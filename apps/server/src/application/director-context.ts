import { canonical, digest, invariant, STAGE_CONTRACTS, STAGES, validateStageScope } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import { activateSkills, readActivatedSkillFile, verifySkillLock } from "@openslate/director";
import type { SkillActivation, SkillCapabilityLock, SkillEnvironment, SkillStageBinding } from "@openslate/director";
import type { ProductionService } from "./service.js";

export const DIRECTOR_CONTEXT_MAX_BYTES = 1024 * 1024;
interface LockRecord { id: string; projectId: string; lock: SkillCapabilityLock }
interface ActivationRecord { id: string; projectId: string; requestId: string; epochId: string; activation: SkillActivation }

/** Server-side context/skill provenance. This does not launch a reasoning process. */
export class DirectorContextService {
  constructor(readonly service: ProductionService, readonly environment: SkillEnvironment) {}

  installLock(projectId: string, human: ActorContext, lock: SkillCapabilityLock): string {
    invariant(human.kind === "human", "ACTOR_DENIED", "Runtime locks are installed by the application request handler");
    this.service.assertActor(projectId, human, true);
    verifySkillLock(lock, this.environment);
    return this.service.store.transaction(() => {
      this.service.assertActor(projectId, human, true);
      const request = this.service.store.get<{ scopeIds: string[] }>("message", human.requestId);
      invariant(request?.scopeIds.includes(projectId), "SCOPE_DENIED", "Installing a project runtime lock requires project scope");
      const existing = this.service.store.get<LockRecord>("director_skill_lock", lock.id);
      if (existing) {
        invariant(existing.projectId === projectId && canonical(existing.lock) === canonical(lock), "IMMUTABLE_RECORD", "Skill lock identity is already bound");
        return lock.id;
      }
      this.service.store.insert("director_skill_lock", lock.id, projectId, { id: lock.id, projectId, lock });
      this.service.store.appendEvent(projectId, "director.lock_installed", { lockId: lock.id, lockDigest: lock.lockDigest, requestId: human.requestId });
      return lock.id;
    });
  }

  capture(projectId: string, actor: ActorContext, options: { lockId: string; selectedSkillIds: string[]; stageBindings?: SkillStageBinding[] }) {
    invariant(actor.kind === "director", "ACTOR_DENIED", "Director context must bind an immutable epoch");
    this.service.assertActor(projectId, actor);
    const record = this.service.store.get<LockRecord>("director_skill_lock", options.lockId);
    invariant(record?.projectId === projectId, "SCOPE_DENIED", "Skill lock belongs to a different project or is absent");
    const snapshot = this.service.readContext(projectId, actor);
    const project = this.service.store.getProject(projectId);
    const request = this.service.store.get<{ scopeIds: string[] }>("message", actor.requestId)!;
    for (const binding of options.stageBindings ?? []) {
      invariant((STAGES as readonly string[]).includes(binding.stageId) && binding.promptId === STAGE_CONTRACTS[binding.stageId]?.promptRef,
        "CAPABILITY_MISMATCH", "Stage guidance must use the current locked contract prompt");
      validateStageScope(project, binding.scopeId);
      invariant(request.scopeIds.includes(projectId) || request.scopeIds.includes(binding.scopeId) || project.shots.some(shot => shot.id === binding.scopeId && request.scopeIds.includes(shot.sceneId)),
        "SCOPE_DENIED", "Stage guidance exceeds the request scope");
      if (binding.proposalId) {
        const proposal = this.service.store.get<{ projectId: string; requestId: string; epochId: string; stages: { stageId: string; scopeId: string }[] }>("prepared", binding.proposalId);
        invariant(proposal?.projectId === projectId && proposal.requestId === actor.requestId && proposal.epochId === actor.epochId && proposal.stages.some(stage => stage.stageId === binding.stageId && stage.scopeId === binding.scopeId),
          "SCOPE_DENIED", "Stage proposal is absent or belongs to other work");
      }
    }
    invariant(Buffer.byteLength(canonical(snapshot)) <= DIRECTOR_CONTEXT_MAX_BYTES, "CONTEXT_TOO_LARGE", "Context requires a narrower projection; nothing was silently truncated");
    // File verification stays outside the SQLite write transaction.
    const activation = activateSkills(record.lock, { ...this.environment, requestId: actor.requestId, contextDigest: digest(snapshot), selectedSkillIds: options.selectedSkillIds,
      ...(options.stageBindings ? { stageBindings: options.stageBindings } : {}) });
    return this.service.store.transaction(() => {
      this.service.assertActor(projectId, actor);
      invariant(digest(this.service.readContext(projectId, actor)) === activation.contextDigest, "CONTEXT_STALE", "Project evidence changed while skills were verified");
      invariant(canonical(this.service.store.get<LockRecord>("director_skill_lock", options.lockId)?.lock) === canonical(record.lock), "CAPABILITY_MISMATCH", "Skill lock changed before context capture");
      const priorLock = this.service.store.get<{ lockId: string }>("director_epoch_lock", actor.epochId);
      invariant(!priorLock || priorLock.lockId === record.id, "CAPABILITY_MISMATCH", "A director epoch cannot switch its skill lock");
      const binding = { projectId, requestId: actor.requestId, epochId: actor.epochId };
      if (!priorLock) this.service.store.insert("director_epoch_lock", actor.epochId, projectId, { id: actor.epochId, ...binding, lockId: record.id });
      this.service.store.insert("director_context", activation.contextSnapshotId, projectId, { id: activation.contextSnapshotId, ...binding, snapshot, contextDigest: activation.contextDigest });
      this.service.store.insert("skill_activation", activation.activationId, projectId, { id: activation.activationId, ...binding, activation });
      this.service.store.appendEvent(projectId, "director.context_captured", { requestId: actor.requestId, epochId: actor.epochId, contextSnapshotId: activation.contextSnapshotId, activationId: activation.activationId, lockId: record.id });
      return { snapshot, activation };
    });
  }

  readSkill(projectId: string, actor: ActorContext, activationId: string, selection: { skillId: string; path: string }) {
    invariant(actor.kind === "director", "ACTOR_DENIED", "Skill reads must retain their director epoch");
    this.service.assertActor(projectId, actor);
    const record = this.service.store.get<ActivationRecord>("skill_activation", activationId);
    invariant(record?.projectId === projectId && record.requestId === actor.requestId && record.epochId === actor.epochId,
      "SCOPE_DENIED", "Skill activation does not belong to this request and epoch");
    const lock = this.service.store.get<LockRecord>("director_skill_lock", record.activation.lockId);
    invariant(lock?.projectId === projectId, "SCOPE_DENIED", "Skill lock is absent");
    const read = readActivatedSkillFile(lock.lock, record.activation, this.environment, selection);
    return this.service.store.transaction(() => {
      this.service.assertActor(projectId, actor);
      invariant(canonical(this.service.store.get<ActivationRecord>("skill_activation", activationId)?.activation) === canonical(record.activation), "CAPABILITY_MISMATCH", "Skill activation changed during read");
      this.service.store.insert("skill_read", read.evidence.readId, projectId, { id: read.evidence.readId, projectId, requestId: actor.requestId, epochId: actor.epochId, evidence: read.evidence });
      return read;
    });
  }
}
