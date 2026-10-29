import test from 'node:test';
import assert from 'node:assert/strict';
import { songSegmentForShot, isSingingShot, lipSyncTransition, advanceLipSync, lipSyncDisplay, FakeLipSyncAdapter } from '../dist/execution/lip-sync.js';

const project = (soundtrack) => ({
  scenes: [{ id: 's1' }, { id: 's2' }],
  // Storyboard order follows scenes: a (0–150), b (150–300), c (300–390).
  shots: [{ id: 'c', sceneId: 's2', desiredFrames: 90 }, { id: 'a', sceneId: 's1', desiredFrames: 150 }, { id: 'b', sceneId: 's1', desiredFrames: 150 }],
  soundtrack,
});
const song = { audioId: 'song', sha256: 'f'.repeat(64), samples: 10 * 48000 };

test('each shot gets the exact song samples heard under it on the film clock', () => {
  const p = project({ audioId: 'song', gainMilliDb: 0 });
  assert.deepEqual(songSegmentForShot(p, 'a', song), { audioId: 'song', sha256: song.sha256, startSample: 0, durationSamples: 240000, shotOffsetSamples: 0 });
  assert.deepEqual(songSegmentForShot(p, 'b', song), { audioId: 'song', sha256: song.sha256, startSample: 240000, durationSamples: 240000, shotOffsetSamples: 0 });
  // The 10 s song ends inside shot c (10–13 s): nothing is heard there.
  assert.equal(songSegmentForShot(p, 'c', song), null);
  // Music starting 2 s in: shot a hears the first 3 s of the song from 2 s into the shot.
  const late = project({ audioId: 'song', gainMilliDb: 0, startFrame: 60 });
  assert.deepEqual(songSegmentForShot(late, 'a', song), { audioId: 'song', sha256: song.sha256, startSample: 0, durationSamples: 144000, shotOffsetSamples: 96000 });
  assert.deepEqual(songSegmentForShot(late, 'c', song), { audioId: 'song', sha256: song.sha256, startSample: 384000, durationSamples: 96000, shotOffsetSamples: 0 });
  assert.equal(songSegmentForShot(project({ audioId: 'song', gainMilliDb: 0, muted: true }), 'a', song), null);
  assert.equal(songSegmentForShot(project(null), 'a', song), null);
  assert.equal(songSegmentForShot(project({ audioId: 'other', gainMilliDb: 0 }), 'a', song), null);
  assert.throws(() => songSegmentForShot(p, 'missing', song), e => e.code === 'NOT_FOUND');
});

test('singing shots are recognised from their direction or an explicit performance', () => {
  assert.equal(isSingingShot({ purpose: 'Mara sings the chorus to camera', action: '' }), true);
  assert.equal(isSingingShot({ purpose: '她对着镜头演唱副歌', action: '' }), true);
  assert.equal(isSingingShot({ purpose: 'The ferry leaves', action: 'Wide harbour' }), false);
  assert.equal(isSingingShot({ purpose: 'Mara sings', action: '', performance: 'none' }), false);
});

const job = (attemptId = 'lip-1') => ({ attemptId, shotId: 'a', picture: { artifactId: 'clip', sha256: 'a'.repeat(64), kind: 'video', frames: 150 },
  segment: { audioId: 'song', sha256: song.sha256, startSample: 0, durationSamples: 240000, shotOffsetSamples: 0 }, audio: 'vocals' });
const output = { kind: 'video', mimeType: 'video/mp4', bytes: new Uint8Array([1]) };

test('a lip-sync pass submits once, then only polls, and completes with the synced clip', async () => {
  const adapter = new FakeLipSyncAdapter({ submit: { type: 'accepted', taskId: 't1' }, polls: [{ type: 'unknown', diagnostic: 'still running', taskId: 't1' }, { type: 'completed', taskId: 't1', outputs: [output] }] });
  let state = { phase: 'not_started' };
  state = await advanceLipSync(adapter, job(), state); assert.deepEqual(state, { phase: 'running', taskId: 't1' });
  state = await advanceLipSync(adapter, job(), state); assert.equal(state.phase, 'unknown'); assert.equal(state.taskId, 't1');
  state = await advanceLipSync(adapter, job(), state); assert.equal(state.phase, 'completed');
  assert.deepEqual(adapter.calls.map(c => c.kind), ['submit', 'poll', 'poll']);
  assert.deepEqual(lipSyncDisplay(state), { state: 'synced', charged: 'yes', retry: 'none', keepsOriginalClip: false });
  // Terminal states never move.
  assert.equal(await advanceLipSync(adapter, job(), state), state); assert.equal(adapter.calls.length, 3);
});

test('a lost submission is never resubmitted: it waits for a human press and the clip stays as it was', async () => {
  const adapter = new FakeLipSyncAdapter({ submit: new Error('socket hang up') });
  const state = await advanceLipSync(adapter, job(), { phase: 'not_started' });
  assert.deepEqual(state, { phase: 'unknown', taskId: null, diagnostic: 'socket hang up' });
  assert.equal(await advanceLipSync(adapter, job(), state), state);
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(lipSyncDisplay(state), { state: 'no_answer', charged: 'unknown', retry: 'human_press', keepsOriginalClip: true });
});

test('refused jobs are not charged; accepted jobs that fail are charged unless the provider refunds them', () => {
  const start = { phase: 'not_started' }, running = { phase: 'running', taskId: 't9' };
  const refused = lipSyncTransition(start, { type: 'rejected', certainty: 'not_accepted', failureId: 'AUDIO_TOO_LONG', technical: false }, { refundsFailedJobs: false });
  assert.deepEqual(lipSyncDisplay(refused), { state: 'failed', charged: 'no', retry: 'human_press', keepsOriginalClip: true });
  const busy = lipSyncTransition(start, { type: 'rejected', certainty: 'not_accepted', failureId: 'RATE_LIMITED', technical: true }, { refundsFailedJobs: false });
  assert.equal(lipSyncDisplay(busy).retry, 'offered');
  const failed = lipSyncTransition(running, { type: 'failed', taskId: 't9', failureId: 'NO_FACE', technical: false }, { refundsFailedJobs: false });
  assert.deepEqual([failed.charged, failed.taskId], ['unknown', 't9']);
  const refunded = lipSyncTransition(running, { type: 'failed', taskId: null, failureId: 'NO_FACE', technical: false, retryAllowed: true }, { refundsFailedJobs: true });
  assert.deepEqual([refunded.charged, refunded.taskId, lipSyncDisplay(refunded).retry], ['no', 't9', 'offered']);
  // A spooled completion is not trusted by this seam.
  const spooled = lipSyncTransition(running, { type: 'completed', version: 2, receiptId: 'r', vendorTaskId: 't9', outputs: [{}] }, { refundsFailedJobs: false });
  assert.equal(spooled.phase, 'unknown');
});

test('segments longer than the service accepts are refused before any call', async () => {
  const adapter = new FakeLipSyncAdapter({ submit: { type: 'accepted', taskId: 't' } }, false, 48000);
  await assert.rejects(advanceLipSync(adapter, job(), { phase: 'not_started' }), e => e.code === 'VALIDATION_ERROR');
  assert.equal(adapter.calls.length, 0);
});
