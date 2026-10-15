import test from 'node:test';
import assert from 'node:assert/strict';
import { noteViews, sceneOpenNotes, shotCallouts } from '../../src/next/model/notes.ts';
import { lastFerryOverview, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => 'text' in m ? m.text : translateMsg('en', m);
const note = (patch) => ({ noteId: 'n', requestId: 'r', turnId: 't', letter: 'a', anchor: { shotIds: [shotId('2.2')] }, kind: 'observation',
  blocking: false, text: 'Coat came out maroon.', choices: [{ kind: 'accept', label: 'Keep maroon' }, { kind: 'regenerate_keyframe', shotIds: [shotId('2.2')] }],
  state: 'open', version: 1, createdAt: 'x', ...patch });
const proposal = { proposalId: 'p1', requestId: 'r', state: 'held', previewDigest: 'd', createdAt: 'x',
  preview: { changes: [], effects: [], filmSecondsNow: 48, filmSecondsAfter: 50,
    timeline: [{ shotId: shotId('2.3'), sceneId: sceneId(2), label: '2.3', nowSeconds: 6, afterSeconds: 8, changed: true }] } };

test('note choices are labelled by the app from their typed action', () => {
  const overview = lastFerryOverview();
  const notes = [note({}), note({ noteId: 'n2', letter: 'b', kind: 'recommendation', blocking: true, anchor: { shotIds: [shotId('2.3')] },
    text: 'Narration 7.4 s, shot 6 s.', choices: [{ kind: 'proposal', proposalId: 'p1' }, { kind: 'edit_field', shotId: shotId('2.3'), field: 'narration' }] })];
  const views = noteViews(notes, overview, [proposal]);
  assert.deepEqual(views[0].choices.map(c => en(c.label)), ['Keep maroon', 'Regenerate 2.2']);
  assert.deepEqual(views[0].choices.map(c => c.paid), [false, true]);
  assert.deepEqual(views[1].choices.map(c => en(c.label)), ['Make 2.3 8 s', 'Edit narration']);
  assert.equal(en(views[1].anchor), '2.3');
  assert.deepEqual(views[1].choices[0].action, { kind: 'proposal', noteId: 'n2', choiceIndex: 0, proposalId: 'p1' });
  // The banner shows blocking notes first: (b) before (a), as in the design.
  assert.deepEqual(sceneOpenNotes(views, sceneId(2)).map(v => v.letter), ['b', 'a']);
  assert.deepEqual(shotCallouts(views, shotId('2.2')).map(v => v.letter), ['a']);
});

test('settled and stale notes say how they ended and leave the banner', () => {
  const overview = lastFerryOverview();
  const views = noteViews([
    note({ state: 'resolved', resolution: { choiceIndex: 0, at: 'x' } }),
    note({ noteId: 'n2', letter: 'b', state: 'resolved', resolution: { choiceIndex: 1, at: 'x' } }),
    note({ noteId: 'n3', letter: 'c', state: 'stale' }),
  ], overview);
  assert.equal(en(views[0].settled), 'Settled: Keep maroon');
  assert.equal(views[0].choices[0].chosen, true);
  assert.equal(en(views[1].settled), 'Settled: 2.2 regenerated');
  assert.equal(en(views[2].settled), 'Out of date: the shot changed since');
  assert.equal(sceneOpenNotes(views, sceneId(2)).length, 0);
  assert.deepEqual(shotCallouts(views, shotId('2.2')).map(v => v.letter), ['a', 'b']);
});

test('a scene-anchored note names its scene', () => {
  const views = noteViews([note({ anchor: { sceneId: sceneId(3) } })], lastFerryOverview());
  assert.equal(en(views[0].anchor), 'Scene 3');
  assert.equal(views[0].sceneId, sceneId(3));
});
