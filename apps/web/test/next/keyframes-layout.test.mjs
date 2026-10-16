import test from 'node:test';
import assert from 'node:assert/strict';
import { fitStrip, revealScroll, sameStripFit, unitRuns } from '../../src/next/model/keyframes-layout.ts';

// Scene 2's strip as the page measures it in English: shots 5, 4 and 6 s (8 s after), labels "2.1 · 5 s" ≈ 61 px
// with their inset and "2.1" ≈ 26 px, the tails "Scene 3" ≈ 62 px and "Scene 3 · 2 s later" ≈ 113 px.
const shot = (seconds, full = 61, short = 26) => ({ seconds, full, short });
const rows = () => [
  { shots: [shot(5), shot(4), shot(6)], tail: 62 },
  { shots: [shot(5), shot(4), shot(8)], tail: 113 },
];

test("the strip keeps the design's 15 px a second where the row has room, and the tail its 150 px", () => {
  const fit = fitStrip(rows(), 720, 3);
  assert.equal(fit.scale, 15);
  assert.deepEqual(fit.rows[1].shots.map((s) => [s.width, s.label]), [[75, 'full'], [60, 'short'], [120, 'full']]);
  assert.deepEqual(fit.rows.map((row) => row.tail), [150, 150]);
});

test('on a narrow row both rows share one smaller scale, so Now and After stay comparable', () => {
  const fit = fitStrip(rows(), 252, 3);
  // The After row is the longer one: (252 − 3 gaps − its tail) / 17 s.
  assert.equal(fit.scale, (252 - 9 - 113) / 17);
  assert.deepEqual(fit.rows[0].shots.map((s) => Math.round(s.width)), [38, 31, 46]);
  assert.deepEqual(fit.rows[1].shots.map((s) => Math.round(s.width)), [38, 31, 61]);
  // Too narrow for "2.1 · 5 s", wide enough for "2.1"; the hot 2.3 · 8 s keeps its whole label.
  assert.deepEqual(fit.rows[1].shots.map((s) => s.label), ['short', 'short', 'full']);
  // The After tail gets exactly its whole text; the Now tail the rest of its row, up to 150 px.
  assert.equal(Math.round(fit.rows[1].tail), 113);
  assert.equal(Math.round(fit.rows[0].tail), Math.round(252 - 9 - (5 + 4 + 6) * fit.scale));
});

test('a sliver too narrow even for its shot label is cut with an ellipsis, and a tail longer than the row ends in one', () => {
  const fit = fitStrip([{ shots: [shot(1), shot(20)], tail: 400 }], 300, 3);
  assert.equal(fit.scale, 0);
  assert.deepEqual(fit.rows[0].shots.map((s) => s.label), ['cut', 'cut']);
  assert.equal(fit.rows[0].tail, 294);
  const done = fitStrip([{ shots: [shot(5), shot(4), shot(8)], tail: null }], 200, 3);
  assert.equal(done.rows[0].tail, null);
  assert.equal(Math.round(done.scale * 100) / 100, Math.round(((200 - 6) / 17) * 100) / 100);
});

test('a refit of the same layout is the same fit, so measuring again does not render again', () => {
  assert.ok(sameStripFit(fitStrip(rows(), 252, 3), fitStrip(rows(), 252.1, 3)));
  assert.ok(!sameStripFit(fitStrip(rows(), 252, 3), fitStrip(rows(), 400, 3)));
  assert.ok(sameStripFit(null, null));
  assert.ok(!sameStripFit(null, fitStrip(rows(), 252, 3)));
});

test('a number keeps its unit on the same line, in English and Chinese', () => {
  assert.deepEqual(unitRuns('The 2.3 line runs 7.4 s but the shot is 6 s.'), [
    { text: 'The 2.3 line runs ', keep: false }, { text: '7.4 s', keep: true }, { text: ' but the shot is ', keep: false }, { text: '6 s', keep: true }, { text: '.', keep: false },
  ]);
  assert.deepEqual(unitRuns('影片 48 秒 → 50 秒').filter((run) => run.keep).map((run) => run.text), ['48 秒', '50 秒']);
  assert.deepEqual(unitRuns('镜头只有6秒').filter((run) => run.keep).map((run) => run.text), ['6秒']);
  // Words that only start with an s are left alone.
  assert.deepEqual(unitRuns('Scene 3 starts 2 seconds later'), [{ text: 'Scene 3 starts 2 seconds later', keep: false }]);
  assert.deepEqual(unitRuns(''), []);
});

test('a scrolling row moves just far enough to show an item whole', () => {
  const view = { left: 16, right: 374 };
  // Cut at the right edge ("3 Depart…"): scroll on by the hidden part and a margin.
  assert.equal(revealScroll(100, view, { left: 300, right: 410 }), 100 + 36 + 8);
  // Cut at the left edge: scroll back.
  assert.equal(revealScroll(100, view, { left: -20, right: 60 }), 100 - 36 - 8);
  // Already whole: unchanged.
  assert.equal(revealScroll(100, view, { left: 40, right: 200 }), 100);
});
