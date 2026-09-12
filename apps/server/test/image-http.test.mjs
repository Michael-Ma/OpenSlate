import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../dist/app.js";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { ProductionService } from "../dist/application/service.js";
import { ImageApplicationService, LocalImageStore, PNG_IMPORT_MAX_BYTES } from "../dist/media/index.js";
import { ManagedUploadStore } from "../dist/narration/managed-upload.js";
import { FakeProvider } from "@openslate/providers";
import { newId } from "@openslate/core";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
let inputs, png, blue;
before(async () => {
  inputs = await mkdtemp(join(tmpdir(), "openslate-image-http-input-"));
  for (const color of ["red", "blue"]) await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x180`, "-frames:v", "1", "-threads", "1", join(inputs, `${color}.png`)], { timeout: 15000 });
  png = await readFile(join(inputs, "red.png")); blue = await readFile(join(inputs, "blue.png"));
});
after(async () => rm(inputs, { recursive: true, force: true }));
async function fixture(t, { maxBytes = PNG_IMPORT_MAX_BYTES, available = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "openslate-image-http-")), store = new Store(join(dir, "db.sqlite")), provider = new FakeProvider(join(dir, "fake.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(dir, "artifacts") }), production = new ProductionService(store, engine);
  const project = production.createProject("HTTP reference images"), uploads = new ManagedUploadStore({ rootDir: join(dir, "uploads"), maxBytes });
  const local = new LocalImageStore({ rootDir: join(engine.artifactDir, "images"), ffmpegPath, ffprobePath }), images = new ImageApplicationService(production, local);
  const token = "test-local-token-with-enough-characters", app = createApp({ service: production, localToken: token, imageRoutes: { production, images: available ? images : null, uploads } });
  const path = `/api/projects/${project.id}/images`, head = () => store.getProject(project.id);
  const request = (method, url, payload, key = newId(), extra = {}) => app.inject({ method, url, ...(payload !== undefined ? { payload } : {}), headers: { host: "127.0.0.1", authorization: `Bearer ${token}`, "idempotency-key": key, ...extra } });
  const upload = (key = newId(), requestId, payload = png, version = head().headVersion) => request("POST", `${path}/uploads?expectedHeadVersion=${version}${requestId ? `&requestId=${requestId}` : ""}`, payload, key, { "content-type": "application/octet-stream" });
  t.after(async () => { await app.close(); store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, store, provider, engine, production, project, uploads, local, images, app, path, request, upload, head };
}

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
