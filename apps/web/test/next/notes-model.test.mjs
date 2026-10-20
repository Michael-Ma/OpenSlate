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
  preview: { changes: [{ shotId: shotId('2.3'), field: 'desiredFrames', before: '180', after: '240' }], effects: [], filmSecondsNow: 48, filmSecondsAfter: 50,
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
  assert.equal(en(views[2].settled), 'Out of date: 2.2 changed after this note.');
  assert.deepEqual(views.map(v => v.making), [false, false, false]);
  assert.equal(sceneOpenNotes(views, sceneId(2)).length, 0);
  assert.deepEqual(shotCallouts(views, shotId('2.2')).map(v => v.letter), ['a', 'b']);
});

test('a note settled by a regenerate says so while the new keyframe is being made, and "regenerated" only once it is back', () => {
  const overview = lastFerryOverview();
  const settled = note({ state: 'resolved', resolution: { choiceIndex: 1, at: 'x' } });
  const shot = overview.shots[shotId('2.2')];
  // The keyframe is being made again (its old picture kept as previous), or a replacement take runs behind it.
  for (const keyframe of [{ ...shot.keyframe, state: 'running', previous: shot.keyframe.artifact, artifact: undefined }, { ...shot.keyframe, replacement: { state: 'queued', waiting: { code: 'capacity', since: 'x' } } }]) {
    const making = { ...overview, shots: { ...overview.shots, [shot.shotId]: { ...shot, keyframe } } };
    const [view] = noteViews([settled], making);
    assert.equal(en(view.settled), 'Regenerating 2.2…');
    assert.equal(translateMsg('zh-CN', view.settled), '正在重新生成 2.2…');
    assert.equal(view.making, true);
  }
  const [back] = noteViews([settled], overview);
  assert.deepEqual([en(back.settled), back.making], ['Settled: 2.2 regenerated', false]);
});

test('an out-of-date note says what changed: a new keyframe of the shot it looked at, or its shots or scene', () => {
  const overview = lastFerryOverview();
  const seen = { shotId: shotId('2.2'), artifactId: 'older', sha256: 'f'.repeat(64) };
  const [replaced, current, scene] = noteViews([
    note({ state: 'stale', seenKeyframe: seen }),
    note({ noteId: 'n2', state: 'stale', seenKeyframe: { ...seen, ...overview.shots[shotId('2.2')].keyframe.artifact } }),
    note({ noteId: 'n3', state: 'stale', anchor: { sceneId: sceneId(3) } }),
  ], overview);
  assert.equal(en(replaced.settled), 'Out of date: 2.2 has a new keyframe since this note.');
  assert.equal(translateMsg('zh-CN', replaced.settled), '已过期：写这条备注后，2.2 有了新的关键帧。');
  assert.equal(en(current.settled), 'Out of date: 2.2 changed after this note.');
  assert.equal(en(scene.settled), 'Out of date: Scene 3 changed after this note.');
});

test('a scene-anchored note names its scene', () => {
  const views = noteViews([note({ anchor: { sceneId: sceneId(3) } })], lastFerryOverview());
  assert.equal(en(views[0].anchor), 'Scene 3');
  assert.equal(views[0].sceneId, sceneId(3));
});

test('a recommendation leads the banner over an observation (from the LIVE-4b review: "a" said a frame works, "b" asked for a change)', async () => {
  const { sceneOpenNotes } = await import('../../src/next/model/notes.ts');
  const view = (letter, kind, blocking = false) => ({ noteId: letter, letter, kind, blocking, state: 'open', sceneId: 's', regeneration: null });
  assert.deepEqual(sceneOpenNotes([view('a', 'observation'), view('b', 'recommendation')], 's').map((n) => n.letter), ['b', 'a']);
  assert.deepEqual(sceneOpenNotes([view('a', 'recommendation'), view('b', 'observation', true)], 's').map((n) => n.letter), ['b', 'a'], 'blocking still first');
  assert.deepEqual(sceneOpenNotes([view('b', 'observation'), view('a', 'observation')], 's').map((n) => n.letter), ['a', 'b']);
});
