import test from 'node:test';
import assert from 'node:assert/strict';
import { afterSave, change, conflicts, editedKeys, hold, keepMine, shown, takeSaved, touched } from '../../src/next/model/plan-conflict.ts';

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

test('a draft is touched once the person changed a field; spaces alone or typing it back is no change', () => {
  assert.equal(touched(undefined), false);
  assert.equal(touched(hold(saved)), false);
  assert.equal(touched(change(hold(saved), saved, 'purpose', ' Mara at the counter. ')), false);
  const typed = change(change(hold(saved), saved, 'motion', 'Slow push-in'), saved, 'seconds', 6);
  assert.deepEqual(editedKeys(typed), ['motion', 'seconds']);
  assert.equal(touched(change(typed, saved, 'motion', 'Static')), true, 'seconds is still changed');
  // Use saved text leaves nothing changed; Keep my text keeps it changed.
  const now = { ...saved, motion: 'Slow pan left', seconds: 5 };
  const one = change(hold(saved), saved, 'motion', 'Slow push-in');
  assert.equal(touched(takeSaved(one, now)), false);
  assert.equal(touched(keepMine(one, now)), true);
});

test('after a save is answered the editor closes, unless the person typed on while the reply was awaited', () => {
  const typed = change(hold(saved), saved, 'purpose', 'Mine.');
  const sent = shown(typed, saved);
  assert.equal(afterSave(typed, sent), null, 'nothing newer: close');
  assert.equal(afterSave(change(typed, saved, 'purpose', 'Mine. '), sent), null, 'spaces are not newer text');
  // Typed on after Save: the newer text stays, held against what was saved, so it is no conflict.
  const later = change(typed, saved, 'purpose', 'Mine, and more.');
  const rest = afterSave(later, sent);
  const savedNow = { ...saved, purpose: 'Mine.' };
  assert.deepEqual(rest.base, sent);
  assert.equal(shown(rest, savedNow).purpose, 'Mine, and more.');
  assert.deepEqual(conflicts(rest, savedNow), []);
  assert.deepEqual(editedKeys(rest), ['purpose']);
  // A field changed only before Save is saved; one typed after Save stays.
  const two = change(change(hold(saved), saved, 'purpose', 'Mine.'), saved, 'motion', 'Slow push-in');
  const sentTwo = shown(two, saved);
  const afterTwo = afterSave(change(two, saved, 'seconds', 7), sentTwo);
  assert.deepEqual(editedKeys(afterTwo), ['seconds']);
  assert.equal(shown(afterTwo, { ...sentTwo }).seconds, 7);
});

test('B17.10 reverting a field to its opening value while Save waits keeps the reverted text', () => {
  const original = { purpose: 'Original', motion: 'Static', seconds: 5 };
  const typed = change(hold(original), original, 'purpose', 'B');
  const sent = shown(typed, original);
  const reverted = change(typed, original, 'purpose', 'Original');
  const rest = afterSave(reverted, sent);
  assert.ok(rest, 'Original still needs saving because the answered command saved B');
  assert.deepEqual(rest.base, sent);
  assert.equal(rest.draft.purpose, 'Original');
  assert.deepEqual(conflicts(rest, sent), []);
});

test('B17.10 reverted numeric and formerly untouched fields compare against every submitted value', () => {
  const original = { text: 'Original', seconds: 5 };
  const typed = change(hold(original), original, 'seconds', 8);
  const sent = shown(typed, { ...original, text: 'A new saved value' });
  const reverted = change(change(typed, original, 'seconds', 5), original, 'text', 'Original');
  const rest = afterSave(reverted, sent);
  assert.deepEqual(rest, { base: sent, draft: original });
});

test('B17.10 an untouched field that followed newer saved text is not reverted after Save', () => {
  const original = { text: 'Original', seconds: 5 };
  const typed = change(hold(original), original, 'seconds', 8);
  const sent = shown(typed, { ...original, text: 'A newer saved value' });
  assert.equal(afterSave(typed, sent, typed), null);
  const later = change(typed, original, 'seconds', 5);
  assert.deepEqual(afterSave(later, sent, typed), { base: sent, draft: { text: sent.text, seconds: 5 } });
});
