import test from 'node:test';
import assert from 'node:assert/strict';
import { shotAudioReview } from '../src/shot-audio-model.ts';
const recording = { id: 'upload', media: { sha256: 'a'.repeat(64), probe: { audio: { samples: 288000 } } } };
const inputs = { active: true, locked: false, dirty: false, row: null, recording, heardIdentity: 'upload:sha:0:6', displayedIdentity: 'upload:sha:0:6', startSample: 0, endSample: 288000 };
test('a human may upload and hear a recording before words exist, but it cannot become accepted narration', () => {
  const state = shotAudioReview(inputs); assert.equal(state.canUpload, true); assert.equal(state.canListen, true); assert.equal(state.canAccept, false);
  assert.equal(shotAudioReview({ ...inputs, active: false }).canUpload, false);
  assert.equal(shotAudioReview({ ...inputs, locked: true }).canUpload, false);
});
test('acceptance requires saved words, exact selected binding, reviewed range and unchanged bytes', () => {
  const row = { script: { text: 'A truthful description' }, audio: recording };
  assert.equal(shotAudioReview({ ...inputs, row }).canAccept, true);
  for (const extra of [{ dirty: true }, { row: { ...row, script: { text: '' } } }, { row: { ...row, audio: { ...recording, id: 'other' } } }, { recording: { ...recording, media: { ...recording.media, sha256: 'b'.repeat(64) } } }, { displayedIdentity: 'upload:sha:1:6' }, { endSample: 288001 }, { startSample: 288000 }]) assert.equal(shotAudioReview({ ...inputs, row, ...extra }).canAccept, false);
});


test('short voiceover fits a longer planned shot while length matching is an explicit 3–15 second video choice', () => {
  const row = { script: { text: 'Short words' }, audio: recording };
  assert.equal(shotAudioReview({ ...inputs, row, plannedFrames: 180, endSample: 48000 }).canAccept, true);
  assert.equal(shotAudioReview({ ...inputs, row, plannedFrames: 90, endSample: 288000 }).rangeValid, false);
  assert.equal(shotAudioReview({ ...inputs, row, plannedFrames: 90, endSample: 288000, durationMode: 'match_audio' }).rangeValid, true);
  assert.equal(shotAudioReview({ ...inputs, row, endSample: 48000, durationMode: 'match_audio' }).rangeValid, false);
});
