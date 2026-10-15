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
