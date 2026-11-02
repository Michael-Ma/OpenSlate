import test from 'node:test';
import assert from 'node:assert/strict';
import { chipParts, fitChip, widestLine, wraps } from '../../src/next/model/chip-fit.ts';

const cutsOf = (text) => { const parts = chipParts(text); return parts.cuts.map((cut) => parts.head.slice(0, cut)); };

test("a chip's words are cut only from the end, after a word; a number keeps its unit, in English and Chinese", () => {
  assert.deepEqual(chipParts("Mara's coat came out maroon"), { head: "Mara's coat came out maroon", tail: '', cuts: [6, 11, 16, 20] });
  // Never a word picked from the end: "6 s" alone would read as if the line were 6 s.
  assert.equal(chipParts('The 2.3 line runs 7.4 s but the shot is 6 s').tail, '');
  // The catalog joins a number and its unit with a no-break space; that is one word too.
  assert.deepEqual(chipParts('Make 2.3 8 s'), { head: 'Make 2.3 8 s', tail: '', cuts: [4, 8] });
  assert.deepEqual(chipParts('  Keep  '), { head: 'Keep', tail: '', cuts: [] });
  assert.deepEqual(chipParts(''), { head: '', tail: '', cuts: [] });
});

test('words are cut only between words, never inside a number and its unit, and never just after a comma', () => {
  assert.deepEqual(cutsOf("Mara's coat came out maroon"), ["Mara's", "Mara's coat", "Mara's coat came", "Mara's coat came out"]);
  assert.ok(!cutsOf('The 2.3 line runs 7.4 s but the shot is 6 s').includes('The 2.3 line runs 7.4'));
  assert.ok(cutsOf('The 2.3 line runs 7.4 s but the shot is 6 s').includes('The 2.3 line runs 7.4 s'));
  // A word's trailing comma is left off at a cut ("Narration 7.4 s…", not "Narration 7.4 s,…").
  assert.deepEqual(cutsOf('Narration 7.4 s, shot 6 s'), ['Narration', 'Narration 7.4 s', 'Narration 7.4 s, shot']);
  // Chinese is cut between characters, but not just after "，".
  assert.ok(cutsOf('旁白 7.4 秒，镜头 6 秒').includes('旁白 7.4 秒，镜'));
  assert.deepEqual(cutsOf('玛拉的外套').slice(0, 2), ['玛拉', '玛拉的']);
  // A cut keeps at least a word's worth: never "The…" or "把…".
  assert.deepEqual(cutsOf('The 2.3 line runs 7.4 s but the shot is 6 s').slice(0, 2), ['The 2.3', 'The 2.3 line']);
  assert.ok(!cutsOf('把 2.3 改为 8 秒').includes('把'));
});

// "Mara's coat came out maroon" ≈ 153 px at 11 px, "…" ≈ 9 px; its words up to each cut: "Mara's" 38, "Mara's coat"
// 66, "Mara's coat came" 92, "Mara's coat came out" 108.
const mara = { head: 153, tail: 0, gap: 0, cuts: [38, 66, 92, 108], ellipsis: 9 };

test('a chip shows as many of its first words as it has room for, then "…", or only its letter', () => {
  assert.deepEqual(fitChip(160, mara), { fit: 'whole', head: null });
  assert.deepEqual(fitChip(153, mara), { fit: 'whole', head: null });
  // Half a pixel short is short: the browser would cut a word ("Mara's coat came out mar…").
  assert.deepEqual(fitChip(152.5, mara), { fit: 'cut', head: 117.25 });
  assert.deepEqual(fitChip(101.25, mara), { fit: 'cut', head: 101.25 });
  assert.deepEqual(fitChip(75.25, mara), { fit: 'cut', head: 75.25 });
  assert.deepEqual(fitChip(47.25, mara), { fit: 'cut', head: 47.25 });
  // Not even the first word with its "…": the letter alone (a settled chip keeps its check), never a lone "…".
  assert.deepEqual(fitChip(47, mara), { fit: 'none', head: null });
  assert.deepEqual(fitChip(0, mara), { fit: 'none', head: null });
});

test('a chip of one word is whole or none; Chinese is cut after a character', () => {
  const one = { head: 70, tail: 0, gap: 0, cuts: [], ellipsis: 9 };
  assert.equal(fitChip(70, one).fit, 'whole');
  assert.equal(fitChip(50, one).fit, 'none');
  const chinese = { head: 99, tail: 0, gap: 0, cuts: [11, 22, 33, 44], ellipsis: 11 };
  assert.deepEqual(fitChip(50, chinese), { fit: 'cut', head: 44.25 });
  assert.deepEqual(fitChip(20, chinese), { fit: 'none', head: null });
});

test('wrapped words are as wide as their widest line, not their column', () => {
  const lines = [{ left: 100, right: 230.4, top: 10, height: 16 }, { left: 100, right: 150, top: 26, height: 16 }];
  assert.equal(widestLine(lines), 130.4);
  assert.ok(wraps(lines));
  assert.ok(!wraps([lines[0]]));
  // Two boxes on one line (an inline element inside the words) are one line.
  assert.ok(!wraps([{ left: 0, right: 40, top: 10, height: 16 }, { left: 40, right: 90, top: 10.5, height: 16 }]));
  assert.equal(widestLine([]), 0);
});
