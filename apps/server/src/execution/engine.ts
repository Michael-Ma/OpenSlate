import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, constants, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { open } from "node:fs/promises";
import { DEFAULT_PROFILES, DomainError, canonical, digest, effectiveNodeDigest, invariant, moneyMicros, newId, providerProfileArguments, shotIntentDigest, snapshotLocalExecution } from "@openslate/core";
import type { ArtifactRef, CompiledPlan, InputSource, OperationKind, PlanNode, ProjectRecord, ProviderProfile } from "@openslate/core";
import { ExecutionRegistry, executionFailureSource, executionIdentity, executionProfileSnapshot, executionTaskId, fixtureOutputs, isLegacyExecution, isSpoolCompletion, isSpoolOutput, profileExecutionIdentity, requestExecutionIdentity, EXECUTION_SPOOL_LIMITS, MAX_EXECUTION_OUTPUT_BYTES, normalizeExecutionOutcome } from "@openslate/providers";
import type { ExecutionCallOptions, ExecutionOutcome, IngestibleExecutionOutput, ExecutionProvider, ExecutionRequest, ExecutionSpoolCompletion } from "@openslate/providers";
import { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { ExecutionOutputStore } from "./output-store.js";
import { materializeFixtureOutput } from "./fixture-ingester.js";
import { assertNormalizedVideoIngestion } from "./video-derivation.js";
import type { NormalizedVideoIngestion, VideoDerivationIntent } from "./video-derivation.js";
import { assertLocalExecutionIntent, assertLocalExecutionResult, assertPreparedLocalExecution, isLocalExecutionAttempt, localFingerprint, localWorkKey } from "./local-execution.js";
import type { LocalExecutionBinding, LocalExecutionCompletion, LocalExecutionDispatch, LocalExecutionIntent, LocalExecutionOptions, LocalExecutionPort, LocalExecutionResult, PreparedLocalExecution } from "./local-execution.js";

export interface Grant { id: string; projectId: string; scopeId: string; kind: OperationKind; authorityId: string; origin: "initial_slot" | "user_change" }
export interface Candidate { id: string; projectId: string; nodeId: string; grantId: string; origin: Grant["origin"] }
export interface PlanRecord { id: string; projectId: string; compiled: CompiledPlan }
export interface NodeBinding {
  id: string; projectId: string; planId: string; node: PlanNode;
  candidateId: string | null; state: "active" | "retired"; outputs: Record<string, ArtifactRef>;
}
export type AttemptPhase = "submitting" | "remote_pending" | "submission_unknown" | "ingesting" | "succeeded" | "failed";
export interface Attempt {
  id: string; projectId: string; nodeId: string; candidateId: string | null; ordinal: number;
  specDigest: string; fingerprint: string; request: ExecutionRequest; workKey: string | null;
  phase: AttemptPhase; leaseOwner: string; leaseEpoch: number; leaseExpiresAt: number;
  taskId: string | null; reservationId: string | null;
  failure: { id: string; technical: boolean; source: string; retryAllowed: boolean } | null;
  outputs: Record<string, ArtifactRef>; createdAt: string;
}
export interface ArtifactRecord {
  id: string; projectId: string; artifact: ArtifactRef; path: string; mimeType: string;
  fixture: boolean; attemptId: string | null; physicalDurationSeconds: number | null;
  origin?: "supplied_video" | "supplied_image" | "local_render" | "narration_audio" | "generated_video";
  outputReceiptId?: string; outputSpoolId?: string; byteLength?: number;
  width?: number; height?: number; validationDigest?: string;
  derivationId?: string; sourceDescriptorId?: string;
}
interface Reservation { id: string; projectId: string; attemptId: string; micros: string; state: "reserved" | "charged" | "released" }
interface Hold { id: string; projectId: string; scopeId: string; ownerId: string; active: boolean }
interface Approval { id: string; projectId: string; snapshotId: string; videoNodeId: string; approvalDigest: string; authorityId: string }
export interface ReviewSnapshot {
  id: string; projectId: string; planId: string;
  members: { videoNodeId: string; shotId: string; keyframe: ArtifactRef | null; approvalDigest: string | null; ready: boolean }[];
}
interface Evidence { id: string; projectId: string; attemptId: string; outcome: ExecutionOutcome; outcomeDigest: string; recordedAt: string }
/** Trusted host hook: decode/probe and publish immutable bytes before returning their exact record. */
export interface ExecutionOutputIngestor {
  ingest(input: { attempt: Readonly<Attempt>; output: Readonly<IngestibleExecutionOutput>; artifactDir: string; signal: AbortSignal }): Promise<ArtifactRecord | NormalizedVideoIngestion> | ArtifactRecord | NormalizedVideoIngestion;
}
interface IngestedOutput { output: IngestibleExecutionOutput; record: ArtifactRecord; normalized?: NormalizedVideoIngestion }
interface ResolvedInputs { artifacts: ArtifactRef[]; fingerprint: string }
export interface ExternalExecutionAdmission {
  /** Trusted synchronous policy; check readiness and select allowance in this admission transaction. */
  authorize(input: { attemptId: string; projectId: string; nodeId: string; candidateId: string; profile: Readonly<ProviderProfile>; estimatedMicros: string }): { allowanceId: string };
  /** Record exact consumption after attempt and reservation insertion, before the same transaction commits. */
  recordAdmission?(attempt: Readonly<Attempt>): void;
}
const GENERATED = new Set<OperationKind>(["image", "video", "speech", "transcription"]);
const TERMINAL = new Set<AttemptPhase>(["succeeded", "failed"]);

/** Durable executor over registered ports. The shipped launcher enables only fake execution. */
export class Engine {
  readonly recovery: InstallationRecoveryGuard;
  readonly registry: ExecutionRegistry;
  private readonly externalAdmission: ExternalExecutionAdmission | undefined;
  private readonly providerTimeoutMs: number;
  readonly workerId: string;
  readonly profiles: ProviderProfile[];
  readonly artifactDir: string;
  readonly leaseMs: number;
  readonly defaultBudgetMicros: string;
  readonly outputIngestor: ExecutionOutputIngestor | undefined;
  readonly outputStore: ExecutionOutputStore | undefined;
  readonly localExecutor: LocalExecutionPort | undefined;
  constructor(readonly store: Store, readonly provider: ExecutionProvider | ExecutionRegistry, options: {
    artifactDir: string; profiles?: ProviderProfile[]; budgetMicros?: string; workerId?: string; leaseMs?: number;
    outputIngestor?: ExecutionOutputIngestor;
    outputStore?: ExecutionOutputStore;
    externalAdmission?: ExternalExecutionAdmission;
    providerTimeoutMs?: number;
    localExecution?: LocalExecutionPort;
  }) {
    this.recovery = new InstallationRecoveryGuard(store);
    this.registry = provider instanceof ExecutionRegistry ? provider : new ExecutionRegistry([provider]);
    this.externalAdmission = options.externalAdmission;
    invariant(!options.externalAdmission || (typeof options.externalAdmission.authorize === "function" && options.externalAdmission.authorize.constructor.name !== "AsyncFunction"), "ASYNC_TRANSACTION", "External admission policy must be synchronous");
    invariant(!options.externalAdmission?.recordAdmission || (typeof options.externalAdmission.recordAdmission === "function"
      && options.externalAdmission.recordAdmission.constructor.name !== "AsyncFunction"), "ASYNC_TRANSACTION", "Admission recording must be synchronous");
    this.providerTimeoutMs = options.providerTimeoutMs ?? 600000;
    invariant(Number.isSafeInteger(this.providerTimeoutMs) && this.providerTimeoutMs >= 10 && this.providerTimeoutMs <= 600000, "PROVIDER_CONFIGURATION_INVALID", "Provider operation deadline must be bounded");
    this.workerId = options.workerId ?? newId();
    this.profiles = options.profiles ?? DEFAULT_PROFILES;
    this.artifactDir = resolve(options.artifactDir);
    this.leaseMs = options.leaseMs ?? 30_000;
    this.defaultBudgetMicros = options.budgetMicros ?? "1000000";
    this.outputIngestor = options.outputIngestor;
    invariant(!options.outputStore || options.outputStore.store === store, "OUTPUT_STORE_CONFIGURATION", "Executor and output storage must share the same application store");
    this.outputStore = options.outputStore;
    this.localExecutor = options.localExecution;
    if (this.localExecutor) {
      snapshotLocalExecution(this.localExecutor.identity);
      invariant(["prepare", "matches", "recover", "execute"].every(name => typeof this.localExecutor![name as "prepare"] === "function")
        && this.localExecutor.matches.constructor.name !== "AsyncFunction" && Number.isSafeInteger(this.localExecutor.maxOutputBytes)
        && this.localExecutor.maxOutputBytes > 0 && this.localExecutor.maxOutputBytes <= 1024 * 1024 * 1024,
      "LOCAL_EXECUTION_UNSUPPORTED", "Install a bounded complete local execution port");
    }
    moneyMicros(this.defaultBudgetMicros);
    mkdirSync(this.artifactDir, { recursive: true });
  }

  createGrant(projectId: string, scopeId: string, kind: OperationKind, authorityId: string, origin: Grant["origin"] = "user_change"): Grant {
    this.recovery.assertWritable(projectId, authorityId);
    const project = this.store.getProject(projectId);
    invariant(scopeId === projectId || project.shots.some(shot => shot.id === scopeId) || project.scenes.some(scene => scene.id === scopeId), "SCOPE_DENIED", "Grant scope is not part of the project");
    invariant(GENERATED.has(kind) && authorityId.length > 0, "ORIGIN_NOT_AUTHORIZED", "A media grant requires trusted scoped authority");
    return this.store.insert("grant", newId(), projectId, { scopeId, kind, authorityId, origin }) as Grant;
  }

  installPlan(projectId: string, planId: string, compiled: CompiledPlan, grantBindings: Record<string, string> = {}): { planId: string; nodes: NodeBinding[] } {
    return this.store.transaction(() => {
      this.recovery.assertWritable(projectId);
      const project = this.store.getProject(projectId);
      if (!this.store.get("budget", projectId)) this.store.insert("budget", projectId, projectId, { capMicros: this.defaultBudgetMicros, currency: "USD" });
      const saved = this.store.get<PlanRecord>("plan", planId);
      if (saved) {
        invariant(saved.projectId === projectId && saved.compiled.graphDigest === compiled.graphDigest, "IDEMPOTENCY_CONFLICT", "Plan identity already has different content");
        return { planId, nodes: this.store.list<NodeBinding>("node_binding", projectId).filter(binding => binding.planId === planId) };
      }
      const previous = new Map(this.store.list<NodeBinding>("node_binding", projectId).map(binding => [binding.id, binding]));
      const seen = new Set<string>(); const replaced = new Set<string>(); const nodes: NodeBinding[] = [];
      for (const node of compiled.nodes) {
        invariant(!seen.has(node.id), "DUPLICATE_NODE", "Duplicate execution node"); seen.add(node.id);
        invariant(!node.shotId || project.shots.some(shot => shot.id === node.shotId), "SCOPE_DENIED", "Node shot is outside this project");
        const old = previous.get(node.id);
        const dependencyChanged = node.inputs.some(input => input.source.kind === "output" && replaced.has(input.source.nodeId));
        const same = old?.state === "active" && old.node.specDigest === node.specDigest && !dependencyChanged;
        const grantId = grantBindings[node.id];
        let candidateId: string | null = same ? old.candidateId : null;
        if (GENERATED.has(node.kind) && (!same || grantId)) {
          invariant(grantId, "ORIGIN_NOT_AUTHORIZED", `Node ${node.alias} requires an unused grant`);
          this.recovery.assertFreshAuthority(projectId, "grant", grantId);
          const grant = this.store.get<Grant>("grant", grantId);
          const sceneId = project.shots.find(shot => shot.id === node.shotId)?.sceneId;
          invariant(grant && grant.projectId === projectId && grant.kind === node.kind && [projectId, node.shotId, sceneId].includes(grant.scopeId), "ORIGIN_NOT_AUTHORIZED", "Grant does not cover this operation");
          const candidate = this.store.insert("candidate", newId(), projectId, { nodeId: node.id, grantId, origin: grant.origin }) as Candidate;
          candidateId = candidate.id;
        }
        const reuse = same && !grantId && !Object.hasOwn(node.args, "localExecution");
        if (!reuse) replaced.add(node.id);
        const binding: NodeBinding = { id: node.id, projectId, planId, node, candidateId, state: "active", outputs: reuse ? old.outputs : {} };
        this.store.put("node_binding", node.id, projectId, binding); nodes.push(binding);
      }
      for (const binding of previous.values()) if (!seen.has(binding.id)) this.store.put("node_binding", binding.id, projectId, { ...binding, state: "retired" });
      this.store.insert("plan", planId, projectId, { id: planId, projectId, compiled });
      this.store.appendEvent(projectId, "execution.plan_installed", { planId });
      return { planId, nodes };
    });
  }

  setHold(projectId: string, value: { scopeId: string; ownerId: string; id?: string }): Hold {
    return this.store.transaction(() => {
      this.recovery.assertWritable(projectId, value.ownerId);
      const project = this.store.getProject(projectId);
      invariant(value.scopeId === projectId || project.shots.some(shot => shot.id === value.scopeId) || project.scenes.some(scene => scene.id === value.scopeId), "SCOPE_DENIED", "Unknown hold scope");
      const id = value.id ?? newId(); const old = this.store.get<Hold>("hold", id);
      invariant(!old || (old.projectId === projectId && old.ownerId === value.ownerId && old.scopeId === value.scopeId), "SCOPE_DENIED", "Hold is owned by another request");
      const result = this.store.put("hold", id, projectId, { ...value, id, projectId, active: true }) as Hold;
      this.store.appendEvent(projectId, "hold.changed", { holdId: id, active: true }); return result;
    });
  }
  releaseHold(projectId: string, holdId: string, ownerId: string): void {
    this.store.transaction(() => {
      this.recovery.assertWritable(projectId);
      const hold = this.store.get<Hold>("hold", holdId);
      invariant(hold?.projectId === projectId && hold.ownerId === ownerId, "SCOPE_DENIED", "Only the hold owner may release it");
      this.store.put("hold", holdId, projectId, { ...hold, active: false });
      this.store.appendEvent(projectId, "hold.changed", { holdId, active: false });
    });
  }
  setPaused(projectId: string, paused: boolean, authorityId: string): void {
    this.store.transaction(() => {
      this.recovery.assertWritable(projectId, authorityId);
      invariant(authorityId.length > 0, "ORIGIN_NOT_AUTHORIZED", "Pause control requires authority");
      this.store.put("execution_control", projectId, projectId, { paused, authorityId });
      this.store.appendEvent(projectId, "execution.pause_changed", { paused });
    });
  }
  setBudget(projectId: string, capMicros: string): void {
    this.recovery.assertWritable(projectId);
    moneyMicros(capMicros); this.store.put("budget", projectId, projectId, { capMicros, currency: "USD" });
  }
  budget(projectId: string): { capMicros: string; committedMicros: string; currency: "USD" } {
    const capMicros = this.store.get<{ capMicros: string }>("budget", projectId)?.capMicros ?? this.defaultBudgetMicros;
    const committed = this.store.list<Reservation>("reservation", projectId).filter(item => item.state !== "released").reduce((sum, item) => sum + moneyMicros(item.micros), 0n);
    return { capMicros, committedMicros: committed.toString(), currency: "USD" };
  }

  reviewSnapshot(projectId: string, gateId?: string): ReviewSnapshot {
    this.recovery.assertWritable(projectId);
    return this.calculateReview(projectId, gateId, true) as ReviewSnapshot;
  }
  inspectReview(projectId: string, gateId?: string): Omit<ReviewSnapshot, "id"> {
    return this.calculateReview(projectId, gateId, false);
  }
  private calculateReview(projectId: string, gateId: string | undefined, persist: boolean): ReviewSnapshot | Omit<ReviewSnapshot, "id"> {
    // Verify bytes before the short consistency transaction. The transaction then
    // compares the same immutable input identities without doing filesystem I/O.
    const before = this.activePlan(this.store.getProject(projectId));
    const verified = new Map<string, string>();
    for (const gate of before.compiled.gates.filter(item => !gateId || item.id === gateId)) for (const member of gate.members) {
      try { verified.set(member.videoNodeId, this.resolveInputs(projectId, this.currentBinding(projectId, member.videoNodeId).node, true).fingerprint); }
      catch (error) { if (!(error instanceof DomainError)) throw error; }
    }
    return this.store.transaction(() => {
      const project = this.store.getProject(projectId);
      const plan = this.activePlan(project);
      const gates = gateId ? plan.compiled.gates.filter(gate => gate.id === gateId) : plan.compiled.gates;
      invariant(!persist && !gateId || gates.length > 0, "NOT_FOUND", "No matching review gate");
      const members: ReviewSnapshot["members"] = [];
      for (const member of gates.flatMap(gate => gate.members)) {
        const binding = this.currentBinding(projectId, member.videoNodeId);
        let keyframe: ArtifactRef | null = null; let approvalDigest: string | null = null;
        try {
          this.checkIntent(project, binding.node);
          keyframe = this.resolveSource(projectId, member.frameSource);
          approvalDigest = this.resolveInputs(projectId, binding.node).fingerprint;
          invariant(verified.get(member.videoNodeId) === approvalDigest, "REVIEW_SPEC_MISMATCH", "Review inputs changed during preparation");
        } catch (error) { if (!(error instanceof DomainError)) throw error; keyframe = null; approvalDigest = null; }
        members.push({ videoNodeId: member.videoNodeId, shotId: member.shotId, keyframe, approvalDigest, ready: keyframe !== null && approvalDigest !== null });
      }
      if (!persist) return { projectId, planId: plan.id, members };
      const snapshot = { id: newId(), projectId, planId: plan.id, members };
      return this.store.insert("review_snapshot", snapshot.id, projectId, snapshot);
    });
  }
  approve(projectId: string, snapshotId: string, videoNodeIds: string[], authorityId: string): Approval[] {
    return this.store.transaction(() => {
      this.recovery.assertWritable(projectId, authorityId);
      invariant(authorityId.length > 0 && videoNodeIds.length > 0 && new Set(videoNodeIds).size === videoNodeIds.length, "HUMAN_REVIEW_REQUIRED", "Approval requires a human decision and an exact nonempty subset");
      const snapshot = this.store.get<ReviewSnapshot>("review_snapshot", snapshotId);
      invariant(snapshot?.projectId === projectId, "SCOPE_DENIED", "Review snapshot is outside this project");
      const project = this.store.getProject(projectId);
      const approvals = videoNodeIds.map(videoNodeId => {
        const displayed = snapshot.members.find(member => member.videoNodeId === videoNodeId);
        const binding = this.currentBinding(projectId, videoNodeId);
        this.checkIntent(project, binding.node);
        const effective = this.resolveInputs(projectId, binding.node).fingerprint;
        invariant(displayed?.ready && displayed.approvalDigest === effective, "REVIEW_SPEC_MISMATCH", "Displayed review no longer matches current inputs");
        return this.store.insert("approval", newId(), projectId, { snapshotId, videoNodeId, approvalDigest: effective, authorityId }) as Approval;
      });
      this.store.appendEvent(projectId, "review.decided", { snapshotId, videoNodeIds }); return approvals;
    });
  }

  attempts(projectId: string): Attempt[] { return this.store.list<Attempt>("attempt", projectId); }
  outputs(projectId: string): { nodeId: string; candidateId: string | null; port: string; artifact: ArtifactRef; fixture: boolean }[] {
    const project = this.store.getProject(projectId);
    return this.store.list<NodeBinding>("node_binding", projectId).filter(binding => binding.state === "active" && binding.planId === project.activePlanId)
      .filter(binding => !Object.hasOwn(binding.node.args, "localExecution") || this.localBindingCurrent(binding))
      .flatMap(binding => Object.entries(binding.outputs).map(([port, artifact]) => {
        const record = this.store.get<ArtifactRecord>("artifact", artifact.artifactId);
        invariant(record?.projectId === projectId && record.artifact.sha256 === artifact.sha256,
          "ARTIFACT_UNAVAILABLE", "Output lacks its owned artifact record");
        return { nodeId: binding.id, candidateId: binding.candidateId, port, artifact, fixture: record.fixture };
      }));
  }

  async runReady(): Promise<{ dispatched: number; reused: number; blocked: { nodeId: string; code: string }[] }> {
    this.recovery.assertWritable();
    this.store.transaction(() => {
      for (const project of this.projects()) for (const binding of this.store.list<NodeBinding>("node_binding", project.id))
        if (binding.state === "active" && binding.planId === project.activePlanId && Object.hasOwn(binding.node.args, "localExecution")
          && Object.keys(binding.outputs).length && !this.localBindingCurrent(binding))
          this.store.put("node_binding", binding.id, project.id, { ...binding, outputs: {} });
    });
    const candidates = this.projects().flatMap(project => this.store.list<NodeBinding>("node_binding", project.id).filter(binding => binding.state === "active" && binding.planId === project.activePlanId && Object.keys(binding.outputs).length === 0));
    const blocked: { nodeId: string; code: string }[] = []; let dispatched = 0; let reused = 0;
    const settled = await Promise.allSettled(candidates.map(async binding => {
      let attempt: Attempt;
      try {
        const lock = this.store.get<{ localExecution?: unknown }>("capability_lock", this.store.getProject(binding.projectId).capabilityLockId);
        if (Object.hasOwn(binding.node.args, "localExecution") || ((binding.node.kind === "timeline" || binding.node.kind === "render") && lock && Object.hasOwn(lock, "localExecution"))) {
          const outcome = await this.runLocalReady(binding);
          if (outcome === "reused") reused++; else dispatched++;
          return;
        }
        const prepared = this.resolveInputs(binding.projectId, binding.node, true);
        if (this.reuseLocal(binding, prepared.fingerprint)) { reused++; return; }
        attempt = this.admit(binding.projectId, binding.id, prepared.fingerprint);
      }
      catch (error) { if (error instanceof DomainError) { blocked.push({ nodeId: binding.id, code: error.code }); return; } throw error; }
      dispatched++;
      if (attempt.candidateId === null) {
        await this.handle(attempt, { type: "completed", taskId: `local:${attempt.id}`, outputs: fixtureOutputs(attempt.request) }); return;
      }
      const provider = this.registry.forRequest(attempt.request);
      this.recovery.assertFirstSubmit(attempt.projectId, attempt.id);
      const outcome = await this.observeProvider(attempt, options => provider.submit(structuredClone(attempt.request), options), "Submission threw after intent was persisted");
      if (outcome) await this.handle(attempt, outcome);
    }));
    const rejected = settled.find(result => result.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
    return { dispatched, reused, blocked };
  }

  async reconcile(): Promise<{ reconciled: number; blocked?: { attemptId: string; code: string }[] }> {
    this.recovery.assertWritable();
    const pending = this.projects().flatMap(project => this.attempts(project.id)).filter(attempt => !TERMINAL.has(attempt.phase));
    let reconciled = 0; const blocked: { attemptId: string; code: string }[] = [];
    const settled = await Promise.allSettled(pending.map(async observed => {
      if (isLocalExecutionAttempt(observed)) {
        try {
          this.requireLocalPort();
          const attempt = this.claimLocal(observed); if (!attempt) return;
          await this.runLocalAttempt(attempt); reconciled++;
        } catch (error) { if (error instanceof DomainError) { blocked.push({ attemptId: observed.id, code: error.code }); return; } throw error; }
        return;
      }
      let provider: ExecutionProvider;
      try { provider = this.registry.forRequest(observed.request); }
      catch (error) { if (error instanceof DomainError) { blocked.push({ attemptId: observed.id, code: error.code }); return; } throw error; }
      const attempt = this.claim(observed);
      if (!attempt) return;
      let outcome: ExecutionOutcome;
      const observations = this.store.list<Evidence>("execution_evidence", attempt.projectId).filter(item => item.projectId === attempt.projectId
        && item.attemptId === attempt.id && item.outcomeDigest === digest(item.outcome));
      // Evidence is tied to this immutable attempt/request. A known task remains
      // authoritative; a late accepted receipt can repair a previously unknown ID.
      const acceptedIds = !attempt.taskId ? [...new Set(observations.filter(item => item.outcome.type === "accepted"
        && normalizeExecutionOutcome(item.outcome, attempt.request).type === "accepted").map(item => executionTaskId(item.outcome)!))] : [];
      const authoritativeTask = attempt.taskId ?? (acceptedIds.length === 1 ? acceptedIds[0]! : null);
      const completed = observations.find(item => item.outcome.type === "completed"
        && (!authoritativeTask || executionTaskId(item.outcome) === authoritativeTask) && this.completionBound(attempt, item.outcome));
      let recovered: ExecutionSpoolCompletion | null = null;
      if (!completed && this.outputStore) {
        try { recovered = await this.withLease(attempt, signal => this.outputStore!.recoverCompletion(attempt.projectId, attempt.id, { signal })); }
        catch {
          await this.handle(attempt, { type: "unknown", diagnostic: "Owned output recovery requires attention" }); reconciled++; return;
        }
        if (!this.owns(attempt)) return;
      }
      if (acceptedIds.length > 1) outcome = { type: "unknown", diagnostic: "Conflicting accepted task receipts require attention" };
      else if (completed) outcome = completed.outcome;
      else if (recovered) outcome = authoritativeTask && executionTaskId(recovered) !== authoritativeTask
        ? { type: "unknown", diagnostic: "Owned output conflicts with retained accepted task identity" } : recovered;
      else if (acceptedIds.length === 1) outcome = { type: "accepted", taskId: acceptedIds[0]! };
      else if (attempt.candidateId === null) outcome = this.recovery.recoveryMode(attempt.projectId, attempt.id) === "existing_results_only"
        ? { type: "unknown", diagnostic: "Restored local work has no retained completion; use a fresh request" }
        : { type: "completed", taskId: `local:${attempt.id}`, outputs: fixtureOutputs(attempt.request) };
      else {
        const result = await this.observeProvider(attempt, options => attempt.taskId
          ? provider.poll(attempt.taskId, structuredClone(attempt.request), options)
          : provider.lookup(attempt.id, structuredClone(attempt.request), options), "Reconciliation temporarily unavailable");
        if (!result) return; outcome = result;
      }
      await this.handle(attempt, outcome); reconciled++;
    }));
    const rejected = settled.find(result => result.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
    return { reconciled, ...(blocked.length ? { blocked } : {}) };
  }

  private requireLocalPort(): LocalExecutionPort {
    invariant(this.localExecutor, "LOCAL_EXECUTION_UNAVAILABLE", "The saved local executor is not installed");
    snapshotLocalExecution(this.localExecutor.identity); return this.localExecutor;
  }
  private localMode(project: ProjectRecord, node: PlanNode): LocalExecutionPort {
    const port = this.requireLocalPort();
    invariant(node.kind === "timeline" || node.kind === "render", "LOCAL_EXECUTION_UNSUPPORTED", "Local execution is only for assembly");
    const lock = this.store.get<{ projectId: string; localExecution?: unknown }>("capability_lock", project.capabilityLockId);
    invariant(lock?.projectId === project.id && Object.hasOwn(lock, "localExecution"), "LOCAL_EXECUTION_UNSUPPORTED", "Local work requires its saved application lock");
    snapshotLocalExecution(lock.localExecution); snapshotLocalExecution(node.args.localExecution);
    const planNode = this.activePlan(project).compiled.nodes.find(value => value.id === node.id);
    invariant(canonical(planNode) === canonical(node), "LOCAL_EXECUTION_STALE", "Local node differs from the active plan");
    return port;
  }
  private localMatches(prepared: PreparedLocalExecution): boolean {
    const matches = this.requireLocalPort().matches(structuredClone(prepared));
    invariant(typeof matches === "boolean", "ASYNC_TRANSACTION", "Local capture comparison must be synchronous"); return matches;
  }
  private localBindingCurrent(binding: NodeBinding): boolean {
    try {
      const project = this.store.getProject(binding.projectId); this.localMode(project, binding.node);
      const selected = this.store.get<LocalExecutionBinding>("local_execution_binding", binding.id);
      const completion = selected ? this.store.get<LocalExecutionCompletion>("local_execution_completion", selected.attemptId) : undefined;
      return !!selected && selected.projectId === binding.projectId && selected.prepared.specDigest === binding.node.specDigest
        && !!completion && canonical(binding.outputs) === canonical({ [completion.result.port]: completion.result.artifact.artifact })
        && this.localMatches(selected.prepared);
    } catch { return false; }
  }
  private localCapacity(exceptId?: string): void {
    invariant(!this.projects().some(project => this.attempts(project.id).some(attempt => attempt.id !== exceptId
      && isLocalExecutionAttempt(attempt) && !TERMINAL.has(attempt.phase) && attempt.leaseExpiresAt > Date.now())),
    "LOCAL_EXECUTION_BUSY", "Another local assembly job owns the installation worker");
  }
  private localOptions(attempt: Attempt, signal: AbortSignal): LocalExecutionOptions {
    return Object.freeze({ signal, expectedLease: Object.freeze({ owner: attempt.leaseOwner, epoch: attempt.leaseEpoch }) });
  }
  private async runLocalReady(observed: NodeBinding): Promise<"reused" | "dispatched"> {
    const port = this.localMode(this.store.getProject(observed.projectId), observed.node);
    const prepared = structuredClone(await port.prepare(observed.projectId, observed.id)); assertPreparedLocalExecution(prepared);
    invariant(prepared.projectId === observed.projectId && prepared.nodeId === observed.id && prepared.specDigest === observed.node.specDigest,
      "LOCAL_EXECUTION_STALE", "Prepared local work belongs to a different node");
    const effective = this.resolveInputs(observed.projectId, observed.node).fingerprint;
    const fingerprint = localFingerprint(effective, prepared.contentDigest);
    const sameContent = (value: Attempt) => isLocalExecutionAttempt(value) && value.nodeId === observed.id && value.fingerprint === fingerprint;
    const previous = this.attempts(observed.projectId).find(value => sameContent(value) && value.phase === "succeeded");
    if (previous) {
      const intent = this.store.get<LocalExecutionIntent>("local_execution_intent", previous.id);
      invariant(intent, "LOCAL_EXECUTION_CONFLICT", "Cached local output lost its original intent"); assertLocalExecutionIntent(intent, previous);
      const abort = new AbortController();
      try {
        const recovered = await port.recover(structuredClone(intent), this.localOptions(previous, abort.signal));
        invariant(recovered, "LOCAL_EXECUTION_COMPLETION_MISSING", "Cached local output has no verified completion");
        const result = structuredClone(recovered); await this.verifyLocalResult(intent, result, abort.signal);
        const completed = this.store.get<LocalExecutionCompletion>("local_execution_completion", previous.id);
        invariant(completed && canonical(completed.result) === canonical(result), "LOCAL_EXECUTION_CONFLICT", "Recovered cache differs from its published receipt");
        this.store.transaction(() => {
          const project = this.store.getProject(observed.projectId), binding = this.currentBinding(project.id, observed.id);
          this.localMode(project, binding.node);
          invariant(!this.held(project, binding.id), "EXECUTION_HELD", "Local work is paused or held");
          invariant(!Object.keys(binding.outputs).length && this.localMatches(prepared)
            && this.resolveInputs(project.id, binding.node).fingerprint === effective, "LOCAL_EXECUTION_STALE", "Local reuse target changed");
          this.selectLocal(binding, previous.id, prepared, result);
          this.store.appendEvent(project.id, "execution.output_reused", { nodeId: binding.id, attemptId: previous.id });
        });
        return "reused";
      } finally { abort.abort(); }
    }
    const attempt = this.store.transaction(() => {
      const project = this.store.getProject(observed.projectId), binding = this.currentBinding(project.id, observed.id);
      this.localMode(project, binding.node); this.localCapacity();
      invariant(!this.held(project, binding.id), "EXECUTION_HELD", "Local work is paused or held");
      invariant(!Object.keys(binding.outputs).length && this.localMatches(prepared)
        && this.resolveInputs(project.id, binding.node).fingerprint === effective, "LOCAL_EXECUTION_STALE", "Local admission target changed");
      const predecessors = this.attempts(project.id).filter(sameContent);
      // A stale admission that never crossed dispatch can be rebased onto a fresh
      // target. Any dispatch or completion retains the no-automatic-rerender rule.
      invariant(predecessors.every(value => {
        const intent = this.store.get<LocalExecutionIntent>("local_execution_intent", value.id);
        if (intent) assertLocalExecutionIntent(intent, value);
        return isLocalExecutionAttempt(value) && value.phase === "failed" && value.failure?.id === "LOCAL_EXECUTION_STALE"
          && !this.store.get("local_execution_dispatch", value.id) && !this.store.get("local_execution_completion", value.id)
          && intent?.prepared.contentDigest === prepared.contentDigest && canonical(intent.prepared.capture) !== canonical(prepared.capture);
      }), "LOCAL_EXECUTION_INTERRUPTED", "Existing local work must be recovered; an explicit local retry is not yet available");
      const id = newId(), ordinal = Math.max(0, ...predecessors.map(value => value.ordinal)) + 1;
      const workKey = localWorkKey(project.id, binding.id, fingerprint, ordinal);
      const admitted: Attempt = { id, projectId: project.id, nodeId: binding.id, candidateId: null, ordinal,
        specDigest: binding.node.specDigest, fingerprint, workKey,
        request: { attemptId: id, nodeId: binding.id, kind: binding.node.kind, fingerprint, args: binding.node.args,
          inputs: this.resolveInputs(project.id, binding.node).artifacts, execution: snapshotLocalExecution(binding.node.args.localExecution) },
        phase: "ingesting", leaseOwner: this.workerId, leaseEpoch: 1, leaseExpiresAt: Date.now() + this.leaseMs,
        taskId: null, reservationId: null, failure: null, outputs: {}, createdAt: new Date().toISOString() };
      this.store.insert("attempt", id, project.id, admitted);
      const intent: LocalExecutionIntent = { id, projectId: project.id, version: 1, attemptId: id, requestDigest: digest(admitted.request),
        capabilityLockId: project.capabilityLockId, execution: snapshotLocalExecution(binding.node.args.localExecution), prepared,
        effectiveFingerprint: effective, outputArtifactId: newId(), createdAt: admitted.createdAt };
      this.store.insert("local_execution_intent", id, project.id, intent);
      this.store.appendEvent(project.id, "attempt.state_changed", { attemptId: id, nodeId: binding.id, phase: "ingesting" }); return admitted;
    });
    await this.runLocalAttempt(attempt); return "dispatched";
  }
  private claimLocal(observed: Attempt): Attempt | null {
    return this.store.transaction(() => {
      this.localCapacity(observed.id); return this.claim(observed);
    });
  }
  private async runLocalAttempt(attempt: Attempt): Promise<void> {
    const port = this.requireLocalPort(), intent = this.store.get<LocalExecutionIntent>("local_execution_intent", attempt.id);
    invariant(intent, "LOCAL_EXECUTION_CONFLICT", "Local attempt has no durable intent"); assertLocalExecutionIntent(intent, attempt);
    let verifiedCompletion = false;
    try {
      let result = await this.withLease(attempt, signal => port.recover(structuredClone(intent), this.localOptions(attempt, signal)));
      if (!this.owns(attempt)) return;
      if (!result) {
        this.store.transaction(() => {
          const current = this.owns(attempt); invariant(current, "LOCAL_EXECUTION_LEASE_LOST", "Local dispatch lease changed");
          invariant(!this.store.get("local_execution_dispatch", attempt.id), "LOCAL_EXECUTION_INTERRUPTED", "Local dispatch has no recoverable completion; automatic rerender is disabled");
          this.recovery.assertWritable(attempt.projectId);
          this.recovery.assertFreshAuthority(attempt.projectId, "attempt", attempt.id);
          const project = this.store.getProject(attempt.projectId), binding = this.currentBinding(project.id, attempt.nodeId);
          this.localMode(project, binding.node);
          invariant(!this.held(project, binding.id), "EXECUTION_HELD", "Local work is paused or held");
          invariant(this.localMatches(intent.prepared), "LOCAL_EXECUTION_STALE", "Local target changed before dispatch");
          const dispatch: LocalExecutionDispatch = { id: attempt.id, projectId: attempt.projectId, version: 1, attemptId: attempt.id,
            requestDigest: intent.requestDigest, intentDigest: digest(intent), owner: attempt.leaseOwner, epoch: attempt.leaseEpoch, createdAt: new Date().toISOString() };
          this.store.insert("local_execution_dispatch", attempt.id, attempt.projectId, dispatch);
        });
        result = await this.withLease(attempt, signal => port.execute(structuredClone(intent), this.localOptions(attempt, signal)), true);
      }
      if (!result || !this.owns(attempt)) return;
      const snapshot = structuredClone(result);
      const verified = await this.withLease(attempt, async signal => { await this.verifyLocalResult(intent, snapshot, signal); return true; });
      if (!verified) return;
      verifiedCompletion = true;
      this.store.transaction(() => {
        const current = this.owns(attempt); if (!current) return;
        assertLocalExecutionIntent(intent, current); assertLocalExecutionResult(snapshot, intent);
        this.store.insert("artifact", snapshot.artifact.id, current.projectId, snapshot.artifact);
        this.store.insert<LocalExecutionCompletion>("local_execution_completion", current.id, current.projectId,
          { id: current.id, projectId: current.projectId, version: 1, attemptId: current.id, result: snapshot });
        this.store.put("attempt", current.id, current.projectId, { ...current, phase: "succeeded", outputs: { [snapshot.port]: snapshot.artifact.artifact }, leaseExpiresAt: 0, failure: null });
        const binding = this.store.get<NodeBinding>("node_binding", current.nodeId), project = this.store.getProject(current.projectId);
        let selectable = false;
        try {
          if (binding?.projectId === project.id && binding.planId === project.activePlanId && binding.state === "active"
            && binding.node.specDigest === intent.prepared.specDigest && !this.held(project, binding.id) && this.localMatches(intent.prepared)
            && this.resolveInputs(project.id, binding.node).fingerprint === intent.effectiveFingerprint) {
            this.localMode(project, binding.node); selectable = true;
          }
        } catch (error) { if (!(error instanceof DomainError)) throw error; }
        if (selectable) this.selectLocal(binding!, current.id, intent.prepared, snapshot);
        this.store.appendEvent(current.projectId, "artifact.published", { artifactId: snapshot.artifact.id, attemptId: current.id, fixture: false });
        this.store.appendEvent(current.projectId, "attempt.state_changed", { attemptId: current.id, phase: "succeeded" });
      });
    } catch (error) {
      this.store.transaction(() => {
        const current = this.owns(attempt); if (!current) return;
        const held = error instanceof DomainError && error.code === "EXECUTION_HELD";
        const recoverable = verifiedCompletion || (error instanceof DomainError && error.code === "RESTORED_AUTHORITY_REQUIRES_NEW") || (!!this.store.get("local_execution_dispatch", current.id)
          && !(error instanceof DomainError && ["LOCAL_EXECUTION_INTERRUPTED", "LOCAL_EXECUTION_CONFLICT"].includes(error.code)));
        this.store.put("attempt", current.id, current.projectId, { ...current, phase: held || recoverable ? "ingesting" : "failed", leaseExpiresAt: 0,
          failure: held ? null : { id: error instanceof DomainError ? error.code : "LOCAL_EXECUTION_FAILED", technical: true, source: "local_media", retryAllowed: false } });
        this.store.appendEvent(current.projectId, "attempt.state_changed", { attemptId: current.id, phase: held || recoverable ? "ingesting" : "failed" });
      });
      throw error;
    } finally {
      this.store.transaction(() => {
        const current = this.owns(attempt);
        if (current) this.store.put("attempt", current.id, current.projectId, { ...current, leaseExpiresAt: 0 });
      });
    }
  }
  private selectLocal(binding: NodeBinding, attemptId: string, prepared: PreparedLocalExecution, result: LocalExecutionResult): void {
    this.store.put<LocalExecutionBinding>("local_execution_binding", binding.id, binding.projectId,
      { id: binding.id, projectId: binding.projectId, attemptId, prepared });
    this.store.put("node_binding", binding.id, binding.projectId, { ...binding, outputs: { [result.port]: result.artifact.artifact } });
  }
  private async verifyLocalResult(intent: LocalExecutionIntent, result: LocalExecutionResult, signal: AbortSignal): Promise<void> {
    assertLocalExecutionResult(result, intent);
    const record = result.artifact, maxBytes = intent.prepared.kind === "timeline" ? 1024 * 1024 : this.requireLocalPort().maxOutputBytes;
    const root = realpathSync(this.artifactDir), path = realpathSync(record.path), rel = relative(root, path);
    invariant(isAbsolute(record.path) && rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "LOCAL_EXECUTION_CONFLICT", "Local output is outside managed artifacts");
    const handle = await open(record.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      invariant(stat.isFile() && stat.size === record.byteLength && stat.size > 0 && stat.size <= maxBytes, "LOCAL_EXECUTION_CONFLICT", "Local output size differs");
      const sha = createHash("sha256"), bytes = Buffer.alloc(1024 * 1024); let size = 0;
      for (;;) {
        invariant(!signal.aborted, "LOCAL_EXECUTION_CANCELLED", "Local verification cancelled");
        const read = await handle.read(bytes, 0, bytes.length, null); if (!read.bytesRead) break;
        size += read.bytesRead; invariant(size <= stat.size, "LOCAL_EXECUTION_CONFLICT", "Local output grew while verifying"); sha.update(bytes.subarray(0, read.bytesRead));
      }
      invariant(size === stat.size && sha.digest("hex") === record.artifact.sha256, "LOCAL_EXECUTION_CONFLICT", "Local output bytes changed");
    } finally { await handle.close(); }
    invariant(!signal.aborted, "LOCAL_EXECUTION_CANCELLED", "Local verification cancelled");
  }

  private projects(): ProjectRecord[] { return (this.store.db.prepare("SELECT id FROM projects").all() as { id: string }[]).map(row => this.store.getProject(row.id)); }
  private lockedProfiles(project: ProjectRecord): ProviderProfile[] {
    const lock = this.store.get<{ projectId: string; profiles: unknown }>("capability_lock", project.capabilityLockId);
    if (!lock) return this.profiles; // Isolated executor fixtures predate the application lock service.
    invariant(lock.projectId === project.id && Array.isArray(lock.profiles) && lock.profiles.length > 0, "CAPABILITY_LOCK_UNSUPPORTED", "Invalid pinned provider catalog");
    const ids = new Set<string>();
    for (const value of lock.profiles) {
      invariant(value && typeof value === "object", "CAPABILITY_LOCK_UNSUPPORTED", "Invalid pinned profile");
      const profile = value as ProviderProfile;
      invariant(typeof profile.id === "string" && profile.id.length > 0 && !ids.has(profile.id), "CAPABILITY_LOCK_UNSUPPORTED", "Pinned profile identities must be unique");
      ids.add(profile.id);
      profileExecutionIdentity(profile);
      invariant(Number.isSafeInteger(profile.maxConcurrency) && profile.maxConcurrency > 0 && profile.maxConcurrency <= 64 && Number.isSafeInteger(profile.maxRetries) && profile.maxRetries >= 0 && profile.maxRetries <= 3, "CAPABILITY_LOCK_UNSUPPORTED", "Unsupported pinned concurrency or retry limits");
      invariant(typeof profile.unitCostMicros === "string", "CAPABILITY_LOCK_UNSUPPORTED", "Pinned price must use decimal micros");
      moneyMicros(profile.unitCostMicros);
      for (const limit of [profile.minFrames, profile.maxFrames]) invariant(limit === undefined || (Number.isSafeInteger(limit) && limit > 0), "CAPABILITY_LOCK_UNSUPPORTED", "Invalid pinned duration limits");
    }
    return lock.profiles as ProviderProfile[];
  }
  private reuseLocal(observed: NodeBinding, fingerprint: string): boolean {
    if (GENERATED.has(observed.node.kind)) return false;
    const workKey = digest({ projectId: observed.projectId, nodeId: observed.id, fingerprint });
    const previous = this.attempts(observed.projectId).find(attempt => attempt.candidateId === null && attempt.workKey === workKey && attempt.phase === "succeeded");
    if (!previous || Object.keys(previous.outputs).length === 0) return false;
    for (const artifact of Object.values(previous.outputs)) this.resolveSource(observed.projectId, { kind: "artifact", artifact }, true);
    return this.store.transaction(() => {
      const project = this.store.getProject(observed.projectId); const binding = this.currentBinding(observed.projectId, observed.id);
      this.lockedProfiles(project);
      invariant(!this.held(project, binding.id), "EXECUTION_HELD", "Dispatch is paused or held");
      invariant(binding.candidateId === null && this.resolveInputs(project.id, binding.node).fingerprint === fingerprint, "REVISION_CONFLICT", "Local cache target changed during verification");
      this.store.put("node_binding", binding.id, project.id, { ...binding, outputs: previous.outputs });
      this.store.appendEvent(project.id, "execution.output_reused", { nodeId: binding.id, attemptId: previous.id }); return true;
    });
  }
  private activePlan(project: ProjectRecord): PlanRecord {
    const plan = project.activePlanId ? this.store.get<PlanRecord>("plan", project.activePlanId) : undefined;
    invariant(plan?.projectId === project.id, "PLAN_REQUIRED", "No current execution plan"); return plan;
  }
  private currentBinding(projectId: string, nodeId: string): NodeBinding {
    const binding = this.store.get<NodeBinding>("node_binding", nodeId); const project = this.store.getProject(projectId);
    invariant(binding?.projectId === projectId && binding.state === "active" && binding.planId === project.activePlanId, "STALE_BINDING", "Node no longer belongs to the active plan"); return binding;
  }
  private resolveSource(projectId: string, source: InputSource, verifyBytes = false): ArtifactRef {
    const binding = source.kind === "output" ? this.currentBinding(projectId, source.nodeId) : null;
    invariant(!binding || !Object.hasOwn(binding.node.args, "localExecution") || this.localBindingCurrent(binding),
      "LOCAL_EXECUTION_STALE", "Local assembly output no longer matches the current captured work");
    const artifact = source.kind === "artifact" ? source.artifact : binding!.outputs[source.port];
    invariant(artifact, "INPUT_PENDING", "An input has not completed");
    const record = this.store.get<ArtifactRecord>("artifact", artifact.artifactId);
    invariant(record?.projectId === projectId && record.artifact.sha256 === artifact.sha256, "ARTIFACT_UNAVAILABLE", "Input is not a usable project artifact");
    if (verifyBytes) {
      let bytes: Buffer;
      try { bytes = readFileSync(record.path); } catch { throw new DomainError("ARTIFACT_UNAVAILABLE", "Input file is unavailable"); }
      const hash = createHash("sha256").update(bytes).digest("hex");
      invariant(hash === artifact.sha256, "ARTIFACT_CORRUPT", "Input bytes do not match their immutable digest");
    }
    return artifact;
  }
  private resolveInputs(projectId: string, node: PlanNode, verifyBytes = false): ResolvedInputs {
    const artifacts = node.inputs.map(input => this.resolveSource(projectId, input.source, verifyBytes));
    const fingerprint = effectiveNodeDigest(node, node.inputs.map((input, index) => ({ destinationPort: input.destinationPort, role: input.role, order: input.order, sha256: artifacts[index]!.sha256 })));
    return { artifacts, fingerprint };
  }
  private checkIntent(project: ProjectRecord, node: PlanNode): void {
    if (node.kind !== "image" && node.kind !== "video") return;
    if (node.shotId === null) return;
    const shot = project.shots.find(item => item.id === node.shotId);
    invariant(shot, "STALE_PROMPT_INTENT", "Shot no longer exists");
    const cue = shot.cueId ? project.cues.find(item => item.id === shot.cueId) : undefined;
    invariant(!shot.cueId || cue, "TIMING_REQUIRED", "Shot cue is missing");
    const intent = shotIntentDigest(shot, node.kind, cue);
    invariant(node.intentDigest === intent && shot.promptIntent[node.kind] === intent, "STALE_PROMPT_INTENT", "Prompt no longer covers the current shot intent");
    invariant(node.args.prompt === (node.kind === "image" ? shot.imagePrompt : shot.videoPrompt), "STALE_PROMPT_INTENT", "Prompt no longer matches the current shot");
  }
  private held(project: ProjectRecord, nodeId: string): boolean {
    if (this.store.get<{ paused: boolean }>("execution_control", project.id)?.paused) return true;
    const holds = this.store.list<Hold>("hold", project.id).filter(hold => hold.active);
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visited.has(id)) return false; visited.add(id);
      const binding = this.store.get<NodeBinding>("node_binding", id); if (!binding) return false;
      const sceneId = project.shots.find(shot => shot.id === binding.node.shotId)?.sceneId;
      if (holds.some(hold => [project.id, binding.node.shotId, sceneId].includes(hold.scopeId))) return true;
      return binding.node.inputs.some(input => input.source.kind === "output" && visit(input.source.nodeId));
    };
    return visit(nodeId);
  }

  private admit(projectId: string, nodeId: string, preparedFingerprint: string): Attempt {
    return this.store.transaction(() => {
      this.recovery.assertWritable(projectId);
      const project = this.store.getProject(projectId); const binding = this.currentBinding(projectId, nodeId); const node = binding.node;
      invariant(Object.keys(binding.outputs).length === 0, "ALREADY_COMPLETE", "Current output is already usable");
      invariant(!this.held(project, nodeId), "EXECUTION_HELD", "Dispatch is paused or held");
      this.checkIntent(project, node);
      const inputs = this.resolveInputs(projectId, node);
      invariant(inputs.fingerprint === preparedFingerprint, "REVISION_CONFLICT", "Inputs changed during execution preparation");
      const profiles = this.lockedProfiles(project);
      const profile = node.profileId ? profiles.find(item => item.id === node.profileId) : undefined;
      let provider: ExecutionProvider;
      if (GENERATED.has(node.kind)) {
        invariant(profile?.kind === node.kind && node.args.profileRevision === profile.revision && node.args.profileIdentity === profile.id,
          "PROFILE_INCOMPATIBLE", "Only the exact pinned profile may run");
        const expected = providerProfileArguments(profile);
        invariant(Object.entries(expected).every(([key, value]) => Object.hasOwn(node.args, key) && canonical(node.args[key]) === canonical(value)), "PROFILE_INCOMPATIBLE", "Node does not contain its exact pinned profile configuration");
        provider = this.registry.forProfile(profile);
      } else provider = this.registry.resolve({ adapter: "fake", version: "1" });
      const execution = executionIdentity(provider);
      if (node.kind === "video") {
        const shot = project.shots.find(item => item.id === node.shotId);
        const cue = shot?.cueId ? project.cues.find(item => item.id === shot.cueId) : undefined;
        const applicationLock = this.store.get<{ recipeDigest?: string }>("capability_lock", project.capabilityLockId);
        if (applicationLock?.recipeDigest) {
          invariant(shot && cue, "TIMING_REQUIRED", "Narrated production requires a current shot cue before video dispatch");
          invariant(cue.durationFrames === shot.desiredFrames && shot.desiredFrames === node.args.durationFrames, "TIMING_REQUIRED", "Measured cue, shot, and video durations must match before dispatch");
        }
        if (cue) invariant(cue.accepted && cue.measured, "TIMING_REQUIRED", "Video requires accepted measured cue timing");
        const plan = this.activePlan(project);
        invariant(node.requires.length > 0 && node.requires.every(id => plan.compiled.gates.some(gate => gate.id === id && gate.members.some(member => member.videoNodeId === nodeId && member.recipeDigest === node.specDigest))), "HUMAN_REVIEW_REQUIRED", "Video lacks a current review contract");
        invariant(this.store.list<Approval>("approval", projectId).some(approval => approval.videoNodeId === nodeId && approval.approvalDigest === inputs.fingerprint), "HUMAN_REVIEW_REQUIRED", "Exact current keyframe approval is required");
      }
      if (binding.candidateId) {
        const candidate = this.store.get<Candidate>("candidate", binding.candidateId); const grant = candidate ? this.store.get<Grant>("grant", candidate.grantId) : undefined;
        invariant(candidate?.projectId === projectId && candidate.nodeId === nodeId && grant?.projectId === projectId && grant.kind === node.kind, "ORIGIN_NOT_AUTHORIZED", "Candidate lacks its immutable grant");
        this.recovery.assertFreshAuthority(projectId, "candidate", candidate.id);
        this.recovery.assertFreshAuthority(projectId, "grant", grant.id);
      } else invariant(!GENERATED.has(node.kind), "ORIGIN_NOT_AUTHORIZED", "Generation requires a candidate");
      const workKey = binding.candidateId ? null : digest({ projectId, nodeId, fingerprint: inputs.fingerprint });
      const previous = this.attempts(projectId).filter(attempt => binding.candidateId ? attempt.candidateId === binding.candidateId : attempt.workKey === workKey).sort((a, b) => b.ordinal - a.ordinal)[0];
      if (previous) {
        invariant(previous.phase === "failed", "ATTEMPT_EXISTS", "Existing work must be reconciled, never resubmitted");
        invariant(binding.candidateId && previous.failure?.technical && previous.failure.retryAllowed && previous.ordinal <= (profile?.maxRetries ?? 0), "RETRY_NOT_AUTHORIZED", "No trusted technical retry allowance");
        invariant(previous.fingerprint === inputs.fingerprint, "NEW_CANDIDATE_REQUIRED", "A technical retry cannot change its creative inputs");
      }
      if (profile) {
        const active = this.projects().flatMap(item => this.attempts(item.id)).filter(attempt => !TERMINAL.has(attempt.phase)
          && attempt.request.args.profileIdentity === profile.id && attempt.request.args.profileRevision === profile.revision
          && canonical(requestExecutionIdentity(attempt.request)) === canonical(execution)).length;
        invariant(active < profile.maxConcurrency, "CAPACITY_EXCEEDED", "Configured provider capacity is occupied");
      }
      const cost = profile ? moneyMicros(profile.unitCostMicros) : 0n; const budget = this.budget(projectId);
      invariant(moneyMicros(budget.committedMicros) + cost <= moneyMicros(budget.capMicros), "BUDGET_EXCEEDED", "Dispatch exceeds the configured spending cap");
      const id = newId(); const reservationId = profile ? newId() : null;
      let externalAllowanceId: string | undefined;
      if (!isLegacyExecution(execution)) {
        invariant(this.externalAdmission && profile && binding.candidateId, "EXTERNAL_EXECUTION_NOT_AUTHORIZED", "External generation requires explicit application spending permission");
        const approval = this.externalAdmission.authorize({ attemptId: id, projectId, nodeId, candidateId: binding.candidateId,
          profile: structuredClone(profile), estimatedMicros: cost.toString() });
        invariant(approval && Object.keys(approval).length === 1 && typeof approval.allowanceId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(approval.allowanceId),
          "EXTERNAL_EXECUTION_NOT_AUTHORIZED", "External admission must return an explicit durable allowance identity");
        externalAllowanceId = approval.allowanceId;
      }
      const pinnedProfile = profile ? executionProfileSnapshot(profile) : undefined;
      const attempt: Attempt = {
        id, projectId, nodeId, candidateId: binding.candidateId, ordinal: (previous?.ordinal ?? 0) + 1,
        specDigest: node.specDigest, fingerprint: inputs.fingerprint, workKey,
        request: { attemptId: id, nodeId, kind: node.kind, fingerprint: inputs.fingerprint, args: node.args, inputs: inputs.artifacts,
          execution: { ...execution }, ...(pinnedProfile ? { profile: pinnedProfile } : {}), ...(externalAllowanceId ? { externalAllowanceId } : {}) },
        phase: "submitting", leaseOwner: this.workerId, leaseEpoch: 1, leaseExpiresAt: Date.now() + this.leaseMs,
        taskId: null, reservationId, failure: null, outputs: {}, createdAt: new Date().toISOString(),
      };
      this.store.insert("attempt", id, projectId, attempt);
      if (reservationId) this.store.insert("reservation", reservationId, projectId, { attemptId: id, micros: cost.toString(), state: "reserved" });
      if (externalAllowanceId && this.externalAdmission?.recordAdmission) {
        const recorded = this.externalAdmission.recordAdmission(structuredClone(attempt)) as unknown;
        invariant(!(recorded && typeof (recorded as { then?: unknown }).then === "function"), "ASYNC_TRANSACTION", "Admission recording cannot return a promise");
      }
      this.store.appendEvent(projectId, "attempt.state_changed", { attemptId: id, phase: "submitting", nodeId }); return attempt;
    });
  }

  private claim(observed: Attempt): Attempt | null {
    return this.store.transaction(() => {
      const attempt = this.store.get<Attempt>("attempt", observed.id)!;
      if (TERMINAL.has(attempt.phase) || attempt.leaseExpiresAt > Date.now()) return null;
      const updated: Attempt = { ...attempt, phase: attempt.phase === "submitting" ? "submission_unknown" : attempt.phase, leaseOwner: this.workerId, leaseEpoch: attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + this.leaseMs };
      this.store.put("attempt", updated.id, updated.projectId, updated); return updated;
    });
  }
  private owns(attempt: Attempt): Attempt | null {
    const current = this.store.get<Attempt>("attempt", attempt.id);
    return current && !TERMINAL.has(current.phase) && current.leaseOwner === this.workerId && current.leaseEpoch === attempt.leaseEpoch && current.leaseExpiresAt > Date.now() ? current : null;
  }
  private completionBound(attempt: Attempt, outcome: ExecutionOutcome): boolean {
    if (!isSpoolCompletion(outcome)) return true;
    try { this.outputStore?.assertCompletion(attempt.projectId, attempt.id, outcome); return this.outputStore !== undefined; }
    catch { return false; }
  }
  private async handle(attempt: Attempt, observation: ExecutionOutcome): Promise<void> {
    const provider = this.registry.forRequest(attempt.request);
    const observed = normalizeExecutionOutcome(observation, attempt.request);
    let outcome = observed;
    // A receipt from another request cannot lend its vendor identity to this attempt.
    if (!this.completionBound(attempt, observed)) outcome = { type: "unknown", diagnostic: "Completion has no matching owned output receipt" };
    const owns = this.store.transaction(() => {
      const outcomeDigest = digest(observed);
      if (!this.store.list<Evidence>("execution_evidence", attempt.projectId).some(item => item.attemptId === attempt.id && item.outcomeDigest === outcomeDigest))
        this.store.insert("execution_evidence", newId(), attempt.projectId, { attemptId: attempt.id, outcome: observed, outcomeDigest, recordedAt: new Date().toISOString() });
      const current = this.owns(attempt); if (!current) return false;
      // A provider receipt cannot replace an already accepted task identity, including during recovery.
      if (current.taskId && ((("taskId" in outcome || isSpoolCompletion(outcome)) && executionTaskId(outcome) !== current.taskId) || outcome.type === "rejected"))
        outcome = { type: "unknown", diagnostic: "Provider observation conflicts with accepted task identity" };
      if (outcome.type === "completed") {
        this.store.put("attempt", current.id, current.projectId, { ...current, phase: "ingesting", taskId: executionTaskId(outcome) }); return true;
      }
      const phase: AttemptPhase = outcome.type === "accepted" ? "remote_pending" : outcome.type === "unknown" ? "submission_unknown" : "failed";
      const failure = outcome.type === "failed" || outcome.type === "rejected"
        ? { id: outcome.failureId, technical: outcome.technical, source: executionFailureSource(provider),
          retryAllowed: outcome.technical === true && outcome.retryAllowed === true } : null;
      const taskId = outcome.type === "accepted" || outcome.type === "failed" || outcome.type === "unknown" ? outcome.taskId ?? current.taskId : current.taskId;
      this.store.put("attempt", current.id, current.projectId, { ...current, phase, taskId, failure, leaseExpiresAt: 0 });
      if (outcome.type === "rejected") this.setReservation(current, "released");
      if (outcome.type === "failed") this.setReservation(current, "charged");
      this.store.appendEvent(current.projectId, "attempt.state_changed", { attemptId: current.id, phase }); return false;
    });
    if (!owns || outcome.type !== "completed") return;
    const completed = outcome;
    // File creation, hashing, flushes and directory publication occur outside SQLite transactions.
    let outputs: IngestedOutput[] | null;
    try { outputs = await this.ingestOutputs(attempt, completed.outputs); }
    catch (error) {
      if (!(error instanceof DomainError && error.code === "MEDIA_BUSY" && isSpoolCompletion(completed)
        && completed.outputs.length === 1 && completed.outputs[0]?.kind === "video" && completed.outputs[0].port === "video")) throw error;
      // A trusted local normalizer is occupied. Keep the durable completion and
      // liability, but let the next cycle recover it without a vendor call.
      this.store.transaction(() => {
        const current = this.owns(attempt); if (!current || current.phase !== "ingesting") return;
        this.store.put("attempt", current.id, current.projectId, { ...current, leaseExpiresAt: 0 });
        this.store.appendEvent(current.projectId, "attempt.ingestion_deferred", { attemptId: current.id, reason: "local_media_busy" });
      });
      return;
    }
    if (!outputs) return;
    this.store.transaction(() => {
      const current = this.owns(attempt); if (!current) return;
      if (isSpoolCompletion(completed)) this.outputStore!.assertCompletion(current.projectId, current.id, completed);
      const mapped: Record<string, ArtifactRef> = {};
      for (const { output, record, normalized } of outputs) {
        if (normalized) this.validateDerived(current, output, normalized);
        this.store.insert("artifact", record.id, attempt.projectId, record); mapped[output.port] = record.artifact;
        if (normalized) {
          this.store.insert("video_derivation_receipt", normalized.derivation.id, attempt.projectId, normalized.derivation);
          this.store.insert("media_source", record.id, attempt.projectId, normalized.mediaSource);
        }
        this.store.appendEvent(attempt.projectId, "artifact.published", { artifactId: record.id, attemptId: attempt.id, fixture: record.fixture });
      }
      const finished: Attempt = { ...current, phase: "succeeded", outputs: mapped, taskId: executionTaskId(completed), leaseExpiresAt: 0 };
      this.store.put("attempt", current.id, current.projectId, finished); this.setReservation(current, "charged");
      const binding = this.store.get<NodeBinding>("node_binding", current.nodeId);
      if (binding && binding.projectId === current.projectId && binding.state === "active" && binding.candidateId === current.candidateId) {
        const project = this.store.getProject(current.projectId);
        if (binding.planId === project.activePlanId) {
          try {
            this.checkIntent(project, binding.node);
            if (this.resolveInputs(current.projectId, binding.node).fingerprint === current.fingerprint)
              this.store.put("node_binding", binding.id, binding.projectId, { ...binding, outputs: mapped });
          } catch (error) { if (!(error instanceof DomainError)) throw error; }
        }
      }
      this.store.appendEvent(current.projectId, "attempt.state_changed", { attemptId: current.id, phase: "succeeded" });
    });
  }
  private setReservation(attempt: Attempt, state: Reservation["state"]): void {
    if (!attempt.reservationId) return;
    const reservation = this.store.get<Reservation>("reservation", attempt.reservationId)!;
    this.store.put("reservation", reservation.id, reservation.projectId, { ...reservation, state });
  }

  /** Keep paid effects owned during slow I/O; cancellation never discards a late vendor receipt. */
  private async observeProvider(attempt: Attempt, operation: (options: ExecutionCallOptions) => Promise<ExecutionOutcome>, diagnostic: string): Promise<ExecutionOutcome | null> {
    const controller = new AbortController();
    const renew = () => {
      if (controller.signal.aborted) return;
      try {
        this.store.transaction(() => {
          const current = this.owns(attempt);
          if (!current) { controller.abort(); return; }
          this.store.put("attempt", current.id, current.projectId, { ...current, leaseExpiresAt: Date.now() + this.leaseMs });
        });
      } catch { controller.abort(); }
    };
    renew(); if (controller.signal.aborted) return null;
    const timer = setInterval(renew, Math.max(1, Math.floor(this.leaseMs / 3))); timer.unref();
    const deadline = setTimeout(() => controller.abort(), this.providerTimeoutMs);
    try {
      // Registered adapters must settle after cancellation. Await their actual
      // observation so an accepted task arriving after lease loss remains evidence.
      try { return await operation(Object.freeze({ signal: controller.signal,
        expectedLease: Object.freeze({ owner: attempt.leaseOwner, epoch: attempt.leaseEpoch }) })); }
      catch { return { type: "unknown", diagnostic }; }
    } finally { clearInterval(timer); clearTimeout(deadline); controller.abort(); }
  }

  private async withLease<T>(attempt: Attempt, operation: (signal: AbortSignal) => Promise<T>, pauseAware = false): Promise<T | null> {
    const controller = new AbortController();
    const renew = (): void => {
      try {
        this.store.transaction(() => {
          const current = this.owns(attempt);
          if (!current) { controller.abort(); return; }
          if (pauseAware && this.held(this.store.getProject(attempt.projectId), attempt.nodeId)) { controller.abort(); return; }
          this.store.put("attempt", current.id, current.projectId, { ...current, leaseExpiresAt: Date.now() + this.leaseMs });
        });
      } catch { controller.abort(); }
    };
    renew();
    const timer = setInterval(renew, Math.max(1, Math.floor(this.leaseMs / 3))); timer.unref();
    try {
      if (controller.signal.aborted) return null;
      const result = await operation(controller.signal);
      return controller.signal.aborted ? null : result;
    } finally { clearInterval(timer); controller.abort(); }
  }

  private async ingestOutputs(attempt: Attempt, descriptors: IngestibleExecutionOutput[]): Promise<IngestedOutput[] | null> {
    return this.withLease(attempt, async signal => {
      const outputs: IngestedOutput[] = [];
      for (const output of descriptors) {
        if (signal.aborted) return [];
        const received = this.outputIngestor ? await this.outputIngestor.ingest({ attempt: structuredClone(attempt),
          output: structuredClone(output), artifactDir: this.artifactDir, signal }) : materializeFixtureOutput({ attempt, output, artifactDir: this.artifactDir, signal });
        if (signal.aborted) return [];
        const snapshot = structuredClone(received);
        const normalized = "type" in snapshot && snapshot.type === "normalized_video" ? snapshot : undefined;
        const record = normalized ? normalized.artifact : snapshot as ArtifactRecord;
        await this.validateIngested(attempt, output, record, signal, normalized);
        outputs.push({ output, record, ...(normalized ? { normalized } : {}) });
      }
      return outputs;
    });
  }

  private validateDerived(attempt: Attempt, output: IngestibleExecutionOutput, result: NormalizedVideoIngestion): VideoDerivationIntent {
    const intent = this.store.get<VideoDerivationIntent>("video_derivation_intent", result.derivation?.id);
    invariant(intent, "VIDEO_DERIVATION_CONFLICT", "Generated video requires its durable pre-transcode intent");
    assertNormalizedVideoIngestion(intent, attempt, output, result); return intent;
  }

  private async validateIngested(attempt: Attempt, output: IngestibleExecutionOutput, record: ArtifactRecord, signal: AbortSignal, normalized?: NormalizedVideoIngestion): Promise<void> {
    const derivation = normalized ? this.validateDerived(attempt, output, normalized) : undefined;
    const expectedSha = normalized ? normalized.derivation.source.sha256 : output.sha256;
    const expectedSize = normalized ? normalized.derivation.source.byteLength : isSpoolOutput(output) ? output.byteLength : undefined;
    const maxBytes = derivation ? derivation.normalization.maxOutputBytes : isSpoolOutput(output) ? EXECUTION_SPOOL_LIMITS[output.kind] : MAX_EXECUTION_OUTPUT_BYTES;
    invariant(typeof record?.id === "string" && record.id.length > 0 && record.projectId === attempt.projectId && record.attemptId === attempt.id
      && record.artifact?.artifactId === record.id && record.artifact.sha256 === expectedSha && record.artifact.kind === output.kind
      && record.mimeType === output.mimeType && record.fixture === output.fixture && typeof record.path === "string" && isAbsolute(record.path)
      && (record.physicalDurationSeconds === null || (Number.isFinite(record.physicalDurationSeconds) && record.physicalDurationSeconds > 0)),
    "INVALID_PROVIDER_OUTPUT", "Ingested artifact does not match the admitted output identity");
    if (isSpoolOutput(output)) invariant(record.outputReceiptId === output.storage.spoolId && record.outputSpoolId === output.storage.spoolId
      && record.byteLength === expectedSize, "INVALID_PROVIDER_OUTPUT", "Ingested artifact lost its exact spool or derivation provenance");
    const root = realpathSync(this.artifactDir), path = realpathSync(record.path), rel = relative(root, path);
    invariant(rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
      "INVALID_PROVIDER_OUTPUT", "Ingested artifact is outside the owned artifact directory");
    const file = await open(record.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      invariant(stat.isFile() && stat.size > 0 && stat.size <= maxBytes && (expectedSize === undefined || stat.size === expectedSize),
        "INVALID_PROVIDER_OUTPUT", "Ingested artifact exceeds the execution byte limit");
      const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024); let size = 0;
      for (;;) {
        invariant(!signal.aborted, "OUTPUT_STORE_CANCELLED", "Artifact verification cancelled");
        const read = await file.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break;
        size += read.bytesRead; invariant(size <= stat.size && size <= maxBytes, "ARTIFACT_CORRUPT", "Ingested artifact grew during verification");
        hash.update(buffer.subarray(0, read.bytesRead));
      }
      invariant(size === stat.size && hash.digest("hex") === expectedSha,
        "ARTIFACT_CORRUPT", "Ingested artifact bytes differ from the completion receipt");
    } finally { await file.close(); }
    invariant(!signal.aborted, "OUTPUT_STORE_CANCELLED", "Artifact verification cancelled");
  }
}
