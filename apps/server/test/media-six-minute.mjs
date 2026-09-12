/** Optional acceptance workload: node apps/server/test/media-six-minute.mjs NEW_OUTPUT_DIRECTORY */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LocalMediaService } from "../dist/media/index.js";

const execute = promisify(execFile), destination = process.argv[2];
assert.ok(destination, "Provide a new output directory; this optional workload is not part of the default test suite");
const root = resolve(destination); await mkdir(root);
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const inputs = join(root, "inputs"); await mkdir(inputs);
const media = new LocalMediaService({ rootDir: join(root, "media"), allowedInputRoots: [inputs], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
const videos = [], recordings = [];
for (const [index, color] of ["red", "blue"].entries()) {
  const videoPath = join(inputs, `${color}.mp4`), audioPath = join(inputs, `${color}.wav`);
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=160x90:r=30:d=6`, "-an", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", videoPath], { timeout: 15000 });
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${index ? 900 : 600}:sample_rate=48000:duration=360`, "-c:a", "pcm_s16le", audioPath], { timeout: 15000 });
  videos.push(await media.importMedia({ artifactId: `${color}-video`, path: videoPath, kind: "video" }));
  recordings.push(await media.importMedia({ artifactId: `${color}-audio`, path: audioPath, kind: "audio" }));
}
const clips = Array.from({ length: 64 }, (_, index) => ({ source: videos[index % 2], startFrame: 0, durationFrames: index % 4 === 3 ? 168 : 169, fit: "contain" }));
const audio = Array.from({ length: 64 }, (_, index) => ({ source: recordings[index % 2], startSample: (63 - index) * 270000 + 4800, durationSamples: 264000, atSample: index * 270000, gainMilliDb: 0 }));
const manifest = await media.freezeManifest({ projectId: "six-minute-synthetic", targetRevisionId: "64-cuts-64-cues", width: 1280, height: 720, clips, audio });
assert.equal(manifest.totalFrames, 10800);
const abort = new AbortController();
let peakSampledRssKiB = 0, sampleCount = 0, samplePending = null, samplerError = null;
const sampleMemory = async () => {
  try {
    // Only numeric process IDs, parents and RSS are read; no commands, credentials or files.
    const { stdout } = await execute("/bin/ps", ["-axo", "pid=,ppid=,rss="], { timeout: 3000, maxBuffer: 2 * 1024 * 1024 });
    const rows = stdout.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number)).filter(row => row.length === 3 && row.every(Number.isFinite));
    const selected = new Set([process.pid]); let changed = true;
    while (changed) { changed = false; for (const [pid, parent] of rows) if (selected.has(parent) && !selected.has(pid)) { selected.add(pid); changed = true; } }
    const rss = rows.filter(([pid]) => selected.has(pid)).reduce((sum, row) => sum + row[2], 0);
    peakSampledRssKiB = Math.max(peakSampledRssKiB, rss); sampleCount++;
    if (rss > 1024 * 1024) abort.abort();
  } catch (error) { samplerError = error instanceof Error ? error.message : String(error); }
};
await sampleMemory();
assert.ok(sampleCount > 0 && samplerError === null, `Memory sampling is unavailable before render: ${samplerError ?? "no samples"}`);
const timer = setInterval(() => { if (!samplePending) samplePending = sampleMemory().finally(() => { samplePending = null; }); }, 100);
const timeout = setTimeout(() => abort.abort(), 180000), started = performance.now();
let result;
try { result = await media.render(manifest, { signal: abort.signal }); }
finally { clearInterval(timer); clearTimeout(timeout); if (samplePending) await samplePending; }
const renderElapsedMs = Math.round(performance.now() - started);
assert.ok(sampleCount > 0 && samplerError === null, `Memory sampling must succeed before making a resource claim: ${samplerError ?? "no samples"}`);
assert.equal(result.artifact.probe.video.frames, 10800); assert.equal(result.artifact.probe.video.width, 1280); assert.equal(result.artifact.probe.video.height, 720);
assert.equal(result.artifact.probe.audio.sampleRate, 48000);
const picture = await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", result.artifact.path, "-map", "0:v:0", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", timeout: 30000, maxBuffer: 128 * 1024 });
assert.equal(picture.stdout.length, 10800 * 3);
let frame = 0;
for (let index = 0; index < 64; index++) for (let offset = 0; offset < clips[index].durationFrames; offset++, frame++) {
  const red = picture.stdout[frame * 3], blue = picture.stdout[frame * 3 + 2];
  assert.ok(index % 2 ? blue > red + 100 : red > blue + 100, `wrong cut at frame ${frame}`);
}
const sound = await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", result.artifact.path, "-map", "0:a:0", "-ac", "1", "-f", "s16le", "-"], { encoding: "buffer", timeout: 30000, maxBuffer: 40 * 1024 * 1024 });
const sample = index => sound.stdout.readInt16LE(index * 2);
const power = (start, frequency) => {
  let real = 0, imaginary = 0;
  for (let index = 0; index < 800; index++) { const value = sample(start + index), angle = 2 * Math.PI * frequency * index / 48000; real += value * Math.cos(angle); imaginary += value * Math.sin(angle); }
  return real ** 2 + imaginary ** 2;
};
for (let index = 0; index < 64; index++) {
  const start = index * 270000, expected = index % 2 ? 900 : 600, other = index % 2 ? 600 : 900;
  assert.ok(power(start + 48000, expected) > power(start + 48000, other) * 10, `wrong audio source at cue ${index}`);
  let energy = 0; for (let offset = 267000; offset < 268000; offset++) energy += sample(start + offset) ** 2;
  assert.ok(Math.sqrt(energy / 1000) < 80, `missing intentional silence at cue ${index}`);
}
const report = {
  kind: "synthetic_local_media_acceptance", capturedAt: new Date().toISOString(), apiCalls: 0,
  geometry: "1280x720", frames: 10800, durationSeconds: 360, frameRate: "30/1", sampleRate: 48000,
  clips: 64, audioPlacements: 64, distinctAudioInputs: 2, simultaneousAudioLanes: 1, sourceRangeOrder: "descending within six-minute recordings",
  manifestDigest: manifest.digest, output: result.artifact.path, outputSha256: result.artifact.sha256, outputBytes: result.artifact.byteLength,
  checks: { allPictureFramesAndCuts: true, all64CueSourceOrders: true, all64IntentionalSilenceGaps: true, fullDecode: true },
  renderElapsedMs, peakSampledProcessTreeRssKiB: peakSampledRssKiB, memorySamples: sampleCount, samplingIntervalMs: 100,
  resourceScope: "Render/validate/install phase; RSS sampled for this Node process and descendants, including sampler overhead. Approximate observed peak, not a memory guarantee.",
  limitations: ["Synthetic repeated-color clips and sine tones, not generated commercial footage", "Local media layer only; application authority and canonical narration integration covered by separate tests", "No H3/image/speech APIs", "One local machine and toolchain; not a production throughput benchmark"],
};
await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
