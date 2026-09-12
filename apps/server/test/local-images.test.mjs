import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalImageStore } from '../dist/media/local-images.js';

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg');
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let fixtures, png;
before(async () => {
  fixtures = await mkdtemp(join(tmpdir(), 'openslate-image-fixture-'));
  await promisify(execFile)(ffmpegPath, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', '-threads', '1', join(fixtures, 'image.png')], { timeout: 15000 });
  png = await readFile(join(fixtures, 'image.png'));
});
after(async () => rm(fixtures, { recursive: true, force: true }));
function input(bytes = png) { return { bytes, sha256: sha(bytes), mimeType: 'image/png', width: 320, height: 180 }; }
async function fixture(t) {
  const rootDir = await mkdtemp(join(tmpdir(), 'openslate-image-store-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return new LocalImageStore({ rootDir, ffmpegPath, ffprobePath });
}

test('a fully decoded keyframe preserves exact encoded bytes and reuses immutable storage', async t => {
  const store = await fixture(t), one = await store.ingest(input()), two = await store.ingest(input());
  assert.equal(one.path, two.path); assert.equal(one.sha256, sha(png)); assert.deepEqual(await readFile(one.path), png);
  assert.equal(one.width, 320); assert.equal(one.height, 180); assert.equal(one.validationDigest, two.validationDigest);
  assert.equal(Object.isFrozen(one), true); assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []);
});

test('input bytes and metadata are frozen before asynchronous validation', async t => {
  const store = await fixture(t), value = input(Buffer.from(png)), expectedHash = value.sha256;
  const running = store.ingest(value); value.bytes.fill(0); value.sha256 = 'b'.repeat(64); value.width = 999;
  const result = await running; assert.equal(result.sha256, expectedHash); assert.equal(result.width, 320); assert.deepEqual(await readFile(result.path), png);
});

test('wrong hashes, dimensions, formats and oversized input fail without publication', async t => {
  const store = await fixture(t);
  for (const changed of [{ sha256: '0'.repeat(64) }, { width: 321 }, { mimeType: 'image/jpeg' }, { width: 4096, height: 4096 }, { bytes: new Uint8Array(32 * 1024 * 1024 + 1) }])
    await assert.rejects(store.ingest({ ...input(), ...changed }), error => ['IMAGE_INPUT_INVALID', 'IMAGE_DIGEST_MISMATCH'].includes(error.code));
  assert.deepEqual(await readdir(join(store.rootDir, 'blobs')), []); assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []);
});

test('a matching PNG header is insufficient without a decodable complete image', async t => {
  const store = await fixture(t), truncated = png.subarray(0, 40);
  await assert.rejects(store.ingest(input(truncated)), error => ['MEDIA_TOOL_FAILED', 'IMAGE_VALIDATION_FAILED'].includes(error.code));
  assert.deepEqual(await readdir(join(store.rootDir, 'blobs')), []); assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []);
});

test('existing corrupted or symlinked storage is never replaced or trusted', async t => {
  const store = await fixture(t), path = join(store.rootDir, 'blobs', `${sha(png)}.png`), corrupted = Buffer.from(png); corrupted[40] ^= 1;
  await writeFile(path, corrupted);
  await assert.rejects(store.ingest(input()), error => error.code === 'IMAGE_INTEGRITY_ERROR'); assert.deepEqual(await readFile(path), corrupted);
  await rm(path); const outside = join(fixtures, 'outside.png'); await writeFile(outside, png); await symlink(outside, path);
  await assert.rejects(store.ingest(input()), error => error.code === 'IMAGE_INTEGRITY_ERROR'); assert.deepEqual(await readFile(outside), png);
});

test('pre-cancelled validation performs no staging or publication', async t => {
  const store = await fixture(t), abort = new AbortController(); abort.abort();
  await assert.rejects(store.ingest(input(), { signal: abort.signal }), error => error.code === 'MEDIA_CANCELLED');
  assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []); assert.deepEqual(await readdir(join(store.rootDir, 'blobs')), []);
});

test('cancellation after publication rejects the descriptor and preserves a reusable validated blob', async t => {
  const store = await fixture(t), abort = new AbortController(), readVerified = store.readVerified.bind(store);
  // Place the cancellation at an asynchronous publication boundary, after the
  // actual decoder and immutable installation have succeeded.
  store.readVerified = async (...args) => { const bytes = await readVerified(...args); abort.abort(); return bytes; };
  await assert.rejects(store.ingest(input(), { signal: abort.signal }), error => error.code === 'MEDIA_CANCELLED');
  assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []);
  assert.deepEqual(await readdir(join(store.rootDir, 'blobs')), [`${sha(png)}.png`]);
  store.readVerified = readVerified;
  const result = await store.ingest(input());
  assert.deepEqual(await readFile(result.path), png, 'a cancelled caller cannot delete bytes another caller can reuse');
});

test('replacing the caller options cannot detach the original cancellation signal', async t => {
  const store = await fixture(t), abort = new AbortController(), options = { signal: abort.signal };
  const running = store.ingest(input(), options);
  options.signal = new AbortController().signal; abort.abort();
  await assert.rejects(running, error => error.code === 'MEDIA_CANCELLED');
  assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []); assert.deepEqual(await readdir(join(store.rootDir, 'blobs')), []);
});

test('concurrent same-image validations share one immutable publication and clean their own staging', async t => {
  const store = await fixture(t), results = await Promise.all([1, 2, 3, 4].map(() => store.ingest(input())));
  assert.equal(new Set(results.map(result => result.path)).size, 1);
  assert.equal(new Set(results.map(result => result.validationDigest)).size, 1);
  assert.deepEqual(await readdir(join(store.rootDir, 'blobs')), [`${sha(png)}.png`]);
  assert.deepEqual(await readFile(results[0].path), png);
  assert.deepEqual(await readdir(join(store.rootDir, 'tmp')), []);
});
