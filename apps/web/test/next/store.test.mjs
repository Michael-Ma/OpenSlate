import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { shotId, sceneId } from '../../src/next/fixtures/last-ferry.ts';
import { LIBRARY_KEY } from '../../src/next/store/press-keys.ts';
import { reducer } from '../../src/next/store/reducer.ts';
import { initialState } from '../../src/next/store/state.ts';
import { StudioStore } from '../../src/next/store/store.ts';

function memoryStorage() {
  const items = new Map();
  return { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, String(v)), removeItem: (k) => items.delete(k) };
}

async function studio(t, options = {}) {
  const port = new FixturePort();
  let n = 0;
  const store = new StudioStore({ client: options.client?.(port) ?? port, storage: options.storage ?? null, newKey: () => `key-${++n}` });
  if (options.start !== false) await store.start();
  t.after(() => { store.stop(); port.close(); });
  return { port, store };
}

test('a shot opened from elsewhere is selected with a new nonce each time, so a view reacts to the same one twice', () => {
  const overview = new FixturePort().world.overview;
  let state = { ...initialState, projectId: 'last-ferry', overview };
  state = reducer(state, { type: 'focus', kind: 'shot', id: shotId('2.2') });
  assert.deepEqual([state.shotId, state.sceneId, state.focus], [shotId('2.2'), sceneId(2), { kind: 'shot', id: shotId('2.2'), nonce: 1 }]);
  state = reducer(state, { type: 'focus', kind: 'shot', id: shotId('2.2') });
  assert.equal(state.focus.nonce, 2);
  state = reducer(state, { type: 'focus', kind: 'scene', id: sceneId(3) });
  assert.deepEqual([state.sceneId, state.shotId, state.focus.kind, state.focus.nonce], [sceneId(3), shotId('3.1'), 'scene', 3]);
  // Another film forgets it.
  assert.equal(reducer(state, { type: 'project', projectId: 'night-bus' }).focus, null);
});

test('with no film open, presses are kept under the library namespace; a film keeps its own', async (t) => {
  const storage = memoryStorage();
  // The reply is lost: the press stays saved so a second press resends the same key.
  const { store } = await studio(t, {
    start: false, storage,
    client: (port) => ({ get closed() { return port.closed; }, events: port.events.bind(port), async request(path, options) { if (options?.method === 'POST') throw new TypeError('lost'); return port.request(path, options); } }),
  });
  assert.equal(store.getState().projectId, null);
  assert.equal(await store.command('start:create', { name: 'X' }, () => ({ path: '/api/projects', body: { name: 'X' } })), undefined);
  assert.deepEqual(Object.keys(JSON.parse(storage.items.get(LIBRARY_KEY))), ['start:create']);
});

test('a toast can carry an Undo callback; only the latest one runs, once', async (t) => {
  const { store } = await studio(t);
  const ran = [];
  store.toastUndo({ id: 'toast.saved' }, () => ran.push('first'));
  const first = store.getState().toast;
  store.toastUndo({ id: 'toast.saved' }, () => ran.push('second'));
  const second = store.getState().toast;
  assert.ok(second.undoKey && second.undoKey !== first.undoKey);
  store.undoToast(first);
  assert.deepEqual(ran, [], 'a replaced toast\'s Undo is gone');
  store.undoToast(second);
  store.undoToast(second);
  assert.deepEqual(ran, ['second']);
  assert.equal(store.getState().toast, null);
});

test('another view can open Assets on one kind of file', async (t) => {
  const { store } = await studio(t);
  store.openAssets('export');
  assert.deepEqual([store.getState().view, store.getState().assetsFilter], ['assets', { role: 'export' }]);
  store.dispatch({ type: 'assetsFilter', role: null });
  assert.equal(store.getState().assetsFilter, null);
});

test('a setup refusal keeps bounded Codex version details in the error toast', async t => {
  const { ApiError } = await import('../../src/next/api/client.ts');
  const details = { expectedVersion: '0.153.4', foundVersion: '0.162.0-alpha.4', binaryPath: '/opt/selected-codex', installPath: '/opt/openslate-codex' };
  const { store } = await studio(t, { client: port => ({ get closed() { return port.closed; }, events: port.events.bind(port),
    async request(path, options) { if (options?.method === 'POST') throw new ApiError('DIRECTOR_CODEX_VERSION_MISMATCH', 409, details); return port.request(path, options); } }) });
  assert.equal(await store.command('settings:director', {}, () => ({ path: '/api/projects/last-ferry/director/setup', body: {} })), undefined);
  assert.deepEqual(store.getState().toast.message, { id: 'error.DIRECTOR_CODEX_VERSION_DETAILS', values: details });
});
