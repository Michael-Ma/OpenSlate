import type { FastifyInstance, FastifyRequest } from 'fastify';
import { canonical, digest, invariant, newId } from '@openslate/core';
import type { ActorContext } from '@openslate/core';
import type { ProductionService } from '../application/service.js';
import type { NarrationService } from './service.js';
import type { NarrationCanonicalService } from './canonical.js';
import type { NarrationCommitReceipt } from './canonical-types.js';
import type { NarrationAudio, SegmentDraft } from './types.js';
import { projectAudioPlacements, storyboardAudioCuts } from './audio-placement.js';
import { assertPersonalVoiceCurrent } from './personal-voices.js';
import { isVerifiedGeneratedNarrationAudio, summarizeGeneratedNarrationAudio } from './generated-audio.js';
import { assertNarrationAuthority, createShotNarrationSession, shotSessionHeadId } from './narration-scope.js';
import type { NarrationSession } from './narration-scope.js';

const id = { type: 'string', minLength: 1, maxLength: 160 }, version = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' }, sample = { type: 'integer', minimum: 0, maximum: 17280000 };
const object = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const key = (request: FastifyRequest) => { const key = request.headers['idempotency-key']; invariant(typeof key === 'string' && key.length > 0 && key.length <= 160, 'VALIDATION_ERROR', 'Use a bounded retry key'); return key; };
const draftId = (projectId: string, shotId: string) => digest({ projectId, shotId });
interface ShotDraft { segmentId: string; projectId: string; shotId: string; intentDigest?: string }
interface PreparedAcceptance { preparedId: string; projectId: string; shotId: string }

/** Human shot workspace. Generation still uses the existing exact speech proposal, grants and spending routes. */
export function registerShotAudioRoutes(app: FastifyInstance, options: { production: ProductionService; narration: NarrationService; canonical: NarrationCanonicalService; actorFor(projectId: string, sessionId: string): ActorContext }) {
  const { production, narration, canonical: commits, actorFor } = options, store = production.store;
  const base = '/api/projects/:projectId/narration/shots/:shotId';
  const actorForShot = (projectId: string, sessionId: string, shotId: string) => {
    const actor = actorFor(projectId, sessionId), scope = assertNarrationAuthority(production, projectId, actor);
    invariant(scope?.shotId === shotId && scope.sessionId === sessionId, 'SCOPE_DENIED', 'Open this shot’s own narration session'); return actor;
  };
  const sessionFor = (projectId: string, shotId: string) => {
    const head = store.get<{ sessionId: string }>('narration_shot_session_head', shotSessionHeadId(projectId, shotId)), session = head ? store.get<NarrationSession>('narration_session', head.sessionId) : undefined;
    if (!session) return null;
    let state: 'active' | 'stale' = 'active'; try { actorForShot(projectId, session.id, shotId); } catch { state = 'stale'; }
    return { ...session, state };
  };
  const detail = (projectId: string, shotId: string) => store.transaction(() => {
    const project = store.getProject(projectId), shot = project.shots.find(shot => shot.id === shotId);
    invariant(shot, 'NOT_FOUND', 'Shot not found');
    const frozen = commits.workspaceCurrent(projectId), saved = store.get<ShotDraft>('narration_shot_draft', draftId(projectId, shotId));
    const mapped = frozen?.shotMappings.find(mapping => mapping.shotId === shotId)?.segmentId;
    const segmentId = saved?.segmentId ?? mapped ?? null;
    const row = narration.workspaceSnapshot(projectId).segments.find(row => row.entry.segmentId === segmentId) ?? null;
    const segment = row && row.audio && isVerifiedGeneratedNarrationAudio(row.audio) ? { ...row, audio: summarizeGeneratedNarrationAudio(row.audio) } : row;
    const latestSpeech = row ? store.db.prepare("SELECT id FROM entities WHERE kind='narration_speech_proposal' AND project_id=? AND json_extract(body,'$.section.segmentId')=? AND json_extract(body,'$.section.segmentRevisionId')=? ORDER BY rowid DESC LIMIT 1").get(projectId, row.entry.segmentId, row.script.id) as { id: string } | undefined : undefined;
    return { shotId, headVersion: project.headVersion, plannedFrames: shot.desiredFrames, segment, session: sessionFor(projectId, shotId), intentCurrent: !saved || saved.intentDigest === digest(shot.narration ?? null), latestSpeechProposalId: latestSpeech?.id ?? null, committed: Boolean(!shot.narrationPending && row && frozen?.shotMappings.some(mapping => mapping.shotId === shotId && mapping.segmentId === row.entry.segmentId) && shot.cueId === row.cue?.id) };
  });
  app.get<{ Params: { projectId: string; shotId: string } }>(base, async request => detail(request.params.projectId, request.params.shotId));
  app.post<{ Params: { projectId: string; shotId: string }; Body: { continuationSessionId?: string } }>(`${base}/sessions`, {
    schema: { body: object({ continuationSessionId: id }, []) },
  }, async request => {
    const { projectId, shotId } = request.params;
    const session = createShotNarrationSession(production, projectId, shotId, key(request), request.body.continuationSessionId);
    let state: 'active' | 'stale' = 'active'; try { actorForShot(projectId, session.id, shotId); } catch { state = 'stale'; }
    return { ...detail(projectId, shotId), session: { ...session, state } };
  });
  app.post<{ Params: { projectId: string; shotId: string }; Body: { sessionId: string; expectedHeadVersion: number; expectedVersion: number; text: string; language: string; mode: 'generated' | 'uploaded'; voice: string | null; profileRevisionId: string | null } }>(`${base}/script`, {
    schema: { body: object({ sessionId: id, expectedHeadVersion: version, expectedVersion: version, text: { type: 'string', minLength: 1, maxLength: 16000 }, language: { type: 'string', minLength: 1, maxLength: 64 }, mode: { enum: ['generated', 'uploaded'] }, voice: { anyOf: [id, { type: 'null' }] }, profileRevisionId: { anyOf: [id, { type: 'null' }] } }, ['sessionId', 'expectedHeadVersion', 'expectedVersion', 'text', 'language', 'mode', 'voice', 'profileRevisionId']) },
  }, async request => {
    const { projectId, shotId } = request.params, b = request.body, actor = actorForShot(projectId, b.sessionId, shotId), commandKey = key(request);
    return store.command(`local-user:${projectId}:shot-audio-script`, commandKey, digest({ shotId, ...b }), () => {
      const project = store.getProject(projectId), shot = project.shots.find(shot => shot.id === shotId);
      invariant(shot, 'NOT_FOUND', 'Shot not found'); invariant(project.headVersion === b.expectedHeadVersion, 'REVISION_CONFLICT', 'Shot changed before saving');
      if (b.mode === 'generated' && shot.narration?.voice === 'personal') {
        invariant(typeof b.voice === 'string' && b.voice.startsWith('openai-custom:'), 'PERSONAL_VOICE_REQUIRED', 'Choose your enrolled recorded voice');
        assertPersonalVoiceCurrent(store, projectId, b.voice);
      }
      const current = detail(projectId, shotId).segment;
      const draft: SegmentDraft = { text: b.text, textKind: 'draft', language: b.language, meaning: shot.purpose,
        source: b.mode === 'generated' ? { kind: 'generated', voice: b.voice, profileRevisionId: b.profileRevisionId } : { kind: 'uploaded' } };
      const next = narration.reviseSegments(projectId, actor, b.expectedVersion, commandKey, current ? { update: [{ segmentId: current.entry.segmentId, draft }] } : { add: [draft] });
      const segmentId = current?.entry.segmentId ?? next.segments.at(-1)!.entry.segmentId;
      const writing = { mode: b.mode, text: b.text, voice: b.voice?.startsWith('openai-custom:') ? 'personal' as const : shot.narration?.voice ?? 'stock' as const };
      const changed = !current || current.script.id !== next.segments.find(row => row.entry.segmentId === segmentId)?.script.id || digest(shot.narration ?? null) !== digest(writing);
      if (changed) {
        // Writing metadata is separate from the visual revision consumed by the immutable frame/video plan.
        shot.narration = writing; shot.narrationPending = true;
        const saved = store.saveProject({ ...project, revisionId: newId() }, project.headVersion); store.insert('project_revision', saved.revisionId, projectId, { project: saved });
      }
      store.put('narration_shot_draft', draftId(projectId, shotId), projectId, { projectId, shotId, segmentId, intentDigest: digest(writing) });
      return detail(projectId, shotId);
    });
  });
  app.post<{ Params: { projectId: string; shotId: string }; Body: { sessionId: string; expectedHeadVersion: number; expectedVersion: number; segmentId: string; segmentRevisionId: string; audioId: string; sha256: string; startSample: number; endSample: number; durationMode?: 'keep' | 'match_audio' } }>(`${base}/accept`, {
    schema: { body: object({ sessionId: id, expectedHeadVersion: version, expectedVersion: version, segmentId: id, segmentRevisionId: id, audioId: id, sha256: hash, startSample: sample, endSample: sample, durationMode: { enum: ['keep', 'match_audio'] } }, ['sessionId', 'expectedHeadVersion', 'expectedVersion', 'segmentId', 'segmentRevisionId', 'audioId', 'sha256', 'startSample', 'endSample']) },
  }, async request => {
    const { projectId, shotId } = request.params, b = request.body, actor = actorForShot(projectId, b.sessionId, shotId), commandKey = key(request);
    const prepared = store.command<PreparedAcceptance>(`local-user:${projectId}:shot-audio-accept`, commandKey, digest({ shotId, ...b }), () => {
      const project = store.getProject(projectId), shot = project.shots.find(shot => shot.id === shotId), row = detail(projectId, shotId).segment;
      invariant(shot && project.headVersion === b.expectedHeadVersion, 'REVISION_CONFLICT', 'Shot changed before review');
      invariant(row && row.entry.segmentId === b.segmentId && row.script.id === b.segmentRevisionId && row.audio?.id === b.audioId && row.audio.media.sha256 === b.sha256,
        'NARRATION_STALE_ACCEPTANCE', 'The displayed script or recording changed');
      const snapshot = narration.workspaceSnapshot(projectId); invariant(snapshot.state.version === b.expectedVersion, 'REVISION_CONFLICT', 'Narration changed before review');
      const frames = Math.ceil((b.endSample - b.startSample) / 1600);
      invariant(b.endSample > b.startSample && shot.desiredFrames >= 90 && shot.desiredFrames <= 450, 'NARRATION_INVALID_INPUT', 'Choose a nonempty recording range and a planned 3–15 second shot');
      invariant(b.durationMode === 'match_audio' ? frames >= 90 && frames <= 450 : frames <= shot.desiredFrames, 'NARRATION_CUE_OUT_OF_RANGE', 'Trim the recording to fit this shot, or explicitly match a 3–15 second shot to the recording');
      const ordered = project.scenes.flatMap(scene => project.shots.filter(shot => shot.sceneId === scene.id));
      const atSample = ordered.slice(0, ordered.findIndex(value => value.id === shotId)).reduce((sum, shot) => sum + shot.desiredFrames * 1600, 0);
      let state = narration.recordHumanCue(projectId, actor, b.expectedVersion, `${commandKey}:cue`, { segmentId: b.segmentId, startSample: b.startSample, endSample: b.endSample });
      state = narration.placeSegments(projectId, actor, state.state.version, `${commandKey}:place`, [{ segmentId: b.segmentId, atSample }]);
      state = narration.accept(projectId, actor, state.state.version, `${commandKey}:script`, 'script', [row.script.id]);
      state = narration.acceptAudio(projectId, actor, state.state.version, `${commandKey}:audio`, [{ segmentRevisionId: row.script.id, audioId: b.audioId }]);
      state = narration.accept(projectId, actor, state.state.version, `${commandKey}:timing`, 'timing', [state.segments.find(row => row.entry.segmentId === b.segmentId)!.cue!.id]);
      const change = commits.prepare(projectId, actor, { expectedHeadVersion: b.expectedHeadVersion, expectedNarrationVersion: state.state.version, segmentIds: [b.segmentId], shotRelativeSegmentIds: [b.segmentId], shotDurationMode: b.durationMode === 'match_audio' ? 'match_audio' : 'preserve', shotMappings: [{ shotId, segmentId: b.segmentId }], key: `${commandKey}:prepare` });
      return { preparedId: change.id, projectId, shotId };
    });
    const receipt: NarrationCommitReceipt = await commits.apply(projectId, actor, prepared.preparedId);
    return { receipt, ...detail(projectId, shotId) };
  });
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/narration/playback', async request => store.transaction(() => {
    const { projectId } = request.params, project = store.getProject(projectId), saved = commits.workspaceCurrent(projectId);
    const placements = (saved?.segments ?? []).filter(segment => project.shots.some(shot => shot.cueId === segment.cue.id) && project.cues.some(cue => cue.id === segment.cue.id && cue.accepted && cue.measured && canonical(cue) === canonical(segment.cue))).flatMap(segment => projectAudioPlacements(segment, storyboardAudioCuts(project)).map(placement => ({
      id: segment.placementMode === 'shot' ? `${segment.cue.id}@${placement.atSample}` : segment.cue.id, audioId: segment.cue.audio.artifactId, sha256: segment.cue.audio.sha256, startSample: placement.startSample, durationSamples: placement.durationSamples, atSample: placement.atSample, gainMilliDb: placement.gainMilliDb,
      shotIds: project.shots.filter(shot => shot.cueId === segment.cue.id).map(shot => shot.id),
    })));
    const recording = project.soundtrack ? store.get<NarrationAudio>('narration_audio', project.soundtrack.audioId) : undefined;
    const soundtrack = recording?.projectId === projectId && project.soundtrack ? { id: 'soundtrack', audioId: recording.id, sha256: recording.media.sha256, startSample: 0, durationSamples: Math.min(recording.media.probe.audio?.samples ?? 0, project.shots.reduce((sum, shot) => sum + shot.desiredFrames * 1600, 0)), atSample: 0, gainMilliDb: project.soundtrack.gainMilliDb, shotIds: [] } : null;
    return { projectId, headVersion: project.headVersion, revisionId: project.revisionId, placements, soundtrack };
  }));
}
