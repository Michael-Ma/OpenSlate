import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { canonical, digest } from "../../../packages/core/dist/index.js";
import { response } from "./transcription-execution-fixture.mjs";
import { addSecondTranscription, current, deferred, due, eventually, liability, preparationEngineFixture, replan, rows, useOutputSource } from "./transcription-preparation-engine-fixture.mjs";

test("repeated preparation contention keeps one attempt, candidate, reservation and permanently consumed allowance", async t => {
  const f = await preparationEngineFixture(t);
  assert.equal((await f.engine.runReady()).dispatched, 1);
  const first = current(f), saved = liability(f), proof = rows(f, "transcription_preparation_intent")[0];
  assert.equal(first.phase, "preparing"); assert.equal(first.preparation.intentId, first.id); assert.equal(first.preparation.intentDigest, digest(proof));
  assert.equal(proof.source.artifactId, f.audio.id); assert.equal(proof.sourceEndSample, 48000);
  assert.equal(first.leaseExpiresAt, 0); assert.equal(rows(f, "external_allowance_consumption").length, 1);
  for (let cycle = 0; cycle < 4; cycle++) {
    const previous = current(f), before = Date.now(); due(f);
    assert.equal((await f.engine.reconcile()).reconciled, 1);
    const waiting = current(f); assert.equal(waiting.phase, "preparing");
    assert.ok(waiting.preparation.waitCount > previous.preparation.waitCount);
    assert.ok(waiting.preparation.nextEligibleAt >= before + 500 && waiting.preparation.nextEligibleAt <= Date.now() + 5000);
    assert.deepEqual(liability(f), saved); assert.deepEqual(rows(f, "transcription_preparation_intent"), [proof]);
    await f.engine.runReady(); assert.equal(f.calls.starts, 1);
  }
  assert.equal(f.calls.http, 0); assert.equal(f.calls.credentials, 0); assert.equal(f.calls.submits, 0); assert.equal(f.calls.lookups, 0);
  assert.equal(rows(f, "transcription_execution_result").length, 0);
  f.control.busy = false; due(f); await f.engine.reconcile();
  assert.equal(current(f).phase, "ingesting"); // This scheduler fixture intentionally installs no data ingester.
  assert.equal(f.calls.http, 1); assert.equal(f.calls.starts, 1); assert.equal(f.calls.resumes, 5);
  assert.deepEqual(liability(f), saved); assert.equal(rows(f, "transcription_execution_dispatch").length, 1);
});

test("not-yet-due waiting work does not claim a lease or repeat local preparation", async t => {
  const f = await preparationEngineFixture(t); await f.engine.runReady();
  const before = current(f), calls = { ...f.calls };
  f.store.put("attempt", before.id, f.project.id, { ...before, preparation: { ...before.preparation, nextEligibleAt: Date.now() + 5000 } });
  const saved = current(f); assert.equal((await f.engine.reconcile()).reconciled, 0);
  assert.deepEqual(current(f), saved); assert.deepEqual(f.calls, calls);
});

test("two admitted transcriptions defer independently in one cycle without repeating either spending consumption", async t => {
  const f = await preparationEngineFixture(t); addSecondTranscription(f);
  assert.equal((await f.engine.runReady()).dispatched, 2);
  const saved = liability(f); assert.equal(saved.attempts.length, 2); assert.equal(saved.consumptions.length, 2);
  assert.equal(new Set(saved.attempts.map(item => item.reservationId)).size, 2);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const attempt of rows(f, "attempt")) f.store.put("attempt", attempt.id, f.project.id,
      { ...attempt, leaseExpiresAt: 0, preparation: { ...attempt.preparation, nextEligibleAt: 0 } });
    assert.equal((await f.engine.reconcile()).reconciled, 2);
    assert.ok(rows(f, "attempt").every(item => item.phase === "preparing" && item.leaseExpiresAt === 0));
    assert.deepEqual(liability(f), saved);
  }
  assert.equal(f.calls.starts, 2); assert.equal(f.calls.resumes, 6); assert.equal(f.calls.lookups, 0); assert.equal(f.calls.http, 0);
  assert.equal(rows(f, "transcription_preparation_intent").length, 2);
});

test("two SQLite workers claim one due preparation while the first retains its original lease", async t => {
  const f = await preparationEngineFixture(t, { leaseMs: 150 }), entered = deferred(), release = deferred();
  await f.engine.runReady(); due(f); const before = current(f), saved = liability(f), peer = f.peer();
  let signal;
  f.control.beforePrepare = async value => { signal = value.options.signal; entered.resolve(); await release.promise; };
  const pending = f.engine.reconcile(); await entered.promise;
  try {
    const owned = current(f); assert.equal(owned.leaseEpoch, before.leaseEpoch + 1); assert.equal(owned.phase, "preparing");
    await eventually(() => current(f).leaseExpiresAt > owned.leaseExpiresAt);
    assert.equal((await peer.engine.reconcile()).reconciled, 0); assert.equal(f.calls.resumes, 1); assert.equal(signal.aborted, false);
    assert.deepEqual(liability(f), saved);
  } finally { release.resolve(); await pending; }
  assert.equal(current(f).phase, "preparing"); assert.equal(f.calls.http, 0);
});

test("an obsolete worker's late local failure cannot settle or overwrite the replacement Store's waiting lease", async t => {
  const f = await preparationEngineFixture(t, { leaseMs: 150 }), entered = deferred(), release = deferred(), peer = f.peer(); let signal;
  f.control.beforePrepare = async value => {
    if (value.store !== f.store) return;
    signal = value.options.signal; entered.resolve(); await release.promise;
  };
  const pending = f.engine.runReady(); await entered.promise;
  const before = current(f), saved = liability(f);
  due(f); await peer.engine.reconcile();
  const replacement = current(f); assert.equal(replacement.leaseOwner, peer.engine.workerId); assert.equal(replacement.leaseEpoch, before.leaseEpoch + 1);
  try { await eventually(() => signal.aborted); } finally { release.resolve(); await pending; }
  assert.deepEqual(current(f), replacement); assert.deepEqual(liability(f), saved);
  assert.equal(rows(f, "transcription_execution_result").length, 0); assert.equal(rows(f, "execution_evidence").length, 0); assert.equal(f.calls.http, 0);
});

for (const control of ["pause", "hold"]) test(`${control} defers due preparation and release continues the same consumed work`, async t => {
  const f = await preparationEngineFixture(t); await f.engine.runReady(); due(f);
  const saved = liability(f), beforeCalls = f.calls.prepare;
  const hold = control === "hold" ? f.engine.setHold(f.project.id, { scopeId: f.project.id, ownerId: "human-review" }) : undefined;
  if (control === "pause") f.engine.setPaused(f.project.id, true, "human-pause");
  await f.engine.reconcile(); assert.equal(current(f).phase, "preparing"); assert.equal(f.calls.prepare, beforeCalls);
  assert.deepEqual(liability(f), saved); assert.equal(f.calls.http, 0);
  if (hold) f.engine.releaseHold(f.project.id, hold.id, "human-review"); else f.engine.setPaused(f.project.id, false, "human-resume");
  f.control.busy = false; due(f); await f.engine.reconcile();
  assert.equal(f.calls.http, 1); assert.equal(current(f).phase, "ingesting"); assert.deepEqual(liability(f), saved);
});

test("pause during asynchronous local work aborts its original signal and preserves preparing rather than unknown", async t => {
  const f = await preparationEngineFixture(t, { leaseMs: 150 }), entered = deferred(), release = deferred();
  let signal;
  f.control.beforePrepare = async value => { signal = value.options.signal; entered.resolve(); await release.promise; };
  const pending = f.engine.runReady(); await entered.promise;
  f.engine.setPaused(f.project.id, true, "human-pause");
  try { await eventually(() => signal.aborted); } finally { release.resolve(); await pending; }
  assert.equal(current(f).phase, "preparing"); assert.equal(rows(f, "reservation")[0].state, "reserved");
  assert.equal(rows(f, "transcription_execution_dispatch").length, 0); assert.equal(rows(f, "transcription_execution_result").length, 0);
  assert.equal(rows(f, "execution_evidence").length, 0); assert.equal(f.calls.http, 0);
  f.control.beforePrepare = undefined; f.control.busy = false;
  f.engine.setPaused(f.project.id, false, "human-resume"); due(f); await f.engine.reconcile(); assert.equal(f.calls.http, 1);
});

test("unrelated project and plan revisions preserve exact waiting work and its original preparation proof", async t => {
  const f = await preparationEngineFixture(t); await f.engine.runReady();
  const saved = liability(f), proof = rows(f, "transcription_preparation_intent")[0], original = f.store.getProject(f.project.id);
  replan(f); const next = f.store.getProject(f.project.id);
  assert.notEqual(next.activePlanId, original.activePlanId); assert.notEqual(next.revisionId, original.revisionId);
  assert.equal(f.store.get("node_binding", f.node.id).candidateId, current(f).candidateId);
  f.control.busy = false; due(f); await f.engine.reconcile();
  assert.equal(f.calls.http, 1); assert.deepEqual(liability(f), saved); assert.deepEqual(rows(f, "transcription_preparation_intent"), [proof]);
});

test("an edit during awaited preparation aborts the old signal and settles only that obsolete unstarted attempt", async t => {
  const f = await preparationEngineFixture(t, { leaseMs: 150 }), entered = deferred(), release = deferred(); let signal;
  f.control.beforePrepare = async value => { signal = value.options.signal; entered.resolve(); await release.promise; };
  const running = f.engine.runReady(); await entered.promise;
  replan(f, { language: "en" });
  try { await eventually(() => signal.aborted); } finally { release.resolve(); await running; }
  assert.equal(current(f).phase, "failed"); assert.equal(rows(f, "reservation")[0].state, "released");
  assert.equal(rows(f, "external_allowance_consumption").length, 1); assert.equal(f.calls.http, 0);
  assert.equal(rows(f, "transcription_execution_dispatch").length, 0);
});

test("an edit after verified upload bytes returns prevents the first marker while retaining useful local derivative evidence", async t => {
  const f = await preparationEngineFixture(t), read = f.files.readUpload.bind(f.files);
  f.files.readUpload = async (...args) => { const upload = await read(...args); replan(f, { language: "en" }); return upload; };
  f.control.busy = false; await f.engine.runReady();
  assert.equal(current(f).phase, "failed"); assert.equal(rows(f, "reservation")[0].state, "released");
  assert.equal(rows(f, "transcription_audio_receipt").length, 1); assert.equal(rows(f, "transcription_execution_dispatch").length, 0);
  assert.equal(f.calls.http, 0); assert.equal(f.calls.credentials, 0); assert.equal(rows(f, "external_allowance_consumption").length, 1);
});

for (const replacement of ["candidate", "specification", "retired"]) test(`${replacement} replacement cancels only obsolete pre-marker work and never refunds consumed allowance capacity`, async t => {
  const f = await preparationEngineFixture(t); await f.engine.runReady();
  const consumed = rows(f, "external_allowance_consumption"), original = current(f);
  if (replacement === "retired") replan(f, { alias: "replacement-transcript" });
  else replan(f, replacement === "candidate" ? { freshCandidate: true } : { language: "en" });
  due(f); await f.engine.reconcile();
  assert.equal(current(f).id, original.id); assert.equal(current(f).phase, "failed");
  assert.equal(rows(f, "reservation")[0].state, "released"); assert.deepEqual(rows(f, "external_allowance_consumption"), consumed);
  assert.equal(f.calls.http, 0); assert.equal(f.calls.prepare, 1); assert.equal(f.calls.lookups, 0);
  assert.equal(rows(f, "transcription_execution_dispatch").length, 0);
});

test("identical bytes under a different upstream artifact identity obsolete waiting input despite an unchanged effective hash", async t => {
  const f = await preparationEngineFixture(t), upstreamId = useOutputSource(f);
  await f.engine.runReady(); const old = current(f), consumed = rows(f, "external_allowance_consumption");
  const original = f.store.get("artifact", f.audio.id), id = randomUUID();
  const replacement = { ...original, id, artifact: { ...original.artifact, artifactId: id } };
  // The controlled upstream output has independently selected another ID for the exact same existing owned bytes.
  f.store.insert("artifact", id, f.project.id, replacement);
  const binding = f.store.get("node_binding", upstreamId);
  f.store.put("node_binding", upstreamId, f.project.id, { ...binding, outputs: { audio: replacement.artifact } });
  const resolved = f.engine.resolveInputs(f.project.id, f.node);
  assert.equal(resolved.fingerprint, old.fingerprint); assert.notEqual(resolved.artifacts[0].artifactId, old.request.inputs[0].artifactId);
  due(f); await f.engine.reconcile();
  assert.equal(current(f).phase, "failed"); assert.equal(rows(f, "reservation")[0].state, "released");
  assert.deepEqual(rows(f, "external_allowance_consumption"), consumed); assert.equal(f.calls.http, 0); assert.equal(f.calls.prepare, 1);
});

test("interruption after installed local proof reopens into dedicated preparation without ordinary lookup", async t => {
  const f = await preparationEngineFixture(t);
  f.control.afterOutcome = () => { throw Error("synthetic worker interruption before its deferral handoff"); };
  await f.engine.runReady();
  assert.equal(current(f).phase, "preparing"); assert.equal(rows(f, "transcription_preparation_intent").length, 1);
  const saved = liability(f); f.control.afterOutcome = undefined; f.control.busy = false; f.reopen(); due(f);
  await f.engine.reconcile(); assert.equal(f.calls.http, 1); assert.equal(f.calls.lookups, 0); assert.equal(f.calls.starts, 1);
  assert.deepEqual(liability(f), saved); assert.equal(current(f).phase, "ingesting");
});

test("a crash before protocol installation remains ordinary unknown recovery and cannot enter preparation", async t => {
  const f = await preparationEngineFixture(t);
  f.control.beforeStart = () => { throw Error("synthetic crash before protocol installation"); };
  await f.engine.runReady(); assert.equal(current(f).phase, "submission_unknown");
  assert.equal(rows(f, "transcription_preparation_intent").length, 0); const saved = liability(f);
  f.control.beforeStart = undefined; f.reopen(); await f.engine.reconcile();
  assert.equal(current(f).phase, "submission_unknown"); assert.equal(f.calls.lookups, 1); assert.equal(f.calls.resumes, 0);
  assert.equal(f.calls.prepare, 0); assert.equal(f.calls.http, 0); assert.deepEqual(liability(f), saved);
});

test("post-marker interruption recovers only observations and never prepares or submits again after reopen", async t => {
  const f = await preparationEngineFixture(t, { fetch: async () => { throw Error("synthetic lost provider response"); } });
  f.control.busy = false; await f.engine.runReady();
  assert.equal(current(f).phase, "submission_unknown"); assert.equal(rows(f, "transcription_execution_dispatch").length, 1);
  const saved = liability(f), prepareCalls = f.calls.prepare; f.reopen();
  await f.engine.reconcile(); await f.engine.runReady();
  assert.equal(f.calls.http, 1); assert.equal(f.calls.prepare, prepareCalls); assert.equal(f.calls.resumes, 0); assert.equal(f.calls.lookups, 1);
  assert.deepEqual(liability(f), saved); assert.equal(current(f).phase, "submission_unknown");
});

test("pause after the dispatch marker does not abort or discard the actual provider observation", async t => {
  const entered = deferred(), release = deferred(); let signal;
  const f = await preparationEngineFixture(t, { leaseMs: 150, fetch: async (_url, options) => { signal = options.signal; entered.resolve(); await release.promise; return response(); } });
  f.control.busy = false; const running = f.engine.runReady(); await entered.promise;
  const atDispatch = current(f); assert.equal(atDispatch.phase, "submitting"); assert.equal(rows(f, "transcription_execution_dispatch").length, 1);
  f.engine.setPaused(f.project.id, true, "human-pause");
  try { await eventually(() => current(f).leaseExpiresAt > atDispatch.leaseExpiresAt); assert.equal(signal.aborted, false); }
  finally {
    release.resolve();
    // This fixture omits data ingestion; the completed provider observation still reaches its durable ingesting boundary.
    await assert.rejects(running, { code: "INVALID_PROVIDER_OUTPUT" });
  }
  assert.equal(current(f).phase, "ingesting"); assert.equal(f.calls.http, 1);
  assert.equal(rows(f, "transcription_execution_result")[0].observation.kind, "completed");
  assert.equal(rows(f, "execution_output_spool").length, 1); assert.equal(rows(f, "reservation")[0].state, "reserved");
});

test("missing preparation proof fails closed without lease takeover, local work or ordinary provider lookup", async t => {
  const f = await preparationEngineFixture(t); await f.engine.runReady(); due(f);
  f.store.db.prepare("DELETE FROM entities WHERE kind='transcription_preparation_intent' AND id=?").run(current(f).id);
  const saved = canonical(current(f)), before = { ...f.calls }, result = await f.engine.reconcile();
  assert.ok(result.blocked?.some(item => item.attemptId === current(f).id));
  assert.equal(canonical(current(f)), saved); assert.deepEqual(f.calls, before); assert.equal(rows(f, "reservation")[0].state, "reserved");
});

test("a missing preparation port isolates waiting work without pretending provider lookup may submit it", async t => {
  const f = await preparationEngineFixture(t); await f.engine.runReady(); due(f);
  const unavailable = f.makeWorker(f.store, { submissionPreparation: undefined }), saved = canonical(current(f)), calls = { ...f.calls };
  const result = await unavailable.engine.reconcile(); assert.ok(result.blocked?.some(item => item.attemptId === current(f).id));
  assert.equal(canonical(current(f)), saved); assert.deepEqual(f.calls, calls); assert.equal(rows(f, "reservation")[0].state, "reserved");
});
