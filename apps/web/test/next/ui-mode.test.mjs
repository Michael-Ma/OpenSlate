import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUiMode, UI_MODE_KEY } from '../../src/shared/ui-mode.ts';

const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), map }; };

test('ui mode defaults to classic and remembers an explicit choice', () => {
  const storage = memory();
  assert.equal(resolveUiMode('', storage), 'classic');
  assert.equal(resolveUiMode('?ui=next', storage), 'next');
  assert.equal(storage.map.get(UI_MODE_KEY), 'next');
  assert.equal(resolveUiMode('', storage), 'next');
  assert.equal(resolveUiMode('?ui=classic', storage), 'classic');
  assert.equal(resolveUiMode('?ui=bogus', storage), 'classic');
});

test('ui mode works without storage', () => {
  assert.equal(resolveUiMode('?ui=next', null), 'next');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(resolveUiMode('?ui=next', throwing), 'next');
  assert.equal(resolveUiMode('', throwing), 'classic');
});
