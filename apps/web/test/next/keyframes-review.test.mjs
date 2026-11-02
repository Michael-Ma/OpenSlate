import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, lastFerryNotes, shotId, sceneId } from '../../src/next/fixtures/last-ferry.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { noteViews } from '../../src/next/model/notes.ts';
import { noteCallout, regeneratePrice } from '../../src/next/model/note-banner.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { keyframesView } from '../../src/next/model/keyframes.ts';
import { canStop } from '../../src/next/model/director.ts';
import { stopPreview } from '../../src/next/model/shell-states.ts';
import { keyframeEstimate } from '../../src/next/model/price.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const quote = micros => ({ micros, unitMicros: micros, units: 1, priceUnknown: false });

test('B17 #1: each card purchase names the exact selected-shot total even when another note occupies the banner', () => {
  const overview = lastFerryOverview();
  overview.shots[shotId('2.2')].quotes = { regenerateKeyframe: quote('65000') };
  const notes = noteViews(lastFerryNotes(), overview, []);
  const callout = noteCallout(notes.find(n => n.letter === 'a'), shotId('2.2'), overview, 'en-US');
  assert.equal(en(callout.regenerate.label), 'Regenerate 2.2 · about $0.07');
  assert.equal(zh(callout.regenerate.label), '重新生成 2.2 · 约 $0.07');
  assert.equal(en(callout.regenerate.price), 'about $0.07');
  // The card shows the short form of the same purchase, price included.
  assert.deepEqual([en(callout.regenerate.take), zh(callout.regenerate.take), zh(callout.regenerate.price)], ['New take', '新版本', '约 $0.07']);
  overview.shots[shotId('2.2')].quotes.regenerateKeyframe.priceUnknown = true;
  const unknown = noteCallout(notes.find(n => n.letter === 'a'), shotId('2.2'), overview, 'en-US');
  assert.equal(en(unknown.regenerate.label), 'Regenerate 2.2 · no price set');
  assert.equal(en(unknown.regenerate.price), 'no price set');
});

test('B17 #8: cards, scene pills and cross-view focus preserve every inspector field until Save or Cancel', async t => {
  const port = new FixturePort();
  const store = new StudioStore({ client: port, storage: null, newKey: () => 'key' });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  store.selectShot(shotId('2.2'));
  for (const field of ['imagePrompt', 'motion', 'narration']) {
    store.setEdit({ shotId: shotId('2.2'), field, value: `Unsaved ${field}` });
    const draft = store.getState().edit;
    for (const move of [() => store.selectShot(shotId('2.1')), () => store.selectScene(sceneId(3)), () => store.openShotIn('plan', shotId('3.1')), () => store.dispatch({ type: 'focus', kind: 'scene', id: sceneId(1) })]) {
      move();
      assert.equal(store.getState().shotId, shotId('2.2'), `${field} stays selected`);
      assert.deepEqual(store.getState().edit, draft, `${field} stays editable`);
    }
    store.selectShot(shotId('2.2'));
    assert.deepEqual(store.getState().edit, draft, 'opening the current card preserves its draft');
    store.selectScene(sceneId(2));
    assert.deepEqual(store.getState().edit, draft, 'opening the current scene preserves its draft');
    store.setEdit(null);
  }
  store.selectScene(sceneId(3));
  assert.equal(store.getState().sceneId, sceneId(3), 'Cancel releases the hold');
});

test('B17 #13: terminal keyframe failures offer a fresh human Make again with its exact price', () => {
  const overview = lastFerryOverview();
  const shot = overview.shots[shotId('2.2')];
  shot.quotes = { regenerateKeyframe: quote('55000') };
  for (const technical of [false, true]) for (const charged of [false, true]) {
    shot.keyframe = { state: 'failed', takeCount: 0, opened: false, failure: { code: 'GENERATION_FAILED', technical, charged, retryAllowed: false, autoRetriesLeft: 0, at: 'now' } };
    const result = inspectorView(overview, shot, 'en-US');
    assert.equal(result.regenerate.enabled, true);
    assert.equal(result.regenerate.primary, true);
    assert.equal(en(result.regenerate.label), 'Make again');
    assert.equal(en(result.regenerate.cost), 'About $0.06.');
    assert.equal(en(result.failure.message), charged ? 'Keyframe failed · counted as spent' : 'Keyframe failed · not charged');
  }
  shot.keyframe = { state: 'no_answer', takeCount: 0, opened: false, attemptId: 'unknown' };
  assert.equal(inspectorView(overview, shot, 'en-US').regenerate.enabled, false, 'an unknown outcome still requires reconciliation');
});

test('B17 #13: partial scenes offer their missing frames before blocked video confirmation', () => {
  const overview = lastFerryOverview(), scene = overview.scenes[1], missing = shotId('2.2');
  overview.shots[missing].keyframe = { state: 'failed', takeCount: 0, opened: false, failure: { code: 'X', technical: true, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: 'now' } };
  scene.state = 'needs_attention';
  scene.counts.keyframesReady = 2;
  scene.keyframeTargets = [missing];
  scene.quotes.makeKeyframes = quote('40000');
  scene.blockers = [{ code: 'keyframe_missing', shotId: missing }, { code: 'frame_not_opened', shotId: shotId('2.3') }];
  const panel = keyframesView(overview, scene.sceneId, missing, 'en-US').panel;
  assert.equal(panel.action, 'make_keyframes');
  assert.equal(panel.enabled, true);
  assert.equal(en(panel.label), 'Make 1 keyframe');
  assert.equal(en(panel.priceTotal), 'about $0.04');
  overview.stopped = { stopId: 's', at: 'now', sentJobs: 0, detachedJobs: 0 };
  scene.blockers.push({ code: 'stopped' });
  assert.equal(keyframesView(overview, scene.sceneId, missing, 'en-US').panel.enabled, false);
});

test('B17 #13: missing-frame purchases stay blocked while their earlier media outcome is unknown or speech is still working', () => {
  const overview = lastFerryOverview(), scene = overview.scenes[1], missing = shotId('2.2');
  scene.keyframeTargets = [missing];
  for (const code of ['no_answer_in_scene', 'narration_making', 'confirmation_running']) {
    scene.blockers = [{ code, shotId: missing }];
    const panel = keyframesView(overview, scene.sceneId, missing, 'en-US').panel;
    assert.equal(panel.enabled, false, code);
    assert.equal(panel.priceTotal, null, code);
    assert.ok(en(panel.reason), 'the blocked purchase explains why');
  }
});

test('B17 #14: Stop stays available for retained replacement work and narration work', () => {
  for (const kind of ['keyframe', 'video']) for (const state of ['queued', 'running']) {
    const overview = lastFerryOverview(), slot = overview.shots[shotId('2.2')][kind];
    Object.assign(slot, { state: 'ready', replacement: { state, attemptId: state === 'running' ? 'replacement' : undefined } });
    assert.equal(canStop(overview, null), true, `${kind} replacement ${state}`);
    assert.deepEqual(stopPreview(overview, null), { sent: state === 'running' ? 1 : 0, queued: state === 'queued' ? 1 : 0, director: false });
  }
  const overview = lastFerryOverview();
  overview.shots[shotId('2.2')].narration = { state: 'making', text: 'A new voice line.', fits: null };
  assert.equal(canStop(overview, null), true);
  assert.deepEqual(stopPreview(overview, null), { sent: 1, queued: 0, director: false });
  overview.shots[shotId('2.2')].keyframe.replacement = { state: 'no_answer', attemptId: 'replacement' };
  overview.shots[shotId('2.2')].keyframe.releasedAttemptIds = ['replacement', 'older-released'];
  assert.deepEqual(stopPreview(overview, null), { sent: 3, queued: 0, director: false }, 'sent narration, unanswered replacement and earlier released attempt each count once');
});

test('B17 #1/#11: regeneration prices sum selected quotes exactly without rounding each shot', () => {
  const overview = lastFerryOverview();
  overview.shots[shotId('2.1')].quotes = { regenerateKeyframe: quote('9007199254740993') };
  overview.shots[shotId('2.2')].quotes = { regenerateKeyframe: quote('1') };
  assert.deepEqual(keyframeEstimate([shotId('2.1'), shotId('2.2')], overview), { micros: '9007199254740994', priceUnknown: false });
  assert.equal(en(regeneratePrice([shotId('2.1'), shotId('2.2')], overview, 'en-US')), 'about $9,007,199,254.74');
  assert.equal(en(regeneratePrice([shotId('2.2'), shotId('2.2')], overview, 'en-US')), 'about $0.000001', 'a selected shot is purchased once');
});
