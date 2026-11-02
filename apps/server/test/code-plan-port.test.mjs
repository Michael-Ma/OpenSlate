import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../dist/persistence/index.js";
import { CodePlanRuntime } from "../dist/code-plan/index.js";
import { CodePlanExecution } from "../dist/code-plan/execution.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { installRecoveryQuarantine } from "../dist/application/installation-recovery.js";
import { projectFixture } from "./execution-fixture.mjs";

const film = body => `export default async function film(ctx: Studio): Promise<void> { ${body} }`;
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-code-plan-port-"));
  const f = { directory, projectId: randomUUID(), calls: [] };
  const open = () => {
    f.store = new Store(join(directory, "store.sqlite"));
    f.provider = new FakeProvider(join(directory, "provider.sqlite"));
    const submit = f.provider.submit.bind(f.provider);
    f.provider.submit = async request => {
      f.calls.push(structuredClone(request));
      if (options.mode) f.provider.setMode(request.nodeId, options.mode);
      return submit(request);
    };
    f.execution = new CodePlanExecution(f.store, { provider: f.provider, artifactDir: join(directory, "artifacts") });
    f.runtime = new CodePlanRuntime(f.store, { execution: f.execution,
      ...(options.models ? { models: options.models } : {}), ...(options.limits ? { limits: options.limits } : {}) });
  };
  open();
  f.store.createProject({ ...projectFixture(f.projectId, 0), planMode: options.planMode ?? "code" });
  f.reopen = async () => { await f.runtime.close(); f.provider.close(); f.store.close(); open(); };
  t.after(async () => { await f.runtime.close(); f.provider.close(); f.store.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
}
const view = f => f.runtime.view(f.projectId);
const submit = (f, source, extra = {}) => f.runtime.submit(f.projectId, { source, author: "user",
  basedOnVersion: view(f).planVersion, invocationId: randomUUID(), ...extra });
const events = f => f.store.readEvents(f.projectId).filter(event => event.kind === "code_plan.changed");
const snapshot = f => JSON.stringify({ rows: f.store.db.prepare("SELECT * FROM entities ORDER BY rowid").all(),
  projects: f.store.db.prepare("SELECT * FROM projects ORDER BY rowid").all(), events: f.store.readEvents(f.projectId) });
async function settle(f, state = "done") {
  for (let i = 0; i < 30; i++) { await f.runtime.tick(); if (view(f).state === state) return view(f); }
  assert.fail(`Expected ${state}, got ${JSON.stringify(view(f))}`);
}
const paid = { paid: { kind: "image", priceMicros: "600000" }, "local-render": { kind: "render", priceMicros: "0" } };

test("port projects empty state, stores source and version diff, and fences stale submissions", async t => {
  const f = fixture(t), before = snapshot(f);
  assert.equal(view(f).state, "empty"); assert.equal(view(f).planVersion, null);
  assert.equal(view(f).ceilingMicros, "4000000"); assert.equal(f.runtime.failure(f.projectId), null);
  assert.equal(snapshot(f), before, "reads do not write");
  const source = film('ctx.log("first");'), result = await submit(f, source);
  assert.equal(result.version, 1); assert.deepEqual(view(f).versions[0].diff, result.diff);
  assert.equal(f.runtime.source(f.projectId, 1).source, source);
  assert.equal(f.runtime.source(f.projectId, 1).sha256, view(f).versions[0].sha256);
  const saved = snapshot(f);
  await assert.rejects(submit(f, film('ctx.log("stale");'), { basedOnVersion: null }), { code: "REVISION_CONFLICT" });
  assert.equal(snapshot(f), saved);
  assert.throws(() => f.runtime.source(f.projectId, 2), { code: "NOT_FOUND" });
});

test("invocation retries, concurrent retries and restart all return the original receipt", async t => {
  const f = fixture(t), invocationId = "lost-response";
  const input = { invocationId, basedOnVersion: null };
  const results = await Promise.all([submit(f, film('ctx.log("once");'), input), submit(f, film('ctx.log("once");'), input)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(view(f).versions.length, 1); assert.equal(events(f).length, 1);
  const before = snapshot(f);
  assert.deepEqual(await submit(f, "invalid retry source", input), results[0]);
  assert.equal(snapshot(f), before);
  await f.reopen();
  assert.deepEqual(await submit(f, "invalid retry source", input), results[0]);
  assert.equal(view(f).versions.length, 1);
});

test("new films can finish $3.60 of work under the default $4 ceiling", async t => {
  const f = fixture(t, { models: { paid: { kind: "image", priceMicros: "1800000" } } });
  await submit(f, film('await Promise.all(["front", "side"].map(prompt => ctx.image({ model: "paid", prompt })));'));
  await settle(f);
  assert.equal(view(f).ceilingMicros, "4000000"); assert.equal(view(f).spentMicros, "3600000");
  assert.equal(f.calls.length, 2);
  await f.reopen(); await f.runtime.replay(f.projectId);
  assert.equal(view(f).ceilingMicros, "4000000"); assert.equal(f.calls.length, 2);
});

test("stored one-dollar and zero ceilings survive first plan and restart, and a saved run wins over settings", async t => {
  for (const ceilingMicros of ["1000000", "0"]) {
    const f = fixture(t);
    f.runtime.setCeiling(f.projectId, { ceilingMicros, by: "person" });
    assert.equal(view(f).ceilingMicros, ceilingMicros);
    await submit(f, film('await ctx.log("Keep my limit");')); await settle(f);
    await f.reopen(); assert.equal(view(f).ceilingMicros, ceilingMicros);
    f.store.put("code_plan_settings", f.projectId, f.projectId, { ceilingMicros: "9000000" });
    assert.equal(view(f).ceilingMicros, ceilingMicros);
    assert.equal(f.calls.length, 0);
  }
});

test("concurrent distinct invocations cannot both replace the same base version", async t => {
  const f = fixture(t);
  const results = await Promise.allSettled([submit(f, film('ctx.log("one");')), submit(f, film('ctx.log("two");'))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "REVISION_CONFLICT");
  assert.equal(view(f).versions.length, 1);
});

test("dry runs write no entities, attempts, choices, runs, events or cursor", async t => {
  const f = fixture(t, { models: paid }), before = snapshot(f);
  const diff = await f.runtime.dryRun(f.projectId, film(`
    ctx.scene({ id: "scene" }); ctx.shot({ id: "shot" }); ctx.log("preview");
    await Promise.all([ctx.image({ model: "paid", prompt: "new" }), ctx.choose("pick", { question: "Pick?", options: [1, 2] })]);
  `));
  assert.equal(diff.newSteps.length, 1); assert.equal(diff.certainMicros, "600000");
  assert.equal(diff.dependsOnPending, true); assert.equal(f.calls.length, 0);
  assert.equal(snapshot(f), before); assert.deepEqual(diff.findings, []);
});

test("one-shot motion preview identifies exactly one new video and render and reuses the other effects", async t => {
  const f = fixture(t);
  // The assembly descriptor is available independently of the pending clip.
  // A sequential await would correctly stop the preview at that pending result.
  const source = motion => film(`
    const frames = await Promise.all(["front", "side"].map(prompt => ctx.image({ prompt })));
    const fixed = await ctx.video({ firstFrame: frames[1].artifact, motion: "static" });
    await Promise.all([
      ctx.video({ firstFrame: frames[0].artifact, motion: ${JSON.stringify(motion)} }),
      ctx.render({ timeline: [{ artifact: fixed.artifact, motion: ${JSON.stringify(motion)} }] })
    ]);
  `);
  await submit(f, source("push")); await settle(f);
  const before = snapshot(f), diff = await f.runtime.dryRun(f.projectId, source("pan"));
  assert.deepEqual(diff.newSteps.map(step => step.kind).sort(), ["render", "video"]);
  assert.equal(diff.reusedSteps, 3); assert.equal(diff.dependsOnPending, true);
  assert.equal(snapshot(f), before);
  await submit(f, source("pan")); const after = await settle(f);
  assert.equal(after.steps.filter(step => step.reached).length, 5);
  assert.equal(after.steps.filter(step => !step.reached).length, 2);
});

test("preview stops at unresolved results and reuses in-flight steps without pretending to know later cost", async t => {
  const f = fixture(t, { mode: "pending" });
  const source = film('const frame = await ctx.image({ prompt: "pending" }); await ctx.video({ firstFrame: frame.artifact });');
  await submit(f, source); await f.runtime.tick();
  const before = snapshot(f), diff = await f.runtime.dryRun(f.projectId, source);
  assert.equal(diff.reusedSteps, 1); assert.equal(diff.newSteps.length, 0); assert.equal(diff.dependsOnPending, true);
  assert.equal(snapshot(f), before);
});

for (const [name, source, code] of [
  ["type stripping", 'export default async function film(: {', "SOURCE_SYNTAX"],
  ["module syntax", 'export default async function film() { return @; }', "SOURCE_SYNTAX"],
  ["module evaluation", 'throw new Error("module bug"); export default async function film() {}', "SOURCE_SYNTAX"],
  ["runtime", film('throw new Error("program bug");'), "RUNTIME_ERROR"],
]) test(`${name} errors are findings and submit rejects them without writing`, async t => {
  const f = fixture(t), before = snapshot(f);
  const diff = await f.runtime.dryRun(f.projectId, source);
  assert.equal(diff.findings[0].code, code); assert.ok(diff.findings[0].detail.length);
  await assert.rejects(submit(f, source), error => error.code === "CODE_PLAN_REJECTED" && error.details.diff.findings[0].code === code);
  assert.equal(snapshot(f), before); assert.equal(f.calls.length, 0);
});

test("unawaited calls are warnings while await, then, catch and Promise.all attach consumers", async t => {
  const f = fixture(t);
  const warning = await f.runtime.dryRun(f.projectId, film('ctx.image({ prompt: "forgotten" });'));
  assert.equal(warning.findings[0].code, "UNAWAITED_CALL"); assert.equal(warning.findings[0].detail, "image");
  for (const body of ['await ctx.image({ prompt: "await" });', 'ctx.image({ prompt: "then" }).then(() => {});',
    'ctx.image({ prompt: "catch" }).catch(() => {});', 'await Promise.all([ctx.image({ prompt: "all" })]);']) {
    assert.deepEqual((await f.runtime.dryRun(f.projectId, film(body))).findings, []);
  }
});

test("ceiling preview counts unique new prices and existing charged liability", async t => {
  const f = fixture(t, { models: paid });
  f.runtime.setCeiling(f.projectId, { ceilingMicros: "1000000", by: "person" });
  await submit(f, film('await ctx.image({ model: "paid", prompt: "spent" });')); await settle(f);
  assert.equal(view(f).spentMicros, "600000"); assert.equal(view(f).reservedMicros, "0");
  const diff = await f.runtime.dryRun(f.projectId, film('await Promise.all([ctx.image({ model: "paid", prompt: "new" }), ctx.image({ model: "paid", prompt: "new" })]);'));
  assert.equal(diff.newSteps.length, 1); assert.equal(diff.certainMicros, "600000");
  assert.deepEqual(diff.findings, [{ code: "CEILING" }]);
});

test("read model separates unknown possible charges from pending reservations", async t => {
  const f = fixture(t, { models: paid, mode: "pending" });
  await submit(f, film('await ctx.image({ model: "paid", prompt: "pending" });')); await settle(f, "waiting");
  assert.equal(view(f).reservedMicros, "600000"); assert.equal(view(f).spentMicros, "0");
  const step = f.runtime.steps(f.projectId)[0], attempt = f.store.get("attempt", step.attemptId);
  f.store.put("attempt", attempt.id, f.projectId, { ...attempt, phase: "submission_unknown" });
  assert.equal(view(f).reservedMicros, "0"); assert.equal(view(f).spentMicros, "600000");
});

test("held execution finishes existing work and free renders, release dispatches paid work exactly once", async t => {
  const f = fixture(t, { models: paid, mode: "pending" });
  f.runtime.setCeiling(f.projectId, { ceilingMicros: "1000000", by: "person" });
  const source = film(`
    const first = await ctx.image({ model: "paid", prompt: "first" });
    await Promise.all([ctx.render({ timeline: [first.artifact] }), ctx.image({ model: "paid", prompt: "second" })]);
  `);
  await submit(f, source); await settle(f, "waiting");
  f.runtime.raiseCeiling(f.projectId, "1200000");
  f.runtime.hold(f.projectId, "director"); f.runtime.hold(f.projectId, "director");
  f.provider.jobs().forEach(job => f.provider.complete(job.id));
  await f.runtime.tick();
  assert.deepEqual(f.calls.map(call => call.kind), ["image", "render"]);
  assert.equal(view(f).steps.find(step => step.label === "second").state, "absent");
  f.provider.jobs().forEach(job => f.provider.complete(job.id)); await f.runtime.tick();
  assert.equal(view(f).steps.find(step => step.kind === "render").state, "succeeded");
  f.runtime.release(f.projectId, "director"); f.runtime.release(f.projectId, "director");
  await f.runtime.tick(); await f.runtime.tick();
  assert.equal(f.calls.filter(call => call.args.prompt === "second").length, 1);
  f.provider.jobs().forEach(job => f.provider.complete(job.id)); await settle(f);
});

test("multiple holds survive restart, released identities never reopen, and holds work before the first plan", async t => {
  const f = fixture(t, { models: paid });
  f.runtime.hold(f.projectId, "one"); f.runtime.hold(f.projectId, "two");
  await submit(f, film('await ctx.image({ model: "paid", prompt: "held" });')); await settle(f, "waiting");
  assert.equal(f.calls.length, 0); await f.reopen();
  assert.equal(view(f).held, true); await f.runtime.tick(); assert.equal(f.calls.length, 0);
  f.runtime.release(f.projectId, "one"); f.runtime.hold(f.projectId, "one"); await f.runtime.tick(); assert.equal(f.calls.length, 0);
  f.runtime.release(f.projectId, "two"); await settle(f); assert.equal(f.calls.length, 1);
  f.runtime.release(f.projectId, "late"); f.runtime.hold(f.projectId, "late"); assert.equal(view(f).held, false);
});

test("dry run counts cancellation only for unsent live steps and does not cancel them itself", async t => {
  const f = fixture(t, { models: paid }); f.runtime.hold(f.projectId, "hold");
  await submit(f, film('await ctx.image({ model: "paid", prompt: "removed" });')); await settle(f, "waiting");
  const before = snapshot(f), diff = await f.runtime.dryRun(f.projectId, film('ctx.log("no media");'));
  assert.equal(diff.cancelledSteps, 1); assert.equal(snapshot(f), before);
  await submit(f, film('ctx.log("no media");')); await settle(f);
  assert.equal(view(f).steps[0].state, "cancelled"); assert.equal(view(f).steps[0].reached, false);
  assert.equal((await f.runtime.dryRun(f.projectId, film('ctx.log("no media");'))).cancelledSteps, 0);
});

test("events advance cursor once per change and stay silent on idle ticks and identical replays, including restart", async t => {
  const f = fixture(t), source = film('const answer = await ctx.choose("pick", { question: "Pick?", options: [1, 2] }); ctx.log(String(answer));');
  await submit(f, source); assert.equal(events(f).length, 1);
  await f.runtime.tick(); assert.equal(events(f).length, 2);
  await f.runtime.tick(); await f.runtime.replay(f.projectId); assert.equal(events(f).length, 2);
  const choice = view(f).choices[0], answer = { choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, answer: 1 };
  f.runtime.answer(f.projectId, answer); assert.equal(events(f).length, 3);
  f.runtime.answer(f.projectId, answer); assert.equal(events(f).length, 3);
  await settle(f); assert.equal(events(f).length, 4);
  f.runtime.raiseCeiling(f.projectId, "5000000"); assert.equal(events(f).length, 5);
  await f.runtime.tick(); assert.equal(events(f).length, 5);
  f.runtime.hold(f.projectId, "one"); f.runtime.hold(f.projectId, "one"); assert.equal(events(f).length, 6);
  f.runtime.release(f.projectId, "one"); f.runtime.release(f.projectId, "one"); assert.equal(events(f).length, 7);
  await f.reopen(); await f.runtime.tick(); assert.equal(events(f).length, 7);
  assert.equal(f.store.cursor(f.projectId), 7);
  assert.deepEqual(events(f).at(-1).payload, { planVersion: 1, state: "done" });
});

test("read model caps version history, orders choices and bounds display labels", async t => {
  const f = fixture(t);
  for (let i = 0; i < 51; i++) f.runtime.submitPlan(f.projectId, film(`ctx.log("${i}");`));
  assert.equal(view(f).versions.length, 50); assert.equal(view(f).versions[0].version, 51); assert.equal(view(f).versions.at(-1).version, 2);
  await submit(f, film(`await Promise.all([ctx.choose("first", { question: "A?", options: [null] }), ctx.choose("second", { question: "B?", options: [true] }), ctx.image({ prompt: "x".repeat(220), motion: "hidden" }), ctx.video({ motion: "pan", aspectRatio: "16:9" })]);`));
  await settle(f, "waiting");
  const choice = view(f).choices[0]; f.runtime.answer(f.projectId, { ...choice, answer: null });
  assert.deepEqual(view(f).choices.map(choice => choice.choiceId), ["second", "first"]);
  assert.equal(view(f).steps.find(step => step.kind === "image").label.length, 200);
  assert.equal(view(f).steps.find(step => step.kind === "video").label, "pan");
});

test("failure is scoped to the current version and clears on a replacement", async t => {
  const f = fixture(t);
  f.runtime.submitPlan(f.projectId, film('throw new Error("latest error");'));
  await settle(f, "error"); assert.equal(f.runtime.failure(f.projectId).version, 1);
  assert.match(f.runtime.failure(f.projectId).message, /latest error/); assert.equal(typeof f.runtime.failure(f.projectId).stack, "string");
  await submit(f, film('ctx.log("fixed");')); assert.equal(f.runtime.failure(f.projectId), null); await settle(f);
});

test("200 dispatched steps remain available after more than 200 held and cancelled steps; the 201st is refused", async t => {
  const f = fixture(t, { models: { paid: { kind: "image", priceMicros: "1" }, free: { kind: "image", priceMicros: "0" } },
    limits: { cpuMs: 5000, memoryMb: 64 } });
  f.runtime.hold(f.projectId, "many");
  f.runtime.submitPlan(f.projectId, film('await Promise.all(Array.from({ length: 205 }, (_, i) => ctx.image({ model: "paid", prompt: "held " + i })));'));
  await f.runtime.replay(f.projectId); assert.equal(f.calls.length, 0); assert.equal(view(f).steps.length, 205);
  const source = film('await Promise.all(Array.from({ length: 200 }, (_, i) => ctx.image({ model: "free", prompt: "free " + i })));');
  const diff = await f.runtime.dryRun(f.projectId, source); assert.equal(diff.cancelledSteps, 205); assert.deepEqual(diff.findings, []);
  f.runtime.submitPlan(f.projectId, source); await f.runtime.replay(f.projectId);
  assert.equal(f.calls.length, 200); assert.equal(view(f).steps.filter(step => step.state === "cancelled").length, 205);
  const over = await f.runtime.dryRun(f.projectId, film('await ctx.image({ model: "free", prompt: "201st" });'));
  assert.deepEqual(over.findings, [{ code: "STEP_LIMIT" }]);
  f.runtime.submitPlan(f.projectId, film('await ctx.image({ model: "free", prompt: "201st" });'));
  await f.runtime.replay(f.projectId); assert.equal(view(f).state, "error"); assert.equal(f.calls.length, 200);
});

test("all port methods reject unknown and graph projects", async t => {
  const f = fixture(t, { planMode: "graph" });
  for (const [id, code] of [[f.projectId, "CODE_PLAN_MODE"], [randomUUID(), "NOT_FOUND"]]) {
    for (const call of [() => f.runtime.view(id), () => f.runtime.stepDetail(id, "unknown-step"), () => f.runtime.source(id, 1), () => f.runtime.failure(id),
      () => f.runtime.answer(id, { choiceId: "x", optionsDigest: "x", answer: 1 }), () => f.runtime.raiseCeiling(id, "2000000"),
      () => f.runtime.hold(id, "x"), () => f.runtime.release(id, "x")]) assert.throws(call, { code });
    await assert.rejects(f.runtime.dryRun(id, film('')), { code });
    await assert.rejects(f.runtime.submit(id, { source: film(''), author: "user", basedOnVersion: null, invocationId: "x" }), { code });
  }
});

test("quarantine blocks every write but preserves read-only inspection and dry run", async t => {
  const f = fixture(t);
  await submit(f, film('await ctx.choose("pick", { question: "Pick?", options: [1] });')); await settle(f, "waiting");
  const choice = view(f).choices[0];
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64),
    sourceDatabaseSha256: "b".repeat(64), originalDataRoot: f.directory, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
  const before = snapshot(f);
  for (const call of [() => f.runtime.answer(f.projectId, { ...choice, answer: 1 }), () => f.runtime.raiseCeiling(f.projectId, "2000000"),
    () => f.runtime.hold(f.projectId, "x"), () => f.runtime.release(f.projectId, "x")]) assert.throws(call, { code: "INSTALLATION_QUARANTINED" });
  await assert.rejects(submit(f, film('')), { code: "INSTALLATION_QUARANTINED" });
  assert.equal(view(f).planVersion, 1); assert.ok(f.runtime.source(f.projectId, 1)); assert.equal(f.runtime.failure(f.projectId), null);
  await f.runtime.dryRun(f.projectId, film('await ctx.image({ prompt: "read only" });')); assert.equal(snapshot(f), before);
});

test("first submission dry run and live run share the exact clock and random seed", async t => {
  const f = fixture(t);
  const result = await submit(f, film('await ctx.image({ prompt: JSON.stringify([Date.now(), Math.random()]) });'));
  await settle(f);
  assert.equal(result.diff.newSteps[0].label, view(f).steps[0].label);
});

test("held and budget-blocked identical replays do not emit timestamp-only changes", async t => {
  for (const hold of [true, false]) {
    const f = fixture(t, { models: { paid: { kind: "image", priceMicros: "4000001" } } });
    if (hold) f.runtime.hold(f.projectId, "held");
    await submit(f, film('await ctx.image({ model: "paid", prompt: "blocked" });'));
    await settle(f, hold ? "waiting" : "paused_budget");
    const count = events(f).length, updatedAt = view(f).steps[0].updatedAt;
    await f.runtime.replay(f.projectId); assert.equal(events(f).length, count); assert.equal(view(f).steps[0].updatedAt, updatedAt);
    await f.reopen(); await f.runtime.tick(); assert.equal(events(f).length, count);
  }
});

test("a hold opened during a pass fences its later paid calls", async t => {
  const f = fixture(t, { models: { free: { kind: "image" }, paid: { kind: "image", priceMicros: "1" } } });
  const dispatch = f.execution.submit.bind(f.execution);
  let held = false;
  f.execution.submit = id => {
    if (!held) { held = true; f.runtime.hold(f.projectId, "mid-pass"); }
    return dispatch(id);
  };
  await submit(f, film('await Promise.all([ctx.image({ model: "free", prompt: "free" }), ctx.image({ model: "paid", prompt: "later" })]);'));
  await settle(f, "waiting"); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].args.model, "free");
  f.runtime.release(f.projectId, "mid-pass"); await settle(f); assert.equal(f.calls.length, 2);
});

test('setCeiling lowers to liability, reports in-flight and unknown numbers, and supports the integer money range',async t=>{
 const f=fixture(t,{models:paid,mode:'pending'});await submit(f,film('await ctx.image({model:"paid",prompt:"pending"});'));await settle(f,'waiting');
 assert.equal(f.runtime.setCeiling(f.projectId,{ceilingMicros:'600000',by:'person'}).ceilingMicros,'600000');
 assert.throws(()=>f.runtime.setCeiling(f.projectId,{ceilingMicros:'599999',by:'person'}),e=>{
  assert.equal(e.code,'CODE_PLAN_CEILING');assert.equal(e.details.inFlightMicros,'600000');assert.equal(e.details.chargedMicros,'0');assert.equal(e.details.liabilityMicros,'600000');return true;
 });
 f.provider.poll=async()=>({type:'unknown',diagnostic:'remote status unavailable'});await f.runtime.tick();
 assert.throws(()=>f.runtime.setCeiling(f.projectId,{ceilingMicros:'0',by:'person'}),e=>{assert.equal(e.details.unknownMicros,'600000');assert.equal(e.details.inFlightMicros,'0');return true;});
 const input={ceilingMicros:'9223372036854775807',by:'director',quote:'raise my limit',invocationId:'limit-once'};
 const receipt=f.runtime.setCeiling(f.projectId,input);assert.equal(receipt.ceilingMicros,input.ceilingMicros);
 f.runtime.setCeiling(f.projectId,{ceilingMicros:'700000',by:'person'});
 assert.deepEqual(f.runtime.setCeiling(f.projectId,input),receipt);
 assert.throws(()=>f.runtime.setCeiling(f.projectId,{...input,ceilingMicros:'800000'}),{code:'IDEMPOTENCY_CONFLICT'});
});
