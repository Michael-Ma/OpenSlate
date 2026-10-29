import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformWithOxc } from '../../node_modules/vite/dist/node/index.js';
import { lastFerryOverview } from '../../src/next/fixtures/last-ferry.ts';
import { cardStatus, confirmationStep, confirmationStop, keyframesView, shotHasNoAnswer, videoPanel } from '../../src/next/model/keyframes.ts';
import { keyframesPress, lostReplyHolds } from '../../src/next/model/keyframes-press.ts';
import { shotClip } from '../../src/next/model/keyframes-stage.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { PressKeys, canonicalJson } from '../../src/next/store/press-keys.ts';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';
import { artifactKey } from '../../src/next/media/artifact-cache.ts';

const en = (message) => translateMsg('en', message);
const zh = (message) => translateMsg('zh-CN', message);
const quote = (units, unit = 15000) => ({ units, micros: String(units * unit), unitMicros: String(unit), priceUnknown: false });

function ready() {
  const overview = lastFerryOverview();
  const scene = overview.scenes[0];
  Object.assign(scene, { state: 'keyframes_back', keyframeTargets: [], videoTargets: [...scene.shotIds], blockers: [] });
  scene.counts.videosReady = 0;
  for (const id of scene.shotIds) {
    overview.shots[id].video = { state: 'queued', waiting: { code: 'review', since: 'x' }, takeCount: 0 };
    overview.shots[id].keyframe.opened = true;
    overview.shots[id].narration = { state: 'none', text: '', fits: true };
  }
  return { overview, scene, first: overview.shots[scene.shotIds[0]], second: overview.shots[scene.shotIds[1]] };
}

function missingVoices() {
  const fixture = ready();
  fixture.scene.keyframeTargets = fixture.scene.shotIds.slice(0, 2);
  fixture.scene.quotes.makeKeyframes = quote(2);
  for (const id of fixture.scene.keyframeTargets) fixture.overview.shots[id].narration = { state: 'text_only', text: 'A line.', fits: true };
  return fixture;
}

test('W1 a lost Regenerate replays exactly until replacement progress proves it landed', () => {
  for (const replacement of [
    { state: 'queued', attemptId: 'new-attempt' },
    { state: 'running', attemptId: 'new-attempt' },
    { state: 'failed', attemptId: 'new-attempt', failure: { at: 'later' } },
  ]) {
    const { overview, scene, first } = ready();
    let key = 0;
    const keys = new PressKeys(overview.projectId, null, () => `request-${++key}`);
    const before = keyframesPress(overview, scene, [first.shotId], true);
    const originalBody = { expectedHeadVersion: 1, targetShotIds: [first.shotId] };
    const saved = keys.begin(before.pressId, before.logical, originalBody);
    const wouldResend = (press) => keys.saved(press.pressId)?.logical === canonicalJson(press.logical);
    assert.equal(lostReplyHolds(overview, keys.ids(), wouldResend), true);
    assert.strictEqual(keys.begin(before.pressId, before.logical, { expectedHeadVersion: 99 }), saved, 'a genuinely unknown outcome keeps the original key and exact body');
    first.keyframe.replacement = replacement;
    assert.equal(lostReplyHolds(overview, keys.ids(), wouldResend), false, replacement.state);
    const after = keyframesPress(overview, scene, [first.shotId], true);
    assert.notEqual(canonicalJson(after.logical), canonicalJson(before.logical));
    assert.notEqual(keys.begin(after.pressId, after.logical, originalBody).key, saved.key);
  }
});

test('W1 replacement attempt identity and failure time distinguish a later human request', () => {
  const { overview, scene, first } = ready();
  first.keyframe.replacement = { state: 'failed', attemptId: 'attempt-1', failure: { at: 'one' } };
  const identity = () => canonicalJson(keyframesPress(overview, scene, [first.shotId], true).logical);
  const firstFailure = identity();
  first.keyframe.replacement.attemptId = 'attempt-2';
  assert.notEqual(identity(), firstFailure);
  const secondAttempt = identity();
  first.keyframe.replacement.failure.at = 'two';
  assert.notEqual(identity(), secondAttempt);
});

test('W1 voice-only Make names and prices speech, including one voice line and both locales', () => {
  const { overview, scene } = missingVoices();
  let panel = videoPanel(overview, scene, 'en-US');
  assert.deepEqual([panel.action, panel.enabled], ['make_keyframes', true]);
  assert.equal(en(panel.label), 'Make 2 voice lines');
  assert.equal(en(panel.note), 'The keyframes are ready. Make the voice lines, then confirm.');
  assert.equal(en(panel.priceTotal), 'about $0.03');
  assert.equal(en(panel.priceEach), '2 voice lines at about $0.02');
  assert.equal(zh(panel.label), '生成 2 条配音');
  assert.equal(zh(panel.note), '关键帧已就绪。先生成配音，再确认。');
  scene.keyframeTargets = [scene.shotIds[0]];
  scene.quotes.makeKeyframes = quote(1);
  panel = videoPanel(overview, scene, 'zh-CN');
  assert.equal(en(panel.label), 'Make 1 voice line');
  assert.equal(zh(panel.priceEach), '1 条配音，每条约 $0.02');
  overview.shots[scene.keyframeTargets[0]].narration.state = 'ready';
  scene.quotes.makeKeyframes = quote(0);
  assert.equal(en(videoPanel(overview, scene, 'en-US').label), 'Make 1 voice line', 'a returned recording still awaiting attach or accept never reads Make 0');
});

test('W1 mixed Make counts actual missing frames and voice lines instead of quote units', () => {
  const { overview, scene, first } = missingVoices();
  first.keyframe = { state: 'none', takeCount: 0, opened: false };
  scene.quotes.makeKeyframes = { ...quote(3), unitMicros: '0', micros: '50000' };
  const panel = videoPanel(overview, scene, 'en-US');
  assert.equal(en(panel.label), 'Make 1 keyframe');
  assert.equal(en(panel.priceEach), '1 keyframe and 2 voice lines');
  assert.equal(zh(panel.priceEach), '1 张关键帧和 2 条配音');
  assert.equal(en(panel.priceTotal), 'about $0.05');
  assert.equal(en(panel.note), 'The prompts are written. Make keyframes to see the shots.');
});

test('W1 keyframe-only Make retains its frame count and price breakdown', () => {
  const { overview, scene } = ready();
  scene.keyframeTargets = scene.shotIds.slice(0, 2);
  scene.quotes.makeKeyframes = quote(2, 20000);
  for (const id of scene.keyframeTargets) overview.shots[id].keyframe = { state: 'none', takeCount: 0, opened: false };
  const panel = videoPanel(overview, scene, 'en-US');
  assert.equal(en(panel.label), 'Make 2 keyframes');
  assert.equal(en(panel.priceEach), '2 keyframes at about $0.02');
});

test('W1 mixed Make does not call an uploaded or already-returned recording a paid voice line', () => {
  const { overview, scene, first } = missingVoices();
  first.keyframe = { state: 'none', takeCount: 0, opened: false };
  scene.quotes.makeKeyframes = quote(1, 20000);
  const panel = videoPanel(overview, scene, 'en-US');
  assert.equal(en(panel.label), 'Make 1 keyframe');
  assert.equal(panel.priceEach, null, 'the one paid unit is its missing frame');
});

test('W1 Make keyframes voice runs expose each current step without promising clips', () => {
  const { overview, scene, first } = missingVoices();
  scene.confirmation = { confirmationId: 'old-video-confirm', state: 'done' };
  scene.keyframesRun = { confirmationId: 'voice-run', state: 'running', currentShotId: first.shotId };
  scene.blockers = [{ code: 'confirmation_running' }];
  for (const [step, text] of [['speech', 'Making voice line…'], ['attach', 'Saving voice line…'], ['accept', 'Fitting voice line…']]) {
    scene.keyframesRun.currentStep = step;
    assert.deepEqual(confirmationStep(overview, scene), { step, shotId: first.shotId, label: first.label });
    const view = keyframesView(overview, scene.sceneId, first.shotId, 'en-US');
    assert.deepEqual([view.panel.action, view.panel.enabled, view.panel.price], [null, false, null]);
    assert.equal(en(view.panel.label), 'Making voice lines…');
    assert.equal(en(view.panel.note), text);
    assert.doesNotMatch(en(view.panel.note), /clips follow/);
    assert.deepEqual([view.cards[0].workingOn, view.cards[0].working], ['voice', true]);
    assert.equal(inspectorView(overview, first, 'en-US').regenerate.enabled, false);
  }
  first.keyframe = { ...first.keyframe, state: 'running' };
  assert.equal(en(videoPanel(overview, scene, 'en-US').note), 'Fitting voice line…', 'the current voice step remains visible while images are being made');
  delete scene.keyframesRun.currentStep;
  assert.equal(zh(videoPanel(overview, scene, 'zh-CN').note), '正在生成配音…');
});

test('W1 blocked keyframe voice runs expose their stop and retain priced human continuation', () => {
  const { overview, scene, first } = missingVoices();
  first.narration = { ...first.narration, measuredSeconds: 7.4, fits: false };
  scene.keyframesRun = { confirmationId: 'voice-run', state: 'blocked', blocker: { code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: first.shotId } };
  scene.confirmation = { confirmationId: 'old-confirm', state: 'done' };
  scene.blockers = [{ code: 'narration_too_long', shotId: first.shotId }];
  const panel = videoPanel(overview, scene, 'en-US');
  assert.equal(panel.stopped.code, 'NARRATION_CUE_OUT_OF_RANGE');
  assert.equal(en(panel.stopped.reason), 'The 1.1 voice line came out at 7.4 s, longer than its shot.');
  assert.equal(en(panel.headline.value), 'Stopped');
  assert.equal(panel.action, 'make_keyframes');
  assert.equal(confirmationStop(overview, scene).shotId, first.shotId);
  scene.keyframesRun = { confirmationId: 'later-run', state: 'running', currentStep: 'speech', currentShotId: first.shotId };
  scene.confirmation = { confirmationId: 'old-blocked-confirm', state: 'blocked', blocker: { code: 'SCENE_REVIEW_STALE' } };
  assert.equal(confirmationStop(overview, scene), null, 'old stopped work does not overshadow the active run');
});

test('W1 saved video clears historical voice stops while a new missing-voice run still shows its blocker', () => {
  const { overview, scene, first } = missingVoices();
  scene.keyframesRun = { confirmationId: 'blocked-voice-run', state: 'blocked', blocker: { code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: first.shotId } };
  scene.confirmation = { confirmationId: 'completed-video', state: 'done' };
  scene.state = 'video_saved';
  scene.videoTargets = [];
  scene.keyframeTargets = [];
  for (const id of scene.shotIds) {
    overview.shots[id].video = { state: 'ready', takeCount: 1 };
    overview.shots[id].narration = { state: 'ready', text: 'A line.', measuredSeconds: 1, fits: true };
  }
  assert.equal(confirmationStop(overview, scene), null);
  assert.equal(videoPanel(overview, scene, 'en-US').action, 'play');
  scene.keyframeTargets = [first.shotId];
  scene.quotes.makeKeyframes = quote(1);
  const panel = videoPanel(overview, scene, 'en-US');
  assert.equal(panel.stopped.code, 'NARRATION_CUE_OUT_OF_RANGE');
  assert.equal(panel.action, 'make_keyframes', 'a fresh voice remake on saved video still needs its own continuation');
});

test('W1 a current voice failure or measured fit blocker stays visible over saved video without paid targets', () => {
  for (const narration of [
    { state: 'ready', text: 'Long line.', measuredSeconds: 8, fits: false },
    { state: 'text_only', text: 'A new line.', fits: true },
    { state: 'failed', text: 'A line.', fits: true },
    { state: 'no_answer', text: 'A line.', fits: true },
  ]) {
    const { overview, scene, first } = ready();
    scene.state = 'video_saved';
    scene.keyframeTargets = []; scene.videoTargets = [];
    first.narration = narration;
    scene.keyframesRun = { confirmationId: 'voice-run', state: 'blocked', blocker: { code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: first.shotId } };
    assert.ok(confirmationStop(overview, scene), narration.state);
    assert.ok(videoPanel(overview, scene, 'en-US').stopped, narration.state);
    first.narration = { state: 'ready', text: 'Settled line.', measuredSeconds: 1, fits: true };
    assert.equal(confirmationStop(overview, scene), null, 'the settled line clears its saved-video history');
  }
});

test('W1 a confirmation-stale clip explains the new confirm on its card and Inspector', () => {
  const { overview, scene, first } = ready();
  first.video = { state: 'none', takeCount: 0, takenOff: 'confirmation_stale' };
  const text = 'Not made: the scene changed after you confirmed. Confirm again.';
  const view = keyframesView(overview, scene.sceneId, first.shotId, 'en-US');
  assert.equal(en(view.cards[0].status), text);
  assert.equal(en(inspectorView(overview, first, 'en-US').status), text);
  assert.equal(zh(cardStatus(first).status), '未生成：确认后这一场有改动。请重新确认。');
  assert.deepEqual([view.panel.action, view.panel.enabled], ['confirm', true]);
});

test('W1 completed clips waiting on download show only allowlisted localized reasons and never Give up', () => {
  const cases = [
    ['OUTPUT_DOWNLOAD_LOCATOR', 'the download address is not on the allowed list', '下载地址不在允许列表中'],
    ['OUTPUT_DOWNLOAD_EXPIRED', 'the download link expired', '下载链接已过期'],
    ['OUTPUT_DOWNLOAD_ADDRESS', 'the download address was refused', '下载地址被拒绝'],
    ['https://private.example/secret?token=never-show', 'the download failed; the studio keeps trying', '下载失败，studio 会继续尝试'],
  ];
  for (const [code, english, chinese] of cases) for (const state of ['running', 'no_answer', 'failed']) {
    const { overview, scene, first } = ready();
    first.video = { state, phase: 'ingesting', attemptId: 'completed-service-job', takeCount: 0, ingestionIssue: { code, at: 'now' } };
    const before = structuredClone(overview);
    const status = cardStatus(first).status;
    assert.equal(en(status), `Finished at the service, not saved yet: ${english}`);
    assert.equal(zh(status), `服务端已完成，但还没保存：${chinese}`);
    const inspector = inspectorView(overview, first, 'en-US');
    assert.equal(inspector.noAnswer, null, `no Give up for ${state}`);
    assert.equal(inspector.failure, null, `no new paid retry for ${state}`);
    assert.equal(shotHasNoAnswer(first), false);
    assert.deepEqual(overview, before, 'diagnostic projection is read-only');
    assert.equal(en(keyframesView(overview, scene.sceneId, first.shotId, 'en-US').cards[0].status), en(status));
  }
});

// Run the real Preview effects through a small hook adapter. JSX is transformed in memory; no browser is started.
const source = readFileSync(new URL('../../src/next/keyframes/Preview.tsx', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const { code } = await transformWithOxc(source, 'Preview.tsx', { jsx: { runtime: 'classic' } });
function previewHarness() {
  let cursor = 0;
  const slots = [], effects = [];
  const useEffect = (effect, deps) => {
    const at = cursor++, previous = slots[at];
    if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
      slots[at] = { deps, cleanup: previous?.cleanup, effect };
      effects.push(() => { slots[at].cleanup?.(); slots[at].cleanup = effect(); });
    }
  };
  const Preview = runInNewContext(`${code}\n;Preview;`, {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useEffect, useRef: (value) => slots[cursor++] ??= { current: value },
    useState(value) { const at = cursor++; slots[at] ??= { value }; return [slots[at].value, (next) => { slots[at].value = next; }]; },
    useI18n: () => ({ t: (id, values) => translate('en', id, values), tm: en }),
    useStore: () => ({}), useMode: () => 'live', useStudio: (select) => select({ pending: {} }),
    useReducedMotion: () => false, useOnScreen: () => false, useGuarded: () => ({}),
    artifactKey, shotClip, previewCaption: () => ({ id: 'preview.caption_plain', values: { text: '' } }),
    Picture: () => {}, StatusPill: () => {}, ShowDirectorButton: () => {},
    clock: () => '0:00',
  });
  const render = (props) => {
    cursor = 0;
    const node = Preview(props);
    while (effects.length) effects.shift()();
    return node;
  };
  render.replayEffects = () => { for (const slot of slots) slot?.effect?.(); };
  return render;
}

test('W1 Preview skips each no-longer-ready scene clip once per shot and availability change', () => {
  const { overview, scene, first, second } = ready();
  const cards = keyframesView(overview, scene.sceneId, first.shotId, 'en-US').cards;
  const render = previewHarness();
  let ended = 0;
  const props = { shot: first, card: cards[0], fps: 30, playing: 'clip', intent: null, position: null, held: null, onEnded: () => ended++ };
  render(props);
  assert.equal(ended, 1, 'queued review has no ready clip');
  render.replayEffects();
  assert.equal(ended, 1, 'strict effect replay does not skip the same shot twice');
  render({ ...props, onEnded: () => ended++ });
  first.video = { state: 'outdated', takeCount: 1 };
  render(props);
  assert.equal(ended, 1, 'rerenders, callback identity and unavailable-state changes do not skip twice');
  render({ ...props, shot: second, card: cards[1] });
  assert.equal(ended, 2, 'a later unavailable shot advances too');
  second.video = { state: 'ready', artifact: { artifactId: 'clip', sha256: 'a'.repeat(64), kind: 'video' }, takeCount: 1 };
  render({ ...props, shot: second, card: cards[1] });
  assert.equal(ended, 2, 'ready clips advance through their player');
  second.video.artifact = undefined;
  render({ ...props, shot: second, card: cards[1] });
  assert.equal(ended, 3, 'a ready state without its artifact is skipped');
  render({ ...props, shot: second, card: cards[1], playing: null });
  assert.equal(ended, 3, 'idle preview does not advance');
});
