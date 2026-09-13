import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, compilePlan, DEFAULT_PROFILES, digest, DomainError } from "../../../packages/core/dist/index.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { assertPreparedLocalExecution, assertLocalExecutionResult } from "../dist/execution/local-execution.js";
import { createLocalTimelineDocument } from "../dist/media/local-timeline.js";
import { projectFixture } from "./execution-fixture.mjs";

const identity = { adapter: "local-media", version: "1" };
const barrier = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-local-engine-")), path = join(directory, "store.sqlite"), artifactDir = join(directory, "artifacts");
  let store = new Store(path), engine;
  const provider = new FakeProvider(join(directory, "fake.sqlite"));
  t.after(() => { if (store.db.open) store.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); });
  const project = projectFixture(randomUUID(), 1), input = { artifactId: randomUUID(), sha256: "a".repeat(64), kind: "video" };
  project.artifacts = [input]; store.createProject(project);
  store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: DEFAULT_PROFILES, localExecution: identity });
  store.insert("artifact", input.artifactId, project.id, { artifact: input, path: join(directory, "source.mp4"), fixture: false, mimeType: "video/mp4", attemptId: null, physicalDurationSeconds: 1 });
  let semantic = 1, executes = 0, recoveries = 0;
  const source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{const take=p.asset(${JSON.stringify(input.artifactId)});return p.timeline("assembly",{takes:[take]});});`;
  const plan = compilePlan(source, { project, profiles: DEFAULT_PROFILES, logicalIds: { assembly: "timeline-node" }, allocateId: randomUUID, localExecution: identity });
  const descriptor = { artifactId: input.artifactId, kind: "video", originalSha256: input.sha256, originalByteLength: 100, sha256: input.sha256, byteLength: 100,
    probe: { durationSeconds: 2, video: { streamIndex: 0, width: 320, height: 180, frameRate: "30/1", frames: 60, durationSeconds: 2, codec: "h264" } }, toolchainDigest: "b".repeat(64) };
  const supplied = { ...descriptor, id: digest(descriptor) };
  const prepare = (projectId, nodeId) => {
    const current = store.getProject(projectId), binding = store.get("node_binding", nodeId), plan = store.get("plan", current.activePlanId);
    const clips = [{ source: supplied, startFrame: semantic - 1, durationFrames: 30, fit: "contain" }];
    const recipe = createLocalTimelineDocument({ projectId, clips, audio: [] });
    return { projectId, nodeId, specDigest: binding.node.specDigest, contentDigest: digest(recipe), kind: "timeline", recipe,
      capture: { target: { revisionId: current.revisionId, headVersion: current.headVersion, planId: current.activePlanId, graphDigest: plan.compiled.graphDigest,
        timelineNodeId: nodeId, canonicalNarrationId: null, inputs: [{ nodeId: null, port: "video", artifact: input }], dependencyNodeIds: [nodeId], scopeIds: [projectId] },
      input: { projectId, targetRevisionId: current.revisionId, clips, audio: [] } } };
  };
  const complete = intent => {
    const bytes = canonical(intent.prepared.recipe), outputPath = join(artifactDir, `${intent.outputArtifactId}.json`);
    writeFileSync(outputPath, bytes);
    const result = { version: 1, intentDigest: digest(intent), requestDigest: intent.requestDigest, port: "timeline",
      artifact: { id: intent.outputArtifactId, projectId: intent.projectId, artifact: { artifactId: intent.outputArtifactId, sha256: intent.prepared.contentDigest, kind: "data" },
        attemptId: intent.attemptId, path: outputPath, mimeType: "application/json", fixture: false, physicalDurationSeconds: null, byteLength: Buffer.byteLength(bytes) },
      completion: { kind: "timeline", documentDigest: intent.prepared.contentDigest } };
    writeFileSync(join(directory, `${intent.id}.receipt.json`), JSON.stringify(result)); return result;
  };
  const port = { identity, maxOutputBytes: 256 * 1024 * 1024,
    async prepare(projectId, nodeId) { return prepare(projectId, nodeId); },
    matches(prepared) { try { return canonical(prepare(prepared.projectId, prepared.nodeId)) === canonical(prepared); } catch { return false; } },
    async recover(intent, call) { recoveries++; if (options.recover) await options.recover(intent, call);
      const receipt = join(directory, `${intent.id}.receipt.json`); return existsSync(receipt) ? JSON.parse(readFileSync(receipt, "utf8")) : null; },
    async execute(intent, call) {
      executes++; const dispatch = store.get("local_execution_dispatch", intent.id), attempt = store.get("attempt", intent.id);
      assert.equal(dispatch.owner, call.expectedLease.owner); assert.equal(dispatch.epoch, call.expectedLease.epoch);
      assert.equal(attempt.leaseOwner, call.expectedLease.owner); assert.equal(attempt.leaseEpoch, call.expectedLease.epoch);
      assert.ok(attempt.leaseExpiresAt > Date.now());
      if (options.execute) return options.execute(intent, call, complete);
      return complete(intent);
    } };
  const makeEngine = extra => new Engine(store, provider, { artifactDir, localExecution: port, leaseMs: options.leaseMs ?? 3000, ...extra });
  engine = makeEngine(); const planId = randomUUID(); engine.installPlan(project.id, planId, plan); store.saveProject({ ...project, activePlanId: planId }, 0);
  return { directory, artifactDir, path, provider, port, projectId: project.id, nodeId: "timeline-node", plan, prepare, complete,
    get store() { return store; }, get engine() { return engine; }, makeEngine,
    semantic(value) { semantic = value; }, counts: () => ({ executes, recoveries }),
    reopen() { store.close(); store = new Store(path); engine = makeEngine(); } };
}

test("local completion binds application identity without vendor work and survives content-key reuse at a new target", async t => {
  const f = fixture(t), first = await f.engine.runReady(); assert.equal(first.dispatched, 1);
  const attempt = f.engine.attempts(f.projectId)[0];
  assert.equal(attempt.phase, "succeeded"); assert.equal(attempt.taskId, null); assert.equal(attempt.candidateId, null); assert.equal(attempt.reservationId, null);
  assert.equal(f.store.list("execution_evidence", f.projectId).length, 0); assert.equal(f.store.list("reservation", f.projectId).length, 0);
  assert.equal(f.store.list("grant", f.projectId).length, 0); assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.engine.outputs(f.projectId)[0].fixture, false);
  const current = f.store.getProject(f.projectId), id = randomUUID(); f.engine.installPlan(f.projectId, id, f.plan);
  f.store.saveProject({ ...current, activePlanId: id, revisionId: randomUUID() }, current.headVersion);
  assert.equal(f.engine.outputs(f.projectId).length, 0);
  const next = await f.engine.runReady(); assert.equal(next.reused, 1); assert.equal(f.counts().executes, 1);
  assert.equal(f.engine.attempts(f.projectId).length, 1); assert.equal(f.engine.outputs(f.projectId).length, 1);
  assert.equal(f.store.get("local_execution_binding", f.nodeId).prepared.capture.target.planId, id);
  assert.deepEqual(await f.engine.runReady(), { dispatched: 0, reused: 0, blocked: [] });
});

test("same active plan with changed captured semantics filters stale output and creates only new local work", async t => {
  const f = fixture(t); await f.engine.runReady(); const original = f.engine.outputs(f.projectId)[0].artifact;
  f.semantic(2); assert.equal(f.engine.outputs(f.projectId).length, 0);
  await f.engine.runReady(); assert.equal(f.counts().executes, 2); assert.notEqual(f.engine.outputs(f.projectId)[0].artifact.sha256, original.sha256);
  assert.equal(f.engine.attempts(f.projectId).length, 2); assert.ok(f.store.get("artifact", original.artifactId));
});

test("a stale pre-dispatch admission rebases identical content onto a fresh plan without retrying dispatched work", async t => {
  const barriers = [0, 1].map(() => ({ started: barrier(), release: barrier() })); let recoveries = 0;
  const f = fixture(t, { recover: async () => { const current = barriers[recoveries++]; if (current) { current.started.resolve(); await current.release.promise; } } });
  for (const currentBarrier of barriers) {
    const running = f.engine.runReady(); await currentBarrier.started.promise;
    try {
      const current = f.store.getProject(f.projectId), planId = randomUUID(); f.engine.installPlan(f.projectId, planId, f.plan);
      f.store.saveProject({ ...current, activePlanId: planId, revisionId: randomUUID() }, current.headVersion);
    } finally { currentBarrier.release.resolve(); }
    assert.equal((await running).blocked[0].code, "LOCAL_EXECUTION_STALE");
  }
  const originalIntents = f.store.list("local_execution_intent", f.projectId);
  assert.equal(f.store.list("local_execution_dispatch", f.projectId).length, 0); assert.equal(f.counts().executes, 0);
  f.reopen(); const rebased = await f.engine.runReady(); assert.equal(rebased.dispatched, 1, JSON.stringify(rebased));
  const attempts = f.engine.attempts(f.projectId).sort((a, b) => a.ordinal - b.ordinal);
  assert.equal(attempts.length, 3); assert.deepEqual(attempts.map(value => value.ordinal), [1, 2, 3]);
  assert.deepEqual(attempts.map(value => value.phase), ["failed", "failed", "succeeded"]);
  assert.equal(new Set(attempts.map(value => value.fingerprint)).size, 1); assert.equal(new Set(attempts.map(value => value.workKey)).size, 3);
  assert.equal(f.counts().executes, 1);
  for (const originalIntent of originalIntents) assert.deepEqual(f.store.get("local_execution_intent", originalIntent.id), originalIntent);
  assert.equal(f.store.list("local_execution_dispatch", f.projectId).length, 1); assert.equal(f.engine.outputs(f.projectId).length, 1);
});

test("prepared timeline requires a complete target and its exact canonical captured recipe", t => {
  const f = fixture(t), valid = f.prepare(f.projectId, f.nodeId); assertPreparedLocalExecution(valid);
  const incomplete = structuredClone(valid); delete incomplete.capture.target.headVersion;
  assert.throws(() => assertPreparedLocalExecution(incomplete), { code: "LOCAL_EXECUTION_CONFLICT" });
  const absentTarget = structuredClone(valid); absentTarget.capture.target = null;
  assert.throws(() => assertPreparedLocalExecution(absentTarget), { code: "LOCAL_EXECUTION_CONFLICT" });
  const unrelated = structuredClone(valid); unrelated.recipe = { unrelated: "not a timeline" }; unrelated.contentDigest = digest(unrelated.recipe);
  assert.throws(() => assertPreparedLocalExecution(unrelated), { code: "LOCAL_TIMELINE_INVALID" });
  const wrongRecipe = structuredClone(valid); wrongRecipe.recipe = createLocalTimelineDocument({ projectId: f.projectId,
    clips: [{ ...valid.capture.input.clips[0], startFrame: 1 }], audio: [] }); wrongRecipe.contentDigest = digest(wrongRecipe.recipe);
  assert.throws(() => assertPreparedLocalExecution(wrongRecipe), { code: "LOCAL_EXECUTION_CONFLICT" });
  const wrongInput = structuredClone(valid); wrongInput.capture.target.inputs[0].artifact.sha256 = "f".repeat(64);
  assert.throws(() => assertPreparedLocalExecution(wrongInput), { code: "LOCAL_EXECUTION_CONFLICT" });
});

test("missing runtime or incompatible saved lock never falls back to fake assembly", async t => {
  const f = fixture(t), noRuntime = new Engine(f.store, f.provider, { artifactDir: f.artifactDir });
  assert.equal((await noRuntime.runReady()).blocked[0].code, "LOCAL_EXECUTION_UNAVAILABLE");
  const current = f.store.getProject(f.projectId), lock = randomUUID();
  f.store.insert("capability_lock", lock, f.projectId, { profiles: DEFAULT_PROFILES }); f.store.saveProject({ ...current, capabilityLockId: lock }, current.headVersion);
  assert.equal((await f.engine.runReady()).blocked[0].code, "LOCAL_EXECUTION_UNSUPPORTED");
  assert.equal(f.engine.attempts(f.projectId).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

for (const failedKind of ["artifact", "local_execution_completion", "local_execution_binding"]) test(`lost ${failedKind} publication transaction recovers after reopen without a second execution`, async t => {
  const f = fixture(t), method = failedKind === "local_execution_binding" ? "put" : "insert", original = f.store[method].bind(f.store);
  f.store[method] = (...args) => { if (args[0] === failedKind) throw new DomainError("INJECTED_SQL_FAILURE", "Before publication commit"); return original(...args); };
  assert.equal((await f.engine.runReady()).blocked[0].code, "INJECTED_SQL_FAILURE"); f.store[method] = original;
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "ingesting"); assert.equal(f.store.list("local_execution_completion", f.projectId).length, 0);
  assert.equal(f.engine.outputs(f.projectId).length, 0);
  f.reopen(); assert.equal((await f.engine.reconcile()).reconciled, 1); assert.equal(f.counts().executes, 1);
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded"); assert.equal(f.engine.outputs(f.projectId).length, 1);
});

test("single-use dispatch without a completion is actionable and never automatically rerenders", async t => {
  const f = fixture(t, { execute: async () => { throw new DomainError("LOCAL_WORK_INTERRUPTED", "Before a completion"); } });
  await f.engine.runReady(); assert.equal(f.engine.attempts(f.projectId)[0].phase, "ingesting"); f.reopen();
  assert.equal((await f.engine.reconcile()).blocked[0].code, "LOCAL_EXECUTION_INTERRUPTED");
  await f.engine.runReady(); await f.engine.reconcile(); assert.equal(f.counts().executes, 1);
  assert.equal(f.engine.attempts(f.projectId)[0].failure.id, "LOCAL_EXECUTION_INTERRUPTED");
});

test("another SQLite worker cannot occupy local capacity and a stolen original lease cannot publish", async t => {
  const started = barrier(), release = barrier(); let originalSignal;
  const f = fixture(t, { execute: async (intent, call, complete) => { originalSignal = call.signal; started.resolve(); await release.promise; return complete(intent); } });
  const running = f.engine.runReady(); await started.promise;
  try {
    const secondStore = new Store(f.path), second = new Engine(secondStore, f.provider, { artifactDir: f.artifactDir, localExecution: f.port });
    try { assert.equal((await second.runReady()).blocked[0].code, "LOCAL_EXECUTION_BUSY"); }
    finally { secondStore.close(); }
    const current = f.engine.attempts(f.projectId)[0];
    f.store.put("attempt", current.id, f.projectId, { ...current, leaseOwner: "replacement-worker", leaseEpoch: current.leaseEpoch + 1 });
  } finally { release.resolve(); await running; }
  assert.equal(originalSignal.aborted, true); assert.equal(f.engine.outputs(f.projectId).length, 0);
  const current = f.engine.attempts(f.projectId)[0]; f.store.put("attempt", current.id, f.projectId, { ...current, leaseExpiresAt: 0 });
  await f.engine.reconcile(); assert.equal(f.counts().executes, 1); assert.equal(f.engine.outputs(f.projectId).length, 1);
});

test("late completed bytes under a new hold become history and are selected only after explicit release", async t => {
  const started = barrier(), release = barrier();
  const f = fixture(t, { execute: async (intent, call, complete) => { started.resolve(); await release.promise; return complete(intent); } });
  const running = f.engine.runReady(); await started.promise;
  const hold = f.engine.setHold(f.projectId, { scopeId: f.projectId, ownerId: "human-edit" }); release.resolve(); await running;
  // Completion can be registered as history immediately or recovered after the abort fence.
  await f.engine.reconcile(); assert.equal(f.engine.outputs(f.projectId).length, 0);
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded");
  f.engine.releaseHold(f.projectId, hold.id, "human-edit"); assert.equal((await f.engine.runReady()).reused, 1); assert.equal(f.counts().executes, 1);
});

test("malformed results and wrong artifact bytes cannot be published or accepted by record validators", async t => {
  const f = fixture(t, { execute: async (intent, call, complete) => { const result = complete(intent); result.artifact.artifact.sha256 = "f".repeat(64); return result; } });
  assert.equal((await f.engine.runReady()).blocked[0].code, "LOCAL_EXECUTION_CONFLICT"); assert.equal(f.engine.outputs(f.projectId).length, 0);
  assert.equal(f.store.list("local_execution_completion", f.projectId).length, 0);
  assert.throws(() => assertPreparedLocalExecution(null), { code: "LOCAL_EXECUTION_CONFLICT" });
  assert.throws(() => assertLocalExecutionResult(null, f.store.list("local_execution_intent", f.projectId)[0]), { code: "LOCAL_EXECUTION_CONFLICT" });
});
