import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalMediaService } from "../dist/media/local-media.js";
import { inspectPcmWave } from "../dist/media/pcm-wave.js";
import { assertTranscriptionAudioCapacity, assertTranscriptionAudioMeasurement } from "../dist/media/transcription-audio-types.js";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const hash = value => createHash("sha256").update(value).digest("hex");
function wav(samples, pattern = "tones") {
  const bytes = Buffer.alloc(44 + samples * 4); bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(192000, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 4, 40);
  for (let i = 4800; i < samples - 4800; i++) {
    const left = Math.round(12000 * Math.sin(2 * Math.PI * 1000 * i / 48000));
    const right = pattern === "cancel" ? -left : Math.round(8000 * Math.sin(2 * Math.PI * 2000 * i / 48000));
    bytes.writeInt16LE(pattern === "impulse" ? (i === 24000 ? 24000 : 0) : left, 44 + i * 4);
    bytes.writeInt16LE(pattern === "impulse" ? 0 : right, 46 + i * 4);
  }
  return bytes;
}
async function fixture(t, { samples = 48000, pattern, limits } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "openslate-transcription-worker-")), inputs = join(dir, "inputs"), rootDir = join(dir, "media");
  await mkdir(inputs); const path = join(inputs, "source.wav"), bytes = wav(samples, pattern); writeFileSync(path, bytes);
  const media = new LocalMediaService({ rootDir, allowedInputRoots: [inputs], ffmpegPath, ffprobePath, ...(limits ? { limits } : {}) });
  const source = await media.importMedia({ artifactId: "owned-source", path, kind: "audio" });
  const verified = await media.verifiedSource(source), recipe = await media.describeTranscriptionAudio();
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, inputs, rootDir, media, source, recipe, sourcePath: verified.path, sourceBytes: readFileSync(verified.path) };
}
async function convert(f, override = {}) {
  let captured, temporaryPath;
  const measured = await f.media.deriveTranscriptionAudio({ source: f.source, recipe: f.recipe }, {
    signal: new AbortController().signal, assertCanStart() {}, async persistCompletion(value, path) {
      temporaryPath = path; captured = await readFile(path); assert.equal(hash(captured), value.sha256);
      assert.throws(() => { value.sampleCount = 1; }, TypeError);
    }, ...override,
  });
  assert.equal(existsSync(temporaryPath), false); assert.equal("path" in measured, false);
  return { measured, bytes: captured };
}
function pcm(bytes) {
  const offset = bytes.indexOf(Buffer.from("data")) + 8;
  return Array.from({ length: (bytes.length - offset) / 2 }, (_, i) => bytes.readInt16LE(offset + i * 2));
}

for (const samples of [48000, 48001, 48002, 48007]) test(`complete ${samples}-sample source preserves silence and measured nondivisible endpoint`, async t => {
  const f = await fixture(t, { samples }), before = JSON.stringify(f.source), sources = await readdir(join(f.rootDir, "sources"));
  const { measured, bytes } = await convert(f); assert.equal(measured.sampleRate, 16000); assert.equal(measured.channels, 1);
  assert.equal(measured.endDelta48kSamples, measured.sampleCount * 3 - samples); assert.ok(Math.abs(measured.endDelta48kSamples) <= 3);
  const values = pcm(bytes); assert.ok(values.slice(0, 1500).every(v => v === 0)); assert.ok(values.slice(-1500).every(v => v === 0));
  const amplitude = frequency => { let real = 0, imaginary = 0; const count = 3200;
    for (let i = 0; i < count; i++) { const angle = 2 * Math.PI * frequency * i / 16000; real += values[3200 + i] * Math.cos(angle); imaginary += values[3200 + i] * Math.sin(angle); }
    return 2 * Math.sqrt(real ** 2 + imaginary ** 2) / count;
  };
  assert.ok(Math.abs(amplitude(1000) - 6000) < 40, "left channel has exactly half gain");
  assert.ok(Math.abs(amplitude(2000) - 4000) < 40, "right channel has exactly half gain");
  assert.deepEqual(readFileSync(f.sourcePath), f.sourceBytes); assert.equal(JSON.stringify(f.source), before);
  assert.deepEqual(await readdir(join(f.rootDir, "sources")), sources, "derivative is not a new SuppliedMedia");
  await assert.rejects(f.media.probe(f.sourcePath), { code: "MEDIA_PATH_REJECTED" }, "external root allowlist remains unchanged");
});

test("opposite channels cancel exactly and a centered impulse retains its source time origin", async t => {
  const cancel = await fixture(t, { pattern: "cancel" }); assert.ok(pcm((await convert(cancel)).bytes).every(value => value === 0));
  const impulse = await fixture(t, { pattern: "impulse" }), values = pcm((await convert(impulse)).bytes);
  const peak = values.reduce((best, value, i) => Math.abs(value) > Math.abs(values[best]) ? i : best, 0);
  assert.equal(peak, 8000); assert.ok(Math.abs(values[peak]) > 3000);
});

test("exact configured duration fits, including the pure six-minute bound, and smaller output caps reject before subprocesses", async t => {
  const f = await fixture(t, { limits: { maxDurationFrames: 30 } }); assert.equal((await convert(f)).measured.sampleCount, 16000);
  assert.doesNotThrow(() => assertTranscriptionAudioCapacity(17280000, { ...f.recipe, maxSourceSamples: 17280000, maxOutputSamples: 5760000 }));
  const blocked = new LocalMediaService({ rootDir: f.rootDir, allowedInputRoots: [f.inputs], ffmpegPath, ffprobePath, limits: { maxOutputBytes: 32000 + 44 - 400 } });
  const recipe = await blocked.describeTranscriptionAudio(); let calls = 0;
  blocked.run = async () => { calls++; throw Error("no subprocess"); };
  await assert.rejects(blocked.deriveTranscriptionAudio({ source: f.source, recipe }, { signal: new AbortController().signal, assertCanStart() {}, async persistCompletion() { throw Error("no publication"); } }), { code: "TRANSCRIPTION_AUDIO_OUTPUT_LIMIT" });
  assert.equal(calls, 0);
});

test("the original signal and source/recipe/callback snapshots remain authoritative after caller mutation", async t => {
  const f = await fixture(t), controller = new AbortController(); let originalGuard = 0, originalSink = 0;
  const input = structuredClone({ source: f.source, recipe: f.recipe }), options = { signal: controller.signal,
    assertCanStart() { originalGuard++; }, async persistCompletion() { originalSink++; } };
  const pending = f.media.deriveTranscriptionAudio(input, options);
  input.source.sha256 = "0".repeat(64); input.recipe.toolchainDigest = "0".repeat(64);
  options.assertCanStart = () => { throw Error("replacement guard"); }; options.persistCompletion = async () => { throw Error("replacement sink"); };
  const measured = await pending; assert.equal(measured.sampleCount, 16000); assert.equal(originalGuard, 3); assert.equal(originalSink, 1);
  const cancelling = { source: f.source, recipe: f.recipe }, cancelOptions = { signal: controller.signal, assertCanStart() {}, async persistCompletion() { throw Error("no cancelled publication"); } };
  const cancelled = f.media.deriveTranscriptionAudio(cancelling, cancelOptions); cancelOptions.signal = new AbortController().signal; controller.abort();
  await assert.rejects(cancelled, { code: "MEDIA_CANCELLED" }); assert.deepEqual(await readdir(join(f.rootDir, "tmp")), []);
});

test("the worker retains its slot and temporary bytes through asynchronous durable completion, including cancellation", async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers(), controller = new AbortController(); let capturedPath, saved;
  const pending = f.media.deriveTranscriptionAudio({ source: f.source, recipe: f.recipe }, { signal: controller.signal, assertCanStart() {},
    async persistCompletion(value, path) { capturedPath = path; saved = value; entered.resolve(); await release.promise; assert.ok(existsSync(path)); } });
  await entered.promise;
  await assert.rejects(f.media.describeAudioNormalization(), { code: "MEDIA_BUSY" }); assert.ok(existsSync(capturedPath));
  controller.abort(); await assert.rejects(f.media.describeTranscriptionAudio(), { code: "MEDIA_BUSY" });
  release.resolve(); await assert.rejects(pending, { code: "MEDIA_CANCELLED" }); assert.equal(saved.sampleCount, 16000);
  assert.equal(existsSync(capturedPath), false); await f.media.describeTranscriptionAudio();
});

test("cancellation during final temporary cleanup cannot report success but does not undo persisted completion", async t => {
  const f = await fixture(t), controller = new AbortController(); let persisted = false, temporaryPath;
  const signal = { get aborted() { if (persisted && temporaryPath && !existsSync(temporaryPath)) controller.abort(); return controller.signal.aborted; },
    addEventListener: (...args) => controller.signal.addEventListener(...args), removeEventListener: (...args) => controller.signal.removeEventListener(...args) };
  await assert.rejects(f.media.deriveTranscriptionAudio({ source: f.source, recipe: f.recipe }, { signal, assertCanStart() {},
    async persistCompletion(value, path) { temporaryPath = path; persisted = value.sampleCount === 16000; } }), { code: "MEDIA_CANCELLED" });
  assert.equal(persisted, true); assert.deepEqual(await readdir(join(f.rootDir, "tmp")), []);
});

test("changed recipe, changed owned bytes and a revoked start guard cannot run conversion", async t => {
  const f = await fixture(t); let calls = 0; const run = f.media.run.bind(f.media);
  f.media.run = async (...args) => { calls++; return run(...args); };
  const options = { signal: new AbortController().signal, assertCanStart() {}, async persistCompletion() { throw Error("no completion"); } };
  await assert.rejects(f.media.deriveTranscriptionAudio({ source: f.source, recipe: { ...f.recipe, toolchainDigest: "0".repeat(64) } }, options), { code: "TRANSCRIPTION_AUDIO_RECIPE_CHANGED" });
  assert.equal(calls, 0);
  await assert.rejects(f.media.deriveTranscriptionAudio({ source: f.source, recipe: f.recipe }, { ...options, assertCanStart() { throw Error("lease revoked"); } }), /lease revoked/);
  assert.equal(calls, 0);
  chmodSync(f.sourcePath, 0o600); writeFileSync(f.sourcePath, Buffer.alloc(f.source.byteLength));
  await assert.rejects(f.media.deriveTranscriptionAudio({ source: f.source, recipe: f.recipe }, options), { code: "MEDIA_INTEGRITY_ERROR" }); assert.equal(calls, 0);
});

test("measured endpoint failure reaches the durable sink before rejection", async t => {
  const f = await fixture(t), run = f.media.run.bind(f.media); let saved;
  f.media.run = async (...args) => {
    const result = await run(...args);
    const path = args[1].at(-1);
    if (typeof path === "string" && path.endsWith("transcription.wav")) {
      const bytes = readFileSync(path), shorter = Buffer.from(bytes.subarray(0, bytes.length - 100));
      shorter.writeUInt32LE(shorter.length - 8, 4); const offset = shorter.indexOf(Buffer.from("data")); shorter.writeUInt32LE(shorter.length - offset - 8, offset + 4); writeFileSync(path, shorter);
    }
    return result;
  };
  await assert.rejects(convert(f, { async persistCompletion(value, path) { saved = value; assert.equal(hash(readFileSync(path)), value.sha256); } }), { code: "TRANSCRIPTION_AUDIO_ENDPOINT_MISMATCH" });
  assert.equal(saved.sampleCount, 15950); assert.equal(saved.endDelta48kSamples, -150);
  assert.doesNotThrow(() => assertTranscriptionAudioMeasurement(saved, 48000, f.recipe, false));
  assert.throws(() => assertTranscriptionAudioMeasurement(saved, 48000, f.recipe), { code: "TRANSCRIPTION_AUDIO_ENDPOINT_MISMATCH" });
});

test("version probes and fixed subprocesses use the effective120-second maximum without changing worker limits", async t => {
  const f = await fixture(t), media = new LocalMediaService({ rootDir: f.rootDir, allowedInputRoots: [f.inputs], ffmpegPath, ffprobePath, limits: { timeoutMs: 600000, maxOutputBytes: 512 * 1024 * 1024 } });
  const run = media.run.bind(media), calls = [];
  media.run = async (...args) => { calls.push(args); return run(...args); };
  const recipe = await media.describeTranscriptionAudio(); assert.equal(recipe.timeoutMs, 120000); assert.equal(recipe.maxOutputBytes, 25000000);
  await media.deriveTranscriptionAudio({ source: f.source, recipe }, { signal: new AbortController().signal, assertCanStart() {}, async persistCompletion() {} });
  assert.equal(media.limits.timeoutMs, 600000); assert.equal(media.limits.maxOutputBytes, 512 * 1024 * 1024);
  assert.ok(calls.length >= 4); assert.ok(calls.every(args => args[3] === 120000));
});

test("changed effective limits reject before even copying owned source bytes", async t => {
  const f = await fixture(t); let copies = 0;
  f.media.snapshotOwnedAudio = async () => { copies++; throw Error("source should not be copied"); };
  const recipe = { ...f.recipe, maxInputBytes: f.recipe.maxInputBytes + 1024 };
  await assert.rejects(f.media.deriveTranscriptionAudio({ source: f.source, recipe }, { signal: new AbortController().signal, assertCanStart() {}, async persistCompletion() {} }), { code: "TRANSCRIPTION_AUDIO_RECIPE_CHANGED" });
  assert.equal(copies, 0);
});

test("completed decode reaches the trusted sink after late abort without claiming durable publication", async t => {
  const f = await fixture(t), controller = new AbortController(), run = f.media.run.bind(f.media); let saved = null;
  f.media.run = async (...args) => { const result = await run(...args); if (args[1].at(-1) === "-") controller.abort(); return result; };
  await assert.rejects(f.media.deriveTranscriptionAudio({ source: f.source, recipe: f.recipe }, { signal: controller.signal, assertCanStart() {},
    async persistCompletion(value, path) { saved = value; assert.ok(existsSync(path)); } }), { code: "MEDIA_CANCELLED" });
  assert.equal(saved.sampleCount, 16000); assert.deepEqual(await readdir(join(f.rootDir, "tmp")), []);
});

test("recipe inspection retains its original signal through the final asynchronous return", async t => {
  const f = await fixture(t), controller = new AbortController(), options = { signal: controller.signal };
  const pending = f.media.describeTranscriptionAudio(options); options.signal = new AbortController().signal; controller.abort();
  await assert.rejects(pending, { code: "MEDIA_CANCELLED" });
});
