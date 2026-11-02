import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PROFILES } from '@openslate/core';
import { fixture } from './helpers/generation-fixture.mjs';
import { GenerationOverviewReader } from '../dist/generation-overview.js';
import { GENERATION_BLOCKER_LIMIT, assertGenerationJobsResolved } from '../dist/application/generation-blockers.js';
import { viggleHasCompletedObservation } from '../dist/execution/viggle-h3-execution.js';
import { fixture as viggleFixture, context, due, accepted, completed, json, taskId } from './viggle-h3-execution-fixture.mjs';

const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
const scene = (overview, id = 'scene-0') => overview.scenes.find(value => value.sceneId === id);
const summary = recovery => recovery.attempts.map(value => ({ attemptId: value.attemptId, shotId: value.shotId,
  kind: value.kind, phase: value.phase, action: value.resolution.action }));
const binding = (f, kind, shotId = 'shot-0') => f.store.list('node_binding', f.project.id).find(value => value.node.kind === kind && value.node.shotId === shotId);
function savedAttempt(f, attempt, changes) {
  const next = { ...f.store.get('attempt', attempt.id), ...changes };
  f.store.put('attempt', next.id, f.project.id, next);
  f.store.appendEvent(f.project.id, 'test.attempt_changed', { attemptId: next.id });
  return next;
}
// Retained historical liabilities are seeded without making another provider request.
function historicalAttempt(f, attempt, index, changes = {}) {
  const id = `historical-${String(index).padStart(3, '0')}`, reservationId = `${id}-reservation`;
  const next = { ...attempt, id, ordinal: attempt.ordinal + index, reservationId, createdAt: new Date(Date.parse(attempt.createdAt) + index * 1000).toISOString(),
    request: { ...attempt.request, attemptId: id }, ...changes };
  f.store.insert('attempt', id, f.project.id, next);
  const reservation = f.store.get('reservation', attempt.reservationId);
  f.store.insert('reservation', reservationId, f.project.id, { ...reservation, id: reservationId, attemptId: id });
  f.store.appendEvent(f.project.id, 'test.historical_attempt', { attemptId: id });
  return next;
}
function assertSceneRecovery(value, recovery) {
  assert.deepEqual(value.blockedBy, summary(recovery));
  assert.equal(value.blockedByTotal, recovery.total);
  assert.equal(value.blockedByTruncated, recovery.truncated);
  for (const attempt of value.blockedBy) assert.deepEqual(Object.keys(attempt).sort(), ['action', 'attemptId', 'kind', 'phase', 'shotId']);
}
function assertUnblocked(value) {
  assert.deepEqual(value.blockedBy, []);
  assert.equal(value.blockedByTotal, 0);
  assert.equal(value.blockedByTruncated, false);
}
async function refusal(f, targetShotIds = ['shot-0']) {
  const response = await f.post(await f.get(), 'image', randomUUID(), { targetShotIds, regenerate: true });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, 'ATTEMPT_EXISTS');
  return response.json().error.details;
}
async function pendingImage(f, mode = 'pending', sceneId = 'scene-0', shotId = 'shot-0') {
  ok(await f.post(await f.get(sceneId)));
  f.provider.setMode(binding(f, 'image', shotId).id, mode);
  await f.engine.runReady();
  return f.engine.attempts(f.project.id).find(value => value.nodeId === binding(f, 'image', shotId).id);
}

test('scene blocker evidence includes older jobs hidden behind the one visible slot and matches the refusal exactly', async t => {
  const f = fixture(t), old = await pendingImage(f, 'unknown_after_accept');
  await pendingImage(f, 'unknown_after_accept', 'scene-1', 'shot-1');
  const current = historicalAttempt(f, old, 1, { phase: 'remote_pending', taskId: 'offline-retained-running-job' });
  const recovery = await refusal(f), cursor = f.store.cursor(f.project.id);
  const before = f.store.db.prepare('SELECT kind,id,body FROM entities ORDER BY kind,id').all();
  const overview = await f.overview();
  assert.equal(overview.shots['shot-0'].keyframe.attemptId, current.id, 'a single media slot cannot expose every old job');
  assertSceneRecovery(scene(overview), recovery);
  assert.deepEqual(scene(overview).blockedBy.map(value => value.attemptId), [old.id, current.id]);
  assert.deepEqual(scene(overview).blockedBy.map(value => value.action), ['human_release', 'follow_existing_job']);
  assert.equal(scene(overview, 'scene-1').blockedByTotal, 1);
  assert.ok(scene(overview, 'scene-1').blockedBy.every(value => value.shotId === 'shot-1'));
  assert.equal(f.store.cursor(f.project.id), cursor, 'overview reads do not publish events or authority');
  assert.deepEqual(f.store.db.prepare('SELECT kind,id,body FROM entities ORDER BY kind,id').all(), before);
  assert.equal(JSON.stringify(scene(overview).blockedBy).includes(old.request.args.prompt), false);
});

test('a detached video remains a scene blocker after an edit and giving up removes only that live blocker', async t => {
  const f = fixture(t);
  ok(await f.post(await f.get())); await f.finish();
  ok(await f.post(await f.get(), 'video'));
  f.provider.setMode(binding(f, 'video').id, 'pending'); await f.engine.runReady();
  const old = f.engine.attempts(f.project.id).find(value => value.request.kind === 'video');
  savedAttempt(f, old, { phase: 'submission_unknown' });
  ok(await f.call('POST', '/storyboard', { kind: 'shot', field: 'imagePrompt', id: 'shot-0',
    value: 'A different harbor at dusk', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }));
  assert.ok(!f.engine.currentAttemptIds(f.project.id).includes(old.id));
  const recovery = await refusal(f), count = f.provider.acceptedCount();
  assert.equal(recovery.attempts[0].detached, true);
  assertSceneRecovery(scene(await f.overview()), recovery);
  ok(await f.call('POST', `/attempts/${old.id}/release`, { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true }));
  assertUnblocked(scene(await f.overview()));
  assert.equal(f.store.get('attempt', old.id).phase, 'submission_unknown', 'release leaves the old job available for polling');
  assert.ok(f.store.get('attempt', old.id).released);
  assert.equal(f.provider.acceptedCount(), count, 'release and overview never start another job');
  ok(await f.post(await f.get(), 'image', randomUUID(), { targetShotIds: ['shot-0'], regenerate: true }));
});

for (const phase of ['failed', 'succeeded']) test(`the scene blocker disappears when its last retained job is ${phase}`, async t => {
  const f = fixture(t), attempt = await pendingImage(f);
  assertSceneRecovery(scene(await f.overview()), await refusal(f));
  savedAttempt(f, attempt, { phase, ...(phase === 'failed' ? { failure: { id: 'SYNTHETIC_TERMINAL_FAILURE', technical: false, retryAllowed: false } } : {}) });
  assertUnblocked(scene(await f.overview()));
  assertUnblocked(scene(new GenerationOverviewReader(f.service).read(f.project.id)));
  ok(await f.post(await f.get(), 'image', randomUUID(), { targetShotIds: ['shot-0'], regenerate: true }));
});

test('scene blocker summaries are bounded and cannot become empty while omitted jobs still block generation', async t => {
  const f = fixture(t), first = await pendingImage(f, 'unknown_after_accept');
  const attempts = [first, ...Array.from({ length: GENERATION_BLOCKER_LIMIT + 2 }, (_, index) => historicalAttempt(f, first, index + 1))];
  const recovery = await refusal(f), initial = scene(await f.overview());
  assertSceneRecovery(initial, recovery);
  assert.equal(initial.blockedBy.length, GENERATION_BLOCKER_LIMIT);
  assert.equal(initial.blockedByTotal, attempts.length);
  assert.equal(initial.blockedByTruncated, true);
  for (const attempt of attempts.slice(0, GENERATION_BLOCKER_LIMIT)) savedAttempt(f, attempt, { phase: 'failed',
    failure: { id: 'SYNTHETIC_TERMINAL_FAILURE', technical: false, retryAllowed: false } });
  const remaining = scene(await f.overview());
  assertSceneRecovery(remaining, await refusal(f));
  assert.equal(remaining.blockedByTotal, 3);
  assert.equal(remaining.blockedByTruncated, false);
  assert.deepEqual(remaining.blockedBy.map(value => value.attemptId), attempts.slice(GENERATION_BLOCKER_LIMIT).map(value => value.id));
  for (const attempt of attempts.slice(GENERATION_BLOCKER_LIMIT)) savedAttempt(f, attempt, { phase: 'succeeded' });
  assertUnblocked(scene(await f.overview()));
  ok(await f.post(await f.get(), 'image', randomUUID(), { targetShotIds: ['shot-0'], regenerate: true }));
  assert.equal(f.provider.acceptedCount(), 1, 'retained test liabilities and overview never submit new provider work');
});

test('a provider-completed clip awaiting local recovery remains follow-only even if its saved phase says unknown', async t => {
  const f = await viggleFixture(t, { additionalProfiles: DEFAULT_PROFILES, fetch: async (_url, init) => init.method === 'POST' ? accepted()
    : json({ ...await completed().json(), video_url: 'https://unapproved.example.test/clip.mp4' }) });
  await f.bridge.submit(f.request, context(f)); due(f);
  await assert.rejects(f.bridge.poll(taskId, f.request), { code: 'OUTPUT_DOWNLOAD_LOCATOR' });
  const attempt = savedAttempt(f, f.attempt, { phase: 'submission_unknown', taskId });
  assert.equal(viggleHasCompletedObservation(f.store, attempt), true);
  let recovery;
  assert.throws(() => assertGenerationJobsResolved(f.production, f.project.id, ['shot-0']), error => {
    assert.equal(error.code, 'ATTEMPT_EXISTS'); recovery = error.recovery; return true;
  });
  assert.equal(recovery.attempts[0].resolution.action, 'follow_existing_job');
  const calls = { ...f.calls }, overview = new GenerationOverviewReader(f.production).read(f.project.id);
  assertSceneRecovery(scene(overview), recovery);
  assert.deepEqual(scene(overview).blockedBy, [{ attemptId: attempt.id, shotId: 'shot-0', kind: 'video',
    phase: 'submission_unknown', action: 'follow_existing_job' }]);
  assert.deepEqual(f.calls, calls, 'projection checks saved evidence without HTTP, downloads or credential access');
});
