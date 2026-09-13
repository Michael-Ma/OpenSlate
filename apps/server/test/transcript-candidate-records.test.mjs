import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, digest } from "@openslate/core";
import { FakeProvider, parseOpenAITranscriptionResponse } from "@openslate/providers";
import { createTranscriptCandidate, resolveTranscriptionSpoolLineage } from "../dist/execution/transcript-candidate.js";
import { createInstallationBackup, inspectInstallationBackup } from "../dist/persistence/installation-backup.js";
import { transcriptionFixture, context, rows, raw, hash } from "./transcription-execution-fixture.mjs";

function clean(path) { if (!existsSync(path)) return; if (lstatSync(path).isDirectory()) {
  chmodSync(path, 0o700); for (const name of readdirSync(path)) clean(join(path, name)); } rmSync(path, { recursive: true, force: true }); }
function write(path, bytes) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
function change(f, kind, value) { f.store.db.prepare("UPDATE entities SET body=? WHERE kind=? AND id=?").run(canonical(value), kind, value.id); }
async function fixture(t, options) {
  const f = await transcriptionFixture(t, options), outcome = await f.bridge.submit(f.request, context(f));
  assert.equal(outcome.type, "completed");
  const lineage = resolveTranscriptionSpoolLineage(f.store, f.attempt, outcome.outputs[0].storage.spoolId);
  const parsed = parseOpenAITranscriptionResponse({ bytes: raw, mimeType: "application/json", sourceDurationSeconds: 1 });
  const candidate = createTranscriptCandidate(lineage, parsed), artifact = {
    id: candidate.artifactId, projectId: f.project.id, attemptId: f.attempt.id, artifact: { artifactId: candidate.artifactId, kind: "data", sha256: hash(raw) },
    path: join(f.artifactRoot, f.project.id, `${hash(raw)}.json`), mimeType: "application/json", fixture: false, physicalDurationSeconds: null,
    origin: "transcription_response", transcriptCandidateId: candidate.id, outputReceiptId: outcome.receiptId,
    outputSpoolId: outcome.outputs[0].storage.spoolId, byteLength: raw.length,
  };
  write(artifact.path, raw);
  const publish = (value = candidate) => f.store.transaction(() => {
    f.store.insert("artifact", artifact.id, f.project.id, artifact); f.store.insert("transcript_candidate", value.id, f.project.id, value);
  });
  return { ...f, outcome, lineage, candidate, artifact, publish };
}
function backupFixture(t, f) {
  new FakeProvider(join(f.directory, "fake-provider.sqlite")).close(); if (existsSync(f.sourcePath)) unlinkSync(f.sourcePath);
  const parent = mkdtempSync(join(tmpdir(), "openslate-transcript-candidate-backup-")), destination = join(parent, "backup");
  t.after(() => clean(parent)); return { destination, run: () => createInstallationBackup({ sourceRoot: f.directory, destination }) };
}
async function substituteWinner(f) {
  const receipt = f.outputs.recordReceipt(f.project.id, { attemptId: f.attempt.id, expectedRequestDigest: digest(f.request),
    port: "cues", kind: "data", mimeType: "application/json", vendorTaskId: null, diagnosticRequestId: "another-identical-byte-observation",
    source: { kind: "returned_bytes", sha256: hash(raw), byteLength: raw.length } });
  await f.outputs.spool(f.project.id, receipt.id, async function* () { yield raw; });
  const previous = rows(f, "execution_output_slot")[0], changed = { ...previous, spoolId: receipt.id };
  // Corrupt retained history deliberately to exercise validation independently of immutable write guards.
  change(f, "execution_output_slot", changed);
  const path = join(f.directory, "execution-output", "slots", `${previous.id}.json`); chmodSync(path, 0o600); writeFileSync(path, canonical(changed));
  return receipt;
}

test("candidate persistence round-trips one immutable unreviewed projection without accepting narration", async t => {
  const f = await fixture(t), before = canonical(f.store.getProject(f.project.id)), accepted = canonical(rows(f, "narration_acceptance"));
  f.publish(); const saved = f.store.get("transcript_candidate", f.candidate.id);
  assert.equal(saved.status, "unreviewed"); assert.equal(saved.resultDigest, f.lineage.result.observation.result.resultDigest);
  assert.equal(saved.raw.sha256, f.artifact.artifact.sha256); assert.notEqual(digest(saved.projection), saved.raw.sha256);
  assert.deepEqual(saved.projection.words[0], { word: "Leather", startSeconds: 0.1, endSeconds: 0.45, startSample: 4800, endSample: 21600 });
  // SQL canonicalizes object key order. Revalidation must reconstruct the provider's exact projection serializer.
  assert.deepEqual(f.store.put("transcript_candidate", saved.id, f.project.id, saved), saved);
  assert.throws(() => f.store.put("transcript_candidate", saved.id, f.project.id, { ...saved, status: "accepted" }));
  assert.equal(canonical(f.store.getProject(f.project.id)), before); assert.equal(canonical(rows(f, "narration_acceptance")), accepted);
  assert.deepEqual(readFileSync(f.artifact.path), raw); assert.equal(f.calls.http, 1);
});

test("candidate validation rejects invented acceptance, changed source range, or altered source-sample suggestions atomically", async t => {
  const f = await fixture(t);
  for (const invalid of [
    { ...f.candidate, status: "accepted" },
    { ...f.candidate, accepted: true },
    { ...f.candidate, source: { ...f.candidate.source, startSample: 100 } },
    { ...f.candidate, projection: { ...f.candidate.projection, words: [{ ...f.candidate.projection.words[0], startSample: 0 }, ...f.candidate.projection.words.slice(1)] } },
    { ...f.candidate, resultDigest: "0".repeat(64) },
  ]) { assert.throws(() => f.publish(invalid)); assert.equal(rows(f, "transcript_candidate").length, 0); assert.equal(rows(f, "artifact").filter(a => a.origin === "transcription_response").length, 0); }
});

test("a transcript candidate cannot reference another project's identical raw artifact", async t => {
  const f = await fixture(t), foreign = f.production.createProject("Other owner");
  f.store.insert("artifact", f.artifact.id, foreign.id, { ...f.artifact, projectId: foreign.id });
  assert.throws(() => f.store.insert("transcript_candidate", f.candidate.id, f.project.id, f.candidate), { code: "SCOPE_DENIED" });
  assert.equal(rows(f, "transcript_candidate").length, 0);
});

test("candidate insertion rejects an identical-byte winner belonging to a different provider receipt", async t => {
  const f = await fixture(t), other = await substituteWinner(f); assert.notEqual(other.id, f.candidate.raw.receiptId);
  assert.throws(f.publish); assert.equal(rows(f, "transcript_candidate").length, 0);
  assert.equal(rows(f, "artifact").filter(a => a.origin === "transcription_response").length, 0);
});

test("candidate insertion requires its retained provider dispatch even after a completed raw response", async t => {
  const f = await fixture(t); f.store.db.prepare("DELETE FROM entities WHERE kind='transcription_execution_dispatch' AND id=?").run(f.attempt.id);
  assert.throws(f.publish); assert.equal(rows(f, "transcript_candidate").length, 0);
});

test("published candidate backup retains exact raw JSON, source derivative and unreviewed projection", async t => {
  const f = await fixture(t); f.publish(); const copy = backupFixture(t, f);
  const before = canonical(f.store.getProject(f.project.id)), candidate = canonical(f.store.get("transcript_candidate", f.candidate.id));
  const exported = await copy.run(); await inspectInstallationBackup({ directory: copy.destination });
  for (const path of [`artifacts/${f.project.id}/${hash(raw)}.json`, `execution-output/blobs/${hash(raw)}.blob`,
    `audio-derivatives/blobs/${f.lineage.preparation.receipt.audio.sha256}.wav`]) assert.ok(exported.manifest.files.some(file => file.path === path));
  assert.deepEqual(readFileSync(join(copy.destination, `artifacts/${f.project.id}/${hash(raw)}.json`)), raw);
  assert.equal(canonical(f.store.get("transcript_candidate", f.candidate.id)), candidate); assert.equal(canonical(f.store.getProject(f.project.id)), before);
});

test("backup rejects a published candidate whose sample coordinates were rewritten in retained SQL", async t => {
  const f = await fixture(t); f.publish(); change(f, "transcript_candidate", { ...f.candidate, projection: { ...f.candidate.projection,
    words: [{ ...f.candidate.projection.words[0], startSample: 0 }, ...f.candidate.projection.words.slice(1)] } });
  const copy = backupFixture(t, f); await assert.rejects(copy.run(), /candidate differs/); assert.equal(existsSync(copy.destination), false);
});

test("published candidate backup requires the original raw spool even when artifact bytes remain intact", async t => {
  const f = await fixture(t); f.publish(); unlinkSync(join(f.directory, "execution-output", "blobs", `${hash(raw)}.blob`));
  assert.deepEqual(readFileSync(f.artifact.path), raw);
  const copy = backupFixture(t, f); await assert.rejects(copy.run()); assert.equal(existsSync(copy.destination), false);
});

test("backup rejects a published candidate after a different identical-byte receipt replaces its raw winner", async t => {
  const f = await fixture(t); f.publish(); await substituteWinner(f);
  const copy = backupFixture(t, f); await assert.rejects(copy.run()); assert.equal(existsSync(copy.destination), false);
});

test("raw transcript artifacts cannot be backed up without their reciprocal candidate record", async t => {
  const f = await fixture(t); f.publish(); f.store.db.prepare("DELETE FROM entities WHERE kind='transcript_candidate' AND id=?").run(f.candidate.id);
  const copy = backupFixture(t, f); await assert.rejects(copy.run(), /transcript_candidate/); assert.equal(existsSync(copy.destination), false);
});
