import test from 'node:test';
import assert from 'node:assert/strict';
import { chipParts, fitChip } from '../../src/next/model/chip-fit.ts';

const cutsOf = (text) => { const parts = chipParts(text); return parts.cuts.map((cut) => parts.head.slice(0, cut)); };

test("a chip's last word is its tail; a number keeps its unit, in English and Chinese", () => {
  assert.deepEqual(chipParts("Mara's coat came out maroon"), { head: "Mara's coat came out", tail: 'maroon', cuts: [6, 11, 16] });
  assert.deepEqual(chipParts('The 2.3 line runs 7.4 s but the shot is 6 s').tail, '6 s');
  // The catalog joins a number and its unit with a no-break space; that is one word too.
  assert.deepEqual(chipParts('Make 2.3 8 s'), { head: 'Make 2.3', tail: '8 s', cuts: [4] });
  assert.deepEqual(chipParts('把 2.3 改为 8 秒').tail, '8 秒');
  // A full stop stays with the word before it.
  assert.deepEqual(chipParts('the shot is 6 s.').tail, '6 s.');
  // One word, or words without spaces, is all head.
  assert.deepEqual(chipParts('  Keep  '), { head: 'Keep', tail: '', cuts: [] });
  assert.deepEqual(chipParts('Keep maroon'), { head: 'Keep', tail: 'maroon', cuts: [] });
  assert.equal(chipParts('玛拉的外套是酱红色').tail, '');
  assert.deepEqual(chipParts(''), { head: '', tail: '', cuts: [] });
});

test('a head is cut only between words, never inside a number and its unit, and never just after a comma', () => {
  assert.deepEqual(cutsOf("Mara's coat came out maroon"), ["Mara's", "Mara's coat", "Mara's coat came"]);
  assert.ok(!cutsOf('The 2.3 line runs 7.4 s but the shot is 6 s').includes('The 2.3 line runs 7.4'));
  assert.ok(cutsOf('The 2.3 line runs 7.4 s but the shot is 6 s').includes('The 2.3 line runs 7.4 s'));
  // A word's trailing comma is left off at a cut ("Narration 7.4 s…", not "Narration 7.4 s,…").
  assert.deepEqual(cutsOf('Narration 7.4 s, shot 6 s'), ['Narration', 'Narration 7.4 s']);
  // Chinese is cut between characters, but not just after "，".
  assert.deepEqual(cutsOf('旁白 7.4 秒，镜头 6 秒'), ['旁白', '旁白 7.4 秒', '旁白 7.4 秒，镜']);
  assert.deepEqual(cutsOf('玛拉的外套').slice(0, 2), ['玛拉', '玛拉的']);
  // A cut keeps at least a word's worth: never "The…" or "把…".
  assert.deepEqual(cutsOf('The 2.3 line runs 7.4 s but the shot is 6 s').slice(0, 2), ['The 2.3', 'The 2.3 line']);
  assert.deepEqual(cutsOf('把 2.3 改为 8 秒'), ['把 2.3', '把 2.3 改']);
  assert.deepEqual(cutsOf('Make 2.3 8 s'), ['Make']);
});

// "Mara's coat came out" ≈ 108 px, "maroon" ≈ 42 px at 11 px, 3 px between them, "…" ≈ 9 px; the head's words up to
// each cut: "Mara's" 38, "Mara's coat" 66, "Mara's coat came" 92.
const mara = { head: 108, tail: 42, gap: 3, cuts: [38, 66, 92], ellipsis: 9 };

test('a chip shows every word it has room for: the head gives way a word at a time, the last word last', () => {
  assert.deepEqual(fitChip(160, mara), { fit: 'whole', head: null });
  assert.deepEqual(fitChip(153, mara), { fit: 'whole', head: null });
  // Half a pixel short is short: the browser would cut the head ("Mara's coat came ou…").
  assert.equal(fitChip(152.5, mara).fit, 'cut');
  // "Mara's coat came… maroon", "Mara's coat… maroon", "Mara's… maroon": the head is its words, the "…" and a
  // quarter pixel, and with the last word it never needs more than the room.
  assert.deepEqual(fitChip(150, mara), { fit: 'cut', head: 101.25 });
  assert.deepEqual(fitChip(121, mara), { fit: 'cut', head: 75.25 });
  assert.deepEqual(fitChip(92.25, mara), { fit: 'cut', head: 47.25 });
  assert.equal(fitChip(92, mara).fit, 'tail');
  // Not even the first word with its "…": the last word alone.
  assert.deepEqual(fitChip(80, mara), { fit: 'tail', head: null });
  assert.deepEqual(fitChip(42, mara), { fit: 'tail', head: null });
  // Not even that: the letter alone (a settled chip keeps its check), never a lone "…".
  assert.deepEqual(fitChip(41.5, mara), { fit: 'none', head: null });
  assert.deepEqual(fitChip(0, mara), { fit: 'none', head: null });
});

test('a chip without a last word is whole, cut after a word or character, or none', () => {
  const one = { head: 70, tail: 0, gap: 0, cuts: [], ellipsis: 9 };
  assert.equal(fitChip(70, one).fit, 'whole');
  assert.equal(fitChip(50, one).fit, 'none');
  const chinese = { head: 99, tail: 0, gap: 0, cuts: [11, 22, 33, 44], ellipsis: 11 };
  assert.deepEqual(fitChip(50, chinese), { fit: 'cut', head: 44.25 });
  assert.deepEqual(fitChip(20, chinese), { fit: 'none', head: null });
});
