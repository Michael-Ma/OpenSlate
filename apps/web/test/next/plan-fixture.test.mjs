import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCommand } from '../../src/next/fixtures/fixture-commands.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { lastFerryDirector, lastFerryOverview, lastFerrySnapshot, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { IMPORT_READ_MS, planRoutes } from '../../src/next/fixtures/routes/plan.ts';

/** A fixture world with a manual clock (as in keyframes-fixture.test.mjs). */
function world() {
  const timers = [];
  let now = 0;
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector },
    update(change) { change(w); const cursor = w.overview.cursor + 1; w.overview = { ...w.overview, cursor }; w.snapshot = { ...w.snapshot, cursor }; },
    later(ms, change) { timers.push({ at: now + ms, change }); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > until) break;
        timers.shift();
        now = next.at;
        w.update(next.change);
      }
      now = until;
    },
  };
  return w;
}

/** Plan routes first, then the Keyframes commands: the order the fixture port uses. */
function call(w, method, path, body) {
  for (const route of planRoutes) {
    const match = route.method === method ? route.match.exec(path) : null;
    if (match) return route.handle(w, match.slice(1), body);
  }
  return fixtureCommand(w, method, path, body);
}
const edit = (w, body) => call(w, 'POST', '/storyboard', { ...body, expectedHeadVersion: w.snapshot.project.headVersion });
const refused = (code) => (error) => error.code === code;
const labels = (w) => w.overview.scenes.map((scene) => scene.shotIds.map((id) => w.overview.shots[id].label));
const shot = (w, id) => w.overview.shots[id];

test('renaming a scene changes only its title, with a new head version, and Undo restores it', () => {
  const w = world();
  const receipt = edit(w, { kind: 'sceneTitle', id: sceneId(2), value: 'First light' });
  assert.equal(receipt.headVersion, 13);
  assert.equal(w.overview.scenes[1].title, 'First light');
  assert.equal(w.snapshot.project.scenes[1].title, 'First light');
  assert.equal(shot(w, shotId('2.1')).keyframe.state, 'ready');
  const back = edit(w, { kind: 'undo', commandId: receipt.commandId });
  assert.equal(back.headVersion, 14);
  assert.equal(w.overview.scenes[1].title, 'Harbour at dawn');
  assert.throws(() => edit(w, { kind: 'undo', commandId: receipt.commandId }), refused('UNDO_UNAVAILABLE'));
  assert.throws(() => edit(w, { kind: 'sceneTitle', id: sceneId(2), value: '  ' }), refused('VALIDATION_ERROR'));
});

test('brief, story and scene direction save without outdating anything', () => {
  const w = world();
  edit(w, { kind: 'treatment', field: 'story', value: 'A new story.' });
  edit(w, { kind: 'scene', id: sceneId(1), value: 'Warm lamp light inside the ticket office.' });
  assert.equal(w.snapshot.project.story, 'A new story.');
  assert.equal(w.overview.scenes[0].purpose, 'Warm lamp light inside the ticket office.');
  assert.equal(w.overview.scenes[0].title, 'Closing time');
  assert.deepEqual(Object.values(w.overview.shots).map((s) => s.video.state).filter((state) => state === 'outdated'), []);
});

test('moving a scene renumbers its shots, and Undo puts it back', () => {
  const w = world();
  const { commandId } = edit(w, { kind: 'moveScene', id: sceneId(3), beforeId: sceneId(2) });
  assert.deepEqual(w.overview.scenes.map((s) => [s.sceneId, s.ordinal]), [[sceneId(1), 1], [sceneId(3), 2], [sceneId(2), 3]]);
  assert.deepEqual([shot(w, shotId('3.1')).label, shot(w, shotId('2.1')).label], ['2.1', '3.1']);
  assert.deepEqual(w.snapshot.project.scenes.map((s) => s.id), [sceneId(1), sceneId(3), sceneId(2)]);
  assert.deepEqual(w.snapshot.project.shots.map((s) => s.id).slice(3, 5), [shotId('3.1'), shotId('3.2')]);
  edit(w, { kind: 'undo', commandId });
  assert.deepEqual(labels(w), [['1.1', '1.2', '1.3'], ['2.1', '2.2', '2.3'], ['3.1', '3.2']]);
});

test('moving a shot within its scene renumbers it', () => {
  const w = world();
  edit(w, { kind: 'moveShot', id: shotId('2.1'), sceneId: sceneId(2), beforeId: shotId('2.3') });
  assert.deepEqual(w.overview.scenes[1].shotIds, [shotId('2.2'), shotId('2.1'), shotId('2.3')]);
  edit(w, { kind: 'moveShot', id: shotId('2.1'), sceneId: sceneId(2) });
  assert.deepEqual(w.overview.scenes[1].shotIds, [shotId('2.2'), shotId('2.3'), shotId('2.1')]);
  assert.equal(shot(w, shotId('2.1')).label, '2.3');
});

test('deleting a scene needs its shots confirmed; Undo brings back the scene and its media', () => {
  const w = world();
  assert.throws(() => edit(w, { kind: 'deleteScene', id: sceneId(1) }), refused('SCENE_HAS_SHOTS'));
  const { commandId } = edit(w, { kind: 'deleteScene', id: sceneId(1), withShots: true });
  assert.deepEqual(labels(w), [['1.1', '1.2', '1.3'], ['2.1', '2.2']]);
  assert.equal(shot(w, shotId('1.1')), undefined);
  assert.equal(w.snapshot.project.shots.length, 5);
  edit(w, { kind: 'undo', commandId });
  assert.equal(w.overview.scenes.length, 3);
  assert.deepEqual([shot(w, shotId('1.2')).keyframe.state, shot(w, shotId('1.2')).video.state, shot(w, shotId('1.2')).label], ['ready', 'ready', '1.2']);
});

test('a new shot needs direction; a written framing lifts that', () => {
  const w = world();
  edit(w, { kind: 'addShot', sceneId: sceneId(3) });
  const added = w.overview.scenes[2].shotIds[2];
  assert.deepEqual([shot(w, added).label, shot(w, added).keyframe.state, shot(w, added).durationFrames], ['3.3', 'direction_required', 180]);
  edit(w, { kind: 'shot', id: added, field: 'purpose', value: 'The harbour lights go out.' });
  assert.equal(shot(w, added).keyframe.state, 'direction_required');
  edit(w, { kind: 'shot', id: added, field: 'framing', value: 'Wide' });
  assert.equal(shot(w, added).keyframe.state, 'none');
  assert.deepEqual(w.overview.scenes[2].keyframeTargets.length, 3);
  edit(w, { kind: 'addScene', value: 'Epilogue' });
  assert.deepEqual([w.overview.scenes[3].title, w.overview.scenes[3].ordinal, w.overview.scenes[3].state], ['Epilogue', 4, 'not_started']);
  edit(w, { kind: 'deleteScene', id: w.overview.scenes[3].sceneId });
  assert.equal(w.overview.scenes.length, 3);
});

test('purpose and framing outdate the keyframe and the clip; Undo restores both', () => {
  const w = world();
  const { commandId } = edit(w, { kind: 'shot', id: shotId('1.2'), field: 'purpose', value: 'Buying the last ticket.' });
  const s = shot(w, shotId('1.2'));
  assert.deepEqual([s.purpose, s.keyframe.state, s.keyframe.previous.artifactId, s.video.state], ['Buying the last ticket.', 'outdated', 'art-1.2', 'outdated']);
  assert.equal(w.overview.scenes[0].state, 'keyframes_partial');
  edit(w, { kind: 'undo', commandId });
  assert.deepEqual([shot(w, shotId('1.2')).keyframe.state, shot(w, shotId('1.2')).video.state, w.overview.scenes[0].state], ['ready', 'ready', 'video_saved']);
});

test('the Keyframes edits still go through the shared fixture, and their Undo too', () => {
  const w = world();
  const { commandId, headVersion } = edit(w, { kind: 'shot', id: shotId('2.1'), field: 'imagePrompt', value: 'Thick fog over the harbour.' });
  assert.equal(headVersion, 13);
  assert.equal(shot(w, shotId('2.1')).keyframe.state, 'outdated');
  edit(w, { kind: 'undo', commandId });
  assert.equal(shot(w, shotId('2.1')).keyframe.state, 'ready');
  const first = edit(w, { kind: 'shot', id: shotId('1.1'), field: 'motion', value: 'Slow pan left' });
  edit(w, { kind: 'narration', id: shotId('1.2'), field: 'text', value: 'One, please.' });
  assert.throws(() => edit(w, { kind: 'undo', commandId: first.commandId }), refused('UNDO_UNAVAILABLE'), 'only the latest command');
});

test('a shot cannot be shorter than its accepted voice line (SB-8)', () => {
  const w = world();
  // 2.3's 7.4 s line is too long for 6 s and not settled: nothing to protect yet.
  edit(w, { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '150' });
  const fit = call(w, 'POST', `/shots/${shotId('2.3')}/narration-fit`, { fit: 'extend_shot', expectedHeadVersion: w.snapshot.project.headVersion });
  assert.equal(shot(w, shotId('2.3')).durationFrames, 240);
  assert.throws(() => edit(w, { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '210' }), refused('SHOT_SHORTER_THAN_NARRATION'));
  edit(w, { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '270' });
  // 1.2's 2.1 s line fits: 3 s is fine.
  edit(w, { kind: 'shot', id: shotId('1.2'), field: 'desiredFrames', value: '90' });
  assert.ok(fit.commandId);
});

test("Undo is refused once paid work used the change, and the narration fit's Undo still works", () => {
  const w = world();
  const { commandId } = edit(w, { kind: 'sceneTitle', id: sceneId(3), value: 'Leaving' });
  w.update((x) => { x.overview = { ...x.overview, shots: { ...x.overview.shots, [shotId('3.1')]: { ...x.overview.shots[shotId('3.1')], keyframe: { state: 'running', takeCount: 0, opened: false } } } }; });
  assert.throws(() => edit(w, { kind: 'undo', commandId }), refused('UNDO_UNAVAILABLE'));
  const fit = call(w, 'POST', `/shots/${shotId('2.3')}/narration-fit`, { fit: 'extend_shot', expectedHeadVersion: w.snapshot.project.headVersion });
  edit(w, { kind: 'undo', commandId: fit.commandId });
  assert.equal(shot(w, shotId('2.3')).durationFrames, 180);
});

test('narration None and A line change the choice; the line stays for later', () => {
  const w = world();
  edit(w, { kind: 'narration', id: shotId('1.2'), field: 'mode', value: 'none' });
  assert.deepEqual([shot(w, shotId('1.2')).narration.state, w.snapshot.project.shots[1].narration.mode], ['none', 'none']);
  edit(w, { kind: 'narration', id: shotId('2.1'), field: 'text', value: 'Fog everywhere.' });
  edit(w, { kind: 'narration', id: shotId('2.1'), field: 'mode', value: 'generated' });
  assert.equal(shot(w, shotId('2.1')).narration.state, 'text_only');
});

test('a written plan: the Director reads it, edits wait, then confirm replaces the outline', () => {
  const w = world();
  assert.deepEqual(call(w, 'GET', '/plan-imports'), { pending: null });
  assert.throws(() => call(w, 'POST', '/plan-imports', { name: 'draft.docx', text: 'x', expectedHeadVersion: 12 }), refused('VALIDATION_ERROR'));
  const { requestId } = call(w, 'POST', '/plan-imports', { name: 'last-ferry-draft.md', text: '1. Closing time.', expectedHeadVersion: 12 });
  let read = call(w, 'GET', '/plan-imports').pending;
  assert.deepEqual([read.id, read.running, read.draft, read.stale], [requestId, true, null, false]);
  assert.equal(w.overview.director.state, 'working');
  assert.throws(() => edit(w, { kind: 'treatment', field: 'brief', value: 'New' }), refused('IMPORT_PENDING'));
  assert.throws(() => call(w, 'POST', '/plan-imports', { name: 'b.md', text: 'x', expectedHeadVersion: 12 }), refused('IMPORT_PENDING'));
  w.advance(IMPORT_READ_MS);
  read = call(w, 'GET', '/plan-imports').pending;
  assert.equal(read.running, false);
  assert.equal(read.draft.project.shots.length, 9);
  assert.ok(w.snapshot.conversation.some((entry) => entry.requestId === requestId && entry.role === 'assistant'));
  assert.throws(() => call(w, 'POST', `/plan-imports/${requestId}/confirm`, { preparedId: 'other', proposalDigest: read.draft.proposalDigest }), refused('IMPORT_STALE'));
  call(w, 'POST', `/plan-imports/${requestId}/confirm`, { preparedId: read.draft.preparedId, proposalDigest: read.draft.proposalDigest });
  assert.deepEqual(call(w, 'GET', '/plan-imports'), { pending: null });
  assert.deepEqual(labels(w)[1], ['2.1', '2.2', '2.3', '2.4']);
  const gangway = shot(w, w.overview.scenes[1].shotIds[3]);
  assert.deepEqual([gangway.purpose, gangway.keyframe.state, gangway.durationFrames], ['The gangway is lowered; Mara steps aboard.', 'none', 120]);
  assert.deepEqual([shot(w, shotId('2.3')).narration.state, shot(w, shotId('2.3')).narration.text], ['text_only', 'It was the last boat of the season.']);
  assert.equal(shot(w, shotId('2.1')).keyframe.state, 'ready', 'media already made stays');
  edit(w, { kind: 'treatment', field: 'brief', value: 'New brief.' });
});

test('discarding a written plan leaves the outline as it was', () => {
  const w = world();
  const { requestId } = call(w, 'POST', '/plan-imports', { name: 'a.txt', text: 'Plan.', expectedHeadVersion: 12 });
  call(w, 'POST', `/plan-imports/${requestId}/discard`, {});
  w.advance(IMPORT_READ_MS);
  assert.deepEqual(call(w, 'GET', '/plan-imports'), { pending: null });
  assert.equal(w.overview.director.state, 'idle');
  assert.equal(Object.keys(w.overview.shots).length, 8);
  assert.throws(() => call(w, 'POST', `/plan-imports/${requestId}/discard`, {}), refused('IMPORT_STALE'));
});

test('the fixture port serves the Plan routes before the Keyframes commands', async () => {
  const port = new FixturePort();
  try {
    const receipt = await port.request('/api/projects/last-ferry/storyboard', { method: 'POST', body: { kind: 'sceneTitle', id: sceneId(1), value: 'Last call', expectedHeadVersion: 12 } });
    assert.equal(receipt.headVersion, 13);
    assert.equal(port.world.overview.scenes[0].title, 'Last call');
    assert.deepEqual(await port.request('/api/projects/last-ferry/plan-imports'), { pending: null });
  } finally {
    port.close();
  }
});
