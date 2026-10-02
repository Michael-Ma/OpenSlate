import type { FastifyInstance } from 'fastify';
import { digest, invariant, newId } from '@openslate/core';
import type { ProductionService } from '../application/service.js';
import type { NarrationService } from './service.js';
import type { NarrationAudio, SuppliedNarrationAudio } from './types.js';
import { ManagedUploadStore } from './managed-upload.js';

const id = { type: 'string', minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
interface AudioLibraryImport { id: string; projectId: string; audioId: string; requestId: string; originalSha256: string; originalByteLength: number; label: string }
interface AudioLabel { id: string; projectId: string; label: string }
export interface AudioLibraryEntry { id: string; label: string; sha256: string; durationSeconds: number; samples: number; byteLength: number; origin: 'uploaded' | 'generated' }
function entry(audio: NarrationAudio, label: string): AudioLibraryEntry {
  const measured = audio.media.probe.audio;
  invariant(audio.media.kind === 'audio' && measured?.samples && measured.sampleRate === 48000 && measured.channels === 2,
    'MEDIA_INTEGRITY_ERROR', 'The recording has no verified normalized audio identity');
  return { id: audio.id, label, sha256: audio.media.sha256, durationSeconds: measured.samples / 48000, samples: measured.samples,
    byteLength: audio.media.byteLength, origin: 'originEvidence' in audio ? 'generated' : 'uploaded' };
}

/** Uploaded audio is an owned library asset. It creates no narration sections, cues, holds or paid authority. */
export function registerAudioLibraryRoutes(app: FastifyInstance, options: { production: ProductionService; narration: NarrationService; uploads: ManagedUploadStore }) {
  const { production, narration, uploads } = options, store = production.store, base = '/api/projects/:projectId/audio-library';
  const check = (projectId: string) => { production.recovery.assertWritable(projectId); store.getProject(projectId); };
  app.get<{ Params: { projectId: string }; Querystring: { offset?: string } }>(base, { schema: { params: object({ projectId: id }, ['projectId']), querystring: object({ offset: { type: 'string', pattern: '^(0|[1-9][0-9]{0,6})$' } }) } }, async (request, reply) => {
    const projectId = request.params.projectId, offset = Number(request.query.offset ?? 0);
    const view = store.db.transaction(() => {
      store.getProject(projectId);
      const total = (store.db.prepare("SELECT count(*) total FROM entities WHERE kind='narration_audio' AND project_id=?").get(projectId) as { total: number }).total;
      invariant(offset <= total, 'VALIDATION_ERROR', 'Refresh the recording library before paging');
      const rows = store.db.prepare("SELECT id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='narration_audio' AND project_id=? ORDER BY rowid DESC LIMIT 40 OFFSET ?").all(projectId, offset) as { id: string; bytes: number }[];
      const recordings = rows.map(row => {
        invariant(row.bytes <= 65536, 'MEDIA_INTEGRITY_ERROR', 'Recording metadata exceeds its display bound');
        const audio = store.get<NarrationAudio>('narration_audio', row.id)!;
        invariant(audio?.projectId === projectId, 'MEDIA_INTEGRITY_ERROR', 'Recording metadata lost its project ownership');
        const label = store.get<AudioLabel>('audio_library_label', audio.id);
        return entry(audio, label?.projectId === projectId ? label.label : 'originEvidence' in audio ? 'Generated narration' : 'Uploaded recording');
      });
      return { recordings, coverage: { offset, total, nextOffset: offset + recordings.length < total ? offset + recordings.length : null },
        capabilities: { import: narration.mediaAvailable, maxBytes: uploads.maxBytes, maxSeconds: 360 } };
    }).deferred();
    return reply.header('Cache-Control', 'private, no-store').send(view);
  });
  app.post<{ Params: { projectId: string }; Querystring: { name?: string }; Body: AsyncIterable<Uint8Array> }>(`${base}/uploads`, {
    bodyLimit: uploads.maxBytes,
    schema: { params: object({ projectId: id }, ['projectId']), querystring: object({ name: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[^\\u0000-\\u001f\\u007f/\\\\]+$' } }) },
  }, async (request, reply) => {
    const projectId = request.params.projectId;
    invariant(narration.mediaAvailable, 'NARRATION_MEDIA_UNAVAILABLE', 'Audio import needs local FFmpeg and ffprobe');
    invariant(request.headers['content-type']?.split(';')[0] === 'application/octet-stream', 'VALIDATION_ERROR', 'Upload owned audio bytes as application/octet-stream');
    const key = request.headers['idempotency-key'];
    invariant(typeof key === 'string' && key.length > 0 && key.length <= 160, 'VALIDATION_ERROR', 'An exact bounded import key is required');
    const label = request.query.name?.trim() || 'Uploaded recording', identity = digest({ projectId, key, operation: 'audio-library-import' });
    const upload = await uploads.receive(request.body, identity, () => check(projectId));
    try {
      const inputDigest = digest({ sha256: upload.sha256, byteLength: upload.byteLength, label });
      const intent = store.transaction(() => {
        check(projectId);
        return store.command<AudioLibraryImport>(`local-user:${projectId}:audio-library-import`, key, inputDigest, () => {
          const actor = production.beginRequest(projectId, 'local-user', 'Import this recording into my owned audio library. No narration or music placement is selected.',
            { editing: false, key: `audio-library:${key}`, scopeIds: [projectId], contextDigest: inputDigest });
          const value: AudioLibraryImport = { id: identity, projectId, audioId: newId(), requestId: actor.requestId,
            originalSha256: upload.sha256, originalByteLength: upload.byteLength, label };
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
          const saved = store.insert('narration_audio', intent.audioId, projectId, { media: imported, declaredOrigin: 'uploaded', requestId: intent.requestId }) as SuppliedNarrationAudio;
          store.insert('audio_library_label', saved.id, projectId, { label });
          store.appendEvent(projectId, 'narration.audio_imported', { audioId: saved.id, sha256: imported.sha256 }); return saved;
        });
      }
      invariant(audio.projectId === projectId && audio.media.originalSha256 === upload.sha256 && audio.media.originalByteLength === upload.byteLength,
        'UPLOAD_CORRUPT', 'The saved recording differs from this exact import');
      await narration.media.verifiedSource(audio.media);
      // Return data so Fastify waits for staging cleanup before publishing a successful response.
      // Sending here would let an immediate same-key retry race directory removal in finally.
      reply.header('Cache-Control', 'private, no-store'); return { recording: entry(audio, intent.label) };
    } finally { await upload.release(); }
  });
}
