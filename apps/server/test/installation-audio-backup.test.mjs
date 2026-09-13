import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { createInstallationBackup, inspectInstallationBackup, installationBackupFileKind } from "../dist/persistence/installation-backup.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { audioArtifactId, audioDerivationId } from "../dist/execution/audio-derivation.js";
import { projectFixture } from "./execution-fixture.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function wav(rate, channels, samples) {
  const bytes = Buffer.alloc(44 + samples * channels * 2); bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
}
function clean(path) {
  if (!existsSync(path)) return;
  if (lstatSync(path).isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) clean(join(path, name)); }
  rmSync(path, { recursive: true, force: true });
}
function write(root, name, bytes) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { mode: 0o600 }); return path; }
async function fixture(t, samples = 48000) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "openslate-audio-backup-"))), sourceRoot = join(root, "source"), destination = join(root, "backup");
  mkdirSync(sourceRoot); const store = new Store(join(sourceRoot, "openslate.sqlite")), fake = new FakeProvider(join(sourceRoot, "fake-provider.sqlite"));
  t.after(() => { if (store.db.open) store.close(); if (fake.db.open) fake.close(); clean(root); });
  const project = projectFixture(randomUUID(), 0); store.createProject(project);
  const request = { kind: "speech", attemptId: "speech-attempt", nodeId: "voice", args: { text: "Synthetic recording", voice: "demo", instructions: "" } };
  store.insert("attempt", request.attemptId, project.id, { candidateId: null, workKey: "audio-fixture", ordinal: 1, request, taskId: null });
  const output = new ExecutionOutputStore(store, { rootDir: join(sourceRoot, "execution-output") });
  const raw = wav(24000, 1, 24000), normalized = wav(48000, 2, samples);
  const rawReceipt = output.recordReceipt(project.id, { attemptId: request.attemptId, expectedRequestDigest: digest(request), port: "audio", kind: "audio",
    mimeType: "audio/wav", vendorTaskId: null, diagnosticRequestId: "synthetic-request-id", source: { kind: "returned_bytes", sha256: sha(raw), byteLength: raw.length } });
  const spool = await output.spool(project.id, rawReceipt.id, async function* () { yield raw; });
  const id = audioDerivationId(project.id, request.attemptId), artifactId = audioArtifactId(id);
  const intent = store.insert("audio_derivation_intent", id, project.id, { version: 1, attemptId: request.attemptId, requestDigest: digest(request),
    slotId: digest({ projectId: project.id, attemptId: request.attemptId, port: "audio" }), spoolId: spool.id, rawSha256: sha(raw), rawByteLength: raw.length,
    artifactId, recipe: "generated-audio-v1", rawPcm: { sampleRate: 24000, channels: 1, sampleCount: 24000, bitsPerSample: 16 }, normalization: {
      version: 1, recipe: "pcm-s16le-48khz-stereo-v1", toolchainDigest: "a".repeat(64), maxInputBytes: 32 * 1024 ** 2,
      maxOutputBytes: 256 * 1024 ** 2, maxSamples: 48000 * 360, timeoutMs: 120000 } });
  const sourceBody = { artifactId, kind: "audio", originalSha256: sha(raw), originalByteLength: raw.length, sha256: sha(normalized), byteLength: normalized.length,
    probe: { durationSeconds: samples / 48000, audio: { streamIndex: 0, sampleRate: 48000, channels: 2, samples,
      durationSeconds: samples / 48000, codec: "pcm_s16le" } }, toolchainDigest: intent.normalization.toolchainDigest };
  const source = { id: digest(sourceBody), ...sourceBody };
  write(sourceRoot, `media/blobs/${sha(raw)}.source`, raw); write(sourceRoot, `media/blobs/${sha(normalized)}.wav`, normalized);
  write(sourceRoot, `media/sources/${source.id}.json`, canonical(source));
  const receipt = { id, version: 1, projectId: project.id, attemptId: request.attemptId, intentDigest: digest(intent), source,
    normalizedSamples: samples, endpointDeltaNumerator: samples * 24000 - 24000 * 48000 };
  const completionPath = `audio-derivations/completions/${id}.json`; write(sourceRoot, completionPath, canonical(receipt));
  const publish = () => store.transaction(() => {
    const path = write(sourceRoot, `artifacts/${project.id}/${sha(normalized)}.wav`, normalized);
    const artifact = { id: artifactId, projectId: project.id, attemptId: request.attemptId, artifact: { artifactId, kind: "audio", sha256: source.sha256 },
      path, mimeType: "audio/wav", fixture: false, origin: "generated_audio", physicalDurationSeconds: samples / 48000,
      byteLength: source.byteLength, outputReceiptId: spool.id, outputSpoolId: spool.id, derivationId: id, sourceDescriptorId: source.id };
    store.insert("artifact", artifactId, project.id, artifact); store.insert("audio_derivation_receipt", id, project.id, receipt);
    store.insert("media_source", artifactId, project.id, { id: artifactId, projectId: project.id, source, origin: "generated_audio", attemptId: request.attemptId, derivationId: id });
    return artifact;
  });
  return { root, sourceRoot, destination, store, project, output, rawReceipt, spool, intent, receipt, completionPath, raw, normalized, publish,
    backup: () => createInstallationBackup({ sourceRoot, destination }) };
}

test("backup includes filesystem-only audio completion, exact raw/normalized bytes and excludes unpublished temporary work", async t => {
  const f = await fixture(t); write(f.sourceRoot, "audio-derivations/tmp/unfinished.partial", "temporary");
  const result = await f.backup(), paths = result.manifest.files.map(file => file.path);
  for (const path of [f.completionPath, `execution-output/blobs/${sha(f.raw)}.blob`, `media/blobs/${sha(f.raw)}.source`,
    `media/blobs/${sha(f.normalized)}.wav`, `media/sources/${f.receipt.source.id}.json`]) assert.ok(paths.includes(path), path);
  assert.equal(paths.some(path => path.includes("unfinished")), false);
  assert.equal(f.store.list("artifact", f.project.id).length, 0); assert.equal(f.store.list("audio_derivation_receipt", f.project.id).length, 0);
  assert.deepEqual(readFileSync(join(f.destination, f.completionPath)), readFileSync(join(f.sourceRoot, f.completionPath)));
  assert.deepEqual(await inspectInstallationBackup({ directory: f.destination }), result);
  assert.equal(installationBackupFileKind(f.completionPath), "owned_metadata");
  assert.equal(installationBackupFileKind("audio-derivatives/completions/" + "a".repeat(64) + ".json"), null, "future namespaces remain unavailable");
});

test("backup preserves measured endpoint failure as recovery evidence without inventing a completed audio artifact", async t => {
  const f = await fixture(t, 47900); assert.ok(Math.abs(f.receipt.endpointDeltaNumerator) > 24000);
  const result = await f.backup(); assert.ok(result.manifest.files.some(file => file.path === f.completionPath));
  await inspectInstallationBackup({ directory: f.destination });
  assert.equal(f.store.list("artifact", f.project.id).length, 0); assert.equal(f.store.list("media_source", f.project.id).length, 0);
  assert.throws(() => f.publish(), { code: "AUDIO_PCM_ENDPOINT_MISMATCH" });
});

test("audio completion with missing raw closure or changed derivation identity fails export", async t => {
  for (const change of [f => unlinkSync(join(f.sourceRoot, `execution-output/blobs/${sha(f.raw)}.blob`)),
    f => write(f.sourceRoot, f.completionPath, canonical({ ...f.receipt, intentDigest: "0".repeat(64) }))]) {
    const f = await fixture(t); change(f); await assert.rejects(f.backup()); assert.equal(existsSync(f.destination), false);
  }
});

test("published audio SQL closure must retain its exact derivation, source and artifact identities", async t => {
  const f = await fixture(t), artifact = f.publish(); await f.backup(); await inspectInstallationBackup({ directory: f.destination });
  clean(f.destination);
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?")
    .run(canonical({ ...artifact, sourceDescriptorId: "b".repeat(64) }), artifact.id);
  await assert.rejects(f.backup(), { code: "AUDIO_DERIVATION_CONFLICT" }); assert.equal(existsSync(f.destination), false);
});

test("raw transcription JSON remains private backup evidence with no cue ingestion and rejects a forged task identity", async t => {
  const f = await fixture(t), request = { kind: "transcription", attemptId: "transcript-attempt", nodeId: "transcript", args: {} };
  f.store.insert("attempt", request.attemptId, f.project.id, { candidateId: null, workKey: "transcript-fixture", ordinal: 1, request, taskId: null });
  const raw = Buffer.from('{ "text":"Synthetic", "words":[] }\n');
  const receipt = f.output.recordReceipt(f.project.id, { attemptId: request.attemptId, expectedRequestDigest: digest(request), port: "cues", kind: "data",
    mimeType: "application/json", vendorTaskId: null, diagnosticRequestId: "synthetic-transcript-id", source: { kind: "returned_bytes", sha256: sha(raw), byteLength: raw.length } });
  await f.output.spool(f.project.id, receipt.id, async function* () { yield raw; });
  const result = await f.backup(); assert.ok(result.manifest.files.some(file => file.path === `execution-output/blobs/${sha(raw)}.blob`));
  assert.equal(f.store.list("narration_cue", f.project.id).length, 0); assert.equal(f.store.list("artifact", f.project.id).length, 0);
  clean(f.destination);
  // Deliberately corrupt SQL history to exercise read-only backup validation independently of Store checks.
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='execution_output_receipt' AND id=?")
    .run(canonical({ ...receipt, vendorTaskId: "not-a-pollable-task" }), receipt.id);
  await assert.rejects(f.backup()); assert.equal(existsSync(f.destination), false);
});
