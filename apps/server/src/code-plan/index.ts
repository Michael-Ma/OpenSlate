import { lyriaFailureMessage } from "../execution/gemini-lyria-execution.js";
import { videoI2vFailure } from "../execution/video-i2v-execution.js";
import { modelPrice, modelDescriptions, codePlanPriceFrame } from "./models.js";
import { createHash, randomInt } from "node:crypto";
import { canonical, digest, DomainError, invariant, moneyMicros } from "@openslate/core";
import type { JsonObject, JsonValue } from "@openslate/core";
import type { CodePlanDiff, CodePlanSourceView, CodePlanStepDetail, CodePlanView } from "@openslate/core/public";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { CodePlanExecution } from "./execution.js";
import { CODE_PLAN_MODELS, normalizeStepInput, stepKey, videoModes } from "./identity.js";
import type { CodePlanMediaKind, CodePlanModel } from "./identity.js";
import { CODE_PLAN_REVIEW_TURNS } from "./records.js";
import type { CodePlanChoice, CodePlanReview, CodePlanHold, CodePlanInvocation, CodePlanRun, CodePlanSettings, CodePlanStep, CodePlanVersion } from "./records.js";
import { runSandbox, SANDBOX_PENDING } from "./sandbox.js";
import type { SandboxResult } from "./sandbox.js";
import type { CodePlanPort } from "./port.js";
import { codePlanView, emptyDiff, stepLabel } from "./view.js";
import { codePlanCeiling } from "./settings.js";
import { codePlanStepDetail } from "./step-detail.js";
import { codePlanProviderArgs } from "./provider-input.js";
import { codePlanVideoSettings, currentVideoModel, isCodePlanVideoResolution } from "./video-settings.js";
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
  wakeReviews(projectId: string): void { this.queued.add(projectId); }
  choices(projectId: string): CodePlanChoice[] { return this.store.list("code_plan_choice", projectId); }
  videoSettings(projectId: string): ReturnType<typeof codePlanVideoSettings> { return codePlanVideoSettings(this.store, projectId); }
  setVideoSettings(projectId: string, resolution: unknown): ReturnType<typeof codePlanVideoSettings> {
    // Availability has the route's dedicated 409, including for graph films.
    this.videoSettings(projectId); this.assertCode(projectId);
    invariant(isCodePlanVideoResolution(resolution), "VALIDATION_ERROR", "Choose 480p, 768p, 1080p or 2k");
    this.store.transaction(() => {
      const settings = this.store.get<CodePlanSettings>("code_plan_settings", projectId) ?? {};
      this.store.put<CodePlanSettings>("code_plan_settings", projectId, projectId, { ...settings, videoResolution: resolution });
      // This policy is outside CodePlanView, so emit even when journal state has not changed yet.
      this.store.appendEvent(projectId, "code_plan.changed", { planVersion: this.getRun(projectId)?.planVersion ?? null,
        state: this.getRun(projectId)?.state ?? "empty" });
    });
    this.queued.add(projectId);
    return this.videoSettings(projectId);
  }
  availableModels(projectId: string): ReturnType<typeof modelDescriptions> {
    this.assertProject(projectId);
    return modelDescriptions(this.models ?? this.options.execution.models(projectId));
  }
  view(projectId: string): CodePlanView {
    this.assertProject(projectId);
    return codePlanView(this.store, this.options.execution, projectId);
  }
  stepDetail(projectId: string, stepKey: string): CodePlanStepDetail {
    this.assertProject(projectId);
    return codePlanStepDetail(this.store, projectId, stepKey, this.options.execution.attempts(projectId));
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
      const run: CodePlanRun = current ? { ...current, planVersion: next, state: "running", error: null, reachedStepKeys: [], reviewKeys: [] }
        : { id: projectId, projectId, planVersion: next, state: "running", now: clock?.now ?? Date.now(), seed: clock?.seed ?? randomInt(1, 0x7fffffff),
          ceilingMicros: codePlanCeiling(this.store, projectId), lastPassAt: null, error: null, reachedStepKeys: [], declarations: { scenes: [], shots: [] }, logs: [] };
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
    if (choice?.answer !== undefined && canonical(choice.answer) === canonical(answer)) return;
    invariant(!choice?.stale, "CODE_PLAN_CHOICE_STALE", "This card no longer applies");
    invariant(choice && choice.options.some(option => canonical(option) === canonical(answer)), "CODE_PLAN_CHOICE", "Answer must be one of this choice's exact options");
    invariant(choice.answer === undefined || canonical(choice.answer) === canonical(answer), "CODE_PLAN_CHOICE_ANSWERED", "This choice already has another answer");
    this.store.put("code_plan_choice", id, projectId, { ...choice, answer, answeredAt: choice.answeredAt ?? stamp() });
    this.changed(projectId);
    this.queued.add(projectId);
  }

  raiseCeiling(projectId: string, micros: string): CodePlanView {
    this.assertCode(projectId);
    invariant(moneyMicros(micros) > moneyMicros(codePlanCeiling(this.store, projectId)), "CODE_PLAN_CEILING", "The new ceiling must be higher");
    return this.setCeiling(projectId, { ceilingMicros: micros, by: "person" });
  }

  setCeiling(projectId: string, input: { ceilingMicros: string; by: "person" } | { ceilingMicros: string; by: "director"; quote: string; invocationId: string }): CodePlanView {
    this.assertCode(projectId);
    if (input.by === "director") return this.store.command(`code-plan:${projectId}:ceiling`, input.invocationId, digest(input),
      () => this.setCeiling(projectId, { ceilingMicros: input.ceilingMicros, by: "person" }));
    const run = this.getRun(projectId);
    const amount = moneyMicros(input.ceilingMicros), accounting = this.options.execution.accounting(projectId);
    if (amount < accounting.total) throw new DomainError("CODE_PLAN_CEILING", "The limit cannot be below charged, unknown and in-flight work", {
      ceilingMicros: input.ceilingMicros, chargedMicros: accounting.charged.toString(), unknownMicros: accounting.unknown.toString(),
      inFlightMicros: accounting.inFlight.toString(), liabilityMicros: accounting.total.toString(),
    });
    this.store.transaction(() => {
      this.store.put<CodePlanSettings>("code_plan_settings", projectId, projectId,
        { ...this.store.get<CodePlanSettings>("code_plan_settings", projectId), ceilingMicros: input.ceilingMicros });
      if (run) this.store.put("code_plan_run", projectId, projectId, { ...run, ceilingMicros: input.ceilingMicros });
      this.changed(projectId);
    });
    if (run) this.queued.add(projectId);
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
      let backfilled = false;
      for (const project of this.store.listProjects()) {
        if (project.planMode !== "code" || !this.getRun(project.id)) continue;
        try {
          if (this.capacityWaiting.delete(project.id)) this.queued.add(project.id);
          if (this.steps(project.id).some(step => step.retryAt !== undefined && step.retryAt <= Date.now())) this.queued.add(project.id);
          let ingestionError: unknown;
          try { if (await this.options.execution.advance(project.id)) this.queued.add(project.id); }
          catch (error) { ingestionError = error; }
          if (this.stopping) return;
          if (this.syncSteps(project.id)) this.queued.add(project.id);
          // A wake during a live pass belongs to its successor, even if tick joins that pass.
          if (!this.passes.has(project.id) && this.queued.delete(project.id)) await this.replay(project.id);
          if (this.stopping) return;
          const run = this.getRun(project.id)!;
          if (ingestionError && !this.passes.has(project.id) && (run.state === "waiting" || run.state === "paused_budget" || run.state === "error")
            && this.steps(project.id).some(step => run.reachedStepKeys.includes(step.key) && step.attemptId
              && this.store.get<import("../execution/engine.js").Attempt>("attempt", step.attemptId)?.phase === "ingesting"))
            this.store.put("code_plan_run", project.id, project.id, { ...run, state: "error", error: errorView(ingestionError) });
        } catch (error) {
          const run = this.getRun(project.id)!;
          this.store.put("code_plan_run", project.id, project.id, { ...run, state: "error", error: errorView(error) });
        }
        // Historical thumbnails are local maintenance, bounded across the entire tick.
        if (!backfilled) backfilled = await this.options.execution.backfillPoster(project.id);
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
      const result: CodePlanStep["result"] = state === "succeeded" ? { ok: true, artifact: (step.kind === "video" || step.kind === "render" ? attempt.outputs.video : step.kind === "image" ? attempt.outputs.image : attempt.outputs.audio) ?? artifacts[0]!, artifacts,
        ...(musicArtifact ? { leadInSamples: musicArtifact.leadInSamples ?? 0, durationSamples: Math.round((musicArtifact.physicalDurationSeconds ?? 0) * 48000) } : {}) }
        : state === "failed" ? { ok: false, error: { ...failure, message: step.kind === "music" ? lyriaFailureMessage(failure.code) : videoI2vFailure(this.store, attempt)?.message ?? "Provider execution failed" } } : null;
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
    const { outcome, reached, reachedChoices, declarations, logs, budget, reviewKeys } = await this.evaluate(projectId, version.source, false);
    // Leave outcomes from an obsolete pass in history; never overwrite the newer plan's run state.
    const current = this.getRun(projectId)!;
    // Shutdown interrupts replay, not the saved film. Keep its saved run and
    // journal reachability for the next runtime to replay.
    if (this.stopping) return current;
    if (current.planVersion !== run.planVersion) { this.queued.add(projectId); return current; }
    for (const step of this.steps(projectId)) if (!reached.has(step.key) && !step.attemptId && step.state !== "cancelled")
      this.store.put("code_plan_step", step.id, projectId, { ...step, state: "cancelled", updatedAt: stamp() });
    const lastPassAt = stamp();
    if (outcome.state !== "error") this.settleChoices(projectId, reachedChoices, lastPassAt);
    const failed = this.steps(projectId).some(step => reached.has(step.key) && step.state === "failed" && step.retryAt === undefined);
    const result: CodePlanRun = { ...current, state: outcome.state === "error" ? "error" : budget ? "paused_budget"
      : reviewKeys.some(id => ["waiting", "watching"].includes(this.store.get<CodePlanReview>("code_plan_review", id)?.state ?? "")) ? "reviewing"
      : outcome.state === "done" && failed ? "done_with_failures" : outcome.state,
      lastPassAt, error: outcome.error ?? null, reachedStepKeys: [...reached], reviewKeys, declarations, logs };
    this.store.put("code_plan_run", projectId, projectId, result); this.changed(projectId); return result;
  }

  private settleChoices(projectId: string, reached: Set<string>, now: string): void {
    const frames = new Map(this.steps(projectId).flatMap(step => step.kind === "image" && step.result?.ok
      ? [[`${step.result.artifact.artifactId}:${step.result.artifact.sha256}`, step.updatedAt] as const] : []));
    for (const choice of this.choices(projectId)) {
      const { stale: _stale, ...row } = choice;
      const current = reached.has(choice.id), unanswered = choice.answer === undefined;
      const next: CodePlanChoice = { ...row, ...(!current ? { stale: true } as const : {}) };
      if (current && unanswered && choice.stale) next.askedAt = now;
      if (!next.askedAt) {
        const option = choice.options[0];
        const value = option && typeof option === "object" && !Array.isArray(option) ? option.artifact ?? option : undefined;
        const frame = value && typeof value === "object" && !Array.isArray(value) && value.kind === "image"
          ? frames.get(`${value.artifactId}:${value.sha256}`) : undefined;
        if (frame) next.askedAt = frame;
        else if (current && unanswered && !choice.answeredAt) next.askedAt = now;
      }
      if (canonical(next) !== canonical(choice)) this.store.put("code_plan_choice", choice.id, projectId, next);
    }
  }

  /** One call path for preview and execution. Preview keeps all new state in memory. */
  private async evaluate(projectId: string, source: string, dry: boolean, clock?: { now: number; seed: number }) {
    const run = this.getRun(projectId), models = this.models ?? this.options.execution.models(projectId);
    const reached = new Set<string>(), declarations: CodePlanRun["declarations"] = { scenes: [], shots: [] }, logs: string[] = [];
    const journal = this.steps(projectId), virtual = new Map(journal.map(step => [step.key, step]));
    const diff = emptyDiff(), submissions: Promise<void>[] = [];
    const reviewKeys: string[] = [];
    const reachedChoices = new Set<string>();
    const lock = this.store.list<{ lock: { compatibility: { toolContract: string } } }>("director_skill_lock", projectId).at(-1)?.lock;
    const filmQualityEnabled = !lock || lock.compatibility.toolContract === "0.3.0";
    const confirmedKeyframes = new Map<string, { frame: JsonObject; choice: string }>();
    const journalKeys = new Set(journal.filter(step => step.attemptId || step.result).map(step => step.key));
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
      if (method === "review") {
        invariant(filmQualityEnabled, "CODE_PLAN_METHOD", "Review needs tool contract 0.3.0");
        const [reviewId, raw] = args;
        invariant(typeof reviewId === "string" && reviewId.length > 0 && reviewId.length <= 200 && raw && typeof raw === "object",
          "CODE_PLAN_REVIEW", "Use a bounded review id and clips/note");
        const { clips, note } = raw as Record<string, unknown>;
        invariant(typeof note === "string" && note.length <= 4096 && Array.isArray(clips) && clips.length > 0 && clips.length <= 200,
          "CODE_PLAN_REVIEW", "Review needs 1 to 200 owned video artifacts and a bounded note");
        const owned = clips.map(ref => {
          const value = ref as import("@openslate/core").ArtifactRef | null;
          const record = value && this.store.get<import("../execution/engine.js").ArtifactRecord>("artifact", value.artifactId);
          invariant(record?.projectId === projectId && record.artifact.kind === "video" && value?.kind === "video" && record.artifact.sha256 === value.sha256,
            "CODE_PLAN_ARTIFACT_INVALID", "Review clips must be owned video artifacts");
          return record.artifact;
        });
        const clipsDigest = digest(owned), id = entityId(projectId, digest({ reviewId, clipsDigest }));
        if (!reviewKeys.includes(id)) reviewKeys.push(id);
        let review = this.store.get<CodePlanReview>("code_plan_review", id);
        const capped = this.store.list<CodePlanReview>("code_plan_review", projectId).filter(row => row.requestId).length >= CODE_PLAN_REVIEW_TURNS;
        if (!review) {
          review = { id, projectId, reviewId, clipsDigest, clips: owned, note, state: capped ? "done" : "waiting",
            ...(capped ? { skipped: true } : {}), createdAt: stamp(), updatedAt: stamp() };
          if (!dry) this.store.put("code_plan_review", id, projectId, review);
        } else if (!dry && review.note !== note) {
          review = { ...review, note, updatedAt: stamp() };
          this.store.put("code_plan_review", id, projectId, review);
        }
        const line = review.skipped ? `Review ${reviewId} skipped: all ${CODE_PLAN_REVIEW_TURNS} review turns already used.`
          : review.state === "failed" ? `Review ${reviewId} failed; continuing the film.` : undefined;
        if (line && !logs.includes(line)) logs.push(line);
        return review.state === "done" || review.state === "failed" ? null : SANDBOX_PENDING;
      }
      if (method === "choose") return this.choose(projectId, args, dry, reachedChoices);
      if (method === "keyframe") {
        invariant(filmQualityEnabled, "CODE_PLAN_METHOD", "Keyframes need tool contract 0.3.0");
        const [shot, raw] = args;
        const declaration = declarations.shots.find(row => row.id === shot);
        invariant(typeof shot === "string" && shot.length > 0 && shot.length <= 120 && declaration,
          "CODE_PLAN_KEYFRAME_INPUT", "ctx.keyframe needs a shot declared in this pass");
        invariant(raw && typeof raw === "object" && !Array.isArray(raw), "CODE_PLAN_KEYFRAME_INPUT", "Use a keyframe input with video settings");
        const { video, ...picture } = raw as Record<string, unknown>;
        invariant(video && typeof video === "object" && !Array.isArray(video)
          && typeof (video as Record<string, unknown>).durationSeconds === "number"
          && Number.isFinite((video as Record<string, unknown>).durationSeconds) && Number((video as Record<string, unknown>).durationSeconds) > 0,
        "CODE_PLAN_KEYFRAME_INPUT", "ctx.keyframe needs video with durationSeconds and optional model/aspectRatio");
        // Select the video model through the same defaults and normalization as ctx.video.
        const settings = video as Record<string, unknown>;
        const modelId = settings.model ?? (models["fake-video"] ? "fake-video" : Object.keys(models).find(id => models[id]?.kind === "video"));
        invariant(typeof modelId === "string" && models[modelId]?.kind === "video", "CODE_PLAN_MODEL", "Use a configured video model");
        const model = currentVideoModel(this.store, projectId, models[modelId]!), modes = videoModes(model);
        invariant(model.profile?.adapter !== "viggle-h3" || settings.resolution === undefined,
          "CODE_PLAN_INPUT", "Viggle resolution belongs to the film's video settings; omit resolution from keyframe.video");
        const image = call("image", [{ ...picture, shot }]) as CodePlanStep["result"] | typeof SANDBOX_PENDING;
        if (image === SANDBOX_PENDING || !image?.ok) return image;
        const frame = image.artifact as unknown as JsonObject;
        const references = (picture.references ?? []) as JsonObject[];
        const limit = model.profile?.adapter === "viggle-h3" ? 4 : 9;
        const options: JsonObject[] = [];
        const add = (choice: string, input: JsonObject) => {
          const normalized = normalizeStepInput("video", { ...settings, ...input }, models);
          const priced = this.options.execution.normalizeVideoInput(projectId, normalized, model);
          options.push({ ...frame, keyframeInput: choice, references,
            // Flat artifact fields remain compatible with existing choice readers.
            // Bind the recipe too: flat-rate models can change length/model without changing price.
            video: priced,
            priceMicros: modelPrice(model, priced, codePlanPriceFrame(this.store, projectId, priced)) });
        };
        if (modes.includes("reference")) {
          add("keyframe_and_references", { references: [frame, ...references].slice(0, limit) });
          if (references.length) add("references_only", { references });
        }
        if (modes.includes("first_frame")) add("first_frame", { firstFrame: frame });
        invariant(options.length > 0, "CODE_PLAN_KEYFRAME_INPUT", "This video model cannot use keyframes; choose a model with references or first-frame input");
        const answer = this.choose(projectId, [`${shot}-keyframe`, {
          question: typeof declaration.title === "string" ? declaration.title : shot, options,
        }], dry, reachedChoices, true) as JsonObject | typeof SANDBOX_PENDING;
        if (answer === SANDBOX_PENDING) return answer;
        const choice = String(answer.keyframeInput);
        confirmedKeyframes.set(shot, { frame, choice });
        return { ok: true, frame, choice, input: choice === "first_frame" ? { firstFrame: frame }
          : { references: choice === "references_only" ? references : [frame, ...references].slice(0, limit) } };
      }
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
      const shotId = kind !== "render" ? (args[0] as { shot?: string }).shot : undefined;
      if (step && step.shotId !== shotId) {
        const { shotId: _previous, ...previous } = step;
        step = { ...previous, ...(shotId === undefined ? {} : { shotId }), updatedAt: stamp() };
        virtual.set(key, step);
        if (!dry) this.store.put("code_plan_step", id, projectId, step);
      }
      if (step?.retryAt !== undefined && step.retryAt > Date.now()) return SANDBOX_PENDING;
      if (step?.retryAt === undefined && (step?.result || step?.attemptId)) {
        reused.add(key);
        return step.result ?? SANDBOX_PENDING;
      }
      if (kind === "video" && filmQualityEnabled && declarations.shots.length > 0 && !journalKeys.has(key)) {
        const confirmed = shotId && declarations.shots.some(row => row.id === shotId) ? confirmedKeyframes.get(shotId) : undefined;
        invariant(confirmed, "CODE_PLAN_KEYFRAME_REQUIRED",
          "CODE_PLAN_KEYFRAME_REQUIRED: Call ctx.keyframe(shot, …) for this declared shot and spread its input into ctx.video");
        const usesFrame = [input.firstFrame, input.lastFrame, ...(Array.isArray(input.references) ? input.references : [])]
          .some(ref => ref && typeof ref === "object" && !Array.isArray(ref) && ref.kind === "image" && ref.sha256 === confirmed.frame.sha256);
        invariant(confirmed.choice === "references_only" ? !usesFrame : usesFrame, "CODE_PLAN_KEYFRAME_INPUT",
          "CODE_PLAN_KEYFRAME_INPUT: Spread the confirmed keyframe.input into ctx.video; respect whether the person allowed the keyframe as input");
      }
      // Refuse now what dispatch would refuse, while nothing is spent and the Director can still fix its plan.
      const model = currentVideoModel(this.store, projectId, models[String(input.model)]!);
      if (model.profile) codePlanProviderArgs(model.profile, input);
      const priceMicros = modelPrice(model, input, codePlanPriceFrame(this.store, projectId, input));
      step = { ...(step ?? { id, projectId, key, kind, input, attemptId: null, result: null, createdAt: stamp() }),
        ...(shotId === undefined ? {} : { shotId }),
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
      outcome = await runSandbox({ source, filmQualityEnabled, now: clock?.now ?? run?.now ?? Date.now(), seed: clock?.seed ?? run?.seed ?? 1, limits: this.limits, call });
      // Publish what the sandbox reached before a long submission hides it.
      // Without submissions, pass() can write its final state immediately.
      if (!dry && !this.stopping && submissions.length) {
        const current = this.getRun(projectId);
        if (current && current.planVersion === run?.planVersion) {
          this.store.put("code_plan_run", projectId, projectId, { ...current, state: "running", error: null,
            reachedStepKeys: [...reached], reviewKeys, declarations, logs });
          this.changed(projectId);
        }
      }
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
    if (moneyMicros(diff.certainMicros) > moneyMicros(codePlanCeiling(this.store, projectId)) - liability) diff.findings.push({ code: "CEILING" });
    return { outcome, reached, reachedChoices, reviewKeys, declarations, logs, budget, diff };
  }

  private choose(projectId: string, args: unknown[], dry: boolean, reached: Set<string>, keyframe = false): unknown {
    const [choiceId, raw] = args;
    invariant(typeof choiceId === "string" && choiceId.length > 0 && choiceId.length <= 200 && raw && typeof raw === "object",
      "CODE_PLAN_CHOICE", "Use a bounded choice id and question/options");
    const { question, options } = raw as Record<string, unknown>;
    invariant(typeof question === "string" && question.length <= 4096 && Array.isArray(options) && options.length > 0 && options.length <= 200
      && Buffer.byteLength(canonical(options)) <= 64 * 1024, "CODE_PLAN_CHOICE", "Use a bounded question and 1 to 200 JSON options");
    // A setting changes prices, not the person's chosen input. Keep an answered recipe's exact row/answer.
    const recipe = (values: unknown[]) => values.map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const { priceMicros: _price, ...input } = value as JsonObject; return input;
    });
    const equivalent = keyframe ? this.choices(projectId).filter(choice => choice.choiceId === choiceId
      && canonical(recipe(choice.options)) === canonical(recipe(options))) : [];
    const answered = equivalent.find(choice => choice.answer !== undefined);
    if (answered) { reached.add(answered.id); return answered.answer; }
    const optionsDigest = digest(options), id = entityId(projectId, digest({ choiceId, optionsDigest }));
    reached.add(id);
    const previous = this.store.get<CodePlanChoice>("code_plan_choice", id);
    const choice: CodePlanChoice = { ...previous, id, projectId, choiceId, question, options: options as JsonValue[], optionsDigest,
      ...(!previous && !dry ? { askedAt: equivalent.find(choice => !choice.stale)?.askedAt ?? stamp() } : {}) };
    if (!dry && (!previous || canonical(previous) !== canonical(choice))) this.store.put("code_plan_choice", id, projectId, choice);
    return Object.hasOwn(choice, "answer") ? choice.answer : SANDBOX_PENDING;
  }
}
