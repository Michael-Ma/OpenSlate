import test from 'node:test';
import assert from 'node:assert/strict';
import {
  narrationChecks, checkTimeline, settledTimeline, checkActions, checkTitle, checkCallout,
  lineEstimate, lineEstimateMsg, narrationPace, estimateNarrationSeconds, speechUnits,
} from '../../src/next/model/checks.ts';
import { clock } from '../../src/next/model/motion.ts';
import { lastFerryOverview, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const golden = () => lastFerryOverview();
const checkFor = (overview, label) => narrationChecks(Object.values(overview.shots), overview.fps).find(c => c.label === label);
const row = segments => segments.map(s => [en(s.text), s.kind, s.seconds, s.hot]);

test('the Now / After strip shows the shot before, the shot, and Scene 3 starting later', () => {
  const overview = golden();
  const timeline = checkTimeline(checkFor(overview, '2.3'), overview);
  assert.deepEqual(row(timeline.now), [['2.2 · 4 s', 'shot', 4, false], ['2.3 · 6 s', 'shot', 6, false], ['Scene 3', 'tail', 0, false]]);
  assert.deepEqual(row(timeline.after), [['2.2 · 4 s', 'shot', 4, false], ['2.3 · 8 s', 'shot', 8, true], ['Scene 3 · 2 s later', 'tail', 0, false]]);
  assert.equal(zh(timeline.after[2].text), '第 3 场 · 推后 2 秒');
});

test('the strip ends with the next shot, or the end of the film, when there is no next scene', () => {
  const overview = golden();
  // A too-long line on 2.1: no shot before it, and 2.2 follows inside the scene.
  overview.shots[shotId('2.1')].narration = { state: 'ready', text: 'A long line', measuredSeconds: 6.2, fits: false };
  const first = checkTimeline(checkFor(overview, '2.1'), overview);
  assert.deepEqual(first.now.map(s => en(s.text)), ['2.1 · 5 s', '2.2']);
  assert.deepEqual(first.after.map(s => en(s.text)), ['2.1 · 7 s', '2.2 · 2 s later']);
  // The last shot of the film.
  overview.shots[shotId('3.2')].narration = { state: 'ready', text: 'Long', measuredSeconds: 9.1, fits: false };
  const last = checkTimeline(checkFor(overview, '3.2'), overview);
  assert.deepEqual(last.after.map(s => en(s.text)), ['3.1 · 8 s', '3.2 · 10 s', 'Ends 2 s later']);
});

test('after the change, the strip says when what follows now starts', () => {
  const overview = golden();
  overview.shots[shotId('2.3')].durationFrames = 8 * 30;
  assert.deepEqual(settledTimeline(shotId('2.3'), overview, clock).map(s => [en(s.text), s.hot]),
    [['2.2 · 4 s', false], ['2.3 · 8 s', true], ['Scene 3 · from 0:34', false]]);
});

test('the check offers the fitting length in frames, an unavailable Keep with its reason, and Edit narration', () => {
  const overview = golden();
  const check = checkFor(overview, '2.3');
  const actions = checkActions(check, 30);
  assert.deepEqual(actions.extend && { seconds: actions.extend.seconds, frames: actions.extend.frames, label: en(actions.extend.label) }, { seconds: 8, frames: 240, label: 'Make 2.3 8 s' });
  assert.equal(en(actions.keep.label), 'Keep 6 s');
  assert.equal(actions.keep.available, false);
  assert.ok(en(actions.keep.reason).length > 0);
  assert.equal(zh(actions.extend.label), '把 2.3 改为 8 秒');
  // A line longer than any allowed shot cannot be fixed by lengthening.
  const long = { ...check, lineSeconds: 16.2, fitSeconds: 15 };
  assert.equal(checkActions(long, 30).extend, null);
});

test('titles and card chips say when a length is only an estimate', () => {
  const check = checkFor(golden(), '2.3');
  assert.equal(en(checkTitle(check)), 'Narration 7.4 s, shot 6 s');
  assert.equal(en(checkCallout({ ...check, estimated: true })), 'Narration about 7.4 s, shot 6 s');
});

test('the live estimate runs at the recorded voice pace, so the unchanged line keeps its measured length', () => {
  const shot = golden().shots[shotId('2.3')];
  assert.equal(speechUnits(shot.narration.text), 13);
  assert.deepEqual(lineEstimate(shot.narration.text, shot, 30), { seconds: 7.4, calibrated: true, fits: false, shotSeconds: 6 });
  const shorter = lineEstimate('It was the last boat, and I nearly missed it.', shot, 30);
  assert.deepEqual(shorter, { seconds: 5.7, calibrated: true, fits: true, shotSeconds: 6 });
  assert.equal(en(lineEstimateMsg(shorter)), "About 5.7 s at the recorded voice's pace (an estimate) · fits 6 s");
  assert.equal(zh(lineEstimateMsg(shorter)), '按已录配音的语速约 5.7 秒（估算）· 放得进 6 秒');
});

test('without a known length the estimate uses the default pace, for words and for Chinese characters', () => {
  assert.deepEqual(narrationPace({ text: 'Hello there', measuredSeconds: undefined, estimatedSeconds: undefined }), { secondsPerUnit: 0.3, calibrated: false });
  const shot = { narration: { state: 'none', text: '', fits: true }, durationFrames: 90 };
  const estimate = lineEstimate('我没有回头，船已经开了', shot, 30);
  assert.equal(estimate.seconds, estimateNarrationSeconds('我没有回头，船已经开了'));
  assert.equal(estimate.calibrated, false);
  assert.equal(en(lineEstimateMsg(estimate)), `About ${estimate.seconds} s (an estimate) · fits 3 s`);
});
