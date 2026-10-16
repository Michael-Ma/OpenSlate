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
  // 2.2's 4 s is 60 px, a pixel short of "2.2 · 4 s": the row has room to spare, so it widens to keep its label (and
  // every longer shot with it, so none is drawn narrower than a shorter one) instead of dropping its seconds.
  assert.deepEqual(fit.rows[1].shots.map((s) => [s.width, s.label]), [[76, 'full'], [61, 'full'], [121, 'full']]);
  assert.deepEqual(fit.rows[0].shots.map((s) => s.width), [76, 61, 91]);
  assert.deepEqual(fit.rows.map((row) => row.tail), [150, 150]);
  // Where every label fits at 15 px a second the strip is exactly the design's.
  const roomy = fitStrip([{ shots: [shot(5), shot(6)], tail: 62 }], 720, 3);
  assert.deepEqual(roomy.rows[0].shots.map((s) => [s.width, s.label]), [[75, 'full'], [90, 'full']]);
});

test('on a narrow row both rows share one smaller scale, so Now and After stay comparable', () => {
  // Labels that need no room of their own: the plain fit, (252 − 3 gaps − the After tail) / 17 s.
  const plain = fitStrip([
    { shots: [shot(5, 20, 10), shot(4, 20, 10), shot(6, 20, 10)], tail: 62 },
    { shots: [shot(5, 20, 10), shot(4, 20, 10), shot(8, 20, 10)], tail: 113 },
  ], 252, 3);
  assert.equal(plain.scale, (252 - 9 - 113) / 17);
  assert.deepEqual(plain.rows[0].shots.map((s) => Math.round(s.width)), [38, 31, 46]);
  assert.deepEqual(plain.rows[1].shots.map((s) => Math.round(s.width)), [38, 31, 61]);
  // The After tail gets exactly its whole text; the Now tail the rest of its row, up to 150 px.
  assert.equal(Math.round(plain.rows[1].tail), 113);
  assert.equal(Math.round(plain.rows[0].tail), Math.round(252 - 9 - (5 + 4 + 6) * plain.scale));
  // With real labels the scale is still one for both rows: the same shots line up, and 2.3 grows by its 2 s.
  const fit = fitStrip(rows(), 252, 3);
  assert.ok(fit.scale < plain.scale);
  assert.deepEqual(fit.rows[0].shots.slice(0, 2).map((s) => s.width), fit.rows[1].shots.slice(0, 2).map((s) => s.width));
  assert.equal(Math.round(fit.rows[1].shots[2].width - fit.rows[0].shots[2].width), Math.round(2 * fit.scale));
  // Too narrow for "2.1 · 5 s", wide enough for "2.1".
  assert.deepEqual(fit.rows[1].shots.slice(0, 2).map((s) => s.label), ['short', 'short']);
});

// The same strip with the change marked: After's 2.3 is the hot segment, Now's 2.3 its counterpart.
const changed = (full = 61) => [
  { shots: [shot(5, full), shot(4, full), shot(6, full)], tail: 62 },
  { shots: [shot(5, full), shot(4, full), { ...shot(8, full), hot: true }], tail: 113 },
];

test('on a narrow row the changed shot and its Now counterpart keep their whole labels; the other shots give up room', () => {
  const fit = fitStrip(changed(), 252, 3);
  assert.deepEqual(fit.rows.map((row) => row.shots.map((s) => s.label)), [['short', 'short', 'full'], ['short', 'short', 'full']]);
  // Now's 2.3 · 6 s is as wide as its label; After's 8 s stays longer by its 2 s at the shared scale.
  assert.equal(Math.round(fit.rows[0].shots[2].width), 61);
  assert.equal(Math.round(fit.rows[1].shots[2].width - fit.rows[0].shots[2].width), Math.round(2 * fit.scale));
  // 2.1 and 2.2 are the same in both rows and stay aligned, each still showing its shot label.
  assert.deepEqual(fit.rows[0].shots.slice(0, 2).map((s) => s.width), fit.rows[1].shots.slice(0, 2).map((s) => s.width));
  assert.ok(fit.rows[1].shots[1].width >= 26 && fit.rows[1].shots[0].width > fit.rows[1].shots[1].width);
  // Both rows still fit, the After tail with its whole text.
  for (const row of fit.rows) assert.ok(row.shots.reduce((sum, s) => sum + s.width, 0) + 9 + row.tail <= 252 + 0.01);
  assert.ok(fit.rows[1].tail >= 113 - 0.01);
  // Chinese labels are wider ("2.3 · 8 秒"): the same order holds.
  const zh = fitStrip(changed(66), 253, 3);
  assert.deepEqual(zh.rows.map((row) => row.shots[2].label), ['full', 'full']);
});

test('a label the row has spare room for is never dropped, in a roomy strip as in a narrow one', () => {
  // Chinese at 1440 px: "2.2 · 4 秒" needs 64 px of 2.2's 60.
  const fit = fitStrip(changed(64), 720, 3);
  assert.equal(fit.scale, 15);
  assert.ok(fit.rows.every((row) => row.shots.every((s) => s.label === 'full')));
  // A one-row strip (a settled change) with room beside it.
  const done = fitStrip([{ shots: [shot(5, 64), shot(4, 64), { ...shot(8, 64), hot: true }], tail: 120 }], 600, 3);
  assert.ok(done.rows[0].shots.every((s) => s.label === 'full'));
});

test('a shortened shot stays shorter than its Now, even when its label widens it', () => {
  const fit = fitStrip([
    { shots: [shot(5), shot(4), shot(8)], tail: 62 },
    { shots: [shot(5), shot(4), { ...shot(5), hot: true }], tail: 113 },
  ], 252, 3);
  const [now, after] = fit.rows.map((row) => row.shots[2]);
  assert.equal(after.label, 'full');
  assert.equal(now.label, 'full');
  assert.equal(Math.round(now.width - after.width), Math.round(3 * fit.scale));
});

test('labels never squeeze the strip below half its plain scale', () => {
  // A phone-sized row of five shots: the change keeps its label, the rest shrink no further than half the scale.
  const five = (hot) => [shot(5), shot(4), hot ? { ...shot(8), hot: true } : shot(6), shot(5), shot(4)];
  const plain = fitStrip([{ shots: five(false).map(({ seconds, full, short }) => ({ seconds, full, short })), tail: 62 }, { shots: five(false).map((s, i) => (i === 2 ? shot(8) : s)), tail: 113 }], 270, 3);
  const fit = fitStrip([{ shots: five(false), tail: 62 }, { shots: five(true), tail: 113 }], 270, 3);
  assert.ok(fit.scale >= plain.scale / 2 - 1e-6 && fit.scale < plain.scale);
  assert.equal(fit.rows[1].shots[2].label, 'full');
  // With a whole label needing more than that, the change shows its shot label alone.
  const wide = fitStrip([{ shots: five(false), tail: 62 }, { shots: five(true).map((s) => (s.hot ? { ...s, full: 140 } : s)), tail: 113 }], 270, 3);
  assert.notEqual(wide.rows[1].shots[2].label, 'full');
  assert.ok(wide.scale >= plain.scale / 2 - 1e-6);
});

test('a sliver too narrow even for its shot label is cut with an ellipsis, and a tail longer than the row ends in one', () => {
  const fit = fitStrip([{ shots: [shot(1), shot(20)], tail: 400 }], 300, 3);
  assert.equal(fit.scale, 0);
  assert.deepEqual(fit.rows[0].shots.map((s) => s.label), ['cut', 'cut']);
  assert.equal(fit.rows[0].tail, 294);
  // A row without a tail (a settled change) fills its room.
  const done = fitStrip([{ shots: [shot(5, 20, 10), shot(4, 20, 10), shot(8, 20, 10)], tail: null }], 200, 3);
  assert.equal(done.rows[0].tail, null);
  assert.equal(Math.round(done.scale * 100) / 100, Math.round(((200 - 6) / 17) * 100) / 100);
});

test("the other shots' whole labels take room only while every label that shows keeps showing", () => {
  // 1024 px in Chinese: at 15 px a second "2.2 · 4 秒" needs 64 of 60 px and the row has nothing to spare; the strip
  // gives up a little of its scale for it, and 2.1 and 2.3 keep their whole labels.
  const fit = fitStrip(changed(64), 376, 3);
  assert.ok(fit.scale < 15 && fit.scale > 12);
  assert.ok(fit.rows.every((row) => row.shots.every((s) => s.label === 'full')));
  assert.ok(fit.rows.every((row) => row.shots.reduce((sum, s) => sum + s.width, 0) + 9 + row.tail <= 376 + 0.01));
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
