import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RECIPE_DIGEST, DomainError, compilePlan, digest, providerProfileArguments } from "../../../packages/core/dist/index.js";
import { fixtureOutputs, registerExecutionProvider } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { ConfiguredExternalAdmission, currentExternalSelection } from "../dist/execution/configured-external-admission.js";
import { projectFixture } from "./execution-fixture.mjs";
import { InstallationRecoveryGuard, installRecoveryQuarantine, releaseRecovery } from "../dist/application/installation-recovery.js";

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-configured-")), dbPath = join(directory, "store.sqlite"), store = new Store(dbPath);
  const profile = { id: "configured-image", revision: "price-1", kind: "image", adapter: "offline-external", executionVersion: "1",
    configuration: { model: "offline-model" }, maxConcurrency: 10, unitCostMicros: "100", maxRetries: 1 };
  const videoProfile = { ...profile, id: "configured-video", kind: "video", configuration: { model: "offline-video" } };
  const profiles = options.video ? [profile, videoProfile] : [profile];
  let ready = true; const calls = [];
  const port = registerExecutionProvider({
    async submit(request) { calls.push(request); return options.submit?.(request, calls.length) ?? { type: "unknown", diagnostic: "offline fixture" }; },
    async poll() { return { type: "unknown", diagnostic: "offline fixture" }; },
    async lookup() { return { type: "unknown", diagnostic: "offline fixture" }; },
  }, { adapter: profile.adapter, version: "1" });
  const policy = new ConfiguredExternalAdmission(store, () => { if (!ready) throw new DomainError("MEDIA_CREDENTIAL_MISSING", "Offline readiness is absent"); });
  const artifactDir = join(directory, "artifacts"), engine = new Engine(store, port, { artifactDir, profiles, externalAdmission: policy });
  const production = new ProductionService(store, engine, profiles);
  const project = projectFixture(randomUUID(), options.count ?? 2); store.createProject(project);
  store.insert("capability_lock", project.capabilityLockId, project.id, { recipeDigest: RECIPE_DIGEST, profiles });
  const source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{${project.shots.map((shot, i) => `const s${i}=p.shot(${JSON.stringify(shot.id)});const image${i}=p.image("image${i}",{intent:s${i},profile:"configured-image",prompt:${JSON.stringify(shot.imagePrompt)}});`
    + (options.video ? `const review${i}=p.humanReview("review${i}",{shots:[{intent:s${i},keyframe:image${i},videoProfile:"configured-video",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:6}]});const video${i}=p.video("video${i}",{intent:s${i},profile:"configured-video",firstFrame:p.approvedImage(image${i},review${i}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:6});` : "")).join("")}return [${project.shots.map((_, i) => `${options.video ? "video" : "image"}${i}`).join(",")}];});`;
  const plan = compilePlan(source, { project, profiles, logicalIds: {}, allocateId: randomUUID });
  const grants = Object.fromEntries(plan.nodes.map(node => [node.id, engine.createGrant(project.id, node.shotId, node.kind, "offline-original-human").id]));
  const planId = randomUUID(); engine.installPlan(project.id, planId, plan, grants); store.saveProject({ ...project, activePlanId: planId }, 0);
  t.after(() => { if (store.db.open) store.close(); rmSync(directory, { recursive: true, force: true }); });
  const selections = (kind = "image") => store.list("node_binding", project.id).filter(node => node.state === "active" && node.node.kind === kind).map(binding => ({ candidateId: binding.candidateId, nodeId: binding.id, specDigest: binding.node.specDigest }));
  return { directory, dbPath, store, profile, videoProfile, policy, port, artifactDir, engine, production, projectId: project.id, plan, selections,
    calls, setReady: value => { ready = value; } };
}
const rows = (f, family) => f.store.list(family, f.projectId);


test("missing credential readiness creates neither attempts nor reservations and corrected readiness admits", async t => {
  const f = fixture(t); f.setReady(false);
  assert.ok((await f.engine.runReady()).blocked.every(row => row.code === "MEDIA_CREDENTIAL_MISSING"));
  assert.equal(rows(f, "attempt").length, 0); assert.equal(rows(f, "reservation").length, 0); assert.equal(f.calls.length, 0);
  f.setReady(true); assert.equal((await f.engine.runReady()).dispatched, 2);
});

test("asynchronous hooks and nonempty admission receipts are rejected without partial admission", async t => {
  const f = fixture(t);
  assert.throws(() => new ConfiguredExternalAdmission(f.store, async () => {}), { code: "ASYNC_TRANSACTION" });
  for (const admission of [new ConfiguredExternalAdmission(f.store, () => Promise.resolve()), { authorize: () => Promise.resolve({}) }]) {
    const engine = new Engine(f.store, f.port, { artifactDir: f.artifactDir, externalAdmission: admission });
    assert.ok((await engine.runReady()).blocked.every(row => row.code === "ASYNC_TRANSACTION"));
  }
  for (const receipt of [{ allowanceId: "retired-allowance" }, [], null]) {
    const engine = new Engine(f.store, f.port, { artifactDir: f.artifactDir, externalAdmission: { authorize: () => receipt } });
    const result = await engine.runReady(); assert.equal(result.dispatched, 0);
    assert.ok(result.blocked.length > 0 && result.blocked.every(row => row.code === "EXTERNAL_EXECUTION_NOT_AUTHORIZED"));
  }
  assert.equal(rows(f, "attempt").length, 0); assert.equal(rows(f, "reservation").length, 0); assert.equal(f.calls.length, 0);
});

test("reservation receipt failure after attempt insertion rolls back the entire admission", async t => {
  const f = fixture(t), insert = f.store.insert.bind(f.store); let witnessed = 0;
  f.store.insert = (...args) => {
    if (args[0] === "reservation") {
      witnessed++; assert.equal(rows(f, "attempt").length, 1);
      throw new DomainError("OFFLINE_RECEIPT_FAILURE", "Injected before commit");
    }
    return insert(...args);
  };
  assert.ok((await f.engine.runReady()).blocked.every(row => row.code === "OFFLINE_RECEIPT_FAILURE"));
  assert.equal(witnessed, 2); assert.equal(rows(f, "attempt").length, 0); assert.equal(rows(f, "reservation").length, 0); assert.equal(f.calls.length, 0);
  f.store.insert = insert; assert.equal((await f.engine.runReady()).dispatched, 2);
});

test("configured provider admission never replaces the exact human keyframe review", async t => {
  const f = fixture(t, { count: 1, video: true, submit: request => ({ type: "completed", taskId: `offline-${request.attemptId}`, outputs: fixtureOutputs(request) }) });
  assert.equal((await f.engine.runReady()).dispatched, 1);
  const blocked = await f.engine.runReady(); assert.equal(blocked.dispatched, 0); assert.equal(blocked.blocked[0].code, "HUMAN_REVIEW_REQUIRED");
  const snapshot = f.engine.reviewSnapshot(f.projectId); f.engine.approve(f.projectId, snapshot.id, snapshot.members.map(row => row.videoNodeId), "offline-human-review");
  assert.equal((await f.engine.runReady()).dispatched, 1); assert.equal(rows(f, "reservation").length, 2);
});

test("new candidates with identical creative instructions receive distinct attempts and reservations", async t => {
  const f = fixture(t, {count: 1}), node = f.plan.nodes[0];
  await f.engine.runReady(); const first = rows(f, "attempt")[0], project = f.store.getProject(f.projectId);
  const grant = f.engine.createGrant(f.projectId, node.shotId, node.kind, "explicit-new-take"), planId = randomUUID();
  f.store.transaction(() => { f.engine.installPlan(f.projectId, planId, f.plan, { [node.id]: grant.id }); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  assert.equal((await f.engine.runReady()).dispatched, 1); const second = rows(f, "attempt").find(row => row.id !== first.id);
  assert.notEqual(second.candidateId, first.candidateId); assert.notEqual(second.reservationId, first.reservationId); assert.equal(first.ordinal, 1); assert.equal(second.ordinal, 1);
});

test("full profile definition is pinned even when execution configuration stays identical", t => {
  const f = fixture(t), selected = f.selections()[0], changed = { ...f.profile, unitCostMicros: "200", maxConcurrency: 9, maxRetries: 2 };
  assert.equal(providerProfileArguments(changed).profileDigest, providerProfileArguments(f.profile).profileDigest);
  assert.throws(() => currentExternalSelection(f.store, f.projectId, selected, String(providerProfileArguments(changed).profileDigest), digest(changed)), {code: "EXTERNAL_PROFILE_MISMATCH"});
  assert.throws(() => currentExternalSelection(f.store, f.projectId, {...selected, candidateId: randomUUID()}, String(providerProfileArguments(f.profile).profileDigest), digest(f.profile)), {code: "EXTERNAL_SELECTION_STALE"});
  assert.throws(() => currentExternalSelection(f.store, f.projectId, {...selected, specDigest: "f".repeat(64)}, String(providerProfileArguments(f.profile).profileDigest), digest(f.profile)), {code: "EXTERNAL_SELECTION_STALE"});
  assert.equal(rows(f, "attempt").length, 0); assert.equal(rows(f, "reservation").length, 0);
});

test("holds, pause and grants remain required with no project cap", async t => {
  const f = fixture(t), hold = f.engine.setHold(f.projectId, { scopeId: f.projectId, ownerId: "human-edit" });
  assert.equal((await f.engine.runReady()).dispatched, 0); f.engine.releaseHold(f.projectId, hold.id, "human-edit");
  f.engine.setPaused(f.projectId, true, "human-pause"); assert.equal((await f.engine.runReady()).dispatched, 0); f.engine.setPaused(f.projectId, false, "human-resume");
  const candidate = rows(f, "candidate")[0]; f.store.db.prepare("DELETE FROM entities WHERE kind='grant' AND id=?").run(candidate.grantId);
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 1); assert.equal(result.blocked[0].code, "ORIGIN_NOT_AUTHORIZED");
  assert.equal(f.engine.committedMicros(f.projectId), "100");
});

test("restart after admission before dispatch reconciles without a second start and keeps liability", async t => {
  const f = fixture(t, { count: 1 }), node = f.plan.nodes[0];
  const admitted = f.engine.admit(f.projectId, node.id, f.engine.resolveInputs(f.projectId, node).fingerprint), reservation = rows(f, "reservation")[0];
  assert.equal(f.calls.length, 0); f.store.put("attempt", admitted.id, f.projectId, { ...admitted, leaseExpiresAt: 0 }); f.store.close();
  const store = new Store(f.dbPath); t.after(() => { if (store.db.open) store.close(); });
  const policy = new ConfiguredExternalAdmission(store, () => { throw Error("recovery must not check readiness"); });
  const engine = new Engine(store, f.port, { artifactDir: f.artifactDir, externalAdmission: policy });
  await engine.reconcile(); await engine.runReady(); assert.equal(f.calls.length, 0);
  assert.deepEqual(store.list("reservation", f.projectId), [reservation]); assert.equal(engine.attempts(f.projectId)[0].phase, "submission_unknown"); assert.equal(engine.committedMicros(f.projectId), "100");
});

test("restoration fences old candidate authority even after quarantine release", async t => {
  const f = fixture(t);
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64), sourceDatabaseSha256: "b".repeat(64),
    originalDataRoot: f.directory, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
  await assert.rejects(f.engine.runReady(), { code: "INSTALLATION_QUARANTINED" });
  const snapshot = new InstallationRecoveryGuard(f.store).snapshot();
  releaseRecovery(f.store, { restoreId: snapshot.receipt.restoreId, expectedReceiptDigest: snapshot.receiptDigest,
    expectedSummaryDigest: snapshot.summaryDigest }, { principalId: "local-person", commandId: randomUUID() });
  const fresh = f.production.beginRequest(f.projectId, "local-person", "Resume", { editing: false }); f.production.control(f.projectId, fresh, "resume");
  const run = await f.engine.runReady(); assert.equal(run.dispatched, 0); assert.ok(run.blocked.every(row => row.code === "RESTORED_AUTHORITY_REQUIRES_NEW"));
  const selected = f.selections()[0];
  assert.throws(() => f.store.transaction(() => f.policy.authorize({ attemptId: randomUUID(), projectId: f.projectId, nodeId: selected.nodeId,
    candidateId: selected.candidateId, profile: f.profile, estimatedMicros: "100" })), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  assert.equal(f.calls.length, 0); assert.equal(rows(f, "attempt").length, 0); assert.equal(rows(f, "reservation").length, 0);
});
