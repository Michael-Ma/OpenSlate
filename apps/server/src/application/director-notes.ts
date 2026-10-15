import { canonical, digest, invariant, newId } from '@openslate/core';
import type { ActorContext, DirectorNote, ProjectRecord, ResolveNoteInput } from '@openslate/core';
import type { FastifyInstance } from 'fastify';
import type { Store } from '../persistence/store.js';
import type { ProductionService, RequestRecord } from './service.js';
import { requiredCommandKey } from './command-key.js';

export type NoteInput = Pick<DirectorNote, 'anchor' | 'kind' | 'blocking' | 'text' | 'seenKeyframe' | 'choices'>;
interface NoteBasis { projectId: string; invocationId: string; argumentsDigest: string; requestId: string; epochId: string; shots: { id: string; revisionId: string }[] }
const shotsFor = (project: ProjectRecord, anchor: DirectorNote['anchor']) => project.shots.filter(shot => anchor.shotIds?.includes(shot.id) || (!anchor.shotIds && anchor.sceneId === shot.sceneId));
function letter(index: number): string {
  let value = '';
  do { value = String.fromCharCode(97 + index % 26) + value; index = Math.floor(index / 26) - 1; } while (index >= 0);
  return value;
}
/** Derive staleness without mutating during reads, including installation recovery. Resolution is durable. */
export function directorNotes(store: Store, projectId: string): DirectorNote[] {
  const project = store.getProject(projectId);
  return store.list<DirectorNote>('director_note', projectId).map(note => {
    if (note.state !== 'open') return note;
    const basis = store.get<NoteBasis>('director_note_basis', note.noteId);
    const changed = !basis || (note.anchor.sceneId && !project.scenes.some(s => s.id === note.anchor.sceneId))
      || basis.shots.some(pin => !project.shots.some(s => s.id === pin.id && s.revisionId === pin.revisionId))
      || canonical(shotsFor(project, note.anchor).map(s => s.id).sort()) !== canonical(basis.shots.map(s => s.id).sort());
    const seen = note.seenKeyframe;
    const current = seen ? store.list<{ state: string; planId: string; node: { shotId?: string; kind: string }; outputs: Record<string, { artifactId: string; sha256: string }> }>('node_binding', projectId)
      .filter(b => b.state === 'active' && b.planId === project.activePlanId && b.node.kind === 'image' && b.node.shotId === seen.shotId).flatMap(b => Object.values(b.outputs)) : [];
    return changed || (seen && !current.some(a => a.sha256 === seen.sha256)) ? { ...note, state: 'stale' } : note;
  });
}
export function sceneNotes(store: Store, projectId: string, sceneId: string): DirectorNote[] {
  const shotIds = new Set(store.getProject(projectId).shots.filter(s => s.sceneId === sceneId).map(s => s.id));
  return directorNotes(store, projectId).filter(note => note.anchor.sceneId === sceneId || note.anchor.shotIds?.some(id => shotIds.has(id)));
}
export function openBlockingNotes(store: Store, projectId: string, sceneId: string): DirectorNote[] {
  return sceneNotes(store, projectId, sceneId).filter(note => note.state === 'open' && note.blocking);
}
export function recordNotes(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string, input: { notes: NoteInput[] }) {
  return service.store.transaction(() => {
    service.assertActor(projectId, actor);
    invariant(actor.kind === 'director', 'ACTOR_DENIED', 'Notes require a Director epoch');
    const store = service.store, project = store.getProject(projectId), request = store.get<RequestRecord>('message', actor.requestId)!;
    const turn = store.list<{ id: string; requestId: string; epochId: string }>('director_turn', projectId).find(t => t.epochId === actor.epochId && t.requestId === actor.requestId);
    invariant(turn, 'ACTOR_DENIED', 'Notes require their application-owned turn');
    const allows = (id: string) => request.scopeIds.includes(projectId) || request.scopeIds.includes(id) || project.shots.some(s => s.id === id && request.scopeIds.includes(s.sceneId));
    const start = store.list<DirectorNote>('director_note', projectId).filter(n => n.turnId === turn.id).length;
    const notes = input.notes.map((input, index): DirectorNote => {
      const anchor = input.anchor, shots = shotsFor(project, anchor);
      invariant(!anchor.sceneId || project.scenes.some(s => s.id === anchor.sceneId) && allows(anchor.sceneId), 'SCOPE_DENIED', 'Note scene exceeds this request');
      invariant(!anchor.shotIds || anchor.shotIds.every(id => project.shots.some(s => s.id === id && (!anchor.sceneId || s.sceneId === anchor.sceneId)) && allows(id)), 'SCOPE_DENIED', 'Note shots exceed this request');
      invariant(shots.every(s => allows(s.id)), 'SCOPE_DENIED', 'Note anchor exceeds this request');
      const ids = new Set(shots.map(s => s.id));
      for (const choice of input.choices) {
        if (choice.kind === 'edit_field') invariant(ids.has(choice.shotId), 'SCOPE_DENIED', 'Edit choice must target an anchored shot');
        if (choice.kind === 'regenerate_keyframe') invariant(choice.shotIds.every(id => ids.has(id)), 'SCOPE_DENIED', 'Regeneration choice must target anchored shots');
      }
      invariant(!input.blocking || input.choices.some(c => c.kind === 'accept'), 'VALIDATION_ERROR', 'Blocking notes must offer a keep choice');
      if (input.seenKeyframe) {
        const seen = input.seenKeyframe;
        const evidence = store.list<{ epochId: string; snapshot: { attachedKeyframes?: { shotId: string; artifactId: string; sha256: string }[] } }>('director_context', projectId)
          .filter(c => c.epochId === actor.epochId).flatMap(c => c.snapshot.attachedKeyframes ?? []);
        invariant(ids.has(seen.shotId) && evidence.some(e => canonical(e) === canonical(seen)), 'SCOPE_DENIED', 'The Director was not shown this exact keyframe');
      }
      return { ...structuredClone(input), noteId: newId(), requestId: actor.requestId, turnId: turn.id, letter: letter(start + index), state: 'open', version: 1, createdAt: new Date().toISOString() };
    });
    for (const note of notes) {
      store.insert('director_note', note.noteId, projectId, note);
      store.insert('director_note_basis', note.noteId, projectId, { projectId, invocationId, argumentsDigest: digest(input), requestId: actor.requestId, epochId: actor.epochId,
        shots: shotsFor(project, note.anchor).map(s => ({ id: s.id, revisionId: s.revisionId })) } satisfies NoteBasis);
      store.appendEvent(projectId, 'director.note', { noteId: note.noteId, requestId: actor.requestId, turnId: turn.id, letter: note.letter });
    }
    const receipt = { notes: notes.map(n => ({ noteId: n.noteId, letter: n.letter })) };
    store.insert('director_notes_receipt', invocationId, projectId, { projectId, epochId: actor.epochId, requestId: actor.requestId, argumentsDigest: digest(input), receipt });
    return receipt;
  });
}

export function resolveNote(service: ProductionService, projectId: string, noteId: string, input: ResolveNoteInput, key: string): DirectorNote {
  service.recovery.assertWritable(projectId);
  return service.store.command(`local-user:${projectId}:resolve-note`, key, digest({ noteId, ...input }), () => {
    const store = service.store, note = directorNotes(store, projectId).find(n => n.noteId === noteId);
    invariant(note, 'NOT_FOUND', 'Note does not belong to this project');
    invariant(note.version === input.expectedVersion && note.state !== 'resolved', 'REVISION_CONFLICT', 'This note has already changed');
    invariant(Number.isSafeInteger(input.choiceIndex) && Number.isSafeInteger(input.expectedVersion) && Object.keys(input).every(k => ['choiceIndex', 'expectedVersion', 'resultRef'].includes(k)), 'VALIDATION_ERROR', 'Choose a valid note action');
    const events = store.readEvents(projectId);
    const noteSequence = events.find(e => e.kind === 'director.note' && e.payload.noteId === noteId)?.sequence ?? Infinity;
    const choice = note.choices[input.choiceIndex];
    invariant(choice, 'VALIDATION_ERROR', 'Choose an action on this note');
    invariant(choice.kind !== 'proposal', 'PROPOSAL_UNAVAILABLE', 'Held proposals are not available yet');
    if (choice.kind === 'accept' || choice.kind === 'reply') invariant(note.state === 'open', 'NOTE_STALE', 'This note is no longer current');
    if (choice.kind === 'reply') {
      const reply = store.get<RequestRecord>('message', input.resultRef ?? '');
      invariant(reply?.projectId === projectId && reply.principalId === 'local-user' && reply.source === 'user'
        && events.some(e => e.kind === 'message.recorded' && e.payload.requestId === input.resultRef && e.sequence > noteSequence), 'NOTE_RESULT_INVALID', 'Link the human reply to this note');
    }
    if (choice.kind === 'regenerate_keyframe') {
      const action = store.get<{ regenerate: boolean; shotIds: string[] }>('scene_generation_action', input.resultRef ?? '');
      const row = store.db.prepare("SELECT result FROM commands WHERE actor_scope=? AND json_extract(result,'$.requestId')=? AND json_extract(result,'$.kind')='image'")
        .get(`local-user:${projectId}:scene-generation`, input.resultRef ?? '') as { result: string } | undefined;
      const result = row ? JSON.parse(row.result) as { shotIds: string[] } : null;
      const request = input.resultRef ? store.get<RequestRecord>('message', input.resultRef) : null;
      invariant(result && request?.projectId === projectId && request.principalId === 'local-user' && request.source === 'app'
        && action?.regenerate && choice.shotIds.every(id => result.shotIds.includes(id) && action.shotIds.includes(id))
        && events.some(e => e.kind === 'message.recorded' && e.payload.requestId === input.resultRef && e.sequence > noteSequence), 'NOTE_RESULT_INVALID', 'Link the human keyframe generation request');
    } else if (choice.kind === 'edit_field') {
      const edit = store.get<{ before: ProjectRecord; requestId: string; headVersion: number }>('storyboard_edit', input.resultRef ?? '');
      const request = edit ? store.get<RequestRecord>('message', edit.requestId) : null;
      const revision = store.list<{ project: ProjectRecord }>('project_revision', projectId).find(r => r.project.headVersion === edit?.headVersion)?.project;
      const before = edit?.before.shots.find(s => s.id === choice.shotId), after = revision?.shots.find(s => s.id === choice.shotId);
      invariant(edit?.before.id === projectId && request?.principalId === 'local-user' && request.source === 'app' && events.some(e => e.kind === 'storyboard.edited' && e.payload.commandId === input.resultRef && e.sequence > noteSequence) && before && after
        && canonical(before[choice.field] ?? null) !== canonical(after[choice.field] ?? null), 'NOTE_RESULT_INVALID', 'Link the human edit of this field');
    }
    const resolved: DirectorNote = { ...note, state: 'resolved', version: note.version + 1, resolution: { choiceIndex: input.choiceIndex, at: new Date().toISOString(), ...(input.resultRef ? { resultRef: input.resultRef } : {}) } };
    store.put('director_note', noteId, projectId, resolved);
    store.appendEvent(projectId, 'director.note_resolved', { noteId, resolution: resolved.resolution! });
    return resolved;
  });
}
export function registerDirectorNotes(app: FastifyInstance, service: () => ProductionService): void {
  app.post<{ Params: { projectId: string; noteId: string }; Body: ResolveNoteInput }>('/api/projects/:projectId/director/notes/:noteId/resolve', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['choiceIndex', 'expectedVersion'], properties: {
      choiceIndex: { type: 'integer', minimum: 0, maximum: 2 }, expectedVersion: { type: 'integer', minimum: 1 }, resultRef: { type: 'string', minLength: 1, maxLength: 160 },
    } } },
  }, async request => resolveNote(service(), request.params.projectId, request.params.noteId, request.body, requiredCommandKey(request)));
}
