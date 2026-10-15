import { canonical } from '@openslate/core';
import type { ProjectRecord } from '@openslate/core';

/** Preserve the exact reviewed IDs and reject overlap; only unrelated state may move forward. */
export function rebaseCreativeDraft(base: ProjectRecord, draft: ProjectRecord, current: ProjectRecord): ProjectRecord | null {
  if (base.id !== current.id || current.capabilityLockId !== base.capabilityLockId || current.activePlanId !== base.activePlanId) return null;
  const next = structuredClone(current);
  for (const field of ['brief', 'story', 'narration', 'cues'] as const) {
    if (canonical(base[field]) === canonical(draft[field])) continue;
    if (canonical(current[field]) !== canonical(base[field])) return null;
    Object.assign(next, { [field]: structuredClone(draft[field]) });
  }
  const merge = <T extends { id: string }>(before: T[], after: T[], now: T[]): T[] | null => {
    const changed = after.filter(row => canonical(before.find(old => old.id === row.id) ?? null) !== canonical(row));
    if (before.some(row => !after.some(next => next.id === row.id))) return null;
    for (const row of changed) if (canonical(now.find(n => n.id === row.id) ?? null) !== canonical(before.find(b => b.id === row.id) ?? null)) return null;
    return now.map(row => structuredClone(changed.find(c => c.id === row.id) ?? row)).concat(changed.filter(row => !now.some(n => n.id === row.id)).map(row => structuredClone(row)));
  };
  const shots = merge(base.shots, draft.shots, current.shots), scenes = merge(base.scenes, draft.scenes, current.scenes);
  if (!shots || !scenes || shots.some(s => !scenes.some(scene => scene.id === s.sceneId))) return null;
  return { ...next, shots, scenes };
}
