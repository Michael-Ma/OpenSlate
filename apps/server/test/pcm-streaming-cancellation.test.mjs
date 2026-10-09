import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants, existsSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { LocalMediaService } from '../dist/media/local-media.js';
import { wave } from './speech-execution-fixture.mjs';

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg');
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openslate-streaming-import-'))), path = join(root, 'source.wav'), bytes = wave(97200);
  bytes.writeUInt32LE(0xffffffff, 4); bytes.writeUInt32LE(0xffffffff, 40); writeFileSync(path, bytes);
  const media = new LocalMediaService({ rootDir: join(root, 'media'), allowedInputRoots: [root], ffmpegPath, ffprobePath });
  const controller = new AbortController(), options = { signal: controller.signal, completedStreamBytes: bytes.length };
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true }); });
  return { root, path, bytes, media, controller, options };
}
function unchangedAndUnpublished(f) {
  assert.deepEqual(readFileSync(f.path), f.bytes);
  for (const directory of ['blobs', 'sources', 'tmp']) assert.deepEqual(readdirSync(join(f.media.rootDir, directory)), []);
}

test('completed streaming import keeps original input and cancellation when caller replaces mutable options during private header read', async t => {
  const f = fixture(t), input = { artifactId: 'signal-review', path: f.path, kind: 'audio' }, originalOpen = fs.open;
  let reached = false;
  t.mock.method(fs, 'open', async (path, flags, ...args) => {
    const handle = await originalOpen(path, flags, ...args);
    if (!reached && flags === 'r' && String(path).endsWith('/input')) {
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        f.options.signal = new AbortController().signal; f.options.completedStreamBytes = 1;
        input.path = '/unavailable/mutated-input'; input.artifactId = 'mutated-identity';
        f.controller.abort(); reached = true; return result;
      };
    }
    return handle;
  });
  syncBuiltinESMExports();
  await assert.rejects(f.media.importMedia(input, f.options), error => error.code === 'MEDIA_CANCELLED');
  assert.equal(reached, true); unchangedAndUnpublished(f);
});

test('cancellation after the private decoder copy retains original response and publishes no audio artifact', async t => {
  const f = fixture(t), originalCopy = fs.copyFile; let reached = false;
  t.mock.method(fs, 'copyFile', async (...args) => {
    const result = await originalCopy(...args);
    if (String(args[1]).endsWith('/framed-input.wav')) {
      assert.equal(args[2], constants.COPYFILE_EXCL); assert.deepEqual(readFileSync(args[1]), f.bytes);
      f.options.signal = new AbortController().signal; f.controller.abort(); reached = true;
    }
    return result;
  });
  syncBuiltinESMExports();
  await assert.rejects(f.media.importMedia({ artifactId: 'copy-cancel', path: f.path, kind: 'audio' }, f.options), error => error.code === 'MEDIA_CANCELLED');
  assert.equal(reached, true); unchangedAndUnpublished(f);
});

test('private WAV framing repairs only the two size fields; complete PCM and paid-response hash stay byte exact', async t => {
  const f = fixture(t), originalOpen = fs.open; let decoderBytes;
  t.mock.method(fs, 'open', async (path, flags, ...args) => {
    const handle = await originalOpen(path, flags, ...args);
    if (String(path).endsWith('/framed-input.wav') && flags === (constants.O_RDWR | constants.O_NOFOLLOW)) {
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); decoderBytes = readFileSync(path); };
    }
    return handle;
  });
  syncBuiltinESMExports();
  const source = await f.media.importMedia({ artifactId: 'framing-review', path: f.path, kind: 'audio' }, f.options);
  assert.ok(decoderBytes); assert.equal(decoderBytes.length, f.bytes.length);
  assert.equal(decoderBytes.readUInt32LE(4), f.bytes.length - 8); assert.equal(decoderBytes.readUInt32LE(40), f.bytes.length - 44);
  assert.deepEqual(decoderBytes.subarray(0, 4), f.bytes.subarray(0, 4));
  assert.deepEqual(decoderBytes.subarray(8, 40), f.bytes.subarray(8, 40));
  assert.equal(hash(decoderBytes.subarray(44)), hash(f.bytes.subarray(44)));
  assert.equal(source.originalSha256, hash(f.bytes)); assert.equal(source.originalByteLength, f.bytes.length);
  assert.deepEqual(readFileSync(join(f.media.rootDir, 'blobs', `${source.originalSha256}.source`)), f.bytes);
  assert.deepEqual(readFileSync(f.path), f.bytes);
  assert.equal(source.probe.audio.samples, 194400); assert.equal(source.probe.audio.sampleRate, 48000); assert.equal(source.probe.audio.channels, 2);
  assert.deepEqual(readdirSync(join(f.media.rootDir, 'tmp')), []);
});
