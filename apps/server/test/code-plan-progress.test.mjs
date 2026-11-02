import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { codePlanFixture } from "./code-plan-e2e-fixture.mjs";

const film = body => `export default async function(ctx) { ${body} }`;
const declarations = { scenes: [{ id: "room", title: "The room" }], shots: [{ id: "opening", sceneId: "room" }] };
const opening = `ctx.scene(${JSON.stringify(declarations.scenes[0])});
  ctx.shot(${JSON.stringify(declarations.shots[0])}); ctx.log("Making the reference");`;
const source = film(`${opening} await ctx.image({prompt:"First reference"}); ctx.log("Reference ready");`);
const snapshot = f => ({ entities: f.store.db.prepare("SELECT * FROM entities ORDER BY rowid").all(),
  events: f.store.readEvents(f.id), calls: structuredClone(f.calls) });

async function fixture(t) {
  const f = await codePlanFixture();
  const releases = [];
  t.after(async () => { releases.forEach(release => release()); await f.close(); });
  f.id = (await f.create()).id;
  f.submit = source => f.runtime.submitPlan(f.id, source);
  f.view = () => f.runtime.view(f.id);
  f.holdSubmission = ({ error } = {}) => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers(), submit = f.execution.submit.bind(f.execution);
    releases.push(release.resolve);
    f.execution.submit = async id => {
      entered.resolve(id); await release.promise;
      if (error) throw error;
      return submit(id);
    };
    return { entered: entered.promise, release: release.resolve };
  };
  f.observeRuns = predicate => {
    const put = f.store.put.bind(f.store), observed = Promise.withResolvers(), writes = [];
    f.store.put = (kind, id, projectId, row) => {
      const result = put(kind, id, projectId, row);
      if (kind === "code_plan_run" && projectId === f.id) {
        writes.push(structuredClone(row));
        if (predicate?.(row)) observed.resolve(row);
      }
      return result;
    };
    return { observed: observed.promise, writes };
  };
  f.until = async predicate => {
    for (let i = 0; i < 40; i++) {
      await f.runtime.tick();
      const view = f.view();
      if (predicate(view)) return view;
      assert.notEqual(view.state, "error", JSON.stringify(view.error));
    }
    assert.fail(JSON.stringify(f.view()));
  };
  return f;
}

test("a slow first image publishes scenes, shots, reached progress and an event before its submission returns", { timeout: 30000 }, async t => {
  const f = await fixture(t), gate = f.holdSubmission();
  f.submit(source);
  const before = f.events(f.id).length;
  const progress = f.observeRuns(run => run.state === "running" && run.reachedStepKeys.length === 1);
  let finished = false;
  const pass = f.runtime.replay(f.id).then(run => { finished = true; return run; });
  await gate.entered; await progress.observed;
  const view = await f.ok("GET", `/api/projects/${f.id}/code-plan`), run = f.runtime.getRun(f.id);
  assert.equal(finished, false);
  assert.equal(view.state, "running"); assert.deepEqual(view.declarations, declarations);
  assert.deepEqual(view.logs, ["Making the reference"]); assert.equal(view.lastPassAt, null);
  assert.deepEqual(view.steps.map(step => [step.label, step.state, step.reached]), [["First reference", "in_flight", true]]);
  assert.deepEqual(run.reachedStepKeys, view.steps.map(step => step.key));
  assert.deepEqual(run.reviewKeys, []);
  assert.equal(view.reservedMicros, "10000"); assert.equal(view.spentMicros, "0");
  assert.equal(f.events(f.id).length, before + 1);
  assert.deepEqual(f.events(f.id).at(-1).payload, { planVersion: 1, state: "running" });

  gate.release();
  const waiting = await pass;
  assert.equal(waiting.state, "waiting"); assert.deepEqual(waiting.declarations, declarations);
  assert.deepEqual(waiting.logs, ["Making the reference"]); assert.ok(waiting.lastPassAt);
  const done = await f.until(view => view.state === "done");
  assert.deepEqual(done.declarations, declarations);
  assert.deepEqual(done.logs, ["Making the reference", "Reference ready"]);
  assert.equal(done.steps[0].state, "succeeded"); assert.equal(done.steps[0].reached, true);
  assert.equal(done.reservedMicros, "0"); assert.equal(done.spentMicros, "10000");
  assert.equal(f.calls.submit.length, 1);
  const events = f.events(f.id);
  await f.runtime.replay(f.id);
  assert.deepEqual(f.view(), { ...done, lastPassAt: f.view().lastPassAt });
  assert.deepEqual(f.events(f.id), events, "an identical replay must not flicker through running");
});

for (const afterProgress of [false, true]) test(`a newer version fences the old pass ${afterProgress ? "after" : "before"} its progress write and after submission`, { timeout: 30000 }, async t => {
  const f = await fixture(t), gate = f.holdSubmission();
  f.submit(source);
  const progress = f.observeRuns(run => run.state === "running" && run.reachedStepKeys.length === 1);
  const pass = f.runtime.replay(f.id);
  await gate.entered;
  if (afterProgress) await progress.observed;
  else assert.equal(progress.writes.length, 0, "the sandbox has not published its result yet");
  const next = f.submit(film(`ctx.scene({id:"new"}); ctx.log("New plan");`));
  const current = f.runtime.getRun(f.id), events = f.events(f.id), writes = progress.writes.length;
  gate.release();
  assert.deepEqual(await pass, current);
  assert.deepEqual(f.runtime.getRun(f.id), current);
  assert.equal(progress.writes.length, writes, "the obsolete pass must not write progress or final run state");
  assert.deepEqual(f.events(f.id), events);
  assert.equal(f.calls.submit.length, 1, "the already admitted submission remains in history");
  await f.runtime.replay(f.id);
  assert.equal(f.view().planVersion, next.version); assert.equal(f.view().state, "done");
  assert.deepEqual(f.view().declarations, { scenes: [{ id: "new" }], shots: [] });
  assert.deepEqual(f.view().logs, ["New plan"]);
  assert.equal(f.view().steps[0].reached, false);
});

test("progress exposes reached reviews and references while choice retirement waits for the final pass", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.submit(film(`await ctx.choose("old",{question:"Old question?",options:["yes","no"]});`));
  await f.runtime.replay(f.id);
  const choices = f.runtime.choices(f.id);
  const artifact = kind => {
    const id = randomUUID(), ref = { artifactId: id, kind, sha256: createHash("sha256").update(id).digest("hex") };
    f.store.put("artifact", id, f.id, { id, projectId: f.id, artifact: ref, path: join(f.paths.artifacts, id),
      fixture: false, attemptId: null, physicalDurationSeconds: null });
    return ref;
  };
  const clip = artifact("video"), reference = artifact("image"), gate = f.holdSubmission();
  f.submit(film(`${opening} await Promise.all([
    ctx.review("watch",{clips:[${JSON.stringify(clip)}],note:"Watch the movement"}),
    ctx.image({prompt:"Use the reference",references:[${JSON.stringify(reference)}]})]);`));
  const progress = f.observeRuns(run => run.state === "running" && run.reachedStepKeys.length === 1);
  const pass = f.runtime.replay(f.id);
  await progress.observed;
  assert.deepEqual(f.view().references, [reference]);
  assert.deepEqual(f.view().reviews.map(({ updatedAt, ...review }) => review),
    [{ id: "watch", note: "Watch the movement", state: "waiting", clipCount: 1 }]);
  assert.equal(f.runtime.getRun(f.id).reviewKeys.length, 1);
  assert.deepEqual(f.runtime.choices(f.id), choices, "the interim write must not settle choices");
  gate.release();
  assert.equal((await pass).state, "reviewing");
  assert.equal(f.runtime.choices(f.id)[0].stale, true);
});

test("dry runs during a held submission write no progress, entities or events and dispatch nothing", { timeout: 30000 }, async t => {
  const f = await fixture(t), gate = f.holdSubmission();
  f.submit(source);
  const progress = f.observeRuns(run => run.state === "running" && run.reachedStepKeys.length === 1);
  const pass = f.runtime.replay(f.id);
  await progress.observed;
  const before = snapshot(f);
  const diff = await f.runtime.dryRun(f.id, film(`ctx.scene({id:"preview"}); ctx.log("Preview");
    await Promise.all([ctx.image({prompt:"Preview picture"}),ctx.choose("preview",{question:"Preview?",options:[1,2]})]);`));
  assert.equal(diff.newSteps.length, 1); assert.equal(diff.dependsOnPending, true);
  assert.deepEqual(snapshot(f), before);
  gate.release(); await pass;
});

test("a rejected submission still ends in error and cannot retire choices after publishing progress", { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.submit(film(`await ctx.choose("keep",{question:"Keep?",options:["yes"]});`));
  await f.runtime.replay(f.id);
  const choices = f.runtime.choices(f.id), gate = f.holdSubmission({ error: new Error("Fixture submission failed") });
  f.submit(source);
  const progress = f.observeRuns(run => run.state === "running" && run.reachedStepKeys.length === 1);
  const pass = f.runtime.replay(f.id);
  await progress.observed;
  assert.equal(f.view().state, "running");
  gate.release();
  const run = await pass;
  assert.equal(run.state, "error"); assert.match(run.error.message, /Fixture submission failed/);
  assert.deepEqual(run.declarations, declarations); assert.deepEqual(run.logs, ["Making the reference"]);
  assert.deepEqual(f.runtime.choices(f.id), choices);
  assert.deepEqual(f.events(f.id).at(-1).payload, { planVersion: 2, state: "error" });
});
