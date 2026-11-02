import { narrationServiceHarness, fixtureAudioRequestSession } from './narration-service-harness.mjs';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

async function fixture(t, { withMedia = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'openslate-narration-http-')), uploadDirectory = join(dir, 'uploads'); await mkdir(uploadDirectory);
  const store = new Store(join(dir, 'db.sqlite')), provider = new FakeProvider(join(dir, 'fake.sqlite')), engine = new Engine(store, provider, { artifactDir: join(dir, 'artifacts') });
  const production = new ProductionService(store, engine), project = production.createProject('Narration upload review');
  const media = new LocalMediaService({ rootDir: join(dir, 'media'), allowedInputRoots: [uploadDirectory], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const narration = new NarrationService(production, withMedia ? media : undefined), canonical = new NarrationCanonicalService(narration), app = createApp({ service: production, localToken: token });
  registerNarrationRoutes(app, { production, narration, canonical, uploadDirectory }); await app.ready();
  const f = { dir, uploadDirectory, store, provider, engine, production, project, media, narration, canonical, app, session: null };
  f.http = (suffix = '', body, extras = {}) => app.inject({ method: body === undefined ? 'GET' : 'POST', url: `/api/projects/${project.id}/narration${suffix}`, ...(body === undefined ? {} : { payload: body }), ...extras,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': randomUUID(), ...extras.headers } });
  f.testToken = token;
  f.request = narrationServiceHarness(f, { uploadDirectory });
  f.start = async (_body = {}, commandKey = randomUUID()) => { f.session = fixtureAudioRequestSession(f, commandKey); return f.session; };
  f.view = () => narration.workspaceSnapshot(project.id);
  f.edit = (suffix, fields, extras = {}) => f.request(suffix, { sessionId: f.session.id, expectedVersion: f.view().state.version, ...fields }, extras);
  f.upload = (bytes = wave, commandKey = 'wave-once', extra = '') => f.request(`/audio?sessionId=${f.session.id}&declaredOrigin=uploaded${extra}`, bytes, { headers: { 'content-type': 'application/octet-stream', 'idempotency-key': commandKey } });
  t.after(async () => { await app.close(); if (store.db.open) store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); }); return f;
}

test('retained narration playback requires local authentication and reads create no authority', async t => {
  const f = await fixture(t), before = f.store.db.prepare('SELECT total_changes() n').get().n;
  assert.equal((await f.http('/playback', undefined, { headers: { authorization: '' } })).statusCode, 403);
  assert.equal((await f.http('/playback', undefined, { headers: { origin: 'https://other.example' } })).statusCode, 403);
  assert.equal((await f.http('/playback')).statusCode, 200);
  assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n, before);
  assert.equal(f.store.list('message', f.project.id).length, 0);
  assert.equal(f.store.list('hold', f.project.id).length, 0);
});


test('service upload replay preserves identity and rejects different bytes or origin under the same key', async t => {
  const f = await fixture(t); await f.start(); const first = await f.upload(); assert.equal(first.statusCode, 200, first.body);
  const replay = await f.upload(); assert.equal(replay.statusCode, 200); assert.deepEqual(replay.json(), first.json());
  const changed = Buffer.concat([wave, Buffer.from('changed')]); const conflict = await f.upload(changed); assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
  const origin = await f.request(`/audio?sessionId=${f.session.id}&declaredOrigin=generated`, wave, { headers: { 'content-type': 'application/octet-stream', 'idempotency-key': 'wave-once' } }); assert.equal(origin.json().error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1); assert.deepEqual(await readdir(f.uploadDirectory), []);
});

test('narration services reject stale revisions and cross-project authority', async t => {
  const f = await fixture(t); await f.start(); await f.edit('/segments', { patch: { add: [draft] } });
  assert.equal((await f.edit('/segments', { expectedVersion: 0, patch: { add: [draft] } })).json().error.code, 'REVISION_CONFLICT');
  const foreign = f.production.createProject('Other');
  const response = await f.request('/segments', { sessionId: f.session.id, expectedVersion: 0, patch: { add: [draft] } }, { url: `/api/projects/${foreign.id}/narration/segments`, headers: { 'idempotency-key': 'foreign' } });
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

test('service upload command identity recovers after closing the backend', async t => {
  const f = await fixture(t); await f.start({}, 'session'); const upload = await f.upload(); assert.equal(upload.statusCode, 200); const original = upload.json(), sessionId = f.session.id;
  await f.app.close(); f.store.close();
  const store = new Store(join(f.dir, 'db.sqlite')), engine = new Engine(store, f.provider, { artifactDir: f.engine.artifactDir }), production = new ProductionService(store, engine);
  const media = new LocalMediaService({ rootDir: f.media.rootDir, allowedInputRoots: [f.uploadDirectory], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration), app = createApp({ service: production, localToken: token });
  registerNarrationRoutes(app, { production, narration, canonical, uploadDirectory: f.uploadDirectory });
  try {
    const invoke = narrationServiceHarness({ production, store, narration, canonical, project: f.project, app, testToken: token }, { uploadDirectory: f.uploadDirectory });
    const view = await invoke(); assert.equal(view.json().session.id, sessionId);
    const replay = await invoke(`/audio?sessionId=${sessionId}&declaredOrigin=uploaded`, wave, { headers: { 'idempotency-key': 'wave-once' } });
    assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), original); assert.equal(store.list('narration_audio', f.project.id).length, 1);
    assert.equal(store.list('message', f.project.id).length, 1); assert.deepEqual(await readdir(f.uploadDirectory), []);
  } finally { await app.close(); store.close(); }
});
