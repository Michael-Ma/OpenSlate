import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCommand, recompute, FIXTURE_TIMING } from '../../src/next/fixtures/fixture-commands.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, lastFerryNotes, lastFerryProposals, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { confirmBody, keyframesBody, videoBody } from '../../src/next/model/commands.ts';
import { StudioStore } from '../../src/next/store/store.ts';

/** A fixture world with a manual clock, so simulated provider time runs on demand. */
function world() {
  const timers = [];
  let now = 0;
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector }, proposals: lastFerryProposals(),
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
const post = (w, path, body) => fixtureCommand(w, 'POST', path, body);
const read = (w, scene) => fixtureCommand(w, 'GET', `/scenes/${scene}/generation`);
const shot = (w, label) => w.overview.shots[shotId(label)];
const scene = (w, ordinal) => w.overview.scenes[ordinal - 1];
const open = (w, label) => { const { artifactId, sha256 } = shot(w, label).keyframe.artifact; return post(w, `/shots/${shotId(label)}/frame-views`, { artifactId, sha256 }); };
const edit = (w, body) => post(w, '/storyboard', { ...body, expectedHeadVersion: w.snapshot.project.headVersion });
const refused = code => error => error.code === code;
/** The Director's note b is carried out by accepting its proposal p1: 2.3 becomes 8 s and the note resolves. */
const acceptP1 = (w) => post(w, '/director/proposals/p1/accept', { previewDigest: w.proposals.find(p => p.proposalId === 'p1').previewDigest });

test('recompute leaves the golden Last Ferry state exactly as it is, the open blocking note included', () => {
  assert.deepEqual(recompute(lastFerryOverview(), lastFerryNotes()), lastFerryOverview());
  const withoutNotes = recompute(lastFerryOverview(), []);
  assert.ok(!withoutNotes.scenes[1].blockers.some(b => b.code === 'recommendation_open'));
});

test('opening a frame records it against the exact picture; a stale picture is refused', () => {
  const w = world();
  const receipt = open(w, '2.2');
  assert.equal(receipt.shotId, shotId('2.2'));
  assert.equal(shot(w, '2.2').keyframe.opened, true);
  assert.equal(scene(w, 2).counts.opened, 2);
  assert.deepEqual(scene(w, 2).blockers.map(b => b.code), ['frame_not_opened', 'narration_too_long', 'recommendation_open']);
  assert.throws(() => post(w, `/shots/${shotId('2.3')}/frame-views`, { artifactId: 'art-2.3', sha256: 'f'.repeat(64) }), refused('FRAME_STALE'));
});

test('the scene read carries the freshness tokens and the current frames', () => {
  const w = world();
  const r = read(w, sceneId(2));
  assert.equal(r.headVersion, 12);
  assert.deepEqual(r.rows.map(row => [row.shotId, row.image?.artifactId, row.imageComplete, row.videoComplete]),
    [[shotId('2.1'), 'art-2.1', true, false], [shotId('2.2'), 'art-2.2', true, false], [shotId('2.3'), 'art-2.3', true, false]]);
});

test('Make 2.3 8 s settles the line, and Undo restores 6 s and the check', () => {
  const w = world();
  const { commandId } = edit(w, { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '240' });
  assert.equal(shot(w, '2.3').durationFrames, 240);
  assert.equal(shot(w, '2.3').narration.fits, true);
  assert.equal(w.snapshot.project.headVersion, 13);
  assert.ok(!scene(w, 2).blockers.some(b => b.code === 'narration_too_long'));
  assert.throws(() => post(w, '/storyboard', { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '210', expectedHeadVersion: 12 }), refused('REVISION_CONFLICT'));
  edit(w, { kind: 'undo', commandId });
  assert.equal(shot(w, '2.3').durationFrames, 180);
  assert.equal(shot(w, '2.3').narration.fits, false);
  assert.ok(scene(w, 2).blockers.some(b => b.code === 'narration_too_long'));
  assert.throws(() => edit(w, { kind: 'undo', commandId }), refused('UNDO_UNAVAILABLE'));
  assert.throws(() => edit(w, { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '60' }), refused('VALIDATION_ERROR'));
});

test('regenerating 2.2 makes a red-coat second take that is not opened', () => {
  const w = world();
  open(w, '2.2');
  const body = { ...keyframesBody(read(w, sceneId(2)), [shotId('2.2')], true), expectedEstimateMicros: '40000' };
  assert.throws(() => post(w, `/scenes/${sceneId(2)}/generate`, { ...body, expectedEstimateMicros: '80000' }), refused('ESTIMATE_CHANGED'));
  post(w, `/scenes/${sceneId(2)}/generate`, body);
  const making = shot(w, '2.2').keyframe;
  assert.deepEqual([making.state, making.previous.artifactId, making.opened], ['running', 'art-2.2', false]);
  assert.equal(scene(w, 2).state, 'keyframes_partial');
  assert.ok(scene(w, 2).blockers.some(b => b.code === 'keyframe_missing' && b.shotId === shotId('2.2')));
  assert.throws(() => post(w, `/scenes/${sceneId(2)}/generate`, { ...keyframesBody(read(w, sceneId(2)), [shotId('2.2')], true), expectedEstimateMicros: '40000' }), refused('ATTEMPT_EXISTS'));
  w.advance(FIXTURE_TIMING.keyframeMs);
  const back = shot(w, '2.2').keyframe;
  assert.deepEqual([back.state, back.artifact.artifactId, back.takeCount, back.opened], ['ready', 'art-2.2-red', 2, false]);
  assert.equal(scene(w, 2).state, 'keyframes_back');
});

test('confirming Scene 2 makes one clip after another, then the scene reads video saved', () => {
  const w = world();
  open(w, '2.2'); open(w, '2.3');
  acceptP1(w);
  assert.deepEqual(scene(w, 2).blockers, []);
  assert.equal(scene(w, 2).quotes.confirmVideo.micros, '1500000');
  const body = { ...videoBody(read(w, sceneId(2)), w.overview), expectedEstimateMicros: '1500000' };
  post(w, `/scenes/${sceneId(2)}/generate`, body);
  assert.equal(scene(w, 2).state, 'making_video');
  assert.equal(scene(w, 2).confirmation.state, 'running');
  assert.deepEqual(['2.1', '2.2', '2.3'].map(l => shot(w, l).video.state), ['running', 'queued', 'queued']);
  assert.deepEqual(['2.2', '2.3'].map(l => shot(w, l).video.waiting.ahead), [0, 1]);
  w.advance(FIXTURE_TIMING.clipMs);
  assert.deepEqual(['2.1', '2.2', '2.3'].map(l => shot(w, l).video.state), ['ready', 'running', 'queued']);
  w.advance(FIXTURE_TIMING.clipMs * 2);
  assert.equal(scene(w, 2).state, 'video_saved');
  assert.equal(scene(w, 2).confirmation.state, 'done');
  assert.deepEqual(scene(w, 2).videoTargets, []);
  assert.equal(scene(w, 2).counts.videosReady, 3);
});

test('the durable confirm binds the opened frames and the digest, then makes the clips', () => {
  const w = world();
  open(w, '2.2'); open(w, '2.3');
  acceptP1(w);
  const body = confirmBody(w.overview, scene(w, 2));
  assert.throws(() => post(w, `/scenes/${sceneId(2)}/confirm`, { ...body, confirmationDigest: 'old' }), refused('SCENE_REVIEW_STALE'));
  assert.throws(() => post(w, `/scenes/${sceneId(2)}/confirm`, { ...body, expectedEstimateMicros: '1000000' }), refused('ESTIMATE_CHANGED'));
  const view = post(w, `/scenes/${sceneId(2)}/confirm`, body);
  assert.deepEqual([view.state, view.currentShotId], ['running', shotId('2.1')]);
  assert.equal(scene(w, 2).confirmation.state, 'running');
  assert.throws(() => post(w, `/scenes/${sceneId(2)}/confirm`, body), refused('ATTEMPT_EXISTS'));
  w.advance(FIXTURE_TIMING.clipMs * 3);
  assert.equal(scene(w, 2).confirmation.state, 'done');
  assert.equal(scene(w, 2).state, 'video_saved');
});

test('narration fit: extend lengthens the shot to the whole second that fits; cut keeps it; both undo', () => {
  const w = world();
  const fitPost = (fit) => post(w, `/shots/${shotId('2.3')}/narration-fit`, { fit, expectedHeadVersion: w.snapshot.project.headVersion });
  const extended = fitPost('extend_shot');
  assert.deepEqual([extended.fit, extended.durationFrames], ['extend_shot', 240]);
  assert.deepEqual([shot(w, '2.3').narration.fit, shot(w, '2.3').narration.fits], ['extend_shot', true]);
  assert.ok(!scene(w, 2).blockers.some(b => b.code === 'narration_too_long'));
  assert.equal(w.snapshot.project.shots.find(s => s.id === shotId('2.3')).desiredFrames, 240);
  edit(w, { kind: 'undo', commandId: extended.commandId });
  assert.deepEqual([shot(w, '2.3').durationFrames, shot(w, '2.3').narration.fit], [180, undefined]);
  const cut = fitPost('cut_to_shot');
  assert.deepEqual([cut.durationFrames, shot(w, '2.3').narration.fit, shot(w, '2.3').narration.fits], [180, 'cut_to_shot', false]);
  assert.ok(!scene(w, 2).blockers.some(b => b.code === 'narration_too_long'), 'a cut line no longer blocks');
  edit(w, { kind: 'undo', commandId: cut.commandId });
  assert.ok(scene(w, 2).blockers.some(b => b.code === 'narration_too_long'));
  assert.throws(() => post(w, `/shots/${shotId('2.3')}/narration-fit`, { fit: 'extend_shot', expectedHeadVersion: 1 }), refused('REVISION_CONFLICT'));
  assert.throws(() => post(w, `/shots/${shotId('2.1')}/narration-fit`, { fit: 'cut_to_shot', expectedHeadVersion: w.snapshot.project.headVersion }), refused('VALIDATION_ERROR'));
});

test('shortening a shot below its line undoes an extend fit', () => {
  const w = world();
  post(w, `/shots/${shotId('2.3')}/narration-fit`, { fit: 'extend_shot', expectedHeadVersion: w.snapshot.project.headVersion });
  edit(w, { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '180' });
  assert.equal(shot(w, '2.3').narration.fit, undefined);
  assert.ok(scene(w, 2).blockers.some(b => b.code === 'narration_too_long'));
});

test('a confirm is refused while frames are unopened or the line is too long', () => {
  const w = world();
  open(w, '2.2'); open(w, '2.3');
  const body = videoBody(read(w, sceneId(2)), w.overview);
  assert.throws(() => post(w, `/scenes/${sceneId(2)}/generate`, body), refused('NARRATION_TOO_LONG'));
  assert.equal(scene(w, 2).state, 'keyframes_back');
});

test('Scene 3 makes both keyframes for about $0.08; they come back not opened', () => {
  const w = world();
  assert.equal(scene(w, 3).quotes.makeKeyframes.micros, '80000');
  post(w, `/scenes/${sceneId(3)}/generate`, { ...keyframesBody(read(w, sceneId(3))), expectedEstimateMicros: '80000' });
  assert.deepEqual(['3.1', '3.2'].map(l => shot(w, l).keyframe.state), ['running', 'running']);
  assert.deepEqual(scene(w, 3).keyframeTargets, []);
  w.advance(FIXTURE_TIMING.keyframeMs);
  assert.deepEqual(['3.1', '3.2'].map(l => [shot(w, l).keyframe.state, shot(w, l).keyframe.artifact.artifactId, shot(w, l).keyframe.opened]), [['ready', 'art-3.1', false], ['ready', 'art-3.2', false]]);
  assert.equal(scene(w, 3).state, 'keyframes_back');
  assert.deepEqual(scene(w, 3).blockers.map(b => b.code), ['frame_not_opened', 'frame_not_opened']);
});

test('a prompt edit outdates the keyframe and its clip, keeping both as earlier takes; Undo brings them back', () => {
  const w = world();
  const before = shot(w, '1.1');
  const { commandId } = edit(w, { kind: 'shot', id: shotId('1.1'), field: 'imagePrompt', value: 'The ticket office at dawn.' });
  const after = shot(w, '1.1');
  assert.deepEqual([after.keyframe.state, after.keyframe.previous.artifactId, after.keyframe.outdatedFields], ['outdated', 'art-1.1', ['imagePrompt']]);
  assert.deepEqual([after.video.state, after.video.previous.artifactId], ['outdated', 'art-1.1-clip']);
  assert.equal(scene(w, 1).state, 'keyframes_partial');
  assert.deepEqual(scene(w, 1).keyframeTargets, [shotId('1.1')]);
  edit(w, { kind: 'undo', commandId });
  assert.deepEqual(shot(w, '1.1').keyframe, before.keyframe);
  assert.deepEqual(shot(w, '1.1').video, before.video);
  assert.equal(scene(w, 1).state, 'video_saved');
});

test('motion and duration edits outdate only a finished clip', () => {
  const w = world();
  edit(w, { kind: 'shot', id: shotId('1.2'), field: 'motion', value: 'Slow push-in' });
  assert.deepEqual([shot(w, '1.2').keyframe.state, shot(w, '1.2').video.state], ['ready', 'outdated']);
  edit(w, { kind: 'shot', id: shotId('2.1'), field: 'desiredFrames', value: '210' });
  assert.deepEqual([shot(w, '2.1').keyframe.state, shot(w, '2.1').keyframe.opened, shot(w, '2.1').video.state], ['ready', true, 'none']);
});

test('a new narration line is estimated at the recorded pace and stops blocking once it fits', () => {
  const w = world();
  edit(w, { kind: 'narration', id: shotId('2.3'), field: 'text', value: 'It was the last boat, and I nearly missed it.' });
  const line = shot(w, '2.3').narration;
  assert.deepEqual([line.state, line.estimatedSeconds, line.measuredSeconds, line.fits], ['text_only', 5.7, undefined, true]);
  assert.ok(!scene(w, 2).blockers.some(b => b.code === 'narration_too_long'));
  assert.equal(w.snapshot.project.shots.find(s => s.id === shotId('2.3')).narration.text, 'It was the last boat, and I nearly missed it.');
});

const note = (w, id) => w.snapshot.notes.find(n => n.noteId === id);
const proposal = (w, id) => w.proposals.find(p => p.proposalId === id);
const resolve = (w, id, choiceIndex, resultRef) => post(w, `/director/notes/${id}/resolve`, { choiceIndex, expectedVersion: note(w, id).version, ...(resultRef ? { resultRef } : {}) });

test('the golden snapshot carries the two notes of the design and the held proposal behind b', () => {
  const w = world();
  assert.deepEqual(w.snapshot.notes.map(n => [n.letter, n.kind, n.blocking, n.state, n.choices.map(c => c.kind)]),
    [['a', 'observation', false, 'open', ['accept', 'regenerate_keyframe']], ['b', 'recommendation', true, 'open', ['proposal', 'edit_field']]]);
  assert.deepEqual([proposal(w, 'p1').state, proposal(w, 'p1').preview.filmSecondsNow, proposal(w, 'p1').preview.filmSecondsAfter], ['held', 48, 50]);
});

test('Keep maroon resolves note a; a non-blocking note never gated the confirm', () => {
  const w = world();
  assert.ok(!scene(w, 2).blockers.some(b => b.code === 'recommendation_open' && b.shotId === shotId('2.2')));
  const resolved = resolve(w, 'note-a', 0);
  assert.deepEqual([resolved.state, resolved.version, resolved.resolution.choiceIndex], ['resolved', 2, 0]);
  assert.throws(() => resolve(w, 'note-a', 0), refused('REVISION_CONFLICT'));
});

test('accepting p1 applies it and resolves note b atomically; the note route only acknowledges; undo reopens', () => {
  const w = world();
  assert.throws(() => resolve(w, 'note-b', 0, 'p1'), refused('NOTE_RESULT_INVALID'), 'the note cannot carry out a proposal');
  assert.throws(() => post(w, '/director/proposals/p1/accept', { previewDigest: 'old' }), refused('PROPOSAL_PREVIEW_CHANGED'));
  const { proposal: accepted } = acceptP1(w);
  assert.equal(accepted.state, 'accepted');
  assert.equal(shot(w, '2.3').durationFrames, 240);
  assert.deepEqual([note(w, 'note-b').state, note(w, 'note-b').resolution.resultRef, note(w, 'note-b').version], ['resolved', 'p1', 2]);
  assert.ok(!scene(w, 2).blockers.some(b => b.code === 'recommendation_open' || b.code === 'narration_too_long'));
  // Acknowledging the already accepted proposal through the note is idempotent.
  assert.equal(post(w, '/director/notes/note-b/resolve', { choiceIndex: 0, expectedVersion: 1, resultRef: 'p1' }).state, 'resolved');
  assert.throws(() => acceptP1(w), refused('PROPOSAL_STALE'));
  const undone = post(w, '/director/proposals/p1/undo');
  assert.deepEqual([undone.proposal.state, undone.leftAlone], ['undone', []]);
  assert.equal(shot(w, '2.3').durationFrames, 180);
  assert.deepEqual([note(w, 'note-b').state, note(w, 'note-b').resolution, note(w, 'note-b').version], ['open', undefined, 3]);
  assert.ok(scene(w, 2).blockers.some(b => b.code === 'recommendation_open'));
});

test('undo leaves a field the person changed since as it is', () => {
  const w = world();
  acceptP1(w);
  edit(w, { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '270' });
  const undone = post(w, '/director/proposals/p1/undo');
  assert.deepEqual(undone.leftAlone, [{ shotId: shotId('2.3'), field: 'desiredFrames' }]);
  assert.equal(shot(w, '2.3').durationFrames, 270);
});

test('a held proposal goes stale while its shot differs and is held again when it changes back; reject keeps the note open', () => {
  const w = world();
  const { commandId } = edit(w, { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '210' });
  assert.deepEqual([proposal(w, 'p1').state, proposal(w, 'p1').staleReason], ['stale', 'SHOT_CHANGED']);
  assert.throws(() => acceptP1(w), refused('PROPOSAL_STALE'));
  edit(w, { kind: 'undo', commandId });
  assert.equal(proposal(w, 'p1').state, 'held');
  post(w, '/director/proposals/p1/reject');
  assert.deepEqual([proposal(w, 'p1').state, note(w, 'note-b').state], ['rejected', 'open']);
});

test('a regenerate choice names the press that carried it out', () => {
  const w = world();
  assert.throws(() => resolve(w, 'note-a', 1, 'request-unknown'), refused('NOTE_RESULT_INVALID'));
  const receipt = post(w, `/scenes/${sceneId(2)}/generate`, { ...keyframesBody(read(w, sceneId(2)), [shotId('2.2')], true), expectedEstimateMicros: '40000' });
  assert.ok(receipt.requestId);
  assert.deepEqual(receipt.shotIds, [shotId('2.2')]);
  assert.equal(resolve(w, 'note-a', 1, receipt.requestId).state, 'resolved');
  w.advance(FIXTURE_TIMING.keyframeMs);
  assert.equal(note(w, 'note-a').state, 'resolved', 'a settled note does not go stale when its new take lands');
});

test('a note whose seen keyframe is replaced some other way goes stale and leaves the banner', () => {
  const w = world();
  post(w, `/scenes/${sceneId(2)}/generate`, { ...keyframesBody(read(w, sceneId(2)), [shotId('2.2')], true), expectedEstimateMicros: '40000' });
  assert.equal(note(w, 'note-a').state, 'open', 'still open while the new take is being made');
  w.advance(FIXTURE_TIMING.keyframeMs);
  assert.equal(note(w, 'note-a').state, 'stale');
  assert.throws(() => resolve(w, 'note-a', 0), refused('NOTE_STALE'));
});

test('an edit choice names the edit that carried it out, and undoing that edit reopens the note', () => {
  const w = world();
  const wrong = edit(w, { kind: 'shot', id: shotId('2.3'), field: 'motion', value: 'Static' });
  assert.throws(() => resolve(w, 'note-b', 1, wrong.commandId), refused('NOTE_RESULT_INVALID'));
  const { commandId } = edit(w, { kind: 'narration', id: shotId('2.3'), field: 'text', value: 'The last boat, and I nearly missed it.' });
  assert.equal(resolve(w, 'note-b', 1, commandId).state, 'resolved');
  assert.deepEqual(scene(w, 2).blockers.filter(b => b.shotId === shotId('2.3')).map(b => b.code), ['frame_not_opened']);
  edit(w, { kind: 'undo', commandId });
  assert.deepEqual([note(w, 'note-b').state, shot(w, '2.3').narration.text], ['open', 'It was the last boat of the season, and I nearly missed it.']);
});

test('Stop detaches queued clips and keeps sent ones; Continue needs the current authority', () => {
  const w = world();
  open(w, '2.2'); open(w, '2.3');
  acceptP1(w);
  post(w, `/scenes/${sceneId(2)}/generate`, videoBody(read(w, sceneId(2)), w.overview));
  const { stopped } = post(w, '/controls', { action: 'stop' });
  assert.deepEqual([stopped.sentJobs, stopped.detachedJobs], [1, 2]);
  assert.deepEqual(['2.1', '2.2', '2.3'].map(l => shot(w, l).video.state), ['running', 'none', 'none']);
  assert.equal(w.snapshot.control.paused, true);
  assert.throws(() => post(w, `/scenes/${sceneId(3)}/generate`, keyframesBody(read(w, sceneId(3)))), refused('EXECUTION_PAUSED'));
  w.advance(FIXTURE_TIMING.clipMs * 3);
  assert.deepEqual(['2.1', '2.2', '2.3'].map(l => shot(w, l).video.state), ['ready', 'none', 'none'], 'the sent clip finished; nothing new was sent');
  assert.equal(scene(w, 2).confirmation.state, 'cancelled');
  assert.ok(scene(w, 2).blockers.some(b => b.code === 'stopped'));
  assert.throws(() => post(w, '/controls', { action: 'resume', expectedAuthorityId: 'other' }), refused('CONTROL_STALE'));
  post(w, '/controls', { action: 'resume', expectedAuthorityId: w.overview.controlAuthorityId });
  assert.equal(w.overview.stopped, null);
  assert.deepEqual(scene(w, 2).videoTargets, [shotId('2.2'), shotId('2.3')]);
});

test('giving up on a job with no answer needs the double-charge acknowledgement', () => {
  const w = world();
  w.update(x => { x.overview = recompute({ ...x.overview, shots: { ...x.overview.shots, [shotId('2.2')]: { ...shot(x, '2.2'), keyframe: { state: 'no_answer', attemptId: 'attempt-7', takeCount: 1, opened: false, previous: shot(x, '2.2').keyframe.artifact } } } }); });
  assert.equal(scene(w, 2).state, 'needs_attention');
  assert.ok(scene(w, 2).blockers.some(b => b.code === 'no_answer_in_scene'));
  assert.throws(() => post(w, '/attempts/attempt-7/release', { expectedPhase: 'submission_unknown' }), refused('DOUBLE_CHARGE_NOT_ACKNOWLEDGED'));
  const receipt = post(w, '/attempts/attempt-7/release', { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true });
  assert.equal(receipt.shotId, shotId('2.2'));
  assert.deepEqual([shot(w, '2.2').keyframe.state, shot(w, '2.2').keyframe.releasedAttemptIds], ['none', ['attempt-7']]);
  assert.deepEqual(scene(w, 2).keyframeTargets, [shotId('2.2')]);
  assert.throws(() => post(w, '/attempts/attempt-7/release', { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true }), refused('ATTEMPT_NOT_RELEASABLE'));
});

test('the store and the fixture agree on the whole Scene 2 path', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const port = new FixturePort();
  let n = 0;
  const store = new StudioStore({ client: port, storage: null, newKey: () => `key-${++n}` });
  const state = () => store.getState();
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); await store.refresh(); };
  try {
    await store.start();
    assert.equal(state().overview.scenes[1].state, 'keyframes_back');
    await store.openFrame(shotId('2.2'));
    await store.openFrame(shotId('2.3'));
    await settle();
    assert.equal(state().overview.scenes[1].counts.opened, 3);
    assert.ok(await store.narrationFit(shotId('2.3'), 'extend_shot', { id: 'toast.saved' }));
    const undo = state().toast.undoCommandId;
    assert.ok(undo, 'the toast offers Undo');
    await settle();
    assert.equal(state().overview.shots[shotId('2.3')].durationFrames, 240);
    assert.ok(await store.undo(undo));
    await settle();
    assert.equal(state().overview.shots[shotId('2.3')].durationFrames, 180);
    // The Director's note b is carried out by accepting its proposal, which resolves the note.
    await settle();
    assert.equal(state().proposals[0].state, 'held');
    const accepted = await store.acceptProposal(state().proposals[0]);
    assert.equal(accepted?.proposal.state, 'accepted');
    await settle();
    assert.deepEqual(state().overview.scenes[1].blockers, []);
    await store.confirmVideo(sceneId(2));
    await settle();
    assert.equal(state().toast?.tone === 'error' ? state().toast.message.id : 'none', 'none');
    assert.equal(state().overview.scenes[1].state, 'making_video');
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(FIXTURE_TIMING.clipMs); await settle(); }
    assert.equal(state().overview.scenes[1].state, 'video_saved');
    await store.regenerateKeyframe(shotId('2.2'));
    await settle();
    assert.equal(state().overview.shots[shotId('2.2')].keyframe.state, 'running');
    assert.equal(state().overview.shots[shotId('2.2')].video.state, 'outdated', 'its clip will need redoing');
    t.mock.timers.tick(FIXTURE_TIMING.keyframeMs);
    await settle();
    const take = state().overview.shots[shotId('2.2')].keyframe;
    assert.deepEqual([take.state, take.takeCount, take.opened], ['ready', 2, false]);
  } finally {
    store.stop();
    port.close();
  }
});
