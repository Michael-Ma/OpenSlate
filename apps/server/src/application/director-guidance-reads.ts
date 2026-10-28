import { invariant, toolCatalog } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { SkillCapabilityLock } from "@openslate/director";
import { DirectorContextService } from "./director-context.js";
import type { ActivationRecord } from "./director-context.js";
import type { ProductionService } from "./service.js";

export interface ReadGuidanceInput { package: string; path?: string }

/**
 * read_guidance: free and read-only. Reads one declared file of a package in this conversation's own lock, from the
 * same verified snapshots its activation used, and records a skill_read for every call. It never reads other locks.
 */
export function readGuidance(service: ProductionService, projectId: string, actor: ActorContext, input: ReadGuidanceInput) {
  invariant(actor.kind === "director", "ACTOR_DENIED", "Guidance reads require a Director epoch");
  service.assertActor(projectId, actor);
  // An epoch captures exactly one activation; it is the only one this call may read through.
  const row = service.store.db.prepare("SELECT id FROM entities WHERE kind='skill_activation' AND project_id=? AND json_extract(body,'$.epochId')=? AND json_extract(body,'$.requestId')=? ORDER BY rowid DESC LIMIT 1")
    .get(projectId, actor.epochId, actor.requestId) as { id: string } | undefined;
  const activation = row ? service.store.get<ActivationRecord>("skill_activation", row.id) : undefined;
  invariant(activation?.snapshotRoot, "GUIDANCE_UNAVAILABLE", "This conversation has no locked guidance to read");
  const lock = service.store.get<{ projectId: string; lock: SkillCapabilityLock }>("director_skill_lock", activation.activation.lockId);
  invariant(lock?.projectId === projectId, "SCOPE_DENIED", "Skill lock is absent");
  // The epoch's lock already passed the tool catalog's handler check; read against that exact lock identity.
  const environment = { snapshotRoot: activation.snapshotRoot, compatibility: lock.lock.compatibility,
    availableToolIds: toolCatalog(lock.lock.compatibility.toolContract).names, bindings: lock.lock.bindings };
  const read = new DirectorContextService(service, environment)
    .readSkill(projectId, actor, activation.id, { skillId: input.package, path: input.path ?? "SKILL.md" }, { via: "read_guidance" });
  return { package: read.evidence.skillId, path: read.evidence.path, content: read.content, sha256: read.evidence.sha256, packageDigest: read.evidence.packageDigest };
}
