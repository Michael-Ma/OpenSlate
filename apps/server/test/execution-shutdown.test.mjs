import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../dist/execution/index.js";
import { setup } from "./execution-fixture.mjs";

test("host shutdown fences fresh dispatch and reconciliation without persisting Stop or changing authority", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }), before = f.store.cursor(f.projectId);
  f.engine.stop(); f.engine.stop();
  assert.deepEqual(await f.engine.runReady(), { dispatched: 0, reused: 0, blocked: [] });
  assert.deepEqual(await f.engine.reconcile(), { reconciled: 0 });
  assert.equal(f.store.cursor(f.projectId), before); assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.engine.attempts(f.projectId).length, 0);
  assert.equal(f.store.get("execution_control", f.projectId), undefined);
  const replacement = new Engine(f.store, f.provider, { artifactDir: f.artifactDir }); await replacement.runReady();
  assert.equal(f.provider.acceptedCount(), 1, "a later installation can continue existing authorized work");
});

for (const receipt of ["accepted", "unknown"]) test(`host shutdown aborts the provider wait and settles a late ${receipt} outcome without resubmission`, async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); f.provider.setMode(f.plan.nodes[0].id, "pending");
  const submit = f.provider.submit.bind(f.provider); let entered, signal, taskId, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  f.provider.submit = async (request, options) => {
    calls++; const accepted = await submit(request); taskId = accepted.taskId; signal = options.signal;
    entered(); await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", resolve, { once: true }); });
    if (receipt === "unknown") throw new Error("reply lost during shutdown");
    return accepted;
  };
  const work = f.engine.runReady(); await started; f.engine.stop(); await work;
  assert.equal(signal.aborted, true); assert.equal(calls, 1); assert.equal(f.provider.acceptedCount(), 1);
  const original = f.engine.attempts(f.projectId)[0];
  assert.equal(original.phase, receipt === "accepted" ? "remote_pending" : "submission_unknown");
  assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
  await f.engine.runReady(); await f.engine.reconcile(); assert.equal(calls, 1);
  f.provider.complete(taskId);
  const replacement = new Engine(f.store, f.provider, { artifactDir: f.artifactDir });
  await replacement.reconcile(); await replacement.runReady();
  const settled = replacement.attempts(f.projectId)[0];
  assert.equal(settled.phase, receipt === "accepted" ? "succeeded" : "failed");
  assert.equal(f.store.get("reservation", settled.reservationId).state, "charged");
  if (receipt === "unknown") {
    assert.equal(settled.failure.id, "SUBMISSION_RESPONSE_LOST"); assert.equal(settled.failure.retryAllowed, false);
    assert.deepEqual(settled.outputs, {});
    for (let cycle = 0; cycle < 3; cycle++) { await replacement.reconcile(); await replacement.runReady(); }
  }
  assert.equal(replacement.attempts(f.projectId).length, 1);
  assert.equal(replacement.attempts(f.projectId)[0].request.attemptId, original.id); assert.equal(calls, 1); assert.equal(f.provider.acceptedCount(), 1);
});
