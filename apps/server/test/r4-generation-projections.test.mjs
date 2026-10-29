import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILES } from '@openslate/core';
import { quote, unitQuote } from '../dist/generation-quotes.js';
import { shotNarration } from '../dist/generation-overview.js';
import { narrationFitFrames } from '../dist/narration-fit.js';
import { fixture } from './helpers/generation-fixture.mjs';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';

const profile = (id, kind, unitCostMicros, extra = {}) => ({ id, kind, unitCostMicros, adapter: 'fake', ...extra });
const measured = seconds => ({ mode: 'generated', text: 'A measured voice line', ready: false, recordingCurrent: true, measuredSeconds: seconds, fit: null });

test('R4 remake quotes select one pinned profile independently of pending work and omit absent profiles', () => {
  const profiles = [profile('video-first', 'video', '1'), profile('speech-first', 'speech', '2'), profile('video-selected', 'video', '800000'), profile('speech-selected', 'speech', '30000')];
  const lock = { profiles, preferredProfileIds: { video: 'video-selected', speech: 'speech-selected' } };
  assert.deepEqual(unitQuote(lock, 'video'), { micros: '800000', units: 1, unitMicros: '800000', priceUnknown: false });
  assert.deepEqual(unitQuote(lock, 'speech'), { micros: '30000', units: 1, unitMicros: '30000', priceUnknown: false });
  assert.equal(unitQuote({ profiles: [] }, 'video'), undefined);
  assert.equal(unitQuote({ profiles: [] }, 'speech'), undefined);
  assert.equal(unitQuote({ ...lock, preferredProfileIds: { video: 'missing' } }, 'video'), undefined);
  assert.equal(unitQuote({ profiles }, 'video').unitMicros, '1');
});

test('R4 one-unit quotes preserve unknown-price and Codex subscription rules', () => {
  for (const kind of ['video', 'speech']) {
    assert.deepEqual(unitQuote({ profiles: [profile('unpriced', kind, '0')] }, kind), { micros: '0', units: 1, unitMicros: '0', priceUnknown: true });
    assert.deepEqual(unitQuote({ profiles: [profile('subscription', kind, '0', { adapter: 'codex-image' })] }, kind), { micros: '0', units: 1, unitMicros: '0', priceUnknown: false, subscription: 'codex' });
  }
});

test('R4 every pending-work quote leaves out a succeeded reusable speech take', () => {
  const lock = { profiles: [profile('i', 'image', '40000'), profile('v', 'video', '800000'), profile('s', 'speech', '30000')] };
  const row = { imageComplete: false, videoComplete: false, videoProfileLabel: 'v', narration: { mode: 'generated', ready: false, recordingCurrent: false, reusableSpeechTake: true, profileId: 's' } };
  for (const [kind, micros, units] of [['voice', '0', 0], ['makeKeyframes', '40000', 1], ['regenerateKeyframe', '40000', 1], ['confirmVideo', '800000', 1]]) {
    assert.deepEqual(quote(lock, [row], kind), { micros, units, unitMicros: units ? micros : '0', priceUnknown: false }, kind);
    assert.equal(quote(lock, [{ ...row, narration: { ...row.narration, reusableSpeechTake: false } }], kind).units, units + 1, `${kind} still prices a line that needs speech`);
  }
});

test('R4 fully made scene retains clip and voice remake prices after pending quotes reach zero', async t => {
  const f = await confirmationFixture(t);
  await f.make(); await f.tick(14); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(14);
  const overview = await f.overview(), scene = overview.scenes[0];
  assert.equal(scene.state, 'video_saved');
  assert.equal(scene.quotes.confirmVideo.units, 0);
  assert.equal(scene.quotes.voice.units, 0);
  const video = DEFAULT_PROFILES.find(p => p.kind === 'video');
  assert.deepEqual(scene.quotes.oneClip, { micros: video.unitCostMicros, units: 1, unitMicros: video.unitCostMicros, priceUnknown: video.unitCostMicros === '0' });
  assert.deepEqual(scene.quotes.oneVoice, { micros: '100', units: 1, unitMicros: '100', priceUnknown: false });
  assert.equal(f.calls.speech, 1);
});

test('R4 overview omits a voice remake quote when the lock has no speech profile', async t => {
  const f = fixture(t, { profiles: DEFAULT_PROFILES.filter(p => p.kind !== 'speech') }), overview = await f.overview();
  assert.equal(Object.hasOwn(overview.scenes[0].quotes, 'oneVoice'), false);
  assert.equal(overview.scenes[0].quotes.oneClip.units, 1);
});

test('R4 overview exposes latest keyframe run and a blocker for any running scene run', async t => {
  const f = fixture(t), projectId = f.project.id;
  const write = (id, kind, state, shotId, step, blocker) => f.store.put('scene_confirmation', id, projectId, { id, projectId, sceneId: 'scene-0', kind, state,
    createdAt: new Date().toISOString(), steps: [{ shotId, step }], ...(blocker ? { blocker } : {}) });
  write('keyframes-old', 'keyframes', 'running', 'shot-0', 'speech');
  write('keyframes-latest', 'keyframes', 'blocked', 'shot-0', 'accept', { code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: 'shot-0' });
  write('video-latest', 'video', 'done', 'shot-0', 'done');
  let overview = await f.overview(), scene = overview.scenes[0];
  assert.deepEqual(scene.keyframesRun, { confirmationId: 'keyframes-latest', state: 'blocked', currentShotId: 'shot-0', currentStep: 'accept', blocker: { code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: 'shot-0' } });
  assert.deepEqual(scene.confirmation, { confirmationId: 'video-latest', state: 'done' });
  assert.equal(scene.blockers.filter(b => b.code === 'confirmation_running').length, 1);
  assert.equal(overview.scenes[1].keyframesRun, undefined);
  assert.equal(overview.scenes[1].blockers.some(b => b.code === 'confirmation_running'), false);
  write('keyframes-old', 'keyframes', 'done', 'shot-0', 'done');
  f.store.appendEvent(projectId, 'test.run-finished', {});
  overview = await f.overview();
  assert.equal(overview.scenes[0].blockers.some(b => b.code === 'confirmation_running'), false);
});

test('R4 real keyframes run projects voice progress, blocked overflow and settled blocker', async t => {
  const f = await confirmationFixture(t, { seconds: 7.4 }); await f.make();
  let scene = (await f.overview()).scenes[0];
  assert.equal(scene.keyframesRun.state, 'running');
  assert.equal(scene.keyframesRun.currentStep, 'speech');
  assert.ok(scene.blockers.some(b => b.code === 'confirmation_running'));
  await f.tick(14);
  scene = (await f.overview()).scenes[0];
  assert.equal(scene.keyframesRun.state, 'blocked');
  assert.deepEqual(scene.keyframesRun.blocker, { code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: 'shot-0' });
  assert.equal(scene.blockers.some(b => b.code === 'confirmation_running'), false);
});

test('R4 measured fit length uses exact server rounding and locked model bounds', () => {
  const bounded = { minFrames: 90, maxFrames: 450 };
  for (const [frames, seconds, expected] of [[150, 5.8, 6], [120, 4.8, 5], [180, 6.9, 7], [180, 7.4, 8]]) {
    const audio = shotNarration(measured(seconds), frames, bounded);
    assert.equal(audio.fits, false);
    assert.equal(audio.fitSeconds, expected);
    assert.equal(audio.fitSeconds * 30, narrationFitFrames(frames, Math.round(seconds * 48000), bounded, 'extend_shot'));
  }
  assert.equal(shotNarration(measured(5.8), 150, { minFrames: 240, maxFrames: 450 }).fitSeconds, 8);
  assert.equal(shotNarration(measured(7.4), 180, { minFrames: 90, maxFrames: 210 }).fitSeconds, undefined, 'an impossible extend is not advertised');
  assert.equal(shotNarration(measured(16), 180, bounded).fitSeconds, undefined, 'studio maximum is enforced');
});

test('R4 fit length is absent for estimates, fitting lines, absent profiles and already cut audio', () => {
  const bounded = { minFrames: 90, maxFrames: 450 };
  const estimate = { ...measured(7.4), measuredSeconds: null, recordingCurrent: false, text: Array(40).fill('word').join(' ') };
  assert.equal(shotNarration(estimate, 180, bounded).fits, false);
  assert.equal(shotNarration(estimate, 180, bounded).fitSeconds, undefined);
  assert.equal(shotNarration(measured(6), 180, bounded).fitSeconds, undefined);
  assert.equal(shotNarration(measured(7.4), 180).fitSeconds, undefined);
  assert.equal(shotNarration({ ...measured(7.4), ready: true, fit: 'cut_to_shot', timing: { durationFrames: 180 } }, 180, bounded).fitSeconds, undefined);
});

test('R4 overview fitSeconds matches the actual extend command without another speech call', async t => {
  const f = await confirmationFixture(t, { seconds: 6.9 }); await f.make(); await f.tick(14);
  const overview = await f.overview(), audio = overview.shots['shot-0'].narration;
  assert.equal(audio.measuredSeconds, 6.9);
  assert.equal(audio.fits, false);
  assert.equal(audio.fitSeconds, 7);
  const receipt = await f.call('POST', '/shots/shot-0/narration-fit', { fit: 'extend_shot', expectedHeadVersion: overview.headVersion }).then(f.ok);
  assert.equal(receipt.durationFrames, audio.fitSeconds * 30);
  assert.equal((await f.overview()).shots['shot-0'].narration.fitSeconds, undefined);
  assert.equal(f.calls.speech, 1);
});
