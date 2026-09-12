import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile, symlink, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { CodexDirectorRuntime, DIRECTOR_IMAGE_LIMITS } from "../dist/index.js";
import { prepareDirectorImages } from "../dist/runtime/images.js";
import { PROTOCOL_FIXTURE_LIMITS } from "./fixture-timing.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/mgAAAAASUVORK5CYII=", "base64");
async function fixture(t, scenario = "complete") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openslate-images-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "image.png"); await writeFile(path, png);
  const image = { path, sha256: hash(png), mediaType: "image/png" };
  const input = { projectId: "project", requestId: "request", epochId: "epoch", turnId: "turn", text: "Describe the attached image", context: "{}", skills: [], images: [image],
    bridge: { projectId: "project", endpoint: "http://127.0.0.1:12345", credential: "fixed-opaque-fixture-credential", entrypoint: join(root, "bridge.mjs") } };
  const log = join(root, "protocol.jsonl");
  const runtime = new CodexDirectorRuntime({ command: { file: process.execPath, args: [fileURLToPath(new URL("runtime-fixture.mjs", import.meta.url))] },
    cwd: root, model: "fake-model", env: { FIXTURE_SCENARIO: scenario, FIXTURE_LOG: log }, runtimeVersion: "0.153.4",
    policy: { mode: "local", id: "fixture", runtimeVersion: "0.153.4", config: { default_permissions: "fixture", permissions: { fixture: { filesystem: { "/": "none" }, network: { enabled: false } } } } },
    limits: { ...PROTOCOL_FIXTURE_LIMITS } });
  return { root, path, image, input, runtime, log };
}
test("verified thumbnail bytes are frozen into native image inputs", async t => {
  const f = await fixture(t);
  const prepared = await prepareDirectorImages([f.image], f.root);
  await writeFile(f.path, "changed after preparation");
  assert.deepEqual(prepared, [{ type: "image", url: `data:image/png;base64,${png.toString("base64")}` }]);
  await writeFile(f.path, png);
  const result = await f.runtime.start(f.input); assert.equal(result.status, "completed", result.error?.code);
  const requests = (await readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  const started = requests.find(row => row.method === "turn/start");
  assert.deepEqual(started.params.input, [{ type: "text", text: f.input.text }, ...prepared]);
  assert.ok(!JSON.stringify(started.params).includes(f.path));
});
test("image paths outside the projection, aliases, and non-files are rejected", async t => {
  const f = await fixture(t), sub = join(f.root, "sub"); await mkdir(sub);
  await assert.rejects(prepareDirectorImages([f.image], sub), error => error.code === "RUNTIME_IMAGE_SCOPE");
  const alias = join(f.root, "alias.png"); await symlink(f.path, alias);
  await assert.rejects(prepareDirectorImages([{ ...f.image, path: alias }], f.root), error => error.code === "RUNTIME_IMAGE_SCOPE");
  await assert.rejects(prepareDirectorImages([{ ...f.image, path: sub }], f.root), error => error.code === "RUNTIME_IMAGE_LIMIT");
});
test("modified hashes, disguised formats and oversized header dimensions fail before native launch", async t => {
  const f = await fixture(t);
  const changed = await f.runtime.start({ ...f.input, images: [{ ...f.image, sha256: "0".repeat(64) }] });
  assert.equal(changed.error.code, "RUNTIME_IMAGE_CHANGED"); assert.equal(changed.dispatched, false);
  await assert.rejects(readFile(f.log), error => error.code === "ENOENT");
  await writeFile(f.path, "GIF89a fake image");
  await assert.rejects(prepareDirectorImages([{ ...f.image, sha256: hash("GIF89a fake image") }], f.root), error => error.code === "RUNTIME_IMAGE_CHANGED");
  const tooWide = Buffer.from(png); tooWide.writeUInt32BE(50_000, 16); await writeFile(f.path, tooWide);
  await assert.rejects(prepareDirectorImages([{ ...f.image, sha256: hash(tooWide) }], f.root), error => error.code === "RUNTIME_IMAGE_LIMIT");
});
test("image count, combined byte size and extra reference fields are bounded", async t => {
  const f = await fixture(t);
  await assert.rejects(prepareDirectorImages(Array.from({ length: 5 }, () => f.image), f.root), error => error.code === "RUNTIME_IMAGES_INVALID");
  await assert.rejects(prepareDirectorImages([{ ...f.image, projectId: "forged" }], f.root), error => error.code === "RUNTIME_IMAGES_INVALID");
  const bytes = Buffer.concat([png, Buffer.alloc(DIRECTOR_IMAGE_LIMITS.totalBytes / 2)]), refs = [];
  for (let i = 0; i < 2; i++) { const path = join(f.root, `large-${i}.png`); await writeFile(path, bytes); refs.push({ path, sha256: hash(bytes), mediaType: "image/png" }); }
  await assert.rejects(prepareDirectorImages(refs, f.root), error => error.code === "RUNTIME_IMAGE_LIMIT");
});
test("JPEG and all supported WebP header forms apply dimension limits", async t => {
  const f = await fixture(t);
  // Minimal structural headers exercise this admission parser, not a full image decoder.
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 2, 0, 3, 1, 1, 17, 0, 255, 217]);
  const webp = type => { const bytes = Buffer.alloc(30); bytes.write("RIFF", 0); bytes.writeUInt32LE(22, 4); bytes.write("WEBP", 8); bytes.write(type, 12); return bytes; };
  const extended = webp("VP8X"); extended.writeUIntLE(2, 24, 3); extended.writeUIntLE(1, 27, 3);
  const lossless = webp("VP8L"); lossless[20] = 47; lossless.writeUInt32LE(2 | (1 << 14), 21);
  const lossy = webp("VP8 "); lossy.set([157, 1, 42], 23); lossy.writeUInt16LE(3, 26); lossy.writeUInt16LE(2, 28);
  for (const [bytes, mediaType, enlarge] of [
    [jpeg, "image/jpeg", value => value.writeUInt16BE(4097, 9)],
    [extended, "image/webp", value => value.writeUIntLE(4096, 24, 3)],
    [lossless, "image/webp", value => value.writeUInt32LE(4096 | (1 << 14), 21)],
    [lossy, "image/webp", value => value.writeUInt16LE(4097, 26)],
  ]) {
    await writeFile(f.path, bytes);
    const ref = { ...f.image, sha256: hash(bytes), mediaType };
    assert.equal((await prepareDirectorImages([ref], f.root))[0].url, `data:${mediaType};base64,${bytes.toString("base64")}`);
    enlarge(bytes); await writeFile(f.path, bytes);
    await assert.rejects(prepareDirectorImages([{ ...ref, sha256: hash(bytes) }], f.root), error => error.code === "RUNTIME_IMAGE_LIMIT");
  }
});
test("pinned structured-question feature must be enabled before a model dispatch", async t => {
  const f = await fixture(t, "question-feature-wrong"), result = await f.runtime.start(f.input);
  assert.equal(result.error.code, "RUNTIME_CONFIG_MISMATCH"); assert.equal(result.dispatched, false);
  const rows = (await readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(!rows.some(row => row.method === "turn/start"));
});
