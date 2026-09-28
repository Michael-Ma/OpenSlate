import type { FastifyInstance } from 'fastify';
import { digest, invariant, newId } from '@openslate/core';
import type { ProjectRecord, ShotRecord } from '@openslate/core';
import type { ProductionService } from './application/service.js';
import type { NarrationAudio } from './narration/types.js';
import type { NodeBinding } from './execution/engine.js';

type Edit = { expectedHeadVersion: number; kind: 'treatment' | 'scene' | 'addScene' | 'shot' | 'addShot' | 'deleteShot' | 'moveShot' | 'narration' | 'undo' | 'soundtrack'; id?: string; sceneId?: string; beforeId?: string; field?: string; value?: string; commandId?: string };
type SavedEdit = { id: string; before: ProjectRecord; headVersion: number; requestId: string };
const text = { type: 'string', minLength: 1, maxLength: 160 };
/** Human direct manipulation. No model execution, paid grant or automatic generation. */
export function editStoryboard(s: ProductionService, projectId: string, input: Edit, key: string) {
  s.recovery.assertWritable(projectId);
  return s.store.command(`local-user:${projectId}:storyboard`, key, digest(input), () => {
    const before = s.store.getProject(projectId);
    invariant(before.headVersion === input.expectedHeadVersion, 'REVISION_CONFLICT', 'The storyboard changed; reload before saving this edit.');
    invariant(!s.store.list<{ state: string }>('plan_import', projectId).some(x => x.state === 'pending'), 'IMPORT_PENDING', 'Confirm or discard the imported plan before editing.');
    let next = structuredClone(before);
    const changed = new Set<string>(); let global = false;
    const shot = () => { const row = next.shots.find(x => x.id === input.id); invariant(row, 'NOT_FOUND', 'Shot does not belong to this film.'); return row; };
    const value = () => { invariant(typeof input.value === 'string' && input.value.trim() && input.value.length <= 16000, 'VALIDATION_ERROR', 'Enter a nonempty value.'); return input.value.trim(); };
    if (input.kind === 'treatment') { invariant(input.field === 'brief' || input.field === 'story', 'VALIDATION_ERROR', 'Unknown treatment field.'); next[input.field] = value(); global = true; }
    else if (input.kind === 'scene') { const row = next.scenes.find(x => x.id === input.id); invariant(row, 'NOT_FOUND', 'Scene does not belong to this film.'); row.purpose = value(); row.revisionId = newId(); next.shots.filter(x => x.sceneId === row.id).forEach(x => changed.add(x.id)); }
    else if (input.kind === 'addScene') { next.scenes.push({ id: newId(), revisionId: newId(), purpose: input.value?.trim() || 'New scene' }); global = true; }
    else if (input.kind === 'addShot') {
      invariant(next.scenes.some(x => x.id === input.sceneId), 'NOT_FOUND', 'Choose a scene in this film.');
      next.shots.push({ id: newId(), revisionId: newId(), sceneId: input.sceneId!, purpose: 'New shot', action: 'Describe the action', framing: 'Describe the visual direction', motion: 'Describe the camera movement', desiredFrames: 180, imagePrompt: 'Pending direction', videoPrompt: 'Pending direction', promptIntent: { image: '', video: '' }, referenceArtifactIds: [], cueId: null }); global = true;
    } else if (input.kind === 'shot') {
      const row = shot(); invariant(['purpose', 'framing', 'motion', 'desiredFrames'].includes(input.field ?? ''), 'VALIDATION_ERROR', 'Unknown shot field.');
      if (input.field === 'desiredFrames') { const frames = Number(value()); invariant(Number.isSafeInteger(frames) && frames >= 90 && frames <= 450, 'VALIDATION_ERROR', 'Use 3–15 seconds per shot.'); row.desiredFrames = frames; }
      else row[input.field as 'purpose' | 'framing' | 'motion'] = value();
      row.revisionId = newId(); changed.add(row.id);
      // Old prompts stay bound to their old intent until the director reauthors them.
    } else if (input.kind === 'deleteShot') { const row = shot(); changed.add(row.id); next.shots = next.shots.filter(x => x.id !== row.id); global = true; }
    else if (input.kind === 'moveShot') {
      const row = shot(); invariant(next.scenes.some(x => x.id === input.sceneId), 'NOT_FOUND', 'Choose a destination scene.');
      const target = input.beforeId ? next.shots.find(x => x.id === input.beforeId && x.sceneId === input.sceneId && x.id !== row.id) : null;
      invariant(!input.beforeId || target, 'VALIDATION_ERROR', 'Invalid reorder target.');
      next.shots = next.shots.filter(x => x.id !== row.id); row.sceneId = input.sceneId!;
      const last = next.shots.map(x => x.sceneId).lastIndexOf(row.sceneId);
      const at = target ? next.shots.findIndex(x => x.id === target.id) : last < 0 ? next.shots.length : last + 1;
      next.shots.splice(at, 0, row); global = true;
    } else if (input.kind === 'narration') {
      const row = shot(), draft = row.narration ?? { mode: 'undecided', text: '', voice: 'stock' };
      if (input.field === 'mode') { invariant(['none', 'generated', 'uploaded'].includes(input.value ?? ''), 'VALIDATION_ERROR', 'Invalid narration choice.'); draft.mode = input.value as 'none' | 'generated' | 'uploaded'; }
      else if (input.field === 'text') draft.text = input.value ?? '';
      else { invariant(input.field === 'voice' && ['stock', 'personal'].includes(input.value ?? ''), 'VALIDATION_ERROR', 'Invalid voice choice.'); draft.voice = input.value as 'stock' | 'personal'; }
      row.narration = draft; row.revisionId = newId(); changed.add(row.id);
    } else if (input.kind === 'soundtrack') {
      if (input.field === 'audioId') {
        if (!input.value) next.soundtrack = null;
        else { const audio = s.store.get<NarrationAudio>('narration_audio', input.value); invariant(audio?.projectId === projectId && audio.media.kind === 'audio', 'NOT_FOUND', 'Choose a recording owned by this film.'); next.soundtrack = { audioId: audio.id, gainMilliDb: next.soundtrack?.gainMilliDb ?? -18000 }; }
      } else { invariant(input.field === 'gainMilliDb' && next.soundtrack, 'VALIDATION_ERROR', 'Select music first.'); const gain = Number(input.value); invariant(Number.isSafeInteger(gain) && gain >= -60000 && gain <= 0, 'VALIDATION_ERROR', 'Use a gain between -60 and 0 dB.'); next.soundtrack.gainMilliDb = gain; }
      global = true;
    } else if (input.kind === 'undo') {
      const saved = s.store.get<SavedEdit>('storyboard_edit', input.commandId ?? '');
      invariant(saved && saved.before.id === projectId && saved.headVersion === before.headVersion, 'REVISION_CONFLICT', 'Only the latest unchanged edit can be undone.');
      next = { ...structuredClone(saved.before), headVersion: before.headVersion, activePlanId: before.activePlanId }; global = true;
      for (const row of [...before.shots, ...next.shots]) { const a = before.shots.find(x => x.id === row.id), b = next.shots.find(x => x.id === row.id); if (digest(a ?? null) !== digest(b ?? null)) changed.add(row.id); }
    } else invariant(false, 'VALIDATION_ERROR', 'Unknown storyboard command.');
    invariant(next.shots.length <= 64 && next.scenes.length <= 64 && next.shots.reduce((n, x) => n + x.desiredFrames, 0) <= next.maxFrames, 'VALIDATION_ERROR', 'Keep the film within 64 shots and six minutes.');
    const previous = s.store.list<SavedEdit>('storyboard_edit', projectId).at(-1);
    const inherited = previous ? s.store.list<{ ownerId: string; scopeId: string; active: boolean }>('hold', projectId).filter(x => x.active && x.ownerId === previous.requestId).map(x => x.scopeId) : [];
    const scopes = global || inherited.includes(projectId) ? [projectId] : [...new Set([...changed, ...inherited])].filter(id => before.shots.some(x => x.id === id));
    const actor = s.beginRequest(projectId, 'local-user', `Storyboard edit: ${input.kind}${input.field ? ` ${input.field}` : ''}. Preserve unaffected work and replan only what this edit requires.`, { key: `storyboard:${key}`, editing: true, scopeIds: scopes.length ? scopes : [projectId], ...(inherited.length ? { continuationRequestId: previous!.requestId } : {}) });
    const request = s.store.get<Record<string, unknown>>('message', actor.requestId)!;
    s.store.put('message', actor.requestId, projectId, { ...request, source: 'storyboard' });
    const bindings = s.store.list<NodeBinding>('node_binding', projectId).filter(x => x.state === 'active' && x.planId === before.activePlanId);
    const affected = new Set(bindings.filter(x => ['timeline', 'render'].includes(x.node.kind) || (input.kind === 'treatment' || input.kind === 'undo' && (next.brief !== before.brief || next.story !== before.story)) || changed.has(x.node.shotId ?? '') && !(input.kind === 'narration' && ['image','video'].includes(x.node.kind)) && !(input.kind === 'shot' && input.field === 'motion' && x.node.kind === 'image')).map(x => x.id));
    for (let grew = true; grew;) { grew = false; for (const b of bindings) if (!affected.has(b.id) && (b.node.inputs.some(x => x.source.kind === 'output' && affected.has(x.source.nodeId)) || b.node.requires.some(id => affected.has(id)))) { affected.add(b.id); grew = true; } }
    for (const b of bindings.filter(x => affected.has(x.id))) s.store.put('node_binding', b.id, projectId, { ...b, candidateId: null, outputs: {} });
    // Existing in-flight attempts retain their durable receipts and cannot publish into detached candidates.
    next = s.store.saveProject({ ...next, revisionId: newId() }, before.headVersion);
    s.store.insert('project_revision', next.revisionId, projectId, { project: next });
    const id = newId(); s.store.insert('storyboard_edit', id, projectId, { id, before, headVersion: next.headVersion, requestId: actor.requestId });
    s.store.appendEvent(projectId, 'storyboard.edited', { commandId: id, kind: input.kind, headVersion: next.headVersion, affectedNodeIds: [...affected] });
    return { commandId: id, headVersion: next.headVersion, requestId: actor.requestId };
  });
}
export function registerStoryboard(app: FastifyInstance, service: () => ProductionService) {
  app.post<{ Params: { projectId: string }; Body: Edit }>('/api/projects/:projectId/storyboard', { schema: { body: { type: 'object', additionalProperties: false, required: ['kind', 'expectedHeadVersion'], properties: {
    kind: { enum: ['treatment','scene','addScene','shot','addShot','deleteShot','moveShot','narration','undo','soundtrack'] }, expectedHeadVersion: { type: 'integer', minimum: 0 }, id: text, sceneId: text, beforeId: text, commandId: text, field: text, value: { type: 'string', maxLength: 16000 },
  } } } }, async request => {
    const key = request.headers['idempotency-key']; invariant(typeof key === 'string', 'VALIDATION_ERROR', 'A command identity is required.');
    return editStoryboard(service(), request.params.projectId, request.body, key);
  });
}
