import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCommand, recompute, FIXTURE_TIMING } from '../../src/next/fixtures/fixture-commands.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, lastFerryProposals, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { keyframesBody } from '../../src/next/model/commands.ts';
import { applyDirectorPresets, fixtureMessage, FIXTURE_REPLY_MS } from '../../src/next/fixtures/fixture-director.ts';
import { generationLines } from '../../src/next/model/director.ts';
import { generationProgress } from '../../src/next/model/generation-progress.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

// The sample film follows the studio's rules where the X1 review found it drifted (items 7, 9, 10, 12, 13).

function world() {
  const timers = [];
  let now = 0;
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector }, proposals: lastFerryProposals(),
    update(change) { change(w); const cursor = w.overview.cursor + 1; w.overview = { ...w.overview, cursor }; w.snapshot = { ...w.snapshot, cursor }; },
    later(ms, change) { timers.push({ at: now + ms, change }); },
    advance(ms) {
      const until = now + ms;
      for (;;) { timers.sort((a, b) => a.at - b.at); const next = timers[0]; if (!next || next.at > until) break; timers.shift(); now = next.at; w.update(next.change); }
      now = until;
    },
  };
  return w;
}
const post = (w, path, body) => fixtureCommand(w, 'POST', path, body);
const read = (w, scene) => fixtureCommand(w, 'GET', `/scenes/${scene}/generation`);
const shot = (w, label) => w.overview.shots[shotId(label)];
const scene = (w, ordinal) => w.overview.scenes[ordinal - 1];
const setShot = (w, label, change) => w.update((x) => { x.overview = recompute({ ...x.overview, shots: { ...x.overview.shots, [shotId(label)]: change(shot(x, label)) } }, x.snapshot.notes ?? [], x.snapshot.project.shots); });
const release = (w, attemptId) => post(w, `/attempts/${attemptId}/release`, { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true });
const refusal = { code: 'PROVIDER_REFUSED', technical: false, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: 'now' };

test('the scripted Director records one generation effect per scene it started, as the studio does', () => {
  const w = world();
  // Scenes 2 and 3 both have keyframes to make.
  setShot(w, '2.2', (s) => ({ ...s, keyframe: { state: 'none', takeCount: 0, opened: false } }));
  fixtureMessage(w, { text: 'Please make the keyframes.' });
  w.advance(FIXTURE_REPLY_MS);
  const effects = w.snapshot.turns.at(-1).effects.generation;
  assert.ok(effects.length >= 2, 'one effect per started scene');
  assert.ok(effects.every((effect) => effect.sceneIds.length === 1));
  assert.deepEqual(effects.map((effect) => effect.sceneIds[0]), [...new Set(effects.map((effect) => effect.sceneIds[0]))]);
  const two = effects.find((effect) => effect.sceneIds[0] === sceneId(2));
  assert.ok(two.shotIds.includes(shotId('2.2')) && two.shotIds.every((id) => id.startsWith('shot-2-')));
  // Each line is that scene's own: its own count and price.
  const lines = generationLines(effects, w.overview, 'en');
  assert.equal(lines.length, effects.length);
  assert.match(translateMsg('en', { ...lines[0].text }), /in Scene \d ·/);
});

test('a refused keyframe stays a keyframe target, so the scene offers to make it again', () => {
  const w = world();
  setShot(w, '3.2', (s) => ({ ...s, keyframe: { state: 'failed', takeCount: 0, opened: false, failure: refusal } }));
  assert.ok(scene(w, 3).keyframeTargets.includes(shotId('3.2')));
  assert.equal(scene(w, 3).quotes.makeKeyframes.units >= 1, true);
});

test('an unanswered voice line or new take blocks its scene, with or without video targets', () => {
  const w = world();
  setShot(w, '3.1', (s) => ({ ...s, narration: { ...s.narration, state: 'no_answer', attemptId: 'v-3-1' } }));
  assert.equal(scene(w, 3).videoTargets.length, 0);
  assert.deepEqual(scene(w, 3).blockers.filter((b) => b.code === 'no_answer_in_scene'), [{ code: 'no_answer_in_scene', shotId: shotId('3.1') }]);
  setShot(w, '1.1', (s) => ({ ...s, video: { ...s.video, replacement: { state: 'no_answer', attemptId: 'clip-1-1' } } }));
  assert.ok(scene(w, 1).blockers.some((b) => b.code === 'no_answer_in_scene' && b.shotId === shotId('1.1')));
});

test('a voice line being made carries its attempt, and a settled one carries none', () => {
  const w = world();
  // Scene 3's keyframes press also makes 3.2's line, which has no voice yet.
  post(w, `/scenes/${sceneId(3)}/generate`, keyframesBody(read(w, sceneId(3))));
  const making = shot(w, '3.2');
  assert.equal(making.narration.state, 'making');
  assert.ok(making?.narration.attemptId, 'making carries an attempt id');
  w.advance(FIXTURE_TIMING.voiceStepMs * 3 * 4 + FIXTURE_TIMING.keyframeMs);
  const settled = w.overview.shots[making.shotId].narration;
  assert.notEqual(settled.state, 'making');
  assert.equal(settled.attemptId, undefined);
  assert.equal(settled.failure, undefined);
});

test('giving up marks the slot released; giving up a new take keeps the current output', () => {
  const w = world();
  setShot(w, '2.2', (s) => ({ ...s, keyframe: { state: 'no_answer', attemptId: 'attempt-7', takeCount: 1, opened: false } }));
  release(w, 'attempt-7');
  assert.deepEqual([shot(w, '2.2').keyframe.state, shot(w, '2.2').keyframe.takenOff], ['none', 'released']);
  // The Director's progress says it was given up, not stopped.
  const progress = generationProgress({ kind: 'keyframes', sceneIds: [sceneId(2)], shotIds: [shotId('2.2')], keyframes: 1, voiceLines: 0, quote: { micros: '40000', units: 1, unitMicros: '40000', priceUnknown: false }, at: 'now' }, w.overview, 'en');
  assert.equal(progress.shots[0].state, 'given_up');
  const artifact = shot(w, '1.1').keyframe.artifact;
  setShot(w, '1.1', (s) => ({ ...s, keyframe: { ...s.keyframe, replacement: { state: 'no_answer', attemptId: 'take-9' } } }));
  release(w, 'take-9');
  assert.deepEqual([shot(w, '1.1').keyframe.state, shot(w, '1.1').keyframe.artifact, shot(w, '1.1').keyframe.replacement, shot(w, '1.1').keyframe.releasedAttemptIds], ['ready', artifact, undefined, ['take-9']]);
  setShot(w, '1.2', (s) => ({ ...s, video: { ...s.video, replacement: { state: 'no_answer', attemptId: 'clip-9' } } }));
  release(w, 'clip-9');
  assert.equal(shot(w, '1.2').video.replacement, undefined);
});

test('the scripted Director declines a proposal on the person\'s typed word, as the studio does', () => {
  const w = world();
  const note = w.snapshot.notes.find((n) => n.choices.some((c) => c.kind === 'proposal' && c.proposalId === 'p1'));
  const before = shot(w, '2.3').durationFrames;
  fixtureMessage(w, { text: `decline proposal ${note.letter}` });
  w.advance(FIXTURE_REPLY_MS);
  const proposal = w.proposals.find((p) => p.proposalId === 'p1');
  assert.deepEqual([proposal.state, proposal.decision.action, proposal.decision.actor], ['rejected', 'reject', 'director_on_user_request']);
  assert.equal(proposal.decision.requestId, w.snapshot.conversation.at(-2).requestId);
  assert.equal(shot(w, '2.3').durationFrames, before, 'declining changes nothing in the film');
  assert.match(w.snapshot.conversation.at(-1).text, /^Declined proposal b as you asked/);
  const zh = world();
  fixtureMessage(zh, { text: `拒绝提案 ${note.letter}` });
  zh.advance(FIXTURE_REPLY_MS);
  assert.equal(zh.proposals.find((p) => p.proposalId === 'p1').state, 'rejected');
});

test('a transcription moves from running to ready on the sample clock', () => {
  const w = world();
  applyDirectorPresets(w, ['transcribing']);
  const line = () => generationLines(w.snapshot.turns.at(-1).effects.generation, w.overview, 'en')[0];
  assert.deepEqual([line().running, line().outcome, line().release], [true, null, null]);
  w.advance(FIXTURE_TIMING.keyframeMs);
  assert.deepEqual([line().running, line().outcome], [false, 'ready']);
  assert.match(translateMsg('en', line().text), /^Transcribed the recording you sent/);
});

test('an unanswered transcription offers Give up for its attempt; once given up it is not offered again', () => {
  const w = world();
  applyDirectorPresets(w, ['unanswered']);
  const line = () => generationLines(w.snapshot.turns.at(-1).effects.generation, w.overview, 'en')[0];
  assert.deepEqual([line().outcome, line().release, line().running], ['no_answer', 'fixture-attempt-transcription', false]);
  // Without an attempt there is nothing to give up on; a running or failed one offers no Give up either.
  const bare = { kind: 'transcription', sceneIds: [], shotIds: [], keyframes: 0, voiceLines: 0, quote: { micros: '6000', units: 1, unitMicros: '6000', priceUnknown: false }, at: 'now' };
  assert.equal(generationLines([{ ...bare, transcription: { state: 'no_answer' } }], w.overview, 'en')[0].release, null);
  assert.equal(generationLines([{ ...bare, transcription: { state: 'running', attemptId: 'x' } }], w.overview, 'en')[0].release, null);
  release(w, 'fixture-attempt-transcription');
  assert.deepEqual([line().outcome, line().release], ['no_answer', null]);
  assert.throws(() => release(w, 'fixture-attempt-transcription'), (error) => error.code === 'ATTEMPT_NOT_RELEASABLE');
});

test('the voices preset: asking for keyframes makes only 3.2\'s voice line; it is counted in voice lines and its refusal is the next step', () => {
  const w = world();
  applyDirectorPresets(w, ['voices']);
  fixtureMessage(w, { text: 'Please make the keyframes.' });
  w.advance(FIXTURE_REPLY_MS);
  const [effect] = w.snapshot.turns.at(-1).effects.generation;
  assert.deepEqual([effect.sceneIds, effect.keyframes, effect.voiceLines], [[sceneId(3)], 0, 1]);
  let progress = generationProgress(effect, w.overview, 'en');
  assert.deepEqual([progress.media, progress.done, progress.total, progress.running], ['voices', 0, 1, true]);
  w.advance(FIXTURE_TIMING.voiceStepMs);
  progress = generationProgress(effect, w.overview, 'en');
  assert.deepEqual([shot(w, '3.2').narration.state, shot(w, '3.2').narration.failure.charged, progress.running], ['failed', false, false]);
  assert.equal(translateMsg('en', progress.next.text), "3.2's voice line failed. Open the shot to see why.");
});

test('the queue preset: an unexplained queue is waiting and a given-up keyframe says so, with no Stop', () => {
  const w = world();
  applyDirectorPresets(w, ['queue']);
  const [effect] = w.snapshot.turns.at(-1).effects.generation;
  const progress = generationProgress(effect, w.overview, 'en');
  assert.deepEqual(progress.shots.map((s) => [s.label, s.state]), [['3.1', 'waiting'], ['3.2', 'given_up']]);
  assert.deepEqual([progress.done, progress.total, progress.running, progress.next], [0, 2, false, null]);
});

test('a regenerate keeps the keyframe in use and runs a replacement; a refused one leaves keyframe and clip as they were', async () => {
  const { fixtureFailNextKeyframe } = await import('../../src/next/fixtures/fixture-commands.ts');
  const w = world();
  const before = shot(w, '1.1');
  fixtureFailNextKeyframe(w, shotId('1.1'));
  post(w, `/scenes/${sceneId(1)}/generate`, keyframesBody(read(w, sceneId(1)), [shotId('1.1')], true));
  assert.deepEqual([shot(w, '1.1').keyframe.state, shot(w, '1.1').keyframe.replacement.state, shot(w, '1.1').video.state], ['ready', 'running', 'ready']);
  w.advance(FIXTURE_TIMING.keyframeMs);
  const after = shot(w, '1.1');
  assert.deepEqual([after.keyframe.state, after.keyframe.artifact, after.keyframe.replacement.state, after.keyframe.replacement.failure.charged, after.video.state],
    ['ready', before.keyframe.artifact, 'failed', false, 'ready']);
});
