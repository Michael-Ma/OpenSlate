import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLocalDraft,
  discardUnreadableLocalDrafts,
  isDraftText,
  localDraftNotice,
  readLocalDraft,
  writeLocalDraft,
} from '../src/local-draft-cache.ts';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

const area = new MemoryStorage();
globalThis.window = { localStorage: area, addEventListener() {} };
const namespace = () => crypto.randomUUID();

test('local drafts are scoped by identity, project and field with a stable base', () => {
  const owner = namespace();
  assert.equal(writeLocalDraft(owner, 'film-a', 'chat', 'unsent', { revision: 3 }, null).status, 'saved');
  assert.equal(readLocalDraft(owner, 'film-a', 'chat', isDraftText)?.value, 'unsent');
  assert.deepEqual(readLocalDraft(owner, 'film-a', 'chat', isDraftText)?.base, { revision: 3 });
  assert.equal(readLocalDraft(owner, 'film-b', 'chat', isDraftText), null);
  assert.equal(readLocalDraft(namespace(), 'film-a', 'chat', isDraftText), null);
  assert.equal(readLocalDraft(owner, 'film-a', 'settings:models', isDraftText), null);
});

test('a stale writer cannot replace a newer revision or clear it', () => {
  const owner = namespace();
  const first = writeLocalDraft(owner, 'film', 'chat', 'first', null, null);
  assert.equal(first.status, 'saved');
  const second = writeLocalDraft(owner, 'film', 'chat', 'second', null, first.revision);
  assert.equal(second.status, 'saved');
  assert.equal(writeLocalDraft(owner, 'film', 'chat', 'stale', null, first.revision).status, 'conflict');
  assert.equal(clearLocalDraft(owner, 'film', 'chat', first.revision), 'conflict');
  assert.equal(readLocalDraft(owner, 'film', 'chat', isDraftText)?.value, 'second');
});

test('expired drafts are pruned and can be replaced, while malformed drafts require explicit discard', () => {
  const owner = namespace();
  writeLocalDraft(owner, 'film', 'chat', 'old', null, null);
  const id = [...area.values.keys()].find(key => key.includes(encodeURIComponent(owner))) ;
  const expired = JSON.parse(area.getItem(id));
  expired.expiresAt = Date.now() - 1;
  area.setItem(id, JSON.stringify(expired));
  assert.equal(readLocalDraft(owner, 'film', 'chat', isDraftText), null);
  assert.equal(writeLocalDraft(owner, 'film', 'chat', 'new', null, null).status, 'saved');
  area.setItem(id, '{broken');
  assert.equal(writeLocalDraft(owner, 'film', 'chat', 'third', null, null).status, 'conflict');
  assert.match(localDraftNotice(), /could not be read/);
  discardUnreadableLocalDrafts(owner);
  assert.equal(writeLocalDraft(owner, 'film', 'chat', 'third', null, null).status, 'saved');
  const validEnvelope = JSON.parse(area.getItem(id));
  validEnvelope.value = { unexpected: 'shape' };
  area.setItem(id, JSON.stringify(validEnvelope));
  assert.equal(readLocalDraft(owner, 'film', 'chat', isDraftText), null);
  discardUnreadableLocalDrafts(owner);
  assert.equal(area.getItem(id), null);
});

test('namespace record budget refuses growth without deleting another project draft', () => {
  const owner = namespace();
  for (let index = 0; index < 128; index++)
    assert.equal(writeLocalDraft(owner, `film-${index % 2}`, `field-${index}`, 'draft', null, null).status, 'saved');
  assert.equal(writeLocalDraft(owner, 'film-0', 'field-extra', 'draft', null, null).status, 'unavailable');
  assert.equal(readLocalDraft(owner, 'film-1', 'field-1', isDraftText)?.value, 'draft');
});

test('storage errors leave the in-memory caller free to continue', () => {
  const previous = globalThis.window.localStorage;
  globalThis.window.localStorage = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); },
    get length() { return 0; },
  };
  assert.equal(writeLocalDraft(namespace(), 'film', 'chat', 'text', null, null).status, 'unavailable');
  assert.match(localDraftNotice(), /unavailable/);
  globalThis.window.localStorage = previous;
});
