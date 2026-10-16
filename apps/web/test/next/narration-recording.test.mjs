import test from 'node:test';
import assert from 'node:assert/strict';
import {
  afterRecordingFailure, checkRecording, checkRecordingLength, isRecordingReceipt, notAddedToast, RECORDING_MAX_BYTES, recordingDone, recordingFileMsg,
  recordingFitNote, recordingIdentity, recordingPath, recordingRefusal, recordingRetryable, sendingMsg, wordsNote,
} from '../../src/next/model/narration-recording.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = (m) => translateMsg('en', m);
const zh = (m) => translateMsg('zh-CN', m);

test('the route and the identity a resend is found by', () => {
  assert.equal(recordingPath('shot 2/3', 12), '/shots/shot%202%2F3/narration/recording?expectedHeadVersion=12');
  assert.equal(recordingIdentity('shot-2-3', { name: 'take.wav', size: 900, lastModified: 5 }), 'narration-recording:shot-2-3:900:5:take.wav');
  assert.notEqual(recordingIdentity('shot-2-2', { name: 'take.wav', size: 900, lastModified: 5 }), recordingIdentity('shot-2-3', { name: 'take.wav', size: 900, lastModified: 5 }));
});

test('refused before sending: not audio, empty, too large, longer than 6 minutes', () => {
  assert.deepEqual(checkRecording({ name: 'take.wav', type: 'audio/wav', size: 1000 }), { ok: true });
  assert.deepEqual(checkRecording({ name: 'take.m4a', type: '', size: 1000 }), { ok: true }, 'a known extension without a type');
  assert.equal(en(checkRecording({ name: 'notes.txt', type: 'text/plain', size: 10 }).refusal), 'Choose an audio file (WAV, MP3, M4A, FLAC…).');
  assert.equal(en(checkRecording({ name: 'clip.mp4', type: 'video/mp4', size: 10 }).refusal), 'Choose an audio file (WAV, MP3, M4A, FLAC…).');
  assert.equal(en(checkRecording({ name: 'take.wav', type: 'audio/wav', size: 0 }).refusal), 'This file is empty.');
  assert.equal(en(checkRecording({ name: 'take.wav', type: 'audio/wav', size: RECORDING_MAX_BYTES + 1 }).refusal), '128 MB is over the 128 MB limit for a recording.');
  assert.deepEqual(checkRecordingLength(null), { ok: true }, 'an unknown length is the studio\'s to judge');
  assert.deepEqual(checkRecordingLength(360), { ok: true });
  assert.equal(en(checkRecordingLength(361).refusal), '6:01 is longer than the 6-minute limit.');
});

test('the chosen file, and a note when it is longer than the shot', () => {
  assert.equal(en(recordingFileMsg({ name: 'take.wav', size: 840_000 }, 4.24)), 'take.wav · 820 KB · 4.2 s');
  assert.equal(en(recordingFileMsg({ name: 'take.wav', size: 840_000 }, null)), 'take.wav · 820 KB');
  assert.equal(recordingFitNote(5.9, 6), null);
  assert.equal(en(recordingFitNote(7.42, 6)), '7.4 s is longer than the 6 s shot. Once added, choose how to fit it.');
  assert.equal(recordingFitNote(null, 6), null);
});

test('the receipt and its toast: a fitting recording, and one that still needs fitting', () => {
  const receipt = { shotId: 'shot-2-3', headVersion: 13, commandId: 'c1', fits: true, measuredSeconds: 4.234, recording: { id: 'r', sha256: 'f'.repeat(64), samples: 203232 } };
  assert.equal(isRecordingReceipt(receipt), true);
  assert.equal(isRecordingReceipt({ refused: { code: 'X' } }), false);
  assert.equal(en(recordingDone('2.3', receipt, 6)), '2.3 now uses your recording (4.2 s).');
  assert.equal(en(recordingDone('2.3', { ...receipt, fits: false, measuredSeconds: 7.4 }, 6)), '2.3 now uses your recording (7.4 s), longer than the 6 s shot. Choose how to fit it.');
  assert.equal(zh(recordingDone('2.3', receipt, 6)), '2.3 现在使用你的录音（4.2 秒）。');
  // New words were saved first as their own command: the recording's Undo leaves them.
  assert.equal(en(recordingDone('2.3', receipt, 6, true)), '2.3 now uses your recording (4.2 s) with its new words. Undo takes back the recording; the words stay.');
  assert.match(zh(recordingDone('2.3', { ...receipt, fits: false }, 6, true)), /撤销只撤回录音，文字保留。$/);
});

test('a recording not added: what became of the words saved for it, in place and in a toast once the panel is closed', () => {
  assert.equal(wordsNote('none'), null);
  assert.equal(en(wordsNote('restored')), 'The words are back as they were.');
  assert.equal(en(wordsNote('kept')), 'The new words were saved, though the recording was not added.');
  const refusal = recordingRefusal('MEDIA_INVALID_INPUT');
  assert.equal(en(notAddedToast('2.2', true, 'none', refusal)), 'Sending the recording for 2.2 stopped; nothing was added.');
  assert.equal(en(notAddedToast('2.2', true, 'restored', refusal)), 'Sending the recording for 2.2 stopped; nothing was added.');
  assert.equal(en(notAddedToast('2.2', true, 'kept', refusal)), 'Sending the recording for 2.2 stopped; it was not added, but its new words were saved.');
  assert.equal(notAddedToast('2.2', false, 'restored', refusal), refusal);
  assert.equal(en(notAddedToast('2.2', false, 'kept', refusal)), 'The recording for 2.2 was not added, but its new words were saved.');
  assert.equal(zh(notAddedToast('2.2', true, 'none', refusal)), '已停止发送 2.2 的录音，没有添加任何内容。');
});

test('refusals are said in place, neutral; unknown codes still name themselves', () => {
  const said = (code) => en(recordingRefusal(code));
  assert.equal(said('NARRATION_MEDIA_UNAVAILABLE'), 'Recordings need FFmpeg on this computer. See Settings › This computer.');
  assert.equal(said('UPLOAD_TOO_LARGE'), 'The studio refused this recording as too large.');
  assert.equal(said('MEDIA_DURATION_LIMIT'), 'The studio refused this recording as longer than 6 minutes.');
  assert.equal(said('AUDIO_PCM_DURATION_LIMIT'), 'The studio refused this recording as longer than 6 minutes.');
  assert.equal(said('MEDIA_INVALID_INPUT'), 'The studio could not read this recording. Try another file.');
  assert.equal(said('NARRATION_RECORDING_REQUIRED'), 'The studio could not read this recording. Try another file.');
  assert.equal(said('REVISION_CONFLICT'), 'The film changed while the recording was sent. Try again.');
  assert.equal(said('CONFIRMATION_RUNNING'), "This scene's video is being made. Add the recording once it finishes.");
  assert.equal(said('IDEMPOTENCY_CONFLICT'), 'This request was already used for another version of the film. Choose the file again.');
  assert.equal(said('NETWORK_ERROR'), 'The studio did not answer. Try again: the same recording is never added twice.');
  assert.equal(said('INSTALLATION_QUARANTINED'), 'The studio is in recovery review. Nothing can be added until it is finished.');
  assert.equal(said('SOMETHING_NEW'), 'Something went wrong (SOMETHING_NEW).');
});

test('after a failure: an unknown answer keeps the key, a stale resend starts fresh, a refusal settles', () => {
  assert.equal(afterRecordingFailure('NETWORK_ERROR', false), 'keep');
  assert.equal(afterRecordingFailure('TIMEOUT', true), 'keep');
  assert.equal(afterRecordingFailure('REVISION_CONFLICT', true), 'fresh');
  assert.equal(afterRecordingFailure('REVISION_CONFLICT', false), 'settle');
  assert.equal(afterRecordingFailure('MEDIA_INVALID_INPUT', false), 'settle');
  assert.equal(recordingRetryable('NETWORK_ERROR'), true);
  assert.equal(recordingRetryable('CONFIRMATION_RUNNING'), true);
  assert.equal(recordingRetryable('MEDIA_INVALID_INPUT'), false);
});

test('sending is a real fraction of the bytes', () => {
  const view = sendingMsg(512 * 1024, 2 * 1024 * 1024);
  assert.equal(view.fraction, 0.25);
  assert.equal(en(view.label), 'Sending 512 KB of 2 MB');
  assert.equal(sendingMsg(-5, 0).fraction, 0);
});
