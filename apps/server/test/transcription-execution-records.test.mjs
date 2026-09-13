import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { assertTranscriptionMappingAdmission, resolveTranscriptionAdmission, resolveTranscriptionPreparation, assertTranscriptionFirstDispatch } from "../dist/execution/transcription-execution-authority.js";
import { assertTranscriptionExecutionMapping, assertTranscriptionExecutionResult, transcriptionExecutionOptions, TRANSCRIPTION_EXECUTION_PARSER } from "../dist/execution/transcription-execution-receipts.js";
import { createInstallationBackup, inspectInstallationBackup } from "../dist/persistence/installation-backup.js";
import { transcriptionFixture, context, rows, raw, hash } from "./transcription-execution-fixture.mjs";

async function completed(t, options) {
  const f = await transcriptionFixture(t, options), outcome = await f.bridge.submit(f.request, context(f));
  assert.equal(outcome.type, "completed");
  return { ...f, outcome, mapping: rows(f, "transcription_execution_mapping")[0], dispatch: rows(f, "transcription_execution_dispatch")[0],
    result: rows(f, "transcription_execution_result")[0], prepared: resolveTranscriptionPreparation(f.store, f.attempt) };
}
function clean(path) { if (!existsSync(path)) return; if (lstatSync(path).isDirectory()) {
  chmodSync(path, 0o700); for (const name of readdirSync(path)) clean(join(path, name)); } rmSync(path, { recursive: true, force: true }); }
function backupFixture(t, f) {
  new FakeProvider(join(f.directory, "fake-provider.sqlite")).close();
  // This fixture owns the import staging file; retained source copies are in the managed media namespace.
  if (existsSync(f.sourcePath)) unlinkSync(f.sourcePath);
  const parent = mkdtempSync(join(tmpdir(), "openslate-transcription-record-backup-")), destination = join(parent, "backup");
  t.after(() => clean(parent)); return { destination, run: () => createInstallationBackup({ sourceRoot: f.directory, destination }) };
}
function change(f, kind, value) { f.store.db.prepare("UPDATE entities SET body=? WHERE kind=? AND id=?").run(canonical(value), kind, value.id); }

test("transcription mapping pins exact original recording, full range, derivative and parser identities", async t => {
  const f = await completed(t), { intent, receipt } = f.prepared;
  assert.equal(f.mapping.preparation.intentDigest, digest(intent)); assert.equal(f.mapping.preparation.receiptDigest, digest(receipt));
  assert.equal(f.mapping.source.descriptor.sha256, f.request.inputs[0].sha256); assert.equal(f.mapping.source.startSample, 0);
  assert.equal(f.mapping.source.endSample, 48000); assert.equal(f.mapping.derivative.sampleCount, 16000);
  assert.deepEqual(f.mapping.parser, TRANSCRIPTION_EXECUTION_PARSER);
  assert.equal(f.request.args.language, "auto"); assert.equal(f.mapping.transport.language, null);
  assert.equal(f.mapping.transport.input.artifactId, receipt.id); assert.notEqual(receipt.id, f.audio.id);
  assert.notEqual(f.mapping.requestDigest, f.mapping.transport.requestDigest); assert.notEqual(f.mapping.transport.requestDigest, f.mapping.transport.bodySha256);
  assertTranscriptionMappingAdmission(resolveTranscriptionAdmission(f.store, f.request, f.mapping), f.mapping, f.prepared);
  for (const changed of [
    { ...f.mapping, source: { ...f.mapping.source, startSample: 1 } },
    { ...f.mapping, derivative: { ...f.mapping.derivative, sampleCount: 15999 } },
    { ...f.mapping, preparation: { ...f.mapping.preparation, receiptDigest: "0".repeat(64) } },
    { ...f.mapping, parser: { ...f.mapping.parser, maxWords: 8191 } },
    { ...f.mapping, transport: { ...f.mapping.transport, requestDigest: "0".repeat(64) } },
    { ...f.mapping, sourcePath: "/not-an-input" },
  ]) assert.throws(() => assertTranscriptionExecutionMapping(f.attempt, changed, f.prepared), { code: "TRANSCRIPTION_EXECUTION_CONFLICT" });
});

test("unsupported inherited segment timing and invalid language are rejected before source preparation", async t => {
  const f = await transcriptionFixture(t, { omitTiming: true });
  assert.equal(f.request.args.timing, "segment"); assert.throws(() => transcriptionExecutionOptions(f.request), { code: "UNSUPPORTED_TIMING" });
  for (const language of ["zz", "EN", "", null]) assert.throws(() => transcriptionExecutionOptions({ ...f.request,
    args: { ...f.request.args, timing: "word", language } }));
  assert.deepEqual(f.calls, { http: 0, credentials: 0, prepare: 0, upload: 0 });
});

test("transcription replay pins retained full profile and never falls back to changed current defaults", async t => {
  const f = await completed(t), id = randomUUID(); f.store.insert("capability_lock", id, f.project.id, { profiles: [{ ...f.profile, unitCostMicros: "999" }] });
  const current = f.store.getProject(f.project.id); f.store.saveProject({ ...current, capabilityLockId: id }, current.headVersion);
  assert.equal(resolveTranscriptionAdmission(f.store, f.request).capabilityLock.id, f.mapping.capabilityLockId);
  for (let i = 0; i < 129; i++) f.store.insert("capability_lock", `later-${i}`, f.project.id, { profiles: [{ ...f.profile, unitCostMicros: String(1000 + i) }] });
  assert.throws(() => resolveTranscriptionAdmission(f.store, f.request), { code: "TRANSCRIPTION_PROFILE_LOOKUP_LIMIT" });
  assert.equal(resolveTranscriptionAdmission(f.store, f.request, f.mapping).profile.unitCostMicros, "100");
  assertTranscriptionMappingAdmission(resolveTranscriptionAdmission(f.store, f.request, f.mapping), f.mapping, f.prepared);
});

test("actual consumption and original unexpired reservation lease remain mandatory", async t => {
  const f = await transcriptionFixture(t), admission = resolveTranscriptionAdmission(f.store, f.request);
  assert.throws(() => assertTranscriptionFirstDispatch(f.store, admission, { owner: "stale", epoch: f.attempt.leaseEpoch }), { code: "TRANSCRIPTION_EXECUTION_NOT_DISPATCHABLE" });
  const reservation = f.store.get("reservation", f.attempt.reservationId);
  f.store.put("reservation", reservation.id, f.project.id, { ...reservation, state: "charged" });
  assert.equal(resolveTranscriptionAdmission(f.store, f.request).reservation.state, "charged");
  assert.throws(() => assertTranscriptionFirstDispatch(f.store, admission, context(f).expectedLease), { code: "TRANSCRIPTION_EXECUTION_NOT_DISPATCHABLE" });
  f.store.db.prepare("DELETE FROM entities WHERE kind='external_allowance_consumption' AND id=?").run(f.attempt.id);
  assert.throws(() => resolveTranscriptionAdmission(f.store, f.request), { code: "TRANSCRIPTION_EXECUTION_CONFLICT" }); assert.equal(f.calls.http, 0);
});

test("preparation replay uses only the exact input keys and rejects changed source-record provenance", async t => {
  const f = await completed(t), get = f.store.get.bind(f.store), inputId = f.request.inputs[0].artifactId;
  f.store.get = (kind, id) => { if (["narration_audio", "media_source"].includes(kind)) assert.equal(id, inputId); return get(kind, id); };
  assert.deepEqual(resolveTranscriptionPreparation(f.store, f.attempt, f.mapping), f.prepared);
  const reference = f.prepared.intent.sourceRecord, source = get(reference.kind, reference.id); change(f, reference.kind, { ...source, changedMetadata: true });
  assert.throws(() => resolveTranscriptionPreparation(f.store, f.attempt, f.mapping), { code: "TRANSCRIPTION_AUDIO_CONFLICT" });
});

test("transcription records are immutable and compact results reject inline words and changed receipt identity", async t => {
  const f = await completed(t), output = f.store.get("execution_output_receipt", f.result.observation.outputReceiptId);
  for (const [kind, saved] of [["transcription_execution_mapping", f.mapping], ["transcription_execution_dispatch", f.dispatch], ["transcription_execution_result", f.result]])
    assert.throws(() => f.store.put(kind, saved.id, f.project.id, { ...saved, version: 2 }));
  assert.ok(Buffer.byteLength(canonical(f.result)) < 2048); assert.equal(f.result.observation.result.wordCount, 2);
  assert.equal(Object.hasOwn(f.result.observation.result, "words"), false);
  for (const changed of [{ ...f.result, observation: { ...f.result.observation, result: { ...f.result.observation.result, words: [] } } },
    { ...f.result, observation: { ...f.result.observation, result: { ...f.result.observation.result, wordCount: 8193 } } }])
    assert.throws(() => assertTranscriptionExecutionResult(f.attempt, f.mapping, f.dispatch, changed, f.prepared, output));
  assert.throws(() => assertTranscriptionExecutionResult(f.attempt, f.mapping, f.dispatch, f.result, f.prepared, { ...output, vendorTaskId: "diagnostic" }));
});

test("a definite local preparation failure cannot later acquire a mapping or dispatch", async t => {
  const f = await transcriptionFixture(t);
  f.store.insert("transcription_execution_result", f.attempt.id, f.project.id, { id: f.attempt.id, projectId: f.project.id, version: 1,
    attemptId: f.attempt.id, requestDigest: digest(f.request), mappingDigest: null, dispatchDigest: null,
    observation: { kind: "not_dispatched", code: "LOCAL_PREPARATION_BUSY" } });
  const result = await f.bridge.submit(f.request, context(f)); assert.equal(result.type, "rejected");
  assert.equal(result.retryAllowed, false); assert.deepEqual(f.calls, { http: 0, credentials: 0, prepare: 0, upload: 0 });
});

test("private backup preserves exact derivative upload and raw JSON without adopting transcript results", async t => {
  const f = await completed(t), before = canonical(f.store.getProject(f.project.id)), acceptances = canonical(rows(f, "narration_acceptance"));
  const copy = backupFixture(t, f), exported = await copy.run(); await inspectInstallationBackup({ directory: copy.destination });
  for (const path of [`audio-derivatives/blobs/${f.mapping.derivative.sha256}.wav`, `execution-output/blobs/${hash(raw)}.blob`])
    assert.ok(exported.manifest.files.some(file => file.path === path));
  assert.deepEqual(readFileSync(join(copy.destination, `execution-output/blobs/${hash(raw)}.blob`)), raw);
  assert.equal(canonical(f.store.getProject(f.project.id)), before); assert.equal(canonical(rows(f, "narration_acceptance")), acceptances);
  assert.equal(rows(f, "transcript_candidate").length, 0); assert.equal(f.calls.http, 1);
});

test("backup recomputes multipart body identity from derivative bytes beyond structural record checks", async t => {
  const f = await completed(t), mapping = { ...f.mapping, transport: { ...f.mapping.transport, bodySha256: "0".repeat(64) } };
  const dispatch = { ...f.dispatch, mappingDigest: digest(mapping), bodySha256: mapping.transport.bodySha256 };
  const result = { ...f.result, mappingDigest: digest(mapping), dispatchDigest: digest(dispatch),
    observation: { ...f.result.observation, receipt: { ...f.result.observation.receipt, bodySha256: mapping.transport.bodySha256 } } };
  // SQL has no audio bytes: this consistent but wrong wire hash passes structural validation only.
  assertTranscriptionExecutionResult(f.attempt, mapping, dispatch, result, f.prepared, f.store.get("execution_output_receipt", result.observation.outputReceiptId));
  for (const [kind, value] of [["transcription_execution_mapping", mapping], ["transcription_execution_dispatch", dispatch], ["transcription_execution_result", result]]) change(f, kind, value);
  const copy = backupFixture(t, f); await assert.rejects(copy.run(), /multipart differs/); assert.equal(existsSync(copy.destination), false);
});

test("backup reparses the exact raw JSON and rejects a forged compact projection", async t => {
  const f = await completed(t); change(f, "transcription_execution_result", { ...f.result, observation: { ...f.result.observation,
    result: { ...f.result.observation.result, resultDigest: "0".repeat(64) } } });
  const copy = backupFixture(t, f); await assert.rejects(copy.run(), /compact result differs/); assert.equal(existsSync(copy.destination), false);
});

test("completed response metadata remains private unresolved evidence when response bytes never spooled", async t => {
  const f = await transcriptionFixture(t); f.outputs.spool = async () => { throw Error("synthetic pre-spool loss"); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown");
  assert.equal(rows(f, "execution_output_spool").length, 0); assert.equal(rows(f, "transcription_execution_result")[0].observation.kind, "completed");
  const copy = backupFixture(t, f); await copy.run(); await inspectInstallationBackup({ directory: copy.destination });
  assert.equal(rows(f, "transcript_candidate").length, 0); assert.equal(f.calls.http, 1);
});

test("backup retains competing raw winners as unresolved evidence without rebinding the recorded transcription result", async t => {
  const f = await transcriptionFixture(t), spool = f.outputs.spool.bind(f.outputs); let injected = false;
  f.outputs.spool = async (...args) => {
    if (!injected) {
      injected = true;
      const competing = f.outputs.recordReceipt(f.project.id, { attemptId: f.attempt.id, expectedRequestDigest: digest(f.request),
        port: "cues", kind: "data", mimeType: "application/json", vendorTaskId: null, diagnosticRequestId: "competing-transcription",
        source: { kind: "returned_bytes", sha256: hash(raw), byteLength: raw.length } });
      await spool(f.project.id, competing.id, async function* () { yield raw; });
    }
    return spool(...args);
  };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown");
  const result = rows(f, "transcription_execution_result")[0], winner = rows(f, "execution_output_slot")[0];
  assert.notEqual(result.observation.outputReceiptId, winner.spoolId);
  assert.equal(rows(f, "execution_output_spool").length, 2);
  const copy = backupFixture(t, f); await copy.run(); await inspectInstallationBackup({ directory: copy.destination });
  assert.equal(rows(f, "transcript_candidate").length, 0); assert.equal(f.calls.http, 1);
});
