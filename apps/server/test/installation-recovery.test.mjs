import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { DirectorSupervisor } from "../dist/application/director-supervisor.js";
import { ToolInvocationService } from "../dist/application/tool-invocations.js";
import { ProjectBudgetService, projectBudgetContextDigest, projectBudgetSnapshot } from "../dist/application/project-budget.js";
import { InstallationRecoveryGuard, installRecoveryQuarantine, releaseRecovery } from "../dist/application/installation-recovery.js";
import { recoveryBodyHash } from "../dist/persistence/recovery-records.js";
import { setup, sourceFor } from "./execution-fixture.mjs";

function origin(root, restoreId = randomUUID()) {
  return { restoreId, backupId: randomUUID(), backupManifestSha256: "a".repeat(64), sourceDatabaseSha256: "b".repeat(64),
    originalDataRoot: root, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" };
}
function release(store, commandId = randomUUID()) {
  const snapshot = new InstallationRecoveryGuard(store).snapshot();
  return releaseRecovery(store, { restoreId: snapshot.receipt.restoreId, expectedReceiptDigest: snapshot.receiptDigest,
    expectedSummaryDigest: snapshot.summaryDigest }, { principalId: "local-user", commandId });
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "openslate-recovery-")), store = new Store(join(root, "app.sqlite"));
  const provider = new FakeProvider(join(root, "fake.sqlite")), engine = new Engine(store, provider, { artifactDir: join(root, "artifacts") });
  const service = new ProductionService(store, engine), project = service.createProject("Recovery fixture");
  let calls = 0;
  const supervisor = new DirectorSupervisor(service, { id: "offline-native", async start(input) {
    calls++; return { projectId: input.projectId, requestId: input.requestId, epochId: input.epochId, turnId: input.turnId,
      status: "completed", text: "Fresh request completed", dispatched: true };
  } }, { mode: "native" });
  t.after(async () => { await supervisor.close(); if (store.db.open) store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, provider, engine, service, projectId: project.id, supervisor, calls: () => calls };
}
const body = (store, kind, id) => store.db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(kind, id)?.body;
const allRows = store => ["projects", "entities", "commands", "events", "installation_recoveries"].map(name => store.db.prepare(`SELECT * FROM ${name}`).all());

test("quarantine atomically retains exact original native ownership evidence and stops all work while reads stay pure", async t => {
  const f = fixture(t), human = f.service.beginRequest(f.projectId, "human", "Original request", { key: "original" });
  const bridge = f.service.openEpoch(f.projectId, human), first = f.supervisor.enqueue(f.projectId, human);
  f.store.put("director_turn", first.id, f.projectId, { ...first, state: "running", owner: "lost-process", leaseExpiresAt: Date.now() + 60000,
    epochId: bridge.actor.epochId, nativeThreadId: "saved-thread", nativeTurnId: "saved-turn", dispatched: true });
  const queuedHuman = f.service.beginRequest(f.projectId, "human", "Queued discussion", { editing: false });
  const queued = f.supervisor.enqueue(f.projectId, queuedHuman);
  const originalTurn = body(f.store, "director_turn", first.id), originalMessage = body(f.store, "message", human.requestId);
  const receipt = installRecoveryQuarantine(f.store, origin(f.root)), guard = f.engine.recovery;
  assert.equal(guard.isQuarantined(), true); assert.equal(receipt.backupCreatedAt, "2026-09-11T00:00:00.000Z");
  const fence = f.store.list("installation_recovery_fence", f.projectId).find(row => row.recordId === first.id);
  assert.equal(fence.originalBody, originalTurn); assert.equal(fence.originalBodySha256, recoveryBodyHash(originalTurn));
  assert.equal(body(f.store, "message", human.requestId), originalMessage);
  assert.equal(f.store.get("director_turn", first.id).state, "unknown");
  assert.equal(f.store.get("director_turn", first.id).nativeThreadId, "saved-thread");
  assert.equal(f.store.get("director_turn", first.id).nativeTurnId, "saved-turn");
  assert.equal(f.store.get("director_turn", first.id).leaseExpiresAt, 0);
  assert.equal(f.store.get("director_turn", queued.id).state, "interrupted");
  assert.equal(f.store.get("epoch", bridge.actor.epochId).state, "revoked");
  const before = allRows(f.store);
  assert.throws(() => f.service.createProject("blocked"), { code: "INSTALLATION_QUARANTINED" });
  assert.throws(() => f.service.beginRequest(f.projectId, "human", "blocked"), { code: "INSTALLATION_QUARANTINED" });
  assert.throws(() => f.service.control(f.projectId, queuedHuman, "resume"), { code: "INSTALLATION_QUARANTINED" });
  assert.throws(() => f.service.openEpoch(f.projectId, queuedHuman), { code: "INSTALLATION_QUARANTINED" });
  assert.throws(() => f.engine.createGrant(f.projectId, f.projectId, "image", "fresh"), { code: "INSTALLATION_QUARANTINED" });
  await assert.rejects(f.engine.runReady(), { code: "INSTALLATION_QUARANTINED" });
  await assert.rejects(f.engine.reconcile(), { code: "INSTALLATION_QUARANTINED" });
  await assert.rejects(new ToolInvocationService(f.service).invoke(f.projectId, bridge.actor, "call", "read_project", {}), { code: "INSTALLATION_QUARANTINED" });
  f.supervisor.tick(); await f.supervisor.settle();
  assert.equal(f.service.snapshot(f.projectId).control.paused, true); assert.equal(f.calls(), 0); assert.equal(f.provider.acceptedCount(), 0);
  assert.deepEqual(allRows(f.store), before);
});

test("release binds the displayed summary, is immutable across connections, leaves pause and all generations fenced", t => {
  const f = fixture(t), actor = f.service.beginRequest(f.projectId, "human", "Old", { editing: false, key: "old" });
  const input = origin(f.root), receipt = installRecoveryQuarantine(f.store, input);
  assert.deepEqual(installRecoveryQuarantine(f.store, input), receipt);
  assert.throws(() => installRecoveryQuarantine(f.store, { ...input, backupId: "other" }), { code: "RECOVERY_CONFLICT" });
  const snapshot = f.engine.recovery.snapshot(), selected = { restoreId: receipt.restoreId, expectedReceiptDigest: snapshot.receiptDigest, expectedSummaryDigest: snapshot.summaryDigest };
  assert.throws(() => releaseRecovery(f.store, { ...selected, expectedSummaryDigest: "f".repeat(64) }, { principalId: "local-user", commandId: "release" }), { code: "RECOVERY_CONFLICT" });
  const second = new Store(f.store.path);
  try {
    const saved = releaseRecovery(f.store, selected, { principalId: "local-user", commandId: "release" });
    assert.deepEqual(releaseRecovery(second, selected, { principalId: "local-user", commandId: "release" }), saved);
    assert.throws(() => releaseRecovery(second, selected, { principalId: "local-user", commandId: "different" }), { code: "RECOVERY_ALREADY_RELEASED" });
    assert.equal(new InstallationRecoveryGuard(second).isQuarantined(), false);
  } finally { second.close(); }
  assert.equal(f.service.snapshot(f.projectId).control.paused, true);
  assert.throws(() => f.service.beginRequest(f.projectId, "human", "Old", { editing: false, key: "old" }), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  assert.throws(() => f.service.openEpoch(f.projectId, actor), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  const fresh = f.service.beginRequest(f.projectId, "human", "New", { editing: false });
  assert.equal(f.engine.recovery.isImported(f.projectId, "message", fresh.requestId), false);
  const later = installRecoveryQuarantine(f.store, origin(f.root)); assert.equal(later.generation, 2); release(f.store);
  const reopened = new Store(f.store.path);
  try {
    const guard = new InstallationRecoveryGuard(reopened);
    for (const id of [actor.requestId, fresh.requestId]) assert.throws(() => guard.assertWritable(f.projectId, id), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
    assert.equal(reopened.installationRecoveries().length, 2);
  } finally { reopened.close(); }
});

test("quarantine rollback leaves no partial fences, pause or native transition; missing fence fails closed on reopen", t => {
  const f = fixture(t), actor = f.service.beginRequest(f.projectId, "human", "Keep me"), before = allRows(f.store);
  const insert = f.store.insert.bind(f.store); let inserted = 0;
  f.store.insert = (...args) => { const value = insert(...args); if (args[0] === "installation_recovery_fence" && ++inserted === 1) throw Error("restore interrupted"); return value; };
  assert.throws(() => installRecoveryQuarantine(f.store, origin(f.root)), /restore interrupted/); f.store.insert = insert;
  assert.deepEqual(allRows(f.store), before);
  installRecoveryQuarantine(f.store, origin(f.root));
  const fence = f.store.list("installation_recovery_fence", f.projectId).find(value => value.recordId === actor.requestId);
  assert.throws(() => f.store.put("installation_recovery_fence", fence.id, f.projectId, { ...fence, originalBodySha256: "e".repeat(64) }), { code: "IMMUTABLE_RECORD" });
  f.store.db.prepare("DELETE FROM entities WHERE kind='installation_recovery_fence' AND id=?").run(fence.id);
  assert.throws(() => new InstallationRecoveryGuard(f.store).snapshot(), { code: "RECOVERY_INVALID" });
});

test("released restoration recovers accepted and uncertain fixture receipts after reopen without another submit or refund", async t => {
  const f = setup(t, { count: 2, imagesOnly: true });
  f.provider.setMode(f.plan.nodes[0].id, "unknown_after_accept"); await f.engine.runReady();
  assert.equal(f.provider.acceptedCount(), 2);
  const evidence = f.store.list("execution_evidence", f.projectId), attempts = f.engine.attempts(f.projectId);
  installRecoveryQuarantine(f.store, origin(f.directory));
  const snapshot = f.engine.recovery.snapshot(); assert.equal(snapshot.counts.knownJobs, 1); assert.equal(snapshot.counts.unknownJobs, 1);
  await assert.rejects(f.engine.reconcile(), { code: "INSTALLATION_QUARANTINED" });
  assert.deepEqual(f.store.list("execution_evidence", f.projectId), evidence);
  release(f.store); f.store.close(); f.provider.close();
  const store = new Store(f.dbPath), provider = new FakeProvider(f.providerPath), engine = new Engine(store, provider, { artifactDir: f.artifactDir });
  try {
    await engine.reconcile(); assert.equal(provider.acceptedCount(), 2); assert.ok(engine.attempts(f.projectId).every(attempt => attempt.phase === "succeeded"));
    assert.equal(engine.budget(f.projectId).committedMicros, "200");
    assert.equal(store.get("execution_control", f.projectId).paused, true);
    for (const attempt of attempts) assert.throws(() => engine.recovery.assertFirstSubmit(f.projectId, attempt.id), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
    assert.equal(engine.outputs(f.projectId).length, 2); // existing accepted results remain available for review while paused
    assert.equal(store.list("artifact", f.projectId).length, 2);
  } finally { store.close(); provider.close(); }
});

test("restored technical failure cannot automatically retry the old candidate even after a fresh human resume", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }), service = new ProductionService(f.store, f.engine);
  f.provider.setMode(f.plan.nodes[0].id, "technical_failure"); await f.engine.runReady(); await f.engine.reconcile();
  installRecoveryQuarantine(f.store, origin(f.directory)); release(f.store);
  const actor = service.beginRequest(f.projectId, "human", "Resume", { editing: false }); service.control(f.projectId, actor, "resume");
  const next = await f.engine.runReady(); assert.equal(next.dispatched, 0); assert.equal(next.blocked[0].code, "RESTORED_AUTHORITY_REQUIRES_NEW");
  assert.equal(f.provider.acceptedCount(), 1); assert.equal(f.engine.attempts(f.projectId).length, 1);
});

test("recovery summary treats conflicting accepted IDs as uncertain even with a saved task, without querying a provider", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId)[0]; assert.ok(attempt.taskId);
  installRecoveryQuarantine(f.store, origin(f.directory));
  assert.equal(f.engine.recovery.snapshot().counts.knownJobs, 1);
  const outcome = { type: "accepted", taskId: "different-observed-task" };
  f.store.insert("execution_evidence", randomUUID(), f.projectId, { attemptId: attempt.id, outcome, outcomeDigest: digest(outcome), recordedAt: new Date().toISOString() });
  const before = allRows(f.store), summary = f.engine.recovery.snapshot();
  assert.equal(summary.counts.knownJobs, 0); assert.equal(summary.counts.unknownJobs, 1);
  assert.deepEqual(allRows(f.store), before); assert.equal(f.provider.acceptedCount(), 1);
  assert.deepEqual(f.engine.attempts(f.projectId)[0], attempt);
});

test("inspection verifies saved review inputs without creating an approval snapshot during quarantine", async t => {
  const f = setup(t, { count: 1 }); await f.engine.runReady(); await f.engine.reconcile();
  installRecoveryQuarantine(f.store, origin(f.directory)); const before = allRows(f.store);
  const inspection = f.engine.inspectReview(f.projectId); assert.equal(inspection.members[0].ready, true); assert.equal(Object.hasOwn(inspection, "id"), false);
  assert.throws(() => f.engine.reviewSnapshot(f.projectId), { code: "INSTALLATION_QUARANTINED" });
  assert.deepEqual(allRows(f.store), before);
});

test("imported waiting questions cannot revive authority; explicit fresh continuation transfers only the old holds", async t => {
  const f = fixture(t), old = f.service.beginRequest(f.projectId, "human", "Original question"), turn = f.supervisor.enqueue(f.projectId, old);
  f.store.put("director_turn", turn.id, f.projectId, { ...turn, state: "waiting_user" });
  f.store.insert("director_question", "pending-question", f.projectId, { turnId: turn.id, requestId: old.requestId, questions: [], state: "pending" });
  installRecoveryQuarantine(f.store, origin(f.root)); release(f.store);
  const before = allRows(f.store);
  assert.equal(f.service.snapshot(f.projectId).questions[0].canAnswer, false);
  assert.equal(Object.hasOwn(f.store.get("director_question", "pending-question"), "canAnswer"), false);
  assert.throws(() => f.supervisor.answerQuestion(f.projectId, "human", "pending-question", "yes", "answer"), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  assert.deepEqual(allRows(f.store), before);
  const fresh = f.service.beginRequest(f.projectId, "human", "Continue this saved work", { continuationRequestId: old.requestId });
  assert.ok(f.store.list("hold", f.projectId).filter(hold => hold.ownerId === old.requestId).every(hold => !hold.active));
  assert.ok(f.store.list("hold", f.projectId).some(hold => hold.ownerId === fresh.requestId && hold.active));
  f.supervisor.enqueue(f.projectId, fresh); f.supervisor.tick(); assert.equal(f.calls(), 0);
  f.service.control(f.projectId, fresh, "resume"); f.supervisor.tick(); await f.supervisor.settle(); assert.equal(f.calls(), 1);
});

test("budget receipt replay requires fresh human authority after restoration", t => {
  const f = fixture(t), budget = new ProjectBudgetService(f.service), before = projectBudgetSnapshot(f.service, f.projectId);
  const input = { expectedRevision: before.revision, expectedCapMicros: before.capMicros, capMicros: "2000000" };
  const actor = f.service.beginRequest(f.projectId, "human", "Raise reviewed cap", { editing: false, contextDigest: projectBudgetContextDigest(f.projectId, input) });
  budget.revise(f.projectId, actor, input); installRecoveryQuarantine(f.store, origin(f.root));
  assert.throws(() => budget.revise(f.projectId, actor, input), { code: "INSTALLATION_QUARANTINED" }); release(f.store);
  assert.throws(() => budget.revise(f.projectId, actor, input), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  assert.equal(projectBudgetSnapshot(f.service, f.projectId).capMicros, "2000000");
});

test("fresh continuation selects its new generation grant rather than an unused imported ancestor grant", async t => {
  const f = fixture(t), old = f.service.beginRequest(f.projectId, "human", "Build the scene");
  const scene = await f.service.prepare(f.projectId, old, { variant: "project", expectedHeadVersion: 0, creative: { brief: "Boots", story: "Craft",
    createScenes: [{ key: "scene", purpose: "Show craft" }], createShots: [{ key: "shot", sceneId: "scene", purpose: "Boot", action: "Boot on bench",
      framing: "Wide", motion: "Push", desiredFrames: 180, imagePrompt: "Boot", videoPrompt: "Push", referenceArtifactIds: [], cueId: null }] } });
  f.service.apply(f.projectId, old, scene.id);
  const project = f.store.getProject(f.projectId), shot = project.shots[0];
  const imported = f.service.authorize(f.projectId, old, [{ scopeId: shot.id, kind: "image" }], "old-slot");
  installRecoveryQuarantine(f.store, origin(f.root)); release(f.store);
  const fresh = f.service.beginRequest(f.projectId, "human", "Continue with a fresh image approval", { continuationRequestId: old.requestId });
  f.service.authorize(f.projectId, fresh, [{ scopeId: shot.id, kind: "image" }], "new-slot");
  const prepared = await f.service.prepare(f.projectId, fresh, { variant: "plan", expectedHeadVersion: project.headVersion, source: sourceFor(project, true) });
  assert.ok(Object.values(prepared.grantBindings).every(id => !f.engine.recovery.isImported(f.projectId, "grant", id)));
  f.service.apply(f.projectId, fresh, prepared.id);
  assert.equal(f.store.list("candidate", f.projectId).length, 1); assert.ok(imported);
});
