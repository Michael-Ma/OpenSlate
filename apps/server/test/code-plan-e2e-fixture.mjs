import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeProvider } from "@openslate/providers";
import { createApp } from "../dist/app.js";
import { ProductionService } from "../dist/application/service.js";
import { LocalDirectorController } from "../dist/application/local-director.js";
import { CodePlanRuntime } from "../dist/code-plan/index.js";
import { CodePlanExecution } from "../dist/code-plan/execution.js";
import { CODE_PLAN_MODELS } from "../dist/code-plan/identity.js";
import { Engine } from "../dist/execution/engine.js";
import { Store } from "../dist/persistence/store.js";
import { StudioSessions } from "../dist/studio-sessions.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const origin = "http://127.0.0.1:5173";
export const exampleSource = readFileSync(join(repositoryRoot, "skills/code-plan/references/example-plan.ts"), "utf8");
const motions = [...exampleSource.matchAll(/motion: "([^"]+)"/g)].map(match => match[1]);
const editedMotion = motions[0].replace("Slow gentle push in", "Slow lateral pan");
export const editedSource = exampleSource.replace(motions[0], editedMotion);
assert.notEqual(editedSource, exampleSource, "The motion edit must change the pinned example");

// These are explicit fixture prices, not provider quotes. Positive prices exercise holds and accounting.
const models = { ...CODE_PLAN_MODELS, "fake-image": { kind: "image", priceMicros: "10000" },
  "fake-video": { ...CODE_PLAN_MODELS["fake-video"], priceMicros: "100000" } };

function writableDirectories(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writableDirectories(join(path, entry.name));
}

/** Real app/runtime/Director with a separate durable fake-vendor DB; never opens a listener. */
export async function codePlanFixture({ imagePriceMicros = "10000" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "openslate-code-e2e-"));
  const paths = { database: join(root, "app.sqlite"), provider: join(root, "fake.sqlite"), artifacts: join(root, "artifacts") };
  const calls = { submit: [], poll: [], lookup: [] }, controls = { loseNextKind: null, lookupUnavailable: false };
  const f = { root, paths, calls, controls };
  let opened = false;
  const open = async () => {
    f.store = new Store(paths.database); f.provider = new FakeProvider(paths.provider);
    const submit = f.provider.submit.bind(f.provider), poll = f.provider.poll.bind(f.provider);
    f.provider.submit = async request => {
      const intent = f.store.get("attempt", request.attemptId);
      assert.equal(intent.phase, "submitting"); assert.deepEqual(intent.request, request);
      assert.ok(f.store.list("code_plan_step", intent.projectId).some(step => step.attemptId === request.attemptId));
      calls.submit.push(structuredClone(request));
      if (controls.loseNextKind === request.kind) {
        controls.loseNextKind = null; f.provider.setMode(request.nodeId, "unknown_after_accept");
      }
      return submit(request);
    };
    f.provider.poll = async taskId => { calls.poll.push(taskId); return poll(taskId); };
    f.provider.lookup = async attemptId => {
      calls.lookup.push(attemptId);
      assert.equal(f.store.get("attempt", attemptId).phase, "submission_unknown");
      if (controls.lookupUnavailable) return { type: "unknown", diagnostic: "Offline lookup temporarily unavailable" };
      // Test-only receipt oracle: the stock fake deliberately cannot look up lost POST responses.
      // This uses the durable vendor DB, never the application's missing receipt or a resubmit.
      const job = f.provider.jobs().find(job => job.attemptId === attemptId);
      return job ? poll(job.id) : { type: "unknown", diagnostic: "No durable fake receipt" };
    };
    f.engine = new Engine(f.store, f.provider, { artifactDir: paths.artifacts });
    f.service = new ProductionService(f.store, f.engine);
    f.execution = new CodePlanExecution(f.store, { provider: f.provider, artifactDir: paths.artifacts });
    f.runtime = new CodePlanRuntime(f.store, { execution: f.execution,
      models: { ...models, "fake-image": { ...models["fake-image"], priceMicros: imagePriceMicros } } });
    f.director = new LocalDirectorController(f.service, { repositoryRoot, dataDirectory: root, endpoint: origin, codePlans: f.runtime,
      defaults: { binaryPath: "/usr/bin/false", model: "offline-fixture-unused" } });
    f.sessions = new StudioSessions();
    f.app = createApp({ service: f.service, codePlans: f.runtime, director: f.director, runtimeSettings: f.director,
      studioSessions: f.sessions, allowedOrigins: [origin], musicListener: null });
    opened = true;
    const paired = await f.app.inject({ method: "POST", url: "/api/session", headers: { host: "127.0.0.1", origin, "x-openslate-client": "studio" },
      payload: { code: f.sessions.issueLaunch() } });
    assert.equal(paired.statusCode, 200, paired.body);
    f.headers = { host: "127.0.0.1", origin, cookie: paired.headers["set-cookie"].split(";")[0], "x-openslate-csrf": paired.json().csrf };
  };
  const shutdown = async () => {
    if (!opened) return;
    await f.director.close(); await f.runtime.close(); f.engine.stop(); await f.app.close();
    f.provider.close(); f.store.close(); opened = false;
  };
  f.close = async () => {
    try { await shutdown(); } finally { writableDirectories(root); rmSync(root, { recursive: true, force: true }); }
  };
  f.restart = async () => { await shutdown(); await open(); };
  f.http = (method, url, payload, key = randomUUID(), extraHeaders = {}) => f.app.inject({ method, url,
    headers: { ...f.headers, "idempotency-key": key, ...extraHeaders }, ...(payload === undefined ? {} : { payload }) });
  f.ok = async (...args) => { const response = await f.http(...args); assert.equal(response.statusCode, 200, response.body); return response.json(); };
  f.create = (planMode = "code") => f.ok("POST", "/api/projects", { name: `Offline ${planMode} film`, planMode });
  f.view = projectId => f.ok("GET", `/api/projects/${projectId}/code-plan`);
  f.events = projectId => f.store.readEvents(projectId).filter(event => event.kind === "code_plan.changed");
  f.changed = (projectId, before, label) => {
    const events = f.events(projectId); assert.ok(events.length > before, `${label} must publish code_plan.changed`);
    for (const event of events.slice(before)) assert.deepEqual(Object.keys(event.payload).sort(), ["planVersion", "state"]);
    return events.length;
  };
  f.tick = async () => {
    // The production 500 ms callback's Director and execution functions, with no timer or wall-clock wait.
    f.director.tick(); await f.director.settle(); await f.engine.reconcile(); await f.engine.runReady(); await f.runtime.tick();
  };
  f.until = async (projectId, predicate, label, limit = 40) => {
    for (let pass = 0; pass < limit; pass++) {
      await f.tick(); const view = await f.view(projectId);
      assert.notEqual(view.state, "error", JSON.stringify(view.error));
      assert.notEqual(view.state, "paused_budget", "The offline example exceeded its fixture ceiling");
      if (predicate(view)) return view;
    }
    assert.fail(`${label} did not settle in ${limit} ticks: ${JSON.stringify(await f.view(projectId))}`);
  };
  try { await open(); return f; } catch (error) { await f.close(); throw error; }
}

export async function runCodePlanOfflineFlow(f) {
  const project = await f.create(), id = project.id, base = `/api/projects/${id}/code-plan`;
  assert.equal(project.planMode, "code"); assert.equal((await f.view(id)).state, "empty");
  const graph = await f.create("graph"), graphBefore = f.store.getProject(graph.id);
  let eventCount = f.changed(id, 0, "code project creation");

  // Gate the real submit method at entry, so a fast fake turn cannot hide the request's open hold.
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), submit = f.runtime.submit.bind(f.runtime);
  let submitting = false;
  f.runtime.submit = async (...args) => { submitting = true; entered.resolve(); await release.promise; return submit(...args); };
  let message;
  try {
    message = await f.ok("POST", `/api/projects/${id}/messages`, { text: "Make a two-shot quiet morning film." }, "morning-message");
    await Promise.race([entered.promise, f.director.settle().then(() => {
      assert.ok(submitting, `Director ended before submit: ${JSON.stringify(f.store.list("director_turn", id))}`);
    })]);
    assert.equal((await f.view(id)).held, true);
    eventCount = f.changed(id, eventCount, "human message hold");
    assert.equal(f.calls.submit.length, 0);
  } finally { release.resolve(); }
  await f.director.settle(); f.runtime.submit = submit;
  const submitted = await f.view(id);
  assert.equal(submitted.planVersion, 1); assert.equal(submitted.held, false);
  assert.equal(submitted.versions[0].author, "director");
  assert.equal((await f.ok("GET", `${base}/versions/1`)).source, exampleSource);
  assert.equal(f.store.list("director_turn", id).find(turn => turn.requestId === message.requestId).state, "completed");
  eventCount = f.changed(id, eventCount, "Director submission and hold release");

  let view = await f.until(id, view => view.state === "waiting" && view.choices.some(choice => !Object.hasOwn(choice, "answer")), "first keyframe choice");
  eventCount = f.changed(id, eventCount, "keyframe completion and choice");
  let answers = 0;
  while (view.state !== "done") {
    const choice = view.choices.find(choice => !Object.hasOwn(choice, "answer")); assert.ok(choice);
    assert.equal(choice.options.length, 3);
    assert.equal(new Set(choice.options.map(option => option.sha256)).size, 3);
    for (const artifact of choice.options) {
      assert.equal(artifact.kind, "image");
      assert.ok(view.steps.some(step => step.state === "succeeded" && step.artifact?.artifactId === artifact.artifactId));
    }
    const media = await f.http("GET", `/api/projects/${id}/artifacts/${choice.options[0].artifactId}/content`);
    assert.equal(media.statusCode, 200, media.body); assert.equal(media.headers["content-type"], "image/svg+xml");
    assert.equal(createHash("sha256").update(media.rawPayload).digest("hex"), choice.options[0].sha256);
    assert.equal(f.events(id).length, eventCount, "Media and view reads must stay quiet");
    const input = { choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, answer: choice.options[0] };
    const receipt = await f.ok("POST", `${base}/choices`, input, `choice-${++answers}`);
    assert.deepEqual((await f.ok("POST", `${base}/choices`, input, `choice-${answers}`)), receipt);
    eventCount = f.changed(id, eventCount, "choice answer");
    view = await f.until(id, view => view.state === "done" || view.choices.some(choice => !Object.hasOwn(choice, "answer")), "next choice or completed film");
    eventCount = f.changed(id, eventCount, "choice continuation");
  }
  assert.equal(answers, 2); assert.equal(view.steps.length, 10);
  assert.ok(view.steps.some(step => step.kind === "render" && step.state === "succeeded"));
  assert.equal(view.spentMicros, "340000"); assert.equal(view.reservedMicros, "0");
  assert.equal(f.store.getProject(id).artifacts.length, 0, "Code outputs need no graph artifact selection");
  assert.equal(f.store.list("node_binding", id).length, 0); assert.equal(f.store.list("candidate", id).length, 0);
  const initialKeys = new Set(view.steps.map(step => step.key)), beforeEdit = f.calls.submit.length;
  assert.equal(beforeEdit, 10);

  const editInput = { source: editedSource, basedOnVersion: 1 };
  const receipt = await f.ok("POST", `${base}/source`, editInput, "motion-edit");
  assert.equal(receipt.view.planVersion, 2);
  // Shots run as concurrent pipelines, so the preview reaches the unchanged shot's frames, choice and clip; only the
  // render still waits for the new clip's result.
  assert.deepEqual(receipt.diff.newSteps.map(step => step.kind), ["video"]);
  assert.equal(receipt.diff.reusedSteps, 7); assert.equal(receipt.diff.dependsOnPending, true);
  eventCount = f.changed(id, eventCount, "edited source");
  assert.deepEqual(await f.ok("POST", `${base}/source`, editInput, "motion-edit"), receipt);

  // Lose the actual fake POST reply; do not rewrite the application journal to simulate a crash.
  f.controls.loseNextKind = "video";
  await f.tick();
  assert.equal(f.calls.submit.length, beforeEdit + 1);
  const editedAttempt = f.calls.submit.at(-1).attemptId;
  assert.equal(f.store.get("attempt", editedAttempt).phase, "submission_unknown");
  eventCount = f.changed(id, eventCount, "edited clip submission");
  const oldHeaders = f.headers;
  await f.restart();
  assert.equal((await f.http("GET", base, undefined, "old-session", oldHeaders)).statusCode, 403);
  assert.deepEqual(await f.ok("POST", `${base}/source`, editInput, "motion-edit"), receipt);
  view = await f.until(id, view => view.state === "done", "restarted edited film");
  eventCount = f.changed(id, eventCount, "restart reconciliation and completed render");
  assert.deepEqual(f.calls.lookup, [editedAttempt]);
  assert.equal(f.provider.acceptedCount(editedAttempt), 1);
  const newCalls = f.calls.submit.slice(beforeEdit);
  assert.deepEqual(newCalls.map(call => call.kind), ["video", "render"]);
  assert.equal(newCalls[0].args.prompt, editedMotion);
  const newSteps = view.steps.filter(step => !initialKeys.has(step.key));
  assert.deepEqual(newSteps.map(step => step.kind).sort(), ["render", "video"]);
  assert.ok(newSteps.every(step => step.state === "succeeded"));
  const reusedSteps = view.steps.filter(step => initialKeys.has(step.key) && step.reached).length;
  assert.equal(reusedSteps, 8);
  assert.deepEqual(newCalls[1].args.timeline.map(row => row.motion), [editedMotion, motions[1]]);
  assert.equal(view.spentMicros, "440000"); assert.equal(view.reservedMicros, "0");
  assert.ok(BigInt(view.spentMicros) <= BigInt(view.ceilingMicros));
  const render = newSteps.find(step => step.kind === "render").artifact;
  const film = await f.http("GET", `/api/projects/${id}/artifacts/${render.artifactId}/content`);
  assert.equal(film.statusCode, 200, film.body); assert.equal(film.rawPayload.subarray(4, 8).toString(), "ftyp");
  assert.equal(createHash("sha256").update(film.rawPayload).digest("hex"), render.sha256);
  for (let idle = 0; idle < 3; idle++) await f.tick();
  assert.equal(f.events(id).length, eventCount, "Idle ticks must not append events");
  assert.equal(f.calls.submit.length, 12);
  const events = f.events(id); assert.ok(events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence));

  const graphBase = `/api/projects/${graph.id}`;
  assert.equal((await f.http("GET", graphBase)).statusCode, 200);
  assert.equal((await f.http("GET", `${graphBase}/generation`)).statusCode, 200);
  for (const [method, suffix, body] of [["GET", ""], ["GET", "/versions/1"], ["POST", "/source", { source: exampleSource, basedOnVersion: null }],
    ["POST", "/choices", { choiceId: "frame", optionsDigest: "a".repeat(64), answer: null }], ["POST", "/ceiling", { ceilingMicros: "2000000" }]]) {
    const response = await f.http(method, `${graphBase}/code-plan${suffix}`, body);
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, "CODE_PLAN_MODE");
  }
  assert.deepEqual(f.store.getProject(graph.id), graphBefore); assert.equal(f.events(graph.id).length, 0);
  const graphEdit = { kind: "treatment", expectedHeadVersion: 0, field: "brief", value: "A graph film still uses its original storyboard routes." };
  await f.ok("POST", `${graphBase}/storyboard`, graphEdit, "legacy-edit");
  assert.equal(f.store.getProject(graph.id).brief, graphEdit.value);
  assert.equal(f.store.getProject(graph.id).planMode, undefined);
  assert.equal(f.events(graph.id).length, 0);
  assert.equal(f.store.list("native_model_start", id).length, 0);
  assert.equal(new Set(f.calls.submit.map(call => call.attemptId)).size, f.calls.submit.length);
  return { mode: "fake", label: "Offline placeholder media; fixture rendering and prices, no real film export",
    versions: view.versions.map(row => row.version).sort(), choicesAnswered: answers,
    edit: { preview: receipt.diff, reusedSteps, newSteps: newSteps.map(step => step.kind).sort() },
    submissions: { initial: beforeEdit, afterEditAndRestart: f.calls.submit.length, duplicateAttempts: 0, recoveredByLookup: f.calls.lookup.length },
    spentMicros: view.spentMicros, ceilingMicros: view.ceilingMicros, finalState: view.state, changedEvents: eventCount };
}
