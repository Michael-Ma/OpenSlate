import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { canonical, digest } from '@openslate/core';
import { createApp } from '../dist/app.js';
import { registerNarrationRoutes } from '../dist/narration/routes.js';
import { MediaApplicationService, registerMediaRoutes } from '../dist/media/index.js';
import { ManagedUploadStore } from '../dist/narration/managed-upload.js';
import { projectDirectorContext, DIRECTOR_PROJECTION_LIMITS } from '../dist/application/context-projection.js';
import { generatedNarrationFixture } from './generated-narration-fixture.mjs';

const token = 'offline_generated_narration_http_token';
async function setup(t) {
  const f = await generatedNarrationFixture(t);
  f.app = createApp({ service: f.production, localToken: token });
  registerNarrationRoutes(f.app, { production: f.production, narration: f.narration, canonical: f.canonical, uploadDirectory: join(f.root, 'uploads') });
  registerMediaRoutes(f.app, { production: f.production, media: new MediaApplicationService(f.production, f.media), uploads: new ManagedUploadStore({ rootDir: join(f.root, 'video-uploads') }) });
  await f.app.ready(); t.after(() => f.app.close());
  f.base = `/api/projects/${f.project.id}/narration`;
  f.request = (suffix = '', payload, extras = {}) => f.app.inject({ method: payload === undefined ? 'GET' : 'POST', url: `${f.base}${suffix}`, ...(payload === undefined ? {} : { payload }), ...extras,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': randomUUID(), ...extras.headers } });
  f.session = async () => {
    const response = await f.request('/sessions', {}); assert.equal(response.statusCode, 200, response.body);
    return response.json().session;
  };
  f.selection = async session => {
    const list = (await f.request('/generated-recordings')).json(), recording = list.recordings[0];
    const view = f.narration.workspaceSnapshot(f.project.id), row = view.segments[0];
    return { sessionId: session.id, expectedVersion: view.state.version, segmentId: row.entry.segmentId, segmentRevisionId: row.script.id,
      artifactId: recording.id, ...recording.selection };
  };
  return f;
}

test('generated recording HTTP lists bounded exact metadata and previews existing WAV without creating authority', async t => {
  const f = await setup(t), before = f.store.db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal((await f.request('/generated-recordings', undefined, { headers: { authorization: '' } })).statusCode, 403);
  assert.equal((await f.request('/generated-recordings', undefined, { headers: { origin: 'https://other.example' } })).statusCode, 403);
  const response = await f.request('/generated-recordings'); assert.equal(response.statusCode, 200, response.body);
  const page = response.json(), audio = page.recordings[0];
  assert.equal(page.recordings.length, 1); assert.equal(page.coverage.nextOffset, null); assert.equal(page.coverage.scanned, 1);
  assert.equal(audio.id, f.artifact.id); assert.equal(audio.originEvidence, 'verified_generated_audio');
  assert.equal(audio.selection.artifactDigest, digest(f.artifact.artifact)); assert.match(audio.selection.generationEvidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(audio.generation.voice, 'coral'); assert.equal('requestId' in audio, false); assert.equal('declaredOrigin' in audio, false);
  assert.ok(!response.body.includes(f.root)); assert.ok(!response.body.includes('synthetic-generated-narration-key'));
  const preview = await f.app.inject({ url: `/api/projects/${f.project.id}/artifacts/${audio.id}/content`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
  assert.equal(preview.statusCode, 200); assert.match(preview.headers['content-type'], /audio\/wav/);
  assert.equal(createHash('sha256').update(preview.rawPayload).digest('hex'), audio.media.sha256);
  const clipLibrary = await f.app.inject({ url: `/api/projects/${f.project.id}/media`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
  assert.equal(clipLibrary.statusCode, 200); assert.deepEqual(clipLibrary.json().sources, [], 'actual generated audio belongs to narration, not the video clip library');
  assert.equal(f.store.list('media_source', f.project.id).length, 1, 'the generated audio source remains retained');
  assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get().n, before); assert.equal(f.store.list('narration_audio', f.project.id).length, 0);
  assert.deepEqual(f.calls, f.initialCalls);
});

test('human HTTP attaches exact generated evidence, replays after later edits and blocks the legacy binding bypass', async t => {
  const f = await setup(t), session = await f.session(), input = await f.selection(session);
  const original = f.narration.workspaceSnapshot(f.project.id), project = canonical(f.store.getProject(f.project.id)), artifact = canonical(f.store.get('artifact', f.artifact.id));
  const counts = Object.fromEntries(['grant', 'attempt', 'reservation', 'external_allowance_consumption', 'hold'].map(kind => [kind, f.store.list(kind, f.project.id).length]));
  const response = await f.request('/generated-audio-bindings', input, { headers: { 'idempotency-key': 'attach-once' } });
  assert.equal(response.statusCode, 200, response.body); const attached = response.json();
  assert.equal(attached.segments[0].audio.id, f.artifact.id); assert.deepEqual(attached.segments[0].accepted, { script: false, audio: false, timing: false });
  assert.deepEqual(attached.segments[1], original.segments[1]);
  const view = (await f.request()).json(), selected = view.snapshot.segments[0].audio;
  assert.deepEqual(selected.selection, { artifactDigest: input.artifactDigest, generationEvidenceDigest: input.generationEvidenceDigest });
  assert.equal(selected.originEvidence, 'verified_generated_audio'); assert.equal('mappingDigest' in selected.generation, false);
  const bypass = await f.request('/bindings', { sessionId: session.id, expectedVersion: attached.state.version, segmentId: input.segmentId, audioId: f.artifact.id });
  assert.equal(bypass.json().error.code, 'NARRATION_GENERATED_ATTACHMENT_REQUIRED');
  const later = await f.request('/placements', { sessionId: session.id, expectedVersion: attached.state.version, placements: [{ segmentId: input.segmentId, atSample: 48000 }] });
  assert.equal(later.statusCode, 200, later.body);
  const replay = await f.request('/generated-audio-bindings', input, { headers: { 'idempotency-key': 'attach-once' } });
  assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), attached);
  const conflict = await f.request('/generated-audio-bindings', { ...input, generationEvidenceDigest: 'f'.repeat(64) }, { headers: { 'idempotency-key': 'attach-once' } });
  assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(canonical(f.store.getProject(f.project.id)), project); assert.equal(canonical(f.store.get('artifact', f.artifact.id)), artifact);
  for (const [kind, count] of Object.entries(counts)) assert.equal(f.store.list(kind, f.project.id).length, count, kind);
  assert.equal(f.store.list('narration_acceptance', f.project.id).length, 0); assert.deepEqual(f.calls, f.initialCalls);
});

test('generated attachment route rejects forged, stale and foreign human selections without adopting anything', async t => {
  const f = await setup(t), session = await f.session(), input = await f.selection(session);
  const before = canonical(f.narration.workspaceSnapshot(f.project.id));
  for (const extra of [{ actor: { kind: 'human' } }, { path: '/tmp/audio.wav' }, { artifactDigest: 'bad' }, { expectedVersion: -1 }]) {
    assert.equal((await f.request('/generated-audio-bindings', { ...input, ...extra })).statusCode, 400);
  }
  assert.equal((await f.request('/generated-audio-bindings', input, { headers: { 'idempotency-key': '' } })).statusCode, 400);
  for (const extra of [{ sessionId: randomUUID() }, { segmentRevisionId: randomUUID() }, { artifactDigest: 'f'.repeat(64) }, { generationEvidenceDigest: 'f'.repeat(64) }, { artifactId: randomUUID() }, { expectedVersion: input.expectedVersion + 1 }]) {
    assert.notEqual((await f.request('/generated-audio-bindings', { ...input, ...extra })).statusCode, 200);
  }
  const other = f.production.createProject('Other project');
  const cross = await f.request('/generated-audio-bindings', input, { url: `/api/projects/${other.id}/narration/generated-audio-bindings` });
  assert.equal(cross.json().error.code, 'NARRATION_SESSION_STALE');
  f.production.beginRequest(f.project.id, 'local-user', 'New independent edit');
  assert.equal((await f.request('/generated-audio-bindings', input)).json().error.code, 'NARRATION_SESSION_STALE');
  assert.equal(canonical(f.narration.workspaceSnapshot(f.project.id)), before); assert.equal(f.store.list('narration_audio', f.project.id).length, 0);
  assert.deepEqual(f.calls, f.initialCalls);
});

test('eligible library scanning is paged before provenance resolution and cannot join a stale page', async t => {
  const f = await setup(t);
  // Deliberately invalid retained artifact rows exercise omission without requiring 40 conversions.
  for (let i = 0; i < 40; i++) f.store.insert('artifact', `invalid-${i}`, f.project.id, { id: `invalid-${i}`, projectId: f.project.id, origin: 'generated_audio' });
  const changes = f.store.db.prepare('SELECT total_changes() AS n').get().n;
  const first = (await f.request('/generated-recordings')).json();
  assert.equal(first.coverage.scanned, 40); assert.equal(first.recordings.length, 0); assert.equal(first.coverage.nextOffset, 40);
  const second = (await f.request(`/generated-recordings?offset=40&expectedDigest=${first.coverage.dataDigest}`)).json();
  assert.equal(second.recordings.length, 1); assert.equal(second.recordings[0].id, f.artifact.id); assert.equal(second.coverage.nextOffset, null);
  assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get().n, changes);
  f.store.insert('artifact', 'new-invalid', f.project.id, { id: 'new-invalid', projectId: f.project.id, origin: 'generated_audio' });
  assert.equal((await f.request(`/generated-recordings?offset=40&expectedDigest=${first.coverage.dataDigest}`)).json().error.code, 'REVISION_CONFLICT');
  assert.equal((await f.request('/generated-recordings?offset=1000001')).statusCode, 400);
});

test('context distinguishes generated evidence from human labels while preserving byte bounds and detached reads', async t => {
  const f = await setup(t), session = await f.session(), input = await f.selection(session);
  assert.equal((await f.request('/generated-audio-bindings', input)).statusCode, 200);
  const actor = { kind: 'human', principalId: 'local-user', requestId: session.requestId };
  const before = f.store.db.prepare('SELECT total_changes() AS n').get().n;
  const page = projectDirectorContext(f.production, f.project.id, actor, { section: 'narration' }), summary = page.audioLibrary[0];
  assert.equal(summary.originEvidence, 'verified_generated_audio'); assert.equal('declaredOrigin' in summary, false); assert.equal('requestId' in summary, false);
  assert.equal(summary.selection.generationEvidenceDigest, input.generationEvidenceDigest); assert.equal(summary.generation.voice, 'coral');
  assert.ok(!canonical(page).includes(f.root)); assert.ok(Buffer.byteLength(canonical(page)) <= DIRECTOR_PROJECTION_LIMITS.bytes);
  const expected = structuredClone(summary), guard = page.guard.dataDigest; summary.generation.voice = 'invented'; summary.selection.artifactDigest = 'changed';
  const next = projectDirectorContext(f.production, f.project.id, actor, { section: 'narration' });
  assert.deepEqual(next.audioLibrary[0], expected); assert.equal(next.guard.dataDigest, guard);
  assert.equal(next.applicationCapabilities.narration.generatedRecordingAttachment.toolAvailable, false);
  assert.equal(next.applicationCapabilities.narration.speechSynthesis.available, false); assert.equal(next.applicationCapabilities.narration.transcription.available, false);
  assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get().n, before); assert.deepEqual(f.calls, f.initialCalls);
});
