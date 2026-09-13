import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installManagedAudio } from "../dist/media/managed-audio.js";

const cancelled = error => error?.code === "MEDIA_CANCELLED";
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "openslate-managed-cancel-")), root = join(dir, "artifacts");
  await mkdir(root); const bytes = Buffer.alloc(256 * 1024, 73), path = join(dir, "owned.wav"); await writeFile(path, bytes);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { root, bytes, source: { path, sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, probe: { audio: { codec: "pcm_s16le", sampleRate: 48000, channels: 2 } } } };
}

test("managed installation retains the original cancellation signal and removes partial temporary files", async t => {
  const f = await fixture(t), controller = new AbortController(), options = { signal: controller.signal };
  const pending = installManagedAudio(f.root, "project", f.source, 1024 * 1024, options);
  options.signal = new AbortController().signal; controller.abort();
  await assert.rejects(pending, cancelled);
  const directory = join(f.root, "project");
  assert.deepEqual(existsSync(directory) ? await readdir(directory) : [], []);
  assert.deepEqual(await readFile(f.source.path), f.bytes);
});

test("cancellation after managed-file cleanup cannot report success; immutable output remains recoverable", async t => {
  const f = await fixture(t), directory = join(f.root, "project"), output = join(directory, `${f.source.sha256}.wav`);
  const controller = new AbortController(); let observedTemporary = false;
  // Inject cancellation at the cleanup boundary, after the immutable file is installed.
  const signal = { get aborted() {
    const names = existsSync(directory) ? readdirSync(directory) : [];
    if (names.some(name => name.startsWith(".media-"))) observedTemporary = true;
    if (observedTemporary && existsSync(output) && !names.some(name => name.startsWith(".media-"))) controller.abort();
    return controller.signal.aborted;
  } };
  await assert.rejects(installManagedAudio(f.root, "project", f.source, 1024 * 1024, { signal }), cancelled);
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(await readdir(directory), [`${f.source.sha256}.wav`]);
  assert.equal(await installManagedAudio(f.root, "project", f.source, 1024 * 1024), await realpath(output));
  assert.deepEqual(await readFile(output), f.bytes);
});
