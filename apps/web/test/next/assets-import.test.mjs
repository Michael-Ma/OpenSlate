import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capabilitiesFrom, checkFile, cleanName, DEFAULT_CAPABILITIES, formatBytes, importDoneMsg, importedArtifactId, importKind,
  IMPORT_LIMITS, refusalMsg, resendsSameKey, sendingView, uploadPath,
} from '../../src/next/model/assets-import.ts';
import { translate } from '../../src/next/i18n/translate.ts';
import { isMessageId } from '../../src/next/i18n/messages.ts';

const en = (m) => translate('en', m.id, m.values);
const MIB = 1024 * 1024;

test('a file goes to the route for its kind, by type or extension', () => {
  assert.equal(importKind({ name: 'a.png', type: 'image/png' }), 'image');
  assert.equal(importKind({ name: 'a.PNG', type: '' }), 'image');
  assert.equal(importKind({ name: 'a.jpg', type: 'image/jpeg' }), 'other_image');
  assert.equal(importKind({ name: 'a.mp4', type: 'video/mp4' }), 'video');
  assert.equal(importKind({ name: 'a.mov', type: '' }), 'video');
  assert.equal(importKind({ name: 'a.wav', type: 'audio/wav' }), 'audio');
  assert.equal(importKind({ name: 'a.m4a', type: 'application/octet-stream' }), 'audio');
  assert.equal(importKind({ name: 'notes.txt', type: 'text/plain' }), null);
});

test('files are refused before sending: wrong kind, not PNG, empty, too large, not importable here', () => {
  assert.deepEqual(checkFile({ name: 'a.png', type: 'image/png', size: 1000 }), { ok: true, kind: 'image' });
  assert.equal(en(checkFile({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }).refusal), 'Only PNG images can be imported. Save the picture as PNG and choose it again.');
  assert.equal(checkFile({ name: 'a.txt', type: 'text/plain', size: 10 }).refusal.id, 'assets.refusal.type');
  assert.equal(checkFile({ name: 'a.wav', type: 'audio/wav', size: 0 }).refusal.id, 'assets.refusal.empty');
  const big = checkFile({ name: 'a.png', type: 'image/png', size: 33 * MIB });
  assert.equal(en(big.refusal), 'This file is 33 MB; the studio takes up to 32 MB for this kind of file.');
  assert.equal(checkFile({ name: 'a.mp4', type: 'video/mp4', size: 128 * MIB }).ok, true, 'exactly the limit is allowed');
  const noFfmpeg = capabilitiesFrom({ capabilities: { import: false, maxBytes: 32 * MIB } }, { capabilities: { import: false } });
  assert.equal(checkFile({ name: 'a.wav', type: 'audio/wav', size: 10 }, noFfmpeg).refusal.id, 'assets.refusal.unavailable');
  assert.equal(checkFile({ name: 'a.mp4', type: 'video/mp4', size: 10 }, noFfmpeg).ok, true, 'video has no capability read; the route decides');
});

test('capabilities only ever tighten the limits', () => {
  const caps = capabilitiesFrom({ capabilities: { import: true, maxBytes: 16 * MIB } }, { capabilities: { import: true, maxBytes: 999 * MIB } });
  assert.equal(caps.limits.image, 16 * MIB);
  assert.equal(caps.limits.audio, IMPORT_LIMITS.audio);
  assert.deepEqual(capabilitiesFrom(null, null), DEFAULT_CAPABILITIES);
});

test('upload paths match the studio routes', () => {
  assert.equal(uploadPath('image', 12, 'music', 'x.png'), '/images/uploads?expectedHeadVersion=12');
  assert.equal(uploadPath('video', 3, 'music', 'x.mp4'), '/media/uploads?expectedHeadVersion=3');
  assert.equal(uploadPath('audio', 3, 'music', 'low tide.mp3'), '/audio-library/uploads?role=music&name=low+tide.mp3');
  assert.equal(uploadPath('audio', 3, 'upload', 'a/b\u0001c.wav'), '/audio-library/uploads?role=upload&name=abc.wav');
  assert.equal(cleanName('x'.repeat(200)).length, 120);
  assert.equal(uploadPath('audio', 0, 'upload', '\u0002'), '/audio-library/uploads?role=upload', 'an empty name is left to the server');
});

test('receipts name the new file; lost replies resend the same key', () => {
  assert.equal(importedArtifactId('image', { artifact: { artifactId: 'img-1' } }), 'img-1');
  assert.equal(importedArtifactId('video', { artifact: { artifactId: 'vid-1' } }), 'vid-1');
  assert.equal(importedArtifactId('audio', { recording: { id: 'aud-1' } }), 'aud-1');
  assert.equal(importedArtifactId('audio', null), null);
  assert.equal(resendsSameKey('NETWORK_ERROR'), true);
  assert.equal(resendsSameKey('REVISION_CONFLICT'), false);
});

test('refusals are words in the interface language, and every one exists in the catalogue', () => {
  for (const code of ['UPLOAD_TOO_LARGE', 'IMAGE_INPUT_INVALID', 'NARRATION_MEDIA_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'NOT_FOUND', 'MEDIA_INVALID_INPUT', 'REVISION_CONFLICT', 'UPLOAD_CORRUPT', 'NETWORK_ERROR', 'AUTH_REQUIRED', 'CSRF_DENIED', 'INSTALLATION_QUARANTINED', 'MEDIA_TOO_LONG', 'SOMETHING_NEW'])
    assert.ok(isMessageId(refusalMsg(code).id), code);
  assert.equal(en(refusalMsg('SOMETHING_NEW')), 'The import was refused (SOMETHING_NEW).');
  assert.equal(en(refusalMsg('REVISION_CONFLICT')), 'The film changed while the file was being sent. Try again.');
});

test('progress is a real fraction while sending; sizes read in binary units', () => {
  const view = sendingView(512 * 1024, 2 * MIB);
  assert.equal(view.fraction, 0.25);
  assert.equal(en(view.label), 'Sending 512 KB of 2 MB');
  assert.equal(sendingView(10, 0).fraction, 1);
  assert.equal(formatBytes(900), '900 B');
  assert.equal(formatBytes(1.25 * MIB), '1.3 MB');
  assert.equal(formatBytes(128 * MIB), '128 MB');
  assert.equal(en(importDoneMsg('audio', 'music', 'low-tide.mp3')), 'Imported low-tide.mp3 as music.');
  assert.equal(en(importDoneMsg('audio', 'upload', 'pier.wav')), 'Imported pier.wav as other audio.');
  assert.equal(en(importDoneMsg('image', 'music', 'pier.png')), 'Imported pier.png.');
});
