import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_PROFILES, RECIPE_DIGEST, STAGE_CONTRACTS_DIGEST, TOOL_NAMES } from '@openslate/core';
import { elapseUnknownBackoff, setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { createApp } from '../dist/app.js';

function fixture(t, options = {}) {
  const profiles = DEFAULT_PROFILES.map(p => ({ ...p, maxConcurrency: 1 }));
  const f = setup(t, { count: 1, imagesOnly: true, profiles, ...options });
  const project = f.store.getProject(f.projectId);
  f.store.insert('capability_lock', project.capabilityLockId, project.id, {
    profiles, recipeDigest: RECIPE_DIGEST, stageContractsDigest: STAGE_CONTRACTS_DIGEST, tools: TOOL_NAMES,
  });
  f.store.insert('project_revision', project.revisionId, project.id, { project });
  const service = new ProductionService(f.store, f.engine);
  const token = randomBytes(32).toString('base64url');
  const app = createApp({ service, localToken: token, logger: false });
  t.after(() => app.close());
  const path = `/api/projects/${project.id}`;
  const post = (route, payload, key = randomUUID()) => app.inject({ method: 'POST', url: path + route,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, ...(key === null ? {} : { 'idempotency-key': key }) }, payload });
  const scene = async () => {
    const response = await app.inject({ url: path + '/scenes/scene-0/generation', headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const generate = async (extra = {}) => {
    const view = await scene();
    return post('/scenes/scene-0/generate', { headVersion: view.headVersion, revisionId: view.revisionId,
      reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId,
      kind: 'image', reviewedFrames: [], ...extra });
  };
  const release = (attempt, input = {}, key = randomUUID()) => post(`/attempts/${attempt.id}/release`, {
    expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true, ...input,
  }, key);
  const overview = async () => {
    const response = await app.inject({ url: path + '/generation', headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200, response.body); return response.json();
  };
  return { ...f, service, app, post, scene, generate, release, overview };
}
const expectError = (response, code) => {
  assert.notEqual(response.statusCode, 200, response.body);
  assert.equal(response.json().error.code, code, response.body);
};
const reservation = (f, a) => f.store.get('reservation', a.reservationId);

test('Stop detaches queued work; sent work finishes and is charged; Continue alone dispatches nothing', async t => {
  const f = fixture(t, { count: 2 });
  f.provider.setMode(f.plan.nodes[0].id, 'pending');
  assert.equal((await f.engine.runReady()).dispatched, 1);
  const sent = f.engine.attempts(f.projectId)[0];
  const queued = f.plan.nodes.find(n => n.id !== sent.nodeId);
  const key = randomUUID(), response = await f.post('/controls', { action: 'stop' }, key);
  assert.equal(response.statusCode, 200, response.body);
  const receipt = response.json();
  assert.deepEqual(Object.keys(receipt).sort(), ['action', 'stopped']);
  assert.deepEqual(Object.keys(receipt.stopped).sort(), ['at', 'detachedJobs', 'sentJobs', 'stopId']);
  assert.equal(receipt.stopped.sentJobs, 1);
  assert.equal(receipt.stopped.detachedJobs, 1);
  assert.equal(f.store.get('node_binding', queued.id).candidateId, null);
  assert.equal(f.store.get('node_binding', queued.id).outdatedReason, 'stopped');
  assert.equal(f.store.get('node_binding', sent.nodeId).candidateId, sent.candidateId);
  const cursor = f.store.cursor(f.projectId);
  assert.deepEqual(f.service.stopView(f.projectId), receipt.stopped);
  assert.equal(f.store.cursor(f.projectId), cursor);
  expectError(await f.generate(), 'EXECUTION_PAUSED');
  const before = f.store.list('message', f.projectId).length;
  expectError(await f.post('/controls', { action: 'resume', expectedAuthorityId: 'wrong-stop' }), 'STOP_CHANGED');
  assert.equal(f.store.list('message', f.projectId).length, before);
  assert.deepEqual(f.service.stopView(f.projectId), receipt.stopped);
  f.provider.complete(sent.taskId);
  await f.engine.reconcile();
  assert.equal(f.engine.attempts(f.projectId)[0].phase, 'succeeded');
  assert.equal(reservation(f, sent).state, 'charged');
  assert.ok(f.store.get('node_binding', sent.nodeId).outputs.image);
  const resumeKey = randomUUID(), resume = { action: 'resume', expectedAuthorityId: receipt.stopped.stopId };
  assert.deepEqual((await f.post('/controls', resume, resumeKey)).json(), { action: 'resume', stopped: null });
  assert.equal(f.service.stopView(f.projectId), null);
  assert.equal((await f.engine.runReady()).dispatched, 0);
  assert.equal(f.provider.acceptedCount(), 1);
  // Old command replays never reinstate a stop or undo a newer stop.
  assert.deepEqual((await f.post('/controls', { action: 'stop' }, key)).json(), receipt);
  assert.equal(f.service.snapshot(f.projectId).control.paused, false);
  const newer = (await f.post('/controls', { action: 'stop' })).json();
  assert.deepEqual((await f.post('/controls', resume, resumeKey)).json(), { action: 'resume', stopped: null });
  assert.deepEqual(f.service.stopView(f.projectId), newer.stopped);
});

test('controls require a key and explicit Continue authority, and persist the Stop read across reopen', async t => {
  const f = fixture(t);
  expectError(await f.post('/controls', { action: 'stop' }, null), 'IDEMPOTENCY_KEY_REQUIRED');
  expectError(await f.post('/controls', { action: 'stop' }, '   '), 'IDEMPOTENCY_KEY_REQUIRED');
  expectError(await f.post('/controls', { action: 'resume' }), 'VALIDATION_ERROR');
  expectError(await f.post('/controls', { action: 'pause' }), 'VALIDATION_ERROR');
  assert.equal(f.store.list('message', f.projectId).length, 0);
  const stopped = (await f.post('/controls', { action: 'stop' })).json().stopped;
  const reopened = new Store(f.dbPath);
  try {
    const engine = new Engine(reopened, f.provider, { artifactDir: f.artifactDir, profiles: f.engine.profiles });
    assert.deepEqual(new ProductionService(reopened, engine).stopView(f.projectId), stopped);
  } finally { reopened.close(); }
  assert.deepEqual((await f.post('/controls', { action: 'resume', expectedAuthorityId: stopped.stopId })).json(), { action: 'resume', stopped: null });
  const generate = await f.generate();
  assert.equal(generate.statusCode, 200, generate.body);
  assert.equal((await f.engine.runReady()).dispatched, 1);
});

test('released unknown work frees capacity; a lost reply stays charged behind the new human take', async t => {
  const f = fixture(t), node = f.plan.nodes[0];
  f.provider.setMode(node.id, 'unknown_after_accept');
  await f.engine.runReady();
  const old = f.engine.attempts(f.projectId)[0], key = randomUUID();
  expectError(await f.generate(), 'ATTEMPT_EXISTS');
  const released = await f.release(old, {}, key);
  assert.equal(released.statusCode, 200, released.body);
  assert.deepEqual(released.json(), { attemptId: old.id, shotId: 'shot-0', releasedAt: f.store.get('attempt', old.id).released.at });
  assert.deepEqual(f.store.get('attempt', old.id).released, { by: 'local-user', at: released.json().releasedAt });
  assert.equal(f.store.get('attempt', old.id).phase, 'submission_unknown');
  assert.deepEqual((await f.release(old, {}, key)).json(), released.json());
  expectError(await f.release(old), 'ATTEMPT_NOT_RELEASABLE');
  expectError(await f.release(old, { acknowledgeDoubleCharge: false }, key), 'IDEMPOTENCY_CONFLICT');
  assert.equal(reservation(f, old).state, 'reserved');
  assert.equal(f.engine.budget(f.projectId).committedMicros, reservation(f, old).micros);
  assert.deepEqual(f.engine.currentAttemptIds(f.projectId), []);
  assert.equal(f.store.get('node_binding', node.id).candidateId, null);
  const generated = await f.generate();
  assert.equal(generated.statusCode, 200, generated.body);
  // Both share the concurrency-one profile. Release must free that slot.
  assert.equal((await f.engine.runReady()).dispatched, 1);
  const replacement = f.engine.attempts(f.projectId).find(a => a.id !== old.id);
  assert.equal(f.provider.acceptedCount(), 2);
  const poll = f.provider.lookup.bind(f.provider);
  f.provider.lookup = async id => id === old.id ? { type: 'unknown', diagnostic: 'Still no answer' } : poll(id);
  await f.engine.reconcile();
  const newTake = f.store.get('node_binding', replacement.nodeId).outputs.image;
  assert.ok(newTake);
  f.provider.lookup = poll; elapseUnknownBackoff(f.store, old.id);
  await f.engine.reconcile();
  assert.equal(f.store.get('attempt', old.id).phase, 'failed');
  assert.equal(f.store.get('attempt', old.id).failure.id, 'SUBMISSION_RESPONSE_LOST');
  assert.equal(f.store.get('attempt', old.id).failure.retryAllowed, false);
  assert.deepEqual(f.store.get('attempt', old.id).outputs, {});
  assert.equal(reservation(f, old).state, 'charged');
  assert.deepEqual(f.store.get('node_binding', replacement.nodeId).outputs.image, newTake);
  assert.deepEqual(f.engine.currentAttemptIds(f.projectId), [replacement.id]);
  assert.equal(f.store.list('artifact', f.projectId).length, 1);
  for (let cycle = 0; cycle < 3; cycle++) { await f.engine.reconcile(); await f.engine.runReady(); }
  assert.equal(f.provider.acceptedCount(), 2);
  const cursor = f.store.cursor(f.projectId), count = f.store.list('message', f.projectId).length;
  assert.deepEqual((await f.release(old, {}, key)).json(), released.json());
  assert.equal(f.store.cursor(f.projectId), cursor);
  assert.equal(f.store.list('message', f.projectId).length, count);
  assert.equal(f.store.readEvents(f.projectId).filter(e => e.kind === 'attempt.released').length, 1);
  assert.equal(f.provider.acceptedCount(old.id), 1);
  expectError(await f.release(old), 'ATTEMPT_NOT_RELEASABLE');
});

test('release rejects missing acknowledgement, key, wrong phase and foreign attempt without mutation', async t => {
  const f = fixture(t), node = f.plan.nodes[0];
  f.provider.setMode(node.id, 'unknown_after_accept');
  await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId)[0], before = f.store.cursor(f.projectId);
  expectError(await f.release(attempt, { acknowledgeDoubleCharge: false }), 'DOUBLE_CHARGE_NOT_ACKNOWLEDGED');
  expectError(await f.post(`/attempts/${attempt.id}/release`, { expectedPhase: 'submission_unknown' }), 'DOUBLE_CHARGE_NOT_ACKNOWLEDGED');
  expectError(await f.release(attempt, {}, null), 'IDEMPOTENCY_KEY_REQUIRED');
  expectError(await f.release(attempt, {}, '   '), 'IDEMPOTENCY_KEY_REQUIRED');
  expectError(await f.release(attempt, { expectedPhase: 'remote_pending' }), 'VALIDATION_ERROR');
  expectError(await f.release({ id: 'missing' }), 'NOT_FOUND');
  assert.equal(f.store.cursor(f.projectId), before);
  assert.equal(f.store.get('attempt', attempt.id).released, undefined);
  await f.engine.reconcile();
  expectError(await f.release(attempt), 'ATTEMPT_NOT_RELEASABLE');
  const other = fixture(t);
  expectError(await other.release(attempt), 'NOT_FOUND');
});

test('release never detaches a newer candidate and its evidence cannot be removed or changed', async t => {
  const f = fixture(t), node = f.plan.nodes[0];
  f.provider.setMode(node.id, 'unknown_after_accept');
  await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId)[0], project = f.store.getProject(f.projectId);
  const grant = f.engine.createGrant(f.projectId, node.shotId, 'image', 'new-human-press');
  const planId = randomUUID();
  f.store.transaction(() => {
    f.engine.installPlan(f.projectId, planId, f.plan, { [node.id]: grant.id });
    f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion);
  });
  const candidate = f.store.get('node_binding', node.id).candidateId;
  assert.equal((await f.release(attempt)).statusCode, 200);
  assert.equal(f.store.get('node_binding', node.id).candidateId, candidate);
  const released = f.store.get('attempt', attempt.id);
  const { released: _release, ...withoutRelease } = released;
  for (const value of [withoutRelease, { ...released, released: { by: 'someone-else', at: released.released.at } }])
    assert.throws(() => f.store.put('attempt', attempt.id, f.projectId, value), { code: 'IMMUTABLE_RECORD' });
});

test('non-unknown attempts cannot be released and Stop preserves completed outputs', async t => {
  const f = fixture(t), node = f.plan.nodes[0];
  f.provider.setMode(node.id, 'pending');
  await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId)[0];
  expectError(await f.release(attempt), 'ATTEMPT_NOT_RELEASABLE');
  f.provider.complete(attempt.taskId);
  await f.engine.reconcile();
  const binding = f.store.get('node_binding', node.id);
  expectError(await f.release(attempt), 'ATTEMPT_NOT_RELEASABLE');
  const stopped = (await f.post('/controls', { action: 'stop' })).json().stopped;
  assert.equal(stopped.detachedJobs, 0);
  assert.equal(stopped.sentJobs, 0);
  assert.deepEqual(f.store.get('node_binding', node.id), binding);
});

test('Stop detaches an unused technical retry so Continue cannot spend its old authority', async t => {
  const f = fixture(t), node = f.plan.nodes[0];
  f.provider.setMode(node.id, 'technical_failure');
  await f.engine.runReady();
  await f.engine.reconcile();
  const failed = f.engine.attempts(f.projectId)[0];
  assert.equal(failed.phase, 'failed');
  expectError(await f.release(failed), 'ATTEMPT_NOT_RELEASABLE');
  const stopped = (await f.post('/controls', { action: 'stop' })).json().stopped;
  assert.equal(stopped.detachedJobs, 1);
  assert.equal(stopped.sentJobs, 0);
  await f.post('/controls', { action: 'resume', expectedAuthorityId: stopped.stopId });
  assert.equal((await f.engine.runReady()).dispatched, 0);
  assert.equal(f.provider.acceptedCount(), 1);
  assert.equal(reservation(f, failed).state, 'charged');
});

test('release persists across reopen and a late definitive rejection never refunds the committed reservation', async t => {
  const f = fixture(t), node = f.plan.nodes[0];
  f.provider.setMode(node.id, 'unknown_after_accept');
  await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId)[0];
  assert.equal((await f.release(attempt)).statusCode, 200);
  const released = f.store.get('attempt', attempt.id).released;
  const reopened = new Store(f.dbPath);
  try {
    const engine = new Engine(reopened, f.provider, { artifactDir: f.artifactDir, profiles: f.engine.profiles });
    assert.deepEqual(reopened.get('attempt', attempt.id).released, released);
    assert.deepEqual(engine.currentAttemptIds(f.projectId), []);
    f.provider.lookup = async () => ({ type: 'rejected', certainty: 'not_accepted', technical: true, retryAllowed: true, failureId: 'late-rejection' });
    await engine.reconcile();
    assert.equal(reopened.get('attempt', attempt.id).phase, 'failed');
    assert.equal(reopened.get('reservation', attempt.reservationId).state, 'reserved');
    assert.equal(engine.budget(f.projectId).committedMicros, reservation(f, attempt).micros);
    assert.equal((await engine.runReady()).dispatched, 0);
  } finally { reopened.close(); }
});

test('a submitted job failing after Stop cannot buy an automatic retry after Continue', async t => {
  const f = fixture(t), node = f.plan.nodes[0];
  f.provider.setMode(node.id, 'pending');
  await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId)[0];
  const stop = (await f.post('/controls', { action: 'stop' })).json().stopped;
  f.provider.poll = async taskId => ({ type: 'failed', taskId, failureId: 'late-failure', technical: true, retryAllowed: true });
  await f.engine.reconcile();
  assert.equal(f.store.get('attempt', attempt.id).phase, 'failed');
  assert.equal(reservation(f, attempt).state, 'charged');
  await f.post('/controls', { action: 'resume', expectedAuthorityId: stop.stopId });
  const resumed = await f.engine.runReady();
  assert.equal(resumed.dispatched, 0);
  assert.equal(resumed.blocked[0].code, 'RETRY_NOT_AUTHORIZED');
  assert.equal(f.provider.acceptedCount(), 1);
  const fresh = await f.generate();
  assert.equal(fresh.statusCode, 200, fresh.body);
  assert.equal((await f.engine.runReady()).dispatched, 1);
  assert.equal(f.provider.acceptedCount(), 2);
});


test('HTTP overview keeps stopped taken-off slots through Continue until a new press binds them', async t => {
  const f = fixture(t), stopped = (await f.post('/controls', { action: 'stop' })).json().stopped;
  assert.equal((await f.overview()).shots['shot-0'].keyframe.takenOff, 'stopped');
  await f.post('/controls', { action: 'resume', expectedAuthorityId: stopped.stopId });
  assert.equal((await f.overview()).shots['shot-0'].keyframe.takenOff, 'stopped');
  assert.equal((await f.engine.runReady()).dispatched, 0);
  const response = await f.generate(); assert.equal(response.statusCode, 200, response.body);
  assert.equal((await f.overview()).shots['shot-0'].keyframe.takenOff, undefined);
});

test('HTTP overview releases no-answer slots and preserves the reason through charged lost-reply failure', async t => {
  const f = fixture(t); f.provider.setMode(f.plan.nodes[0].id, 'unknown_after_accept'); await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId)[0]; assert.equal((await f.overview()).shots['shot-0'].keyframe.state, 'no_answer');
  const response = await f.release(attempt); assert.equal(response.statusCode, 200, response.body);
  let slot = (await f.overview()).shots['shot-0'].keyframe; assert.equal(slot.takenOff, 'released'); assert.notEqual(slot.state, 'no_answer');
  await f.engine.reconcile(); slot = (await f.overview()).shots['shot-0'].keyframe;
  assert.equal(slot.takenOff, 'released'); assert.equal(slot.artifact, undefined); assert.equal(slot.takeCount, 0);
  assert.equal(f.store.get('attempt', attempt.id).failure.id, 'SUBMISSION_RESPONSE_LOST');
  assert.equal(reservation(f, attempt).state, 'charged');
  assert.equal((await f.generate()).statusCode, 200); assert.equal((await f.overview()).shots['shot-0'].keyframe.takenOff, undefined);
});
