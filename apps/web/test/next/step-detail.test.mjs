import test from 'node:test';
import assert from 'node:assert/strict';
import { callFacts, stepFacts } from '../../src/next/model/step-detail.ts';
import { moneyParts } from '../../src/next/model/director.ts';
import { translate } from '../../src/next/i18n/translate.ts';

const en = (m) => translate('en', m.id, m.values);
const zh = (m) => translate('zh-CN', m.id, m.values);
const now = new Date(2026, 9, 31, 12, 0);
const detail = {
  key: 'step', kind: 'video', state: 'succeeded', model: 'viggle-live', prompt: 'x'.repeat(757), durationSeconds: 6, aspectRatio: '9:16',
  output: { width: 768, height: 1344, durationSeconds: 6.6 }, priceMicros: '100000', attempts: 2, createdAt: '2026-10-31T10:20:00',
  call: { adapter: 'viggle-h3', providerModel: 'MiniMax-H3', settings: { aspectRatio: '9:16', resolution: '768p' },
    firstFrameCrop: { sourceWidth: 941, sourceHeight: 1672, width: 936, height: 1664 }, taskId: 'vid_1', requestDigest: 'abc' },
};

test('the facts anyone can read: what made it, its size, length, ratio, cost and retries', () => {
  assert.deepEqual(stepFacts(detail, now, 'en').map((row) => [en(row.label), en(row.value)]), [
    ['Model', 'viggle-live'], ['Size', '768 × 1344'], ['Length', '6.6 s'], ['Ratio', '9:16'], ['Cost', '$0.10'], ['Attempts', '2'], ['Made', 'Today 10:20'],
  ]);
  assert.equal(zh(stepFacts(detail, now, 'zh-CN')[0].label), '模型');
});

test('facts leave out what a step does not have', () => {
  const render = { key: 'r', kind: 'render', state: 'succeeded', model: 'local-render', priceMicros: '0', attempts: 1, createdAt: '2026-10-31T10:20:00' };
  assert.deepEqual(stepFacts(render, now, 'en').map((row) => en(row.label)), ['Model', 'Made']);
});

test('the provider call lists its settings, the crop and the task for debugging', () => {
  assert.deepEqual(callFacts(detail), [
    { label: 'adapter', value: 'viggle-h3' }, { label: 'model', value: 'MiniMax-H3' }, { label: 'aspectRatio', value: '9:16' }, { label: 'resolution', value: '768p' },
    { label: 'firstFrameCrop', value: '941 × 1672 → 936 × 1664' }, { label: 'taskId', value: 'vid_1' }, { label: 'requestDigest', value: 'abc' },
  ]);
  assert.deepEqual(callFacts({ ...detail, call: undefined }), []);
  const named = { ...detail, call: { adapter: 'codex-image', providerModel: 'gpt-6-astra', settings: { model: 'gpt-6-astra', width: 1024 } } };
  assert.deepEqual(callFacts(named).map((row) => row.label), ['adapter', 'model', 'width'], 'the model is listed once');
});

test('money in a reply is picked out, and only money', () => {
  assert.deepEqual(moneyParts('花了 $0.24，上限 $1,000.50。'), [
    { text: '花了 ', money: false }, { text: '$0.24', money: true }, { text: '，上限 ', money: false }, { text: '$1,000.50', money: true }, { text: '。', money: false },
  ]);
  assert.deepEqual(moneyParts('no amounts, not even $x'), [{ text: 'no amounts, not even $x', money: false }]);
});
