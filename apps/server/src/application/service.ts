import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  applyCreativePatch, compilePlanIsolated, DEFAULT_PROFILES, digest, diffPlans, invariant, newId,
  parseChangeProposal, RECIPE_DIGEST, requiredStages, shotIntentDigest, snapshotLocalExecution, stageInputDigest,
  validateStageRequirements, validateStageScope, workflowReadiness,
  STAGE_CONTRACTS, STAGE_CONTRACTS_DIGEST, TOOL_NAMES,
} from "@openslate/core";
import type {
  ActorContext, ArtifactRef, ChangeProposal, CompiledPlan, NodeImpact, OperationKind, ProjectRecord,
  LocalExecutionIdentity, ProviderProfile, ShotRecord, StageRequirement,
} from "@openslate/core";
import { Store } from "../persistence/store.js";
import { Engine } from "../execution/engine.js";
import type { ArtifactRecord, NodeBinding } from "../execution/engine.js";
import { projectDirectorContext } from "./context-projection.js";
import type { DirectorContextQuery } from "./context-projection.js";
import { selectedProviderProfiles } from "./provider-catalog.js";
import type { InstalledProviderSelection } from "./provider-catalog.js";
import { ownedTranscriptionCatalog, snapshotOwnedTranscriptionData } from "../narration/owned-transcription-records.js";
import { captureOwnedTranscriptionReviewInput, currentOwnedTranscriptionReview, ownedTranscriptionReviewScope } from "../narration/owned-transcription-review-state.js";
import type { OwnedTranscriptionApplication, OwnedTranscriptionApplyReceipt, OwnedTranscriptionReview, ReviewOwnedTranscription } from "../narration/owned-transcription-types.js";

interface RequestRecord { id: string; projectId: string; principalId: string; text: string; scopeIds: string[]; editing: boolean; state: "active" | "superseded"; contextDigest: string | null }
interface Epoch { id: string; projectId: string; requestId: string; principalId: string; tokenHash: string; state: "active" | "read_only" | "revoked"; scopeIds: string[] }
interface PlanRecord { id: string; projectId: string; compiled: CompiledPlan }
interface Grant { id: string; scopeId: string; kind: OperationKind; authorityId: string; origin: "initial_slot" | "user_change" }
interface Candidate { grantId: string }
interface Hold { id: string; scopeId: string; ownerId: string; active?: boolean; state?: string }
interface StageBinding extends StageRequirement { id: string; projectId: string; bindingVersion: number; progressVersion: number; inputDigest: string; outputDigest: string; contractDigest: string }
interface Prepared {
  id: string; projectId: string; requestId: string; principalId: string; epochId: string | null;
  proposal: ChangeProposal; proposalDigest: string; baseVersion: number; next: ProjectRecord;
  compiled: CompiledPlan | null; logicalIds: Record<string, string>; impact: NodeImpact[];
  stages: StageRequirement[]; stageVersions: Record<string, number>; grantBindings: Record<string, string>;
  semanticChange: boolean;
  capabilityDigest: string;
}

export interface ApplyReceipt { preparedId: string; projectId: string; revisionId: string; headVersion: number; activePlanId: string | null; cursor: number }
export interface ProductionServiceOptions {
  /** Trusted installation choice for new projects only. Existing locks never inherit this default. */
  newProjectLocalExecution?: LocalExecutionIdentity;
  /** Limit the new-project pin to the resolved trusted profile selection. Omission means all. */
  newProjectLocalExecutionFor?: "all" | "external-video";
}
interface ProjectCapabilityLock {
  projectId: string; profiles: ProviderProfile[]; recipeDigest: string; stageContractsDigest: string;
  localExecution?: LocalExecutionIdentity;
}
interface PreparedChangeCapture {
  before: ProjectRecord; next: ProjectRecord; lock: ProjectCapabilityLock;
  proposal: ChangeProposal; proposalDigest: string; compiled: CompiledPlan | null;
  logicalIds: Record<string, string>;
}
interface CompiledChangeAssessment {
  impact: NodeImpact[]; stages: StageRequirement[]; extraTakeIds: Set<string>;
}
export { TOOL_NAMES } from "@openslate/core";

/** The trusted application boundary. Models propose data; these methods own authority and commits. */
export class ProductionService {
  get recovery() { return this.engine.recovery; }
  private readonly newProjectLocalExecution: Readonly<LocalExecutionIdentity> | undefined;
  private readonly newProjectLocalExecutionFor: "all" | "external-video";
  constructor(readonly store: Store, readonly engine: Engine, readonly profiles: ProviderProfile[] = DEFAULT_PROFILES,
    options: ProductionServiceOptions = {}) {
    const selected = options.newProjectLocalExecution;
    this.newProjectLocalExecution = selected === undefined ? undefined : snapshotLocalExecution(selected);
    const scope = options.newProjectLocalExecutionFor === undefined ? "all" : options.newProjectLocalExecutionFor;
    invariant(scope === "all" || scope === "external-video", "LOCAL_EXECUTION_UNSUPPORTED", "Unsupported new-project local execution scope");
    invariant(scope !== "external-video" || this.newProjectLocalExecution, "LOCAL_EXECUTION_UNSUPPORTED", "External-video scope requires an exact local execution identity");
    this.newProjectLocalExecutionFor = scope;
  }

  createProject(name: string, selection?: InstalledProviderSelection): ProjectRecord {
    this.recovery.assertWritable();
    invariant(typeof name === "string" && name.trim().length > 0 && name.length <= 160, "VALIDATION_ERROR", "Provide a short project name");
    const selected = selection === undefined ? undefined : selectedProviderProfiles(selection);
    const profiles = selected?.profiles ?? this.profiles;
    const pinLocalExecution = this.newProjectLocalExecution && (this.newProjectLocalExecutionFor === "all"
      || profiles.some(profile => profile.kind === "video" && profile.adapter !== "fake"));
    return this.store.transaction(() => {
      const project: ProjectRecord = {
        id: newId(), revisionId: newId(), headVersion: 0, name, brief: "", story: "", scenes: [],
        narration: { script: "", source: "undecided" }, maxFrames: 10800, capabilityLockId: newId(),
        shots: [], cues: [], artifacts: [], activePlanId: null,
      };
      this.store.createProject(project);
      this.store.insert("capability_lock", project.capabilityLockId, project.id, { profiles,
        recipeDigest: RECIPE_DIGEST, stageContractsDigest: STAGE_CONTRACTS_DIGEST, tools: TOOL_NAMES,
        ...(selected ? { providerSelection: selected.provenance } : {}),
        ...(pinLocalExecution ? { localExecution: this.newProjectLocalExecution } : {}) });
      this.store.insert("project_revision", project.revisionId, project.id, { project });
      this.store.appendEvent(project.id, "project.created", { revisionId: project.revisionId });
      return project;
    });
  }

  /** Invoked from an authenticated human channel, never from model arguments. */
  beginRequest(projectId: string, principalId: string, text: string, options: { scopeIds?: string[]; editing?: boolean; key?: string; continuationRequestId?: string; resumeFromStopId?: string; contextDigest?: string } = {}): ActorContext {
    this.recovery.assertWritable(projectId);
    invariant(text.trim().length > 0 && text.length <= 16000, "VALIDATION_ERROR", "Message must contain at most 16000 characters");
    const key = options.key ?? newId();
    const actor = this.store.command<ActorContext>(`${principalId}:${projectId}:message`, key, digest({ text, scopeIds: options.scopeIds ?? [projectId], editing: options.editing ?? true, continuationRequestId: options.continuationRequestId ?? null, contextDigest: options.contextDigest ?? null, ...(options.resumeFromStopId ? { resumeFromStopId: options.resumeFromStopId } : {}) }), () => {
      const project = this.store.getProject(projectId);
      if (options.resumeFromStopId) {
        const control = this.store.get<{ paused: boolean; authorityId: string }>("execution_control", projectId);
        const stopped = this.store.get<RequestRecord>("message", options.resumeFromStopId);
        const recovery = this.recovery.snapshot();
        const releasedRestore = recovery.state === "released" && recovery.receipt?.restoreId === options.resumeFromStopId && recovery.receipt.projectIds.includes(projectId);
        invariant(control?.paused && control.authorityId === options.resumeFromStopId && (releasedRestore || stopped?.projectId === projectId && stopped.principalId === principalId),
          "STOP_CHANGED", "The stop state changed. Refresh before sending a new direction.");
        invariant(options.editing !== false && (!options.scopeIds || options.scopeIds.includes(projectId)), "SCOPE_DENIED", "Continue stopped work with a project-wide edit");
      }
      const scopeIds = [...new Set(options.scopeIds ?? [projectId])];
      invariant(scopeIds.length > 0 && scopeIds.length <= 400, "VALIDATION_ERROR", "A request requires a bounded scope");
      scopeIds.forEach(scopeId => validateStageScope(project, scopeId));
      const request: RequestRecord = { id: newId(), projectId, principalId, text, scopeIds, editing: options.editing ?? true, state: "active", contextDigest: options.contextDigest ?? null };
      this.store.insert("message", request.id, projectId, request);
      if (options.editing !== false) {
        for (const prior of this.store.list<RequestRecord>("message", projectId)) if (prior.id !== request.id && prior.editing && prior.state === "active")
          this.store.put("message", prior.id, projectId, { ...prior, state: "superseded" });
        for (const epoch of this.store.list<Epoch>("epoch", projectId)) if (epoch.state !== "revoked")
          this.store.put("epoch", epoch.id, projectId, { ...epoch, state: "revoked" });
        for (const scopeId of scopeIds) this.engine.setHold(projectId, { scopeId, ownerId: request.id });
        if (options.continuationRequestId) {
          const prior = this.store.get<RequestRecord>("message", options.continuationRequestId);
          invariant(prior?.projectId === projectId && prior.principalId === principalId && prior.editing, "ACTOR_DENIED", "Continuation does not refer to an editable human request");
          for (const hold of this.store.list<Hold>("hold", projectId).filter(h => h.ownerId === prior.id && h.active)) {
            invariant(scopeIds.includes(projectId) || scopeIds.includes(hold.scopeId), "SCOPE_DENIED", "Continuation must cover the previous edit hold");
            this.engine.releaseHold(projectId, hold.id, prior.id);
          }
          this.store.insert("request_continuation", newId(), projectId, { fromRequestId: prior.id, toRequestId: request.id });
        }
      }
      if (options.resumeFromStopId) {
        // A fresh human follow-up takes ownership before execution can continue.
        // This runs only on first acceptance, never on an idempotent replay.
        const owners = new Set<string>();
        for (const hold of this.store.list<Hold>("hold", projectId).filter(h => h.active && h.ownerId !== request.id)) {
          const prior = this.store.get<RequestRecord>("message", hold.ownerId);
          if (prior?.principalId !== principalId || prior.projectId !== projectId) continue;
          this.engine.releaseHold(projectId, hold.id, prior.id); owners.add(prior.id);
        }
        for (const fromRequestId of owners) this.store.insert("request_continuation", newId(), projectId, { fromRequestId, toRequestId: request.id });
        for (const prior of this.store.list<RequestRecord>("message", projectId)) if (prior.id !== request.id && prior.state === "active")
          this.store.put("message", prior.id, projectId, { ...prior, state: "superseded" });
        this.engine.setPaused(projectId, false, request.id);
      }
      this.store.appendEvent(projectId, "message.recorded", { requestId: request.id, text, editing: options.editing ?? true });
      return { kind: "human", principalId, requestId: request.id };
    });
    this.recovery.assertFreshAuthority(projectId, "message", actor.requestId); return actor;
  }

  openEpoch(projectId: string, human: ActorContext): { actor: ActorContext; token: string } {
    this.recovery.assertWritable(projectId, human.requestId);
    this.assertActor(projectId, human);
    invariant(human.kind === "human", "ACTOR_DENIED", "Only the human request handler can open a director bridge");
    const request = this.request(projectId, human);
    invariant(request.state === "active", "ACTOR_DENIED", "This conversation request has been stopped or superseded");
    if (request.editing) this.assertActor(projectId, human, true);
    const token = randomBytes(32).toString("base64url");
    const epoch: Epoch = { id: newId(), projectId, requestId: human.requestId, principalId: human.principalId, tokenHash: digest(token), state: request.editing ? "active" : "read_only", scopeIds: request.scopeIds };
    this.store.insert("epoch", epoch.id, projectId, epoch);
    return { actor: { ...human, kind: "director", epochId: epoch.id }, token };
  }

  actorForBridge(projectId: string, token: string): ActorContext {
    const hash = Buffer.from(digest(token));
    const epoch = this.store.list<Epoch>("epoch", projectId).find(row => timingSafeEqual(Buffer.from(row.tokenHash), hash));
    invariant(epoch && epoch.state !== "revoked", "EPOCH_REVOKED", "Director bridge is absent or revoked");
    return { kind: "director", principalId: epoch.principalId, requestId: epoch.requestId, epochId: epoch.id };
  }

  private request(projectId: string, actor: ActorContext): RequestRecord {
    const request = this.store.get<RequestRecord>("message", actor.requestId);
    invariant(request && request.projectId === projectId && request.principalId === actor.principalId, "ACTOR_DENIED", "Request authority does not belong to this project");
    return request;
  }

  assertActor(projectId: string, actor: ActorContext, mutating = false): void {
    if (mutating) this.recovery.assertWritable(projectId, actor.requestId);
    const request = this.request(projectId, actor);
    if (actor.kind === "director") {
      const epoch = this.store.get<Epoch>("epoch", actor.epochId);
      invariant(epoch && epoch.state !== "revoked" && epoch.projectId === projectId && epoch.requestId === actor.requestId && epoch.principalId === actor.principalId,
        "EPOCH_REVOKED", "This director call belongs to an inactive request");
      if (mutating) invariant(epoch.state === "active", "ACTOR_DENIED", "This director epoch is read only");
    }
    if (mutating) invariant(request.editing && request.state === "active", "ACTOR_DENIED", "This request is read only or superseded");
  }

  private allows(project: ProjectRecord, actor: ActorContext, scopeId: string): boolean {
    const scopes = this.request(project.id, actor).scopeIds;
    return scopes.includes(project.id) || scopes.includes(scopeId) || project.shots.some(shot => shot.id === scopeId && scopes.includes(shot.sceneId));
  }

  private checkFootprint(before: ProjectRecord, next: ProjectRecord, actor: ActorContext, plan: CompiledPlan | null, impact: NodeImpact[]): void {
    const globalChanged = ["brief", "story", "narration"].some(key => digest(before[key as keyof ProjectRecord]) !== digest(next[key as keyof ProjectRecord]));
    if (globalChanged) invariant(this.allows(before, actor, before.id), "SCOPE_DENIED", "Project-wide changes require project scope");
    for (const scene of next.scenes) {
      const old = before.scenes.find(s => s.id === scene.id);
      if (digest(old ?? null) !== digest(scene)) invariant(this.allows(before, actor, old ? scene.id : before.id), "SCOPE_DENIED", "Scene change exceeds this request's scope");
    }
    for (const shot of next.shots) if (digest(before.shots.find(s => s.id === shot.id) ?? null) !== digest(shot))
      invariant(this.allows(next, actor, shot.id), "SCOPE_DENIED", "Shot change exceeds this request's scope");
    const oldPlan = before.activePlanId ? this.store.get<PlanRecord>("plan", before.activePlanId)?.compiled : null;
    for (const change of impact.filter(change => change.kind !== "reuse")) {
      const node = plan?.nodes.find(n => n.id === change.nodeId) ?? oldPlan?.nodes.find(n => n.id === change.nodeId);
      if (!node) continue;
      if (node.shotId) invariant(this.allows(next, actor, node.shotId), "SCOPE_DENIED", "Media change exceeds request scope");
      else if (!this.allows(next, actor, next.id)) {
        const previous = oldPlan?.nodes.find(n => n.id === node.id);
        // A shot edit may rebuild its existing assembly; it may not invent project-wide work.
        invariant(previous && ["timeline", "render"].includes(node.kind) && change.kind === "replace" && digest(previous.args) === digest(node.args) && digest(previous.inputs) === digest(node.inputs),
          "SCOPE_DENIED", "Global media changes require project scope");
      }
    }
  }

  authorize(projectId: string, human: ActorContext, slots: Array<{ scopeId: string; kind: OperationKind }>, key: string, origin: "initial_slot" | "user_change" = "user_change") {
    this.assertActor(projectId, human, true);
    invariant(human.kind === "human", "ACTOR_DENIED", "Creative generation requires human authorization");
    invariant(slots.length > 0 && slots.length <= 800, "VALIDATION_ERROR", "Authorize a bounded number of slots");
    return this.store.command(`${human.principalId}:${projectId}:grant`, key, digest({ slots, origin }), () => {
      this.assertActor(projectId, human, true);
      const project = this.store.getProject(projectId);
      for (const slot of slots) {
        validateStageScope(project, slot.scopeId);
        invariant(["image", "video", "speech", "transcription"].includes(slot.kind) && this.allows(project, human, slot.scopeId), "SCOPE_DENIED", "Invalid generation slot");
      }
      return slots.map(slot => this.engine.createGrant(projectId, slot.scopeId, slot.kind, human.requestId, origin));
    });
  }

  async prepare(projectId: string, actor: ActorContext, input: unknown): Promise<Prepared> {
    this.assertActor(projectId, actor, true);
    const proposal = parseChangeProposal(input);
    if (actor.kind === "director" && this.store.get("plan_import", actor.requestId)) {
      invariant(!proposal.source && !proposal.requestNewTakes?.length && !!proposal.creative, "IMPORT_REVIEW_REQUIRED", "Prepare only a creative interpretation of the supplied material. No executable plan or generation; the human confirms the exact draft in Film plan.");
    }
    invariant(!proposal.source || !proposal.creative?.createShots?.length, "VALIDATION_ERROR", "Create shot intents first, then reference their saved IDs in the executable plan");
    const proposalDigest = digest(proposal);
    const same = this.store.list<Prepared>("prepared", projectId).find(item => item.requestId === actor.requestId && item.epochId === (actor.kind === "director" ? actor.epochId : null) && item.proposalDigest === proposalDigest);
    if (same) return same;
    this.holdRequest(projectId, actor);
    const before = this.store.getProject(projectId);
    const lock = this.store.get<ProjectCapabilityLock>("capability_lock", before.capabilityLockId);
    invariant(lock?.projectId === projectId && lock.recipeDigest === RECIPE_DIGEST && lock.stageContractsDigest === STAGE_CONTRACTS_DIGEST, "CAPABILITY_MISMATCH", "Project workflow lock is unsupported");
    const localExecution = Object.hasOwn(lock, "localExecution") ? snapshotLocalExecution(lock.localExecution) : undefined;
    invariant(before.headVersion === proposal.expectedHeadVersion, "REVISION_CONFLICT", "Project changed before preparation");
    const next = proposal.creative ? applyCreativePatch(before, proposal.creative, (shot, cue) => ({ ...shot, promptIntent: { image: shotIntentDigest(shot, "image", cue), video: shotIntentDigest(shot, "video", cue) } })) : structuredClone(before);
    const logicalIds = { ...(this.store.get<{ aliases: Record<string, string> }>("logical_ids", projectId)?.aliases ?? {}) };
    const basePlan = before.activePlanId ? this.store.get<PlanRecord>("plan", before.activePlanId)?.compiled ?? null : null;
    const transcriptionInputs = ownedTranscriptionCatalog(this.store, projectId, basePlan);
    const compiled = proposal.source ? await compilePlanIsolated(proposal.source, { project: next, profiles: lock.profiles, logicalIds, allocateId: newId,
      ...(transcriptionInputs.length ? { transcriptionInputs } : {}),
      ...(localExecution ? { localExecution } : {}) }) : null;
    const captured: PreparedChangeCapture = { before, next, lock, proposal, proposalDigest, compiled, logicalIds };
    const assessment = this.assessCompiledChange(captured, actor);
    return this.store.transaction(() => this.finalizePreparedChange(projectId, actor, captured, assessment));
  }

  /** Shared post-compile validation. This assessment creates neither records nor generation authority. */
  private assessCompiledChange(captured: PreparedChangeCapture, actor: ActorContext): CompiledChangeAssessment {
    const { before, next, proposal, compiled } = captured;
    const oldPlan = before.activePlanId ? this.store.get<PlanRecord>("plan", before.activePlanId)?.compiled ?? null : null;
    const impact = compiled ? diffPlans(oldPlan, compiled) : [];
    // Settings deliberately leave changed pending work without a candidate. A subsequent
    // ordinary plan review must select a fresh grant even when the new spec is unchanged.
    for (const change of impact) if (change.kind === "reuse") {
      const binding = this.store.get<NodeBinding>("node_binding", change.nodeId);
      if (binding?.state === "active" && binding.planId === before.activePlanId && binding.candidateId === null
        && ["image", "video", "speech", "transcription"].includes(binding.node.kind)) {
        change.kind = "replace"; change.reason = "Pending work requires fresh generation approval";
      }
    }
    const extra = new Set(proposal.requestNewTakes ?? []);
    invariant(extra.size === (proposal.requestNewTakes?.length ?? 0), "VALIDATION_ERROR", "Duplicate extra take requests");
    for (const id of extra) {
      invariant(compiled?.nodes.some(n => n.id === id && n.kind === "video"), "VALIDATION_ERROR", "Extra take must name a video node in the current plan");
      const change = impact.find(item => item.nodeId === id)!;
      change.kind = "replace"; change.reason = "Human-authorized additional take";
    }
    this.checkFootprint(before, next, actor, compiled, impact);
    const stages = requiredStages(before, next, compiled);
    for (const proposed of proposal.stages ?? []) validateStageScope(next, proposed.scopeId);
    validateStageRequirements(next, stages);
    return { impact, stages, extraTakeIds: extra };
  }

  /** Synchronous finalization inside prepare's transaction; existing unused grants remain mandatory. */
  private finalizePreparedChange(projectId: string, actor: ActorContext, captured: PreparedChangeCapture, assessment: CompiledChangeAssessment): Prepared {
    const { before, next, lock, proposal, proposalDigest, compiled, logicalIds } = captured;
    const { impact, stages, extraTakeIds: extra } = assessment;
    // Parsing and provider completion may interleave. Authority and project version are rechecked here.
    this.assertActor(projectId, actor, true);
    invariant(this.store.getProject(projectId).headVersion === before.headVersion, "REVISION_CONFLICT", "Project changed during preparation");
    const duplicate = this.store.list<Prepared>("prepared", projectId).find(item => item.requestId === actor.requestId && item.epochId === (actor.kind === "director" ? actor.epochId : null) && item.proposalDigest === proposalDigest);
    if (duplicate) return duplicate;
    const noProgress = digest(before) === digest(next) && !compiled;
    invariant(!noProgress || this.store.list<Prepared>("prepared", projectId).filter(item => item.requestId === actor.requestId && !item.semanticChange && !item.compiled).length < 3,
      "WAITING_USER", "No production progress after three assessments; ask the user for the missing information");
    const used = new Set(this.store.list<Candidate>("candidate", projectId).map(candidate => candidate.grantId));
    const authorities = new Set([actor.requestId]);
    const continuations = this.store.list<{ fromRequestId: string; toRequestId: string }>("request_continuation", projectId);
    for (let count = 0; count < continuations.length; count++) for (const continuation of continuations)
      if (authorities.has(continuation.toRequestId)) authorities.add(continuation.fromRequestId);
    const grants = this.store.list<Grant>("grant", projectId).filter(grant => !used.has(grant.id) && authorities.has(grant.authorityId)
      && !this.recovery.isImported(projectId, "grant", grant.id) && !this.store.get("owned_transcription_review", grant.id) && !this.store.get("narration_speech_review", grant.id));
    const grantBindings: Record<string, string> = {};
    for (const change of impact.filter(change => change.kind === "new" || change.kind === "replace")) {
      const node = compiled!.nodes.find(n => n.id === change.nodeId)!;
      if (["timeline", "render"].includes(node.kind)) continue;
      const sceneId = next.shots.find(s => s.id === node.shotId)?.sceneId;
      const grant = grants.find(g => !used.has(g.id) && g.kind === node.kind && (!extra.has(node.id) || g.origin === "user_change") && (g.scopeId === node.shotId || g.scopeId === sceneId || g.scopeId === projectId));
      invariant(grant, "ORIGIN_NOT_AUTHORIZED", `Human generation authorization is required for ${node.alias}`);
      used.add(grant.id); grantBindings[node.id] = grant.id;
    }
    return this.recordPreparedChange(projectId, actor, captured, assessment, grantBindings);
  }

  /** Record one validated compiled change; callers own the exact grant selection and outer transaction. */
  private recordPreparedChange(projectId: string, actor: ActorContext, captured: PreparedChangeCapture,
    assessment: CompiledChangeAssessment, grantBindings: Record<string, string>): Prepared {
    const { before, next, lock, proposal, proposalDigest, compiled, logicalIds } = captured;
    const { impact, stages } = assessment;
    const stageVersions = Object.fromEntries(stages.map(stage => { const id = this.stageId(projectId, stage); return [id, this.store.get<StageBinding>("stage", id)?.bindingVersion ?? 0]; }));
    const prepared: Prepared = {
      id: newId(), projectId, requestId: actor.requestId, principalId: actor.principalId, epochId: actor.kind === "director" ? actor.epochId : null,
      proposal, proposalDigest, baseVersion: before.headVersion, next, compiled, logicalIds, impact, stages, stageVersions, grantBindings,
      semanticChange: digest(before) !== digest(next),
      capabilityDigest: digest(lock),
    };
    this.store.insert("prepared", prepared.id, projectId, prepared);
    this.store.appendEvent(projectId, "change.prepared", { preparedId: prepared.id, impact: impact.map(i => ({ ...i })) });
    return prepared;
  }

  /** Trusted synchronous host boundary after review re-verifies bytes and isolated composition.
   * All human authority, one-use grant, plan publication and receipt records commit together.
   * This method is never a model tool; admission independently verifies the exact owned bytes again.
   */
  commitOwnedTranscriptionReview(projectId: string, human: ActorContext, input: ReviewOwnedTranscription,
    options: { signal?: AbortSignal } = {}): OwnedTranscriptionApplyReceipt {
    const signal = options.signal;
    const stopped = (): void => invariant(!signal?.aborted, "OWNED_TRANSCRIPTION_CANCELLED", "Recording review was cancelled");
    stopped();
    human = snapshotOwnedTranscriptionData(human, 16384); input = captureOwnedTranscriptionReviewInput(input);
    const authority = (): void => {
      invariant(human.kind === "human", "ACTOR_DENIED", "Only a human can approve recording transcription");
      this.assertActor(projectId, human, true);
      invariant(this.request(projectId, human).scopeIds.includes(projectId), "SCOPE_DENIED", "Recording review requires editable project scope");
      this.recovery.assertFreshAuthority(projectId, "owned_transcription_proposal", input.proposalId);
    };
    authority();
    return this.store.transaction(() => {
      authority();
      const receipt = this.store.command(ownedTranscriptionReviewScope(projectId, human), input.key, digest(input), () => {
        const { proposal: owned, before, lock } = currentOwnedTranscriptionReview(this.store, projectId, input);
        const proposal = parseChangeProposal({ variant: "plan", expectedHeadVersion: before.headVersion, source: owned.compiled.source });
        const captured: PreparedChangeCapture = { before, next: structuredClone(before), lock: lock as ProjectCapabilityLock,
          proposal, proposalDigest: digest(proposal), compiled: owned.compiled, logicalIds: owned.logicalIds };
        const assessment = this.assessCompiledChange(captured, human);
        invariant(digest(assessment.impact) === digest(owned.impact) && digest(assessment.stages) === digest(owned.stages),
          "OWNED_TRANSCRIPTION_STALE", "Recording proposal assessment changed since human review");
        const node = owned.compiled.nodes.find(item => item.alias === owned.operation.alias)!;
        const grant = this.engine.createGrant(projectId, projectId, "transcription", human.requestId, "user_change");
        const review: OwnedTranscriptionReview = { id: grant.id, version: 1, projectId, requestId: human.requestId,
          principalId: human.principalId, proposal: { id: owned.id, digest: input.proposalDigest }, grantDigest: digest(grant),
          sourceBinding: owned.sourceBinding, nodeId: node.id, specDigest: node.specDigest, compiledDigest: digest(owned.compiled) };
        this.store.insert("owned_transcription_review", review.id, projectId, review);
        const prepared = this.recordPreparedChange(projectId, human, captured, assessment, { [node.id]: grant.id });
        const applied = this.publishPreparedChange(projectId, human, prepared);
        const binding = this.store.get<{ candidateId: string }>("node_binding", node.id)!;
        const candidate = this.store.get("candidate", binding.candidateId)!;
        const application: OwnedTranscriptionApplication = { id: binding.candidateId, version: 1, projectId,
          review: { id: review.id, digest: digest(review) }, candidateDigest: digest(candidate),
          prepared: { id: prepared.id, digest: digest(this.store.get("prepared", prepared.id)) },
          plan: { id: applied.activePlanId!, digest: digest(this.store.get("plan", applied.activePlanId!)) },
          projectRevision: { id: applied.revisionId, digest: digest(this.store.get("project_revision", applied.revisionId)) }, receipt: applied };
        this.store.insert("owned_transcription_application", application.id, projectId, application);
        this.store.appendEvent(projectId, "narration.transcription_reviewed", { proposalId: owned.id, reviewId: review.id,
          applicationId: application.id, grantId: grant.id, candidateId: binding.candidateId, requestId: human.requestId });
        return { proposalId: owned.id, proposalDigest: input.proposalDigest, reviewId: review.id,
          applicationId: application.id, grantId: grant.id, candidateId: binding.candidateId, applied };
      });
      stopped(); return receipt;
    });
  }

  /** Exact human speech review; grants and application publication remain atomic. */
  commitNarrationSpeechReview(projectId: string, human: ActorContext, input: ReviewNarrationSpeech,
    options: { signal?: AbortSignal } = {}): NarrationSpeechApplyReceipt {
    const signal = options.signal;
    const stopped = (): void => invariant(!signal?.aborted, "NARRATION_SPEECH_CANCELLED", "Narration speech review was cancelled");
    stopped();
    human = snapshotOwnedTranscriptionData(human, 16384); input = captureNarrationSpeechReviewInput(input);
    const authority = (): void => {
      invariant(human.kind === "human", "ACTOR_DENIED", "Only a human can approve narration speech");
      this.assertActor(projectId, human, true);
      invariant(this.request(projectId, human).scopeIds.includes(projectId), "SCOPE_DENIED", "Narration speech review requires editable project scope");
      this.recovery.assertFreshAuthority(projectId, "narration_speech_proposal", input.proposalId);
    };
    authority();
    return this.store.transaction(() => {
      authority();
      const receipt = this.store.command(narrationSpeechReviewScope(projectId, human), input.key, digest(input), () => {
        const { proposal: owned, before, lock } = currentNarrationSpeechReview(this.store, projectId, input);
        const proposal = parseChangeProposal({ variant: "plan", expectedHeadVersion: before.headVersion, source: owned.compiled.source });
        const captured: PreparedChangeCapture = { before, next: structuredClone(before), lock: lock as ProjectCapabilityLock,
          proposal, proposalDigest: digest(proposal), compiled: owned.compiled, logicalIds: owned.logicalIds };
        const assessment = this.assessCompiledChange(captured, human);
        invariant(digest(assessment.impact) === digest(owned.impact) && digest(assessment.stages) === digest(owned.stages),
          "NARRATION_SPEECH_STALE", "Narration speech proposal assessment changed since human review");
        const node = owned.compiled.nodes.find(item => item.alias === owned.operation.alias)!;
        const grant = this.engine.createGrant(projectId, projectId, "speech", human.requestId, "user_change");
        const review: NarrationSpeechReview = { id: grant.id, version: 1, projectId, requestId: human.requestId,
          principalId: human.principalId, proposal: { id: owned.id, digest: input.proposalDigest }, grantDigest: digest(grant),
          section: owned.section, nodeId: node.id, specDigest: node.specDigest, compiledDigest: digest(owned.compiled) };
        this.store.insert("narration_speech_review", review.id, projectId, review);
        const prepared = this.recordPreparedChange(projectId, human, captured, assessment, { [node.id]: grant.id });
        const applied = this.publishPreparedChange(projectId, human, prepared);
        const binding = this.store.get<{ candidateId: string }>("node_binding", node.id)!;
        const candidate = this.store.get("candidate", binding.candidateId)!;
        const application: NarrationSpeechApplication = { id: binding.candidateId, version: 1, projectId,
          review: { id: review.id, digest: digest(review) }, candidateDigest: digest(candidate),
          prepared: { id: prepared.id, digest: digest(this.store.get("prepared", prepared.id)) },
          plan: { id: applied.activePlanId!, digest: digest(this.store.get("plan", applied.activePlanId!)) },
          projectRevision: { id: applied.revisionId, digest: digest(this.store.get("project_revision", applied.revisionId)) }, receipt: applied };
        this.store.insert("narration_speech_application", application.id, projectId, application);
        this.store.appendEvent(projectId, "narration.speech_reviewed", { proposalId: owned.id, reviewId: review.id,
          applicationId: application.id, grantId: grant.id, candidateId: binding.candidateId, requestId: human.requestId });
        return { proposalId: owned.id, proposalDigest: input.proposalDigest, reviewId: review.id,
          applicationId: application.id, grantId: grant.id, candidateId: binding.candidateId, applied };
      });
      stopped(); return receipt;
    });
  }

  apply(projectId: string, actor: ActorContext, preparedId: string): ApplyReceipt {
    invariant(actor.kind !== "director" || !this.store.get("plan_import", actor.requestId), "IMPORT_REVIEW_REQUIRED", "The supplied-material draft must be confirmed by the human in Film plan.");
    this.assertActor(projectId, actor, true);
    return this.store.transaction(() => {
      this.assertActor(projectId, actor, true);
      const prepared = this.store.get<Prepared>("prepared", preparedId);
      invariant(prepared && prepared.projectId === projectId && prepared.requestId === actor.requestId && prepared.principalId === actor.principalId && prepared.epochId === (actor.kind === "director" ? actor.epochId : null), "ACTOR_DENIED", "Prepared change is not owned by this request");
      return this.store.command(`${actor.principalId}:${projectId}:apply`, preparedId, prepared.proposalDigest,
        () => this.publishPreparedChange(projectId, actor, prepared));
    });
  }

  /** Human-only import acceptance: retain the exact reviewed draft and recheck all publication predicates. */
  confirmPlanImport(projectId: string, requestId: string, preparedId: string, proposalDigest: string, key: string): ApplyReceipt {
    this.recovery.assertWritable(projectId);
    return this.store.command(`local-user:${projectId}:confirm-plan-import`, key, digest({ requestId, preparedId, proposalDigest }), () => {
      const material = this.store.get<{ projectId: string; state: string }>("plan_import", requestId);
      invariant(material?.projectId === projectId && material.state === "pending", "IMPORT_STALE", "This import is no longer pending.");
      this.recovery.assertFreshAuthority(projectId, "message", requestId);
      const request = this.store.get<RequestRecord>("message", requestId);
      invariant(request?.principalId === "local-user" && request.state === "active" && this.store.list<RequestRecord>("message", projectId).filter(row => row.editing).at(-1)?.id === requestId,
        "IMPORT_STALE", "Newer direction superseded this import. Re-import against the current film plan.");
      invariant(!this.store.get<{ paused: boolean }>("execution_control", projectId)?.paused, "IMPORT_STALE", "The conversation is stopped. Resume with a fresh request before importing again.");
      invariant(!this.store.list<{ requestId: string; state: string }>("director_turn", projectId).some(turn => turn.requestId === requestId && ["queued", "running"].includes(turn.state)), "IMPORT_NOT_READY", "Wait for the director to finish interpreting the source.");
      const prepared = this.store.get<Prepared>("prepared", preparedId);
      const latest = this.store.list<Prepared>("prepared", projectId).filter(row => row.requestId === requestId).at(-1);
      invariant(prepared?.projectId === projectId && prepared.requestId === requestId && latest?.id === preparedId && prepared.proposalDigest === proposalDigest && !prepared.compiled && !prepared.proposal.source,
        "IMPORT_STALE", "Review the current import draft before confirming.");
      invariant(prepared.baseVersion === this.store.getProject(projectId).headVersion, "REVISION_CONFLICT", "The film plan changed. Re-import against its current version.");
      const human = this.beginRequest(projectId, "local-user", "Confirm the reviewed supplied-material plan. No generation is authorized.", { editing: true, continuationRequestId: requestId, key: `confirm-import:${key}`, contextDigest: digest({ preparedId, proposalDigest }) });
      const reviewed: Prepared = { ...prepared, id: newId(), requestId: human.requestId, principalId: human.principalId, epochId: null };
      this.store.insert("prepared", reviewed.id, projectId, reviewed);
      const result = this.apply(projectId, human, reviewed.id);
      this.store.put("plan_import", requestId, projectId, { ...material, state: "confirmed", preparedId, confirmation: result });
      this.store.appendEvent(projectId, "plan_import.confirmed", { requestId, preparedId });
      return result;
    });
  }

  /** Shared synchronous publication kernel; callers retain exact actor ownership and command authority. */
  private publishPreparedChange(projectId: string, actor: ActorContext, prepared: Prepared): ApplyReceipt {
    const preparedId = prepared.id;
    const before = this.store.getProject(projectId);
    invariant(digest(this.store.get("capability_lock", before.capabilityLockId) ?? null) === prepared.capabilityDigest, "CAPABILITY_MISMATCH", "Project capability lock changed");
    validateStageRequirements(prepared.next, prepared.stages);
    invariant(before.headVersion === prepared.baseVersion, "REVISION_CONFLICT", "Prepared change is stale");
    for (const [id, version] of Object.entries(prepared.stageVersions)) invariant((this.store.get<StageBinding>("stage", id)?.bindingVersion ?? 0) === version, "STAGE_BINDING_CONFLICT", "Stage binding changed");
    let planId = before.activePlanId;
    if (prepared.compiled) planId = newId();
    const changed = prepared.semanticChange || !!prepared.compiled;
    const next = changed ? this.store.saveProject({ ...prepared.next, revisionId: newId(), activePlanId: planId }, prepared.baseVersion) : before;
    if (prepared.compiled) {
      this.engine.installPlan(projectId, planId!, prepared.compiled, prepared.grantBindings);
      this.store.put("logical_ids", projectId, projectId, { aliases: prepared.logicalIds });
    }
    if (changed) this.store.insert("project_revision", next.revisionId, projectId, { project: next });
    for (const stage of prepared.stages) {
      const id = this.stageId(projectId, stage);
      const previous = this.store.get<StageBinding>("stage", id);
      const inputDigest = stageInputDigest(next, stage);
      const outputDigest = digest(prepared.compiled?.nodes.filter(n => stage.scopeId === projectId || n.shotId === stage.scopeId || next.shots.some(s => s.id === n.shotId && s.sceneId === stage.scopeId)).map(n => n.specDigest) ?? []);
      const bindingVersion = (previous?.bindingVersion ?? 0) + (previous?.inputDigest === inputDigest && previous?.outputDigest === outputDigest ? 0 : 1);
      const binding: StageBinding = { ...stage, id, projectId, inputDigest, outputDigest, bindingVersion, progressVersion: previous?.progressVersion ?? 0, contractDigest: digest(STAGE_CONTRACTS[stage.stageId]) };
      this.store.put("stage", id, projectId, binding);
      if (bindingVersion !== previous?.bindingVersion) this.store.insert("stage_revision", newId(), projectId, { binding, preparedId });
    }
    for (const proposal of prepared.proposal.stages ?? []) this.store.insert("stage_assessment", newId(), projectId, { ...proposal, preparedId, advisory: true });
    if (prepared.compiled) this.releaseResolvedHolds(projectId, actor, prepared);
    this.store.appendEvent(projectId, "change.applied", { preparedId, revisionId: next.revisionId, planId, headVersion: next.headVersion });
    return { preparedId, projectId, revisionId: next.revisionId, headVersion: next.headVersion, activePlanId: next.activePlanId, cursor: this.store.cursor(projectId) };
  }

  private releaseResolvedHolds(projectId: string, actor: ActorContext, prepared: Prepared): void {
    for (const hold of this.store.list<Hold>("hold", projectId)) {
      // Only service-issued request holds are eligible. User pause is a separate execution state.
      const owner = this.store.get<RequestRecord>("message", hold.ownerId);
      if (!owner || owner.projectId !== projectId) continue;
      if (hold.active && hold.ownerId === actor.requestId) this.engine.releaseHold(projectId, hold.id, actor.requestId);
    }
  }

  private stageId(projectId: string, stage: StageRequirement): string { return digest({ projectId, stageId: stage.stageId, scopeId: stage.scopeId }); }

  recordProgress(projectId: string, stage: StageRequirement, evidenceId: string): void {
    this.store.transaction(() => {
      const id = this.stageId(projectId, stage), current = this.store.get<StageBinding>("stage", id);
      invariant(current && current.projectId === projectId, "NOT_FOUND", "Stage binding does not exist");
      this.store.put("stage", id, projectId, { ...current, progressVersion: current.progressVersion + 1 });
      this.store.appendEvent(projectId, "stage.progress", { stageId: stage.stageId, scopeId: stage.scopeId, evidenceId });
    });
  }

  readContext(projectId: string, actor: ActorContext, query: DirectorContextQuery = {}) { return projectDirectorContext(this, projectId, actor, query); }

  /** Display metadata only: never infer fixture status from a director, profile, or unmatched record. */
  artifactFixture(projectId: string, artifact: ArtifactRef): boolean | null {
    const record = this.store.get<ArtifactRecord>("artifact", artifact.artifactId);
    return record?.projectId === projectId && record.id === artifact.artifactId && record.artifact?.artifactId === artifact.artifactId
      && record.artifact.kind === artifact.kind && record.artifact.sha256 === artifact.sha256 && typeof record.fixture === "boolean" ? record.fixture : null;
  }

  snapshot(projectId: string) {
    return this.store.transaction(() => {
      const project = this.store.getProject(projectId);
      const plan = project.activePlanId ? this.store.get<PlanRecord>("plan", project.activePlanId) : undefined;
      const messages = this.store.list<RequestRecord>("message", projectId);
      const outputs = this.store.list<{ id: string; requestId: string; text: string; phase: string }>("director_output", projectId);
      const conversation = this.store.readEvents(projectId).flatMap(event => {
        if (event.kind === "message.recorded") {
          const message = messages.find(message => message.id === event.payload.requestId);
          return message ? [{ id: message.id, role: "user", text: message.text, state: message.state, requestId: message.id }] : [];
        }
        if (event.kind === "director.message") {
          const output = outputs.find(output => output.id === event.payload.outputId);
          return output ? [{ id: output.id, role: "assistant", text: output.text, state: output.phase, requestId: output.requestId }] : [];
        }
        return [];
      });
      return { project, workflow: workflowReadiness(project),
      stages: this.store.list<StageBinding>("stage", projectId), outputs: this.engine.outputs(projectId), attempts: this.engine.attempts(projectId),
      assessments: this.store.list("stage_assessment", projectId),
      holds: this.store.list("hold", projectId), messages, conversation,
      control: this.store.get<{ paused: boolean; authorityId: string }>("execution_control", projectId) ?? { paused: false },
      plan: plan ? { id: plan.id, graphDigest: plan.compiled.graphDigest, canonicalSource: plan.compiled.canonicalSource, nodes: plan.compiled.nodes } : null,
      questions: this.store.list<{ id: string; requestId: string; turnId: string }>("director_question", projectId).map(question =>
        this.recovery.isQuarantined() || this.recovery.isImported(projectId, "message", question.requestId)
          || this.recovery.isImported(projectId, "director_turn", question.turnId) || this.store.get<RequestRecord>("message", question.requestId)?.state === "superseded" ? { ...question, canAnswer: false } : question),
      previousPreviews: this.engine.attempts(projectId).filter(attempt => attempt.request.kind === "render" && attempt.phase === "succeeded")
        .reverse().flatMap(attempt => Object.values(attempt.outputs).map(artifact => ({ artifact, nodeId: attempt.nodeId, fixture: this.artifactFixture(projectId, artifact) }))).slice(0, 3),
      reconciliations: this.store.list("tool_reconciliation", projectId),
      toolCalls: this.store.list<{ id: string; requestId: string; epochId: string; callId: string; tool: string; state: string; resultDigest: string | null }>("tool_invocation", projectId).slice(-20)
        .map(({ id, requestId, epochId, callId, tool, state, resultDigest }) => ({ id, requestId, epochId, callId, tool, state, resultDigest })),
      cursor: this.store.cursor(projectId) };
    });
  }

  approve(projectId: string, human: ActorContext, snapshotId: string, videoNodeIds: string[]) {
    this.recovery.assertWritable(projectId, human.requestId);
    this.assertActor(projectId, human);
    invariant(human.kind === "human", "ACTOR_DENIED", "Only human review can approve keyframes");
    const project = this.store.getProject(projectId);
    const plan = project.activePlanId ? this.store.get<PlanRecord>("plan", project.activePlanId)?.compiled : undefined;
    for (const id of videoNodeIds) invariant(plan?.nodes.some(n => n.id === id && n.shotId && this.allows(project, human, n.shotId)), "SCOPE_DENIED", "Review selection is outside this request");
    invariant(videoNodeIds.length > 0 && new Set(videoNodeIds).size === videoNodeIds.length, "VALIDATION_ERROR", "Select one or more distinct review members");
    return this.store.command(`${human.principalId}:${projectId}:review`, digest({ snapshotId, videoNodeIds: [...videoNodeIds].sort() }), digest({ snapshotId, videoNodeIds: [...videoNodeIds].sort() }),
      () => this.engine.approve(projectId, snapshotId, videoNodeIds, human.requestId));
  }

  replyToReview(projectId: string, human: ActorContext, snapshotId: string, text: string) {
    this.recovery.assertWritable(projectId, human.requestId);
    this.assertActor(projectId, human);
    invariant(human.kind === "human", "ACTOR_DENIED", "Review replies must come from a human");
    const snapshot = this.store.get<{ projectId: string; members: Array<{ videoNodeId: string }> }>("review_snapshot", snapshotId);
    invariant(snapshot?.projectId === projectId, "NOT_FOUND", "Reply to a displayed review snapshot");
    if (!["approve", "approve all", "approve all displayed shots"].includes(text.trim().toLowerCase())) return { status: "needs_clarification" as const };
    return { status: "approved" as const, approvals: this.approve(projectId, human, snapshotId, snapshot.members.map(member => member.videoNodeId)) };
  }

  control(projectId: string, actor: ActorContext, action: "pause" | "resume" | "stop") {
    return this.store.transaction(() => {
      this.recovery.assertWritable(projectId, actor.requestId);
      this.assertActor(projectId, actor);
      invariant(actor.kind === "human" && this.allows(this.store.getProject(projectId), actor, projectId), "ACTOR_DENIED", "Execution controls require a human project command");
      if (action === "stop") {
        for (const prior of this.store.list<RequestRecord>("message", projectId)) if (prior.id !== actor.requestId && prior.state === "active")
          this.store.put("message", prior.id, projectId, { ...prior, state: "superseded" });
        for (const epoch of this.store.list<Epoch>("epoch", projectId)) if (epoch.state !== "revoked")
          this.store.put("epoch", epoch.id, projectId, { ...epoch, state: "revoked" });
      }
      this.engine.setPaused(projectId, action !== "resume", actor.requestId);
      return { action, cursor: this.store.cursor(projectId) };
    });
  }

  holdRequest(projectId: string, actor: ActorContext) {
    this.assertActor(projectId, actor, true);
    return this.store.transaction(() => {
      this.assertActor(projectId, actor, true);
      const holds = this.store.list<Hold>("hold", projectId);
      return this.request(projectId, actor).scopeIds.map(scopeId => holds.find(hold => hold.active && hold.ownerId === actor.requestId && hold.scopeId === scopeId)
        ?? this.engine.setHold(projectId, { scopeId, ownerId: actor.requestId }));
    });
  }

  inspectArtifact(projectId: string, actor: ActorContext, artifactId: string) {
    this.assertActor(projectId, actor);
    const artifact = this.store.get<ArtifactRecord & { byteLength?: number; physicalDurationSeconds?: number }>("artifact", artifactId);
    invariant(artifact?.projectId === projectId, "NOT_FOUND", "Artifact does not belong to this project");
    return { id: artifact.id, projectId, artifact: artifact.artifact, mimeType: artifact.mimeType, fixture: artifact.fixture,
      origin: artifact.origin ?? (artifact.fixture ? "fixture" : "unknown"), byteLength: artifact.byteLength ?? null,
      physicalDurationSeconds: artifact.physicalDurationSeconds ?? null };
  }
}
import { captureNarrationSpeechReviewInput, currentNarrationSpeechReview, narrationSpeechReviewScope } from "../narration/narration-speech-review-state.js";
import type { NarrationSpeechApplication, NarrationSpeechApplyReceipt, NarrationSpeechReview, ReviewNarrationSpeech } from "../narration/narration-speech-types.js";
