import { canonical, invariant } from '@openslate/core';
import type { ActorContext, CreativePatch, ProjectRecord } from '@openslate/core';
import type { Store } from '../persistence/store.js';

interface Field { shotId?: string; sceneId?: string; field: string }
/** Record changed fields, including ABA edits, in the same transaction as publication. */
export function recordHumanFields(store: Store, before: ProjectRecord, after: ProjectRecord, actor: ActorContext): void {
  if (actor.kind !== 'human') return;
  const fields: Field[] = [];
  for (const shot of after.shots) {
    const old = before.shots.find(s => s.id === shot.id);
    if (!old) continue;
    for (const key of new Set([...Object.keys(old), ...Object.keys(shot)])) if (!['revisionId', 'promptIntent'].includes(key)
      && canonical(old[key as keyof typeof old] ?? null) !== canonical(shot[key as keyof typeof shot] ?? null)) fields.push({ shotId: shot.id, field: key });
  }
  for (const scene of after.scenes) if (before.scenes.some(s => s.id === scene.id && s.purpose !== scene.purpose)) fields.push({ sceneId: scene.id, field: 'purpose' });
  if (fields.length) store.appendEvent(before.id, 'human.fields_changed', { requestId: actor.requestId, fields: fields.map(field => ({ ...field })) });
}
/** A later read_context does not erase the original turn's human-edit fence. */
export function assertNoHumanFieldConflict(store: Store, projectId: string, actor: ActorContext, patch?: CreativePatch): void {
  if (actor.kind !== 'director' || !patch) return;
  const captured = store.db.prepare("SELECT min(json_extract(body,'$.snapshot.cursor')) AS cursor FROM entities WHERE kind='director_context' AND project_id=? AND json_extract(body,'$.epochId')=?")
    .get(projectId, actor.epochId) as { cursor: number | null };
  if (captured.cursor === null) return; // Legacy/direct service callers without a captured turn.
  const cursor = captured.cursor;
  const fields: Field[] = [
    ...(patch.updateShots ?? []).flatMap(row => Object.keys(row).filter(key => key !== 'id' && key !== 'reauthorPrompts').map(field => ({ shotId: row.id, field }))),
    ...(patch.updateScenes ?? []).map(row => ({ sceneId: row.id, field: 'purpose' })),
  ];
  const edited = store.readEvents(projectId, cursor).filter(e => e.kind === 'human.fields_changed')
    .flatMap(e => e.payload.fields as unknown as Field[]);
  invariant(!fields.some(f => edited.some(e => f.shotId === e.shotId && f.sceneId === e.sceneId && f.field === e.field)),
    'HUMAN_EDITED_FIELD', 'A person changed this field after the Director context was captured. Preserve that edit.');
}
