// The sample film simulates what the Keyframes parity work shows: a scene confirm's voice steps and its stops, and
// a shot's keyframe takes with "Use this take" and its Undo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCommand, FIXTURE_TIMING } from '../../src/next/fixtures/fixture-commands.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, lastFerryProposals, pictureKey, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { confirmBody, keyframesBody } from '../../src/next/model/commands.ts';
import { confirmationStop, videoPanel } from '../../src/next/model/keyframes.ts';
import { confirmPress, keyframesPress, lostReplyHolds } from '../../src/next/model/keyframes-press.ts';
import { recompute } from '../../src/next/fixtures/fixture-commands.ts';
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
  const before = store.getState().overview;
  const press = keyframesPress(before, before.scenes[1], [shotId('2.2')], true);
  await store.regenerateKeyframe(shotId('2.2'));
  assert.equal(store.getState().toast.message.id, 'error.PAID_UNCONFIRMED');
  assert.equal(store.getState().toast.tone, 'error');
  assert.deepEqual(store.savedPressIds(), [`regenerate:${shotId('2.2')}`]);
  // The request landed: the studio is making the take, once.
  assert.equal(port.world.overview.shots[shotId('2.2')].keyframe.state, 'running');
  // Pressing again (before the film shows the job) resends the same request with the same key: the studio replays it.
  losing = false;
  assert.equal(press.pressId, `regenerate:${shotId('2.2')}`);
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

/** A sample-film studio on a fake clock: simulated provider time runs on `tick`, and the store reads the film after. */
async function clockedStudio(t, lose) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const studio = await lossyStudio(t, lose);
  const tick = async (ms) => { t.mock.timers.tick(ms); await studio.store.refresh(); };
  return { ...studio, tick };
}

const holds = (store) => lostReplyHolds(store.getState().overview, store.savedPressIds(), (press) => store.wouldResend(press.pressId, press.logical));
const LONG_LINE = 'I stood at the rail until the town was only a line of lights, and then not even that.';

test('a Confirm whose reply was lost: the notice holds until its confirmation shows; once it stops, confirm again starts a new one', async (t) => {
  let losing = false;
  const { store, port, sent, tick } = await clockedStudio(t, (path, options) => (losing && options?.method === 'POST' && path.endsWith('/confirm') ? 'reply' : null));
  // Scene 3 with a line that will come back too long, its keyframes made and opened.
  await store.edit({ kind: 'narration', id: shotId('3.2'), field: 'text', value: LONG_LINE });
  await store.makeKeyframes(sceneId(3));
  await tick(FIXTURE_TIMING.keyframeMs);
  await store.openFrame(shotId('3.1'));
  await store.openFrame(shotId('3.2'));
  await store.refresh();
  // Confirm: the request lands, the reply is lost.
  losing = true;
  await store.confirmVideo(sceneId(3));
  losing = false;
  assert.equal(store.getState().toast.message.id, 'error.PAID_UNCONFIRMED');
  const first = port.world.overview.scenes[2].confirmation;
  assert.equal(first.state, 'running', 'the studio started it');
  // Until the film is read again, pressing again would resend it: the notice holds.
  assert.equal(holds(store), true);
  await store.refresh();
  assert.equal(holds(store), false, 'the film shows the confirmation: the notice goes');
  assert.equal(videoPanel(store.getState().overview, store.getState().overview.scenes[2], 'en-US').action, null, 'nothing to press while it runs');
  // The line comes back too long: the confirm stops at 3.2. The stop says it; the button adds nothing.
  for (let step = 0; step < 3; step++) await tick(FIXTURE_TIMING.voiceStepMs);
  let scene3 = store.getState().overview.scenes[2];
  assert.deepEqual([scene3.confirmation.confirmationId, scene3.confirmation.state, scene3.confirmation.blocker.code], [first.confirmationId, 'blocked', 'NARRATION_CUE_OUT_OF_RANGE']);
  assert.equal(holds(store), false);
  assert.equal(videoPanel(store.getState().overview, scene3, 'en-US').reason, null);
  // Lengthen the shot, then confirm again: a new key, and a new confirm starts (the old receipt is not replayed).
  await store.narrationFit(shotId('3.2'), 'extend_shot');
  scene3 = store.getState().overview.scenes[2];
  assert.equal(videoPanel(store.getState().overview, scene3, 'en-US').enabled, true);
  assert.equal(store.wouldResend(...Object.values(confirmPress(store.getState().overview, scene3))), false);
  await store.confirmVideo(sceneId(3));
  const confirms = sent.filter((request) => request.path.endsWith('/confirm'));
  assert.equal(confirms.length, 2);
  assert.notEqual(confirms[1].key, confirms[0].key);
  const second = port.world.overview.scenes[2].confirmation;
  assert.notEqual(second.confirmationId, first.confirmationId);
  assert.deepEqual([second.state, second.currentStep], ['running', 'video']);
  assert.deepEqual(store.savedPressIds(), []);
});

test('a Make keyframes whose reply was lost: the notice goes once the keyframes are being made; after they fail, a press is a new request', async (t) => {
  let losing = true;
  const { store, port, sent } = await clockedStudio(t, (path, options) => (losing && options?.method === 'POST' && path.endsWith('/generate') ? 'reply' : null));
  await store.makeKeyframes(sceneId(3));
  losing = false;
  assert.equal(store.getState().toast.message.id, 'error.PAID_UNCONFIRMED');
  assert.deepEqual(['3.1', '3.2'].map((label) => port.world.overview.shots[shotId(label)].keyframe.state), ['running', 'running']);
  assert.equal(holds(store), true);
  await store.refresh();
  assert.equal(holds(store), false, 'the keyframes are being made: the notice goes');
  // Both fail before they are made: Make keyframes is offered again, and it is a new request.
  port.world.update((w) => {
    const shots = { ...w.overview.shots };
    for (const label of ['3.1', '3.2']) shots[shotId(label)] = { ...shots[shotId(label)], keyframe: { state: 'failed', takeCount: 0, opened: false, failure: { code: 'EXECUTION_FAILED', technical: true, retryAllowed: true, autoRetriesLeft: 0, charged: false, at: '2026-10-15T10:01:00Z' } } };
    w.overview = recompute({ ...w.overview, shots });
  });
  await store.refresh();
  const overview = store.getState().overview;
  assert.equal(holds(store), false);
  assert.deepEqual([videoPanel(overview, overview.scenes[2], 'en-US').action, videoPanel(overview, overview.scenes[2], 'en-US').enabled], ['make_keyframes', true]);
  await store.makeKeyframes(sceneId(3));
  const generates = sent.filter((request) => request.path.endsWith('/generate'));
  assert.equal(generates.length, 2);
  assert.notEqual(generates[1].key, generates[0].key);
});

test('a motion edit rewrites the video prompt as the studio does; a picture prompt edit leaves it, and Undo restores it', () => {
  const w = world();
  const videoPrompt = () => w.snapshot.project.shots.find((row) => row.id === shotId('2.3')).videoPrompt;
  const before = videoPrompt();
  edit(w, { kind: 'shot', id: shotId('2.3'), field: 'imagePrompt', value: 'The ticket, close.' });
  assert.equal(videoPrompt(), before, 'the picture prompt has its own words');
  const { commandId } = edit(w, { kind: 'shot', id: shotId('2.3'), field: 'motion', value: 'Slow push in' });
  assert.match(videoPrompt(), /^OpenSlate current direction:\n.*Camera movement: Slow push in\nReference details \(retain only where consistent\):\n/s);
  assert.ok(videoPrompt().endsWith(before), 'the earlier words are kept');
  edit(w, { kind: 'undo', commandId });
  assert.equal(videoPrompt(), before);
});
