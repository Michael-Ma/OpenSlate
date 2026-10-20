import test from 'node:test';
import assert from 'node:assert/strict';
import { codexImageFixture } from './codex-image-execution-fixture.mjs';
import { GenerationOverviewReader } from '../dist/generation-overview.js';
import { assertCodexImageRecords } from '../dist/execution/codex-image-lineage.js';

async function fixture(t, outcome) {
  const f = codexImageFixture(t);
  f.transport.start = async prepared => {
    f.calls.start++;
    return typeof outcome === 'string'
      ? { kind: 'failed', threadId: prepared.session.threadId, turnId: 'private-native-turn', code: outcome }
      : outcome;
  };
  f.build();
  f.selected = await f.seed();
  f.engine = f.runtime.engine;
  f.reader = new GenerationOverviewReader(f.production);
  f.rows = kind => f.store.list(kind, f.selected.projectId);
  f.attempt = () => f.engine.attempts(f.selected.projectId)[0];
  return f;
}

for (const code of ['USAGE_LIMIT', 'IMAGE_FAILED', 'TURN_FAILED', 'TURN_INTERRUPTED', 'NO_IMAGE']) {
  test(`saved native ${code} is failed and charged without release, duplicate starts or scene no-answer`, async t => {
    const f = await fixture(t, code);
    assert.equal((await f.engine.runReady()).dispatched, 1);
    const attempt = f.attempt();
    assert.equal(attempt.phase, 'failed');
    assert.equal(attempt.taskId, null, 'native turn identity is not a vendor job id');
    assert.equal(attempt.failure.id, code);
    assert.equal(attempt.failure.technical, false);
    assert.equal(attempt.failure.retryAllowed, false);
    assert.equal(f.store.get('reservation', attempt.reservationId).state, 'charged');
    assert.equal(assertCodexImageRecords(f.store, attempt).result.observation.code, code);
    assert.throws(() => f.engine.releaseAttempt(attempt.projectId, attempt.id, 'local-user', true), { code: 'ATTEMPT_NOT_RELEASABLE' });

    const overview = f.reader.read(attempt.projectId);
    const slot = overview.shots['shot-0'].keyframe;
    assert.equal(slot.state, 'failed', 'the browser offers failure recovery rather than double-charge release');
    assert.equal(slot.phase, 'failed');
    assert.equal(slot.failure.code, code);
    assert.equal(slot.failure.technical, false);
    assert.equal(slot.failure.retryAllowed, false);
    assert.equal(slot.failure.autoRetriesLeft, 0);
    assert.equal(slot.failure.charged, true);
    assert.equal(slot.failure.notDispatched, undefined);
    assert.deepEqual(slot.failure.nativeDiagnostic, code === 'USAGE_LIMIT' ? { category: 'native_rate_limited' } : undefined);
    assert.equal(slot.releasedAttemptIds, undefined);
    assert.equal(overview.scenes[0].blockers.some(blocker => blocker.code === 'no_answer_in_scene'), false);
    assert.equal(JSON.stringify(overview).includes('private-native-turn'), false, 'native ids stay behind the adapter');
    assert.equal(JSON.stringify(overview).includes('thread-injected'), false);

    const evidence = f.rows('execution_evidence');
    const reservation = f.store.get('reservation', attempt.reservationId);
    for (let cycle = 0; cycle < 3; cycle++) {
      await f.engine.reconcile();
      await f.engine.runReady();
    }
    assert.deepEqual(f.rows('execution_evidence'), evidence, 'terminal replay cannot add another charge observation');
    assert.deepEqual(f.store.get('reservation', attempt.reservationId), reservation);
    assert.equal(f.rows('reservation').length, 1);
    assert.equal(f.engine.attempts(attempt.projectId).length, 1);
    assert.equal(f.calls.start, 1);
    assert.equal(f.calls.lookup, 0, 'saved terminal evidence never starts a new native lookup');
    assert.equal(f.calls.api, 0);
    assert.equal(f.calls.credentials, 0);
  });
}

test('a saved native failure frees the installation-wide Codex slot for another film', async t => {
  const f = await fixture(t, 'USAGE_LIMIT');
  await f.engine.runReady();
  const first = f.attempt();
  const second = await f.seed();
  const ready = await f.engine.runReady();
  assert.equal(ready.dispatched, 1);
  assert.equal(ready.blocked.some(item => item.code === 'CAPACITY_EXCEEDED'), false);
  const attempt = f.engine.attempts(second.projectId)[0];
  assert.equal(attempt.phase, 'failed');
  assert.equal(f.store.get('reservation', attempt.reservationId).state, 'charged');
  assert.notEqual(attempt.id, first.id);
  assert.equal(f.calls.start, 2);
  assert.equal(f.calls.api, 0);
});

test('no saved native outcome remains unknown and reserves capacity without blind resubmission', async t => {
  const f = await fixture(t, { kind: 'unknown', code: 'ACKNOWLEDGEMENT_LOST' });
  await f.engine.runReady();
  const original = f.attempt();
  for (let cycle = 0; cycle < 3; cycle++) {
    const attempt = f.attempt();
    f.store.put('attempt', attempt.id, attempt.projectId, { ...attempt, leaseExpiresAt: 0 });
    await f.engine.reconcile();
    await f.engine.runReady();
  }
  assert.equal(f.attempt().phase, 'submission_unknown');
  assert.equal(f.store.get('reservation', original.reservationId).state, 'reserved');
  assert.equal(f.rows('codex_image_execution_result').length, 0);
  assert.equal(f.calls.start, 1);
  assert.equal(f.calls.lookup, 3, 'only read-only lookup can resolve an unknown dispatched turn');
  const overview = f.reader.read(original.projectId);
  assert.equal(overview.shots['shot-0'].keyframe.state, 'no_answer');
  assert.equal(overview.scenes[0].blockers.some(blocker => blocker.code === 'no_answer_in_scene'), true);
  const second = await f.seed();
  assert.ok((await f.engine.runReady()).blocked.some(item => item.nodeId === second.binding.id && item.code === 'CAPACITY_EXCEEDED'));
  assert.equal(f.calls.start, 1);
  assert.equal(f.calls.api, 0);
});
