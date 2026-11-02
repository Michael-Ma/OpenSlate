import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview } from '../../src/next/fixtures/last-ferry.ts';
import { assetLibrary, compareAssets, roleCounts, titleMsg, useMsg, ALL_ASSETS } from '../../src/next/model/assets.ts';
import { translate } from '../../src/next/i18n/translate.ts';

const overview = lastFerryOverview();
const en = (m) => translate('en', m.id, m.values);
const zh = (m) => translate('zh-CN', m.id, m.values);
const sheet = (take, current) => ({ artifact: { artifactId: `sheet-${take}`, sha256: `${'a'.repeat(63)}${take}`, kind: 'image' }, role: 'character_sheet',
  characterId: 'mara', takeIndex: take, current, source: 'generated', label: 'Mara', createdAt: '2026-10-15T10:00:00' });

test('a character sheet is titled by its character and take in both languages', () => {
  assert.equal(en(titleMsg(sheet(2, true), overview)), 'Mara · character sheet · take 2');
  assert.equal(zh(titleMsg(sheet(2, true), overview)), 'Mara · 角色设定图 · 版本 2');
  assert.equal(en(titleMsg({ ...sheet(1, false), takeIndex: undefined }, overview)), 'Character sheet');
  assert.equal(en(useMsg(sheet(1, true)).label), en(useMsg({ role: 'upload', current: true }).label));
});

test('sheets count under All without a filter of their own and sort after every other role', () => {
  const upload = { artifact: { artifactId: 'up', sha256: 'f'.repeat(64), kind: 'image' }, role: 'upload', current: false, source: 'imported', label: 'x', createdAt: '2026-10-15T09:00:00' };
  const counts = roleCounts([sheet(1, false), upload]);
  assert.equal(counts.all, 2);
  assert.equal(counts.upload, 1);
  assert.ok(Object.values(counts).every(Number.isFinite));
  assert.deepEqual([sheet(1, false), upload].sort(compareAssets).map((i) => i.role), ['upload', 'character_sheet']);
  assert.ok(assetLibrary([sheet(1, false)], overview, ALL_ASSETS));
});
