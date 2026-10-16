import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOMY, partlyInView, scrolls, tighten } from '../../src/next/model/inspector-fit.ts';

const fits = { overflows: false, labelCut: false, cramped: false };
const over = { overflows: true, labelCut: false, cramped: false };

test('a roomy inspector whose rows fit keeps the design layout', () => {
  assert.equal(tighten(ROOMY, fits), ROOMY);
  // Roomy stacks the actions, so a label can wrap there and is never measured as cut.
  assert.equal(tighten(ROOMY, { ...fits, labelCut: true }), ROOMY);
});

test('rows that do not fit tighten one step at a time: compact, then the actions pinned with the rows scrolling', () => {
  const compact = tighten(ROOMY, over);
  assert.deepEqual(compact, { fit: 'compact', short: false });
  const pinned = tighten(compact, over);
  assert.deepEqual(pinned, { fit: 'pinned', short: false });
  // Pinned overflows by design (its rows scroll): it stays while the title has room above the actions, so the
  // measuring loop ends with the actions in view.
  assert.equal(tighten(pinned, over), pinned);
  assert.equal(tighten(pinned, fits), pinned);
  assert.equal(tighten(compact, fits), compact);
  assert.deepEqual([scrolls('roomy'), scrolls('compact'), scrolls('pinned'), scrolls('scroll')], [false, false, true, true]);
});

test('pinned actions that leave the title no room give way to scrolling the whole inspector, the last resort', () => {
  const pinned = { fit: 'pinned', short: true };
  const scroll = tighten(pinned, { ...over, cramped: true });
  assert.deepEqual(scroll, { fit: 'scroll', short: true });
  // Scroll is the last step: the same layout comes back, so the measuring loop ends.
  assert.equal(tighten(scroll, { ...over, cramped: true }), scroll);
  assert.equal(tighten(scroll, over), scroll);
});

test('a side-by-side label that cannot fit is shortened before the layout tightens further', () => {
  const compact = { fit: 'compact', short: false };
  const short = tighten(compact, { ...over, labelCut: true });
  assert.deepEqual(short, { fit: 'compact', short: true });
  // Measured again with the short label: it fits, and the rows may still overflow.
  assert.deepEqual(tighten(short, over), { fit: 'pinned', short: true });
  assert.equal(tighten(short, { ...fits, labelCut: true }), short);
  // A pinned inspector shortens its label first too.
  assert.deepEqual(tighten({ fit: 'pinned', short: false }, { ...over, labelCut: true, cramped: true }), { fit: 'pinned', short: true });
});

test('a scrolled inspector draws only the units wholly in view', () => {
  const view = { top: 12, bottom: 221 };
  const units = [
    { top: 12, bottom: 38 }, // title, at the top edge: in view
    { top: 46, bottom: 70 }, // status
    { top: 184, bottom: 217 }, // the side-by-side edits
    { top: 210, bottom: 243 }, // crosses the bottom edge
    { top: 223, bottom: 256 }, // below the view, in the padding band
    { top: 400, bottom: 420 }, // far below (not painted anyway)
    { top: -20, bottom: 30 }, // crosses the top edge
  ];
  assert.deepEqual(partlyInView(units, view), [false, false, false, true, true, true, true]);
});

test('a unit taller than the view is drawn, or it could never be read', () => {
  assert.deepEqual(partlyInView([{ top: 0, bottom: 300 }, { top: 20, bottom: 229.6 }], { top: 12, bottom: 221 }), [false, false]);
  // Sub-pixel edges count as inside.
  assert.deepEqual(partlyInView([{ top: 11.6, bottom: 221.4 }], { top: 12, bottom: 221 }), [false]);
});
