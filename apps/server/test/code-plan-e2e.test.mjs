import test from "node:test";
import assert from "node:assert/strict";
import { codePlanFixture, runCodePlanOfflineFlow } from "./code-plan-e2e-fixture.mjs";

test("real HTTP code-plan stack goes from a human message to frame choices, motion edit and lookup recovery", { timeout: 30000 }, async t => {
  const f = await codePlanFixture(); t.after(() => f.close());
  t.mock.method(globalThis, "fetch", () => assert.fail("The offline flow must not call the network"));
  const summary = await runCodePlanOfflineFlow(f);
  assert.equal(summary.finalState, "done"); assert.deepEqual(summary.versions, [1, 2, 3, 4]);
  assert.deepEqual(summary.edit.newSteps, ["render", "video"]); assert.equal(summary.edit.reusedSteps, 8);
});

const source = body => `export default async function film(ctx: Studio): Promise<void> { ${body} }`;

test("real source route enforces authentication, command replay, stale versions and dry-run rejection without side effects", async t => {
  const f = await codePlanFixture(); t.after(() => f.close());
  const project = await f.create(), base = `/api/projects/${project.id}/code-plan`;
  const input = { source: source('await ctx.log("saved");'), basedOnVersion: null };
  for (const [headers, status] of [[{ cookie: "" }, 403], [{ "x-openslate-csrf": "" }, 403], [{ "idempotency-key": "" }, 400]]) {
    const response = await f.http("POST", `${base}/source`, input, "denied", headers);
    assert.equal(response.statusCode, status, response.body);
  }
  assert.equal((await f.view(project.id)).planVersion, null);
  assert.equal(f.events(project.id).length, 1, "Creation publishes the empty code view once");
  const accepted = await f.ok("POST", `${base}/source`, input, "first");
  await f.until(project.id, view => view.state === "done", "log-only film");
  const eventCount = f.events(project.id).length;
  assert.deepEqual(await f.ok("POST", `${base}/source`, input, "first"), accepted);
  for (const [body, key, code] of [[{ ...input, source: source('await ctx.log("changed");') }, "first", "IDEMPOTENCY_CONFLICT"],
    [input, "stale", "REVISION_CONFLICT"], [{ source: "export default ???", basedOnVersion: 1 }, "invalid", "CODE_PLAN_REJECTED"]]) {
    const response = await f.http("POST", `${base}/source`, body, key);
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, code);
    if (code === "CODE_PLAN_REJECTED") assert.ok(response.json().error.details.diff.findings.some(finding => finding.code === "SOURCE_SYNTAX"));
  }
  assert.equal((await f.view(project.id)).planVersion, 1);
  assert.equal(f.events(project.id).length, eventCount); assert.equal(f.calls.submit.length, 0);
});

test("a lost HTTP source result replays the real runtime invocation after reopening storage", async t => {
  const f = await codePlanFixture(); t.after(() => f.close());
  const project = await f.create(), base = `/api/projects/${project.id}/code-plan`;
  const input = { source: source('await ctx.log("once");'), basedOnVersion: null };
  const submit = f.runtime.submit.bind(f.runtime);
  f.runtime.submit = async (...args) => { await submit(...args); throw Error("Injected loss after version publication"); };
  const lost = await f.http("POST", `${base}/source`, input, "lost-result"); assert.equal(lost.statusCode, 500);
  assert.equal(f.store.list("code_plan_version", project.id).length, 1);
  await f.restart();
  const before = f.events(project.id).length;
  const recovered = await f.ok("POST", `${base}/source`, input, "lost-result");
  assert.equal(recovered.view.planVersion, 1); assert.equal(f.events(project.id).length, before);
  assert.equal(f.store.list("code_plan_invocation", project.id).length, 1);
  await f.until(project.id, view => view.state === "done", "recovered source");
  assert.equal(f.calls.submit.length, 0);
});

test("restart keeps an unknown job reserved across unavailable lookups, then finishes with zero new submissions", async t => {
  const f = await codePlanFixture(); t.after(() => f.close());
  const project = await f.create(), base = `/api/projects/${project.id}/code-plan`;
  await f.ok("POST", `${base}/source`, { source: source('await ctx.image({ prompt: "Recover once" });'), basedOnVersion: null }, "recover");
  f.controls.loseNextKind = "image"; await f.tick();
  const attemptId = f.calls.submit[0].attemptId;
  assert.equal(f.store.get("attempt", attemptId).phase, "submission_unknown");
  f.controls.lookupUnavailable = true; await f.restart();
  await f.tick(); const before = f.events(project.id).length;
  for (let idle = 0; idle < 3; idle++) await f.tick();
  let view = await f.view(project.id);
  assert.equal(view.steps[0].state, "unknown"); assert.equal(view.state, "waiting"); assert.equal(view.spentMicros, "10000");
  assert.equal(f.events(project.id).length, before); assert.equal(f.calls.submit.length, 1);
  f.controls.lookupUnavailable = false;
  view = await f.until(project.id, view => view.state === "done", "lookup recovery");
  assert.equal(view.steps[0].state, "succeeded"); assert.equal(f.calls.submit.length, 1);
  assert.equal(f.provider.acceptedCount(attemptId), 1); assert.ok(f.calls.lookup.every(id => id === attemptId));
  f.changed(project.id, before, "successful lookup");
});

test("HTTP ceiling changes resume only blocked work and never resubmit admitted work", async t => {
  const f = await codePlanFixture({ imagePriceMicros: "600000" }); t.after(() => f.close());
  const project = await f.create(), base = `/api/projects/${project.id}/code-plan`;
  await f.ok("POST", `${base}/ceiling`, { ceilingMicros: "1000000" }, "stored-one-dollar-limit");
  const input = { source: source('await Promise.all(["one", "two"].map(prompt => ctx.image({ prompt })));'), basedOnVersion: null };
  const receipt = await f.ok("POST", `${base}/source`, input, "budget");
  assert.ok(receipt.diff.findings.some(finding => finding.code === "CEILING"));
  await f.tick(); await f.tick();
  let view = await f.view(project.id);
  assert.equal(view.state, "paused_budget"); assert.equal(view.spentMicros, "600000"); assert.equal(f.calls.submit.length, 1);
  const before = f.events(project.id).length;
  for (let idle = 0; idle < 3; idle++) await f.tick();
  assert.equal(f.events(project.id).length, before); assert.equal(f.calls.submit.length, 1);
  const raised = await f.ok("POST", `${base}/ceiling`, { ceilingMicros: "1200000" }, "raise");
  f.changed(project.id, before, "ceiling increase");
  assert.deepEqual(await f.ok("POST", `${base}/ceiling`, { ceilingMicros: "1200000" }, "raise"), raised);
  view = await f.until(project.id, view => view.state === "done", "raised ceiling");
  assert.equal(view.spentMicros, "1200000"); assert.equal(f.calls.submit.length, 2);
  assert.equal(new Set(f.calls.submit.map(call => call.attemptId)).size, 2);
});
