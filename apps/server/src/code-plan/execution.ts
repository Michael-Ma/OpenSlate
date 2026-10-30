import { createHash } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonical, digest, invariant, newId } from "@openslate/core";
import type { ArtifactRef, JsonObject } from "@openslate/core";
import { executionIdentity, executionTaskId, isSpoolCompletion, isSpoolOutput, normalizeExecutionOutcome, MAX_EXECUTION_OUTPUT_BYTES } from "@openslate/providers";
import type { ExecutionOutcome, ExecutionProvider, IngestibleExecutionOutput } from "@openslate/providers";
import type { ArtifactRecord, Attempt, ExecutionOutputIngestor } from "../execution/engine.js";
import { ExecutionIngestionRouter } from "../execution/ingestion-router.js";
import type { ExecutionOutputStore } from "../execution/output-store.js";
import type { Store } from "../persistence/store.js";

import type { CodePlanMediaKind } from "./identity.js";
export type { CodePlanMediaKind } from "./identity.js";
export type CodePlanLiability = "reserved" | "charged" | "released";
export interface CodePlanExecutionRecord {
  id: string; projectId: string; requestDigest: string; liability: CodePlanLiability;
  outcome: ExecutionOutcome | null; outcomeDigest: string | null; createdAt: string; updatedAt: string;
}
const terminal = (attempt: Attempt): boolean => attempt.phase === "succeeded" || attempt.phase === "failed";

/** Fake-only bridge to the existing attempt, receipt and ingestion contracts, without graph admission. */
export class CodePlanExecution {
  readonly artifactDir: string;
  private readonly workerId = newId();
  private readonly fresh = new Set<string>();
  private readonly operations = new Map<string, Promise<void>>();
  private readonly ingestor: ExecutionOutputIngestor;
  private readonly provider: ExecutionProvider;
  private readonly outputStore: ExecutionOutputStore | undefined;
  private readonly providerTimeoutMs: number;
  private readonly controllers = new Set<AbortController>();
  private stopping = false;
  constructor(readonly store: Store, options: {
    provider: ExecutionProvider; artifactDir: string; outputStore?: ExecutionOutputStore; outputIngestor?: ExecutionOutputIngestor;
    providerTimeoutMs?: number;
  }) {
    const identity = executionIdentity(options.provider);
    invariant(identity.adapter === "fake" && identity.version === "1", "CODE_PLAN_FAKE_ONLY", "P1 code plans require fake/1 execution");
    invariant(!options.outputStore || options.outputStore.store === store, "OUTPUT_STORE_CONFIGURATION", "Code plans and output storage must share the application store");
    this.provider = options.provider; this.outputStore = options.outputStore;
    this.providerTimeoutMs = options.providerTimeoutMs ?? 5000;
    invariant(Number.isSafeInteger(this.providerTimeoutMs) && this.providerTimeoutMs >= 10 && this.providerTimeoutMs <= 600000,
      "CODE_PLAN_CONFIGURATION_INVALID", "Provider calls require a bounded deadline");
    this.artifactDir = resolve(options.artifactDir); mkdirSync(this.artifactDir, { recursive: true });
    this.ingestor = options.outputIngestor ?? new ExecutionIngestionRouter({});
  }

  attempts(projectId: string): Attempt[] {
    return this.store.list<Attempt>("attempt", projectId).filter(attempt => attempt.workKey?.startsWith("code-plan:") === true);
  }

  liability(attemptId: string): CodePlanLiability {
    return this.record(this.attempt(attemptId)).liability;
  }

  /** The complete immutable submission intent is durable before this method returns. */
  prepare(projectId: string, key: string, kind: CodePlanMediaKind, normalizedInput: JsonObject): Attempt {
    invariant(!this.stopping, "CODE_PLAN_CLOSED", "Code-plan execution is stopping");
    invariant(this.store.getProject(projectId).planMode === "code", "CODE_PLAN_MODE_INVALID", "Code execution requires a code-mode project");
    invariant(/^[a-f0-9]{64}$/.test(key) && ["image", "video", "speech", "render"].includes(kind), "CODE_PLAN_INPUT_INVALID", "Use a content-addressed media step");
    const input = structuredClone(normalizedInput);
    const prepared = this.store.transaction(() => {
      const workKey = `code-plan:${key}`, specDigest = digest({ kind, input });
      const existing = this.attempts(projectId).find(attempt => attempt.workKey === workKey);
      if (existing) {
        invariant(existing.specDigest === specDigest && existing.request.kind === kind, "CODE_PLAN_STEP_CONFLICT", "Step key already has different execution inputs");
        this.record(existing); return { attempt: existing, created: false };
      }
      const id = newId(), at = new Date().toISOString(), inputs = this.resolveInputs(projectId, input);
      const attempt: Attempt = { id, projectId, nodeId: workKey, candidateId: null, ordinal: 1, specDigest,
        fingerprint: key, workKey, phase: "submitting", leaseOwner: this.workerId, leaseEpoch: 1, leaseExpiresAt: 0,
        taskId: null, reservationId: null, failure: null, outputs: {}, createdAt: at,
        request: { attemptId: id, nodeId: workKey, kind, fingerprint: key, args: input, inputs, execution: { adapter: "fake", version: "1" } } };
      this.store.insert("attempt", id, projectId, attempt);
      this.store.insert("code_plan_execution", id, projectId, { requestDigest: digest(attempt.request), liability: "reserved",
        outcome: null, outcomeDigest: null, createdAt: at, updatedAt: at });
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
      const observation = await this.callProvider(signal => this.provider.submit(structuredClone(attempt.request), { signal }));
      await this.observe(attemptId, observation);
    });
  }

  /** Reconcile only this bridge's attempts. Ingestion recovery does not query the provider. */
  async advance(projectId: string): Promise<boolean> {
    if (this.stopping || this.store.getProject(projectId).planMode !== "code") return false;
    const before = canonical(this.attempts(projectId));
    const results = await Promise.allSettled(this.attempts(projectId).filter(attempt => !terminal(attempt) && !this.operations.has(attempt.id)).map(attempt => this.start(attempt.id, async () => {
      // A prepared intent left by an earlier process has no authority to submit.
      this.fresh.delete(attempt.id);
      if (attempt.phase === "ingesting") { await this.ingest(attempt.id); return; }
      if (attempt.phase === "submitting") this.store.put("attempt", attempt.id, projectId, { ...attempt, phase: "submission_unknown" });
      const observation = await this.callProvider(signal => attempt.taskId && attempt.phase !== "submitting"
        ? this.provider.poll(attempt.taskId, structuredClone(attempt.request), { signal })
        : this.provider.lookup(attempt.id, structuredClone(attempt.request), { signal }));
      await this.observe(attempt.id, observation);
    })));
    const rejected = results.find(result => result.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
    return before !== canonical(this.attempts(projectId));
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

  private async callProvider(call: (signal: AbortSignal) => Promise<ExecutionOutcome>): Promise<ExecutionOutcome> {
    const controller = new AbortController(); this.controllers.add(controller);
    let abort!: () => void;
    const interrupted = new Promise<ExecutionOutcome>(resolveOutcome => {
      abort = () => resolveOutcome({ type: "unknown", diagnostic: "Provider call interrupted after its intent; reconcile without resubmission" });
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), this.providerTimeoutMs);
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
    invariant(attempt.request.execution?.adapter === "fake" && attempt.request.execution.version === "1", "CODE_PLAN_FAKE_ONLY", "P1 cannot recover a real-provider intent");
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
      const phase = outcome.type === "completed" ? "ingesting" : outcome.type === "accepted" ? "remote_pending"
        : outcome.type === "unknown" ? "submission_unknown" : "failed";
      const failure = outcome.type === "failed" || outcome.type === "rejected" ? { id: outcome.failureId, technical: outcome.technical,
        retryAllowed: false, source: "fake_provider" } : null;
      // Rejection is the sole positive evidence that the request cannot be charged.
      const liability: CodePlanLiability = outcome.type === "rejected" ? "released"
        : outcome.type === "completed" || outcome.type === "failed" ? "charged" : record.liability;
      this.store.put("code_plan_execution", id, attempt.projectId, { ...record, liability, outcome, outcomeDigest: digest(outcome), updatedAt: new Date().toISOString() });
      this.store.put("attempt", id, attempt.projectId, { ...attempt, phase, failure, taskId: executionTaskId(outcome) ?? attempt.taskId });
      ingest = outcome.type === "completed";
    });
    if (ingest) await this.ingest(id);
  }

  private async ingest(id: string): Promise<void> {
    const attempt = this.attempt(id), record = this.record(attempt), completion = record.outcome;
    invariant(attempt.phase === "ingesting" && completion?.type === "completed", "CODE_PLAN_EXECUTION_CORRUPT", "Ingestion requires its durable provider completion");
    const signal = new AbortController().signal;
    const outputs: Record<string, ArtifactRef> = {}, artifacts: ArtifactRecord[] = [];
    for (const output of completion.outputs) {
      const result = await this.ingestor.ingest({ attempt: structuredClone(attempt), output: structuredClone(output), artifactDir: this.artifactDir, signal });
      const artifact = ("artifact" in result && typeof result.artifact === "object" && "artifactId" in result.artifact) ? result as ArtifactRecord : null;
      invariant(artifact, "INVALID_PROVIDER_OUTPUT", "P1 fake ingestion must return an immutable fixture artifact");
      await this.validateArtifact(attempt, output, artifact);
      artifacts.push(artifact); outputs[output.port] = artifact.artifact;
    }
    this.store.transaction(() => {
      const current = this.attempt(id);
      if (current.phase === "succeeded") return;
      invariant(current.phase === "ingesting" && this.record(current).outcomeDigest === record.outcomeDigest, "CODE_PLAN_EXECUTION_CORRUPT", "Completion changed during ingestion");
      for (const artifact of artifacts) this.store.insert("artifact", artifact.id, attempt.projectId, artifact);
      this.store.put("attempt", id, attempt.projectId, { ...current, phase: "succeeded", outputs });
    });
  }

  private async validateArtifact(attempt: Attempt, output: IngestibleExecutionOutput, artifact: ArtifactRecord): Promise<void> {
    invariant(typeof artifact.id === "string" && artifact.id.length > 0 && artifact.projectId === attempt.projectId
      && artifact.attemptId === attempt.id && artifact.id === artifact.artifact?.artifactId
      && artifact.artifact.sha256 === output.sha256 && artifact.artifact.kind === output.kind
      && artifact.mimeType === output.mimeType && artifact.fixture === output.fixture && typeof artifact.path === "string" && isAbsolute(artifact.path)
      && (artifact.physicalDurationSeconds === null || Number.isFinite(artifact.physicalDurationSeconds) && artifact.physicalDurationSeconds > 0),
    "INVALID_PROVIDER_OUTPUT", "Ingested artifact differs from the provider completion");
    if (isSpoolOutput(output)) invariant(artifact.outputSpoolId === output.storage.spoolId && artifact.outputReceiptId === output.storage.spoolId
      && artifact.byteLength === output.byteLength, "INVALID_PROVIDER_OUTPUT", "Ingested artifact lost its output spool provenance");
    const path = realpathSync(artifact.path), rel = relative(realpathSync(this.artifactDir), path);
    invariant(rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "INVALID_PROVIDER_OUTPUT", "Ingested artifact must remain in the owned media directory");
    const file = await open(artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      invariant(stat.isFile() && stat.size > 0 && stat.size <= MAX_EXECUTION_OUTPUT_BYTES
        && (!isSpoolOutput(output) || stat.size === output.byteLength), "INVALID_PROVIDER_OUTPUT", "Ingested artifact has an invalid byte count");
      const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024); let size = 0;
      for (;;) {
        const read = await file.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break;
        size += read.bytesRead;
        invariant(size <= stat.size && size <= MAX_EXECUTION_OUTPUT_BYTES, "ARTIFACT_CORRUPT", "Ingested artifact grew during verification");
        hash.update(buffer.subarray(0, read.bytesRead));
      }
      invariant(size === stat.size && hash.digest("hex") === output.sha256, "ARTIFACT_CORRUPT", "Ingested artifact bytes differ from the completion");
    } finally { await file.close(); }
  }
}
