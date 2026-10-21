import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createApp } from "../dist/app.js";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { ProductionService } from "../dist/application/service.js";
import { LocalDirectorController } from "../dist/application/local-director.js";
import { ImageApplicationService, LocalImageStore, PNG_IMPORT_MAX_BYTES } from "../dist/media/index.js";
import { ManagedUploadStore } from "../dist/narration/managed-upload.js";
import { FakeProvider } from "@openslate/providers";
import { newId } from "@openslate/core";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
let inputs, png, blue, jpeg;
// Generated with Pillow 9.5: a lossless 2x2 red WebP, requiring no WebP encoder on the host.
const webp = Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAUAAAAcQ/Y/+ByKi/wEA', 'base64');
const heic = Buffer.alloc(48); heic.writeUInt32BE(24); heic.write('ftypheic', 4); heic.write('heicmif1', 16); heic.writeUInt32BE(24, 24); heic.write('mdat', 28);
// Synthetic 16x16 red picture: FFmpeg libx265 (info=0), wrapped in the
// ISO-BMFF HEIF item/property boxes. Independently decoded by FFmpeg to PNG.
const validHeic = Buffer.from('AAAAGGZ0eXBoZWljAAAAAGhlaWNtaWYxAAABOm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABWgAAABQAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAL5pcHJwAAAAoGlwY28AAAB0aHZjQwEBYAAAAJAAAAAAAB7wAPz9+PgAAA8DoAABABhAAQwB//8BYAAAAwCQAAADAAADAB6VmAmhAAEAKEIBAQFgAAADAJAAAAMAAAMAHqCIRZZWaryvAWgIAAADAAgAAAMAyECiAAEABkQBwXPQiQAAABRpc3BlAAAAAAAAABAAAAAQAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBggMAAAAcbWRhdAAAABAoAa8dgPAOCP+JeffqFlh4', 'base64');
before(async () => {
  inputs = await mkdtemp(join(tmpdir(), "openslate-image-http-input-"));
  for (const color of ["red", "blue"]) await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x180`, "-frames:v", "1", "-threads", "1", join(inputs, `${color}.png`)], { timeout: 15000 });
  png = await readFile(join(inputs, "red.png")); blue = await readFile(join(inputs, "blue.png"));
  await promisify(execFile)(ffmpegPath, ['-nostdin', '-v', 'error', '-i', join(inputs, 'red.png'), '-frames:v', '1', '-threads', '1', join(inputs, 'reference.jpg')], { timeout: 15000 });
  jpeg = await readFile(join(inputs, 'reference.jpg'));
});
after(async () => rm(inputs, { recursive: true, force: true }));
async function writable(path) {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(join(path, entry.name));
}
async function fixture(t, { maxBytes = PNG_IMPORT_MAX_BYTES, available = true, withDirector = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "openslate-image-http-")), store = new Store(join(dir, "db.sqlite")), provider = new FakeProvider(join(dir, "fake.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(dir, "artifacts") }), production = new ProductionService(store, engine);
  const project = production.createProject("HTTP reference images"), uploads = new ManagedUploadStore({ rootDir: join(dir, "uploads"), maxBytes });
  const local = new LocalImageStore({ rootDir: join(engine.artifactDir, "images"), ffmpegPath, ffprobePath }), images = new ImageApplicationService(production, local);
  const director = withDirector ? new LocalDirectorController(production, {
    repositoryRoot: fileURLToPath(new URL("../../../", import.meta.url)), dataDirectory: dir, endpoint: "http://127.0.0.1:3101", ffmpegPath,
    defaults: { binaryPath: process.execPath, model: "test-model" }, setup: async () => { throw new Error("Image HTTP tests must keep the scripted Director"); },
  }) : undefined;
  const token = "test-local-token-with-enough-characters", app = createApp({ service: production, localToken: token, ...(director ? { director, runtimeSettings: director } : {}), imageRoutes: { production, images: available ? images : null, uploads } });
  const path = `/api/projects/${project.id}/images`, head = () => store.getProject(project.id);
  const request = (method, url, payload, key = newId(), extra = {}) => app.inject({ method, url, ...(payload !== undefined ? { payload } : {}), headers: { host: "127.0.0.1", authorization: `Bearer ${token}`, "idempotency-key": key, ...extra } });
  const upload = (key = newId(), requestId, payload = png, version = head().headVersion, name) => request("POST", `${path}/uploads?expectedHeadVersion=${version}${requestId ? `&requestId=${requestId}` : ""}${name === undefined ? "" : `&name=${encodeURIComponent(name)}`}`, payload, key, { "content-type": "application/octet-stream" });
  t.after(async () => { await director?.close(); await app.close(); store.close(); provider.close(); if (director) await writable(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, store, provider, engine, production, project, uploads, local, images, director, app, path, request, upload, head };
}

test("named PNG and JPEG imports retain their file names in Assets and Director messages", async t => {
  const f = await fixture(t, { withDirector: true }), imported = [];
  for (const [name, payload] of [["渡口 reference.PNG", png], ["人物 portrait.jpeg", jpeg]]) {
    const response = await f.upload(newId(), undefined, payload, f.head().headVersion, name); assert.equal(response.statusCode, 200, response.body);
    imported.push({ artifact: response.json().artifact, name });
  }
  const assets = await f.request("GET", `/api/projects/${f.project.id}/assets`); assert.equal(assets.statusCode, 200, assets.body);
  for (const item of imported) assert.equal(assets.json().assets.find(asset => asset.artifact.artifactId === item.artifact.artifactId)?.label, item.name);
  const message = await f.request("POST", `/api/projects/${f.project.id}/messages`, { text: "Discuss these references.", editing: false, attachments: imported.map(({ artifact }) => ({ artifactId: artifact.artifactId, sha256: artifact.sha256 })) });
  assert.equal(message.statusCode, 200, message.body); await f.director.settle();
  const snapshot = await f.request("GET", `/api/projects/${f.project.id}`); assert.equal(snapshot.statusCode, 200, snapshot.body);
  const user = snapshot.json().conversation.find(item => item.role === "user" && item.requestId === message.json().requestId);
  assert.deepEqual(user.attachments, imported.map(item => ({ ...item, readable: true })));
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.store.list("native_model_start", f.project.id).length, 0);
});

test("unnamed images retain the original Assets and message attachment labels", async t => {
  const f = await fixture(t, { withDirector: true }), upload = await f.upload(); assert.equal(upload.statusCode, 200, upload.body);
  const artifact = upload.json().artifact, assets = await f.request("GET", `/api/projects/${f.project.id}/assets`);
  assert.equal(assets.statusCode, 200, assets.body); assert.equal(assets.json().assets[0].label, `${f.project.name} · upload`);
  const message = await f.request("POST", `/api/projects/${f.project.id}/messages`, { editing: false, attachments: [{ artifactId: artifact.artifactId, sha256: artifact.sha256 }] });
  assert.equal(message.statusCode, 200, message.body); await f.director.settle();
  const snapshot = await f.request("GET", `/api/projects/${f.project.id}`); assert.equal(snapshot.statusCode, 200, snapshot.body);
  assert.deepEqual(snapshot.json().conversation.find(item => item.role === "user" && item.requestId === message.json().requestId).attachments, [{ artifact, name: `image ${artifact.artifactId}`, readable: true }]);
  assert.equal(f.provider.acceptedCount(), 0);
});

test("image upload names accept both length boundaries and reject empty, long, control and path names before staging", async t => {
  const f = await fixture(t);
  for (const name of ["", "x".repeat(121), "a\u0000b.png", "a\tb.png", "a\nb.png", "a\u007fb.png", "folder/image.png", "folder\\image.png"]) {
    const response = await f.upload(newId(), undefined, png, 0, name);
    assert.equal(response.statusCode, 400, response.body); assert.equal(response.json().error.code, "VALIDATION_ERROR");
  }
  for (const kind of ["message", "image_import", "artifact"]) assert.equal(f.store.list(kind, f.project.id).length, 0);
  assert.deepEqual(await readdir(f.uploads.rootDir), []);
  for (const name of ["x", "x".repeat(120)]) {
    const response = await f.upload(newId(), undefined, png, f.head().headVersion, name); assert.equal(response.statusCode, 200, response.body);
  }
  assert.equal(f.head().artifacts.length, 2); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

for (const explicit of [false, true]) test(`image upload name binds ${explicit ? "explicit" : "automatic"} request replay without duplicating an import`, async t => {
  const f = await fixture(t), actor = explicit ? f.production.beginRequest(f.project.id, "local-user", "Import reference pictures") : undefined;
  const first = await f.upload("named-once", actor?.requestId, png, 0, "reference.png"); assert.equal(first.statusCode, 200, first.body);
  f.local.normalizeUpload = () => { throw new Error("A completed upload replay must not decode again"); };
  const replay = await f.upload("named-once", actor?.requestId, png, 0, "reference.png"); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), first.json());
  for (const name of ["renamed.png", undefined]) {
    const changed = await f.upload("named-once", actor?.requestId, png, 0, name);
    assert.equal(changed.statusCode, 409, changed.body); assert.equal(changed.json().error.code, "IDEMPOTENCY_CONFLICT");
  }
  for (const kind of ["message", "image_import", "image_import_receipt", "artifact"]) assert.equal(f.store.list(kind, f.project.id).length, 1);
  assert.equal(f.head().artifacts.length, 1); assert.deepEqual(await readdir(f.uploads.rootDir), []); assert.equal(f.provider.acceptedCount(), 0);
});

test("authenticated upload preserves PNG content and returns a path-free library without creating read requests", async t => {
  const f = await fixture(t), first = await f.upload("first"); assert.equal(first.statusCode, 200, first.body);
  const result = first.json(), count = f.store.list("message", f.project.id).length, list = await f.request("GET", f.path);
  assert.equal(list.statusCode, 200, list.body); assert.equal(list.json().capabilities.import, true); assert.equal(list.json().capabilities.maxBytes, 32 * 1024 * 1024);
  assert.deepEqual(list.json().images[0], { artifact: result.artifact, mimeType: "image/png", width: 320, height: 180, byteLength: png.length, fixture: false, origin: "supplied_image" });
  assert.equal(list.body.includes(f.dir), false); assert.equal(f.store.list("message", f.project.id).length, count);
  const content = await f.request("GET", `/api/projects/${f.project.id}/artifacts/${result.artifact.artifactId}/content`);
  assert.equal(content.statusCode, 200, content.body); assert.equal(content.headers["content-type"], "image/png"); assert.deepEqual(content.rawPayload, png);
  const foreign = f.production.createProject("Other owner");
  assert.equal((await f.request("GET", `/api/projects/${foreign.id}/artifacts/${result.artifact.artifactId}/content`)).statusCode, 404);
  assert.deepEqual(await readdir(f.uploads.rootDir), []);
  for (const family of ["approval", "grant", "attempt"]) assert.equal(f.store.list(family, f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test('JPEG and WebP uploads become owned PNG references and replay their original upload identity', async t => {
  const f = await fixture(t);
  for (const [name, bytes, width, height] of [['JPEG', jpeg, 320, 180], ['WebP', webp, 2, 2]]) {
    const version = f.head().headVersion, response = await f.upload(name, undefined, bytes, version);
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json(), record = f.store.get('artifact', result.artifact.artifactId);
    assert.equal(record.mimeType, 'image/png'); assert.equal(result.width, width); assert.equal(result.height, height);
    assert.deepEqual((await readFile(record.path)).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const replay = await f.upload(name, undefined, bytes, version); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), result);
  }
  assert.equal(f.head().artifacts.length, 2); assert.deepEqual(await readdir(f.uploads.rootDir), []);
  const list = await f.request('GET', f.path); assert.deepEqual(list.json().capabilities.acceptedFormats, ['image/png', 'image/jpeg', 'image/webp', 'image/heic']);
});

test('an undecodable generated HEIC container gives IMAGE_FORMAT_UNSUPPORTED and publishes nothing', async t => {
  const f = await fixture(t), response = await f.upload('heic', undefined, heic);
  assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'IMAGE_FORMAT_UNSUPPORTED');
  assert.match(response.json().error.message, /HEIC.*PNG, JPEG or WebP/);
  assert.equal(f.head().artifacts.length, 0); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test('a valid generated HEIC picture normalizes to PNG or clearly reports an unavailable decoder', async t => {
  const f = await fixture(t), response = await f.upload('valid-heic', undefined, validHeic);
  if (response.statusCode === 200) {
    t.diagnostic('Installed FFmpeg decoded the valid HEIC fixture and published PNG');
    const result = response.json(), record = f.store.get('artifact', result.artifact.artifactId);
    assert.equal(result.width, 16); assert.equal(result.height, 16); assert.equal(record.mimeType, 'image/png');
    assert.deepEqual((await readFile(record.path)).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  } else {
    t.diagnostic('Installed FFmpeg does not decode the valid HEIC fixture; the explicit unsupported code was returned');
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'IMAGE_FORMAT_UNSUPPORTED', response.body); assert.equal(f.head().artifacts.length, 0);
  }
  assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test("local token, Host and Origin are enforced before messages or staging, with no path or actor overrides", async t => {
  const f = await fixture(t);
  for (const extra of [{ authorization: "" }, { authorization: "Bearer a-director-token" }, { host: "evil.invalid" }, { origin: "https://evil.invalid" }]) {
    const response = await f.request("POST", `${f.path}/uploads?expectedHeadVersion=0`, png, newId(), { "content-type": "application/octet-stream", ...extra });
    assert.equal(response.statusCode, 403, response.body);
  }
  for (const query of ["&path=/tmp/private", "&principalId=other", "&epochId=example"])
    assert.equal((await f.request("POST", `${f.path}/uploads?expectedHeadVersion=0${query}`, png, newId(), { "content-type": "application/octet-stream" })).statusCode, 400);
  assert.equal(f.store.list("message", f.project.id).length, 0); assert.equal(f.store.list("image_import", f.project.id).length, 0); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test("exact retry reuses its request and receipt; changed bytes under the same key are rejected", async t => {
  const f = await fixture(t), first = await f.upload("once", undefined, png, 0); assert.equal(first.statusCode, 200, first.body);
  f.local.ingest = () => { throw new Error("replay must not decode"); };
  const retry = await f.upload("once", undefined, png, 0); assert.equal(retry.statusCode, 200, retry.body); assert.deepEqual(retry.json(), first.json());
  const changed = await f.upload("once", undefined, blue, 0); assert.equal(changed.statusCode, 409, changed.body); assert.equal(changed.json().error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(f.store.list("message", f.project.id).length, 1); assert.equal(f.store.list("image_import", f.project.id).length, 1); assert.equal(f.head().artifacts.length, 1);
  assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test("batch uploads share an explicit request; continuation transfers its hold and fences the old request", async t => {
  const f = await fixture(t), first = await f.upload("one"); assert.equal(first.statusCode, 200, first.body);
  const requestId = first.json().requestId, second = await f.upload("two", requestId); assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().requestId, requestId); assert.equal(f.store.list("hold", f.project.id).filter(h => h.active).length, 1);
  const continued = await f.request("POST", `${f.path}/uploads?expectedHeadVersion=2&continuationRequestId=${requestId}`, blue, "continued", { "content-type": "application/octet-stream" });
  assert.equal(continued.statusCode, 200, continued.body); assert.notEqual(continued.json().requestId, requestId);
  assert.equal(f.store.list("hold", f.project.id).filter(h => h.active).length, 1); assert.equal(f.store.list("hold", f.project.id).find(h => h.ownerId === requestId).active, false);
  const stale = await f.upload("old", requestId); assert.equal(stale.statusCode, 403, stale.body); assert.equal(stale.json().error.code, "ACTOR_DENIED");
  assert.equal(f.head().artifacts.length, 3); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test("missing tools report an unavailable import capability without creating a request or staging files", async t => {
  const f = await fixture(t, { available: false }), list = await f.request("GET", f.path);
  assert.equal(list.statusCode, 200); assert.equal(list.json().capabilities.import, false); assert.match(list.json().capabilities.unavailableReason, /FFmpeg and ffprobe/);
  const response = await f.upload(); assert.equal(response.statusCode, 503, response.body); assert.equal(response.json().error.code, "SERVICE_UNAVAILABLE");
  assert.equal(f.store.list("message", f.project.id).length, 0); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test("oversize, empty and invalid PNG uploads leave no artifact or staging bytes", async t => {
  const f = await fixture(t, { maxBytes: 100 }), large = await f.upload("large");
  assert.equal(large.statusCode, 409, large.body); assert.equal(large.json().error.code, "UPLOAD_TOO_LARGE"); assert.match(large.json().error.message, /100 byte/);
  const empty = await f.upload("empty", large.json().requestId, Buffer.alloc(0)); assert.equal(empty.statusCode, 400, empty.body);
  const truncated = await f.upload("truncated", large.json().requestId, png.subarray(0, 40)); assert.equal(truncated.statusCode, 409, truncated.body);
  assert.equal(f.head().artifacts.length, 0); assert.equal(f.store.list("artifact", f.project.id).length, 0); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test("superseding a request during decoder work prevents publication through HTTP", async t => {
  const f = await fixture(t), ingest = f.local.ingest.bind(f.local);
  f.local.ingest = async (...args) => { const result = await ingest(...args); f.production.beginRequest(f.project.id, "local-user", "A newer edit"); return result; };
  const response = await f.upload(); assert.equal(response.statusCode, 403, response.body); assert.equal(response.json().error.code, "ACTOR_DENIED");
  assert.equal(f.head().headVersion, 0); assert.equal(f.head().artifacts.length, 0); assert.equal(f.store.list("image_import_receipt", f.project.id).length, 0); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test("reference pagination has explicit coverage and excludes unregistered or foreign assets", async t => {
  const f = await fixture(t), response = await f.upload(); assert.equal(response.statusCode, 200, response.body);
  const original = f.store.get("artifact", response.json().artifact.artifactId), head = f.head(), artifacts = [...head.artifacts];
  for (let i = 0; i < 41; i++) {
    const id = newId(), artifact = { ...original.artifact, artifactId: id };
    f.store.insert("artifact", id, f.project.id, { ...original, id, artifact });
    if (i < 40) artifacts.push(artifact);
  }
  f.store.saveProject({ ...head, revisionId: newId(), artifacts }, head.headVersion);
  const first = await f.request("GET", f.path), second = await f.request("GET", `${f.path}?offset=40`);
  assert.deepEqual(first.json().coverage, { offset: 0, returned: 40, total: 41, nextOffset: 40 });
  assert.deepEqual(second.json().coverage, { offset: 40, returned: 1, total: 41, nextOffset: null });
  assert.equal(new Set([...first.json().images, ...second.json().images].map(i => i.artifact.artifactId)).size, 41);
  assert.equal((await f.request("GET", `${f.path}?offset=-1`)).statusCode, 400);
  const other = f.production.createProject("Other image library");
  assert.equal((await f.request("GET", `/api/projects/${other.id}/images`)).json().coverage.total, 0);
});
