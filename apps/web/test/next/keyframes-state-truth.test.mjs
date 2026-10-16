import test from 'node:test';
import assert from 'node:assert/strict';
import { cardStatus, isWorking, keyframesView, replacementStatus, sceneStateOf, sceneUnknownOutcome } from '../../src/next/model/keyframes.ts';
import { lastFerryOverview, lastFerryNotes, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { takeBlocked } from '../../src/next/model/keyframes-takes.ts';
import { noteViews, regenerationSummary } from '../../src/next/model/notes.ts';
import { noteBanner, noteCallout, settledMsg } from '../../src/next/model/note-banner.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = value => translateMsg('en', value);
const zh = value => translateMsg('zh-CN', value);
const noAnswer = { state: 'no_answer', phase: 'submission_unknown', attemptId: 'unanswered', takeCount: 0 };

function ready() {
  const overview = lastFerryOverview();
  const scene = overview.scenes[0];
  scene.state = 'keyframes_back';
  scene.videoTargets = [...scene.shotIds];
  scene.keyframeTargets = [];
  scene.blockers = [];
  scene.counts.videosReady = 0;
  for (const id of scene.shotIds) {
    overview.shots[id].video = { state: 'queued', waiting: { code: 'review', since: 'x' }, takeCount: 0 };
    overview.shots[id].keyframe.opened = true;
  }
  return { overview, scene, first: overview.shots[scene.shotIds[0]], second: overview.shots[scene.shotIds[1]] };
}

test('B20 a restarted unanswered clip names its shot and blocks confirm even if scene blockers are stale', () => {
  const { overview, scene, first } = ready();
  first.video = { ...noAnswer };
  overview.restartCasualties = ['unanswered'];
  const before = structuredClone(overview);
  const view = keyframesView(overview, sceneId(1), null, 'en-US');
  assert.equal(en(view.header.status), 'needs attention');
  assert.equal(en(view.attention), 'No answer from the service for 1.1. The work may still arrive and be charged.');
  assert.equal(zh(view.attention), '服务还未回应 1.1 的生成任务。结果可能稍后返回并产生费用。');
  assert.deepEqual([view.panel.action, view.panel.enabled, view.panel.price, view.panel.priceTotal, view.panel.priceEach], [null, false, null, null, null]);
  assert.equal(en(view.panel.headline.value), 'No answer yet');
  assert.equal(view.panel.headline.unit, null, 'opening the frame does not mean its unknown paid clip is ready for another confirm');
  assert.deepEqual(view.panel.note, view.attention);
  assert.match(en(view.panel.reason), /unanswered work/);
  assert.equal(sceneStateOf(overview, scene), 'needs_attention');
  assert.deepEqual(overview, before, 'deriving restart state does not submit, release or mutate work');
});

test('B20 every unanswered paid kind blocks the scene, including retained takes and voice lines', () => {
  for (const kind of ['keyframe', 'video', 'keyframe replacement', 'video replacement', 'narration']) {
    const { overview, scene, first } = ready();
    if (kind === 'narration') first.narration = { state: 'no_answer', text: 'The last boat.', fits: null };
    else if (kind.endsWith('replacement')) {
      const slot = kind.split(' ')[0];
      first[slot] = { ...first[slot], state: 'ready', replacement: { state: 'no_answer', attemptId: 'unanswered' } };
    } else first[kind] = { ...noAnswer, ...(kind === 'keyframe' ? { opened: true } : {}) };
    // Older/stale scene aggregates and targets cannot bypass current paid-outcome evidence.
    scene.state = 'video_saved'; scene.videoTargets = []; scene.keyframeTargets = [shotId('1.2')];
    const view = keyframesView(overview, scene.sceneId, first.shotId, 'en-US');
    assert.equal(en(view.header.status), 'needs attention', kind);
    assert.equal(view.panel.action, null, kind);
    assert.equal(view.panel.enabled, false, kind);
    assert.match(en(view.panel.note), /1\.1/, kind);
    assert.equal(en(view.panel.headline.value), 'No answer yet', kind);
  }
});

test('B20 the overview blocker alone still blocks, naming only shots in this scene and deduplicating labels', () => {
  const { overview, scene, first, second } = ready();
  first.video = { ...noAnswer };
  first.narration.state = 'no_answer';
  scene.blockers = [{ code: 'no_answer_in_scene', shotId: first.shotId }, { code: 'no_answer_in_scene', shotId: second.shotId }];
  const summary = sceneUnknownOutcome(overview, scene, 'en-US');
  assert.equal(en(summary), 'No answer from the service for 1.1 and 1.2. The work may still arrive and be charged.');
  assert.equal(zh(sceneUnknownOutcome(overview, scene, 'zh-CN')), '服务还未回应 1.1 和 1.2 的生成任务。结果可能稍后返回并产生费用。');
  first.video = { state: 'none', takeCount: 0 }; first.narration.state = 'none';
  scene.blockers = [{ code: 'no_answer_in_scene' }];
  const view = keyframesView(overview, scene.sceneId, null, 'en-US');
  assert.equal(en(view.header.status), 'needs attention');
  assert.equal(view.panel.action, null);
  assert.equal(en(view.attention), 'No answer from the service for work in this scene. It may still arrive and be charged.');
});

test('B20 unknown outcomes stay visible beside active work and a stopped confirmation', () => {
  const { overview, scene, first, second } = ready();
  first.video = { ...noAnswer };
  second.video = { state: 'running', attemptId: 'other', takeCount: 0 };
  scene.state = 'making_video';
  scene.confirmation = { confirmationId: 'confirm', state: 'blocked', blocker: { code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: second.shotId } };
  const view = keyframesView(overview, scene.sceneId, null, 'en-US');
  assert.equal(view.panel.action, null);
  assert.match(en(view.panel.note), /1\.1/);
  assert.equal(view.panel.stopped, null, 'an old stop must not hide the current unknown-outcome explanation');
  assert.equal(view.cards[1].working, true, 'other real work keeps its progress');
});

test('B20 only an answered or explicitly released outcome restores the normal scene decision', () => {
  const { overview, scene, first } = ready();
  first.video = { ...noAnswer };
  assert.equal(keyframesView(overview, scene.sceneId, null, 'en-US').panel.enabled, false);
  first.video = { state: 'none', takeCount: 0, takenOff: 'released', releasedAttemptIds: ['unanswered'] };
  const released = keyframesView(overview, scene.sceneId, null, 'en-US');
  assert.equal(released.attention, null);
  assert.deepEqual([released.panel.action, released.panel.enabled], ['confirm', true]);
  first.video = { state: 'ready', takeCount: 1 };
  assert.equal(sceneUnknownOutcome(overview, scene, 'en-US'), null);
});

test('B20 unclassified and stopped queues never look active or grant scene confirmation', () => {
  for (const waiting of [undefined, { code: 'unknown', since: 'x' }, { code: 'stopped', since: 'x' }, { code: 'timing', since: 'x' }]) {
    const { overview, scene, first } = ready();
    first.video = { state: 'queued', takeCount: 0, ...(waiting ? { waiting } : {}) };
    scene.state = 'making_video';
    const view = keyframesView(overview, scene.sceneId, null, 'en-US');
    assert.equal(isWorking(first.video), false, waiting?.code);
    assert.equal(cardStatus(first).tone, 'quiet', waiting?.code);
    assert.equal(view.cards[0].working, false, waiting?.code);
    assert.notEqual(en(view.header.status), 'making video', waiting?.code);
    assert.equal(view.panel.action, null, waiting?.code);
    assert.equal(view.panel.enabled, false, waiting?.code);
    assert.doesNotMatch(en(view.panel.label), /Making/, waiting?.code);
  }
});

test('B20 explicit queue reasons and proven automatic retries retain their real working state', () => {
  for (const code of ['capacity', 'edit_pending', 'voice']) {
    const { overview, scene, first } = ready();
    first.video = { state: 'queued', takeCount: 0, waiting: { code, since: 'x' } };
    scene.state = 'making_video';
    assert.equal(isWorking(first.video), true, code);
    assert.equal(keyframesView(overview, scene.sceneId, null, 'en-US').panel.enabled, false, code);
  }
  const retry = { state: 'queued', failure: { autoRetriesLeft: 1 } };
  assert.equal(isWorking(retry), true, 'a known automatic technical retry is a real queue even without waiting metadata');
  assert.equal(isWorking({ state: 'ready', replacement: retry }), true);
  assert.equal(replacementStatus({ state: 'ready', replacement: { state: 'queued' } }).tone, 'quiet');
  assert.equal(isWorking({ state: 'ready', replacement: { state: 'queued' } }), false);
});

test('B20 neutral unresolved queues still guard regeneration and take selection on every entry point', () => {
  for (const kind of ['keyframe', 'video']) for (const replacement of [false, true]) for (const code of [undefined, 'unknown', 'timing', 'stopped']) {
    const overview = lastFerryOverview();
    const shot = overview.shots[shotId('2.2')];
    const queue = { state: 'queued', takeCount: 0, ...(code ? { waiting: { code, since: 'x' } } : {}) };
    if (replacement) shot[kind] = { ...shot[kind], state: 'ready', replacement: queue };
    else shot[kind] = { ...shot[kind], ...queue };
    const inspector = inspectorView(overview, shot, 'en-US');
    assert.deepEqual([inspector.regenerate.enabled, inspector.regenerate.working, inspector.regenerate.cost], [false, false, null], `${kind} ${replacement} ${code}`);
    assert.ok(takeBlocked(shot), `${kind} ${replacement} ${code}`);
    const note = noteViews(lastFerryNotes(), overview, []).find(note => note.letter === 'a');
    const callout = noteCallout(note, shot.shotId, overview, 'en-US').regenerate;
    assert.equal(callout.enabled, false, `${kind} ${replacement} ${code}`);
    assert.doesNotMatch(en(callout.wait), /Making|finish/, 'the safety guard still speaks neutrally about an unresolved wait');
    const banner = noteBanner(note, overview, [], 'en-US');
    assert.equal(banner.actions.find(action => action.action.kind === 'regenerate').enabled, false);
  }
});

test('B20 unknown paid outcomes guard scene retries and own-shot purchases while unrelated shot work stays available', () => {
  const overview = lastFerryOverview();
  const scene = overview.scenes[1];
  scene.blockers = [];
  const shot = overview.shots[shotId('2.2')];
  shot.video = { state: 'failed', takeCount: 0, failure: { retryAllowed: true, technical: true, autoRetriesLeft: 0 } };
  overview.shots[shotId('2.1')].narration.state = 'no_answer';
  const inspector = inspectorView(overview, shot, 'en-US');
  assert.equal(inspector.regenerate.enabled, true, 'an unrelated shot can still make its keyframe');
  assert.equal(inspector.failure.retryVideo.enabled, false);
  const note = noteViews(lastFerryNotes(), overview, []).find(note => note.letter === 'a');
  const callout = noteCallout(note, shot.shotId, overview, 'en-US').regenerate;
  assert.equal(callout.enabled, true, 'a note on an unrelated shot can still make its keyframe');
  assert.equal(callout.wait, null);
  shot.video = { state: 'ready', takeCount: 1, replacement: { state: 'no_answer', attemptId: 'retained-video' } };
  const own = inspectorView(overview, shot, 'en-US');
  assert.equal(own.regenerate.enabled, false);
  const guarded = noteCallout(note, shot.shotId, overview, 'en-US').regenerate;
  assert.equal(guarded.enabled, false);
  assert.match(en(guarded.wait), /2\.2.*may still arrive and be charged/);
  assert.deepEqual(own.noAnswer, { slot: 'video', attemptId: 'retained-video' }, 'a retained unanswered video keeps its explicit release/reconciliation action');
});

test('B20 a resolved regenerate choice never claims an unclassified or unanswered keyframe has finished', () => {
  for (const replacement of [false, true]) for (const state of ['queued', 'no_answer']) {
    const overview = lastFerryOverview();
    const shot = overview.shots[shotId('2.2')];
    const pending = { state, takeCount: 0, attemptId: 'pending' };
    if (replacement) shot.keyframe.replacement = pending;
    else shot.keyframe = { ...shot.keyframe, ...pending };
    const note = lastFerryNotes().find(note => note.letter === 'a');
    Object.assign(note, { state: 'resolved', resolution: { choiceIndex: 1, at: 'x' } });
    const [view] = noteViews([note], overview);
    const immediate = settledMsg(view.choices[1].action, view.choices[1].label, overview);
    assert.deepEqual(view.settled, immediate, 'the saved note and just-chosen banner give the same account');
    assert.doesNotMatch(en(view.settled), /regenerated|Regenerating/, `${state} ${replacement}`);
    assert.match(en(view.settled), /2\.2/, `${state} ${replacement}`);
    assert.equal(view.making, false, 'a passive wait is not active work');
    if (state === 'queued') {
      assert.equal(en(view.settled), 'Waiting for the keyframe status of 2.2.');
      assert.equal(zh(view.settled), '等待 2.2 的关键帧状态。');
    } else assert.match(en(view.settled), /may still arrive and be charged/);
  }
});

test('B20 unanswered note targets stay named before other target progress, and wait notes name only their reason', () => {
  for (const kind of ['keyframe', 'video', 'narration']) {
    const overview = lastFerryOverview();
    const running = overview.shots[shotId('2.1')], unknown = overview.shots[shotId('2.2')];
    running.keyframe.state = 'running';
    unknown[kind].state = 'no_answer';
    const summary = regenerationSummary(overview, [running.shotId, unknown.shotId]);
    assert.equal(en(summary), 'No answer from the service for 2.2. The work may still arrive and be charged.', kind);
  }
  const { overview, scene, first, second } = ready();
  first.video.waiting.code = 'timing'; second.video.waiting.code = 'unknown';
  const panel = keyframesView(overview, scene.sceneId, null, 'en-US').panel;
  assert.equal(en(panel.note), 'Settle the narration timing for 1.1.');
  assert.equal(en(panel.reason), 'Settle the narration timing before generating video.');
});
