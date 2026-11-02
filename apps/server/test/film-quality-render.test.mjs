import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, digest } from '@openslate/core';
import { LocalMediaService, renderTimeoutMs } from '../dist/media/local-media.js';
import { createLocalTimelineDocument, parseLocalTimelineDocument, rowFrames, SOUND_NAMES } from '../dist/media/local-timeline.js';
import { layoutCaptions, rasterizeCaption, systemCaptionFont, validateCaptions } from '../dist/media/captions.js';
import { normalizeStepInput, stepKey, validateRenderInput } from '../dist/code-plan/identity.js';
import { captureEditedCodePlanRender, LocalMediaExecutor } from '../dist/execution/local-media-executor.js';
import { captureCodePlanRender } from '../dist/media/timeline-capture.js';
import { Store } from '../dist/persistence/store.js';
import { projectFixture } from './execution-fixture.mjs';
import { CodePlanRuntime } from '../dist/code-plan/index.js';
import { CodePlanExecution } from '../dist/code-plan/execution.js';
import { FakeProvider } from '@openslate/providers';
import { findCjkCaptionFont, loadTestToolchain, mediaConfigure, mediaDecoderSupport, mediaDemuxerSupport, requiredMediaDecoders, requireTestToolchain } from '../../../scripts/test-toolchain.mjs';

const run = promisify(execFile), ffmpeg = process.env.OPENSLATE_FFMPEG_PATH, ffprobe = process.env.OPENSLATE_FFPROBE_PATH;
const invalid = /Row|row|Caption|caption|frames|placements|length/;
let root, media, video, black, voice, sounds;
const clip = (source = video, edits = {}) => ({ source, startFrame: 3, durationFrames: 30, fit: 'cover', ...edits });
const input = (changes = {}) => ({ projectId: 'film', targetRevisionId: 'target', width: 320, height: 180, clips: [clip()], ...changes });
const manifest = changes => media.freezeManifest(input(changes));
const render = async changes => media.render(await manifest(changes));
const ref = source => ({ artifactId: source.artifactId, kind: source.kind, sha256: source.sha256 });
async function frames(path, numbers, width = 320, height = 180) {
  const { stdout } = await run(ffmpeg, ['-nostdin', '-v', 'error', '-i', path, '-vf', `select='${numbers.map(n => `eq(n,${n})`).join('+')}'`, '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
  return numbers.map((_, i) => stdout.subarray(i * width * height * 3, (i + 1) * width * height * 3));
}
async function pcm(path) { return (await run(ffmpeg, ['-nostdin', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 30000 })).stdout; }
function rms(bytes, from, to) { let sum = 0; for (let i = from; i < to; i++) sum += bytes.readInt16LE(i * 2) ** 2; return Math.sqrt(sum / (to - from)); }
async function probed(path) { return JSON.parse((await run(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path])).stdout); }
function timeline(m) { const { projectId, clips, audio = [], captions, mastering, sfxPackDigest } = m; return createLocalTimelineDocument({ projectId, clips, audio, ...(captions ? { captions } : {}), ...(mastering ? { mastering } : {}), ...(sfxPackDigest ? { sfxPackDigest } : {}) }); }

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openslate-q4-'));
  for (const [name, filter] of [['moving', 'testsrc2=s=320x180:r=30:d=4'], ['black', 'color=c=black:s=360x640:r=30:d=3']])
    await run(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', filter, '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', join(root, `${name}.mp4`)], { timeout: 30000 });
  await run(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:a', 'pcm_s16le', join(root, 'voice.wav')]);
  media = new LocalMediaService({ rootDir: join(root, 'media'), allowedInputRoots: [root], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  video = await media.importMedia({ artifactId: 'moving', path: join(root, 'moving.mp4'), kind: 'video' });
  black = await media.importMedia({ artifactId: 'black', path: join(root, 'black.mp4'), kind: 'video' });
  voice = await media.importMedia({ artifactId: 'voice', path: join(root, 'voice.wav'), kind: 'audio' });
  sounds = new Map(); for (const name of SOUND_NAMES) sounds.set(name, await media.supplySound(name));
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

test('toolchain CJK preflight agrees with the caption renderer and fails clearly with an absent font override', () => {
  assert.equal(findCjkCaptionFont(), systemCaptionFont(true)?.family);
  assert.ok(systemCaptionFont(true)?.sha256, 'The renderer found a readable CJK font file');
  assert.throws(() => requireTestToolchain({ fontLookup: () => undefined }), /CJK caption font:.*unavailable.*apt-get install fonts-noto-cjk/);
  const linux = ['Noto Sans CJK SC', 'Noto Sans CJK', 'Noto Sans SC'];
  for (const family of linux) assert.equal(findCjkCaptionFont({ platform: 'linux', catalog: { has: name => name === family } }), family);
  assert.equal(findCjkCaptionFont({ platform: 'linux', catalog: { has: name => name === 'DejaVu Sans' } }), undefined, 'Font fallback cannot masquerade as CJK support');
});

test('same-version FFmpeg overrides missing AV1, HEVC or still-image demuxers fail before uploads run', () => {
  const profile = loadTestToolchain();
  const decoders = spawnSync(ffmpeg, ['-hide_banner', '-decoders'], { encoding: 'utf8' });
  assert.equal(decoders.status, 0);
  for (const missing of requiredMediaDecoders(profile, 'linux')) {
    const probe = () => ({ status: 0, stdout: decoders.stdout.split('\n').filter(line => line.trim().split(/\s+/)[1] !== missing).join('\n') });
    assert.deepEqual(mediaDecoderSupport(ffmpeg, profile, probe, 'linux'), { ready: false, missing: [missing] });
  }
  for (const missing of ['libdav1d', 'hevc']) {
    const probe = (path, args) => {
      const result = spawnSync(path, args, { encoding: 'utf8' });
      if (args.includes('-decoders')) result.stdout = result.stdout.split('\n').filter(line => line.trim().split(/\s+/)[1] !== missing).join('\n');
      return result;
    };
    assert.throws(() => requireTestToolchain({ probe, platform: 'linux' }), new RegExp(`media decoders:.*missing: ${missing}.*setup:test-media`));
  }
  const demuxers = spawnSync(ffmpeg, ['-hide_banner', '-demuxers'], { encoding: 'utf8' });
  assert.equal(demuxers.status, 0);
  const probe = (path, args) => args.includes('-demuxers')
    ? { status: 0, stdout: demuxers.stdout.split('\n').filter(line => !line.trim().split(/\s+/)[1]?.split(',').includes('mov')).join('\n') }
    : spawnSync(path, args, { encoding: 'utf8' });
  assert.deepEqual(mediaDemuxerSupport(ffmpeg, profile, probe), { ready: false, missing: ['mov'] });
  assert.throws(() => requireTestToolchain({ probe }), /media demuxers:.*missing: mov/);
  assert.equal(mediaDecoderSupport(ffmpeg, profile, () => ({ status: 1, stdout: decoders.stdout })).ready, false, 'A failed listing is not a successful probe');
});

test('only Linux adds dav1d to the pinned build; macOS configure flags stay unchanged', () => {
  const profile = loadTestToolchain();
  assert.deepEqual(mediaConfigure(profile, 'darwin'), profile.media.configure);
  assert.deepEqual(mediaConfigure(profile, 'linux'), [...profile.media.configure, '--enable-libdav1d']);
  assert.ok(profile.media.requiredDecoders.includes('hevc'));
  assert.ok(requiredMediaDecoders(profile, 'linux').includes('libdav1d'));
  assert.equal(requiredMediaDecoders(profile, 'darwin').includes('libdav1d'), false, 'The Mac source build keeps its existing library prerequisites');
  assert.ok(profile.media.requiredDemuxers.includes('mov'));
});

for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) test(`speed ${speed} gives rounded film frames and probed duration`, async () => {
  const row = clip(video, { durationFrames: 31, speed }), m = await manifest({ clips: [row] }), result = await media.render(m), probe = await probed(result.artifact.path);
  const expected = Math.round(31 / speed);
  assert.equal(m.totalFrames, expected); assert.equal(result.artifact.probe.video.frames, expected);
  assert.equal(Number(probe.streams[0].nb_read_frames), expected); assert.ok(Math.abs(Number(probe.format.duration) - expected / 30) < 0.001);
});

test('hold freezes the last used frame, including a speed/hold/zoom row and the next cut', async () => {
  const result = await render({ clips: [clip(video, { speed: 2, holdFrames: 12, zoom: { scale: 1.4, x: 0.8, y: 0.2 } }), clip(video, { startFrame: 50, durationFrames: 9 })] });
  assert.equal(result.artifact.probe.video.frames, 36); assert.equal(result.artifact.probe.durationSeconds, 1.2);
  const [end, held, next] = await frames(result.artifact.path, [14, 26, 27]);
  let mean = 0; for (let i = 0; i < end.length; i++) mean += Math.abs(end[i] - held[i]);
  assert.ok(mean / end.length < 2, `Held frame differs by ${mean / end.length}`); assert.notDeepEqual(held, next);
});

test('fixed punch-in changes geometry without changing time and honours the focus point', async () => {
  const normal = await render(), center = await render({ clips: [clip(video, { zoom: { scale: 1.4 } })] }), side = await render({ clips: [clip(video, { zoom: { scale: 1.4, x: 0, y: 1 } })] });
  for (const value of [normal, center, side]) { assert.equal(value.artifact.probe.video.frames, 30); assert.equal(value.artifact.probe.durationSeconds, 1); }
  const [a] = await frames(normal.artifact.path, [0]), [b] = await frames(center.artifact.path, [0]), [c] = await frames(side.artifact.path, [0]);
  assert.notDeepEqual(a, b); assert.notDeepEqual(b, c);
});

test('row ranges, edited duration, captions and sounds are refused at plan normalization with row/range context', () => {
  const base = () => ({ timeline: [{ artifact: ref(video), durationFrames: 30 }] });
  for (const patch of [{ speed: 0 }, { speed: 1.1 }, { speed: Infinity }, { holdFrames: 0 }, { holdFrames: 91 }, { holdFrames: 1.5 }, { zoom: { scale: 1 } }, { zoom: { scale: 1.41 } }, { zoom: { scale: 1.2, x: -0.1 } }, { zoom: { scale: 1.2, y: 1.1 } }])
    assert.throws(() => normalizeStepInput('render', { timeline: [{ ...base().timeline[0], ...patch }] }), error => /Row 1/.test(error.message) && /0.5|1–90|1.4|0–1/.test(error.message));
  assert.throws(() => normalizeStepInput('render', { timeline: [{ artifact: ref(video), durationFrames: 10800, speed: 0.5 }] }), /1–10800/);
  assert.throws(() => normalizeStepInput('render', { ...base(), audio: [{ sound: 'explosion', atSample: 0 }] }), /Audio row 1.*pop.*boing/);
  assert.throws(() => normalizeStepInput('render', { ...base(), audio: [{ sound: 'pop', atSample: -1 }] }), /Audio row 1.*0–/);
  assert.throws(() => normalizeStepInput('render', { ...base(), audio: [{ artifact: ref(voice), durationSamples: 100, fadeInSamples: 101 }] }), /Audio row 1.*1–100/);
  assert.throws(() => normalizeStepInput('render', { ...base(), captions: [{ text: 'a'.repeat(81), atFrame: 0, durationFrames: 10 }] }), /Caption 1.*1–80/);
});

test('caption wrapping supports English and mixed CJK, refuses a third line and missing injected CJK font', () => {
  const english = { text: 'This is a longer English caption', atFrame: 0, durationFrames: 30 };
  assert.equal(layoutCaptions([english], 360, 640)[0].lines.length, 2);
  const cjk = { ...english, text: '今日运动完成，明天继续 Hello' };
  assert.equal(layoutCaptions([cjk], 360, 640)[0].lines.length, 2);
  assert.throws(() => layoutCaptions([{ ...english, text: 'W'.repeat(80) }], 360, 640), /Caption 1.*2 lines.*302 px/);
  assert.throws(() => validateRenderInput({ timeline: [ref(video)], captions: [cjk] }, { fontLookup: () => undefined }), /Caption 1.*no CJK system font/);
  assert.throws(() => normalizeStepInput('render', { timeline: [ref(video)], width: 360, height: 640, captions: [{ ...english, text: 'W'.repeat(80) }] }), /Caption 1.*2 lines/);
  for (const c of [english, cjk]) assert.ok(rasterizeCaption(layoutCaptions([c], 360, 640)[0], 360, 640).length > 100);
});

test('caption validation refuses overlaps, malformed positions and out-of-film ranges', () => {
  const c = { text: 'Hello', atFrame: 0, durationFrames: 10 };
  assert.throws(() => validateCaptions(Array(65).fill(c)), /64/);
  assert.throws(() => validateCaptions([c, { ...c, atFrame: 9 }]), /Caption 2.*overlaps caption 1/);
  for (const patch of [{ text: '' }, { text: '  ' }, { atFrame: -1 }, { durationFrames: 0 }, { durationFrames: 31 }, { position: 'left' }, { atFrame: 0.5 }]) assert.throws(() => validateCaptions([{ ...c, ...patch }], 30), /Caption 1/);
  assert.equal(validateCaptions([c, { ...c, atFrame: 10 }], 30).length, 2);
});

test('English and Chinese captions alter pixels only in the enabled interval and expected screen area', async () => {
  const captions = [{ text: 'Hello OpenSlate', atFrame: 10, durationFrames: 10, position: 'top' }, { text: '今日运动完成 Hello', atFrame: 30, durationFrames: 15, position: 'bottom' }];
  const m = await manifest({ width: 360, height: 640, clips: [clip(black, { startFrame: 0, durationFrames: 60 })], captions });
  assert.equal(m.captions.length, 2); assert.ok(m.captions.every(c => c.font.family && /^[a-f0-9]{64}$/.test(c.sha256)));
  assert.ok(m.captions[0].font.sha256, 'The local readable font file is digested');
  const result = await media.render(m), decoded = await frames(result.artifact.path, [0, 10, 19, 20, 30, 44, 45], 360, 640);
  const bright = (bytes, fromY, toY) => { let count = 0; for (let y = fromY; y < toY; y++) for (let x = 20; x < 340; x++) if (bytes[(y * 360 + x) * 3] > 140) count++; return count; };
  for (const i of [0, 3, 6]) assert.equal(bright(decoded[i], 0, 640), 0, `Caption leaked at selected index ${i}`);
  for (const i of [1, 2]) { assert.ok(bright(decoded[i], 40, 110) > 100); assert.equal(bright(decoded[i], 180, 640), 0); }
  for (const i of [4, 5]) { assert.ok(bright(decoded[i], 450, 550) > 100); assert.equal(bright(decoded[i], 0, 400), 0); }
  assert.equal(result.artifact.probe.audio, undefined, 'Caption-only films remain silent');
});

test('middle caption is centered and rasterization has a transparent background', async () => {
  const layout = layoutCaptions([{ text: 'Middle', atFrame: 0, durationFrames: 10, position: 'middle' }], 360, 640)[0];
  const { loadImage, createCanvas } = await import('../node_modules/@napi-rs/canvas/index.js');
  const image = await loadImage(rasterizeCaption(layout, 360, 640)), context = createCanvas(360, 640).getContext('2d'); context.drawImage(image, 0, 0);
  assert.equal(context.getImageData(0, 0, 1, 1).data[3], 0);
  const pixels = context.getImageData(0, 0, 360, 640).data, ys = [];
  for (let y = 0; y < 640; y++) for (let x = 0; x < 360; x++) if (pixels[(y * 360 + x) * 4 + 3] > 100) ys.push(y);
  assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 320) < 10);
});

test('fade-in ramps real samples and persists without changing old fade-out recipes', async () => {
  const base = { source: voice, startSample: 0, durationSamples: 48000, atSample: 0 };
  const noFade = await render({ audio: [base] }), fade = await render({ audio: [{ ...base, fadeInSamples: 24000, fadeOutSamples: 4800 }] });
  const a = await pcm(noFade.artifact.path), b = await pcm(fade.artifact.path);
  assert.ok(rms(b, 500, 3000) < rms(a, 500, 3000) * 0.18);
  assert.ok(rms(b, 26000, 35000) > rms(a, 26000, 35000) * 0.9);
  const doc = timeline(input({ audio: [{ ...base, fadeInSamples: 24000 }] })); assert.equal(doc.audio[0].fadeInSamples, 24000); assert.deepEqual(parseLocalTimelineDocument(doc), doc);
});

for (const name of SOUND_NAMES) test(`offline ${name} pack source is bounded and places at its exact sample interval`, async () => {
  const sound = sounds.get(name), bytes = await stat(new URL(`../assets/sfx/${name}.wav`, import.meta.url));
  assert.ok(bytes.size < 150000); assert.equal(sound.source.probe.audio.sampleRate, 48000); assert.ok(sound.source.probe.durationSeconds < 1.5);
  const result = await render({ clips: [clip(video, { durationFrames: 60 })], audio: [{ source: sound.source, startSample: 0, durationSamples: sound.source.probe.audio.samples, atSample: 24000 }], sfxPackDigest: sound.packDigest });
  const audio = await pcm(result.artifact.path), end = 24000 + sound.source.probe.audio.samples;
  assert.ok(rms(audio, 1000, 22000) < 2); assert.ok(rms(audio, 24500, Math.min(27000, end)) > 100); assert.ok(rms(audio, end + 2500, 94000) < 2);
  assert.equal(result.manifest.sfxPackDigest, sound.packDigest);
});

test('unknown built-in sound is refused and sounds share the normal placement/lane limits', async () => {
  await assert.rejects(media.supplySound('unknown'), /pop.*boing/);
  const sound = sounds.get('pop').source, placement = { source: sound, startSample: 0, durationSamples: sound.probe.audio.samples, atSample: 0 };
  assert.throws(() => timeline(input({ audio: Array(66).fill(placement) })), /65/);
  assert.throws(() => timeline(input({ audio: Array(9).fill(placement) })), /simultaneous/);
  assert.throws(() => timeline(input({ audio: [{ ...placement, atSample: 96000 }] })), /Audio row 1/);
  await assert.rejects(manifest({ audio: [{ ...placement, atSample: 47999 }] }), /timeline boundary/);
});

test('0.3.0 final mixed audio measures -14 ±1 LUFS; the saved 0.2.0 path has no loudnorm', async () => {
  const audio = [{ source: voice, startSample: 0, durationSamples: 192000, atSample: 0, gainMilliDb: -5000 }, { source: voice, startSample: 0, durationSamples: 192000, atSample: 0, gainMilliDb: -10000 }];
  const changes = { clips: [clip(video, { startFrame: 0, durationFrames: 120 })], audio };
  const originalRun = media.run.bind(media), graphs = []; media.run = (tool, args, ...rest) => { if (args.includes('-filter_complex')) graphs.push(args[args.indexOf('-filter_complex') + 1]); return originalRun(tool, args, ...rest); };
  try {
    const old = await render(changes); assert.ok(!graphs.at(-1).includes('loudnorm'));
    const result = await render({ ...changes, mastering: 'loudnorm-0.3.0' }); assert.ok(graphs.at(-1).includes('loudnorm=I=-14:TP=-1.5:LRA=11'));
    const loudness = async path => { const { stderr } = await run(ffmpeg, ['-nostdin', '-v', 'info', '-i', path, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']); return Number(JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)).input_i); };
    assert.ok(Math.abs(await loudness(result.artifact.path) + 14) <= 1); assert.ok(await loudness(old.artifact.path) < -20);
  } finally { media.run = originalRun; }
});

test('unchanged plans keep the saved render step key and graph manifest/timeline identities', async () => {
  const source = { timeline: [{ artifact: ref(video), startFrame: 3, durationFrames: 30, fit: 'cover', motion: 'static' }], audio: [{ artifact: ref(voice), startSample: 0, durationSamples: 48000, atSample: 0, fadeOutSamples: 4800 }] };
  const legacy = { ...source, model: 'local-render', timeline: [{ ...source.timeline[0], artifact: { kind: 'video', sha256: video.sha256 } }], audio: [{ ...source.audio[0], artifact: { kind: 'audio', sha256: voice.sha256 } }] };
  assert.equal(stepKey('render', normalizeStepInput('render', source)), digest({ kind: 'render', input: legacy }));
  for (const size of [{ height: 1920 }, { width: 1920 }]) {
    const partial = { timeline: [ref(video)], ...size };
    assert.equal(stepKey('render', normalizeStepInput('render', partial)), digest({ kind: 'render', input: { timeline: [{ kind: 'video', sha256: video.sha256 }], ...size, model: 'local-render' } }));
  }
  const value = input({ audio: [{ source: voice, startSample: 0, durationSamples: 48000, atSample: 0, fadeOutSamples: 4800 }] }), m = await media.freezeManifest(value);
  assert.deepEqual(m.clips, value.clips); assert.deepEqual(m.audio, [{ ...value.audio[0], gainMilliDb: 0 }]);
  assert.deepEqual(Object.keys(m).sort(), ['digest','version','projectId','targetRevisionId','width','height','frameRate','sampleRate','totalFrames','clips','audio','toolchainDigest'].sort());
  const { digest: ignored, ...body } = m; assert.equal(m.digest, digest(body));
  const doc = timeline(value); assert.deepEqual(Object.keys(doc).sort(), ['version','localExecution','projectId','transition','frameRate','sampleRate','totalFrames','clips','audio','recipeDigest'].sort());
});

async function sqlFixture(t, contract = '0.3.0') {
  const directory = await mkdtemp(join(root, 'sql-')), store = new Store(join(directory, 'state.sqlite')), provider = new FakeProvider(join(directory, 'fake.sqlite'));
  const project = { ...projectFixture(randomUUID(), 0), planMode: 'code', maxFrames: 10800 }; store.createProject(project);
  store.insert('capability_lock', project.capabilityLockId, project.id, { id: project.capabilityLockId, projectId: project.id, localExecution: { adapter: 'local-media', version: '1' }, profiles: [{ id: 'unused-real-profile', revision: 'fixture', kind: 'speech', adapter: 'openai-speech', executionVersion: '1', configuration: { model: 'gpt-4o-mini-tts', settings: {} }, maxConcurrency: 1, unitCostMicros: '10000', maxRetries: 0 }] });
  for (const source of [video, voice]) { const artifact = ref(source); store.insert('artifact', artifact.artifactId, project.id, { artifact, fixture: false, path: (await media.verifiedSource(source)).path, mimeType: source.kind === 'video' ? 'video/mp4' : 'audio/wav' }); store.insert('media_source', artifact.artifactId, project.id, { source }); }
  const worker = new LocalMediaExecutor(store, media, { artifactDir: join(directory, 'artifacts'), codePlanContract: contract });
  const execution = new CodePlanExecution(store, { provider, localExecutor: worker, artifactDir: join(directory, 'artifacts') }), plans = new CodePlanRuntime(store, { execution });
  t.after(async () => { await plans.close(); provider.close(); store.close(); });
  return { store, provider, project, worker, execution, plans };
}

test('real code-plan execution persists all edits, stays free and replays its completion without rendering', async t => {
  const f = await sqlFixture(t), args = { timeline: [{ artifact: ref(video), startFrame: 5, durationFrames: 60, speed: 1.5, holdFrames: 20, zoom: { scale: 1.2 } }], width: 320, height: 180,
    captions: [{ text: 'Hello 你好', atFrame: 10, durationFrames: 30 }], audio: [{ sound: 'ding', atSample: 8000 }, { artifact: ref(voice), durationSamples: 48000, atSample: 0, fadeInSamples: 10000 }] };
  const source = `export default async function film(ctx: Studio) { await ctx.render(${JSON.stringify(args)}); }`;
  await f.plans.submit(f.project.id, { source, author: 'user', basedOnVersion: null, invocationId: randomUUID() });
  for (let i = 0; i < 10 && f.plans.view(f.project.id).state !== 'done'; i++) await f.plans.tick();
  assert.equal(f.plans.view(f.project.id).state, 'done', JSON.stringify(f.plans.view(f.project.id)));
  assert.equal(f.plans.steps(f.project.id).length, 1); assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.plans.view(f.project.id).spentMicros, '0');
  const intent = f.store.list('code_plan_render_intent', f.project.id)[0]; assert.equal(intent.recipe.totalFrames, 60); assert.equal(intent.recipe.mastering, 'loudnorm-0.3.0');
  assert.equal(intent.timeline.captions[0].text, 'Hello 你好'); assert.equal(intent.recipe.audio[1].fadeInSamples, 10000); assert.ok(intent.recipe.sfxPackDigest);
  const stored = await media.findCompletions(intent.recipe.digest); assert.equal(stored.length, 1); assert.equal(stored[0].artifact.probe.video.frames, 60);
  const calls = media.render; media.render = () => { throw Error('replay must not render'); };
  try { await f.plans.submit(f.project.id, { source, author: 'user', basedOnVersion: 1, invocationId: randomUUID() }); await f.plans.tick(); assert.equal(f.plans.view(f.project.id).state, 'done'); assert.equal(f.plans.steps(f.project.id).length, 1); }
  finally { media.render = calls; }
});

test('code contract injection masters only 0.3.0, and old capture stays byte-for-byte identical', async t => {
  const f = await sqlFixture(t), args = { timeline: [{ artifact: ref(video), durationFrames: 30 }], audio: [{ artifact: ref(voice), durationSamples: 48000 }] };
  const legacy = captureCodePlanRender(f.store, f.project.id, args), old = await captureEditedCodePlanRender(f.store, media, f.project.id, args, '0.2.0'), current = await captureEditedCodePlanRender(f.store, media, f.project.id, args, '0.3.0');
  assert.equal(canonical(old), canonical(legacy)); assert.equal(old.mastering, undefined); assert.equal(current.mastering, 'loudnorm-0.3.0');
  const silent = await media.render(await media.freezeManifest({ ...current, audio: [] })); assert.equal(silent.artifact.probe.audio, undefined);
  assert.equal((await captureEditedCodePlanRender(f.store, media, f.project.id, args, '0.1.0')).mastering, undefined);
});

test('eight clips, eight captions and twelve sounds render within the local timeout with a recoverable receipt', async () => {
  const clips = Array.from({ length: 8 }, (_, i) => clip(video, { startFrame: i * 3, durationFrames: 90, ...(i === 2 ? { speed: 1.5, holdFrames: 30 } : {}), ...(i === 5 ? { zoom: { scale: 1.4 } } : {}) }));
  const captions = clips.map((_, i) => ({ text: i % 2 ? '明天继续 Hello' : `Scene ${i + 1}`, atFrame: i * 90 + 10, durationFrames: 60 }));
  const audio = Array.from({ length: 12 }, (_, i) => { const source = sounds.get(SOUND_NAMES[i % 6]).source; return { source, startSample: 0, durationSamples: source.probe.audio.samples, atSample: i * 90000, gainMilliDb: -6000 }; });
  const start = performance.now(), m = await manifest({ width: 1280, height: 720, clips, captions, audio, mastering: 'loudnorm-0.3.0', sfxPackDigest: sounds.get('pop').packDigest }), result = await media.render(m), elapsed = performance.now() - start;
  assert.ok(elapsed < renderTimeoutMs(m.totalFrames), `${elapsed} ms exceeds render timeout`);
  assert.equal(result.artifact.probe.video.frames, 720); assert.equal(result.artifact.probe.video.durationSeconds, 24);
  assert.equal((await media.readCompletion(m.digest, result.artifact.sha256)).manifest.captions.length, 8);
  console.log(`Q4 eight-clip render: ${Math.round(elapsed)} ms / ${renderTimeoutMs(m.totalFrames)} ms`);
});

test('one source frame at every speed and maximum hold keep their exact rounded lengths', async () => {
  for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const row = clip(video, { startFrame: 119, durationFrames: 1, speed, holdFrames: 90 });
    const result = await render({ clips: [row] });
    assert.equal(result.artifact.probe.video.frames, rowFrames(row));
    assert.ok(Math.abs(result.artifact.probe.durationSeconds - rowFrames(row) / 30) < 0.001);
  }
});

test('edited total bounds apply after speed and hold, with sample positions in the finished film', async t => {
  const f = await sqlFixture(t), project = f.store.getProject(f.project.id); f.store.saveProject({ ...project, maxFrames: 90 }, project.headVersion);
  const args = { timeline: [{ artifact: ref(video), durationFrames: 120, speed: 2, holdFrames: 30 }], audio: [{ artifact: ref(voice), startSample: 0, durationSamples: 48000, atSample: 96000, fadeInSamples: 4800 }] };
  const captured = await captureEditedCodePlanRender(f.store, media, f.project.id, args, '0.3.0');
  const document = timeline(captured); assert.equal(document.totalFrames, 90); assert.equal(document.audio[0].atSample, 96000);
  await assert.rejects(captureEditedCodePlanRender(f.store, media, f.project.id, { ...args, timeline: [{ ...args.timeline[0], holdFrames: 31 }] }, '0.3.0'), /1–90 frames/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(captureEditedCodePlanRender(f.store, media, f.project.id, args, '0.3.0', { signal: abort.signal }), { code: 'MEDIA_CANCELLED' });
});

test('caption receipt survives reopen without font lookup and detects tampered PNG bytes', async () => {
  const m = await manifest({ captions: [{ text: 'Frozen 你好', atFrame: 2, durationFrames: 20 }] }), result = await media.render(m);
  const reopened = new LocalMediaService({ rootDir: media.rootDir, allowedInputRoots: [root], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  assert.equal((await reopened.readCompletion(m.digest, result.artifact.sha256)).manifest.captions[0].font.family, m.captions[0].font.family);
  const { chmod, writeFile } = await import('node:fs/promises'), path = join(media.rootDir, 'blobs', `${m.captions[0].sha256}.png`), bytes = await readFile(path);
  try { await chmod(path, 0o600); await writeFile(path, Buffer.alloc(bytes.length)); await assert.rejects(media.render(m), /Caption 1.*PNG changed/); }
  finally { await writeFile(path, bytes); await chmod(path, 0o444); }
});

test('maximum punch-in on the minimum output dimensions keeps a nonempty even crop', async () => {
  const result = await render({ width: 2, height: 2, clips: [clip(video, { durationFrames: 3, zoom: { scale: 1.4, x: 0, y: 1 } })] });
  assert.equal(result.artifact.probe.video.width, 2); assert.equal(result.artifact.probe.video.height, 2); assert.equal(result.artifact.probe.video.frames, 3);
});

test('measured mastering keeps a transient sound over a mostly silent film at -14 LUFS', async () => {
  const source = sounds.get('ding').source;
  const result = await render({ clips: [clip(video, { startFrame: 0, durationFrames: 110 })], audio: [{ source, startSample: 0, durationSamples: source.probe.audio.samples, atSample: 48000, fadeInSamples: 2400 }], mastering: 'loudnorm-0.3.0' });
  const { stderr } = await run(ffmpeg, ['-nostdin', '-v', 'info', '-i', result.artifact.path, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
  const stats = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  assert.ok(Math.abs(Number(stats.input_i) + 14) <= 1, stats.input_i); assert.ok(Number(stats.input_tp) <= -1.4, stats.input_tp);
});
