import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
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
import { filmPlanningGuidance } from '../dist/application/film-planning-guidance.js';
import { SongEnvelope, analyzeSongTiming, fitShotsToSong } from '../dist/media/song-timing.js';
import { isMusicVideoProject, defaultSoundtrackDecision } from '../dist/narration/music-video.js';
import { setup } from './execution-fixture.mjs';

const RATE = 48000;
/** A click track: `bpm` beats, quiet for the first `split` seconds and loud with a bed after it. */
function clicks(seconds, bpm = 120, split = seconds / 2, offset = 0.05) {
  const samples = new Float64Array(Math.round(seconds * RATE)), period = 60 / bpm;
  for (let t = offset; t < seconds; t += period) {
    const loud = t >= split, at = Math.round(t * RATE);
    for (let i = 0; i < 1200 && at + i < samples.length; i++) samples[at + i] += (loud ? 0.8 : 0.15) * Math.exp(-i / 200) * Math.sin(i * 0.3);
  }
  for (let i = Math.round(split * RATE); i < samples.length; i++) samples[i] += 0.05 * Math.sin(i * 2 * Math.PI * 110 / RATE);
  return samples;
}
function stereoWav(mono) {
  const bytes = Buffer.alloc(44 + mono.length * 4); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(mono.length * 4, 40);
  for (let i = 0; i < mono.length; i++) { const v = Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767))); bytes.writeInt16LE(v, 44 + i * 4); bytes.writeInt16LE(v, 46 + i * 4); }
  return bytes;
}
const analyze = mono => { const e = new SongEnvelope(); e.pushMono(mono); return analyzeSongTiming(e.energies(), e.samples); };

test('song timing finds the tempo, a beat grid on the clicks and the section where the song gets loud', () => {
  const timing = analyze(clicks(32, 120, 16));
  assert.equal(timing.durationFrames, 960);
  assert.ok(Math.abs(timing.bpm - 120) <= 1.5, `bpm ${timing.bpm}`);
  const gaps = timing.beatFrames.slice(1).map((frame, i) => frame - timing.beatFrames[i]);
  assert.ok(gaps.every(gap => gap >= 14 && gap <= 16), `gaps ${gaps}`);
  // Beats sit on the clicks (0.05 s + k * 0.5 s), within one frame.
  const off = frame => { const r = ((frame - 1.5) % 15 + 15) % 15; return Math.min(r, 15 - r); };
  assert.ok(timing.beatFrames.every(frame => off(frame) <= 1.5), `beats ${timing.beatFrames.slice(0, 8)}`);
  assert.equal(timing.sectionStartFrames[0], 0);
  assert.ok(timing.sectionStartFrames.some(frame => Math.abs(frame - 480) <= 30), `sections ${timing.sectionStartFrames}`);
  // Stereo PCM16 chunks give the same envelope as mono samples.
  const envelope = new SongEnvelope(), wav = stereoWav(clicks(4)); envelope.push(new Uint8Array(wav.subarray(44)));
  assert.equal(envelope.samples, 4 * RATE);
  assert.throws(() => envelope.push(new Uint8Array(3)), e => e.code === 'AUDIO_PCM_INVALID');
});

test('a recording without a steady beat reports its length and no beat grid', () => {
  // mulberry32: deterministic noise without the float-precision periodicity of a naive LCG.
  let seed = 7; const random = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const noise = Float64Array.from({ length: 20 * RATE }, () => (random() - 0.5) * 0.2);
  const timing = analyze(noise);
  assert.equal(timing.durationFrames, 600); assert.equal(timing.bpm, null); assert.deepEqual(timing.beatFrames, []); assert.deepEqual(timing.sectionStartFrames.slice(0, 1), [0]);
});

test('fitting shots to the song fills its length, keeps 3–15 s shots and lands scene ends on sections and cuts on beats', () => {
  const beatFrames = Array.from({ length: 120 }, (_, i) => i * 15);
  const timing = { durationFrames: 1800, bpm: 120, beatFrames, sectionStartFrames: [0, 452, 900, 1352] };
  const shots = [['a', 's1', 180], ['b', 's1', 180], ['c', 's2', 150], ['d', 's2', 150], ['e', 's3', 210], ['f', 's3', 210], ['g', 's4', 180], ['h', 's4', 180]]
    .map(([id, sceneId, desiredFrames]) => ({ id, sceneId, desiredFrames }));
  const fit = fitShotsToSong(shots, timing);
  assert.equal(fit.targetFrames, 1800); assert.equal(fit.totalFrames, 1800); assert.equal(fit.shortfallFrames, 0);
  assert.equal(fit.timings.reduce((n, x) => n + x.desiredFrames, 0), 1800);
  assert.ok(fit.timings.every(x => x.desiredFrames >= 90 && x.desiredFrames <= 450));
  const cuts = fit.timings.slice(0, -1).map((_, i) => fit.timings.slice(0, i + 1).reduce((n, x) => n + x.desiredFrames, 0));
  assert.deepEqual([cuts[1], cuts[3], cuts[5]], [452, 900, 1352]);
  assert.ok([cuts[0], cuts[2], cuts[4], cuts[6]].every(cut => cut % 15 === 0));
  assert.deepEqual(fit.snapped, { sections: 3, beats: 4 });
  // The music's start offset lengthens the film; too few shots report the uncovered song.
  const late = fitShotsToSong(shots.slice(0, 2), timing, 60);
  assert.equal(late.targetFrames, 1860); assert.equal(late.totalFrames, 900); assert.equal(late.shortfallFrames, 960);
  assert.deepEqual(late.timings.map(x => x.desiredFrames), [450, 450]);
  // Too many shots for a short song are kept at 3 s each and report the overflow; a voice floor is kept.
  const short = fitShotsToSong(shots.slice(0, 4), { durationFrames: 300, bpm: null, beatFrames: [], sectionStartFrames: [0] });
  assert.equal(short.totalFrames, 360); assert.equal(short.overflowFrames, 60);
  const floor = fitShotsToSong([{ ...shots[0], minFrames: 200 }, shots[1]], { durationFrames: 300, bpm: null, beatFrames: [], sectionStartFrames: [0] });
  assert.deepEqual(floor.timings.map(x => x.desiredFrames), [200, 100]);
  assert.deepEqual(fitShotsToSong([], timing).timings, []);
});

test('music video detection and the default-soundtrack decision', () => {
  const p = (brief, soundtrack) => ({ name: 'Film', brief, story: '', ...(soundtrack === undefined ? {} : { soundtrack }) });
  assert.equal(isMusicVideoProject(p('A music video for my song')), true);
  assert.equal(isMusicVideoProject(p('给这首歌做一个MV')), true);
  assert.equal(isMusicVideoProject(p('做一支音乐视频')), true);
  assert.equal(isMusicVideoProject(p('Run mv on the file; a documentary')), false);
  assert.deepEqual(defaultSoundtrackDecision(p('An MV'), 'music'), { adopt: true, gainMilliDb: 0 });
  assert.deepEqual(defaultSoundtrackDecision(p('A documentary'), 'music'), { adopt: true, gainMilliDb: null });
  assert.deepEqual(defaultSoundtrackDecision(p('An MV'), 'upload'), { adopt: false, reason: 'not_music' });
  assert.deepEqual(defaultSoundtrackDecision(p('An MV', null), 'music'), { adopt: false, reason: 'removed' });
  assert.deepEqual(defaultSoundtrackDecision(p('An MV', { audioId: 'x', gainMilliDb: -6000 }), 'music'), { adopt: false, reason: 'already_chosen' });
});

const token = 'offline_music_video_token';
const paths = { ffmpegPath: process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg'),
  ffprobePath: process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe') };
async function library(t, brief) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openslate-music-video-'))), store = new Store(join(root, 'app.sqlite'));
  const provider = new FakeProvider(join(root, 'fake.sqlite')), engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') });
  const production = new ProductionService(store, engine), project = production.createProject('Song film'), uploadDirectory = join(root, 'uploads');
  mkdirSync(uploadDirectory);
  const media = new LocalMediaService({ rootDir: join(root, 'media'), allowedInputRoots: [uploadDirectory], ...paths });
  const narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration);
  const app = createApp({ service: production, localToken: token });
  registerNarrationRoutes(app, { production, narration, canonical, uploadDirectory }); await app.ready();
  t.after(async () => { await app.close(); store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  const headers = { host: '127.0.0.1', authorization: `Bearer ${token}` };
  if (brief) editStoryboard(production, project.id, { kind: 'treatment', field: 'brief', value: brief, expectedHeadVersion: store.getProject(project.id).headVersion }, randomUUID());
  const upload = (role, name, body = stereoWav(clicks(12, 120, 6)), key = randomUUID()) => app.inject({ method: 'POST', url: `/api/projects/${project.id}/audio-library/uploads?role=${role}&name=${encodeURIComponent(name)}`,
    payload: body, headers: { ...headers, 'idempotency-key': key, 'content-type': 'application/octet-stream' } });
  const timing = audioId => app.inject({ method: 'GET', url: `/api/projects/${project.id}/audio-library/${audioId}/timing`, headers });
  return { store, production, project, upload, timing, current: () => store.getProject(project.id) };
}

test('a song imported as music becomes a music video’s soundtrack at full level, and the person can still change or remove it', async t => {
  const f = await library(t, 'A music video for my song.');
  const first = await f.upload('music', 'Song.wav', undefined, 'song-key'); assert.equal(first.statusCode, 200, first.body);
  const song = first.json().recording; assert.equal(song.selectedAsMusic, true); assert.equal(song.role, 'music');
  assert.deepEqual(f.current().soundtrack, { audioId: song.id, gainMilliDb: 0 });
  // Both steps are the person's own soundtrack command (with Undo history), not a new authority.
  const edits = f.store.list('storyboard_edit', f.project.id).filter(x => x.input.kind === 'soundtrack');
  assert.deepEqual(edits.map(x => [x.input.field, x.input.value]), [['audioId', song.id], ['gainMilliDb', '0']]);
  const replay = await f.upload('music', 'Song.wav', undefined, 'song-key'); assert.deepEqual(replay.json(), first.json());
  assert.equal(f.store.list('storyboard_edit', f.project.id).filter(x => x.input.kind === 'soundtrack').length, 2);
  // The timing was cached at import; the route reports it and the fit for the (empty) storyboard.
  assert.equal(f.store.get('song_timing', song.id).sha256, song.sha256);
  const timing = await f.timing(song.id); assert.equal(timing.statusCode, 200, timing.body);
  const view = timing.json(); assert.equal(view.musicVideo, true); assert.equal(view.selected, true); assert.equal(view.timing.durationFrames, 360);
  assert.ok(Math.abs(view.timing.bpm - 120) <= 1.5); assert.equal(view.fit.shortfallFrames, 360);
  const guide = filmPlanningGuidance(f.production, f.project.id, f.current().id);
  assert.equal(guide.musicVideo.songAudioId, song.id); assert.equal(guide.musicVideo.song.seconds, 12);
  // A second song never replaces the choice.
  const other = await f.upload('music', 'Other.wav', stereoWav(clicks(8, 100))); assert.equal(other.json().recording.selectedAsMusic, false);
  assert.equal(f.current().soundtrack.audioId, song.id);
  // No music is respected for later imports.
  editStoryboard(f.production, f.project.id, { kind: 'soundtrack', field: 'audioId', value: '', expectedHeadVersion: f.current().headVersion }, randomUUID());
  assert.equal(f.current().soundtrack, null);
  const third = await f.upload('music', 'Third.wav', stereoWav(clicks(6, 90))); assert.equal(third.json().recording.selectedAsMusic, false);
  assert.equal(f.current().soundtrack, null);
  const foreign = await f.timing('missing-audio'); assert.equal(foreign.statusCode, 404);
});

test('music in a film that is not a music video becomes the soundtrack at the usual bed level; other audio never does', async t => {
  const f = await library(t, 'A short documentary about the harbour.');
  const other = await f.upload('upload', 'Interview.wav'); assert.equal(other.json().recording.selectedAsMusic, false);
  assert.equal(f.current().soundtrack, undefined);
  const music = await f.upload('music', 'Bed.wav'); assert.equal(music.json().recording.selectedAsMusic, true);
  assert.deepEqual(f.current().soundtrack, { audioId: music.json().recording.id, gainMilliDb: -18000 });
  assert.equal(filmPlanningGuidance(f.production, f.project.id, 'none').musicVideo, undefined);
});

test('a pending plan import leaves the music imported but unselected', async t => {
  const f = await library(t, 'An MV');
  f.store.insert('plan_import', 'pending-import', f.project.id, { id: 'pending-import', projectId: f.project.id, state: 'pending' });
  const music = await f.upload('music', 'Song.wav'); assert.equal(music.statusCode, 200, music.body);
  assert.equal(music.json().recording.selectedAsMusic, false); assert.equal(f.current().soundtrack, undefined);
});

test('shotTiming sets several shot lengths as one undoable command and outdates only the clips', t => {
  const f = setup(t), service = new ProductionService(f.store, f.engine);
  const edit = (body, key = randomUUID()) => editStoryboard(service, f.projectId, { expectedHeadVersion: f.store.getProject(f.projectId).headVersion, ...body }, key);
  const before = f.store.getProject(f.projectId), [a, b] = before.shots, bindings = f.store.list('node_binding', f.projectId);
  const receipt = edit({ kind: 'shotTiming', timings: [{ id: a.id, desiredFrames: 120 }, { id: b.id, desiredFrames: 165 }] });
  const after = f.store.getProject(f.projectId);
  assert.deepEqual(after.shots.map(x => x.desiredFrames), [120, 165]);
  assert.deepEqual(after.shots.map(x => x.imagePrompt), before.shots.map(x => x.imagePrompt));
  assert.deepEqual(after.shots.map(x => x.promptIntent.image), before.shots.map(x => x.promptIntent.image));
  for (const binding of bindings) {
    const now = f.store.get('node_binding', binding.id);
    if (binding.node.kind === 'image') assert.equal(now.candidateId, binding.candidateId);
    if (binding.node.kind === 'video' && binding.candidateId) { assert.equal(now.candidateId, null); if (now.outdated) assert.deepEqual(now.outdated.fields, ['desiredFrames']); }
  }
  edit({ kind: 'undo', commandId: receipt.commandId });
  assert.deepEqual(f.store.getProject(f.projectId).shots.map(x => x.desiredFrames), before.shots.map(x => x.desiredFrames));
  for (const timings of [[{ id: a.id, desiredFrames: 60 }], [{ id: 'foreign', desiredFrames: 120 }], [{ id: a.id, desiredFrames: 120 }, { id: a.id, desiredFrames: 130 }], []])
    assert.throws(() => edit({ kind: 'shotTiming', timings }), e => ['VALIDATION_ERROR', 'NOT_FOUND'].includes(e.code));
});
