import test from 'node:test';
import assert from 'node:assert/strict';
import { audioAt, currentPlayback, scheduleAudioStart, syncAudio, timelineMediaIndex, upcomingAudioDelay } from '../src/timeline-playback-model.ts';
const voice = { id: 'cue', audioId: 'audio', sha256: 'a'.repeat(64), startSample: 48000, durationSamples: 96000, atSample: 144000, gainMilliDb: 0, shotIds: ['shot'] };
function media() { return { currentTime: 0, volume: 1, paused: true, plays: 0, pauses: 0, pause() { this.paused = true; this.pauses++; }, async play() { this.paused = false; this.plays++; } }; }
test('timeline audio uses absolute placement and source-local trims with strict end boundary', () => {
  assert.deepEqual(audioAt(voice, 2), { active: false, sourceSeconds: 1, volume: 1 });
  assert.deepEqual(audioAt(voice, 3.5), { active: true, sourceSeconds: 1.5, volume: 1 });
  assert.equal(audioAt(voice, 5).active, false);
  assert.ok(Math.abs(audioAt({ ...voice, gainMilliDb: -12000 }, 4).volume - 0.2511886) < .00001);
});
test('seek corrects drift, pauses out-of-range audio and resumes only once per active placement', async () => {
  const el = media(); await syncAudio(el, voice, 3.5, true); assert.equal(el.currentTime, 1.5); assert.equal(el.plays, 1);
  syncAudio(el, voice, 3.55, true); assert.equal(el.plays, 1);
  syncAudio(el, voice, 4.5, false); assert.equal(el.currentTime, 2.5); assert.equal(el.paused, true);
  await syncAudio(el, voice, 4.5, true); assert.equal(el.plays, 2);
  syncAudio(el, voice, 5, true); assert.equal(el.paused, true);
  syncAudio(el, voice, 1, true); assert.equal(el.paused, true);
});
test('playback audio selection is fenced by project, exact revision and head version', () => {
  const project = { id: 'p', revisionId: 'r', headVersion: 4 }, view = { projectId: 'p', revisionId: 'r', headVersion: 4 };
  assert.equal(currentPlayback(view, project), true);
  for (const field of ['id', 'revisionId', 'headVersion']) assert.equal(currentPlayback(view, { ...project, [field]: field === 'headVersion' ? 5 : 'other' }), false);
});
test('indexed timeline media keeps current outputs and ignores unrecognized nodes', () => {
  const image = { nodeId: 'frame', artifact: { kind: 'image' } }, video = { nodeId: 'clip', artifact: { kind: 'video' } };
  const index = timelineMediaIndex({ plan: { nodes: [{ id: 'frame', kind: 'image', shotId: 'shot' }, { id: 'clip', kind: 'video', shotId: 'shot' }] }, outputs: [image, video, { nodeId: 'old' }] });
  assert.deepEqual(index.get('shot'), { image, video }); assert.equal(index.size, 1);
});


test('upcoming voice starts at its selected first sample between UI ticks and cancelled playback cannot start it', async () => {
  const el = media(), callbacks = new Map(); let next = 0;
  const timers = { set(callback, delay) { callbacks.set(++next, { callback, delay }); return next; }, clear(id) { callbacks.delete(id); } };
  assert.ok(Math.abs(upcomingAudioDelay(voice, 2.98) - 20) < 0.000001);
  assert.equal(upcomingAudioDelay(voice, 3), null); assert.equal(upcomingAudioDelay(voice, 0), null);
  const cancel = scheduleAudioStart(el, voice, 2.98, () => true, () => assert.fail('unexpected playback error'), timers);
  callbacks.get(1).callback(); await Promise.resolve(); assert.equal(el.currentTime, 1); assert.equal(el.plays, 1); cancel();
  const stopped = scheduleAudioStart(el, voice, 2.98, () => false, () => {}, timers); callbacks.get(2).callback(); assert.equal(el.plays, 1); stopped();
  const before = callbacks.size, paused = scheduleAudioStart(el, voice, 2, () => true, () => {}, timers); paused(); assert.equal(callbacks.size, before);
});
