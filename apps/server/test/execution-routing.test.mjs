import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { DEFAULT_PROFILES, DomainError, compilePlan, digest } from "../../../packages/core/dist/index.js";
import { ExecutionRegistry, FakeProvider, fixtureOutputs, registerExecutionProvider } from "../../../packages/providers/dist/index.js";
import { projectFixture } from "./execution-fixture.mjs";

const profile = (adapter, id = "shared") => ({ id, revision: "profile-2026-09", kind: "image", adapter, executionVersion: "1",
  configuration: { model: `${adapter}-model`, settings: { quality: "medium" } }, maxConcurrency: 1, unitCostMicros: "100", maxRetries: 1 });
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-routing-")), store = new Store(join(directory, "state.sqlite")), fake = new FakeProvider(join(directory, "fake.sqlite"));
  t.after(() => { store.close(); fake.close(); rmSync(directory, { recursive: true, force: true }); });
  const authorize = input => {
    const id = randomUUID(); store.insert("offline_test_allowance", id, input.projectId, { attemptId: input.attemptId, micros: input.estimatedMicros });
    return { allowanceId: id };
  };
  return { store, fake, engine: (providers, options = {}) => new Engine(store, new ExecutionRegistry(providers), {
    artifactDir: join(directory, "artifacts"), externalAdmission: { authorize }, ...options }) };
}
function project(f, engine, profiles, selected = profiles) {
  const value = projectFixture(randomUUID(), 1); f.store.createProject(value);
  f.store.insert("capability_lock", value.capabilityLockId, value.id, { profiles });
  const source = `definePlan({baseRevision:${JSON.stringify(value.revisionId)}},p=>{${selected.map((p, i) => `const frame${i}=p.image("image${i}",{profile:${JSON.stringify(p.id)},prompt:"A boot"});`).join("")}return [${selected.map((_, i) => `frame${i}`).join(",")}];});`;
  const plan = compilePlan(source, { project: value, profiles, logicalIds: {}, allocateId: randomUUID }), grants = {};
  for (const node of plan.nodes) grants[node.id] = engine.createGrant(value.id, value.id, "image", "human-offline-fixture", "initial_slot").id;
  const id = randomUUID(); engine.installPlan(value.id, id, plan, grants); f.store.saveProject({ ...value, activePlanId: id }, 0);
  return value.id;
}
function adapter(identity, implementation = {}) {
  const calls = [];
  const port = registerExecutionProvider({
    async submit(request, options) { calls.push({ method: "submit", request: structuredClone(request), signal: options?.signal, expectedLease: options?.expectedLease }); return implementation.submit?.(request, options) ?? { type: "accepted", taskId: "same-vendor-task" }; },
    async poll(taskId, request, options) { calls.push({ method: "poll", taskId, request: structuredClone(request), signal: options?.signal, expectedLease: options?.expectedLease }); return implementation.poll?.(taskId, request, options) ?? { type: "completed", taskId, outputs: fixtureOutputs(request) }; },
    async lookup(attemptId, request, options) { calls.push({ method: "lookup", attemptId, request: structuredClone(request), signal: options?.signal, expectedLease: options?.expectedLease }); return implementation.lookup?.(attemptId, request, options) ?? { type: "unknown", diagnostic: "offline unresolved" }; },
  }, { adapter: identity, version: "1" });
  return { port, calls };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function eventually(predicate) { const deadline = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < deadline, "barrier did not advance"); await delay(5); } }

test("registered external routes require explicit admission; missing readiness and policy rollback consume no attempt", async t => {
  const f = fixture(t), a = adapter("image-a"), p = profile("image-a");
  const denied = f.engine([a.port], { externalAdmission: undefined }), id = project(f, denied, [p]);
  assert.equal((await denied.runReady()).blocked[0].code, "EXTERNAL_EXECUTION_NOT_AUTHORIZED");
  assert.equal(denied.attempts(id).length, 0); assert.equal(f.store.list("reservation", id).length, 0); assert.equal(a.calls.length, 0);
  const missing = f.engine([a.port], { externalAdmission: { authorize(input) { f.store.insert("offline_test_allowance", "rolled-back", id, { attemptId: input.attemptId }); throw new DomainError("MEDIA_CREDENTIAL_MISSING", "offline missing key"); } } });
  assert.equal((await missing.runReady()).blocked[0].code, "MEDIA_CREDENTIAL_MISSING");
  assert.equal(f.store.list("offline_test_allowance", id).length, 0); assert.equal(missing.attempts(id).length, 0);
  assert.throws(() => f.engine([a.port], { externalAdmission: { async authorize() { return { allowanceId: "invalid" }; } } }), { code: "ASYNC_TRANSACTION" });
});

test("colliding vendor task IDs route by frozen adapter and configuration across restart and default changes", async t => {
  const f = fixture(t), a = adapter("image-a"), b = adapter("image-b"), engine = f.engine([a.port, b.port]);
  const first = project(f, engine, [profile("image-a")]), second = project(f, engine, [profile("image-b")]);
  assert.equal((await engine.runReady()).dispatched, 2);
  const original = [engine.attempts(first)[0], engine.attempts(second)[0]].map(attempt => ({ id: attempt.id, request: structuredClone(attempt.request) }));
  const restarted = f.engine([b.port, a.port], { profiles: [{ ...profile("image-a"), configuration: { model: "changed-default" } }] });
  assert.equal((await restarted.reconcile()).reconciled, 2);
  for (const [i, id] of [first, second].entries()) {
    const attempt = restarted.attempts(id)[0]; assert.equal(attempt.phase, "succeeded"); assert.equal(attempt.taskId, "same-vendor-task");
    assert.deepEqual(attempt.request, original[i].request); assert.ok(attempt.request.externalAllowanceId);
    assert.equal(attempt.request.profile.configuration.model, i === 0 ? "image-a-model" : "image-b-model");
  }
  assert.deepEqual(a.calls.map(call => call.method), ["submit", "poll"]); assert.deepEqual(b.calls.map(call => call.method), ["submit", "poll"]);
  assert.equal(a.calls[1].request.attemptId, original[0].id); assert.equal(b.calls[1].request.attemptId, original[1].id);
  for (const [port, id] of [[a, first], [b, second]]) {
    const attempt = restarted.attempts(id)[0];
    assert.deepEqual(port.calls[0].expectedLease, { owner: engine.workerId, epoch: attempt.leaseEpoch - 1 });
    assert.deepEqual(port.calls[1].expectedLease, { owner: restarted.workerId, epoch: attempt.leaseEpoch });
    assert.equal(Object.isFrozen(port.calls[0].expectedLease), true);
    assert.equal("expectedLease" in attempt.request, false);
  }
});

test("missing adapters isolate selected admission and recovery without claiming a pending lease or changing liability", async t => {
  const f = fixture(t), a = adapter("image-a"), b = adapter("image-b"), both = f.engine([a.port, b.port]);
  const first = project(f, both, [profile("image-a")]), second = project(f, both, [profile("image-b")]);
  await both.runReady(); const original = structuredClone(both.attempts(first)[0]), budget = both.budget(first);
  const available = f.engine([b.port]), result = await available.reconcile();
  assert.deepEqual(result.blocked, [{ attemptId: original.id, code: "PROVIDER_NOT_REGISTERED" }]);
  assert.deepEqual(available.attempts(first)[0], original); assert.deepEqual(available.budget(first), budget);
  assert.equal(available.attempts(second)[0].phase, "succeeded"); assert.equal(a.calls.length, 1);
  const third = project(f, available, [profile("image-a", "missing"), profile("image-b", "available")], [profile("image-b", "available")]);
  assert.equal((await available.runReady()).dispatched, 1); assert.equal(available.attempts(third).length, 1);
});

test("capacity uses adapter contract plus profile identity, and unknown lookup never resubmits", async t => {
  const f = fixture(t), a = adapter("image-a", { submit: () => ({ type: "unknown", diagnostic: "lost offline response" }) }), b = adapter("image-b");
  const engine = f.engine([a.port, b.port]), first = project(f, engine, [profile("image-a")]);
  const same = project(f, engine, [profile("image-a")]), other = project(f, engine, [profile("image-b")]);
  const dispatched = await engine.runReady(); assert.equal(dispatched.dispatched, 2); assert.equal(dispatched.blocked[0].code, "CAPACITY_EXCEEDED");
  await engine.reconcile(); await engine.runReady();
  assert.deepEqual([engine.attempts(first).length, engine.attempts(same).length].sort(), [0, 1]); assert.equal(engine.attempts(other)[0].phase, "succeeded");
  assert.deepEqual(a.calls.map(call => call.method), ["submit", "lookup"]); assert.equal(a.calls[1].request.profile.configuration.model, "image-a-model");
  const pending = [...engine.attempts(first), ...engine.attempts(same)][0];
  assert.deepEqual(a.calls[1].expectedLease, { owner: engine.workerId, epoch: pending.leaseEpoch });
});

test("long submit and poll renew the lease while competing executors cannot claim them", { timeout: 15000 }, async t => {
  for (const method of ["submit", "poll"]) {
    const f = fixture(t), gate = deferred(), started = deferred(); let captured;
    const port = registerExecutionProvider({
      async submit(request, options) { if (method === "submit") { captured = options.signal; started.resolve(); return gate.promise; } return { type: "accepted", taskId: "held-task" }; },
      async poll(taskId, request, options) { captured = options.signal; started.resolve(); return gate.promise; },
      async lookup() { throw Error("must not claim held work"); },
    }, { adapter: "fake", version: "1" });
    const engine = f.engine([port], { leaseMs: 150, providerTimeoutMs: 5000 }), id = project(f, engine, [DEFAULT_PROFILES[0]]);
    if (method === "poll") await engine.runReady();
    const originalPut = f.store.put.bind(f.store); let renewals = 0;
    f.store.put = (...args) => { if (args[0] === "attempt" && args[3].leaseOwner === engine.workerId && args[3].leaseExpiresAt > Date.now()) renewals++; return originalPut(...args); };
    const running = method === "submit" ? engine.runReady() : engine.reconcile(); await started.promise;
    await eventually(() => renewals >= 5);
    const competitor = f.engine([port], { leaseMs: 150 }); assert.equal((await competitor.reconcile()).reconciled, 0); assert.equal(captured.aborted, false);
    const attempt = engine.attempts(id)[0]; gate.resolve(method === "submit" ? { type: "accepted", taskId: "held-task" } : { type: "completed", taskId: "held-task", outputs: fixtureOutputs(attempt.request) });
    await running; assert.equal(engine.attempts(id)[0].phase, method === "submit" ? "remote_pending" : "succeeded");
  }
});

test("ownership loss aborts the original signal but preserves a late accepted observation without stale publication", { timeout: 10000 }, async t => {
  const f = fixture(t), gate = deferred(), started = deferred(); let signal, expectedLease, lookups = 0; const polls = [];
  const port = registerExecutionProvider({
    async submit(_request, options) { signal = options.signal; expectedLease = options.expectedLease; started.resolve(); return gate.promise; },
    async poll(taskId, request) { polls.push(taskId); return { type: "completed", taskId, outputs: fixtureOutputs(request) }; },
    async lookup() { lookups++; return { type: "unknown", diagnostic: "must use saved acceptance" }; },
  }, { adapter: "fake", version: "1" });
  const engine = f.engine([port], { leaseMs: 150 }), id = project(f, engine, [DEFAULT_PROFILES[0]]), running = engine.runReady();
  await started.promise; const old = engine.attempts(id)[0], moved = { ...old, leaseOwner: "other-owner", leaseEpoch: old.leaseEpoch + 1, leaseExpiresAt: Date.now() + 10000 };
  f.store.put("attempt", old.id, id, moved); await eventually(() => signal.aborted);
  assert.deepEqual(expectedLease, { owner: old.leaseOwner, epoch: old.leaseEpoch });
  gate.resolve({ type: "accepted", taskId: "late-accepted-task" }); await running;
  assert.deepEqual(engine.attempts(id)[0], moved); assert.equal(f.store.list("artifact", id).length, 0);
  const evidence = f.store.list("execution_evidence", id); assert.equal(evidence.length, 1); assert.equal(evidence[0].outcome.taskId, "late-accepted-task");
  assert.equal(evidence[0].outcomeDigest, digest(evidence[0].outcome)); assert.equal(engine.budget(id).committedMicros, "100");
  f.store.put("attempt", old.id, id, { ...moved, leaseExpiresAt: 0 });
  const restarted = f.engine([port]); await restarted.reconcile();
  assert.equal(restarted.attempts(id)[0].taskId, "late-accepted-task"); assert.equal(lookups, 0); assert.deepEqual(polls, []);
  await restarted.reconcile(); assert.deepEqual(polls, ["late-accepted-task"]); assert.equal(lookups, 0);
  assert.equal(restarted.attempts(id)[0].phase, "succeeded"); assert.deepEqual(f.store.get("execution_evidence", evidence[0].id), evidence[0]);
});

test("provider deadline aborts cooperative I/O and retains uncertainty without retry", { timeout: 10000 }, async t => {
  const f = fixture(t); let submitted = 0, signal;
  const port = registerExecutionProvider({ async submit(_request, options) {
    submitted++; signal = options.signal; await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true })); throw Error("aborted");
  }, async poll() { throw Error("unexpected"); }, async lookup() { return { type: "unknown", diagnostic: "unsettled" }; } }, { adapter: "fake", version: "1" });
  const engine = f.engine([port], { leaseMs: 150, providerTimeoutMs: 50 }), id = project(f, engine, [DEFAULT_PROFILES[0]]);
  await engine.runReady(); assert.equal(signal.aborted, true); assert.equal(engine.attempts(id)[0].phase, "submission_unknown");
  await engine.runReady(); assert.equal(submitted, 1); assert.equal(engine.budget(id).committedMicros, "100");
});

test("accepted recovery ignores corrupted digests and cannot choose among conflicting task IDs", async t => {
  for (const mode of ["corrupt", "conflict", "conflicting-completion"]) {
    const f = fixture(t), port = adapter("image-a", { submit: () => ({ type: "unknown", diagnostic: "offline receipt gap" }) });
    const engine = f.engine([port.port]), id = project(f, engine, [profile("image-a")]); await engine.runReady();
    const attempt = engine.attempts(id)[0];
    for (const taskId of mode === "corrupt" ? ["corrupted-task"] : ["first-task", "second-task"]) {
      const outcome = { type: "accepted", taskId };
      f.store.insert("execution_evidence", randomUUID(), id, { attemptId: attempt.id, outcome, outcomeDigest: mode === "corrupt" ? "0".repeat(64) : digest(outcome), recordedAt: new Date().toISOString() });
    }
    if (mode === "conflicting-completion") {
      const outcome = { type: "completed", taskId: "first-task", outputs: fixtureOutputs(attempt.request) };
      f.store.insert("execution_evidence", randomUUID(), id, { attemptId: attempt.id, outcome, outcomeDigest: digest(outcome), recordedAt: new Date().toISOString() });
    }
    await engine.reconcile(); assert.equal(engine.attempts(id)[0].taskId, null); assert.equal(engine.attempts(id)[0].phase, "submission_unknown");
    assert.equal(f.store.list("artifact", id).length, 0); assert.equal(engine.budget(id).committedMicros, "100");
    assert.deepEqual(port.calls.map(call => call.method), mode === "corrupt" ? ["submit", "lookup"] : ["submit"]);
  }
});
