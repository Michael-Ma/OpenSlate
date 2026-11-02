// Keyframes parity with the classic studio: a scene confirm's steps and why it stopped, moving through the whole
// film from the stage, the Video side of the preview, the takes strip, the prompts, and a paid press whose reply
// was lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationStep, confirmationStop, keyframesView, shotStatus, stopExplains, videoPanel } from '../../src/next/model/keyframes.ts';
import { ARROW_OWNERS, editHold, filmShotOrder, shotClip, shotPosition, stageStep } from '../../src/next/model/keyframes-stage.ts';
import { takeBlocked, takeImpact, takesPath, takesStrip, takeUsedToast, useTakeCommand } from '../../src/next/model/keyframes-takes.ts';
import { confirmPress, keyframesPress, lostReplyHolds, pressFromId, PAID_PRESS } from '../../src/next/model/keyframes-press.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { lastFerryOverview, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { canonicalJson, PressKeys } from '../../src/next/store/press-keys.ts';
import { reducer } from '../../src/next/store/reducer.ts';
import { initialState } from '../../src/next/store/state.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const scene = (overview, ordinal) => overview.scenes[ordinal - 1];
const shot = (overview, label) => overview.shots[shotId(label)];

/** Scene 3 with its keyframes made and opened, ready to confirm (no confirm yet). */
function readyScene3() {
  const overview = lastFerryOverview();
  for (const label of ['3.1', '3.2']) Object.assign(shot(overview, label).keyframe, { state: 'ready', artifact: { artifactId: `art-${label}`, sha256: 'a'.repeat(64), kind: 'image' }, takeCount: 1, opened: true });
  Object.assign(scene(overview, 3), { state: 'keyframes_back', videoTargets: [shotId('3.1'), shotId('3.2')], keyframeTargets: [], blockers: [] });
  return overview;
}

/** Scene 3 with its keyframes made and opened, and its last confirm stopped with this blocker. */
function stoppedScene3(blocker) {
  const overview = readyScene3();
  scene(overview, 3).confirmation = { confirmationId: 'c-1', state: 'blocked', blocker };
  return overview;
}

// ---- the scene confirm's steps --------------------------------------------------------------------------

test('a running confirm names its step and shot: the voice steps on their shot\'s card and in the panel', () => {
  const overview = lastFerryOverview();
  const s3 = scene(overview, 3);
  for (const label of ['3.1', '3.2']) Object.assign(shot(overview, label).keyframe, { state: 'ready', artifact: { artifactId: `art-${label}`, sha256: 'a'.repeat(64), kind: 'image' }, takeCount: 1, opened: true });
  for (const label of ['3.1', '3.2']) shot(overview, label).video = { state: 'queued', takeCount: 0, waiting: { code: 'voice', since: '2026-10-15T10:00:00Z' } };
  Object.assign(s3, { state: 'making_video', confirmation: { confirmationId: 'c-1', state: 'running', currentShotId: shotId('3.2'), currentStep: 'speech' } });
  assert.deepEqual(confirmationStep(overview, s3), { step: 'speech', shotId: shotId('3.2'), label: '3.2' });

  for (const [step, card, panel] of [
    ['speech', 'Making voice line…', 'Making the voice line for 3.2; the clips follow.'],
    ['attach', 'Saving voice line…', 'Saving the voice line for 3.2; the clips follow.'],
    ['accept', 'Fitting voice line…', 'Fitting the voice line to 3.2; the clips follow.'],
  ]) {
    s3.confirmation.currentStep = step;
    const view = keyframesView(overview, sceneId(3), null, 'en-US');
    const [c31, c32] = view.cards;
    assert.deepEqual([en(c32.status), c32.tone, c32.working, c32.workingOn], [card, 'working', true, 'voice']);
    assert.deepEqual([en(c31.status), c31.workingOn], ['Waiting for voice', null], 'the other clip waits without a voice step of its own');
    assert.equal(en(view.panel.note), panel);
    assert.equal(en(shotStatus(overview, s3, shot(overview, '3.2')).status), card);
    assert.equal(en(inspectorView(overview, shot(overview, '3.2'), 'en-US').status), card);
  }
  assert.equal(zh(keyframesView(overview, sceneId(3), null, 'zh-CN').panel.note), '正在把配音对齐到 3.2，之后生成视频。');

  // The video step names no shot in the studio's view: the panel counts the clips instead.
  s3.confirmation = { confirmationId: 'c-1', state: 'running', currentStep: 'video' };
  shot(overview, '3.1').video = { state: 'running', takeCount: 0 };
  assert.deepEqual(confirmationStep(overview, s3), { step: 'video', shotId: null, label: null });
  const view = keyframesView(overview, sceneId(3), null, 'en-US');
  assert.equal(en(view.panel.note), 'Clip 1 of 2: 3.1. Progress shows on each card.');
  assert.equal(view.cards[1].workingOn, null);
  s3.confirmation.state = 'done';
  assert.equal(confirmationStep(overview, s3), null);
});

// ---- why a confirm stopped ------------------------------------------------------------------------------

test('a stopped confirm says why, at which shot, and what to do next, for each blocker the studio reports', () => {
  const cases = [
    ['NARRATION_SPEECH_FAILED', 'The voice line for 3.2 failed.', 'Check the line in Plan, then confirm again.', 'plan'],
    ['SUBMISSION_UNKNOWN', 'The voice service never confirmed the line for 3.2.', 'It may still arrive. Once the service answers, confirm again.', null],
    ['NARRATION_RECORDING_REQUIRED', 'The recording for 3.2 needs attention: none is attached.', 'Check the shot\'s narration in Plan, then confirm again.', 'plan'],
    ['GENERATED_NARRATION_CONFLICT', 'The voice line for 3.2 came back, but saving its recording needs attention.', 'Check the shot\'s narration in Plan, then confirm again.', 'plan'],
    ['AUDIO_DECODE_FAILED', 'The voice line for 3.2 came back, but saving its recording needs attention.', 'Check the shot\'s narration in Plan, then confirm again.', 'plan'],
    ['NARRATION_CUE_OUT_OF_RANGE', 'The 3.2 voice line runs longer than its shot.', 'Choose how to fit it, then confirm again.', null],
    ['SCENE_REVIEW_STALE', '3.2 changed after you confirmed: its frame or plan is not the one you opened.', 'Open the current frames, then confirm again.', null],
    ['EXECUTION_PAUSED', 'The film was stopped before 3.2 was done.', 'Continue the film, then confirm again.', null],
    ['NARRATION_SPEECH_UNAVAILABLE', 'No narrator voice is set up for the line in 3.2.', 'Choose a narrator voice in Settings, then confirm again.', 'settings'],
    ['PERSONAL_VOICE_REQUIRED', 'No narrator voice is set up for the line in 3.2.', 'Choose a narrator voice in Settings, then confirm again.', 'settings'],
    ['SOMETHING_NEW', 'Something went wrong (SOMETHING_NEW).', 'Check the scene, then confirm again.', null],
  ];
  for (const [code, reason, next, action] of cases) {
    const overview = stoppedScene3({ code, shotId: shotId('3.2') });
    // The film is still stopped (once it runs again, the next step is only to confirm again).
    overview.stopped = { stopId: 'stop-1', at: '2026-10-15T10:00:00Z', sentJobs: 0, detachedJobs: 1 };
    const stop = confirmationStop(overview, scene(overview, 3));
    assert.deepEqual([stop.code, stop.shotId, stop.label, en(stop.reason), en(stop.next), stop.action], [code, shotId('3.2'), '3.2', reason, next, action], code);
  }
  // Without a shot, the scene is named.
  const overview = stoppedScene3({ code: 'NARRATION_SPEECH_FAILED' });
  const stop = confirmationStop(overview, scene(overview, 3));
  assert.deepEqual([stop.shotId, en(stop.reason), stop.action], [null, 'A voice line failed.', null], 'Edit in Plan needs a shot');
  assert.equal(zh(stop.reason), '有配音生成失败。');
});

test('every stop is worded in English and Chinese, with or without its shot', () => {
  for (const code of ['NARRATION_SPEECH_FAILED', 'SUBMISSION_UNKNOWN', 'NARRATION_RECORDING_REQUIRED', 'NARRATION_IMPORT_FAILED', 'MEDIA_PROBE_FAILED', 'NARRATION_CUE_OUT_OF_RANGE', 'SCENE_REVIEW_STALE', 'EXECUTION_PAUSED', 'NARRATION_SPEECH_UNAVAILABLE', 'CONFIRMATION_FAILED']) {
    for (const shotIdOrNone of [shotId('3.2'), undefined]) {
      const overview = stoppedScene3({ code, ...(shotIdOrNone ? { shotId: shotIdOrNone } : {}) });
      const stop = confirmationStop(overview, scene(overview, 3));
      for (const text of [en(stop.reason), zh(stop.reason), en(stop.next), zh(stop.next)]) assert.ok(text && !/confirm\.stopped|\{/.test(text), `${code}: ${text}`);
    }
  }
});

test('any other blocker code is said through its error message', () => {
  const overview = stoppedScene3({ code: 'ESTIMATE_CHANGED', shotId: shotId('3.2') });
  assert.equal(en(confirmationStop(overview, scene(overview, 3)).reason), translateMsg('en', { id: 'error.ESTIMATE_CHANGED' }));
});

test('a line measured too long says its length; once fitted, the next step is only to confirm again', () => {
  const overview = stoppedScene3({ code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: shotId('3.2') });
  Object.assign(shot(overview, '3.2').narration, { state: 'ready', measuredSeconds: 8.43, fits: false });
  delete shot(overview, '3.2').narration.estimatedSeconds;
  let stop = confirmationStop(overview, scene(overview, 3));
  assert.equal(en(stop.reason), 'The 3.2 voice line came out at 8.4 s, longer than its shot.');
  assert.equal(en(stop.next), 'Choose how to fit it, then confirm again.');
  // Lengthened to 9 s (or the line cut at the shot's end): it fits now.
  Object.assign(shot(overview, '3.2'), { durationFrames: 270 });
  shot(overview, '3.2').narration.fits = true;
  stop = confirmationStop(overview, scene(overview, 3));
  assert.equal(en(stop.reason), 'The 3.2 voice line came out at 8.4 s, longer than its shot.', 'it still explains the last confirm');
  assert.equal(en(stop.next), 'It fits now: confirm again.');
  shot(overview, '3.2').narration.fits = false;
  shot(overview, '3.2').narration.fit = 'cut_to_shot';
  assert.equal(en(confirmationStop(overview, scene(overview, 3)).next), 'It fits now: confirm again.');
});

test('the stop shows in the panel and on its shot in the inspector, until clips are made again or the video is saved', () => {
  const overview = stoppedScene3({ code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: shotId('3.2') });
  scene(overview, 3).blockers = [{ code: 'narration_too_long', shotId: shotId('3.2') }];
  const panel = videoPanel(overview, scene(overview, 3), 'en-US');
  assert.equal(panel.stopped.code, 'NARRATION_CUE_OUT_OF_RANGE');
  assert.deepEqual([en(panel.headline.value), en(panel.headline.unit)], ['Stopped', 'at 3.2']);
  assert.deepEqual([panel.action, panel.enabled], ['confirm', false]);
  assert.equal(inspectorView(overview, shot(overview, '3.1'), 'en-US').stopped, null, 'only the shot it stopped at');
  const here = inspectorView(overview, shot(overview, '3.2'), 'en-US').stopped;
  assert.equal(en(here.reason), 'The 3.2 voice line runs longer than its shot.');
  // A new confirm making clips, or a saved video: nothing to explain any more.
  shot(overview, '3.1').video = { state: 'running', takeCount: 0 };
  assert.equal(confirmationStop(overview, scene(overview, 3)), null);
  shot(overview, '3.1').video = { state: 'none', takeCount: 0 };
  scene(overview, 3).state = 'video_saved';
  assert.equal(confirmationStop(overview, scene(overview, 3)), null);
  // A confirm that is running, done or cancelled is not a stop.
  for (const state of ['running', 'done', 'cancelled']) {
    const other = stoppedScene3({ code: 'SCENE_REVIEW_STALE' });
    scene(other, 3).confirmation.state = state;
    assert.equal(confirmationStop(other, scene(other, 3)), null, state);
  }
});

test('under a stopped confirm the disabled button still says why, less what the stop itself already says', () => {
  const reason = (overview) => { const panel = videoPanel(overview, scene(overview, 3), 'en-US'); return panel.reason && en(panel.reason); };
  // The too-long line at the stop's shot is the stop's own blocker: nothing to add under the button.
  let overview = stoppedScene3({ code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: shotId('3.2') });
  scene(overview, 3).blockers = [{ code: 'narration_too_long', shotId: shotId('3.2') }];
  assert.equal(reason(overview), null);
  // Frames still to open are not: the reason names them (and leaves out the line the stop explains).
  scene(overview, 3).blockers = [{ code: 'frame_not_opened', shotId: shotId('3.1') }, { code: 'narration_too_long', shotId: shotId('3.2') }];
  assert.equal(reason(overview), 'Open 3.1 first');
  // A failed voice line explains nothing about unopened frames or a working Director: both are said.
  overview = stoppedScene3({ code: 'NARRATION_SPEECH_FAILED', shotId: shotId('3.1') });
  scene(overview, 3).blockers = [{ code: 'frame_not_opened', shotId: shotId('3.1') }, { code: 'frame_not_opened', shotId: shotId('3.2') }];
  assert.equal(reason(overview), 'Open 3.1 and 3.2 first');
  scene(overview, 3).blockers = [{ code: 'director_working' }];
  assert.equal(reason(overview), 'The Director is working on this scene');
  // A too-long line at another shot than the stop's is still said.
  overview = stoppedScene3({ code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: shotId('3.2') });
  scene(overview, 3).blockers = [{ code: 'narration_too_long', shotId: shotId('3.1') }];
  assert.equal(reason(overview), 'Settle the narration in 3.1 first');
  // The opened-frame segments stay next to the stop.
  assert.deepEqual(videoPanel(overview, scene(overview, 3), 'en-US').segments.map((segment) => segment.opened), [true, true]);
  // Which blockers each stop explains.
  const stop = (code, shot = shotId('3.2')) => ({ code, shotId: shot });
  assert.ok(stopExplains(stop('EXECUTION_PAUSED'), { code: 'stopped' }));
  assert.ok(stopExplains(stop('SUBMISSION_UNKNOWN'), { code: 'no_answer_in_scene', shotId: shotId('3.2') }));
  assert.ok(!stopExplains(stop('SUBMISSION_UNKNOWN'), { code: 'no_answer_in_scene', shotId: shotId('3.1') }));
  assert.ok(stopExplains(stop('NARRATION_CUE_OUT_OF_RANGE', null), { code: 'narration_too_long', shotId: shotId('3.1') }), 'a stop with no shot covers any too-long line');
  assert.ok(!stopExplains(stop('NARRATION_SPEECH_FAILED'), { code: 'frame_not_opened', shotId: shotId('3.2') }));
  assert.ok(!stopExplains(stop('EXECUTION_PAUSED'), { code: 'director_working' }));
});

test('a confirm the stopped film cut short says to continue the film, and only to confirm again once it runs', () => {
  const overview = stoppedScene3({ code: 'EXECUTION_PAUSED', shotId: shotId('3.2') });
  overview.stopped = { stopId: 'stop-1', at: '2026-10-15T10:00:00Z', sentJobs: 0, detachedJobs: 1 };
  scene(overview, 3).blockers = [{ code: 'stopped' }];
  let panel = videoPanel(overview, scene(overview, 3), 'en-US');
  assert.deepEqual([en(panel.stopped.next), panel.reason], ['Continue the film, then confirm again.', null], 'the stopped film is the stop\'s own blocker');
  // Continued: confirm again; a Director now working on the scene is said under the button.
  overview.stopped = null;
  scene(overview, 3).blockers = [{ code: 'director_working' }];
  panel = videoPanel(overview, scene(overview, 3), 'en-US');
  assert.deepEqual([en(panel.stopped.next), en(panel.reason)], ['The film runs again: confirm again.', 'The Director is working on this scene']);
  assert.equal(zh(panel.stopped.next), '影片已继续，请再确认一次。');
});

// ---- moving through the whole film ----------------------------------------------------------------------

test('the stage moves through the whole film in scene order, across scene boundaries, with a "3 / 8" counter', () => {
  const overview = lastFerryOverview();
  assert.deepEqual(filmShotOrder(overview), ['1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '3.1', '3.2'].map(shotId));
  // Scenes in ordinal order even if listed otherwise.
  const shuffled = { ...overview, scenes: [overview.scenes[2], overview.scenes[0], overview.scenes[1]] };
  assert.deepEqual(filmShotOrder(shuffled), filmShotOrder(overview));
  assert.deepEqual(shotPosition(overview, shotId('1.3')), { index: 3, total: 8, previous: { shotId: shotId('1.2'), label: '1.2' }, next: { shotId: shotId('2.1'), label: '2.1' } });
  assert.deepEqual([shotPosition(overview, shotId('1.1')).previous, shotPosition(overview, shotId('3.2')).next], [null, null]);
  assert.equal(shotPosition(overview, 'shot-9-9'), null);
  assert.equal(en({ id: 'preview.position', values: { index: 3, total: 8 } }), '3 / 8');
});

test('ArrowLeft / ArrowRight step through the film unless a modifier is held or a field or video owns the keys', () => {
  const none = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
  assert.equal(stageStep('ArrowLeft', none, false), -1);
  assert.equal(stageStep('ArrowRight', none, false), 1);
  assert.equal(stageStep('ArrowUp', none, false), null);
  assert.equal(stageStep('Enter', none, false), null);
  for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) assert.equal(stageStep('ArrowRight', { ...none, [key]: true }, false), null, key);
  assert.equal(stageStep('ArrowRight', none, true), null);
  for (const owner of ['input', 'textarea', 'select', 'video', 'audio', '[role="slider"]', '[contenteditable]']) assert.ok(ARROW_OWNERS.includes(owner), owner);
});

test('an open inspector edit keeps its shot: moving to another shot is off and says why', () => {
  const overview = lastFerryOverview();
  assert.equal(editHold(null, overview), null);
  const edit = { shotId: shotId('2.3'), field: 'motion', value: 'Slow tilt down' };
  assert.equal(en(editHold(edit, overview)), 'Save or cancel the edit to 2.3 first', 'Previous / Next and the arrow keys');
  assert.equal(zh(editHold(edit, overview)), '请先保存或取消对 2.3 的修改');
  assert.equal(en(editHold(edit, overview, shotId('2.1'))), 'Save or cancel the edit to 2.3 first', 'Edit 2.1 in Plan would select 2.1');
  assert.equal(editHold(edit, overview, shotId('2.3')), null, 'Edit 2.3 in Plan keeps the edit');
  assert.equal(editHold({ shotId: 'shot-9-9' }, overview), null, 'a shot that is gone holds nothing');
});

test('the Video side plays the current clip, else the earlier one an edit replaced; none without a clip', () => {
  const overview = lastFerryOverview();
  assert.deepEqual(shotClip(shot(overview, '1.1')), { artifact: shot(overview, '1.1').video.artifact, earlier: false });
  assert.equal(shotClip(shot(overview, '2.1')), null);
  const clip = shot(overview, '1.2').video.artifact;
  shot(overview, '1.2').video = { state: 'outdated', previous: clip, takeCount: 1, outdatedFields: ['motion'] };
  assert.deepEqual(shotClip(shot(overview, '1.2')), { artifact: clip, earlier: true });
  // A previous keyframe is not a clip.
  shot(overview, '1.2').video = { state: 'failed', previous: shot(overview, '1.2').keyframe.artifact, takeCount: 1 };
  assert.equal(shotClip(shot(overview, '1.2')), null);
});

// ---- the takes strip --------------------------------------------------------------------------------------

const takes = (overview, label) => ({
  shotId: shotId(label),
  keyframes: [
    { artifact: { artifactId: `art-${label}~3`, sha256: 'c'.repeat(64), kind: 'image' }, current: true, createdAt: '2026-10-15T10:44:00', selectable: true },
    { artifact: { artifactId: `art-${label}~2`, sha256: 'b'.repeat(64), kind: 'image' }, current: false, createdAt: '2026-10-14T09:05:00', selectable: true },
    { artifact: { artifactId: `art-${label}`, sha256: 'a'.repeat(64), kind: 'image' }, current: false, createdAt: 'not a time', selectable: true },
  ],
});

test('the takes strip numbers every take from the oldest, marks the one in use and says when each was made', () => {
  const overview = lastFerryOverview();
  const strip = takesStrip(takes(overview, '2.1'), overview, shot(overview, '2.1'), new Date('2026-10-15T12:00:00'), 'en');
  assert.deepEqual(strip.items.map(i => [i.take, i.current, en(i.label), i.made && en(i.made)]),
    [[3, true, 'Take 3', 'Today 10:44'], [2, false, 'Take 2', '14 Oct 09:05'], [1, false, 'Take 1', 'not a time']]);
  assert.equal(en(strip.impact), 'Using an earlier take is free. The take in use now is kept.');
  assert.equal(strip.blocked, null);
  assert.equal(zh(strip.items[1].label), '版本 2');
  assert.equal(takesPath('shot 1/2'), '/shots/shot%201%2F2/takes');
});

test('using an earlier take is free; with a finished clip it says the clip must be made again and its price', () => {
  const overview = lastFerryOverview();
  assert.equal(en(takeImpact(overview, shot(overview, '1.1'), 'en-US')), 'Using an earlier take is free, but 1.1\'s clip goes out of date; making it again costs about $0.50.');
  // No clip price anywhere: never $0.00.
  for (const s of overview.scenes) delete s.quotes.oneClip;
  assert.equal(en(takeImpact(overview, shot(overview, '1.1'), 'en-US')), 'Using an earlier take is free, but 1.1\'s clip goes out of date and needs making again.');
  const unknown = lastFerryOverview();
  scene(unknown, 1).quotes.oneClip = { micros: '0', units: 1, unitMicros: '0', priceUnknown: true };
  assert.ok(!en(takeImpact(unknown, shot(unknown, '1.1'), 'en-US')).includes('$0.00'));
});

test('the takes strip keeps unsupported takes visible without offering to restore them', () => {
  const overview = lastFerryOverview();
  const read = takes(overview, '2.1');
  read.keyframes[1].selectable = false;
  // A malformed or older response without an explicit selection flag grants no restore capability.
  delete read.keyframes[2].selectable;
  const strip = takesStrip(read, overview, shot(overview, '2.1'), new Date('2026-10-15T12:00:00'), 'en');
  assert.equal(strip.items.length, 3);
  assert.deepEqual(strip.items.map((item) => item.selectable), [true, false, false]);
});

test('no take is switched while the shot\'s keyframe or clip is being made, or its keyframe job has no answer', () => {
  const overview = lastFerryOverview();
  const s = shot(overview, '2.1');
  s.keyframe = { ...s.keyframe, state: 'running' };
  assert.equal(en(takeBlocked(s)), 'Wait for this shot\'s keyframe job to finish before switching takes.');
  s.keyframe = { ...s.keyframe, state: 'no_answer', attemptId: 'a-1' };
  assert.ok(takeBlocked(s));
  s.keyframe = { ...s.keyframe, state: 'ready' };
  s.video = { state: 'queued', takeCount: 0 };
  assert.ok(takeBlocked(s));
  s.video = { state: 'none', takeCount: 0 };
  assert.equal(takeBlocked(s), null);
});

test('"Use this take" is one press per shot keyed by the take, and its toast carries the studio\'s Undo command', () => {
  const command = useTakeCommand('shot-2-1', 'art-2.1~2');
  assert.deepEqual(command, { pressId: 'take:shot-2-1', logical: { kind: 'use-take', shotId: 'shot-2-1', artifactId: 'art-2.1~2' }, path: '/shots/shot-2-1/takes/art-2.1~2/use', body: {} });
  assert.equal(useTakeCommand('a/b', 'c d').path, '/shots/a%2Fb/takes/c%20d/use');
  const overview = lastFerryOverview();
  const receipt = { shotId: shotId('2.1'), artifactId: 'art-2.1', commandId: 'cmd-9' };
  const plain = takeUsedToast(shot(overview, '2.1'), { take: 1 }, receipt);
  assert.deepEqual([en(plain.message), plain.undoCommandId], ['2.1 now uses take 1.', 'cmd-9']);
  assert.equal(en(takeUsedToast(shot(overview, '1.1'), { take: 1 }, receipt).message), '1.1 now uses take 1; its clip needs making again.');
});

// ---- the prompts -------------------------------------------------------------------------------------

test('the inspector carries the full picture prompt and the video prompt read from the snapshot', () => {
  const overview = lastFerryOverview();
  const view = inspectorView(overview, shot(overview, '2.3'), 'en-US', undefined, null, 'The ticket. Slow tilt down.');
  assert.deepEqual(view.prompts, { image: shot(overview, '2.3').imagePrompt, video: 'The ticket. Slow tilt down.' });
  assert.equal(inspectorView(overview, shot(overview, '2.3'), 'en-US').prompts.video, null, 'not read yet');
});

test('the inspector keeps recording take origin alongside full prompts and a stopped confirmation', () => {
  const overview = stoppedScene3({ code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: shotId('3.2') });
  const selected = shot(overview, '3.2');
  Object.assign(selected.narration, { state: 'ready', measuredSeconds: 8.4, fits: false });
  const prompt = 'The ferry leaves the pier. Slow pan left.';
  for (const [origin, expected] of [
    ['recording', '8.4 s'],
    ['voice', 'not added yet · the voice line plays (8.4 s)'],
  ]) {
    const view = inspectorView(overview, selected, 'en-US', 'uploaded', origin, prompt);
    const narration = view.rows.find((row) => row.key === 'narration');
    assert.equal(en(narration.value), 'Your recording');
    assert.equal(en(narration.notes[0].message), expected);
    assert.deepEqual(view.prompts, { image: selected.imagePrompt, video: prompt });
    assert.equal(en(view.stopped.reason), 'The 3.2 voice line came out at 8.4 s, longer than its shot.');
  }
});

test('Edit in Plan opens Plan with the shot focused in one step; Plan handles that focus when it opens, once', () => {
  const overview = lastFerryOverview();
  let state = { ...initialState, projectId: 'last-ferry', overview, focus: { kind: 'shot', id: shotId('1.1'), nonce: 4 } };
  state = reducer(state, { type: 'focus', kind: 'shot', id: shotId('2.3'), view: 'plan' });
  assert.deepEqual([state.view, state.shotId, state.sceneId], ['plan', shotId('2.3'), sceneId(2)]);
  assert.deepEqual(state.focus, { kind: 'shot', id: shotId('2.3'), nonce: 5, view: 'plan' }, 'marked for Plan, with a new nonce');
  // Staying in Plan keeps the mark; going elsewhere makes it an ordinary focus, so Plan opened later does not flash again.
  assert.equal(reducer(state, { type: 'view', view: 'plan' }).focus.view, 'plan');
  const left = reducer(state, { type: 'view', view: 'keyframes' });
  assert.deepEqual(left.focus, { kind: 'shot', id: shotId('2.3'), nonce: 5 });
  // A focus without a view (a Director note's "Open 2.2") leaves the view alone.
  const note = reducer(left, { type: 'focus', kind: 'shot', id: shotId('2.2') });
  assert.deepEqual([note.view, note.focus], ['keyframes', { kind: 'shot', id: shotId('2.2'), nonce: 6 }]);
});

// ---- a paid press whose reply was lost ---------------------------------------------------------------------

test('paid presses: their ids map back to the press as it would be sent now', () => {
  const overview = lastFerryOverview();
  const s2 = scene(overview, 2);
  for (const press of [confirmPress(overview, s2), keyframesPress(overview, scene(overview, 3)), keyframesPress(overview, s2, [shotId('2.2')], true), keyframesPress(overview, s2, [shotId('2.2'), shotId('2.3')], true)]) {
    assert.ok(PAID_PRESS.test(press.pressId), press.pressId);
    assert.deepEqual(pressFromId(overview, press.pressId), press);
  }
  assert.equal(pressFromId(overview, 'take:shot-2-1'), null);
  assert.equal(pressFromId(overview, 'confirm:scene-9'), null);
  assert.equal(pressFromId(overview, `regenerate:${shotId('2.2')},shot-9-9`), null);
  assert.equal(pressFromId(overview, 'nocolon'), null);
  assert.ok(!PAID_PRESS.test('take:shot-2-1') && !PAID_PRESS.test('edit:shot:x') && !PAID_PRESS.test('frame-view:x'));
});

/** Saved presses of one film, keyed k-1, k-2… */
function pressKeys() {
  let n = 0;
  const keys = new PressKeys('last-ferry', null, () => `k-${++n}`);
  return { keys, wouldResend: (press) => keys.saved(press.pressId)?.logical === canonicalJson(press.logical) };
}

test('a lost Confirm holds until the film shows its confirmation; after it stops, "confirm again" is a new request', () => {
  const { keys, wouldResend } = pressKeys();
  const before = readyScene3();
  const press = confirmPress(before, scene(before, 3));
  const sent = keys.begin(press.pressId, press.logical, { path: '/x', body: {} });
  assert.equal(lostReplyHolds(before, keys.ids(), wouldResend), true, 'nothing shows yet: pressing again resends it');
  // It landed: the studio's new confirmation voices 3.2's line, and its clips wait. Nothing to press meanwhile.
  const running = readyScene3();
  Object.assign(scene(running, 3), { state: 'making_video', confirmation: { confirmationId: 'c-7', state: 'running', currentShotId: shotId('3.2'), currentStep: 'speech' } });
  for (const label of ['3.1', '3.2']) shot(running, label).video = { state: 'queued', takeCount: 0, waiting: { code: 'voice', since: '2026-10-15T10:00:00Z' } };
  assert.equal(lostReplyHolds(running, keys.ids(), wouldResend), false);
  assert.equal(videoPanel(running, scene(running, 3), 'en-US').action, null);
  // It stopped: Confirm is offered again, with no "Not confirmed", and pressing it starts a new confirm (a new key).
  const stopped = stoppedScene3({ code: 'NARRATION_SPEECH_FAILED', shotId: shotId('3.2') });
  scene(stopped, 3).confirmation.confirmationId = 'c-7';
  assert.equal(lostReplyHolds(stopped, keys.ids(), wouldResend), false);
  const panel = videoPanel(stopped, scene(stopped, 3), 'en-US');
  assert.deepEqual([panel.action, panel.enabled], ['confirm', true]);
  const again = confirmPress(stopped, scene(stopped, 3));
  assert.equal(wouldResend(again), false);
  assert.notEqual(keys.begin(again.pressId, again.logical, { path: '/x', body: {} }).key, sent.key);
  // A confirm pressed after an earlier stop names that one: until a newer confirmation shows, it is resent as it was.
  const later = keys.begin(again.pressId, again.logical, { path: '/x', body: {} });
  assert.equal(keys.begin(again.pressId, confirmPress(stopped, scene(stopped, 3)).logical, {}).key, later.key);
});

test('a lost Make keyframes holds until a target keyframe shows its job; after it fails or is taken off, it is a new request', () => {
  const { keys, wouldResend } = pressKeys();
  const before = lastFerryOverview();
  const press = keyframesPress(before, scene(before, 3));
  const sent = keys.begin(press.pressId, press.logical, { path: '/x', body: {} });
  assert.equal(lostReplyHolds(before, keys.ids(), wouldResend), true);
  // It landed: 3.1 is being made, 3.2 waits its turn. The panel has nothing to press.
  const running = lastFerryOverview();
  shot(running, '3.1').keyframe = { state: 'running', attemptId: 'attempt-1', startedAt: '2026-10-15T10:00:00Z', takeCount: 0, opened: false };
  shot(running, '3.2').keyframe = { state: 'queued', takeCount: 0, opened: false, waiting: { code: 'capacity', ahead: 1, since: '2026-10-15T10:00:00Z' } };
  assert.equal(lostReplyHolds(running, keys.ids(), wouldResend), false);
  assert.equal(videoPanel(running, scene(running, 3), 'en-US').action, null);
  // 3.1 failed and the film's Stop took 3.2 off: Make keyframes is offered again, and pressing it is a new request.
  const ended = lastFerryOverview();
  shot(ended, '3.1').keyframe = { state: 'failed', takeCount: 0, opened: false, failure: { code: 'EXECUTION_FAILED', technical: false, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: '2026-10-15T10:01:00Z' } };
  shot(ended, '3.2').keyframe = { state: 'none', takeCount: 0, opened: false, takenOff: 'stopped' };
  assert.equal(lostReplyHolds(ended, keys.ids(), wouldResend), false);
  const panel = videoPanel(ended, scene(ended, 3), 'en-US');
  assert.deepEqual([panel.action, panel.enabled], ['make_keyframes', true]);
  const again = keyframesPress(ended, scene(ended, 3));
  assert.equal(wouldResend(again), false);
  assert.notEqual(keys.begin(again.pressId, again.logical, { path: '/x', body: {} }).key, sent.key);
  // A second failure of the same shot is another job: it does not read as the first one.
  const twice = structuredClone(ended);
  shot(twice, '3.1').keyframe.failure.at = '2026-10-15T10:05:00Z';
  assert.equal(wouldResend(keyframesPress(twice, scene(twice, 3))), false);
});

test('"Not confirmed" holds while pressing again would resend the saved request, and not once the film shows the job', () => {
  const overview = lastFerryOverview();
  const keys = new PressKeys('last-ferry', null, () => 'k-1');
  const wouldResend = (press) => keys.saved(press.pressId)?.logical === canonicalJson(press.logical);
  const press = keyframesPress(overview, scene(overview, 2), [shotId('2.2')], true);
  assert.equal(lostReplyHolds(overview, keys.ids(), wouldResend), false, 'nothing sent');
  keys.begin(press.pressId, press.logical, { path: '/x', body: {} });
  assert.equal(lostReplyHolds(overview, keys.ids(), wouldResend), true);
  // The job reached the studio: the keyframe is being made, so the press would now be a new request.
  const started = lastFerryOverview();
  shot(started, '2.2').keyframe = { state: 'running', previous: shot(started, '2.2').keyframe.artifact, takeCount: 1, opened: false };
  assert.equal(lostReplyHolds(started, keys.ids(), wouldResend), false);
  // The studio answered: the key is settled.
  keys.settle(press.pressId);
  assert.equal(lostReplyHolds(overview, keys.ids(), wouldResend), false);
  // A free press with no reply is not a paid one.
  keys.begin('take:shot-2-1', { kind: 'use-take' }, {});
  assert.equal(lostReplyHolds(overview, keys.ids(), () => true), false);
  assert.equal(en({ id: 'error.PAID_UNCONFIRMED' }), 'Not confirmed. Press again to check; it will not charge twice.');
  assert.equal(zh({ id: 'error.PAID_UNCONFIRMED' }), '未确认。再按一次即可核实，不会重复计费。');
});
