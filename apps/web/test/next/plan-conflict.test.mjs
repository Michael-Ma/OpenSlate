import test from 'node:test';
import assert from 'node:assert/strict';
import { change, conflicts, hold, keepMine, shown, takeSaved } from '../../src/next/model/plan-conflict.ts';

const saved = { purpose: 'Mara at the counter.', motion: 'Static', seconds: 5 };

test('an open draft shows the saved values until the person types', () => {
  const held = hold(saved);
  assert.deepEqual(shown(held, saved), saved);
  const typed = change(held, saved, 'purpose', 'Mara buys the last ticket. ');
  assert.equal(shown(typed, saved).purpose, 'Mara buys the last ticket. ', 'what was typed is shown exactly, spaces and all');
  assert.deepEqual(conflicts(typed, saved), []);
});

test('a field the person did not touch follows the saved film, so a save never reverts it', () => {
  const typed = change(hold(saved), saved, 'purpose', 'Mine.');
  const now = { ...saved, motion: 'Slow push-in', seconds: 6 };
  assert.deepEqual(shown(typed, now), { purpose: 'Mine.', motion: 'Slow push-in', seconds: 6 });
  assert.deepEqual(conflicts(typed, now), []);
});

test("a field changed under the person's own text is a conflict; their text is kept", () => {
  const typed = change(hold(saved), saved, 'purpose', 'Mine.');
  const now = { ...saved, purpose: "The Director's." };
  assert.deepEqual(conflicts(typed, now), ['purpose']);
  assert.equal(shown(typed, now).purpose, 'Mine.');
  // The same words on both sides are no conflict.
  assert.deepEqual(conflicts(typed, { ...saved, purpose: ' Mine. ' }), []);
});

test('Keep my text saves it over the new version; Use saved text takes the saved words', () => {
  const typed = change(hold(saved), saved, 'purpose', 'Mine.');
  const now = { ...saved, purpose: "The Director's." };
  const kept = keepMine(typed, now);
  assert.deepEqual(conflicts(kept, now), []);
  assert.equal(shown(kept, now).purpose, 'Mine.');
  const taken = takeSaved(typed, now);
  assert.deepEqual(conflicts(taken, now), []);
  assert.equal(shown(taken, now).purpose, "The Director's.");
  // Untouched again, it follows the next saved change.
  assert.equal(shown(taken, { ...now, purpose: 'Later.' }).purpose, 'Later.');
});

test('typing into a field the saved film already changed starts from the new saved value: no conflict', () => {
  const held = hold(saved);
  const now = { ...saved, purpose: "The Director's." };
  const typed = change(held, now, 'purpose', "The Director's, and mine.");
  assert.deepEqual(conflicts(typed, now), []);
  // A field touched only by spaces is not the person's text: it follows the saved value.
  const spaced = change(held, saved, 'motion', 'Static ');
  assert.equal(shown(spaced, { ...saved, motion: 'Slow pan left' }).motion, 'Slow pan left');
  assert.deepEqual(conflicts(spaced, { ...saved, motion: 'Slow pan left' }), []);
});

test('numbers compare to a millionth', () => {
  const typed = change(hold(saved), saved, 'seconds', 7);
  assert.deepEqual(conflicts(typed, { ...saved, seconds: 5 + 1e-9 }), []);
  assert.deepEqual(conflicts(typed, { ...saved, seconds: 8 }), ['seconds']);
});
