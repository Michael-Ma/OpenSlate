import test from "node:test";
import assert from "node:assert/strict";
import { digest, DomainError } from "../../../packages/core/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { OpenAITranscriptionExecution } from "../dist/execution/openai-transcription-execution.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { TranscriptionAudioService } from "../dist/execution/transcription-audio-service.js";
import { createTranscriptionPreparationIntent, assertTranscriptionPreparationIntent, resolveTranscriptionPreparationIntent } from "../dist/execution/transcription-preparation.js";
import { assertSubmissionPreparationEligibility, snapshotSubmissionPreparationContext } from "../dist/execution/submission-preparation.js";
import { transcriptionFixture, rows, response } from "./transcription-execution-fixture.mjs";
import { join } from "node:path";

function latch() { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; }
const busy = () => { throw new DomainError("MEDIA_BUSY", "Synthetic shared worker is occupied"); };
const current = f => f.store.get("attempt", f.attempt.id);
function context(f, eligibility = () => ({ type: "ready" }), signal = new AbortController().signal) {
  const saved = current(f); return { signal, expectedLease: { owner: saved.leaseOwner, epoch: saved.leaseEpoch }, eligibility };
}
function reclaim(f) {
  const saved = current(f);
  f.store.put("attempt", saved.id, saved.projectId, { ...saved, leaseOwner: "preparation-replacement", leaseEpoch: saved.leaseEpoch + 1,
    leaseExpiresAt: Date.now() + 30000 });
  return context(f);
}
const result = f => rows(f, "transcription_execution_result")[0];
const noDispatch = f => { assert.equal(rows(f, "transcription_execution_dispatch").length, 0); assert.equal(f.calls.http, 0); };

test("proof pins admission and source without IO and stays independent of mutable lease/reservation state", async t => {
  const f = await transcriptionFixture(t), before = { ...f.calls };
  const proof = createTranscriptionPreparationIntent(f.store, f.attempt);
  assert.deepEqual(f.calls, before); assert.equal(proof.id, f.attempt.id); assert.equal(proof.source.artifactId, f.audio.id);
  assert.equal(proof.sourceStartSample, 0); assert.equal(proof.sourceEndSample, 48000);
  const reservation = f.store.get("reservation", f.attempt.reservationId);
  f.store.put("reservation", reservation.id, reservation.projectId, { ...reservation, state: "released" });
  f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, phase: "failed", leaseEpoch: 7, leaseExpiresAt: 0 });
  assertTranscriptionPreparationIntent(f.store, current(f), proof);
  assert.deepEqual(createTranscriptionPreparationIntent(f.store, current(f)), proof);
});

test("proof rejects forged source/approval fields and accessors without invoking them", async t => {
  const f = await transcriptionFixture(t), proof = createTranscriptionPreparationIntent(f.store, f.attempt);
  for (const edit of [v => { v.sourceEndSample--; }, v => { v.consumptionDigest = "f".repeat(64); },
    v => { v.reservation.micros = "101"; }, v => { v.candidateDigest = "f".repeat(64); }, v => { v.extra = true; }]) {
    const changed = structuredClone(proof); edit(changed);
    assert.throws(() => assertTranscriptionPreparationIntent(f.store, f.attempt, changed), { code: "SUBMISSION_PREPARATION_INVALID" });
  }
  let invoked = 0; const forged = { ...proof };
  Object.defineProperty(forged, "source", { enumerable: true, get() { invoked++; return proof.source; } });
  assert.throws(() => assertTranscriptionPreparationIntent(f.store, f.attempt, forged), { code: "SUBMISSION_PREPARATION_INVALID" });
  assert.equal(invoked, 0);
});

test("context snapshots originals and rejects asynchronous or accessor-based eligibility", () => {
  const controller = new AbortController(), options = { signal: controller.signal, expectedLease: { owner: "one", epoch: 1 }, eligibility: () => ({ type: "ready" }) };
  const saved = snapshotSubmissionPreparationContext(options); options.expectedLease.owner = "two"; options.signal = new AbortController().signal;
  options.eligibility = () => ({ type: "obsolete", reason: "binding_changed" });
  assert.equal(saved.signal, controller.signal); assert.equal(saved.expectedLease.owner, "one"); assertSubmissionPreparationEligibility(saved);
  assert.throws(() => assertSubmissionPreparationEligibility({ ...saved, eligibility: async () => ({ type: "ready" }) }), { code: "SUBMISSION_PREPARATION_INVALID" });
  let invoked = 0;
  assert.throws(() => assertSubmissionPreparationEligibility({ ...saved, eligibility: () => ({ get type() { invoked++; return "ready"; } }) }), { code: "SUBMISSION_PREPARATION_INVALID" });
  assert.throws(() => snapshotSubmissionPreparationContext({ ...saved, get signal() { invoked++; return controller.signal; } }), { code: "SUBMISSION_PREPARATION_INVALID" });
  assert.equal(invoked, 0);
});

for (const reason of ["paused", "held"]) test(`initial ${reason} installs proof before local IO and retains the consumed start`, async t => {
  const f = await transcriptionFixture(t), before = { ...f.calls };
  const outcome = await f.bridge.start(f.request, context(f, () => ({ type: "deferred", reason })));
  const saved = current(f), proof = resolveTranscriptionPreparationIntent(f.store, saved);
  assert.deepEqual(outcome, { type: "preparation_deferred", intentId: proof.id, intentDigest: digest(proof), reason });
  assert.equal(saved.phase, "preparing"); assert.deepEqual(saved.preparation, { intentId: proof.id, intentDigest: digest(proof), waitCount: 0, nextEligibleAt: 0 });
  assert.deepEqual(f.calls, before); assert.equal(result(f), undefined); noDispatch(f);
  assert.equal(rows(f, "external_allowance_consumption").length, 1); assert.equal(f.store.get("reservation", saved.reservationId).state, "reserved");
});

test("busy preparation is installed before first await; lookup/direct submit never resume it", async t => {
  const f = await transcriptionFixture(t), prepare = f.preparation.prepare;
  f.preparation.prepare = async (attempt, options) => {
    assert.equal(attempt.phase, "preparing"); assert.equal(current(f).phase, "preparing");
    assert.equal(resolveTranscriptionPreparationIntent(f.store, current(f)).id, f.attempt.id);
    assert.ok(options.submissionPreparation); busy();
  };
  const deferred = await f.bridge.start(f.request, context(f)); assert.equal(deferred.reason, "local_media_busy");
  const preparingEvents = () => f.store.readEvents(f.project.id).filter(event => event.kind === "attempt.state_changed"
    && event.payload.attemptId === f.attempt.id && event.payload.phase === "preparing");
  assert.equal(preparingEvents().length, 1);
  assert.equal(result(f), undefined); noDispatch(f);
  f.preparation.prepare = () => { throw Error("ordinary observation must not prepare"); };
  const before = { ...f.calls };
  assert.equal((await f.bridge.lookup(f.attempt.id)).type, "unknown");
  assert.equal((await f.bridge.submit(f.request, { expectedLease: context(f).expectedLease })).type, "unknown");
  assert.deepEqual(f.calls, before);
  f.preparation.prepare = prepare;
  const completed = await f.bridge.resume(f.request, reclaim(f)); assert.equal(completed.type, "completed");
  assert.equal(f.calls.http, 1); assert.equal(rows(f, "attempt").length, 1); assert.equal(rows(f, "external_allowance_consumption").length, 1);
  assert.equal(current(f).phase, "submitting"); assert.equal(current(f).preparation.intentDigest, deferred.intentDigest);
  assert.equal(preparingEvents().length, 1);
});

test("initial obsolete work retains proven pre-marker state for Engine settlement", async t => {
  const f = await transcriptionFixture(t), before = { ...f.calls };
  await assert.rejects(f.bridge.start(f.request, context(f, () => ({ type: "obsolete", reason: "binding_changed" }))), { code: "SUBMISSION_PREPARATION_OBSOLETE" });
  assert.equal(current(f).phase, "preparing"); assert.ok(resolveTranscriptionPreparationIntent(f.store, current(f)));
  assert.deepEqual(f.calls, before); assert.equal(result(f), undefined); noDispatch(f);
});

test("original cancellation during preparation remains deferred despite caller option mutation", async t => {
  const f = await transcriptionFixture(t), entered = latch(), release = latch(), controller = new AbortController();
  const options = context(f, () => ({ type: "ready" }), controller.signal);
  f.preparation.prepare = async (_attempt, received) => { assert.equal(received.signal, controller.signal); entered.release(); await release.promise; throw new DomainError("MEDIA_CANCELLED", "cancelled"); };
  const running = f.bridge.start(f.request, options);
  try {
    await entered.promise; options.signal = new AbortController().signal; options.expectedLease.owner = "forged";
    options.eligibility = () => ({ type: "ready", extra: true }); controller.abort(); release.release();
    const outcome = await running; assert.equal(outcome.type, "preparation_deferred"); assert.equal(outcome.reason, "cancelled");
    assert.equal(result(f), undefined); noDispatch(f); assert.equal(current(f).phase, "preparing");
  } finally { release.release(); await running.catch(() => {}); }
});

test("late pre-marker error cannot settle a replacement lease; reopened owner resumes exact proof", async t => {
  const f = await transcriptionFixture(t), entered = latch(), release = latch();
  f.preparation.prepare = async () => { entered.release(); await release.promise; throw Error("late local failure"); };
  const running = f.bridge.start(f.request, context(f));
  try {
    await entered.promise; reclaim(f); const winner = current(f); release.release();
    await assert.rejects(running, { code: "SUBMISSION_PREPARATION_LEASE_LOST" });
    assert.deepEqual(current(f), winner); assert.equal(result(f), undefined); noDispatch(f);
  } finally { release.release(); await running.catch(() => {}); }
  f.store.close(); const store = new Store(f.path); f.stores.push(store); f.store = store;
  const outputs = new ExecutionOutputStore(store, { rootDir: join(f.directory, "execution-output") });
  const preparation = new TranscriptionAudioService(store, f.media, f.files);
  const bridge = new OpenAITranscriptionExecution({ store, outputStore: outputs, preparation, credentials: f.credentials, fetch: f.fetch });
  const completed = await bridge.resume(f.request, context(f)); assert.equal(completed.type, "completed");
  assert.equal(f.calls.http, 1); assert.equal(rows(f, "external_allowance_consumption").length, 1);
});

test("eligibility after upload blocks obsolete work before credentials or marker", async t => {
  const f = await transcriptionFixture(t), upload = f.files.readUpload.bind(f.files); let state = { type: "ready" };
  f.files.readUpload = async (...args) => { const value = await upload(...args); state = { type: "obsolete", reason: "inputs_changed" }; return value; };
  await assert.rejects(f.bridge.start(f.request, context(f, () => state)), { code: "SUBMISSION_PREPARATION_OBSOLETE" });
  assert.equal(f.calls.credentials, 0); assert.equal(result(f), undefined); noDispatch(f);
  assert.ok(rows(f, "transcription_audio_receipt").length); assert.equal(current(f).phase, "preparing");
});

test("definite owned invalid input remains not_dispatched rather than an automatic local retry", async t => {
  const f = await transcriptionFixture(t);
  f.preparation.prepare = async () => { throw new DomainError("TRANSCRIPTION_AUDIO_CONFLICT", "private fixture detail"); };
  const outcome = await f.bridge.start(f.request, context(f)); assert.equal(outcome.type, "rejected");
  assert.deepEqual(result(f).observation, { kind: "not_dispatched", code: "LOCAL_INPUT_INVALID" });
  assert.equal(JSON.stringify(result(f)).includes("private fixture detail"), false); noDispatch(f);
  f.preparation.prepare = () => { throw Error("terminal local result cannot prepare again"); };
  assert.equal((await f.bridge.resume(f.request, context(f))).type, "rejected");
});

test("after unique marker, changed eligibility cannot discard a real provider observation", async t => {
  let state = { type: "ready" };
  const f = await transcriptionFixture(t, { fetch: async () => {
    assert.equal(current(f).phase, "submitting"); assert.equal(rows(f, "transcription_execution_dispatch").length, 1);
    state = { type: "obsolete", reason: "binding_changed" }; return response();
  } });
  const outcome = await f.bridge.start(f.request, context(f, () => state)); assert.equal(outcome.type, "completed");
  assert.equal(result(f).observation.kind, "completed"); assert.equal(f.calls.http, 1);
  f.preparation.prepare = () => { throw Error("marker replay cannot prepare"); };
  f.credentials.resolve = () => { throw Error("marker replay cannot load keys"); };
  assert.equal((await f.bridge.resume(f.request, context(f, () => state))).type, "completed"); assert.equal(f.calls.http, 1);
});

test("missing protocol proof is never inferred from marker absence", async t => {
  const f = await transcriptionFixture(t), before = { ...f.calls };
  await assert.rejects(f.bridge.resume(f.request, context(f)), { code: "SUBMISSION_PREPARATION_INVALID" });
  assert.deepEqual(f.calls, before); assert.equal(current(f).phase, "submitting"); noDispatch(f);
});

test("direct local preparation cannot borrow a saved protocol phase", async t => {
  const f = await transcriptionFixture(t);
  await f.bridge.start(f.request, context(f, () => ({ type: "deferred", reason: "held" })));
  const before = { ...f.calls };
  await assert.rejects(f.preparation.prepare(current(f), { expectedLease: context(f).expectedLease, signal: new AbortController().signal }), { code: "SUBMISSION_PREPARATION_INVALID" });
  assert.equal(f.calls.prepare, before.prepare + 1); assert.equal(f.calls.upload, before.upload); noDispatch(f);
});

test("missing owned source before proof retains a definite local rejection and the single consumed start", async t => {
  const f = await transcriptionFixture(t), before = { ...f.calls };
  f.store.db.prepare("DELETE FROM entities WHERE project_id=? AND kind IN ('media_source','narration_audio') AND id=?").run(f.project.id, f.audio.id);
  const outcome = await f.bridge.start(f.request, context(f)); assert.equal(outcome.type, "rejected");
  assert.deepEqual(result(f).observation, { kind: "not_dispatched", code: "LOCAL_INPUT_INVALID" });
  assert.equal(rows(f, "transcription_preparation_intent").length, 0); assert.equal(current(f).preparation, undefined);
  assert.deepEqual(f.calls, before); noDispatch(f); assert.equal(rows(f, "external_allowance_consumption").length, 1);
  assert.equal((await f.bridge.start(f.request, context(f))).type, "rejected"); assert.deepEqual(f.calls, before);
});

test("unsupported historical operation before proof is definite while arbitrary proof IO errors are not", async t => {
  const f = await transcriptionFixture(t, { timing: "segment" }), before = { ...f.calls };
  assert.equal((await f.bridge.start(f.request, context(f))).type, "rejected");
  assert.deepEqual(result(f).observation, { kind: "not_dispatched", code: "LOCAL_INPUT_INVALID" });
  assert.equal(rows(f, "transcription_preparation_intent").length, 0); assert.deepEqual(f.calls, before); noDispatch(f);
  const g = await transcriptionFixture(t), get = g.store.get.bind(g.store);
  g.store.get = (kind, ...args) => { if (kind === "media_source") throw Error("synthetic database read failure"); return get(kind, ...args); };
  await assert.rejects(g.bridge.start(g.request, context(g)), /synthetic database read failure/);
  g.store.get = get; assert.equal(result(g), undefined); assert.equal(rows(g, "transcription_preparation_intent").length, 0); noDispatch(g);
});
