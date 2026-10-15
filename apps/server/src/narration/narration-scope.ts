import { canonical, digest, invariant, newId } from '@openslate/core';
import type { ActorContext, ProjectRecord } from '@openslate/core';
import type { Store } from '../persistence/store.js';
import type { ProductionService } from '../application/service.js';
import type { NarrationState } from './types.js';
import { isProxy } from 'node:util/types';
import { earlierRequestHoldIds, assertRequestHoldCutoff } from './request-holds.js';

type Reader = Pick<Store, 'get' | 'getProject' | 'db'>;
export interface NarrationSession { id: string; projectId: string; requestId: string; principalId: 'local-user'; shotId?: string }
export interface NarrationShotScope { id: string; version: 1; projectId: string; requestId: string; sessionId: string; principalId: 'local-user'; shotId: string }
interface ScopeTarget { id: string; version: 1; projectId: string; requestId: string; shotId: string; segmentId: string; scopeDigest: string }
interface Message { id: string; projectId: string; principalId: string; editing: boolean; scopeIds: string[] }
const fail = (value: unknown, message: string): void => invariant(value, 'SCOPE_DENIED', message);
interface RequestedShotScope { id: string; version: 1; projectId: string; requestId: string; principalId: string; segmentId: string; shotId: string; projectRevisionId: string; projectDigest: string }
export function assertRequestedNarrationShotScope(reader: Reader, projectId: string, input: unknown): asserts input is RequestedShotScope {
  fail(input && typeof input === 'object' && !Array.isArray(input) && !isProxy(input), 'Requested narration mapping is invalid');
  const descriptors = Object.getOwnPropertyDescriptors(input!);
  fail((Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null) && Object.getOwnPropertySymbols(input!).length === 0
    && Object.values(descriptors).every(field => field.enumerable && Object.hasOwn(field, 'value')), 'Requested narration mapping must contain only plain saved data');
  const mapping = input as RequestedShotScope;
  fail(Object.keys(mapping).sort().join('\0') === ['id','version','projectId','requestId','principalId','segmentId','shotId','projectRevisionId','projectDigest'].sort().join('\0')
    && mapping.version === 1 && mapping.projectId === projectId && [mapping.id,mapping.requestId,mapping.principalId,mapping.segmentId,mapping.shotId,mapping.projectRevisionId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 160)
    && /^[a-f0-9]{64}$/.test(mapping.projectDigest) && mapping.id === digest({ projectId, requestId: mapping.requestId, segmentId: mapping.segmentId }), 'Requested narration mapping changed');
  const request = record<Message>(reader, 'message', mapping.requestId, projectId);
  const meta = reader.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='project_revision' AND id=?").get(mapping.projectRevisionId) as { project_id: string; bytes: number } | undefined;
  fail(meta?.project_id === projectId && meta.bytes > 0 && meta.bytes <= 8 * 1024 * 1024, 'Requested narration lost its saved shot revision');
  const saved = reader.get<{ project: ProjectRecord }>('project_revision', mapping.projectRevisionId)?.project;
  const shot = saved?.shots.find(shot => shot.id === mapping.shotId);
  fail(request?.id === mapping.requestId && request.projectId === projectId && request.principalId === mapping.principalId && request.editing && Array.isArray(request.scopeIds) && request.scopeIds.length <= 400 && saved?.id === projectId
    && saved.revisionId === mapping.projectRevisionId && digest(saved) === mapping.projectDigest && shot && (request.scopeIds.includes(projectId) || request.scopeIds.includes(shot.id) || request.scopeIds.includes(shot.sceneId)),
    'Requested narration is outside its original human scope');
}
export function requestedNarrationShot(reader: Reader, projectId: string, requestId: string, principalId: string, segmentId: string): string | null {
  const key = digest({ projectId, requestId, segmentId }), mapping = record<RequestedShotScope>(reader, 'narration_requested_shot_scope', key, projectId);
  if (!mapping) return null;
  assertRequestedNarrationShotScope(reader, projectId, mapping);
  fail(mapping.requestId === requestId && mapping.principalId === principalId && mapping.segmentId === segmentId, 'Requested narration mapping differs from its original request');
  return mapping.shotId;
}
export const shotDraftId = (projectId: string, shotId: string): string => digest({ projectId, shotId });
export const shotSessionHeadId = shotDraftId;
function record<T>(reader: Reader, kind: string, id: string, projectId: string): T | undefined {
  const metadata = reader.db.prepare('SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind=? AND id=?').get(kind, id) as { project_id: string; bytes: number } | undefined;
  if (!metadata) return undefined;
  fail(metadata.project_id === projectId && metadata.bytes > 0 && metadata.bytes <= (kind === 'message' ? 128 * 1024 : 8192), 'Shot narration scope evidence is foreign or invalid');
  return reader.get<T>(kind, id);
}
/** Static immutable ownership evidence. Historical validators deliberately do not require the request or shot to remain current. */
export function narrationAuthorScope(reader: Reader, projectId: string, requestId: string, principalId: string, segmentId?: string): NarrationShotScope | null {
  const request = record<Message>(reader, 'message', requestId, projectId);
  invariant(request?.id === requestId && request.projectId === projectId && request.principalId === principalId && request.editing && Array.isArray(request.scopeIds), 'SCOPE_DENIED', 'Narration requires its editable human request');
  if (segmentId !== undefined && requestedNarrationShot(reader, projectId, requestId, principalId, segmentId)) return null;
  if (request.scopeIds.includes(projectId)) return null;
  const scope = record<NarrationShotScope>(reader, 'narration_shot_scope', requestId, projectId);
  invariant(scope?.id === requestId && scope.requestId === requestId && scope.version === 1 && scope.projectId === projectId && scope.principalId === principalId
    && principalId === 'local-user' && request.scopeIds.length === 1 && request.scopeIds[0] === scope.shotId, 'SCOPE_DENIED', 'Open a dedicated shot narration session before editing this section');
  const session = record<NarrationSession>(reader, 'narration_session', scope.sessionId, projectId);
  fail(session?.id === scope.sessionId && session.requestId === requestId && session.projectId === projectId && session.principalId === principalId && session.shotId === scope.shotId,
    'Shot narration session no longer matches its issued scope');
  if (segmentId !== undefined) {
    const target = narrationScopeTarget(reader, scope);
    fail(target?.segmentId === segmentId, 'This narration session may edit only its pinned shot section');
  }
  return scope;
}
export function narrationScopeTarget(reader: Reader, scope: NarrationShotScope): ScopeTarget | null {
  const target = record<ScopeTarget>(reader, 'narration_shot_scope_target', scope.id, scope.projectId);
  if (!target) return null;
  fail(target.id === scope.id && target.version === 1 && target.requestId === scope.requestId && target.projectId === scope.projectId && target.shotId === scope.shotId
    && target.scopeDigest === digest(scope) && typeof target.segmentId === 'string' && target.segmentId.length > 0 && target.segmentId.length <= 160,
  'The shot narration target pin changed');
  return target;
}
/** The app may append one target pin, never replace it. No segment identity comes from a model or a browser. */
export function bindNarrationScopeTarget(store: Store, scope: NarrationShotScope, segmentId: string): void {
  const existing = narrationScopeTarget(store, scope);
  if (existing) { fail(existing.segmentId === segmentId, 'A shot narration session cannot switch to another section'); return; }
  store.insert('narration_shot_scope_target', scope.id, scope.projectId, { version: 1, requestId: scope.requestId, shotId: scope.shotId, segmentId, scopeDigest: digest(scope) });
}
function ownedSegment(reader: Reader, projectId: string, shotId: string): string | null {
  const draft = record<{ projectId: string; shotId: string; segmentId: string }>(reader, 'narration_shot_draft', shotDraftId(projectId, shotId), projectId);
  const head = reader.get<{ canonicalId: string }>('narration_canonical_head', projectId), saved = head ? reader.get<{ projectId: string; shotMappings: { shotId: string; segmentId: string | null }[] }>('narration_canonical', head.canonicalId) : undefined;
  fail(!draft || draft.projectId === projectId && draft.shotId === shotId && typeof draft.segmentId === 'string', 'The saved shot narration mapping is invalid');
  const segmentId = draft?.segmentId ?? saved?.shotMappings.find(mapping => mapping.shotId === shotId)?.segmentId ?? null;
  if (!segmentId) return null;
  const others = reader.db.prepare("SELECT 1 FROM entities WHERE kind='narration_shot_draft' AND project_id=? AND json_extract(body,'$.segmentId')=? AND json_extract(body,'$.shotId')<>? LIMIT 1").get(projectId, segmentId, shotId);
  fail(!others && !saved?.shotMappings.some(mapping => mapping.segmentId === segmentId && mapping.shotId !== shotId), 'A narration section shared by several shots requires the full narration workspace');
  fail(reader.get<NarrationState>('narration_state', projectId)?.entries.some(entry => entry.segmentId === segmentId), 'The mapped shot narration section was removed');
  return segmentId;
}
export function createShotNarrationSession(production: ProductionService, projectId: string, shotId: string, key: string, continuationSessionId?: string): NarrationSession {
  const store = production.store;
  fail(typeof key === 'string' && key.length > 0 && key.length <= 160 && (continuationSessionId === undefined || typeof continuationSessionId === 'string' && continuationSessionId.length > 0 && continuationSessionId.length <= 160), 'Use a bounded shot narration session identity');
  return store.command(`local-user:${projectId}:${shotId}:shot-narration-session`, key, digest({ continuationSessionId: continuationSessionId ?? null }), () => {
    const project = store.getProject(projectId); fail(project.shots.some(shot => shot.id === shotId), 'Choose a current shot');
    const head = store.get<{ sessionId: string }>('narration_shot_session_head', shotSessionHeadId(projectId, shotId)), previous = head ? store.get<NarrationSession>('narration_session', head.sessionId) : undefined;
    fail(!previous || previous.id === continuationSessionId, 'Explicitly continue the displayed shot narration session');
    fail(!continuationSessionId || previous?.id === continuationSessionId && previous.projectId === projectId && previous.shotId === shotId && previous.principalId === 'local-user', 'The previous shot narration session changed');
    const segmentId = ownedSegment(store, projectId, shotId);
    const actor = production.beginRequest(projectId, 'local-user', 'Edit narration for this shot and review its exact recording and timing.',
      { source: "app", scopeIds: [shotId], editing: true, key: `shot-narration:${shotId}:${digest(key)}`, ...(previous ? { continuationRequestId: previous.requestId } : {}) });
    const session: NarrationSession = { id: newId(), projectId, requestId: actor.requestId, principalId: 'local-user', shotId };
    store.insert('narration_session', session.id, projectId, session);
    const scope = store.insert('narration_shot_scope', actor.requestId, projectId, { version: 1, requestId: actor.requestId, sessionId: session.id, principalId: 'local-user', shotId }) as NarrationShotScope;
    if (segmentId) bindNarrationScopeTarget(store, scope, segmentId);
    store.put('narration_shot_session_head', shotSessionHeadId(projectId, shotId), projectId, { sessionId: session.id }); return session;
  });
}
export function assertNarrationAuthority(production: ProductionService, projectId: string, actor: ActorContext, segmentId?: string): NarrationShotScope | null {
  production.assertActor(projectId, actor, true);
  const scope = narrationAuthorScope(production.store, projectId, actor.requestId, actor.principalId, segmentId);
  if (scope) {
    fail(production.store.getProject(projectId).shots.some(shot => shot.id === scope.shotId), 'The scoped narration shot was removed');
    const target = narrationScopeTarget(production.store, scope);
    if (target) fail(ownedSegment(production.store, projectId, scope.shotId) === target.segmentId, 'The scoped narration mapping changed');
  }
  return scope;
}
export function assertNarrationMutation(store: Store, scope: NarrationShotScope | null, before: NarrationState, after: NarrationState, action: string, args: unknown): void {
  if (!scope) return;
  const target = narrationScopeTarget(store, scope)?.segmentId ?? null, input = args as Record<string, unknown>;
  const requireTarget = (id: unknown) => fail(target !== null && id === target, 'Shot narration may mutate only its pinned section');
  if (action === 'revise') {
    const update = (input.update ?? []) as { segmentId: string }[], remove = (input.remove ?? []) as string[], add = (input.add ?? []) as unknown[];
    for (const row of update) requireTarget(row.segmentId); for (const id of remove) requireTarget(id);
    fail(input.order === undefined && !remove.length && (!add.length || !target && add.length === 1 && !update.length), 'A compact shot edit cannot add another section, remove a section or reorder the narration collection');
  } else if (action === 'accept') {
    for (const id of input.targets as string[]) requireTarget(before.entries.find(entry => (input.kind === 'script' ? entry.segmentRevisionId : entry.cueId) === id)?.segmentId);
  } else if (action === 'accept_audio') {
    for (const row of args as { segmentRevisionId: string }[]) requireTarget(before.entries.find(entry => entry.segmentRevisionId === row.segmentRevisionId)?.segmentId);
  } else if (action === 'place') {
    const project = store.getProject(scope.projectId), ordered = project.scenes.flatMap(scene => project.shots.filter(shot => shot.sceneId === scene.id)), index = ordered.findIndex(shot => shot.id === scope.shotId);
    const expected = ordered.slice(0, index).reduce((sum, shot) => sum + shot.desiredFrames * 1600, 0);
    for (const placement of args as { segmentId: string; atSample: number }[]) { requireTarget(placement.segmentId); fail(placement.atSample === expected, 'Shot narration placement must follow its current storyboard position'); }
  } else requireTarget(input.segmentId);
  const oldIds = before.entries.filter(entry => entry.segmentId !== target).map(entry => entry.segmentId), nextIds = after.entries.filter(entry => entry.segmentId !== target && oldIds.includes(entry.segmentId)).map(entry => entry.segmentId);
  fail(canonical(oldIds) === canonical(nextIds) && before.entries.filter(entry => entry.segmentId !== target).every(entry => canonical(entry) === canonical(after.entries.find(row => row.segmentId === entry.segmentId) ?? null)), 'A compact narration edit cannot alter unrelated sections');
  const additions = after.entries.filter(entry => !before.entries.some(old => old.segmentId === entry.segmentId));
  if (additions.length) {
    fail(!target && additions.length === 1 && action === 'revise', 'A compact narration edit has exactly one section');
    const segmentId = additions[0]!.segmentId; bindNarrationScopeTarget(store, scope, segmentId);
    const shot = store.getProject(scope.projectId).shots.find(shot => shot.id === scope.shotId)!;
    store.put('narration_shot_draft', shotDraftId(scope.projectId, scope.shotId), scope.projectId, { shotId: scope.shotId, segmentId, intentDigest: digest(shot.narration ?? null) });
  }
}
export function assertScopedCanonicalFootprint(scope: NarrationShotScope | null, before: ProjectRecord, after: ProjectRecord): void {
  if (!scope) return;
  fail(before.shots.length === after.shots.length && before.shots.filter(shot => shot.id !== scope.shotId).every(shot => canonical(shot) === canonical(after.shots.find(row => row.id === shot.id) ?? null)), 'Shot narration cannot revise another shot');
  const oldShot = before.shots.find(shot => shot.id === scope.shotId), newShot = after.shots.find(shot => shot.id === scope.shotId), changedCues = new Set([oldShot?.cueId, newShot?.cueId]);
  fail(before.cues.filter(cue => !changedCues.has(cue.id)).every(cue => canonical(cue) === canonical(after.cues.find(row => row.id === cue.id) ?? null)), 'Shot narration cannot revise or remove unrelated cue acceptance');
  const { shots: _oldShots, cues: _oldCues, artifacts: _oldArtifacts, narration: _oldNarration, ...oldProject } = before;
  const { shots: _newShots, cues: _newCues, artifacts: _newArtifacts, narration: _newNarration, ...newProject } = after;
  fail(canonical(oldProject) === canonical(newProject), 'Shot narration cannot change other film settings');
}
/** Host-derived execution footprint of an exact reviewed speech candidate; no model-supplied scope field is consulted. */
export function narrationSpeechShotScope(reader: Reader, projectId: string, candidateId: string | null): string | null {
  if (!candidateId) return null;
  const candidate = reader.get<{ projectId: string; grantId: string }>('candidate', candidateId);
  if (candidate?.projectId !== projectId) return null;
  const review = reader.get<{ projectId: string; requestId: string; principalId: string; section: { segmentId: string }; proposal: { id: string } }>('narration_speech_review', candidate.grantId);
  if (!review) return null;
  fail(review.projectId === projectId, 'Speech scope belongs to another project');
  const requested = requestedNarrationShot(reader, projectId, review.requestId, review.principalId, review.section.segmentId);
  if (requested) return requested;
  const scope = narrationAuthorScope(reader, projectId, review.requestId, review.principalId, review.section.segmentId);
  if (scope) return scope.shotId;
  const proposal = reader.db.prepare("SELECT project_id,json_extract(body,'$.requestId') requestId,json_extract(body,'$.principalId') principalId,json_extract(body,'$.section.segmentId') segmentId FROM entities WHERE kind='narration_speech_proposal' AND id=?")
    .get(review.proposal.id) as { project_id: string; requestId: string; principalId: string; segmentId: string } | undefined;
  fail(proposal?.project_id === projectId && proposal.segmentId === review.section.segmentId, 'Speech proposal lost its scope evidence');
  return narrationAuthorScope(reader, projectId, proposal!.requestId, proposal!.principalId, proposal!.segmentId)?.shotId ?? null;
}
/** A legacy project-authored section may acquire a checked compact target later. That edit must also hold its queued speech. */
export function narrationSpeechShotScopes(reader: Reader, projectId: string, candidateId: string | null): string[] {
  const authored = narrationSpeechShotScope(reader, projectId, candidateId);
  if (authored) return [authored];
  if (!candidateId) return [];
  const candidate = reader.get<{ projectId: string; grantId: string }>('candidate', candidateId), review = candidate?.projectId === projectId
    ? reader.get<{ projectId: string; section: { segmentId: string } }>('narration_speech_review', candidate.grantId) : undefined;
  if (!review) return [];
  const ids = reader.getProject(projectId).shots.map(shot => shot.id); if (!ids.length) return [];
  // Group before hydration: repeated sessions retain history without creating an unbounded target scan.
  const rows = reader.db.prepare(`SELECT id,max(rowid) latest FROM entities WHERE kind='narration_shot_scope_target' AND project_id=? AND json_extract(body,'$.segmentId')=?
    AND json_extract(body,'$.shotId') IN (${ids.map(() => '?').join(',')}) GROUP BY json_extract(body,'$.shotId') ORDER BY latest DESC LIMIT ?`)
    .all(projectId, review.section.segmentId, ...ids, ids.length + 1) as { id: string }[];
  return [...new Set(rows.map(row => {
    const target = record<ScopeTarget>(reader, 'narration_shot_scope_target', row.id, projectId);
    fail(target, 'Mapped speech lost its compact target evidence');
    const scope = narrationAuthorScope(reader, projectId, target!.requestId, 'local-user', review.section.segmentId);
    fail(scope && scope.shotId === target!.shotId, 'Mapped speech has invalid compact scope evidence'); return scope!.shotId;
  }))];
}
/** Only this exact reviewed speech job may run through its own compact writing hold. Other holders and project/scene holds still win. */
export function narrationSpeechHoldExemption(reader: Reader, projectId: string, candidateId: string | null): { scopeId: string; ownerId: string; requested?: true; holdIds?: string[] } | null {
  if (!candidateId) return null;
  const candidate = reader.get<{ projectId: string; grantId: string; nodeId: string }>('candidate', candidateId);
  if (candidate?.projectId !== projectId) return null;
  const review = reader.get<{ projectId: string; requestId: string; principalId: string; nodeId: string; requested?: true; requestedAtCursor?: number; epochId?: string; section: { segmentId: string } }>('narration_speech_review', candidate.grantId);
  if (!review) return null;
  fail(review.projectId === projectId && review.nodeId === candidate.nodeId, 'The speech hold exemption lost its exact reviewed candidate');
  const scope = narrationAuthorScope(reader, projectId, review.requestId, review.principalId, review.section.segmentId);
  if (review.requested === true) {
    assertRequestHoldCutoff(reader,projectId,review.requestId,review.requestedAtCursor,review.epochId);
    const requested = requestedNarrationShot(reader, projectId, review.requestId, review.principalId, review.section.segmentId);
    if(requested) {
      const mapping=record<RequestedShotScope>(reader,'narration_requested_shot_scope',digest({projectId,requestId:review.requestId,segmentId:review.section.segmentId}),projectId)!;
      const before=reader.get<{project:ProjectRecord}>('project_revision',mapping.projectRevisionId)?.project.shots.find(shot=>shot.id===requested);
      const current=reader.getProject(projectId).shots.find(shot=>shot.id===requested);
      invariant(before && current && canonical(before.narration??null)===canonical(current.narration??null),'NARRATION_SPEECH_STALE','The requested shot writing or voice intent changed before generation.');
    }
    return {scopeId:requested??scope?.shotId??projectId,ownerId:review.requestId,requested:true,holdIds:earlierRequestHoldIds(reader,projectId,review.requestedAtCursor!)};
  }
  return scope ? { scopeId: scope.shotId, ownerId: scope.requestId } : null;
}
