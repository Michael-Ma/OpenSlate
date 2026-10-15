import test from 'node:test';
import assert from 'node:assert/strict';
import { keyframesView, cardStatus, filmMeta } from '../../src/next/model/keyframes.ts';
import { narrationChecks, estimateNarrationSeconds } from '../../src/next/model/checks.ts';
import { priceMsg, formatMicros } from '../../src/next/model/price.ts';
import { lastFerryOverview, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);

test('the Last Ferry golden state opens on Scene 2 with the design\'s cards, check and disabled confirm', () => {
  const overview = lastFerryOverview();
  const view = keyframesView(overview, null, null, 'en-US');
  assert.equal(view.scene.sceneId, sceneId(2));
  assert.equal(view.header.title, 'Harbour at dawn');
  assert.deepEqual(view.pills.map(p => [p.ordinal, p.title, p.status && en(p.status), p.selected]),
    [[1, 'Closing time', 'video saved', false], [2, 'Harbour at dawn', null, true], [3, 'Departure', 'not started', false]]);
  assert.deepEqual(view.cards.map(c => [c.label, en(c.status), c.tone, c.seconds]),
    [['2.1', 'Opened', 'opened', 5], ['2.2', 'Not opened', 'not_opened', 4], ['2.3', 'Not opened', 'not_opened', 6]]);
  assert.equal(view.checks.length, 1);
  assert.equal(view.checks[0].check.label, '2.3');
  assert.equal(view.checks[0].check.fitSeconds, 8);
  assert.equal(view.cards[2].callouts[0].letter, 'a');
  const panel = view.panel;
  assert.equal(panel.action, 'confirm');
  assert.equal(panel.enabled, false);
  assert.equal(`${panel.openedCount}/${panel.targetCount}`, '1/3');
  assert.equal(en(panel.reason), 'Open 2.2 and 2.3 and settle 2.3 first');
  assert.equal(en(panel.note), 'Open 2.2 and 2.3 to confirm. Earlier keyframes are kept.');
  assert.equal(en(panel.headline.value), '1 of 3');
  assert.equal(en(panel.headline.unit), 'frames opened');
  assert.equal(panel.priceTotal, null, 'a blocked confirm shows no price');
});

test('confirm is enabled with its price once every frame is opened and the line fits', () => {
  const overview = lastFerryOverview();
  for (const id of overview.scenes[1].shotIds) overview.shots[id].keyframe.opened = true;
  overview.shots[shotId('2.3')].durationFrames = 8 * 30;
  overview.shots[shotId('2.3')].narration.fits = true;
  overview.scenes[1].blockers = [];
  const view = keyframesView(overview, sceneId(2), null, 'en-US');
  assert.equal(view.panel.enabled, true);
  assert.equal(en(view.panel.price), 'about $1.50 · 3 at about $0.50');
  assert.equal(en(view.panel.priceTotal), 'about $1.50');
  assert.equal(en(view.panel.priceEach), '3 clips at about $0.50');
  assert.equal(en(view.panel.note), 'Every frame is opened. Earlier keyframes are kept.');
  assert.equal(zh(view.panel.price), '约 $1.50 · 3 个，每个约 $0.50');
  assert.equal(view.checks.length, 0);
});

test('Scene 3 offers its keyframes with a price, and Scene 1 offers playback', () => {
  const overview = lastFerryOverview();
  const three = keyframesView(overview, sceneId(3), null, 'en-US').panel;
  assert.equal(three.action, 'make_keyframes');
  assert.equal(en(three.label), 'Make 2 keyframes');
  assert.equal(en(three.price), 'about $0.08 · 2 at about $0.04');
  assert.equal(`${en(three.label)} · ${en(three.priceTotal)}`, 'Make 2 keyframes · about $0.08');
  assert.equal(en(three.eyebrow), 'Scene 3 keyframes');
  const one = keyframesView(overview, sceneId(1), null, 'en-US').panel;
  assert.equal(one.action, 'play');
  assert.equal(en(one.label), 'Play Scene 1');
});

test('card status covers the states the scene view could not show before', () => {
  const base = lastFerryOverview().shots[shotId('2.2')];
  const variant = patch => cardStatus({ ...base, keyframe: { ...base.keyframe, ...patch.keyframe }, video: { ...base.video, ...patch.video } });
  assert.equal(en(variant({ keyframe: { state: 'running' } }).status), 'Making keyframe…');
  assert.equal(en(variant({ keyframe: { state: 'queued', waiting: { code: 'capacity', ahead: 2, since: 'x' } } }).status), 'Queued · 2 ahead');
  assert.equal(en(variant({ keyframe: { state: 'failed', failure: { code: 'X', technical: true, retryAllowed: true, autoRetriesLeft: 0, charged: true, at: 'x' } } }).status), 'Keyframe failed · counted as spent');
  assert.equal(en(variant({ keyframe: { state: 'failed', failure: { code: 'X', technical: false, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: 'x' } } }).status), 'Keyframe failed · not charged');
  assert.equal(en(variant({ keyframe: { state: 'no_answer' } }).status), 'No answer from the service');
  assert.equal(en(variant({ keyframe: { state: 'outdated', previous: base.keyframe.artifact } }).status), 'Keyframe out of date');
  assert.equal(en(variant({ keyframe: { state: 'running' }, video: { state: 'ready' } }).status), 'Making keyframe…', 'a keyframe being remade wins over its saved clip');
  assert.equal(en(variant({ video: { state: 'running' } }).status), 'Making video…');
  assert.equal(variant({ keyframe: { state: 'outdated', previous: base.keyframe.artifact } }).tone, 'attention');
});

test('the reason names the first kind of blocker for every shot it applies to', () => {
  const overview = lastFerryOverview();
  overview.shots[shotId('2.2')].keyframe.opened = true;
  overview.scenes[1].blockers = [{ code: 'frame_not_opened', shotId: shotId('2.3') }];
  assert.equal(en(keyframesView(overview, sceneId(2), null, 'en-US').panel.reason), 'Open 2.3 first');
  overview.scenes[1].blockers = [{ code: 'narration_too_long', shotId: shotId('2.3') }];
  assert.equal(en(keyframesView(overview, sceneId(2), null, 'en-US').panel.reason), 'Settle the narration in 2.3 first');
  assert.equal(zh(keyframesView(overview, sceneId(2), null, 'zh-CN').panel.reason), '请先处理 2.3 的旁白长度');
});

test('a long scene counts its unopened frames instead of naming every one', () => {
  const overview = lastFerryOverview();
  const scene = overview.scenes[1];
  scene.shotIds = [...scene.shotIds]; scene.videoTargets = [...scene.videoTargets];
  for (const label of ['2.4', '2.5', '2.6']) {
    const id = shotId(label);
    overview.shots[id] = { ...overview.shots[shotId('2.2')], shotId: id, label };
    scene.shotIds.push(id); scene.videoTargets.push(id);
    scene.blockers.splice(scene.blockers.length - 1, 0, { code: 'frame_not_opened', shotId: id });
  }
  const panel = keyframesView(overview, sceneId(2), null, 'en-US').panel;
  assert.equal(en(panel.reason), 'Open 5 frames and settle 2.3 first');
  assert.equal(en(panel.note), 'Open the 5 frames still unopened to confirm. Earlier keyframes are kept.');
  assert.equal(panel.segments.length, 6);
});

test('a scene whose keyframes are being made says so instead of offering a confirm', () => {
  const overview = lastFerryOverview();
  for (const id of overview.scenes[2].shotIds) overview.shots[id].keyframe = { state: 'running', takeCount: 0, opened: false };
  overview.scenes[2].keyframeTargets = [];
  const panel = keyframesView(overview, sceneId(3), null, 'en-US').panel;
  assert.equal(panel.action, null);
  assert.equal(panel.enabled, false);
  assert.equal(en(panel.label), 'Making keyframes…');
  const cards = keyframesView(overview, sceneId(3), null, 'en-US').cards;
  assert.deepEqual(cards.map(c => [c.workingOn, c.working]), [['keyframe', true], ['keyframe', true]]);
});

test('a queued clip shows its place in line but no progress bar', () => {
  const overview = lastFerryOverview();
  overview.shots[shotId('2.2')].video = { state: 'queued', takeCount: 0, waiting: { code: 'capacity', ahead: 0, since: 'x' } };
  const card = keyframesView(overview, sceneId(2), null, 'en-US').cards[1];
  assert.equal(en(card.status), 'Queued · next');
  assert.equal(card.workingOn, null);
  assert.equal(card.working, true);
});

test('outdated cards show the previous take dimmed', () => {
  const overview = lastFerryOverview();
  const shot = overview.shots[shotId('2.2')];
  overview.shots[shotId('2.2')] = { ...shot, keyframe: { ...shot.keyframe, state: 'outdated', previous: shot.keyframe.artifact, artifact: undefined, outdatedFields: ['imagePrompt'] } };
  const card = keyframesView(overview, sceneId(2), shotId('2.2'), 'en-US').cards[1];
  assert.equal(card.picture.artifactId, shot.keyframe.artifact.artifactId);
  assert.equal(card.pictureDimmed, true);
  assert.equal(card.selected, true);
});

test('narration checks use the measured line, or a labelled estimate, and settle once a fit is chosen', () => {
  const shots = Object.values(lastFerryOverview().shots);
  assert.deepEqual(narrationChecks(shots, 30).map(c => [c.label, c.lineSeconds, c.shotSeconds, c.estimated]), [['2.3', 7.4, 6, false]]);
  const settled = shots.map(s => s.label === '2.3' ? { ...s, narration: { ...s.narration, fit: 'cut_to_shot' } } : s);
  assert.equal(narrationChecks(settled, 30).length, 0);
  assert.equal(estimateNarrationSeconds('It was the last boat of the season'), 2.4);
  assert.equal(estimateNarrationSeconds('我没有回头'), 1.5);
});

test('prices never print $0.00 and keep sub-cent amounts', () => {
  assert.equal(en(priceMsg({ micros: '0', units: 1, unitMicros: '0', priceUnknown: true }, 'en-US')), 'no price set');
  assert.equal(en(priceMsg({ micros: '0', units: 2, unitMicros: '0', priceUnknown: false }, 'en-US')), 'no price set');
  assert.equal(formatMicros('4000', 'en-US'), '$0.004');
  assert.equal(formatMicros('1500000', 'zh-CN'), '$1.50');
  assert.equal(en(priceMsg({ micros: '1560000', units: 4, unitMicros: '0', priceUnknown: false }, 'en-US')), 'about $1.56');
  assert.equal(en(priceMsg({ micros: '40000', units: 1, unitMicros: '40000', priceUnknown: false }, 'en-US')), 'about $0.04');
});

test('film meta sums every shot', () => {
  assert.deepEqual(filmMeta(lastFerryOverview()), { seconds: 48, scenes: 3, shots: 8, fps: 30 });
});
