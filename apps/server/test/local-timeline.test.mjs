import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, compilePlan, DEFAULT_PROFILES, digest, newId } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { captureTimeline } from '../dist/media/timeline-capture.js';
import { createLocalTimelineDocument, parseLocalTimelineDocument, LocalTimelineStore } from '../dist/media/local-timeline.js';

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg');
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe');
const execute = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = { code: 'LOCAL_TIMELINE_INVALID' }, cancelled = { code: 'MEDIA_CANCELLED' };
let root, videoPath, audioPath, media, video, audio;
const mediaOptions = name => ({ rootDir: join(root, name), allowedInputRoots: [root], ffmpegPath, ffprobePath });
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openslate-local-timeline-')); videoPath = join(root, 'input.mp4'); audioPath = join(root, 'voice.wav');
  await execute(ffmpegPath, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', videoPath], { timeout: 15000 });
  await execute(ffmpegPath, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', audioPath], { timeout: 15000 });
  media = new LocalMediaService(mediaOptions('media'));
  video = await media.importMedia({ artifactId: 'video', path: videoPath, kind: 'video' });
  audio = await media.importMedia({ artifactId: 'audio', path: audioPath, kind: 'audio' });
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });
function input() { return { projectId: 'project', clips: [{ source: video, startFrame: 3, durationFrames: 12, fit: 'contain' }, { source: video, startFrame: 17, durationFrames: 9, fit: 'cover' }],
  audio: [{ source: audio, startSample: 3200, durationSamples: 8000, atSample: 4800, gainMilliDb: -2500 }, { source: audio, startSample: 14400, durationSamples: 6400, atSample: 24000 }] }; }
async function storage(owner = media) { const rootDir = await mkdtemp(join(root, 'documents-')); return new LocalTimelineStore({ rootDir, media: owner }); }
function reidentify(value) { const { id, ...body } = value; return { ...body, id: digest(body) }; }
function receipt(document, bytes = Buffer.from(canonical(document))) { return { recipeDigest: document.recipeDigest, sha256: sha(bytes), byteLength: bytes.length }; }

test('timeline recipe preserves ordered full sources, trims and exact narration samples and canonical gain', () => {
  const value = input(), document = createLocalTimelineDocument(value);
  assert.equal(document.totalFrames, 21); assert.equal(document.audio[1].gainMilliDb, 0);
  assert.deepEqual(document.clips, value.clips); assert.deepEqual(document.audio[0], value.audio[0]);
  assert.equal(Object.isFrozen(document.audio[0].source.probe.audio), true); assert.equal(Object.isFrozen(document.localExecution), true);
  assert.deepEqual(parseLocalTimelineDocument(JSON.parse(canonical(document))), document);
  value.clips.reverse(); value.audio[0].atSample = 1600;
  assert.equal(document.clips[0].startFrame, 3); assert.equal(document.audio[0].atSample, 4800);
});

test('recipe changes for semantic inputs even when normalized media hashes remain identical', () => {
  const baseline = createLocalTimelineDocument(input());
  for (const mutate of [
    v => v.clips.reverse(), v => v.clips[0].startFrame++, v => v.clips[0].fit = 'cover',
    v => v.audio.reverse(), v => v.audio[0].startSample++, v => v.audio[0].durationSamples--,
    v => v.audio[0].atSample++, v => v.audio[0].gainMilliDb++, v => v.projectId = 'other-project',
    v => { v.clips = v.clips.map(c => ({ ...c, source: reidentify({ ...c.source, originalSha256: 'a'.repeat(64) }) })); },
    v => { v.clips = v.clips.map(c => ({ ...c, source: reidentify({ ...c.source, toolchainDigest: 'b'.repeat(64) }) })); }
  ]) {
    const changed = structuredClone(input()); mutate(changed);
    assert.notEqual(createLocalTimelineDocument(changed).recipeDigest, baseline.recipeDigest);
  }
  const explicitZero = input(); explicitZero.audio[1].gainMilliDb = 0;
  assert.equal(createLocalTimelineDocument(explicitZero).recipeDigest, baseline.recipeDigest);
});

test('strict parser rejects forged identity, host configuration, noncanonical omissions and extra fields', () => {
  const document = createLocalTimelineDocument(input());
  for (const mutate of [
    v => v.recipeDigest = '0'.repeat(64), v => v.totalFrames++, v => v.version = 2,
    v => v.transition = 'fade', v => v.frameRate.numerator = 24, v => v.sampleRate = 44100,
    v => v.localExecution.version = '2', v => v.localExecution.path = '/bin/sh',
    v => v.targetRevisionId = 'later', v => v.width = 160, v => v.attemptId = 'attempt',
    v => delete v.audio[0].gainMilliDb, v => v.clips[0].source.sha256 = 'a'.repeat(64),
    v => v.clips[0].source.path = '/private/foreign.mp4', v => v.audio[0].gainMilliDb = null,
    v => v.clips[0].source.probe.video.frameRate = '60/1'
  ]) { const value = structuredClone(document); mutate(value); assert.throws(() => parseLocalTimelineDocument(value), invalid); }
  assert.throws(() => createLocalTimelineDocument({ ...input(), targetRevisionId: 'unintended-authority' }), invalid);
});

test('data snapshots reject getters, hidden properties, prototypes and sparse arrays', () => {
  let calls = 0; const value = input(); Object.defineProperty(value, 'projectId', { enumerable: true, get() { calls++; return 'project'; } });
  assert.throws(() => createLocalTimelineDocument(value), invalid); assert.equal(calls, 0);
  for (const mutate of [v => Object.defineProperty(v, 'hidden', { value: true }), v => v[Symbol('hidden')] = true,
    v => Object.setPrototypeOf(v.clips[0], { source: video }), v => delete v.clips[0], v => v.audio[0].atSample = Infinity]) {
    const changed = input(); mutate(changed); assert.throws(() => createLocalTimelineDocument(changed), invalid);
  }
});

test('physical bounds reject overruns, malformed normalized sources and conflicting artifact identities', () => {
  for (const mutate of [
    v => v.clips[0].startFrame = 29, v => v.clips[0].durationFrames = 0,
    v => v.audio[0].startSample = 47999, v => v.audio[0].atSample = 21 * 1600,
    v => v.audio[0].gainMilliDb = -60001, v => v.clips = [],
    v => v.clips = Array(65).fill(v.clips[0]), v => v.audio = Array(65).fill(v.audio[0]),
    v => v.audio = Array(9).fill(v.audio[0]),
    v => v.clips[0].source = reidentify({ ...video, probe: { ...video.probe, audio: audio.probe.audio } }),
    v => v.audio[0].source = reidentify({ ...audio, probe: { ...audio.probe, audio: { ...audio.probe.audio, samples: null } } }),
    v => v.clips[0].source = reidentify({ ...video, originalSha256: 'd'.repeat(64) })
  ]) { const changed = structuredClone(input()); mutate(changed); assert.throws(() => createLocalTimelineDocument(changed), invalid); }
  const tooLong = input(); tooLong.clips = [{ source: reidentify({ ...video, probe: { durationSeconds: 360, video: { ...video.probe.video, frames: 10800, durationSeconds: 360 } } }), startFrame: 0, durationFrames: 10800, fit: 'contain' }];
  assert.equal(createLocalTimelineDocument(tooLong).totalFrames, 10800);
  tooLong.clips.push({ ...tooLong.clips[0], durationFrames: 1 }); assert.throws(() => createLocalTimelineDocument(tooLong), invalid);
});

test('shared SQL capture materializes independently of publication revision without creating application authority', async t => {
  const directory = await mkdtemp(join(root, 'capture-')), sql = new Store(join(directory, 'db.sqlite')), provider = new FakeProvider(join(directory, 'fake.sqlite'));
  t.after(() => { sql.close(); provider.close(); });
  const engine = new Engine(sql, provider, { artifactDir: join(directory, 'artifacts') }), service = new ProductionService(sql, engine), initial = service.createProject('Timeline document');
  const artifact = { artifactId: video.artifactId, kind: 'video', sha256: video.sha256 };
  sql.insert('artifact', artifact.artifactId, initial.id, { artifact, fixture: false, path: (await media.verifiedSource(video)).path, mimeType: 'video/mp4', attemptId: null });
  sql.insert('media_source', artifact.artifactId, initial.id, { source: video, requestId: 'synthetic-capture-setup' });
  const project = sql.saveProject({ ...initial, revisionId: newId(), artifacts: [artifact] }, initial.headVersion), planId = newId();
  const plan = compilePlan(`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{const timeline=p.timeline("timeline",{takes:[p.asset("video")]});return timeline;})`, { project, profiles: DEFAULT_PROFILES, allocateId: newId, logicalIds: {}, localExecution: { adapter: 'local-media', version: '1' } });
  engine.installPlan(project.id, planId, plan); sql.saveProject({ ...project, activePlanId: planId }, project.headVersion);
  const fromCapture = () => { const { projectId, clips, audio } = captureTimeline(sql, project.id, plan.nodes[0].id).input; return createLocalTimelineDocument({ projectId, clips, audio }); };
  const first = fromCapture(), head = sql.getProject(project.id); sql.saveProject({ ...head, revisionId: newId() }, head.headVersion);
  const before = sql.db.prepare('SELECT * FROM entities ORDER BY kind,id').all(), store = await storage(), second = fromCapture();
  assert.equal(second.recipeDigest, first.recipeDigest);
  const one = await store.put(first), two = await store.put(second); assert.deepEqual(one, two);
  assert.deepEqual(sql.db.prepare('SELECT * FROM entities ORDER BY kind,id').all(), before); assert.equal(provider.acceptedCount(), 0);
});

test('managed publication verifies actual service sources and survives reopen with exact canonical bytes', async () => {
  const store = await storage(), document = createLocalTimelineDocument(input()), stored = await store.put(document);
  const bytes = await readFile(stored.path); assert.equal(bytes.toString(), canonical(document));
  assert.equal(stored.receipt.sha256, sha(bytes)); assert.notEqual(stored.receipt.sha256, document.recipeDigest);
  assert.equal(stored.receipt.byteLength, bytes.length); assert.equal(stored.receipt.recipeDigest, document.recipeDigest);
  const reopened = new LocalTimelineStore({ rootDir: store.rootDir, media: { verifiedSource() { throw Error('recovery must not reinterpret current sources'); } } });
  assert.deepEqual(await reopened.read(stored.receipt), stored); assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []);
  const manifest = await media.freezeManifest({ projectId: document.projectId, targetRevisionId: 'render-target', width: 160, height: 90, clips: stored.document.clips, audio: stored.document.audio });
  assert.deepEqual(manifest.clips, document.clips); assert.deepEqual(manifest.audio, document.audio);
});

test('same-document concurrent writers reuse one immutable file and clean only their own staging', async () => {
  const store = await storage(), document = createLocalTimelineDocument(input()), results = await Promise.all(Array.from({ length: 4 }, () => store.put(document)));
  assert.equal(new Set(results.map(r => r.path)).size, 1); assert.deepEqual(await readdir(join(store.rootDir, 'documents')), [`${results[0].receipt.sha256}.json`]);
  assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []);
});

test('unknown service descriptors and corrupted owned source bytes cannot publish documents', async () => {
  const foreign = new LocalMediaService(mediaOptions('foreign')), store = await storage(foreign), document = createLocalTimelineDocument(input());
  await assert.rejects(store.put(document), { code: 'ENOENT' }); assert.deepEqual(await readdir(join(store.rootDir, 'documents')), []);
  const local = await foreign.importMedia({ artifactId: 'local-video', path: videoPath, kind: 'video' });
  const selected = createLocalTimelineDocument({ projectId: 'project', clips: [{ source: local, startFrame: 0, durationFrames: 3, fit: 'contain' }], audio: [] });
  const path = (await foreign.verifiedSource(local)).path; await chmod(path, 0o600); await writeFile(path, Buffer.alloc(local.byteLength));
  await assert.rejects(store.put(selected), { code: 'MEDIA_INTEGRITY_ERROR' }); assert.deepEqual(await readdir(join(store.rootDir, 'documents')), []);
});

test('changed, symlinked, oversized and noncanonical stored records fail closed without overwriting them', async () => {
  const store = await storage(), document = createLocalTimelineDocument(input()), expected = receipt(document), path = join(store.rootDir, 'documents', `${expected.sha256}.json`);
  await writeFile(path, Buffer.alloc(expected.byteLength)); await assert.rejects(store.put(document), invalid);
  assert.deepEqual(await readFile(path), Buffer.alloc(expected.byteLength)); await rm(path);
  const outside = join(root, 'outside.json'); await writeFile(outside, canonical(document)); await symlink(outside, path);
  await assert.rejects(store.read(expected)); await assert.rejects(store.put(document)); await rm(path);
  await writeFile(path, Buffer.alloc(1024 * 1024 + 1)); await assert.rejects(store.read(expected), invalid); await rm(path);
  const spaced = Buffer.from(JSON.stringify(document, null, 2)), other = receipt(document, spaced);
  await writeFile(join(store.rootDir, 'documents', `${other.sha256}.json`), spaced); await assert.rejects(store.read(other), invalid);
  const wrong = { ...expected, recipeDigest: 'b'.repeat(64) }; await writeFile(path, canonical(document)); await assert.rejects(store.read(wrong), invalid);
  assert.equal((await readFile(outside)).toString(), canonical(document));
});

test('a FIFO at the expected document path fails without waiting for a writer', { timeout: 1500 }, async () => {
  const store = await storage(), document = createLocalTimelineDocument(input()), expected = receipt(document);
  await execute('mkfifo', [join(store.rootDir, 'documents', `${expected.sha256}.json`)]);
  await assert.rejects(store.read(expected), invalid);
});

test('recovery captures receipt and cancellation context before opening the saved file', async () => {
  const store = await storage(), saved = await store.put(createLocalTimelineDocument(input())), expected = { ...saved.receipt };
  const pending = store.read(expected); expected.recipeDigest = '0'.repeat(64); expected.sha256 = 'f'.repeat(64); expected.byteLength++;
  assert.deepEqual(await pending, saved);
  const abort = new AbortController(), options = { signal: abort.signal }, cancelledRead = store.read(saved.receipt, options);
  options.signal = new AbortController().signal; abort.abort(); await assert.rejects(cancelledRead, cancelled);
});

test('source verification receives the original signal and all inputs are captured before its first await', async () => {
  let resume; const entered = Promise.withResolvers(), gate = new Promise(resolve => resume = resolve), seen = [];
  const abort = new AbortController(), options = { signal: abort.signal }, value = structuredClone(createLocalTimelineDocument(input()));
  const store = await storage({ async verifiedSource(source, context) { seen.push(context.signal); entered.resolve(); await gate; return media.verifiedSource(source); } });
  const running = store.put(value, options); await entered.promise;
  value.projectId = 'changed'; value.clips[0].startFrame = 28; options.signal = new AbortController().signal;
  abort.abort(); resume(); await assert.rejects(running, cancelled);
  assert.deepEqual(seen, [abort.signal]); assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []); assert.deepEqual(await readdir(join(store.rootDir, 'documents')), []);
});

test('caller mutation cannot change a successful saved recipe while source verification is suspended', async () => {
  let resume; const entered = Promise.withResolvers(), gate = new Promise(resolve => resume = resolve);
  const value = structuredClone(createLocalTimelineDocument(input())), expected = structuredClone(value);
  const store = await storage({ async verifiedSource(source) { entered.resolve(); await gate; return media.verifiedSource(source); } });
  const pending = store.put(value); await entered.promise; value.clips.reverse(); value.audio[0].atSample++; resume();
  assert.deepEqual((await pending).document, expected);
});

test('late cancellation preserves reusable immutable output but returns no successful descriptor', async () => {
  const store = await storage(), document = createLocalTimelineDocument(input()), abort = new AbortController(), originalRead = store.read.bind(store);
  store.read = async (...args) => { const result = await originalRead(...args); abort.abort(); return result; };
  await assert.rejects(store.put(document, { signal: abort.signal }), cancelled); assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []);
  assert.deepEqual(await readdir(join(store.rootDir, 'documents')), [`${receipt(document).sha256}.json`]);
  store.read = originalRead; assert.deepEqual((await store.put(document)).document, document);
  await assert.rejects(store.read(receipt(document), { signal: abort.signal }), cancelled);
});

test('pre-cancelled operations perform no source validation and no storage writes', async () => {
  let calls = 0; const store = await storage({ verifiedSource() { calls++; throw Error('must not verify'); } }), abort = new AbortController(); abort.abort();
  await assert.rejects(store.put(createLocalTimelineDocument(input()), { signal: abort.signal }), cancelled);
  await assert.rejects(store.read(receipt(createLocalTimelineDocument(input())), { signal: abort.signal }), cancelled);
  assert.equal(calls, 0); assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []); assert.deepEqual(await readdir(join(store.rootDir, 'documents')), []);
});
