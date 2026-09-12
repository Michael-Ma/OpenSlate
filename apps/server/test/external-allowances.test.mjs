import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { DomainError, compilePlan, digest, providerProfileArguments } from "../../../packages/core/dist/index.js";
import { fixtureOutputs, registerExecutionProvider } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { ExternalAllowanceService, allowanceIssueContextDigest, allowanceRevokeContextDigest } from "../dist/application/external-allowances.js";
import { DurableExternalAdmission } from "../dist/execution/durable-external-admission.js";
import { projectFixture } from "./execution-fixture.mjs";

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-allowance-")), dbPath = join(directory, "store.sqlite"), store = new Store(dbPath);
  const profile = { id: "allowance-image", revision: "price-1", kind: "image", adapter: "offline-external", executionVersion: "1",
    configuration: { model: "offline-model" }, maxConcurrency: 10, unitCostMicros: "100", maxRetries: 1 };
  const videoProfile = { ...profile, id: "allowance-video", kind: "video", configuration: { model: "offline-video" } };
  const profiles = options.video ? [profile, videoProfile] : [profile];
  let ready = true; const calls = [];
  const port = registerExecutionProvider({
    async submit(request) { calls.push(request); return options.submit?.(request, calls.length) ?? { type: "unknown", diagnostic: "offline fixture" }; },
    async poll() { return { type: "unknown", diagnostic: "offline fixture" }; },
    async lookup() { return { type: "unknown", diagnostic: "offline fixture" }; },
  }, { adapter: profile.adapter, version: "1" });
  const policy = new DurableExternalAdmission(store, () => { if (!ready) throw new DomainError("MEDIA_CREDENTIAL_MISSING", "Offline readiness is absent"); });
  const artifactDir = join(directory, "artifacts"), engine = new Engine(store, port, { artifactDir, profiles, externalAdmission: policy });
  const production = new ProductionService(store, engine, profiles), allowances = new ExternalAllowanceService(store);
  const project = projectFixture(randomUUID(), options.count ?? 2); store.createProject(project);
  store.insert("capability_lock", project.capabilityLockId, project.id, { profiles });
  const source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{${project.shots.map((shot, i) => `const s${i}=p.shot(${JSON.stringify(shot.id)});const image${i}=p.image("image${i}",{intent:s${i},profile:"allowance-image",prompt:${JSON.stringify(shot.imagePrompt)}});`
    + (options.video ? `const review${i}=p.humanReview("review${i}",{shots:[{intent:s${i},keyframe:image${i},videoProfile:"allowance-video",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:6}]});const video${i}=p.video("video${i}",{intent:s${i},profile:"allowance-video",firstFrame:p.approvedImage(image${i},review${i}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:6});` : "")).join("")}return [${project.shots.map((_, i) => `${options.video ? "video" : "image"}${i}`).join(",")}];});`;
  const plan = compilePlan(source, { project, profiles, logicalIds: {}, allocateId: randomUUID });
  const grants = Object.fromEntries(plan.nodes.map(node => [node.id, engine.createGrant(project.id, node.shotId, node.kind, "offline-original-human").id]));
  const planId = randomUUID(); engine.installPlan(project.id, planId, plan, grants); store.saveProject({ ...project, activePlanId: planId }, 0);
  t.after(() => { if (store.db.open) store.close(); rmSync(directory, { recursive: true, force: true }); });
  const selections = (kind = "image") => store.list("node_binding", project.id).filter(node => node.state === "active" && node.node.kind === kind).map(binding => ({ candidateId: binding.candidateId, nodeId: binding.id, specDigest: binding.node.specDigest }));
  const input = changes => ({ profileDigest: String(providerProfileArguments(profile).profileDigest), profileDefinitionDigest: digest(profile), selections: selections(), maxAttempts: 4,
    maxEstimatedMicros: "400", expiresAt: new Date(Date.now() + 3600000).toISOString(), ...changes });
  const human = (value, scopes = [project.id], action = "issue") => production.beginRequest(project.id, "local-person", "Explicit spending action", {
    editing: false, scopeIds: scopes, contextDigest: action === "issue" ? allowanceIssueContextDigest(project.id, value) : allowanceRevokeContextDigest(project.id, value) });
  const issue = changes => { const value = input(changes), actor = human(value); return { allowance: allowances.issue(project.id, actor, value), actor, input: value }; };
  return { directory, dbPath, store, profile, videoProfile, policy, port, artifactDir, engine, production, allowances, projectId: project.id, plan, selections,
    input, human, issue, calls, setReady: value => { ready = value; } };
}
const rows = (f, family) => f.store.list(family, f.projectId);

test("explicit read-only human spending authority issues once without changing plan, grants, holds or director epochs", t => {
  const f = fixture(t), editing = f.production.beginRequest(f.projectId, "local-person", "Edit the opening", { scopeIds: ["shot-0"] });
  f.production.openEpoch(f.projectId, editing);
  const before = { project: f.store.getProject(f.projectId), grants: rows(f, "grant"), holds: rows(f, "hold"), epochs: rows(f, "epoch") };
  const issued = f.issue();
  assert.equal(f.store.get("message", issued.actor.requestId).editing, false);
  assert.deepEqual(f.allowances.issue(f.projectId, issued.actor, issued.input), issued.allowance);
  assert.equal(rows(f, "external_allowance").length, 1);
  assert.deepEqual({ project: f.store.getProject(f.projectId), grants: rows(f, "grant"), holds: rows(f, "hold"), epochs: rows(f, "epoch") }, before);
  const projection = f.allowances.list(f.projectId, issued.actor)[0];
  assert.equal(projection.remainingAttempts, 4); assert.equal(projection.remainingEstimatedMicros, "400"); assert.equal(projection.revoked, false);
});

test("generic discussion, director, changed payload, superseded and foreign human authority cannot issue spending", t => {
  const f = fixture(t), input = f.input(), ordinary = f.production.beginRequest(f.projectId, "local-person", "Discuss images", { editing: false });
  assert.throws(() => f.allowances.issue(f.projectId, ordinary, input), { code: "ALLOWANCE_AUTHORITY_INVALID" });
  const actor = f.human(input), director = f.production.openEpoch(f.projectId, actor).actor;
  assert.throws(() => f.allowances.issue(f.projectId, director, input), { code: "ALLOWANCE_AUTHORITY_INVALID" });
  assert.throws(() => f.allowances.issue(f.projectId, { ...actor, principalId: "somebody-else" }, input), { code: "ALLOWANCE_AUTHORITY_INVALID" });
  assert.throws(() => f.allowances.issue(f.projectId, actor, { ...input, maxAttempts: 100 }), { code: "ALLOWANCE_AUTHORITY_INVALID" });
  const request = f.store.get("message", actor.requestId); f.store.put("message", request.id, f.projectId, { ...request, state: "superseded" });
  assert.throws(() => f.allowances.issue(f.projectId, actor, input), { code: "ALLOWANCE_AUTHORITY_INVALID" });
  assert.equal(rows(f, "external_allowance").length, 0);
});

test("issue enforces exact current candidate, node, spec, profile and human scope", t => {
  const f = fixture(t), all = f.input(), scoped = f.human(all, ["shot-0"]);
  assert.throws(() => f.allowances.issue(f.projectId, scoped, all), { code: "SCOPE_DENIED" });
  const one = f.input({ selections: [f.selections()[0]] });
  assert.equal(f.allowances.issue(f.projectId, f.human(one, ["scene-0"]), one).selections.length, 1);
  for (const changes of [{ profileDigest: "f".repeat(64) }, { profileDefinitionDigest: "f".repeat(64) }, { selections: [{ ...f.selections()[0], specDigest: "e".repeat(64) }] },
    { selections: [{ ...f.selections()[0], candidateId: randomUUID() }] }, { selections: [{ ...f.selections()[0], nodeId: randomUUID() }] }]) {
    const value = f.input(changes); assert.throws(() => f.allowances.issue(f.projectId, f.human(value), value));
  }
  assert.equal(rows(f, "external_allowance").length, 1);
});

test("issue payloads are bounded and reject unknown fields, duplicate selections, invalid amounts and past expiry", t => {
  const f = fixture(t);
  for (const changes of [{ maxAttempts: 0 }, { maxAttempts: 10001 }, { maxEstimatedMicros: "-1" }, { maxEstimatedMicros: "9223372036854775808" },
    { selections: [] }, { selections: [f.selections()[0], f.selections()[0]] }, { credential: "not-allowed" }, { expiresAt: "tomorrow" }]) {
    assert.throws(() => allowanceIssueContextDigest(f.projectId, f.input(changes)));
  }
  const past = f.input({ expiresAt: new Date(Date.now() - 60000).toISOString() });
  assert.throws(() => f.allowances.issue(f.projectId, f.human(past), past), { code: "ALLOWANCE_EXPIRED" });
  const distant = f.input({ expiresAt: new Date(Date.now() + 31 * 86400000).toISOString() });
  assert.throws(() => f.allowances.issue(f.projectId, f.human(distant), distant), { code: "ALLOWANCE_EXPIRY_INVALID" });
  assert.equal(rows(f, "external_allowance").length, 0);
});

test("registered external execution stays denied without an issued allowance", async t => {
  const f = fixture(t), result = await f.engine.runReady();
  assert.equal(result.dispatched, 0); assert.ok(result.blocked.every(row => row.code === "EXTERNAL_ALLOWANCE_UNAVAILABLE"));
  assert.equal(rows(f, "attempt").length, 0); assert.equal(rows(f, "reservation").length, 0); assert.equal(f.calls.length, 0);
});

test("admission writes exact permanent consumption with attempt and reservation, without keys in its receipts", async t => {
  const f = fixture(t), issued = f.issue({ maxAttempts: 2, maxEstimatedMicros: "200" });
  assert.equal((await f.engine.runReady()).dispatched, 2);
  const consumed = rows(f, "external_allowance_consumption"); assert.equal(consumed.length, 2);
  for (const receipt of consumed) {
    const attempt = f.store.get("attempt", receipt.attemptId);
    assert.equal(receipt.id, attempt.id); assert.equal(receipt.allowanceId, issued.allowance.id);
    assert.equal(receipt.requestDigest, digest(attempt.request)); assert.equal(receipt.estimatedMicros, "100");
    assert.equal(attempt.request.externalAllowanceId, issued.allowance.id); assert.equal(attempt.phase, "submission_unknown");
  }
  await f.engine.reconcile(); await f.engine.runReady(); assert.deepEqual(rows(f, "external_allowance_consumption"), consumed);
  assert.equal(f.calls.length, 2);
  const status = f.allowances.list(f.projectId, issued.actor)[0];
  assert.equal(status.usedAttempts, 2); assert.equal(status.usedEstimatedMicros, "200"); assert.equal(status.remainingAttempts, 0);
  assert.equal(status.remainingEstimatedMicros, "0");
});

test("start and estimated caps independently prevent admission, and small allowances are never combined", async t => {
  for (const limits of [{ maxAttempts: 1, maxEstimatedMicros: "10000" }, { maxAttempts: 10, maxEstimatedMicros: "150" }]) {
    const f = fixture(t); f.issue(limits); const result = await f.engine.runReady();
    assert.equal(result.dispatched, 1); assert.equal(result.blocked[0].code, "EXTERNAL_ALLOWANCE_UNAVAILABLE");
    assert.equal(rows(f, "external_allowance_consumption").length, 1);
  }
  const f = fixture(t); f.issue({ maxEstimatedMicros: "60" }); f.issue({ maxEstimatedMicros: "60" });
  assert.equal((await f.engine.runReady()).dispatched, 0); assert.equal(rows(f, "external_allowance_consumption").length, 0);
});

test("overlapping human allowances are consumed in stable issue order without pooling", async t => {
  const f = fixture(t), a = f.issue({ maxAttempts: 1, maxEstimatedMicros: "100" }).allowance, b = f.issue({ maxAttempts: 1, maxEstimatedMicros: "100" }).allowance;
  await f.engine.runReady();
  const ordered = [a, b].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  assert.deepEqual(rows(f, "external_allowance_consumption").map(row => row.allowanceId), ordered.map(row => row.id));
});

test("missing credential readiness consumes nothing and corrected readiness uses existing human authority", async t => {
  const f = fixture(t); f.issue(); f.setReady(false);
  assert.ok((await f.engine.runReady()).blocked.every(row => row.code === "MEDIA_CREDENTIAL_MISSING"));
  assert.equal(rows(f, "attempt").length, 0); assert.equal(rows(f, "external_allowance_consumption").length, 0);
  f.setReady(true); assert.equal((await f.engine.runReady()).dispatched, 2);
});

test("asynchronous readiness and consumption hooks are rejected without partial admission", async t => {
  const f = fixture(t); f.issue();
  assert.throws(() => new DurableExternalAdmission(f.store, async () => {}), { code: "ASYNC_TRANSACTION" });
  const policy = new DurableExternalAdmission(f.store, () => Promise.resolve());
  const engine = new Engine(f.store, f.port, { artifactDir: f.artifactDir, externalAdmission: policy });
  assert.ok((await engine.runReady()).blocked.every(row => row.code === "ASYNC_TRANSACTION"));
  assert.throws(() => new Engine(f.store, f.port, { artifactDir: f.artifactDir, externalAdmission: { authorize: f.policy.authorize.bind(f.policy), async recordAdmission() {} } }), { code: "ASYNC_TRANSACTION" });
  const late = new Engine(f.store, f.port, { artifactDir: f.artifactDir, externalAdmission: {
    authorize: f.policy.authorize.bind(f.policy), recordAdmission(attempt) { f.policy.recordAdmission(attempt); return Promise.resolve(); },
  } });
  assert.ok((await late.runReady()).blocked.every(row => row.code === "ASYNC_TRANSACTION"));
  assert.equal(rows(f, "attempt").length, 0); assert.equal(rows(f, "reservation").length, 0); assert.equal(rows(f, "external_allowance_consumption").length, 0);
});

test("receipt failure after attempt insertion rolls back the whole admission and leaves its allowance reusable", async t => {
  const f = fixture(t); f.issue(); const insert = f.store.insert.bind(f.store); let witnessed = 0;
  f.store.insert = (...args) => {
    if (args[0] === "external_allowance_consumption") {
      witnessed++; assert.ok(f.store.get("attempt", args[1])); assert.equal(rows(f, "reservation").length, 1);
      throw new DomainError("OFFLINE_RECEIPT_FAILURE", "Injected before commit");
    }
    return insert(...args);
  };
  assert.ok((await f.engine.runReady()).blocked.every(row => row.code === "OFFLINE_RECEIPT_FAILURE"));
  assert.equal(witnessed, 2); assert.equal(rows(f, "attempt").length, 0); assert.equal(rows(f, "reservation").length, 0);
  assert.equal(rows(f, "external_allowance_consumption").length, 0); assert.equal(f.calls.length, 0);
  f.store.insert = insert; assert.equal((await f.engine.runReady()).dispatched, 2);
});

test("expiry and explicit revocation stop future starts without refunding unresolved consumption", async t => {
  const f = fixture(t), issued = f.issue();
  const held = f.engine.setHold(f.projectId, { scopeId: "shot-1", ownerId: "offline-pending-edit" }); await f.engine.runReady();
  const before = rows(f, "external_allowance_consumption"), attempt = rows(f, "attempt")[0];
  const input = { allowanceId: issued.allowance.id }, revoke = f.human(input, [f.projectId], "revoke");
  const result = f.allowances.revoke(f.projectId, revoke, input);
  assert.deepEqual(f.allowances.revoke(f.projectId, revoke, input), result);
  assert.equal(f.allowances.list(f.projectId, revoke)[0].revoked, true); assert.deepEqual(rows(f, "attempt")[0], attempt);
  f.engine.releaseHold(f.projectId, held.id, "offline-pending-edit");
  await f.engine.reconcile(); await f.engine.runReady(); assert.deepEqual(rows(f, "external_allowance_consumption"), before);
  assert.equal(f.calls.length, 1); assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
  const g = fixture(t), expiring = g.issue(), now = Date.now;
  try { Date.now = () => Date.parse(expiring.allowance.expiresAt) + 1; assert.equal((await g.engine.runReady()).dispatched, 0); }
  finally { Date.now = now; }
  assert.equal(rows(g, "attempt").length, 0); assert.equal(rows(g, "external_allowance_consumption").length, 0);
});

test("video spending permission never replaces exact human keyframe review", async t => {
  const f = fixture(t, { count: 1, video: true, submit: request => ({ type: "completed", taskId: `offline-${request.attemptId}`, outputs: fixtureOutputs(request) }) });
  f.issue(); f.issue({ profileDigest: String(providerProfileArguments(f.videoProfile).profileDigest), profileDefinitionDigest: digest(f.videoProfile), selections: f.selections("video") });
  assert.equal((await f.engine.runReady()).dispatched, 1);
  assert.equal(rows(f, "external_allowance_consumption").length, 1);
  const blocked = await f.engine.runReady(); assert.equal(blocked.dispatched, 0); assert.equal(blocked.blocked[0].code, "HUMAN_REVIEW_REQUIRED");
  const snapshot = f.engine.reviewSnapshot(f.projectId); f.engine.approve(f.projectId, snapshot.id, snapshot.members.map(row => row.videoNodeId), "offline-human-review");
  assert.equal((await f.engine.runReady()).dispatched, 1); assert.equal(rows(f, "external_allowance_consumption").length, 2);
});

test("revocation requires its own exact human purpose and project scope", t => {
  const f = fixture(t), issued = f.issue(), input = { allowanceId: issued.allowance.id };
  assert.throws(() => f.allowances.revoke(f.projectId, issued.actor, input), { code: "ALLOWANCE_AUTHORITY_INVALID" });
  assert.throws(() => f.allowances.revoke(f.projectId, f.human(input, ["shot-0"], "revoke"), input), { code: "SCOPE_DENIED" });
  const actor = f.human(input, [f.projectId], "revoke"), director = f.production.openEpoch(f.projectId, actor).actor;
  assert.throws(() => f.allowances.revoke(f.projectId, director, input), { code: "ALLOWANCE_AUTHORITY_INVALID" });
  assert.equal(rows(f, "external_allowance_revocation").length, 0);
});

test("new candidates cannot borrow prior allowance even with identical creative instructions", async t => {
  const f = fixture(t); f.issue(); const project = f.store.getProject(f.projectId), node = f.plan.nodes[0];
  const grant = f.engine.createGrant(f.projectId, node.shotId, node.kind, "explicit-new-take"), planId = randomUUID();
  f.store.transaction(() => { f.engine.installPlan(f.projectId, planId, f.plan, { [node.id]: grant.id }); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 1);
  assert.equal(result.blocked[0].nodeId, node.id); assert.equal(result.blocked[0].code, "EXTERNAL_ALLOWANCE_UNAVAILABLE");
});

test("full profile definition pins price and limits even when execution configuration stays identical", async t => {
  const f = fixture(t), issued = f.issue();
  const changed = { ...f.profile, unitCostMicros: "200", maxConcurrency: 9, maxRetries: 2 };
  assert.equal(providerProfileArguments(changed).profileDigest, issued.allowance.profileDigest);
  assert.notEqual(digest(changed), issued.allowance.profileDefinitionDigest);
  const project = f.store.getProject(f.projectId), lockId = randomUUID();
  f.store.insert("capability_lock", lockId, f.projectId, { profiles: [changed] });
  f.store.saveProject({ ...project, capabilityLockId: lockId }, project.headVersion);
  assert.ok((await f.engine.runReady()).blocked.every(row => row.code === "EXTERNAL_ALLOWANCE_UNAVAILABLE"));
  assert.equal(rows(f, "attempt").length, 0);
  const stale = f.input(); assert.throws(() => f.allowances.issue(f.projectId, f.human(stale), stale), { code: "ALLOWANCE_PROFILE_MISMATCH" });
  const fresh = f.issue({ profileDefinitionDigest: digest(changed) });
  assert.equal((await f.engine.runReady()).dispatched, 2);
  assert.ok(rows(f, "external_allowance_consumption").every(row => row.profileDefinitionDigest === digest(changed) && row.allowanceId === fresh.allowance.id));
});

test("recordAdmission rechecks the full profile definition before committing consumption", async t => {
  const f = fixture(t); f.issue(); const before = f.store.getProject(f.projectId);
  const engine = new Engine(f.store, f.port, { artifactDir: f.artifactDir, externalAdmission: {
    authorize: f.policy.authorize.bind(f.policy), recordAdmission(attempt) {
      const project = f.store.getProject(f.projectId), lockId = randomUUID();
      f.store.insert("capability_lock", lockId, f.projectId, { profiles: [{ ...f.profile, maxRetries: 2 }] });
      f.store.saveProject({ ...project, capabilityLockId: lockId }, project.headVersion);
      f.policy.recordAdmission(attempt);
    },
  } });
  assert.ok((await engine.runReady()).blocked.every(row => row.code === "ALLOWANCE_PROFILE_MISMATCH"));
  assert.deepEqual(f.store.getProject(f.projectId), before); assert.equal(rows(f, "attempt").length, 0);
  assert.equal(rows(f, "external_allowance_consumption").length, 0);
});

test("holds, pause, grants and budget remain independent requirements", async t => {
  const f = fixture(t); f.issue();
  const hold = f.engine.setHold(f.projectId, { scopeId: f.projectId, ownerId: "human-edit" });
  assert.equal((await f.engine.runReady()).dispatched, 0); f.engine.releaseHold(f.projectId, hold.id, "human-edit");
  f.engine.setPaused(f.projectId, true, "human-pause"); assert.equal((await f.engine.runReady()).dispatched, 0); f.engine.setPaused(f.projectId, false, "human-resume");
  const budget = f.store.get("budget", f.projectId); f.store.put("budget", budget.id, f.projectId, { ...budget, capMicros: "0" });
  assert.ok((await f.engine.runReady()).blocked.every(row => row.code === "BUDGET_EXCEEDED"));
  assert.equal(rows(f, "external_allowance_consumption").length, 0);
  f.store.put("budget", budget.id, f.projectId, budget);
  const candidate = rows(f, "candidate")[0]; f.store.db.prepare("DELETE FROM entities WHERE kind='grant' AND id=?").run(candidate.grantId);
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 1); assert.equal(result.blocked[0].code, "ORIGIN_NOT_AUTHORIZED");
});

test("each trusted retry permanently consumes another start; rejected requests never restore estimate capacity", async t => {
  const f = fixture(t, { count: 1, submit: (_request, count) => ({ type: "rejected", certainty: "not_accepted", failureId: `offline-failure-${count}`, technical: true, retryAllowed: true }) });
  const issued = f.issue({ maxAttempts: 2, maxEstimatedMicros: "200" });
  await f.engine.runReady(); await f.engine.runReady(); await f.engine.runReady();
  assert.equal(f.calls.length, 2); assert.equal(rows(f, "external_allowance_consumption").length, 2);
  assert.equal(f.allowances.list(f.projectId, issued.actor)[0].remainingEstimatedMicros, "0");
  assert.equal(f.engine.budget(f.projectId).committedMicros, "0", "released project reservation does not refund allowance");
  const g = fixture(t, { submit: () => ({ type: "rejected", certainty: "not_accepted", failureId: "offline-declined", technical: false, retryAllowed: false }) });
  g.issue({ maxAttempts: 4, maxEstimatedMicros: "100" }); await g.engine.runReady(); await g.engine.runReady();
  assert.equal(g.calls.length, 1); assert.equal(rows(g, "external_allowance_consumption").length, 1);
});

test("restart after admission-before-dispatch preserves consumption and reconciles without a second start", async t => {
  const f = fixture(t, { count: 1 }), issued = f.issue(); const node = f.plan.nodes[0];
  const admitted = f.engine.admit(f.projectId, node.id, f.engine.resolveInputs(f.projectId, node).fingerprint);
  const receipt = rows(f, "external_allowance_consumption")[0]; assert.equal(f.calls.length, 0);
  f.store.put("attempt", admitted.id, f.projectId, { ...admitted, leaseExpiresAt: 0 }); f.store.close();
  const store = new Store(f.dbPath); t.after(() => { if (store.db.open) store.close(); });
  const policy = new DurableExternalAdmission(store, () => { throw Error("recovery must not consume or check readiness"); });
  const engine = new Engine(store, f.port, { artifactDir: f.artifactDir, externalAdmission: policy });
  await engine.reconcile(); await engine.runReady(); assert.equal(f.calls.length, 0);
  assert.deepEqual(store.list("external_allowance_consumption", f.projectId), [receipt]);
  assert.equal(store.get("external_allowance", issued.allowance.id).id, issued.allowance.id);
  assert.equal(engine.attempts(f.projectId)[0].phase, "submission_unknown");
});

test("receipt identities and amounts are immutable and same-project references cannot be substituted", async t => {
  const f = fixture(t); const issued = f.issue(); await f.engine.runReady(); const consumed = rows(f, "external_allowance_consumption")[0];
  assert.throws(() => f.store.put("external_allowance", issued.allowance.id, f.projectId, { ...issued.allowance, createdAt: new Date(Date.parse(issued.allowance.createdAt) - 1).toISOString() }), { code: "IMMUTABLE_RECORD" });
  assert.throws(() => f.store.put("external_allowance_consumption", consumed.id, f.projectId, { ...consumed, estimatedMicros: "1" }), { code: "ALLOWANCE_CONSUMPTION_INVALID" });
  assert.throws(() => f.store.put("external_allowance_consumption", consumed.id, f.projectId, { ...consumed, requestDigest: "0".repeat(64) }), { code: "ALLOWANCE_CONSUMPTION_INVALID" });
  const other = projectFixture(); f.store.createProject(other);
  assert.throws(() => f.store.insert("external_allowance_consumption", consumed.id, other.id, { ...consumed, projectId: other.id }), { code: "SCOPE_DENIED" });
  assert.throws(() => f.policy.authorize({}), { code: "ALLOWANCE_TRANSACTION_REQUIRED" });
  assert.throws(() => f.policy.recordAdmission(f.store.get("attempt", consumed.id)), { code: "ALLOWANCE_TRANSACTION_REQUIRED" });
});

test("two independent SQLite worker connections cannot overspend a shared allowance", { timeout: 15000 }, async t => {
  const f = fixture(t); f.issue({ maxAttempts: 1, maxEstimatedMicros: "100" });
  const shared = new SharedArrayBuffer(4), modulePaths = { store: new URL("../dist/persistence/store.js", import.meta.url).href,
    engine: new URL("../dist/execution/engine.js", import.meta.url).href, policy: new URL("../dist/execution/durable-external-admission.js", import.meta.url).href,
    providers: new URL("../../../packages/providers/dist/index.js", import.meta.url).href };
  const code = `const {parentPort,workerData}=require('node:worker_threads'); (async()=>{
    const {Store}=await import(workerData.modules.store), {Engine}=await import(workerData.modules.engine),
      {DurableExternalAdmission}=await import(workerData.modules.policy), {registerExecutionProvider}=await import(workerData.modules.providers);
    const store=new Store(workerData.dbPath), port=registerExecutionProvider({async submit(){return {type:'unknown',diagnostic:'offline'};},async lookup(){return {type:'unknown',diagnostic:'offline'};},async poll(){return {type:'unknown',diagnostic:'offline'};}},{adapter:'offline-external',version:'1'});
    const engine=new Engine(store,port,{artifactDir:workerData.artifactDir,externalAdmission:new DurableExternalAdmission(store,()=>{})});
    parentPort.postMessage('ready'); Atomics.wait(new Int32Array(workerData.shared),0,0);
    try{parentPort.postMessage(await engine.runReady());}finally{store.close();}
  })().catch(error=>{throw error;});`;
  const workers = [0, 1].map(() => new Worker(code, { eval: true, workerData: { modules: modulePaths, dbPath: f.dbPath, artifactDir: f.artifactDir, shared } }));
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  const next = worker => new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
  await Promise.all(workers.map(next)); const results = workers.map(next);
  Atomics.store(new Int32Array(shared), 0, 1); Atomics.notify(new Int32Array(shared), 0, 2);
  const completed = await Promise.all(results); assert.equal(completed.reduce((sum, value) => sum + value.dispatched, 0), 1);
  assert.equal(rows(f, "external_allowance_consumption").length, 1); assert.equal(rows(f, "attempt").length, 1);
});
