import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { inspectPcmWave } from "../dist/media/pcm-wave.js";
import { wave } from "./speech-execution-fixture.mjs";
const streaming = () => {
  const bytes = wave(97200);
  bytes.writeUInt32LE(0xffffffff, 4);
  bytes.writeUInt32LE(0xffffffff, 40);
  return bytes;
};
function file(t, bytes) {
  const dir = mkdtempSync(join(tmpdir(), "openslate-streaming-wav-"));
  const path = join(dir, "audio.wav");
  writeFileSync(path, bytes);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path;
}

test("completed owned streaming PCM preserves original bytes and measures the exact EOF endpoint; generic reads stay strict", async (t) => {
  const bytes = streaming(),
    path = file(t, bytes);
  await assert.rejects(inspectPcmWave(path, 32 * 1024 * 1024), {
    code: "AUDIO_PCM_INVALID",
  });
  const result = await inspectPcmWave(path, 32 * 1024 * 1024, undefined, {
    completedStreamBytes: bytes.length,
  });
  assert.deepEqual(result.pcm, {
    sampleRate: 24000,
    channels: 1,
    sampleCount: 97200,
    bitsPerSample: 16,
  });
  assert.equal(result.byteLength, 194444);
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(readFileSync(path), bytes);
});

test("completed-stream opt-in cannot excuse mismatched extent, mixed sentinels, unsupported encoding or truncated PCM", async (t) => {
  const original = streaming();
  const wrongRiff = Buffer.from(original);
  wrongRiff.writeUInt32LE(wrongRiff.length - 8, 4);
  const wrongData = Buffer.from(original);
  wrongData.writeUInt32LE(wrongData.length - 44, 40);
  const compressed = Buffer.from(original);
  compressed.writeUInt16LE(3, 20);
  const misaligned = Buffer.from(original.subarray(0, original.length - 1));
  const truncated = Buffer.from(original.subarray(0, original.length - 2));
  for (const [bytes, expected] of [
    [original, original.length + 2],
    [wrongRiff, wrongRiff.length],
    [wrongData, wrongData.length],
    [compressed, compressed.length],
    [misaligned, misaligned.length],
    [truncated, original.length],
  ]) {
    const path = file(t, bytes);
    await assert.rejects(
      inspectPcmWave(path, 32 * 1024 * 1024, undefined, {
        completedStreamBytes: expected,
      }),
      (e) => e.code?.startsWith("AUDIO_PCM_"),
    );
  }
});
