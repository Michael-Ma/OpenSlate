import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { compilePlan, compilePlanIsolated, diffPlans, digest, effectiveNodeDigest, snapshotLocalExecution } from "../dist/index.js";
import { localPlanContext, localPlanSource } from "./local-execution-fixture.mjs";

const identity = () => ({ adapter: "local-media", version: "1" });
const localContext = () => ({ ...localPlanContext(), localExecution: identity() });
const assembly = plan => plan.nodes.filter(node => ["timeline", "render"].includes(node.kind));
const resolved = node => node.inputs.map(input => ({ destinationPort: input.destinationPort, role: input.role, order: input.order, sha256: "e".repeat(64) }));

test("omitted local execution preserves the previously captured legacy plan bytes and all graph digests", () => {
  const plan = compilePlan(localPlanSource, localPlanContext());
  // Captured against the pre-change compiler, with deterministic source and all aliases preassigned.
  assert.equal(createHash("sha256").update(JSON.stringify(plan)).digest("hex"), "66ddaa339d83d7c0c1d6971a0b6b349797c7b703f01597329b6682145e704795");
  assert.equal(digest(plan), "b32f9af5046e3845ab3610c9c7e6c19187f3aad10c74169b4867897563fbd359");
  assert.equal(plan.graphDigest, "f6bc2365ef270ab2924a0e20fc2a1adf0334a1b1b542e97f0dc4b0bf4bbcc0eb");
  assert.equal(digest(plan.canonicalSource), "48bcc713ebcccfb45807b5fa75d95b45a7f9aabd7c486c2a61d4ebb6377bb3ef");
  assert.ok(plan.nodes.every(node => !Object.hasOwn(node.args, "localExecution")));
  assert.equal(JSON.stringify(compilePlan(localPlanSource, { ...localPlanContext(), localExecution: undefined })), JSON.stringify(plan));
});

test("trusted local identity changes only assembly recipes and resolved work identity, preserving video and review", () => {
  const legacy = compilePlan(localPlanSource, localPlanContext()), real = compilePlan(localPlanSource, localContext());
  assert.deepEqual(real.nodes.slice(0, 2), legacy.nodes.slice(0, 2)); assert.deepEqual(real.gates, legacy.gates);
  assert.equal(real.source, legacy.source); assert.equal(real.canonicalSource, legacy.canonicalSource);
  assert.notEqual(real.graphDigest, legacy.graphDigest);
  assert.deepEqual(diffPlans(legacy, real).map(value => value.kind), ["reuse", "reuse", "replace", "replace"]);
  for (const [index, node] of real.nodes.entries()) {
    if (["timeline", "render"].includes(node.kind)) {
      assert.deepEqual(node.args.localExecution, identity()); assert.ok(Object.isFrozen(node.args.localExecution));
      assert.notEqual(node.specDigest, legacy.nodes[index].specDigest);
      assert.notEqual(effectiveNodeDigest(node, resolved(node)), effectiveNodeDigest(legacy.nodes[index], resolved(node)));
    } else assert.equal(effectiveNodeDigest(node, resolved(node)), effectiveNodeDigest(legacy.nodes[index], resolved(node)));
  }
  assert.notEqual(assembly(real)[0].args.localExecution, assembly(real)[1].args.localExecution);
});

test("local identity helper snapshots plain data, rejects unsupported shape and never invokes accessor properties", () => {
  const original = identity(), snapshot = snapshotLocalExecution(original); original.version = "2";
  assert.deepEqual(snapshot, identity()); assert.ok(Object.isFrozen(snapshot)); assert.throws(() => { snapshot.version = "2"; }, TypeError);
  assert.deepEqual(snapshotLocalExecution(Object.assign(Object.create(null), identity())), identity());
  let reads = 0; const accessor = { get adapter() { reads++; return "local-media"; }, version: "1" };
  const hidden = identity(); Object.defineProperty(hidden, "path", { value: "/private/not-a-config-field", enumerable: false });
  for (const value of [undefined, null, 0, false, "local-media", [], new Date(), new Map(), Object.create(identity()), accessor, hidden,
    {}, { adapter: "local-media" }, { ...identity(), version: 1 }, { ...identity(), version: "2" }, { ...identity(), adapter: "fake" },
    { ...identity(), path: "/private/host" }, { ...identity(), settings: {} }, { ...identity(), [Symbol("extra")]: true }])
    assert.throws(() => snapshotLocalExecution(value), { code: "LOCAL_EXECUTION_UNSUPPORTED" });
  assert.equal(reads, 0);
});

test("invalid explicit context rejects predictably at direct and isolated entry without allocating aliases", async () => {
  for (const value of [null, 0, false, [], { adapter: "local-media", version: "2" }, { ...identity(), executable: "/bin/sh" }]) {
    const context = { ...localPlanContext(), localExecution: value }, aliases = structuredClone(context.logicalIds);
    assert.throws(() => compilePlan(localPlanSource, context), { code: "LOCAL_EXECUTION_UNSUPPORTED" });
    await assert.rejects(compilePlanIsolated(localPlanSource, context), { code: "LOCAL_EXECUTION_UNSUPPORTED" });
    assert.deepEqual(context.logicalIds, aliases);
  }
});

test("direct compilation captures local context before an allocator callback can change the caller's selection", () => {
  const context = localContext(); context.logicalIds = {}; let sequence = 0;
  context.allocateId = () => { context.localExecution.version = "2"; context.localExecution = null; return `allocated-${++sequence}`; };
  // Mutate only on the first callback; subsequent allocations still return normal deterministic IDs.
  const allocate = context.allocateId; context.allocateId = () => sequence ? `allocated-${++sequence}` : allocate();
  const plan = compilePlan(localPlanSource, context);
  for (const node of assembly(plan)) assert.deepEqual(node.args.localExecution, identity());
});

test("isolated compilation snapshots local identity before await and agrees with direct compilation", async () => {
  const context = localContext(), direct = compilePlan(localPlanSource, localContext()), selected = context.localExecution;
  const pending = compilePlanIsolated(localPlanSource, context); selected.version = "2"; context.localExecution = { adapter: "other", version: "99" };
  const isolated = await pending; assert.deepEqual(isolated, direct);
  for (const node of assembly(isolated)) {
    assert.ok(Object.isFrozen(node.args.localExecution)); assert.throws(() => { node.args.localExecution.version = "2"; }, TypeError);
  }
});

test("the worker itself validates unsupported local identity when called through its fixed protocol", async t => {
  const { allocateId, ...context } = localPlanContext();
  const worker = new Worker(new URL("../dist/planning/worker.js", import.meta.url), { workerData: { ...context, source: localPlanSource, localExecution: null } });
  t.after(() => worker.terminate());
  const result = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); worker.once("exit", code => { if (code) reject(Error(`worker exit ${code}`)); }); });
  assert.equal(result.ok, false); assert.equal(result.error.code, "LOCAL_EXECUTION_UNSUPPORTED");
});

test("canonical source roundtrips with the same trusted context without embedding host execution settings", async () => {
  const context = localContext(), original = compilePlan(localPlanSource, context);
  assert.equal(original.canonicalSource.includes("localExecution"), false);
  const direct = compilePlan(original.canonicalSource, context), isolated = await compilePlanIsolated(original.canonicalSource, context);
  assert.equal(direct.graphDigest, original.graphDigest); assert.deepEqual(direct.nodes, original.nodes); assert.deepEqual(isolated, direct);
  assert.equal(compilePlan(original.canonicalSource, localPlanContext()).graphDigest, "f6bc2365ef270ab2924a0e20fc2a1adf0334a1b1b542e97f0dc4b0bf4bbcc0eb");
});

test("planning syntax cannot select local execution, host paths or executable behavior", async () => {
  const attempts = [
    localPlanSource.replace('baseRevision:"revision-1"', 'baseRevision:"revision-1",localExecution:{adapter:"local-media",version:"1"}'),
    localPlanSource.replace('takes:[video]', 'takes:[video],localExecution:{adapter:"local-media",version:"1"}'),
    localPlanSource.replace('width:1280', 'localExecution:{adapter:"local-media",version:"1"},width:1280'),
    localPlanSource.replace('width:1280', 'path:"/private/output.mp4",width:1280'),
    localPlanSource.replace('width:1280', 'executable:"/bin/sh",width:1280'),
    localPlanSource.replace('width:1280', 'width:(()=>{globalThis.localExecutionTest=true;return 1280})()'),
  ];
  for (const source of attempts) {
    assert.throws(() => compilePlan(source, localContext()));
    await assert.rejects(compilePlanIsolated(source, localContext()));
    assert.equal(globalThis.localExecutionTest, undefined);
  }
});
