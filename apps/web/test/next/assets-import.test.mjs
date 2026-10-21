import test from 'node:test';
import assert from 'node:assert/strict';
import {
  afterFailure, capabilitiesFrom, checkFile, checkLength, checkPngHeader, cleanName, DEFAULT_CAPABILITIES, formatBytes, importDoneMsg,
  importedArtifactId, importIdentity, ImportKeys, importKind, IMPORT_KEY_MAX_AGE_MS, IMPORT_LIMITS, IMPORT_MAX_SECONDS, PNG_HEADER_BYTES,
  refusalMsg, retryable, sendingView, uploadPath,
} from '../../src/next/model/assets-import.ts';
import { translate } from '../../src/next/i18n/translate.ts';
import { isMessageId } from '../../src/next/i18n/messages.ts';

const en = (m) => translate('en', m.id, m.values);
const MIB = 1024 * 1024;

test('a file goes to the route for its kind, by type or extension', () => {
  assert.equal(importKind({ name: 'a.png', type: 'image/png' }), 'image');
  assert.equal(importKind({ name: 'a.PNG', type: '' }), 'image');
  assert.equal(importKind({ name: 'a.jpg', type: 'image/jpeg' }), 'image', 'JPEG, WebP and HEIC are stored as PNG by the studio');
  assert.equal(importKind({ name: 'a.webp', type: '' }), 'image');
  assert.equal(importKind({ name: 'a.HEIC', type: 'application/octet-stream' }), 'image');
  assert.equal(importKind({ name: 'a.gif', type: 'image/gif' }), 'other_image');
  assert.equal(importKind({ name: 'a.mp4', type: 'video/mp4' }), 'video');
  assert.equal(importKind({ name: 'a.mov', type: '' }), 'video');
  assert.equal(importKind({ name: 'a.wav', type: 'audio/wav' }), 'audio');
  assert.equal(importKind({ name: 'a.m4a', type: 'application/octet-stream' }), 'audio');
  assert.equal(importKind({ name: 'notes.txt', type: 'text/plain' }), 'document');
  assert.equal(importKind({ name: 'brief.pdf', type: 'application/pdf' }), 'document');
  assert.equal(importKind({ name: 'plan.md', type: '' }), 'document');
  assert.equal(importKind({ name: 'sheet.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), null);
});

test('files are refused before sending: wrong kind, unsupported picture, empty, too large, not importable here', () => {
  assert.deepEqual(checkFile({ name: 'a.png', type: 'image/png', size: 1000 }), { ok: true, kind: 'image' });
  assert.deepEqual(checkFile({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }), { ok: true, kind: 'image' });
  assert.equal(en(checkFile({ name: 'a.gif', type: 'image/gif', size: 1000 }).refusal), 'This picture format can’t be imported. Use PNG, JPEG, WebP or HEIC.');
  assert.deepEqual(checkFile({ name: 'a.txt', type: 'text/plain', size: 10 }), { ok: true, kind: 'document' });
  assert.equal(checkFile({ name: 'a.zip', type: 'application/zip', size: 10 }).refusal.id, 'assets.refusal.type');
  assert.equal(checkFile({ name: 'a.pdf', type: 'application/pdf', size: 33 * MIB }).refusal.id, 'assets.refusal.too_large');
  assert.equal(checkFile({ name: 'a.wav', type: 'audio/wav', size: 0 }).refusal.id, 'assets.refusal.empty');
  const big = checkFile({ name: 'a.png', type: 'image/png', size: 33 * MIB });
  assert.equal(en(big.refusal), 'This file is 33 MB; the studio takes up to 32 MB for this kind of file.');
  assert.equal(checkFile({ name: 'a.mp4', type: 'video/mp4', size: 128 * MIB }).ok, true, 'exactly the limit is allowed');
  const noFfmpeg = capabilitiesFrom({ capabilities: { import: false, maxBytes: 32 * MIB } }, { capabilities: { import: false } });
  assert.equal(checkFile({ name: 'a.wav', type: 'audio/wav', size: 10 }, noFfmpeg).refusal.id, 'assets.refusal.unavailable');
  assert.equal(checkFile({ name: 'a.mp4', type: 'video/mp4', size: 10 }, noFfmpeg).refusal.id, 'assets.refusal.unavailable',
    'video needs the same FFmpeg as PNG images, so the image capability answers for it');
  const audioOnly = capabilitiesFrom({ capabilities: { import: true } }, { capabilities: { import: false } });
  assert.equal(checkFile({ name: 'a.mp4', type: 'video/mp4', size: 10 }, audioOnly).ok, true);
});

/** The first bytes of a PNG of the given size (signature and IHDR), as the browser reads them before sending. */
function pngHeader(width, height, { signature = true, chunk = 'IHDR' } = {}) {
  const bytes = Buffer.alloc(PNG_HEADER_BYTES);
  if (signature) Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); bytes.write(chunk, 12, 'ascii'); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return new Uint8Array(bytes);
}

test('a PNG is checked by its first bytes: a real PNG, at most 3840 × 2160 pixels and 4096 on a side', () => {
  assert.deepEqual(checkPngHeader(pngHeader(1600, 900)), { ok: true, kind: 'image' });
  assert.deepEqual(checkPngHeader(pngHeader(3840, 2160)), { ok: true, kind: 'image' }, 'exactly the pixel limit');
  assert.deepEqual(checkPngHeader(pngHeader(4096, 2025)), { ok: true, kind: 'image' }, 'a 4096 side within the pixel limit');
  assert.equal(en(checkPngHeader(pngHeader(4097, 100)).refusal),
    'This image is 4097 × 100 pixels. The studio takes PNG images up to 3840 × 2160 (8.3 million pixels, no side over 4096).');
  assert.equal(checkPngHeader(pngHeader(4096, 4096)).refusal.id, 'assets.refusal.png_pixels', 'over the pixel limit');
  assert.equal(checkPngHeader(pngHeader(10, 10, { signature: false })).refusal.id, 'assets.refusal.not_png');
  assert.equal(checkPngHeader(pngHeader(10, 10, { chunk: 'IDAT' })).refusal.id, 'assets.refusal.not_png');
  assert.equal(checkPngHeader(pngHeader(0, 10)).refusal.id, 'assets.refusal.not_png');
  assert.equal(checkPngHeader(new TextEncoder().encode('not a png')).refusal.id, 'assets.refusal.not_png', 'too short to be a PNG');
  assert.deepEqual(checkPngHeader(null), { ok: true, kind: 'image' }, 'an unreadable start is left to the studio');
});

test('Try again is offered only where the same file can work on another try', () => {
  for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'REQUEST_FAILED', 'AUTH_REQUIRED', 'CSRF_DENIED', 'SESSION_CLOSED', 'REVISION_CONFLICT', 'UPLOAD_CORRUPT', 'MEDIA_TIMEOUT', 'INSTALLATION_QUARANTINED'])
    assert.equal(retryable(code), true, code);
  for (const code of ['IMAGE_INPUT_INVALID', 'IMAGE_VALIDATION_FAILED', 'MEDIA_DURATION_LIMIT', 'UPLOAD_TOO_LARGE', 'MEDIA_STREAM_MISSING', 'NARRATION_MEDIA_UNAVAILABLE', 'NOT_FOUND', 'SOMETHING_NEW'])
    assert.equal(retryable(code), false, code);
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

test('receipts name the new file', () => {
  assert.equal(importedArtifactId('image', { artifact: { artifactId: 'img-1' } }), 'img-1');
  assert.equal(importedArtifactId('video', { artifact: { artifactId: 'vid-1' } }), 'vid-1');
  assert.equal(importedArtifactId('audio', { recording: { id: 'aud-1' } }), 'aud-1');
  assert.equal(importedArtifactId('audio', null), null);
});

test('an unknown answer keeps the request; a stale resend makes a fresh one; a refusal ends it', () => {
  for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'AUTH_REQUIRED', 'CSRF_DENIED', 'REQUEST_FAILED', 'INTERNAL_ERROR'])
    assert.equal(afterFailure(code, false), 'keep', code);
  assert.equal(afterFailure('NETWORK_ERROR', true), 'keep');
  assert.equal(afterFailure('REVISION_CONFLICT', true), 'fresh', 'a resend that is out of date means the first try never arrived');
  assert.equal(afterFailure('REVISION_CONFLICT', false), 'settle');
  assert.equal(afterFailure('IMAGE_INPUT_INVALID', true), 'settle');
  assert.equal(afterFailure('MEDIA_DURATION_LIMIT', false), 'settle');
});

/** A Storage stand-in. */
function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k), values };
}

test('a lost reply is resent exactly as first sent, found by the file, even after the film version moved', () => {
  let n = 0;
  const storage = memoryStorage();
  const keys = new ImportKeys('p1', storage, () => `key-${++n}`, () => 1000);
  const file = { name: 'pier.png', size: 5000, lastModified: 42 };
  const identity = importIdentity(file, 'image', 'music');
  const first = keys.begin(identity, '/images/uploads?expectedHeadVersion=2');
  assert.deepEqual(first, { key: 'key-1', path: '/images/uploads?expectedHeadVersion=2', resent: false });
  // The reply was lost; the studio committed and the film is now at version 3. The retry builds a new path,
  // but the saved request wins: same key, same version, so the studio replays its receipt.
  const again = keys.begin(identity, '/images/uploads?expectedHeadVersion=3');
  assert.deepEqual(again, { key: 'key-1', path: '/images/uploads?expectedHeadVersion=2', resent: true });
  // It survives closing the sheet and reloading: a new instance reads it back from storage.
  const reloaded = new ImportKeys('p1', storage, () => 'other', () => 2000);
  assert.deepEqual(reloaded.begin(identity, '/images/uploads?expectedHeadVersion=9'), again);
  // Another film keeps its own.
  assert.equal(new ImportKeys('p2', storage, () => 'p2-key', () => 2000).begin(identity, '/x').key, 'p2-key');
  // Settled: the next import of the same file is a new one.
  keys.settle(identity);
  assert.deepEqual(keys.begin(identity, '/images/uploads?expectedHeadVersion=3'), { key: 'key-2', path: '/images/uploads?expectedHeadVersion=3', resent: false });
});

test('the file identity separates files, kinds and audio uses; old saved requests are forgotten', () => {
  const file = { name: 'tide.wav', size: 10, lastModified: 5 };
  assert.notEqual(importIdentity(file, 'audio', 'music'), importIdentity(file, 'audio', 'upload'));
  assert.notEqual(importIdentity(file, 'audio', 'music'), importIdentity({ ...file, lastModified: 6 }, 'audio', 'music'));
  assert.equal(importIdentity({ name: 'a.png', size: 1, lastModified: 1 }, 'image', 'music'), importIdentity({ name: 'a.png', size: 1, lastModified: 1 }, 'image', 'upload'), 'use only matters for audio');
  let now = 0;
  const storage = memoryStorage();
  const keys = new ImportKeys('p', storage, () => `k${now}`, () => now);
  keys.begin('a', '/a');
  now = IMPORT_KEY_MAX_AGE_MS + 1;
  assert.equal(keys.saved('a'), undefined);
  assert.equal(keys.begin('a', '/a2').resent, false);
  // A broken stored value is ignored, and failing storage only loses persistence.
  storage.setItem('openslate.next.asset-imports.q', '{nope');
  assert.equal(new ImportKeys('q', storage, () => 'k', () => 0).saved('a'), undefined);
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const fragile = new ImportKeys('r', throwing, () => 'k1', () => 0);
  assert.equal(fragile.begin('a', '/a').key, 'k1');
  assert.equal(fragile.begin('a', '/b').resent, true, 'memory still protects this tab');
});

test('video and audio over 6 minutes are refused before sending, by their length', () => {
  assert.deepEqual(checkLength('audio', 359), { ok: true, kind: 'audio' });
  assert.deepEqual(checkLength('video', IMPORT_MAX_SECONDS), { ok: true, kind: 'video' });
  assert.deepEqual(checkLength('video', null), { ok: true, kind: 'video' }, 'an unknown length is left to the studio');
  assert.deepEqual(checkLength('image', 9999), { ok: true, kind: 'image' });
  assert.equal(en(checkLength('audio', 400).refusal), 'This file is 6:40 long; the studio takes video and audio up to 6 minutes.');
  assert.equal(checkLength('video', 361).ok, false);
});

test('refusals are words in the interface language, and every one exists in the catalogue', () => {
  for (const code of ['UPLOAD_TOO_LARGE', 'IMAGE_INPUT_INVALID', 'NARRATION_MEDIA_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'NOT_FOUND', 'MEDIA_INVALID_INPUT', 'REVISION_CONFLICT', 'UPLOAD_CORRUPT', 'NETWORK_ERROR', 'AUTH_REQUIRED', 'CSRF_DENIED', 'INSTALLATION_QUARANTINED', 'MEDIA_DURATION_LIMIT', 'MEDIA_TIMEOUT', 'TIMEOUT', 'SOMETHING_NEW'])
    assert.ok(isMessageId(refusalMsg(code).id), code);
  assert.equal(en(refusalMsg('SOMETHING_NEW')), 'The import was refused (SOMETHING_NEW).');
  assert.equal(en(refusalMsg('REVISION_CONFLICT')), 'The film changed while the file was being sent. Try again.');
});

test('the codes the studio sends for long, unreadable or oversized media say so in words', () => {
  const id = (code) => refusalMsg(code).id;
  assert.equal(id('MEDIA_DURATION_LIMIT'), 'assets.refusal.too_long');
  assert.equal(id('AUDIO_PCM_DURATION_LIMIT'), 'assets.refusal.too_long');
  assert.equal(en(refusalMsg('MEDIA_DURATION_LIMIT')), 'This file is longer than 6 minutes, the most the studio takes.');
  for (const code of ['MEDIA_STREAM_MISSING', 'MEDIA_VALIDATION_FAILED', 'MEDIA_INVALID_INPUT', 'MEDIA_INTEGRITY_ERROR', 'AUDIO_PCM_INVALID', 'AUDIO_PCM_UNSUPPORTED', 'MEDIA_TOOL_FAILED', 'MEDIA_TOOL_OUTPUT_LIMIT'])
    assert.equal(id(code), 'assets.refusal.unreadable', code);
  for (const code of ['UPLOAD_TOO_LARGE', 'MEDIA_INPUT_LIMIT', 'AUDIO_NORMALIZATION_INPUT_LIMIT'])
    assert.equal(id(code), 'assets.refusal.too_large_server', code);
  for (const code of ['SERVICE_UNAVAILABLE', 'NARRATION_MEDIA_UNAVAILABLE', 'MEDIA_TOOL_UNAVAILABLE'])
    assert.equal(id(code), 'assets.refusal.unavailable', code);
  // The studio refuses a damaged PNG and one too large in pixels with the same code: the words cover both.
  for (const code of ['IMAGE_INPUT_INVALID', 'IMAGE_VALIDATION_FAILED', 'IMAGE_EXECUTION_INPUT_INVALID'])
    assert.equal(id(code), 'assets.refusal.png_refused', code);
  assert.equal(en(refusalMsg('IMAGE_INPUT_INVALID')), 'The studio could not take this PNG. It may be damaged, or larger than 3840 × 2160 pixels.');
  assert.equal(id('IMAGE_DIGEST_MISMATCH'), 'assets.refusal.corrupt');
  assert.equal(id('MEDIA_UNSUPPORTED'), 'assets.refusal.not_supported');
  assert.equal(id('MEDIA_TIMEOUT'), 'assets.refusal.slow');
  // Without FFmpeg the studio has no video upload route: a missing route then means FFmpeg is missing.
  assert.equal(refusalMsg('NOT_FOUND', 'video').id, 'assets.refusal.unavailable');
  assert.equal(refusalMsg('NOT_FOUND', 'audio').id, 'assets.refusal.not_supported');
  // Codes the studio never sends are not mapped: they read as a refusal with their code.
  for (const code of ['MEDIA_TOO_LONG', 'AUDIO_TOO_LONG', 'MEDIA_PROBE_FAILED', 'PAYLOAD_TOO_LARGE', 'MEDIA_UNAVAILABLE'])
    assert.equal(id(code), 'assets.refusal.other', code);
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
