import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changedWhen, filmSeconds, filmsView, openViewFor, pickerProjects, renameValue, runningJobs, sameProjects, FILM_NAME_MAX, TICKS_MAX,
} from '../../src/next/model/start.ts';
import { lastFerryOverview } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const now = new Date(2026, 9, 15, 15, 30);
const at = (days, h, m) => new Date(2026, 9, 15 - days, h, m).toISOString();
const item = (over) => ({ id: 'p', name: 'Film', archived: false, scenes: 1, shots: 2, seconds: 10, videosReady: 0, updatedAt: at(0, 10, 44), ...over });

test('the last change reads today, yesterday, a date, or a date with its year', () => {
  assert.deepEqual(changedWhen(at(0, 10, 44), now, 'en'), { kind: 'today', time: '10:44' });
  assert.deepEqual(changedWhen(at(1, 18, 10), now, 'en'), { kind: 'yesterday', time: '18:10' });
  assert.deepEqual(changedWhen(at(6, 9, 0), now, 'en'), { kind: 'date', date: '9 Oct' });
  assert.deepEqual(changedWhen(at(6, 9, 0), now, 'zh-CN'), { kind: 'date', date: '10月9日' });
  assert.deepEqual(changedWhen(new Date(2025, 9, 9).toISOString(), now, 'en'), { kind: 'date', date: '9 Oct 2025' });
  // The server's "never" (the epoch) and garbage say nothing rather than 1970.
  assert.equal(changedWhen(new Date(0).toISOString(), now, 'en'), null);
  assert.equal(changedWhen('not a date', now, 'en'), null);
});

test('a row shows only list-item facts: counts, length, change, clips made', () => {
  const view = filmsView([
    item({ id: 'p1', name: 'The Last Ferry', scenes: 3, shots: 8, seconds: 48, videosReady: 3 }),
    item({ id: 'p3', name: 'Night bus', updatedAt: at(6, 21, 5) }),
  ], 'p1', now, 'en');
  const [ferry, bus] = view.live;
  assert.equal(en(ferry.meta), '3 scenes · 8 shots · 48 s · changed today 10:44');
  assert.equal(zh(ferry.meta), '3 场 · 8 个镜头 · 48 秒 · 今天 10:44 修改');
  assert.equal(en(ferry.progress), '3 of 8 clips made');
  assert.equal(zh(ferry.progress), '已生成 3/8 段视频');
  assert.deepEqual(ferry.ticks, [true, true, true, false, false, false, false, false]);
  assert.equal(ferry.current, true);
  assert.equal(ferry.openTo, 'keyframes');
  assert.equal(en(bus.meta), '1 scene · 2 shots · 10 s · changed 9 Oct');
  assert.equal(bus.current, false);
  assert.equal(en(view.count), '2 films on this computer');
  assert.equal(zh(view.count), '本机有 2 部影片');
  assert.equal(view.firstRun, false);
});

test('newest change first; archived films sit apart and do not count', () => {
  const view = filmsView([
    item({ id: 'old', name: 'Old', updatedAt: at(9, 9, 0) }),
    item({ id: 'arch', name: 'Lighthouse test', archived: true, shots: 1 }),
    item({ id: 'new', name: 'New', updatedAt: at(0, 9, 0) }),
  ], null, now, 'en');
  assert.deepEqual(view.live.map(r => r.id), ['new', 'old']);
  assert.deepEqual(view.archived.map(r => r.id), ['arch']);
  assert.equal(en(view.archived[0].meta), '1 shot · archived · its media stays on this computer');
  assert.equal(en(view.count), '2 films on this computer');
});

test('an empty film opens on its Plan, says it has no shots, and draws no meter', () => {
  const [row] = filmsView([item({ shots: 0, scenes: 0, seconds: 0 })], null, now, 'en').live;
  assert.equal(row.openTo, 'plan');
  assert.equal(en(row.progress), 'No shots yet');
  assert.equal(row.ticks, null);
  assert.equal(openViewFor({ shots: 3 }), 'keyframes');
  assert.equal(en(row.meta), '0 scenes · 0 shots · 0 s · changed today 10:44');
});

test('long films keep the words but drop the meter; clips made never exceed shots', () => {
  const [row] = filmsView([item({ shots: TICKS_MAX + 1, videosReady: 99 })], null, now, 'en').live;
  assert.equal(row.ticks, null);
  assert.equal(en(row.progress), `${TICKS_MAX + 1} of ${TICKS_MAX + 1} clips made`);
});

test('no live films is the first run, even with archived ones', () => {
  assert.equal(filmsView([], null, now, 'en').firstRun, true);
  assert.equal(filmsView([item({ archived: true })], null, now, 'en').firstRun, true);
  assert.equal(en(filmsView([], null, now, 'en').count), '0 films on this computer');
});

test('film length has one decimal at most', () => {
  assert.equal(filmSeconds(48, 'en'), '48');
  assert.equal(filmSeconds(15.53, 'en'), '15.5');
  assert.equal(filmSeconds(1234, 'en'), '1,234');
  assert.equal(filmSeconds(-1, 'en'), '0');
});

test('the top bar picker lists live films and keeps the open film after it is archived', () => {
  const items = [item({ id: 'a', name: 'A', updatedAt: at(0, 9, 0) }), item({ id: 'b', name: 'B', archived: true }), item({ id: 'c', name: 'C', archived: true })];
  assert.deepEqual(pickerProjects(items, 'a').map(p => p.id), ['a']);
  assert.deepEqual(pickerProjects(items, 'b').map(p => p.id).sort(), ['a', 'b']);
  assert.equal(sameProjects([{ id: 'a', name: 'A' }], [{ id: 'a', name: 'A' }]), true);
  assert.equal(sameProjects([{ id: 'a', name: 'A' }], [{ id: 'a', name: 'A2' }]), false);
  assert.equal(sameProjects([], [{ id: 'a', name: 'A' }]), false);
});

test('a rename is sent only when it changes the name and fits', () => {
  assert.equal(renameValue('  Night bus 2 ', 'Night bus'), 'Night bus 2');
  assert.equal(renameValue('Night bus', 'Night bus'), null);
  assert.equal(renameValue('   ', 'Night bus'), null);
  assert.equal(renameValue('x'.repeat(FILM_NAME_MAX + 1), 'Night bus'), null);
});

test('running jobs are counted from the open film’s overview', () => {
  const overview = lastFerryOverview();
  assert.equal(runningJobs(overview), 0);
  assert.equal(runningJobs(null), 0);
  const shots = { ...overview.shots };
  shots['shot-3-1'] = { ...shots['shot-3-1'], keyframe: { state: 'running', takeCount: 0, opened: false } };
  shots['shot-3-2'] = { ...shots['shot-3-2'], keyframe: { state: 'no_answer', takeCount: 0, opened: false }, narration: { state: 'making', text: 'x', fits: true } };
  shots['shot-2-1'] = { ...shots['shot-2-1'], video: { state: 'queued', takeCount: 0 } };
  assert.equal(runningJobs({ ...overview, shots }), 4);
});
