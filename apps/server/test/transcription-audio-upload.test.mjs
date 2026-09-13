import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { appendFileSync, chmodSync, readFileSync, renameSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { canonical, digest } from "@openslate/core";
import { describeOpenAITranscriptionRequest } from "@openslate/providers";
import { fixture, sha, wav } from "./transcription-audio-fixture.mjs";

async function prepared(t) {
  const f = await fixture(t, { samples: 48001 }), completed = await f.prepare();
  return { ...f, files: f.files, intent: f.store.get("transcription_audio_intent", completed.receipt.id), completed };
}
function replaceFile(path, bytes) { chmodSync(path, 0o600); writeFileSync(path, bytes); }
function saveReceipt(f, receipt) {
  replaceFile(join(f.files.rootDir, "completions", `${f.intent.id}.json`), canonical(receipt));
}
function interceptUploadHandle(t, f, edit) {
  const originalOpen = fs.open, verify = f.files.verifyBlob.bind(f.files); let verified = false, intercepted = false;
  f.files.verifyBlob = async (...args) => { const path = await verify(...args); verified = true; return path; };
  t.mock.method(fs, "open", async (path, ...args) => {
    const handle = await originalOpen(path, ...args);
    if (verified && path === f.completed.path && !intercepted) { intercepted = true; edit(handle); }
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return () => assert.equal(intercepted, true, "controlled upload-file boundary was reached");
}

test("owned FFmpeg derivative returns detached upload bytes with unchanged transport identity and no outward path", async t => {
  const f = await prepared(t), before = readFileSync(f.completed.path), receiptBefore = canonical(f.completed.receipt);
  const result = await f.files.readUpload(f.intent);
  assert.deepEqual(Object.keys(result).sort(), ["bytes", "receipt"]); assert.deepEqual(Buffer.from(result.bytes), before);
  const describe = bytes => describeOpenAITranscriptionRequest({ model: "whisper-1", language: null, timing: "word",
    input: { artifactId: f.intent.id, sha256: f.completed.receipt.audio.sha256, mimeType: "audio/wav", bytes } });
  assert.deepEqual(describe(result.bytes), describe(before));
  assert.equal(describe(result.bytes).input.waveform.sampleCount, result.receipt.audio.sampleCount);
  result.bytes.fill(0); result.receipt.audio.sha256 = "0".repeat(64);
  const next = await f.files.readUpload(f.intent);
  assert.deepEqual(Buffer.from(next.bytes), before); assert.equal(canonical(next.receipt), receiptBefore);
  assert.equal(f.calls.derive, 1); assert.deepEqual(readFileSync(f.completed.path), before);
});

test("missing or noncanonical upload completion never produces bytes", async t => {
  const f = await prepared(t), path = join(f.files.rootDir, "completions", `${f.intent.id}.json`);
  replaceFile(path, `${canonical(f.completed.receipt)}\n`);
  await assert.rejects(f.files.readUpload(f.intent), { code: "TRANSCRIPTION_AUDIO_CORRUPT" });
  unlinkSync(path); await assert.rejects(f.files.readUpload(f.intent), { code: "TRANSCRIPTION_AUDIO_NOT_READY" });
});

test("corrupt, truncated, grown, swapped or symbolic upload blobs fail complete verification", async t => {
  for (const damage of [
    f => { const bytes = readFileSync(f.completed.path); bytes[bytes.length - 1] ^= 1; replaceFile(f.completed.path, bytes); },
    f => { chmodSync(f.completed.path, 0o600); truncateSync(f.completed.path, 100); },
    f => { chmodSync(f.completed.path, 0o600); appendFileSync(f.completed.path, Buffer.from([0])); },
    f => { renameSync(f.completed.path, `${f.completed.path}.saved`); writeFileSync(f.completed.path, wav(16000, 16000, 1)); },
    f => { renameSync(f.completed.path, `${f.completed.path}.saved`); symlinkSync(`${f.completed.path}.saved`, f.completed.path); },
  ]) {
    const f = await prepared(t); damage(f); await assert.rejects(f.files.readUpload(f.intent));
    assert.equal(f.calls.derive, 1);
  }
});

test("upload rejects claimed 16 kHz geometry when matching hashed bytes contain another format", async t => {
  const f = await prepared(t), invalid = wav(f.completed.receipt.audio.sampleCount, 48000, 1), hash = sha(invalid);
  writeFileSync(join(f.files.rootDir, "blobs", `${hash}.wav`), invalid);
  saveReceipt(f, { ...f.completed.receipt, audio: { ...f.completed.receipt.audio, sha256: hash, byteLength: invalid.length } });
  await assert.rejects(f.files.readUpload(f.intent), { code: "TRANSCRIPTION_AUDIO_CORRUPT" });
});

test("measured bad endpoints remain historical evidence but cannot be uploaded", async t => {
  const f = await prepared(t), shortened = wav(15900, 16000, 1), hash = sha(shortened);
  writeFileSync(join(f.files.rootDir, "blobs", `${hash}.wav`), shortened);
  saveReceipt(f, { ...f.completed.receipt, audio: { ...f.completed.receipt.audio, sha256: hash, byteLength: shortened.length,
    sampleCount: 15900, endDelta48kSamples: 15900 * 3 - f.intent.sourceEndSample } });
  assert.equal((await f.files.read(f.intent)).receipt.audio.sampleCount, 15900);
  await assert.rejects(f.files.readUpload(f.intent), { code: "TRANSCRIPTION_AUDIO_ENDPOINT_MISMATCH" });
});

test("upload capacity is checked before opening a blob or allocating its reported size", async t => {
  for (const maxOutputBytes of [1024, 25_000_001]) {
    const f = await prepared(t), intent = structuredClone(f.intent); intent.recipe.maxOutputBytes = maxOutputBytes;
    saveReceipt(f, { ...f.completed.receipt, intentDigest: digest(intent) });
    f.files.verifyBlob = async () => { assert.fail("invalid capacity must not open the blob"); };
    await assert.rejects(f.files.readUpload(intent), { code: maxOutputBytes === 1024 ? "TRANSCRIPTION_AUDIO_OUTPUT_LIMIT" : "TRANSCRIPTION_AUDIO_RECIPE_INVALID" });
  }
});

test("original signal and intent remain captured across receipt reads despite caller option mutation", async t => {
  const f = await prepared(t), original = new AbortController(), options = { signal: original.signal }, input = structuredClone(f.intent);
  const readReceipt = f.files.readReceipt.bind(f.files), entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.files.readReceipt = async (...args) => { const receipt = await readReceipt(...args); entered.resolve(); await release.promise; return receipt; };
  const running = f.files.readUpload(input, options); await entered.promise;
  input.id = "a".repeat(64); input.recipe.maxOutputBytes = 1024; options.signal = new AbortController().signal;
  original.abort(); release.resolve(); await assert.rejects(running, { code: "MEDIA_CANCELLED" });
  const other = await f.files.readUpload(f.intent); assert.deepEqual(other.receipt, f.completed.receipt);
});

test("growth or truncation during the bounded upload copy cannot return a partial snapshot", async t => {
  for (const growth of [false, true]) {
    await t.test(growth ? "growth" : "truncation", async t => {
      const f = await prepared(t); chmodSync(f.completed.path, 0o600);
      const reached = interceptUploadHandle(t, f, handle => {
        const read = handle.read.bind(handle); let changed = false;
        handle.read = async (...args) => { const result = await read(...args);
          if (!changed) { changed = true; if (growth) appendFileSync(f.completed.path, Buffer.from([1])); else truncateSync(f.completed.path, 100); }
          return result;
        };
      });
      await assert.rejects(f.files.readUpload(f.intent), { code: "TRANSCRIPTION_AUDIO_CORRUPT" }); reached();
    });
  }
});

test("original cancellation during upload copy or final file close never returns success", async t => {
  for (const atClose of [false, true]) {
    await t.test(atClose ? "file cleanup" : "copy", async t => {
      const f = await prepared(t), original = new AbortController(), options = { signal: original.signal };
      const reached = interceptUploadHandle(t, f, handle => {
        const name = atClose ? "close" : "read", method = handle[name].bind(handle);
        handle[name] = async (...args) => { const result = await method(...args); options.signal = new AbortController().signal; original.abort(); return result; };
      });
      await assert.rejects(f.files.readUpload(f.intent, options), { code: "MEDIA_CANCELLED" }); reached();
      assert.deepEqual(readFileSync(f.completed.path), await fs.readFile(f.completed.path));
    });
  }
});

test("a changed private derivative directory cannot redirect upload reads", async t => {
  const f = await prepared(t), directory = join(f.files.rootDir, "blobs"), moved = join(f.files.rootDir, "blobs-saved");
  renameSync(directory, moved); symlinkSync(moved, directory);
  await assert.rejects(f.files.readUpload(f.intent), { code: "TRANSCRIPTION_AUDIO_CORRUPT" });
  unlinkSync(directory); renameSync(moved, directory);
});
