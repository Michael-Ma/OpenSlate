import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePlan, digest, DEFAULT_PROFILES } from '../../../packages/core/dist/index.js';
import { FakeProvider, fixtureOutputs } from '../../../packages/providers/dist/index.js';
import { Engine, ExecutionIngestionRouter, ExecutionOutputStore, SpoolImageIngestor, SpoolVideoIngestor } from '../dist/execution/index.js';
import { LocalImageStore } from '../dist/media/local-images.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { MediaApplicationService } from '../dist/media/application.js';
import { ProductionService } from '../dist/application/service.js';
import { Store } from '../dist/persistence/store.js';
import { projectFixture, sourceFor, setup } from './execution-fixture.mjs';

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg');
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let temporary, png, mp4;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'openslate-ingestion-router-'));
  await promisify(execFile)(ffmpegPath, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1024x1024', '-frames:v', '1', '-threads', '1', join(temporary, 'frame.png')], { timeout: 30000 });
  await promisify(execFile)(ffmpegPath, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=24', '-t', '6', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', join(temporary, 'take.mp4')], { timeout: 30000 });
  png = readFileSync(join(temporary, 'frame.png')); mp4 = readFileSync(join(temporary, 'take.mp4'));
});
after(async () => rm(temporary, { recursive: true, force: true }));

test('one configured Engine preserves exact PNG, derives MP4 and renders the frozen generated take locally', async t => {
  const directory = await mkdtemp(join(temporary, 'workflow-')), artifactDir = join(directory, 'artifacts');
  const store = new Store(join(directory, 'store.sqlite')), provider = new FakeProvider(join(directory, 'fake.sqlite'));
  t.after(() => { store.close(); provider.close(); });
  const outputs = new ExecutionOutputStore(store, { rootDir: join(directory, 'outputs') });
  const images = new LocalImageStore({ rootDir: join(artifactDir, 'images'), ffmpegPath, ffprobePath });
  const media = new LocalMediaService({ rootDir: join(directory, 'media'), allowedInputRoots: [outputs.rootDir], ffmpegPath, ffprobePath });
  const router = new ExecutionIngestionRouter({ image: new SpoolImageIngestor(outputs, images),
    video: new SpoolVideoIngestor(outputs, media, { rootDir: join(directory, 'derivations') }) });
  const engine = new Engine(store, provider, { artifactDir, outputStore: outputs, outputIngestor: router });
  const service = new ProductionService(store, engine), project = projectFixture(randomUUID(), 1); store.createProject(project);
  const source = sourceFor(project).replace('return [video0];', 'const cut=p.timeline("cut",{takes:[video0]});return p.render("export",{timeline:cut,width:160,height:90});');
  const plan = compilePlan(source, { project, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: randomUUID }), planId = randomUUID(), grants = {};
  for (const node of plan.nodes.filter(node => ['image', 'video'].includes(node.kind))) grants[node.id] = engine.createGrant(project.id, node.shotId, node.kind, 'offline-human', 'initial_slot').id;
  engine.installPlan(project.id, planId, plan, grants); store.saveProject({ ...project, activePlanId: planId }, 0);
  const calls = [];
  provider.submit = async request => {
    calls.push(request.kind); const image = request.kind === 'image', bytes = image ? png : mp4;
    const receipt = outputs.recordReceipt(project.id, { attemptId: request.attemptId, expectedRequestDigest: digest(request),
      port: request.kind, kind: request.kind, mimeType: image ? 'image/png' : 'video/mp4', vendorTaskId: image ? null : 'offline-video', diagnosticRequestId: null,
      source: { kind: 'returned_bytes', sha256: hash(bytes), byteLength: bytes.length } });
    await outputs.spool(project.id, receipt.id, async function* () { yield bytes; }); return outputs.recoverCompletion(project.id, request.attemptId);
  };
  await engine.runReady(); assert.deepEqual(calls, ['image']);
  const frame = store.list('artifact', project.id)[0]; assert.equal(frame.fixture, false); assert.deepEqual(readFileSync(frame.path), png);
  assert.equal((await engine.runReady()).dispatched, 0, 'routing cannot bypass exact keyframe review');
  const review = engine.reviewSnapshot(project.id); assert.equal(review.members[0].keyframe.sha256, hash(png));
  engine.approve(project.id, review.id, [review.members[0].videoNodeId], 'offline-human-review');
  await engine.runReady(); await engine.runReady(); await engine.runReady();
  assert.deepEqual(calls, ['image', 'video']); assert.equal(engine.attempts(project.id).length, 4);
  const artifacts = store.list('artifact', project.id), take = artifacts.find(record => record.origin === 'generated_video');
  assert.equal(take.physicalDurationSeconds, 6); assert.notEqual(take.artifact.sha256, hash(mp4));
  assert.equal(artifacts.filter(record => record.fixture).length, 2, 'legacy assembly stays visibly fixture-only');
  const application = new MediaApplicationService(service, media), actor = service.beginRequest(project.id, 'local-user', 'Render the accepted generated take', { editing: false });
  const job = await application.prepareRender(project.id, actor, { expectedHeadVersion: 1, renderNodeId: plan.nodes.find(node => node.kind === 'render').id, key: 'render-generated-take' });
  assert.equal(job.manifest.clips[0].source.sha256, take.artifact.sha256);
  const finished = await application.run(project.id, actor, job.id); assert.equal(finished.state, 'published');
  const preview = application.snapshot(project.id, actor).preview; assert.equal(preview.fixture, false);
  assert.equal(store.get('artifact', preview.artifact.artifactId).physicalDurationSeconds, 6);
  const originalOutputs = engine.outputs(project.id); await engine.reconcile(); await engine.runReady();
  assert.deepEqual(engine.outputs(project.id), originalOutputs); assert.deepEqual(calls, ['image', 'video']);
});

test('missing real handler cannot fall back to fixture publication or call another kind', async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); let videoCalls = 0;
  const outputs = new ExecutionOutputStore(f.store, { rootDir: join(f.directory, 'outputs') });
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: outputs,
    outputIngestor: new ExecutionIngestionRouter({ video: { ingest() { videoCalls++; throw Error('wrong handler'); } } }) });
  f.provider.submit = async request => {
    const receipt = outputs.recordReceipt(f.projectId, { attemptId: request.attemptId, expectedRequestDigest: digest(request), port: 'image', kind: 'image', mimeType: 'image/png', vendorTaskId: null, diagnosticRequestId: null,
      source: { kind: 'returned_bytes', sha256: hash(png), byteLength: png.length } });
    await outputs.spool(f.projectId, receipt.id, async function* () { yield png; }); return outputs.recoverCompletion(f.projectId, request.attemptId);
  };
  await assert.rejects(engine.runReady(), { code: 'OUTPUT_INGESTION_UNSUPPORTED' });
  assert.equal(videoCalls, 0); assert.equal(f.store.list('artifact', f.projectId).length, 0);
  const attempt = engine.attempts(f.projectId)[0]; assert.equal(attempt.phase, 'ingesting'); assert.equal(f.store.get('reservation', attempt.reservationId).state, 'reserved');
  assert.equal(f.store.list('execution_output_slot', f.projectId).length, 1);
});

test('router captures inputs and forwards the original signal; unsupported inline media and cancellation stay closed', async () => {
  let received; const handlers = { image: { async ingest(input) { received = input; await Promise.resolve(); return { sentinel: input.output.sha256 }; } } };
  const router = new ExecutionIngestionRouter(handlers), signal = new AbortController();
  const input = { attempt: { id: 'attempt' }, artifactDir: temporary, signal: signal.signal,
    output: { kind: 'image', port: 'image', fixture: false, sha256: 'a'.repeat(64), storage: { type: 'spool', spoolId: 'b'.repeat(64) } } };
  const pending = router.ingest(input); input.output.sha256 = 'c'.repeat(64); handlers.image = { ingest() { throw Error('mutated route'); } };
  assert.equal((await pending).sentinel, 'a'.repeat(64)); assert.equal(received.signal, signal.signal);
  const raw = fixtureOutputs({ kind: 'image', args: {}, inputs: [], fingerprint: 'x', nodeId: 'x', attemptId: 'x' })[0];
  assert.throws(() => router.ingest({ ...input, output: { ...raw, fixture: false } }), { code: 'OUTPUT_INGESTION_UNSUPPORTED' });
  signal.abort(); assert.throws(() => router.ingest(input), { code: 'OUTPUT_STORE_CANCELLED' });
  assert.throws(() => new ExecutionIngestionRouter({ data: handlers.image }), { code: 'OUTPUT_INGESTION_CONFIGURATION' });
});

test('audio requires its explicit handler while raw transcription data has no fallback route', async () => {
  let audioCalls = 0;
  const router = new ExecutionIngestionRouter({ audio: { ingest(input) { audioCalls++; return { audio: input.output.sha256 }; } } });
  const input = { attempt: { id: 'attempt' }, artifactDir: temporary, signal: new AbortController().signal,
    output: { kind: 'audio', port: 'audio', mimeType: 'audio/wav', extension: 'wav', byteLength: 44,
      fixture: false, sha256: 'a'.repeat(64), storage: { type: 'spool', spoolId: 'b'.repeat(64) } } };
  assert.deepEqual(router.ingest(input), { audio: 'a'.repeat(64) }); assert.equal(audioCalls, 1);
  assert.throws(() => new ExecutionIngestionRouter({}).ingest(input), { code: 'OUTPUT_INGESTION_UNSUPPORTED' });
  assert.throws(() => router.ingest({ ...input, output: { ...input.output, port: 'cues', kind: 'data', mimeType: 'application/json', extension: 'json' } }),
    { code: 'OUTPUT_INGESTION_UNSUPPORTED' });
  assert.equal(audioCalls, 1);
});
