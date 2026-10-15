import { canonical, digest, invariant, newId, sceneVideoDurationFrames, shotIntentDigest } from "@openslate/core";
import type { ProjectRecord, ProviderProfile } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { NodeBinding } from "./execution/engine.js";
import type { CanonicalNarration } from "./narration/canonical-types.js";

export interface MediaUndo {
  bindings: NodeBinding[];
  /** Event cursor at which the command started, not a wall-clock comparison. */
  cursor: number;
  canonicalId?: string | null;
}
export function captureMediaUndo(s: ProductionService, projectId: string): MediaUndo {
  return { bindings: [], cursor: s.store.cursor(projectId) };
}
export function assertUndoUnused(s: ProductionService, projectId: string, undo?: MediaUndo): void {
  if (!undo) return; // Legacy records retain their original strict head-version fence.
  const attempts = new Map(s.engine.attempts(projectId).map(a => [a.id, a]));
  const used = s.store.readEvents(projectId).some(e => e.sequence > undo.cursor && e.kind === "attempt.state_changed" && e.payload.phase === "submitting" &&
    attempts.get(String(e.payload.attemptId))?.candidateId);
  invariant(!used, "UNDO_UNAVAILABLE", "Paid work has already used the state after this command.");
}
/** No authority is created. Only exact saved paid operations with verified owned bytes return. */
export function restoreMediaUndo(s: ProductionService, project: ProjectRecord, undo?: MediaUndo): void {
  const ordered = [...undo?.bindings ?? []].sort((a, b) => Number(a.node.kind === "video") - Number(b.node.kind === "video"));
  for (const old of ordered) {
    const current = s.store.get<NodeBinding>("node_binding", old.id);
    if (!current || current.projectId !== project.id || current.planId !== project.activePlanId || current.state !== "active" ||
      canonical({ ...current.node, shotRevisionId: null }) !== canonical({ ...old.node, shotRevisionId: null })) continue;
    if (old.node.kind === "image" || old.node.kind === "video") {
      const shot = project.shots.find(shot => shot.id === old.node.shotId);
      const cue = project.cues.find(cue => cue.id === shot?.cueId);
      if (!shot || old.node.intentDigest !== shotIntentDigest(shot, old.node.kind, cue) ||
        old.node.args.prompt !== (old.node.kind === "image" ? shot.imagePrompt : shot.videoPrompt)) continue;
      if (old.node.kind === "video") {
        const lock = s.store.get<{ profiles: ProviderProfile[] }>("capability_lock", project.capabilityLockId);
        const profile = lock?.profiles.find(p => p.id === old.node.profileId);
        if (!profile || sceneVideoDurationFrames(shot, profile, old.node) !== old.node.args.durationFrames) continue;
      }
    } else continue; // Local assembly must be rebuilt against the restored canonical state.
    const outputs = old.retainedTake?.outputs ?? old.outputs;
    if (!s.engine.outputsMatchOperation(old, outputs)) continue;
    for (const artifact of Object.values(outputs)) s.engine.verifyArtifact(project.id, artifact);
    const { retainedTake: _retained, ...saved } = old;
    s.store.put("node_binding", old.id, project.id, { ...saved, planId: project.activePlanId,
      candidateId: Object.keys(outputs).length ? old.retainedTake?.candidateId ?? old.candidateId : null, outputs });
  }
}
/** Re-commit an immutable earlier canonical projection; acceptance evidence remains historical. */
export function restoreCanonicalUndo(s: ProductionService, project: ProjectRecord, requestId: string, undo: MediaUndo): void {
  if (!Object.hasOwn(undo, "canonicalId")) return;
  const previous = undo.canonicalId ? s.store.get<CanonicalNarration>("narration_canonical", undo.canonicalId) : undefined;
  invariant(!undo.canonicalId || previous?.projectId === project.id, "NARRATION_INTEGRITY_ERROR", "The earlier canonical narration is unavailable");
  const head = s.store.get<{ canonicalId: string }>("narration_canonical_head", project.id);
  const current = head ? s.store.get<CanonicalNarration>("narration_canonical", head.canonicalId) : undefined;
  if (!current && !previous) return;
  for (const segment of previous?.segments ?? []) if (segment.cue.audio) s.engine.verifyArtifact(project.id, segment.cue.audio);
  const record: CanonicalNarration = { ...(previous ?? current!), id: newId(), projectRevisionId: project.revisionId, headVersion: project.headVersion,
    requestId, epochId: null, script: project.narration.script, source: project.narration.source,
    ...(!previous ? { segments: [], shotMappings: [], projectionDigest: digest({ segments: [] }) } : {}) };
  s.store.insert("narration_canonical", record.id, project.id, record);
  s.store.put("narration_canonical_head", project.id, project.id, { canonicalId: record.id });
  s.store.appendEvent(project.id, "narration.canonical_restored", { canonicalId: record.id, previousCanonicalId: undo.canonicalId ?? null, requestId });
}
