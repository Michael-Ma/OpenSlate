import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RECIPE_DIGEST, canonical, digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { resolveSpeechAdmission, assertSpeechFirstDispatch, assertSpeechMappingAdmission } from "../dist/execution/audio-execution-authority.js";
import { prepareSpeechExecutionRequest, assertSpeechExecutionMapping, assertSpeechExecutionResult } from "../dist/execution/audio-execution-receipts.js";
import { createInstallationBackup, inspectInstallationBackup } from "../dist/persistence/installation-backup.js";
import { speechFixture, context, rows } from "./speech-execution-fixture.mjs";

function mapping(f) {
  const value = resolveSpeechAdmission(f.store, f.request), prepared = prepareSpeechExecutionRequest(f.request);
  return { id: f.attempt.id, projectId: f.project.id, version: 1, attemptId: f.attempt.id, requestDigest: digest(f.request),
    profileDigest: f.request.profile.digest, profileDefinitionDigest: digest(value.profile), profileDefinition: value.profile,
    capabilityLockId: value.capabilityLock.id, capabilityLockDigest: digest(value.capabilityLock), estimatedMicros: value.reservation.micros,
    transport: prepared.description, bodyByteLength: prepared.bodyByteLength };
}
function replaceCurrentLock(f, profile = { ...f.profile, unitCostMicros: "999", maxConcurrency: 1 }) {
  const id = randomUUID(); f.store.insert("capability_lock", id, f.project.id, { recipeDigest: RECIPE_DIGEST, profiles: [profile] });
  const project = f.store.getProject(f.project.id); f.store.saveProject({ ...project, capabilityLockId: id }, project.headVersion); return id;
}
function clean(path) { if (!existsSync(path)) return; if (lstatSync(path).isDirectory()) {
  chmodSync(path, 0o700); for (const name of readdirSync(path)) clean(join(path, name)); } rmSync(path, { recursive: true, force: true }); }
function backupFixture(t, f) {
  new FakeProvider(join(f.directory, "fake-provider.sqlite")).close();
  const parent = mkdtempSync(join(tmpdir(), "openslate-speech-backup-")), destination = join(parent, "backup");
  t.after(() => clean(parent)); return { destination, run: () => createInstallationBackup({ sourceRoot: f.directory, destination }) };
}

test("speech mapping preserves exact text/wire bytes and the full admitted profile estimate", t => {
  const f = speechFixture(t), saved = mapping(f), prepared = prepareSpeechExecutionRequest(f.request);
  assert.equal(prepared.request.text, f.text); assert.equal(prepared.request.instructions, f.instructions); assert.equal(prepared.request.voice, f.voice);
  assert.equal(prepared.bodyByteLength, Buffer.byteLength(canonical({ model: f.profile.configuration.model, input: f.text, voice: f.voice,
    instructions: f.instructions, response_format: "wav", stream_format: "audio", speed: 1 })));
  assert.notEqual(saved.requestDigest, saved.transport.requestDigest); assert.notEqual(saved.requestDigest, saved.transport.bodySha256);
  assert.equal(saved.estimatedMicros, "100"); assert.equal(saved.profileDefinitionDigest, digest(f.profile));
  assertSpeechMappingAdmission(resolveSpeechAdmission(f.store, f.request), saved);
  for (const invalid of [{ ...saved, bodyByteLength: saved.bodyByteLength + 1 }, { ...saved, estimatedMicros: "99" },
    { ...saved, profileDefinition: { ...saved.profileDefinition, maxConcurrency: 10 } }, { ...saved, path: "/not-a-profile" }])
    assert.throws(() => assertSpeechExecutionMapping(f.attempt, invalid));
  assert.equal(f.calls.http, 0); assert.equal(f.calls.credentials, 0);
});

test("admitted full-definition pin avoids current defaults and unrelated retained locks", t => {
  const f = speechFixture(t); replaceCurrentLock(f);
  const saved = mapping(f); assert.equal(saved.capabilityLockId, f.project.capabilityLockId); assert.equal(saved.profileDefinition.unitCostMicros, "100");
  f.store.insert("speech_execution_mapping", saved.id, f.project.id, saved);
  for (let i = 0; i < 129; i++) f.store.insert("capability_lock", `future-${i}`, f.project.id, { recipeDigest: RECIPE_DIGEST, profiles: [{ ...f.profile, unitCostMicros: String(1000 + i) }] });
  assert.equal(resolveSpeechAdmission(f.store, f.request).capabilityLock.id, saved.capabilityLockId);
  assert.equal(resolveSpeechAdmission(f.store, f.request, saved).capabilityLock.id, saved.capabilityLockId);
  assertSpeechMappingAdmission(resolveSpeechAdmission(f.store, f.request, saved), saved);
});

test("the exact admitted providerUse lock is retained even when a later identical lock exists", t => {
  const f = speechFixture(t), later = replaceCurrentLock(f, f.profile), saved = mapping(f);
  assert.notEqual(saved.capabilityLockId, later); assert.equal(saved.capabilityLockId, f.project.capabilityLockId);
  assert.equal(saved.profileDefinitionDigest, digest(f.profile));
});

test("oversized lock metadata fails before the selected body is decoded", t => {
  const f = speechFixture(t), lockId = f.project.capabilityLockId;
  const lock = f.store.get("capability_lock", lockId); f.store.db.prepare("UPDATE entities SET body=? WHERE kind='capability_lock' AND id=?")
    .run(canonical({ ...lock, oversized: "x".repeat(65536) }), lockId);
  const get = f.store.get.bind(f.store); f.store.get = (kind, id) => { assert.ok(kind !== "capability_lock", "oversized body must not be decoded"); return get(kind, id); };
  assert.throws(() => resolveSpeechAdmission(f.store, f.request), { code: "SPEECH_EXECUTION_CONFLICT" });
});

test("forged providerUse, changed reserved estimate and foreign grant cannot authorize speech", t => {
  for (const corrupt of [
    f => { f.request = { ...f.request, providerUse: { ...f.request.providerUse, profileDefinitionDigest: "0".repeat(64) } }; },
    f => { const reservation = f.store.get("reservation", f.attempt.reservationId); f.store.db.prepare("UPDATE entities SET body=? WHERE kind='reservation' AND id=?").run(canonical({ ...reservation, micros: "101" }), reservation.id); },
    f => f.store.db.prepare("UPDATE entities SET body=? WHERE kind='grant' AND id=?").run(canonical({ ...f.grant, projectId: "foreign" }), f.grant.id),

  ]) { const f = speechFixture(t); corrupt(f); assert.throws(() => resolveSpeechAdmission(f.store, f.request)); assert.equal(f.calls.http, 0); }
});

test("charged replay preserves history while first dispatch requires a reserved original lease", t => {
  const f = speechFixture(t), admission = resolveSpeechAdmission(f.store, f.request);
  assert.doesNotThrow(() => assertSpeechFirstDispatch(f.store, admission, context(f).expectedLease));
  const reservation = f.store.get("reservation", f.attempt.reservationId); f.store.put("reservation", reservation.id, f.project.id, { ...reservation, state: "charged" });
  assert.equal(resolveSpeechAdmission(f.store, f.request).reservation.state, "charged");
  assert.throws(() => assertSpeechFirstDispatch(f.store, admission, context(f).expectedLease), { code: "SPEECH_EXECUTION_NOT_DISPATCHABLE" });
});

test("speech records are immutable and cannot invent a dispatch after terminal local preparation", t => {
  const f = speechFixture(t), local = { id: f.attempt.id, projectId: f.project.id, version: 1, attemptId: f.attempt.id,
    requestDigest: digest(f.request), mappingDigest: null, dispatchDigest: null, observation: { kind: "not_dispatched", code: "LOCAL_INPUT_INVALID" } };
  f.store.insert("speech_execution_result", local.id, f.project.id, local);
  assert.throws(() => f.store.put("speech_execution_result", local.id, f.project.id, { ...local, observation: { kind: "not_dispatched", code: "LOCAL_CANCELLED" } }), { code: "IMMUTABLE_RECORD" });
  assert.throws(() => f.store.insert("speech_execution_mapping", local.id, f.project.id, mapping(f)), { code: "SPEECH_EXECUTION_CONFLICT" });
  assert.equal(f.calls.http, 0);
});

test("completed speech receipt binds exact raw evidence and rejects diagnostic task, output and wire substitutions", async t => {
  const f = speechFixture(t), outcome = await f.bridge.submit(f.request, context(f)); assert.equal(outcome.type, "completed");
  const saved = rows(f, "speech_execution_mapping")[0], dispatch = rows(f, "speech_execution_dispatch")[0], result = rows(f, "speech_execution_result")[0];
  const output = f.store.get("execution_output_receipt", result.observation.outputReceiptId);
  assertSpeechExecutionResult(f.attempt, saved, dispatch, result, output);
  for (const changed of [{ ...output, vendorTaskId: "diagnostic-is-not-task" }, { ...output, source: { ...output.source, sha256: "0".repeat(64) } }])
    assert.throws(() => assertSpeechExecutionResult(f.attempt, saved, dispatch, result, changed));
  assert.throws(() => assertSpeechExecutionResult(f.attempt, saved, dispatch,
    { ...result, observation: { ...result.observation, receipt: { ...result.observation.receipt, bodySha256: "0".repeat(64) } } }, output));
});

test("backup preserves the complete speech mapping, provider use, result and exact raw spool after current profile changes", async t => {
  const f = speechFixture(t), outcome = await f.bridge.submit(f.request, context(f)); assert.equal(outcome.type, "completed");
  replaceCurrentLock(f); const copy = backupFixture(t, f), exported = await copy.run();
  assert.ok(exported.manifest.files.some(file => file.path === `execution-output/blobs/${outcome.outputs[0].sha256}.blob`));
  await inspectInstallationBackup({ directory: copy.destination });
  assert.equal(f.calls.http, 1); assert.equal(rows(f, "artifact").length, 0);
});

test("backup rejects changed retained speech profile, provider use or provider result evidence", async t => {
  for (const damage of [
    f => { const lock = f.store.get("capability_lock", f.project.capabilityLockId); f.store.db.prepare("UPDATE entities SET body=? WHERE kind='capability_lock' AND id=?")
      .run(canonical({ ...lock, profiles: [{ ...f.profile, unitCostMicros: "200" }] }), lock.id); },
    f => { const value = f.store.get("attempt", f.attempt.id); f.store.db.prepare("UPDATE entities SET body=? WHERE kind='attempt' AND id=?")
      .run(canonical({ ...value, request: { ...value.request, providerUse: { ...value.request.providerUse, capabilityLockDigest: "0".repeat(64) } } }), value.id); },
    f => { const value = rows(f, "speech_execution_result")[0]; f.store.db.prepare("UPDATE entities SET body=? WHERE kind='speech_execution_result' AND id=?")
      .run(canonical({ ...value, dispatchDigest: "0".repeat(64) }), value.id); },
  ]) { const f = speechFixture(t); await f.bridge.submit(f.request, context(f)); damage(f); const copy = backupFixture(t, f);
    await assert.rejects(copy.run()); assert.equal(existsSync(copy.destination), false); }
});
