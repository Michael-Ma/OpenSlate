import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonical, clipAudioDefault, clipAudioSegments, compilePlan, DEFAULT_PROFILES, digest, newId, shotIntentDigest } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { createApp } from '../dist/app.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalMediaService, MediaApplicationService } from '../dist/media/index.js';
import { captureStoryboard } from '../dist/media/storyboard-capture.js';
import { clipPlaybackPlacements, playbackClips, registerClipAudioContent } from '../dist/media/clip-audio-playback.js';
import { editStoryboard } from '../dist/storyboard.js';
import { requireTestToolchain } from '../../../scripts/test-toolchain.mjs';

const execute = promisify(execFile), { tools: { ffmpeg, ffprobe } } = requireTestToolchain();
const TONES = [440, 1250, 2500];
let inputs, voiced, silent, voice;
before(async () => {
  inputs = await mkdtemp(join(tmpdir(), 'openslate-clip-audio-inputs-'));
  // One second of picture each, with its own tone as the clip's native sound (MiniMax H3 style).
  voiced = await Promise.all(TONES.map(async (frequency, index) => {
    const path = join(inputs, `voiced-${index}.mp4`);
    await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `color=c=gray:s=160x90:r=30:d=1`, '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=1`,
      '-shortest', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', path]);
    return path;
  }));
  silent = join(inputs, 'silent.mp4');
  await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=1', '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', silent]);
  voice = join(inputs, 'voice.wav');
  await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=700:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', voice]);
});
after(async () => { await rm(inputs, { recursive: true, force: true }); });

/** Three 1 s shots; shot 1 has a 0.5 s narration line at its start; optional -18 dB music. */
async function fixture(t, { filmKind, soundtrack = false, silentClip = -1 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'openslate-clip-audio-')), store = new Store(join(dir, 'db.sqlite'));
  const provider = new FakeProvider(join(dir, 'fake.sqlite')), engine = new Engine(store, provider, { artifactDir: join(dir, 'artifacts') });
  const production = new ProductionService(store, engine), project = production.createProject('Clip sound film');
  const media = new LocalMediaService({ rootDir: join(dir, 'media'), allowedInputRoots: [inputs], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const service = new MediaApplicationService(production, media), app = createApp({ service: production, localToken: 'clip-audio-test-token' });
  registerClipAudioContent(app, { store, media: () => media });
  t.after(async () => { await app.close(); store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  const refs = [];
  for (const [index, path] of voiced.entries()) {
    const id = newId(), source = await media.importMedia({ artifactId: id, path: index === silentClip ? silent : path, kind: 'video' }), ref = { artifactId: id, kind: 'video', sha256: source.sha256 };
    refs.push(ref);
    store.insert('artifact', id, project.id, { projectId: project.id, artifact: ref, fixture: false, path: (await media.verifiedSource(source)).path, mimeType: 'video/mp4', physicalDurationSeconds: 1 });
    store.insert('media_source', id, project.id, { id, projectId: project.id, source, requestId: 'test-source' });
  }
  const audio = await media.importMedia({ artifactId: newId(), path: voice, kind: 'audio' });
  const audioRef = { artifactId: audio.artifactId, sha256: audio.sha256, kind: 'audio' };
  store.insert('artifact', audio.artifactId, project.id, { projectId: project.id, artifact: audioRef, fixture: false, path: (await media.verifiedSource(audio)).path, mimeType: 'audio/wav' });
  store.insert('narration_audio', audio.artifactId, project.id, { id: audio.artifactId, projectId: project.id, media: audio });
  const scene = { id: newId(), revisionId: newId(), purpose: 'Scene' };
  const cue = { id: newId(), meaning: 'Voice', durationFrames: 15, placementFrames: 30, audio: audioRef, accepted: true, measured: true };
  const shots = refs.map((_, index) => {
    const voiced = index === 1;
    const shot = { id: newId(), revisionId: newId(), sceneId: scene.id, purpose: `Shot ${index}`, action: 'Stand', framing: 'Wide', motion: 'Push', desiredFrames: 30,
      imagePrompt: 'Boot', videoPrompt: 'Push', referenceArtifactIds: [], cueId: voiced ? cue.id : null,
      narration: { mode: voiced ? 'uploaded' : 'none', text: voiced ? 'Voice' : '', voice: 'stock' }, ...(voiced ? { narrationTimingMode: 'within_shot' } : {}), promptIntent: {} };
    shot.promptIntent = { image: shotIntentDigest(shot, 'image', voiced ? cue : undefined), video: shotIntentDigest(shot, 'video', voiced ? cue : undefined) }; return shot;
  });
  const frame = { artifactId: newId(), sha256: 'a'.repeat(64), kind: 'image' };
  const saved = store.saveProject({ ...project, revisionId: newId(), scenes: [scene], shots, cues: [cue], artifacts: [...refs, audioRef, frame],
    narration: { script: 'Voice', source: 'uploaded' }, ...(filmKind ? { filmKind } : {}),
    ...(soundtrack ? { soundtrack: { audioId: audio.artifactId, gainMilliDb: -18000, startFrame: 0, muted: false } } : {}) }, project.headVersion);
  const canonicalId = newId();
  store.insert('narration_canonical', canonicalId, project.id, { id: canonicalId, projectId: project.id, script: 'Voice', segments: [{ cue, placementMode: 'shot', timingMode: 'within_shot', audioPlacement: { source: audio, startSample: 0, durationSamples: 24000, atSample: 48000, gainMilliDb: 0 } }] });
  store.put('narration_canonical_head', project.id, project.id, { projectId: project.id, canonicalId });
  const declarations = shots.map((shot, i) => `const s${i}=p.shot(${JSON.stringify(shot.id)});const r${i}=p.humanReview("r${i}",{shots:[{intent:s${i},keyframe:p.asset(${JSON.stringify(frame.artifactId)}),videoProfile:"fake-video-v1",motionPrompt:"Push",seconds:6}]});const v${i}=p.video("v${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(p.asset(${JSON.stringify(frame.artifactId)}),r${i}),prompt:"Push",seconds:6});`).join('');
  const plan = compilePlan(`definePlan({baseRevision:${JSON.stringify(saved.revisionId)}},p=>{${declarations}return v2;});`, { project: saved, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: newId });
  const planId = newId(), grants = {};
  for (const node of plan.nodes.filter(n => n.kind === 'video')) grants[node.id] = engine.createGrant(project.id, node.shotId, 'video', 'test-clip-audio').id;
  engine.installPlan(project.id, planId, plan, grants);
  store.saveProject({ ...saved, revisionId: newId(), activePlanId: planId }, saved.headVersion);
  for (const [i, node] of plan.nodes.filter(n => n.kind === 'video').entries()) {
    const binding = store.get('node_binding', node.id); store.put('node_binding', node.id, project.id, { ...binding, outputs: { video: refs[i] } });
  }
  const head = () => store.getProject(project.id);
  const actor = production.beginRequest(project.id, 'local-user', 'Export this film', { editing: false, source: 'app' });
  const prepare = (key = newId()) => service.prepareExport(project.id, actor, { expectedHeadVersion: head().headVersion, key });
  const edit = (input, key = newId()) => editStoryboard(production, project.id, { ...input, expectedHeadVersion: head().headVersion }, key);
  const keep = (index, value = true) => edit({ kind: 'shotClipAudio', id: shots[index].id, field: 'keep', value: String(value) });
  return { store, production, media, service, app, project, refs, shots, actor, prepare, head, edit, keep };
}
const placementRows = job => job.manifest.audio.map(a => [a.atSample, a.durationSamples, a.gainMilliDb, a.source.artifactId.startsWith('clip-audio_') ? 'clip' : 'voice']);
async function decode(path) {
  return (await execute(ffmpeg, ['-nostdin', '-v', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 })).stdout;
}
/** Goertzel-style power of one frequency over 4800 samples from `start`. */
function power(pcm, start, frequency) {
  let real = 0, imaginary = 0;
  for (let index = 0; index < 4800; index++) { const value = pcm.readInt16LE((start + index) * 2), angle = 2 * Math.PI * frequency * index / 48000; real += value * Math.cos(angle); imaginary += value * Math.sin(angle); }
  return Math.sqrt(real ** 2 + imaginary ** 2) / 4800;
}

test('the project default follows filmKind: social, skit and comedy keep, music videos and older projects mute', () => {
  assert.deepEqual(clipAudioDefault({}), { keep: false, gainMilliDb: -6000, reason: 'none' }, 'older projects are unchanged (muted)');
  assert.equal(clipAudioDefault({ filmKind: { version: 'film-kind@1', kind: 'social' } }).keep, true);
  assert.equal(clipAudioDefault({ filmKind: { version: 'film-kind@1', kind: 'social', subtype: 'skit' } }).reason, 'social', 'skit is a social subtype');
  assert.deepEqual(clipAudioDefault({ filmKind: { version: 'film-kind@1', kind: 'narrative', tones: ['comedy'] } }), { keep: true, gainMilliDb: -6000, reason: 'comedy' });
  assert.deepEqual(clipAudioDefault({ filmKind: { version: 'film-kind@1', kind: 'music_video', tones: ['comedy'] } }).keep, false, 'the song is the track');
  assert.equal(clipAudioDefault({ filmKind: { version: 'film-kind@1', kind: 'narrative' } }).keep, false);
  assert.equal(clipAudioDefault({ filmKind: 'social_vertical' }).keep, true, 'a pre-structure string is read through the film-kind normalizer');
  for (const odd of [null, 7, 'nonsense', { kind: 'skit' }, { tones: 'comedy' }]) assert.equal(clipAudioDefault({ filmKind: odd }).keep, false, `defensive read of ${JSON.stringify(odd)}`);
});

test('ducking splits a kept clip into fixed-gain pieces under every voice span, merged and clipped to the shot', () => {
  const base = { startSample: 0, atSample: 48000, durationSamples: 48000, gainMilliDb: -6000 };
  assert.deepEqual(clipAudioSegments(base, []), [base]);
  assert.deepEqual(clipAudioSegments(base, [{ atSample: 48000, durationSamples: 24000 }]),
    [{ startSample: 0, atSample: 48000, durationSamples: 24000, gainMilliDb: -18000 }, { startSample: 24000, atSample: 72000, durationSamples: 24000, gainMilliDb: -6000 }]);
  assert.deepEqual(clipAudioSegments(base, [{ atSample: 0, durationSamples: 60000 }, { atSample: 59000, durationSamples: 2000 }, { atSample: 90000, durationSamples: 50000 }]).map(p => [p.atSample, p.durationSamples, p.gainMilliDb]),
    [[48000, 13000, -18000], [61000, 29000, -6000], [90000, 6000, -18000]]);
  assert.equal(clipAudioSegments({ ...base, gainMilliDb: -55000 }, [{ atSample: 48000, durationSamples: 1 }])[0].gainMilliDb, -60000, 'floor -60 dB');
});

test('an older project exports exactly as before: no clip placements and an unchanged film fingerprint', async t => {
  const f = await fixture(t, { soundtrack: true });
  const capture = captureStoryboard(f.store, f.project.id);
  assert.deepEqual(capture.clipAudio.shots, []);
  // The pre-clip-audio fingerprint formula, recomputed independently.
  const project = f.head(), store = f.store;
  const legacy = project.shots.map(shot => {
    const node = store.get('plan', project.activePlanId).compiled.nodes.find(n => n.kind === 'video' && n.shotId === shot.id);
    return { id: shot.id, revisionId: shot.revisionId, frames: shot.desiredFrames, intent: shot.promptIntent.video, clip: store.get('node_binding', node.id).outputs.video };
  });
  assert.equal(capture.target.film.shots, digest(legacy.sort((a, b) => canonical(a).localeCompare(canonical(b)))));
  const job = await f.prepare();
  assert.deepEqual(placementRows(job), [[48000, 24000, 0, 'voice'], [0, 48000, -18000, 'voice']]);
  assert.equal(Object.hasOwn(job, 'clipAudio'), false);
  // Muting explicitly is the same mix: the manifest differs only by the new target revision.
  f.keep(0, false);
  const again = await f.prepare();
  const recipe = ({ digest: _digest, targetRevisionId: _revision, ...rest }) => canonical(rest);
  assert.equal(recipe(again.manifest), recipe(job.manifest));
  assert.equal(captureStoryboard(f.store, f.project.id).target.film.shots, capture.target.film.shots);
});

test('keep=true mixes each clip sound at its shot offset, trimmed to the shot, and ducks it under narration', async t => {
  const f = await fixture(t);
  f.keep(0); f.keep(1); f.keep(2);
  const job = await f.prepare();
  assert.deepEqual(placementRows(job), [
    [48000, 24000, 0, 'voice'],
    [0, 48000, -6000, 'clip'],
    [48000, 24000, -18000, 'clip'], [72000, 24000, -6000, 'clip'],
    [96000, 48000, -6000, 'clip'],
  ]);
  assert.deepEqual(job.clipAudio.map(r => [r.state, r.pieces]), [['mixed', 1], ['mixed', 2], ['mixed', 1]]);
  const clip = job.manifest.audio.filter(a => a.source.artifactId.startsWith('clip-audio_'));
  assert.ok(clip.every(a => a.startSample + a.durationSamples <= a.source.probe.audio.samples));
  const done = await f.service.run(f.project.id, f.actor, job.id);
  const pcm = await decode(f.store.get('artifact', done.artifact.artifactId).path);
  // Each tone sounds inside its own shot and not in the others.
  for (const [index, frequency] of TONES.entries()) {
    const at = index * 48000 + (index === 1 ? 30000 : 12000);
    assert.ok(power(pcm, at, frequency) > 10 * power(pcm, at, TONES[(index + 1) % 3]), `shot ${index} plays its own clip sound`);
    for (const other of [0, 1, 2].filter(o => o !== index)) assert.ok(power(pcm, other * 48000 + 30000, frequency) < power(pcm, at, frequency) / 10, `clip ${index} is silent in shot ${other}`);
  }
  // Under the narration line (first half of shot 1) the clip is 12 dB down; the voice is at full level.
  const ducked = power(pcm, 48000 + 12000, TONES[1]), open = power(pcm, 72000 + 12000, TONES[1]);
  assert.ok(ducked < open / 2.5 && ducked > open / 8, `ducked ${ducked} vs open ${open}`);
  assert.ok(power(pcm, 48000 + 12000, 700) > ducked, 'the voice sits above the ducked clip');
});

test('with music, clip sound sits above the -18 dB bed and the music is never ducked', async t => {
  const f = await fixture(t, { soundtrack: true, filmKind: { version: 'film-kind@1', kind: 'social', subtype: 'skit' } });
  const job = await f.prepare();
  const rows = placementRows(job);
  assert.deepEqual(rows.filter(r => r[3] === 'voice'), [[48000, 24000, 0, 'voice'], [0, 48000, -18000, 'voice']], 'voice and music placements unchanged');
  assert.deepEqual(rows.filter(r => r[3] === 'clip').map(r => r[2]), [-6000, -18000, -6000, -6000]);
});

test('a clip without an audio stream is skipped silently with its reason recorded', async t => {
  const f = await fixture(t, { silentClip: 2 });
  f.keep(0); f.keep(2);
  const job = await f.prepare();
  assert.deepEqual(job.clipAudio, [{ shotId: f.shots[0].id, state: 'mixed', pieces: 1 }, { shotId: f.shots[2].id, state: 'skipped', reason: 'no_audio_stream' }]);
  assert.deepEqual(placementRows(job).filter(r => r[3] === 'clip'), [[0, 48000, -6000, 'clip']]);
  const event = f.store.readEvents(f.project.id, 0).find(e => e.kind === 'media.clip_audio_skipped');
  assert.deepEqual(event.payload.shots, [{ shotId: f.shots[2].id, reason: 'no_audio_stream' }]);
  const done = await f.service.run(f.project.id, f.actor, job.id);
  assert.equal(done.state, 'published');
  // The negative result is cached: a second derivation does not decode again and gives the same answer.
  assert.deepEqual(await f.media.deriveClipAudio((f.store.get('media_source', f.refs[2].artifactId)).source), { reason: 'no_audio_stream' });
});

test('shotClipAudio sets keep and level, refuses bad input, outdates the export by shots only, and undoes', async t => {
  const f = await fixture(t);
  const job = await f.prepare(), before = f.head(), shot = f.shots[1];
  const receipt = f.keep(1);
  let row = f.head().shots.find(s => s.id === shot.id);
  assert.deepEqual(row.clipAudio, { keep: true });
  assert.equal(row.revisionId, before.shots.find(s => s.id === shot.id).revisionId, 'a mix choice keeps the shot revision and its clip');
  assert.deepEqual(captureStoryboard(f.store, f.project.id).readiness.blockers, []);
  assert.deepEqual(f.service.exportRecord(f.project.id, job.id).outdatedBy, ['shots']);
  f.edit({ kind: 'shotClipAudio', id: shot.id, field: 'gainMilliDb', value: '-12000' });
  row = f.head().shots.find(s => s.id === shot.id);
  assert.deepEqual(row.clipAudio, { keep: true, gainMilliDb: -12000 });
  f.keep(1, false);
  assert.deepEqual(f.head().shots.find(s => s.id === shot.id).clipAudio, { keep: false, gainMilliDb: -12000 }, 'muting keeps the level');
  for (const bad of [{ field: 'keep', value: 'yes' }, { field: 'gainMilliDb', value: '6000' }, { field: 'gainMilliDb', value: '-1.5' }, { field: 'gainMilliDb', value: '' }, { field: 'volume', value: '1' }])
    assert.throws(() => f.edit({ kind: 'shotClipAudio', id: shot.id, ...bad }), e => e.code === 'VALIDATION_ERROR', JSON.stringify(bad));
  assert.throws(() => f.edit({ kind: 'shotClipAudio', id: 'missing', field: 'keep', value: 'true' }), e => e.code === 'NOT_FOUND');
  const last = f.edit({ kind: 'shotClipAudio', id: shot.id, field: 'default' });
  assert.equal(Object.hasOwn(f.head().shots.find(s => s.id === shot.id), 'clipAudio'), false);
  f.edit({ kind: 'undo', commandId: last.commandId });
  assert.deepEqual(f.head().shots.find(s => s.id === shot.id).clipAudio, { keep: false, gainMilliDb: -12000 }, 'undo restores the shot choice');
  assert.notEqual(receipt.commandId, last.commandId);
  assert.equal(f.store.list('hold', f.project.id).some(h => h.active), false, 'no holds');
  assert.ok(captureStoryboard(f.store, f.project.id).readiness.ready, 'clips stay current through every clip sound edit and undo');
});

test('the Film preview gets the same ducked pieces as gain steps, and the clip sound route serves the derived audio', async t => {
  const f = await fixture(t, { filmKind: { version: 'film-kind@1', kind: 'narrative', tones: ['comedy'] } });
  const clips = playbackClips(f.store, f.head());
  assert.deepEqual(clips.map(c => [c.atSample, c.durationSamples, c.gainMilliDb]), [[0, 48000, -6000], [48000, 48000, -6000], [96000, 48000, -6000]]);
  const placements = await clipPlaybackPlacements(f.media, clips, [{ atSample: 48000, durationSamples: 24000 }]);
  assert.deepEqual(placements[1].gainSteps, [{ atSample: 48000, gainMilliDb: -18000 }, { atSample: 72000, gainMilliDb: -6000 }]);
  assert.deepEqual(placements.map(p => [p.kind, p.audioId, p.shotIds[0]]), f.shots.map((s, i) => ['clip', f.refs[i].artifactId, s.id]));
  const response = await f.app.inject({ method: 'GET', url: `/api/projects/${f.project.id}/clip-audio/${f.refs[0].artifactId}/content`, headers: { host: '127.0.0.1', authorization: 'Bearer clip-audio-test-token' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['x-content-sha256'], placements[0].sha256);
  const foreign = await f.app.inject({ method: 'GET', url: `/api/projects/${f.project.id}/clip-audio/not-a-clip/content`, headers: { host: '127.0.0.1', authorization: 'Bearer clip-audio-test-token' } });
  assert.equal(foreign.statusCode, 404);
  f.edit({ kind: 'shotClipAudio', id: f.shots[0].id, field: 'keep', value: 'false' });
  assert.deepEqual(playbackClips(f.store, f.head()).map(c => c.shotId), [f.shots[1].id, f.shots[2].id], 'a muted shot is left out of the preview');
});
