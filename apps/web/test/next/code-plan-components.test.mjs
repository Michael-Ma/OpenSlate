import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from '../../node_modules/vite/dist/node/index.js';
import { answerPress, choiceCard, CEILING_PRESS, runStrip, threadChoices } from '../../src/next/model/code-plan.ts';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';

/**
 * The code-plan cards rendered as the page renders them: each component file is compiled on its own (imports dropped)
 * and given the model, real React and small stand-ins for the store, i18n and pictures.
 */
async function load(file, names, scope) {
  const source = readFileSync(new URL(`../../src/next/codeplan/${file}`, import.meta.url), 'utf8')
    .replace(/^import [^;]*;\n/gm, '').replace(/^export /gm, '');
  const { code } = await transformWithOxc(source, file, { lang: 'tsx', jsx: { runtime: 'classic' } });
  return runInNewContext(`${code}\n;({ ${names.join(', ')} });`, { React, useMemo: React.useMemo, ...scope });
}

const i18n = (locale) => ({ locale, t: (id, values) => translate(locale, id, values), tm: (m) => translateMsg(locale, m) });
const sha = (c) => c.repeat(64);
const ref = (id) => ({ artifactId: id, sha256: sha('a'), kind: 'image' });
const view = (overrides) => ({ projectId: 'p', planVersion: 2, state: 'waiting', held: false, ceilingMicros: '1000000', spentMicros: '240000', reservedMicros: '0', declarations: { scenes: [], shots: [] }, steps: [], choices: [], versions: [], logs: [], lastPassAt: null, ...overrides });

function store(pending = {}, unconfirmed = () => false) {
  const calls = [];
  return {
    calls,
    pending,
    answerCodePlanChoice: (choice, answer) => { calls.push(['answer', choice.choiceId, answer]); return Promise.resolve(undefined); },
    raiseCodePlanCeiling: (current, body) => { calls.push(['raise', current.ceilingMicros, body]); return Promise.resolve(undefined); },
    unconfirmed,
  };
}

async function choiceCards({ locale = 'en', guard = { disabled: false, title: undefined }, s = store(), codePlan = { view: null } } = {}) {
  return load('ChoiceCards.tsx', ['CodePlanChoiceCard', 'CodePlanChoiceGroup', 'useCodePlanChoices'], {
    useI18n: () => i18n(locale),
    Picture: ({ artifact, alt }) => React.createElement('img', { 'data-artifact': artifact.artifactId, alt }),
    answerPress, threadChoices,
    useGuarded: () => ({ ...guard, 'data-needs': 'server' }),
    CodePlanMedia: ({ children }) => React.createElement('div', { 'data-media': 'code-plan' }, children),
    useStore: () => s,
    useStudio: (select) => select({ pending: s.pending }),
    useCodePlan: () => codePlan,
  });
}

const frames = { choiceId: 'frame-1.1', optionsDigest: 'd1', question: 'Which frame should 1.1 start from?', options: [ref('a1'), ref('a2'), ref('a3')] };

test('a waiting choice: amber card, the question, three thumbnails through the code-plan media, each a press', async () => {
  const { CodePlanChoiceGroup } = await choiceCards();
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceGroup, { cards: [choiceCard(frames)] }));
  assert.match(html, /data-media="code-plan"/);
  assert.match(html, /class="cp-choice" data-choice="frame-1.1" data-answered="false"/);
  assert.match(html, /The plan asks/);
  assert.match(html, /Which frame should 1\.1 start from\?/);
  assert.equal((html.match(/class="cp-thumb"/g) ?? []).length, 3);
  assert.deepEqual([...html.matchAll(/data-artifact="([^"]+)"/g)].map((m) => m[1]), ['a1', 'a2', 'a3']);
  assert.deepEqual([...html.matchAll(/aria-label="(Choose [^"]+)"/g)].map((m) => m[1]), ['Choose Option 1', 'Choose Option 2', 'Choose Option 3']);
  assert.doesNotMatch(html, /disabled/);
  assert.match(html, /priced in Code/);
});

test('an answered choice marks the chosen option white and turns the others off', async () => {
  const { CodePlanChoiceCard } = await choiceCards({ locale: 'zh-CN' });
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card: choiceCard({ ...frames, answer: ref('a2'), answeredAt: '2026-10-29T10:38:00Z' }) }));
  assert.match(html, /class="cp-choice done"/);
  assert.match(html, /你已选择/);
  assert.equal((html.match(/class="cp-thumb chosen"/g) ?? []).length, 1);
  assert.match(html, /aria-label="选项 2，已选"/);
  assert.match(html, /✓ 已选/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
});

test('text options are chips; pressing one sends that exact value once, and a lost reply says to press it again', async () => {
  const card = choiceCard({ choiceId: 'tone', optionsDigest: 'd2', question: 'Which tone?', options: ['Warm', { label: 'Cold', grade: 'teal' }] });
  const s = store();
  const { CodePlanChoiceCard } = await choiceCards({ s });
  // Shallow: call the component and press its buttons directly.
  const tree = CodePlanChoiceCard({ card });
  const buttons = [];
  const walk = (node) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return; } if (node.type === 'button') buttons.push(node); walk(node.props?.children); };
  walk(tree);
  assert.deepEqual(buttons.map((b) => b.props.className), ['pill sm cp-chip', 'pill sm cp-chip']);
  buttons[1].props.onClick();
  assert.deepEqual(s.calls, [['answer', 'tone', { label: 'Cold', grade: 'teal' }]]);

  const lost = await choiceCards({ s: store({}, (id) => id === 'codeplan:choice:tone') });
  assert.match(renderToStaticMarkup(React.createElement(lost.CodePlanChoiceCard, { card })), /Not confirmed\. Press the same option again/);
  const sending = await choiceCards({ s: store({ 'codeplan:choice:tone': true }) });
  const busy = renderToStaticMarkup(React.createElement(sending.CodePlanChoiceCard, { card }));
  assert.match(busy, /Sending your choice/);
  assert.equal((busy.match(/disabled=""/g) ?? []).length, 2);
});

test('offline (the write guard) turns the options off and says why', async () => {
  const { CodePlanChoiceCard } = await choiceCards({ guard: { disabled: true, title: 'Can’t reach the studio.' } });
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card: choiceCard(frames) }));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
  assert.match(html, /title="Can’t reach the studio\."/);
});

async function runStripComponent({ locale = 'en', codePlan, s = store(), guard = { disabled: false, title: undefined } }) {
  return (await load('RunStrip.tsx', ['CodePlanRunStrip'], {
    useI18n: () => i18n(locale),
    numberLocale: (l) => (l === 'zh-CN' ? 'zh-CN' : 'en-US'),
    CEILING_PRESS, runStrip,
    useGuarded: () => ({ ...guard, 'data-needs': 'run' }),
    useStore: () => s,
    useStudio: (select) => select({ pending: s.pending }),
    useCodePlan: () => ({ reload() {}, error: null, loading: false, ...codePlan }),
  })).CodePlanRunStrip;
}

test('the run strip: state chip, version, spend with pending money, and the held line', async () => {
  const Strip = await runStripComponent({ codePlan: { view: view({ state: 'running', reservedMicros: '570000', held: true }) } });
  const html = renderToStaticMarkup(React.createElement(Strip));
  assert.match(html, /data-state="running" data-held="true"/);
  assert.match(html, /class="status busy"[^>]*data-run="running"><i class="cp-spin"[^>]*><\/i>Running/);
  assert.match(html, /Version 2/);
  assert.match(html, /Spent \$0\.24 \(\+\$0\.57 pending\) of \$1\.00/);
  assert.match(html, /The Director is updating the plan/);
  assert.doesNotMatch(html, /code-plan-raise/);
});

test('paused at the ceiling the strip offers +$1 (white, primary) and raising sends the next ceiling', async () => {
  const s = store();
  const paused = view({ state: 'paused_budget', spentMicros: '810000' });
  const Strip = await runStripComponent({ codePlan: { view: paused }, s, locale: 'zh-CN' });
  const html = renderToStaticMarkup(React.createElement(Strip));
  assert.match(html, /已到花费上限，暂停/);
  assert.match(html, /下一个付费步骤会超过 \$1\.00 的上限/);
  assert.match(html, /class="pill sm primary" data-act="code-plan-raise"[^>]*>把上限提高到 \$2\.00/);
  const tree = Strip();
  let raise = null;
  const walk = (node) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return; } if (node.props?.['data-act'] === 'code-plan-raise') raise = node; walk(node.props?.children); };
  walk(tree);
  raise.props.onClick();
  assert.deepEqual(s.calls, [['raise', '1000000', { ceilingMicros: '2000000' }]]);
  const busy = await runStripComponent({ codePlan: { view: paused }, s: store({ [CEILING_PRESS]: true }) });
  assert.match(renderToStaticMarkup(React.createElement(busy)), /aria-busy="true"/);
});

test('an error is said plainly with the pass’s own message; an unreadable run offers Read again', async () => {
  const Strip = await runStripComponent({ codePlan: { view: view({ state: 'error', error: { message: 'TypeError: <x> is undefined' } }) } });
  const html = renderToStaticMarkup(React.createElement(Strip));
  assert.match(html, /role="alert"/);
  assert.match(html, /The plan stopped with an error/);
  assert.match(html, /<pre class="cp-error-text">TypeError: &lt;x&gt; is undefined<\/pre>/, 'escaped text, never markup');
  const Unread = await runStripComponent({ codePlan: { view: null, error: 'NETWORK_ERROR' } });
  const unread = renderToStaticMarkup(React.createElement(Unread));
  assert.match(unread, /could not be read \(NETWORK_ERROR\)/);
  assert.match(unread, /data-act="code-plan-reload"/);
  const Nothing = await runStripComponent({ codePlan: { view: null } });
  assert.equal(renderToStaticMarkup(React.createElement(Nothing)), '');
});
