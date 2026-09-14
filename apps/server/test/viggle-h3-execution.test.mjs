import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest } from '@openslate/core';
import { describeViggleH3Request } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ViggleH3Execution } from '../dist/execution/viggle-h3-execution.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { assertViggleRecords, assertViggleSpoolLineage } from '../dist/execution/viggle-h3-lineage.js';
import { assertViggleH3ExecutionMapping, viggleH3CompletedObservationId } from '../dist/execution/viggle-h3-receipts.js';
import { InstallationRecoveryGuard, installRecoveryQuarantine, releaseRecovery } from '../dist/application/installation-recovery.js';
import { fixture, context, due, rows, taskId, key, json, accepted, pending, completed, hash } from './viggle-h3-execution-fixture.mjs';

function barrier() { let enter, release; return { entered: new Promise(resolve => { enter = resolve; }), waiting: new Promise(resolve => { release = resolve; }), enter: () => enter(), release: () => release() }; }
function tamper(f, kind, record) { f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical(record), kind, record.id); }
function current(f) { return f.store.get('attempt', f.attempt?.id ?? rows(f, 'attempt')[0].id); }
function reopen(f, deny = true) {
  f.store.close(); const store = new Store(f.path); f.stores.push(store);
  const outputs = new ExecutionOutputStore(store, { rootDir: join(f.directory, 'execution-output') });
  const bridge = new ViggleH3Execution({ ...f.bridgeOptions, store, outputStore: outputs, ...(deny ? {
    credentials: new EnvironmentMediaCredentials(() => { throw Error('Recovery must not request a key'); }), fetch: async () => { throw Error('Recovery must not call HTTP'); }
  } : {}) }); return { store, outputs, bridge };
}
async function ready(f) { await f.bridge.submit(f.request, context(f)); due(f); return f.bridge.poll(taskId, f.request); }

test('Viggle submits exact reviewed PNG multipart only after immutable full-admission mapping and marker', async t => {
  let f, body;
  f = await fixture(t, { fetch: async (url, init) => {
    assert.equal(url, 'https://apis.viggle.ai/v1/videos'); assert.equal(init.method, 'POST');
    assert.equal(rows(f, 'viggle_h3_execution_dispatch').length, 1); body = Buffer.from(init.body);
    const form = await new Request(url, { method: 'POST', headers: init.headers, body }).formData();
    assert.equal(form.get('quality'), 'low'); assert.equal(form.get('duration_s'), '6'); assert.equal(form.get('watermark'), 'false');
    assert.deepEqual(Buffer.from(await form.get('first_frame_image').arrayBuffer()), readFileSync(f.image.path)); return accepted();
  } });
  assert.deepEqual(await f.bridge.submit(f.request, context(f)), { type: 'accepted', taskId });
  const mapping = rows(f, 'viggle_h3_execution_mapping')[0], consumption = rows(f, 'external_allowance_consumption')[0];
  assert.equal(mapping.transport.bodySha256, hash(body)); assert.equal(mapping.transport.bodyByteLength, body.length);
  assert.equal(mapping.profileDefinitionDigest, digest(f.profile)); assert.equal(mapping.consumptionDigest, digest(consumption));
  assert.equal(mapping.allowanceDigest, digest(f.allowance)); assert.equal(mapping.firstFrame.artifactDigest, digest(f.image));
  assert.equal(mapping.firstFrame.approvalDigest, digest(f.approval)); assert.equal(mapping.firstFrame.snapshotDigest, digest(f.review));
  assert.equal(JSON.stringify(rows(f, 'viggle_h3_execution_mapping')).includes(key), false);
  assertViggleRecords(f.store, f.attempt.id); assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0);
});

test('missing actual consumption or forged full profile cannot substitute a nominal allowance ID', async t => {
  for (const mode of ['missing-consumption', 'profile-cost']) {
    const f = await fixture(t);
    if (mode === 'missing-consumption') f.store.db.prepare("DELETE FROM entities WHERE kind='external_allowance_consumption' AND id=?").run(f.attempt.id);
    else { const lock = f.store.get('capability_lock', f.project.capabilityLockId); tamper(f, 'capability_lock', { ...lock, profiles: [{ ...f.profile, unitCostMicros: '1' }] }); }
    await assert.rejects(f.bridge.submit(f.request, context(f)), /[Vv]iggle/); assert.equal(f.calls.post, 0);
    assert.equal(rows(f, 'viggle_h3_execution_dispatch').length, 0);
  }
});

test('missing owned PNG and unsupported creative overrides record only owned pre-dispatch failure', async t => {
  for (const mode of ['missing-png', 'override']) {
    const f = await fixture(t, mode === 'override' ? { shotSettings: { quality: 'high' } } : {});
    if (mode === 'missing-png') unlinkSync(f.image.path);
    const result = await f.bridge.submit(f.request, context(f)); assert.equal(result.type, 'rejected'); assert.equal(result.retryAllowed, false);
    assert.equal(rows(f, 'viggle_h3_execution_submit')[0].observation.code, 'LOCAL_INPUT_INVALID'); assert.equal(f.calls.post, 0);
    assert.equal(rows(f, 'viggle_h3_execution_dispatch').length, 0);
  }
});

test('captured original lease fences local failure after slow PNG preparation', async t => {
  const f = await fixture(t), b = barrier(), prepare = f.bridge.prepare.bind(f.bridge);
  f.bridge.prepare = async (...args) => { await prepare(...args); b.enter(); await b.waiting; throw Error('late preparation failure'); };
  const running = f.bridge.submit(f.request, context(f)); const rejected = assert.rejects(running, { code: 'VIGGLE_H3_EXECUTION_NOT_DISPATCHABLE' });
  await b.entered; f.store.put('attempt', f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: 'replacement', leaseEpoch: f.attempt.leaseEpoch + 1 });
  b.release(); await rejected; assert.equal(rows(f, 'viggle_h3_execution_submit').length, 0); assert.equal(f.calls.post, 0);
});

for (const mode of ['paused', 'project-hold', 'shot-hold', 'scene-hold', 'retired', 'prompt-changed']) test(`first POST rechecks ${mode} after asynchronous image verification`, async t => {
  const f = await fixture(t), b = barrier(), prepare = f.bridge.prepare.bind(f.bridge);
  f.bridge.prepare = async (...args) => { const result = await prepare(...args); b.enter(); await b.waiting; return result; };
  const running = f.bridge.submit(f.request, context(f)); const rejected = assert.rejects(running);
  await b.entered;
  if (mode === 'paused') f.store.put('execution_control', f.project.id, f.project.id, { paused: true });
  else if (mode.endsWith('hold')) f.engine.setHold(f.project.id, { scopeId: mode === 'project-hold' ? f.project.id : mode === 'shot-hold' ? f.project.shots[0].id : f.project.shots[0].sceneId, ownerId: randomUUID() });
  else { const binding = f.store.get('node_binding', f.node.id); f.store.put('node_binding', binding.id, f.project.id, mode === 'retired'
    ? { ...binding, state: 'retired' } : { ...binding, node: { ...binding.node, args: { ...binding.node.args, prompt: 'Changed motion' } } }); }
  b.release(); await rejected; assert.equal(f.calls.post, 0); assert.equal(rows(f, 'viggle_h3_execution_dispatch').length, 0);
  assert.equal(rows(f, 'viggle_h3_execution_submit').length, 0, 'a stale selector does not publish a local failure');
});

test('original cancellation survives replacement of the caller options signal', async t => {
  const f = await fixture(t), b = barrier(), prepare = f.bridge.prepare.bind(f.bridge), original = new AbortController(), replacement = new AbortController();
  f.bridge.prepare = async (...args) => { const result = await prepare(...args); b.enter(); await b.waiting; return result; };
  const options = { ...context(f), signal: original.signal }, running = f.bridge.submit(f.request, options);
  await b.entered; options.signal = replacement.signal; original.abort(); b.release(); await running;
  assert.equal(f.calls.post, 0); assert.equal(rows(f, 'viggle_h3_execution_submit')[0].observation.code, 'LOCAL_CANCELLED');
  assert.equal((await f.bridge.lookup(f.attempt.id)).type, 'rejected');
});

test('credential callback cannot publish local failure or POST after stealing the original lease', async t => {
  let f; f = await fixture(t, { credential: () => { const old = current(f); f.store.put('attempt', old.id, f.project.id, { ...old, leaseOwner: 'replacement', leaseEpoch: old.leaseEpoch + 1 }); return undefined; } });
  await assert.rejects(f.bridge.submit(f.request, context(f)), { code: 'VIGGLE_H3_EXECUTION_NOT_DISPATCHABLE' });
  assert.equal(rows(f, 'viggle_h3_execution_submit').length, 0); assert.equal(rows(f, 'viggle_h3_execution_dispatch').length, 0); assert.equal(f.calls.post, 0);
});

test('unknown marker and observation survive reopen without blind GET, credential lookup, or another POST', async t => {
  const f = await fixture(t, { fetch: async () => { throw Error('lost response'); } });
  assert.equal((await f.bridge.submit(f.request, context(f))).type, 'unknown'); const reopened = reopen(f);
  assert.equal((await reopened.bridge.submit(f.request)).type, 'unknown'); assert.equal((await reopened.bridge.lookup(f.attempt.id)).type, 'unknown');
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0); assert.equal(reopened.store.list('viggle_h3_execution_dispatch', f.project.id).length, 1);
});

test('durable accepted Engine evidence repairs a lost submit receipt without another POST', async t => {
  const f = await fixture(t, { deferAdmission: true }), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === 'viggle_h3_execution_submit') throw Error('controlled receipt SQL failure'); return insert(...args); };
  try { await f.engine.runReady(); } finally { f.store.insert = insert; }
  f.attempt = current(f); f.request = f.attempt.request; assert.equal(f.attempt.phase, 'remote_pending');
  assert.equal(rows(f, 'viggle_h3_execution_submit').length, 0); const restarted = reopen(f);
  assert.deepEqual(await restarted.bridge.lookup(f.attempt.id), { type: 'accepted', taskId });
  assert.equal(restarted.store.list('viggle_h3_execution_submit', f.project.id)[0].observation.taskId, taskId);
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0);
});

test('known polling cooldown is durable and a late worker cannot shorten a replacement claim', async t => {
  const b = barrier(); let count = 0;
  const f = await fixture(t, { fetch: async (_url, init) => { if (init.method === 'POST') return accepted(); if (++count === 1) { b.enter(); await b.waiting; } return pending(); } });
  await f.bridge.submit(f.request, context(f)); due(f); const running = f.bridge.poll(taskId, f.request); await b.entered;
  const second = new ViggleH3Execution(f.bridgeOptions); await second.poll(taskId, f.request); assert.equal(f.calls.query, 1);
  due(f); await second.poll(taskId, f.request); const replacement = rows(f, 'viggle_h3_poll_schedule')[0];
  b.release(); await running; assert.deepEqual(rows(f, 'viggle_h3_poll_schedule')[0], replacement); assert.equal(f.calls.query, 2);
  assert.equal(f.calls.post, 1); await second.poll(taskId, f.request); assert.equal(f.calls.query, 2);
});

test('expired signed locator refreshes only through another known-task GET and retains both immutable observations', async t => {
  let f, status = 400;
  f = await fixture(t, { fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed(String(f.calls.query)), downloadStatus: () => status });
  assert.equal((await ready(f)).type, 'unknown'); const first = rows(f, 'execution_output_receipt')[0];
  status = 200; due(f); const result = await f.bridge.poll(taskId, f.request); assert.equal(result.type, 'completed');
  assert.equal(rows(f, 'execution_output_receipt').length, 2); assert.equal(rows(f, 'viggle_h3_execution_observation').length, 2);
  assert.deepEqual(f.store.get('execution_output_receipt', first.id), first); assertViggleSpoolLineage(f.store, f.attempt, result.outputs[0].storage.spoolId);
  const before = { ...f.calls }; assert.deepEqual(await f.bridge.lookup(f.attempt.id), result); assert.deepEqual(await f.bridge.poll(taskId, f.request), result);
  assert.deepEqual(f.calls, before); assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 2);
});

test('identical bytes from an alternate winning receipt cannot bypass Viggle completed-observation lineage', async t => {
  const f = await fixture(t, { fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() }), spool = f.outputs.spool.bind(f.outputs); let injected = false;
  f.outputs.spool = async (...args) => {
    if (!injected) { injected = true; const other = f.outputs.recordReceipt(f.project.id, { attemptId: f.attempt.id, expectedRequestDigest: digest(f.request),
      port: 'video', kind: 'video', mimeType: 'video/mp4', vendorTaskId: taskId, diagnosticRequestId: 'wrong-result', source: { kind: 'protected_locator', locator: 'https://media.example.test/other.mp4', expiresAt: null } });
      await spool(f.project.id, other.id, async function* () { yield f.video; }); }
    return spool(...args);
  };
  assert.equal((await ready(f)).type, 'unknown'); const winner = rows(f, 'execution_output_slot')[0];
  assert.throws(() => assertViggleSpoolLineage(f.store, f.attempt, winner.spoolId), /Viggle/);
  const before = { ...f.calls }; assert.equal((await f.bridge.lookup(f.attempt.id)).type, 'unknown'); assert.deepEqual(f.calls, before);
  assert.equal(rows(f, 'video_derivation_intent').length, 0);
});

test('current plan changes after POST do not invalidate exact historical completed recovery', async t => {
  const f = await fixture(t, { fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() });
  await f.bridge.submit(f.request, context(f)); const binding = f.store.get('node_binding', f.node.id);
  f.store.put('node_binding', binding.id, f.project.id, { ...binding, state: 'retired' }); f.store.put('execution_control', f.project.id, f.project.id, { paused: true });
  due(f); assert.equal((await f.bridge.poll(taskId, f.request)).type, 'completed'); assertViggleRecords(f.store, f.attempt.id);
  assert.equal(f.calls.post, 1);
});

test('Engine refuses a custom ingester raw ArtifactRecord bypass for the new Viggle adapter', async t => {
  const f = await fixture(t, { deferAdmission: true, fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() });
  const engine = new Engine(f.store, f.bridge, { ...f.engineOptions, outputIngestor: { ingest: async ({ attempt, output }) => ({ id: 'raw-bypass', projectId: f.project.id,
    attemptId: attempt.id, artifact: { artifactId: 'raw-bypass', kind: 'video', sha256: output.sha256 }, path: join(f.artifactRoot, 'unverified.mp4'),
    mimeType: 'video/mp4', fixture: false, physicalDurationSeconds: 6 }) } });
  await engine.runReady(); f.attempt = current(f); f.request = f.attempt.request; due(f);
  await assert.rejects(engine.reconcile(), /Viggle|normaliz/i); assert.equal(f.store.get('artifact', 'raw-bypass'), undefined);
  assert.notEqual(current(f).phase, 'succeeded'); assert.equal(f.calls.post, 1);
});

test('saved normalization intent cannot reuse its completion after exact completed observation disappears', async t => {
  const f = await fixture(t, { ingest: true, fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() });
  const result = await ready(f); assert.equal(result.type, 'completed');
  f.attempt = f.store.put('attempt', f.attempt.id, f.project.id, { ...f.attempt, phase: 'ingesting', taskId });
  const input = { attempt: f.attempt, output: result.outputs[0], artifactDir: f.artifactRoot, signal: new AbortController().signal };
  await f.ingester.ingest(input); assert.equal(rows(f, 'video_derivation_intent').length, 1);
  const count = f.calls.normalization, observationId = viggleH3CompletedObservationId(f.attempt.id, result.outputs[0].storage.spoolId);
  f.store.db.prepare("DELETE FROM entities WHERE kind='viggle_h3_execution_observation' AND id=?").run(observationId);
  await assert.rejects(f.ingester.ingest(input), /Viggle/); assert.equal(f.calls.normalization, count);
  assert.equal(rows(f, 'video_derivation_receipt').length, 0);
});

test('restored imported attempt can recover accepted evidence after release but can never make its first POST', async t => {
  for (const submitted of [false, true]) {
    const f = await fixture(t); if (submitted) await f.bridge.submit(f.request, context(f));
    installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: 'a'.repeat(64), sourceDatabaseSha256: 'b'.repeat(64),
      originalDataRoot: f.directory, backupCreatedAt: '2026-09-11T00:00:00.000Z', restoredAt: '2026-09-12T00:00:00.000Z' });
    await assert.rejects(f.bridge.lookup(f.attempt.id), { code: 'INSTALLATION_QUARANTINED' });
    const snapshot = new InstallationRecoveryGuard(f.store).snapshot(); releaseRecovery(f.store, { restoreId: snapshot.receipt.restoreId,
      expectedReceiptDigest: snapshot.receiptDigest, expectedSummaryDigest: snapshot.summaryDigest }, { principalId: 'offline-human', commandId: randomUUID() });
    if (submitted) assert.deepEqual(await f.bridge.lookup(f.attempt.id), { type: 'accepted', taskId });
    else await assert.rejects(f.bridge.submit(f.request, context(f)), /restor|import/i);
    assert.equal(f.calls.post, submitted ? 1 : 0);
  }
});

test('mapping validators reject extra fields and accessors without evaluating getters', async t => {
  const f = await fixture(t); await f.bridge.submit(f.request, context(f)); const mapping = rows(f, 'viggle_h3_execution_mapping')[0];
  assert.throws(() => assertViggleH3ExecutionMapping(f.attempt, { ...mapping, apiKey: 'must-not-retain' }));
  let invoked = false; const invalid = { ...mapping }; Object.defineProperty(invalid, 'transport', { get() { invoked = true; return mapping.transport; } });
  assert.throws(() => assertViggleH3ExecutionMapping(f.attempt, invalid)); assert.equal(invoked, false);
  assert.throws(() => assertViggleSpoolLineage(f.store, { ...f.attempt, request: { ...f.request, execution: { adapter: 'viggle-h3', version: '2' } } }, 'missing'));
});

test('a copied approval without its actual human application command fails closed', async t => {
  const f = await fixture(t); await f.bridge.submit(f.request, context(f));
  f.store.db.prepare('DELETE FROM commands WHERE actor_scope=?').run(`${f.human.principalId}:${f.project.id}:review`);
  await assert.rejects(f.bridge.lookup(f.attempt.id), /human application command/);
  assert.throws(() => assertViggleRecords(f.store, f.attempt.id), /human application command/);
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0);
});

test('human scene-scope approval retains historical validity after the shot moves to another scene', async t => {
  const f = await fixture(t, { fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() });
  const sceneActor = f.production.beginRequest(f.project.id, 'scene-reviewer', 'Approve the displayed frame in this scene', { editing: false, scopeIds: [f.project.shots[0].sceneId] });
  const approval = f.production.approve(f.project.id, sceneActor, f.review.id, [f.node.id])[0];
  f.store.db.prepare("DELETE FROM entities WHERE kind='approval' AND id=?").run(f.approval.id);
  assert.deepEqual(await f.bridge.submit(f.request, context(f)), { type: 'accepted', taskId });
  assert.equal(rows(f, 'viggle_h3_execution_mapping')[0].firstFrame.approvalId, approval.id);
  const project = f.store.getProject(f.project.id), sceneId = randomUUID();
  f.store.saveProject({ ...project, scenes: [...project.scenes, { ...project.scenes[0], id: sceneId }],
    shots: project.shots.map(shot => ({ ...shot, sceneId })) }, project.headVersion);
  due(f); assert.equal((await f.bridge.poll(taskId, f.request)).type, 'completed'); assertViggleRecords(f.store, f.attempt.id);
  assert.equal(f.calls.post, 1);
});
