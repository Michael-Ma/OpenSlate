import test from 'node:test';
import assert from 'node:assert/strict';
import {
  afterFailure, codexFrom, createBody, createdMsg, createdOutcome, creationSteps, sheetFootMsg, defaultStep, directorAfterOpen, directorSetupBody, effectiveStep, failedMsg, failureNeedsReason,
  keysMsg, madePlan, modelPlan, modelSummaryText, nameRuns, notReadyReason, planFileName, planOffReason, planTextProblem, retryMsg, setupStatus, sheetTitleMsg, stepAvailable, PLAN_TEXT_MAX,
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
const CODEX_SETUP = { mode: 'native', binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' };
const found = { state: 'found', model: 'gpt-6-astra', setup: CODEX_SETUP };

test('Codex is found from the host default, else the film’s own Codex Director; what is named is what a new film is sent', () => {
  assert.deepEqual(codexFrom(null), { state: 'unknown' });
  assert.deepEqual(codexFrom({ selection: { mode: 'fake' }, defaults: { binaryPath: '', model: 'gpt-6-astra' } }), { state: 'not_found' });
  assert.deepEqual(codexFrom({ selection: { mode: 'fake' }, defaults: { binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' } }), found);
  // The open film runs another model: a new film gets the host defaults, and the sheet names those.
  assert.deepEqual(codexFrom({ selection: { mode: 'native', binaryPath: '/opt/codex', model: 'gpt-7' }, defaults: { binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' } }), found);
  // The host found no Codex, but the open film runs one set by hand: a new film is sent that same Codex.
  assert.deepEqual(codexFrom({ selection: { mode: 'native', binaryPath: '/opt/codex', model: 'gpt-7', codexHome: '/h' }, defaults: { binaryPath: '', model: 'gpt-6-astra' } }),
    { state: 'found', model: 'gpt-7', setup: { mode: 'native', binaryPath: '/opt/codex', model: 'gpt-7', codexHome: '/h' } });
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
    ['transcription', 'OpenAI whisper-1', 'about $0.01 a recording', 'ready', true],
  ]);
  assert.equal(zh(plan.rows[2].price), '每段视频约 $0.50');
  // The collapsed line names each paid default with its price before Create.
  assert.equal(modelSummaryText(plan, en), 'This computer’s defaults, all ready: Codex · gpt-6-astra Director (uses your Codex plan), OpenAI gpt-image-2 keyframes (about $0.04 a keyframe), '
    + 'MiniMax H3 video (about $0.50 a clip), OpenAI gpt-4o-mini-tts narration (about $0.01 a line), OpenAI whisper-1 transcription (about $0.01 a recording). Each price is an estimate set on this computer.');
  assert.match(modelSummaryText(plan, zh), /^本机默认模型，都已就绪：Codex · gpt-6-astra 导演（使用你的 Codex 套餐）、OpenAI gpt-image-2 关键帧（每张关键帧约 \$0\.04）、/);
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
  assert.equal(plan.standInWhy, 'no_keys');
  assert.match(modelSummaryText(plan, en), /^No keys are set/);
  // Only the stand-ins installed: nothing waits.
  const bare = modelPlan(catalog([]), found, 'en');
  assert.equal(en(bare.rows[1].status), 'no model set up');
  assert.equal(bare.standInWhy, 'none');
  assert.match(modelSummaryText(bare, en), /^No real model is set up on this computer yet, so this film starts with free stand-in models/);
});

test('when no real model is ready, the line says what they wait for: keys, FFmpeg, or the host turning them on', () => {
  const someKeys = allReal(false); someKeys[0] = row('img', 'OpenAI gpt-image-2', 'image', 'openai-image', '40000', false, { key: true, tools: false });
  const keyed = modelPlan(catalog(someKeys), found, 'en');
  assert.equal(keyed.standInWhy, 'key');
  assert.match(modelSummaryText(keyed, en), /^The media models are waiting for their keys/);
  const noTools = allReal(false).map(r => row(r.id, r.label, r.profile.kind, r.profile.adapter, '1', false, { key: true, tools: false }));
  const tools = modelPlan(catalog(noTools), found, 'en');
  assert.equal(tools.standInWhy, 'tools');
  assert.match(modelSummaryText(tools, en), /^FFmpeg was not found on this computer/);
  assert.doesNotMatch(modelSummaryText(tools, en), /keys/i);
  const off = allReal(false).map(r => row(r.id, r.label, r.profile.kind, r.profile.adapter, '1', false, { key: true, enabled: false }));
  assert.match(modelSummaryText(modelPlan(catalog(off), found, 'en'), en), /^No real model is turned on on this computer/);
  assert.match(modelSummaryText(modelPlan(catalog(off), found, 'zh-CN'), zh), /^本机还没有启用真实模型/);
});

test('a partly set-up computer mixes ready models and stand-ins in one selection', () => {
  const real = allReal(false);
  real[0] = row('img', 'OpenAI gpt-image-2', 'image', 'openai-image', '40000', true);
  const plan = modelPlan(catalog(real), { state: 'unknown' }, 'en');
  assert.deepEqual(plan.selection.profileIds, ['img', 'fake-video-v1', 'fake-speech-v1', 'fake-transcription-v1']);
  assert.equal(modelSummaryText(plan, en), '1 of 4 media jobs have a ready model: OpenAI gpt-image-2 keyframes (about $0.04 a keyframe). The rest start with free stand-ins; switch them in Settings once they are set up.');
  assert.equal(en(plan.rows[0].status), 'checked when the film is made');
});

test('prices never read $0.00: Codex images use the plan, an unset estimate says so', () => {
  const plan = modelPlan(catalog([row('codex', 'Codex image', 'image', 'codex-image', '0', true), row('vid', 'Free video', 'video', 'minimax-h3', '0', true)]), found, 'en');
  assert.equal(en(plan.rows[1].price), 'uses your Codex plan');
  assert.equal(en(plan.rows[2].price), 'no price set');
  for (const r of plan.rows) assert.doesNotMatch(en(r.price), /\$0\.00/);
  // A host price below a tenth of a cent reads "under $0.001", as in Settings (formatMicros would print "$0.0005").
  const cheap = modelPlan(catalog([row('tts', 'Cheap voice', 'speech', 'openai-speech', '300', true), row('stt', 'Cheap words', 'transcription', 'openai-transcription', '500', true)]), found, 'en');
  assert.equal(en(cheap.rows[3].price), 'under $0.001 a line');
  assert.equal(zh(cheap.rows[3].price), '每条不到 $0.001');
  assert.equal(en(cheap.rows[4].price), 'under $0.001 a recording');
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
  // A fresh install has only the stand-ins: FFmpeg is still listed, as not checked yet.
  assert.equal(en(keysMsg(none.keys)), 'none set');
  const some = allReal(false); some[0] = row('img', 'I', 'image', 'openai-image', '1', true);
  assert.equal(en(keysMsg(setupStatus(catalog(some), found).keys)), 'set for 1 of 4');
  assert.equal(zh(keysMsg(setupStatus(catalog(allReal(true)), found).keys)), '都已设置');
  assert.equal(setupStatus(catalog([]), found).tools, 'unknown');
  assert.equal(setupStatus(null, { state: 'unknown' }).tools, 'unknown');
  assert.equal(setupStatus(null, { state: 'unknown' }).realReady, false);
  const noTools = allReal(true).map(r => ({ ...r, readiness: { ...r.readiness, mediaTools: { required: true, available: false } } }));
  assert.equal(setupStatus(catalog(noTools), found).tools, 'not_found');
});

test('the Director and plan steps need Codex; a written plan needs it found first; the empty outline never does', () => {
  assert.equal(stepAvailable('director', { state: 'not_found' }), false);
  assert.equal(stepAvailable('plan', { state: 'not_found' }), false);
  assert.equal(stepAvailable('empty', { state: 'not_found' }), true);
  // Unknown (a real first run, no film at all): talking stays possible (nothing is lost if Codex is missing),
  // a written plan does not (it would be dropped).
  assert.equal(stepAvailable('director', { state: 'unknown' }), true);
  assert.equal(stepAvailable('plan', { state: 'unknown' }), false);
  assert.equal(stepAvailable('plan', found), true);
  assert.equal(planOffReason(found), null);
  assert.equal(en({ id: planOffReason({ state: 'not_found' }) }), 'Needs the Codex Director');
  assert.equal(en({ id: planOffReason({ state: 'unknown' }) }), 'Needs the Codex Director, which is checked when you make a film');
  assert.equal(defaultStep({ state: 'not_found' }), 'empty');
  assert.equal(defaultStep(found), 'director');
  assert.equal(defaultStep({ state: 'unknown' }), 'empty');
});

test('the shown step follows a late Codex answer: an untouched choice moves to the default, a step that is now off falls back', () => {
  assert.equal(effectiveStep(null, { state: 'unknown' }), 'empty');
  assert.equal(effectiveStep(null, found), 'director');
  assert.equal(effectiveStep('plan', { state: 'unknown' }), 'empty');
  assert.equal(effectiveStep('director', { state: 'unknown' }), 'director');
  assert.equal(effectiveStep('plan', found), 'plan');
  assert.equal(effectiveStep('director', { state: 'not_found' }), 'empty');
  assert.equal(effectiveStep('plan', { state: 'not_found' }), 'empty');
  assert.equal(effectiveStep('empty', found), 'empty');
});

test('a failed step after Create: no Codex is final, anything else offers to run that step again; the sheet adds the refusal’s words when they say more', () => {
  assert.equal(afterFailure('CODEX_NOT_FOUND'), 'final');
  assert.equal(afterFailure('DIRECTOR_SETUP_BUSY'), 'retry');
  assert.equal(afterFailure(null), 'retry');
  assert.equal(afterFailure('VALIDATION_ERROR'), 'retry');
  assert.equal(en(failedMsg('director', 'director', 'CODEX_NOT_FOUND', 'Harbour')),
    'Harbour was created, but Codex was not found on this computer, so the film starts with the stand-in Director. Once Codex is set up, switch its Director in Settings.');
  assert.match(en(failedMsg('plan', 'director', 'CODEX_NOT_FOUND', 'Harbour')), /cannot read the written plan/);
  // A check still running is not "could not be set up".
  assert.match(en(failedMsg('director', 'director', 'DIRECTOR_SETUP_BUSY', 'Harbour')), /^Harbour was created, and its Codex Director is still being checked\. Check again in a moment/);
  assert.match(en(failedMsg('director', 'director', 'DIRECTOR_SETUP_REQUIRED', 'Harbour')), /could not be set up\. Check it again/);
  assert.match(en(failedMsg('plan', 'import', null, 'Harbour')), /the plan was not sent\. Send it again/);
  // The way on names the step it runs again, never a bare "Try again" (that reads as making the film again).
  assert.equal(en(retryMsg('director')), 'Check the Director again');
  assert.equal(en(retryMsg('import')), 'Send the plan again');
  assert.equal(zh(retryMsg('director')), '重新检查导演');
  assert.equal(failureNeedsReason('DIRECTOR_SETUP_REQUIRED'), true);
  assert.equal(failureNeedsReason('NETWORK_ERROR'), true);
  assert.equal(failureNeedsReason('CODEX_NOT_FOUND'), false);
  assert.equal(failureNeedsReason('DIRECTOR_SETUP_BUSY'), false);
  assert.equal(failureNeedsReason(null), false);
});

test('Create waits for the Codex check only when the first step needs it; an empty outline opens first and sets it up after', () => {
  assert.deepEqual(creationSteps('plan', found, 'Scene 1: the pier'), ['create', 'director', 'import']);
  assert.deepEqual(creationSteps('plan', found, '   '), ['create', 'director']);
  assert.deepEqual(creationSteps('director', found, 'ignored'), ['create', 'director']);
  assert.deepEqual(creationSteps('director', { state: 'unknown' }, ''), ['create', 'director']);
  assert.deepEqual(creationSteps('empty', { state: 'unknown' }, ''), ['create']);
  assert.deepEqual(creationSteps('empty', found, ''), ['create']);
  assert.equal(directorAfterOpen('empty', found), true);
  assert.equal(directorAfterOpen('empty', { state: 'unknown' }), true);
  assert.equal(directorAfterOpen('empty', { state: 'not_found' }), false);
  assert.equal(directorAfterOpen('director', found), false);
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

test('after Create the toast names what happens next; a step that did not finish says what the film has instead', () => {
  const done = { failedAt: null, code: null };
  assert.equal(createdOutcome('director', '', done), 'director');
  assert.equal(createdOutcome('plan', 'Scene 1', done), 'plan');
  assert.equal(createdOutcome('plan', '  ', done), 'plan_later');
  assert.equal(createdOutcome('empty', '', done), 'empty');
  assert.equal(createdOutcome('plan', 'Scene 1', { failedAt: 'import', code: 'VALIDATION_ERROR' }), 'plan_later');
  // A check still running is said as such, never as "could not be set up".
  assert.equal(createdOutcome('director', '', { failedAt: 'director', code: 'DIRECTOR_SETUP_BUSY' }), 'setup_pending');
  assert.match(en(createdMsg('setup_pending', 'Harbour')), /^Created Harbour\. Its Codex Director is still being checked/);
  assert.equal(createdOutcome('director', '', { failedAt: 'director', code: 'DIRECTOR_SETUP_REQUIRED' }), 'setup_later');
  assert.equal(createdOutcome('director', '', { failedAt: 'director', code: 'CODEX_NOT_FOUND' }), 'stand_in');
  assert.equal(createdOutcome('plan', 'Scene 1', { failedAt: 'director', code: 'CODEX_NOT_FOUND' }), 'stand_in');
  assert.match(en(createdMsg('stand_in', 'Harbour')), /^Created Harbour with the stand-in Director: Codex was not found/);
  assert.equal(en(createdMsg('plan', 'Night bus')), 'Created Night bus. The Director is reading the plan; nothing changes until you confirm.');
  assert.equal(zh(createdMsg('director', 'Night bus')), '已新建《Night bus》。告诉导演这部影片讲什么。');
  assert.equal(en(sheetFootMsg('plan', 'x')), 'Creating a film is free. Reading the plan uses your Codex plan; no media is made.');
  assert.equal(en(sheetFootMsg('plan', '')), 'Creating a film is free.');
  assert.equal(en(sheetFootMsg('director', 'x')), 'Creating a film is free.');
});

test('once the film exists, the sheet’s title and foot say so instead of offering to create it', () => {
  assert.equal(en(sheetTitleMsg(false)), 'New film');
  assert.equal(en(sheetTitleMsg(true)), 'Film created');
  assert.equal(zh(sheetTitleMsg(true)), '影片已新建');
  assert.equal(en(sheetFootMsg('plan', 'Scene 1', 'Crossing')), 'Crossing is in your films.');
  assert.equal(zh(sheetFootMsg('director', '', 'Crossing')), '《Crossing》已在影片列表里。');
});

test('once the film exists, its Director row says what became of the check, never “ready” beside a notice that says otherwise', () => {
  const plan = modelPlan(catalog(allReal(true)), found, 'en');
  const director = (made) => made.rows.find((r) => r.job === 'director');
  const busy = madePlan(plan, 'director', 'DIRECTOR_SETUP_BUSY');
  assert.deepEqual([director(busy).model, en(director(busy).status), director(busy).ok], ['Codex · gpt-6-astra', 'still being checked', false]);
  assert.deepEqual(busy.rows.slice(1), plan.rows.slice(1), 'the media rows stay as they were');
  const refused = madePlan(plan, 'director', 'DIRECTOR_SETUP_REQUIRED');
  assert.deepEqual([en(director(refused).status), director(refused).ok], ['not set up yet', false]);
  const missing = madePlan(plan, 'director', 'CODEX_NOT_FOUND');
  assert.deepEqual([director(missing).model, en(director(missing).price), en(director(missing).status)], [null, 'free stand-in', 'Codex not found']);
  // A plan that was not sent came after the Director was set up: the rows stand.
  assert.equal(madePlan(plan, 'import', 'NETWORK_ERROR'), plan);
});

test('the summary splits around each model’s own label, so a label is kept whole on screen', () => {
  const runs = nameRuns('Codex · gpt-6-astra Director (uses your Codex plan), OpenAI gpt-4o-mini-tts narration.', ['Codex · gpt-6-astra', 'OpenAI gpt-4o-mini-tts', '']);
  assert.deepEqual(runs, [
    { text: 'Codex · gpt-6-astra', name: true }, { text: ' Director (uses your Codex plan), ', name: false },
    { text: 'OpenAI gpt-4o-mini-tts', name: true }, { text: ' narration.', name: false },
  ]);
  assert.equal(runs.map((run) => run.text).join(''), 'Codex · gpt-6-astra Director (uses your Codex plan), OpenAI gpt-4o-mini-tts narration.');
  // The longer of two overlapping labels wins.
  assert.deepEqual(nameRuns('MiniMax H3 Pro video', ['MiniMax H3', 'MiniMax H3 Pro']), [{ text: 'MiniMax H3 Pro', name: true }, { text: ' video', name: false }]);
  assert.deepEqual(nameRuns('No keys are set.', []), [{ text: 'No keys are set.', name: false }]);
});
