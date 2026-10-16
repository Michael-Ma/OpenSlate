import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../src/next/api/client.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { RESTORE_ID, setFixtureRecovery } from '../../src/next/fixtures/routes/recovery.ts';
import { shotId } from '../../src/next/fixtures/last-ferry.ts';
import { RELEASE_PATH, RELEASE_PRESS, RELEASE_STORAGE_KEY, recoveryReadOnly, stoppedByRestore } from '../../src/next/model/recovery.ts';
import { StudioStore } from '../../src/next/store/store.ts';

function memoryStorage() {
  const items = new Map();
  return { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)), removeItem: (k) => items.delete(k) };
}

/**
 * The sample studio, restored from a backup (`preset`), with every request recorded. `lose` drops the reply to a
 * matching request after the studio handled it; `drop` drops the request before it reaches the studio.
 */
async function studio(t, { preset = 'quarantined', storage = null, port = new FixturePort(), lose = null, drop = null, start = true, prefix = 'key' } = {}) {
  if (preset !== undefined && !port.restored) { setFixtureRecovery(port.world, preset); port.restored = true; }
  const calls = [];
  let n = 0;
  const client = {
    get closed() { return port.closed; },
    events: port.events.bind(port),
    async request(path, options = {}) {
      calls.push({ path, method: options.method ?? 'GET', key: options.key, body: options.body });
      if (drop?.(path, options)) throw new ApiError('NETWORK_ERROR');
      const answer = await port.request(path, options);
      if (lose?.(path, options)) throw new ApiError('NETWORK_ERROR');
      return answer;
    },
  };
  const store = new StudioStore({ client, storage, newKey: () => `${prefix}-${++n}` });
  if (start) await store.start();
  t.after(() => { store.stop(); port.close(); });
  const posts = () => calls.filter((call) => call.method === 'POST');
  return { port, store, calls, posts };
}

test('a restored studio is read-only from its first screen: presses are refused without sending, with the one reason', async (t) => {
  const { store, posts } = await studio(t);
  const state = store.getState();
  assert.equal(state.recovery.status.state, 'quarantined');
  assert.equal(recoveryReadOnly(state), true);
  // Reads keep working: the film and its overview are there.
  assert.equal(state.snapshot.project.name, 'The Last Ferry');
  assert.ok(state.overview);
  // The film was stopped by the restore.
  assert.equal(stoppedByRestore(state.overview, state.recovery.status), true);

  assert.equal(await store.edit({ kind: 'shot', id: shotId('2.1'), field: 'motion', value: 'Slow push' }), null);
  assert.equal(await store.sendMessage(), false);
  assert.equal(await store.command('plan:x', { x: 1 }, () => ({ path: '/storyboard', body: {} })), undefined);
  assert.deepEqual(posts(), [], 'nothing was sent');
  assert.equal(store.getState().toast.message.id, 'guard.recovery');
  assert.equal(store.getState().toast.tone, 'error');

  // Opening a frame is recorded on its own when it is shown: while read-only it is simply not recorded, and says nothing.
  store.dismissToast();
  await store.openFrame(shotId('2.2'));
  assert.deepEqual(posts(), []);
  assert.equal(store.getState().toast, null);
});

test('the sample studio refuses writes like the server while in review, the Director\'s messages included', async (t) => {
  const port = new FixturePort();
  setFixtureRecovery(port.world, 'quarantined');
  for (const path of ['/api/projects/last-ferry/messages', '/api/projects/last-ferry/storyboard', '/api/projects'])
    await assert.rejects(port.request(path, { method: 'POST', body: {} }), (error) => error.code === 'INSTALLATION_QUARANTINED' && error.status === 409, path);
  await port.request('/api/projects/last-ferry/generation');
  // Logout is not a studio write.
  assert.deepEqual(await port.request('/api/session/logout', { method: 'POST' }), { disconnected: true });
  port.close();
});

test('Finish recovery review releases exactly what was read, with an Idempotency-Key; the film stays stopped', async (t) => {
  const storage = memoryStorage();
  const { store, posts } = await studio(t, { storage });
  const read = store.getState().recovery.status;
  assert.equal(await store.releaseRecovery(), 'released');
  const [release] = posts();
  assert.equal(release.path, RELEASE_PATH);
  assert.equal(release.key, 'key-1');
  assert.deepEqual(release.body, { restoreId: RESTORE_ID, expectedReceiptDigest: read.receiptDigest, expectedSummaryDigest: read.summaryDigest });
  const state = store.getState();
  assert.equal(state.recovery.status.state, 'released');
  assert.equal(state.recovery.released, true, 'the review says what happens next');
  assert.equal(state.recovery.unconfirmed, null);
  assert.equal(recoveryReadOnly(state), false);
  assert.equal(state.pending[RELEASE_PRESS], undefined);
  assert.equal(storage.items.has(RELEASE_STORAGE_KEY), false, 'nothing left to retry');
  await store.refresh();
  assert.ok(store.getState().overview.stopped, 'every film stays stopped until the person continues it');
  assert.equal(stoppedByRestore(store.getState().overview, store.getState().recovery.status), true);
  store.dismissRecovery();
  assert.equal(store.getState().recovery.released, false);
  // Writes work again.
  assert.ok(await store.edit({ kind: 'shot', id: shotId('2.1'), field: 'motion', value: 'Slow push' }));
});

test('a lost request keeps the same decision, across a reload, until Retry gets the answer', async (t) => {
  const storage = memoryStorage();
  const port = new FixturePort();
  setFixtureRecovery(port.world, 'quarantined');
  port.restored = true;
  // The connection drops before the release reaches the studio.
  const first = await studio(t, { storage, port, drop: (path) => path === RELEASE_PATH });
  assert.equal(await first.store.releaseRecovery(), 'unconfirmed');
  const saved = first.store.getState().recovery.unconfirmed;
  assert.equal(saved.key, 'key-1');
  assert.deepEqual(JSON.parse(storage.items.get(RELEASE_STORAGE_KEY)), saved, 'kept for a reload');
  assert.equal(recoveryReadOnly(first.store.getState()), true, 'still read-only: the outcome is not known here');
  first.store.stop();

  // A reload: a new page on the same studio and storage, which still has the review open.
  const second = await studio(t, { storage, port, prefix: 'reloaded' });
  assert.deepEqual(second.store.getState().recovery.unconfirmed, saved, 'Retry is offered after the reload');
  assert.equal(await second.store.releaseRecovery(), 'released');
  const [retry] = second.posts();
  assert.deepEqual([retry.key, retry.body], [saved.key, saved.body], 'the same key and body: it cannot count twice');
  assert.equal(second.store.getState().recovery.status.state, 'released');
  assert.equal(storage.items.has(RELEASE_STORAGE_KEY), false);
});

test('the sample studio answers a resend of an applied release with the same answer, and refuses another decision', async () => {
  const port = new FixturePort();
  setFixtureRecovery(port.world, 'quarantined');
  const status = await port.request('/api/installation/recovery');
  const body = { restoreId: RESTORE_ID, expectedReceiptDigest: status.receiptDigest, expectedSummaryDigest: status.summaryDigest };
  const first = await port.request(RELEASE_PATH, { method: 'POST', body, key: 'decision-1' });
  const again = await port.request(RELEASE_PATH, { method: 'POST', body, key: 'decision-1' });
  assert.deepEqual(again, first);
  assert.equal(first.recovery.state, 'released');
  await assert.rejects(port.request(RELEASE_PATH, { method: 'POST', body, key: 'decision-2' }), (error) => error.code === 'RECOVERY_ALREADY_RELEASED' && error.status === 409);
  await assert.rejects(port.request(RELEASE_PATH, { method: 'POST', body }), (error) => error.code === 'VALIDATION_ERROR', 'a release needs its command key');
  port.close();
});

test('the lost-reply preset drops the first release before the studio gets it; Retry finishes the review', async (t) => {
  const { store, posts } = await studio(t, { preset: 'lost-reply' });
  assert.equal(await store.releaseRecovery(), 'unconfirmed');
  await store.readRecovery();
  assert.equal(store.getState().recovery.status.state, 'quarantined', 'nothing was released');
  assert.ok(store.getState().recovery.unconfirmed, 'Retry stays on offer');
  assert.equal(await store.releaseRecovery(), 'released');
  const [first, retry] = posts();
  assert.deepEqual([retry.key, retry.body], [first.key, first.body]);
  assert.equal(store.getState().recovery.released, true);
});

test('after a reload, a saved decision the studio already applied finishes the review instead of asking again', async (t) => {
  const storage = memoryStorage();
  const port = new FixturePort();
  setFixtureRecovery(port.world, 'quarantined');
  port.restored = true;
  // Applied by the studio, but its answer never reached the page.
  const first = await studio(t, { storage, port, lose: (path) => path === RELEASE_PATH });
  assert.equal(await first.store.releaseRecovery(), 'unconfirmed');
  first.store.stop();
  const second = await studio(t, { storage, port, prefix: 'reloaded' });
  const recovery = second.store.getState().recovery;
  assert.equal(recovery.status.state, 'released');
  assert.equal(recovery.unconfirmed, null);
  assert.equal(recovery.released, true, 'it says what happens next');
  assert.equal(storage.items.has(RELEASE_STORAGE_KEY), false);
  assert.deepEqual(second.posts(), [], 'nothing was sent again');
});

test('a summary that changed is refused and read again; the next Finish is bound to the new one', async (t) => {
  const { store, posts } = await studio(t, { preset: 'stale' });
  const before = store.getState().recovery.status;
  assert.equal(await store.releaseRecovery(), 'stale');
  const after = store.getState().recovery;
  assert.equal(after.stale, true);
  assert.equal(after.unconfirmed, null);
  assert.equal(after.status.state, 'quarantined');
  assert.notEqual(after.status.summaryDigest, before.summaryDigest);
  assert.deepEqual([after.status.counts.unknownJobs, after.status.counts.knownJobs], [0, 3]);
  assert.equal(store.getState().toast, null, 'the review says it, not a toast');

  assert.equal(await store.releaseRecovery(), 'released');
  const [, second] = posts();
  assert.equal(second.body.expectedSummaryDigest, after.status.summaryDigest);
  assert.notEqual(second.key, posts()[0].key, 'a new decision has a new key');
  assert.equal(store.getState().recovery.stale, false);
});

test('a review finished by another decision is said, and this page follows it', async (t) => {
  const port = new FixturePort();
  setFixtureRecovery(port.world, 'quarantined');
  port.restored = true;
  const other = await studio(t, { port, prefix: 'other' });
  const { store } = await studio(t, { port });
  assert.equal(await other.store.releaseRecovery(), 'released');
  await store.refresh();
  // This page had not heard yet: it still shows the review, and its own Finish is a different decision.
  store.dispatch({ type: 'recovery', recovery: { released: false, status: { ...other.store.getState().recovery.status, state: 'quarantined' } } });
  assert.equal(await store.releaseRecovery(), 'already');
  assert.equal(store.getState().recovery.status.state, 'released');
  assert.equal(store.getState().recovery.released, true);
  assert.equal(store.getState().toast.message.id, 'recovery.toast.already');
});

test('a release seen through a later read (its answer lost, its event arrived) finishes the review here too', async (t) => {
  const storage = memoryStorage();
  const { store, port } = await studio(t, { storage, lose: (path) => path === RELEASE_PATH });
  assert.equal(await store.releaseRecovery(), 'unconfirmed');
  assert.ok(store.getState().recovery.unconfirmed);
  await store.readRecovery();
  const recovery = store.getState().recovery;
  assert.equal(recovery.status.state, 'released');
  assert.equal(recovery.unconfirmed, null);
  assert.equal(recovery.released, true);
  assert.equal(storage.items.has(RELEASE_STORAGE_KEY), false);
  assert.ok(port);
});

test('an ordinary studio is not read-only and has nothing to review; a server without the route changes nothing', async (t) => {
  const { store } = await studio(t, { preset: null });
  assert.equal(store.getState().recovery.status.state, 'ordinary');
  assert.equal(recoveryReadOnly(store.getState()), false);
  assert.equal(await store.releaseRecovery(), undefined, 'nothing to release');

  const port = new FixturePort();
  const older = { get closed() { return port.closed; }, events: port.events.bind(port), request: (path, options) => (path.startsWith('/api/installation') ? Promise.reject(new ApiError('NOT_FOUND', 404)) : port.request(path, options)) };
  const plain = new StudioStore({ client: older, storage: null, newKey: () => 'k' });
  await plain.start();
  t.after(() => { plain.stop(); port.close(); });
  assert.equal(plain.getState().recovery.status, null);
  assert.equal(recoveryReadOnly(plain.getState()), false);
  assert.equal(plain.getState().snapshot.project.name, 'The Last Ferry');
});

test('Disconnect ends the session and stops the store; a refusal keeps the page and names the reason', async (t) => {
  const { store, posts } = await studio(t, { preset: 'quarantined' });
  assert.equal(await store.disconnect(), null, 'allowed while the studio is in review: it is not a studio write');
  assert.deepEqual(posts().map((call) => call.path), ['/api/session/logout']);
  assert.equal(store.getState().pending['session:disconnect'], undefined);

  const port = new FixturePort();
  const refusing = { get closed() { return port.closed; }, events: port.events.bind(port), request: (path, options) => (path === '/api/session/logout' ? Promise.reject(new ApiError('NETWORK_ERROR')) : port.request(path, options)) };
  const kept = new StudioStore({ client: refusing, storage: null, newKey: () => 'k' });
  await kept.start();
  t.after(() => { kept.stop(); port.close(); });
  assert.equal(await kept.disconnect(), 'NETWORK_ERROR');
  assert.ok(kept.getState().snapshot, 'the page stays as it was');
});

test('Disconnect on a session that had already ended counts as disconnected, not as an error', async (t) => {
  for (const code of ['AUTH_REQUIRED', 'SESSION_CLOSED']) {
    const port = new FixturePort();
    const ended = { get closed() { return port.closed; }, events: port.events.bind(port), request: (path, options) => (path === '/api/session/logout' ? Promise.reject(new ApiError(code, code === 'AUTH_REQUIRED' ? 403 : 0)) : port.request(path, options)) };
    const store = new StudioStore({ client: ended, storage: null, newKey: () => 'k' });
    await store.start();
    t.after(() => { store.stop(); port.close(); });
    assert.equal(await store.disconnect(), null, code);
    assert.equal(store.getState().pending['session:disconnect'], undefined, code);
  }
  // A refusal of another kind is still said.
  const port = new FixturePort();
  const refusing = { get closed() { return port.closed; }, events: port.events.bind(port), request: (path, options) => (path === '/api/session/logout' ? Promise.reject(new ApiError('CSRF_DENIED', 403)) : port.request(path, options)) };
  const store = new StudioStore({ client: refusing, storage: null, newKey: () => 'k' });
  await store.start();
  t.after(() => { store.stop(); port.close(); });
  assert.equal(await store.disconnect(), 'CSRF_DENIED');
});
