import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  applyCreativePatch, compilePlanIsolated, DEFAULT_PROFILES, digest, diffPlans, invariant, newId,
  parseChangeProposal, RECIPE_DIGEST, requiredStages, shotIntentDigest, stageInputDigest,
  validateStageRequirements, validateStageScope, workflowReadiness,
  STAGE_CONTRACTS, STAGE_CONTRACTS_DIGEST, TOOL_NAMES,
} from "@openslate/core";
import type {
  ActorContext, ArtifactRef, ChangeProposal, CompiledPlan, NodeImpact, OperationKind, ProjectRecord,
  ProviderProfile, ShotRecord, StageRequirement,
} from "@openslate/core";
import { Store } from "../persistence/store.js";
import { Engine } from "../execution/engine.js";
import type { ArtifactRecord } from "../execution/engine.js";
import { projectDirectorContext } from "./context-projection.js";
import type { DirectorContextQuery } from "./context-projection.js";
import { selectedProviderProfiles } from "./provider-catalog.js";
import type { InstalledProviderSelection } from "./provider-catalog.js";

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
export { TOOL_NAMES } from "@openslate/core";

/** The trusted application boundary. Models propose data; these methods own authority and commits. */
export class ProductionService {
  constructor(readonly store: Store, readonly engine: Engine, readonly profiles: ProviderProfile[] = DEFAULT_PROFILES) {}

  createProject(name: string, selection?: InstalledProviderSelection): ProjectRecord {
    invariant(typeof name === "string" && name.trim().length > 0 && name.length <= 160, "VALIDATION_ERROR", "Provide a short project name");
    const selected = selection === undefined ? undefined : selectedProviderProfiles(selection);
    return this.store.transaction(() => {
      const project: ProjectRecord = {
        id: newId(), revisionId: newId(), headVersion: 0, name, brief: "", story: "", scenes: [],
        narration: { script: "", source: "undecided" }, maxFrames: 10800, capabilityLockId: newId(),
        shots: [], cues: [], artifacts: [], activePlanId: null,
      };
      this.store.createProject(project);
      this.store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: selected?.profiles ?? this.profiles,
        recipeDigest: RECIPE_DIGEST, stageContractsDigest: STAGE_CONTRACTS_DIGEST, tools: TOOL_NAMES,
        ...(selected ? { providerSelection: selected.provenance } : {}) });
      this.store.insert("project_revision", project.revisionId, project.id, { project });
      this.store.appendEvent(project.id, "project.created", { revisionId: project.revisionId });
      return project;
    });
  }

  /** Invoked from an authenticated human channel, never from model arguments. */
  beginRequest(projectId: string, principalId: string, text: string, options: { scopeIds?: string[]; editing?: boolean; key?: string; continuationRequestId?: string; contextDigest?: string } = {}): ActorContext {
    invariant(text.trim().length > 0 && text.length <= 16000, "VALIDATION_ERROR", "Message must contain at most 16000 characters");
    const key = options.key ?? newId();
    return this.store.command(`${principalId}:${projectId}:message`, key, digest({ text, scopeIds: options.scopeIds ?? [projectId], editing: options.editing ?? true, continuationRequestId: options.continuationRequestId ?? null, contextDigest: options.contextDigest ?? null }), () => {
      const project = this.store.getProject(projectId);
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
      this.store.appendEvent(projectId, "message.recorded", { requestId: request.id, text, editing: options.editing ?? true });
      return { kind: "human", principalId, requestId: request.id };
    });
  }

  openEpoch(projectId: string, human: ActorContext): { actor: ActorContext; token: string } {
    this.assertActor(projectId, human);
    invariant(human.kind === "human", "ACTOR_DENIED", "Only the human request handler can open a director bridge");
    const request = this.request(projectId, human);
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
    invariant(!proposal.source || !proposal.creative?.createShots?.length, "VALIDATION_ERROR", "Create shot intents first, then reference their saved IDs in the executable plan");
    const proposalDigest = digest(proposal);
    const same = this.store.list<Prepared>("prepared", projectId).find(item => item.requestId === actor.requestId && item.epochId === (actor.kind === "director" ? actor.epochId : null) && item.proposalDigest === proposalDigest);
    if (same) return same;
    this.holdRequest(projectId, actor);
    const before = this.store.getProject(projectId);
    const lock = this.store.get<{ profiles: ProviderProfile[]; recipeDigest: string; stageContractsDigest: string }>("capability_lock", before.capabilityLockId);
    invariant(lock?.recipeDigest === RECIPE_DIGEST && lock.stageContractsDigest === STAGE_CONTRACTS_DIGEST, "CAPABILITY_MISMATCH", "Project workflow lock is unsupported");
    invariant(before.headVersion === proposal.expectedHeadVersion, "REVISION_CONFLICT", "Project changed before preparation");
    const next = proposal.creative ? applyCreativePatch(before, proposal.creative, (shot, cue) => ({ ...shot, promptIntent: { image: shotIntentDigest(shot, "image", cue), video: shotIntentDigest(shot, "video", cue) } })) : structuredClone(before);
    const logicalIds = { ...(this.store.get<{ aliases: Record<string, string> }>("logical_ids", projectId)?.aliases ?? {}) };
    const compiled = proposal.source ? await compilePlanIsolated(proposal.source, { project: next, profiles: lock.profiles, logicalIds, allocateId: newId }) : null;
    const oldPlan = before.activePlanId ? this.store.get<PlanRecord>("plan", before.activePlanId)?.compiled ?? null : null;
    const impact = compiled ? diffPlans(oldPlan, compiled) : [];
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
    return this.store.transaction(() => {
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
      const grants = this.store.list<Grant>("grant", projectId).filter(grant => !used.has(grant.id) && authorities.has(grant.authorityId));
      const grantBindings: Record<string, string> = {};
      for (const change of impact.filter(change => change.kind === "new" || change.kind === "replace")) {
        const node = compiled!.nodes.find(n => n.id === change.nodeId)!;
        if (["timeline", "render"].includes(node.kind)) continue;
        const sceneId = next.shots.find(s => s.id === node.shotId)?.sceneId;
        const grant = grants.find(g => !used.has(g.id) && g.kind === node.kind && (!extra.has(node.id) || g.origin === "user_change") && (g.scopeId === node.shotId || g.scopeId === sceneId || g.scopeId === projectId));
        invariant(grant, "ORIGIN_NOT_AUTHORIZED", `Human generation authorization is required for ${node.alias}`);
        used.add(grant.id); grantBindings[node.id] = grant.id;
      }
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
    });
  }

  apply(projectId: string, actor: ActorContext, preparedId: string): ApplyReceipt {
    this.assertActor(projectId, actor, true);
    return this.store.transaction(() => {
      this.assertActor(projectId, actor, true);
      const prepared = this.store.get<Prepared>("prepared", preparedId);
      invariant(prepared && prepared.projectId === projectId && prepared.requestId === actor.requestId && prepared.principalId === actor.principalId && prepared.epochId === (actor.kind === "director" ? actor.epochId : null), "ACTOR_DENIED", "Prepared change is not owned by this request");
      return this.store.command(`${actor.principalId}:${projectId}:apply`, preparedId, prepared.proposalDigest, () => {
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
      });
    });
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
      control: { paused: this.store.get<{ paused: boolean }>("execution_control", projectId)?.paused ?? false },
      plan: plan ? { id: plan.id, graphDigest: plan.compiled.graphDigest, canonicalSource: plan.compiled.canonicalSource, nodes: plan.compiled.nodes } : null,
      questions: this.store.list("director_question", projectId),
      previousPreviews: this.engine.attempts(projectId).filter(attempt => attempt.request.kind === "render" && attempt.phase === "succeeded")
        .reverse().flatMap(attempt => Object.values(attempt.outputs).map(artifact => ({ artifact, nodeId: attempt.nodeId, fixture: this.artifactFixture(projectId, artifact) }))).slice(0, 3),
      reconciliations: this.store.list("tool_reconciliation", projectId),
      toolCalls: this.store.list<{ id: string; requestId: string; epochId: string; callId: string; tool: string; state: string; resultDigest: string | null }>("tool_invocation", projectId).slice(-20)
        .map(({ id, requestId, epochId, callId, tool, state, resultDigest }) => ({ id, requestId, epochId, callId, tool, state, resultDigest })),
      cursor: this.store.cursor(projectId) };
    });
  }

  approve(projectId: string, human: ActorContext, snapshotId: string, videoNodeIds: string[]) {
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
    this.assertActor(projectId, human);
    invariant(human.kind === "human", "ACTOR_DENIED", "Review replies must come from a human");
    const snapshot = this.store.get<{ projectId: string; members: Array<{ videoNodeId: string }> }>("review_snapshot", snapshotId);
    invariant(snapshot?.projectId === projectId, "NOT_FOUND", "Reply to a displayed review snapshot");
    if (!["approve", "approve all", "approve all displayed shots"].includes(text.trim().toLowerCase())) return { status: "needs_clarification" as const };
    return { status: "approved" as const, approvals: this.approve(projectId, human, snapshotId, snapshot.members.map(member => member.videoNodeId)) };
  }

  control(projectId: string, actor: ActorContext, action: "pause" | "resume") {
    this.assertActor(projectId, actor);
    invariant(actor.kind === "human" && this.allows(this.store.getProject(projectId), actor, projectId), "ACTOR_DENIED", "Global pause and resume require a human project command");
    this.engine.setPaused(projectId, action === "pause", actor.requestId);
    return { action };
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
