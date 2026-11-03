import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { digest } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { LocalMediaService } from '../dist/media/local-media.js';
import { createLocalTimelineDocument, parseLocalTimelineDocument } from '../dist/media/local-timeline.js';
import { videoTicks } from '../dist/media/frame-rate.js';
import { LocalMediaExecutor, captureEditedCodePlanRender } from '../dist/execution/local-media-executor.js';
import { readClipFrames } from '../dist/code-plan/clip-frames.js';
import { CODE_PLAN_MODELS, normalizeStepInput, stepKey } from '../dist/code-plan/identity.js';
import { CodePlanRuntime } from '../dist/code-plan/index.js';
import { CodePlanExecution } from '../dist/code-plan/execution.js';
import { Store } from '../dist/persistence/store.js';
import { projectFixture } from './execution-fixture.mjs';

const run = promisify(execFile), ffmpeg = process.env.OPENSLATE_FFMPEG_PATH, ffprobe = process.env.OPENSLATE_FFPROBE_PATH;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ref = source => ({ artifactId: source.artifactId, kind: source.kind, sha256: source.sha256 });
let root, media, native, thirty, voice, black;
async function fixture(name, rate, options = []) {
  const path = join(root, `${name}.mp4`);
  // A binary frame counter in eight 20-pixel bars, plus testsrc2 motion below it.
  const counter = "geq=lum='if(lt(Y,24),16+200*mod(floor(N/pow(2,floor(X/20))),2),lum(X,Y))':cb='if(lt(Y,24),128,cb(X,Y))':cr='if(lt(Y,24),128,cr(X,Y))'";
  await run(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=160x90:r=${rate}:d=3`, '-vf', counter, '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', ...options, path]);
  return { path, source: await media.importMedia({ artifactId: name, path, kind: 'video' }) };
}
const row = (source, changes = {}) => ({ source, startFrame: 0, durationFrames: videoTicks(source.probe.video), fit: 'contain', ...changes });
async function render(clips, changes = {}) {
  const manifest = await media.freezeManifest({ projectId: 'g2', targetRevisionId: 'cut', width: 160, height: 90, outputFrameRate: 24, clips, ...changes });
  return media.render(manifest);
}
async function hashes(path) {
  const { stdout } = await run(ffmpeg, ['-nostdin', '-v', 'error', '-threads', '1', '-i', path, '-map', '0:v:0', '-f', 'framemd5', '-']);
  return stdout.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
}
async function pictures(path) {
  const { stdout } = await run(ffmpeg, ['-nostdin', '-v', 'error', '-threads', '1', '-i', path, '-map', '0:v:0', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  return Array.from({ length: stdout.length / (160 * 90) }, (_, i) => stdout.subarray(i * 160 * 90, (i + 1) * 160 * 90));
}
const frameId = bytes => Array.from({ length: 8 }, (_, bit) => bytes[12 * 160 + bit * 20 + 10] > 128 ? 2 ** bit : 0).reduce((sum, value) => sum + value, 0);
const ids = async path => (await pictures(path)).map(frameId);
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openslate-g2-'));
  media = new LocalMediaService({ rootDir: join(root, 'media'), allowedInputRoots: [root], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  native = await fixture('native24', 24); thirty = await fixture('native30', 30);
  const path = join(root, 'voice.wav');
  await run(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', path]);
  voice = await media.importMedia({ artifactId: 'voice', path, kind: 'audio' });
  const blackPath = join(root, 'black.mp4'); await run(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=24:d=3', '-c:v', 'libx264', '-threads', '1', blackPath]);
  black = await media.importMedia({ artifactId: 'black', path: blackPath, kind: 'video' });
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

test('24 fps normalization and whole speed-one code render retain all 72 decoded frames, hashes and order', async () => {
  const source = native.source, owned = await media.verifiedSource(source);
  assert.equal(source.probe.video.frameRate, '24/1'); assert.equal(source.probe.video.frames, 72);
  const original = await hashes(native.path); assert.equal(new Set(original).size, 72);
  assert.deepEqual(await hashes(owned.path), original);
  const result = await render([row(source)]);
  assert.equal(result.artifact.probe.video.frameRate, '24/1'); assert.equal(result.artifact.probe.video.frames, 72);
  assert.deepEqual(await hashes(result.artifact.path), original);
  // Force the ordinary encoder path too: identity scale, explicit speed and two contiguous rows.
  const encoded = await render([row(source, { durationFrames: 45, speed: 1 }), row(source, { startFrame: 45, durationFrames: 45 })]);
  assert.deepEqual(await ids(encoded.artifact.path), Array.from({ length: 72 }, (_, i) => i));
  const encodedHashes = await hashes(encoded.artifact.path); assert.equal(new Set(encodedHashes).size, 72);
  // Reproduce the former normalization locally, without altering application recipes.
  const before = join(root, 'old30.mp4');
  await run(ffmpeg, ['-nostdin', '-v', 'error', '-i', native.path, '-vf', 'fps=30', '-c:v', 'libx264', '-threads', '1', before]);
  const old = await media.probe(before), oldIds = await ids(before);
  assert.equal(old.video.frames, 90); assert.equal(oldIds.filter((id, i) => i && id === oldIds[i - 1]).length, 18);
  const legacy = await media.importMedia({ artifactId: 'legacy30', path: before, kind: 'video' });
  const replay = await render([row(legacy)]);
  assert.deepEqual(await ids(replay.artifact.path), Array.from({ length: 72 }, (_, i) => i), 'a finished clip converted by the old normalizer can rerender locally without judder');
  console.log('G2 measured encoded 3s clip: source 24/1 72; former normalization 30/1 90 (18 duplicate pictures); current normalization/render 24/1 72 (72 distinct source hashes).');
});

test('25 and both NTSC rates stay native; unsupported and variable rates fall back to 30 fps', async () => {
  for (const rate of ['25', '24000/1001', '30000/1001']) {
    const value = await fixture(`rate-${rate.replace('/', '-')}`, rate);
    assert.equal(value.source.probe.video.frameRate, rate === '25' ? '25/1' : rate);
    assert.equal(value.source.probe.video.frames, (await media.probe(value.path)).video.frames);
    assert.deepEqual(await hashes((await media.verifiedSource(value.source)).path), await hashes(value.path));
  }
  const other = await fixture('rate12', 12); assert.equal(other.source.probe.video.frameRate, '30/1');
  // Still averages 24 fps, but has alternating one- and three-tick presentation gaps.
  const path = join(root, 'vfr.mp4');
  await run(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=48:d=3', '-vf', "select='eq(mod(n,4),0)+eq(mod(n,4),3)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '1', '-video_track_timescale', '48', path]);
  assert.equal((await media.probe(path)).video.frameRate, '24/1', 'variable timestamps can still advertise an average 24 fps');
  const vfr = await media.importMedia({ artifactId: 'vfr', path, kind: 'video' }); assert.equal(vfr.probe.video.frameRate, '30/1');
});

test('native-rate transcoding still enforces even size, square pixels, yuv420p, zero rotation and silence', async () => {
  const path = join(root, 'odd444.mp4');
  await run(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=161x91:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=1',
    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv444p', '-c:a', 'aac', '-metadata', 'comment=removed by normalization', path]);
  const source = await media.importMedia({ artifactId: 'odd444', path, kind: 'video' }), owned = await media.verifiedSource(source);
  assert.equal(source.probe.video.frameRate, '24/1'); assert.equal(source.probe.video.frames, 24);
  assert.equal(source.probe.video.width, 162); assert.equal(source.probe.video.height, 92); assert.equal(source.probe.audio, undefined);
  const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', owned.path])).stdout);
  assert.equal(probe.streams.length, 1); assert.equal(probe.streams[0].pix_fmt, 'yuv420p'); assert.equal(probe.streams[0].sample_aspect_ratio, '1:1');
  assert.ok((probe.streams[0].side_data_list ?? []).every(data => !data.rotation)); assert.equal(probe.format.tags.comment, undefined);
  const audio = await media.deriveClipAudio(source); assert.equal(audio.media.probe.audio.samples, 48000, 'original sound uses native video duration');
  const rotatedPath = join(root, 'rotated.mp4');
  await run(ffmpeg, ['-nostdin', '-v', 'error', '-display_rotation:v:0', '90', '-i', native.path, '-c:v', 'copy', rotatedPath]);
  const input = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', rotatedPath])).stdout);
  assert.equal(input.streams[0].side_data_list.find(data => data.side_data_type === 'Display Matrix').rotation, 90);
  const rotated = await media.importMedia({ artifactId: 'rotated', path: rotatedPath, kind: 'video' });
  assert.equal(rotated.probe.video.frameRate, '24/1'); assert.equal(rotated.probe.video.frames, 72);
  assert.equal(rotated.probe.video.width, 90); assert.equal(rotated.probe.video.height, 160);
  const output = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', (await media.verifiedSource(rotated)).path])).stdout);
  assert.ok((output.streams[0].side_data_list ?? []).every(data => !data.rotation));
});

test('30 fps code source drops frames evenly at 24 fps without a repeated picture; graph output stays 30 fps', async () => {
  const result = await render([row(thirty.source)]), sequence = await ids(result.artifact.path);
  assert.equal(sequence.length, 72); assert.equal(new Set(sequence).size, 72);
  const deltas = sequence.slice(1).map((value, i) => value - sequence[i]);
  assert.ok(deltas.every(delta => delta === 1 || delta === 2));
  const dropped = deltas.flatMap((delta, i) => delta === 2 ? [i] : []);
  assert.ok(dropped.slice(1).every((at, i) => at - dropped[i] === 4));
  const graph = await render([row(native.source)], { outputFrameRate: undefined });
  assert.equal(graph.artifact.probe.video.frameRate, '30/1'); assert.equal(graph.artifact.probe.video.frames, 90);
});

test('tick cuts and cumulative boundaries round once, even when individual rows disappear', async () => {
  const fractional = await render([row(native.source, { startFrame: 7, durationFrames: 31 })]);
  assert.deepEqual(await ids(fractional.artifact.path), Array.from({ length: 25 }, (_, i) => i + 6), 'a fractional cut must not repeat its final source picture');
  const clips = Array.from({ length: 10 }, (_, i) => row(native.source, { startFrame: i * 3, durationFrames: 3 }));
  const result = await render(clips); assert.equal(result.artifact.probe.video.frames, 24);
  const sequence = await ids(result.artifact.path); let cursor = 0;
  for (const clip of clips) {
    const start = Math.round(cursor * 24 / 30), end = Math.round((cursor + 3) * 24 / 30);
    assert.equal(sequence[start], Math.round(clip.startFrame * 24 / 30)); cursor += 3;
    assert.equal(sequence.slice(start, end).length, end - start);
  }
  const small = await render(Array.from({ length: 10 }, (_, i) => row(native.source, { startFrame: i * 3, durationFrames: 1 })));
  assert.equal(small.artifact.probe.video.frames, 8);
});

test('captions keep their tick windows, audio keeps sample positions and ends at the rounded film boundary', async () => {
  const whole = await render([row(native.source)], {
    audio: [{ source: voice, startSample: 0, durationSamples: 144000, atSample: 0 }],
  });
  assert.deepEqual(await hashes(whole.artifact.path), await hashes(native.path), 'adding audio retains the whole-clip picture-copy path');
  assert.ok(Math.abs(whole.artifact.probe.audio.samples - 144000) <= 2000, 'whole-clip audio ends within one output frame');
  const clips = [row(black, { durationFrames: 31 })];
  const result = await render(clips, {
    captions: [{ text: 'SYNC', atFrame: 7, durationFrames: 13 }],
    audio: [{ source: voice, startSample: 0, durationSamples: 31 * 1600 - 12000, atSample: 12000 }],
  });
  assert.equal(result.artifact.probe.video.frames, 25);
  assert.ok(Math.abs(result.artifact.probe.audio.samples - 50000) <= 2048);
  const b = await pictures(result.artifact.path);
  for (let i = 0; i < 25; i++) {
    const bright = b[i].subarray(30 * 160).filter(value => value > 100).length;
    assert.equal(bright > 10, i >= 6 && i < 16, `caption at output frame ${i}: ${bright} bright pixels`);
  }
  const { stdout } = await run(ffmpeg, ['-nostdin', '-v', 'error', '-i', result.artifact.path, '-map', '0:a:0', '-ac', '1', '-f', 's16le', '-'], { encoding: 'buffer' });
  const energy = (start, end) => { let sum = 0; for (let i = start; i < end; i++) sum += stdout.readInt16LE(i * 2) ** 2; return Math.sqrt(sum / (end - start)); };
  assert.ok(energy(1000, 10000) < 5); assert.ok(energy(14000, 20000) > 100);
  const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', result.artifact.path])).stdout);
  assert.ok(Math.abs(Number(probe.streams.find(s => s.codec_type === 'audio').duration) - 25 / 24) < 1 / 24);
});

test('all supported speeds, holds and zoom preserve rounded on-screen length', async () => {
  for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const clip = row(native.source, { durationFrames: 31, speed, holdFrames: 9, zoom: { scale: 1.2 } });
    const result = await render([clip]), count = Math.round((Math.round(31 / speed) + 9) * 24 / 30);
    assert.equal(result.artifact.probe.video.frames, count); assert.ok(Math.abs(result.artifact.probe.video.durationSeconds - count / 24) < 0.001);
  }
  const result = await render([row(native.source, { durationFrames: 30, speed: 2, holdFrames: 30 })]);
  const sequence = await ids(result.artifact.path); assert.equal(sequence.length, 36);
  assert.ok(sequence.slice(12).every(id => id === sequence[11]), 'hold freezes the last used source picture');
});

test('saved finished clips replay and locally rerender at 24 fps after restart with unchanged video key and zero provider calls', async t => {
  const directory = join(root, 'saved'), provider = new FakeProvider(`${directory}-fake.sqlite`);
  let store = new Store(`${directory}.sqlite`);
  const project = { ...projectFixture(randomUUID(), 0), planMode: 'code', maxFrames: 10800 }; store.createProject(project);
  store.insert('capability_lock', project.capabilityLockId, project.id, { id: project.capabilityLockId, projectId: project.id, localExecution: { adapter: 'local-media', version: '1' }, profiles: [{ id: 'unused', revision: 'fixture', kind: 'speech', adapter: 'openai-speech', executionVersion: '1', configuration: { model: 'gpt-4o-mini-tts', settings: {} }, maxConcurrency: 1, unitCostMicros: '10000', maxRetries: 0 }] });
  const source = native.source, artifact = ref(source), owned = await media.verifiedSource(source);
  store.insert('artifact', source.artifactId, project.id, { id: source.artifactId, projectId: project.id, artifact, fixture: false, path: owned.path, mimeType: 'video/mp4', physicalDurationSeconds: 3, width: 160, height: 90 });
  store.insert('media_source', source.artifactId, project.id, { id: source.artifactId, projectId: project.id, source });
  const videoInput = normalizeStepInput('video', { model: 'fake-video', motion: 'saved motion', durationSeconds: 3, aspectRatio: '16:9' });
  const key = stepKey('video', videoInput), now = new Date().toISOString();
  store.insert('code_plan_step', digest({ projectId: project.id, key }), project.id, { id: digest({ projectId: project.id, key }), projectId: project.id, key, kind: 'video', input: videoInput, state: 'succeeded', attemptId: null, result: { ok: true, artifact, artifacts: [artifact] }, priceMicros: '0', createdAt: now, updatedAt: now });
  let providerCalls = 0;
  for (const method of ['submit', 'poll', 'lookup']) provider[method] = async () => { providerCalls++; throw Error(`unexpected provider ${method}`); };
  const start = () => new CodePlanRuntime(store, { models: CODE_PLAN_MODELS, execution: new CodePlanExecution(store, { provider, localExecutor: new LocalMediaExecutor(store, media, { artifactDir: `${directory}-artifacts` }), artifactDir: `${directory}-artifacts` }) });
  let plans = start(); t.after(async () => { await plans.close(); provider.close(); store.close(); });
  const program = variant => `export default async function film(ctx) { const clip = await ctx.video(${JSON.stringify(videoInput)}); await ctx.render({timeline:[clip.artifact],width:160,height:90,variant:${JSON.stringify(variant)}}); }`;
  async function finish(source, version) {
    try { await plans.submit(project.id, { source, author: 'user', basedOnVersion: version, invocationId: randomUUID() }); } catch (error) { throw Error(JSON.stringify(error.details), { cause: error }); }
    for (let i = 0; i < 15 && plans.view(project.id).state !== 'done'; i++) await plans.tick();
    assert.equal(plans.view(project.id).state, 'done', JSON.stringify(plans.view(project.id)));
  }
  await finish(program('one'), null);
  await plans.close(); store.close(); store = new Store(`${directory}.sqlite`); plans = start();
  await finish(program('two'), 1); // Only the free local render changes.
  assert.equal(providerCalls, 0); assert.equal(plans.steps(project.id).filter(step => step.kind === 'video').length, 1);
  const intents = store.list('code_plan_render_intent', project.id); assert.equal(intents.length, 2);
  for (const intent of intents) { assert.equal(intent.recipe.frameRate.numerator, 24); assert.equal(intent.recipe.totalFrames, 72); }
  const captured = await captureEditedCodePlanRender(store, media, project.id, { timeline: [artifact] }, '0.3.0');
  assert.equal(captured.clips[0].durationFrames, 90);
  const timeline = createLocalTimelineDocument({ projectId: project.id, clips: captured.clips, audio: [] });
  assert.equal(timeline.totalFrames, 90); assert.deepEqual(parseLocalTimelineDocument(timeline), timeline);
  const watched = await readClipFrames(store, project.id, { artifactId: source.artifactId, startFrame: 30, endFrame: 60, everyFrames: 15 }, { ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  assert.equal(watched.metadata.fps, 30); assert.equal(watched.metadata.durationFrames, 90); assert.deepEqual(watched.metadata.frames, [30, 45, 60]);
  const sheet = await loadImage(Buffer.from(watched.content[1].data, 'base64'));
  const canvas = createCanvas(sheet.width, sheet.height), context = canvas.getContext('2d'); context.drawImage(sheet, 0, 0);
  for (const [index, expected] of [24, 36, 48].entries()) {
    const x = index % watched.metadata.sheet.columns * 320, y = Math.floor(index / watched.metadata.sheet.columns) * 208;
    let id = 0; for (let bit = 0; bit < 8; bit++) if (context.getImageData(x + bit * 40 + 20, y + 24, 1, 1).data[0] > 128) id += 2 ** bit;
    assert.equal(id, expected, `contact sheet cell ${index} keeps tick numbering`);
  }
});
