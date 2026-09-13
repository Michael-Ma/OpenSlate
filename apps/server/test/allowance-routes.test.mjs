import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePlan, digest, DomainError } from "../../../packages/core/dist/index.js";
import { registerExecutionProvider } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { ExternalAllowanceService, allowanceIssueContextDigest } from "../dist/application/external-allowances.js";
import { DurableExternalAdmission } from "../dist/execution/durable-external-admission.js";
import { createApp } from "../dist/app.js";
import { projectFixture } from "./execution-fixture.mjs";
import { InstallationRecoveryGuard, installRecoveryQuarantine, releaseRecovery } from "../dist/application/installation-recovery.js";
import { projectSpendingProjection } from "../dist/application/allowance-projection.js";

const token = "offline_allowance_http_session_0123456789";
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-allowance-http-")), path = join(directory, "store.sqlite"), store = new Store(path);
  const profile = { id: "offline-image", revision: "price-1", kind: "image", adapter: "offline-external", executionVersion: "1",
    configuration: { model: "offline-model" }, maxConcurrency: 8, unitCostMicros: "100", maxRetries: 1 };
  let calls = 0;
  const port = registerExecutionProvider({ async submit() { calls++; return { type: "unknown", diagnostic: "offline fixture" }; },
    async poll() { return { type: "unknown", diagnostic: "offline fixture" }; }, async lookup() { return { type: "unknown", diagnostic: "offline fixture" }; } },
  { adapter: profile.adapter, version: "1" });
  const engine = new Engine(store, port, { artifactDir: join(directory, "artifacts"), profiles: [profile], externalAdmission: new DurableExternalAdmission(store, () => {}) });
  const service = new ProductionService(store, engine, [profile]), allowances = new ExternalAllowanceService(store), apps = [];
  const appFor = (enabled = true, replacement = service, allowanceService = allowances) => {
    const app = createApp({ service: replacement, localToken: token, ...(enabled ? { allowanceRoutes: { service: replacement, allowances: allowanceService } } : {}),
      director: { status: () => ({ mode: "fake" }), enqueue: () => { throw Error("spending must not start director"); }, tick() {}, answerQuestion() {} } });
    apps.push(app); return app;
  };
  const addProject = (count = options.count ?? 2) => {
    const project = projectFixture(randomUUID(), count); store.createProject(project);
    store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: [profile] });
    const source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{${project.shots.map((shot, i) => `const s${i}=p.shot(${JSON.stringify(shot.id)});const f${i}=p.image("frame${i}",{intent:s${i},profile:"offline-image",prompt:${JSON.stringify(shot.imagePrompt)}});`).join("")}return [${project.shots.map((_, i) => `f${i}`).join(",")}];});`;
    const plan = compilePlan(source, { project, profiles: [profile], logicalIds: {}, allocateId: randomUUID });
    const grants = Object.fromEntries(plan.nodes.map(node => [node.id, engine.createGrant(project.id, node.shotId, node.kind, "offline-human").id]));
    const planId = randomUUID(); engine.installPlan(project.id, planId, plan, grants); store.saveProject({ ...project, activePlanId: planId }, 0);
    return project.id;
  };
  const projectId = addProject(), app = appFor(options.enabled !== false);
  const request = (method, url, payload, key = randomUUID(), target = app, headers = {}) => target.inject({ method, url,
    headers: { host: "127.0.0.1", authorization: `Bearer ${token}`, ...(key === null ? {} : { "idempotency-key": key }), ...headers },
    ...(payload === undefined ? {} : { payload }) });
  const inputFor = async (id = projectId) => {
    const response = await request("GET", `/api/projects/${id}/spending`); assert.equal(response.statusCode, 200, response.body);
    const candidates = response.json().candidates, first = candidates[0];
    return { profileDigest: first.profileDigest, profileDefinitionDigest: first.profileDefinitionDigest,
      selections: candidates.map(({ candidateId, nodeId, specDigest }) => ({ candidateId, nodeId, specDigest })),
      maxAttempts: 4, maxEstimatedMicros: "400", expiresAt: new Date(Date.now() + 3600000).toISOString() };
  };
  t.after(async () => { for (const app of apps) await app.close(); if (store.db.open) store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, path, store, profile, port, engine, service, allowances, projectId, addProject, app, appFor, request, inputFor, calls: () => calls };
}
const url = f => `/api/projects/${f.projectId}/spending`;
const rows = (f, kind, id = f.projectId) => f.store.list(kind, id);
const counts = f => Object.fromEntries(["projects", "entities", "commands", "events"].map(table => [table, f.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
const creative = f => ({ project: f.store.getProject(f.projectId), holds: rows(f, "hold"), grants: rows(f, "grant"), epochs: rows(f, "epoch"), approvals: rows(f, "approval"), turns: rows(f, "director_turn") });
function restoreSpendingFixture(f) {
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64), sourceDatabaseSha256: "b".repeat(64),
    originalDataRoot: f.directory, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
  return () => { const snapshot = new InstallationRecoveryGuard(f.store).snapshot(); return releaseRecovery(f.store, { restoreId: snapshot.receipt.restoreId,
    expectedReceiptDigest: snapshot.receiptDigest, expectedSummaryDigest: snapshot.summaryDigest }, { principalId: "local-user", commandId: randomUUID() }); };
}

test("spending projection treats imported permissions as history before and after release while fresh work gets independent coverage", async t => {
  const f = fixture(t, { count: 1 }), input = await f.inputFor();
  const issue = await f.request("POST", `${url(f)}/allowances`, input); assert.equal(issue.statusCode, 200, issue.body);
  const oldId = issue.json().allowance.id, original = f.store.get("external_allowance", oldId);
  const oldProjection = projectSpendingProjection(f.service, f.projectId), release = restoreSpendingFixture(f);
  for (const stage of ["quarantined", "released"]) {
    if (stage === "released") release();
    const before = counts(f), response = await f.request("GET", url(f)); assert.equal(response.statusCode, 200, response.body);
    const value = response.json(), candidate = value.candidates[0], allowance = value.allowances[0];
    assert.equal(candidate.selectionCurrent, false); assert.equal(candidate.suggestedForIssue, false);
    assert.equal(candidate.unavailableCode, "RESTORED_AUTHORITY_REQUIRES_NEW"); assert.equal(candidate.matchingAllowanceCount, 0);
    assert.equal(allowance.status, "restored_history"); assert.equal(allowance.restoredHistory, true);
    assert.equal(allowance.currentSelectionCount, 0); assert.equal(allowance.suggestedSelectionCount, 0);
    assert.equal(allowance.remainingAttempts, original.maxAttempts); assert.equal(allowance.usedAttempts, 0);
    assert.equal(allowance.work[0].alias, oldProjection.allowances[0].work[0].alias); assert.equal(allowance.work[0].historyAvailable, true);
    assert.equal(allowance.work[0].current, false); assert.deepEqual(counts(f), before); assert.deepEqual(f.store.get("external_allowance", oldId), original);
  }
  const project = f.store.getProject(f.projectId), plan = f.store.get("plan", project.activePlanId).compiled, node = plan.nodes[0], planId = randomUUID();
  const grant = f.engine.createGrant(f.projectId, node.shotId, node.kind, "fresh-human-request");
  f.engine.installPlan(f.projectId, planId, plan, { [node.id]: grant.id }); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion);
  const nextInput = await f.inputFor(); assert.notEqual(nextInput.selections[0].candidateId, input.selections[0].candidateId);
  const newIssue = await f.request("POST", `${url(f)}/allowances`, nextInput); assert.equal(newIssue.statusCode, 200, newIssue.body);
  const next = projectSpendingProjection(f.service, f.projectId);
  assert.equal(next.candidates[0].selectionCurrent, true); assert.equal(next.candidates[0].matchingAllowanceCount, 1);
  assert.equal(next.allowances.find(row => row.id === oldId).status, "restored_history");
  assert.equal(next.allowances.find(row => row.id === newIssue.json().allowance.id).status, "open");
  const revoked = await f.request("POST", `${url(f)}/allowances/${oldId}/revoke`, {}); assert.equal(revoked.statusCode, 200, revoked.body);
  const history = projectSpendingProjection(f.service, f.projectId).allowances.find(row => row.id === oldId);
  assert.equal(history.status, "revoked"); assert.equal(history.restoredHistory, true); assert.equal(history.currentSelectionCount, 0);
  assert.deepEqual(history.work[0], { ...oldProjection.allowances[0].work[0], current: false });
  assert.equal(f.calls(), 0); assert.deepEqual(f.store.get("external_allowance", oldId), original);
});

test("spending projection also rejects a new candidate bound to an unused imported grant", t => {
  const f = fixture(t, { count: 1 }), binding = rows(f, "node_binding")[0];
  const grant = f.engine.createGrant(f.projectId, binding.node.shotId, "image", "old-unused-grant");
  const release = restoreSpendingFixture(f); release();
  // Simulate historical low-level data admission; projection must independently check the grant fence.
  const candidate = f.store.insert("candidate", randomUUID(), f.projectId, { nodeId: binding.id, grantId: grant.id, origin: grant.origin });
  f.store.put("node_binding", binding.id, f.projectId, { ...binding, candidateId: candidate.id });
  assert.equal(f.service.recovery.isImported(f.projectId, "candidate", candidate.id), false);
  const before = counts(f), value = projectSpendingProjection(f.service, f.projectId).candidates[0];
  assert.equal(value.selectionCurrent, false); assert.equal(value.unavailableCode, "RESTORED_AUTHORITY_REQUIRES_NEW");
  assert.equal(value.suggestedForIssue, false); assert.equal(value.matchingAllowanceCount, 0); assert.deepEqual(counts(f), before);
});

test("spending routes are absent unless a trusted host explicitly installs them", async t => {
  const f = fixture(t, { enabled: false }), before = counts(f);
  assert.equal((await f.request("GET", url(f))).statusCode, 404);
  assert.equal((await f.request("POST", `${url(f)}/allowances`, {})).statusCode, 404); assert.deepEqual(counts(f), before);
});

test("GET projects exact current selections and estimates without minting any request or database row", async t => {
  const f = fixture(t), before = counts(f), snapshot = creative(f), response = await f.request("GET", url(f));
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.headers["cache-control"], "private, no-store");
  const value = response.json(); assert.equal(value.candidates.length, 2); assert.deepEqual(value.allowances, []);
  for (const candidate of value.candidates) {
    const binding = f.store.get("node_binding", candidate.nodeId);
    assert.equal(candidate.candidateId, binding.candidateId); assert.equal(candidate.specDigest, binding.node.specDigest);
    assert.equal(candidate.profileDigest, binding.node.args.profileDigest); assert.equal(candidate.profileDefinitionDigest, digest(f.profile));
    assert.equal(candidate.estimatedMicros, "100"); assert.equal(candidate.selectionCurrent, true); assert.equal(candidate.workState, "unattempted");
    assert.equal(candidate.suggestedForIssue, true);
  }
  assert.deepEqual(counts(f), before); assert.deepEqual(creative(f), snapshot); assert.equal(f.calls(), 0);
});

test("authenticated issue mints dedicated read-only purpose authority and replays exactly without creative side effects", async t => {
  const f = fixture(t), input = await f.inputFor(), before = creative(f), key = randomUUID();
  const first = await f.request("POST", `${url(f)}/allowances`, input, key); assert.equal(first.statusCode, 200, first.body);
  const receipt = first.json(), message = f.store.get("message", receipt.requestId), saved = counts(f);
  assert.equal(message.editing, false); assert.equal(message.principalId, "local-user"); assert.equal(message.contextDigest, allowanceIssueContextDigest(f.projectId, input));
  const replay = await f.request("POST", `${url(f)}/allowances`, input, key); assert.deepEqual(replay.json(), receipt);
  assert.deepEqual(counts(f), saved); assert.deepEqual(creative(f), before); assert.equal(f.calls(), 0);
  assert.equal((await f.request("POST", `${url(f)}/allowances`, { ...input, maxAttempts: 5 }, key)).json().error.code, "IDEMPOTENCY_CONFLICT");
});

test("session authentication, loopback host and origin checks also protect spending from director tokens", async t => {
  const f = fixture(t), input = await f.inputFor(), human = f.service.beginRequest(f.projectId, "local-user", "Discuss", { editing: false });
  const director = f.service.openEpoch(f.projectId, human), before = counts(f);
  for (const headers of [{ authorization: "" }, { authorization: `Bearer ${director.token}` }, { origin: "https://elsewhere.example" }, { host: "elsewhere.example" }]) {
    const response = await f.request("POST", `${url(f)}/allowances`, input, randomUUID(), f.app, headers); assert.equal(response.statusCode, 403, response.body);
    assert.equal((await f.request("GET", url(f), undefined, null, f.app, headers)).statusCode, 403);
  }
  assert.deepEqual(counts(f), before); assert.equal(f.calls(), 0);
});

test("write schemas forbid borrowed requests or actors and require a stable command identity", async t => {
  const f = fixture(t), input = await f.inputFor(), ordinary = f.service.beginRequest(f.projectId, "local-user", "Discuss", { editing: false }), before = counts(f);
  for (const extra of [{ requestId: ordinary.requestId }, { actor: ordinary }, { contextDigest: "0".repeat(64) }, { principalId: "local-user" }]) {
    assert.equal((await f.request("POST", `${url(f)}/allowances`, { ...input, ...extra })).statusCode, 400);
  }
  assert.equal((await f.request("POST", `${url(f)}/allowances`, input, null)).statusCode, 400);
  assert.equal((await f.request("POST", `${url(f)}/allowances?requestId=${ordinary.requestId}`, input)).statusCode, 400);
  assert.deepEqual(counts(f), before);
});

test("failed issue rolls back its minted request and command receipt, allowing the same command to resume", async t => {
  const f = fixture(t), input = await f.inputFor(), key = randomUUID(), before = counts(f), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "external_allowance") throw new DomainError("OFFLINE_FAILURE", "Injected before issue"); return insert(...args); };
  try { assert.equal((await f.request("POST", `${url(f)}/allowances`, input, key)).json().error.code, "OFFLINE_FAILURE"); }
  finally { f.store.insert = insert; }
  assert.deepEqual(counts(f), before); assert.equal((await f.request("POST", `${url(f)}/allowances`, input, key)).statusCode, 200);
});

test("issue replay survives catalog/canonical changes, expiry and SQLite reopen", async t => {
  const f = fixture(t), input = await f.inputFor(), key = randomUUID();
  const first = await f.request("POST", `${url(f)}/allowances`, input, key); assert.equal(first.statusCode, 200, first.body);
  const project = f.store.getProject(f.projectId), lockId = randomUUID();
  f.store.insert("capability_lock", lockId, f.projectId, { profiles: [{ ...f.profile, unitCostMicros: "900" }] });
  f.store.saveProject({ ...project, activePlanId: null, capabilityLockId: lockId }, project.headVersion);
  await f.app.close(); f.store.close(); const store = new Store(f.path);
  try {
    const engine = new Engine(store, f.port, { artifactDir: join(f.directory, "artifacts") }), service = new ProductionService(store, engine);
    const app = f.appFor(true, service, new ExternalAllowanceService(store)), now = Date.now, before = store.db.prepare("SELECT count(*) AS n FROM entities").get().n;
    try {
      Date.now = () => Date.parse(input.expiresAt) + 1;
      assert.deepEqual((await f.request("POST", `${url(f)}/allowances`, input, key, app)).json(), first.json());
    } finally { Date.now = now; }
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM entities").get().n, before); await app.close();
  } finally { store.close(); }
});

test("revoke mints its own purpose request, preserves creative state and survives later replay", async t => {
  const f = fixture(t), issue = await f.request("POST", `${url(f)}/allowances`, await f.inputFor()), id = issue.json().allowance.id;
  const key = randomUUID(), path = `${url(f)}/allowances/${id}/revoke`, before = creative(f);
  assert.equal((await f.request("POST", path, { requestId: issue.json().requestId }, key)).statusCode, 400);
  const first = await f.request("POST", path, {}, key); assert.equal(first.statusCode, 200, first.body); const saved = counts(f);
  assert.equal(f.store.get("message", first.json().requestId).editing, false); assert.deepEqual(creative(f), before);
  const project = f.store.getProject(f.projectId); f.store.saveProject({ ...project, activePlanId: null }, project.headVersion);
  assert.deepEqual((await f.request("POST", path, {}, key)).json(), first.json()); assert.deepEqual(counts(f), saved);
  const value = (await f.request("GET", url(f))).json(); assert.equal(value.allowances[0].status, "revoked");
});

test("same command keys are isolated by project and a revoke key cannot select another allowance", async t => {
  const f = fixture(t), key = randomUUID(), first = await f.request("POST", `${url(f)}/allowances`, await f.inputFor(), key), other = f.addProject();
  const second = await f.request("POST", `/api/projects/${other}/spending/allowances`, await f.inputFor(other), key);
  assert.equal(second.statusCode, 200, second.body); assert.notEqual(first.json().requestId, second.json().requestId);
  const before = counts(f);
  assert.equal((await f.request("POST", `/api/projects/${other}/spending/allowances/${first.json().allowance.id}/revoke`, {})).statusCode, 403);
  assert.deepEqual(counts(f), before);
  const third = await f.request("POST", `${url(f)}/allowances`, await f.inputFor());
  const revokeKey = randomUUID(); assert.equal((await f.request("POST", `${url(f)}/allowances/${first.json().allowance.id}/revoke`, {}, revokeKey)).statusCode, 200);
  assert.equal((await f.request("POST", `${url(f)}/allowances/${third.json().allowance.id}/revoke`, {}, revokeKey)).json().error.code, "IDEMPOTENCY_CONFLICT");
});

test("GET distinguishes uncertain existing attempts and permanent consumption from new suggested work", async t => {
  const f = fixture(t); await f.request("POST", `${url(f)}/allowances`, await f.inputFor()); await f.engine.runReady();
  const before = counts(f), value = (await f.request("GET", url(f))).json();
  assert.ok(value.candidates.every(candidate => candidate.workState === "uncertain" && candidate.latestAttempt.phase === "submission_unknown" && !candidate.suggestedForIssue));
  assert.equal(value.allowances[0].usedAttempts, 2); assert.equal(value.allowances[0].usedEstimatedMicros, "200");
  assert.equal(value.allowances[0].remainingEstimatedMicros, "200"); assert.deepEqual(counts(f), before); assert.equal(f.calls(), 2);
});

test("GET pages allowance history and rejects unknown query fields without request side effects", async t => {
  const f = fixture(t), input = await f.inputFor();
  for (let index = 0; index < 41; index++) assert.equal((await f.request("POST", `${url(f)}/allowances`, input)).statusCode, 200);
  const before = counts(f), first = (await f.request("GET", url(f))).json(), next = (await f.request("GET", `${url(f)}?allowanceOffset=40`)).json();
  assert.equal(first.allowances.length, 40); assert.equal(first.coverage.allowances.nextOffset, 40); assert.equal(next.allowances.length, 1);
  assert.equal(next.coverage.allowances.nextOffset, null); assert.equal(new Set([...first.allowances, ...next.allowances].map(row => row.id)).size, 41);
  assert.ok(first.candidates.every(candidate => candidate.matchingAllowanceCount === 41));
  assert.ok(next.candidates.every(candidate => candidate.matchingAllowanceCount === 41));
  assert.equal((await f.request("GET", `${url(f)}?requestId=borrowed`)).statusCode, 400); assert.deepEqual(counts(f), before);
});

test("matching coverage excludes revoked, expired, underfunded and fully consumed allowances", async t => {
  const f = fixture(t), input = await f.inputFor();
  const underfunded = await f.request("POST", `${url(f)}/allowances`, { ...input, maxEstimatedMicros: "99" });
  const revoked = await f.request("POST", `${url(f)}/allowances`, input);
  await f.request("POST", `${url(f)}/allowances/${revoked.json().allowance.id}/revoke`, {});
  const expired = await f.request("POST", `${url(f)}/allowances`, { ...input, expiresAt: new Date(Date.now() + 60000).toISOString() });
  const usable = await f.request("POST", `${url(f)}/allowances`, { ...input, maxAttempts: 1, maxEstimatedMicros: "100" });
  for (const response of [underfunded, revoked, expired, usable]) assert.equal(response.statusCode, 200, response.body);
  const now = Date.now;
  try {
    Date.now = () => Date.parse(expired.json().allowance.expiresAt) + 1;
    const value = (await f.request("GET", url(f))).json();
    assert.ok(value.candidates.every(candidate => candidate.matchingAllowanceCount === 1));
    assert.equal(value.allowances.find(row => row.id === underfunded.json().allowance.id).status, "estimate_limit_reached");
    assert.equal(value.allowances.find(row => row.id === expired.json().allowance.id).status, "expired");
    await f.engine.runReady();
    const consumed = (await f.request("GET", url(f))).json();
    assert.ok(consumed.candidates.every(candidate => candidate.matchingAllowanceCount === 0));
    assert.equal(consumed.allowances.find(row => row.id === usable.json().allowance.id).status, "start_limit_reached");
    assert.equal(f.calls(), 1);
  } finally { Date.now = now; }
});

test("candidate paging retains exact current selection identities without minting requests", async t => {
  const f = fixture(t, { count: 101 }), before = counts(f);
  const first = (await f.request("GET", url(f))).json(), next = (await f.request("GET", `${url(f)}?candidateOffset=100`)).json();
  assert.equal(first.candidates.length, 100); assert.equal(first.coverage.candidates.nextOffset, 100);
  assert.equal(next.candidates.length, 1); assert.equal(next.coverage.candidates.nextOffset, null);
  assert.equal(new Set([...first.candidates, ...next.candidates].map(row => row.candidateId)).size, 101);
  assert.deepEqual(counts(f), before);
});

test("stale displayed selections fail atomically and issuing an allowance never raises the independent project budget", async t => {
  const f = fixture(t), input = await f.inputFor(), budget = f.engine.budget(f.projectId);
  assert.equal((await f.request("POST", `${url(f)}/allowances`, { ...input, maxEstimatedMicros: "9000000" })).statusCode, 200);
  assert.deepEqual(f.engine.budget(f.projectId), budget);
  const project = f.store.getProject(f.projectId); f.store.saveProject({ ...project, activePlanId: null }, project.headVersion);
  const before = counts(f);
  const response = await f.request("POST", `${url(f)}/allowances`, input);
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, "ALLOWANCE_SELECTION_STALE");
  assert.deepEqual(counts(f), before);
});
