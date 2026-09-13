import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { digest } from "../../../packages/core/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { OpenAISpeechExecution } from "../dist/execution/openai-speech-execution.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { speechFixture, context, rows, key, bytes, wave, hash, response, restart, restoreSpeechFixture, revoke } from "./speech-execution-fixture.mjs";

function replaceLease(f) {
  const attempt = f.store.get("attempt", f.attempt.id);
  const replacement = { ...attempt, leaseOwner: "replacement-worker", leaseEpoch: attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 };
  f.store.put("attempt", attempt.id, f.project.id, replacement); return replacement;
}
const replacementContext = attempt => ({ expectedLease: { owner: attempt.leaseOwner, epoch: attempt.leaseEpoch } });

test("real consumed admission precedes exact single speech POST, then raw owned completion is recoverable", async t => {
  const large = wave(1200000), f = speechFixture(t, { fetch: async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/audio/speech"); assert.equal(init.method, "POST");
    const mapping = rows(f, "speech_execution_mapping")[0], marker = rows(f, "speech_execution_dispatch")[0], consumed = rows(f, "external_allowance_consumption")[0];
    assert.equal(mapping.requestDigest, digest(f.request)); assert.notEqual(mapping.requestDigest, mapping.transport.requestDigest);
    assert.equal(mapping.profileDefinitionDigest, digest(f.profile)); assert.equal(mapping.consumptionDigest, digest(consumed));
    assert.equal(mapping.allowanceDigest, digest(f.allowance)); assert.equal(mapping.estimatedMicros, "100");
    assert.equal(mapping.capabilityLockDigest, digest(f.store.get("capability_lock", mapping.capabilityLockId)));
    assert.equal(marker.mappingDigest, digest(mapping)); assert.equal(marker.bodySha256, hash(init.body));
    assert.equal(marker.transportDigest, mapping.transport.requestDigest); assert.equal(mapping.bodyByteLength, init.body.byteLength);
    assert.equal(init.headers.Authorization, `Bearer ${key}`); assert.equal(init.headers["Idempotency-Key"], undefined);
    assert.deepEqual(JSON.parse(Buffer.from(init.body).toString()), { model: f.profile.configuration.model, voice: f.voice,
      input: f.text, instructions: f.instructions, response_format: "wav", stream_format: "audio", speed: 1 });
    return response(large);
  } });
  const spool = f.outputs.spool.bind(f.outputs), chunks = [];
  f.outputs.spool = async (projectId, receiptId, source, options) => {
    assert.equal(rows(f, "speech_execution_result")[0].observation.kind, "completed");
    return spool(projectId, receiptId, async function* () { for await (const value of source()) { chunks.push(value.byteLength); yield value; } }, options);
  };
  const completed = await f.bridge.submit(f.request, context(f));
  assert.equal(completed.type, "completed"); assert.equal(completed.version, 2); assert.equal(completed.vendorTaskId, null);
  assert.equal(completed.outputs[0].sha256, hash(large)); assert.equal(completed.outputs[0].port, "audio"); assert.equal(completed.outputs[0].fixture, false);
  assert.deepEqual(readFileSync((await f.outputs.resolveOwned(f.project.id, completed.receiptId)).path), large);
  assert.ok(chunks.length >= 3); assert.ok(chunks.every(size => size <= 1024 * 1024));
  assert.deepEqual(await f.bridge.submit(f.request), completed); assert.deepEqual(await f.bridge.lookup(f.attempt.id, f.request), completed);
  assert.equal((await f.bridge.poll("req-speech-diagnostic", f.request)).type, "unknown");
  assert.deepEqual(f.calls, { http: 1, credentials: 1 }); assert.equal(rows(f, "artifact").length, 0, "raw retention is separate from Engine publication");
  const evidence = JSON.stringify([rows(f, "speech_execution_mapping"), rows(f, "speech_execution_dispatch"), rows(f, "speech_execution_result")]);
  assert.ok(!evidence.includes(key) && !evidence.includes(f.directory) && !evidence.includes("bytesBase64"));
  assert.equal(rows(f, "speech_execution_result")[0].observation.result.usage, null);
  assert.deepEqual(await restart(f).bridge.lookup(f.attempt.id), completed);
});

test("registered speech does not substitute an allowance correlation for actual consumption", async t => {
  for (const kind of ["external_allowance_consumption", "external_allowance", "candidate", "grant", "reservation"]) {
    const f = speechFixture(t); f.store.db.prepare("DELETE FROM entities WHERE kind=?").run(kind);
    await assert.rejects(f.bridge.submit(f.request, context(f)), { code: "SPEECH_EXECUTION_CONFLICT" });
    assert.deepEqual(f.calls, { http: 0, credentials: 0 }); assert.equal(rows(f, "speech_execution_result").length, 0);
  }
});

test("unsupported text, voice, model and extra operation/profile settings fail before credentials without rewriting", async t => {
  for (const options of [{ text: "x".repeat(1792) }, { instructions: "x".repeat(257) }, { voice: "custom-voice" }, { model: "tts-1" },
    { profileSettings: { voice: "coral" } }, { settings: { speed: 2 } }]) {
    const f = speechFixture(t, options), outcome = await f.bridge.submit(f.request, context(f));
    assert.equal(outcome.type, "rejected"); assert.equal(outcome.retryAllowed, false);
    assert.equal(rows(f, "speech_execution_result")[0].observation.code, "LOCAL_INPUT_INVALID");
    assert.equal(rows(f, "speech_execution_dispatch").length, 0); assert.deepEqual(f.calls, { http: 0, credentials: 0 });
    assert.deepEqual(await f.bridge.lookup(f.attempt.id), outcome);
  }
});

test("first dispatch requires the captured original unexpired submitting lease", async t => {
  const f = speechFixture(t);
  await assert.rejects(f.bridge.submit(f.request), { code: "SPEECH_EXECUTION_NOT_DISPATCHABLE" });
  const original = context(f); replaceLease(f);
  await assert.rejects(f.bridge.submit(f.request, original), { code: "SPEECH_EXECUTION_NOT_DISPATCHABLE" });
  assert.deepEqual(f.calls, { http: 0, credentials: 0 }); assert.equal(rows(f, "speech_execution_result").length, 0);
  const g = speechFixture(t); g.store.put("attempt", g.attempt.id, g.project.id, { ...g.attempt, leaseExpiresAt: Date.now() - 1 });
  await assert.rejects(g.bridge.submit(g.request, context(g)), { code: "SPEECH_EXECUTION_NOT_DISPATCHABLE" });
  assert.equal(rows(g, "speech_execution_mapping").length, 0);
});

test("a stale local credential failure cannot preempt the replacement owner's first dispatch", async t => {
  let replacement, first = true;
  const f = speechFixture(t, { credential: () => {
    if (first) { first = false; replacement = replaceLease(f); throw Error("stale local credential failure"); }
    return key;
  } });
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown");
  assert.equal(rows(f, "speech_execution_result").length, 0); assert.equal(rows(f, "speech_execution_dispatch").length, 0);
  assert.equal((await f.bridge.submit(f.request, replacementContext(replacement))).type, "completed");
  assert.equal(f.calls.http, 1);
});

test("lease/context mutation during credential resolution cannot borrow replacement authority", async t => {
  let replacement, options;
  const f = speechFixture(t, { credential: () => { replacement = replaceLease(f); options.expectedLease.owner = replacement.leaseOwner;
    options.expectedLease.epoch = replacement.leaseEpoch; return key; } }); options = context(f);
  await assert.rejects(f.bridge.submit(f.request, options), { code: "SPEECH_EXECUTION_NOT_DISPATCHABLE" });
  assert.equal(f.calls.http, 0); assert.equal(rows(f, "speech_execution_result").length, 0); assert.equal(rows(f, "speech_execution_dispatch").length, 0);
});

test("request and original call context are copied before asynchronous HTTP", async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let sent;
  const f = speechFixture(t, { fetch: async (_url, init) => { sent = init; entered.resolve(); await release.promise; return response(); } });
  const request = structuredClone(f.request), options = context(f), pending = f.bridge.submit(request, options); await entered.promise;
  request.args.text = "changed"; request.profile.configuration.model = "changed"; options.expectedLease.owner = "changed";
  release.resolve(); assert.equal((await pending).type, "completed"); assert.equal(JSON.parse(Buffer.from(sent.body).toString()).input, f.text);
  await assert.rejects(f.bridge.submit(request, context(f))); assert.equal(f.calls.http, 1);
});

test("two SQLite workers share one dispatch marker and never issue a second synchronous POST", async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = speechFixture(t, { fetch: async () => { entered.resolve(); await release.promise; return response(); } });
  const store = new Store(f.path); f.stores.push(store);
  const second = new OpenAISpeechExecution({ store, outputStore: new ExecutionOutputStore(store, { rootDir: join(f.directory, "execution-output") }), credentials: f.credentials, fetch: f.fetch });
  const first = f.bridge.submit(f.request, context(f)); await entered.promise;
  try { assert.equal((await second.submit(f.request)).type, "unknown"); assert.deepEqual(f.calls, { http: 1, credentials: 1 }); }
  finally { release.resolve(); }
  const completed = await first; assert.equal(completed.type, "completed"); assert.deepEqual(await second.lookup(f.attempt.id), completed);
  assert.equal(rows(f, "speech_execution_dispatch").length, 1);
});

test("a late completed response retains exact evidence after lease replacement without changing attempt ownership", async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = speechFixture(t, { fetch: async () => { entered.resolve(); await release.promise; return response(); } });
  const pending = f.bridge.submit(f.request, context(f)); await entered.promise; const replacement = replaceLease(f);
  release.resolve(); const completed = await pending; assert.equal(completed.type, "completed");
  assert.equal(rows(f, "speech_execution_result")[0].observation.kind, "completed"); assert.deepEqual(f.store.get("attempt", f.attempt.id), replacement);
  assert.equal(rows(f, "artifact").length, 0); assert.deepEqual(await restart(f).bridge.lookup(f.attempt.id), completed);
});

test("definite local credential failures are durable only while owned and never auto-retry", async t => {
  for (const value of [undefined, "x".repeat(4097)]) {
    let credential = value; const f = speechFixture(t, { credential: () => credential });
    const result = await f.bridge.submit(f.request, context(f)); assert.equal(result.type, "rejected"); assert.equal(result.retryAllowed, false);
    assert.equal(rows(f, "speech_execution_result")[0].observation.code, "LOCAL_CREDENTIAL_UNAVAILABLE");
    credential = key; assert.deepEqual(await f.bridge.submit(f.request), result); assert.deepEqual(f.calls, { http: 0, credentials: 1 });
  }
});

test("original cancellation before dispatch records a definite local outcome without reading credentials", async t => {
  const f = speechFixture(t), controller = new AbortController(); controller.abort();
  const result = await f.bridge.submit(f.request, { ...context(f), signal: controller.signal });
  assert.equal(result.type, "rejected"); assert.equal(rows(f, "speech_execution_result")[0].observation.code, "LOCAL_CANCELLED");
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});

test("cancellation during credential lookup retains the original signal and proves no POST", async t => {
  const original = new AbortController(); let options;
  const f = speechFixture(t, { credential: () => { options.signal = new AbortController().signal; original.abort(); return key; } });
  options = { ...context(f), signal: original.signal };
  assert.equal((await f.bridge.submit(f.request, options)).type, "rejected");
  assert.equal(rows(f, "speech_execution_result")[0].observation.code, "LOCAL_CANCELLED");
  assert.equal(rows(f, "speech_execution_dispatch").length, 0); assert.deepEqual(f.calls, { http: 0, credentials: 1 });
});

test("original signal remains authoritative after dispatch and timeout/cancellation stays unknown", async t => {
  const entered = Promise.withResolvers(); let sent;
  const f = speechFixture(t, { fetch: async (_url, init) => { sent = init.signal; entered.resolve(); return new Promise(() => {}); } });
  const original = new AbortController(), options = { ...context(f), signal: original.signal }, pending = f.bridge.submit(f.request, options);
  await entered.promise; options.signal = new AbortController().signal; original.abort();
  assert.equal((await pending).type, "unknown"); assert.equal(sent.aborted, true); assert.equal(rows(f, "speech_execution_result")[0].observation.code, "SUBMISSION_ABORTED");
  assert.equal((await restart(f).bridge.submit(f.request)).type, "unknown"); assert.equal(f.calls.http, 1);
});

test("unknown HTTP outcomes redact diagnostics and never resolve another key or repeat POST after restart", async t => {
  const f = speechFixture(t, { fetch: async () => { throw Error(`${key} lost accepted response`); } });
  const unknown = await f.bridge.submit(f.request, context(f)); assert.equal(unknown.type, "unknown");
  assert.equal(rows(f, "speech_execution_result")[0].observation.kind, "unknown"); assert.ok(!JSON.stringify(rows(f, "speech_execution_result")).includes(key));
  const next = restart(f); assert.deepEqual(await next.bridge.lookup(f.attempt.id), unknown); assert.deepEqual(await next.bridge.submit(f.request), unknown);
  assert.deepEqual(f.calls, { http: 1, credentials: 1 });
});

test("provider not-accepted rejection retains reported retry delay without granting automatic retry", async t => {
  const f = speechFixture(t, { fetch: async () => new Response(JSON.stringify({ error: { type: "rate_limit_error", message: "private diagnostic" } }),
    { status: 429, headers: { "content-type": "application/json", "retry-after": "5" } }) });
  const rejected = await f.bridge.submit(f.request, context(f)); assert.equal(rejected.type, "rejected"); assert.equal(rejected.retryAllowed, false);
  const observation = rows(f, "speech_execution_result")[0].observation; assert.equal(observation.retryAfterMs, 5000); assert.equal(observation.source, "provider");
  assert.ok(!JSON.stringify(observation).includes("private diagnostic")); assert.deepEqual(await restart(f).bridge.lookup(f.attempt.id), rejected);
});

test("lost result transaction leaves the marker and no orphan byte receipt; restart stays unknown", async t => {
  const f = speechFixture(t), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "speech_execution_result") throw Error("result SQL rollback"); return insert(...args); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown"); f.store.insert = insert;
  assert.equal(rows(f, "speech_execution_dispatch").length, 1); assert.equal(rows(f, "speech_execution_result").length, 0); assert.equal(rows(f, "execution_output_receipt").length, 0);
  assert.equal((await restart(f).bridge.submit(f.request)).type, "unknown"); assert.equal(f.calls.http, 1);
});

test("filesystem spool publication repairs failed SQL installation after reopen without HTTP", async t => {
  const f = speechFixture(t), put = f.store.put.bind(f.store);
  f.store.put = (...args) => { if (args[0] === "execution_output_spool") throw Error("spool SQL rollback"); return put(...args); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown"); f.store.put = put;
  assert.equal(rows(f, "speech_execution_result")[0].observation.kind, "completed"); assert.equal(rows(f, "execution_output_spool").length, 0);
  const next = restart(f), result = await next.bridge.lookup(f.attempt.id); assert.equal(result.type, "completed");
  assert.deepEqual(readFileSync((await next.outputs.resolveOwned(f.project.id, result.receiptId)).path), bytes); assert.equal(f.calls.http, 1);
});

test("known completed response with bytes lost before spooling cannot regenerate", async t => {
  const f = speechFixture(t); f.outputs.spool = async () => { throw Error("disk unavailable before durable bytes"); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown");
  assert.equal(rows(f, "speech_execution_result")[0].observation.kind, "completed");
  const next = restart(f); assert.equal((await next.bridge.lookup(f.attempt.id)).type, "unknown"); assert.equal((await next.bridge.submit(f.request)).type, "unknown");
  assert.equal(f.calls.http, 1);
});

test("late storage cancellation retains immutable completion for a fresh read without another POST", async t => {
  const f = speechFixture(t), controller = new AbortController(), spool = f.outputs.spool.bind(f.outputs);
  f.outputs.spool = async (...args) => { const completed = await spool(...args); controller.abort(); return completed; };
  const result = await f.bridge.submit(f.request, { ...context(f), signal: controller.signal }); assert.equal(result.type, "unknown");
  assert.equal(rows(f, "execution_output_spool").length, 1); assert.equal((await restart(f).bridge.lookup(f.attempt.id)).type, "completed");
  assert.equal(f.calls.http, 1);
});

for (const sameBytes of [false, true]) test(`a different winning receipt cannot be rebound to speech even with ${sameBytes ? "identical" : "different"} bytes`, async t => {
  const f = speechFixture(t), other = sameBytes ? bytes : wave(48000), spool = f.outputs.spool.bind(f.outputs); let injected = false;
  f.outputs.spool = async (...args) => {
    if (!injected) {
      injected = true; const receipt = f.outputs.recordReceipt(f.project.id, { attemptId: f.attempt.id, expectedRequestDigest: digest(f.request),
        port: "audio", kind: "audio", mimeType: "audio/wav", vendorTaskId: null, diagnosticRequestId: "competing-diagnostic",
        source: { kind: "returned_bytes", sha256: hash(other), byteLength: other.length } });
      await spool(f.project.id, receipt.id, async function* () { yield other; });
    }
    return spool(...args);
  };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown");
  assert.equal((await restart(f).bridge.lookup(f.attempt.id)).type, "unknown"); assert.equal(f.calls.http, 1);
});

test("quarantine blocks all direct calls; release never revives an imported first POST", async t => {
  const f = speechFixture(t), release = restoreSpeechFixture(f);
  for (const operation of [() => f.bridge.submit(f.request, context(f)), () => f.bridge.lookup(f.attempt.id), () => f.bridge.poll("invented", f.request)])
    await assert.rejects(operation(), { code: "INSTALLATION_QUARANTINED" });
  release(); await assert.rejects(f.bridge.submit(f.request, context(f)), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  assert.equal((await f.bridge.lookup(f.attempt.id)).type, "unknown"); assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});

test("a released restoration recovers completed speech with unavailable credentials", async t => {
  const f = speechFixture(t), completed = await f.bridge.submit(f.request, context(f)), release = restoreSpeechFixture(f);
  await assert.rejects(f.bridge.lookup(f.attempt.id), { code: "INSTALLATION_QUARANTINED" }); release();
  assert.deepEqual(await restart(f).bridge.lookup(f.attempt.id), completed); assert.deepEqual(f.calls, { http: 1, credentials: 1 });
});

test("revocation and expiry stop new admissions without retroactively cancelling consumed speech", async t => {
  const f = speechFixture(t); revoke(f);
  const expires = Date.parse(f.allowance.expiresAt) + 1;
  f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseExpiresAt: expires + 30000 });
  t.mock.timers.enable({ apis: ["Date"], now: expires });
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "completed"); assert.equal(f.calls.http, 1);
  const g = speechFixture(t, { deferAdmission: true }); revoke(g); const result = await g.engine.runReady();
  assert.equal(result.dispatched, 0); assert.ok(result.blocked.some(item => item.code === "EXTERNAL_ALLOWANCE_UNAVAILABLE")); assert.equal(g.calls.http, 0);
});

test("historical matching lock is pinned for replay and cannot be replaced by a later equivalent lock", async t => {
  const f = speechFixture(t), oldLock = f.store.get("capability_lock", f.project.capabilityLockId), current = f.store.getProject(f.project.id), nextLockId = randomUUID();
  f.store.insert("capability_lock", nextLockId, f.project.id, { profiles: [{ ...f.profile, unitCostMicros: "200" }] });
  f.store.saveProject({ ...current, capabilityLockId: nextLockId }, current.headVersion);
  const completed = await f.bridge.submit(f.request, context(f)); assert.equal(completed.type, "completed");
  const mapping = rows(f, "speech_execution_mapping")[0]; assert.equal(mapping.capabilityLockId, oldLock.id); assert.equal(mapping.capabilityLockDigest, digest(oldLock));
  const equivalent = randomUUID(); f.store.insert("capability_lock", equivalent, f.project.id, { profiles: [f.profile] });
  f.store.db.prepare("DELETE FROM entities WHERE kind='capability_lock' AND id=?").run(oldLock.id);
  await assert.rejects(f.bridge.lookup(f.attempt.id), { code: "SPEECH_EXECUTION_CONFLICT" }); assert.equal(f.calls.http, 1);
});

test("changed admitted request, profile estimate and foreign request cannot reuse speech authorization", async t => {
  const f = speechFixture(t);
  for (const mutate of [r => { r.args.text += "changed"; }, r => { r.profile.revision = "other"; }, r => { r.externalAllowanceId = randomUUID(); },
    r => { r.inputs.push({ artifactId: "foreign", kind: "audio", sha256: "a".repeat(64) }); }]) {
    const request = structuredClone(f.request); mutate(request); await assert.rejects(f.bridge.submit(request, context(f)));
  }
  f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.micros','200') WHERE kind='reservation' AND id=?").run(f.attempt.reservationId);
  await assert.rejects(f.bridge.submit(f.request, context(f))); assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});
