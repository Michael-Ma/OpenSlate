import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, lastFerrySnapshot, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { catalog } from '../../src/next/i18n/messages.ts';
import {
  addedScene, addedShot, clipPill, clockText, deleteSceneFacts, deleteShotFacts, keyframePill, locate, mediaCountMsgs, mediaCounts,
  narrationView, planOutline, promptText, promptToSave, sceneMove, shotMove, written,
} from '../../src/next/model/plan.ts';

const golden = () => planOutline(lastFerrySnapshot(), lastFerryOverview());
const row = (outline, label) => outline.scenes.flatMap((scene) => scene.shots).find((shot) => shot.label === label);
const ids = (value) => JSON.stringify(value).match(/"id":"[^"]+"/g)?.map((text) => text.slice(6, -1)) ?? [];

test('the outline follows the overview: scenes, shots, length and the 6:00 cap', () => {
  const outline = golden();
  assert.deepEqual(outline.counts, { scenes: 3, shots: 8, seconds: 48, maxSeconds: 360 });
  assert.deepEqual(outline.line, { id: 'plan.line', values: { scenes: 3, shots: 8, seconds: 48, max: '6:00' } });
  assert.deepEqual(outline.scenes.map((scene) => [scene.ordinal, scene.title, scene.seconds, scene.state.id, scene.shots.length]), [
    [1, 'Closing time', 17, 'scene.state.video_saved', 3],
    [2, 'Harbour at dawn', 15, 'scene.state.keyframes_back', 3],
    [3, 'Departure', 16, 'scene.state.not_started', 2],
  ]);
  assert.deepEqual(outline.scenes.map((scene) => [scene.first, scene.last]), [[true, false], [false, false], [false, true]]);
  assert.equal(outline.brief, lastFerrySnapshot().project.brief);
  assert.equal(clockText(48), '0:48');
});

test('rows say framing, length, narration and the media state in neutral pills (green only when done)', () => {
  const outline = golden();
  const r12 = row(outline, '1.2');
  assert.deepEqual([r12.framing, r12.seconds, r12.motion, r12.first, r12.last], ['Medium', 5, 'Static', false, false]);
  assert.deepEqual(r12.narration, { kind: 'line', text: 'One for the morning boat.', detail: { id: 'plan.narr.voice', values: { seconds: 2.1 } } });
  assert.deepEqual(r12.pills.map((pill) => [pill.text.id, pill.tone, pill.icon]), [['plan.pill.opened', 'ok', '✓'], ['plan.pill.clip', 'ok', '✓']]);
  assert.equal(r12.picture.artifactId, 'art-1.2');
  const r22 = row(outline, '2.2');
  assert.deepEqual(r22.pills.map((pill) => pill.text.id), ['plan.pill.not_opened', 'plan.pill.clip_none']);
  assert.deepEqual(r22.narration.kind, 'none');
  // The too-long line is an app fact: a neutral check. The Director's own note b about it is the amber chip (study).
  const r23 = row(outline, '2.3');
  assert.deepEqual(r23.check, { id: 'plan.check.narration', values: { line: 7.4, shot: 6 } });
  assert.deepEqual(r23.notes, [{ noteId: 'note-b', letter: 'b', text: 'The 2.3 line runs 7.4 s but the shot is 6 s.', done: false }]);
  const r31 = row(outline, '3.1');
  assert.deepEqual(r31.pills.map((pill) => pill.text.id), ['plan.pill.kf_none'], 'no clip pill before a keyframe exists');
  assert.deepEqual([r31.picture, r31.emptyThumb], [null, { id: 'plan.thumb.none' }]);
  assert.deepEqual(row(outline, '3.2').narration.detail, { id: 'plan.narr.estimate', values: { seconds: 1.6 } });
});

test('failures and unanswered jobs are neutral with an icon; an earlier keyframe shows dimmed', () => {
  const shot = lastFerryOverview().shots[shotId('2.1')];
  const failed = { ...shot, keyframe: { state: 'failed', takeCount: 1, opened: false, previous: shot.keyframe.artifact, failure: { code: 'X', technical: false, retryAllowed: true, autoRetriesLeft: 0, charged: true, at: '' } } };
  assert.deepEqual(keyframePill(failed), { text: { id: 'plan.pill.kf_failed_charged' }, tone: 'fail', icon: '!' });
  assert.deepEqual(keyframePill({ ...shot, keyframe: { state: 'no_answer', takeCount: 0, opened: false } }), { text: { id: 'plan.pill.no_answer' }, tone: 'fail', icon: '?' });
  assert.deepEqual(clipPill({ ...shot, video: { state: 'no_answer', takeCount: 0 } }).icon, '?');
  assert.equal(clipPill({ ...shot, keyframe: { state: 'none', takeCount: 0, opened: false } }), null);
  const overview = lastFerryOverview();
  overview.shots[shotId('2.1')] = failed;
  const outline = planOutline(lastFerrySnapshot(), overview);
  assert.deepEqual([row(outline, '2.1').picture.artifactId, row(outline, '2.1').pictureDimmed], ['art-2.1', true]);
});

test('server placeholders and the direction header are not shown as written text', () => {
  assert.equal(written('purpose', 'New shot'), '');
  assert.equal(written('framing', 'Describe the visual direction'), '');
  assert.equal(written('sceneDirection', 'New scene'), '');
  assert.equal(written('imagePrompt', '  A pier at dawn '), 'A pier at dawn');
  assert.equal(promptText('OpenSlate current direction:\nMara waits. Wide\nReference details (retain only where consistent):\nMara on the pier.'), 'Mara on the pier.');
  assert.equal(promptText('Pending direction'), '');
  const shot = lastFerryOverview().shots[shotId('2.1')];
  assert.deepEqual(narrationView(shot, 'undecided', 30), { kind: 'undecided', text: '', detail: null });
  assert.deepEqual(narrationView(shot, 'none', 30).kind, 'none');
});

test('a rewritten picture prompt keeps the direction header the server put in front of it', () => {
  const header = 'OpenSlate current direction:\nMara waits. Wide\nReference details (retain only where consistent):\n';
  assert.equal(promptToSave(`${header}Mara on the pier.`, 'Mara alone on the pier.'), `${header}Mara alone on the pier.`);
  assert.equal(promptToSave('Mara on the pier.', 'Mara alone on the pier.'), 'Mara alone on the pier.');
  // A header without its separator is not the server's: the words are the whole prompt.
  assert.equal(promptToSave('OpenSlate current direction:\nMara waits.', 'Fog.'), 'Fog.');
});

test("a new scene's server placeholder is not shown as its direction", () => {
  const overview = lastFerryOverview();
  overview.scenes[2] = { ...overview.scenes[2], purpose: 'New scene' };
  assert.equal(planOutline(lastFerrySnapshot(), overview).scenes[2].direction, '');
});

test("the Director's notes repeat on their rows and scenes; stale ones are left out", () => {
  const note = (noteId, letter, anchor, state = 'open') => ({ noteId, requestId: 'r', turnId: 't', letter, anchor, kind: 'observation', blocking: false, text: `Note ${letter}`, choices: [{ kind: 'reply' }], state, version: 1, createdAt: '' });
  const snapshot = { ...lastFerrySnapshot(), notes: [
    note('n1', 'a', { shotIds: [shotId('2.2')] }),
    note('n2', 'b', { shotIds: [shotId('2.3')] }, 'resolved'),
    note('n3', 'c', { sceneId: sceneId(3) }),
    note('n4', 'd', { shotIds: [shotId('2.1')] }, 'stale'),
  ] };
  snapshot.notes[1].resolution = { choiceIndex: 0, at: '' };
  const outline = planOutline(snapshot, lastFerryOverview());
  assert.deepEqual(row(outline, '2.2').notes, [{ noteId: 'n1', letter: 'a', text: 'Note a', done: false }]);
  assert.deepEqual(row(outline, '2.3').notes.map((n) => [n.letter, n.done]), [['b', true]]);
  assert.deepEqual(row(outline, '2.1').notes, []);
  assert.deepEqual(outline.scenes[2].notes.map((n) => n.letter), ['c']);
  assert.deepEqual(outline.scenes[1].notes, []);
});

test('moves name the neighbour to go before and the new number', () => {
  const outline = golden();
  assert.deepEqual(sceneMove(outline, sceneId(3), -1), { beforeId: sceneId(2), ordinal: 2 });
  assert.deepEqual(sceneMove(outline, sceneId(1), 1), { beforeId: sceneId(3), ordinal: 2 });
  assert.deepEqual(sceneMove(outline, sceneId(2), 1), { beforeId: undefined, ordinal: 3 });
  assert.equal(sceneMove(outline, sceneId(1), -1), null);
  assert.deepEqual(shotMove(outline, shotId('2.2'), -1), { sceneId: sceneId(2), beforeId: shotId('2.1'), from: '2.2', to: '2.1' });
  assert.deepEqual(shotMove(outline, shotId('2.1'), 1), { sceneId: sceneId(2), beforeId: shotId('2.3'), from: '2.1', to: '2.2' });
  assert.deepEqual(shotMove(outline, shotId('2.2'), 1), { sceneId: sceneId(2), beforeId: undefined, from: '2.2', to: '2.3' });
  assert.equal(shotMove(outline, shotId('2.3'), 1), null);
  assert.equal(locate(outline, shotId('3.2')).scene.ordinal, 3);
});

test('a delete confirm lists what stays in Assets and the new film length', () => {
  const outline = golden();
  const overview = lastFerryOverview();
  assert.deepEqual(deleteSceneFacts(outline, overview, sceneId(1)), {
    media: [{ id: 'plan.count.keyframes', values: { count: 3 } }, { id: 'plan.count.clips', values: { count: 3 } }, { id: 'plan.count.voices', values: { count: 1 } }],
    seconds: 31, renumbers: true, shots: 3,
  });
  assert.deepEqual(deleteSceneFacts(outline, overview, sceneId(3)), { media: [], seconds: 32, renumbers: false, shots: 2 });
  assert.deepEqual(deleteShotFacts(outline, overview, shotId('2.2')), { media: [{ id: 'plan.count.keyframes', values: { count: 1 } }], seconds: 44, renumbers: true, shots: 1 });
  assert.deepEqual(mediaCountMsgs(mediaCounts([])), []);
});

test('the shot or scene an add created is found by comparing the overview before and after', () => {
  const before = lastFerryOverview();
  const after = structuredClone(before);
  after.shots['new'] = { ...after.shots[shotId('2.1')], shotId: 'new', label: '2.4' };
  after.scenes[1].shotIds.push('new');
  after.scenes.push({ ...after.scenes[2], sceneId: 'scene-new', ordinal: 4, shotIds: [] });
  assert.equal(addedShot(before, after, sceneId(2)).shotId, 'new');
  assert.equal(addedShot(before, after, sceneId(1)), null);
  assert.equal(addedScene(before, after).sceneId, 'scene-new');
});

test('every message the outline uses is in the catalog', () => {
  const outline = planOutline({ ...lastFerrySnapshot(), notes: [] }, lastFerryOverview());
  for (const id of ids(outline)) assert.ok(Object.hasOwn(catalog, id), `${id} is not in the catalog`);
});
