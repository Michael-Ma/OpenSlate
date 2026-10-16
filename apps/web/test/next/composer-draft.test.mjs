import test from 'node:test';
import assert from 'node:assert/strict';
import { watchComposerDraft } from '../../src/next/director/composer-draft.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { draftKey, readDraft } from '../../src/next/model/director.ts';
import { carryFrom, parseStoredCarry, storedCarry } from '../../src/next/model/shell-states.ts';
import { StudioStore } from '../../src/next/store/store.ts';

function memoryStorage() {
  const items = new Map();
  return { items, getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key) };
}

async function studio(t) {
  const port = new FixturePort();
  const store = new StudioStore({ client: port, storage: null, newKey: () => 'draft-test' });
  await store.start();
  t.after(() => { store.stop(); port.close(); });
  return store;
}

const mount = (t, store, storage, relinquished = new Set(), mode = 'live') => {
  const off = watchComposerDraft(store, storage, mode, relinquished, () => {});
  t.after(off);
  return off;
};
const text = store => store.getState().composer.text;
const picture = { source: 'upload', shotId: null, artifactId: 'uploaded-fog', sha256: 'a'.repeat(64), name: 'Fog reference' };

test('a relinquished origin stays empty through refresh and watcher remount after another tab takes its draft', async t => {
  const storage = memoryStorage();
  const old = await studio(t);
  const off = mount(t, old, storage);
  old.setComposerText('Unsent draft about the fog');
  old.restoreDraft({ text: text(old), targets: [{ kind: 'shot', id: 'shot-2-2' }], images: [picture] });
  const projectId = old.getState().projectId;
  const carry = carryFrom(old.getState());
  off();
  // Disconnect shared this carry, so only the session that takes it may restore the shared draft.
  const relinquished = new Set([projectId]);
  const receiver = await studio(t);
  mount(t, receiver, storage);
  assert.equal(text(receiver), carry.text);
  assert.deepEqual(receiver.getState().composer.images, [picture], 'the receiving tab keeps picture references too');
  receiver.setComposerText('Unsent draft about the fog, with a lamp');
  const saved = storage.getItem(draftKey(projectId));

  const origin = await studio(t);
  const stop = mount(t, origin, storage, relinquished);
  assert.equal(text(origin), '', 'no second copy from the per-film cache');
  await origin.refresh();
  assert.equal(text(origin), '');
  origin.dispatch({ type: 'composerSending', sending: false });
  assert.equal(storage.getItem(draftKey(projectId)), saved, 'empty origin cannot erase the receiving tab\'s draft');
  stop();
  mount(t, origin, storage, relinquished);
  assert.equal(text(origin), '', 'remount does not forget the relinquished project');
  assert.equal(storage.getItem(draftKey(projectId)), saved);
  const reloadedReceiver = await studio(t);
  mount(t, reloadedReceiver, storage);
  assert.equal(text(reloadedReceiver), 'Unsent draft about the fog, with a lamp', 'the receiver still survives reload');
});

test('an explicit unconsumed carry restores words when the per-film cache is unavailable', async t => {
  const old = await studio(t);
  old.setComposerText('Keep the fog low');
  const carry = parseStoredCarry(storedCarry(carryFrom(old.getState()), 1000), 1000);
  const next = await studio(t);
  const relinquished = new Set([carry.projectId]);
  mount(t, next, null, relinquished);
  assert.equal(text(next), '');
  // The explicit carry is applied by the shell after the same film is read.
  next.setComposerText(carry.text);
  for (const target of carry.targets) next.pointAt(target);
  assert.equal(text(next), 'Keep the fog low');
  assert.equal(relinquished.has(carry.projectId), false, 'a draft in this composer belongs to this window again');
});

test('taking its own unconsumed carry also restores cached pictures and chips', async t => {
  const storage = memoryStorage();
  const old = await studio(t);
  mount(t, old, storage);
  old.restoreDraft({ text: 'Keep this fog', targets: [{ kind: 'shot', id: 'shot-2-2' }], images: [picture] });
  const carry = parseStoredCarry(storedCarry(carryFrom(old.getState()), 1000), 1000);
  const relinquished = new Set([carry.projectId]);
  // boot removes this exclusion only when this window actually takes the stored handover.
  relinquished.delete(carry.projectId);
  const next = await studio(t);
  mount(t, next, storage, relinquished);
  assert.deepEqual(next.getState().composer.images, [picture]);
  assert.deepEqual(next.getState().composer.targets, [{ kind: 'shot', id: 'shot-2-2' }]);
  assert.equal(text(next), 'Keep this fog');
});

test('ordinary reload and per-film switching restore drafts, while sample drafts keep a separate key', async t => {
  const storage = memoryStorage();
  const first = await studio(t);
  mount(t, first, storage);
  first.setComposerText('A quiet harbour');
  const projectId = first.getState().projectId;
  const reloaded = await studio(t);
  mount(t, reloaded, storage);
  assert.equal(text(reloaded), 'A quiet harbour');
  reloaded.dispatch({ type: 'project', projectId: 'another-film' });
  reloaded.setComposerText('A different film');
  reloaded.dispatch({ type: 'project', projectId });
  assert.equal(text(reloaded), 'A quiet harbour');
  reloaded.dispatch({ type: 'project', projectId: 'another-film' });
  assert.equal(text(reloaded), 'A different film');
  const fixture = await studio(t);
  mount(t, fixture, storage, new Set(), 'fixture');
  assert.equal(text(fixture), '');
  fixture.setComposerText('Sample only');
  assert.equal(readDraft(storage.getItem(draftKey(projectId, 'fixture'))).text, 'Sample only');
  assert.equal(readDraft(storage.getItem(draftKey(projectId))).text, 'A quiet harbour');
});

test('new origin words end the exclusion and retain normal per-film draft restoration', async t => {
  const storage = memoryStorage();
  const store = await studio(t);
  const projectId = store.getState().projectId;
  storage.setItem(draftKey(projectId), JSON.stringify({ text: 'Other tab\'s draft', targets: [], images: [] }));
  const relinquished = new Set([projectId]);
  mount(t, store, storage, relinquished);
  store.setComposerText('A new message from this window');
  assert.equal(relinquished.has(projectId), false);
  store.dispatch({ type: 'project', projectId: 'another-film' });
  store.dispatch({ type: 'project', projectId });
  assert.equal(text(store), 'A new message from this window');
  store.setComposerText('');
  assert.equal(storage.getItem(draftKey(projectId)), null, 'emptying one\'s own draft still removes it');
});

test('unreadable, full or unavailable storage keeps the in-memory composer working', async t => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  for (const storage of [null, blocked]) {
    const store = await studio(t);
    mount(t, store, storage);
    assert.equal(text(store), '');
    assert.doesNotThrow(() => store.setComposerText('Still here'));
    assert.equal(text(store), 'Still here');
    assert.doesNotThrow(() => store.setComposerText(''));
    assert.equal(text(store), '');
  }
});
