import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { DirectorImageProjector, imageMessageContext } from '../dist/application/director-images.js';
import { directorInputDigest } from '../dist/application/director-input-identity.js';
import { prepareDirectorImages } from '../../../packages/director/dist/runtime/images.js';
import { FakeProvider } from '@openslate/providers';
import { canonical, digest, newId } from '@openslate/core';
import { createApp } from '../dist/app.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const ffmpegPath = realpathSync(process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let inputRoot, png, noisyPng;
before(async () => { inputRoot = mkdtempSync(join(tmpdir(), 'openslate-director-image-input-')); const path = join(inputRoot, 'red.png'); await promisify(execFile)(ffmpegPath, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1280x720', '-frames:v', '1', '-threads', '1', path], { timeout: 15000 }); png = readFileSync(path);
  const noise = join(inputRoot, 'noise.png');
  await promisify(execFile)(ffmpegPath, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'nullsrc=s=768x768,geq=random(1)*255:random(2)*255:random(3)*255', '-frames:v', '1', '-threads', '1', noise], { timeout: 15000 }); noisyPng = readFileSync(noise);
});
after(() => rmSync(inputRoot, { recursive: true, force: true }));
function writable(path) { chmodSync(path, 0o755); for (const item of readdirSync(path, { withFileTypes: true })) if (item.isDirectory()) writable(join(path, item.name)); }
function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openslate-director-images-'))), store = new Store(join(root, 'app.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') }), service = new ProductionService(store, engine), calls = [];
  const config = { repositoryRoot, dataDirectory: root, endpoint: 'http://127.0.0.1:3001', ffmpegPath: options.ffmpegPath ?? ffmpegPath,
    defaults: { binaryPath: process.execPath, model: 'test-model' }, setup: async () => ({ readiness: { status: 'ready' }, runtimeOptions: {} }),
    makeRuntime: () => ({ id: 'codex-app-server', start: async (input, options) => { calls.push(input); await options.onEvent({ ...input, kind: 'runtime_started', nativeThreadId: `thread-${input.turnId}` }); return { projectId: input.projectId, requestId: input.requestId, turnId: input.turnId, epochId: input.epochId, status: 'completed', text: 'Observed selected reference', dispatched: true }; } }) };
  if (options.unavailable) delete config.ffmpegPath;
  const director = new LocalDirectorController(service, config), token = 'test-director-image-token-at-least-20', app = createApp({ service, director, runtimeSettings: director, localToken: token });
  const project = service.createProject('Image discussion'), native = { mode: 'native', binaryPath: process.execPath, model: 'test-model' };
  const req = (body, key = newId(), id = project.id) => app.inject({ method: 'POST', url: `/api/projects/${id}/messages`, payload: body, headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': key } });
  const add = (projectId = project.id, bytes = png, extra = {}) => {
    const artifactId = newId(), path = join(engine.artifactDir, `${artifactId}.png`), artifact = { artifactId, sha256: sha(bytes), kind: 'image' };
    writeFileSync(path, bytes);
    // Imported PNG validation has separate decode/HTTP coverage. This fixture starts at its immutable owned record.
    store.insert('artifact', artifactId, projectId, { id: artifactId, projectId, artifact, path, origin: 'supplied_image', fixture: false, mimeType: 'image/png', attemptId: null, byteLength: bytes.length, width: 1280, height: 720, ...extra });
    const value = store.getProject(projectId); store.saveProject({ ...value, artifacts: [...value.artifacts, artifact] }, value.headVersion);
    return { artifactId, sha256: artifact.sha256, path };
  };
  t.after(async () => { await director.close(); await app.close(); provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  const select = image => ({ artifactId: image.artifactId, sha256: image.sha256 });
  const body = images => ({ text: 'Discuss these references without editing', editing: false, images: images.map(select) });
  return { root, store, provider, engine, service, project, director, config, native, app, req, add, select, body, calls };
}
function context(f, images) {
  const actor = f.service.beginRequest(f.project.id, 'local-user', 'Discuss', { editing: false, contextDigest: imageMessageContext(images.map(f.select)) });
  const projector = new DirectorImageProjector(f.service, { ffmpegPath: f.config.ffmpegPath }); projector.record(f.project.id, actor, images.map(f.select));
  const bridge = f.service.openEpoch(f.project.id, actor), input = { projectId: f.project.id, requestId: actor.requestId, epochId: bridge.actor.epochId, turnId: newId(), text: 'Discuss', context: '{}', skills: [], bridge: { toolContractVersion: '2.0.0' } };
  const projection = join(f.root, 'projection'); mkdirSync(projection); return { projector, actor, bridge, input, projection };
}
async function until(predicate) { const started = Date.now(); while (!predicate()) { assert.ok(Date.now() - started < 5000, 'timed out waiting for fixture'); await new Promise(resolve => setTimeout(resolve, 10)); } }

test('native message records ordered selection before queue, derives verified thumbnails and never carries them forward', async t => {
  const f = fixture(t), image = f.add(), duplicateBytes = f.add(); await f.director.configure(f.project.id, f.native, 'native');
  const held = f.service.beginRequest(f.project.id, 'local-user', 'Keep this pending edit'); const holds = f.store.list('hold', f.project.id), canonicalBefore = digest(f.store.getProject(f.project.id));
  let selectionAtQueue;
  const enqueue = f.director.enqueue.bind(f.director); f.director.enqueue = (...args) => { selectionAtQueue = f.store.get('request_image_selection', args[1].requestId); return enqueue(...args); };
  const request = await f.req(f.body([duplicateBytes, image]), 'discuss'); assert.equal(request.statusCode, 200, request.body); assert.ok(selectionAtQueue);
  assert.deepEqual(selectionAtQueue.images, [f.select(duplicateBytes), f.select(image)]); await f.director.settle();
  assert.equal(f.calls.length, 1); const input = f.calls[0], receipt = f.store.get('request_image_projection', input.requestId);
  assert.equal(input.images.length, 2); assert.notEqual(input.images[0].path, input.images[1].path, 'identical source content retains separate ordered paths');
  const frozen = await prepareDirectorImages(input.images, join(f.root, 'native', f.project.id, 'workspace')); assert.equal(frozen.length, 2);
  assert.ok(receipt.images.every(image => image.byteLength <= 128 * 1024)); assert.deepEqual(receipt.images.map(f.select), selectionAtQueue.images);
  assert.equal(JSON.stringify(JSON.parse(input.context).attachedImages).includes(f.root), false);
  assert.equal(digest(f.store.getProject(f.project.id)), canonicalBefore); assert.deepEqual(f.store.list('hold', f.project.id), holds);
  assert.equal(f.store.get('message', held.requestId).state, 'active'); assert.equal(f.provider.acceptedCount(), 0);
  const beforeDigest = directorInputDigest(input), changed = structuredClone(input); changed.images[0].sha256 = 'a'.repeat(64); assert.notEqual(directorInputDigest(changed), beforeDigest);
  const reply = await f.req({ text: 'Continue discussing your saved observation', editing: false }); assert.equal(reply.statusCode, 200); await f.director.settle();
  assert.equal(f.calls[1].images, undefined); assert.equal(JSON.parse(f.calls[1].context).attachedImages, undefined);
});

test('exact attached-message retry replays after revision advance without another queue or thumbnail receipt', async t => {
  const f = fixture(t), first = f.add(), second = f.add(); await f.director.configure(f.project.id, f.native, 'native');
  const body = f.body([first, second]), initial = await f.req(body, 'exact'); await f.director.settle(); const count = f.store.cursor(f.project.id), receipt = f.store.get('request_image_projection', initial.json().requestId);
  const project = f.store.getProject(f.project.id); f.store.saveProject({ ...project, brief: 'A later edit' }, project.headVersion);
  const replay = await f.req(body, 'exact'); await f.director.settle(); assert.deepEqual(replay.json(), initial.json()); assert.equal(f.calls.length, 1); assert.equal(f.store.cursor(f.project.id), count);
  assert.deepEqual(f.store.get('request_image_projection', initial.json().requestId), receipt);
  assert.equal((await f.req(f.body([second, first]), 'exact')).statusCode, 409); assert.equal((await f.req({ ...body, images: [{ ...body.images[0], sha256: 'f'.repeat(64) }, body.images[1]] }, 'exact')).statusCode, 409);
});

test('selection rejects foreign, stale, fixture, duplicate, path-bearing and unavailable attachments atomically', async t => {
  const f = fixture(t), image = f.add(), foreignProject = f.service.createProject('Foreign'), foreign = f.add(foreignProject.id); await f.director.configure(f.project.id, f.native, 'native');
  const fixtureImage = f.add(f.project.id, png, { fixture: true, origin: 'fake' });
  const before = f.store.list('message', f.project.id).length;
  for (const images of [[f.select(fixtureImage)], [f.select(foreign)], [{ ...f.select(image), sha256: 'a'.repeat(64) }], [f.select(image), f.select(image)], [{ ...f.select(image), path: image.path }], Array(5).fill(f.select(image))]) {
    const response = await f.req({ text: 'Discuss', images }); assert.ok(response.statusCode >= 400, response.body);
  }
  for (const other of [{ replyToReviewId: 'unknown' }, { replyToQuestionId: 'unknown' }]) assert.ok((await f.req({ ...f.body([image]), ...other })).statusCode >= 400);
  assert.equal(f.store.list('message', f.project.id).length, before); assert.equal(f.store.list('director_turn', f.project.id).length, 0); assert.equal(f.store.list('request_image_selection', f.project.id).length, 0); assert.equal(f.calls.length, 0);
  const fake = f.service.createProject('Fake'); assert.ok((await f.req(f.body([image]), 'fake', fake.id)).statusCode >= 400);
  const g = fixture(t, { unavailable: true }), owned = g.add(); await g.director.configure(g.project.id, g.native, 'native'); assert.equal(g.director.status(g.project.id).imageAttachmentsAvailable, false);
  assert.ok((await g.req(g.body([owned]))).statusCode >= 400); assert.equal(g.store.list('message', g.project.id).length, 0);
});

test('saved selection and projection are immutable, same-project and hash-bound', async t => {
  const f = fixture(t), image = f.add(), c = context(f, [image]); const result = await c.projector.prepare(c.input, c.bridge.actor, c.projection);
  const selection = f.store.get('request_image_selection', c.actor.requestId), receipt = f.store.get('request_image_projection', c.actor.requestId);
  assert.throws(() => f.store.put('request_image_projection', receipt.id, f.project.id, { ...receipt, images: receipt.images.map(image => ({ ...image, thumbnailSha256: 'f'.repeat(64) })) }), e => e.code === 'IMMUTABLE_RECORD');
  assert.throws(() => f.store.put('request_image_selection', selection.id, f.project.id, { ...selection, images: [] }), e => e.code === 'IDENTITY_MISMATCH');
  const foreign = f.service.createProject('Foreign'); assert.throws(() => f.store.insert('request_image_selection', selection.id, foreign.id, { ...selection, projectId: foreign.id }), e => e.code === 'SCOPE_DENIED');
  const repeated = await c.projector.prepare(c.input, c.bridge.actor, c.projection); assert.deepEqual(repeated.images, result.images); assert.equal(directorInputDigest(repeated), directorInputDigest(result));
});

test('changed source fails native preparation before runtime/model dispatch', async t => {
  const f = fixture(t), image = f.add(); await f.director.configure(f.project.id, f.native, 'native');
  f.engine.setPaused(f.project.id, true, 'test'); const response = await f.req(f.body([image])); assert.equal(response.statusCode, 200, response.body);
  writeFileSync(image.path, Buffer.alloc(png.length)); f.engine.setPaused(f.project.id, false, 'test'); f.director.tick(); await f.director.settle();
  assert.equal(f.calls.length, 0); assert.equal(f.store.list('native_model_start', f.project.id).length, 0); assert.equal(f.store.list('director_turn', f.project.id)[0].state, 'failed');
  assert.equal(f.store.list('request_image_projection', f.project.id).length, 0); assert.equal(f.store.readEvents(f.project.id, 0).some(event => event.kind === 'director.dispatch_intent'), false);
});

test('missing or changed completed thumbnail fails closed rather than being regenerated', async t => {
  const f = fixture(t), image = f.add(), c = context(f, [image]), prepared = await c.projector.prepare(c.input, c.bridge.actor, c.projection);
  const receipt = f.store.get('request_image_projection', c.actor.requestId), path = prepared.images[0].path; chmodSync(path, 0o600); writeFileSync(path, Buffer.alloc(receipt.images[0].byteLength));
  await assert.rejects(c.projector.prepare(c.input, c.bridge.actor, c.projection), error => error.code === 'DIRECTOR_IMAGE_CHANGED'); unlinkSync(path);
  await assert.rejects(c.projector.prepare(c.input, c.bridge.actor, c.projection), error => error.code === 'DIRECTOR_IMAGE_MISSING'); assert.equal(existsSync(path), false);
  assert.deepEqual(f.store.get('request_image_projection', c.actor.requestId), receipt);
});

test('symlink and outside-root source paths cannot enter the native projection', async t => {
  const f = fixture(t), image = f.add(), c = context(f, [image]), outside = join(f.root, 'outside.png'); writeFileSync(outside, png); unlinkSync(image.path); symlinkSync(outside, image.path);
  await assert.rejects(c.projector.prepare(c.input, c.bridge.actor, c.projection), error => error.code === 'DIRECTOR_IMAGE_SCOPE'); assert.equal(f.store.list('request_image_projection', f.project.id).length, 0);
});

test('current preparation signal cancels the real image child process before any model dispatch', async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'openslate-director-image-slow-')), marker = join(temporary, 'started'), executable = join(temporary, 'slow-tool');
  writeFileSync(executable, `#!/bin/sh\ntouch '${marker}'\nsleep 30\n`, { mode: 0o700 }); t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const f = fixture(t, { ffmpegPath: executable }), image = f.add(); await f.director.configure(f.project.id, f.native, 'native');
  const response = await f.req(f.body([image])); assert.equal(response.statusCode, 200); await until(() => existsSync(marker));
  f.service.beginRequest(f.project.id, 'local-user', 'A new edit fences the image discussion'); f.director.tick(); await f.director.settle();
  assert.equal(f.calls.length, 0); assert.equal(f.store.list('native_model_start', f.project.id).length, 0); assert.equal(f.store.list('request_image_projection', f.project.id).length, 0);
  assert.equal(f.store.readEvents(f.project.id, 0).some(event => event.kind === 'director.dispatch_intent'), false);
  const turn = f.store.list('director_turn', f.project.id)[0]; assert.equal(turn.state, 'interrupted'); assert.equal(f.store.get('epoch', turn.epochId).state, 'revoked');
  const parent = join(f.root, 'native', f.project.id, 'workspace', 'image-attachments', digest({ requestId: turn.requestId })); assert.deepEqual(readdirSync(parent), []);
});


test('a complex reference exceeding the fixed thumbnail limit fails clearly without dispatch or leftover staging', async t => {
  const f = fixture(t), image = f.add(f.project.id, noisyPng, { width: 768, height: 768 }); await f.director.configure(f.project.id, f.native, 'native');
  const response = await f.req(f.body([image])); assert.equal(response.statusCode, 200); await f.director.settle();
  assert.equal(f.calls.length, 0); const turn = f.store.list('director_turn', f.project.id)[0]; assert.equal(turn.errorCode, 'DIRECTOR_IMAGE_LIMIT');
  assert.match(f.director.status(f.project.id).message, /simpler or smaller PNG/); assert.equal(f.store.list('request_image_projection', f.project.id).length, 0);
  const parent = join(f.root, 'native', f.project.id, 'workspace', 'image-attachments', digest({ requestId: turn.requestId })); assert.deepEqual(readdirSync(parent), []);
});

test('projection receipt and exact input survive a reopened application store without derivation', async t => {
  const f = fixture(t), image = f.add(), c = context(f, [image]), original = await c.projector.prepare(c.input, c.bridge.actor, c.projection);
  const reopened = new Store(join(f.root, 'app.sqlite'));
  try {
    const service = new ProductionService(reopened, new Engine(reopened, f.provider, { artifactDir: f.engine.artifactDir }));
    const projector = new DirectorImageProjector(service, { ffmpegPath }), recovered = await projector.prepare(c.input, c.bridge.actor, c.projection);
    assert.deepEqual(recovered, original); assert.equal(directorInputDigest(recovered), directorInputDigest(original));
    assert.equal(reopened.list('request_image_selection', f.project.id).length, 1); assert.equal(reopened.list('request_image_projection', f.project.id).length, 1);
  } finally { reopened.close(); }
});

test('a mismatched persisted recipe receipt is rejected before yielding native images', async t => {
  const f = fixture(t), image = f.add(), c = context(f, [image]); await c.projector.prepare(c.input, c.bridge.actor, c.projection);
  const receipt = f.store.get('request_image_projection', c.actor.requestId);
  // Deliberate corruption bypasses the normal immutable write guard to exercise read-time fencing.
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='request_image_projection' AND id=?").run(canonical({ ...receipt, recipeDigest: 'a'.repeat(64) }), receipt.id);
  await assert.rejects(c.projector.prepare(c.input, c.bridge.actor, c.projection), error => error.code === 'DIRECTOR_IMAGE_IDENTITY');
});

test('mutating the caller options cannot replace the original cancellation signal across awaits', async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'openslate-director-image-signal-')), marker = join(temporary, 'started'), executable = join(temporary, 'slow-tool');
  writeFileSync(executable, `#!/bin/sh\ntouch '${marker}'\nsleep 30\n`, { mode: 0o700 }); t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const f = fixture(t, { ffmpegPath: executable }), image = f.add(), c = context(f, [image]), abort = new AbortController(), options = { signal: abort.signal };
  const pending = c.projector.prepare(c.input, c.bridge.actor, c.projection, options); options.signal = new AbortController().signal;
  await until(() => existsSync(marker)); abort.abort(); await assert.rejects(pending, error => error.code === 'MEDIA_CANCELLED');
  assert.equal(f.store.list('request_image_projection', f.project.id).length, 0);
});
