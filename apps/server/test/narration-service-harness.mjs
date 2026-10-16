import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { digest, invariant, DomainError } from '@openslate/core';
import { ManagedUploadStore } from '../dist/narration/managed-upload.js';
import { assertNarrationAuthority, createShotNarrationSession, shotSessionHeadId } from '../dist/narration/narration-scope.js';
import { createShotAudioWorkspace } from '../dist/narration/shot-audio-routes.js';
import { projectGeneratedRecordings } from '../dist/narration/generated-recording-projection.js';
import { isVerifiedGeneratedNarrationAudio, summarizeGeneratedNarrationAudio } from '../dist/narration/generated-audio.js';
import { projectTranscriptCandidates, projectTranscriptSelection, projectTranscriptWords } from '../dist/narration/transcript-projection.js';
import { projectNarrationSpeechOptions, projectNarrationSpeechProposals, projectNarrationSpeechProposal, summarizeNarrationSpeechProposal } from '../dist/narration/narration-speech-projection.js';
import { projectOwnedTranscriptionOptions, projectOwnedTranscriptionProposals, projectOwnedTranscriptionProposal, summarizeOwnedTranscriptionProposal } from '../dist/narration/owned-transcription-projection.js';

/** Test data adapter only. The retired paths are labels for service operations, never registered HTTP routes.
 * Existing provenance/replay/rollback assertions keep exercising the actual services used by the current runners.
 * Retained HTTP routes continue through inject; this helper deliberately has no authentication/schema emulation. */
export function narrationServiceHarness(f, { uploadDirectory = f.uploadDirectory, speech = f.speechService, transcription } = {}) {
  const projectId = f.project.id, { production, store, narration, canonical } = f;
  const actorFor = (pid, sessionId) => {
    const session = store.get('narration_session', sessionId);
    invariant(session?.projectId === pid && session.principalId === 'local-user', 'NARRATION_SESSION_STALE', 'Fixture session is unavailable');
    const head = store.get(session.shotId ? 'narration_shot_session_head' : 'narration_session_head', session.shotId ? shotSessionHeadId(pid, session.shotId) : pid);
    invariant(head?.sessionId === session.id, 'NARRATION_SESSION_STALE', 'Fixture session was continued');
    const actor = { kind: 'human', principalId: 'local-user', requestId: session.requestId };
    try { production.assertActor(pid, actor, true); } catch { invariant(false, 'NARRATION_SESSION_STALE', 'Fixture session was superseded'); }
    assertNarrationAuthority(production, pid, actor); return actor;
  };
  const workspace = createShotAudioWorkspace({ production, narration, canonical, actorFor });
  const selected = pid => {
    const head = store.get('narration_session_head', pid), session = head && store.get('narration_session', head.sessionId);
    if (!session) return null;
    let state = 'active'; try { actorFor(pid, session.id); } catch { state = 'stale'; } return { ...session, state };
  };
  const view = pid => {
    const snapshot = narration.workspaceSnapshot(pid), session = selected(pid), project = store.getProject(pid);
    const continuationRequest = session?.state === 'active' ? null : store.db.prepare(`SELECT id, substr(json_extract(body,'$.text'),1,240) text FROM entities WHERE kind='message' AND project_id=? AND json_extract(body,'$.principalId')='local-user' AND json_extract(body,'$.editing')=1 AND json_extract(body,'$.state')='active' AND EXISTS (SELECT 1 FROM json_each(body,'$.scopeIds') WHERE value=?) ORDER BY rowid DESC LIMIT 1`).get(pid, pid) ?? null;
    return { headVersion: project.headVersion, revisionId: project.revisionId, snapshot: { ...snapshot, segments: snapshot.segments.map(row => row.audio && isVerifiedGeneratedNarrationAudio(row.audio) ? { ...row, audio: summarizeGeneratedNarrationAudio(row.audio) } : row) }, canonical: canonical.workspaceCurrent(pid), session, continuationRequest };
  };
  const open = (pid, body, commandKey) => store.command(`local-user:${pid}:fixture-narration-session`, commandKey, digest(body), () => {
    const old = selected(pid); invariant(!old || body.continuationSessionId === old.id, 'NARRATION_SESSION_EXISTS', 'Continue the fixture session explicitly');
    const previous = body.continuationSessionId && store.get('narration_session', body.continuationSessionId);
    invariant(!body.continuationSessionId || previous?.projectId === pid && previous.principalId === 'local-user', 'NARRATION_SESSION_STALE', 'Previous fixture session changed');
    const explicit = body.continuationRequestId && store.get('message', body.continuationRequestId);
    invariant(!body.continuationRequestId || explicit?.projectId === pid && explicit.principalId === 'local-user' && explicit.editing && explicit.state === 'active' && explicit.scopeIds.includes(pid), 'NARRATION_SESSION_STALE', 'Explicit fixture request changed');
    const continuationRequestId = body.continuationRequestId ?? previous?.requestId;
    const actor = production.beginRequest(pid, 'local-user', body.text ?? 'Set up narration service fixture', { source: 'app', concurrency: 'alongside', scopeIds: [pid], editing: true, key: digest({ commandKey }), ...(continuationRequestId ? { continuationRequestId } : {}) });
    const session = { id: randomUUID(), projectId: pid, requestId: actor.requestId, principalId: 'local-user' };
    store.insert('narration_session', session.id, pid, session); store.put('narration_session_head', pid, pid, { sessionId: session.id }); return session;
  });
  const response = (data, statusCode = 200) => { const body = JSON.stringify(data); return { statusCode, body, rawPayload: Buffer.from(body), json: () => JSON.parse(body) }; };
  return async (suffix = '', body, extras = {}) => {
    const url = new URL(extras.url ?? `/api/projects/${projectId}/narration${suffix}`, 'http://fixture.invalid');
    const pid = decodeURIComponent(url.pathname.split('/')[3]), path = url.pathname.split('/narration')[1] ?? '', query = Object.fromEntries(url.searchParams);
    const commandKey = extras.headers?.['idempotency-key'] ?? randomUUID();
    const input = body && !Buffer.isBuffer(body) ? Object.fromEntries(Object.entries(body).filter(([name]) => name !== 'sessionId')) : body;
    try {
      let result;
      if (path === '' && body === undefined) result = view(pid);
      else if (path === '/sessions') { const session = open(pid, body, commandKey); result = { ...view(pid), session: { ...session, state: (() => { try { actorFor(pid, session.id); return 'active'; } catch { return 'stale'; } })() } }; }
      else if (path === '/segments') result = narration.reviseSegments(pid, actorFor(pid, body.sessionId), body.expectedVersion, commandKey, body.patch);
      else if (path === '/bindings') result = narration.bindAudio(pid, actorFor(pid, body.sessionId), body.expectedVersion, commandKey, body.segmentId, body.audioId);
      else if (path === '/generated-audio-bindings') result = await narration.attachGeneratedAudio(pid, actorFor(pid, body.sessionId), { ...input, key: commandKey });
      else if (path === '/transcript-words' || path === '/transcript-timing') result = await narration[path === '/transcript-words' ? 'useTranscriptWords' : 'useTranscriptTiming'](pid, actorFor(pid, body.sessionId), { ...input, key: commandKey });
      else if (path === '/cues') result = narration.recordHumanCue(pid, actorFor(pid, body.sessionId), body.expectedVersion, commandKey, { segmentId: body.segmentId, startSample: body.startSample, endSample: body.endSample });
      else if (path === '/placements') result = narration.placeSegments(pid, actorFor(pid, body.sessionId), body.expectedVersion, commandKey, body.placements);
      else if (path === '/acceptances') result = narration.accept(pid, actorFor(pid, body.sessionId), body.expectedVersion, commandKey, body.kind, body.targets);
      else if (path === '/audio-acceptances') result = narration.acceptAudio(pid, actorFor(pid, body.sessionId), body.expectedVersion, commandKey, body.targets);
      else if (path === '/prepare') result = canonical.prepare(pid, actorFor(pid, body.sessionId), { ...input, key: commandKey });
      else if (path === '/apply') result = canonical.apply(pid, actorFor(pid, body.sessionId), body.preparedId);
      else if (path === '/audio') {
        invariant(narration.mediaAvailable, 'NARRATION_MEDIA_UNAVAILABLE', 'Fixture import needs media');
        const actor = actorFor(pid, query.sessionId), uploads = new ManagedUploadStore({ rootDir: uploadDirectory });
        const upload = await uploads.receive(Readable.from([body]), digest({ pid, sessionId: query.sessionId, commandKey }), () => actorFor(pid, query.sessionId));
        try { result = await narration.importAudio(pid, actor, { path: upload.path, declaredOrigin: query.declaredOrigin, key: `fixture:${commandKey}` }); } finally { await upload.release(); }
      } else if (path === '/generated-recordings') result = projectGeneratedRecordings(store, pid, Number(query.offset ?? 0), query.expectedDigest);
      else if (/^\/audio\/[^/]+\/transcripts$/.test(path)) result = projectTranscriptCandidates(store, pid, path.split('/')[2], Number(query.offset ?? 0), query.expectedDigest);
      else if (/^\/transcripts\/[^/]+\/words$/.test(path)) result = projectTranscriptWords(store, pid, { ...query, candidateId: path.split('/')[2], offset: Number(query.offset ?? 0) });
      else if (/^\/transcripts\/[^/]+\/selection$/.test(path)) result = projectTranscriptSelection(store, pid, { ...query, candidateId: path.split('/')[2], startWordIndex: Number(query.startWordIndex), endWordIndex: Number(query.endWordIndex) });
      else if (path === '/speech-options') result = projectNarrationSpeechOptions(production, pid);
      else if (path === '/speech-proposals' && body === undefined) result = projectNarrationSpeechProposals(store, pid, Number(query.offset ?? 0), query.expectedDigest);
      else if (path.startsWith('/speech-proposals/') && body === undefined) result = projectNarrationSpeechProposal(store, pid, path.split('/')[2]);
      else if (path === '/speech-proposals') { const proposal = await speech.prepare(pid, actorFor(pid, body.sessionId), { ...input, key: commandKey }); result = { proposal: summarizeNarrationSpeechProposal(store, pid, proposal.id) }; }
      else if (path === '/speech-reviews') result = { receipt: await speech.review(pid, actorFor(pid, body.sessionId), { ...input, key: commandKey }) };
      else if (path === '/transcription-options') result = projectOwnedTranscriptionOptions(production, pid);
      else if (path === '/transcription-proposals' && body === undefined) result = projectOwnedTranscriptionProposals(store, pid, Number(query.offset ?? 0), query.expectedDigest);
      else if (path.startsWith('/transcription-proposals/') && body === undefined) result = projectOwnedTranscriptionProposal(store, pid, path.split('/')[2]);
      else if (path === '/transcription-proposals') { const proposal = await transcription.prepare(pid, actorFor(pid, body.sessionId), { ...input, key: commandKey }); result = { proposal: summarizeOwnedTranscriptionProposal(store, pid, proposal.id) }; }
      else if (path === '/transcription-reviews') result = { receipt: await transcription.review(pid, actorFor(pid, body.sessionId), { ...input, key: commandKey }) };
      else if (/^\/shots\/[^/]+\/sessions$/.test(path)) { const shotId = path.split('/')[2], session = createShotNarrationSession(production, pid, shotId, commandKey, body.continuationSessionId); result = { ...workspace.detail(pid, shotId), session: { ...session, state: 'active' } }; }
      else if (/^\/shots\/[^/]+\/script$/.test(path)) result = workspace.saveWriting(pid, path.split('/')[2], body, commandKey);
      else if (/^\/shots\/[^/]+\/accept$/.test(path)) result = workspace.accept(pid, path.split('/')[2], body, commandKey);
      else if (/^\/shots\/[^/]+\/initialize$/.test(path)) {
        const shotId = path.split('/')[2], project = store.getProject(pid), shot = project.shots.find(row => row.id === shotId);
        invariant(shot && project.headVersion === body.expectedHeadVersion, 'REVISION_CONFLICT', 'Fixture shot changed');
        invariant(body.expectedNarrationVersion === undefined || narration.workspaceSnapshot(pid).state.version === body.expectedNarrationVersion, 'REVISION_CONFLICT', 'Fixture narration changed');
        const session = body.sessionId ? store.get('narration_session', body.sessionId) : createShotNarrationSession(production, pid, shotId, commandKey, body.continuationSessionId);
        result = workspace.saveWriting(pid, shotId, { sessionId: session.id, expectedHeadVersion: project.headVersion, expectedVersion: narration.workspaceSnapshot(pid).state.version, text: body.text?.trim() || shot.narration?.text.trim() || 'Uploaded narration recording', language: 'en', mode: body.mode, voice: body.voice ?? null, profileRevisionId: null }, commandKey);
      } else {
        return await f.app.inject({ method: body === undefined ? 'GET' : 'POST', url: url.pathname + url.search, ...(body === undefined ? {} : { payload: body }), ...extras, headers: { host: '127.0.0.1', authorization: `Bearer ${f.testToken}`, 'idempotency-key': commandKey, ...extras.headers } });
      }
      return response(await result);
    } catch (error) {
      const status = ['ACTOR_DENIED', 'SCOPE_DENIED'].includes(error.code) ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'VALIDATION_ERROR' ? 400 : error instanceof DomainError ? 409 : 500;
      return response({ error: { code: error.code ?? 'INTERNAL_ERROR', message: error.message } }, status);
    }
  };
}
