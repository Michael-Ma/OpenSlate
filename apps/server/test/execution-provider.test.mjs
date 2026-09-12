import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { Engine } from "../dist/execution/index.js";
import { fixtureOutputs, registerExecutionProvider } from "../../../packages/providers/dist/index.js";
import { digest } from "../../../packages/core/dist/index.js";
import { setup } from "./execution-fixture.mjs";

const wrap = provider => ({ submit: request => provider.submit(request), poll: taskId => provider.poll(taskId), lookup: attemptId => provider.lookup(attemptId) });
const register = provider => registerExecutionProvider(provider, { adapter: "fake", version: "1" });
function ingested({ attempt, output, artifactDir }) {
  mkdirSync(artifactDir, { recursive: true });
  const path = join(artifactDir, `${output.sha256}.${output.extension}`);
  writeFileSync(path, Buffer.from(output.bytesBase64, "base64"));
  const id = randomUUID();
  return { id, projectId: attempt.projectId, attemptId: attempt.id,
    artifact: { artifactId: id, sha256: output.sha256, kind: output.kind },
    path, mimeType: output.mimeType, fixture: output.fixture, physicalDurationSeconds: null };
}
// Deliberately construct a pre-refactor fixture; production Store APIs still forbid request mutation.
function legacyAttempt(f, attempt) {
  const old = structuredClone(attempt); delete old.request.execution;
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='attempt' AND id=?").run(JSON.stringify(old), old.id);
  return old;
}

test("execution requires trusted registration rather than a concrete provider class", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); const wrapped = wrap(f.provider);
  assert.throws(() => new Engine(f.store, wrapped, { artifactDir: f.artifactDir }), { code: "PROVIDER_NOT_REGISTERED" });
  assert.throws(() => registerExecutionProvider(wrapped, { adapter: "minimax-h3-v2", version: "1" }), { code: "PROVIDER_NOT_REGISTERED" });
  const engine = new Engine(f.store, register(wrapped), { artifactDir: f.artifactDir });
  await engine.runReady(); await engine.reconcile();
  assert.equal(engine.outputs(f.projectId).length, 1);
  assert.deepEqual(engine.attempts(f.projectId)[0].request.execution, { adapter: "fake", version: "1" });
  const attempt = engine.attempts(f.projectId)[0];
  assert.throws(() => f.store.put("attempt", attempt.id, f.projectId, { ...attempt,
    request: { ...attempt.request, execution: { adapter: "other", version: "1" } } }), { code: "IMMUTABLE_RECORD" });
});

test("adapter mutation cannot alter the immutable submission request or current attempt identity", async t => {
  const f = setup(t, { count: 1, imagesOnly: true });
  const original = f.plan.nodes[0];
  const provider = register({
    async submit(request) { request.attemptId = "different-attempt"; request.fingerprint = "changed";
      request.execution.adapter = "other"; return { type: "unknown", diagnostic: "fixture loss" }; },
    async poll() { throw Error("not expected"); }, async lookup() { return { type: "unknown", diagnostic: "unsettled" }; },
  });
  const engine = new Engine(f.store, provider, { artifactDir: f.artifactDir });
  await engine.runReady(); await engine.reconcile(); await engine.runReady();
  const [attempt] = engine.attempts(f.projectId);
  assert.equal(attempt.request.attemptId, attempt.id); assert.equal(attempt.nodeId, original.id);
  assert.equal(attempt.request.fingerprint, attempt.fingerprint);
  assert.deepEqual(attempt.request.execution, { adapter: "fake", version: "1" });
  assert.equal(attempt.phase, "submission_unknown"); assert.equal(engine.attempts(f.projectId).length, 1);
});

test("technical classification alone never grants an automatic retry", async t => {
  for (const classification of [{ technical: true }, { technical: true, retryAllowed: false }, { technical: false, retryAllowed: true }]) {
    const f = setup(t, { count: 1, imagesOnly: true }); let calls = 0;
    const provider = register({
      async submit() { calls++; return { type: "failed", taskId: "fixture-task", failureId: "fixture-failure", ...classification }; },
      async poll() { throw Error("not expected"); }, async lookup() { throw Error("not expected"); },
    });
    const engine = new Engine(f.store, provider, { artifactDir: f.artifactDir });
    await engine.runReady();
    const result = await engine.runReady(), [attempt] = engine.attempts(f.projectId);
    assert.equal(attempt.phase, "failed"); assert.equal(attempt.failure.retryAllowed, false);
    assert.equal(result.blocked[0].code, "RETRY_NOT_AUTHORIZED"); assert.equal(calls, 1);
    assert.equal(engine.budget(f.projectId).committedMicros, "100");
  }
});

test("malformed provider failures remain unknown and keep their reservation", async t => {
  const f = setup(t, { count: 1, imagesOnly: true });
  f.provider.submit = async () => ({ type: "failed", taskId: "task", failureId: "failure", retryAllowed: true });
  await f.engine.runReady(); await f.engine.runReady();
  const [attempt] = f.engine.attempts(f.projectId);
  assert.equal(attempt.phase, "submission_unknown"); assert.equal(attempt.failure, null);
  assert.equal(f.engine.attempts(f.projectId).length, 1); assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
});

test("contradictory task receipts are retained without replacing the accepted task or blocking later recovery", async t => {
  const f = setup(t, { count: 1, imagesOnly: true });
  f.provider.setMode(f.plan.nodes[0].id, "pending"); await f.engine.runReady();
  const accepted = f.engine.attempts(f.projectId)[0], originalPoll = f.provider.poll.bind(f.provider);
  f.provider.poll = async () => ({ type: "completed", taskId: "wrong-task", outputs: fixtureOutputs(accepted.request) });
  await f.engine.reconcile();
  let current = f.engine.attempts(f.projectId)[0];
  assert.equal(current.taskId, accepted.taskId); assert.equal(current.phase, "submission_unknown");
  assert.equal(f.store.list("artifact", f.projectId).length, 0);
  assert.ok(f.store.list("execution_evidence", f.projectId).some(row => row.outcome.taskId === "wrong-task"));
  f.provider.poll = async () => ({ type: "rejected", certainty: "not_accepted", technical: true, retryAllowed: true, failureId: "contradiction" });
  await f.engine.reconcile();
  assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
  assert.equal(f.engine.attempts(f.projectId)[0].taskId, accepted.taskId);
  f.provider.poll = originalPoll; f.provider.complete(accepted.taskId);
  await f.engine.reconcile(); current = f.engine.attempts(f.projectId)[0];
  assert.equal(current.phase, "succeeded"); assert.equal(current.taskId, accepted.taskId);
  assert.equal(f.provider.acceptedCount(), 1); assert.equal(f.engine.outputs(f.projectId).length, 1);
});

test("default fixture ingestion cannot silently materialize nonfixture outputs", async t => {
  const f = setup(t, { count: 1, imagesOnly: true });
  f.provider.submit = async request => ({ type: "completed", taskId: "task", outputs: fixtureOutputs(request).map(output => ({ ...output, fixture: false })) });
  await assert.rejects(f.engine.runReady(), { code: "INVALID_PROVIDER_OUTPUT" });
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "ingesting");
  assert.equal(f.store.list("artifact", f.projectId).length, 0);
  assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
});

test("an explicit trusted ingestion hook preserves stored fixture flags in outputs and publication events", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); let ingestions = 0;
  // Synthetic contract fixture, not a live generated image.
  f.provider.submit = async request => ({ type: "completed", taskId: "task", outputs: fixtureOutputs(request).map(output => ({ ...output, fixture: false })) });
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputIngestor: {
    ingest(input) { ingestions++; return ingested(input); },
  } });
  await engine.runReady();
  assert.equal(ingestions, 1); assert.equal(engine.outputs(f.projectId)[0].fixture, false);
  assert.equal(f.store.list("artifact", f.projectId)[0].fixture, false);
  const event = f.store.readEvents(f.projectId).find(row => row.kind === "artifact.published");
  assert.equal(event.payload.fixture, false);
});

test("ingester metadata cannot cross project, attempt, hash, kind, MIME or fixture boundaries", async t => {
  for (const mutate of [row => { row.projectId = "other"; }, row => { row.attemptId = "other"; },
    row => { row.artifact.sha256 = "0".repeat(64); }, row => { row.artifact.kind = "video"; },
    row => { row.artifact.artifactId = "other"; }, row => { row.mimeType = "image/png"; },
    row => { row.fixture = false; }]) {
    const f = setup(t, { count: 1, imagesOnly: true });
    const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputIngestor: {
      ingest(input) { const row = ingested(input); mutate(row); return row; },
    } });
    await engine.runReady(); await assert.rejects(engine.reconcile(), { code: "INVALID_PROVIDER_OUTPUT" });
    assert.equal(f.store.list("artifact", f.projectId).length, 0);
    assert.equal(engine.attempts(f.projectId)[0].phase, "ingesting");
  }
});

test("ingestion verifies actual bytes before any artifact or selected output is published", async t => {
  const f = setup(t, { count: 1, imagesOnly: true });
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputIngestor: {
    ingest(input) { const row = ingested(input); writeFileSync(row.path, "wrong bytes"); return row; },
  } });
  await engine.runReady(); await assert.rejects(engine.reconcile(), { code: "ARTIFACT_CORRUPT" });
  assert.equal(f.store.list("artifact", f.projectId).length, 0); assert.equal(engine.outputs(f.projectId).length, 0);
});

test("ingestion cannot publish paths outside the artifact root or final symlinks", async t => {
  for (const mode of ["outside", "symlink"]) {
    const f = setup(t, { count: 1, imagesOnly: true });
    const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputIngestor: {
      ingest(input) {
        const row = ingested(input);
        if (mode === "outside") {
          row.path = join(f.directory, "outside.svg"); writeFileSync(row.path, Buffer.from(input.output.bytesBase64, "base64"));
        } else { const link = join(f.artifactDir, "linked.svg"); symlinkSync(row.path, link); row.path = link; }
        return row;
      },
    } });
    await engine.runReady();
    await assert.rejects(engine.reconcile(), error => mode === "outside" ? error.code === "INVALID_PROVIDER_OUTPUT" : ["ELOOP", "EMLINK"].includes(error.code));
    assert.equal(f.store.list("artifact", f.projectId).length, 0); assert.equal(engine.outputs(f.projectId).length, 0);
  }
});

test("asynchronous ingestion renews its owned lease and prevents a second worker from repeating it", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); let ingestions = 0, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.provider.submit = async request => ({ type: "completed", taskId: "slow-ingestion", outputs: fixtureOutputs(request) });
  const outputIngestor = { async ingest(input) { ingestions++; entered(); await delay(400); return ingested(input); } };
  const first = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, leaseMs: 150, outputIngestor });
  const second = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, leaseMs: 150, outputIngestor });
  const running = first.runReady(); await started; await delay(180);
  assert.equal((await second.reconcile()).reconciled, 0); await running;
  assert.equal(ingestions, 1); assert.equal(first.attempts(f.projectId)[0].phase, "succeeded");
  assert.equal(first.outputs(f.projectId).length, 1);
});

test("ingestion lease loss aborts the hook and cannot resurrect ownership or publish", { timeout: 2000 }, async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); let entered, observedSignal;
  const started = new Promise(resolve => { entered = resolve; });
  f.provider.submit = async request => ({ type: "completed", taskId: "fenced-ingestion", outputs: fixtureOutputs(request) });
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, leaseMs: 90, outputIngestor: {
    async ingest(input) { observedSignal = input.signal; entered(); await new Promise(resolve => input.signal.addEventListener("abort", resolve, { once: true })); return ingested(input); },
  } });
  const running = engine.runReady(); await started;
  const attempt = engine.attempts(f.projectId)[0];
  f.store.put("attempt", attempt.id, f.projectId, { ...attempt, leaseOwner: "replacement-worker", leaseEpoch: attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 1000 });
  await running;
  assert.equal(observedSignal.aborted, true); assert.equal(engine.attempts(f.projectId)[0].leaseOwner, "replacement-worker");
  assert.equal(f.store.list("artifact", f.projectId).length, 0); assert.equal(engine.outputs(f.projectId).length, 0);
});

test("wrong or duplicated output roles never reach the trusted ingester", async t => {
  for (const modify of [outputs => [{ ...outputs[0], port: "video" }], outputs => [{ ...outputs[0], kind: "video" }], outputs => [outputs[0], outputs[0]]]) {
    const f = setup(t, { count: 1, imagesOnly: true }); let ingestions = 0;
    f.provider.submit = async request => ({ type: "completed", taskId: "task", outputs: modify(fixtureOutputs(request)) });
    const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputIngestor: { ingest(input) { ingestions++; return ingested(input); } } });
    await engine.runReady(); assert.equal(ingestions, 0);
    assert.equal(engine.attempts(f.projectId)[0].phase, "submission_unknown"); assert.equal(engine.outputs(f.projectId).length, 0);
  }
});

test("unusable initial completion retains its task receipt and recovers by polling without resubmission", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); let submissions = 0, lookups = 0, polls = 0;
  f.provider.submit = async request => { submissions++; return { type: "completed", taskId: "accepted-task",
    outputs: fixtureOutputs(request).map(output => ({ ...output, port: "wrong" })) }; };
  f.provider.lookup = async () => { lookups++; throw Error("known task must be polled"); };
  f.provider.poll = async taskId => { polls++; return { type: "completed", taskId,
    outputs: fixtureOutputs(f.engine.attempts(f.projectId)[0].request) }; };
  await f.engine.runReady();
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "submission_unknown");
  assert.equal(f.engine.attempts(f.projectId)[0].taskId, "accepted-task");
  await f.engine.runReady(); await f.engine.reconcile();
  assert.equal(submissions, 1); assert.equal(polls, 1); assert.equal(lookups, 0);
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded");
});

test("legacy completed evidence replays byte-for-byte without another provider call", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); await f.engine.runReady();
  const old = legacyAttempt(f, { ...f.engine.attempts(f.projectId)[0], leaseExpiresAt: 0 });
  const outcome = await f.provider.poll(old.taskId), evidenceId = randomUUID();
  f.store.insert("execution_evidence", evidenceId, f.projectId, { attemptId: old.id, outcome, outcomeDigest: digest(outcome), recordedAt: new Date().toISOString() });
  const evidence = f.store.get("execution_evidence", evidenceId);
  f.provider.poll = f.provider.lookup = async () => { throw Error("provider must not be contacted"); };
  const restarted = new Engine(f.store, f.provider, { artifactDir: f.artifactDir }); await restarted.reconcile();
  assert.equal(restarted.attempts(f.projectId)[0].phase, "succeeded");
  assert.deepEqual(f.store.get("execution_evidence", evidenceId), evidence);
  assert.deepEqual(restarted.attempts(f.projectId)[0].request, old.request);
  assert.equal(f.provider.acceptedCount(), 1);
});

test("legacy failed attempts retain their recorded retry authority and immutable failure evidence", async t => {
  const f = setup(t, { count: 1, imagesOnly: true });
  f.provider.setMode(f.plan.nodes[0].id, ["technical_failure", "complete"]);
  await f.engine.runReady(); await f.engine.reconcile();
  const old = legacyAttempt(f, f.engine.attempts(f.projectId)[0]);
  const evidence = f.store.list("execution_evidence", f.projectId).find(row => row.outcome.type === "failed");
  delete evidence.outcome.retryAllowed; evidence.outcomeDigest = digest(evidence.outcome);
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='execution_evidence' AND id=?").run(JSON.stringify(evidence), evidence.id);
  const restarted = new Engine(f.store, f.provider, { artifactDir: f.artifactDir });
  await restarted.runReady(); await restarted.reconcile();
  const attempts = restarted.attempts(f.projectId);
  assert.equal(attempts.length, 2); assert.equal(attempts[1].phase, "succeeded");
  assert.equal(attempts[1].candidateId, old.candidateId); assert.equal(attempts[1].ordinal, 2);
  assert.equal(attempts[0].failure.source, "fake_provider"); assert.equal(attempts[0].failure.retryAllowed, true);
  assert.deepEqual(f.store.get("execution_evidence", evidence.id), evidence);
  assert.deepEqual(attempts[0].request, old.request); assert.deepEqual(attempts[1].request.execution, { adapter: "fake", version: "1" });
});
