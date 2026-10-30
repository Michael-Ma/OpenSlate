import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../../../packages/core/dist/index.js";
import { FakeProvider, fixtureOutputs, registerExecutionProvider } from "../../../packages/providers/dist/index.js";
import { CodePlanExecution } from "../dist/code-plan/execution.js";
import { Engine } from "../dist/execution/engine.js";
import { ExecutionIngestionRouter } from "../dist/execution/ingestion-router.js";
import { Store } from "../dist/persistence/store.js";
import { projectFixture } from "./execution-fixture.mjs";

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-code-execution-")), artifactDir = join(directory, "artifacts");
  const store = new Store(join(directory, "store.sqlite")), project = { ...projectFixture(), planMode: "code" };
  store.createProject(project);
  const provider = new FakeProvider(join(directory, "fake.sqlite"));
  const execution = new CodePlanExecution(store, { provider, artifactDir, ...options });
  t.after(() => { if (store.db.open) store.close(); if (provider.db.open) provider.close(); rmSync(directory, { recursive: true, force: true }); });
  const prepare = (input = { model: "fake-image", prompt: "fixture" }, kind = "image") => execution.prepare(project.id, digest({ kind, input }), kind, input);
  return { store, projectId: project.id, provider, artifactDir, execution, prepare };
}

test("code execution refuses unregistered and nonfake providers before any dispatch", t => {
  const f = fixture(t);
  const methods = { async submit() { assert.fail("must never submit"); }, async poll() { assert.fail("must never poll"); }, async lookup() { assert.fail("must never lookup"); } };
  assert.throws(() => new CodePlanExecution(f.store, { provider: methods, artifactDir: f.artifactDir }), { code: "PROVIDER_NOT_REGISTERED" });
  registerExecutionProvider(methods, { adapter: "real-fixture", version: "1" });
  assert.throws(() => new CodePlanExecution(f.store, { provider: methods, artifactDir: f.artifactDir }), { code: "CODE_PLAN_FAKE_ONLY" });
});

test("submission intent precedes dispatch; duplicate submits and replay pay once without graph admission", async t => {
  const f = fixture(t), original = f.provider.submit.bind(f.provider); let submits = 0;
  f.provider.submit = async request => {
    submits++;
    assert.equal(f.store.get("attempt", request.attemptId).phase, "submitting");
    assert.equal(f.store.get("code_plan_execution", request.attemptId).requestDigest, digest(request));
    return original(request);
  };
  const attempt = f.prepare();
  assert.equal(submits, 0); assert.equal(attempt.candidateId, null); assert.match(attempt.workKey, /^code-plan:/);
  await Promise.all([f.execution.submit(attempt.id), f.execution.submit(attempt.id)]);
  assert.equal(submits, 1); assert.equal(f.execution.attempts(f.projectId)[0].phase, "remote_pending");
  await f.execution.advance(f.projectId);
  const succeeded = f.execution.attempts(f.projectId)[0];
  assert.equal(succeeded.phase, "succeeded"); assert.equal(f.execution.liability(attempt.id), "charged");
  assert.equal(f.store.list("artifact", f.projectId).length, 1);
  for (const kind of ["candidate", "grant", "node_binding", "reservation"]) assert.equal(f.store.list(kind, f.projectId).length, 0);
  assert.equal(f.prepare().id, attempt.id);
  await f.execution.submit(attempt.id); await f.execution.advance(f.projectId);
  assert.equal(submits, 1); assert.equal(f.provider.acceptedCount(), 1);
});

test("advance does not reconcile an in-process submission while its response is outstanding", async t => {
  const f = fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers(); let lookups = 0;
  f.provider.submit = async () => { entered.resolve(); await release.promise; return { type: "accepted", taskId: "controlled-task" }; };
  f.provider.lookup = async () => { lookups++; assert.fail("submission still in flight"); };
  const attempt = f.prepare(), submitted = f.execution.submit(attempt.id); await entered.promise;
  assert.equal(await f.execution.advance(f.projectId), false); assert.equal(lookups, 0);
  release.resolve(); await submitted;
  assert.equal(f.execution.attempts(f.projectId)[0].phase, "remote_pending");
});

test("restart turns an unreceipted intent unknown and resolves by lookup with zero resubmits", async t => {
  const f = fixture(t), attempt = f.prepare(); let submits = 0, lookups = 0;
  f.provider.submit = async () => { submits++; assert.fail("a restarted intent must never resubmit"); };
  f.provider.lookup = async (id, request) => {
    lookups++; assert.equal(id, attempt.id); assert.equal(f.store.get("attempt", id).phase, "submission_unknown");
    return { type: "completed", taskId: "recovered-task", outputs: fixtureOutputs(request) };
  };
  const restarted = new CodePlanExecution(f.store, { provider: f.provider, artifactDir: f.artifactDir });
  assert.throws(() => restarted.submit(attempt.id), { code: "CODE_PLAN_RESUBMISSION_REFUSED" });
  await restarted.advance(f.projectId);
  assert.equal(submits, 0); assert.equal(lookups, 1); assert.equal(restarted.attempts(f.projectId)[0].phase, "succeeded");
  assert.equal(restarted.liability(attempt.id), "charged");
});

test("completed receipt is durable before ingestion; restart retries only ingestion", async t => {
  let ingestions = 0;
  const f = fixture(t, { outputIngestor: { ingest({ attempt }) {
    ingestions++; assert.equal(f.store.get("attempt", attempt.id).phase, "ingesting");
    assert.equal(f.store.get("code_plan_execution", attempt.id).outcome.type, "completed");
    throw Error("synthetic ingestion interruption");
  } } });
  const attempt = f.prepare();
  f.provider.submit = async request => ({ type: "completed", taskId: "finished-task", outputs: fixtureOutputs(request) });
  await assert.rejects(f.execution.submit(attempt.id), /synthetic ingestion interruption/);
  assert.equal(ingestions, 1); assert.equal(f.execution.attempts(f.projectId)[0].phase, "ingesting");
  assert.equal(f.store.list("artifact", f.projectId).length, 0); assert.equal(f.execution.liability(attempt.id), "charged");
  for (const method of ["submit", "poll", "lookup"]) f.provider[method] = async () => assert.fail(`ingestion recovery called ${method}`);
  const restarted = new CodePlanExecution(f.store, { provider: f.provider, artifactDir: f.artifactDir });
  await restarted.advance(f.projectId);
  assert.equal(restarted.attempts(f.projectId)[0].phase, "succeeded"); assert.equal(f.store.list("artifact", f.projectId).length, 1);
});

test("provider failures are terminal and charged; positive rejection releases liability", async t => {
  for (const mode of ["technical_failure", "reject_before_accept"]) {
    const f = fixture(t), attempt = f.prepare(); f.provider.setMode(attempt.nodeId, mode);
    await f.execution.submit(attempt.id); await f.execution.advance(f.projectId);
    const failed = f.execution.attempts(f.projectId)[0];
    assert.equal(failed.phase, "failed"); assert.equal(failed.failure.retryAllowed, false);
    assert.equal(f.execution.liability(attempt.id), mode === "technical_failure" ? "charged" : "released");
    assert.equal(f.store.list("artifact", f.projectId).length, 0);
    const accepted = f.provider.acceptedCount(); await f.execution.submit(attempt.id); await f.execution.advance(f.projectId);
    assert.equal(f.provider.acceptedCount(), accepted);
  }
});

test("a lost submit response retains liability and never retries submission", async t => {
  const f = fixture(t), attempt = f.prepare(); let submits = 0, lookups = 0;
  f.provider.submit = async () => { submits++; throw Error("lost response"); };
  f.provider.lookup = async () => { lookups++; return { type: "unknown", diagnostic: "No retained receipt" }; };
  await f.execution.submit(attempt.id); await f.execution.submit(attempt.id); await f.execution.advance(f.projectId);
  assert.equal(submits, 1); assert.equal(lookups, 1);
  assert.equal(f.execution.attempts(f.projectId)[0].phase, "submission_unknown"); assert.equal(f.execution.liability(attempt.id), "reserved");
});

test("conflicting vendor task cannot replace accepted identity or release liability", async t => {
  const f = fixture(t), attempt = f.prepare();
  f.provider.submit = async () => ({ type: "accepted", taskId: "original-task" });
  f.provider.poll = async () => ({ type: "completed", taskId: "other-task", outputs: fixtureOutputs(attempt.request) });
  await f.execution.submit(attempt.id); await f.execution.advance(f.projectId);
  assert.equal(f.execution.attempts(f.projectId)[0].phase, "submission_unknown");
  assert.equal(f.execution.attempts(f.projectId)[0].taskId, "original-task"); assert.equal(f.execution.liability(attempt.id), "reserved");
  f.provider.poll = async () => ({ type: "rejected", certainty: "not_accepted", failureId: "rejected", technical: false });
  await f.execution.advance(f.projectId);
  assert.equal(f.execution.attempts(f.projectId)[0].phase, "submission_unknown"); assert.equal(f.execution.liability(attempt.id), "reserved");
  f.provider.poll = async () => ({ type: "failed", taskId: null, failureId: "SUBMISSION_RESPONSE_LOST", technical: true, retryAllowed: false });
  await f.execution.advance(f.projectId);
  assert.equal(f.execution.attempts(f.projectId)[0].phase, "submission_unknown"); assert.equal(f.execution.liability(attempt.id), "reserved");
});

test("bounded provider waits become unknown; shutdown aborts and drains without resubmission", async t => {
  const f = fixture(t, { providerTimeoutMs: 20 }), entered = Promise.withResolvers(); let calls = 0, signal;
  f.provider.submit = async (_request, options) => { calls++; signal = options.signal; entered.resolve(); return new Promise(() => {}); };
  const attempt = f.prepare(), before = Date.now(); await f.execution.submit(attempt.id);
  assert.ok(Date.now() - before < 1000); assert.equal(signal.aborted, true);
  assert.equal(f.execution.attempts(f.projectId)[0].phase, "submission_unknown"); assert.equal(f.execution.liability(attempt.id), "reserved");
  await f.execution.awaitIdle(); await f.execution.submit(attempt.id); assert.equal(calls, 1);
  const second = f.prepare({ model: "fake-image", prompt: "shutdown" });
  const submitting = f.execution.submit(second.id); await new Promise(resolve => setImmediate(resolve));
  await f.execution.close(); await submitting;
  assert.equal(f.execution.attempts(f.projectId).find(item => item.id === second.id).phase, "submission_unknown");
  assert.equal(await f.execution.advance(f.projectId), false);
  assert.throws(() => f.prepare({ prompt: "closed" }), { code: "CODE_PLAN_CLOSED" });
});

test("graph Engine ignores code attempts and bridge refuses graph projects", async t => {
  const f = fixture(t), attempt = f.prepare();
  for (const method of ["submit", "poll", "lookup"]) f.provider[method] = async () => assert.fail(`graph engine called ${method} for code work`);
  const graph = { ...projectFixture(), planMode: "graph" }; f.store.createProject(graph);
  assert.throws(() => f.execution.prepare(graph.id, digest("graph"), "image", { prompt: "graph" }), { code: "CODE_PLAN_MODE_INVALID" });
  assert.equal(await f.execution.advance(graph.id), false);
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir });
  assert.equal((await engine.reconcile()).reconciled, 0);
  assert.equal(f.store.get("attempt", attempt.id).phase, "submitting");
});

test("normalized artifact digests resolve only from the same project", async t => {
  const f = fixture(t), image = f.prepare(); await f.execution.submit(image.id); await f.execution.advance(f.projectId);
  const artifact = f.store.list("artifact", f.projectId)[0].artifact;
  const input = { model: "fake-video", firstFrame: { sha256: artifact.sha256, kind: artifact.kind } };
  const video = f.prepare(input, "video"); assert.deepEqual(video.request.inputs, [artifact]);
  const other = { ...projectFixture(), planMode: "code" }; f.store.createProject(other);
  assert.throws(() => f.execution.prepare(other.id, digest(input), "video", input), { code: "CODE_PLAN_ARTIFACT_INVALID" });
  assert.equal(f.execution.attempts(other.id).length, 0);
  assert.throws(() => f.execution.prepare(f.projectId, image.fingerprint, "image", { prompt: "different" }), { code: "CODE_PLAN_STEP_CONFLICT" });
});

test("fake local render uses the same durable provider and ingestion boundary", async t => {
  const f = fixture(t), attempt = f.prepare({ model: "local-render", timeline: [] }, "render");
  await f.execution.submit(attempt.id); await f.execution.advance(f.projectId);
  assert.equal(f.execution.attempts(f.projectId)[0].phase, "succeeded");
  assert.equal(f.store.list("artifact", f.projectId)[0].artifact.kind, "video");
  assert.equal(f.store.list("artifact", f.projectId)[0].fixture, true);
});

test("ingestion metadata and bytes cannot publish a different artifact", async t => {
  for (const mutation of ["scope", "bytes", "fixture"]) {
    const router = new ExecutionIngestionRouter({});
    const f = fixture(t, { outputIngestor: { async ingest(input) {
      const artifact = await router.ingest(input);
      if (mutation === "scope") artifact.projectId = "different-project";
      if (mutation === "fixture") artifact.fixture = false;
      if (mutation === "bytes") writeFileSync(artifact.path, "corrupt");
      return artifact;
    } } });
    const attempt = f.prepare();
    f.provider.submit = async request => ({ type: "completed", taskId: "finished-task", outputs: fixtureOutputs(request) });
    await assert.rejects(f.execution.submit(attempt.id), error => ["INVALID_PROVIDER_OUTPUT", "ARTIFACT_CORRUPT"].includes(error.code));
    assert.equal(f.execution.attempts(f.projectId)[0].phase, "ingesting"); assert.equal(f.execution.liability(attempt.id), "charged");
    assert.equal(f.store.list("artifact", f.projectId).length, 0);
  }
});
