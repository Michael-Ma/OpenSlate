import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { catalog } from '../../src/next/i18n/messages.ts';
import { translate } from '../../src/next/i18n/translate.ts';
import {
  canStep, changedFields, draftEdits, draftOf, draftProblem, editChange, lengthFloor, lengthHint, lineNote, savedMessage, shotImpact, stepLength, unitPrices,
} from '../../src/next/model/plan-edit.ts';

const overview = lastFerryOverview();
const shot = (label) => overview.shots[shotId(label)];
const prices = (label) => unitPrices(overview, shot(label).sceneId);
const impact = (label, change, extra = {}) => {
  const base = draftOf(shot(label), 'generated', 30);
  const draft = { ...base, ...change };
  return shotImpact(shot(label), base, draft, { ...prices(label), ...extra }, 'en');
};
const text = (result) => result.parts.map((part) => translate('en', part.id, part.values)).join(' ');

test("the editor starts from the shot as it is now", () => {
  assert.deepEqual(draftOf(shot('1.2'), 'generated', 30), {
    purpose: 'Mara at the counter, sliding coins across.', framing: 'Medium', prompt: 'Mara at the counter, sliding coins across.', motion: 'Static', seconds: 5, narration: 'line', line: 'One for the morning boat.',
  });
  assert.equal(draftOf(shot('2.1'), undefined, 30).narration, 'none');
  assert.equal(draftOf(shot('2.1'), 'undecided', 30).narration, 'undecided');
});

test('prices come from the overview quotes: a keyframe and a clip, and no voice price in the sample film', () => {
  assert.deepEqual(prices('1.2'), { keyframe: 40000, clip: 500000, voice: null });
});

test('purpose or framing outdates the keyframe and the clip, and says they are written into the prompt', () => {
  const result = impact('1.2', { purpose: 'Mara buys the last ticket of the season.' });
  assert.equal(result.tone, 'cost');
  assert.equal(text(result), "Purpose and framing are written into the picture prompt. Saving outdates **1.2's keyframe and clip**; remaking both costs **about $0.54**. The current ones stay in Assets as earlier takes.");
  const base = draftOf(shot('1.2'), 'generated', 30);
  assert.deepEqual(savedMessage(shot('1.2'), base, { ...base, framing: 'Wide' }), { id: 'plan.toast.saved_kf_clip', values: { shot: '1.2' } });
});

test('a prompt change on a shot without a clip outdates only the keyframe', () => {
  const result = impact('2.1', { prompt: 'The empty harbour at first light.' });
  assert.equal(text(result), "Saving outdates **2.1's keyframe** (remaking it costs **about $0.04**). The current ones stay in Assets as earlier takes.");
});

test('motion or length outdates only the clip; with no clip yet nothing goes out of date', () => {
  assert.equal(text(impact('1.1', { motion: 'Slow pan left' })), "Saving outdates **1.1's clip** (remaking it costs **about $0.50**). The keyframe stays. The current ones stay in Assets as earlier takes.");
  const none = impact('2.1', { motion: 'Slow pan left' });
  assert.equal(none.tone, 'none');
  assert.equal(text(none), 'Nothing made goes out of date: 2.1 has no clip yet and the keyframe stays.');
  assert.equal(text(impact('3.1', { seconds: 9 })), 'Nothing has been made for 3.1 yet, so nothing goes out of date.');
  assert.equal(text(impact('2.1', {})), 'No changes yet.');
});

test('a new line outdates the voice line; the price shows only when one is set (never $0.00)', () => {
  assert.equal(text(impact('1.2', { line: 'One ticket, please.' })), 'The voice line needs making again; until then its length is an estimate.');
  assert.equal(text(impact('1.2', { line: 'One ticket, please.' }, { voice: 10000 })), 'The voice line needs making again (**about $0.01**); until then its length is an estimate.');
  assert.equal(text(impact('1.2', { narration: 'none' })), '1.2 will have no narration. Its voice line stays in Assets.');
  const unpriced = impact('1.2', { prompt: 'Coins on the counter.' }, { keyframe: null });
  assert.doesNotMatch(text(unpriced), /\$0\.00/);
  assert.match(text(unpriced), /no price set/);
});

test('the commands are ordered so the server accepts them, one field each', () => {
  const base = draftOf(shot('1.2'), 'generated', 30);
  const draft = { ...base, purpose: 'Buying the ticket.', prompt: 'Coins on the counter.', seconds: 6, line: 'One, please.' };
  assert.deepEqual(draftEdits(base, draft, 30, 'generated').map(({ field, edit }) => [field, edit.kind, edit.field, edit.value]), [
    ['length', 'shot', 'desiredFrames', '180'],
    ['prompt', 'shot', 'imagePrompt', 'Coins on the counter.'],
    ['purpose', 'shot', 'purpose', 'Buying the ticket.'],
    ['line', 'narration', 'text', 'One, please.'],
  ]);
  // Dropping the line comes first, so a shorter shot is no longer held by its voice.
  assert.deepEqual(draftEdits(base, { ...base, narration: 'none', seconds: 3 }, 30, 'generated').map(({ edit }) => [edit.field, edit.value]), [['mode', 'none'], ['desiredFrames', '90']]);
  // A first line: the words, then the choice to narrate.
  const silent = draftOf(shot('2.1'), 'none', 30);
  assert.deepEqual(draftEdits(silent, { ...silent, narration: 'line', line: 'Fog.' }, 30, 'none').map(({ edit }) => [edit.field, edit.value]), [['text', 'Fog.'], ['mode', 'generated']]);
  assert.deepEqual(draftEdits(base, base, 30, 'generated'), []);
  assert.deepEqual(changedFields(base, { ...base, purpose: `${base.purpose}  ` }), [], 'surrounding spaces are not a change');
});

test('a cleared field or an empty line cannot be saved', () => {
  const base = draftOf(shot('1.2'), 'generated', 30);
  assert.deepEqual(draftProblem(base, { ...base, purpose: ' ' }), { id: 'plan.edit.required_purpose' });
  assert.deepEqual(draftProblem(base, { ...base, line: '' }), { id: 'plan.line.empty' });
  assert.equal(draftProblem(base, { ...base, purpose: 'New' }), null);
});

test('the length has a floor at an accepted voice line (SB-8)', () => {
  // 1.2's 2.1 s line fits: the floor is the 3 s minimum.
  const floor12 = lengthFloor(shot('1.2'), 30, 'line');
  assert.deepEqual(floor12, { min: 3, reason: 'voice', lineSeconds: 2.1 });
  assert.deepEqual(lengthHint(shot('1.2'), floor12), { id: 'plan.len.range', values: { min: 3, max: 15 } });
  // 2.3's line is longer than the shot and not settled: no floor, and the hint says so.
  const floor23 = lengthFloor(shot('2.3'), 30, 'line');
  assert.equal(floor23.reason, null);
  assert.deepEqual(lengthHint(shot('2.3'), floor23), { id: 'plan.len.line_long', values: { line: 7.4 } });
  // Once 2.3 was lengthened to fit, it cannot go below the line.
  const extended = { ...shot('2.3'), durationFrames: 240, narration: { ...shot('2.3').narration, fits: true, fit: 'extend_shot' } };
  const floor = lengthFloor(extended, 30, 'line');
  assert.deepEqual(floor, { min: 7.4, reason: 'voice', lineSeconds: 7.4 });
  assert.deepEqual(lengthHint(extended, floor), { id: 'plan.len.floor_voice', values: { line: 7.4 } });
  assert.equal(stepLength(8, -1, floor), 7.4);
  assert.equal(canStep(7.4, -1, floor), false);
  assert.equal(stepLength(14.5, 1, floor), 15);
  assert.equal(canStep(15, 1, floor), false);
  // Choosing no narration lifts the floor; a line cut at the shot's end holds the current length.
  assert.equal(lengthFloor(extended, 30, 'none').min, 3);
  const cut = { ...shot('2.3'), narration: { ...shot('2.3').narration, fit: 'cut_to_shot' } };
  assert.deepEqual(lengthFloor(cut, 30, 'line'), { min: 6, reason: 'cut', lineSeconds: 7.4 });
});

test('the line shows its measured length until the words change, then a labelled estimate', () => {
  const base = draftOf(shot('1.2'), 'generated', 30);
  assert.deepEqual(lineNote(shot('1.2'), base), { id: 'plan.line.measured_fits', values: { seconds: 2.1, shot: 5 } });
  assert.deepEqual(lineNote(shot('1.2'), { ...base, line: 'It was the last boat of the season, and I nearly missed it, again and again and again.' }), { id: 'plan.line.estimate_long', values: { seconds: 5.4, shot: 5 } });
  assert.deepEqual(lineNote(shot('1.2'), { ...base, line: 'The last boat.' }), { id: 'plan.line.estimate_fits', values: { seconds: 0.9, shot: 5 } });
  assert.deepEqual(lineNote(shot('3.2'), draftOf(shot('3.2'), 'generated', 30)), { id: 'plan.line.estimate_fits', values: { seconds: 1.6, shot: 8 } });
  assert.equal(lineNote(shot('1.2'), { ...base, narration: 'none' }), null);
});

test('Undo names the whole edit, or the field its last command saved', () => {
  assert.deepEqual(editChange('1.2', ['purpose']), { id: 'plan.change.edit_shot', values: { shot: '1.2' } });
  assert.deepEqual(editChange('1.2', ['length', 'prompt', 'purpose']), { id: 'plan.change.field.purpose', values: { shot: '1.2' } });
  for (const field of ['purpose', 'framing', 'prompt', 'motion', 'length', 'narration', 'line']) assert.ok(Object.hasOwn(catalog, `plan.change.field.${field}`));
  for (const field of ['purpose', 'framing', 'prompt', 'motion']) assert.ok(Object.hasOwn(catalog, `plan.edit.required_${field}`));
  for (const key of ['wide', 'medium', 'close_up', 'extreme_close_up']) assert.ok(Object.hasOwn(catalog, `plan.framing.${key}`));
});

test('the Chinese impact line reads with the price in place', () => {
  const result = impact('1.2', { purpose: 'Mara buys the last ticket of the season.' });
  const zh = result.parts.map((part) => translate('zh-CN', part.id, part.values)).join('');
  assert.equal(zh, '目的和景别会写进画面描述。保存后，**1.2 的关键帧和视频**会过期，重做两者**约 $0.54**。现有的会作为旧版本保留在素材里。');
  assert.equal(sceneId(1), 'scene-1');
});
