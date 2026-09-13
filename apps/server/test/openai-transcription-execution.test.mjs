import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { digest, DomainError } from "../../../packages/core/dist/index.js";
import { parseOpenAITranscriptionResponse } from "../../../packages/providers/dist/index.js";
import { OpenAITranscriptionExecution } from "../dist/execution/openai-transcription-execution.js";
import { installRecoveryQuarantine, InstallationRecoveryGuard, releaseRecovery } from "../dist/application/installation-recovery.js";
import { transcriptionFixture, context, rows, raw, payload, response, key, hash, restart } from "./transcription-execution-fixture.mjs";

const code = expected => error => error?.code === expected;
function replaceLease(f) { const old = f.store.get("attempt", f.attempt.id), next = { ...old, leaseOwner: "replacement-worker", leaseEpoch: old.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 };
  f.store.put("attempt", old.id, f.project.id, next); return { expectedLease: { owner: next.leaseOwner, epoch: next.leaseEpoch } }; }
const cloneBridge = f => new OpenAITranscriptionExecution({ store: f.store, outputStore: f.outputs, preparation: f.preparation, credentials: f.credentials, fetch: f.fetch });

test("accepted canonical audio and real consumed approval bind exact multipart and bounded raw JSON completion", async t => {
  const large = Buffer.concat([Buffer.alloc(1200000, 32), raw, Buffer.alloc(1200000, 10)]);
  const f = await transcriptionFixture(t, { fetch: async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/audio/transcriptions"); assert.equal(init.method, "POST");
    const mapping = rows(f, "transcription_execution_mapping")[0], marker = rows(f, "transcription_execution_dispatch")[0], consumption = rows(f, "external_allowance_consumption")[0];
    assert.equal(mapping.requestDigest, digest(f.request)); assert.notEqual(mapping.requestDigest, mapping.transport.requestDigest);
    assert.equal(mapping.profileDefinitionDigest, digest(f.profile)); assert.equal(mapping.consumptionDigest, digest(consumption));
    assert.equal(mapping.allowanceDigest, digest(f.allowance)); assert.equal(mapping.estimatedMicros, "100");
    assert.equal(mapping.capabilityLockDigest, digest(f.store.get("capability_lock", mapping.capabilityLockId)));
    assert.equal(marker.mappingDigest, digest(mapping)); assert.equal(marker.transportDigest, mapping.transport.requestDigest);
    assert.equal(marker.bodySha256, hash(init.body)); assert.equal(mapping.transport.bodyByteLength, init.body.byteLength);
    assert.equal(init.headers.Authorization, `Bearer ${key}`); assert.equal(init.headers["Idempotency-Key"], undefined);
    const form = await new Request(url, { method: "POST", headers: init.headers, body: init.body }).formData();
    assert.deepEqual([...form.keys()], ["model", "response_format", "timestamp_granularities[]", "file"]);
    assert.equal(form.get("model"), "whisper-1"); assert.equal(form.get("timestamp_granularities[]"), "word"); assert.equal(form.get("response_format"), "verbose_json");
    const fileBytes = Buffer.from(await form.get("file").arrayBuffer());
    assert.equal(hash(fileBytes), mapping.derivative.sha256); assert.equal(fileBytes.length, mapping.derivative.byteLength);
    assert.equal(mapping.source.descriptor.sha256, f.audio.media.sha256); assert.equal(mapping.source.endSample, 48000);
    assert.equal(mapping.derivative.sampleCount, 16000); assert.equal(mapping.transport.language, null);
    assert.equal(mapping.parser.maxResponseBytes, 4194304);
    return response(large);
  } });
  const spool = f.outputs.spool.bind(f.outputs), chunks = [];
  f.outputs.spool = (projectId, receiptId, source, options) => spool(projectId, receiptId, async function* () {
    assert.equal(rows(f, "transcription_execution_result")[0].observation.kind, "completed");
    for await (const value of source()) { chunks.push(value.byteLength); yield value; }
  }, options);
  const completed = await f.bridge.submit(f.request, context(f));
  assert.equal(completed.type, "completed"); assert.equal(completed.version, 2); assert.equal(completed.vendorTaskId, null);
  assert.equal(completed.outputs[0].port, "cues"); assert.equal(completed.outputs[0].kind, "data"); assert.equal(completed.outputs[0].fixture, false);
  assert.equal(completed.outputs[0].sha256, hash(large)); assert.deepEqual(readFileSync((await f.outputs.resolveOwned(f.project.id, completed.receiptId)).path), large);
  assert.equal(chunks.length, 3); assert.ok(chunks.every(size => size <= 1048576));
  const observed = rows(f, "transcription_execution_result")[0].observation;
  const parsed = parseOpenAITranscriptionResponse({ bytes: large, mimeType: "application/json", sourceDurationSeconds: 1 });
  assert.equal(observed.result.resultDigest, parsed.result.resultDigest); assert.equal(observed.result.rawResponseSha256, hash(large));
  assert.equal(observed.result.wordCount, 2); assert.equal(observed.reportedModel, "whisper-1"); assert.deepEqual(observed.result.usage, { type: "duration", seconds: 1 });
  const savedResult = JSON.stringify(rows(f, "transcription_execution_result"));
  assert.ok(!savedResult.includes("Leather") && !savedResult.includes(key) && !savedResult.includes("rawResponseBytes"));
  assert.equal(rows(f, "artifact").length, 1, "only the human accepted audio is published; raw ASR is not an adopted transcript");
  assert.equal(rows(f, "transcript_candidate").length, 0);
  assert.deepEqual(await f.bridge.submit(f.request), completed); assert.deepEqual(await f.bridge.lookup(f.attempt.id), completed);
  assert.equal((await f.bridge.poll("req-transcription-diagnostic", f.request)).type, "unknown");
  assert.deepEqual(f.calls, { http: 1, credentials: 1, prepare: 1, upload: 1 });
  assert.deepEqual(await restart(f).bridge.lookup(f.attempt.id), completed);
});

test("language hint is exact while compiler's historical default segment timing fails before preparation", async t => {
  const f = await transcriptionFixture(t, { language: "zh", fetch: async (url, init) => {
    const form = await new Request(url, { method: "POST", headers: init.headers, body: init.body }).formData(); assert.equal(form.get("language"), "zh"); return response();
  } }); assert.equal((await f.bridge.submit(f.request, context(f))).type, "completed");
  for (const options of [{ omitTiming: true }, { timing: "none" }, { language: "en-US" }, { model: "gpt-4o-transcribe" }, { settings: { prompt: "invented" } }, { profileSettings: { temperature: 0 } }]) {
    const g = await transcriptionFixture(t, options); if (options.omitTiming) assert.equal(g.request.args.timing, "segment");
    const result = await g.bridge.submit(g.request, context(g)); assert.equal(result.type, "rejected"); assert.equal(result.retryAllowed, false);
    assert.equal(rows(g, "transcription_execution_result")[0].observation.code, "LOCAL_INPUT_INVALID");
    assert.deepEqual(g.calls, { http: 0, credentials: 0, prepare: 0, upload: 0 });
    assert.deepEqual(await g.bridge.lookup(g.attempt.id), result);
  }
});

test("allowance ID cannot replace actual consumption, full approved profile and reserved cost", async t => {
  for (const kind of ["external_allowance_consumption", "external_allowance", "candidate", "grant", "reservation"]) {
    const f = await transcriptionFixture(t); f.store.db.prepare("DELETE FROM entities WHERE kind=?").run(kind);
    await assert.rejects(f.bridge.submit(f.request, context(f)), code("TRANSCRIPTION_EXECUTION_CONFLICT"));
    assert.deepEqual(f.calls, { http: 0, credentials: 0, prepare: 0, upload: 0 });
  }
});

test("first preparation requires original submitting owner and never borrows a replacement lease", async t => {
  const f = await transcriptionFixture(t); await assert.rejects(f.bridge.submit(f.request), code("TRANSCRIPTION_EXECUTION_NOT_DISPATCHABLE"));
  const original = context(f); replaceLease(f); await assert.rejects(f.bridge.submit(f.request, original), code("TRANSCRIPTION_EXECUTION_NOT_DISPATCHABLE"));
  assert.equal(f.calls.prepare, 0); assert.equal(rows(f, "transcription_execution_result").length, 0);
});

test("owned MEDIA_BUSY is a definite local non-dispatch and never automatically prepares again", async t => {
  const f = await transcriptionFixture(t); let called = 0;
  f.preparation.prepare = async () => { called++; throw new DomainError("MEDIA_BUSY", "owned local worker busy"); };
  const result = await f.bridge.submit(f.request, context(f)); assert.equal(result.type, "rejected"); assert.equal(result.retryAllowed, false);
  assert.equal(rows(f, "transcription_execution_result")[0].observation.code, "LOCAL_PREPARATION_BUSY");
  assert.deepEqual(await cloneBridge(f).submit(f.request, context(f)), result); assert.equal(called, 1); assert.equal(f.calls.http, 0);
  assert.equal(rows(f, "transcription_audio_intent").length, 0); assert.equal(rows(f, "transcription_execution_dispatch").length, 0);
  assert.equal(rows(f, "external_allowance_consumption").length, 1, "local failure never restores allowance attempt capacity");
});

test("stale preparation failure does not install a local decision ahead of replacement", async t => {
  const f = await transcriptionFixture(t), prepare = f.preparation.prepare.bind(f.preparation), entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.preparation.prepare = async () => { entered.resolve(); await release.promise; throw new DomainError("MEDIA_BUSY", "stale busy"); };
  const running = f.bridge.submit(f.request, context(f)); await entered.promise; const replacement = replaceLease(f); release.resolve();
  assert.equal((await running).type, "unknown"); assert.equal(rows(f, "transcription_execution_result").length, 0);
  f.preparation.prepare = prepare; assert.equal((await f.bridge.submit(f.request, replacement)).type, "completed"); assert.equal(f.calls.http, 1);
});

test("request, original lease and original cancellation are captured before awaited preparation", async t => {
  const f = await transcriptionFixture(t), original = new AbortController(), options = { ...context(f), signal: original.signal }, request = structuredClone(f.request);
  const prepare = f.preparation.prepare.bind(f.preparation);
  f.preparation.prepare = async (...args) => {
    assert.equal(args[1].signal, original.signal); const value = await prepare(...args);
    request.args.language = "zh"; options.signal = new AbortController().signal; original.abort(); return value;
  };
  const result = await f.bridge.submit(request, options); assert.equal(result.type, "rejected");
  assert.equal(rows(f, "transcription_execution_result")[0].observation.code, "LOCAL_CANCELLED"); assert.equal(f.calls.upload, 0); assert.equal(f.calls.http, 0);
});

test("an upload reader returning different bytes or receipt cannot reach mapping or credentials", async t => {
  for (const change of [upload => { upload.bytes[upload.bytes.length - 1] ^= 1; }, upload => { upload.receipt.audio.sha256 = "f".repeat(64); }]) {
    const f = await transcriptionFixture(t), read = f.files.readUpload.bind(f.files);
    f.files.readUpload = async (...args) => { const upload = await read(...args); change(upload); return upload; };
    assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected"); assert.equal(f.calls.credentials, 0);
    assert.equal(rows(f, "transcription_execution_mapping").length, 0); assert.equal(rows(f, "transcription_execution_dispatch").length, 0);
  }
});

test("source provenance changes during upload block the first dispatch", async t => {
  const f = await transcriptionFixture(t), read = f.files.readUpload.bind(f.files);
  f.files.readUpload = async (...args) => { const upload = await read(...args); f.store.db.prepare("DELETE FROM entities WHERE kind='narration_audio' AND id=?").run(f.audio.id); return upload; };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected"); assert.equal(f.calls.credentials, 0); assert.equal(f.calls.http, 0);
  assert.equal(rows(f, "transcription_execution_mapping").length, 0);
});

test("original signal and lease are checked again after the upload's final handoff", async t => {
  const f = await transcriptionFixture(t), read = f.files.readUpload.bind(f.files), controller = new AbortController();
  const options = { ...context(f), signal: controller.signal };
  f.files.readUpload = async (...args) => { const upload = await read(...args); options.signal = new AbortController().signal; controller.abort(); return upload; };
  assert.equal((await f.bridge.submit(f.request, options)).type, "rejected"); assert.equal(f.calls.credentials, 0);
  const g = await transcriptionFixture(t), other = g.files.readUpload.bind(g.files), old = context(g);
  g.files.readUpload = async (...args) => { const upload = await other(...args), replacement = replaceLease(g); Object.assign(old.expectedLease, replacement.expectedLease); return upload; };
  assert.equal((await g.bridge.submit(g.request, old)).type, "unknown"); assert.equal(rows(g, "transcription_execution_result").length, 0); assert.equal(g.calls.http, 0);
});

test("missing credentials are a local failure while a stale credential failure installs no terminal result", async t => {
  const f = await transcriptionFixture(t, { credential: () => undefined });
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected"); assert.equal(rows(f, "transcription_execution_result")[0].observation.code, "LOCAL_CREDENTIAL_UNAVAILABLE");
  assert.equal(rows(f, "transcription_execution_mapping").length, 1); assert.equal(f.calls.http, 0);
  let replacement, first = true; const g = await transcriptionFixture(t, { credential: () => { if (first) { first = false; replacement = replaceLease(g); throw Error("stale credential result"); } return key; } });
  assert.equal((await g.bridge.submit(g.request, context(g))).type, "unknown"); assert.equal(rows(g, "transcription_execution_result").length, 0);
  assert.equal((await g.bridge.submit(g.request, replacement)).type, "completed"); assert.equal(g.calls.http, 1);
});

test("durable marker excludes concurrent bridge submission and all replay avoids preparation", async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await transcriptionFixture(t, { fetch: async () => { entered.resolve(); await release.promise; return response(); } });
  const running = f.bridge.submit(f.request, context(f)); await entered.promise;
  try { assert.equal((await cloneBridge(f).submit(f.request, context(f))).type, "unknown"); assert.equal(f.calls.prepare, 1); }
  finally { release.resolve(); }
  assert.equal((await running).type, "completed"); assert.equal(f.calls.http, 1);
});

test("late actual completion is retained after lease loss without granting current publication", async t => {
  const f = await transcriptionFixture(t, { fetch: async () => { replaceLease(f); return response(); } });
  const result = await f.bridge.submit(f.request, context(f)); assert.equal(result.type, "completed");
  assert.equal(rows(f, "transcription_execution_result")[0].observation.outputReceiptId, result.receiptId);
  assert.equal(f.store.get("attempt", f.attempt.id).leaseOwner, "replacement-worker"); assert.equal(rows(f, "artifact").length, 1);
});

test("provider rejection and ambiguous response each retain one redacted result with no automatic retry", async t => {
  for (const [fetch, expected] of [[async () => new Response(JSON.stringify({ error: { message: "bad input", type: "invalid_request_error", code: "invalid_value" } }), { status: 400, headers: { "content-type": "application/json" } }), "rejected"],
    [async () => { throw Error("response lost"); }, "unknown"], [async () => response(Buffer.from("{")), "unknown"]]) {
    const f = await transcriptionFixture(t, { fetch }); const outcome = await f.bridge.submit(f.request, context(f)); assert.equal(outcome.type, expected);
    assert.deepEqual(await f.bridge.submit(f.request), outcome); assert.equal(f.calls.http, 1); assert.equal(f.calls.prepare, 1);
    assert.equal(rows(f, "execution_output_receipt").length, 0); assert.equal(rows(f, "transcription_execution_result").length, 1);
  }
});

test("no-speech and timing issues remain completed raw evidence without transcript adoption", async t => {
  for (const value of [payload({ text: "", words: [] }), payload({ words: [{ word: "Leather", start: 0.8, end: 2 }, { word: "boots.", start: 0.1, end: 0.9 }] })]) {
    const f = await transcriptionFixture(t, { fetch: async () => response(Buffer.from(JSON.stringify(value))) });
    assert.equal((await f.bridge.submit(f.request, context(f))).type, "completed");
    const result = rows(f, "transcription_execution_result")[0].observation.result;
    assert.equal(result.wordCount, value.words.length); assert.equal(result.timingIssueCount > 0, value.words.length > 0);
    assert.equal(rows(f, "transcript_candidate").length, 0); assert.equal(f.store.getProject(f.project.id).narration.script, "Leather boots.");
  }
});

test("receipt and redacted result commit atomically; lost result never repeats the POST", async t => {
  const f = await transcriptionFixture(t), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "transcription_execution_result") throw Error("synthetic result SQL failure"); return insert(...args); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown"); f.store.insert = insert;
  assert.equal(rows(f, "transcription_execution_dispatch").length, 1); assert.equal(rows(f, "transcription_execution_result").length, 0);
  assert.equal(rows(f, "execution_output_receipt").length, 0); assert.equal((await restart(f).bridge.lookup(f.attempt.id)).type, "unknown"); assert.equal(f.calls.http, 1);
});

test("filesystem output completion survives spool SQL rollback and reopens with no tools or credentials", async t => {
  const f = await transcriptionFixture(t), put = f.store.put.bind(f.store); let failed = false;
  f.store.put = (...args) => { if (args[0] === "execution_output_spool" && !failed) { failed = true; throw Error("synthetic spool SQL failure"); } return put(...args); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown"); f.store.put = put;
  assert.equal(rows(f, "execution_output_spool").length, 0); assert.equal(rows(f, "transcription_execution_result")[0].observation.kind, "completed");
  const reopened = restart(f), result = await reopened.bridge.lookup(f.attempt.id);
  assert.equal(result.type, "completed"); assert.equal(result.outputs[0].sha256, hash(raw)); assert.equal(f.calls.prepare, 1); assert.equal(f.calls.http, 1);
});

test("missing raw bytes after a completed observation stay unresolved instead of preparing or posting again", async t => {
  const f = await transcriptionFixture(t); f.outputs.spool = async () => { throw Error("no raw storage"); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown"); assert.equal((await restart(f).bridge.lookup(f.attempt.id)).type, "unknown");
  assert.equal(f.calls.http, 1); assert.equal(f.calls.prepare, 1);
});

for (const identical of [true, false]) test(`${identical ? "identical" : "different"} byte alternate winning receipt cannot replace the observed raw result`, async t => {
  const f = await transcriptionFixture(t), spool = f.outputs.spool.bind(f.outputs); let first = true;
  f.outputs.spool = async (projectId, receiptId, source, options) => {
    if (first) { first = false; const alternate = identical ? raw : Buffer.from(JSON.stringify(payload({ text: "Other text." })));
      const receipt = f.outputs.recordReceipt(projectId, { attemptId: f.attempt.id, expectedRequestDigest: digest(f.request), port: "cues", kind: "data", mimeType: "application/json",
        vendorTaskId: null, diagnosticRequestId: "alternate-observation", source: { kind: "returned_bytes", sha256: hash(alternate), byteLength: alternate.length } });
      await spool(projectId, receipt.id, async function* () { yield alternate; });
    }
    return spool(projectId, receiptId, source, options);
  };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown");
  const saved = rows(f, "transcription_execution_result")[0].observation;
  assert.notEqual((await f.outputs.recoverCompletion(f.project.id, f.attempt.id)).receiptId, saved.outputReceiptId);
  assert.equal((await restart(f).bridge.lookup(f.attempt.id)).type, "unknown"); assert.equal(f.calls.http, 1);
});

test("restoration is read-only until release and imported completed replay grants no new POST", async t => {
  const f = await transcriptionFixture(t), completed = await f.bridge.submit(f.request, context(f));
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64), sourceDatabaseSha256: "b".repeat(64),
    originalDataRoot: f.directory, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
  await assert.rejects(f.bridge.lookup(f.attempt.id), code("INSTALLATION_QUARANTINED"));
  const snapshot = new InstallationRecoveryGuard(f.store).snapshot(); releaseRecovery(f.store, { restoreId: snapshot.receipt.restoreId,
    expectedReceiptDigest: snapshot.receiptDigest, expectedSummaryDigest: snapshot.summaryDigest }, { principalId: "offline-human", commandId: randomUUID() });
  assert.deepEqual(await restart(f).bridge.lookup(f.attempt.id), completed); assert.equal(f.calls.http, 1);
});

test("caller request mutation during preparation cannot alter the frozen upload language or full request identity", async t => {
  let sentLanguage;
  const f = await transcriptionFixture(t, { language: "en", fetch: async (url, init) => { sentLanguage = (await new Request(url, { method: "POST", headers: init.headers, body: init.body }).formData()).get("language"); return response(); } });
  const request = structuredClone(f.request), prepare = f.preparation.prepare.bind(f.preparation);
  f.preparation.prepare = async (...args) => { const result = await prepare(...args); request.args.language = "zh"; request.inputs[0].sha256 = "f".repeat(64); return result; };
  assert.equal((await f.bridge.submit(request, context(f))).type, "completed"); assert.equal(sentLanguage, "en");
  assert.equal(rows(f, "transcription_execution_mapping")[0].requestDigest, digest(f.request));
});

test("source substitution after the mapping still cannot cross the first POST marker", async t => {
  const f = await transcriptionFixture(t, { credential: () => { f.store.db.prepare("DELETE FROM entities WHERE kind='narration_audio' AND id=?").run(f.audio.id); return key; } });
  await assert.rejects(f.bridge.submit(f.request, context(f)));
  assert.equal(rows(f, "transcription_execution_mapping").length, 1); assert.equal(rows(f, "transcription_execution_dispatch").length, 0); assert.equal(f.calls.http, 0);
});

test("original cancellation after saving actual response retains evidence but never reports a usable completion", async t => {
  const f = await transcriptionFixture(t), original = new AbortController(), options = { ...context(f), signal: original.signal }, insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { const result = insert(...args); if (args[0] === "transcription_execution_result") { options.signal = new AbortController().signal; original.abort(); } return result; };
  assert.equal((await f.bridge.submit(f.request, options)).type, "unknown"); f.store.insert = insert;
  assert.equal(rows(f, "transcription_execution_result")[0].observation.kind, "completed"); assert.equal(rows(f, "execution_output_receipt").length, 1);
  assert.equal(rows(f, "execution_output_spool").length, 0); assert.equal(f.calls.http, 1);
  assert.equal((await restart(f).bridge.lookup(f.attempt.id)).type, "unknown");
});

test("released restoration never starts an imported attempt that had no dispatch marker", async t => {
  const f = await transcriptionFixture(t);
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64), sourceDatabaseSha256: "b".repeat(64),
    originalDataRoot: f.directory, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
  const snapshot = new InstallationRecoveryGuard(f.store).snapshot(); releaseRecovery(f.store, { restoreId: snapshot.receipt.restoreId,
    expectedReceiptDigest: snapshot.receiptDigest, expectedSummaryDigest: snapshot.summaryDigest }, { principalId: "offline-human", commandId: randomUUID() });
  await assert.rejects(f.bridge.submit(f.request, context(f)), code("RESTORED_AUTHORITY_REQUIRES_NEW"));
  assert.equal((await f.bridge.lookup(f.attempt.id)).type, "unknown"); assert.deepEqual(f.calls, { http: 0, credentials: 0, prepare: 0, upload: 0 });
});
