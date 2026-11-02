import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformWithOxc } from '../../node_modules/vite/dist/node/index.js';
import { lastFerryOverview, lastFerrySnapshot, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { actionLine, planOutline, shotDeleteIssue } from '../../src/next/model/plan.ts';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';
import { fixtureRoute } from '../../src/next/fixtures/routes/index.ts';

const fresh = () => lastFerryOverview().shots[shotId('1.1')];
const blocked = { id: 'error.ATTEMPTS_RUNNING' };

test('W1 deletion keeps running and unanswered image, clip, replacement and voice work reachable', () => {
  for (const medium of ['keyframe', 'video']) {
    for (const state of ['running', 'no_answer']) {
      const shot = fresh();
      shot[medium] = { ...shot[medium], state, attemptId: 'pending-attempt' };
      assert.deepEqual(shotDeleteIssue(shot), blocked, `${medium} ${state}`);
      shot[medium] = { ...fresh()[medium], replacement: { state, attemptId: 'replacement-attempt' } };
      assert.deepEqual(shotDeleteIssue(shot), blocked, `${medium} retained ${state}`);
    }
  }
  for (const state of ['making', 'no_answer']) {
    const shot = fresh();
    shot.narration = { ...shot.narration, state };
    assert.deepEqual(shotDeleteIssue(shot), blocked, `voice ${state}`);
  }
});

test('W1 deletion becomes available after settlement and permits unsent review or stopped work', () => {
  const shot = fresh();
  for (const state of ['none', 'ready', 'failed', 'outdated']) {
    shot.video = { state, takeCount: 1 };
    assert.equal(shotDeleteIssue(shot), null, state);
  }
  for (const code of ['review', 'stopped']) {
    shot.video = { state: 'queued', waiting: { code, since: '' }, takeCount: 0 };
    assert.equal(shotDeleteIssue(shot), null, code);
  }
  shot.video = { ...fresh().video, replacement: { state: 'failed' } };
  assert.equal(shotDeleteIssue(shot), null);
});

// Evaluate the actual JSX component with inert element/hook adapters; no browser or server is started.
const Menu = () => {};
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
const i18n = (locale) => ({ locale, t: (id, values) => translate(locale, id, values), tm: (message) => translateMsg(locale, message) });
const source = readFileSync(new URL('../../src/next/views/plan/ShotRow.tsx', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const { code } = await transformWithOxc(source, 'ShotRow.tsx', { jsx: { runtime: 'classic' } });
const loadRow = (locale) => runInNewContext(`${code}\n;ShotRow;`, {
  React: { createElement: jsx }, Menu, Picture: () => {}, actionLine,
  useId: () => 'prompts', useState: (value) => [value, () => {}], useI18n: () => i18n(locale),
});
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  return (Array.isArray(node) ? node : node.props?.children ?? []).map((child) => find(child, predicate)).find(Boolean) ?? null;
};

test('W1 the actual shot menu disables only Delete for pending work with the localized reason', () => {
  for (const locale of ['en', 'zh-CN']) {
    const overview = lastFerryOverview();
    const shot = overview.shots[shotId('1.2')];
    shot.video = { ...shot.video, replacement: { state: 'no_answer', attemptId: 'uncertain' } };
    const row = planOutline(lastFerrySnapshot(), overview).scenes[0].shots[1];
    assert.deepEqual(row.deleteIssue, blocked);
    const render = () => loadRow(locale)({ row, busy: false, canMoveScene: true, drop: {} });
    let menu = find(render(), (node) => node.type === Menu);
    let deletion = menu.props.items.find((item) => item.act === 'delete-shot');
    assert.equal(deletion.disabled, true);
    assert.equal(deletion.title, translateMsg(locale, blocked));
    assert.equal(menu.props.items.find((item) => item.act === 'shot-earlier').disabled, false, 'other edits remain available');
    row.deleteIssue = null;
    menu = find(render(), (node) => node.type === Menu);
    deletion = menu.props.items.find((item) => item.act === 'delete-shot');
    assert.equal(deletion.disabled, false);
    assert.equal(deletion.title, undefined);
  }
});

test('W1 a stale fixture delete press refuses pending work and preserves its attempt and media', () => {
  for (const pending of [
    (shot) => { shot.keyframe.state = 'running'; shot.keyframe.attemptId = 'image-run'; },
    (shot) => { shot.video.state = 'no_answer'; shot.video.attemptId = 'uncertain'; },
    (shot) => { shot.video.replacement = { state: 'running', attemptId: 'replacement' }; },
    (shot) => { shot.narration.state = 'making'; },
  ]) {
    const world = {
      overview: lastFerryOverview(), snapshot: lastFerrySnapshot(),
      update(change) { change(world); }, later() {},
    };
    const id = shotId('1.1');
    pending(world.overview.shots[id]);
    const before = structuredClone({ overview: world.overview, snapshot: world.snapshot });
    assert.throws(() => fixtureRoute(world, 'POST', '/storyboard', {
      kind: 'deleteShot', id, expectedHeadVersion: world.snapshot.project.headVersion,
    }), (error) => error.code === 'ATTEMPTS_RUNNING');
    assert.deepEqual({ overview: world.overview, snapshot: world.snapshot }, before);
  }
});
