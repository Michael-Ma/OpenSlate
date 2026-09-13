import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { audioArtifactId, audioDerivationId } from "../dist/execution/audio-derivation.js";
import { createInstallationBackup, inspectInstallationBackup } from "../dist/persistence/installation-backup.js";
import { speechFixture, context, rows, bytes, hash } from "./speech-execution-fixture.mjs";

function write(root, name, content) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return path; }
function clean(path) {
  if (!existsSync(path)) return;
  if (lstatSync(path).isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) clean(join(path, name)); }
  rmSync(path, { recursive: true, force: true });
}
function normalizedWave() {
  const out = Buffer.alloc(44 + 48000 * 4); out.write("RIFF"); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(48000, 24); out.writeUInt32LE(192000, 28);
  out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(out.length - 44, 40); return out;
}
async function fixture(t, competing = false) {
  const f = speechFixture(t), spool = f.outputs.spool.bind(f.outputs); let injected = false;
  if (competing) f.outputs.spool = async (...args) => {
    if (!injected) {
      injected = true;
      const other = f.outputs.recordReceipt(f.project.id, { attemptId: f.attempt.id, expectedRequestDigest: digest(f.request),
        port: "audio", kind: "audio", mimeType: "audio/wav", vendorTaskId: null, diagnosticRequestId: "different-receipt-same-bytes",
        source: { kind: "returned_bytes", sha256: hash(bytes), byteLength: bytes.length } });
      await spool(f.project.id, other.id, async function* () { yield bytes; });
    }
    return spool(...args);
  };
  const outcome = await f.bridge.submit(f.request, context(f));
  assert.equal(outcome.type, competing ? "unknown" : "completed");
  const slot = rows(f, "execution_output_slot")[0], raw = f.store.get("execution_output_spool", slot.spoolId), result = rows(f, "speech_execution_result")[0];
  assert.equal(result.observation.kind, "completed");
  assert.equal(raw.sha256, result.observation.result.sha256, "the negative case changes provenance, not content");
  assert.equal(raw.id === result.observation.outputReceiptId, !competing);
  const id = audioDerivationId(f.project.id, f.attempt.id), artifactId = audioArtifactId(id), normalized = normalizedWave();
  const intent = { id, projectId: f.project.id, version: 1, attemptId: f.attempt.id, requestDigest: digest(f.request),
    slotId: slot.id, spoolId: raw.id, rawSha256: raw.sha256, rawByteLength: raw.byteLength, artifactId, recipe: "generated-audio-v1",
    rawPcm: { sampleRate: 24000, channels: 1, sampleCount: 24000, bitsPerSample: 16 }, normalization: {
      version: 1, recipe: "pcm-s16le-48khz-stereo-v1", toolchainDigest: "a".repeat(64), maxInputBytes: 32 * 1024 ** 2,
      maxOutputBytes: 256 * 1024 ** 2, maxSamples: 48000 * 360, timeoutMs: 120000 } };
  const sourceBody = { artifactId, kind: "audio", originalSha256: raw.sha256, originalByteLength: raw.byteLength, sha256: hash(normalized), byteLength: normalized.length,
    probe: { durationSeconds: 1, audio: { streamIndex: 0, sampleRate: 48000, channels: 2, samples: 48000, durationSeconds: 1, codec: "pcm_s16le" } },
    toolchainDigest: intent.normalization.toolchainDigest };
  const source = { id: digest(sourceBody), ...sourceBody };
  const receipt = { id, version: 1, projectId: f.project.id, attemptId: f.attempt.id, intentDigest: digest(intent), source,
    normalizedSamples: 48000, endpointDeltaNumerator: 0 };
  const completionPath = `audio-derivations/completions/${id}.json`;
  const saveFiles = () => {
    write(f.directory, `media/blobs/${raw.sha256}.source`, bytes); write(f.directory, `media/blobs/${source.sha256}.wav`, normalized);
    write(f.directory, `media/sources/${source.id}.json`, canonical(source)); write(f.directory, completionPath, canonical(receipt));
  };
  const artifact = { id: artifactId, projectId: f.project.id, attemptId: f.attempt.id, artifact: { artifactId, kind: "audio", sha256: source.sha256 },
    path: join(f.directory, "artifacts", f.project.id, `${source.sha256}.wav`), mimeType: "audio/wav", fixture: false, origin: "generated_audio",
    physicalDurationSeconds: 1, byteLength: normalized.length, outputReceiptId: raw.id, outputSpoolId: raw.id, derivationId: id, sourceDescriptorId: source.id };
  const mediaSource = { id: artifactId, projectId: f.project.id, source, origin: "generated_audio", attemptId: f.attempt.id, derivationId: id };
  const insertIntent = () => f.store.insert("audio_derivation_intent", id, f.project.id, intent);
  const publish = () => f.store.transaction(() => {
    f.store.insert("artifact", artifactId, f.project.id, artifact);
    f.store.insert("audio_derivation_receipt", id, f.project.id, receipt);
    f.store.insert("media_source", artifactId, f.project.id, mediaSource);
  });
  // Deliberately insert malformed historical SQL to test closure independently of Store's write barrier.
  const rawInsert = (kind, value) => f.store.db.prepare("INSERT INTO entities(kind,id,project_id,body) VALUES(?,?,?,?)")
    .run(kind, value.id, f.project.id, canonical(value));
  const parent = mkdtempSync(join(tmpdir(), "openslate-speech-lineage-backup-")), destination = join(parent, "backup");
  t.after(() => clean(parent)); new FakeProvider(join(f.directory, "fake-provider.sqlite")).close();
  return { ...f, intent, receipt, artifact, mediaSource, normalized, completionPath, saveFiles, insertIntent, publish, rawInsert, destination,
    backup: () => createInstallationBackup({ sourceRoot: f.directory, destination }) };
}

test("matching speech result supports exact normalized provenance and backup closure", async t => {
  const f = await fixture(t); f.insertIntent(); f.saveFiles();
  write(f.directory, `artifacts/${f.project.id}/${f.receipt.source.sha256}.wav`, f.normalized); f.publish();
  await f.backup(); await inspectInstallationBackup({ directory: f.destination });
  assert.deepEqual(readFileSync(join(f.destination, f.completionPath)), readFileSync(join(f.directory, f.completionPath)));
  assert.equal(rows(f, "audio_derivation_receipt").length, 1); assert.equal(f.calls.http, 1);
});

test("Store rejects an alternate winning receipt even when its speech bytes are identical", async t => {
  const f = await fixture(t, true);
  assert.throws(f.insertIntent, /[Ss]peech/);
  assert.equal(rows(f, "audio_derivation_intent").length, 0);
  assert.equal(rows(f, "artifact").length, 0); assert.equal(f.calls.http, 1);
});

test("Store publication revalidates speech lineage when a retained intent bypassed the write barrier", async t => {
  const f = await fixture(t, true); f.rawInsert("audio_derivation_intent", f.intent);
  assert.throws(f.publish, /[Ss]peech/);
  for (const kind of ["artifact", "audio_derivation_receipt", "media_source"]) assert.equal(rows(f, kind).length, 0, kind);
});

for (const published of [false, true]) test(`backup rejects ${published ? "published" : "filesystem-only"} normalization tied to a different identical-byte speech receipt`, async t => {
  const f = await fixture(t, true); f.rawInsert("audio_derivation_intent", f.intent); f.saveFiles();
  if (published) {
    write(f.directory, `artifacts/${f.project.id}/${f.receipt.source.sha256}.wav`, f.normalized);
    for (const [kind, value] of [["artifact", f.artifact], ["audio_derivation_receipt", f.receipt], ["media_source", f.mediaSource]]) f.rawInsert(kind, value);
  }
  await assert.rejects(f.backup(), /[Ss]peech/); assert.equal(existsSync(f.destination), false); assert.equal(f.calls.http, 1);
});

test("missing completed speech evidence cannot authorize a normalization intent", async t => {
  const f = await fixture(t); f.store.db.prepare("DELETE FROM entities WHERE kind='speech_execution_result' AND id=?").run(f.attempt.id);
  assert.throws(f.insertIntent, /[Ss]peech/); assert.equal(rows(f, "audio_derivation_intent").length, 0);
});
