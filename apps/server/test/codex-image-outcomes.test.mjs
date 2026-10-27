import test from 'node:test';
import assert from 'node:assert/strict';
import { codexImageFixture } from './codex-image-execution-fixture.mjs';
import { GenerationOverviewReader } from '../dist/generation-overview.js';
import { assertCodexImageRecords } from '../dist/execution/codex-image-lineage.js';
import { pngBytes } from './viggle-h3-execution-fixture.mjs';

async function fixture(t, outcome, callbacks = {}) {
  const f = codexImageFixture(t);
  f.transport.start = async (prepared, input, options) => {
    f.calls.start++;
    if (callbacks.start) return callbacks.start(prepared, input, options);
    return typeof outcome === 'string'
      ? { kind: 'failed', threadId: prepared.session.threadId, turnId: 'private-native-turn', code: outcome }
      : outcome;
  };
  if (callbacks.lookup) f.transport.lookup = async (prepared, options) => {
    f.calls.lookup++;
    return callbacks.lookup(prepared, options);
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
    const { unknownWait: _wait, ...due } = attempt; // time passes beyond the unchanged-unknown backoff
    f.store.put('attempt', attempt.id, attempt.projectId, { ...due, leaseExpiresAt: 0 });
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

for (const savedTurn of [false, true]) {
  test(`a saved native ${savedTurn ? 'turn and thread' : 'thread without a turn'} remains a real recovery source after the maximum turn window`, async t => {
    let terminal = false;
    const f = await fixture(t, { kind: 'unknown', code: 'ACKNOWLEDGEMENT_LOST' }, {
      start: async (_prepared, _input, options) => {
        if (savedTurn) await options.observeTurn('turn-exact');
        return { kind: 'unknown', code: 'ACKNOWLEDGEMENT_LOST' };
      },
      lookup: async (prepared, options) => {
        assert.equal(prepared.session.threadId, 'thread-injected');
        assert.equal(options.turnId, savedTurn ? 'turn-exact' : undefined);
        return terminal
          ? { kind: 'failed', threadId: prepared.session.threadId, turnId: 'turn-exact', code: 'IMAGE_FAILED' }
          : { kind: 'unknown', code: 'SAVED_THREAD_UNAVAILABLE' };
      },
    });
    await f.engine.runReady();
    const original = f.attempt(), dispatch = f.rows('codex_image_execution_dispatch')[0];
    assert.equal(dispatch.threadId, 'thread-injected');
    assert.equal(f.rows('codex_image_execution_run').length, savedTurn ? 1 : 0);
    let now = Date.parse(dispatch.createdAt) + 180_000 - 1;
    t.mock.method(Date, 'now', () => now);
    const reconcile = async () => {
      const { unknownWait: _wait, ...attempt } = f.attempt();
      f.store.put('attempt', attempt.id, attempt.projectId, { ...attempt, leaseExpiresAt: 0 });
      await f.engine.reconcile();
      await f.engine.runReady();
    };
    for (const age of [179_999, 180_001]) {
      now = Date.parse(dispatch.createdAt) + age;
      await reconcile();
      assert.equal(f.attempt().phase, 'submission_unknown');
      assert.equal(f.store.get('reservation', original.reservationId).state, 'reserved');
      assert.equal(f.rows('codex_image_execution_result').length, 0);
      assert.equal(f.calls.start, 1, 'passing a local timeout cannot buy another native turn');
    }
    assert.equal(f.calls.lookup, 2);
    terminal = true;
    now++;
    await reconcile();
    assert.equal(f.attempt().phase, 'failed');
    assert.equal(f.attempt().failure.id, 'IMAGE_FAILED', 'the saved real source decides the result');
    assert.equal(f.attempt().failure.retryAllowed, false);
    assert.equal(f.store.get('reservation', original.reservationId).state, 'charged');
    for (let cycle = 0; cycle < 3; cycle++) await reconcile();
    assert.equal(f.calls.start, 1);
    assert.equal(f.calls.lookup, 3, 'the saved terminal receipt replays without another native read');
    assert.equal(f.rows('reservation').length, 1);
    const second = await f.seed();
    const ready = await f.engine.runReady();
    assert.equal(ready.dispatched, 1, 'the terminal result frees the installation-wide slot');
    assert.equal(ready.blocked.some(item => item.nodeId === second.binding.id && item.code === 'CAPACITY_EXCEEDED'), false);
    assert.equal(f.calls.start, 2);
    assert.equal(f.calls.api, 0);
    assert.equal(f.calls.credentials, 0);
  });
}

test('a fenced preparation with no dispatch remains uncharged and frees capacity without automatic retry', async t => {
  const f = await fixture(t, { kind: 'unknown', code: 'UNUSED' });
  const attempt = f.engine.admit(f.selected.projectId, f.selected.binding.id,
    f.engine.resolveInputs(f.selected.projectId, f.selected.binding.node).fingerprint);
  const bridge = f.engine.registry.resolve({ adapter: 'codex-image', version: '1' });
  const { unknownWait: _wait, ...due } = attempt;
  f.store.put('attempt', attempt.id, attempt.projectId, { ...due, leaseExpiresAt: 0 });
  await f.engine.reconcile();
  assert.equal(f.attempt().phase, 'failed');
  assert.equal(f.store.get('reservation', attempt.reservationId).state, 'released');
  assert.equal(f.rows('codex_image_execution_result')[0].observation.kind, 'not_dispatched');
  const context = { expectedLease: { owner: attempt.leaseOwner, epoch: attempt.leaseEpoch } };
  assert.equal((await bridge.submit(attempt.request, context)).type, 'rejected');
  for (let cycle = 0; cycle < 3; cycle++) {
    await f.engine.reconcile();
    await f.engine.runReady();
  }
  assert.equal(f.calls.prepare, 0);
  assert.equal(f.calls.start, 0);
  assert.equal(f.calls.lookup, 0);
  assert.equal(f.rows('codex_image_execution_dispatch').length, 0);
  const second = await f.seed();
  const ready = await f.engine.runReady();
  assert.equal(ready.dispatched, 1);
  assert.equal(ready.blocked.some(item => item.nodeId === second.binding.id && item.code === 'CAPACITY_EXCEEDED'), false);
  assert.equal(f.calls.start, 1);
});

test('a saved native completion replays locally after the maximum turn window with no native lookup', async t => {
  const f = await fixture(t, { kind: 'unknown', code: 'UNUSED' }, {
    start: async prepared => ({ kind: 'completed', threadId: prepared.session.threadId, turnId: 'turn-complete', itemId: 'image-complete', bytes: pngBytes(), revisedPrompt: null }),
  });
  await f.engine.runReady();
  const attempt = f.attempt();
  assert.equal(attempt.phase, 'succeeded');
  assert.equal(f.store.get('reservation', attempt.reservationId).state, 'charged');
  const dispatch = f.rows('codex_image_execution_dispatch')[0];
  t.mock.method(Date, 'now', () => Date.parse(dispatch.createdAt) + 180_001);
  const bridge = f.engine.registry.resolve({ adapter: 'codex-image', version: '1' });
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.equal((await bridge.lookup(attempt.id, attempt.request)).type, 'completed');
    await f.engine.reconcile();
    await f.engine.runReady();
  }
  assert.equal(f.calls.start, 1);
  assert.equal(f.calls.lookup, 0);
  assert.equal(f.calls.api, 0);
  assert.equal(f.rows('reservation').length, 1);
});
