import { invariant } from '@openslate/core';
import type { ActorContext, NoteChoice, ProjectRecord } from '@openslate/core';
import type { ProductionService, RequestRecord } from './service.js';
import { requestSource } from './request-source.js';
import { editStoryboard, type StoryboardEditOrigin } from '../storyboard.js';
import { shotTakes, useShotTake } from '../shot-takes.js';
import { assertNoRunningAttempts } from '../project-library.js';
import { executionControlCommand } from './execution-controls.js';
import { proposalCommand, type ProposalRecord } from './director-proposals.js';
import { recordConfirmationCard } from './director-notes.js';
import type { ExportLauncher } from '../media/export-launcher.js';
import type { NodeBinding } from '../execution/engine.js';

/**
 * Contract 7.0.0 Director edits. Each free tool runs the exact command behind the person's button (storyboard,
 * export, stop) under a Director-derived command key; destructive or paid-resuming tools only write a confirmation
 * card, and the person's click on it runs the same command (applyConfirmationCard).
 */
type CardChoice = Extract<NoteChoice, { kind: 'confirm_delete_shots' | 'confirm_delete_scene' | 'use_take' | 'confirm_resume' }>;

/** A fresh, typed human editing conversation, as for make_keyframes; no spending and no pause check. */
export function assertDirectorEditAuthority(service: ProductionService, projectId: string, actor: ActorContext): { request: RequestRecord; project: ProjectRecord } {
  invariant(actor.kind === 'director', 'ORIGIN_NOT_AUTHORIZED', 'Director edits require an editing conversation epoch');
  service.recovery.assertWritable(projectId, actor.requestId);
  service.assertActor(projectId, actor, true);
  const store = service.store, request = store.get<RequestRecord>('message', actor.requestId);
  invariant(request?.projectId === projectId && request.principalId === actor.principalId && request.state === 'active'
    && request.editing === true && requestSource(store, request) === 'user'
    && !store.get('keyframe_review_request', actor.requestId)
    && !store.list<{ answerRequestId?: string; requestId: string }>('director_question', projectId)
      .some(question => question.answerRequestId === actor.requestId && !!store.get('keyframe_review_request', question.requestId)),
  'ORIGIN_NOT_AUTHORIZED', 'Only a fresh human editing conversation may change the film');
  return { request, project: store.getProject(projectId) };
}
/** The request scope bounds what may change; the tool's arguments only select within it. */
function covers(project: ProjectRecord, request: RequestRecord, id: string): boolean {
  return request.scopeIds.includes(project.id) || request.scopeIds.includes(id)
    || project.shots.some(shot => shot.id === id && request.scopeIds.includes(shot.sceneId));
}
const wholeFilm = (project: ProjectRecord, request: RequestRecord, what: string): void =>
  invariant(request.scopeIds.includes(project.id), 'SCOPE_DENIED', `${what} changes the whole film; this conversation is limited to part of it`);
const origin = (actor: ActorContext, invocationId: string): StoryboardEditOrigin => {
  invariant(actor.kind === 'director', 'ACTOR_DENIED', 'A Director epoch is required');
  return { director: { requestId: actor.requestId, epochId: actor.epochId, invocationId } };
};
const key = (invocationId: string, part?: string) => `director-tool:${invocationId}${part ? `:${part}` : ''}`;

export interface SetSoundtrackInput { audioId?: string | null; startFrame?: number; gainMilliDb?: number; muted?: boolean }
export function setSoundtrack(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string, input: SetSoundtrackInput) {
  return service.store.transaction(() => {
    const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
    wholeFilm(project, request, 'Music');
    const commandIds: string[] = [];
    // Field order matches the person's Film menu: choose the recording before its start, gain or mute.
    for (const field of ['audioId', 'startFrame', 'gainMilliDb', 'muted'] as const) {
      if (!Object.hasOwn(input, field)) continue;
      const raw = input[field], value = raw === null ? '' : String(raw);
      const head = service.store.getProject(projectId).headVersion;
      commandIds.push(editStoryboard(service, projectId, { kind: 'soundtrack', field, value, expectedHeadVersion: head }, key(invocationId, field), origin(actor, invocationId)).commandId);
    }
    const saved = service.store.getProject(projectId);
    return { soundtrack: saved.soundtrack ?? null, headVersion: saved.headVersion, commandIds,
      undo: 'undo_edit with the last commandId restores the field it changed. The person can also change music in Film.' };
  });
}

export function moveShot(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string, input: { shotId: string; sceneId: string; beforeId?: string }) {
  return service.store.transaction(() => {
    const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
    invariant(project.shots.some(shot => shot.id === input.shotId), 'NOT_FOUND', 'Shot does not belong to this film.');
    invariant(covers(project, request, input.shotId) && covers(project, request, input.sceneId), 'SCOPE_DENIED', 'The shot or destination scene is outside this conversation');
    const result = editStoryboard(service, projectId, { kind: 'moveShot', id: input.shotId, sceneId: input.sceneId, ...(input.beforeId ? { beforeId: input.beforeId } : {}),
      expectedHeadVersion: project.headVersion }, key(invocationId), origin(actor, invocationId));
    const saved = service.store.getProject(projectId);
    return { commandId: result.commandId, headVersion: result.headVersion, sceneId: input.sceneId,
      shotOrder: saved.shots.filter(shot => shot.sceneId === input.sceneId).map(shot => shot.id) };
  });
}

export function moveScene(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string, input: { sceneId: string; beforeId?: string }) {
  return service.store.transaction(() => {
    const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
    invariant(project.scenes.some(scene => scene.id === input.sceneId), 'NOT_FOUND', 'Scene does not belong to this film.');
    invariant(covers(project, request, input.sceneId), 'SCOPE_DENIED', 'The scene is outside this conversation');
    const result = editStoryboard(service, projectId, { kind: 'moveScene', id: input.sceneId, ...(input.beforeId ? { beforeId: input.beforeId } : {}),
      expectedHeadVersion: project.headVersion }, key(invocationId), origin(actor, invocationId));
    return { commandId: result.commandId, headVersion: result.headVersion, sceneOrder: service.store.getProject(projectId).scenes.map(scene => scene.id) };
  });
}

export async function startExport(service: ProductionService, exports: ExportLauncher | undefined, projectId: string, actor: ActorContext, invocationId: string) {
  const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
  wholeFilm(project, request, 'Export');
  invariant(exports, 'TOOL_CAPABILITY_UNAVAILABLE', 'Local export is not configured on this server');
  const record = await exports.start(projectId, { expectedHeadVersion: project.headVersion }, key(invocationId));
  return { export: record, next: 'Report the export state as returned. The finished file appears in Film; earlier exports stay listed.' };
}

export function undoEdit(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string, input: { commandId: string }) {
  return service.store.transaction(() => {
    const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
    const edit = service.store.get<{ before: ProjectRecord; origin?: StoryboardEditOrigin }>('storyboard_edit', input.commandId);
    if (edit?.before.id === projectId) {
      const own = !!edit.origin && 'requestId' in edit.origin.director && edit.origin.director.requestId === actor.requestId;
      invariant(own || request.scopeIds.includes(projectId), 'SCOPE_DENIED', 'Undoing work from outside this conversation requires whole-film scope');
      const result = editStoryboard(service, projectId, { kind: 'undo', commandId: input.commandId, expectedHeadVersion: project.headVersion }, key(invocationId), origin(actor, invocationId));
      return { undone: 'storyboard_command', commandId: input.commandId, undoCommandId: result.commandId, headVersion: result.headVersion };
    }
    const proposal = service.store.get<ProposalRecord>('director_proposal', input.commandId);
    invariant(proposal?.projectId === projectId, 'UNDO_UNAVAILABLE', 'No storyboard command or accepted proposal of this film has that ID.');
    const own = proposal.decision?.requestId === actor.requestId;
    invariant(own || request.scopeIds.includes(projectId), 'SCOPE_DENIED', 'Undoing work from outside this conversation requires whole-film scope');
    // The person's proposal Undo, unchanged: it restores only fields nobody changed since.
    const receipt = proposalCommand(service, projectId, proposal.id, 'undo', key(invocationId));
    return { undone: 'proposal', proposalId: proposal.id, state: receipt.proposal.state, leftAlone: receipt.leftAlone ?? [] };
  });
}

export function stopFilm(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string) {
  const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
  wholeFilm(project, request, 'Stop');
  // The person's Stop: it supersedes this conversation too, so it must be the turn's last call.
  const result = executionControlCommand(service, projectId, { action: 'stop' }, key(invocationId));
  return { ...result, next: 'Stopped. This conversation has ended; new generation waits until the person continues.' };
}

const paidOutputs = (service: ProductionService, project: ProjectRecord, shotIds: readonly string[]) => {
  const bindings = service.store.list<NodeBinding>('node_binding', project.id).filter(b => b.state === 'active' && b.planId === project.activePlanId
    && shotIds.includes(b.node.shotId ?? '') && Object.keys(b.outputs).length > 0);
  return { keyframes: bindings.filter(b => b.node.kind === 'image').length, clips: bindings.filter(b => b.node.kind === 'video').length };
};
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const cardReceipt = (note: { noteId: string; letter: string }) => ({ state: 'awaiting_confirmation', noteId: note.noteId, letter: note.letter, applied: false,
  next: 'Nothing has changed. The person confirms on the card in this chat; a chat reply does not apply it. Report the card and wait.' });

export function requestDeleteShots(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string, input: { shotIds: string[] }) {
  const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
  for (const id of input.shotIds) invariant(project.shots.some(shot => shot.id === id), 'NOT_FOUND', 'A shot does not belong to this film.');
  invariant(input.shotIds.every(id => covers(project, request, id)), 'SCOPE_DENIED', 'A shot is outside this conversation');
  assertNoRunningAttempts(service, projectId, new Set(input.shotIds));
  const media = paidOutputs(service, project, input.shotIds);
  const note = recordConfirmationCard(service, projectId, actor, invocationId, { anchor: { shotIds: [...input.shotIds] },
    text: `Delete ${plural(input.shotIds.length, 'shot')}? ${plural(media.keyframes, 'keyframe')} and ${plural(media.clips, 'clip')} leave the timeline. Undo stays available.`,
    choice: { kind: 'confirm_delete_shots', shotIds: [...input.shotIds] }, keepLabel: 'Keep them' });
  return { ...cardReceipt(note), paidMedia: media };
}

export function requestDeleteScene(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string, input: { sceneId: string; withShots?: boolean }) {
  const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
  invariant(project.scenes.some(scene => scene.id === input.sceneId), 'NOT_FOUND', 'Scene does not belong to this film.');
  invariant(covers(project, request, input.sceneId), 'SCOPE_DENIED', 'The scene is outside this conversation');
  const shotIds = project.shots.filter(shot => shot.sceneId === input.sceneId).map(shot => shot.id);
  invariant(!shotIds.length || input.withShots === true, 'SCENE_HAS_SHOTS', 'Confirm deletion of this scene and its shots.');
  assertNoRunningAttempts(service, projectId, new Set(shotIds));
  const media = paidOutputs(service, project, shotIds);
  const note = recordConfirmationCard(service, projectId, actor, invocationId, { anchor: { sceneId: input.sceneId },
    text: `Delete this scene${shotIds.length ? ` and its ${plural(shotIds.length, 'shot')}` : ''}? ${plural(media.keyframes, 'keyframe')} and ${plural(media.clips, 'clip')} leave the timeline. Undo stays available.`,
    choice: { kind: 'confirm_delete_scene', sceneId: input.sceneId, withShots: shotIds.length > 0 }, keepLabel: 'Keep it' });
  return { ...cardReceipt(note), shotCount: shotIds.length, paidMedia: media };
}

export function requestUseTake(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string, input: { shotId: string; artifactId: string }) {
  const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
  invariant(project.shots.some(shot => shot.id === input.shotId), 'NOT_FOUND', 'Shot does not belong to this film.');
  invariant(covers(project, request, input.shotId), 'SCOPE_DENIED', 'The shot is outside this conversation');
  const take = shotTakes(service, projectId, input.shotId).keyframes.find(item => item.artifact.artifactId === input.artifactId);
  invariant(take, 'NOT_FOUND', 'Choose an earlier keyframe of this shot');
  invariant(take.selectable, 'TAKE_NOT_SELECTABLE', 'This frame uses a conditioning source this shot cannot switch to; generate a shot keyframe first');
  invariant(!take.current, 'ALREADY_COMPLETE', 'This keyframe is already current');
  const note = recordConfirmationCard(service, projectId, actor, invocationId, { anchor: { shotIds: [input.shotId] },
    text: 'Use this earlier keyframe? The shot\'s clip will need confirming and generating again. Undo stays available.',
    choice: { kind: 'use_take', shotId: input.shotId, artifactId: input.artifactId }, keepLabel: 'Keep current' });
  return cardReceipt(note);
}

export function requestResume(service: ProductionService, projectId: string, actor: ActorContext, invocationId: string) {
  const { request, project } = assertDirectorEditAuthority(service, projectId, actor);
  wholeFilm(project, request, 'Continue');
  const control = service.store.get<{ paused: boolean; authorityId: string }>('execution_control', projectId);
  invariant(control?.paused, 'NOT_STOPPED', 'The film is not stopped; nothing needs continuing.');
  const stopped = service.stopView(projectId);
  const note = recordConfirmationCard(service, projectId, actor, invocationId, { anchor: {},
    text: `Continue stopped work? ${stopped ? `${plural(stopped.detachedJobs, 'unsent job')} may start again and cost money.` : 'Queued paid work may start again.'}`,
    choice: { kind: 'confirm_resume', expectedAuthorityId: control.authorityId ?? null }, keepLabel: 'Stay stopped' });
  return cardReceipt(note);
}

/** The person's click on a card: run their own command. Called only from resolveNote's human command. */
export function applyConfirmationCard(service: ProductionService, projectId: string, noteId: string, choice: CardChoice, commandKey: string): string {
  const cardOrigin: StoryboardEditOrigin = { director: { noteId } };
  const head = () => service.store.getProject(projectId).headVersion;
  switch (choice.kind) {
    case 'confirm_delete_shots': return editStoryboard(service, projectId, { kind: 'deleteShots', ids: [...choice.shotIds], expectedHeadVersion: head() }, `note-card:${commandKey}`, cardOrigin).commandId;
    case 'confirm_delete_scene': return editStoryboard(service, projectId, { kind: 'deleteScene', id: choice.sceneId, withShots: choice.withShots, expectedHeadVersion: head() }, `note-card:${commandKey}`, cardOrigin).commandId;
    case 'use_take': return useShotTake(service, projectId, choice.shotId, choice.artifactId, `note-card:${commandKey}`).commandId;
    case 'confirm_resume': return executionControlCommand(service, projectId, { action: 'resume', expectedAuthorityId: choice.expectedAuthorityId }, `note-card:${commandKey}`).requestId;
  }
}
