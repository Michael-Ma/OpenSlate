import { canonical, digest, invariant, normalizeFilmKind, STAGE_CONTRACTS, STAGES, validateStageScope } from "@openslate/core";
import type { ActorContext, ProjectRecord } from "@openslate/core";
import { activateSkills, readActivatedSkillFile, routeSkills, SKILL_LIMITS, verifySkillLock, verifySkillLockRelease } from "@openslate/director";
import type { SkillActivation, SkillCapabilityLock, SkillEnvironment, SkillReadVia, SkillStageBinding } from "@openslate/director";
import type { ProductionService } from "./service.js";

export const DIRECTOR_CONTEXT_MAX_BYTES = 1024 * 1024;
interface LockRecord { id: string; projectId: string; lock: SkillCapabilityLock }
/** snapshotRoot is the trusted root the activation verified against; read_guidance reads from the same snapshots. */
export interface ActivationRecord { id: string; projectId: string; requestId: string; epochId: string; activation: SkillActivation; snapshotRoot?: string }

/** Closed routing facts from saved state only; never from model arguments. */
export function directorRoutingConditions(project: ProjectRecord): string[] {
  const facts: string[] = [];
  if ((project.characters ?? []).length > 0) facts.push("has_characters");
  if (project.soundtrack) facts.push("has_soundtrack");
  if (project.narration.script.trim() || project.shots.some(shot => shot.narration && shot.narration.mode !== "none" && shot.narration.text.trim())) facts.push("narration_planned");
  if (project.visualStyle) facts.push("has_visual_style");
  if (normalizeFilmKind(project.filmKind)?.audience === "kids") facts.push("audience:kids");
  return facts;
}

/** Server-side context/skill provenance. This does not launch a reasoning process. */
export class DirectorContextService {
  constructor(readonly service: ProductionService, readonly environment: SkillEnvironment) {}

  /** Trusted host configuration, never exposed through director tools or HTTP request data. */
  bootstrapLock(projectId: string, lock: SkillCapabilityLock): string {
    this.service.recovery.assertWritable(projectId);
    verifySkillLock(lock, this.environment);
    return this.service.store.transaction(() => {
      this.service.store.getProject(projectId);
      const existing = this.service.store.list<LockRecord>("director_skill_lock", projectId);
      invariant(existing.length === 0, "CAPABILITY_MISMATCH", "Bootstrap cannot replace an existing project skill lock");
      this.service.store.insert("director_skill_lock", lock.id, projectId, { id: lock.id, projectId, lock });
      this.service.store.appendEvent(projectId, "director.lock_installed", { lockId: lock.id, lockDigest: lock.lockDigest, source: "application_configuration" });
      return lock.id;
    });
  }

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

  /** Schema 1 locks select packages explicitly; schema 2 (release) locks are routed from saved state here. */
  capture(projectId: string, actor: ActorContext, options: { lockId: string; selectedSkillIds?: string[]; stageBindings?: SkillStageBinding[] }) {
    this.service.recovery.assertWritable(projectId, actor.requestId);
    invariant(actor.kind === "director", "ACTOR_DENIED", "Director context must bind an immutable epoch");
    this.service.assertActor(projectId, actor);
    const record = this.service.store.get<LockRecord>("director_skill_lock", options.lockId);
    invariant(record?.projectId === projectId, "SCOPE_DENIED", "Skill lock belongs to a different project or is absent");
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
    // A first snapshot must advertise the same catalog that is actually activated.
    // Verify immutable files before recording a selection, then retain that binding
    // even if a later capture is interrupted. An epoch can never select again.
    verifySkillLock(record.lock, this.environment);
    this.service.store.transaction(() => {
      this.service.recovery.assertWritable(projectId, actor.requestId);
      this.service.assertActor(projectId, actor);
      invariant(canonical(this.service.store.get<LockRecord>("director_skill_lock", options.lockId)?.lock) === canonical(record.lock), "CAPABILITY_MISMATCH", "Skill lock changed before epoch binding");
      const prior = this.service.store.get<{ projectId: string; requestId: string; lockId: string }>("director_epoch_lock", actor.epochId);
      invariant(!prior || prior.projectId === projectId && prior.requestId === actor.requestId && prior.lockId === record.id,
        "CAPABILITY_MISMATCH", "A director epoch cannot switch its skill lock");
      if (!prior) this.service.store.insert("director_epoch_lock", actor.epochId, projectId,
        { id: actor.epochId, projectId, requestId: actor.requestId, epochId: actor.epochId, lockId: record.id });
    });
    const snapshot = this.service.readContext(projectId, actor);
    invariant(Buffer.byteLength(canonical(snapshot)) <= DIRECTOR_CONTEXT_MAX_BYTES, "CONTEXT_TOO_LARGE", "Context requires a narrower projection; nothing was silently truncated");
    // File verification stays outside the SQLite write transaction. Routing reads the saved film, not the request.
    const routed = record.lock.schemaVersion === 2 ? this.service.store.getProject(projectId) : null;
    const routing = routed ? routeSkills(routed.filmKind, verifySkillLockRelease(record.lock, this.environment.snapshotRoot), directorRoutingConditions(routed)) : undefined;
    const activation = activateSkills(record.lock, { ...this.environment, requestId: actor.requestId, contextDigest: digest(snapshot),
      ...(options.selectedSkillIds ? { selectedSkillIds: options.selectedSkillIds } : {}), ...(routing ? { routing } : {}),
      ...(options.stageBindings ? { stageBindings: options.stageBindings } : {}) });
    return this.service.store.transaction(() => {
      this.service.assertActor(projectId, actor);
      invariant(digest(this.service.readContext(projectId, actor)) === activation.contextDigest, "CONTEXT_STALE", "Project evidence changed while skills were verified");
      invariant(canonical(this.service.store.get<LockRecord>("director_skill_lock", options.lockId)?.lock) === canonical(record.lock), "CAPABILITY_MISMATCH", "Skill lock changed before context capture");
      const priorLock = this.service.store.get<{ projectId: string; requestId: string; lockId: string }>("director_epoch_lock", actor.epochId);
      invariant(priorLock?.projectId === projectId && priorLock.requestId === actor.requestId && priorLock.lockId === record.id, "CAPABILITY_MISMATCH", "A director epoch cannot switch its skill lock");
      const binding = { projectId, requestId: actor.requestId, epochId: actor.epochId };
      this.service.store.insert("director_context", activation.contextSnapshotId, projectId, { id: activation.contextSnapshotId, ...binding, snapshot, contextDigest: activation.contextDigest });
      this.service.store.insert("skill_activation", activation.activationId, projectId, { id: activation.activationId, ...binding, activation, snapshotRoot: this.environment.snapshotRoot });
      this.service.store.appendEvent(projectId, "director.context_captured", { requestId: actor.requestId, epochId: actor.epochId, contextSnapshotId: activation.contextSnapshotId, activationId: activation.activationId, lockId: record.id });
      return { snapshot, activation };
    });
  }

  /** via "read_guidance" is the Director's own on-demand read: bounded per activation and recorded like an injection. */
  readSkill(projectId: string, actor: ActorContext, activationId: string, selection: { skillId: string; path: string }, options: { via?: SkillReadVia } = {}) {
    this.service.recovery.assertWritable(projectId, actor.requestId);
    invariant(actor.kind === "director", "ACTOR_DENIED", "Skill reads must retain their director epoch");
    this.service.assertActor(projectId, actor);
    const record = this.service.store.get<ActivationRecord>("skill_activation", activationId);
    invariant(record?.projectId === projectId && record.requestId === actor.requestId && record.epochId === actor.epochId,
      "SCOPE_DENIED", "Skill activation does not belong to this request and epoch");
    const lock = this.service.store.get<LockRecord>("director_skill_lock", record.activation.lockId);
    invariant(lock?.projectId === projectId, "SCOPE_DENIED", "Skill lock is absent");
    const guidance = options.via === "read_guidance";
    const used = () => this.service.store.db.prepare("SELECT count(*) AS count, coalesce(sum(json_extract(body,'$.bytes')),0) AS bytes FROM entities WHERE kind='skill_read' AND project_id=? AND json_extract(body,'$.epochId')=? AND json_extract(body,'$.evidence.activationId')=? AND json_extract(body,'$.via')='read_guidance'")
      .get(projectId, actor.epochId, activationId) as { count: number; bytes: number };
    const limit = (bytes: number) => { const prior = used();
      invariant(prior.count < SKILL_LIMITS.guidanceReadsPerActivation && prior.bytes + bytes <= SKILL_LIMITS.guidanceReadBytes, "GUIDANCE_READ_LIMIT",
        `This conversation already read ${prior.count} guidance files; at most ${SKILL_LIMITS.guidanceReadsPerActivation} files and ${SKILL_LIMITS.guidanceReadBytes} bytes per conversation. Continue with what you have read.`); };
    if (guidance) limit(0);
    const read = readActivatedSkillFile(lock.lock, record.activation, this.environment, selection, options.via ? { via: options.via } : {});
    const bytes = Buffer.byteLength(read.content);
    return this.service.store.transaction(() => {
      this.service.assertActor(projectId, actor);
      invariant(canonical(this.service.store.get<ActivationRecord>("skill_activation", activationId)?.activation) === canonical(record.activation), "CAPABILITY_MISMATCH", "Skill activation changed during read");
      if (guidance) limit(bytes);
      this.service.store.insert("skill_read", read.evidence.readId, projectId, { id: read.evidence.readId, projectId, requestId: actor.requestId, epochId: actor.epochId, evidence: read.evidence,
        ...(options.via ? { via: options.via, bytes } : {}) });
      return read;
    });
  }
}
