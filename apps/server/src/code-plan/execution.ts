import { viggleFreeFailure } from "../execution/viggle-h3-execution.js";
import { videoI2vFailure } from "../execution/video-i2v-execution.js";
import { createHash } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonical, digest, invariant, newId } from "@openslate/core";
import type { ArtifactRef, JsonObject } from "@openslate/core";
import { ExecutionRegistry, executionIdentity, executionProfileSnapshot, profileExecutionIdentity, executionTaskId, isSpoolCompletion, isSpoolOutput, normalizeExecutionOutcome, MAX_EXECUTION_OUTPUT_BYTES, EXECUTION_SPOOL_LIMITS } from "@openslate/providers";
import type { ExecutionOutcome, ExecutionProvider, IngestibleExecutionOutput } from "@openslate/providers";
import type { ArtifactRecord, Attempt, ExecutionOutputIngestor } from "../execution/engine.js";
import { ExecutionIngestionRouter } from "../execution/ingestion-router.js";
import type { ExecutionOutputStore } from "../execution/output-store.js";
import type { Store } from "../persistence/store.js";

import type { InstalledProviderCatalog } from "../application/provider-catalog.js";
import type { LocalMediaExecutor } from "../execution/local-media-executor.js";
import { projectModels, modelPrice, codePlanPriceFrame, type CodePlanCapabilityLock } from "./models.js";
import { codePlanProviderArgs, videoAspect } from "./provider-input.js";
import type { CodePlanModel } from "./identity.js";
import { VIDEO_DERIVATION_LIMITS, assertNormalizedVideoIngestion, type NormalizedVideoIngestion, type VideoDerivationIntent } from "../execution/video-derivation.js";
import { AUDIO_DERIVATION_LIMITS, assertNormalizedAudioIngestion, type NormalizedAudioIngestion, type AudioDerivationIntent } from "../execution/audio-derivation.js";
import type { MusicReceipt } from "../execution/spool-music-ingester.js";
import { assertMusicArtifact } from "../execution/spool-music-ingester.js";
import { assertCodePlanFirstDispatch } from "./provider-authority.js";
import { makeCodePlanPoster } from "./posters.js";
import type { CodePlanStep } from "./records.js";
import type { CodePlanMediaKind } from "./identity.js";
export type { CodePlanMediaKind } from "./identity.js";
export type CodePlanLiability = "reserved" | "charged" | "released";
export interface CodePlanExecutionRecord {
  id: string; projectId: string; requestDigest: string; liability: CodePlanLiability;
  planVersion?: number; normalizedInput?: JsonObject; priceMicros?: string;
  outcome: ExecutionOutcome | null; outcomeDigest: string | null; createdAt: string; updatedAt: string;
}
const terminal = (attempt: Attempt): boolean => attempt.phase === "succeeded" || attempt.phase === "failed";

/** Code-plan bridge to the existing attempt, receipt and ingestion contracts, without graph admission. */
export class CodePlanExecution {
  readonly artifactDir: string;
  private readonly workerId = newId();
  private readonly fresh = new Set<string>();
  private readonly operations = new Map<string, Promise<void>>();
  private readonly ingestor: ExecutionOutputIngestor;
  private readonly registry: ExecutionRegistry;
  private readonly catalog: InstalledProviderCatalog | undefined;
  private readonly localExecutor: LocalMediaExecutor | undefined;
  private ingestionTail: Promise<unknown> = Promise.resolve();
  private readonly outputStore: ExecutionOutputStore | undefined;
  private readonly providerTimeoutMs: number;
  private readonly controllers = new Set<AbortController>();
  private stopping = false;
  constructor(readonly store: Store, options: {
    provider: ExecutionProvider; registry?: ExecutionRegistry; catalog?: InstalledProviderCatalog; localExecutor?: LocalMediaExecutor; artifactDir: string; outputStore?: ExecutionOutputStore; outputIngestor?: ExecutionOutputIngestor;
    providerTimeoutMs?: number;
  }) {
    const identity = executionIdentity(options.provider);
    invariant(identity.adapter === "fake" && identity.version === "1", "CODE_PLAN_FAKE_ONLY", "The fallback provider must be registered fake/1; real routes belong in the installed registry");
    invariant(!options.outputStore || options.outputStore.store === store, "OUTPUT_STORE_CONFIGURATION", "Code plans and output storage must share the application store");
    this.registry = options.registry ?? new ExecutionRegistry([options.provider]); this.catalog = options.catalog;
    this.localExecutor = options.localExecutor; this.outputStore = options.outputStore;
    this.providerTimeoutMs = options.providerTimeoutMs ?? 5000;
    invariant(Number.isSafeInteger(this.providerTimeoutMs) && this.providerTimeoutMs >= 10 && this.providerTimeoutMs <= 600000,
      "CODE_PLAN_CONFIGURATION_INVALID", "Provider calls require a bounded deadline");
    this.artifactDir = resolve(options.artifactDir); mkdirSync(this.artifactDir, { recursive: true });
    this.ingestor = options.outputIngestor ?? new ExecutionIngestionRouter({});
  }

  models(projectId: string): Record<string, CodePlanModel> { return projectModels(this.store, projectId, this.catalog); }

  normalizeVideoInput(projectId: string, input: JsonObject, model: CodePlanModel): JsonObject {
    const records = this.store.list<ArtifactRecord>("artifact", projectId);
    const refs = [input.firstFrame, input.lastFrame, ...(Array.isArray(input.references) ? input.references : [])].filter(ref => ref !== undefined);
    const owned = refs.map(ref => {
      const frame = ref && typeof ref === "object" && !Array.isArray(ref) && records
        .find(row => row.projectId === projectId && row.artifact.kind === "image" && row.artifact.sha256 === ref.sha256);
      invariant(frame, "CODE_PLAN_ARTIFACT_INVALID", "Video requires owned images of this film"); return frame;
    });
    if (!model.profile) return input;
    return videoAspect(input, model.profile, owned[0]);
  }

  private ready(projectId: string, input: JsonObject, kind: CodePlanMediaKind): CodePlanModel {
    const model = this.models(projectId)[String(input.model)];
    const lock = this.store.get<CodePlanCapabilityLock>("capability_lock", this.store.getProject(projectId).capabilityLockId);
    // Trusted runtime model tables may use custom fixture labels. They still dispatch only to fake/1.
    if (!model && !lock?.profiles.some(row => row.adapter !== "fake")) return { kind };
    invariant(model?.kind === kind, "CODE_PLAN_MODEL", "The selected model is not installed in this project's profile lock");
    if (model.profile) {
      const project = this.store.getProject(projectId), lock = this.store.get<CodePlanCapabilityLock>("capability_lock", project.capabilityLockId)!;
      const row = this.catalog!.projectView(lock.profiles, undefined, lock.localExecution).profiles.find(row => row.id === model.profile!.id);
      invariant(row?.installedDefinition && row.readiness.realExecutionEnabled && row.projectExecution.compatible,
        row?.readiness.credential.required && !row.readiness.credential.present ? "MEDIA_CREDENTIAL_MISSING" : "CODE_PLAN_PROVIDER_UNAVAILABLE",
        "Configure, enable and install the project's exact provider profile before dispatch");
      invariant(input.profileDefinitionDigest === model.profileDefinitionDigest, "CODE_PLAN_MODEL", "Provider definition changed before admission");
      this.registry.forProfile(model.profile);
    }
    return model;
  }

  hasCapacity(projectId: string, input: JsonObject): boolean {
    const profile = this.models(projectId)[String(input.model)]?.profile;
    if (!profile) return true;
    const row = this.store.db.prepare("SELECT count(*) n FROM entities WHERE kind='attempt' AND json_extract(body,'$.request.execution.adapter')=? AND json_extract(body,'$.request.profile.id')=? AND json_extract(body,'$.phase') NOT IN ('succeeded','failed')")
      .get(profile.adapter, profile.id) as { n: number };
    return row.n < profile.maxConcurrency;
  }

  attempts(projectId: string): Attempt[] {
    return this.store.list<Attempt>("attempt", projectId).filter(attempt => attempt.workKey?.startsWith("code-plan:") === true);
  }

  liability(attemptId: string): CodePlanLiability {
    return this.record(this.attempt(attemptId)).liability;
  }

  failure(attemptId: string): { code: string; retry: "safe" | "consent" | "none"; mayHaveCharged: boolean } {
    const attempt = this.attempt(attemptId), liability = this.record(attempt).liability;
    return { code: attempt.failure?.id ?? "PROVIDER_FAILED",
      retry: liability === "released" ? attempt.failure?.retryAllowed ? "safe" : "none" : "consent",
      mayHaveCharged: liability !== "released" };
  }

  accounting(projectId: string): { charged: bigint; unknown: bigint; inFlight: bigint; total: bigint } {
    let charged = 0n, unknown = 0n, inFlight = 0n;
    for (const attempt of this.attempts(projectId)) {
      const record = this.record(attempt);
      const price = BigInt(record.priceMicros ?? this.store.list<import("./records.js").CodePlanStep>("code_plan_step", projectId)
        .find(step => step.key === attempt.fingerprint)?.priceMicros ?? "0");
      if (record.liability === "released") continue;
      if (attempt.phase === "submission_unknown" || attempt.failure?.id === "SUBMISSION_RESPONSE_LOST") unknown += price;
      else if (record.liability === "charged") charged += price;
      else inFlight += price;
    }
    return { charged, unknown, inFlight, total: charged + unknown + inFlight };
  }

  /** The complete immutable submission intent is durable before this method returns. */
  prepare(projectId: string, key: string, kind: CodePlanMediaKind, normalizedInput: JsonObject,
    options: { previousAttemptId?: string; priceMicros?: string } = {}): Attempt {
    invariant(!this.stopping, "CODE_PLAN_CLOSED", "Code-plan execution is stopping");
    invariant(this.store.getProject(projectId).planMode === "code", "CODE_PLAN_MODE_INVALID", "Code execution requires a code-mode project");
    invariant(/^[a-f0-9]{64}$/.test(key) && ["image", "video", "speech", "music", "render"].includes(kind), "CODE_PLAN_INPUT_INVALID", "Use a content-addressed media step");
    const input = structuredClone(normalizedInput), model = this.ready(projectId, input, kind);
    const profile = model.profile;
    const lock = profile ? this.store.get<CodePlanCapabilityLock>("capability_lock", this.store.getProject(projectId).capabilityLockId)! : undefined;
    const args = profile ? codePlanProviderArgs(profile, input, { enhance: false }) : input;
    const realRender = kind === "render" && this.store.get<CodePlanCapabilityLock>("capability_lock", this.store.getProject(projectId).capabilityLockId)?.profiles.some(row => row.adapter !== "fake");
    invariant(!realRender || this.localExecutor, "CODE_PLAN_RENDER_UNAVAILABLE", "Real projects require the installed local media executor");
    const prepared = this.store.transaction(() => {
      const specDigest = digest({ kind, input });
      const history = this.attempts(projectId).filter(attempt => attempt.fingerprint === key).sort((a, b) => a.ordinal - b.ordinal);
      const previous = options.previousAttemptId ? history.find(attempt => attempt.id === options.previousAttemptId) : undefined;
      invariant(!options.previousAttemptId || previous && terminal(previous), "CODE_PLAN_RETRY", "Only terminal attempts may open another submission intent");
      const ordinal = previous ? previous.ordinal + 1 : 1;
      // The store's local-work index is globally unique. A step keeps its key,
      // while each project/attempt needs a distinct immutable execution work key.
      const workKey = `code-plan:${projectId}:${key}:${ordinal}`;
      const existing = history.find(attempt => attempt.ordinal === ordinal);
      if (existing) {
        invariant(existing.specDigest === specDigest && existing.request.kind === kind, "CODE_PLAN_STEP_CONFLICT", "Step key already has different execution inputs");
        this.record(existing); return { attempt: existing, created: false };
      }
      const id = newId(), at = new Date().toISOString(), inputs = this.resolveInputs(projectId, input);
      const attempt: Attempt = { id, projectId, nodeId: workKey, candidateId: null, ordinal, specDigest,
        fingerprint: key, workKey, phase: "submitting", leaseOwner: this.workerId, leaseEpoch: 1, leaseExpiresAt: Date.now() + this.providerTimeoutMs + 600000,
        taskId: null, reservationId: null, failure: null, outputs: {}, createdAt: at,
        request: { attemptId: id, nodeId: workKey, kind, fingerprint: key, args, inputs, execution: profile ? profileExecutionIdentity(profile) : realRender ? { adapter: "local-media", version: "1" } : { adapter: "fake", version: "1" },
          ...(profile ? { profile: executionProfileSnapshot(profile)!, providerUse: { kind: "configured" as const, capabilityLockId: lock!.id,
            capabilityLockDigest: digest(lock), profileDefinitionDigest: digest(profile) } } : {}) } };
      this.store.insert("code_plan_execution", id, projectId, { requestDigest: digest(attempt.request), liability: "reserved",
        outcome: null, outcomeDigest: null, createdAt: at, updatedAt: at,
        ...(this.store.get<{ planVersion: number }>("code_plan_run", projectId) ? { planVersion: this.store.get<{ planVersion: number }>("code_plan_run", projectId)!.planVersion } : {}),
        normalizedInput: input, priceMicros: options.priceMicros ?? modelPrice(model, input, codePlanPriceFrame(this.store, projectId, input)) });
      this.store.insert("attempt", id, projectId, attempt);
      return { attempt, created: true };
    });
    if (prepared.created) this.fresh.add(prepared.attempt.id);
    return prepared.attempt;
  }

  /** Only the creator's ephemeral first-submit permit may dispatch. Restarted intents only reconcile. */
  submit(attemptId: string): Promise<void> {
    const busy = this.operations.get(attemptId); if (busy) return busy;
    const attempt = this.attempt(attemptId);
    if (terminal(attempt) || attempt.phase !== "submitting") return Promise.resolve();
    invariant(!this.stopping, "CODE_PLAN_CLOSED", "Code-plan execution is stopping");
    invariant(this.fresh.delete(attemptId), "CODE_PLAN_RESUBMISSION_REFUSED", "An existing submission intent must be reconciled, never submitted again");
    return this.start(attemptId, async () => {
      if (attempt.request.execution.adapter === "local-media") { await this.render(attempt); return; }
      if (attempt.request.providerUse) {
        this.ready(attempt.projectId, this.record(attempt).normalizedInput!, attempt.request.kind as CodePlanMediaKind);
        assertCodePlanFirstDispatch(this.store, attempt, { owner: attempt.leaseOwner!, epoch: attempt.leaseEpoch });
      }
      const observation = await this.callProvider(signal => this.registry.forRequest(attempt.request).submit(structuredClone(attempt.request),
        { signal, expectedLease: { owner: attempt.leaseOwner!, epoch: attempt.leaseEpoch } }), attempt.request.kind === "music" ? Math.max(this.providerTimeoutMs, 360000) : this.providerTimeoutMs);
      await this.observe(attemptId, observation);
    });
  }

  /** Reconcile only this bridge's attempts. Ingestion recovery does not query the provider. */
  async advance(projectId: string): Promise<boolean> {
    if (this.stopping || this.store.getProject(projectId).planMode !== "code") return false;
    const before = canonical(this.attempts(projectId));
    const results = await Promise.allSettled(this.attempts(projectId).filter(attempt => !terminal(attempt) && !this.operations.has(attempt.id)).map(previous => this.start(previous.id, async () => {
      const attempt = { ...previous, leaseOwner: this.workerId, leaseEpoch: previous.leaseEpoch + 1, leaseExpiresAt: Date.now() + this.providerTimeoutMs + 600000 };
      this.store.put("attempt", attempt.id, projectId, attempt);
      // A prepared intent left by an earlier process has no authority to submit.
      this.fresh.delete(attempt.id);
      if (attempt.request.execution.adapter === "local-media") { await this.render(attempt); return; }
      if (attempt.phase === "ingesting") { await this.ingest(attempt.id); return; }
      if (attempt.phase === "submitting") this.store.put("attempt", attempt.id, projectId, { ...attempt, phase: "submission_unknown" });
      const observation = await this.callProvider(signal => attempt.taskId && attempt.phase !== "submitting"
        ? this.registry.forRequest(attempt.request).poll(attempt.taskId, structuredClone(attempt.request), { signal, expectedLease: { owner: attempt.leaseOwner!, epoch: attempt.leaseEpoch } })
        : this.registry.forRequest(attempt.request).lookup(attempt.id, structuredClone(attempt.request), { signal, expectedLease: { owner: attempt.leaseOwner!, epoch: attempt.leaseEpoch } }), attempt.request.kind === "music" ? Math.max(this.providerTimeoutMs, 360000) : this.providerTimeoutMs);
      await this.observe(attempt.id, observation);
    })));
    const rejected = results.find(result => result.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
    return before !== canonical(this.attempts(projectId));
  }

  /** At most one historical clip per tick, including history from older plan versions. */
  async backfillPoster(projectId: string): Promise<boolean> {
    if (this.stopping || !this.localExecutor) return false;
    const step = this.store.list<CodePlanStep>("code_plan_step", projectId).find(step => step.state === "succeeded"
      && step.result?.ok && step.result.artifact.kind === "video" && !this.store.get("code_plan_poster", step.result.artifact.artifactId));
    if (!step?.result?.ok) return false;
    await this.poster(projectId, step.result.artifact); return true;
  }

  private async poster(projectId: string, ref: ArtifactRef): Promise<void> {
    if (this.stopping || !this.localExecutor || ref.kind !== "video") return;
    const controller = new AbortController(); this.controllers.add(controller);
    try { await makeCodePlanPoster(this.store, this.localExecutor.media, this.artifactDir, projectId, ref, controller.signal); }
    finally { this.controllers.delete(controller); }
  }

  /** Await already-started work before a replay or before closing the shared store. */
  async awaitIdle(): Promise<void> {
    const results = await Promise.allSettled([...this.operations.values()]);
    const rejected = results.find(result => result.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
  }

  async close(): Promise<void> {
    this.stopping = true;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.operations.values()]);
  }

  private async callProvider(call: (signal: AbortSignal) => Promise<ExecutionOutcome>, timeoutMs = this.providerTimeoutMs): Promise<ExecutionOutcome> {
    const controller = new AbortController(); this.controllers.add(controller);
    let abort!: () => void;
    const interrupted = new Promise<ExecutionOutcome>(resolveOutcome => {
      abort = () => resolveOutcome({ type: "unknown", diagnostic: "Provider call interrupted after its intent; reconcile without resubmission" });
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (this.stopping) controller.abort();
      const observed = Promise.resolve().then(() => controller.signal.aborted
        ? interrupted : call(controller.signal)).catch((): ExecutionOutcome => ({ type: "unknown", diagnostic: "Provider call threw after its intent; reconcile without resubmission" }));
      return await Promise.race([observed, interrupted]);
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); this.controllers.delete(controller); }
  }

  private start(id: string, operation: () => Promise<void>): Promise<void> {
    // Defer entry so even synchronously resolving providers cannot race the busy marker.
    const pending = Promise.resolve().then(operation).finally(() => { if (this.operations.get(id) === pending) this.operations.delete(id); });
    this.operations.set(id, pending); return pending;
  }

  private attempt(id: string): Attempt {
    const attempt = this.store.get<Attempt>("attempt", id);
    invariant(attempt?.candidateId === null && attempt.workKey?.startsWith("code-plan:"), "CODE_PLAN_ATTEMPT_INVALID", "Attempt is not owned by code plans");
    if (attempt.request.execution.adapter !== "local-media") this.registry.forRequest(attempt.request);
    return attempt;
  }

  private record(attempt: Attempt): CodePlanExecutionRecord {
    const record = this.store.get<CodePlanExecutionRecord>("code_plan_execution", attempt.id);
    invariant(record?.projectId === attempt.projectId && record.requestDigest === digest(attempt.request)
      && (record.outcome === null ? record.outcomeDigest === null : digest(record.outcome) === record.outcomeDigest),
    "CODE_PLAN_EXECUTION_CORRUPT", "Execution receipt differs from its immutable submission intent");
    return record;
  }

  private resolveInputs(projectId: string, input: JsonObject): ArtifactRef[] {
    const found = new Map<string, ArtifactRef>(), records = this.store.list<ArtifactRecord>("artifact", projectId);
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const object = value as Record<string, unknown>;
      if (typeof object.sha256 === "string" && typeof object.kind === "string") {
        const record = records.find(item => item.projectId === projectId && item.artifact.sha256 === object.sha256 && item.artifact.kind === object.kind);
        invariant(record, "CODE_PLAN_ARTIFACT_INVALID", "Media input must reference an ingested artifact owned by this project");
        found.set(`${record.artifact.kind}:${record.artifact.sha256}`, structuredClone(record.artifact)); return;
      }
      Object.values(object).forEach(visit);
    };
    visit(input); return [...found.values()];
  }

  private async observe(id: string, value: ExecutionOutcome): Promise<void> {
    let ingest = false;
    this.store.transaction(() => {
      const attempt = this.attempt(id), record = this.record(attempt);
      if (terminal(attempt) || record.outcome?.type === "completed") { ingest = attempt.phase === "ingesting"; return; }
      let outcome = normalizeExecutionOutcome(value, attempt.request);
      if (attempt.taskId && (outcome.type === "rejected" || (outcome.type !== "unknown" || outcome.taskId !== undefined)
        && executionTaskId(outcome) !== attempt.taskId))
        outcome = { type: "unknown", diagnostic: "Provider observation conflicts with the accepted task identity" };
      if (isSpoolCompletion(outcome)) {
        try {
          invariant(this.outputStore, "OUTPUT_STORE_CONFIGURATION", "Owned output spools require the existing output store");
          this.outputStore.assertCompletion(attempt.projectId, attempt.id, outcome);
        } catch { outcome = { type: "unknown", diagnostic: "Completion has no matching owned output receipt" }; }
      }
      const evidenceDigest = digest(outcome), evidenceId = digest({ attemptId: id, outcomeDigest: evidenceDigest });
      if (!this.store.get("execution_evidence", evidenceId)) this.store.insert("execution_evidence", evidenceId, attempt.projectId,
        { attemptId: id, outcome, outcomeDigest: evidenceDigest, recordedAt: new Date().toISOString() });
      const phase = outcome.type === "completed" ? "ingesting" : outcome.type === "accepted" ? "remote_pending"
        : outcome.type === "unknown" ? "submission_unknown" : "failed";
      const freeFailure = outcome.type === "failed" ? (() => {
        const row = videoI2vFailure(this.store, attempt);
        if (row?.free) return row;
        return viggleFreeFailure(this.store, attempt) ? { code: "VIGGLE_TASK_FAILED", free: true } : null;
      })() : null;
      const failure = outcome.type === "failed" || outcome.type === "rejected" ? { id: outcome.failureId, technical: outcome.technical,
        // A free vendor failure (not a content refusal) cannot charge twice, so it may retry as safely as a rejection.
        retryAllowed: outcome.type === "rejected" ? outcome.retryAllowed : !!freeFailure && !/FACE|MODERATION/.test(freeFailure.code),
        source: `${attempt.request.execution.adapter}_provider` } : null;
      // Rejections and validated free terminal tasks positively release liability.
      const liability: CodePlanLiability = outcome.type === "rejected" || freeFailure ? "released"
        : outcome.type === "completed" || outcome.type === "failed" ? "charged" : record.liability;
      this.store.put("code_plan_execution", id, attempt.projectId, { ...record, liability, outcome, outcomeDigest: digest(outcome), updatedAt: new Date().toISOString() });
      this.store.put("attempt", id, attempt.projectId, { ...attempt, phase, failure, taskId: executionTaskId(outcome) ?? attempt.taskId });
      ingest = outcome.type === "completed";
    });
    if (ingest) await this.ingest(id);
  }

  private async render(attempt: Attempt): Promise<void> {
    invariant(this.localExecutor, "CODE_PLAN_RENDER_UNAVAILABLE", "The pinned local media executor is unavailable");
    const controller = new AbortController(); this.controllers.add(controller);
    try {
      if (this.stopping) controller.abort();
      this.store.put("attempt", attempt.id, attempt.projectId, { ...attempt, phase: "ingesting" });
      const artifact = await this.localExecutor.executeCodePlan(attempt, { signal: controller.signal });
      this.store.transaction(() => {
        const current = this.attempt(attempt.id), record = this.record(current);
        this.store.put("artifact", artifact.id, attempt.projectId, artifact);
        this.store.put("code_plan_execution", attempt.id, attempt.projectId, { ...record, liability: "charged", updatedAt: new Date().toISOString() });
        this.store.put("attempt", attempt.id, attempt.projectId, { ...current, phase: "succeeded", outputs: { video: artifact.artifact } });
      });
      await this.poster(attempt.projectId, artifact.artifact);
    } finally { this.controllers.delete(controller); }
  }

  private ingest(id: string): Promise<void> {
    const next = this.ingestionTail.catch(() => {}).then(() => this.ingestNow(id));
    this.ingestionTail = next; return next;
  }

  private async ingestNow(id: string): Promise<void> {
    const controller = new AbortController(); this.controllers.add(controller);
    try {
      if (this.stopping) controller.abort();
      await this.ingestWithSignal(id, controller.signal);
    } finally { this.controllers.delete(controller); }
  }

  private async ingestWithSignal(id: string, signal: AbortSignal): Promise<void> {
    const attempt = this.attempt(id), record = this.record(attempt), completion = record.outcome;
    invariant(attempt.phase === "ingesting" && completion?.type === "completed", "CODE_PLAN_EXECUTION_CORRUPT", "Ingestion requires its durable provider completion");

    const outputs: Record<string, ArtifactRef> = {}, artifacts: ArtifactRecord[] = [];
    const derived: (NormalizedVideoIngestion | NormalizedAudioIngestion)[] = [];
    for (const output of completion.outputs) {
      const result = await this.ingestor.ingest({ attempt: structuredClone(attempt), output: structuredClone(output), artifactDir: this.artifactDir, signal });
      let artifact: ArtifactRecord;
      if ("type" in result && result.type === "normalized_video") {
        const intent = this.store.get<VideoDerivationIntent>("video_derivation_intent", result.derivation.id)!;
        assertNormalizedVideoIngestion(intent, attempt, output, result); derived.push(result); artifact = result.artifact;
      } else if ("type" in result && result.type === "normalized_audio") {
        const intent = this.store.get<AudioDerivationIntent>("audio_derivation_intent", result.derivation.id)!;
        assertNormalizedAudioIngestion(intent, attempt, output, result); derived.push(result); artifact = result.artifact;
      } else {
        invariant("artifact" in result && typeof result.artifact === "object" && "artifactId" in result.artifact,
          "INVALID_PROVIDER_OUTPUT", "Ingestion must return an immutable owned artifact");
        artifact = result as ArtifactRecord;
      }
      const music = attempt.request.kind === "music" && output.fixture === false;
      if (music) assertMusicArtifact(this.store, attempt, output, artifact);
      await this.validateArtifact(attempt, output, artifact, music || derived.some(item => item.artifact === artifact));
      artifacts.push(artifact); outputs[output.port] = artifact.artifact;
    }
    if (attempt.request.execution.adapter === "seedance") {
      const lastFrame = this.store.get<ArtifactRecord>("artifact", digest({attemptId:attempt.id,port:"lastFrame"}));
      if (lastFrame?.projectId === attempt.projectId && lastFrame.attemptId === attempt.id && lastFrame.artifact.kind === "image") outputs.lastFrame = lastFrame.artifact;
    }
    this.store.transaction(() => {
      const current = this.attempt(id);
      if (current.phase === "succeeded") return;
      invariant(current.phase === "ingesting" && this.record(current).outcomeDigest === record.outcomeDigest, "CODE_PLAN_EXECUTION_CORRUPT", "Completion changed during ingestion");
      for (const artifact of artifacts) {
        this.store.insert("artifact", artifact.id, attempt.projectId, artifact);
        if (attempt.request.kind === "music" && artifact.fixture === false) {
          const receipt = this.store.get<MusicReceipt>("music_ingestion_receipt", artifact.id)!;
          this.store.put("media_source", artifact.id, attempt.projectId, { source: receipt.source, origin: "generated_audio", attemptId: attempt.id, derivationId: receipt.id });
        }
      }
      for (const result of derived) {
        this.store.put(result.type === "normalized_video" ? "video_derivation_receipt" : "audio_derivation_receipt", result.derivation.id, attempt.projectId, result.derivation);
        this.store.put("media_source", result.mediaSource.id, attempt.projectId, result.mediaSource);
      }
      this.store.put("attempt", id, attempt.projectId, { ...current, phase: "succeeded", outputs });
    });
    for (const ref of Object.values(outputs)) if (ref.kind === "video") await this.poster(attempt.projectId, ref);
  }

  private async validateArtifact(attempt: Attempt, output: IngestibleExecutionOutput, artifact: ArtifactRecord, derived = false): Promise<void> {
    invariant(typeof artifact.id === "string" && artifact.id.length > 0 && artifact.projectId === attempt.projectId
      && artifact.attemptId === attempt.id && artifact.id === artifact.artifact?.artifactId
      && (derived || artifact.artifact.sha256 === output.sha256) && artifact.artifact.kind === output.kind
      && (attempt.request.kind === "music" && derived ? artifact.mimeType === "audio/wav" : artifact.mimeType === output.mimeType) && artifact.fixture === output.fixture && typeof artifact.path === "string" && isAbsolute(artifact.path)
      && (artifact.physicalDurationSeconds === null || Number.isFinite(artifact.physicalDurationSeconds) && artifact.physicalDurationSeconds > 0),
    "INVALID_PROVIDER_OUTPUT", "Ingested artifact differs from the provider completion");
    if (isSpoolOutput(output)) invariant(artifact.outputSpoolId === output.storage.spoolId && artifact.outputReceiptId === output.storage.spoolId
      && (derived || artifact.byteLength === output.byteLength), "INVALID_PROVIDER_OUTPUT", "Ingested artifact lost its output spool provenance");
    const path = realpathSync(artifact.path), rel = relative(realpathSync(this.artifactDir), path);
    invariant(rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "INVALID_PROVIDER_OUTPUT", "Ingested artifact must remain in the owned media directory");
    const maxBytes = derived ? output.kind === "audio" ? AUDIO_DERIVATION_LIMITS.outputBytes : VIDEO_DERIVATION_LIMITS.outputBytes
      : isSpoolOutput(output) ? EXECUTION_SPOOL_LIMITS[output.kind] : MAX_EXECUTION_OUTPUT_BYTES;
    const file = await open(artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      invariant(stat.isFile() && stat.size > 0 && stat.size <= maxBytes
        && (derived ? stat.size === artifact.byteLength : !isSpoolOutput(output) || stat.size === output.byteLength), "INVALID_PROVIDER_OUTPUT", "Ingested artifact has an invalid byte count");
      const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024); let size = 0;
      for (;;) {
        const read = await file.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break;
        size += read.bytesRead;
        invariant(size <= stat.size && size <= maxBytes, "ARTIFACT_CORRUPT", "Ingested artifact grew during verification");
        hash.update(buffer.subarray(0, read.bytesRead));
      }
      invariant(size === stat.size && hash.digest("hex") === artifact.artifact.sha256, "ARTIFACT_CORRUPT", "Ingested artifact bytes differ from the completion");
    } finally { await file.close(); }
  }
}
