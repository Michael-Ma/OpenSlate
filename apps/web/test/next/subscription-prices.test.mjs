import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, lastFerryNotes, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { priceMsg, keyframeEstimate } from '../../src/next/model/price.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { keyframesView } from '../../src/next/model/keyframes.ts';
import { noteViews } from '../../src/next/model/notes.ts';
import { noteBanner, noteCallout, regeneratePrice } from '../../src/next/model/note-banner.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = message => translateMsg('en', message);
const zh = message => translateMsg('zh-CN', message);
const codex = (micros = '0', priceUnknown = false, units = 1) => ({ micros, unitMicros: units === 1 ? micros : '0', units, priceUnknown, subscription: 'codex' });

test('B22: subscription quotes say Codex plan in both languages, preserving mixed per-call estimates and unknown prices', () => {
  assert.equal(en(priceMsg(codex(), 'en-US')), 'uses your Codex plan');
  assert.equal(zh(priceMsg(codex(), 'zh-CN')), '使用你的 Codex 订阅');
  assert.equal(en(priceMsg(codex('30000', false, 2), 'en-US')), 'about $0.03 · uses your Codex plan');
  assert.equal(zh(priceMsg(codex('30000', false, 2), 'zh-CN')), '约 $0.03 · 使用你的 Codex 订阅');
  assert.equal(en(priceMsg(codex('0', true, 2), 'en-US')), 'no price set for other models · uses your Codex plan');
  assert.equal(zh(priceMsg(codex('0', true, 2), 'zh-CN')), '其他模型未设置价格 · 使用你的 Codex 订阅');
  assert.equal(en(priceMsg({ micros: '0', unitMicros: '0', units: 1, priceUnknown: true }, 'en-US')), 'no price set');
});

test('B22: selected-shot totals preserve subscription identity without treating zero subscription cost as unknown', () => {
  const overview = lastFerryOverview();
  const ids = [shotId('2.1'), shotId('2.2')];
  overview.shots[ids[0]].quotes = { regenerateKeyframe: codex() };
  overview.shots[ids[1]].quotes = { regenerateKeyframe: codex('30000', false, 2) };
  assert.deepEqual(keyframeEstimate([ids[0], ids[0]], overview), { micros: '0', priceUnknown: false, subscription: 'codex' });
  assert.deepEqual(keyframeEstimate(ids, overview), { micros: '30000', priceUnknown: false, subscription: 'codex' });
  overview.shots[ids[1]].quotes.regenerateKeyframe = { micros: '0', unitMicros: '0', units: 1, priceUnknown: true };
  assert.deepEqual(keyframeEstimate(ids, overview), { micros: '0', priceUnknown: true, subscription: 'codex' });
});

test('B22: inspector first make and regeneration show subscription use and a still-needed voice price', () => {
  const overview = lastFerryOverview();
  for (const [label, cost] of [['2.2', '0'], ['3.2', '30000']]) {
    const shot = overview.shots[shotId(label)];
    shot.quotes = { regenerateKeyframe: codex(cost) };
    const result = inspectorView(overview, shot, 'en-US');
    assert.equal(en(result.regenerate.cost), cost === '0' ? 'uses your Codex plan' : 'about $0.03 · uses your Codex plan');
    assert.equal(zh(result.regenerate.cost), cost === '0' ? '使用你的 Codex 订阅' : '约 $0.03 · 使用你的 Codex 订阅');
  }
});

test('B22: scene keyframe panel shows subscription use for one or many frames, and mixed voice pricing', () => {
  const overview = lastFerryOverview(), scene = overview.scenes[2], id = scene.shotIds[0];
  for (const quote of [codex(), codex('0', false, 2), codex('30000', false, 3)]) {
    scene.quotes.makeKeyframes = quote;
    const panel = keyframesView(overview, scene.sceneId, id, 'en-US').panel;
    assert.equal(panel.action, 'make_keyframes');
    assert.equal(en(panel.price), en(priceMsg(quote, 'en-US')));
    assert.equal(en(panel.priceTotal), en(priceMsg(quote, 'en-US')));
    if (quote.units > 2) {
      assert.equal(en(panel.priceEach), '2 keyframes and 1 voice line');
      assert.equal(zh(panel.priceEach), '2 张关键帧和 1 条配音');
    } else assert.equal(panel.priceEach, null, 'subscription work never assigns a voice price to each keyframe');
  }
});

test('B22: note link and banner preserve subscription and mixed voice prices in English and Chinese', () => {
  const overview = lastFerryOverview(), id = shotId('2.2');
  for (const quote of [codex(), codex('30000', false, 2), codex('0', true, 2)]) {
    overview.shots[id].quotes = { regenerateKeyframe: quote };
    const note = noteViews(lastFerryNotes(), overview, []).find(note => note.letter === 'a');
    for (const locale of ['en-US', 'zh-CN']) {
      const text = locale === 'en-US' ? en : zh;
      const expected = text(priceMsg(quote, locale));
      const callout = noteCallout(note, id, overview, locale);
      assert.equal(text(callout.regenerate.label), `${locale === 'en-US' ? 'Regenerate' : '重新生成'} 2.2 · ${expected}`);
      assert.equal(text(callout.regenerate.price), expected);
      assert.equal(text(regeneratePrice([id], overview, locale)), expected);
      assert.equal(text(noteBanner(note, overview, [], locale).actions.find(action => action.action.kind === 'regenerate').price), expected);
    }
  }
});
