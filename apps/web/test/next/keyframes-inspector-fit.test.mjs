import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOMY, partlyInView, tighten } from '../../src/next/model/inspector-fit.ts';

const fits = { overflows: false, labelCut: false };

test('a roomy inspector whose rows fit keeps the design layout', () => {
  assert.equal(tighten(ROOMY, fits), ROOMY);
  // Roomy stacks the actions, so a label can wrap there and is never measured as cut.
  assert.equal(tighten(ROOMY, { overflows: false, labelCut: true }), ROOMY);
});

test('rows that do not fit tighten one step at a time: compact, then scroll as one unit', () => {
  const compact = tighten(ROOMY, { overflows: true, labelCut: false });
  assert.deepEqual(compact, { fit: 'compact', short: false });
  const scroll = tighten(compact, { overflows: true, labelCut: false });
  assert.deepEqual(scroll, { fit: 'scroll', short: false });
  // Nothing is tighter than scrolling: the same layout comes back, so the measuring loop ends.
  assert.equal(tighten(scroll, { overflows: true, labelCut: false }), scroll);
  assert.equal(tighten(compact, fits), compact);
});

test('a side-by-side label that cannot fit is shortened before the layout tightens further', () => {
  const compact = { fit: 'compact', short: false };
  const short = tighten(compact, { overflows: true, labelCut: true });
  assert.deepEqual(short, { fit: 'compact', short: true });
  // Measured again with the short label: it fits, and the rows may still overflow.
  assert.deepEqual(tighten(short, { overflows: true, labelCut: false }), { fit: 'scroll', short: true });
  assert.equal(tighten(short, { overflows: false, labelCut: true }), short);
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
