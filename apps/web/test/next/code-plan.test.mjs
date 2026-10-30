import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { CODE_FILM_ID, CODE_STEP_MS } from '../../src/next/fixtures/routes/code-plan.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { ApiError } from '../../src/next/api/client.ts';
import { artifactContentPath, codePlanArtifactContentPath, codePlanVersionPath, CODE_PLAN_PATH } from '../../src/next/api/code-plan.ts';
import {
  answerPress, artifactRefOf, attentionViews, ceilingPress, changeBlocks, choiceCard, codePlanAttentionItems, codePlanHeading, declaredPlan, diffCounts, diffSummary,
  findingMsg, isCodeProject, latestRender, lineDiff, needsAttention, optionArtifact, optionLabel, placeByTime, previousVersion, problemCause, retryPress, runStrip,
  sourcePress, stepProblem, stepRows, threadChoices, versionRows,
} from '../../src/next/model/code-plan.ts';
import { DEVELOPER_STORAGE_KEY, readDeveloperMode, setDeveloperMode } from '../../src/next/app/useDeveloperMode.ts';
import { createBody, planningStep, stepFits } from '../../src/next/model/start-new.ts';
import { runCreation } from '../../src/next/model/start-commands.ts';
import { searchWithView, shownView, viewFromSearch, viewTabs } from '../../src/next/model/shell.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = (m) => translateMsg('en', m);
const zh = (m) => translateMsg('zh-CN', m);
const sha = (c) => c.repeat(64);
const ref = (id, kind = 'image', c = 'a') => ({ artifactId: id, sha256: sha(c), kind });

function view(overrides = {}) {
  return {
    projectId: 'film-1', planVersion: 2, state: 'waiting', held: false, ceilingMicros: '1000000', spentMicros: '240000', reservedMicros: '0',
    declarations: { scenes: [], shots: [] }, steps: [], choices: [], versions: [], logs: [], lastPassAt: '2026-10-29T10:00:00.000Z', ...overrides,
  };
}
const step = (key, kind, state, extra = {}) => ({ key, kind, state, model: kind === 'image' ? 'flux' : 'kling', label: `${key} label`, priceMicros: kind === 'render' ? '0' : '40000', reached: true, updatedAt: '2026-10-29T10:00:00.000Z', ...extra });

// ---- the project switch and routes ----

test('only a film whose snapshot says planMode "code" is a code-plan film', () => {
  const snapshot = (planMode) => ({ project: { id: 'p', ...(planMode ? { planMode } : {}) } });
  assert.equal(isCodeProject(snapshot('code'), 'p'), true);
  assert.equal(isCodeProject(snapshot('graph'), 'p'), false);
  assert.equal(isCodeProject(snapshot(undefined), 'p'), false, 'absent is graph (every older film)');
  assert.equal(isCodeProject(snapshot('code'), 'other'), false, 'another film’s snapshot never counts');
  assert.equal(isCodeProject(null, 'p'), false);
});

test('code-plan routes and the one media helper the lead can switch', () => {
  assert.equal(CODE_PLAN_PATH, '/code-plan');
  assert.equal(codePlanVersionPath(3), '/code-plan/versions/3');
  assert.equal(codePlanArtifactContentPath('a b', 'art/1'), '/api/projects/a%20b/artifacts/art%2F1/content');
  assert.equal(artifactContentPath('p', 'x'), '/api/projects/p/artifacts/x/content');
});

// ---- media and option words ----

test('media is read only from exact StudioArtifactRefs, alone or as an option’s artifact', () => {
  assert.deepEqual(artifactRefOf(ref('a1')), ref('a1'));
  assert.equal(artifactRefOf({ artifactId: 'a1', sha256: 'short', kind: 'image' }), null);
  assert.equal(artifactRefOf({ artifactId: 'a1', sha256: sha('a'), kind: 'pdf' }), null);
  assert.equal(artifactRefOf([ref('a1')]), null);
  assert.deepEqual(optionArtifact({ ok: true, artifact: ref('a2') }), ref('a2'), 'a ctx.image result');
  assert.deepEqual(optionArtifact({ label: 'Warm', artifact: ref('a3', 'video') }), ref('a3', 'video'));
  assert.equal(optionArtifact('Warm'), null);
  assert.equal(optionLabel('  Keep it  '), 'Keep it');
  assert.equal(optionLabel(3), '3');
  assert.equal(optionLabel({ label: 'Warm', artifact: ref('a3') }), 'Warm');
  assert.equal(optionLabel(ref('a1')), null, 'a bare media option is named by the card ("Option n")');
  assert.equal(optionLabel({ mood: 'calm' }), '{"mood":"calm"}');
  assert.equal(optionLabel('x'.repeat(300)).length, 200);
});

// ---- the run strip ----

test('the run strip says the state, the version and the spend, with pending money, in both languages', () => {
  const waiting = runStrip(view({ choices: [{ choiceId: 'c', optionsDigest: 'd', question: 'q', options: ['a'] }] }), 'en-US');
  assert.equal(en(waiting.status), 'Waiting for your choice');
  assert.equal(waiting.tone, 'attention');
  assert.equal(en(waiting.spend), 'Spent $0.24 of $1.00');
  assert.equal(waiting.raise, null);
  const results = runStrip(view(), 'en-US');
  assert.equal(en(results.status), 'Waiting for results');
  assert.equal(results.tone, 'plain');
  const running = runStrip(view({ state: 'running', reservedMicros: '570000', held: true }), 'zh-CN');
  assert.equal(running.tone, 'busy');
  assert.equal(running.held, true);
  assert.equal(zh(running.spend), '已花费 $0.24（另有 $0.57 待定），上限 $1.00');
  assert.deepEqual(running.meter, { spent: 0.24, reserved: 0.57 });
  assert.equal(en(runStrip(view({ state: 'done' }), 'en-US').status), 'Done');
  assert.equal(en(runStrip(view({ state: 'empty', planVersion: null }), 'en-US').status), 'No plan yet');
});

test('at the ceiling the strip offers one more dollar; an error is said in the pass’s own words', () => {
  const paused = runStrip(view({ state: 'paused_budget', spentMicros: '810000' }), 'en-US');
  assert.deepEqual(paused.raise.body, { ceilingMicros: '2000000' });
  assert.equal(en(paused.raise.label), 'Raise the limit to $2.00');
  assert.equal(paused.raise.ceiling, '$1.00');
  assert.equal(paused.tone, 'attention');
  const failed = runStrip(view({ state: 'error', error: { message: '  TypeError: x\n  at film (plan.ts:3:1) ' } }), 'en-US');
  assert.equal(failed.error, 'TypeError: x\n  at film (plan.ts:3:1)');
  assert.equal(en(failed.status), 'Stopped by an error');
  assert.equal(runStrip(view({ state: 'waiting', error: { message: 'old' } }), 'en-US').error, null, 'only state "error" shows it');
  assert.deepEqual(runStrip(view({ spentMicros: '5000000' }), 'en-US').meter.spent, 1, 'the meter never passes its end');
});

// ---- choices ----

test('a choice card finds the chosen option by value and lays media options out as thumbnails', () => {
  const options = [ref('a1'), ref('a2'), ref('a3')];
  const pending = choiceCard({ choiceId: 'frame-1.1', optionsDigest: 'd1', question: 'Which frame?', options });
  assert.deepEqual([pending.answered, pending.chosen, pending.media, pending.answeredAt], [false, null, true, null]);
  assert.deepEqual(pending.options.map((o) => o.label), [null, null, null]);
  // The server echoes the answer as JSON; key order does not matter.
  const answer = { sha256: sha('a'), kind: 'image', artifactId: 'a2' };
  const done = choiceCard({ choiceId: 'frame-1.1', optionsDigest: 'd1', question: 'Which frame?', options, answer, answeredAt: '2026-10-29T10:38:00.000Z' });
  assert.deepEqual([done.answered, done.chosen, done.answeredAt], [true, 1, '2026-10-29T10:38:00.000Z']);
  assert.deepEqual(done.options.map((o) => o.chosen), [false, true, false]);
  const mixed = choiceCard({ choiceId: 'tone', optionsDigest: 'd2', question: 'Tone?', options: ['Warm', ref('a4')] });
  assert.equal(mixed.media, false);
  assert.deepEqual(mixed.options.map((o) => [o.label, !!o.artifact]), [['Warm', false], [null, true]]);
  assert.equal(choiceCard({ choiceId: 'x', optionsDigest: 'd', question: 'q', options: [false, 0], answer: false }).chosen, 0, 'a falsy answer is still an answer');
});

test('the thread lists answered choices first, then the ones still waiting', () => {
  const choices = [
    { choiceId: 'b', optionsDigest: 'd', question: 'B?', options: ['x'] },
    { choiceId: 'a', optionsDigest: 'd', question: 'A?', options: ['x'], answer: 'x', answeredAt: '2026-10-29T10:00:00.000Z' },
  ];
  assert.deepEqual(threadChoices(view({ choices })).map((c) => c.choiceId), ['a', 'b']);
  assert.deepEqual(threadChoices(null), []);
});

test('answered choices sit before the first message written after them', () => {
  const entries = ['2026-10-29T10:30:00Z', null, '2026-10-29T10:36:00Z', '2026-10-29T10:40:00Z'];
  const items = [{ key: 'early', at: '2026-10-29T10:20:00Z' }, { key: 'mid', at: '2026-10-29T10:38:00Z' }, { key: 'late', at: '2026-10-29T11:00:00Z' }, { key: 'none', at: null }];
  const { before, after } = placeByTime(entries, items);
  assert.deepEqual(before.map((list) => list.map((item) => item.key)), [['early'], [], [], ['mid']]);
  assert.deepEqual(after.map((item) => item.key), ['late', 'none']);
});

test('each press has one identity: an answer per choice and option, the ceiling from its current value, the source by content', () => {
  const choice = { choiceId: 'frame-1.1', optionsDigest: 'd1' };
  const one = answerPress(choice, ref('a1')), again = answerPress(choice, { kind: 'image', artifactId: 'a1', sha256: sha('a') }), other = answerPress(choice, ref('a2'));
  assert.equal(one.pressId, 'codeplan:choice:frame-1.1');
  assert.deepEqual(one.logical, again.logical, 'the same answer is the same request, whatever its key order');
  assert.notDeepEqual(one.logical, other.logical);
  assert.deepEqual(one.body, { choiceId: 'frame-1.1', optionsDigest: 'd1', answer: ref('a1') });
  const ceiling = ceilingPress({ ceilingMicros: '1000000' }, { ceilingMicros: '2000000' });
  assert.deepEqual([ceiling.pressId, ceiling.logical], ['codeplan:ceiling', { from: '1000000', to: '2000000' }]);
  const a = sourcePress({ source: 'export default 1', basedOnVersion: 2 }), b = sourcePress({ source: 'export default 2', basedOnVersion: 2 });
  assert.equal(a.pressId, 'codeplan:source');
  assert.notDeepEqual(a.logical, b.logical);
  assert.equal(JSON.stringify(a.logical).includes('export default'), false, 'the source itself stays in the body only');
});

// ---- steps ----

test('steps split into the current plan and history, with budget waits and chosen frames marked', () => {
  const steps = [
    step('img-old', 'image', 'succeeded', { artifact: ref('old'), reached: false, updatedAt: '2026-10-29T09:00:00.000Z' }),
    step('img-1', 'image', 'succeeded', { artifact: ref('a1') }),
    step('img-2', 'image', 'in_flight'),
    step('img-cancel', 'image', 'cancelled', { reached: false, updatedAt: '2026-10-29T09:30:00.000Z' }),
    step('clip', 'video', 'absent', { priceMicros: '450000' }),
    step('img-bad', 'image', 'failed', { error: { code: 'PROVIDER_REFUSED' } }),
  ];
  const choices = [{ choiceId: 'c', optionsDigest: 'd', question: 'q', options: [ref('a1')], answer: ref('a1'), answeredAt: 'x' }];
  const images = stepRows(view({ steps, choices, state: 'paused_budget' }), ['image'], 'en-US');
  assert.deepEqual(images.current.map((r) => r.key), ['img-1', 'img-2', 'img-bad']);
  assert.deepEqual(images.history.map((r) => r.key), ['img-cancel', 'img-old'], 'history, newest first');
  assert.equal(images.current[0].chosen, true);
  assert.equal(en(images.current[0].price), 'about $0.04');
  assert.equal(images.current[1].artifact, null, 'no picture until it succeeded');
  assert.equal(images.current[1].tone, 'busy');
  assert.equal(images.current[2].error, 'PROVIDER_REFUSED');
  assert.equal(en(images.history[0].status), 'Not sent: no longer in the plan');
  const clip = stepRows(view({ steps, state: 'paused_budget' }), ['video'], 'en-US').current[0];
  assert.equal(en(clip.status), 'Waiting for a higher limit');
  assert.equal(stepRows(view({ steps, state: 'running' }), ['video'], 'en-US').current[0].status.id, 'codeplan.step.absent');
  assert.equal(stepRows(view({ steps: [step('r', 'render', 'succeeded', { artifact: ref('r', 'video') })] }), ['render'], 'en-US').current[0].price, null, 'a free render shows no price');
});

test('the film plays the newest succeeded render the plan still reaches', () => {
  const steps = [
    step('r-old', 'render', 'succeeded', { artifact: ref('r1', 'video'), updatedAt: '2026-10-29T12:00:00.000Z', reached: false }),
    step('r-new', 'render', 'succeeded', { artifact: ref('r2', 'video'), updatedAt: '2026-10-29T11:00:00.000Z' }),
    step('r-run', 'render', 'in_flight', { updatedAt: '2026-10-29T13:00:00.000Z' }),
  ];
  assert.equal(latestRender(view({ steps })).key, 'r-new');
  assert.equal(latestRender(view({ steps: steps.filter((s) => s.key === 'r-old') })).key, 'r-old', 'history when nothing reached is made');
  assert.equal(latestRender(view({ steps: [steps[2]] })), null);
});

// ---- declarations ----

test('Plan reads scenes and shots defensively, and finds each shot’s keyframe by its prompt', () => {
  const prompt = 'The empty harbour at dawn.';
  const plan = declaredPlan(view({
    declarations: {
      scenes: [{ id: 'harbour', title: 'Harbour at dawn', purpose: 'Mara waits.' }, { name: 'Untitled two' }, 'not an object'],
      shots: [
        { id: '1.1', scene: 'harbour', purpose: 'Open', framing: 'Wide', seconds: 5, prompt, motion: 'Pan' },
        { sceneId: 'harbour', title: 'Pier', duration: 4.25, imagePrompt: 'Mara on the pier.', narration: { text: 'She waits.' } },
        { scene: 'nowhere', description: 'Loose', seconds: -3 },
      ],
    },
    steps: [
      step('i1', 'image', 'succeeded', { label: prompt, artifact: ref('newest'), updatedAt: '2026-10-29T12:00:00.000Z' }),
      step('i2', 'image', 'succeeded', { label: prompt, artifact: ref('picked'), updatedAt: '2026-10-29T11:00:00.000Z' }),
    ],
    choices: [{ choiceId: 'c', optionsDigest: 'd', question: 'q', options: [ref('picked')], answer: ref('picked'), answeredAt: 'x' }],
  }));
  assert.deepEqual(plan.scenes.map((s) => [s.key, s.ordinal, s.title]), [['harbour', 1, 'Harbour at dawn'], ['scene-2', 2, 'Untitled two']]);
  const [open, pier] = plan.scenes[0].shots;
  assert.deepEqual([open.label, open.framing, open.seconds, open.motion], ['1.1', 'Wide', 5, 'Pan']);
  assert.equal(open.picture.artifactId, 'picked', 'the chosen frame wins over a newer one');
  assert.deepEqual([pier.label, pier.purpose, pier.seconds, pier.prompt, pier.narration, pier.picture], ['1.2', 'Pier', 4.3, 'Mara on the pier.', 'She waits.', null]);
  assert.deepEqual(plan.loose.map((s) => [s.label, s.purpose, s.seconds]), [['1', 'Loose', null]]);
  assert.deepEqual([plan.shotCount, plan.seconds], [3, 9.3]);
  const heading = codePlanHeading({ title: 'Harbour', meta: null, counts: null }, view({ declarations: { scenes: [{}], shots: [{}, {}] } }));
  assert.equal(en(heading.meta), 'Code plan · experimental');
  assert.equal(en(heading.counts), '1 scene · 2 shots');
  assert.equal(codePlanHeading({ title: 'x', meta: null, counts: null }, view({ planVersion: null })).counts, null);
});

// ---- versions and diffs ----

test('versions list newest first with their dry run in words, in both languages', () => {
  const diff = { reusedSteps: 4, newSteps: [{ kind: 'video', model: 'kling', label: 'Push in', priceMicros: '450000' }, { kind: 'render', model: 'ffmpeg', label: 'Film', priceMicros: '0' }], cancelledSteps: 1, certainMicros: '450000', dependsOnPending: true, findings: [{ code: 'UNAWAITED_CALL', detail: 'line 3' }, { code: 'NEW_THING' }] };
  const rows = versionRows(view({ planVersion: 2, versions: [
    { version: 1, author: 'director', sha256: sha('1'), createdAt: 'a', diff: { reusedSteps: 0, newSteps: [], cancelledSteps: 0, certainMicros: '0', dependsOnPending: false, findings: [] } },
    { version: 2, author: 'user', sha256: sha('2'), createdAt: 'b', diff },
  ] }), 'en-US');
  assert.deepEqual(rows.map((r) => [r.version, r.current]), [[2, true], [1, false]]);
  const [two, one] = rows;
  assert.equal(en(two.author), 'you');
  assert.equal(en(two.reused), '4 steps reused');
  assert.equal(en(two.newCost), '2 new steps · $0.45');
  assert.deepEqual(two.newSteps.map((s) => [en(s.kind), s.price && en(s.price)]), [['Clip', 'about $0.45'], ['Render', null]]);
  assert.equal(en(two.cancelled), '1 unsent step cancelled');
  assert.equal(en(two.certain), 'Certain cost $0.45; more depends on your choices and results');
  assert.deepEqual(two.findings.map((f) => [f.code, en(f.text), f.detail]), [['UNAWAITED_CALL', 'A studio call is not awaited', 'line 3'], ['NEW_THING', 'Finding NEW_THING', null]]);
  assert.equal(en(one.reused), 'No steps reused');
  assert.equal(one.newCost, null);
  assert.equal(one.cancelled, null);
  assert.equal(en(one.certain), 'Certain cost $0.00');
  assert.equal(zh(diffSummary(diff, 'zh-CN').reused), '复用 4 个步骤');
  assert.equal(zh(findingMsg('CEILING')), '会超过花费上限');
  assert.equal(previousVersion([{ version: 4 }, { version: 2 }, { version: 1 }], 4), 2);
  assert.equal(previousVersion([{ version: 1 }], 1), null);
  assert.equal(previousVersion([], null), null);
});

// ---- the line diff ----

test('a first version is plain lines; a change shows removed then added lines with both line numbers', () => {
  assert.deepEqual(lineDiff(null, 'a\nb\n'), [{ kind: 'same', text: 'a', before: null, after: 1 }, { kind: 'same', text: 'b', before: null, after: 2 }]);
  const lines = lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(lines.map((l) => [l.kind, l.text, l.before, l.after]), [
    ['same', 'a', 1, 1], ['removed', 'b', 2, null], ['added', 'B', null, 2], ['same', 'c', 3, 3], ['same', 'd', 4, 4], ['added', 'e', null, 5],
  ]);
  assert.deepEqual(diffCounts(lines), { added: 2, removed: 1 });
  assert.deepEqual(lineDiff('x\r\ny', 'x\ny').map((l) => l.kind), ['same', 'same'], 'line endings do not count as changes');
  assert.deepEqual(diffCounts(lineDiff('', 'one')), { added: 1, removed: 0 });
  // Too large to align: the changed middle shows as removed, then added, with the common ends matched.
  const big = (tag) => ['head', ...Array.from({ length: 2100 }, (_, i) => `${tag}${i}`), 'tail'].join('\n');
  const wide = lineDiff(big('old'), big('new'));
  assert.deepEqual([wide[0].kind, wide.at(-1).kind, diffCounts(wide).added, diffCounts(wide).removed], ['same', 'same', 2100, 2100]);
  assert.equal(wide.at(-1).before, 2102);
});

test('Changes folds unchanged runs beyond three lines of context', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
  const after = before.replace('line 10', 'line ten');
  const blocks = changeBlocks(lineDiff(before, after));
  assert.deepEqual(blocks.map((b) => (b.kind === 'skip' ? `skip ${b.count}` : `lines ${b.lines.length}`)), ['skip 6', 'lines 8', 'skip 7']);
  assert.deepEqual(changeBlocks(lineDiff(null, 'a\nb')), [{ kind: 'skip', count: 2 }], 'nothing changed: everything folds');
});

// ---- the start flow ----

test('the planning choice: storyboard stays the default and sends nothing new; a code plan sends planMode "code"', () => {
  assert.deepEqual(createBody('Night', null, 'Untitled'), { name: 'Night' });
  assert.deepEqual(createBody('Night', null, 'Untitled', 'graph'), { name: 'Night' });
  assert.deepEqual(createBody('Night', null, 'Untitled', 'code'), { name: 'Night', planMode: 'code' });
  const selection = { expectedCatalogDigest: 'e'.repeat(64), profileIds: ['p'] };
  assert.deepEqual(createBody('', { selection }, 'Untitled', 'code'), { name: 'Untitled', expectedCatalogDigest: 'e'.repeat(64), profileIds: ['p'], planMode: 'code' });
  assert.equal(stepFits('plan', 'code'), false, 'a written plan is read into a storyboard only');
  assert.equal(stepFits('plan', 'graph'), true);
  assert.equal(planningStep('plan', 'code', { state: 'found', model: 'm', setup: {} }), 'director');
  assert.equal(planningStep('plan', 'code', { state: 'not_found' }), 'empty');
  assert.equal(planningStep('empty', 'code', { state: 'found', model: 'm', setup: {} }), 'empty');
});

// ---- the shell ----

test('a code-plan film has a Code tab; a graph film never shows Code', () => {
  assert.deepEqual(viewTabs('plan').map((t) => t.view), ['plan', 'keyframes', 'assets', 'film']);
  assert.deepEqual(viewTabs('code', true).map((t) => [t.view, t.selected]), [['plan', false], ['keyframes', false], ['assets', false], ['film', false], ['code', true]]);
  assert.equal(en({ id: viewTabs('code', true)[4].label }), 'Code');
  const base = { view: 'code', projectId: 'p', projects: [{ id: 'p', name: 'P' }], connection: 'connected' };
  assert.equal(shownView({ ...base, snapshot: { project: { id: 'p' } } }), 'keyframes');
  assert.equal(shownView({ ...base, snapshot: { project: { id: 'p', planMode: 'code' } } }), 'code');
  assert.equal(shownView({ ...base, snapshot: null }), 'code', 'while the film loads the asked view is kept');
  assert.equal(viewFromSearch('?view=code'), 'code');
  assert.equal(searchWithView('?fixture=last-ferry', 'code'), '?fixture=last-ferry&view=code');
});

// ---- the store against the fixture studio ----

/** A port that records every request (path, method, key, body) before the fixture answers it. */
class Recording {
  constructor(port, fail = () => false) { this.port = port; this.fail = fail; this.sent = []; }
  get closed() { return this.port.closed; }
  async request(path, options = {}) {
    this.sent.push({ path, method: options.method ?? 'GET', key: options.key, body: options.body });
    if (this.fail(path, options)) throw new ApiError('NETWORK_ERROR');
    return this.port.request(path, options);
  }
  events(projectId, options) { return this.port.events(projectId, options); }
}

async function studio(t, search, fail) {
  if (search) globalThis.location = { search };
  const port = new FixturePort();
  const client = new Recording(port, fail);
  let n = 0;
  const store = new StudioStore({ client, storage: null, newKey: () => `key-${++n}` });
  await store.start();
  t.after(() => { store.stop(); port.close(); delete globalThis.location; });
  return { port, client, store };
}

test('a graph film never calls a code-plan route', async (t) => {
  const { store, client } = await studio(t);
  assert.equal(store.getState().projectId, 'last-ferry');
  assert.equal(await store.answerCodePlanChoice({ choiceId: 'c', optionsDigest: 'd' }, 'x'), undefined);
  assert.equal(await store.raiseCodePlanCeiling({ ceilingMicros: '1000000' }, { ceilingMicros: '2000000' }), undefined);
  assert.equal(await store.submitCodePlanSource({ source: 'x', basedOnVersion: null }), undefined);
  await assert.rejects(store.readCodePlan(), (error) => error.code === 'CODE_PLAN_MODE');
  await assert.rejects(store.readCodePlanSource(1), (error) => error.code === 'CODE_PLAN_MODE');
  assert.equal(client.sent.some((request) => request.path.includes('/code-plan')), false);
  // The fixture refuses them too, like the server does for a graph film.
  await assert.rejects(store.read('/code-plan'), (error) => error.code === 'CODE_PLAN_MODE' && error.status === 409);
});

test('?codeplan=waiting opens a code-plan film waiting on three keyframe thumbnails, with two versions', async (t) => {
  const { store } = await studio(t, '?codeplan=waiting');
  assert.equal(store.getState().projectId, CODE_FILM_ID);
  assert.equal(store.getState().snapshot.project.planMode, 'code');
  const plan = await store.readCodePlan();
  assert.deepEqual([plan.state, plan.planVersion, plan.spentMicros, plan.versions.map((v) => v.version)], ['waiting', 2, '240000', [2, 1]]);
  const [card] = threadChoices(plan);
  assert.deepEqual([card.choiceId, card.answered, card.media, card.options.length], ['frame-1.1', false, true, 3]);
  const rows = stepRows(plan, ['image'], 'en-US');
  assert.deepEqual([rows.current.length, rows.history.length], [3, 3], 'version 1’s frames are history');
  const [v2, v1] = await Promise.all([store.readCodePlanSource(2), store.readCodePlanSource(1)]);
  const counts = diffCounts(lineDiff(v1.source, v2.source));
  assert.ok(counts.added > 0 && counts.removed > 0);
  await assert.rejects(store.readCodePlanSource(9), (error) => error.code === 'NOT_FOUND');
});

test('answering sends the exact option with an Idempotency-Key, and the run moves on by itself', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, client } = await studio(t, '?codeplan=waiting');
  const plan = await store.readCodePlan();
  const choice = plan.choices[0];
  const receipt = await store.answerCodePlanChoice(choice, choice.options[2]);
  const sent = client.sent.find((request) => request.path.endsWith('/code-plan/choices'));
  assert.equal(sent.path, `/api/projects/${CODE_FILM_ID}/code-plan/choices`);
  assert.equal(sent.method, 'POST');
  assert.match(sent.key, /^key-\d+$/);
  assert.deepEqual(sent.body, { choiceId: 'frame-1.1', optionsDigest: choice.optionsDigest, answer: choice.options[2] });
  assert.equal(receipt.view.state, 'running');
  assert.equal(receipt.view.reservedMicros, '570000', 'the first clip and the next three frames are sent');
  t.mock.timers.tick(CODE_STEP_MS);
  const next = await store.readCodePlan();
  assert.equal(next.state, 'waiting');
  assert.deepEqual(threadChoices(next).map((c) => [c.choiceId, c.answered, c.chosen]), [['frame-1.1', true, 2], ['frame-1.2', false, null]]);
});

test('a lost answer is resent with the same key and body; a stale choice is refused', async (t) => {
  let lose = true;
  const { store, client } = await studio(t, '?codeplan=waiting', (path) => path.endsWith('/choices') && lose);
  const plan = await store.readCodePlan();
  const choice = plan.choices[0];
  assert.equal(await store.answerCodePlanChoice(choice, choice.options[0]), undefined);
  assert.equal(store.unconfirmed('codeplan:choice:frame-1.1'), true);
  lose = false;
  assert.ok(await store.answerCodePlanChoice(choice, choice.options[0]));
  const answers = client.sent.filter((request) => request.path.endsWith('/choices'));
  assert.equal(answers.length, 2);
  assert.equal(answers[1].key, answers[0].key);
  assert.deepEqual(answers[1].body, answers[0].body);
  assert.equal(store.unconfirmed('codeplan:choice:frame-1.1'), false);
  // The same choice again, now answered: the studio refuses it and nothing is resent under the old key.
  assert.equal(await store.answerCodePlanChoice(choice, choice.options[1]), undefined);
  assert.equal(store.getState().toast.message.id, 'error.CODE_PLAN_CHOICE');
  assert.notEqual(client.sent.filter((request) => request.path.endsWith('/choices')).at(-1).key, answers[0].key);
});

test('paused at the ceiling, raising it by a dollar lets the clip and the render finish', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, client } = await studio(t, '?codeplan=budget');
  const plan = await store.readCodePlan();
  const strip = runStrip(plan, 'en-US');
  assert.equal(plan.state, 'paused_budget');
  assert.equal(en(strip.spend), 'Spent $0.81 of $1.00');
  assert.equal(stepRows(plan, ['video'], 'en-US').current.find((row) => row.state === 'absent').status.id, 'codeplan.step.budget');
  const receipt = await store.raiseCodePlanCeiling(plan, strip.raise.body);
  const sent = client.sent.find((request) => request.path.endsWith('/code-plan/ceiling'));
  assert.deepEqual([sent.body, !!sent.key], [{ ceilingMicros: '2000000' }, true]);
  assert.deepEqual([receipt.view.state, receipt.view.ceilingMicros], ['running', '2000000']);
  t.mock.timers.tick(CODE_STEP_MS);
  t.mock.timers.tick(CODE_STEP_MS);
  const done = await store.readCodePlan();
  assert.equal(done.state, 'done');
  assert.equal(latestRender(done).key, 'render');
  assert.equal(done.spentMicros, '1260000');
  // Lower or equal is refused.
  assert.equal(await store.raiseCodePlanCeiling(done, { ceilingMicros: '2000000' }), undefined);
});

test('an error stops the run and is said plainly; a message to the Director writes a fixed version', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store } = await studio(t, '?codeplan=error');
  const plan = await store.readCodePlan();
  assert.equal(plan.state, 'error');
  assert.match(runStrip(plan, 'en-US').error, /^TypeError: Cannot read properties of undefined/);
  assert.deepEqual(plan.versions.map((v) => v.version), [3, 2, 1]);
  assert.deepEqual(versionRows(plan, 'en-US')[0].findings.map((f) => f.code), ['UNAWAITED_CALL']);
  store.setComposerText('Please fix it.');
  assert.equal(await store.sendMessage(), true);
  assert.equal((await store.readCodePlan()).held, true, 'the Director holds new paid work while it reads');
  t.mock.timers.tick(1500);
  const fixed = await store.readCodePlan();
  assert.deepEqual([fixed.held, fixed.planVersion, fixed.state], [false, 4, 'running']);
  t.mock.timers.tick(CODE_STEP_MS);
  assert.equal((await store.readCodePlan()).state, 'waiting');
});

test('Start makes a code-plan film with planMode "code"; the Director writes its first version', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, client } = await studio(t);
  const result = await runCreation(store, { body: createBody('Pier test', null, 'Untitled', 'code'), steps: ['create'], plan: null, codex: { state: 'unknown' } }, { onStep() {} });
  assert.equal(result.failedAt, null);
  const create = client.sent.find((request) => request.path === '/api/projects' && request.method === 'POST');
  assert.deepEqual(create.body, { name: 'Pier test', planMode: 'code' });
  await store.selectProject(result.film.id);
  assert.equal(store.getState().snapshot.project.planMode, 'code');
  const empty = await store.readCodePlan();
  assert.deepEqual([empty.state, empty.planVersion, empty.steps.length], ['empty', null, 0]);
  store.setComposerText('Mara waits for the last ferry.');
  await store.sendMessage();
  t.mock.timers.tick(1500);
  assert.deepEqual([(await store.readCodePlan()).planVersion, (await store.readCodePlan()).state], [1, 'running']);
  t.mock.timers.tick(CODE_STEP_MS);
  const ready = await store.readCodePlan();
  assert.equal(ready.state, 'waiting');
  assert.equal(threadChoices(ready)[0].options.length, 3);
  // A storyboard film's create body is what it always was.
  await runCreation(store, { body: createBody('Plain', null, 'Untitled'), steps: ['create'], plan: null, codex: { state: 'unknown' } }, { onStep() {} });
  assert.deepEqual(client.sent.filter((request) => request.path === '/api/projects' && request.method === 'POST').at(-1).body, { name: 'Plain' });
});

test('a failed step is explained in plain words, with what a retry means; the runtime\'s own facts win', () => {
  const lost = step('clip', 'video', 'failed', { priceMicros: '100000', error: { code: 'SUBMISSION_RESPONSE_LOST' } });
  const problem = stepProblem(lost, 'en-US');
  assert.equal(problem.cause, 'lost');
  assert.equal(en(problem.what), 'The service did not answer when this was sent, so it is not known whether it started.');
  assert.equal(en(problem.cost), 'It may already have cost $0.10.');
  assert.deepEqual([problem.retry, problem.price], ['consent', '$0.10']);
  assert.equal(en(problem.retryNote), 'A retry makes a new attempt and may charge again.');
  // N1 says the request never left: safe, and nothing charged.
  const safe = stepProblem({ ...lost, error: { code: 'VIGGLE_H3_CONNECT_REFUSED', mayHaveCharged: false, retry: 'safe' } }, 'en-US');
  assert.deepEqual([safe.retry, safe.cost], ['safe', null]);
  assert.equal(zh(safe.retryNote), '请求没有到达服务，重试不会重复收费。');
  assert.equal(stepProblem(step('f', 'video', 'failed', { error: { code: 'SEEDANCE_MODERATION_REFUSED' } }), 'en-US').retry, 'none');
  assert.equal(en(stepProblem(step('f', 'image', 'failed', { error: { code: 'WEIRD_THING' } }), 'en-US').what), 'The service reported a problem (WEIRD_THING).');
  assert.deepEqual(['NO_KEY_CREDENTIAL', 'RATE_LIMITED', 'TIMED_OUT', 'MEDIA_VALIDATION_FAILED', 'CODE_PLAN_INPUT', 'CODE_PLAN_CEILING'].map((code) => problemCause(code, 'failed')),
    ['key', 'busy', 'timeout', 'media', 'input', 'limit']);
  assert.equal(stepProblem(step('ok', 'image', 'succeeded'), 'en-US'), null);
  assert.equal(stepProblem(step('w', 'video', 'unknown'), 'en-US'), null, 'still waiting for an answer is not a failure');
});

test('failed steps put a red dot on their tab and list in Needs attention; unreached history does not', () => {
  const plan = view({ steps: [
    step('frame', 'image', 'failed', { error: { code: 'MODERATION' } }),
    step('clip', 'video', 'unknown', { error: { code: 'SUBMISSION_RESPONSE_LOST' }, label: 'Push in on Tofu' }),
    step('old', 'video', 'failed', { reached: false, error: { code: 'X' } }),
    step('fine', 'image', 'succeeded'),
  ] });
  assert.deepEqual(plan.steps.map(needsAttention), [true, true, false, false]);
  assert.deepEqual([...attentionViews(plan)].sort(), ['film', 'keyframes']);
  assert.deepEqual([...attentionViews(view({ steps: [step('fine', 'image', 'succeeded')] }))], []);
  const items = codePlanAttentionItems(plan, 'en-US');
  assert.deepEqual(items.map((item) => [item.key, item.view, en(item.badge)]), [['frame', 'keyframes', 'Frame'], ['clip', 'film', 'Clip']]);
  assert.equal(en(items[1].title), 'A clip failed: Push in on Tofu');
  assert.match(en(items[1].detail), /did not answer/);
});

test('a retry press is keyed by the step and its attempt, so a later retry is a new request', () => {
  assert.deepEqual(retryPress({ key: 'clip', attempts: 1 }), { pressId: 'codeplan:retry:clip', logical: { stepKey: 'clip', attempt: 1 } });
  assert.notDeepEqual(retryPress({ key: 'clip', attempts: 2 }).logical, retryPress({ key: 'clip', attempts: 1 }).logical);
  const row = stepRows(view({ steps: [step('clip', 'video', 'failed', { attempts: 2, error: { code: 'X' } })] }), ['video'], 'en-US').current[0];
  assert.equal(row.attempts, 2);
});

test('developer mode is a browser preference, off unless saved as on; storage that throws reads as off', () => {
  const saved = new Map();
  const storage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) };
  assert.equal(readDeveloperMode(storage), false);
  assert.equal(setDeveloperMode(true, storage), true);
  assert.equal(saved.get(DEVELOPER_STORAGE_KEY), 'on');
  assert.equal(readDeveloperMode(storage), true);
  setDeveloperMode(false, storage);
  assert.equal(readDeveloperMode(storage), false);
  assert.equal(readDeveloperMode({ getItem() { throw new Error('blocked'); } }), false);
  assert.equal(setDeveloperMode(true, { setItem() { throw new Error('full'); }, removeItem() {} }), false);
  setDeveloperMode(false, null);
  // Without it a code film has no Code tab.
  assert.deepEqual(viewTabs('plan', false).map((tab) => tab.view), ['plan', 'keyframes', 'assets', 'film']);
  assert.deepEqual(viewTabs('plan', true).map((tab) => tab.view), ['plan', 'keyframes', 'assets', 'film', 'code']);
});

test('?codeplan=failed: a lost clip stops the run; Retry (with consent) makes it again and the film renders', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, client } = await studio(t, '?codeplan=failed');
  const plan = await store.readCodePlan();
  assert.equal(plan.state, 'done_with_failures');
  assert.equal(en(runStrip(plan, 'en-US').status), 'Stopped: a step failed');
  const row = stepRows(plan, ['video'], 'en-US').current.find((r) => r.key === 'clip-pier');
  assert.deepEqual([row.state, row.problem.retry, row.attempts], ['failed', 'consent', 1]);
  const receipt = await store.retryCodePlanStep(row);
  const sent = client.sent.find((request) => request.path.endsWith('/code-plan/steps/clip-pier/retry'));
  assert.ok(sent && sent.key, 'an idempotent POST');
  assert.equal(receipt.view.state, 'running');
  t.mock.timers.tick(CODE_STEP_MS);
  t.mock.timers.tick(CODE_STEP_MS);
  const done = await store.readCodePlan();
  assert.equal(done.state, 'done');
  assert.equal(done.steps.find((s) => s.key === 'clip-pier').attempts, 2);
  // Nothing left to retry.
  assert.equal(await store.retryCodePlanStep({ key: 'clip-pier', attempts: 2 }), undefined);
});
