import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { createApp } from '../dist/app.js';
import { Store } from '../dist/persistence/index.js';
import { Engine } from '../dist/execution/index.js';
import { ProductionService } from '../dist/application/service.js';
import { NarrationService, NarrationCanonicalService } from '../dist/narration/index.js';
import { registerNarrationRoutes } from '../dist/narration/routes.js';
import { ManagedUploadStore } from '../dist/narration/managed-upload.js';
import { LocalMediaService } from '../dist/media/index.js';
import { FakeProvider } from '@openslate/providers';
const token = 'local_narration_test_token_0000000';
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg');
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe');
let inputDir, wave;
before(async () => { inputDir = await mkdtemp(join(tmpdir(), 'openslate-narration-http-input-')); const path = join(inputDir, 'wave.wav'); await promisify(execFile)(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=530:sample_rate=44100:duration=1', '-c:a', 'pcm_s16le', path], { timeout: 15000 }); wave = await readFile(path); });
after(async () => rm(inputDir, { recursive: true, force: true }));
const draft = { text: 'Built with care', textKind: 'draft', language: 'en', meaning: 'Handmade construction', source: { kind: 'uploaded' } };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'openslate-narration-http-')), uploadDirectory = join(dir, 'uploads'); await mkdir(uploadDirectory);
  const store = new Store(join(dir, 'db.sqlite')), provider = new FakeProvider(join(dir, 'fake.sqlite')), engine = new Engine(store, provider, { artifactDir: join(dir, 'artifacts') });
  const production = new ProductionService(store, engine), project = production.createProject('Narration upload review');
  const media = new LocalMediaService({ rootDir: join(dir, 'media'), allowedInputRoots: [uploadDirectory], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration), app = createApp({ service: production, localToken: token });
  registerNarrationRoutes(app, { production, narration, canonical, uploadDirectory }); await app.ready();
  const f = { dir, uploadDirectory, store, provider, engine, production, project, media, narration, canonical, app, session: null };
  f.request = (suffix = '', body, extras = {}) => app.inject({ method: body === undefined ? 'GET' : 'POST', url: `/api/projects/${project.id}/narration${suffix}`, ...(body === undefined ? {} : { payload: body }), ...extras,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': randomUUID(), ...extras.headers } });
  f.start = async (body = {}, commandKey = randomUUID()) => { const response = await f.request('/sessions', body, { headers: { 'idempotency-key': commandKey } }); assert.equal(response.statusCode, 200, response.body); f.session = response.json().session; return response.json(); };
  f.view = () => narration.workspaceSnapshot(project.id);
  f.edit = (suffix, fields, extras = {}) => f.request(suffix, { sessionId: f.session.id, expectedVersion: f.view().state.version, ...fields }, extras);
  f.upload = (bytes = wave, commandKey = 'wave-once', extra = '') => f.request(`/audio?sessionId=${f.session.id}&declaredOrigin=uploaded${extra}`, bytes, { headers: { 'content-type': 'application/octet-stream', 'idempotency-key': commandKey } });
  t.after(async () => { await app.close(); if (store.db.open) store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); }); return f;
}

test('HTTP narration requires local authentication and GET does not create sessions or holds', async t => {
  const f = await fixture(t), cursor = f.store.cursor(f.project.id);
  const denied = await f.request('', undefined, { headers: { authorization: '' } }); assert.equal(denied.statusCode, 403);
  const badOrigin = await f.request('', undefined, { headers: { origin: 'https://other.example' } }); assert.equal(badOrigin.statusCode, 403);
  const view = await f.request(); assert.equal(view.statusCode, 200); assert.equal(view.json().session, null); assert.equal(view.json().canonical, null);
  assert.equal(f.store.cursor(f.project.id), cursor); assert.equal(f.store.list('message', f.project.id).length, 0); assert.equal(f.store.list('hold', f.project.id).length, 0);
  assert.equal((await f.request('/sessions', { actor: { kind: 'human' } })).statusCode, 400);
  assert.equal((await f.request('/sessions', {}, { headers: { 'idempotency-key': '' } })).statusCode, 400);
});

test('one persisted human session spans edits; stale sessions require explicit continuation without new grants', async t => {
  const f = await fixture(t), initial = await f.start({}, 'start');
  assert.equal((await f.start({}, 'start')).session.id, initial.session.id); assert.equal(f.store.list('message', f.project.id).length, 1);
  assert.equal((await f.edit('/segments', { patch: { add: [draft] } })).statusCode, 200);
  assert.equal((await f.edit('/segments', { patch: { add: [{ ...draft, text: 'Made to last' }] } })).statusCode, 200);
  assert.equal(f.store.list('message', f.project.id).length, 1);
  const oldSession = f.session.id, unrelated = f.production.beginRequest(f.project.id, 'local-user', 'Edit another part');
  const stale = await f.edit('/segments', { patch: { remove: [f.view().segments[0].entry.segmentId] } }); assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'NARRATION_SESSION_STALE');
  assert.equal((await f.request()).json().session.state, 'stale');
  assert.equal((await f.request('/sessions', {})).json().error.code, 'NARRATION_SESSION_EXISTS');
  await f.start({ continuationSessionId: oldSession });
  assert.notEqual(f.session.id, oldSession); assert.equal(f.store.list('request_continuation', f.project.id).length, 1);
  assert.ok(f.store.list('hold', f.project.id).some(hold => hold.ownerId === unrelated.requestId && hold.active));
  assert.equal(f.store.list('grant', f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test('uploaded audio can be heard before acceptance; exact human decisions then commit without generation', async t => {
  const f = await fixture(t); await f.start();
  assert.equal((await f.edit('/segments', { patch: { add: [draft] } })).statusCode, 200);
  const upload = await f.upload(); assert.equal(upload.statusCode, 200, upload.body); const audio = upload.json();
  const preview = await f.request(`/audio/${audio.id}/content`); assert.equal(preview.statusCode, 200); assert.match(preview.headers['content-type'], /audio\/wav/);
  assert.equal(createHash('sha256').update(preview.rawPayload).digest('hex'), audio.media.sha256); assert.equal(preview.headers['x-content-sha256'], audio.media.sha256);
  assert.equal(f.store.list('narration_acceptance', f.project.id).length, 0);
  const segment = f.view().segments[0];
  assert.equal((await f.edit('/bindings', { segmentId: segment.entry.segmentId, audioId: audio.id })).statusCode, 200);
  assert.equal((await f.edit('/cues', { segmentId: segment.entry.segmentId, startSample: 0, endSample: 48000 })).statusCode, 200);
  assert.equal((await f.edit('/acceptances', { kind: 'script', targets: [segment.script.id] })).statusCode, 200);
  assert.equal((await f.edit('/audio-acceptances', { targets: [{ segmentRevisionId: segment.script.id, audioId: audio.id }] })).statusCode, 200);
  assert.equal((await f.edit('/acceptances', { kind: 'timing', targets: [f.view().segments[0].cue.id] })).statusCode, 200);
  const prepared = await f.request('/prepare', { sessionId: f.session.id, expectedHeadVersion: 0, expectedNarrationVersion: f.view().state.version, shotMappings: [] }); assert.equal(prepared.statusCode, 200, prepared.body);
  const applied = await f.request('/apply', { sessionId: f.session.id, preparedId: prepared.json().id }, { headers: { 'idempotency-key': 'apply-once' } }); assert.equal(applied.statusCode, 200, applied.body);
  assert.deepEqual((await f.request('/apply', { sessionId: f.session.id, preparedId: prepared.json().id })).json(), applied.json());
  const conflictingApply = await f.request('/apply', { sessionId: f.session.id, preparedId: randomUUID() }, { headers: { 'idempotency-key': 'apply-once' } }); assert.equal(conflictingApply.json().error.code, 'IDEMPOTENCY_CONFLICT');
  const current = (await f.request()).json(); assert.equal(current.canonical.id, applied.json().canonicalId); assert.equal(current.headVersion, 1);
  assert.equal(current.canonical.source, 'uploaded'); assert.ok(f.store.list('hold', f.project.id).some(hold => hold.active));
  assert.equal(f.store.list('grant', f.project.id).length, 0); assert.equal(f.store.list('attempt', f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
  assert.deepEqual(await readdir(f.uploadDirectory), []);
});

test('upload replay preserves identity and rejects different bytes, origin or client paths under the same key', async t => {
  const f = await fixture(t); await f.start(); const first = await f.upload(); assert.equal(first.statusCode, 200, first.body);
  const replay = await f.upload(); assert.equal(replay.statusCode, 200); assert.deepEqual(replay.json(), first.json());
  const changed = Buffer.concat([wave, Buffer.from('changed')]); const conflict = await f.upload(changed); assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
  const origin = await f.request(`/audio?sessionId=${f.session.id}&declaredOrigin=generated`, wave, { headers: { 'content-type': 'application/octet-stream', 'idempotency-key': 'wave-once' } }); assert.equal(origin.json().error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.upload(wave, 'path', '&path=/etc/passwd')).statusCode, 400);
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1); assert.deepEqual(await readdir(f.uploadDirectory), []);
});

test('revision, exact target, cross-project and actor fields are validated at the HTTP boundary', async t => {
  const f = await fixture(t); await f.start(); await f.edit('/segments', { patch: { add: [draft] } });
  assert.equal((await f.edit('/segments', { expectedVersion: 0, patch: { add: [draft] } })).json().error.code, 'REVISION_CONFLICT');
  assert.equal((await f.edit('/acceptances', { kind: 'script', targets: [randomUUID()] })).json().error.code, 'NARRATION_STALE_ACCEPTANCE');
  assert.equal((await f.edit('/segments', { actor: { kind: 'human' }, patch: { add: [draft] } })).statusCode, 400);
  assert.equal((await f.edit('/segments', { patch: { add: [{ ...draft, accepted: true }] } })).statusCode, 400);
  const foreign = f.production.createProject('Other');
  const response = await f.app.inject({ method: 'POST', url: `/api/projects/${foreign.id}/narration/segments`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': 'foreign' }, payload: { sessionId: f.session.id, expectedVersion: 0, patch: { add: [draft] } } });
  assert.equal(response.json().error.code, 'NARRATION_SESSION_STALE');
});

test('an edit during upload normalization fences the old session and cleans staging', async t => {
  const f = await fixture(t); await f.start(); const original = f.media.importMedia.bind(f.media);
  f.media.importMedia = async (...args) => { const result = await original(...args); f.production.beginRequest(f.project.id, 'local-user', 'New direction while uploading'); return result; };
  const response = await f.upload(); assert.equal(response.statusCode, 403); assert.equal(response.json().error.code, 'ACTOR_DENIED');
  assert.equal(f.store.list('narration_audio', f.project.id).length, 0); assert.deepEqual(await readdir(f.uploadDirectory), []);
});

test('managed streaming uploads enforce byte bounds and clean interrupted streams', async t => {
  const root = await mkdtemp(join(tmpdir(), 'openslate-upload-bound-')); t.after(() => rm(root, { recursive: true, force: true }));
  const uploads = new ManagedUploadStore({ rootDir: root, maxBytes: 8 });
  await assert.rejects(uploads.receive(Readable.from([Buffer.alloc(9)]), 'too-large', () => {}), error => error.code === 'UPLOAD_TOO_LARGE');
  async function* interrupted() { yield Buffer.from('123'); throw new Error('synthetic interrupted upload'); }
  await assert.rejects(uploads.receive(interrupted(), 'interrupted', () => {}), /synthetic interrupted upload/);
  assert.deepEqual(await readdir(root), []);
  const one = await uploads.receive(Readable.from([Buffer.from('123')]), 'same', () => {}), two = await uploads.receive(Readable.from([Buffer.from('123')]), 'same', () => {});
  assert.equal(one.path, two.path); await one.release(); assert.deepEqual(await readFile(two.path), Buffer.from('123')); await two.release(); assert.deepEqual(await readdir(root), []);
});

test('recording library survives reload, pages without clipping and never exposes host paths', async t => {
  const f = await fixture(t); await f.start(); const upload = await f.upload(); assert.equal(upload.statusCode, 200); const audio = upload.json();
  const one = (await f.request()).json(); assert.equal(one.snapshot.segments.length, 0); assert.equal(one.audioLibrary[0].id, audio.id);
  assert.equal(one.audioLibrary[0].media.sha256, audio.media.sha256); assert.deepEqual(one.coverage.audioLibrary, { offset: 0, returned: 1, total: 1, nextOffset: null });
  f.store.transaction(() => { for (let index = 0; index < 401; index++) { const id = randomUUID(); f.store.insert('narration_audio', id, f.project.id, { ...audio, id, media: { ...audio.media, artifactId: id } }); } });
  const cursor = f.store.cursor(f.project.id), first = (await f.request()).json(), second = (await f.request('?audioOffset=400')).json();
  assert.equal(first.audioLibrary.length, 400); assert.equal(second.audioLibrary.length, 2); assert.equal(first.coverage.audioLibrary.total, 402);
  assert.equal(first.coverage.audioLibrary.nextOffset, 400); assert.equal(second.coverage.audioLibrary.nextOffset, null);
  assert.equal(new Set([...first.audioLibrary, ...second.audioLibrary].map(item => item.id)).size, 402);
  assert.ok(!JSON.stringify(first.audioLibrary).includes(f.dir)); assert.equal(f.store.cursor(f.project.id), cursor);
  assert.equal((await f.request('?audioOffset=999')).statusCode, 400); assert.equal((await f.request('?audioOffset=01')).statusCode, 400);
  const other = f.production.createProject('Foreign audio');
  const denied = await f.app.inject({ method: 'GET', url: `/api/projects/${other.id}/narration/audio/${audio.id}/content`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } }); assert.equal(denied.statusCode, 404);
});

test('HTTP session and upload command identity recover after closing the backend', async t => {
  const f = await fixture(t); await f.start({}, 'session'); const upload = await f.upload(); assert.equal(upload.statusCode, 200); const original = upload.json(), sessionId = f.session.id;
  await f.app.close(); f.store.close();
  const store = new Store(join(f.dir, 'db.sqlite')), engine = new Engine(store, f.provider, { artifactDir: f.engine.artifactDir }), production = new ProductionService(store, engine);
  const media = new LocalMediaService({ rootDir: f.media.rootDir, allowedInputRoots: [f.uploadDirectory], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration), app = createApp({ service: production, localToken: token });
  registerNarrationRoutes(app, { production, narration, canonical, uploadDirectory: f.uploadDirectory });
  try {
    const headers = { host: '127.0.0.1', authorization: `Bearer ${token}` };
    const view = await app.inject({ url: `/api/projects/${f.project.id}/narration`, headers }); assert.equal(view.json().session.id, sessionId); assert.equal(view.json().audioLibrary[0].id, original.id);
    const replay = await app.inject({ method: 'POST', url: `/api/projects/${f.project.id}/narration/audio?sessionId=${sessionId}&declaredOrigin=uploaded`, headers: { ...headers, 'content-type': 'application/octet-stream', 'idempotency-key': 'wave-once' }, payload: wave });
    assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), original); assert.equal(store.list('narration_audio', f.project.id).length, 1);
    assert.equal(store.list('message', f.project.id).length, 1); assert.deepEqual(await readdir(f.uploadDirectory), []);
  } finally { await app.close(); store.close(); }
});
