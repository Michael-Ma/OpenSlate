import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compilePlan, DEFAULT_PROFILES } from "../../../packages/core/dist/index.js";
import { setup } from "./execution-fixture.mjs";

const unavailable = { code: "APPLICATION_INPUT_UNAVAILABLE" };
function snapshot(f) {
  return ["projects", "entities", "events", "commands"].map(table => f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}
for (const value of [null, undefined, false, {}, { kind: "owned_transcription", id: "unactivated", digest: "a".repeat(64) }])
test(`installPlan rejects applicationInput property presence (${String(value)}) before new writes or saved-plan replay`, t => {
  const f = setup(t, { count: 1, imagesOnly: true }), plan = structuredClone(f.plan), before = snapshot(f);
  plan.nodes[0].applicationInput = value;
  for (const id of [randomUUID(), f.store.getProject(f.projectId).activePlanId]) {
    assert.throws(() => f.engine.installPlan(f.projectId, id, plan), unavailable); assert.deepEqual(snapshot(f), before);
  }
});

test("applicationInput getter is rejected by presence without being invoked", t => {
  const f = setup(t, { count: 1, imagesOnly: true }), plan = structuredClone(f.plan); let invoked = 0;
  Object.defineProperty(plan.nodes[0], "applicationInput", { enumerable: true, get() { invoked++; return null; } });
  assert.throws(() => f.engine.installPlan(f.projectId, randomUUID(), plan), unavailable); assert.equal(invoked, 0);
});

test("scheduler and direct admission reject persisted unactivated inputs before source bytes or allowance policy", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }), node = f.plan.nodes[0], binding = f.store.get("node_binding", node.id);
  f.store.put("node_binding", binding.id, f.projectId, { ...binding, node: { ...binding.node, applicationInput: null } });
  const before = snapshot(f); let sourceReads = 0;
  f.engine.resolveInputs = () => { sourceReads++; throw Error("unactivated inputs must not reach bytes or resolution"); };
  assert.throws(() => f.engine.admit(f.projectId, node.id, "unused"), unavailable);
  const run = await f.engine.runReady(); assert.equal(run.dispatched, 0); assert.deepEqual(run.blocked, [{ nodeId: node.id, code: unavailable.code }]);
  assert.equal(sourceReads, 0); assert.equal(f.provider.acceptedCount(), 0); assert.deepEqual(snapshot(f), before);
});

test("ordinary absent applicationInput preserves existing fake installation and execution", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }), current = f.store.getProject(f.projectId);
  assert.equal(Object.hasOwn(f.plan.nodes[0], "applicationInput"), false);
  assert.equal(f.engine.installPlan(f.projectId, current.activePlanId, f.plan).planId, current.activePlanId);
  assert.equal((await f.engine.runReady()).dispatched, 1); await f.engine.reconcile();
  assert.equal(f.provider.acceptedCount(), 1); assert.equal(f.engine.outputs(f.projectId).length, 1);
});

test("the new compiler input surface remains unpublishable until the application binding service exists", t => {
  const f = setup(t, { count: 1, imagesOnly: true }), project = f.store.getProject(f.projectId), before = snapshot(f);
  const plan = compilePlan(`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{return p.transcription("words",{profile:"fake-transcription-v1",audio:p.transcriptionInput("binding"),timing:"word"});});`,
    { project, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: randomUUID,
      transcriptionInputs: [{ id: "binding", digest: "a".repeat(64), consumerAlias: "words", artifact: { artifactId: "draft", sha256: "b".repeat(64), kind: "audio" } }] });
  assert.equal(Object.hasOwn(plan.nodes[0], "applicationInput"), true);
  assert.throws(() => f.engine.installPlan(f.projectId, randomUUID(), plan), unavailable);
  assert.deepEqual(snapshot(f), before); assert.equal(f.provider.acceptedCount(), 0);
});
