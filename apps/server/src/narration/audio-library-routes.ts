import { audioLibraryRole, type AudioRole, type AudioLabel } from "./audio-library-role.js";
import type { FastifyInstance } from 'fastify';
import { digest, invariant, newId } from '@openslate/core';
import type { ProductionService } from '../application/service.js';
import type { NarrationService } from './service.js';
import type { NarrationAudio, SuppliedNarrationAudio } from './types.js';
import { ManagedUploadStore } from './managed-upload.js';
import { defaultSoundtrackDecision, isMusicVideoProject } from './music-video.js';
import { fitShotsToSong } from '../media/song-timing.js';
import { localSongTiming, songFitShots } from '../media/music-analyzer.js';
import { editStoryboard } from '../storyboard.js';

const id = { type: 'string', minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
interface AudioLibraryImport { id: string; projectId: string; audioId: string; requestId: string; originalSha256: string; originalByteLength: number; label: string; role: AudioRole }
export interface AudioLibraryEntry { id: string; label: string; sha256: string; durationSeconds: number; samples: number; byteLength: number; origin: 'uploaded' | 'generated'; role: AudioRole }
function entry(audio: NarrationAudio, label: string, role: AudioRole): AudioLibraryEntry {
  const measured = audio.media.probe.audio;
  invariant(audio.media.kind === 'audio' && measured?.samples && measured.sampleRate === 48000 && measured.channels === 2,
    'MEDIA_INTEGRITY_ERROR', 'The recording has no verified normalized audio identity');
  return { id: audio.id, label, sha256: audio.media.sha256, durationSeconds: measured.samples / 48000, samples: measured.samples,
    byteLength: audio.media.byteLength, origin: 'originEvidence' in audio ? 'generated' : 'uploaded', role };
}

/**
 * Default soundtrack: music imported into a film that never chose music becomes its soundtrack through the
 * person's own soundtrack command (same validation, Undo and events); a music video also plays it at 0 dB.
 * A refused selection (an import awaiting review, recovery, a concurrent edit) leaves the import itself intact.
 */
function adoptDefaultSoundtrack(production: ProductionService, projectId: string, audioId: string, role: AudioRole, importId: string): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    const project = production.store.getProject(projectId), decision = defaultSoundtrackDecision(project, role);
    if (!decision.adopt) return;
    try {
      const selected = editStoryboard(production, projectId, { kind: 'soundtrack', field: 'audioId', value: audioId, expectedHeadVersion: project.headVersion }, `audio-library-default:${importId}:audioId`);
      if (decision.gainMilliDb !== null)
        editStoryboard(production, projectId, { kind: 'soundtrack', field: 'gainMilliDb', value: String(decision.gainMilliDb), expectedHeadVersion: selected.headVersion }, `audio-library-default:${importId}:gain`);
      return;
    } catch (error) {
      if (attempt === 0 && (error as { code?: string }).code === 'REVISION_CONFLICT') continue;
      production.store.appendEvent(projectId, 'audio_library.default_soundtrack_skipped', { audioId, code: (error as { code?: string }).code ?? 'UNKNOWN' });
      return;
    }
  }
}

/** Uploaded audio is an owned library asset. It creates no narration sections, cues, holds or paid authority. */
export function registerAudioLibraryRoutes(app: FastifyInstance, options: { production: ProductionService; narration: NarrationService; uploads: ManagedUploadStore }) {
  const { production, narration, uploads } = options, store = production.store, base = '/api/projects/:projectId/audio-library';
  const check = (projectId: string) => { production.recovery.assertWritable(projectId); store.getProject(projectId); };
  app.get<{ Params: { projectId: string }; Querystring: { offset?: string; role?: AudioRole } }>(base, { schema: { params: object({ projectId: id }, ['projectId']), querystring: object({ offset: { type: 'string', pattern: '^(0|[1-9][0-9]{0,6})$' }, role: { enum: ['music', 'voice', 'upload'] } }) } }, async (request, reply) => {
    const projectId = request.params.projectId, offset = Number(request.query.offset ?? 0);
    const view = store.db.transaction(() => {
      const project = store.getProject(projectId), labels = new Map(store.list<AudioLabel>('audio_library_label', projectId).map(x => [x.id, x]));
      const rows = store.db.prepare("SELECT id,length(CAST(body AS BLOB)) bytes,json_extract(body,'$.role') role,json_extract(body,'$.originEvidence') originEvidence FROM entities WHERE kind='narration_audio' AND project_id=? ORDER BY rowid DESC").all(projectId) as { id: string; bytes: number; role: AudioRole | null; originEvidence: string | null }[];
      const all = rows.map(row => {
        const label = labels.get(row.id), role = audioLibraryRole(project, { id: row.id, ...(row.role ? { role: row.role } : {}), ...(row.originEvidence ? { originEvidence: row.originEvidence } : {}) }, label);
        return { row, label, role };
      }).filter(x => !request.query.role || x.role === request.query.role);
      const total = all.length;
      invariant(offset <= total, 'VALIDATION_ERROR', 'Refresh the recording library before paging');
      const recordings = all.slice(offset, offset + 40).map(({ row, label, role }) => {
        invariant(row.bytes <= 65536, 'MEDIA_INTEGRITY_ERROR', 'Recording metadata exceeds its display bound');
        const audio = store.get<NarrationAudio>('narration_audio', row.id)!;
        invariant(audio.projectId === projectId, 'MEDIA_INTEGRITY_ERROR', 'Recording metadata exceeds its display bound or ownership');
        return entry(audio, label?.label ?? ('originEvidence' in audio ? 'Generated narration' : 'Uploaded recording'), role);
      });
      return { recordings, coverage: { offset, total, nextOffset: offset + recordings.length < total ? offset + recordings.length : null },
        capabilities: { import: narration.mediaAvailable, maxBytes: uploads.maxBytes, maxSeconds: 360 } };
    }).deferred();
    return reply.header('Cache-Control', 'private, no-store').send(view);
  });
  app.get<{ Params: { projectId: string; audioId: string } }>(`${base}/:audioId/timing`, { schema: { params: object({ projectId: id, audioId: id }, ['projectId', 'audioId']) } }, async (request, reply) => {
    const { projectId, audioId } = request.params;
    invariant(narration.mediaAvailable, 'NARRATION_MEDIA_UNAVAILABLE', 'Song timing needs local media tools');
    const audio = store.get<NarrationAudio>('narration_audio', audioId);
    invariant(audio?.projectId === projectId && audio.media.kind === 'audio', 'NOT_FOUND', 'Choose a recording owned by this film');
    const timing = await localSongTiming(production, narration, audio);
    const project = store.getProject(projectId), shots = songFitShots(project);
    const startFrame = project.soundtrack?.audioId === audioId ? project.soundtrack.startFrame ?? 0 : 0;
    return reply.header('Cache-Control', 'private, no-store').send({
      audioId, sha256: audio.media.sha256, headVersion: project.headVersion, musicVideo: isMusicVideoProject(project),
      selected: project.soundtrack?.audioId === audioId, timing, fit: fitShotsToSong(shots, timing, startFrame, Math.min(project.maxFrames, 10800)),
    });
  });
  app.post<{ Params: { projectId: string }; Querystring: { name?: string; role?: AudioRole }; Body: AsyncIterable<Uint8Array> }>(`${base}/uploads`, {
    bodyLimit: uploads.maxBytes,
    schema: { params: object({ projectId: id }, ['projectId']), querystring: object({ role: { enum: ['music', 'voice', 'upload'] }, name: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[^\\u0000-\\u001f\\u007f/\\\\]+$' } }) },
  }, async (request, reply) => {
    const projectId = request.params.projectId;
    invariant(narration.mediaAvailable, 'NARRATION_MEDIA_UNAVAILABLE', 'Audio import needs local FFmpeg and ffprobe');
    invariant(request.headers['content-type']?.split(';')[0] === 'application/octet-stream', 'VALIDATION_ERROR', 'Upload owned audio bytes as application/octet-stream');
    const key = request.headers['idempotency-key'];
    invariant(typeof key === 'string' && key.length > 0 && key.length <= 160, 'VALIDATION_ERROR', 'An exact bounded import key is required');
    const label = request.query.name?.trim() || 'Uploaded recording', identity = digest({ projectId, key, operation: 'audio-library-import' });
    const upload = await uploads.receive(request.body, identity, () => check(projectId));
    try {
      const role = request.query.role ?? 'upload';
      const inputDigest = digest({ sha256: upload.sha256, byteLength: upload.byteLength, label, role });
      const intent = store.transaction(() => {
        check(projectId);
        return store.command<AudioLibraryImport>(`local-user:${projectId}:audio-library-import`, key, inputDigest, () => {
          const actor = production.beginRequest(projectId, 'local-user', 'Import this recording into my owned audio library. No narration or music placement is selected.',
            { source: "app", editing: false, key: `audio-library:${key}`, scopeIds: [projectId], contextDigest: inputDigest });
          const value: AudioLibraryImport = { id: identity, projectId, audioId: newId(), requestId: actor.requestId,
            originalSha256: upload.sha256, originalByteLength: upload.byteLength, label, role };
          store.insert('audio_library_import', identity, projectId, value); return value;
        });
      });
      let audio = store.get<SuppliedNarrationAudio>('narration_audio', intent.audioId);
      if (!audio) {
        const imported = await narration.media.importMedia({ artifactId: intent.audioId, path: upload.path, kind: 'audio' });
        invariant(imported.originalSha256 === upload.sha256 && imported.originalByteLength === upload.byteLength, 'UPLOAD_CORRUPT', 'Normalized recording differs from the exact supplied bytes');
        await narration.media.verifiedSource(imported);
        audio = store.transaction(() => {
          check(projectId);
          const existing = store.get<SuppliedNarrationAudio>('narration_audio', intent.audioId);
          if (existing) { invariant(digest(existing.media) === digest(imported), 'UPLOAD_CORRUPT', 'This import already published different audio'); return existing; }
          const saved = store.insert('narration_audio', intent.audioId, projectId, { media: imported, declaredOrigin: 'uploaded', requestId: intent.requestId, role: intent.role }) as SuppliedNarrationAudio;
          store.insert('audio_library_label', saved.id, projectId, { label, role: intent.role });
          store.appendEvent(projectId, 'narration.audio_imported', { audioId: saved.id, sha256: imported.sha256 }); return saved;
        });
      }
      invariant(audio.projectId === projectId && audio.media.originalSha256 === upload.sha256 && audio.media.originalByteLength === upload.byteLength,
        'UPLOAD_CORRUPT', 'The saved recording differs from this exact import');
      await narration.media.verifiedSource(audio.media);
      if (intent.role === 'music') {
        adoptDefaultSoundtrack(production, projectId, audio.id, intent.role, intent.id);
        // Timing is a convenience for planning; an unreadable beat never fails the import.
        try { await localSongTiming(production, narration, audio); } catch { /* the timing route reports it */ }
      }
      const selectedAsMusic = store.getProject(projectId).soundtrack?.audioId === audio.id;
      // Return data so Fastify waits for staging cleanup before publishing a successful response.
      // Sending here would let an immediate same-key retry race directory removal in finally.
      reply.header('Cache-Control', 'private, no-store'); return { recording: { ...entry(audio, intent.label, intent.role), selectedAsMusic } };
    } finally { await upload.release(); }
  });
}
