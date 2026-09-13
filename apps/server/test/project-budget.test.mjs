import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { DomainError } from "../../../packages/core/dist/index.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { ExternalAllowanceService } from "../dist/application/external-allowances.js";
import { ProjectBudgetService, projectBudgetContextDigest, projectBudgetSnapshot } from "../dist/application/project-budget.js";
import { createApp } from "../dist/app.js";
import { setup } from "./execution-fixture.mjs";

const token = "offline_project_budget_session_0123456789";
function fixture(t, options = {}) {
  const f = setup(t, { imagesOnly: true, ...options }), service = new ProductionService(f.store, f.engine), budgets = new ProjectBudgetService(service);
  const appFor = (replacement = service, enabled = true) => createApp({ service: replacement, localToken: token,
    ...(enabled ? { allowanceRoutes: { service: replacement, allowances: new ExternalAllowanceService(replacement.store) } } : {}) });
  const app = appFor(); t.after(() => app.close());
  const request = (method, path, body, key = randomUUID(), target = app, headers = {}) => target.inject({ method, url: path,
    headers: { host: "127.0.0.1", authorization: `Bearer ${token}`, ...(key === null ? {} : { "idempotency-key": key }), ...headers },
    ...(body === undefined ? {} : { payload: body }) });
  const input = (capMicros = "9000000", projectId = f.projectId) => {
    const current = projectBudgetSnapshot(service, projectId); return { expectedRevision: current.revision, expectedCapMicros: current.capMicros, capMicros };
  };
  const human = (value, scopeIds = [f.projectId]) => service.beginRequest(f.projectId, "local-user", "Explicit project budget action", {
    editing: false, scopeIds, contextDigest: projectBudgetContextDigest(f.projectId, value) });
  return { ...f, service, budgets, app, appFor, request, input, human };
}
const path = (f, projectId = f.projectId) => `/api/projects/${projectId}/spending/budget`;
const counts = f => Object.fromEntries(["projects", "entities", "commands", "events"].map(table => [table, f.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
const creative = f => ({ project: f.store.getProject(f.projectId), ...Object.fromEntries(["hold", "epoch", "grant", "approval", "attempt", "reservation", "external_allowance", "external_allowance_consumption"].map(kind => [kind, f.store.list(kind, f.projectId)])) });

test("budget snapshot reports an unsaved default as revision zero without creating a record", async t => {
  const f = fixture(t), project = f.service.createProject("No plan yet"), before = counts(f);
  const response = await f.request("GET", `/api/projects/${project.id}/spending`);
  assert.deepEqual(response.json().projectBudget, { revision: 0, capMicros: "100000", committedMicros: "0", currency: "USD" });
  assert.deepEqual(counts(f), before); assert.equal(f.store.get("budget", project.id), undefined);
  const input = f.input("200000", project.id), result = await f.request("POST", path(f, project.id), input);
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().revision.priorRevision, 0); assert.equal(result.json().revision.revision, 1);
});

test("human budget revision records exact purpose and prior/new cap without touching creative or execution state", async t => {
  const f = fixture(t), edit = f.service.beginRequest(f.projectId, "local-user", "Edit the opening", { scopeIds: ["shot-0"] });
  f.service.openEpoch(f.projectId, edit); const before = creative(f), input = f.input();
  const response = await f.request("POST", path(f), input); assert.equal(response.statusCode, 200, response.body);
  const value = response.json(), request = f.store.get("message", value.requestId), audit = f.store.get("project_budget_revision", value.requestId);
  assert.equal(request.editing, false); assert.equal(request.contextDigest, projectBudgetContextDigest(f.projectId, input));
  assert.deepEqual(audit, value.revision); assert.equal(audit.priorCapMicros, input.expectedCapMicros); assert.equal(audit.capMicros, input.capMicros);
  assert.equal(audit.priorRevision, input.expectedRevision); assert.equal(audit.revision, input.expectedRevision + 1);
  assert.deepEqual(creative(f), before); assert.equal(f.provider.acceptedCount(), 0);
});

test("budget service rejects generic, director, wrong-purpose, foreign, stale and shot-only request authority", t => {
  const f = fixture(t), input = f.input(), actor = f.human(input);
  const ordinary = f.service.beginRequest(f.projectId, "local-user", "Discuss budget", { editing: false });
  for (const denied of [ordinary, f.service.openEpoch(f.projectId, actor).actor, { ...actor, principalId: "another-human" }, f.human(input, ["shot-0"])])
    assert.throws(() => f.budgets.revise(f.projectId, denied, input), { code: "PROJECT_BUDGET_AUTHORITY_INVALID" });
  assert.throws(() => f.budgets.revise(f.projectId, actor, { ...input, capMicros: "1" }), { code: "PROJECT_BUDGET_AUTHORITY_INVALID" });
  const editing = f.service.beginRequest(f.projectId, "local-user", "Creative edit cannot double as budget action", { contextDigest: projectBudgetContextDigest(f.projectId, input) });
  assert.throws(() => f.budgets.revise(f.projectId, editing, input), { code: "PROJECT_BUDGET_AUTHORITY_INVALID" });
  const other = f.service.createProject("Other"); assert.throws(() => f.budgets.revise(other.id, actor, input), { code: "PROJECT_BUDGET_AUTHORITY_INVALID" });
  const request = f.store.get("message", actor.requestId); f.store.put("message", request.id, f.projectId, { ...request, state: "superseded" });
  assert.throws(() => f.budgets.revise(f.projectId, actor, input), { code: "PROJECT_BUDGET_AUTHORITY_INVALID" });
  assert.equal(f.store.list("project_budget_revision", f.projectId).length, 0);
});

test("budget route requires local human authentication and rejects borrowed authority or noninteger amounts", async t => {
  const f = fixture(t), input = f.input(), actor = f.human(input), director = f.service.openEpoch(f.projectId, actor), before = counts(f);
  for (const headers of [{ authorization: "" }, { authorization: `Bearer ${director.token}` }, { origin: "https://elsewhere.example" }, { host: "elsewhere.example" }])
    assert.equal((await f.request("POST", path(f), input, randomUUID(), f.app, headers)).statusCode, 403);
  for (const change of [{ requestId: actor.requestId }, { actor }, { expectedRevision: "1" }, { capMicros: "0.1" }, { capMicros: "-1" }, { capMicros: "01" }, { capMicros: "1e6" }, { capMicros: 1 }, { expectedRevision: -1 }])
    assert.equal((await f.request("POST", path(f), { ...input, ...change })).statusCode, 400);
  assert.notEqual((await f.request("POST", path(f), { ...input, capMicros: "9223372036854775808" })).statusCode, 200);
  assert.equal((await f.request("POST", path(f), input, null)).statusCode, 400);
  assert.equal((await f.request("POST", `${path(f)}?requestId=${actor.requestId}`, input)).statusCode, 400);
  assert.deepEqual(counts(f), before);
  const disabled = f.appFor(f.service, false);
  try { assert.equal((await f.request("POST", path(f), input, randomUUID(), disabled)).statusCode, 404); } finally { await disabled.close(); }
});

test("both expected cap and entity revision fence stale changes, including a host cap ABA", async t => {
  const f = fixture(t), input = f.input();
  f.engine.setBudget(f.projectId, "3"); f.engine.setBudget(f.projectId, input.expectedCapMicros);
  const before = counts(f), current = projectBudgetSnapshot(f.service, f.projectId);
  assert.equal(current.revision, input.expectedRevision + 2);
  for (const stale of [input, { ...input, expectedRevision: current.revision, expectedCapMicros: "3" }]) {
    const response = await f.request("POST", path(f), stale);
    assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, "PROJECT_BUDGET_CONFLICT");
  }
  assert.deepEqual(counts(f), before); assert.equal((await f.request("POST", path(f), f.input())).statusCode, 200);
});

test("failed audit insertion rolls back budget version, human request, events and receipt", async t => {
  const f = fixture(t), input = f.input(), key = randomUUID(), before = counts(f), budget = projectBudgetSnapshot(f.service, f.projectId), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "project_budget_revision") throw new DomainError("OFFLINE_FAILURE", "Injected audit failure"); return insert(...args); };
  try { assert.equal((await f.request("POST", path(f), input, key)).json().error.code, "OFFLINE_FAILURE"); } finally { f.store.insert = insert; }
  assert.deepEqual(counts(f), before); assert.deepEqual(projectBudgetSnapshot(f.service, f.projectId), budget);
  assert.equal((await f.request("POST", path(f), input, key)).statusCode, 200);
});

test("exact budget command replay survives later cap/plan changes and database reopen", async t => {
  const f = fixture(t), input = f.input(), key = randomUUID(), first = await f.request("POST", path(f), input, key);
  assert.equal(first.statusCode, 200, first.body); f.engine.setBudget(f.projectId, "5");
  const project = f.store.getProject(f.projectId); f.store.saveProject({ ...project, activePlanId: null }, project.headVersion);
  await f.app.close(); f.store.close(); f.provider.close();
  const store = new Store(f.dbPath), provider = new FakeProvider(f.providerPath), engine = new Engine(store, provider, { artifactDir: f.artifactDir });
  const service = new ProductionService(store, engine), app = f.appFor(service);
  try {
    const before = store.db.prepare("SELECT count(*) AS n FROM entities").get().n;
    assert.deepEqual((await f.request("POST", path(f), input, key, app)).json(), first.json());
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM entities").get().n, before); assert.equal(engine.budget(f.projectId).capMicros, "5");
    assert.equal((await f.request("POST", path(f), { ...input, capMicros: "6" }, key, app)).json().error.code, "IDEMPOTENCY_CONFLICT");
  } finally { await app.close(); store.close(); provider.close(); }
});

test("lowering below uncertain liability preserves it, blocks new starts and permits existing reconciliation", async t => {
  const f = fixture(t), hold = f.engine.setHold(f.projectId, { scopeId: "shot-1", ownerId: "offline-test" });
  f.provider.setMode(f.plan.nodes[0].id, "unknown_after_accept"); await f.engine.runReady();
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "submission_unknown"); const before = creative(f);
  assert.equal((await f.request("POST", path(f), f.input("0"))).statusCode, 200);
  assert.deepEqual(creative(f), before); assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
  f.engine.releaseHold(f.projectId, hold.id, "offline-test");
  const blocked = await f.engine.runReady(); assert.equal(blocked.dispatched, 0); assert.ok(blocked.blocked.some(row => row.code === "BUDGET_EXCEEDED"));
  await f.engine.reconcile(); assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded"); assert.equal(f.provider.acceptedCount(), 1);
  assert.equal(f.engine.budget(f.projectId).committedMicros, "100"); assert.equal(f.engine.budget(f.projectId).capMicros, "0");
});

test("budget audit is immutable and validates exact same-project purpose authority", t => {
  const f = fixture(t), input = f.input(), actor = f.human(input), receipt = f.budgets.revise(f.projectId, actor, input);
  f.engine.setBudget(f.projectId, "4"); assert.deepEqual(f.store.put("project_budget_revision", receipt.id, f.projectId, receipt), receipt);
  assert.throws(() => f.store.put("project_budget_revision", receipt.id, f.projectId, { ...receipt, createdAt: "2026-01-01T00:00:00.000Z" }), { code: "IMMUTABLE_RECORD" });
  const other = f.service.createProject("Another"); assert.throws(() => f.store.insert("project_budget_revision", randomUUID(), other.id, { ...receipt, id: undefined, projectId: other.id }), { code: "SCOPE_DENIED" });
  const ordinary = f.service.beginRequest(f.projectId, "local-user", "Discuss", { editing: false });
  assert.throws(() => f.store.insert("project_budget_revision", ordinary.requestId, f.projectId, { ...receipt, id: ordinary.requestId, requestId: ordinary.requestId }), { code: "PROJECT_BUDGET_AUTHORITY_INVALID" });
});

test("budget command keys are isolated by project and never overlap allowance commands", async t => {
  const f = fixture(t), key = randomUUID(), other = f.service.createProject("Other"), input = f.input();
  const first = await f.request("POST", path(f), input, key), second = await f.request("POST", path(f, other.id), f.input("2", other.id), key);
  assert.equal(first.statusCode, 200); assert.equal(second.statusCode, 200); assert.notEqual(first.json().requestId, second.json().requestId);
  assert.equal(f.engine.budget(f.projectId).capMicros, input.capMicros); assert.equal(f.engine.budget(other.id).capMicros, "2");
  const allowance = await f.request("POST", `/api/projects/${f.projectId}/spending/allowances`, {}, key);
  assert.equal(allowance.statusCode, 400); assert.notEqual(allowance.json().error.code, "IDEMPOTENCY_CONFLICT");
});

test("two independent SQLite workers applying the same displayed revision produce one audited update", async t => {
  const f = fixture(t), input = f.input(), shared = new SharedArrayBuffer(4), gate = new Int32Array(shared), workers = [];
  const imports = { store: new URL("../dist/persistence/store.js", import.meta.url).href, engine: new URL("../dist/execution/engine.js", import.meta.url).href,
    provider: new URL("../../../packages/providers/dist/index.js", import.meta.url).href, service: new URL("../dist/application/service.js", import.meta.url).href,
    budget: new URL("../dist/application/project-budget.js", import.meta.url).href };
  const run = capMicros => new Promise((resolve, reject) => {
    const worker = new Worker(`const { parentPort,workerData }=require('node:worker_threads'); (async()=>{
      const {Store}=await import(workerData.imports.store),{Engine}=await import(workerData.imports.engine),{FakeProvider}=await import(workerData.imports.provider),
        {ProductionService}=await import(workerData.imports.service),{ProjectBudgetService,projectBudgetContextDigest}=await import(workerData.imports.budget);
      const store=new Store(workerData.dbPath),provider=new FakeProvider(workerData.providerPath),engine=new Engine(store,provider,{artifactDir:workerData.artifactDir}),service=new ProductionService(store,engine),input=workerData.input;
      parentPort.postMessage({ready:true}); Atomics.wait(new Int32Array(workerData.shared),0,0,10000);
      try { const result=store.transaction(()=>{const actor=service.beginRequest(workerData.projectId,'local-user','Budget worker',{editing:false,contextDigest:projectBudgetContextDigest(workerData.projectId,input)});return new ProjectBudgetService(service).revise(workerData.projectId,actor,input);});parentPort.postMessage({result}); }
      catch(error){parentPort.postMessage({error:error.code});}finally{provider.close();store.close();}
    })().catch(error=>{parentPort.postMessage({fatal:String(error)});process.exitCode=1;});`, { eval: true,
      workerData: { imports, dbPath: f.dbPath, providerPath: f.providerPath, artifactDir: f.artifactDir, projectId: f.projectId, input: { ...input, capMicros }, shared } });
    let outcome;
    workers.push(worker); worker.on("error", reject); worker.on("message", message => {
      if (message.ready) { ready++; if (ready === 2) { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); } }
      else if (message.fatal) reject(Error(message.fatal)); else outcome = message;
    });
    worker.on("exit", code => { if (code === 0 && outcome) resolve(outcome); else reject(Error(`Budget worker exited with ${code}`)); });
  });
  let ready = 0; t.after(async () => { for (const worker of workers) await worker.terminate(); });
  const outcomes = await Promise.all([run("7"), run("8")]);
  assert.equal(outcomes.filter(row => row.result).length, 1); assert.equal(outcomes.filter(row => row.error === "PROJECT_BUDGET_CONFLICT").length, 1);
  assert.equal(f.store.list("project_budget_revision", f.projectId).length, 1); assert.equal(f.store.list("message", f.projectId).length, 1);
  assert.equal(projectBudgetSnapshot(f.service, f.projectId).revision, input.expectedRevision + 1);
});
