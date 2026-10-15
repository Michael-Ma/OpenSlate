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

// Generated frame projection uses owned outputs, never user-authored filesystem references.
import { KeyframeProjector } from '../dist/application/keyframe-projector.js';
import { projectFixture } from './execution-fixture.mjs';
import { shotIntentDigest } from '@openslate/core';
import { recordNotes } from '../dist/application/director-notes.js';
function keyframes(f, count, { fixture = false, svg = false } = {}) {
  const shape = projectFixture(f.project.id, count), initial = f.store.getProject(f.project.id);
  let project = f.store.saveProject({ ...initial, ...shape, capabilityLockId: initial.capabilityLockId, scenes: [{ id: 'scene', revisionId: newId(), purpose: 'Test frames' }], shots: shape.shots.map(s => ({ ...s, sceneId: 'scene' })), activePlanId: 'frames' }, initial.headVersion);
  for (const shot of project.shots) {
    const image = f.add(project.id, png, { fixture, ...(svg ? { mimeType: 'image/svg+xml' } : {}) });
    const artifact = f.store.get('artifact', image.artifactId).artifact;
    f.store.insert('node_binding', shot.id, project.id, { id: shot.id, projectId: project.id, planId: 'frames', state: 'active', candidateId: `candidate-${shot.id}`, node: { kind: 'image', shotId: shot.id, args: { prompt: shot.imagePrompt }, intentDigest: shotIntentDigest(shot, 'image') }, outputs: { image: artifact } });
  }
  return f.store.getProject(project.id);
}
function frameContext(f, scopeIds = ['scene'], refs = []) {
  const actor = f.service.beginRequest(f.project.id, 'local-user', 'Discuss current frames', { editing: false, scopeIds, ...(refs.length ? { contextDigest: imageMessageContext(refs.map(f.select)) } : {}) });
  const projector = new KeyframeProjector(f.service, { ffmpegPath }), bridge = f.service.openEpoch(f.project.id, actor), turnId = newId();
  f.store.insert('director_turn', turnId, f.project.id, { id: turnId, requestId: actor.requestId, epochId: bridge.actor.epochId, state: 'completed' });
  if (refs.length) projector.record(f.project.id, actor, refs.map(f.select));
  const input = { projectId: f.project.id, requestId: actor.requestId, epochId: bridge.actor.epochId, turnId, text: 'Discuss', context: '{}', skills: [], bridge: {} };
  const projection = join(f.root, 'projection'); mkdirSync(projection, { recursive: true });
  return { actor, projector, bridge, input, projection };
}
test('up to four current scoped keyframes attach individually; frozen receipt replays after later outputs', async t => {
  const f = fixture(t); keyframes(f, 4); const c = frameContext(f);
  const prepared = await c.projector.prepare(c.input, c.bridge.actor, c.projection);
  assert.equal(prepared.images.length, 4); assert.equal((await prepareDirectorImages(prepared.images, c.projection)).length, 4);
  const receipt = f.store.get('request_keyframe_projection', c.actor.requestId);
  assert.equal(receipt.images.length, 4); assert.equal(new Set(prepared.images.map(i => i.path)).size, 4);
  assert.ok(receipt.images.every(i => i.tile === 0));
  const binding = f.store.get('node_binding', 'shot-0'); f.store.put('node_binding', binding.id, f.project.id, { ...binding, outputs: {} });
  assert.deepEqual(await c.projector.prepare(c.input, c.bridge.actor, c.projection), prepared);
  assert.deepEqual(f.store.get('request_keyframe_projection', c.actor.requestId), receipt);
});
test('five frames become one bounded row-major contact sheet accepted by the runtime', async t => {
  const f = fixture(t); keyframes(f, 5); const c = frameContext(f);
  const prepared = await c.projector.prepare(c.input, c.bridge.actor, c.projection), context = JSON.parse(prepared.context).attachedKeyframes;
  assert.equal(prepared.images.length, 1); assert.equal(context.images.length, 5); assert.deepEqual(context.images.map(i => i.tile), [0,1,2,3,4]);
  assert.ok(context.attachments[0].byteLength <= 512 * 1024); assert.equal((await prepareDirectorImages(prepared.images, c.projection)).length, 1);
  assert.match(context.instructions, /frozen at turn start/);
});
test('references take precedence; remaining frames share a sheet and a full reference budget describes omissions', async t => {
  const f = fixture(t); keyframes(f, 3); const refs = [f.add(), f.add(), f.add(), f.add()];
  const c = frameContext(f, ['scene'], refs.slice(0, 2)), prepared = await c.projector.prepare(c.input, c.bridge.actor, c.projection);
  assert.equal(prepared.images.length, 3); assert.equal(JSON.parse(prepared.context).attachedKeyframes.images.length, 3);
  assert.equal((await prepareDirectorImages(prepared.images, c.projection)).length, 3);
  const full = frameContext(f, ['scene'], refs), input = await full.projector.prepare(full.input, full.bridge.actor, full.projection);
  assert.equal(input.images.length, 4); assert.equal(JSON.parse(input.context).attachedKeyframes.images.length, 0);
  assert.ok(JSON.parse(input.context).attachedKeyframes.described.every(s => s.reason === 'user_references_fill_image_budget'));
});
test('fixture SVG frames are described; scope and stale image intent exclude unshown frames', async t => {
  const f = fixture(t); keyframes(f, 2, { fixture: true, svg: true }); const c = frameContext(f, ['shot-0']);
  const prepared = await c.projector.prepare(c.input, c.bridge.actor, c.projection), frames = JSON.parse(prepared.context).attachedKeyframes;
  assert.equal(prepared.images, undefined); assert.deepEqual(frames.described, [{ shotId: 'shot-0', reason: 'fixture_not_visually_inspected' }]);
  const whole = frameContext(f, [f.project.id]); assert.equal((await whole.projector.prepare(whole.input, whole.bridge.actor, whole.projection)).images, undefined);
});
test('seenKeyframe must match this request and epoch projection exactly, never a context claim', async t => {
  const f = fixture(t); keyframes(f, 1); const c = frameContext(f);
  await c.projector.prepare(c.input, c.bridge.actor, c.projection);
  const frame = f.store.get('request_keyframe_projection', c.actor.requestId).images[0];
  const seen = { shotId: frame.shotId, artifactId: frame.artifactId, sha256: frame.sha256 };
  const note = { anchor: { shotIds: ['shot-0'] }, kind: 'observation', blocking: false, text: 'Frame has been attached.', seenKeyframe: seen, choices: [{ kind: 'accept', label: 'Keep' }] };
  const before = f.store.list('director_note', f.project.id).length;
  assert.throws(() => recordNotes(f.service, f.project.id, c.bridge.actor, newId(), { notes: [{ ...note, seenKeyframe: { ...seen, sha256: 'f'.repeat(64) } }] }), { code: 'SCOPE_DENIED' });
  assert.equal(f.store.list('director_note', f.project.id).length, before);
  assert.equal(recordNotes(f.service, f.project.id, c.bridge.actor, newId(), { notes: [note] }).notes.length, 1);
  const other = frameContext(f); assert.throws(() => recordNotes(f.service, f.project.id, other.bridge.actor, newId(), { notes: [note] }), { code: 'SCOPE_DENIED' });
});

test('stale frame intent and nonfixture SVG are omitted rather than attached', async t => {
 const f=fixture(t);keyframes(f,2);const b=f.store.get('node_binding','shot-0');f.store.put('node_binding',b.id,f.project.id,{...b,node:{...b.node,intentDigest:'old'}});
 const other=f.store.get('node_binding','shot-1'),image=f.add(f.project.id,png,{mimeType:'image/svg+xml'});f.store.put('node_binding',other.id,f.project.id,{...other,outputs:{image:f.store.get('artifact',image.artifactId).artifact}});
 const c=frameContext(f),prepared=await c.projector.prepare(c.input,c.bridge.actor,c.projection);
 assert.equal(prepared.images,undefined);assert.deepEqual(JSON.parse(prepared.context).attachedKeyframes.described.map(s=>s.reason),['no_current_keyframe','unsupported_image']);
});
test('unavailable image tool degrades with recorded omissions and never records seen-frame evidence', async t => {
 const f=fixture(t);keyframes(f,1);const c=frameContext(f),binary=join(f.root,'unavailable-ffmpeg');writeFileSync(binary,'#!/bin/sh\nexit 8\n',{mode:0o755});
 const projector=new KeyframeProjector(f.service,{ffmpegPath:binary}),prepared=await projector.prepare(c.input,c.bridge.actor,c.projection);
 assert.equal(prepared.images,undefined);assert.deepEqual(JSON.parse(prepared.context).attachedKeyframes.described,[{shotId:'shot-0',reason:'image_projection_unavailable'}]);
 assert.deepEqual(f.store.get('request_keyframe_projection',c.actor.requestId).images,[]);
});
test('keyframe cancellation publishes no receipt or note evidence', async t => {
 const f=fixture(t);keyframes(f,1);const c=frameContext(f),abort=new AbortController();abort.abort();
 await assert.rejects(c.projector.prepare(c.input,c.bridge.actor,c.projection,{signal:abort.signal}),{code:'MEDIA_CANCELLED'});
 assert.equal(f.store.get('request_keyframe_projection',c.actor.requestId),undefined);
});

test('noisy contact sheet shrinks to the budget left after three user references', async t => {
 const f=fixture(t);keyframes(f,5);
 for(const binding of f.store.list('node_binding',f.project.id)){
   const image=f.add(f.project.id,noisyPng),artifact=f.store.get('artifact',image.artifactId).artifact;
   f.store.put('node_binding',binding.id,f.project.id,{...binding,outputs:{image:artifact}});
 }
 const reference=join(f.root,'reference.png');
 await promisify(execFile)(ffmpegPath,['-nostdin','-v','error','-i',join(inputRoot,'noise.png'),'-vf','scale=256:256','-frames:v','1','-threads','1',reference],{timeout:15000});
 const referenceBytes=readFileSync(reference),references=[f.add(f.project.id,referenceBytes),f.add(f.project.id,referenceBytes),f.add(f.project.id,referenceBytes)],c=frameContext(f,['scene'],references),prepared=await c.projector.prepare(c.input,c.bridge.actor,c.projection);
 assert.equal(prepared.images.length,4);assert.equal(JSON.parse(prepared.context).attachedKeyframes.images.length,5);
 assert.equal((await prepareDirectorImages(prepared.images,c.projection)).length,4);
 assert.ok(prepared.images.reduce((n,i)=>n+readFileSync(i.path).length,0)<=512*1024);
});

test('a keyframe with disguised SVG bytes cannot select a different input demuxer',async t=>{
 const f=fixture(t);keyframes(f,1);const image=f.add(f.project.id,Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>'));
 const binding=f.store.get('node_binding','shot-0');f.store.put('node_binding',binding.id,f.project.id,{...binding,outputs:{image:f.store.get('artifact',image.artifactId).artifact}});
 const c=frameContext(f),prepared=await c.projector.prepare(c.input,c.bridge.actor,c.projection);
 assert.equal(prepared.images,undefined);assert.deepEqual(JSON.parse(prepared.context).attachedKeyframes.images,[]);
 assert.equal(JSON.parse(prepared.context).attachedKeyframes.described[0].reason,'image_projection_unavailable');
});
