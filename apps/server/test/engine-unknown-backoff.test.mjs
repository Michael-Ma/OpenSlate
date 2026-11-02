import test from 'node:test';
import assert from 'node:assert/strict';
import { elapseUnknownBackoff, setup } from './execution-fixture.mjs';

// Real vendors cannot find work by our attempt id, so the fake's own lookup is replaced:
// the engine only ever sees the same unknown answer, as with a vendor whose task status is unavailable.
function stuck(t) {
  const f = setup(t, { count: 1, imagesOnly: true });
  f.provider.setMode(f.plan.nodes[0].id, 'unknown_after_accept');
  f.provider.lookup = async () => ({ type: 'unknown', diagnostic: 'No retained provider answer' });
  return f;
}
const attempt = f => f.engine.attempts(f.projectId)[0];
/** Time passes but the backoff count is kept. */
const wake = (f, id) => { const saved = f.store.get('attempt', id); f.store.put('attempt', id, saved.projectId, { ...saved, unknownWait: { ...saved.unknownWait, nextEligibleAt: 0 } }); };
const events = (f, id) => f.store.readEvents(f.projectId).filter(event => event.payload?.attemptId === id);

test('repeated identical unknown observations append no events, never resubmit and never declare failure', async t => {
  const f = stuck(t); await f.engine.runReady();
  const first = attempt(f), before = events(f, first.id).length;
  for (let cycle = 0; cycle < 25; cycle++) { elapseUnknownBackoff(f.store, first.id); await f.engine.reconcile(); }
  const after = attempt(f);
  assert.equal(events(f, first.id).length, before, 'unchanged observations are not history');
  assert.equal(after.phase, 'submission_unknown'); assert.equal(after.failure, null);
  assert.ok(after.leaseEpoch >= first.leaseEpoch + 25, 'every cycle still re-observed the attempt');
  assert.equal(f.store.get('reservation', after.reservationId).state, 'reserved');
  assert.equal(f.provider.acceptedCount(), 1);
});

test('unknown outcome polling backs off, caps, resets on real change and still allows human release', async t => {
  const f = stuck(t); await f.engine.runReady();
  const id = attempt(f).id; await f.engine.reconcile(); const first = attempt(f);
  assert.equal(first.unknownWait.count, 1); assert.ok(first.unknownWait.nextEligibleAt > Date.now());
  for (let cycle = 0; cycle < 5; cycle++) await f.engine.reconcile();
  assert.equal(attempt(f).leaseEpoch, first.leaseEpoch, 'a waiting unknown attempt is not reclaimed every tick');
  for (let cycle = 0; cycle < 12; cycle++) { wake(f, id); await f.engine.reconcile(); }
  const waited = attempt(f); assert.equal(waited.unknownWait.count, 13);
  const delay = waited.unknownWait.nextEligibleAt - Date.now(); assert.ok(delay <= 60_000 && delay > 30_000, 'delay is capped at one minute');
  const count = events(f, id).length;
  assert.equal(f.engine.releaseAttempt(f.projectId, id, 'local-user', true).attemptId, id); assert.ok(attempt(f).released);
  assert.deepEqual(events(f, id).slice(count).map(event => event.kind), ['attempt.released']);
  // A delayed local acceptance receipt supplies the real vendor task id.
  // The vendor is queried only by that saved task id, never by our attempt id.
  const taskId = f.provider.jobs()[0].id;
  f.provider.lookup = async () => ({ type: 'accepted', taskId });
  elapseUnknownBackoff(f.store, id); await f.engine.reconcile(); await f.engine.reconcile(); const repaired = attempt(f);
  assert.equal(repaired.unknownWait, undefined);
  assert.equal(repaired.phase, 'succeeded', 'a late result still lands after release, as history');
  assert.deepEqual(events(f, id).slice(count + 1).filter(event => event.kind === 'attempt.state_changed').map(event => event.payload.phase), ['remote_pending', 'succeeded'],
    'one state event for each real change');
  assert.equal(f.provider.acceptedCount(), 1);
});
