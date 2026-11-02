import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from '../../node_modules/vite/dist/node/index.js';
import { answerPress, choiceCard, CEILING_PRESS, declaredPlan, retryPress, runStrip, stepRows, threadChoices, TONE_CLASS, TONE_GLYPH } from '../../src/next/model/code-plan.ts';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';
import { formatMicros } from '../../src/next/model/price.ts';

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
    setCodePlanCeiling: (current, body) => { calls.push(['raise', current.ceilingMicros, body]); return Promise.resolve(undefined); },
    unconfirmed,
  };
}

// The card's one piece of state is which option's large view is open: `comparing` sets it, and setting it is recorded.
async function choiceCards({ locale = 'en', guard = { disabled: false, title: undefined }, s = store(), codePlan = { view: null }, comparing = null, developer = true } = {}) {
  return load('ChoiceCards.tsx', ['CodePlanChoiceCard', 'CodePlanChoiceGroup', 'useCodePlanChoices', 'ChoiceCompare'], {
    useState: (initial) => [comparing ?? initial, (value) => s.calls.push(['comparing', value])],
    useDeveloperMode: () => developer,
    useNaturalAspect: () => ({ aspect: null, onDecoded() {}, style: undefined }),
    Modal: ({ className, labelledBy, children }) => React.createElement('dialog', { className, 'aria-labelledby': labelledBy, open: true }, children),
    useI18n: () => i18n(locale),
    Picture: ({ artifact, alt }) => React.createElement('img', { 'data-artifact': artifact.artifactId, alt }),
    answerPress, threadChoices, formatMicros,
    useGuarded: () => ({ ...guard, 'data-needs': 'server' }),
    CodePlanMedia: ({ children }) => React.createElement('div', { 'data-media': 'code-plan' }, children),
    useStore: () => s,
    useStudio: (select) => select({ pending: s.pending }),
    useCodePlan: () => codePlan,
  });
}

const frames = { choiceId: 'frame-1.1', optionsDigest: 'd1', question: 'Which frame should 1.1 start from?', options: [ref('a1'), ref('a2'), ref('a3')] };

const keyframe = (overrides = {}) => ({ choiceId: '1.1-keyframe', optionsDigest: 'k1', question: 'The harbour at dusk', options: [
  { ...ref('kf'), keyframeInput: 'keyframe_and_references', references: [ref('sheet')], priceMicros: '400000' },
  { ...ref('kf'), keyframeInput: 'references_only', references: [ref('sheet')], priceMicros: '400000' },
  { ...ref('kf'), keyframeInput: 'first_frame', references: [ref('sheet')], priceMicros: '240000' },
], ...overrides });

test('a keyframe to confirm shows one picture and the priced ways to use it, the first as the default', async () => {
  const card = choiceCard(keyframe());
  assert.equal(card.keyframe.artifactId, 'kf');
  assert.equal(card.media, false, 'these are not pictures to compare');
  assert.deepEqual(card.options.map(option => [option.keyframe.input, option.keyframe.priceMicros, option.artifact]),
    [['keyframe_and_references', '400000', null], ['references_only', '400000', null], ['first_frame', '240000', null]]);
  const { CodePlanChoiceCard } = await choiceCards();
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card }));
  assert.match(html, /Confirm the keyframe/);
  assert.match(html, /The harbour at dusk/);
  assert.deepEqual([...html.matchAll(/data-artifact="([^"]+)"/g)].map((m) => m[1]), ['kf'], 'the picture appears once');
  assert.deepEqual([...html.matchAll(/data-input="([^"]+)"/g)].map((m) => m[1]), ['keyframe_and_references', 'references_only', 'first_frame']);
  assert.equal((html.match(/class="cp-input primary"/g) ?? []).length, 1);
  for (const words of ['Keyframe and references', 'References only', 'Keyframe as first frame', '\\$0\\.40', '\\$0\\.24', 'tell the Director']) assert.match(html, new RegExp(words));
  assert.doesNotMatch(html, /Compare larger/);
});

test('a confirmed keyframe keeps the picture and says how the clip used it', async () => {
  const waiting = keyframe();
  const card = choiceCard({ ...waiting, answer: waiting.options[2], answeredAt: '2026-11-01T10:00:00.000Z' });
  const { CodePlanChoiceCard } = await choiceCards();
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card }));
  assert.match(html, /Keyframe confirmed/);
  assert.equal(card.chosen, 2);
  assert.match(html, /class="cp-input chosen"[^>]*data-input="first_frame"/);
  assert.doesNotMatch(html, /tell the Director/);
});

test('a retired card is one quiet line: its picture still opens, and nothing can be chosen', async () => {
  const { CodePlanChoiceCard } = await choiceCards({ locale: 'zh-CN' });
  const card = choiceCard(keyframe({ askedAt: '2026-10-29T10:37:00Z', stale: true }));
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card }));
  assert.match(html, /class="cp-choice retired"[^>]*data-stale="true"/);
  assert.match(html, /已失效：它依赖的内容改了/);
  assert.match(html, /The harbour at dusk/);
  assert.match(html, /data-act="code-plan-retired-look"/);
  assert.match(html, /data-artifact="kf"/);
  assert.doesNotMatch(html, /data-act="code-plan-choose"/);
  assert.doesNotMatch(html, /tell the Director|告诉导演/);
});

test('a keyframe made without references is not offered as "and references"', async () => {
  const { CodePlanChoiceCard } = await choiceCards();
  const card = choiceCard(keyframe({ options: [{ ...ref('kf'), keyframeInput: 'keyframe_and_references', references: [], priceMicros: '400000' }] }));
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card }));
  assert.doesNotMatch(html, /Keyframe and references/);
  assert.match(html, />Keyframe</);
});

test('a waiting choice: amber card, the question, three thumbnails through the code-plan media, each opening the large view', async () => {
  const { CodePlanChoiceGroup } = await choiceCards();
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceGroup, { cards: [choiceCard(frames)] }));
  assert.match(html, /data-media="code-plan"/);
  assert.match(html, /class="cp-choice" data-choice="frame-1.1" data-answered="false"/);
  assert.match(html, /The plan asks/);
  assert.match(html, /Which frame should 1\.1 start from\?/);
  assert.equal((html.match(/class="cp-thumb"/g) ?? []).length, 3);
  assert.deepEqual([...html.matchAll(/data-artifact="([^"]+)"/g)].map((m) => m[1]), ['a1', 'a2', 'a3']);
  assert.deepEqual([...html.matchAll(/aria-label="(See [^"]+)"/g)].map((m) => m[1]), ['See Option 1 larger to choose', 'See Option 2 larger to choose', 'See Option 3 larger to choose']);
  assert.equal((html.match(/data-act="code-plan-look"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /data-act="code-plan-choose"/, 'a media choice is never made by one press on a thumbnail');
  assert.doesNotMatch(html, /disabled/);
  assert.match(html, /priced in Code/);
  const plain = await choiceCards({ developer: false });
  assert.match(renderToStaticMarkup(React.createElement(plain.CodePlanChoiceCard, { card: choiceCard(frames) })), /counts toward the spend limit/);
});

test('an answered choice marks the chosen option white; its thumbnails still open larger', async () => {
  const { CodePlanChoiceCard } = await choiceCards({ locale: 'zh-CN' });
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card: choiceCard({ ...frames, answer: ref('a2'), answeredAt: '2026-10-29T10:38:00Z' }) }));
  assert.match(html, /class="cp-choice done"/);
  assert.match(html, /你已选择/);
  assert.equal((html.match(/class="cp-thumb chosen"/g) ?? []).length, 1);
  assert.match(html, /aria-label="放大查看选项 2"/);
  assert.match(html, /✓ 已选/);
  assert.doesNotMatch(html, /disabled=""/);
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

test('offline (the write guard) turns the Choose buttons off and says why; looking still works', async () => {
  const { CodePlanChoiceCard } = await choiceCards({ guard: { disabled: true, title: 'Can’t reach the studio.' }, comparing: 0 });
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card: choiceCard(frames) }));
  assert.equal((html.match(/data-act="code-plan-choose"[^>]*disabled=""/g) ?? []).length, 3);
  assert.equal((html.match(/data-act="code-plan-look"[^>]*disabled=""/g) ?? []).length, 0);
  assert.match(html, /title="Can’t reach the studio\."/);
});

async function runStripComponent({ locale = 'en', codePlan, s = store(), guard = { disabled: false, title: undefined } }) {
  return (await load('RunStrip.tsx', ['CodePlanRunStrip'], {
    useI18n: () => i18n(locale),
    numberLocale: (l) => (l === 'zh-CN' ? 'zh-CN' : 'en-US'),
    CEILING_PRESS, runStrip, TONE_CLASS, TONE_GLYPH, useState: (initial) => [initial, () => {}], LimitEditor: () => null,
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

const pressables = (tree) => {
  const found = [];
  const walk = (node) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return; } if (node.props?.['data-act']) found.push(node); walk(node.props?.children); };
  walk(tree);
  return found;
};

test('a media choice opens large from Compare larger or a thumbnail (that option first); text choices have neither', async () => {
  const s = store();
  const { CodePlanChoiceCard } = await choiceCards({ s });
  const presses = pressables(CodePlanChoiceCard({ card: choiceCard(frames) }));
  presses.find((node) => node.props['data-act'] === 'code-plan-compare').props.onClick();
  presses.filter((node) => node.props['data-act'] === 'code-plan-look')[2].props.onClick();
  assert.deepEqual(s.calls, [['comparing', 0], ['comparing', 2]]);
  const chips = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card: choiceCard({ choiceId: 'tone', optionsDigest: 'd2', question: 'Which tone?', options: ['Warm', 'Cold'] }) }));
  assert.doesNotMatch(chips, /Compare larger/);
});

test('the comparison shows each option large with its own Choose; choosing answers once and closes it', async () => {
  const s = store();
  const { CodePlanChoiceCard, ChoiceCompare } = await choiceCards({ s, comparing: 1 });
  const card = choiceCard(frames);
  const html = renderToStaticMarkup(React.createElement(CodePlanChoiceCard, { card }));
  assert.match(html, /<dialog class="cp-compare" aria-labelledby="cp-compare-frame-1\.1" open="">/);
  assert.match(html, /<h2 id="cp-compare-frame-1\.1">Which frame should 1\.1 start from\?<\/h2>/);
  assert.equal((html.match(/class="cp-compare-item"/g) ?? []).length, 3);
  assert.deepEqual([...html.matchAll(/class="pill sm primary"[^>]*>(Choose [^<]+)</g)].map((m) => m[1]), ['Choose Option 1', 'Choose Option 2', 'Choose Option 3']);
  // Focus starts on the pressed option's Choose.
  assert.match(html, /data-option="1" data-autofocus="true"/);
  assert.equal((html.match(/data-autofocus="true"/g) ?? []).length, 1);
  // Choosing in the dialog is the thumbnail's own answer, then the dialog closes.
  const tree = CodePlanChoiceCard({ card });
  let compare = null;
  const walk = (node) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return; } if (node.type === ChoiceCompare) compare = node; walk(node.props?.children); };
  walk(tree);
  compare.props.onChoose(card.options[1]);
  assert.deepEqual(s.calls, [['answer', 'frame-1.1', ref('a2')], ['comparing', null]]);
  // Its Choose buttons carry each option.
  const picks = [];
  const buttons = pressables(ChoiceCompare({ card, focus: 0, off: false, offTitle: undefined, onChoose: (option) => picks.push(option.index), onClose() {} }))
    .filter((node) => node.props['data-act'] === 'code-plan-choose');
  buttons[2].props.onClick();
  assert.deepEqual(picks, [2]);
});

test('an answered choice compares read only: its pick is marked and nothing can be chosen', async () => {
  const { ChoiceCompare } = await choiceCards({ locale: 'zh-CN' });
  const card = choiceCard({ ...frames, answer: ref('a3'), answeredAt: '2026-10-29T10:38:00Z' });
  const html = renderToStaticMarkup(React.createElement(ChoiceCompare, { card, focus: 0, off: true, offTitle: undefined, onChoose() {}, onClose() {} }));
  assert.equal((html.match(/class="cp-compare-item chosen"/g) ?? []).length, 1);
  assert.match(html, /✓ 已选/);
  assert.doesNotMatch(html, /data-act="code-plan-choose"/);
  assert.match(html, /data-act="code-plan-compare-close"[^>]*>关闭/);
});

test('a render step is named "Film render", not "No prompt"; other unlabelled steps keep "No prompt"', async () => {
  const { stepLabel } = await load('parts.tsx', ['stepLabel'], { useI18n: () => i18n('en') });
  const t = i18n('en').t;
  assert.equal(stepLabel({ kind: 'render', label: '' }, t), 'Film render');
  assert.equal(stepLabel({ kind: 'image', label: '' }, t), 'No prompt');
  assert.equal(stepLabel({ kind: 'render', label: 'Final cut' }, t), 'Final cut');
  assert.equal(stepLabel({ kind: 'render', label: '' }, i18n('zh-CN').t), '影片渲染');
});

test('Plan before the first pass ends says the plan is running, not that it declares nothing', async () => {
  const parts = await load('parts.tsx', ['ViewHead', 'ViewMessage', 'StepCard', 'StepStatus', 'stepLabel'], { useI18n: () => i18n('en') });
  const plan = async (codePlan) => (await load('CodePlanViews.tsx', ['CodePlanPlanView'], {
    useI18n: () => i18n('en'), useCodePlan: () => ({ error: null, loading: false, reload() {}, ...codePlan }), declaredPlan, useDeveloperMode: () => false, useState: React.useState, MediaViewer: () => null,
    CodePlanMedia: ({ children }) => React.createElement('div', null, children), ...parts,
  })).CodePlanPlanView;
  const Running = await plan({ view: view({ planVersion: 1, state: 'running', lastPassAt: null }) });
  assert.match(renderToStaticMarkup(React.createElement(Running)), /The plan is running\. Its scenes and shots appear when it reaches them\./);
  const Empty = await plan({ view: view({ planVersion: 1, state: 'done', lastPassAt: '2026-10-29T22:45:40Z' }) });
  assert.match(renderToStaticMarkup(React.createElement(Empty)), /This version declares no scenes or shots\./);
});

test('a failed step says what happened in plain words; Retry asks first when it may charge again, then retries', async () => {
  const calls = [];
  const parts = async (asking = false, pending = {}) => load('parts.tsx', ['StepProblemNote', 'StepCard', 'stepStatus', 'stepLabel'], {
    useI18n: () => i18n('en'), retryPress,
    useState: (initial) => [asking || initial, (value) => calls.push(['asking', value])],
    useStore: () => ({ retryCodePlanStep: (row) => { calls.push(['retry', row.key, row.attempts]); return Promise.resolve(undefined); } }),
    useGuarded: () => ({ disabled: false, title: undefined }),
    useStudio: (select) => select({ pending }),
    Modal: ({ className, labelledBy, children }) => React.createElement('dialog', { className, 'aria-labelledby': labelledBy, open: true }, children),
  });
  const plan = view({ steps: [{ key: 'clip', kind: 'video', state: 'failed', model: 'viggle', label: 'Push in on Tofu', priceMicros: '100000', reached: true, updatedAt: '2026-10-30T07:11:14Z', error: { code: 'SUBMISSION_RESPONSE_LOST', mayHaveCharged: true, retry: 'consent' } }] });
  const row = stepRows(plan, ['video'], 'en-US').current[0];
  const { StepProblemNote, stepStatus } = await parts();
  const html = renderToStaticMarkup(React.createElement(StepProblemNote, { row }));
  assert.match(html, /did not answer when this was sent/);
  assert.match(html, /It may already have cost \$0\.10\./);
  assert.match(html, /may charge again/);
  assert.match(html, /data-act="code-plan-retry"[^>]*>Retry</);
  assert.equal(stepStatus(row).id, 'codeplan.step.failed', 'the chip says Failed; the code is in its tooltip');
  // Retry opens the confirm; the confirm retries.
  const press = (tree, act) => { let found = null; const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) { n.forEach(walk); return; } if (n.props?.['data-act'] === act) found = n; walk(n.props?.children); }; walk(tree); return found; };
  press(StepProblemNote({ row }), 'code-plan-retry').props.onClick();
  assert.deepEqual(calls, [['asking', true]]);
  const open = await parts(true);
  const dialog = renderToStaticMarkup(React.createElement(open.StepProblemNote, { row }));
  assert.match(dialog, /Retry Push in on Tofu\?/);
  assert.match(dialog, /about \$0\.10\)\. The first try may also have been charged/);
  press(open.StepProblemNote({ row }), 'code-plan-retry-confirm').props.onClick();
  assert.deepEqual(calls.slice(1), [['asking', false], ['retry', 'clip', 1]]);
  // A safe failure retries at once; a refused one offers no Retry.
  calls.length = 0;
  const safeRow = stepRows(view({ steps: [{ ...plan.steps[0], error: { code: 'CONNECT_REFUSED', mayHaveCharged: false, retry: 'safe' } }] }), ['video'], 'en-US').current[0];
  press(StepProblemNote({ row: safeRow }), 'code-plan-retry').props.onClick();
  assert.deepEqual(calls, [['asking', false], ['retry', 'clip', 1]]);
  const refused = stepRows(view({ steps: [{ ...plan.steps[0], error: { code: 'MODERATION_REFUSED', retry: 'none' } }] }), ['video'], 'en-US').current[0];
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(StepProblemNote, { row: refused })), /code-plan-retry/);
  const sending = await parts(false, { [retryPress(row).pressId]: true });
  assert.match(renderToStaticMarkup(React.createElement(sending.StepProblemNote, { row })), /aria-busy="true"[^>]*disabled=""[^>]*>Retrying…/);
});

test('the spend limit is changed in the run strip', async () => {
  const Strip = await runStripComponent({ codePlan: { view: view({ state: 'done' }) } });
  const html = renderToStaticMarkup(React.createElement(Strip));
  assert.match(html, /data-act="code-plan-limit-open"/);
  assert.match(html, />Change<\/button>/);
});
