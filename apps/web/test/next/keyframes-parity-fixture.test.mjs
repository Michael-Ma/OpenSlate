// The sample film simulates what the Keyframes parity work shows: a scene confirm's voice steps and its stops, and
// a shot's keyframe takes with "Use this take" and its Undo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCommand, FIXTURE_TIMING } from '../../src/next/fixtures/fixture-commands.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, lastFerryProposals, pictureKey, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { confirmBody, keyframesBody } from '../../src/next/model/commands.ts';
import { confirmationStop } from '../../src/next/model/keyframes.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m);

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
const get = (w, path) => fixtureCommand(w, 'GET', path);
const read = (w, scene) => get(w, `/scenes/${scene}/generation`);
const shot = (w, label) => w.overview.shots[shotId(label)];
const scene = (w, ordinal) => w.overview.scenes[ordinal - 1];
const open = (w, label) => { const { artifactId, sha256 } = shot(w, label).keyframe.artifact; return post(w, `/shots/${shotId(label)}/frame-views`, { artifactId, sha256 }); };
const edit = (w, body) => post(w, '/storyboard', { ...body, expectedHeadVersion: w.snapshot.project.headVersion });
const refused = code => error => error.code === code;
const confirmation = (w, ordinal) => scene(w, ordinal).confirmation;
const step = (w, ordinal) => { const c = confirmation(w, ordinal); return [c.state, c.currentShotId, c.currentStep]; };
const regenerate = (w, label) => post(w, `/scenes/${shot(w, label).sceneId}/generate`, keyframesBody(read(w, shot(w, label).sceneId), [shotId(label)], true));

/** Scene 3 with both keyframes made and opened, ready to confirm. */
function scene3Ready(w) {
  post(w, `/scenes/${sceneId(3)}/generate`, keyframesBody(read(w, sceneId(3))));
  w.advance(FIXTURE_TIMING.keyframeMs);
  open(w, '3.1'); open(w, '3.2');
}

test('a confirm voices a line with no voice yet step by step (make, save, fit) before its clips', () => {
  const w = world();
  scene3Ready(w);
  assert.equal(shot(w, '3.2').narration.state, 'text_only');
  const view = post(w, `/scenes/${sceneId(3)}/confirm`, confirmBody(w.overview, scene(w, 3)));
  assert.deepEqual([view.state, view.currentShotId, view.currentStep], ['running', shotId('3.2'), 'speech']);
  assert.deepEqual(step(w, 3), ['running', shotId('3.2'), 'speech']);
  assert.equal(shot(w, '3.2').narration.state, 'making');
  assert.deepEqual(['3.1', '3.2'].map(l => [shot(w, l).video.state, shot(w, l).video.waiting.code]), [['queued', 'voice'], ['queued', 'voice']]);
  assert.equal(scene(w, 3).state, 'making_video');
  w.advance(FIXTURE_TIMING.voiceStepMs);
  assert.deepEqual(step(w, 3), ['running', shotId('3.2'), 'attach']);
  w.advance(FIXTURE_TIMING.voiceStepMs);
  assert.deepEqual(step(w, 3), ['running', shotId('3.2'), 'accept']);
  w.advance(FIXTURE_TIMING.voiceStepMs);
  // "I didn't look back." measures 1.8 s, well inside 8 s: the clips follow.
  assert.deepEqual([shot(w, '3.2').narration.state, shot(w, '3.2').narration.measuredSeconds, shot(w, '3.2').narration.fits], ['ready', 1.8, true]);
  assert.deepEqual(step(w, 3), ['running', shotId('3.1'), 'video']);
  assert.deepEqual(['3.1', '3.2'].map(l => shot(w, l).video.state), ['running', 'queued']);
  w.advance(FIXTURE_TIMING.clipMs * 2);
  assert.equal(confirmation(w, 3).state, 'done');
  assert.equal(scene(w, 3).state, 'video_saved');
});

test('a line that comes back longer than its shot stops the confirm at the fit step; fitted, the scene confirms', () => {
  const w = world();
  edit(w, { kind: 'narration', id: shotId('3.2'), field: 'text', value: 'I stood at the rail until the town was only a line of lights, and then not even that.' });
  assert.equal(shot(w, '3.2').narration.fits, true, 'its estimate fits the 8 s shot');
  scene3Ready(w);
  post(w, `/scenes/${sceneId(3)}/confirm`, confirmBody(w.overview, scene(w, 3)));
  w.advance(FIXTURE_TIMING.voiceStepMs * 3);
  assert.deepEqual([confirmation(w, 3).state, confirmation(w, 3).blocker], ['blocked', { code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: shotId('3.2') }]);
  assert.deepEqual([shot(w, '3.2').narration.measuredSeconds, shot(w, '3.2').narration.fits], [8.4, false]);
  assert.deepEqual(['3.1', '3.2'].map(l => shot(w, l).video.state), ['none', 'none'], 'the clips are taken off; nothing was sent');
  assert.ok(scene(w, 3).blockers.some(b => b.code === 'narration_too_long' && b.shotId === shotId('3.2')));
  const stop = confirmationStop(w.overview, scene(w, 3));
  assert.equal(en(stop.reason), 'The 3.2 voice line came out at 8.4 s, longer than its shot.');
  w.advance(FIXTURE_TIMING.clipMs * 4);
  assert.equal(confirmation(w, 3).state, 'blocked', 'nothing runs on');
  // Make 3.2 9 s (free), then confirm again: the line is voiced already, so the clips go straight out.
  post(w, `/shots/${shotId('3.2')}/narration-fit`, { fit: 'extend_shot', expectedHeadVersion: w.snapshot.project.headVersion });
  assert.equal(en(confirmationStop(w.overview, scene(w, 3)).next), 'It fits now: confirm again.');
  const view = post(w, `/scenes/${sceneId(3)}/confirm`, confirmBody(w.overview, scene(w, 3)));
  assert.deepEqual([view.state, view.currentStep], ['running', 'video']);
  assert.equal(confirmationStop(w.overview, scene(w, 3)), null);
  w.advance(FIXTURE_TIMING.clipMs * 2);
  assert.equal(scene(w, 3).state, 'video_saved');
});

test('a confirmed frame that changes during the voice steps stops the confirm at that shot (frames changed)', () => {
  const w = world();
  scene3Ready(w);
  post(w, `/scenes/${sceneId(3)}/confirm`, confirmBody(w.overview, scene(w, 3)));
  w.advance(FIXTURE_TIMING.voiceStepMs);
  // Another take of 3.1 lands meanwhile (as a Director change could do).
  w.update(x => { x.overview = { ...x.overview, shots: { ...x.overview.shots, [shotId('3.1')]: { ...shot(x, '3.1'), keyframe: { ...shot(x, '3.1').keyframe, artifact: { artifactId: 'art-3.1~2', sha256: 'b'.repeat(64), kind: 'image' }, opened: false } } } }; });
  w.advance(FIXTURE_TIMING.voiceStepMs);
  assert.deepEqual([confirmation(w, 3).state, confirmation(w, 3).blocker], ['blocked', { code: 'SCENE_REVIEW_STALE', shotId: shotId('3.1') }]);
  assert.deepEqual(['3.1', '3.2'].map(l => shot(w, l).video.state), ['none', 'none']);
  assert.equal(en(confirmationStop(w.overview, scene(w, 3)).reason), '3.1 changed after you confirmed: its frame or plan is not the one you opened.');
});

test('Stop cancels a confirm during its voice steps; the voice job already sent still finishes', () => {
  const w = world();
  scene3Ready(w);
  post(w, `/scenes/${sceneId(3)}/confirm`, confirmBody(w.overview, scene(w, 3)));
  post(w, '/controls', { action: 'stop' });
  assert.equal(confirmation(w, 3).state, 'cancelled');
  w.advance(FIXTURE_TIMING.voiceStepMs * 4);
  assert.equal(confirmation(w, 3).state, 'cancelled');
  assert.equal(shot(w, '3.2').narration.state, 'text_only');
  assert.equal(confirmationStop(w.overview, scene(w, 3)), null, 'a cancelled confirm is not a stop');
});

test('the takes list every keyframe of a shot, newest first, each its own artifact showing the shot\'s picture', () => {
  const w = world();
  assert.deepEqual(get(w, `/shots/${shotId('2.1')}/takes`).keyframes.map(k => [k.artifact.artifactId, k.current]), [['art-2.1', true]]);
  regenerate(w, '2.2');
  w.advance(FIXTURE_TIMING.keyframeMs);
  regenerate(w, '2.2');
  w.advance(FIXTURE_TIMING.keyframeMs);
  const list = get(w, `/shots/${shotId('2.2')}/takes`);
  assert.equal(list.shotId, shotId('2.2'));
  assert.deepEqual(list.keyframes.map(k => [k.artifact.artifactId, k.current]), [['art-2.2-red~3', true], ['art-2.2-red', false], ['art-2.2', false]]);
  assert.equal(new Set(list.keyframes.map(k => k.artifact.sha256)).size, 3);
  assert.ok(list.keyframes.every(k => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(k.createdAt)));
  assert.deepEqual(list.keyframes.map(k => pictureKey(k.artifact.artifactId)), ['2.2-red', '2.2-red', '2.2']);
  assert.throws(() => get(w, '/shots/shot-9-9/takes'), refused('NOT_FOUND'));
});

test('using an earlier take is free, keeps whether it was opened, outdates the clip, and Undo brings the take back', () => {
  const w = world();
  // 1.1 was opened and has a clip; a new take replaces both.
  regenerate(w, '1.1');
  w.advance(FIXTURE_TIMING.keyframeMs);
  const latest = shot(w, '1.1').keyframe.artifact;
  assert.deepEqual([latest.artifactId, shot(w, '1.1').keyframe.opened], ['art-1.1~2', false]);
  const head = w.snapshot.project.headVersion;
  const receipt = post(w, `/shots/${shotId('1.1')}/takes/art-1.1/use`, {});
  assert.deepEqual([receipt.shotId, receipt.artifactId, typeof receipt.commandId], [shotId('1.1'), 'art-1.1', 'string']);
  const used = shot(w, '1.1');
  assert.deepEqual([used.keyframe.state, used.keyframe.artifact.artifactId, used.keyframe.opened, used.keyframe.takeCount], ['ready', 'art-1.1', true, 2], 'take 1 was opened before');
  assert.notEqual(used.video.state, 'ready', 'its clip went out of date');
  assert.equal(w.snapshot.project.headVersion, head + 1);
  assert.deepEqual(get(w, `/shots/${shotId('1.1')}/takes`).keyframes.map(k => k.current), [false, true]);
  assert.throws(() => post(w, `/shots/${shotId('1.1')}/takes/art-1.1/use`, {}), refused('ALREADY_COMPLETE'));
  assert.throws(() => post(w, `/shots/${shotId('1.1')}/takes/art-nope/use`, {}), refused('NOT_FOUND'));
  edit(w, { kind: 'undo', commandId: receipt.commandId });
  assert.deepEqual([shot(w, '1.1').keyframe.artifact.artifactId, shot(w, '1.1').keyframe.opened], ['art-1.1~2', false]);
  // No switch while the shot's keyframe is being made.
  regenerate(w, '1.1');
  assert.throws(() => post(w, `/shots/${shotId('1.1')}/takes/art-1.1/use`, {}), refused('ATTEMPT_EXISTS'));
});

// ---- a paid press whose reply was lost, through the store ------------------------------------------------

import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { StudioStore } from '../../src/next/store/store.ts';

/**
 * A store on the sample film whose client loses the replies the test chooses (the request still lands). Like the
 * studio, it answers a POST whose Idempotency-Key it has seen with the saved receipt instead of acting again.
 */
async function lossyStudio(t, lose) {
  const port = new FixturePort();
  const sent = [];
  const receipts = new Map();
  let n = 0;
  const client = {
    get closed() { return port.closed; },
    events: port.events.bind(port),
    async request(path, options) {
      const fate = lose(path, options);
      if (fate === 'before') throw new TypeError('offline');
      if (options?.method === 'POST') sent.push({ path, key: options.key, body: JSON.stringify(options.body) });
      const replay = options?.key && receipts.get(options.key);
      const result = replay ?? await port.request(path, options);
      if (options?.key) receipts.set(options.key, result);
      if (fate === 'reply') throw new TypeError('reply lost');
      return result;
    },
  };
  const store = new StudioStore({ client, storage: null, newKey: () => `key-${++n}` });
  await store.start();
  t.after(() => { store.stop(); port.close(); });
  return { store, port, sent };
}

test('a paid press whose reply was lost says pressing again checks without paying twice, and resends the same key', async (t) => {
  let losing = true;
  const { store, port, sent } = await lossyStudio(t, (path, options) => (losing && options?.method === 'POST' && path.endsWith('/generate') ? 'reply' : null));
  await store.regenerateKeyframe(shotId('2.2'));
  assert.equal(store.getState().toast.message.id, 'error.PAID_UNCONFIRMED');
  assert.equal(store.getState().toast.tone, 'error');
  assert.deepEqual(store.savedPressIds(), [`regenerate:${shotId('2.2')}`]);
  // The request landed: the studio is making the take, once.
  assert.equal(port.world.overview.shots[shotId('2.2')].keyframe.state, 'running');
  // Pressing again (before the film shows the job) resends the same request with the same key: the studio replays it.
  losing = false;
  const press = { pressId: `regenerate:${shotId('2.2')}`, logical: JSON.parse(JSON.stringify({ kind: 'image', sceneId: sceneId(2), targets: [shotId('2.2')], regenerate: true, previous: ['art-2.2'] })) };
  assert.equal(store.wouldResend(press.pressId, press.logical), true);
  await store.regenerateKeyframe(shotId('2.2'));
  assert.equal(sent.length, 2);
  assert.deepEqual([sent[1].key, sent[1].body], [sent[0].key, sent[0].body]);
  assert.deepEqual(store.savedPressIds(), [], 'answered: the next press is a new request');
});

test('a paid press that failed before it was sent, or a free press whose reply was lost, says what went wrong', async (t) => {
  const { store } = await lossyStudio(t, (path, options) => (options?.method !== 'POST' && path.endsWith(`/scenes/${sceneId(2)}/generation`) ? 'before' : options?.method === 'POST' && path.includes('/frame-views') ? 'reply' : null));
  await store.regenerateKeyframe(shotId('2.2'));
  assert.equal(store.getState().toast.message.id, 'error.NETWORK_ERROR', 'nothing was sent, so nothing to confirm');
  assert.deepEqual(store.savedPressIds(), []);
  store.dismissToast();
  await store.openFrame(shotId('2.2'));
  assert.equal(store.getState().toast.message.id, 'error.NETWORK_ERROR');
});
