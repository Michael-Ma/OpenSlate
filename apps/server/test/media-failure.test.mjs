import test from "node:test";
import assert from "node:assert/strict";
import { canonical } from "../../../packages/core/dist/index.js";
import { attemptMediaFailure } from "../dist/media-failure.js";
import { speechFixture, context as speechContext } from "./speech-execution-fixture.mjs";
import { transcriptionFixture, context as transcriptionContext } from "./transcription-execution-fixture.mjs";
import { codexImageFixture } from "./codex-image-execution-fixture.mjs";

const current = f => f.store.get("attempt", f.attempt.id);
const database = f => canonical(f.store.db.prepare("SELECT * FROM entities ORDER BY kind,id").all());
const reservation = f => f.store.get("reservation", f.attempt.reservationId);
const failureFields = ["code", "technical", "retryAllowed", "autoRetriesLeft", "charged", "at"];
const audioFixtures = [
  { kind: "speech", fixture: speechFixture, context: speechContext },
  { kind: "transcription", fixture: transcriptionFixture, context: transcriptionContext },
];

async function settle(f, context) {
  const outcome = await f.bridge.submit(f.request, context(f));
  await f.engine.handle(current(f), outcome);
  assert.equal(current(f).phase, "failed");
  return outcome;
}

for (const audio of audioFixtures) {
  test(`${audio.kind} failure derives notDispatched only from its exact retained pre-dispatch result`, async t => {
    const f = await audio.fixture(t, { credential: () => { throw Error("PRIVATE_CREDENTIAL_DETAIL"); } });
    await settle(f, audio.context);
    const attempt = current(f), calls = { ...f.calls }, before = database(f);
    const failure = attemptMediaFailure(f.store, attempt, 3);
    assert.equal(failure.code, attempt.failure.id);
    assert.equal(failure.technical, true);
    assert.equal(failure.retryAllowed, false);
    assert.equal(failure.autoRetriesLeft, 0);
    assert.equal(failure.charged, false);
    assert.equal(failure.notDispatched, true);
    assert.equal(failure.nativeDiagnostic, undefined);
    assert.deepEqual(Object.keys(failure).sort(), [...failureFields, "notDispatched"].sort());
    assert.equal(reservation(f).state, "released");
    assert.equal(f.calls.http, 0);
    assert.deepEqual(f.calls, calls);
    assert.equal(database(f), before, "the projection does not change execution or liability evidence");
    assert.equal(JSON.stringify(failure).includes("PRIVATE_CREDENTIAL_DETAIL"), false);
  });

  test(`${audio.kind} malformed or foreign pre-dispatch evidence is omitted without breaking the failure read`, async t => {
    const f = await audio.fixture(t, { credential: () => { throw Error("private local details"); } });
    await settle(f, audio.context);
    const attempt = current(f), kind = `${audio.kind}_execution_result`;
    const saved = f.store.db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(kind, attempt.id);
    const original = JSON.parse(saved.body), calls = { ...f.calls };
    assert.equal(attemptMediaFailure(f.store, attempt).notDispatched, true);
    const variants = [
      { ...original, requestDigest: "f".repeat(64) },
      { ...original, attemptId: "another-attempt" },
      { ...original, projectId: "another-project" },
      { ...original, mappingDigest: "e".repeat(64) },
      { ...original, dispatchDigest: "d".repeat(64) },
      { ...original, observation: null },
      { ...original, observation: { ...original.observation, message: "PRIVATE_RECEIPT_PROSE" } },
    ];
    for (const value of variants) {
      // Simulate imported or damaged historical receipts; normal writes reject these mutations.
      f.store.db.prepare("UPDATE entities SET body=? WHERE kind=? AND id=?").run(JSON.stringify(value), kind, attempt.id);
      const before = database(f), failure = attemptMediaFailure(f.store, attempt);
      assert.equal(failure.notDispatched, undefined, JSON.stringify(value));
      assert.equal(failure.code, attempt.failure.id);
      assert.equal(failure.charged, false);
      assert.equal(failure.nativeDiagnostic, undefined);
      assert.equal(JSON.stringify(failure).includes("PRIVATE_RECEIPT_PROSE"), false);
      assert.equal(database(f), before);
    }
    f.store.db.prepare("UPDATE entities SET body=? WHERE kind=? AND id=?").run(saved.body, kind, attempt.id);
    assert.equal(attemptMediaFailure(f.store, attempt).notDispatched, true);
    assert.deepEqual(f.calls, calls);
    assert.equal(f.calls.http, 0);
  });

  test(`${audio.kind} provider refusal releases its reservation without claiming it was never dispatched`, async t => {
    const f = await audio.fixture(t, { fetch: async () => new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "PRIVATE_PROVIDER_PROSE" } }), {
      status: 400, headers: { "content-type": "application/json", "x-request-id": "private-provider-request" },
    }) });
    await settle(f, audio.context);
    const failure = attemptMediaFailure(f.store, current(f), 3);
    assert.equal(failure.charged, false);
    assert.equal(failure.notDispatched, undefined);
    assert.equal(failure.retryAllowed, false);
    assert.equal(failure.autoRetriesLeft, 0);
    assert.equal(failure.technical, false);
    assert.equal(f.calls.http, 1);
    assert.equal(reservation(f).state, "released");
    assert.ok(f.store.get(`${audio.kind}_execution_dispatch`, f.attempt.id));
    assert.deepEqual(Object.keys(failure).sort(), failureFields.sort());
    assert.equal(JSON.stringify(failure).includes("PRIVATE_PROVIDER_PROSE"), false);
    assert.equal(JSON.stringify(failure).includes("private-provider-request"), false);
  });
}

test("a historical lost-reply failure falls back to its execution evidence without regaining retry authority", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = speechFixture(t, { fetch: async () => { throw Error("PRIVATE_TRANSPORT_BODY"); } });
  const unknown = await f.bridge.submit(f.request, speechContext(f));
  assert.equal(unknown.type, "unknown");
  await f.engine.handle(current(f), unknown);
  const dispatch = f.store.get("speech_execution_dispatch", f.attempt.id);
  t.mock.timers.setTime(Date.parse(dispatch.createdAt) + 120001);
  await f.engine.reconcile();
  assert.equal(current(f).phase, "failed");
  const saved = current(f), evidence = f.store.list("execution_evidence", f.project.id).filter(row => row.attemptId === saved.id).at(-1);
  f.store.put("attempt", saved.id, f.project.id, { ...saved, failure: null });
  const before = database(f), calls = { ...f.calls };
  assert.deepEqual(attemptMediaFailure(f.store, current(f), 3), {
    code: "SUBMISSION_RESPONSE_LOST", technical: true, retryAllowed: false, autoRetriesLeft: 0, charged: true, at: evidence.recordedAt,
  });
  assert.equal(database(f), before);
  assert.deepEqual(f.calls, calls);
  assert.equal(f.calls.http, 1);
});

test("reservation release alone never proves a failed attempt was not dispatched", t => {
  const f = speechFixture(t), attempt = { ...f.attempt, phase: "failed", failure: null };
  f.store.put("attempt", attempt.id, f.project.id, attempt);
  f.store.put("reservation", attempt.reservationId, f.project.id, { ...reservation(f), state: "released" });
  assert.deepEqual(attemptMediaFailure(f.store, current(f)), {
    code: "EXECUTION_FAILED", technical: false, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: attempt.createdAt,
  });
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});

test("failure retries use the executor's remaining automatic budget and Stop fence", t => {
  const f = speechFixture(t), attempt = { ...f.attempt, phase: "failed", ordinal: 1,
    failure: { id: "TEMPORARY_TECHNICAL_FAILURE", technical: true, retryAllowed: true, source: "offline-test" } };
  f.store.put("attempt", attempt.id, f.project.id, attempt);
  const failure = attemptMediaFailure(f.store, current(f), 2);
  assert.equal(failure.retryAllowed, true);
  assert.equal(failure.autoRetriesLeft, 2);
  assert.equal(failure.charged, true);
  f.store.insert("candidate_stop", attempt.candidateId, f.project.id, { stopId: "human-stop" });
  const stopped = attemptMediaFailure(f.store, current(f), 2);
  assert.equal(stopped.retryAllowed, false);
  assert.equal(stopped.autoRetriesLeft, 0);
  assert.equal(stopped.notDispatched, undefined);
});

test("shared failure mapping preserves exact safe native pre-dispatch diagnostics and omits damaged proof", async t => {
  const f = codexImageFixture(t), raw = "PRIVATE_NATIVE_OUTPUT", diagnostic = { category: "native_timeout", limitMs: 60000 };
  t.mock.method(console, "warn", () => {});
  f.transport.prepare = async () => { f.calls.prepare++; throw Object.assign(Error(raw), { code: "RUNTIME_RPC_TIMEOUT", nativeDiagnostic: { ...diagnostic, message: raw } }); };
  f.build(); const selected = await f.seed(); await f.runtime.engine.runReady();
  const attempt = f.runtime.engine.attempts(selected.projectId)[0], calls = { ...f.calls }, before = database(f);
  const failure = attemptMediaFailure(f.store, attempt);
  assert.deepEqual(failure.nativeDiagnostic, diagnostic);
  assert.equal(failure.notDispatched, true);
  assert.equal(failure.charged, false);
  assert.equal(JSON.stringify(failure).includes(raw), false);
  assert.equal(database(f), before);
  f.store.db.prepare("UPDATE entities SET body=json_remove(body,'$.observation.nativeDiagnostic') WHERE kind='codex_image_execution_result' AND id=?")
    .run(attempt.id);
  const withoutDiagnostic = attemptMediaFailure(f.store, attempt);
  assert.equal(withoutDiagnostic.nativeDiagnostic, undefined);
  assert.equal(withoutDiagnostic.notDispatched, true, 'an optional diagnostic is not required for exact pre-dispatch proof');
  assert.equal(withoutDiagnostic.charged, false);
  f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.requestDigest',?) WHERE kind='codex_image_execution_result' AND id=?")
    .run("f".repeat(64), attempt.id);
  const damaged = attemptMediaFailure(f.store, attempt);
  assert.equal(damaged.nativeDiagnostic, undefined);
  assert.equal(damaged.notDispatched, undefined);
  assert.equal(damaged.code, failure.code);
  assert.deepEqual(f.calls, calls);
});

test("shared failure mapping preserves native usage-limit diagnostics without inventing non-dispatch", async t => {
  const f = codexImageFixture(t);
  f.transport.start = async prepared => { f.calls.start++; return { kind: "failed", threadId: prepared.session.threadId, turnId: "private-turn", code: "USAGE_LIMIT" }; };
  f.build(); const selected = await f.seed(); await f.runtime.engine.runReady();
  const attempt = f.runtime.engine.attempts(selected.projectId)[0], failure = attemptMediaFailure(f.store, attempt);
  assert.deepEqual(failure.nativeDiagnostic, { category: "native_rate_limited" });
  assert.equal(failure.code, "USAGE_LIMIT");
  assert.equal(failure.charged, true);
  assert.equal(failure.notDispatched, undefined);
  assert.equal(failure.retryAllowed, false);
  assert.equal(failure.autoRetriesLeft, 0);
  assert.equal(JSON.stringify(failure).includes("private-turn"), false);
  assert.equal(f.calls.start, 1);
});
