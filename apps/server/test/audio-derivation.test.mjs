import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePlan, DEFAULT_PROFILES, digest } from "../../../packages/core/dist/index.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { SpoolAudioIngestor } from "../dist/execution/spool-audio-ingester.js";
import { audioDerivationId, assertAudioNormalizationCapacity } from "../dist/execution/audio-derivation.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { inspectPcmWave, GENERATED_AUDIO_SAMPLE_RATES } from "../dist/media/pcm-wave.js";
import { projectFixture } from "./execution-fixture.mjs";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const hash = b => createHash("sha256").update(b).digest("hex");
function wav(rate = 48000, channels = 2, samples = rate) {
  const b = Buffer.alloc(44 + samples * channels * 2);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples * channels * 2, 40);
  // Exact initial silence; channel-distinct tones; a nonzero tail prevents accepting a shortened prefix.
  for (let i = Math.floor(samples / 4); i < samples; i++) for (let c = 0; c < channels; c++) b.writeInt16LE(Math.round(10000 * Math.sin(i * (c + 1) * 0.11)), 44 + (i * channels + c) * 2);
  return b;
}
async function fixture(t, { bytes = wav(), limits } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "openslate-audio-derivation-")), store = new Store(join(dir, "store.sqlite"));
  const provider = new FakeProvider(join(dir, "fake.sqlite")), artifactDir = join(dir, "artifacts");
  const outputs = new ExecutionOutputStore(store, { rootDir: join(dir, "outputs") });
  const media = new LocalMediaService({ rootDir: join(dir, "media"), allowedInputRoots: [outputs.rootDir], ffmpegPath, ffprobePath, ...(limits ? { limits } : {}) });
  const ingester = new SpoolAudioIngestor(outputs, media, { rootDir: join(dir, "audio-derivations") });
  const engine = new Engine(store, provider, { artifactDir, outputStore: outputs, outputIngestor: ingester });
  const project = projectFixture(randomUUID(), 0); store.createProject(project);
  const plan = compilePlan(`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{const s=p.speech("voice",{profile:"fake-speech-v1",text:"A complete generated audio fixture",voice:"demo"});return[s];});`,
    { project, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: randomUUID });
  const grant = engine.createGrant(project.id, project.id, "speech", "human-test", "initial_slot"), planId = randomUUID();
  store.transaction(() => { engine.installPlan(project.id, planId, plan, { [plan.nodes[0].id]: grant.id }); store.saveProject({ ...project, activePlanId: planId }, 0); });
  const calls = { submit: 0, normalize: 0, recipe: 0 };
  const normalize = media.importMedia.bind(media), recipe = media.describeAudioNormalization.bind(media);
  media.importMedia = async (...args) => { calls.normalize++; assert.equal(store.list("audio_derivation_intent", project.id).length, 1); return normalize(...args); };
  media.describeAudioNormalization = async (...args) => { calls.recipe++; return recipe(...args); };
  provider.submit = async request => {
    calls.submit++; const receipt = outputs.recordReceipt(project.id, { attemptId: request.attemptId, expectedRequestDigest: digest(request), port: "audio", kind: "audio", mimeType: "audio/wav",
      vendorTaskId: null, diagnosticRequestId: null, source: { kind: "returned_bytes", sha256: hash(bytes), byteLength: bytes.length } });
    await outputs.spool(project.id, receipt.id, async function* () { yield bytes; }); return outputs.recoverCompletion(project.id, request.attemptId);
  };
  provider.lookup = provider.poll = async () => { throw Error("No native or provider recovery calls permitted"); };
  t.after(() => { if (store.db.open) store.close(); if (provider.db.open) provider.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, provider, outputs, media, ingester, engine, project, artifactDir, calls, bytes };
}
const attempt = f => f.engine.attempts(f.project.id)[0];
const index = f => join(f.ingester.rootDir, "completions", `${audioDerivationId(f.project.id, attempt(f).id)}.json`);
const result = f => f.store.list("audio_derivation_receipt", f.project.id)[0];
function expire(f) { const a = attempt(f); f.store.put("attempt", a.id, f.project.id, { ...a, leaseExpiresAt: 0 }); }
function unresolved(f) { assert.equal(attempt(f).phase, "ingesting"); assert.equal(f.store.list("artifact", f.project.id).length, 0); assert.equal(f.store.list("media_source", f.project.id).length, 0); }

for (const rate of GENERATED_AUDIO_SAMPLE_RATES) test(`complete PCM16 ${rate} Hz stereo preserves odd-sample endpoint and silence`, async t => {
  const count = rate + 7, f = await fixture(t, { bytes: wav(rate, 2, count) }); await f.engine.runReady();
  assert.equal(attempt(f).phase, "succeeded"); const receipt = result(f), intent = f.store.list("audio_derivation_intent", f.project.id)[0];
  assert.deepEqual(intent.rawPcm, { sampleRate: rate, channels: 2, sampleCount: count, bitsPerSample: 16 });
  assert.equal(receipt.source.originalSha256, hash(f.bytes)); assert.notEqual(receipt.source.sha256, hash(f.bytes));
  assert.equal(receipt.endpointDeltaNumerator, receipt.normalizedSamples * rate - count * 48000);
  assert.ok(Math.abs(receipt.endpointDeltaNumerator) <= (rate === 48000 ? 0 : rate));
  const record = f.store.list("artifact", f.project.id)[0], bytes = readFileSync(record.path), data = bytes.indexOf(Buffer.from("data")) + 8;
  assert.equal(record.origin, "generated_audio"); assert.equal(record.fixture, false); assert.equal(record.attemptId, attempt(f).id);
  assert.equal(record.physicalDurationSeconds, receipt.normalizedSamples / 48000);
  assert.ok(bytes.subarray(data, data + 100).every(v => v === 0), "source silence is retained");
  assert.ok(bytes.subarray(-200).some(v => v !== 0), "complete nonzero tail is retained");
  if (rate === 48000) assert.deepEqual(bytes.subarray(data), f.bytes.subarray(44), "equal-rate stereo PCM samples are byte exact");
  assert.deepEqual(f.calls, { submit: 1, normalize: 1, recipe: 1 });
});

test("exact configured endpoint accepts resampling; full six-minute geometry fits the default cap", async t => {
  assert.doesNotThrow(() => assertAudioNormalizationCapacity({ rawPcm: { sampleRate: 24000, sampleCount: 24000 * 360 }, normalization: { maxSamples: 48000 * 360, maxOutputBytes: 256 * 1024 * 1024 } }));
  const f = await fixture(t, { bytes: wav(24000, 1, 24000), limits: { maxDurationFrames: 30 } }); await f.engine.runReady();
  assert.equal(result(f).normalizedSamples, 48000); assert.equal(result(f).endpointDeltaNumerator, 0);
});

test("lowered output cap cannot silently accept less than 0.1 seconds of missing PCM", async t => {
  const f = await fixture(t, { bytes: wav(48000, 2), limits: { maxOutputBytes: 48000 * 4 + 44 - 4000 } });
  await assert.rejects(f.engine.runReady(), { code: "AUDIO_NORMALIZATION_OUTPUT_LIMIT" }); unresolved(f);
  assert.equal(f.calls.normalize, 0); assert.equal(f.store.list("execution_output_spool", f.project.id).length, 1);
  assert.equal(f.store.list("audio_derivation_intent", f.project.id).length, 0);
});

test("actual shared-worker cap and timeout cannot exceed generated audio bounds", async t => {
  const f = await fixture(t);
  for (const limits of [{ maxOutputBytes: 512 * 1024 * 1024 }, { timeoutMs: 120001 }]) {
    const media = new LocalMediaService({ rootDir: join(f.dir, randomUUID()), allowedInputRoots: [f.outputs.rootDir], ffmpegPath, ffprobePath, limits });
    assert.throws(() => new SpoolAudioIngestor(f.outputs, media, { rootDir: join(f.dir, randomUUID()) }), { code: "AUDIO_DERIVATION_CONFIGURATION" });
  }
});

test("completed normalized audio survives SQL publication failure and recovers without probing or converting again", async t => {
  const f = await fixture(t), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "audio_derivation_receipt") throw Error("SQL interruption"); return insert(...args); };
  await assert.rejects(f.engine.runReady(), /SQL interruption/); f.store.insert = insert; unresolved(f); assert.ok(existsSync(index(f)));
  f.media.importMedia = f.media.describeAudioNormalization = async () => { throw Error("must not regenerate or probe the current recipe"); };
  expire(f); await f.engine.reconcile(); assert.equal(attempt(f).phase, "succeeded"); assert.equal(result(f).normalizedSamples, 48000);
  assert.deepEqual(f.calls, { submit: 1, normalize: 1, recipe: 1 });
});

test("incomplete normalization keeps its recipe pinned and completed PCM corruption cannot rerun it", async t => {
  const f = await fixture(t), original = f.media.importMedia;
  f.media.importMedia = async () => { throw Error("conversion not started"); };
  await assert.rejects(f.engine.runReady(), /conversion not started/); unresolved(f);
  const intent = f.store.list("audio_derivation_intent", f.project.id)[0];
  f.media.describeAudioNormalization = async () => ({ ...intent.normalization, toolchainDigest: "0".repeat(64) });
  expire(f); await assert.rejects(f.engine.reconcile(), { code: "AUDIO_DERIVATION_RECIPE_CHANGED" });
  f.media.describeAudioNormalization = async () => intent.normalization; f.media.importMedia = original;
  const write = f.ingester.writeIndex.bind(f.ingester);
  f.ingester.writeIndex = async receipt => { await write(receipt); throw Error("after completion"); };
  expire(f); await assert.rejects(f.engine.reconcile(), /after completion/);
  const receipt = JSON.parse(readFileSync(index(f), "utf8")), verified = await f.media.verifiedSource(receipt.source);
  chmodSync(verified.path, 0o600); writeFileSync(verified.path, Buffer.alloc(receipt.source.byteLength));
  expire(f); await assert.rejects(f.engine.reconcile()); unresolved(f); assert.equal(f.calls.normalize, 1);
});

test("lease loss at completion retains exact bytes while blocking the old worker", async t => {
  const f = await fixture(t), write = f.ingester.writeIndex.bind(f.ingester);
  f.ingester.writeIndex = async receipt => { await write(receipt); const a = attempt(f); f.store.put("attempt", a.id, f.project.id, { ...a, leaseOwner: "replacement", leaseEpoch: a.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 }); };
  await assert.rejects(f.engine.runReady(), { code: "AUDIO_DERIVATION_LEASE_LOST" }); unresolved(f); assert.ok(existsSync(index(f)));
  f.ingester.writeIndex = write; expire(f); await f.engine.reconcile(); assert.equal(attempt(f).phase, "succeeded"); assert.equal(f.calls.normalize, 1);
});

test("a measured shortened endpoint is durable rejected evidence, never repeat conversion permission", async t => {
  const f = await fixture(t), normalize = f.media.importMedia.bind(f.media);
  f.media.importMedia = async (...args) => {
    const source = await normalize(...args), verified = await f.media.verifiedSource(source), bytes = readFileSync(verified.path);
    // Simulate a worker returning a complete WAV prefix accepted by the human importer's old 0.1s tolerance.
    const shorter = Buffer.from(bytes.subarray(0, bytes.length - 400)); shorter.writeUInt32LE(shorter.length - 8, 4);
    const data = shorter.indexOf(Buffer.from("data")); shorter.writeUInt32LE(shorter.length - data - 8, data + 4);
    const path = join(f.dir, "shorter.wav"); writeFileSync(path, shorter);
    const samples = 47900, probe = { ...source.probe, durationSeconds: samples / 48000, audio: { ...source.probe.audio, samples, durationSeconds: samples / 48000 } };
    const body = { ...source, sha256: hash(shorter), byteLength: shorter.length, probe }; delete body.id;
    const changed = { ...body, id: digest(body) };
    f.media.verifiedSource = async () => ({ source: changed, path }); return changed;
  };
  await assert.rejects(f.engine.runReady(), { code: "AUDIO_PCM_ENDPOINT_MISMATCH" }); unresolved(f); assert.ok(existsSync(index(f)));
  expire(f); await assert.rejects(f.engine.reconcile(), { code: "AUDIO_PCM_ENDPOINT_MISMATCH" }); assert.equal(f.calls.normalize, 1);
});

test("strict WAV parser rejects malformed geometry, high-bit aliases, incomplete framing and oversized headers before conversion", async t => {
  const dir = mkdtempSync(join(tmpdir(), "openslate-pcm-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cases = [];
  const high = wav(); high[0] |= 128; cases.push(high);
  const highData = wav(); highData[36] |= 128; cases.push(highData);
  const compressed = wav(); compressed.writeUInt16LE(3, 20); cases.push(compressed);
  const unsupported = wav(); unsupported.writeUInt32LE(12345, 24); unsupported.writeUInt32LE(49380, 28); cases.push(unsupported);
  const truncated = wav().subarray(0, 100); cases.push(truncated);
  const misaligned = Buffer.from(wav().subarray(0, 100)); misaligned.writeUInt32LE(92, 4); misaligned.writeUInt32LE(55, 40); cases.push(misaligned);
  const duplicate = Buffer.concat([wav(), Buffer.from("data\x04\x00\x00\x00abcd", "latin1")]); duplicate.writeUInt32LE(duplicate.length - 8, 4); cases.push(duplicate);
  const huge = Buffer.concat([wav(), Buffer.alloc(65536)]); const end = wav().length; huge.write("JUNK", end); huge.writeUInt32LE(65528, end + 4); huge.writeUInt32LE(huge.length - 8, 4); cases.push(huge);
  for (const [i, bytes] of cases.entries()) { const path = join(dir, `${i}.wav`); writeFileSync(path, bytes); await assert.rejects(inspectPcmWave(path, 32 * 1024 * 1024), error => error.code?.startsWith("AUDIO_PCM_")); }
  const f = await fixture(t, { bytes: high }); await assert.rejects(f.engine.runReady(), { code: "AUDIO_PCM_INVALID" }); unresolved(f);
  assert.equal(f.calls.normalize, 0); assert.equal(f.calls.recipe, 0); assert.equal(f.store.list("execution_output_spool", f.project.id).length, 1);
});

test("original signal and frozen caller identity survive replacement during raw resolution", async t => {
  const f = await fixture(t), controller = new AbortController();
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputs, outputIngestor: { ingest(input) {
    const supplied = { ...input, attempt: structuredClone(input.attempt), output: structuredClone(input.output), signal: controller.signal };
    const pending = f.ingester.ingest(supplied);
    supplied.signal = new AbortController().signal; supplied.attempt.request.args.text = "mutated"; supplied.output.sha256 = "0".repeat(64);
    controller.abort(); return pending;
  } } });
  await assert.rejects(engine.runReady(), { code: "OUTPUT_STORE_CANCELLED" }); unresolved(f); assert.equal(f.calls.normalize, 0); assert.equal(f.calls.recipe, 0);
  expire(f); await f.engine.reconcile(); assert.equal(attempt(f).phase, "succeeded"); assert.equal(f.calls.submit, 1);
});

test("late original cancellation preserves the durable completion without publishing a selected artifact", async t => {
  const f = await fixture(t), controller = new AbortController(), write = f.ingester.writeIndex.bind(f.ingester);
  f.ingester.writeIndex = async receipt => { await write(receipt); controller.abort(); };
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputs,
    outputIngestor: { ingest(input) { return f.ingester.ingest({ ...input, signal: controller.signal }); } } });
  await assert.rejects(engine.runReady(), { code: "MEDIA_CANCELLED" }); unresolved(f); assert.ok(existsSync(index(f)));
  f.ingester.writeIndex = write; expire(f); await f.engine.reconcile(); assert.equal(attempt(f).phase, "succeeded"); assert.equal(f.calls.normalize, 1);
});

test("a busy shared converter defers paid raw audio and recovers it without another provider submission", async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const operation = f.media.exclusive(async () => { entered.resolve(); await release.promise; }); await entered.promise;
  try { await f.engine.runReady(); unresolved(f); assert.equal(f.calls.normalize, 0); assert.equal(attempt(f).leaseExpiresAt, 0); }
  finally { release.resolve(); await operation; }
  await f.engine.reconcile(); assert.equal(attempt(f).phase, "succeeded"); assert.equal(f.calls.submit, 1); assert.equal(f.calls.normalize, 1);
});

test("malformed or null completion metadata never becomes an absent completion or raw TypeError", async t => {
  for (const content of ["null", "{"]) {
    const f = await fixture(t), write = f.ingester.writeIndex.bind(f.ingester);
    f.ingester.writeIndex = async receipt => { await write(receipt); throw Error("interrupted after index"); };
    await assert.rejects(f.engine.runReady(), /interrupted after index/);
    chmodSync(index(f), 0o600); writeFileSync(index(f), content);
    expire(f); await assert.rejects(f.engine.reconcile(), { code: "AUDIO_DERIVATION_CORRUPT" }); unresolved(f); assert.equal(f.calls.normalize, 1);
    assert.equal(readFileSync(index(f), "utf8"), content);
  }
});
