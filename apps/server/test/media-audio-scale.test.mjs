import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalMediaService } from "../dist/media/index.js";

const execute = promisify(execFile);
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const code = expected => error => error?.code === expected;

test("64 sequential cue placements use two distinct audio streams with decoded source order and silence gaps", async t => {
  const root = await mkdtemp(join(tmpdir(), "openslate-audio-scale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const picture = join(root, "picture.mp4");
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30", "-frames:v", "128", "-an", "-c:v", "libx264", "-threads", "1", picture], { timeout: 10000 });
  const service = new LocalMediaService({ rootDir: join(root, "store"), allowedInputRoots: [root], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const video = await service.importMedia({ artifactId: "picture", path: picture, kind: "video" }), sources = [];
  for (const frequency of [600, 900]) {
    const path = join(root, `${frequency}.wav`);
    await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=1`, "-c:a", "pcm_s16le", path], { timeout: 10000 });
    sources.push(await service.importMedia({ artifactId: `audio-${frequency}`, path, kind: "audio" }));
  }
  const audio = Array.from({ length: 64 }, (_, index) => ({ source: sources[index % 2], startSample: 0, durationSamples: 1600, atSample: index * 3200 }));
  const input = { projectId: "scale", targetRevisionId: "64-cues", width: 160, height: 90, clips: [{ source: video, startFrame: 0, durationFrames: 128, fit: "contain" }], audio };
  const manifest = await service.freezeManifest(input), rendered = await service.render(manifest);
  assert.equal(manifest.audio.length, 64); assert.equal(new Set(manifest.audio.map(a => a.source.sha256)).size, 2);
  assert.equal(rendered.artifact.probe.video.frames, 128);
  const decoded = await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", rendered.artifact.path, "-map", "0:a:0", "-ac", "1", "-f", "s16le", "-"], { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 10000 });
  const sample = index => decoded.stdout.readInt16LE(index * 2);
  const power = (start, frequency) => {
    let real = 0, imaginary = 0;
    for (let index = 0; index < 800; index++) { const value = sample(start + index), angle = 2 * Math.PI * frequency * index / 48000; real += value * Math.cos(angle); imaginary += value * Math.sin(angle); }
    return real ** 2 + imaginary ** 2;
  };
  for (let index = 0; index < 64; index++) {
    const start = index * 3200 + 400, expected = index % 2 ? 900 : 600, other = index % 2 ? 600 : 900;
    assert.ok(power(start, expected) > power(start, other) * 10, `wrong source or placement at cue ${index}`);
    let energy = 0; for (let offset = 2600; offset < 3000; offset++) energy += sample(index * 3200 + offset) ** 2;
    assert.ok(Math.sqrt(energy / 400) < 80, `missing silence gap at cue ${index}`);
  }
  // The placement limit (default 260 since kept clip sound; 65 here) still refuses one more.
  const capped = new LocalMediaService({ rootDir: service.rootDir, allowedInputRoots: [root], ffmpegPath: ffmpeg, ffprobePath: ffprobe, limits: { maxAudioPlacements: 65 } });
  await assert.rejects(capped.freezeManifest({ ...input, audio: [...audio, audio[0], audio[0]] }), code("MEDIA_INVALID_INPUT"));
  await assert.rejects(service.freezeManifest({ ...input, audio: audio.slice(0, 9).map(placement => ({ ...placement, atSample: 0 })) }), code("MEDIA_INVALID_INPUT"));
  const oneSource = new LocalMediaService({ rootDir: service.rootDir, allowedInputRoots: [root], ffmpegPath: ffmpeg, ffprobePath: ffprobe, limits: { maxAudioSources: 1 } });
  await assert.rejects(oneSource.freezeManifest(input), code("MEDIA_INVALID_INPUT"));
  await assert.rejects(oneSource.render(manifest), code("MEDIA_INVALID_INPUT"));
  const conflicting = await service.importMedia({ artifactId: sources[0].artifactId, path: join(root, "900.wav"), kind: "audio" });
  await assert.rejects(service.freezeManifest({ ...input, audio: [audio[0], { ...audio[1], source: conflicting }] }), code("MEDIA_INTEGRITY_ERROR"));
  await assert.rejects(service.freezeManifest({ ...input, audio: [{ ...audio[0], source: { ...sources[0], sha256: sources[1].sha256 } }] }), code("MEDIA_INTEGRITY_ERROR"));
});

test('64 individual voice placements plus music render through two chronological lanes with more than eight distinct sources', async t => {
  const root = await mkdtemp(join(tmpdir(), 'openslate-many-voices-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'picture.mp4');
  await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=30', '-frames:v', '192', '-an', '-c:v', 'libx264', '-threads', '1', path], { timeout: 10000 });
  const service = new LocalMediaService({ rootDir: join(root, 'store'), allowedInputRoots: [root], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const video = await service.importMedia({ artifactId: 'picture', path, kind: 'video' }), voices = [];
  for (let index = 0; index < 9; index++) {
    const path = join(root, `voice${index}.wav`);
    await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${500 + index * 100}:sample_rate=48000:duration=1`, '-c:a', 'pcm_s16le', path], { timeout: 10000 });
    voices.push(await service.importMedia({ artifactId: `voice${index}`, path, kind: 'audio' }));
  }
  const musicPath = join(root, 'music.wav');
  await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=100:sample_rate=48000:duration=6.4', '-c:a', 'pcm_s16le', musicPath], { timeout: 10000 });
  const music = await service.importMedia({ artifactId: 'music', path: musicPath, kind: 'audio' });
  const audio = Array.from({ length: 64 }, (_, index) => ({ source: voices[index % 9], startSample: 0, durationSamples: 4800, atSample: index * 4800, gainMilliDb: 0 }));
  audio.push({ source: music, startSample: 0, durationSamples: 307200, atSample: 0, gainMilliDb: -18000 });
  const manifest = await service.freezeManifest({ projectId: 'voices', targetRevisionId: '64-voices-and-music', width: 160, height: 90, clips: [{ source: video, startFrame: 0, durationFrames: 192, fit: 'contain' }], audio });
  assert.equal(manifest.audio.length, 65); assert.equal(new Set(manifest.audio.map(placement => placement.source.sha256)).size, 10);
  const rendered = await service.render(manifest); assert.equal(rendered.artifact.probe.video.frames, 192); assert.ok(rendered.artifact.probe.audio);
  const decoded = await execute(ffmpeg, ['-nostdin', '-v', 'error', '-i', rendered.artifact.path, '-map', '0:a:0', '-ac', '1', '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024, timeout: 10000 });
  const power = (start, frequency) => { let real = 0, imaginary = 0; for (let index = 0; index < 1600; index++) { const value = decoded.stdout.readInt16LE((start + index) * 2), angle = 2 * Math.PI * frequency * index / 48000; real += value * Math.cos(angle); imaginary += value * Math.sin(angle); } return real ** 2 + imaginary ** 2; };
  for (const index of [0, 8, 9, 31, 63]) { const frequency = 500 + (index % 9) * 100; assert.ok(power(index * 4800 + 1600, frequency) > power(index * 4800 + 1600, frequency + 50) * 10, `wrong voice at ${index}`); }
  const capped = new LocalMediaService({ rootDir: service.rootDir, allowedInputRoots: [root], ffmpegPath: ffmpeg, ffprobePath: ffprobe, limits: { maxAudioPlacements: 65 } });
  await assert.rejects(capped.freezeManifest({ projectId: 'voices', targetRevisionId: 'over-limit', width: 160, height: 90, clips: manifest.clips, audio: [...audio, audio[0]] }), code('MEDIA_INVALID_INPUT'));
  const placements = Array.from({ length: 260 }, (_, index) => ({ source: voices[index % 9], startSample: 0, durationSamples: 1000, atSample: index * 1100, gainMilliDb: 0 }));
  assert.equal((await service.freezeManifest({ projectId: 'voices', targetRevisionId: 'default-limit', width: 160, height: 90, clips: manifest.clips, audio: placements })).audio.length, 260);
  await assert.rejects(service.freezeManifest({ projectId: 'voices', targetRevisionId: 'default-over', width: 160, height: 90, clips: manifest.clips, audio: [...placements, placements[0]] }), code('MEDIA_INVALID_INPUT'));
});
