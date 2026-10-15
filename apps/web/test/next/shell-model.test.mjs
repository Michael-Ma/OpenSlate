import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classicHref, codeSegments, connectionPill, escClosesDrawer, filmHeading, isDesignedView, otherLocale,
  pauseCountdown, resumeCountdown, searchWithLocale, showProjectPicker, startCountdown, tabKeyTarget,
  toastLifetime, viewTabs, TOAST_INFO_MS, TOAST_RESUME_MIN_MS,
} from '../../src/next/model/shell.ts';
import { lastFerryOverview } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);

test('the tab row lists the four views in order; Keyframes and Assets are designed', () => {
  const tabs = viewTabs('keyframes');
  assert.deepEqual(tabs.map(t => [t.view, t.selected, t.classic]),
    [['plan', false, true], ['keyframes', true, false], ['assets', false, false], ['film', false, true]]);
  assert.deepEqual(viewTabs('film').filter(t => t.selected).map(t => t.view), ['film']);
  assert.equal(isDesignedView('keyframes'), true);
  assert.equal(isDesignedView('assets'), true);
  assert.equal(isDesignedView('plan'), false);
});

test('arrow keys move focus around the tab row and wrap', () => {
  assert.equal(tabKeyTarget('ArrowRight', 1, 4), 2);
  assert.equal(tabKeyTarget('ArrowRight', 3, 4), 0);
  assert.equal(tabKeyTarget('ArrowLeft', 0, 4), 3);
  assert.equal(tabKeyTarget('Home', 2, 4), 0);
  assert.equal(tabKeyTarget('End', 0, 4), 3);
  assert.equal(tabKeyTarget('Enter', 0, 4), null);
  assert.equal(tabKeyTarget('ArrowRight', 0, 0), null);
});

test('the classic link opens the matching classic view, keeps the language and drops the sample film', () => {
  assert.equal(classicHref('?ui=next&fixture=last-ferry', 'plan'), '?ui=classic&view=plan');
  assert.equal(classicHref('', 'keyframes'), '?ui=classic&view=frames');
  assert.equal(classicHref('?lang=zh-CN&ui=next', 'film'), '?lang=zh-CN&ui=classic&view=cut');
  assert.equal(classicHref('?view=cut', 'assets'), '?view=assets&ui=classic');
});

test('switching language flips between English and Chinese and updates an explicit ?lang', () => {
  assert.equal(otherLocale('en'), 'zh-CN');
  assert.equal(otherLocale('zh-CN'), 'en');
  assert.equal(searchWithLocale('?ui=next', 'zh-CN'), null);
  assert.equal(searchWithLocale('?lang=en&ui=next', 'zh-CN'), '?lang=zh-CN&ui=next');
});

test('the connection pill says Saved locally only while connected', () => {
  assert.deepEqual([en(connectionPill('connected').label), connectionPill('connected').tone], ['Saved locally', 'ok']);
  assert.equal(en(connectionPill('reconnecting').label), 'Reconnecting…');
  assert.equal(zh(connectionPill('reconnecting').label), '正在重新连接…');
  assert.equal(en(connectionPill('connecting').label), 'Connecting…');
  assert.equal(connectionPill('connecting').tone, 'waiting');
});

test('the film heading names the film and reads duration, frame rate and counts from the overview', () => {
  const overview = lastFerryOverview();
  const heading = filmHeading('The Last Ferry', [], overview.projectId, overview);
  assert.equal(heading.title, 'The Last Ferry');
  assert.equal(en(heading.meta), '48 s · 30 fps');
  assert.equal(zh(heading.meta), '48 秒 · 30 帧/秒');
  assert.equal(en(heading.counts), '3 scenes · 8 shots');
  assert.equal(zh(heading.counts), '3 场 · 8 个镜头');
});

test('the film heading falls back to the project list while the snapshot loads', () => {
  const projects = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
  assert.deepEqual(filmHeading(undefined, projects, 'b', null), { title: 'Beta', meta: null, counts: null });
  assert.equal(filmHeading(undefined, projects, 'missing', null).title, '');
  assert.equal(showProjectPicker(projects), true);
  assert.equal(showProjectPicker(projects.slice(0, 1)), false);
});

test('info toasts leave after about six seconds; errors stay', () => {
  assert.equal(toastLifetime({ tone: 'info' }), TOAST_INFO_MS);
  assert.equal(TOAST_INFO_MS, 6000);
  assert.equal(toastLifetime({ tone: 'error' }), null);
});

test('hovering or focusing a toast pauses its countdown and leaving gives it time again', () => {
  let c = startCountdown(6000, 1000);
  c = pauseCountdown(c, 2500);
  assert.deepEqual(c, { remaining: 4500, since: null });
  assert.deepEqual(pauseCountdown(c, 9999), c, 'pausing twice changes nothing');
  c = resumeCountdown(c, 50000);
  assert.deepEqual(c, { remaining: 4500, since: 50000 });
  assert.deepEqual(resumeCountdown(c, 60000), c, 'resuming twice changes nothing');
  // Nearly expired when hovered: it still stays a moment after the pointer leaves.
  const late = pauseCountdown(startCountdown(6000, 0), 5900);
  assert.equal(resumeCountdown(late, 7000).remaining, TOAST_RESUME_MIN_MS);
  assert.equal(pauseCountdown(startCountdown(6000, 0), 9000).remaining, 0);
});

test('Esc closes the drawer only when it is open on a narrow screen and nothing inside used the key', () => {
  const esc = { key: 'Escape', defaultPrevented: false };
  assert.equal(escClosesDrawer(esc, true, true), true);
  assert.equal(escClosesDrawer(esc, false, true), false);
  assert.equal(escClosesDrawer(esc, true, false), false);
  assert.equal(escClosesDrawer({ key: 'Escape', defaultPrevented: true }, true, true), false);
  assert.equal(escClosesDrawer({ key: 'Enter', defaultPrevented: false }, true, true), false);
});

test('backticks in a message mark code', () => {
  assert.deepEqual(codeSegments('Open the link that `pnpm studio` printed.'),
    [{ text: 'Open the link that ', code: false }, { text: 'pnpm studio', code: true }, { text: ' printed.', code: false }]);
  assert.deepEqual(codeSegments('No code here'), [{ text: 'No code here', code: false }]);
  assert.deepEqual(codeSegments('An `unpaired tick'), [{ text: 'An `unpaired tick', code: false }]);
  assert.deepEqual(codeSegments(''), []);
});
