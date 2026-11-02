import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, digest, DomainError, invariant, moneyMicros } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { createApp } from "../dist/app.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { StudioSessions } from "../dist/studio-sessions.js";
import { installRecoveryQuarantine } from "../dist/application/installation-recovery.js";

const origin = "http://127.0.0.1:5173";
const source = "export default async function film(ctx) { ctx.log('hello'); }";
const diff = { reusedSteps: 1, newSteps: [{ kind: "image", model: "fake-image", label: "Frame", priceMicros: "10000" }],
  cancelledSteps: 0, certainMicros: "10000", dependsOnPending: true, findings: [] };
const options = [null, { caption: "Frame A", artifact: { artifactId: "frame-a", sha256: "a".repeat(64), kind: "image" } }];
const answerInput = { choiceId: "frame", optionsDigest: digest(options), answer: options[1] };
const inputs = { choices: answerInput, ceiling: { ceilingMicros: "2000000" }, source: { source, basedOnVersion: null } };

/** Contract fake only: HTTP tests do not instantiate or mutate the P2b runtime. */
class FakeCodePlans {
  calls = { view: [], source: [], answer: [], raiseCeiling: [], submit: [] };
  views = new Map();
  constructor(store) { this.store = store; }
  current(projectId) {
    invariant(this.store.getProject(projectId).planMode === "code", "CODE_PLAN_MODE", "Use a code project");
    if (!this.views.has(projectId)) this.views.set(projectId, { projectId, planVersion: null, state: "empty", held: false,
      ceilingMicros: "1000000", spentMicros: "0", reservedMicros: "0", declarations: { scenes: [], shots: [] }, steps: [],
      choices: [{ choiceId: "frame", optionsDigest: digest(options), question: "Which frame?", options }], versions: [], logs: [], lastPassAt: null });
    return this.views.get(projectId);
  }
  view(projectId) { this.calls.view.push(projectId); return structuredClone(this.current(projectId)); }
  source(projectId, version) {
    this.current(projectId); this.calls.source.push({ projectId, version });
    const row = this.store.list("fake_code_plan_submission", projectId).find(row => row.version === version);
    invariant(row, "NOT_FOUND", "Version not found");
    return { version, author: row.input.author, sha256: digest(row.input.source), source: row.input.source, createdAt: row.createdAt };
  }
  answer(projectId, input) {
    const view = this.current(projectId); this.calls.answer.push({ projectId, input });
    invariant(input.choiceId === "frame" && input.optionsDigest === digest(options)
      && options.some(option => canonical(option) === canonical(input.answer)), "CODE_PLAN_CHOICE", "Choice changed or answer is not an option");
    view.choices[0] = { ...view.choices[0], answer: input.answer, answeredAt: "2026-10-29T00:00:00.000Z" };
    view.state = "running"; return structuredClone(view);
  }
  setCeiling(projectId, { ceilingMicros, by }) {
    assert.equal(by, "person");
    const view = this.current(projectId); this.calls.raiseCeiling.push({ projectId, ceilingMicros });
    moneyMicros(ceilingMicros);
    view.ceilingMicros = ceilingMicros; view.state = "running"; return structuredClone(view);
  }
  retryStep(projectId, input) {
    assert.deepEqual(input.consent, {by:"person"});
    this.calls.retryStep ??= []; this.calls.retryStep.push({projectId, input});
    return this.view(projectId);
  }
  async submit(projectId, input) {
    const view = this.current(projectId); this.calls.submit.push({ projectId, input });
    if (this.beforeSubmit) await this.beforeSubmit(projectId, input);
    const result = this.store.command(`fake-code-plan:${projectId}`, input.invocationId, digest(input), () => {
      invariant(view.planVersion === input.basedOnVersion, "REVISION_CONFLICT", "Plan changed");
      const version = (view.planVersion ?? 0) + 1, createdAt = "2026-10-29T00:00:00.000Z";
      this.store.insert("fake_code_plan_submission", randomUUID(), projectId, { version, input, createdAt });
      view.planVersion = version; view.state = "running";
      view.versions.unshift({ version, author: input.author, sha256: digest(input.source), createdAt, diff });
      return { version, diff };
    });
    if (this.afterSubmit) await this.afterSubmit(projectId, input);
    return structuredClone(result);
  }
  async dryRun() { return structuredClone(diff); }
  hold() {}
  release() {}
  failure() { return null; }
}

function fixture(t, { installed = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "openslate-code-plan-routes-")), artifactDir = join(root, "artifacts");
  mkdirSync(artifactDir);
  const store = new Store(join(root, "state.sqlite")), provider = new FakeProvider(join(root, "fake.sqlite"));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir }));
  const project = service.createProject("Code film", undefined, "code"), graph = service.createProject("Graph film");
  const codePlans = new FakeCodePlans(store), sessions = new StudioSessions(), apps = [];
  const makeApp = (port = codePlans) => {
    const app = createApp({ service, studioSessions: sessions, ...(installed ? { codePlans: port } : {}), musicListener: null });
    apps.push(app); return app;
  };
  const app = makeApp(), paired = sessions.connect(sessions.issueLaunch()), cookie = paired.cookie.split(";")[0];
  const headers = { host: "127.0.0.1", cookie, origin, "x-openslate-csrf": paired.csrf };
  const http = (method, path = "", payload, key, extraHeaders = {}, projectId = project.id, target = app) => target.inject({
    method, url: `/api/projects/${projectId}/code-plan${path}`, headers: { ...headers, ...(key === undefined ? {} : { "idempotency-key": key }), ...extraHeaders },
    ...(payload === undefined ? {} : { payload }),
  });
  const create = (body, key = randomUUID()) => app.inject({ method: "POST", url: "/api/projects", payload: body,
    headers: { ...headers, "idempotency-key": key } });
  const quarantine = () => installRecoveryQuarantine(store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64),
    sourceDatabaseSha256: "b".repeat(64), originalDataRoot: root, backupCreatedAt: "2026-10-28T00:00:00.000Z", restoredAt: "2026-10-29T00:00:00.000Z" });
  t.after(async () => { for (const app of apps) await app.close(); provider.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, artifactDir, store, service, project, graph, codePlans, app, headers, http, create, makeApp, quarantine };
}

test("project creation persists code mode on the project and initial revision", async t => {
  const f = fixture(t), response = await f.create({ name: "New code film", planMode: "code" });
  assert.equal(response.statusCode, 200, response.body); const project = response.json();
  assert.equal(project.planMode, "code"); assert.deepEqual(f.store.getProject(project.id), project);
  assert.deepEqual(f.store.get("project_revision", project.revisionId).project, project);
  assert.equal((await f.http("GET", "", undefined, undefined, {}, project.id)).json().state, "empty");
});

for (const planMode of [undefined, "graph"]) test(`project creation preserves the legacy record bytes for ${planMode ?? "omitted"} mode`, async t => {
  const f = fixture(t), response = await f.create({ name: "Legacy film", ...(planMode ? { planMode } : {}) });
  assert.equal(response.statusCode, 200, response.body); const project = response.json();
  const expected = { id: project.id, revisionId: project.revisionId, headVersion: 0, name: "Legacy film", brief: "", story: "", scenes: [],
    narration: { script: "", source: "undecided" }, maxFrames: 10800, capabilityLockId: project.capabilityLockId,
    shots: [], cues: [], artifacts: [], activePlanId: null };
  assert.equal(canonical(f.store.getProject(project.id)), canonical(expected));
  assert.equal(canonical(f.store.get("project_revision", project.revisionId).project), canonical(expected));
  assert.equal(Object.hasOwn(project, "planMode"), false);
});

test("project creation validates plan mode and replays the exact original creation", async t => {
  const f = fixture(t), count = f.store.listProjects().length;
  for (const planMode of ["other", null, true, 1, {}, []]) {
    const response = await f.create({ name: "Invalid", planMode }); assert.equal(response.statusCode, 400, response.body);
  }
  assert.throws(() => f.service.createProject("Invalid", undefined, "other"), { code: "VALIDATION_ERROR" });
  assert.equal(f.store.listProjects().length, count);
  const body = { name: "Keyed", planMode: "code" }, first = await f.create(body, "create");
  assert.equal(first.statusCode, 200, first.body); assert.deepEqual((await f.create(body, "create")).json(), first.json());
  assert.equal((await f.create({ ...body, planMode: "graph" }, "create")).json().error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(f.store.listProjects().length, count + 1);
});

test("GET code-plan returns the exact contract view; source POST returns its view and diff", async t => {
  const f = fixture(t), initial = await f.http("GET");
  assert.equal(initial.statusCode, 200, initial.body); assert.deepEqual(initial.json(), f.codePlans.view(f.project.id));
  const submitted = await f.http("POST", "/source", inputs.source, "source-key");
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.deepEqual(submitted.json(), { view: f.codePlans.view(f.project.id), diff });
  assert.deepEqual(f.codePlans.calls.submit, [{ projectId: f.project.id, input: { ...inputs.source, author: "user", invocationId: "source-key" } }]);
});

test("GET stored source uses a numeric version and reports absent versions/projects", async t => {
  const f = fixture(t); await f.http("POST", "/source", inputs.source, "first");
  const response = await f.http("GET", "/versions/1"); assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), f.codePlans.source(f.project.id, 1));
  assert.equal(typeof f.codePlans.calls.source[0].version, "number");
  assert.equal((await f.http("GET", "/versions/2")).statusCode, 404);
  for (const path of ["", "/versions/1"]) assert.equal((await f.http("GET", path, undefined, undefined, {}, "missing")).statusCode, 404);
  for (const version of ["0", "-1", "1.5", "1e2", "01", "nope", "9007199254740992", "12345678901234567"]) {
    const invalid = await f.http("GET", `/versions/${version}`); assert.equal(invalid.statusCode, 400, invalid.body);
  }
});

test("choice answers preserve exact JSON values including null", async t => {
  const f = fixture(t);
  for (const answer of options) {
    const input = { ...answerInput, answer }, response = await f.http("POST", "/choices", input, randomUUID());
    assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.json(), { view: f.codePlans.view(f.project.id) });
    assert.deepEqual(response.json().view.choices[0].answer, answer);
  }
});

test("ceiling changes use integer micros and return the exact receipt", async t => {
  const f = fixture(t), response = await f.http("POST", "/ceiling", inputs.ceiling, "ceiling");
  assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.json(), { view: f.codePlans.view(f.project.id) });
  assert.deepEqual(f.codePlans.calls.raiseCeiling, [{ projectId: f.project.id, ceilingMicros: "2000000" }]);
  for (const ceilingMicros of ["2000000", "1000000"]) {
    assert.equal((await f.http("POST", "/ceiling", { ceilingMicros }, randomUUID())).statusCode, 200);
  }
});

for (const route of ["choices", "ceiling", "source"]) {
  test(`${route} requires a session, CSRF and a bounded command key before invoking the port`, async t => {
    const f = fixture(t), payload = inputs[route];
    for (const extra of [{ cookie: "" }, { "x-openslate-csrf": "" }, { "x-openslate-csrf": "x".repeat(43) }, { origin: "" }, { origin: "http://evil.example" }]) {
      const response = await f.http("POST", `/${route}`, payload, "auth", extra); assert.equal(response.statusCode, 403, response.body);
    }
    for (const key of [undefined, "", " ", "a".repeat(161)]) {
      const response = await f.http("POST", `/${route}`, payload, key);
      assert.equal(response.statusCode, 400, response.body); assert.equal(response.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
    }
    assert.equal(f.codePlans.calls.submit.length + f.codePlans.calls.answer.length + f.codePlans.calls.raiseCeiling.length, 0);
  });

  test(`${route} exact replay keeps its saved receipt and changed-body reuse fails`, async t => {
    const f = fixture(t), payload = inputs[route], first = await f.http("POST", `/${route}`, payload, "same");
    assert.equal(first.statusCode, 200, first.body);
    f.codePlans.current(f.project.id).logs.push("Later runtime progress");
    const replay = await f.http("POST", `/${route}`, payload, "same");
    assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), first.json());
    const changed = route === "source" ? { ...payload, source: `${source}\n// changed` }
      : route === "choices" ? { ...payload, answer: null } : { ceilingMicros: "3000000" };
    const conflict = await f.http("POST", `/${route}`, changed, "same");
    assert.equal(conflict.statusCode, 409, conflict.body); assert.equal(conflict.json().error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(f.codePlans.calls.submit.length + f.codePlans.calls.answer.length + f.codePlans.calls.raiseCeiling.length, 1);
    // A second app instance models route re-registration after a server restart.
    const restarted = f.makeApp();
    const saved = await f.http("POST", `/${route}`, payload, "same", {}, f.project.id, restarted);
    assert.equal(saved.statusCode, 200, saved.body); assert.deepEqual(saved.json(), first.json());
  });

  test(`${route} refuses quarantine, including replay of a previously completed command`, async t => {
    const f = fixture(t), payload = inputs[route];
    assert.equal((await f.http("POST", `/${route}`, payload, "saved")).statusCode, 200);
    const before = structuredClone(f.codePlans.calls); f.quarantine();
    for (const key of ["saved", "new"]) {
      const response = await f.http("POST", `/${route}`, payload, key);
      assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, "INSTALLATION_QUARANTINED");
    }
    assert.deepEqual(f.codePlans.calls, before);
  });
}

test("all reads and writes reject a graph project and reads require a session", async t => {
  const f = fixture(t);
  for (const [method, path, payload] of [["GET", ""], ["GET", "/versions/1"], ...Object.entries(inputs).map(([route, input]) => ["POST", `/${route}`, input])]) {
    const graph = await f.http(method, path, payload, "graph", {}, f.graph.id);
    assert.equal(graph.statusCode, 409, graph.body); assert.equal(graph.json().error.code, "CODE_PLAN_MODE");
    const missing = await f.http(method, path, payload, "missing", {}, "absent"); assert.equal(missing.statusCode, 404, missing.body);
    if (method === "GET") assert.equal((await f.http(method, path, payload, undefined, { cookie: "" })).statusCode, 403);
  }
});

test("CODE_PLAN_REJECTED returns the dry-run diff, and stale submission stays a conflict", async t => {
  const f = fixture(t), rejected = { ...diff, findings: [{ code: "SOURCE_SYNTAX", detail: "Unexpected token" }] };
  f.codePlans.beforeSubmit = () => { throw new DomainError("CODE_PLAN_REJECTED", "Source rejected", { diff: rejected }); };
  const response = await f.http("POST", "/source", inputs.source, "bad");
  assert.equal(response.statusCode, 409, response.body); assert.deepEqual(response.json().error.details, { diff: rejected });
  assert.equal(f.store.list("fake_code_plan_submission", f.project.id).length, 0);
  delete f.codePlans.beforeSubmit;
  const stale = await f.http("POST", "/source", { ...inputs.source, basedOnVersion: 1 }, "stale");
  assert.equal(stale.statusCode, 409, stale.body); assert.equal(stale.json().error.code, "REVISION_CONFLICT");
  assert.equal(f.store.list("fake_code_plan_submission", f.project.id).length, 0);
});

test("strict POST schemas reject unknown fields, missing fields and malformed values without calling the port", async t => {
  const f = fixture(t);
  const bad = {
    choices: [{ ...answerInput, extra: true }, { ...answerInput, optionsDigest: "x" }, { ...answerInput, choiceId: "" },
      { ...answerInput, choiceId: "x".repeat(201) }, { choiceId: "frame", optionsDigest: digest(options) }],
    ceiling: [{ ceilingMicros: 2000000 }, { ceilingMicros: "-1" }, { ceilingMicros: "01" }, { ceilingMicros: "1.5" },
      { ceilingMicros: "9223372036854775808" }, { ...inputs.ceiling, extra: true }, {}],
    source: [{ source }, { ...inputs.source, basedOnVersion: 0 }, { ...inputs.source, basedOnVersion: "1" },
      { ...inputs.source, basedOnVersion: Number.MAX_SAFE_INTEGER + 1 }, { ...inputs.source, source: "" },
      { ...inputs.source, source: "x".repeat(256 * 1024 + 1) }, { ...inputs.source, source: "中".repeat(90000) }, { ...inputs.source, author: "director" }],
  };
  for (const [route, payloads] of Object.entries(bad)) for (const payload of payloads) {
    const response = await f.http("POST", `/${route}`, payload, randomUUID()); assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(f.codePlans.calls.submit.length + f.codePlans.calls.answer.length + f.codePlans.calls.raiseCeiling.length, 0);
});

test("a stale choice digest or a value outside its options is refused", async t => {
  const f = fixture(t);
  for (const change of [{ optionsDigest: "b".repeat(64) }, { answer: "not an option" }, { choiceId: "other" }]) {
    const response = await f.http("POST", "/choices", { ...answerInput, ...change }, randomUUID());
    assert.equal(response.statusCode, 409, response.body);
  }
  assert.equal(Object.hasOwn(f.codePlans.current(f.project.id).choices[0], "answer"), false);
});

test("concurrent identical source commands share one submission and reject a changed pending body", async t => {
  const f = fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers(), joined = Promise.withResolvers();
  let intents = 0; const command = f.store.command.bind(f.store);
  f.store.command = (...args) => {
    const result = command(...args);
    if (args[0].endsWith("code-plan-source:intent") && ++intents === 2) joined.resolve();
    return result;
  };
  f.codePlans.beforeSubmit = async () => { assert.equal(f.store.db.inTransaction, false); entered.resolve(); await release.promise; };
  const first = Promise.resolve(f.http("POST", "/source", inputs.source, "pending")); await entered.promise;
  const second = Promise.resolve(f.http("POST", "/source", inputs.source, "pending")); await joined.promise;
  const changed = await f.http("POST", "/source", { ...inputs.source, basedOnVersion: 1 }, "pending");
  assert.equal(changed.statusCode, 409, changed.body); assert.equal(changed.json().error.code, "IDEMPOTENCY_CONFLICT");
  release.resolve(); const [a, b] = await Promise.all([first, second]);
  assert.equal(a.statusCode, 200, a.body); assert.deepEqual(b.json(), a.json()); assert.equal(f.codePlans.calls.submit.length, 1);
  assert.equal(f.store.list("fake_code_plan_submission", f.project.id).length, 1);
});

test("lost source result recovers with the original invocation after restart and never creates another version", async t => {
  const f = fixture(t);
  f.codePlans.afterSubmit = () => { throw Error("Synthetic lost result after storing version"); };
  const lost = await f.http("POST", "/source", inputs.source, "lost"); assert.equal(lost.statusCode, 500);
  assert.equal(f.store.list("fake_code_plan_submission", f.project.id).length, 1);
  delete f.codePlans.afterSubmit;
  const restarted = f.makeApp();
  const changed = await f.http("POST", "/source", { ...inputs.source, source: `${source}\n// replacement` }, "lost", {}, f.project.id, restarted);
  assert.equal(changed.statusCode, 409, changed.body); assert.equal(changed.json().error.code, "IDEMPOTENCY_CONFLICT");
  const recovered = await f.http("POST", "/source", inputs.source, "lost", {}, f.project.id, restarted);
  assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().view.planVersion, 1);
  assert.equal(f.codePlans.calls.submit.length, 2); assert.equal(f.store.list("fake_code_plan_submission", f.project.id).length, 1);
});

test("source receipt publication rechecks quarantine after the asynchronous port call", async t => {
  const f = fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.codePlans.afterSubmit = async () => { entered.resolve(); await release.promise; };
  const response = f.http("POST", "/source", inputs.source, "quarantine-race"); await entered.promise;
  f.quarantine(); release.resolve(); const refused = await response;
  assert.equal(refused.statusCode, 409, refused.body); assert.equal(refused.json().error.code, "INSTALLATION_QUARANTINED");
  assert.equal(f.store.commandReplay(`local-user:${f.project.id}:code-plan-source`, "quarantine-race", digest(inputs.source)), undefined);
});

test("code-plan routes are absent when the optional port is not installed", async t => {
  const f = fixture(t, { installed: false });
  for (const [method, path, payload] of [["GET", ""], ["GET", "/versions/1"], ...Object.entries(inputs).map(([route, input]) => ["POST", `/${route}`, input])]) {
    assert.equal((await f.http(method, path, payload, "unused")).statusCode, 404);
  }
});

function artifact(f, { outside = false, symlink = false, projectId = f.project.id, mimeType = "image/png", kind = "image" } = {}) {
  const id = randomUUID(), bytes = Buffer.from(`fixture ${kind} bytes`), path = join(outside ? f.root : f.artifactDir, id);
  writeFileSync(path, bytes);
  const storedPath = symlink ? join(f.artifactDir, `link-${id}`) : path;
  if (symlink) symlinkSync(path, storedPath);
  const ref = { artifactId: id, sha256: createHash("sha256").update(bytes).digest("hex"), kind };
  f.store.insert("artifact", id, projectId, { id, projectId, artifact: ref, path: storedPath, mimeType, fixture: true,
    attemptId: "code-plan-attempt", physicalDurationSeconds: null });
  // No graph selection, project.artifacts or node_binding references this output.
  f.store.insert("code_plan_step", randomUUID(), projectId, { projectId, state: "succeeded", result: { ok: true, artifact: ref, artifacts: [ref] } });
  return { ref, bytes };
}
const media = (f, projectId, artifactId, headers = {}) => f.app.inject({ method: "GET",
  url: `/api/projects/${projectId}/artifacts/${artifactId}/content`, headers: { ...f.headers, ...headers } });

test("existing authenticated content route serves unselected code-step image, video and speech artifacts", async t => {
  const f = fixture(t);
  for (const [kind, mimeType] of [["image", "image/png"], ["video", "video/mp4"], ["audio", "audio/wav"]]) {
    const saved = artifact(f, { kind, mimeType }), response = await media(f, f.project.id, saved.ref.artifactId);
    assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.rawPayload, saved.bytes);
    assert.equal(response.headers["content-type"], mimeType); assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    // This existing preview route returns the full body even for Range requests.
    const ranged = await media(f, f.project.id, saved.ref.artifactId, { range: "bytes=0-3" });
    assert.equal(ranged.statusCode, 200); assert.deepEqual(ranged.rawPayload, saved.bytes);
  }
  assert.deepEqual(f.store.getProject(f.project.id).artifacts, []); assert.equal(f.store.list("node_binding", f.project.id).length, 0);
});

test("artifact content rejects another project, missing session, escaped paths and escaping symlinks", async t => {
  const f = fixture(t), saved = artifact(f);
  assert.equal((await media(f, f.graph.id, saved.ref.artifactId)).statusCode, 404);
  assert.equal((await media(f, f.project.id, saved.ref.artifactId, { cookie: "" })).statusCode, 403);
  for (const symlink of [false, true]) {
    const escaped = artifact(f, { outside: true, symlink }), response = await media(f, f.project.id, escaped.ref.artifactId);
    assert.equal(response.statusCode, 403, response.body); assert.equal(response.json().error.code, "SCOPE_DENIED");
  }
  writeFileSync(f.store.get("artifact", saved.ref.artifactId).path, "tampered");
  assert.equal((await media(f, f.project.id, saved.ref.artifactId)).json().error.code, "ARTIFACT_CORRUPT");
});


test("ceiling accepts lowering and retry requires an idempotent authenticated person command", async t => {
 const f=fixture(t), stepKey="a".repeat(64), path=`/steps/${stepKey}/retry`;
 assert.equal((await f.http("POST","/ceiling",{ceilingMicros:"500000"},"lower")).json().view.ceilingMicros,"500000");
 for(const [headers,key] of [[{cookie:""},"auth"],[{"x-openslate-csrf":""},"csrf"],[{},undefined]])
   assert.notEqual((await f.http("POST",path,{},key,headers)).statusCode,200);
 assert.equal((await f.http("POST",path,{consent:{by:"director"}},"bad-body")).statusCode,400);
 const first=await f.http("POST",path,{},"retry");assert.equal(first.statusCode,200,first.body);
 assert.deepEqual((await f.http("POST",path,{},"retry")).json(),first.json());
 assert.deepEqual((await f.http("POST",path,{},"retry",{},f.project.id,f.makeApp())).json(),first.json());
 assert.equal(f.codePlans.calls.retryStep.length,1);
 assert.equal((await f.http("POST",`/steps/${"b".repeat(64)}/retry`,{},"retry")).json().error.code,"IDEMPOTENCY_CONFLICT");
 assert.equal((await f.http("POST",path,{},"graph",{},f.graph.id)).json().error.code,"CODE_PLAN_MODE");
 assert.equal((await f.http("POST",path,{},"missing",{},"absent")).statusCode,404);
 f.quarantine();assert.equal((await f.http("POST",path,{},"retry")).json().error.code,"INSTALLATION_QUARANTINED");
});
