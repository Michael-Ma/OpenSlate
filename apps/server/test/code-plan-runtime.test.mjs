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
import { ExecutionIngestionRouter } from "../dist/execution/ingestion-router.js";
import { installRecoveryQuarantine } from "../dist/application/installation-recovery.js";
import { projectFixture } from "./execution-fixture.mjs";

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-code-plan-runtime-"));
  const paths = { database: join(directory, "store.sqlite"), provider: join(directory, "provider.sqlite"), artifacts: join(directory, "artifacts") };
  const calls = { submit: [], poll: [], lookup: [] };
  const f = { directory, paths, calls, projectId: randomUUID() };
  const open = () => {
    f.store = new Store(paths.database); f.provider = new FakeProvider(paths.provider);
    const submit = f.provider.submit.bind(f.provider), poll = f.provider.poll.bind(f.provider), lookup = f.provider.lookup.bind(f.provider);
    f.provider.submit = async request => {
      // No external side effect may precede its durable immutable submission intent.
      const intent = f.store.get("attempt", request.attemptId);
      assert.deepEqual(intent.request, request); assert.equal(intent.phase, "submitting");
      calls.submit.push(structuredClone(request));
      if (options.mode) f.provider.setMode(request.nodeId, options.mode(request));
      return submit(request);
    };
    f.provider.poll = async (taskId, request) => { calls.poll.push(taskId); return poll(taskId, request); };
    f.provider.lookup = async (attemptId, request) => {
      calls.lookup.push(attemptId);
      assert.equal(f.store.get("attempt", attemptId).phase, "submission_unknown");
      if (options.recoverLostReceipt) {
        const job = f.provider.jobs().find(value => value.attemptId === attemptId);
        if (job) return poll(job.id, request);
      }
      return lookup(attemptId, request);
    };
    f.execution = new CodePlanExecution(f.store, { provider: f.provider, artifactDir: paths.artifacts });
    f.runtime = new CodePlanRuntime(f.store, { execution: f.execution, ...(options.models ? { models: options.models } : {}), ...(options.limits ? { limits: options.limits } : {}) });
  };
  open();
  const project = { ...projectFixture(f.projectId, 0), ...(options.planMode === undefined ? { planMode: "code" } : options.planMode === null ? {} : { planMode: options.planMode }) };
  f.store.createProject(project);
  if (options.ceilingMicros !== undefined) f.store.put("code_plan_settings", f.projectId, f.projectId, { ceilingMicros: options.ceilingMicros });
  f.reopen = () => { f.provider.close(); f.store.close(); open(); };
  t.after(() => { if (f.provider.db.open) f.provider.close(); if (f.store.db.open) f.store.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
}

const film = body => `export default async function film(ctx: Studio): Promise<void> { ${body} }`;
const submit = (f, source) => f.runtime.submitPlan(f.projectId, source);
const replay = f => f.runtime.replay(f.projectId);
async function settle(f, state = "done", max = 30) {
  for (let turn = 0; turn < max; turn++) {
    await f.runtime.tick();
    if (f.runtime.getRun(f.projectId)?.state === state) return f.runtime.getRun(f.projectId);
  }
  assert.fail(`Code plan did not reach ${state}: ${JSON.stringify(f.runtime.getRun(f.projectId))}`);
}
const resultView = run => ({ state: run.state, declarations: run.declarations, logs: run.logs, error: run.error });

test("code-plan replay reuses ingested results, declarations, stable Date and seeded random", async t => {
  const f = fixture(t);
  submit(f, film(`
    const title: string = "Opening";
    ctx.scene({ id: "scene-1", title }); ctx.shot({ id: "shot-1", sceneId: "scene-1" });
    ctx.log(JSON.stringify([Date.now(), new Date().getTime(), Math.random(), Math.random()]));
    const image = await ctx.image({ prompt: "A boot on a bench" });
    if (!image.ok) throw new Error("Expected fake image");
    ctx.log(image.artifact.sha256);
  `));
  const done = await settle(f), calls = f.calls.submit.length;
  assert.equal(calls, 1); assert.equal(f.runtime.steps(f.projectId)[0].state, "succeeded");
  assert.equal(done.declarations.scenes.length, 1); assert.equal(done.declarations.shots.length, 1);
  const first = resultView(done);
  assert.deepEqual(resultView(await replay(f)), first);
  assert.deepEqual(resultView(await replay(f)), first);
  assert.equal(f.calls.submit.length, calls, "finished replay must make no provider submissions");
  assert.equal(f.store.list("artifact", f.projectId).length, 1);
});

test("three Promise.all images dispatch in one pass and single-flight replays do not duplicate them", async t => {
  const f = fixture(t, { mode: () => "pending" });
  submit(f, film(`await Promise.all(["front", "side", "back"].map(prompt => ctx.image({ prompt })));`));
  await Promise.all([replay(f), replay(f), replay(f)]);
  assert.equal(f.calls.submit.length, 3); assert.equal(f.provider.acceptedCount(), 3);
  assert.equal(f.runtime.getRun(f.projectId).state, "waiting");
  assert.equal(new Set(f.runtime.steps(f.projectId).map(step => step.key)).size, 3);
  f.provider.jobs().forEach(job => f.provider.complete(job.id));
  await settle(f); assert.equal(f.calls.submit.length, 3);
});

test("unanswered choices wait, answers wake, question changes reuse answers and new options re-ask", async t => {
  const f = fixture(t);
  const source = (question, options) => film(`
    const answer = await ctx.choose("framing", { question: ${JSON.stringify(question)}, options: ${JSON.stringify(options)} });
    ctx.log(answer); await ctx.image({ prompt: answer });
  `);
  submit(f, source("Choose framing", ["wide", "close"]));
  const waiting = await replay(f);
  assert.equal(waiting.state, "waiting"); assert.equal(f.calls.submit.length, 0);
  let choice = f.runtime.choices(f.projectId)[0];
  f.runtime.answerChoice(f.projectId, choice.choiceId, choice.optionsDigest, "wide");
  assert.deepEqual((await settle(f)).logs, ["wide"]); assert.equal(f.calls.submit.length, 1);
  submit(f, source("Which framing do you prefer?", ["wide", "close"]));
  await settle(f); assert.equal(f.runtime.choices(f.projectId).length, 1); assert.equal(f.calls.submit.length, 1);
  submit(f, source("Choose framing", ["wide", "medium"]));
  assert.equal((await replay(f)).state, "waiting"); assert.equal(f.runtime.choices(f.projectId).length, 2);
  const current = f.runtime.choices(f.projectId).find(value => value.optionsDigest !== choice.optionsDigest);
  assert.throws(() => f.runtime.answerChoice(f.projectId, current.choiceId, choice.optionsDigest, "close"), /choice|options|stale/i);
  f.runtime.answerChoice(f.projectId, current.choiceId, current.optionsDigest, "medium");
  await settle(f); assert.equal(f.calls.submit.length, 2);
});

test("a choice answer and overlapping tick preserve the wake for a successor pass", async t => {
  const f = fixture(t), choose = f.runtime.choose.bind(f.runtime);
  let once = false, overlapping;
  f.runtime.choose = (...args) => {
    const result = choose(...args);
    if (!once) {
      once = true;
      const choice = f.runtime.choices(f.projectId)[0];
      f.runtime.answerChoice(f.projectId, choice.choiceId, choice.optionsDigest, "yes");
      overlapping = f.runtime.tick();
    }
    return result;
  };
  submit(f, film(`const answer = await ctx.choose("overlap", { question: "Continue?", options: ["yes"] }); ctx.log(answer);`));
  await replay(f); await overlapping;
  assert.deepEqual((await settle(f)).logs, ["yes"]);
});

test("input normalization reuses reordered keys, filled defaults and artifact digest identity; variant separates duplicates", async t => {
  const f = fixture(t);
  submit(f, film(`
    const image = await ctx.image({ prompt: "boot" });
    if (!image.ok) throw new Error("image failed");
    await ctx.video({ model: "fake-video", firstFrame: image.artifact, prompt: "push", params: { speed: 1, zoom: 2 } });
  `));
  await settle(f); assert.equal(f.calls.submit.length, 2);
  submit(f, film(`
    const image = await ctx.image({ model: "fake-image", prompt: "boot" });
    const ref = { ...image.artifact, artifactId: "different-id-same-owned-content" };
    await ctx.video({ params: { zoom: 2, speed: 1 }, prompt: "push", durationSeconds: 6, firstFrame: ref, model: "fake-video" });
  `));
  await settle(f); assert.equal(f.calls.submit.length, 2);
  submit(f, film(`await Promise.all([ctx.image({ prompt: "boot", variant: "A" }), ctx.image({ variant: "B", prompt: "boot" })]);`));
  await settle(f); assert.equal(f.calls.submit.length, 4);
});

test("editing one motion reuses both images and the other video, dispatching only changed video and render", async t => {
  const f = fixture(t);
  const source = motion => film(`
    const motions = [${JSON.stringify(motion)}, "static"];
    const frames = await Promise.all(["front", "side"].map(prompt => ctx.image({ prompt })));
    const clips = await Promise.all(frames.map((frame, index) => ctx.video({ firstFrame: frame.artifact, prompt: motions[index] })));
    await ctx.render({ clips: clips.map((clip, index) => ({ artifact: clip.artifact, motion: motions[index] })) });
  `);
  submit(f, source("push")); await settle(f);
  assert.deepEqual(f.calls.submit.map(call => call.kind).sort(), ["image", "image", "render", "video", "video"]);
  const oldKeys = new Set(f.runtime.steps(f.projectId).map(step => step.key)), before = f.calls.submit.length;
  submit(f, source("pan")); await settle(f);
  assert.deepEqual(f.calls.submit.slice(before).map(call => call.kind).sort(), ["render", "video"]);
  const steps = f.runtime.steps(f.projectId);
  assert.equal(steps.length, 7); assert.equal(steps.filter(step => oldKeys.has(step.key)).length, 5, "edits preserve historical completed steps");
});

test("restart reconciles an intent with a lost receipt through lookup and never submits again", async t => {
  const f = fixture(t, { recoverLostReceipt: true });
  submit(f, film(`const image = await ctx.image({ prompt: "lost receipt" }); if (!image.ok) throw new Error("Recovery failed");`));
  await replay(f); assert.equal(f.calls.submit.length, 1);
  const step = f.runtime.steps(f.projectId)[0], attempt = f.store.get("attempt", step.attemptId);
  // Crash window: the fake has durably accepted, but the local receipt never made it to disk.
  f.store.put("attempt", attempt.id, f.projectId, { ...attempt, phase: "submitting", taskId: null });
  const execution = f.store.get("code_plan_execution", attempt.id);
  f.store.put("code_plan_execution", attempt.id, f.projectId, { ...execution, outcome: null, outcomeDigest: null, liability: "reserved" });
  f.reopen(); await settle(f);
  assert.deepEqual(f.calls.lookup, [attempt.id]); assert.equal(f.calls.submit.length, 1);
  assert.equal(f.provider.acceptedCount(attempt.id), 1); assert.equal(f.runtime.steps(f.projectId)[0].state, "succeeded");
});

test("restart restores a pending choice and its answer continues the same run", async t => {
  const f = fixture(t);
  submit(f, film(`const answer = await ctx.choose("style", { question: "Style?", options: ["plain", "bright"] }); ctx.log(answer);`));
  await replay(f); const choice = f.runtime.choices(f.projectId)[0];
  f.reopen(); await f.runtime.tick(); assert.equal(f.runtime.getRun(f.projectId).state, "waiting");
  assert.equal(f.runtime.choices(f.projectId).length, 1);
  f.runtime.answerChoice(f.projectId, choice.choiceId, choice.optionsDigest, "plain");
  assert.deepEqual((await settle(f)).logs, ["plain"]); assert.equal(f.calls.submit.length, 0);
});

test("provider failure resolves ok:false and permits a different-model fallback without retrying the failure", async t => {
  const f = fixture(t, { models: { primary: { kind: "image" }, fallback: { kind: "image" } }, mode: request => request.args.model === "primary" ? "technical_failure" : "complete" });
  submit(f, film(`
    const initial = await ctx.image({ model: "primary", prompt: "boot" });
    if (!initial.ok) { ctx.log(initial.error.code); const next = await ctx.image({ model: "fallback", prompt: "boot" }); if (!next.ok) throw new Error("fallback failed"); }
  `));
  await settle(f, "done_with_failures"); assert.deepEqual(f.calls.submit.map(call => call.args.model), ["primary", "fallback"]);
  assert.deepEqual(f.runtime.steps(f.projectId).map(step => step.state).sort(), ["failed", "succeeded"]);
  assert.equal(f.runtime.getRun(f.projectId).logs.length, 1);
  await replay(f); assert.equal(f.calls.submit.length, 2);
});

test("programming errors end the pass with a capped message and stack", async t => {
  const f = fixture(t);
  submit(f, film(`throw new Error("Broken film " + "x".repeat(40000));`));
  const run = await replay(f);
  assert.equal(run.state, "error"); assert.match(run.error.message, /Broken film/);
  assert.equal(typeof run.error.stack, "string"); assert.ok(JSON.stringify(run.error).length < 20000);
  assert.equal(f.calls.submit.length, 0);
});

test("speech returns a priced fake audio artifact and reuses it on replay", async t => {
  const f = fixture(t);
  submit(f, film(`const speech = await ctx.speech({ text: "hello", voice: "fixture", model: "fake-speech" });
    if (!speech.ok) throw new Error(speech.error.code); ctx.log(speech.artifact.kind);`));
  assert.deepEqual((await settle(f)).logs, ["audio"]);
  assert.equal(f.calls.submit.length, 1);
  const step = f.runtime.steps(f.projectId)[0];
  assert.equal(step.kind, "speech"); assert.equal(step.priceMicros, "10000");
  assert.deepEqual(step.input, { text: "hello", voice: "fixture", model: "fake-speech" });
  await replay(f); assert.equal(f.calls.submit.length, 1);
});

test("paid parallel steps reserve against a stored $1 ceiling and a raised ceiling wakes remaining work", async t => {
  const f = fixture(t, { ceilingMicros: "1000000", models: { paid: { kind: "image", priceMicros: "600000" } } });
  submit(f, film(`await Promise.all(["front", "side", "back"].map(prompt => ctx.image({ model: "paid", prompt })));`));
  await settle(f, "paused_budget"); assert.equal(f.calls.submit.length, 1);
  await f.runtime.tick(); assert.equal(f.calls.submit.length, 1, "charged work must continue counting against the ceiling");
  f.runtime.raiseCeiling(f.projectId, "1800000"); await settle(f);
  assert.equal(f.calls.submit.length, 3); assert.equal(f.runtime.steps(f.projectId).filter(step => step.state === "succeeded").length, 3);
});

test("possibly charged unknown outcomes retain their ceiling reservation across restart", async t => {
  const f = fixture(t, { ceilingMicros: "1000000", models: { paid: { kind: "image", priceMicros: "600000" } }, mode: () => "unknown_after_accept" });
  submit(f, film(`await Promise.all(["front", "side"].map(prompt => ctx.image({ model: "paid", prompt })));`));
  await settle(f, "paused_budget"); assert.equal(f.calls.submit.length, 1);
  f.reopen();
  f.provider.lookup = async attemptId => { f.calls.lookup.push(attemptId); return { type: "unknown", diagnostic: "Still unresolved" }; };
  await f.runtime.tick(); assert.equal(f.calls.submit.length, 1); assert.equal(f.runtime.getRun(f.projectId).state, "paused_budget");
  assert.equal(f.calls.lookup.length, 1); assert.equal(f.runtime.steps(f.projectId).filter(step => step.state === "unknown").length, 1);
});

test("unsent steps refresh trusted prices while dispatched reservations keep their original price", async t => {
  const f = fixture(t, { ceilingMicros: "1000000", models: { paid: { kind: "image", priceMicros: "600000" } } });
  submit(f, film(`await Promise.all(["first", "second"].map(prompt => ctx.image({ model: "paid", prompt })));`));
  await settle(f, "paused_budget");
  f.runtime = new CodePlanRuntime(f.store, { execution: f.execution, models: { paid: { kind: "image", priceMicros: "800000" } } });
  f.runtime.raiseCeiling(f.projectId, "1300000");
  await settle(f, "paused_budget");
  assert.equal(f.calls.submit.length, 1);
  assert.deepEqual(f.runtime.steps(f.projectId).map(step => step.priceMicros), ["600000", "800000"]);
  f.runtime.raiseCeiling(f.projectId, "1400000"); await settle(f);
  assert.equal(f.calls.submit.length, 2);
});

test("ingestion failure is visible on the run and recovers its same receipt without another submission", async t => {
  const f = fixture(t), router = new ExecutionIngestionRouter({}); let fail = true;
  f.execution = new CodePlanExecution(f.store, { provider: f.provider, artifactDir: f.paths.artifacts, outputIngestor: {
    ingest(input) { if (fail) throw new Error("Fixture ingestion interrupted"); return router.ingest(input); },
  } });
  f.runtime = new CodePlanRuntime(f.store, { execution: f.execution });
  submit(f, film(`await ctx.image({ prompt: "recover owned output" });`));
  await replay(f); await f.runtime.tick();
  assert.equal(f.runtime.getRun(f.projectId).state, "error");
  assert.match(f.runtime.getRun(f.projectId).error.message, /ingestion interrupted/);
  assert.equal(f.runtime.steps(f.projectId)[0].result, null);
  assert.equal(f.execution.attempts(f.projectId)[0].phase, "ingesting");
  fail = false; await settle(f);
  assert.equal(f.calls.submit.length, 1); assert.equal(f.calls.poll.length, 1);
});

test("a historical ingestion failure cannot block a replacement plan that no longer reaches that step", async t => {
  const f = fixture(t);
  f.execution = new CodePlanExecution(f.store, { provider: f.provider, artifactDir: f.paths.artifacts, outputIngestor: {
    ingest() { throw new Error("Historical output cannot ingest"); },
  } });
  f.runtime = new CodePlanRuntime(f.store, { execution: f.execution });
  submit(f, film(`await ctx.image({ prompt: "old step" });`));
  await replay(f); await f.runtime.tick();
  assert.equal(f.runtime.getRun(f.projectId).state, "error");
  submit(f, film(`ctx.log("replacement runs");`));
  assert.deepEqual((await settle(f)).logs, ["replacement runs"]);
  await f.runtime.tick();
  assert.equal(f.runtime.getRun(f.projectId).state, "done");
  assert.equal(f.execution.attempts(f.projectId)[0].phase, "ingesting");
  assert.equal(f.execution.liability(f.runtime.steps(f.projectId)[0].attemptId), "charged");
  assert.equal(f.calls.submit.length, 1);
});

test("code edits cancel unreached unsent steps while retaining the journal", async t => {
  const f = fixture(t, { models: { costly: { kind: "image", priceMicros: "4000001" } } });
  submit(f, film(`await ctx.image({ model: "costly", prompt: "not affordable" });`));
  await settle(f, "paused_budget");
  const blocked = f.runtime.steps(f.projectId)[0];
  assert.equal(blocked.state, "absent"); assert.equal(blocked.attemptId, null);
  submit(f, film(`ctx.log("Removed expensive shot");`));
  assert.equal((await settle(f)).state, "done");
  const retained = f.runtime.steps(f.projectId)[0];
  assert.equal(retained.key, blocked.key); assert.equal(retained.state, "cancelled");
  assert.equal(f.calls.submit.length, 0);
});

test("the 201st free media step is refused while the first 200 can dispatch", async t => {
  const f = fixture(t, { mode: () => "pending", limits: { cpuMs: 5000, memoryMb: 64 } });
  submit(f, film(`await Promise.all(Array.from({ length: 201 }, (_, index) => ctx.image({ prompt: "free " + index })));`));
  const run = await replay(f);
  assert.equal(run.state, "error"); assert.match(JSON.stringify(run.error), /step|200|limit/i);
  assert.equal(f.calls.submit.length, 200); assert.equal(f.runtime.steps(f.projectId).length, 200);
});

test("an edited plan cannot let an old pass overwrite the new version or dispatch an old continuation", async t => {
  const f = fixture(t, { mode: () => "pending" });
  const oldVersion = submit(f, film(`await ctx.image({ prompt: "old first" }); await ctx.image({ prompt: "old continuation" });`));
  await replay(f); const firstJob = f.provider.jobs()[0];
  const nextVersion = submit(f, film(`ctx.log("new version"); await ctx.image({ prompt: "new first" });`));
  f.provider.complete(firstJob.id); await f.runtime.tick();
  assert.notEqual(nextVersion.version, oldVersion.version);
  assert.equal(f.runtime.getRun(f.projectId).planVersion, nextVersion.version);
  assert.equal(f.calls.submit.some(call => call.args.prompt === "old continuation"), false);
  f.provider.jobs().forEach(job => f.provider.complete(job.id));
  assert.deepEqual((await settle(f)).logs, ["new version"]);
});

test("stale plan versions cannot overwrite a newer plan or add journal entries", async t => {
  const f = fixture(t);
  const first = submit(f, film(`ctx.log("first");`));
  const next = f.runtime.submitPlan(f.projectId, film(`ctx.log("second");`), "user", first.version);
  assert.throws(() => f.runtime.submitPlan(f.projectId, film(`await ctx.image({ prompt: "stale" });`), "user", first.version), { code: "REVISION_CONFLICT" });
  assert.equal(f.runtime.getRun(f.projectId).planVersion, next.version);
  assert.equal(f.store.list("code_plan_version", f.projectId).length, 2);
  assert.deepEqual((await settle(f)).logs, ["second"]); assert.equal(f.calls.submit.length, 0);
});

test("graph and legacy projects are untouched by code-plan startup ticks and reject code submissions", async t => {
  for (const planMode of ["graph", null]) {
    const f = fixture(t, { planMode });
    const before = f.store.getProject(f.projectId);
    assert.throws(() => submit(f, film(`await ctx.image({ prompt: "must not run" });`)), { code: "CODE_PLAN_MODE" });
    await f.runtime.tick();
    assert.deepEqual(f.store.getProject(f.projectId), before);
    assert.equal(f.calls.submit.length, 0); assert.equal(f.store.list("code_plan_version", f.projectId).length, 0);
    assert.equal(f.runtime.getRun(f.projectId), undefined);
  }
});

test("installation recovery quarantine blocks code dispatch and leaves inspection state unchanged", async t => {
  const f = fixture(t);
  submit(f, film(`await ctx.image({ prompt: "must wait for recovery" });`));
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64),
    sourceDatabaseSha256: "b".repeat(64), originalDataRoot: f.directory,
    backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
  const before = f.runtime.getRun(f.projectId);
  await f.runtime.tick();
  assert.deepEqual(f.runtime.getRun(f.projectId), before);
  assert.throws(() => f.runtime.replay(f.projectId), { code: "INSTALLATION_QUARANTINED" });
  assert.equal(f.calls.submit.length, 0); assert.equal(f.runtime.steps(f.projectId).length, 0);
});
