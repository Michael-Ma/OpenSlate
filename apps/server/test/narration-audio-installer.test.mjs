import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { digest } from "../../../packages/core/dist/index.js";
import { installNarrationAudio } from "../dist/narration/verified-audio.js";

const cancelled = { code: "NARRATION_ARTIFACT_CANCELLED" };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function latch() { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; }
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "openslate-audio-installer-"))), artifactRoot = join(root, "artifacts");
  await fs.mkdir(artifactRoot); const sourcePath = join(root, "source.wav"), samples = 48000, bytes = Buffer.alloc(44 + samples * 4);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(192000, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(samples * 4, 40);
  for (let i = 44; i < bytes.length; i += 2) bytes.writeInt16LE((i % 8192) - 4096, i);
  await fs.writeFile(sourcePath, bytes);
  const fields = { artifactId: randomUUID(), kind: "audio", originalSha256: hash(bytes), originalByteLength: bytes.length,
    sha256: hash(bytes), byteLength: bytes.length, toolchainDigest: "a".repeat(64),
    probe: { durationSeconds: 1, audio: { streamIndex: 0, sampleRate: 48000, channels: 2, samples, durationSeconds: 1, codec: "pcm_s16le" } } };
  const source = { id: digest(fields), ...fields }, projectId = randomUUID(), seen = [];
  const media = { limits: { maxOutputBytes: 256 * 1024 ** 2 }, async verifiedSource(value, options) {
    seen.push(options?.signal); assert.deepEqual(value, source); return { path: sourcePath, source: structuredClone(value) };
  } };
  const path = join(artifactRoot, projectId, `${source.sha256}.wav`), directory = join(artifactRoot, projectId);
  const install = options => installNarrationAudio(media, artifactRoot, projectId, source, options);
  t.after(async () => { t.mock.restoreAll(); syncBuiltinESMExports(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, artifactRoot, sourcePath, directory, path, source, projectId, bytes, media, seen, install };
}
function patch(t, name, callback) { const original = fs[name]; t.mock.method(fs, name, (...args) => callback(original, ...args)); syncBuiltinESMExports(); }
async function noTemporary(f) { assert.equal((await fs.readdir(f.directory).catch(() => [])).some(name => name.startsWith(".narration-")), false); }

test("omitted options preserve the exact canonical artifact identity, bytes, path and immutable replay", async t => {
  const f = await fixture(t), saved = await f.install();
  assert.deepEqual(saved, { id: f.source.artifactId, projectId: f.projectId,
    artifact: { artifactId: f.source.artifactId, sha256: f.source.sha256, kind: "audio" }, path: f.path,
    mimeType: "audio/wav", fixture: false, attemptId: null, origin: "narration_audio", byteLength: f.bytes.length,
    physicalDurationSeconds: 1, sourceDescriptorId: f.source.id });
  assert.deepEqual(await fs.readFile(saved.path), f.bytes); const stat = await fs.stat(saved.path);
  assert.equal(stat.mode & 0o777, 0o444); assert.deepEqual(await f.install(), saved); assert.equal((await fs.stat(saved.path)).ino, stat.ino);
  assert.deepEqual(f.seen, [undefined, undefined]); await noTemporary(f);
});

test("pre-cancelled installation performs no source verification or directory publication", async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(f.install({ signal: controller.signal }), cancelled); assert.equal(f.seen.length, 0);
  assert.deepEqual(await fs.readdir(f.artifactRoot), []);
});

test("caller source and options are captured before verifiedSource awaits", async t => {
  const f = await fixture(t), original = structuredClone(f.source), entered = latch(), release = latch(), controller = new AbortController();
  const options = { signal: controller.signal };
  f.media.verifiedSource = async (value, received) => { assert.equal(received.signal, controller.signal); entered.release(); await release.promise; return { source: value, path: f.sourcePath }; };
  const running = f.install(options);
  try {
    await entered.promise; f.source.sha256 = "b".repeat(64); f.source.probe.audio.samples = 3;
    options.signal = new AbortController().signal; release.release(); const saved = await running;
    assert.equal(saved.artifact.sha256, original.sha256); assert.equal(saved.physicalDurationSeconds, 1); assert.equal(saved.path, f.path);
  } finally { release.release(); await running.catch(() => {}); }
});

test("original cancellation during source verification wins over replacement options and cleanup errors", async t => {
  const f = await fixture(t), entered = latch(), release = latch(), controller = new AbortController(), options = { signal: controller.signal };
  f.media.verifiedSource = async (_value, received) => { assert.equal(received.signal, controller.signal); entered.release(); await release.promise; throw Error("late source read error"); };
  const running = f.install(options);
  try { await entered.promise; options.signal = new AbortController().signal; controller.abort(); release.release(); await assert.rejects(running, cancelled); }
  finally { release.release(); await running.catch(() => {}); }
  assert.deepEqual(await fs.readdir(f.artifactRoot), []);
});

test("verified result source and path cannot change while later storage IO is suspended", async t => {
  const f = await fixture(t), verified = { source: structuredClone(f.source), path: f.sourcePath };
  f.media.verifiedSource = async () => verified;
  patch(t, "realpath", async (original, path, ...args) => { const result = await original(path, ...args);
    if (path === f.artifactRoot) { verified.path = join(f.root, "missing.wav"); verified.source.sha256 = "f".repeat(64); } return result; });
  const saved = await f.install(); assert.equal(saved.path, f.path); assert.deepEqual(await fs.readFile(f.path), f.bytes);
});

for (const stage of ["source_open", "source_read", "temporary_write", "temporary_sync", "temporary_close", "link", "installed_read", "directory_sync", "input_close", "temporary_cleanup"])
test(`original cancellation after ${stage} rejects and cleans the owned temporary file`, async t => {
  const f = await fixture(t), controller = new AbortController(), opened = new Set(); let triggered = false;
  const abort = () => { triggered = true; controller.abort(); };
  patch(t, "open", async (original, path, ...args) => {
    const file = await original(path, ...args); opened.add(file); const close = file.close.bind(file);
    file.close = async (...values) => { try { const result = await close(...values);
      if (stage === "temporary_close" && String(path).includes(".narration-") || stage === "input_close" && path === f.sourcePath) abort(); return result;
    } finally { opened.delete(file); } };
    if (stage === "source_open" && path === f.sourcePath) abort();
    for (const [method, matches] of [["read", stage === "source_read" && path === f.sourcePath || stage === "installed_read" && path === f.path],
      ["writeFile", stage === "temporary_write" && String(path).includes(".narration-")],
      ["sync", stage === "temporary_sync" && String(path).includes(".narration-") || stage === "directory_sync" && path === f.directory]]) {
      if (matches) { const action = file[method].bind(file); file[method] = async (...values) => { const result = await action(...values); abort(); return result; }; }
    }
    return file;
  });
  if (stage === "link") patch(t, "link", async (original, ...args) => { const result = await original(...args); abort(); return result; });
  if (stage === "temporary_cleanup") patch(t, "unlink", async (original, path, ...args) => { const result = await original(path, ...args);
    if (String(path).includes(".narration-")) abort(); return result; });
  await assert.rejects(f.install({ signal: controller.signal }), cancelled);
  assert.equal(triggered, true); assert.equal(opened.size, 0); await noTemporary(f);
  t.mock.restoreAll(); syncBuiltinESMExports();
  const saved = await f.install(); assert.deepEqual(await fs.readFile(saved.path), f.bytes); await noTemporary(f);
});

test("cancellation during final awaited close overrides its error and still removes temporary bytes", async t => {
  const f = await fixture(t), controller = new AbortController(), entered = latch(), release = latch();
  patch(t, "open", async (original, path, ...args) => { const file = await original(path, ...args);
    if (path === f.sourcePath) { const close = file.close.bind(file); file.close = async () => { entered.release(); await release.promise; await close(); throw Error("late close error"); }; }
    return file;
  });
  const running = f.install({ signal: controller.signal });
  try { await entered.promise; controller.abort(); release.release(); await assert.rejects(running, cancelled); }
  finally { release.release(); await running.catch(() => {}); }
  await noTemporary(f); assert.deepEqual(await fs.readFile(f.path), f.bytes);
});
