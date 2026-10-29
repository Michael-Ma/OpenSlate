import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compilePlan, DEFAULT_PROFILES, DomainError, newId, shotIntentDigest } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { createApp } from '../dist/app.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalMediaService, MediaApplicationService, registerMediaRoutes } from '../dist/media/index.js';
import { ManagedUploadStore } from '../dist/narration/managed-upload.js';
import { captureStoryboard } from '../dist/media/storyboard-capture.js';
import { runDemo } from '../dist/demo.js';
import { editStoryboard } from '../dist/storyboard.js';
import { ExportLauncher } from '../dist/media/export-launcher.js';
import { requireTestToolchain } from '../../../scripts/test-toolchain.mjs';

const execute = promisify(execFile), { tools: { ffmpeg, ffprobe } } = requireTestToolchain();
const code = expected => error => error?.code === expected;
let inputs, paths, voice;
before(async () => {
  inputs = await mkdtemp(join(tmpdir(), 'openslate-export-inputs-'));
  paths = await Promise.all(['red', 'blue', 'green'].map(async color => {
    const path = join(inputs, `${color}.mp4`);
    await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=30:d=1`, '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', path]); return path;
  }));
  voice = join(inputs, 'voice.wav');
  await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=700:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', voice]);
});
after(async () => { await rm(inputs, { recursive: true, force: true }); });

async function fixture(t, { demo = false, narration = true, mixed = false, short = false, absoluteNarration = false, absoluteSharedCue = false, mixedVoice = false, mixedMusic = false, soundtrack = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'openslate-export-')), store = new Store(join(dir, 'db.sqlite'));
  const provider = new FakeProvider(join(dir, 'fake.sqlite')), engine = new Engine(store, provider, { artifactDir: join(dir, 'artifacts') });
  const production = new ProductionService(store, engine), project = production.createProject('Storyboard film');
  const media = new LocalMediaService({ rootDir: join(dir, 'media'), allowedInputRoots: [inputs], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const service = new MediaApplicationService(production, media), app = createApp({ service: production, localToken: 'local-export-test-token' });
  registerMediaRoutes(app, { production, media: service, uploads: new ManagedUploadStore({ rootDir: join(dir, 'uploads') }) });
  t.after(async () => { await app.close(); store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  const refs = [], sources = [];
  for (const path of paths) {
    const id = newId(), source = await media.importMedia({ artifactId: id, path, kind: 'video' }), ref = { artifactId: id, kind: 'video', sha256: source.sha256 };
    refs.push(ref); sources.push(source);
    store.insert('artifact', id, project.id, { artifact: ref, fixture: demo && !(mixed && refs.length === 1), path: (await media.verifiedSource(source)).path, mimeType: 'video/mp4', physicalDurationSeconds: 1 });
    store.insert('media_source', id, project.id, { source: short && refs.length === 1 ? { ...source, probe: { ...source.probe, video: { ...source.probe.video, frames: 15 } } } : source, requestId: 'test-source' });

  }
  const audio = await media.importMedia({ artifactId: newId(), path: voice, kind: 'audio' });
  const audioRef = { artifactId: audio.artifactId, sha256: audio.sha256, kind: 'audio' };
  store.insert('artifact', audio.artifactId, project.id, { artifact: audioRef, fixture: demo && !mixedVoice, path: (await media.verifiedSource(audio)).path, mimeType: 'audio/wav' });
  store.insert('narration_audio', audio.artifactId, project.id, { id: audio.artifactId, projectId: project.id, media: audio });
  let music = audio;
  if (mixedMusic) {
    music = await media.importMedia({ artifactId: newId(), path: voice, kind: 'audio' });
    store.insert('artifact', music.artifactId, project.id, { artifact: { artifactId: music.artifactId, sha256: music.sha256, kind: 'audio' }, fixture: false, path: (await media.verifiedSource(music)).path, mimeType: 'audio/wav' });
    store.insert('narration_audio', music.artifactId, project.id, { id: music.artifactId, projectId: project.id, media: music });
  }
  const scene = { id: newId(), revisionId: newId(), purpose: 'Scene' };
  const cue = { id: newId(), meaning: 'Voice', durationFrames: 15, placementFrames: 30, audio: audioRef, accepted: true, measured: true };
  const shots = refs.map((_, index) => {
    const shot = { id: newId(), revisionId: newId(), sceneId: scene.id, purpose: `Shot ${index}`, action: 'Stand', framing: 'Wide', motion: 'Push', desiredFrames: demo ? 90 : 30,
      imagePrompt: 'Boot', videoPrompt: 'Push', referenceArtifactIds: [], cueId: narration && (index === 1 || absoluteSharedCue && index === 2) ? cue.id : null,
      narration: { mode: narration && (index === 1 || absoluteSharedCue && index === 2) ? 'uploaded' : 'none', text: narration && (index === 1 || absoluteSharedCue && index === 2) ? 'Voice' : '', voice: 'stock' },
      ...(narration && (index === 1 || absoluteSharedCue && index === 2) ? { narrationTimingMode: 'within_shot' } : {}), promptIntent: {} };
    shot.promptIntent = { image: shotIntentDigest(shot, 'image', shot.cueId ? cue : undefined), video: shotIntentDigest(shot, 'video', shot.cueId ? cue : undefined) }; return shot;
  });
  const frame = { artifactId: newId(), sha256: 'a'.repeat(64), kind: 'image' };
  const saved = store.saveProject({ ...project, revisionId: newId(), scenes: [scene], shots, cues: narration ? [cue] : [], artifacts: [...refs, audioRef, frame],
    narration: { script: narration ? 'Voice' : '', source: narration ? 'uploaded' : 'undecided' }, ...(soundtrack ? { soundtrack: { audioId: music.artifactId, gainMilliDb: -18000, startFrame: 0, muted: false } } : {}) }, project.headVersion);
  if (narration) {
    const id = newId(); store.insert('narration_canonical', id, project.id, { id, script: 'Voice', segments: [{ cue, ...(absoluteSharedCue || absoluteNarration ? {} : { placementMode: 'shot', timingMode: 'within_shot' }), audioPlacement: { source: audio, startSample: 0, durationSamples: 24000, atSample: 48000, gainMilliDb: 0 } }] });
    store.put('narration_canonical_head', project.id, project.id, { canonicalId: id });
  }
  const declarations = shots.map((shot, i) => `const s${i}=p.shot(${JSON.stringify(shot.id)});const r${i}=p.humanReview("r${i}",{shots:[{intent:s${i},keyframe:p.asset(${JSON.stringify(frame.artifactId)}),videoProfile:"fake-video-v1",motionPrompt:"Push",seconds:6}]});const v${i}=p.video("v${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(p.asset(${JSON.stringify(frame.artifactId)}),r${i}),prompt:"Push",seconds:6});`).join('');
  const plan = compilePlan(`definePlan({baseRevision:${JSON.stringify(saved.revisionId)}},p=>{${declarations}return v2;});`, { project: saved, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: newId });
  const planId = newId(), grants = {};
  for (const node of plan.nodes.filter(n => n.kind === 'video')) grants[node.id] = engine.createGrant(project.id, node.shotId, 'video', 'test-export-fixture').id;
  engine.installPlan(project.id, planId, plan, grants);
  store.saveProject({ ...saved, revisionId: newId(), activePlanId: planId }, saved.headVersion);
  for (const [i, node] of plan.nodes.filter(n => n.kind === 'video').entries()) {
    const binding = store.get('node_binding', node.id); store.put('node_binding', node.id, project.id, { ...binding, outputs: { video: refs[i] } });
  }
  const head = () => store.getProject(project.id);
  const actor = production.beginRequest(project.id, 'local-user', 'Export this film', { editing: false, source: 'app' });
  const prepare = (key = newId()) => service.prepareExport(project.id, actor, { expectedHeadVersion: head().headVersion, key });
  const request = (method, suffix = '', payload, key = newId(), headers = {}) => app.inject({ method, url: `/api/projects/${project.id}${suffix}`, ...(payload === undefined ? {} : { payload }), headers: { host: '127.0.0.1', authorization: 'Bearer local-export-test-token', 'idempotency-key': key, ...headers } });
  const mutate = fn => { const current = head(); const next = structuredClone(current); fn(next); return store.saveProject({ ...next, revisionId: newId() }, current.headVersion); };
  return { dir, store, provider, production, engine, media, service, app, project, refs, sources, audio, actor, prepare, head, request, mutate, shots, plan };
}
async function waitExport(f, exportId) {
  for (let i = 0; i < 500; i++) {
    const view = (await f.request('GET', '/exports')).json();
    const record = [view.current, ...view.history].find(row => row?.exportId === exportId);
    if (record?.state !== 'rendering') return record;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Export did not settle');
}
async function pixels(path, scale = '1:1') {
  return (await execute(ffmpeg, ['-nostdin', '-v', 'error', '-i', path, '-vf', `scale=${scale}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 })).stdout;
}

test('three-shot plan without timeline exports in storyboard order with voice and soundtrack; reorder follows the film', async t => {
  const f = await fixture(t), job = await f.prepare('first');
  assert.equal(f.plan.nodes.some(n => ['timeline', 'render'].includes(n.kind)), false);
  assert.equal(job.target.kind, 'storyboard'); assert.equal(Object.hasOwn(job.target, 'renderNodeId'), false);
  assert.deepEqual(job.manifest.clips.map(c => c.source.artifactId), f.refs.map(r => r.artifactId));
  assert.deepEqual(job.manifest.audio.map(a => [a.atSample, a.durationSamples, a.gainMilliDb]), [[48000, 24000, 0], [0, 48000, -18000]]);
  const result = await f.service.run(f.project.id, f.actor, job.id);
  const row = f.store.get('artifact', result.artifact.artifactId); assert.equal(row.physicalDurationSeconds, 3);
  const p = await pixels(row.path); assert.equal(p.length, 90 * 3); assert.ok(p[0] > p[2] + 100); assert.ok(p[30 * 3 + 2] > p[30 * 3] + 100);
  assert.equal((await f.media.probe(row.path).catch(() => null)), null, 'owned outputs do not widen user file roots');
  const sound = await execute(ffmpeg, ['-nostdin', '-v', 'error', '-i', row.path, '-map', '0:a:0', '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 });
  assert.ok(sound.stdout.some(byte => byte !== 0));
  editStoryboard(f.production, f.project.id, { kind: 'moveShot', id: f.shots[1].id, beforeId: f.shots[0].id, sceneId: f.shots[0].sceneId, expectedHeadVersion: f.head().headVersion }, 'reorder');
  assert.deepEqual(f.service.exportRecord(f.project.id, job.id).outdatedBy, ['order']);
  assert.equal(f.store.list('hold', f.project.id).some(h => h.active), false);
  const next = await f.prepare('second'); assert.deepEqual(next.manifest.clips.map(c => c.source.artifactId), [f.refs[1], f.refs[0], f.refs[2]].map(r => r.artifactId));
  assert.equal(next.manifest.audio[0].atSample, 0);
  const again = await f.service.run(f.project.id, f.actor, next.id), p2 = await pixels(f.store.get('artifact', again.artifact.artifactId).path);
  assert.ok(p2[2] > p2[0] + 100); assert.equal(f.provider.acceptedCount(), 0);
});

test('readiness refuses missing/stale/foreign/short clips, unsettled voice, empty and oversized films with shot reasons', async t => {
  const f = await fixture(t);
  const node = f.plan.nodes.find(n => n.kind === 'video'), original = f.store.get('node_binding', node.id);
  f.store.put('node_binding', node.id, f.project.id, { ...original, outputs: {} });
  assert.ok(captureStoryboard(f.store, f.project.id).readiness.blockers.some(b => b.code === 'no_clip' && b.shotId === f.shots[0].id));
  f.store.put('node_binding', node.id, f.project.id, original);
  const foreign = f.production.createProject('Foreign artifact owner'), ref = { ...f.refs[0], artifactId: newId() };
  f.store.insert('artifact', ref.artifactId, foreign.id, { artifact: ref, fixture: false });
  f.store.put('node_binding', node.id, f.project.id, { ...original, outputs: { video: ref } });
  assert.ok(captureStoryboard(f.store, f.project.id).readiness.blockers.some(b => b.code === 'clip_outdated' && b.shotId === f.shots[0].id));
  f.store.put('node_binding', node.id, f.project.id, original);
  const short = await fixture(t, { short: true });
  assert.ok(captureStoryboard(short.store, short.project.id).readiness.blockers.some(b => b.code === 'clip_outdated' && b.shotId === short.shots[0].id));
  f.mutate(p => { p.shots[0].videoPrompt = 'Changed'; p.shots[1].narrationPending = true; });
  let readiness = captureStoryboard(f.store, f.project.id).readiness;
  assert.ok(readiness.blockers.some(b => b.code === 'clip_outdated' && b.shotId === f.shots[0].id));
  assert.ok(readiness.blockers.some(b => b.code === 'voice_unsettled' && b.shotId === f.shots[1].id));
  const response = await f.request('POST', '/exports', { expectedHeadVersion: f.head().headVersion });
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'EXPORT_BLOCKED'); assert.deepEqual(response.json().error.details, readiness);
  f.mutate(p => { p.shots.forEach(s => { s.desiredFrames = 10800; }); });
  assert.ok(captureStoryboard(f.store, f.project.id).readiness.blockers.some(b => b.code === 'too_long'));
  f.mutate(p => { p.shots = []; p.scenes = []; });
  assert.deepEqual(captureStoryboard(f.store, f.project.id).readiness.blockers, [{ code: 'empty_film' }]);
});

test('all-fixture exports stretch each clip to its planned length and burn Demo into pixels', async t => {
  const f = await fixture(t, { demo: true, narration: false });
  const [job, replay] = await Promise.all([f.prepare('demo-once'), f.prepare('demo-once')]); assert.equal(replay.id, job.id); assert.equal(f.store.list('media_render', f.project.id).length, 1); assert.equal(job.manifest.demo, true); assert.equal(job.manifest.totalFrames, 270);
  assert.ok(job.manifest.clips.every(c => c.source.probe.video.frames === 90));
  const done = await f.service.run(f.project.id, f.actor, job.id), row = f.store.get('artifact', done.artifact.artifactId);
  assert.equal(row.fixture, true); assert.equal(row.physicalDurationSeconds, 9);
  const picture = (await execute(ffmpeg, ['-nostdin', '-v', 'error', '-i', row.path, '-vf', 'crop=208:80:0:0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' })).stdout;
  const offset = (16 * 208 + 16) * 3; assert.ok(picture[offset] > 200 && picture[offset + 1] > 200 && picture[offset + 2] > 200, 'white D glyph is burned in');
  const inside = (32 * 208 + 24) * 3; assert.ok(picture[inside] < 100 && picture[inside + 1] < 100 && picture[inside + 2] < 100, 'black background separates the D glyph');
  const library = (await f.request('GET', '/assets?source=export')).json(); assert.match(library.assets[0].label, /Demo export/);
});

test('mixed clips identify the clip medium on each shot', async t => {
  const mixed = await fixture(t, { demo: true, narration: false, mixed: true });
  const readiness = captureStoryboard(mixed.store, mixed.project.id).readiness;
  assert.deepEqual(readiness.blockers.filter(b => b.code === 'mixed_demo_media'), mixed.shots.map(s => ({ code: 'mixed_demo_media', medium: 'clip', shotId: s.id })));
  await assert.rejects(mixed.prepare(), code('EXPORT_BLOCKED'));
});

test('an imported soundtrack on demo clips reports one music blocker without a shot', async t => {
  const f = await fixture(t, { demo: true, mixedMusic: true });
  const readiness = captureStoryboard(f.store, f.project.id).readiness;
  assert.deepEqual(readiness.blockers, [{ code: 'mixed_demo_media', medium: 'music' }]);
  assert.equal(readiness.ready, false); assert.equal(readiness.demo, false);
  await assert.rejects(f.prepare(), code('EXPORT_BLOCKED'));
});

test('an own recording on demo clips reports a voice blocker only on its mapped shot', async t => {
  const f = await fixture(t, { demo: true, mixedVoice: true, soundtrack: false });
  assert.deepEqual(captureStoryboard(f.store, f.project.id).readiness.blockers, [{ code: 'mixed_demo_media', medium: 'voice', shotId: f.shots[1].id }]);
  await assert.rejects(f.prepare(), code('EXPORT_BLOCKED'));
});

test('a real recording used as both voice and music identifies each differing use once', async t => {
  const f = await fixture(t, { demo: true, mixedVoice: true });
  assert.deepEqual(captureStoryboard(f.store, f.project.id).readiness.blockers, [
    { code: 'mixed_demo_media', medium: 'voice', shotId: f.shots[1].id }, { code: 'mixed_demo_media', medium: 'music' },
  ]);
});

test('HTTP start is authenticated, revision checked and idempotent; music keeps a downloadable outdated export and no holds', async t => {
  const f = await fixture(t), version = f.head().headVersion;
  assert.equal((await f.request('POST', '/exports', { expectedHeadVersion: version }, newId(), { authorization: '' })).statusCode, 403);
  assert.equal((await f.request('POST', '/exports', { expectedHeadVersion: version }, '')).statusCode, 400);
  assert.equal((await f.request('POST', '/exports', { expectedHeadVersion: version - 1 })).json().error.code, 'REVISION_CONFLICT');
  const first = await f.request('POST', '/exports', { expectedHeadVersion: version }, 'start-once'); assert.equal(first.statusCode, 202, first.body);
  const id = first.json().exportId;
  const immediateReplay = await f.request('POST', '/exports', { expectedHeadVersion: version }, 'start-once'); assert.equal(immediateReplay.json().exportId, id);
  assert.equal((await f.request('POST', '/exports', { expectedHeadVersion: version + 1 }, 'start-once')).json().error.code, 'IDEMPOTENCY_CONFLICT');
  const done = await waitExport(f, id); assert.equal(done.state, 'done');
  const replay = await f.request('POST', '/exports', { expectedHeadVersion: version }, 'start-once'); assert.equal(replay.json().exportId, id);
  assert.equal(f.store.list('media_render', f.project.id).length, 1);
  editStoryboard(f.production, f.project.id, { kind: 'soundtrack', field: 'gainMilliDb', value: '-9000', expectedHeadVersion: version }, 'music-volume');
  let view = (await f.request('GET', '/exports')).json(); assert.deepEqual(view.current.outdatedBy, ['music']); assert.equal(view.current.artifact.artifactId, done.artifact.artifactId);
  const oldMedia = (await f.request('GET', '/media')).json(); assert.equal(oldMedia.lastExport.outdated, true); assert.deepEqual(oldMedia.lastExport.outdatedBy, ['music']);
  assert.equal(f.store.list('hold', f.project.id).some(h => h.active), false);
  assert.equal((await f.request('GET', `/artifacts/${done.artifact.artifactId}/content`)).statusCode, 200);
  assert.equal((await f.request('POST', '/exports', { expectedHeadVersion: version }, 'start-once')).json().exportId, id, 'lost reply replay survives later edits');
  const fresh = await f.prepare(); await f.service.run(f.project.id, f.actor, fresh.id);
  view = f.service.exportView(f.project.id); assert.equal(view.current.exportId, fresh.id); assert.deepEqual(view.history[0].outdatedBy, ['music']);
  assert.equal(f.provider.acceptedCount(), 0);
});

test('cancel aborts a running export; recover only checks receipts, replay never re-renders failed or cancelled work', { timeout: 15000 }, async t => {
  const f = await fixture(t), original = f.media.render.bind(f.media); let calls = 0, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.media.render = async (manifest, options) => { calls++; entered(); await new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'MEDIA_CANCELLED' })), { once: true }); }); };
  const response = await f.request('POST', '/exports', { expectedHeadVersion: f.head().headVersion }, 'cancel-once'); await started;
  const id = response.json().exportId;
  assert.equal((await f.request('POST', `/exports/${id}/recover`, {})).json().error.code, 'MEDIA_RENDER_BUSY');
  assert.equal((await f.request('POST', `/exports/${id}/cancel`, {})).json().state, 'cancelled');
  await waitExport(f, id);
  // Wait for the route task to release its lease after cancellation.
  for (let i = 0; i < 100 && f.store.get('media_render', id).ownerToken; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const recovered = await f.request('POST', `/exports/${id}/recover`, {}); assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().state, 'cancelled');
  assert.equal((await f.request('POST', '/exports', { expectedHeadVersion: f.head().headVersion }, 'cancel-once')).json().exportId, id); assert.equal(calls, 1);
  f.media.render = original;
  const job = await f.prepare('lost-receipt');
  const completion = await original(job.manifest);
  f.store.put('media_render', job.id, f.project.id, { ...job, state: 'running', ownerToken: 'dead-worker', leaseUntil: Date.now() - 1 });
  f.media.render = async () => { throw new Error('Recover must never render'); };
  const recoveredDone = await f.request('POST', `/exports/${job.id}/recover`, {}); assert.equal(recoveredDone.statusCode, 200, recoveredDone.body); assert.equal(recoveredDone.json().state, 'done');
  assert.equal(recoveredDone.json().artifact.sha256, completion.artifact.sha256);
  assert.equal((await f.request('POST', `/exports/${job.id}/recover`, {})).json().state, 'done');
});

test('stale-version, holds, foreign export IDs and edits during freeze/publication remain fenced', async t => {
  const f = await fixture(t);
  const hold = f.engine.setHold(f.project.id, { scopeId: f.shots[0].id, ownerId: 'other' }); await assert.rejects(f.prepare(), code('MEDIA_HELD')); f.engine.releaseHold(f.project.id, hold.id, 'other');
  assert.equal((await f.request('POST', '/exports/not-owned/cancel', {})).statusCode, 404);
  const original = f.media.freezeManifest.bind(f.media);
  f.media.freezeManifest = async input => { const frozen = await original(input); f.mutate(p => { p.soundtrack.gainMilliDb = -6000; }); return frozen; };
  await assert.rejects(f.prepare(), code('REVISION_CONFLICT')); assert.equal(f.store.list('media_render', f.project.id).length, 0);
  f.media.freezeManifest = original;
  const job = await f.prepare(); const render = f.media.render.bind(f.media);
  f.media.render = async (...args) => { const result = await render(...args); f.mutate(p => { p.soundtrack.muted = true; }); return result; };
  const done = await f.service.run(f.project.id, f.actor, job.id); assert.equal(done.state, 'historical');
  assert.deepEqual(f.service.exportRecord(f.project.id, job.id).outdatedBy, ['music']);
  assert.equal(f.store.get('media_preview', f.project.id), undefined);
});


test('the shipped fake demo exports twelve planned seconds with accepted fixture narration after reopening', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'openslate-shipped-demo-export-'));
  const summary = await runDemo(dir), store = new Store(join(dir, 'openslate.sqlite')), provider = new FakeProvider(join(dir, 'fake-provider.sqlite'));
  t.after(async () => { store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  const production = new ProductionService(store, new Engine(store, provider, { artifactDir: join(dir, 'artifacts') }));
  const media = new LocalMediaService({ rootDir: join(dir, 'media'), allowedInputRoots: [inputs], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const service = new MediaApplicationService(production, media), before = provider.acceptedCount();
  const actor = production.beginRequest(summary.projectId, 'local-user', 'Export demo', { editing: false, source: 'app' });
  const readiness = service.exportView(summary.projectId).readiness; assert.equal(readiness.ready, true, JSON.stringify(readiness));
  const job = await service.prepareExport(summary.projectId, actor, { expectedHeadVersion: store.getProject(summary.projectId).headVersion, key: 'shipped-demo' });
  assert.equal(job.manifest.totalFrames, 360); assert.equal(job.manifest.audio.length, 2); assert.deepEqual(job.manifest.audio.map(a => a.atSample), [0, 288000]);
  const done = await service.run(summary.projectId, actor, job.id); assert.equal(done.state, 'published');
  assert.equal(store.get('artifact', done.artifact.artifactId).physicalDurationSeconds, 12); assert.equal(store.get('artifact', done.artifact.artifactId).fixture, true);
  assert.equal(provider.acceptedCount(), before);
});


test('changed-since fingerprints distinguish shot media, narration and order without treating unrelated text as a film change', async t => {
  const f = await fixture(t), job = await f.prepare();
  f.mutate(p => { p.brief = 'An unrelated brief correction'; });
  assert.deepEqual(f.service.exportRecord(f.project.id, job.id).outdatedBy, []);
  const node = f.plan.nodes.find(n => n.kind === 'video'), original = f.store.get('node_binding', node.id);
  f.store.put('node_binding', node.id, f.project.id, { ...original, outputs: {} });
  assert.deepEqual(f.service.exportRecord(f.project.id, job.id).outdatedBy, ['shots']);
  f.store.put('node_binding', node.id, f.project.id, original);
  f.mutate(p => { p.shots[1].narration.text = 'A new voice line'; });
  assert.deepEqual(f.service.exportRecord(f.project.id, job.id).outdatedBy, ['narration']);
});


test('legacy absolute narration is current only on the shared cue cut at its accepted sample', async t => {
  const f = await fixture(t, { absoluteSharedCue: true }), capture = captureStoryboard(f.store, f.project.id);
  assert.deepEqual(capture.readiness.blockers, [{ code: 'voice_unsettled', shotId: f.shots[2].id }]);
  assert.equal(capture.input.audio.length, 2, 'only the aligned narration placement and soundtrack are projected');
  assert.deepEqual(capture.input.audio.map(a => a.atSample), [48000, 0]);
  await assert.rejects(f.prepare(), code('EXPORT_BLOCKED'));
});

test('legacy absolute narration becomes unsettled after reorder and after an earlier shot is lengthened', async t => {
  const f = await fixture(t, { absoluteNarration: true });
  const canonicalId = f.store.get('narration_canonical_head', f.project.id).canonicalId, accepted = f.store.get('narration_canonical', canonicalId);
  assert.equal(captureStoryboard(f.store, f.project.id).readiness.ready, true);
  editStoryboard(f.production, f.project.id, { kind: 'moveShot', id: f.shots[1].id, beforeId: f.shots[0].id, sceneId: f.shots[0].sceneId, expectedHeadVersion: f.head().headVersion }, 'move-legacy-voice');
  let capture = captureStoryboard(f.store, f.project.id);
  assert.deepEqual(capture.readiness.blockers, [{ code: 'voice_unsettled', shotId: f.shots[1].id }]);
  assert.equal(capture.input.audio.some(a => a.gainMilliDb === 0), false);
  await assert.rejects(f.prepare(), code('EXPORT_BLOCKED'));
  editStoryboard(f.production, f.project.id, { kind: 'moveShot', id: f.shots[0].id, beforeId: f.shots[1].id, sceneId: f.shots[0].sceneId, expectedHeadVersion: f.head().headVersion }, 'restore-legacy-cut');
  assert.equal(captureStoryboard(f.store, f.project.id).readiness.ready, true);
  f.mutate(p => { p.shots.find(shot => shot.id === f.shots[0].id).desiredFrames = 45; });
  capture = captureStoryboard(f.store, f.project.id);
  assert.deepEqual(capture.readiness.blockers.filter(b => b.code === 'voice_unsettled'), [{ code: 'voice_unsettled', shotId: f.shots[1].id }]);
  assert.equal(capture.input.audio.some(a => a.gainMilliDb === 0), false);
  assert.deepEqual(f.store.get('narration_canonical', canonicalId), accepted, 'readiness never moves the accepted absolute source history');
});

test('demo preparation waits for a busy fixture worker and concurrent same-key requests share one export', async t => {
  const f = await fixture(t, { demo: true, narration: false }), original = f.media.importFixture.bind(f.media);
  let calls = 0, busy;
  const observedBusy = new Promise(resolve => { busy = resolve; });
  f.media.importFixture = async (...args) => {
    calls++;
    if (calls === 1) { busy(); throw new DomainError('MEDIA_BUSY', 'Another media job owns the worker'); }
    return original(...args);
  };
  const first = f.prepare('busy-fixture-once'), replay = f.prepare('busy-fixture-once');
  await observedBusy;
  assert.equal(f.store.list('media_render', f.project.id).length, 0, 'busy preparation has not created a failed export');
  const [job, same] = await Promise.all([first, replay]);
  assert.equal(job.id, same.id); assert.equal(job.state, 'prepared'); assert.equal(calls, 4, 'one busy response and one import per fixture clip');
  assert.equal(f.store.list('media_render', f.project.id).length, 1);
  assert.equal((await f.prepare('busy-fixture-once')).id, job.id); assert.equal(calls, 4, 'same-key replay cannot normalize again');
  const done = await f.service.run(f.project.id, f.actor, job.id);
  assert.equal(done.state, 'published'); assert.equal(f.store.list('media_render', f.project.id).length, 1); assert.equal(f.provider.acceptedCount(), 0);
});

test('export view keeps an older rendering export current over a newer failure without duplicating history', async t => {
  const f = await fixture(t), running = await f.prepare('older-render'), failed = await f.prepare('newer-failure');
  f.store.put('media_render', running.id, f.project.id, { ...running, state: 'running', ownerToken: 'owned-live-worker', leaseUntil: Date.now() + 15000 });
  f.store.put('media_render', failed.id, f.project.id, { ...failed, state: 'failed', errorCode: 'MEDIA_RENDER_FAILED', finishedAt: new Date().toISOString() });
  const view = f.service.exportView(f.project.id);
  assert.equal(view.current.exportId, running.id); assert.equal(view.current.state, 'rendering');
  assert.deepEqual(view.history.map(row => row.exportId), [failed.id]);
  assert.deepEqual([view.current, ...view.history].map(row => row.exportId).sort(), [running.id, failed.id].sort());
});

test('a shutdown-interrupted export stays publicly recoverable and can publish an already written receipt without rerendering', async t => {
  const f = await fixture(t), job = await f.prepare('shutdown-receipt');
  const receipt = await f.media.render(job.manifest);
  f.store.put('media_render', job.id, f.project.id, { ...job, state: 'interrupted', ownerToken: null, leaseUntil: null, cancelRequested: false, errorCode: null });
  const view = f.service.exportView(f.project.id); assert.equal(view.current.state, 'rendering'); assert.equal(view.current.failure, undefined);
  const detail = await f.request('GET', `/media/renders/${job.id}`); assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().job.state, 'interrupted'); assert.equal(detail.json().job.canRecover, true); assert.equal(detail.json().job.cancelRequested, false);
  f.media.render = async () => { throw new Error('Shutdown receipt recovery must not render again'); };
  const recovered = await f.request('POST', `/exports/${job.id}/recover`, {}); assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal(recovered.json().state, 'done'); assert.equal(recovered.json().artifact.sha256, receipt.artifact.sha256);
  assert.equal(f.store.get('media_render', job.id).state, 'published'); assert.equal(f.store.get('media_render', job.id).cancelRequested, false);
});


test('HTTP storyboard export prepares, renders and publishes while stopped without enabling paid generation', async t => {
  const f = await fixture(t, { narration: false });
  const stopped = await f.request('POST', '/controls', { action: 'stop' }); assert.equal(stopped.statusCode, 200, stopped.body);
  const before = f.provider.acceptedCount(), attempts = f.engine.attempts(f.project.id), grants = f.store.list('grant', f.project.id);
  const stopState = f.production.stopView(f.project.id);
  const key = newId(), body = { expectedHeadVersion: f.head().headVersion };
  const started = await f.request('POST', '/exports', body, key); assert.equal(started.statusCode, 202, started.body);
  const done = await waitExport(f, started.json().exportId); assert.equal(done.state, 'done'); assert.ok(done.artifact);
  assert.equal(f.store.get('media_render', done.exportId).state, 'published');
  assert.equal((await f.request('POST', '/exports', body, key)).json().exportId, done.exportId);
  const view = (await f.request('GET', `/scenes/${f.shots[0].sceneId}/generation`)).json();
  const paid = await f.request('POST', `/scenes/${f.shots[0].sceneId}/generate`, { kind: 'image', headVersion: view.headVersion, revisionId: view.revisionId,
    reviewedFrames: [], reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId });
  assert.equal(paid.json().error.code, 'EXECUTION_PAUSED', paid.body);
  assert.deepEqual(f.engine.attempts(f.project.id), attempts); assert.deepEqual(f.store.list('grant', f.project.id), grants);
  assert.equal(f.provider.acceptedCount(), before); assert.deepEqual(f.production.stopView(f.project.id), stopState);
});

test('the export follows the film aspect: a 9:16 film renders 720 x 1280, a film without a format stays 1280 x 720', async t => {
  const f = await fixture(t, { narration: false, soundtrack: false });
  const legacy = captureStoryboard(f.store, f.project.id).input; assert.deepEqual([legacy.width, legacy.height], [1280, 720]);
  f.mutate(project => { project.filmKind = { version: 'film-kind@1', kind: 'social', format: { platform: 'ig_reels', aspect: '9:16' } }; });
  const vertical = captureStoryboard(f.store, f.project.id).input; assert.deepEqual([vertical.width, vertical.height], [720, 1280]);
  const job = await f.prepare('vertical'); assert.deepEqual([job.manifest.width, job.manifest.height], [720, 1280]);
  // The renderer validates the written picture against the frozen geometry before it publishes.
  const result = await f.service.run(f.project.id, f.actor, job.id), row = f.store.get('artifact', result.artifact.artifactId);
  const probe = await execute(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', row.path]);
  assert.equal(probe.stdout.trim(), '720,1280');
});

test('a 9:16 film crops near-shape clips to fill the frame, keeps other shapes whole, and a film without a format keeps contain', async t => {
  const f = await fixture(t, { narration: false, soundtrack: false });
  // A 2:3 clip, the shape Viggle returns for a 2:3 first frame (768 x 1152), stands in for the first shot's clip.
  const portrait = join(inputs, `portrait-${newId()}.mp4`);
  await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=96x144:r=30:d=1', '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', portrait]);
  const id = newId(), source = await f.media.importMedia({ artifactId: id, path: portrait, kind: 'video' }), ref = { artifactId: id, kind: 'video', sha256: source.sha256 };
  f.store.insert('artifact', id, f.project.id, { artifact: ref, fixture: false, path: (await f.media.verifiedSource(source)).path, mimeType: 'video/mp4', physicalDurationSeconds: 1 });
  f.store.insert('media_source', id, f.project.id, { source, requestId: 'test-source' });
  const node = f.plan.nodes.find(n => n.kind === 'video' && n.shotId === f.shots[0].id);
  f.store.put('node_binding', node.id, f.project.id, { ...f.store.get('node_binding', node.id), outputs: { video: ref } });
  // No format chosen: every clip stays whole, exactly as before.
  const legacy = captureStoryboard(f.store, f.project.id);
  assert.deepEqual(legacy.input.clips.map(clip => clip.fit), ['contain', 'contain', 'contain']); assert.equal(legacy.chosenFormat, false);
  f.mutate(project => { project.filmKind = { version: 'film-kind@1', kind: 'social', format: { platform: 'ig_reels', aspect: '9:16' } }; });
  const vertical = captureStoryboard(f.store, f.project.id);
  assert.deepEqual(vertical.input.clips.map(clip => clip.fit), ['cover', 'contain', 'contain'], '2:3 is within 1.25x of 9:16; 16:9 is not');
  const job = await f.prepare('vertical-fit'); assert.deepEqual(job.manifest.clips.map(clip => clip.fit), ['cover', 'contain', 'contain']);
  const result = await f.service.run(f.project.id, f.actor, job.id), row = f.store.get('artifact', result.artifact.artifactId);
  // 9 x 16 samples per frame: the cropped portrait clip reaches the top edge; the landscape clip keeps black bars there.
  const p = await pixels(row.path, '9:16'), frame = 9 * 16 * 3, top = 4 * 3;
  assert.ok(p[top] > 150 && p[top + 2] < 80, `first shot fills the top edge (${p.slice(top, top + 3).join(',')})`);
  const second = 30 * frame + top;
  assert.ok(p[second] < 40 && p[second + 1] < 40 && p[second + 2] < 40, `second shot is letterboxed (${p.slice(second, second + 3).join(',')})`);
});

test("the Director's start_export is not blocked by its own conversation's edit hold, but still is by the person's and other requests' holds", async t => {
  const f = await fixture(t, { narration: false, soundtrack: false });
  const launcher = new ExportLauncher(f.production, f.service); t.after(() => launcher.close());
  const settle = async id => { for (let i = 0; i < 500 && f.store.get('media_render', id)?.state !== 'published'; i++) await new Promise(resolve => setTimeout(resolve, 10)); return f.store.get('media_render', id); };
  // A Director conversation in an editing turn holds the whole film, as every editing request does.
  const director = f.production.beginRequest(f.project.id, 'local-user', 'Export it.', { editing: true, source: 'user' });
  assert.ok(f.store.list('hold', f.project.id).some(hold => hold.active && hold.ownerId === director.requestId && hold.scopeId === f.project.id));
  // Without naming that conversation (the person's Export), the hold refuses as before.
  await assert.rejects(launcher.start(f.project.id, { expectedHeadVersion: f.head().headVersion }, 'person-while-director-edits'), code('MEDIA_HELD'));
  // Naming it, its own hold is waived from prepare through publication.
  const started = await launcher.start(f.project.id, { expectedHeadVersion: f.head().headVersion }, 'director-export', { directorRequestId: director.requestId });
  assert.equal(started.state, 'rendering');
  const job = await settle(started.exportId);
  assert.equal(job.state, 'published'); assert.equal(job.directorRequestId, director.requestId);
  assert.ok(f.store.list('hold', f.project.id).some(hold => hold.active && hold.ownerId === director.requestId), 'the conversation keeps its hold');
  // Another request's hold on any shot still refuses the Director's export, alongside its own.
  const other = f.engine.setHold(f.project.id, { scopeId: f.shots[1].id, ownerId: 'another-request' });
  await assert.rejects(launcher.start(f.project.id, { expectedHeadVersion: f.head().headVersion }, 'director-export-2', { directorRequestId: director.requestId }), code('MEDIA_HELD'));
  f.engine.releaseHold(f.project.id, other.id, 'another-request');
  // The person opens an edit: their new editing request holds the film, and the Director's export is refused again.
  const person = f.production.beginRequest(f.project.id, 'local-user', 'Change shot 2.', { editing: true, source: 'app', concurrency: 'alongside' });
  assert.ok(f.store.list('hold', f.project.id).some(hold => hold.active && hold.ownerId === person.requestId));
  await assert.rejects(launcher.start(f.project.id, { expectedHeadVersion: f.head().headVersion }, 'director-export-3', { directorRequestId: director.requestId }), code('MEDIA_HELD'));
  // A hold that appears after the export starts still keeps it from publishing (only the named conversation is waived).
  f.production.releaseAlongsideHolds(f.project.id, person);
  const job2 = await f.service.prepareExport(f.project.id, f.actor, { expectedHeadVersion: f.head().headVersion, key: 'director-export-4' }, { directorRequestId: director.requestId });
  const late = f.engine.setHold(f.project.id, { scopeId: f.project.id, ownerId: 'late-request' });
  await assert.rejects(f.service.run(f.project.id, f.actor, job2.id), code('MEDIA_HELD'));
  f.engine.releaseHold(f.project.id, late.id, 'late-request');
  assert.equal(f.provider.acceptedCount(), 0);
});
