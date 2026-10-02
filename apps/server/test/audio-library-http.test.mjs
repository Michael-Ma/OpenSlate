import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { NarrationService } from '../dist/narration/service.js';
import { NarrationCanonicalService } from '../dist/narration/canonical.js';
import { registerNarrationRoutes } from '../dist/narration/routes.js';
import { createApp } from '../dist/app.js';
import { editStoryboard } from '../dist/storyboard.js';
import { wave } from './speech-execution-fixture.mjs';

const token = 'offline_owned_audio_library_token', bytes = wave(24000);
const paths = { ffmpegPath: process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg'),
  ffprobePath: process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe') };
async function fixture(t, mediaAvailable = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openslate-audio-library-'))), store = new Store(join(root, 'app.sqlite'));
  const provider = new FakeProvider(join(root, 'fake.sqlite')), engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') });
  const production = new ProductionService(store, engine), project = production.createProject('Owned recording library'), uploadDirectory = join(root, 'uploads');
  const { mkdirSync } = await import('node:fs'); mkdirSync(uploadDirectory);
  const media = new LocalMediaService({ rootDir: join(root, 'media'), allowedInputRoots: [uploadDirectory], ...paths });
  const narration = new NarrationService(production, mediaAvailable ? media : undefined), canonical = new NarrationCanonicalService(narration);
  const app = createApp({ service: production, localToken: token });
  registerNarrationRoutes(app, { production, narration, canonical, uploadDirectory }); await app.ready();
  t.after(async () => { await app.close(); store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  const f = { root, store, provider, engine, production, project, media, narration, uploadDirectory, app };
  f.request = (suffix = '', payload, key = randomUUID(), extraHeaders = {}) => app.inject({ method: payload === undefined ? 'GET' : 'POST', url: `/api/projects/${project.id}/audio-library${suffix}`,
    ...(payload === undefined ? {} : { payload }), headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': key,
      ...(payload === undefined ? {} : { 'content-type': 'application/octet-stream' }), ...extraHeaders } });
  f.upload = (body = bytes, key = 'one-recording', name = 'Quiet music.wav') => f.request(`/uploads?name=${encodeURIComponent(name)}`, body, key);
  return f;
}
const frozen = f => ['hold', 'epoch', 'grant', 'attempt', 'narration_state', 'narration_segment', 'narration_cue', 'narration_canonical', 'external_allowance'].map(kind => f.store.list(kind, f.project.id));

test('owned library upload is normalized and playable without changing current creative authority, head, holds or narration', async t => {
  const f = await fixture(t), human = f.production.beginRequest(f.project.id, 'local-user', 'Continue the existing film plan.'), epoch = f.production.openEpoch(f.project.id, human);
  const before = frozen(f), projectBefore = f.store.getProject(f.project.id), first = await f.upload(); assert.equal(first.statusCode, 200, first.body);
  const recording = first.json().recording; assert.equal(recording.label, 'Quiet music.wav'); assert.equal(recording.origin, 'uploaded'); assert.equal(recording.samples, 48000);
  assert.equal(recording.durationSeconds, 1); assert.deepEqual(frozen(f), before); assert.deepEqual(f.store.getProject(f.project.id), projectBefore);
  assert.doesNotThrow(() => f.production.assertActor(f.project.id, epoch.actor, true));
  const source = f.store.get('narration_audio', recording.id); assert.equal(source.projectId, f.project.id);
  assert.equal(f.store.get('message', source.requestId).editing, false); assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
  const listing = await f.request(); assert.equal(listing.statusCode, 200, listing.body); assert.equal(listing.json().recordings[0].id, recording.id);
  assert.ok(!listing.body.includes(f.root));
  const other = f.production.createProject('Another audio library');
  const foreign = await f.app.inject({ method: 'GET', url: `/api/projects/${other.id}/narration/audio/${recording.id}/content`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
  assert.equal(foreign.statusCode, 404); const otherLibrary = await f.app.inject({ method: 'GET', url: `/api/projects/${other.id}/audio-library`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
  assert.equal(otherLibrary.json().recordings.length, 0);
  const played = await f.app.inject({ method: 'GET', url: `/api/projects/${f.project.id}/narration/audio/${recording.id}/content`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
  assert.equal(played.statusCode, 200); assert.equal(createHash('sha256').update(played.rawPayload).digest('hex'), recording.sha256);
  assert.deepEqual(await readdir(f.uploadDirectory), []);
});

test('the exact upload key replays once; changed bytes or name cannot allocate new recording or request', async t => {
  const f = await fixture(t); const first = await f.upload(); assert.equal(first.statusCode, 200, first.body);
  const count = f.store.list('message', f.project.id).length;
  const replay = await f.upload(); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), first.json());
  assert.equal(f.store.list('message', f.project.id).length, count); assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
  const different = await f.upload(wave(24001)); assert.equal(different.statusCode, 409, different.body);
  const renamed = await f.upload(bytes, 'one-recording', 'Other label.wav'); assert.equal(renamed.statusCode, 409, renamed.body);
  assert.equal(f.store.list('message', f.project.id).length, count); assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
  assert.deepEqual(await readdir(f.uploadDirectory), []);
});

test('auth, media availability, binary content, extra query paths and missing retry keys are rejected before local import', async t => {
  const f = await fixture(t);
  const denied = await f.request('/uploads', bytes, 'denied', { authorization: '' }); assert.equal(denied.statusCode, 403);
  const json = await f.request('/uploads', '{}', 'json', { 'content-type': 'application/json' }); assert.equal(json.statusCode, 400, json.body);
  const extra = await f.request('/uploads?path=/private/secret.wav', bytes); assert.equal(extra.statusCode, 400, extra.body);
  const missing = await f.request('/uploads', bytes, '', { 'idempotency-key': '' }); assert.equal(missing.statusCode, 400, missing.body);
  assert.equal(f.store.list('narration_audio', f.project.id).length, 0); assert.equal(f.store.list('audio_library_import', f.project.id).length, 0);
  const g = await fixture(t, false), result = await g.upload(); assert.notEqual(result.statusCode, 200);
  assert.equal(result.json().error.code, 'NARRATION_MEDIA_UNAVAILABLE'); assert.equal(g.store.list('message', g.project.id).length, 0);
});

test('interrupted SQL publication reuses its allocated owned identity, and importing never selects the soundtrack', async t => {
  const f = await fixture(t), insert = f.store.insert.bind(f.store); let injected = true;
  f.store.insert = (...args) => { if (args[0] === 'narration_audio' && injected) { injected = false; throw Error('INJECTED_AUDIO_PUBLICATION_FAILURE'); } return insert(...args); };
  const failed = await f.upload(); assert.equal(failed.statusCode, 500, failed.body); f.store.insert = insert;
  const intent = f.store.list('audio_library_import', f.project.id)[0]; assert.ok(intent?.audioId); assert.equal(f.store.list('narration_audio', f.project.id).length, 0);
  const retry = await f.upload(); assert.equal(retry.statusCode, 200, retry.body); assert.equal(retry.json().recording.id, intent.audioId);
  assert.equal(f.store.list('message', f.project.id).length, 1); assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
  assert.equal(f.store.getProject(f.project.id).soundtrack ?? null, null);
  const before = f.store.getProject(f.project.id); editStoryboard(f.production, f.project.id, { expectedHeadVersion: before.headVersion, kind: 'soundtrack', field: 'audioId', value: intent.audioId }, randomUUID());
  assert.equal(f.store.getProject(f.project.id).soundtrack.audioId, intent.audioId); assert.equal(f.store.getProject(f.project.id).headVersion, before.headVersion + 1);
});
