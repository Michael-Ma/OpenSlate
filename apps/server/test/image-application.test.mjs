import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { ProductionService } from "../dist/application/service.js";
import { ImageApplicationService, LocalImageStore } from "../dist/media/index.js";
import { FakeProvider } from "@openslate/providers";
import { compilePlan, DEFAULT_PROFILES, newId } from "@openslate/core";
import { projectFixture, refreshIntent } from "./execution-fixture.mjs";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const sha = bytes => createHash("sha256").update(bytes).digest("hex"), code = expected => error => error?.code === expected;
let inputs, png, blue;
before(async () => {
  inputs = await mkdtemp(join(tmpdir(), "openslate-image-app-input-"));
  for (const color of ["red", "blue"]) await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x180`, "-frames:v", "1", "-threads", "1", join(inputs, `${color}.png`)], { timeout: 15000 });
  png = await readFile(join(inputs, "red.png")); blue = await readFile(join(inputs, "blue.png"));
});
after(async () => rm(inputs, { recursive: true, force: true }));
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "openslate-image-app-")), store = new Store(join(dir, "db.sqlite")), provider = new FakeProvider(join(dir, "fake.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(dir, "artifacts") }), production = new ProductionService(store, engine);
  const project = production.createProject("Reference images"), human = production.beginRequest(project.id, "human", "Import my reference");
  const options = { rootDir: join(engine.artifactDir, "images"), ffmpegPath, ffprobePath }, images = new LocalImageStore(options), app = new ImageApplicationService(production, images);
  const head = () => store.getProject(project.id), input = (key = newId(), bytes = png) => ({ expectedHeadVersion: head().headVersion, key, bytes, sha256: sha(bytes) });
  t.after(async () => { if (store.db.open) store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, store, provider, engine, production, project, human, images, options, app, head, input };
}
function noPublication(f) {
  assert.equal(f.head().artifacts.length, 0); assert.equal(f.store.list("artifact", f.project.id).length, 0);
  assert.equal(f.store.list("image_import_receipt", f.project.id).length, 0);
  assert.equal(f.store.list("grant", f.project.id).length, 0); assert.equal(f.store.list("approval", f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
}

test("exact PNG bytes become one owned immutable reference; replay does not validate again or grant generation", async t => {
  const f = await fixture(t), input = f.input("once"), result = await f.app.importImage(f.project.id, f.human, input);
  const record = f.store.get("artifact", result.artifact.artifactId), intent = f.store.list("image_import", f.project.id)[0];
  assert.deepEqual(await readFile(record.path), png); assert.equal(result.artifact.sha256, sha(png));
  assert.equal(record.fixture, false); assert.equal(record.origin, "supplied_image"); assert.equal(record.attemptId, null);
  assert.equal(record.projectId, f.project.id); assert.equal(record.importId, intent.id); assert.equal(record.validationDigest.length, 64);
  assert.equal(result.width, 320); assert.equal(result.height, 180); assert.equal(result.byteLength, png.length);
  assert.deepEqual(f.head().artifacts, [result.artifact]); assert.equal(f.head().headVersion, 1);
  f.images.ingest = () => { throw new Error("completed replay must not decode"); };
  assert.deepEqual(await f.app.importImage(f.project.id, f.human, input), result);
  await assert.rejects(f.app.importImage(f.project.id, f.human, { ...input, bytes: blue, sha256: sha(blue) }), code("IDEMPOTENCY_CONFLICT"));
  assert.equal(f.store.list("artifact", f.project.id).length, 1); assert.equal(f.store.list("image_import", f.project.id).length, 1);
  assert.throws(() => f.store.put("image_import", intent.id, f.project.id, { ...intent, sha256: sha(blue) }), code("IMMUTABLE_RECORD"));
  assert.throws(() => f.store.put("image_import_receipt", intent.id, f.project.id, { ...result, width: 99 }), code("IMMUTABLE_RECORD"));
  for (const family of ["attempt", "grant", "approval", "candidate"]) assert.equal(f.store.list(family, f.project.id).length, 0);
  assert.equal(f.store.list("hold", f.project.id).filter(h => h.active && h.ownerId === f.human.requestId).length, 1);
});

test("caller mutations during validation cannot replace import identity, bytes, or human authority", async t => {
  const f = await fixture(t), input = f.input("frozen", Buffer.from(png)), actor = { ...f.human };
  const running = f.app.importImage(f.project.id, actor, input);
  input.bytes.fill(0); input.key = "changed"; input.sha256 = sha(blue); input.expectedHeadVersion = 900; actor.principalId = "other";
  const result = await running, record = f.store.get("artifact", result.artifact.artifactId);
  assert.equal(result.artifact.sha256, sha(png)); assert.deepEqual(await readFile(record.path), png);
  assert.equal(f.store.list("image_import", f.project.id)[0].requestId, f.human.requestId);
});

test("only a current editing human with project scope can import; invalid callers never decode", async t => {
  const f = await fixture(t), epoch = f.production.openEpoch(f.project.id, f.human).actor;
  f.images.ingest = () => { throw new Error("authority must be checked before decode"); };
  await assert.rejects(f.app.importImage(f.project.id, epoch, f.input()), code("ACTOR_DENIED"));
  await assert.rejects(f.app.importImage(f.project.id, { ...f.human, principalId: "foreign" }, f.input()), code("ACTOR_DENIED"));
  const readonly = f.production.beginRequest(f.project.id, "human", "Read", { editing: false });
  await assert.rejects(f.app.importImage(f.project.id, readonly, f.input()), code("ACTOR_DENIED"));
  const fixtureProject = projectFixture(f.project.id, 1), current = f.head();
  f.store.saveProject({ ...current, scenes: fixtureProject.scenes, shots: fixtureProject.shots }, current.headVersion);
  const scoped = f.production.beginRequest(f.project.id, "human", "Edit shot", { scopeIds: [fixtureProject.shots[0].id] });
  await assert.rejects(f.app.importImage(f.project.id, scoped, f.input()), code("SCOPE_DENIED"));
  await assert.rejects(f.app.importImage(f.project.id, f.human, f.input()), code("ACTOR_DENIED")); noPublication(f);
});

test("stale head is rejected before decoding; changes during validation leave only reusable cache", async t => {
  const f = await fixture(t), input = f.input("stale"), head = f.head();
  f.store.saveProject({ ...head, revisionId: newId() }, head.headVersion);
  const ingest = f.images.ingest.bind(f.images); let calls = 0;
  f.images.ingest = async (...args) => { calls++; const result = await ingest(...args); const current = f.head(); f.store.saveProject({ ...current, revisionId: newId() }, current.headVersion); return result; };
  await assert.rejects(f.app.importImage(f.project.id, f.human, input), code("REVISION_CONFLICT")); assert.equal(calls, 0);
  await assert.rejects(f.app.importImage(f.project.id, f.human, f.input()), code("REVISION_CONFLICT")); assert.equal(calls, 1);
  noPublication(f); assert.deepEqual(await readdir(join(f.images.rootDir, "blobs")), [`${sha(png)}.png`]);
});

test("a newer request or cancellation after validation prevents canonical publication", async t => {
  for (const mode of ["superseded", "cancelled"]) {
    const f = await fixture(t), abort = new AbortController(), ingest = f.images.ingest.bind(f.images);
    f.images.ingest = async (...args) => { const result = await ingest(...args); if (mode === "superseded") f.production.beginRequest(f.project.id, "human", "Changed my mind"); else abort.abort(); return result; };
    await assert.rejects(f.app.importImage(f.project.id, f.human, f.input(), { signal: abort.signal }), code(mode === "superseded" ? "ACTOR_DENIED" : "MEDIA_CANCELLED"));
    noPublication(f); assert.equal(f.head().headVersion, 0); assert.equal(f.store.list("image_import", f.project.id).length, 1);
  }
});

test("concurrent exact replay publishes once; competing commands cannot share stale revision authority", async t => {
  const f = await fixture(t), input = f.input("same"), results = await Promise.all([1, 2].map(() => f.app.importImage(f.project.id, f.human, input)));
  assert.deepEqual(results[0], results[1]); assert.equal(f.head().headVersion, 1); assert.equal(f.head().artifacts.length, 1);
  const contenders = await Promise.allSettled([f.app.importImage(f.project.id, f.human, f.input("a")), f.app.importImage(f.project.id, f.human, f.input("b", blue))]);
  assert.equal(contenders.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(contenders.find(r => r.status === "rejected").reason.code, "REVISION_CONFLICT"); assert.equal(f.head().artifacts.length, 2);
});

test("SQL publication failure rolls back canonical state; restart retries original intent and then replays its receipt", async t => {
  const f = await fixture(t), input = f.input("restart"), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "image_import_receipt") throw new Error("synthetic receipt failure"); return insert(...args); };
  await assert.rejects(f.app.importImage(f.project.id, f.human, input), /synthetic receipt failure/); noPublication(f);
  assert.equal(f.head().headVersion, 0); const intent = f.store.list("image_import", f.project.id)[0]; f.store.close();
  const reopened = new Store(join(f.dir, "db.sqlite"));
  try {
    const production = new ProductionService(reopened, new Engine(reopened, f.provider, { artifactDir: f.engine.artifactDir }));
    const images = new LocalImageStore(f.options), app = new ImageApplicationService(production, images), result = await app.importImage(f.project.id, f.human, input);
    assert.equal(result.artifact.artifactId, intent.artifactId); assert.equal(reopened.list("image_import", f.project.id).length, 1);
    images.ingest = () => { throw new Error("receipt must survive restart"); }; assert.deepEqual(await app.importImage(f.project.id, f.human, input), result);
  } finally { reopened.close(); }
});

test("imported references are available to compiler review without minting approval, and director metadata has no host path", async t => {
  const f = await fixture(t), imported = await f.app.importImage(f.project.id, f.human, f.input()), project = f.head(), planned = projectFixture(project.id, 1);
  const shot = planned.shots[0]; shot.referenceArtifactIds = [imported.artifact.artifactId]; refreshIntent(shot);
  const saved = f.store.saveProject({ ...project, revisionId: newId(), scenes: planned.scenes, shots: [shot] }, project.headVersion);
  const source = `definePlan({baseRevision:${JSON.stringify(saved.revisionId)}},p=>{const shot=p.shot("shot-0");const frame=p.asset(${JSON.stringify(imported.artifact.artifactId)});const review=p.humanReview("review",{shots:[{intent:shot,keyframe:frame,videoProfile:"fake-video-v1",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:6}]});return p.video("take",{intent:shot,profile:"fake-video-v1",firstFrame:p.approvedImage(frame,review),prompt:${JSON.stringify(shot.videoPrompt)},seconds:6});});`;
  const compiled = compilePlan(source, { project: saved, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: newId });
  assert.deepEqual(compiled.gates[0].members[0].frameSource, { kind: "artifact", artifact: imported.artifact });
  const metadata = f.production.inspectArtifact(f.project.id, f.human, imported.artifact.artifactId);
  assert.equal(metadata.origin, "supplied_image"); assert.equal(metadata.mimeType, "image/png"); assert.equal(metadata.byteLength, png.length);
  assert.equal(JSON.stringify(metadata).includes(f.dir), false); assert.equal("path" in metadata, false);
  for (const family of ["grant", "approval", "attempt"]) assert.equal(f.store.list(family, f.project.id).length, 0);
});

test("invalid format and truncated decode never produce a canonical artifact, and foreign storage is rejected", async t => {
  const f = await fixture(t);
  for (const bytes of [Buffer.alloc(80), png.subarray(0, 40)]) await assert.rejects(f.app.importImage(f.project.id, f.human, f.input(newId(), bytes)), error => ["IMAGE_INPUT_INVALID", "MEDIA_TOOL_FAILED", "IMAGE_VALIDATION_FAILED"].includes(error.code));
  noPublication(f); assert.deepEqual(await readdir(join(f.images.rootDir, "tmp")), []);
  const foreign = new LocalImageStore({ ...f.options, rootDir: join(f.dir, "outside-artifacts") });
  assert.throws(() => new ImageApplicationService(f.production, foreign), code("IMAGE_CONFIGURATION_INVALID"));
});
