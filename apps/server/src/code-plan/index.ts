import { createHash, randomInt } from "node:crypto";
import { canonical, digest, invariant, moneyMicros } from "@openslate/core";
import type { JsonObject, JsonValue } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { CodePlanExecution } from "./execution.js";
import { CODE_PLAN_MODELS, normalizeStepInput, stepKey } from "./identity.js";
import type { CodePlanMediaKind, CodePlanModel } from "./identity.js";
import type { CodePlanChoice, CodePlanRun, CodePlanStep, CodePlanVersion } from "./records.js";
import { runSandbox, SANDBOX_PENDING } from "./sandbox.js";
export { normalizeStepInput, stepKey } from "./identity.js";
export type * from "./records.js";

const stamp = () => new Date().toISOString();
const entityId = (projectId: string, key: string) => digest({ projectId, key });
const errorView = (error: unknown) => ({ message: String(error instanceof Error ? error.message : error).slice(0, 4096),
  stack: String(error instanceof Error ? error.stack ?? error.message : error).slice(0, 8192) });
const flights = new WeakMap<Store, Map<string, Promise<CodePlanRun>>>();

/** Experimental, host-owned replay coordinator. It never admits graph candidates or grants. */
export class CodePlanRuntime {
  private readonly models: Readonly<Record<string, CodePlanModel>>;
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
    this.models = structuredClone(options.models ?? CODE_PLAN_MODELS);
    for (const model of Object.values(this.models)) {
      invariant(["image", "video", "render"].includes(model.kind), "CODE_PLAN_MODEL", "Invalid model operation");
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
  stop(): void { this.stopping = true; }
  async close(): Promise<void> {
    this.stop(); await this.options.execution.close();
    await Promise.allSettled([...this.passes.values(), ...(this.ticking ? [this.ticking] : [])]);
  }

  submitPlan(projectId: string, source: string, author: "director" | "user" = "user", expectedVersion?: number): CodePlanVersion {
    this.assertCode(projectId);
    invariant(typeof source === "string" && Buffer.byteLength(source) > 0 && Buffer.byteLength(source) <= 256 * 1024,
      "CODE_PLAN_SOURCE", "Use a plan source of at most 256 KiB");
    invariant(author === "director" || author === "user", "CODE_PLAN_AUTHOR", "Invalid plan author");
    const version = this.store.transaction(() => {
      const current = this.getRun(projectId);
      invariant(expectedVersion === undefined || (current?.planVersion ?? 0) === expectedVersion, "REVISION_CONFLICT", "Code plan changed; reload before editing");
      const next = (current?.planVersion ?? 0) + 1;
      const record: CodePlanVersion = { id: entityId(projectId, `version:${next}`), projectId, version: next, source,
        sha256: createHash("sha256").update(source).digest("hex"), author, createdAt: stamp() };
      this.store.put("code_plan_version", record.id, projectId, record);
      const run: CodePlanRun = current ? { ...current, planVersion: next, state: "running", error: null }
        : { id: projectId, projectId, planVersion: next, state: "running", now: Date.now(), seed: randomInt(1, 0x7fffffff),
          ceilingMicros: "1000000", lastPassAt: null, error: null, reachedStepKeys: [], declarations: { scenes: [], shots: [] }, logs: [] };
      this.store.put("code_plan_run", projectId, projectId, run);
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
    this.queued.add(projectId);
  }

  raiseCeiling(projectId: string, micros: string): void {
    this.assertCode(projectId);
    const run = this.getRun(projectId); invariant(run, "CODE_PLAN_MISSING", "No code plan is saved");
    invariant(moneyMicros(micros) > moneyMicros(run.ceilingMicros), "CODE_PLAN_CEILING", "The new ceiling must be higher");
    this.store.put("code_plan_run", projectId, projectId, { ...run, ceilingMicros: micros });
    this.queued.add(projectId);
  }

  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    const work = async () => {
      if (this.stopping || this.recovery.isQuarantined()) return;
      for (const project of this.store.listProjects()) {
        if (project.planMode !== "code" || !this.getRun(project.id)) continue;
        try {
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
    invariant(!this.stopping, "CODE_PLAN_STOPPED", "Code-plan execution is stopping");
    this.recovery.assertWritable();
    invariant(this.store.getProject(projectId).planMode === "code", "CODE_PLAN_MODE", "This project uses graph planning");
  }

  private syncSteps(projectId: string): boolean {
    let changed = false;
    for (const step of this.steps(projectId)) {
      if (!step.attemptId || step.result) continue;
      const attempt = this.store.get<import("../execution/engine.js").Attempt>("attempt", step.attemptId);
      invariant(attempt?.projectId === projectId, "CODE_PLAN_JOURNAL", "Step lost its admitted attempt");
      const state = attempt.phase === "succeeded" ? "succeeded" : attempt.phase === "failed" ? "failed"
        : attempt.phase === "submission_unknown" ? "unknown" : "in_flight";
      if (state === step.state) continue;
      const artifacts = Object.values(attempt.outputs);
      invariant(state !== "succeeded" || artifacts.length > 0, "CODE_PLAN_JOURNAL", "A successful step requires ingested output");
      const result: CodePlanStep["result"] = state === "succeeded" ? { ok: true, artifact: artifacts[0]!, artifacts }
        : state === "failed" ? { ok: false, error: { code: attempt.failure?.id ?? "PROVIDER_FAILED", message: "Provider execution failed" } } : null;
      this.store.put("code_plan_step", step.id, projectId, { ...step, state, result, updatedAt: stamp() }); changed = true;
    }
    return changed;
  }

  private async pass(projectId: string): Promise<CodePlanRun> {
    this.syncSteps(projectId);
    const run = this.getRun(projectId); invariant(run, "CODE_PLAN_MISSING", "No code plan is saved");
    const version = this.store.get<CodePlanVersion>("code_plan_version", entityId(projectId, `version:${run.planVersion}`));
    invariant(version && version.sha256 === createHash("sha256").update(version.source).digest("hex"), "CODE_PLAN_JOURNAL", "Plan source identity differs");
    const reached = new Set<string>(), declarations: CodePlanRun["declarations"] = { scenes: [], shots: [] }, logs: string[] = [];
    const submissions: Promise<void>[] = [];
    let budget = false;
    const call = (method: string, args: unknown[]): unknown => {
      this.assertCode(projectId);
      invariant(this.getRun(projectId)?.planVersion === run.planVersion, "REVISION_CONFLICT", "A newer plan replaced this pass");
      if (method === "shot" || method === "scene") {
        const value = args[0];
        invariant(value && typeof value === "object" && !Array.isArray(value) && Buffer.byteLength(canonical(value)) <= 64 * 1024,
          "CODE_PLAN_DECLARATION", "Storyboard declarations must be bounded objects");
        const rows = method === "shot" ? declarations.shots : declarations.scenes;
        invariant(rows.length < 200, "CODE_PLAN_LIMIT", "Too many storyboard declarations"); rows.push(value as JsonObject); return value;
      }
      if (method === "log") { invariant(typeof args[0] === "string" && args[0].length <= 4096 && logs.length < 200,
        "CODE_PLAN_LOG", "Use at most 200 bounded log lines"); logs.push(args[0]); return null; }
      if (method === "choose") return this.choose(projectId, args);
      if (method === "speech") return { ok: false, error: { code: "NOT_IMPLEMENTED", message: "Code-plan speech is not implemented in P1" } };
      invariant(method === "image" || method === "video" || method === "render", "CODE_PLAN_METHOD", "Unknown Studio operation");
      const kind: CodePlanMediaKind = method;
      const input = normalizeStepInput(kind, args[0], this.models), key = stepKey(kind, input), id = entityId(projectId, key);
      reached.add(key);
      let step = this.store.get<CodePlanStep>("code_plan_step", id);
      if (step?.result) return step.result;
      if (step?.attemptId) return SANDBOX_PENDING;
      if (!step) {
        invariant(this.steps(projectId).length < this.maxSteps, "CODE_PLAN_STEP_LIMIT", `Code plans allow at most ${this.maxSteps} media steps per run`);
        step = { id, projectId, key, kind, input, state: "absent", attemptId: null, result: null,
          priceMicros: this.models[String(input.model)]?.priceMicros ?? "0", createdAt: stamp(), updatedAt: stamp() };
      }
      // Unsent work takes today's trusted price; dispatched work keeps its original reservation forever.
      step = { ...step, priceMicros: this.models[String(input.model)]?.priceMicros ?? "0" };
      const current = this.getRun(projectId)!;
      const liability = this.steps(projectId).reduce((total, previous) => total + (previous.attemptId
        && this.options.execution.liability(previous.attemptId) !== "released" ? moneyMicros(previous.priceMicros) : 0n), 0n);
      if (liability + moneyMicros(step.priceMicros) > moneyMicros(current.ceilingMicros)) {
        budget = true; this.store.put("code_plan_step", id, projectId, { ...step, state: "absent" }); return SANDBOX_PENDING;
      }
      // Reserve against the durable step before the provider sees the intent. Both records commit together.
      const admitted = this.store.transaction(() => {
        const attempt = this.options.execution.prepare(projectId, key, kind, input);
        this.store.put("code_plan_step", id, projectId, { ...step, state: "in_flight", attemptId: attempt.id, updatedAt: stamp() });
        return attempt;
      });
      const submission = this.options.execution.submit(admitted.id).finally(() => { this.queued.add(projectId); });
      // Retain the rejection for this pass while avoiding an unhandled rejection before the sandbox returns.
      void submission.catch(() => {}); submissions.push(submission);
      return SANDBOX_PENDING;
    };
    let outcome: { state: "done" | "waiting" | "error"; error?: { message: string; stack: string } };
    try {
      outcome = await runSandbox({ source: version.source, now: run.now, seed: run.seed, limits: this.limits, call });
      const settled = await Promise.allSettled(submissions);
      const rejected = settled.find(result => result.status === "rejected");
      if (rejected?.status === "rejected") outcome = { state: "error", error: errorView(rejected.reason) };
    } catch (error) { outcome = { state: "error", error: errorView(error) }; }
    // Leave outcomes from an obsolete pass in history; never overwrite the newer plan's run state.
    const current = this.getRun(projectId)!;
    if (current.planVersion !== run.planVersion) { this.queued.add(projectId); return current; }
    for (const step of this.steps(projectId)) if (!reached.has(step.key) && !step.attemptId && step.state !== "cancelled")
      this.store.put("code_plan_step", step.id, projectId, { ...step, state: "cancelled", updatedAt: stamp() });
    const result: CodePlanRun = { ...current, state: outcome.state === "error" ? "error" : budget ? "paused_budget" : outcome.state,
      lastPassAt: stamp(), error: outcome.error ?? null, reachedStepKeys: [...reached], declarations, logs };
    this.store.put("code_plan_run", projectId, projectId, result); return result;
  }

  private choose(projectId: string, args: unknown[]): unknown {
    const [choiceId, raw] = args;
    invariant(typeof choiceId === "string" && choiceId.length > 0 && choiceId.length <= 200 && raw && typeof raw === "object",
      "CODE_PLAN_CHOICE", "Use a bounded choice id and question/options");
    const { question, options } = raw as Record<string, unknown>;
    invariant(typeof question === "string" && question.length <= 4096 && Array.isArray(options) && options.length > 0 && options.length <= 200
      && Buffer.byteLength(canonical(options)) <= 64 * 1024, "CODE_PLAN_CHOICE", "Use a bounded question and 1 to 200 JSON options");
    const optionsDigest = digest(options), id = entityId(projectId, digest({ choiceId, optionsDigest }));
    const previous = this.store.get<CodePlanChoice>("code_plan_choice", id);
    const choice: CodePlanChoice = { ...previous, id, projectId, choiceId, question, options: options as JsonValue[], optionsDigest };
    this.store.put("code_plan_choice", id, projectId, choice);
    return Object.hasOwn(choice, "answer") ? choice.answer : SANDBOX_PENDING;
  }
}
