import { lyriaFailureMessage } from "../execution/gemini-lyria-execution.js";
import { modelPrice, modelDescriptions } from "./models.js";
import { createHash, randomInt } from "node:crypto";
import { canonical, digest, DomainError, invariant, moneyMicros } from "@openslate/core";
import type { JsonObject, JsonValue } from "@openslate/core";
import type { CodePlanDiff, CodePlanSourceView, CodePlanView } from "@openslate/core/public";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { CodePlanExecution } from "./execution.js";
import { CODE_PLAN_MODELS, normalizeStepInput, stepKey } from "./identity.js";
import type { CodePlanMediaKind, CodePlanModel } from "./identity.js";
import type { CodePlanChoice, CodePlanHold, CodePlanInvocation, CodePlanRun, CodePlanStep, CodePlanVersion } from "./records.js";
import { runSandbox, SANDBOX_PENDING } from "./sandbox.js";
import type { SandboxResult } from "./sandbox.js";
import type { CodePlanPort } from "./port.js";
import { codePlanView, emptyDiff, stepLabel } from "./view.js";
export { normalizeStepInput, stepKey } from "./identity.js";
export type * from "./records.js";

const stamp = () => new Date().toISOString();
const entityId = (projectId: string, key: string) => digest({ projectId, key });
const errorView = (error: unknown) => ({ message: String(error instanceof Error ? error.message : error).slice(0, 4096),
  stack: String(error instanceof Error ? error.stack ?? error.message : error).slice(0, 8192) });
const flights = new WeakMap<Store, Map<string, Promise<CodePlanRun>>>();

/** Experimental, host-owned replay coordinator. It never admits graph candidates or grants. */
export class CodePlanRuntime implements CodePlanPort {
  private readonly capacityWaiting = new Set<string>();
  private readonly models: Readonly<Record<string, CodePlanModel>> | undefined;
  private readonly maxSteps: number;
  private readonly queued = new Set<string>();
  private readonly passes: Map<string, Promise<CodePlanRun>>;
  private ticking: Promise<void> | undefined;
  private stopping = false;
  private readonly limits: { cpuMs?: number; memoryMb?: number };
  private readonly recovery: InstallationRecoveryGuard;
  constructor(readonly store: Store, private readonly options: {
    execution: CodePlanExecution; models?: Readonly<Record<string, CodePlanModel>>;
    limits?: { cpuMs?: number; memoryMb?: number; maxSteps?: number };
  }) {
    this.recovery = new InstallationRecoveryGuard(store);
    this.models = options.models ? structuredClone(options.models) : undefined;
    for (const model of Object.values(this.models ?? CODE_PLAN_MODELS)) {
      invariant(["image", "video", "speech", "music", "render"].includes(model.kind), "CODE_PLAN_MODEL", "Invalid model operation");
      moneyMicros(model.priceMicros ?? "0");
      invariant(model.kind !== "render" || moneyMicros(model.priceMicros ?? "0") === 0n, "CODE_PLAN_MODEL", "Local renders are free");
    }
    this.maxSteps = options.limits?.maxSteps ?? 200;
    invariant(Number.isSafeInteger(this.maxSteps) && this.maxSteps >= 1 && this.maxSteps <= 200, "CODE_PLAN_LIMIT", "Use a media step limit from 1 to 200");
    const { maxSteps: _maxSteps, ...limits } = options.limits ?? {};
    this.limits = limits;
    this.passes = flights.get(store) ?? new Map(); flights.set(store, this.passes);
    // Startup is a wake; recovery still uses the same submission identity.
    for (const project of store.listProjects()) if (project.planMode === "code" && this.getRun(project.id)) this.queued.add(project.id);
  }

  getRun(projectId: string): CodePlanRun | undefined { return this.store.get("code_plan_run", projectId); }
  steps(projectId: string): CodePlanStep[] { return this.store.list("code_plan_step", projectId); }
  choices(projectId: string): CodePlanChoice[] { return this.store.list("code_plan_choice", projectId); }
  availableModels(projectId: string): ReturnType<typeof modelDescriptions> {
    this.assertProject(projectId);
    return modelDescriptions(this.models ?? this.options.execution.models(projectId));
  }
  view(projectId: string): CodePlanView {
    this.assertProject(projectId);
    return codePlanView(this.store, this.options.execution, projectId);
  }
  source(projectId: string, version: number): CodePlanSourceView {
    this.assertProject(projectId);
    const row = this.store.get<CodePlanVersion>("code_plan_version", entityId(projectId, `version:${version}`));
    invariant(row, "NOT_FOUND", "Code plan version not found");
    return { version: row.version, author: row.author, sha256: row.sha256, source: row.source, createdAt: row.createdAt };
  }
  async dryRun(projectId: string, source: string): Promise<CodePlanDiff> {
    this.assertProject(projectId);
    return (await this.evaluate(projectId, source, true)).diff;
  }
  async submit(projectId: string, input: {
    source: string; author: "director" | "user"; basedOnVersion: number | null; invocationId: string;
  }): Promise<{ version: number; diff: CodePlanDiff }> {
    this.assertCode(projectId);
    invariant(typeof input.invocationId === "string" && input.invocationId.length > 0 && input.invocationId.length <= 200,
      "CODE_PLAN_INVOCATION", "Use a bounded invocation id");
    invariant(input.basedOnVersion === null || Number.isSafeInteger(input.basedOnVersion) && input.basedOnVersion > 0,
      "REVISION_CONFLICT", "Use the current code plan version");
    const id = entityId(projectId, `invocation:${input.invocationId}`);
    const previous = this.store.get<CodePlanInvocation>("code_plan_invocation", id);
    if (previous) return { version: previous.version, diff: previous.diff };
    const expected = input.basedOnVersion ?? 0;
    invariant((this.getRun(projectId)?.planVersion ?? 0) === expected, "REVISION_CONFLICT", "Code plan changed; reload before editing");
    const clock = this.getRun(projectId) ?? { now: Date.now(), seed: randomInt(1, 0x7fffffff) };
    const diff = (await this.evaluate(projectId, input.source, true, clock)).diff;
    // The sandbox yields: recheck both idempotency and the version in one transaction.
    return this.store.transaction(() => {
      this.assertCode(projectId);
      const replay = this.store.get<CodePlanInvocation>("code_plan_invocation", id);
      if (replay) return { version: replay.version, diff: replay.diff };
      invariant((this.getRun(projectId)?.planVersion ?? 0) === expected, "REVISION_CONFLICT", "Code plan changed; reload before editing");
      if (diff.findings.some(finding => finding.code === "SOURCE_SYNTAX" || finding.code === "RUNTIME_ERROR"))
        throw new DomainError("CODE_PLAN_REJECTED", "Code plan failed its dry run", { diff });
      const record = this.submitPlan(projectId, input.source, input.author, expected, diff, clock);
      this.store.insert("code_plan_invocation", id, projectId, { id, projectId, invocationId: input.invocationId, version: record.version, diff });
      return { version: record.version, diff };
    });
  }
  answer(projectId: string, input: { choiceId: string; optionsDigest: string; answer: unknown }): CodePlanView {
    this.answerChoice(projectId, input.choiceId, input.optionsDigest, input.answer as JsonValue);
    return this.view(projectId);
  }
  hold(projectId: string, holdId: string): void { this.setHold(projectId, holdId, false); }
  release(projectId: string, holdId: string): void { this.setHold(projectId, holdId, true); }
  failure(projectId: string): { version: number; message: string; stack: string } | null {
    this.assertProject(projectId);
    const run = this.getRun(projectId);
    return run?.error ? { version: run.planVersion, ...run.error } : null;
  }
  private setHold(projectId: string, holdId: string, released: boolean): void {
    this.assertCode(projectId);
    invariant(typeof holdId === "string" && holdId.length > 0 && holdId.length <= 200, "CODE_PLAN_HOLD", "Use a bounded hold id");
    const id = entityId(projectId, `hold:${holdId}`);
    this.store.transaction(() => {
      const previous = this.store.get<CodePlanHold>("code_plan_hold", id);
      // A late retry of hold must never reopen its already released identity.
      if (previous && (previous.released || !released)) return;
      this.store.put("code_plan_hold", id, projectId, { id, projectId, holdId, released });
      if (released) this.queued.add(projectId);
      if (previous || !released) this.changed(projectId);
    });
  }
  private changed(projectId: string): void {
    // A replay timestamp is diagnostic, not a reason for another browser refetch.
    const { lastPassAt: _lastPassAt, ...view } = this.view(projectId);
    const value = digest(view), previous = this.store.get<{ digest: string }>("code_plan_view_digest", projectId);
    if (previous?.digest === value) return;
    this.store.transaction(() => {
      this.store.put("code_plan_view_digest", projectId, projectId, { digest: value });
      this.store.appendEvent(projectId, "code_plan.changed", { planVersion: view.planVersion, state: view.state });
    });
  }
  stop(): void { this.stopping = true; }
  async close(): Promise<void> {
    this.stop(); await this.options.execution.close();
    await Promise.allSettled([...this.passes.values(), ...(this.ticking ? [this.ticking] : [])]);
  }

  submitPlan(projectId: string, source: string, author: "director" | "user" = "user", expectedVersion?: number,
    diff?: CodePlanDiff, clock?: { now: number; seed: number }): CodePlanVersion {
    this.assertCode(projectId);
    invariant(typeof source === "string" && Buffer.byteLength(source) > 0 && Buffer.byteLength(source) <= 256 * 1024,
      "CODE_PLAN_SOURCE", "Use a plan source of at most 256 KiB");
    invariant(author === "director" || author === "user", "CODE_PLAN_AUTHOR", "Invalid plan author");
    const version = this.store.transaction(() => {
      const current = this.getRun(projectId);
      invariant(expectedVersion === undefined || (current?.planVersion ?? 0) === expectedVersion, "REVISION_CONFLICT", "Code plan changed; reload before editing");
      const next = (current?.planVersion ?? 0) + 1;
      const record: CodePlanVersion = { id: entityId(projectId, `version:${next}`), projectId, version: next, source,
        sha256: createHash("sha256").update(source).digest("hex"), author, createdAt: stamp(), ...(diff ? { diff } : {}) };
      this.store.put("code_plan_version", record.id, projectId, record);
      const run: CodePlanRun = current ? { ...current, planVersion: next, state: "running", error: null, reachedStepKeys: [] }
        : { id: projectId, projectId, planVersion: next, state: "running", now: clock?.now ?? Date.now(), seed: clock?.seed ?? randomInt(1, 0x7fffffff),
          ceilingMicros: "1000000", lastPassAt: null, error: null, reachedStepKeys: [], declarations: { scenes: [], shots: [] }, logs: [] };
      this.store.put("code_plan_run", projectId, projectId, run);
      this.changed(projectId);
      return record;
    });
    this.queued.add(projectId); return version;
  }

  answerChoice(projectId: string, choiceId: string, optionsDigest: string, answer: JsonValue): void {
    this.assertCode(projectId);
    const run = this.getRun(projectId);
    invariant(run && this.store.get<CodePlanVersion>("code_plan_version", entityId(projectId, `version:${run.planVersion}`)), "CODE_PLAN_MISSING", "No code plan is saved");
    const id = entityId(projectId, digest({ choiceId, optionsDigest }));
    const choice = this.store.get<CodePlanChoice>("code_plan_choice", id);
    invariant(choice && choice.options.some(option => canonical(option) === canonical(answer)), "CODE_PLAN_CHOICE", "Answer must be one of this choice's exact options");
    invariant(choice.answer === undefined || canonical(choice.answer) === canonical(answer), "CODE_PLAN_CHOICE_ANSWERED", "This choice already has another answer");
    this.store.put("code_plan_choice", id, projectId, { ...choice, answer, answeredAt: choice.answeredAt ?? stamp() });
    this.changed(projectId);
    this.queued.add(projectId);
  }

  raiseCeiling(projectId: string, micros: string): CodePlanView {
    this.assertCode(projectId);
    const run = this.getRun(projectId); invariant(run, "CODE_PLAN_MISSING", "No code plan is saved");
    invariant(moneyMicros(micros) > moneyMicros(run.ceilingMicros), "CODE_PLAN_CEILING", "The new ceiling must be higher");
    return this.setCeiling(projectId, { ceilingMicros: micros, by: "person" });
  }

  setCeiling(projectId: string, input: { ceilingMicros: string; by: "person" } | { ceilingMicros: string; by: "director"; quote: string; invocationId: string }): CodePlanView {
    this.assertCode(projectId);
    if (input.by === "director") return this.store.command(`code-plan:${projectId}:ceiling`, input.invocationId, digest(input),
      () => this.setCeiling(projectId, { ceilingMicros: input.ceilingMicros, by: "person" }));
    const run = this.getRun(projectId); invariant(run, "CODE_PLAN_MISSING", "No code plan is saved");
    const amount = moneyMicros(input.ceilingMicros), accounting = this.options.execution.accounting(projectId);
    if (amount < accounting.total) throw new DomainError("CODE_PLAN_CEILING", "The limit cannot be below charged, unknown and in-flight work", {
      ceilingMicros: input.ceilingMicros, chargedMicros: accounting.charged.toString(), unknownMicros: accounting.unknown.toString(),
      inFlightMicros: accounting.inFlight.toString(), liabilityMicros: accounting.total.toString(),
    });
    this.store.put("code_plan_run", projectId, projectId, { ...run, ceilingMicros: input.ceilingMicros });
    this.queued.add(projectId);
    this.changed(projectId);
    return this.view(projectId);
  }

  retryStep(projectId: string, input: { stepKey: string; consent: { by: "person" } | { by: "director"; quote: string; invocationId: string } }): CodePlanView {
    this.assertCode(projectId);
    if (input.consent.by === "director") return this.store.command(`code-plan:${projectId}:retry`, input.consent.invocationId, digest(input),
      () => this.retryStep(projectId, { stepKey: input.stepKey, consent: { by: "person" } }));
    this.syncSteps(projectId);
    const run = this.getRun(projectId), step = this.steps(projectId).find(step => step.key === input.stepKey);
    invariant(run && run.reachedStepKeys.includes(input.stepKey) && step?.state === "failed" && step.result && !step.result.ok
      && step.result.error.retry !== "none", "CODE_PLAN_RETRY", "Only a reached failed or terminal-unknown step that permits retry can be retried");
    // Mark a new intent for the next replay. Stop, holds, ceiling and capacity still gate admission.
    this.store.put("code_plan_step", step.id, projectId, { ...step, retryAt: Date.now(), updatedAt: stamp() });
    this.queued.add(projectId); this.changed(projectId);
    return this.view(projectId);
  }

  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    const work = async () => {
      if (this.stopping || this.recovery.isQuarantined()) return;
      for (const project of this.store.listProjects()) {
        if (project.planMode !== "code" || !this.getRun(project.id)) continue;
        try {
          if (this.capacityWaiting.delete(project.id)) this.queued.add(project.id);
          if (this.steps(project.id).some(step => step.retryAt !== undefined && step.retryAt <= Date.now())) this.queued.add(project.id);
          let ingestionError: unknown;
          try { if (await this.options.execution.advance(project.id)) this.queued.add(project.id); }
          catch (error) { ingestionError = error; }
          if (this.syncSteps(project.id)) this.queued.add(project.id);
          // A wake during a live pass belongs to its successor, even if tick joins that pass.
          if (!this.passes.has(project.id) && this.queued.delete(project.id)) await this.replay(project.id);
          const run = this.getRun(project.id)!;
          if (ingestionError && !this.passes.has(project.id) && (run.state === "waiting" || run.state === "paused_budget" || run.state === "error")
            && this.steps(project.id).some(step => run.reachedStepKeys.includes(step.key) && step.attemptId
              && this.store.get<import("../execution/engine.js").Attempt>("attempt", step.attemptId)?.phase === "ingesting"))
            this.store.put("code_plan_run", project.id, project.id, { ...run, state: "error", error: errorView(ingestionError) });
        } catch (error) {
          const run = this.getRun(project.id)!;
          this.store.put("code_plan_run", project.id, project.id, { ...run, state: "error", error: errorView(error) });
        }
        this.changed(project.id);
      }
    };
    this.ticking = work().finally(() => { this.ticking = undefined; }); return this.ticking;
  }

  replay(projectId: string): Promise<CodePlanRun> {
    this.assertCode(projectId);
    const active = this.passes.get(projectId); if (active) return active;
    const pass = this.pass(projectId).finally(() => { if (this.passes.get(projectId) === pass) this.passes.delete(projectId); });
    this.passes.set(projectId, pass); return pass;
  }

  private assertCode(projectId: string): void {
    this.assertProject(projectId);
    invariant(!this.stopping, "CODE_PLAN_STOPPED", "Code-plan execution is stopping");
    this.recovery.assertWritable();
  }
  private assertProject(projectId: string): void {
    invariant(this.store.getProject(projectId).planMode === "code", "CODE_PLAN_MODE", "This project uses graph planning");
  }

  private syncSteps(projectId: string): boolean {
    let changed = false;
    for (const step of this.steps(projectId)) {
      if (!step.attemptId || step.result && (step.result.ok || step.result.error.retry !== undefined && step.result.error.mayHaveCharged !== undefined)) continue;
      const attempt = this.store.get<import("../execution/engine.js").Attempt>("attempt", step.attemptId);
      invariant(attempt?.projectId === projectId, "CODE_PLAN_JOURNAL", "Step lost its admitted attempt");
      const state = attempt.phase === "succeeded" ? "succeeded" : attempt.phase === "failed" ? "failed"
        : attempt.phase === "submission_unknown" ? "unknown" : "in_flight";
      if (state === step.state && !step.result) continue;
      const artifacts = Object.values(attempt.outputs);
      invariant(state !== "succeeded" || artifacts.length > 0, "CODE_PLAN_JOURNAL", "A successful step requires ingested output");
      const failure = this.options.execution.failure(attempt.id), retry = failure.retry;
      const musicArtifact = state === "succeeded" && step.kind === "music"
        ? this.store.get<import("../execution/engine.js").ArtifactRecord & { leadInSamples?: number }>("artifact", artifacts[0]!.artifactId) : undefined;
      const result: CodePlanStep["result"] = state === "succeeded" ? { ok: true, artifact: artifacts[0]!, artifacts,
        ...(musicArtifact ? { leadInSamples: musicArtifact.leadInSamples ?? 0, durationSamples: Math.round((musicArtifact.physicalDurationSeconds ?? 0) * 48000) } : {}) }
        : state === "failed" ? { ok: false, error: { ...failure, message: step.kind === "music" ? lyriaFailureMessage(failure.code) : "Provider execution failed" } } : null;
      const automaticRetries = step.automaticRetries ?? 0;
      this.store.put("code_plan_step", step.id, projectId, { ...step, state, result, updatedAt: stamp(),
        ...(state === "failed" && retry === "safe" && automaticRetries < 2
          ? { retryAt: Date.now() + 250 * 2 ** automaticRetries, automaticRetries: automaticRetries + 1 } : {}) }); changed = true;
    }
    return changed;
  }

  private async pass(projectId: string): Promise<CodePlanRun> {
    this.syncSteps(projectId);
    const run = this.getRun(projectId); invariant(run, "CODE_PLAN_MISSING", "No code plan is saved");
    const version = this.store.get<CodePlanVersion>("code_plan_version", entityId(projectId, `version:${run.planVersion}`));
    invariant(version && version.sha256 === createHash("sha256").update(version.source).digest("hex"), "CODE_PLAN_JOURNAL", "Plan source identity differs");
    const { outcome, reached, declarations, logs, budget } = await this.evaluate(projectId, version.source, false);
    // Leave outcomes from an obsolete pass in history; never overwrite the newer plan's run state.
    const current = this.getRun(projectId)!;
    if (current.planVersion !== run.planVersion) { this.queued.add(projectId); return current; }
    for (const step of this.steps(projectId)) if (!reached.has(step.key) && !step.attemptId && step.state !== "cancelled")
      this.store.put("code_plan_step", step.id, projectId, { ...step, state: "cancelled", updatedAt: stamp() });
    const failed = this.steps(projectId).some(step => reached.has(step.key) && step.state === "failed" && step.retryAt === undefined);
    const result: CodePlanRun = { ...current, state: outcome.state === "error" ? "error" : budget ? "paused_budget"
      : outcome.state === "done" && failed ? "done_with_failures" : outcome.state,
      lastPassAt: stamp(), error: outcome.error ?? null, reachedStepKeys: [...reached], declarations, logs };
    this.store.put("code_plan_run", projectId, projectId, result); this.changed(projectId); return result;
  }

  /** One call path for preview and execution. Preview keeps all new state in memory. */
  private async evaluate(projectId: string, source: string, dry: boolean, clock?: { now: number; seed: number }) {
    const run = this.getRun(projectId), models = this.models ?? this.options.execution.models(projectId);
    const reached = new Set<string>(), declarations: CodePlanRun["declarations"] = { scenes: [], shots: [] }, logs: string[] = [];
    const journal = this.steps(projectId), virtual = new Map(journal.map(step => [step.key, step]));
    const diff = emptyDiff(), submissions: Promise<void>[] = [];
    let budget = false, limited = false;
    const reused = new Set<string>(), fresh = new Set<string>();
    const call = (method: string, args: unknown[]): unknown => {
      if (dry) this.assertProject(projectId);
      else {
        this.assertCode(projectId);
        invariant(this.getRun(projectId)?.planVersion === run?.planVersion, "REVISION_CONFLICT", "A newer plan replaced this pass");
      }
      if (method === "shot" || method === "scene") {
        const value = args[0];
        invariant(value && typeof value === "object" && !Array.isArray(value) && Buffer.byteLength(canonical(value)) <= 64 * 1024,
          "CODE_PLAN_DECLARATION", "Storyboard declarations must be bounded objects");
        const rows = method === "shot" ? declarations.shots : declarations.scenes;
        invariant(rows.length < 200, "CODE_PLAN_LIMIT", "Too many storyboard declarations"); rows.push(value as JsonObject); return value;
      }
      if (method === "log") { invariant(typeof args[0] === "string" && args[0].length <= 4096 && logs.length < 200,
        "CODE_PLAN_LOG", "Use at most 200 bounded log lines"); logs.push(args[0]); return null; }
      if (method === "choose") return this.choose(projectId, args, dry);
      invariant(method === "image" || method === "video" || method === "speech" || method === "music" || method === "render", "CODE_PLAN_METHOD", "Unknown Studio operation");
      const kind: CodePlanMediaKind = method;
      const normalized = normalizeStepInput(kind, args[0], models);
      // Previously journaled defaults are immutable: installing new aspect inference
      // must not silently buy replacement clips for an unchanged saved program.
      const journaledDefault = kind === "video" && normalized.aspectRatio === undefined
        && virtual.has(stepKey(kind, normalized));
      const input = kind === "video" && !journaledDefault
        ? this.options.execution.normalizeVideoInput(projectId, normalized, models[String(normalized.model)]!) : normalized;
      const key = stepKey(kind, input), id = entityId(projectId, key);
      reached.add(key);
      let step = dry ? virtual.get(key) : this.store.get<CodePlanStep>("code_plan_step", id);
      if (step?.retryAt !== undefined && step.retryAt > Date.now()) return SANDBOX_PENDING;
      if (step?.retryAt === undefined && (step?.result || step?.attemptId)) {
        reused.add(key);
        return step.result ?? SANDBOX_PENDING;
      }
      const priceMicros = modelPrice(models[String(input.model)]!);
      step = { ...(step ?? { id, projectId, key, kind, input, attemptId: null, result: null, createdAt: stamp() }),
        state: "absent", priceMicros,
        updatedAt: step?.state === "absent" && step.priceMicros === priceMicros ? step.updatedAt : stamp() };
      virtual.set(key, step);
      if (!fresh.has(key)) {
        fresh.add(key);
        diff.newSteps.push({ kind, model: String(input.model), label: stepLabel(input), priceMicros: step.priceMicros });
      }
      if (dry) {
        limited ||= this.options.execution.attempts(projectId).length + fresh.size > this.maxSteps;
        return SANDBOX_PENDING;
      }
      // These predicates run immediately before intent admission, even for a pass
      // that started before the Director opened a hold or raised the ceiling.
      if (moneyMicros(step.priceMicros) > 0n && this.store.list<CodePlanHold>("code_plan_hold", projectId).some(hold => !hold.released)) {
        this.store.put("code_plan_step", id, projectId, step); return SANDBOX_PENDING;
      }
      if (this.store.get<{ paused: boolean }>("execution_control", projectId)?.paused) {
        this.store.put("code_plan_step", id, projectId, step); return SANDBOX_PENDING;
      }
      const liability = this.options.execution.accounting(projectId).total;
      if (liability + moneyMicros(step.priceMicros) > moneyMicros(this.getRun(projectId)!.ceilingMicros)) {
        budget = true; this.store.put("code_plan_step", id, projectId, step); return SANDBOX_PENDING;
      }
      invariant(this.options.execution.attempts(projectId).length < this.maxSteps,
        "CODE_PLAN_STEP_LIMIT", `Code plans allow at most ${this.maxSteps} dispatched media steps per project`);
      if (!this.options.execution.hasCapacity(projectId, input)) {
        this.capacityWaiting.add(projectId); this.store.put("code_plan_step", id, projectId, step); return SANDBOX_PENDING;
      }
      const admitted = this.store.transaction(() => {
        const attempt = this.options.execution.prepare(projectId, key, kind, input, {
          ...(step.attemptId ? { previousAttemptId: step.attemptId } : {}), priceMicros: step.priceMicros });
        const { retryAt: _retryAt, ...next } = step;
        this.store.put("code_plan_step", id, projectId, { ...next, result: null, state: "in_flight", attemptId: attempt.id });
        return attempt;
      });
      const submission = this.options.execution.submit(admitted.id).finally(() => { this.queued.add(projectId); });
      void submission.catch(() => {}); submissions.push(submission);
      return SANDBOX_PENDING;
    };
    let outcome: SandboxResult;
    try {
      outcome = await runSandbox({ source, now: clock?.now ?? run?.now ?? Date.now(), seed: clock?.seed ?? run?.seed ?? 1, limits: this.limits, call });
      const settled = await Promise.allSettled(submissions);
      const rejected = settled.find(result => result.status === "rejected");
      if (rejected?.status === "rejected") outcome = { state: "error", error: errorView(rejected.reason) };
    } catch (error) { outcome = { state: "error", error: errorView(error) }; }
    diff.reusedSteps = reused.size;
    diff.cancelledSteps = journal.filter(step => !step.attemptId && step.state !== "cancelled" && !reached.has(step.key)).length;
    diff.certainMicros = diff.newSteps.reduce((sum, step) => sum + moneyMicros(step.priceMicros), 0n).toString();
    diff.dependsOnPending = outcome.state === "waiting";
    if (outcome.errorCode === "SOURCE_SYNTAX") diff.findings.push({ code: "SOURCE_SYNTAX", detail: outcome.error?.message ?? "Source evaluation failed" });
    else if (outcome.state === "error") diff.findings.push({ code: "RUNTIME_ERROR", detail: outcome.error?.message ?? "Pass failed" });
    if (outcome.unawaitedCalls?.length) diff.findings.push({ code: "UNAWAITED_CALL", detail: [...new Set(outcome.unawaitedCalls)].join(", ") });
    if (limited) diff.findings.push({ code: "STEP_LIMIT" });
    const liability = this.options.execution.accounting(projectId).total;
    if (moneyMicros(diff.certainMicros) > moneyMicros(run?.ceilingMicros ?? "1000000") - liability) diff.findings.push({ code: "CEILING" });
    return { outcome, reached, declarations, logs, budget, diff };
  }

  private choose(projectId: string, args: unknown[], dry = false): unknown {
    const [choiceId, raw] = args;
    invariant(typeof choiceId === "string" && choiceId.length > 0 && choiceId.length <= 200 && raw && typeof raw === "object",
      "CODE_PLAN_CHOICE", "Use a bounded choice id and question/options");
    const { question, options } = raw as Record<string, unknown>;
    invariant(typeof question === "string" && question.length <= 4096 && Array.isArray(options) && options.length > 0 && options.length <= 200
      && Buffer.byteLength(canonical(options)) <= 64 * 1024, "CODE_PLAN_CHOICE", "Use a bounded question and 1 to 200 JSON options");
    const optionsDigest = digest(options), id = entityId(projectId, digest({ choiceId, optionsDigest }));
    const previous = this.store.get<CodePlanChoice>("code_plan_choice", id);
    const choice: CodePlanChoice = { ...previous, id, projectId, choiceId, question, options: options as JsonValue[], optionsDigest };
    if (!dry) this.store.put("code_plan_choice", id, projectId, choice);
    return Object.hasOwn(choice, "answer") ? choice.answer : SANDBOX_PENDING;
  }
}
