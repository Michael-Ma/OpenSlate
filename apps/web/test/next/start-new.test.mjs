import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codexFrom, createBody, createdMsg, createdOutcome, creationSteps, sheetFootMsg, defaultStep, directorSetupBody, keysMsg, modelPlan, modelSummary, notReadyReason,
  planFileName, planTextProblem, setupStatus, stepAvailable, PLAN_TEXT_MAX,
} from '../../src/next/model/start-new.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);

function row(id, label, kind, adapter, unitMicros, ready, extra = {}) {
  const fake = adapter === 'fake';
  return {
    id, label, profile: { kind, adapter },
    estimatedCost: { unitMicros, basis: fake ? 'fixture' : 'host_configured' },
    readiness: {
      configurationValid: true, registered: true,
      mediaTools: { required: !fake, available: extra.tools ?? true },
      credential: { required: !fake && adapter !== 'codex-image', present: fake ? null : (extra.key ?? ready), backendUnavailable: false },
      enabledByHost: extra.enabled ?? !fake, realExecutionEnabled: !fake && ready,
    },
    ...(adapter === 'codex-image' ? { usage: { kind: 'codex_subscription' } } : {}),
  };
}
const STAND_INS = [
  row('fake-image-v1', 'Demo image', 'image', 'fake', '100', true),
  row('fake-video-v1', 'Demo video', 'video', 'fake', '1000', true),
  row('fake-speech-v1', 'Demo speech', 'speech', 'fake', '100', true),
  row('fake-transcription-v1', 'Demo transcription', 'transcription', 'fake', '100', true),
];
const catalog = (real) => ({ catalogDigest: 'c'.repeat(64), defaults: STAND_INS.map(r => r.id), profiles: [...STAND_INS, ...real], realExecutionEnabled: real.some(r => r.readiness.realExecutionEnabled) });
const allReal = (ready) => [
  row('img', 'OpenAI gpt-image-2', 'image', 'openai-image', '40000', ready),
  row('vid', 'MiniMax H3', 'video', 'minimax-h3', '500000', ready),
  row('tts', 'OpenAI gpt-4o-mini-tts', 'speech', 'openai-speech', '10000', ready),
  row('stt', 'OpenAI whisper-1', 'transcription', 'openai-transcription', '10000', ready),
];
const found = { state: 'found', model: 'gpt-6-astra' };

test('Codex is found from the host default or the film’s own Codex Director', () => {
  assert.deepEqual(codexFrom(null), { state: 'unknown' });
  assert.deepEqual(codexFrom({ selection: { mode: 'fake' }, defaults: { binaryPath: '', model: 'gpt-6-astra' } }), { state: 'not_found' });
  assert.deepEqual(codexFrom({ selection: { mode: 'fake' }, defaults: { binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' } }), found);
  assert.deepEqual(codexFrom({ selection: { mode: 'native', binaryPath: '/opt/codex', model: 'gpt-7' }, defaults: { binaryPath: '', model: 'gpt-6-astra' } }), { state: 'found', model: 'gpt-7' });
  assert.deepEqual(directorSetupBody({ selection: { mode: 'fake' }, defaults: { binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra', codexHome: '/h' } }),
    { mode: 'native', binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra', codexHome: '/h' });
  assert.equal(directorSetupBody({ selection: { mode: 'fake' }, defaults: { binaryPath: '', model: 'gpt-6-astra' } }), null);
});

test('with every key set, a new film gets the ready real models with their prices', () => {
  const plan = modelPlan(catalog(allReal(true)), found, 'en');
  assert.deepEqual(plan.selection, { expectedCatalogDigest: 'c'.repeat(64), profileIds: ['img', 'vid', 'tts', 'stt'] });
  assert.equal(plan.ready, 4);
  assert.deepEqual(plan.rows.map(r => [r.job, r.model, en(r.price), en(r.status), r.ok]), [
    ['director', 'Codex · gpt-6-astra', 'uses your Codex plan', 'ready', true],
    ['keyframes', 'OpenAI gpt-image-2', 'about $0.04 a keyframe', 'ready', true],
    ['video', 'MiniMax H3', 'about $0.50 a clip', 'ready', true],
    ['narration', 'OpenAI gpt-4o-mini-tts', 'about $0.01 a line', 'ready', true],
    ['transcription', 'OpenAI whisper-1', 'about $0.01 a line', 'ready', true],
  ]);
  assert.equal(zh(plan.rows[2].price), '每段视频约 $0.50');
  assert.equal(en(modelSummary(plan)), 'This computer’s defaults, all ready. Each price is an estimate set on this computer.');
});

test('without keys the film starts with the free stand-ins and says which model waits for what', () => {
  const plan = modelPlan(catalog(allReal(false)), { state: 'not_found' }, 'en');
  assert.equal(plan.selection, null);
  assert.equal(plan.ready, 0);
  assert.deepEqual(plan.rows.map(r => [r.job, r.model, en(r.price), en(r.status)]), [
    ['director', null, 'free stand-in', 'Codex not found'],
    ['keyframes', null, 'free stand-in', 'OpenAI gpt-image-2: key not set'],
    ['video', null, 'free stand-in', 'MiniMax H3: key not set'],
    ['narration', null, 'free stand-in', 'OpenAI gpt-4o-mini-tts: key not set'],
    ['transcription', null, 'free stand-in', 'OpenAI whisper-1: key not set'],
  ]);
  assert.match(en(modelSummary(plan)), /^No keys are set/);
  // Only the stand-ins installed: nothing waits.
  assert.equal(en(modelPlan(catalog([]), found, 'en').rows[1].status), 'no model set up');
});

test('a partly set-up computer mixes ready models and stand-ins in one selection', () => {
  const real = allReal(false);
  real[0] = row('img', 'OpenAI gpt-image-2', 'image', 'openai-image', '40000', true);
  const plan = modelPlan(catalog(real), { state: 'unknown' }, 'en');
  assert.deepEqual(plan.selection.profileIds, ['img', 'fake-video-v1', 'fake-speech-v1', 'fake-transcription-v1']);
  assert.equal(en(modelSummary(plan)), '1 of 4 media jobs have a ready model; the rest start with free stand-ins. Switch them in Settings once they are set up.');
  assert.equal(en(plan.rows[0].status), 'checked when the film is made');
});

test('prices never read $0.00: Codex images use the plan, an unset estimate says so', () => {
  const plan = modelPlan(catalog([row('codex', 'Codex image', 'image', 'codex-image', '0', true), row('vid', 'Free video', 'video', 'minimax-h3', '0', true)]), found, 'en');
  assert.equal(en(plan.rows[1].price), 'uses your Codex plan');
  assert.equal(en(plan.rows[2].price), 'no price set');
  for (const r of plan.rows) assert.doesNotMatch(en(r.price), /\$0\.00/);
});

test('the reason a real model is not ready names the most actionable fix', () => {
  assert.equal(notReadyReason(row('a', 'A', 'image', 'openai-image', '1', false)), 'key');
  assert.equal(notReadyReason(row('a', 'A', 'image', 'openai-image', '1', false, { key: true, tools: false })), 'tools');
  assert.equal(notReadyReason(row('a', 'A', 'image', 'openai-image', '1', false, { key: true, enabled: false })), 'off');
  assert.equal(notReadyReason(row('a', 'A', 'image', 'openai-image', '1', false, { key: true })), 'setup');
});

test('the first-run card reports Codex, FFmpeg and keys without pretending to fix them', () => {
  const none = setupStatus(catalog(allReal(false)), { state: 'not_found' });
  assert.deepEqual(none, { codex: 'not_found', tools: 'found', keys: { set: 0, total: 4 }, realReady: false });
  assert.equal(en(keysMsg(none.keys)), 'none set');
  const some = allReal(false); some[0] = row('img', 'I', 'image', 'openai-image', '1', true);
  assert.equal(en(keysMsg(setupStatus(catalog(some), found).keys)), '1 of 4 set');
  assert.equal(zh(keysMsg(setupStatus(catalog(allReal(true)), found).keys)), '都已设置');
  assert.equal(setupStatus(catalog([]), found).tools, null);
  assert.equal(setupStatus(null, { state: 'unknown' }).realReady, false);
  const noTools = allReal(true).map(r => ({ ...r, readiness: { ...r.readiness, mediaTools: { required: true, available: false } } }));
  assert.equal(setupStatus(catalog(noTools), found).tools, 'not_found');
});

test('the Director and plan steps need Codex; the empty outline never does', () => {
  assert.equal(stepAvailable('director', { state: 'not_found' }), false);
  assert.equal(stepAvailable('plan', { state: 'not_found' }), false);
  assert.equal(stepAvailable('empty', { state: 'not_found' }), true);
  assert.equal(stepAvailable('plan', { state: 'unknown' }), true);
  assert.equal(defaultStep({ state: 'not_found' }), 'empty');
  assert.equal(defaultStep(found), 'director');
});

test('Create sets up the Codex Director when this computer has it and sends a plan only when given', () => {
  assert.deepEqual(creationSteps('plan', found, 'Scene 1: the pier'), ['create', 'director', 'import']);
  assert.deepEqual(creationSteps('plan', found, '   '), ['create', 'director']);
  assert.deepEqual(creationSteps('director', found, 'ignored'), ['create', 'director']);
  assert.deepEqual(creationSteps('empty', { state: 'unknown' }, ''), ['create', 'director']);
  assert.deepEqual(creationSteps('empty', { state: 'not_found' }, ''), ['create']);
});

test('the create body carries a selection only when it differs from the stand-ins', () => {
  assert.deepEqual(createBody('  Night bus ', null, 'Untitled film'), { name: 'Night bus' });
  assert.deepEqual(createBody('', { selection: null }, 'Untitled film'), { name: 'Untitled film' });
  assert.deepEqual(createBody('A', { selection: { expectedCatalogDigest: 'd', profileIds: ['x'] } }, 'U'), { name: 'A', expectedCatalogDigest: 'd', profileIds: ['x'] });
  assert.equal(createBody('x'.repeat(200), null, 'U').name.length, 160);
});

test('a written plan is text up to 12,000 characters, named .txt or .md', () => {
  assert.equal(planTextProblem('a'.repeat(PLAN_TEXT_MAX)), null);
  assert.equal(planTextProblem('a'.repeat(PLAN_TEXT_MAX + 1)), 'too_long');
  assert.equal(planTextProblem('a\0b'), 'not_text');
  assert.equal(planFileName('Night bus', 'brief.MD'), 'brief.MD');
  assert.equal(planFileName('Night bus', 'brief.pdf'), 'night-bus.txt');
  assert.equal(planFileName('  The Last Ferry!  ', null), 'the-last-ferry.txt');
  assert.equal(planFileName('末班渡轮', null), '末班渡轮.txt');
  assert.equal(planFileName('', null), 'plan.txt');
  assert.match(planFileName('x'.repeat(300), null), /^x{60}\.txt$/);
});

test('after Create the toast names what happens next; a step that did not finish falls back to the Plan', () => {
  assert.equal(createdOutcome('director', '', true), 'director');
  assert.equal(createdOutcome('plan', 'Scene 1', true), 'plan');
  assert.equal(createdOutcome('plan', '  ', true), 'plan_later');
  assert.equal(createdOutcome('plan', 'Scene 1', false), 'plan_later');
  assert.equal(createdOutcome('director', '', false), 'empty');
  assert.equal(createdOutcome('empty', '', true), 'empty');
  assert.equal(en(createdMsg('plan', 'Night bus')), 'Created Night bus. The Director is reading the plan; nothing changes until you confirm.');
  assert.equal(zh(createdMsg('director', 'Night bus')), '已新建《Night bus》。告诉导演这部影片讲什么。');
  assert.equal(en(sheetFootMsg('plan', 'x')), 'Creating a film is free. Reading the plan uses your Codex plan; no media is made.');
  assert.equal(en(sheetFootMsg('plan', '')), 'Creating a film is free.');
  assert.equal(en(sheetFootMsg('director', 'x')), 'Creating a film is free.');
});
