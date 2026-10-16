import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/app.js";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { ProductionService } from "../dist/application/service.js";
import { DirectorSupervisor } from "../dist/application/director-supervisor.js";
import { InstallationRecoveryGuard, installRecoveryQuarantine } from "../dist/application/installation-recovery.js";
import { LocalMediaService, MediaApplicationService } from "../dist/media/index.js";
import { ManagedUploadStore } from "../dist/narration/managed-upload.js";
import { NarrationService } from "../dist/narration/service.js";
import { NarrationCanonicalService } from "../dist/narration/canonical.js";
import { FakeProvider } from "@openslate/providers";
import { projectFixture, setup } from "./execution-fixture.mjs";
import { recoveryInspectionAllowed } from "../dist/application/recovery-routes.js";

const statusPath = "/api/installation/recovery", releasePath = `${statusPath}/release`;
const origin = root => ({ restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64), sourceDatabaseSha256: "b".repeat(64),
  originalDataRoot: root, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
const exact = state => ({ restoreId: state.receipt.restoreId, expectedReceiptDigest: state.receiptDigest, expectedSummaryDigest: state.summaryDigest });
const rows = store => Object.fromEntries(["projects", "entities", "events", "commands", "installation_recoveries"].map(table => [table, store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const denied = (response, code = "INSTALLATION_QUARANTINED", status = 409) => { assert.equal(response.statusCode, status, response.body); assert.equal(response.json().error.code, code, response.body); };

function fixture(t, { audioContent = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-recovery-http-")), store = new Store(join(directory, "openslate.sqlite"));
  const provider = new FakeProvider(join(directory, "fake-provider.sqlite")), engine = new Engine(store, provider, { artifactDir: join(directory, "artifacts") });
  let app;
  t.after(async () => { await app?.close(); if (store.db.open) store.close(); if (provider.db.open) provider.close(); rmSync(directory, { recursive: true, force: true }); });
  const service = new ProductionService(store, engine), project = service.createProject("Recovery inspection");
  const uploads = new ManagedUploadStore({ rootDir: join(directory, "uploads"), maxBytes: 32 * 1024 ** 2 });
  const local = new LocalMediaService({ rootDir: join(directory, "media"), allowedInputRoots: [uploads.rootDir],
    ffmpegPath: audioContent ? process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg") : join(directory, "must-not-run-ffmpeg"),
    ffprobePath: audioContent ? process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe") : join(directory, "must-not-run-ffprobe") });
  const media = new MediaApplicationService(service, local), narration = new NarrationService(service, local), canonical = new NarrationCanonicalService(narration);
  const token = randomBytes(32).toString("base64url");
  const runtimeSettings = { settings: () => ({ mode: "fake" }), models: async () => ({ models: [] }), tools: () => ({ tools: [] }),
    codexStatus: async () => ({ found: false, version: null, pinnedVersion: "fixture", signedIn: null }) };
  app = createApp({ service, localToken: token, runtimeSettings, mediaRoutes: { production: service, media, uploads }, imageRoutes: { production: service, images: null, uploads },
    narrationRoutes: { production: service, narration, canonical, uploadDirectory: uploads.rootDir } });
  const headers = { host: "127.0.0.1", authorization: `Bearer ${token}` };
  const request = (method, url, payload, key = randomUUID(), extra = {}) => app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: { ...headers, "idempotency-key": key, ...extra } });
  const quarantine = () => installRecoveryQuarantine(store, origin(directory));
  return { directory, store, provider, engine, service, project, app, request, quarantine, uploads, local, narration, path: `/api/projects/${project.id}` };
}

test("ordinary status has no recovery authority; restored inspection stays authenticated and read-only", async t => {
  const f = fixture(t);
  assert.equal((await f.request("GET", statusPath)).json().state, "ordinary");
  f.quarantine(); const before = rows(f.store), files = readdirSync(f.uploads.rootDir);
  denied(await f.request("GET", statusPath, undefined, "missing", { authorization: "" }), "AUTH_REQUIRED", 403);
  denied(await f.request("GET", statusPath, undefined, "origin", { origin: "https://wrong.invalid" }), "ORIGIN_DENIED", 403);
  for (const path of [statusPath, "/api/projects", "/api/providers", f.path, `${f.path}/director`, `${f.path}/review`, `${f.path}/images`, `${f.path}/media`]) {
    const response = await f.request("GET", path); assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
  }
  const state = (await f.request("GET", statusPath)).json(); assert.equal(state.state, "quarantined"); assert.equal(state.receipt.backupCreatedAt, "2026-09-11T00:00:00.000Z");
  assert.deepEqual(state.counts, { projects: 1, knownJobs: 0, unknownJobs: 0, nativeRequests: 0, unusedAllowances: 0, preparingJobs: 0 });
  assert.equal((await f.request("GET", `${f.path}/review`)).json().id, null);
  assert.deepEqual(rows(f.store), before); assert.deepEqual(readdirSync(f.uploads.rootDir), files); assert.equal(f.provider.acceptedCount(), 0);
});

test("quarantine permits all next studio inspection reads while keeping exact route and method fences", async t => {
  const f = fixture(t), storyboard = projectFixture(f.project.id, 1);
  f.store.saveProject({ ...f.project, scenes: storyboard.scenes, shots: storyboard.shots, revisionId: randomUUID() }, f.project.headVersion);
  f.quarantine(); const before = rows(f.store), files = readdirSync(f.uploads.rootDir);
  for (const path of ["/api/installation/status", "/api/projects", f.path, `${f.path}/generation`, `${f.path}/director`, `${f.path}/director/proposals`,
    `${f.path}/director/setup`, `${f.path}/director/models`,
    `${f.path}/assets?offset=0`, `${f.path}/exports`, `${f.path}/media`, `${f.path}/settings/models`, `${f.path}/settings/voice`,
    `${f.path}/settings/director-review`, `${f.path}/shots/${storyboard.shots[0].id}/takes`, `${f.path}/scenes/${storyboard.scenes[0].id}/generation`,
    `${f.path}/audio-library?role=music`, `${f.path}/narration/personal-voices`, `${f.path}/narration/playback`, "/api/narration/voices", `/api/narration/voices?projectId=${f.project.id}`]) {
    const response = await f.request("GET", path); assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
  }
  const head = await f.request("HEAD", `${f.path}/generation`); assert.equal(head.statusCode, 200, head.body); assert.equal(head.body, "");
  denied(await f.request("POST", `${f.path}/settings/director-review`, { expectedHeadVersion: 1, enabled: false }));
  denied(await f.request("POST", `${f.path}/settings/models/preview`, { expectedHeadVersion: 1, expectedSelectionDigest: "a".repeat(64),
    expectedCatalogDigest: "b".repeat(64), profileIds: ["fake-image-v1"], scope: { kind: "unfinished" } }));
  denied(await f.request("POST", `${f.path}/settings/voice`, { expectedHeadVersion: 1, narratorVoice: "cedar" }));
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(recoveryInspectionAllowed(method, "/api/projects/:projectId/generation"), false);
  assert.equal(recoveryInspectionAllowed("GET", "/api/projects/:projectId/settings/future-write"), false);
  assert.equal(recoveryInspectionAllowed("GET", undefined), false);
  assert.deepEqual(rows(f.store), before); assert.deepEqual(readdirSync(f.uploads.rootDir), files); assert.equal(f.provider.acceptedCount(), 0);
});

test("restored narration audio content remains readable with exact bytes and no acceptance or dispatch", async t => {
  const f = fixture(t, { audioContent: true }), bytes = Buffer.alloc(44 + 4800 * 4);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(192000, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  const path = join(f.uploads.rootDir, "local-recording.wav"); writeFileSync(path, bytes);
  const actor = f.service.beginRequest(f.project.id, "local-user", "Import a disposable recording", { editing: true });
  const recording = await f.narration.importAudio(f.project.id, actor, { path, declaredOrigin: "uploaded", key: "fixture-audio" });
  f.quarantine(); const before = rows(f.store);
  const response = await f.request("GET", `${f.path}/narration/audio/${recording.id}/content`);
  assert.equal(response.statusCode, 200, response.body); assert.match(response.headers["content-type"], /audio\/wav/);
  assert.equal(response.headers["x-content-sha256"], recording.media.sha256);
  assert.deepEqual(response.rawPayload, readFileSync((await f.local.verifiedSource(recording.media)).path));
  assert.deepEqual(rows(f.store), before); assert.equal(f.store.list("narration_acceptance", f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test("recovery status reads the saved backup time, project, pending, uncertain and Director counts without changing work", async t => {
  const cleanup = [], f = setup({ after: fn => cleanup.push(fn) }, { count: 2, imagesOnly: true });
  const service = new ProductionService(f.store, f.engine), token = randomBytes(32).toString("base64url");
  const director = new DirectorSupervisor(service, { id: "unstarted-fixture", async start() { assert.fail("Inspection must not start a Director turn"); } }, { mode: "native" });
  const app = createApp({ service, localToken: token });
  t.after(async () => { await app.close(); await director.close(); cleanup.forEach(fn => fn()); });
  f.provider.setMode(f.plan.nodes[0].id, "unknown_after_accept"); await f.engine.runReady();
  const actor = service.beginRequest(f.projectId, "local-user", "Saved Director direction", { editing: false }); director.enqueue(f.projectId, actor);
  service.createProject("A second restored project");
  installRecoveryQuarantine(f.store, origin(f.directory)); const before = rows(f.store);
  const response = await app.inject({ url: statusPath, headers: { host: "127.0.0.1", authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200, response.body); const state = response.json();
  assert.equal(state.receipt.backupCreatedAt, "2026-09-11T00:00:00.000Z");
  assert.deepEqual(state.counts, { projects: 2, knownJobs: 1, unknownJobs: 1, nativeRequests: 1, unusedAllowances: 0, preparingJobs: 0 });
  assert.deepEqual(rows(f.store), before); assert.equal(f.provider.acceptedCount(), 2);
});

test("quarantine blocks every mutation family and future routes before body consumers run", async t => {
  const f = fixture(t); let futureCalls = 0;
  f.app.post("/api/future/write", async () => { futureCalls++; return {}; });
  f.app.get("/api/future/reconcile", async () => { futureCalls++; return {}; });
  f.quarantine(); const before = rows(f.store);
  for (const [url, body] of [["/api/projects", { name: "No new project" }], [`${f.path}/messages`, { text: "New request" }], [`${f.path}/controls`, { action: "resume", expectedAuthorityId: null }],
    [`${f.path}/attempts/unknown/release`, { expectedPhase: "submission_unknown", acknowledgeDoubleCharge: true }],
    [`${f.path}/scenes/scene-0/confirm`, { confirmationDigest: "a".repeat(64), reviewedFrames: [] }], [`${f.path}/director/setup`, { mode: "native" }], [`${f.path}/media/renders`, { expectedHeadVersion: 0, renderNodeId: "render" }],
    ["/api/future/write", {}]]) denied(await f.request("POST", url, body));
  denied(await f.request("GET", "/api/future/reconcile"));
  for (const suffix of ["images/uploads?expectedHeadVersion=0", "media/uploads?expectedHeadVersion=0", "shots/missing/narration/recording?expectedHeadVersion=0"])
    denied(await f.request("POST", `${f.path}/${suffix}`, Buffer.from("not consumed"), randomUUID(), { "content-type": "application/octet-stream" }));
  assert.equal(futureCalls, 0); assert.deepEqual(rows(f.store), before); assert.deepEqual(readdirSync(f.uploads.rootDir), []);
  assert.equal(f.provider.acceptedCount(), 0);
});

test("release requires exact human review, rejects forged fields and replays one decision while projects stay paused", async t => {
  const f = fixture(t); f.quarantine(); const state = (await f.request("GET", statusPath)).json(), body = exact(state), before = rows(f.store);
  denied(await f.request("POST", releasePath, body, "unauth", { authorization: "" }), "AUTH_REQUIRED", 403);
  denied(await f.request("POST", releasePath, { ...body, principalId: "director" }), "VALIDATION_ERROR", 400);
  denied(await f.request("POST", releasePath, body, ""), "VALIDATION_ERROR", 400);
  denied(await f.request("POST", releasePath, { ...body, expectedSummaryDigest: "c".repeat(64) }), "RECOVERY_CONFLICT");
  denied(await f.request("POST", releasePath, { ...body, restoreId: "other-backup" }), "RECOVERY_CONFLICT");
  assert.deepEqual(rows(f.store), before);
  const first = await f.request("POST", releasePath, body, "release-once"); assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().receipt.principalId, "local-user"); assert.equal(first.json().recovery.state, "released");
  const after = rows(f.store), again = await f.request("POST", releasePath, body, "release-once");
  assert.equal(again.statusCode, 200, again.body); assert.deepEqual(again.json(), first.json()); assert.deepEqual(rows(f.store), after);
  assert.equal(f.store.get("execution_control", f.project.id).paused, true);
  assert.equal(f.store.list("message", f.project.id).length, 0); assert.equal(f.store.list("grant", f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
  const fresh = await f.request("POST", `${f.path}/messages`, { text: "Inspect the restored story", editing: false }, "fresh-human-request");
  assert.equal(fresh.statusCode, 200, fresh.body); assert.equal(f.store.get("execution_control", f.project.id).paused, true);
});

test("review stays read-only before, during and after recovery release; engine can create a fresh approval snapshot", async t => {
  const cleanup = [], f = setup({ after: fn => cleanup.push(fn) }, { count: 1 });
  const service = new ProductionService(f.store, f.engine), token = randomBytes(32).toString("base64url"), app = createApp({ service, localToken: token });
  t.after(async () => { await app.close(); cleanup.forEach(fn => fn()); });
  const request = url => app.inject({ url, headers: { host: "127.0.0.1", authorization: `Bearer ${token}` } });
  await f.engine.runReady(); await f.engine.reconcile();
  const path = `/api/projects/${f.projectId}`, beforeRead = rows(f.store), prior = (await request(`${path}/review`)).json();
  assert.equal(prior.id, null); assert.equal(prior.members[0].ready, true); assert.deepEqual(rows(f.store), beforeRead);
  const oldSnapshot = f.engine.reviewSnapshot(f.projectId);
  installRecoveryQuarantine(f.store, origin(f.directory)); const before = rows(f.store);
  const inspected = await request(`${path}/review`); assert.equal(inspected.statusCode, 200, inspected.body);
  assert.equal(inspected.json().id, null); assert.deepEqual(inspected.json().members, prior.members);
  const artifact = f.store.get("artifact", prior.members[0].keyframe.artifactId);
  const preview = await request(`${path}/artifacts/${artifact.artifact.artifactId}/content`); assert.equal(preview.statusCode, 200); assert.deepEqual(preview.rawPayload, readFileSync(artifact.path));
  assert.deepEqual(rows(f.store), before);
  const state = new InstallationRecoveryGuard(f.store).snapshot();
  const released = await app.inject({ method: "POST", url: releasePath, payload: exact(state), headers: { host: "127.0.0.1", authorization: `Bearer ${token}`, "idempotency-key": "reviewed" } });
  assert.equal(released.statusCode, 200, released.body);
  const afterRelease = rows(f.store), current = (await request(`${path}/review`)).json();
  assert.equal(current.id, null); assert.deepEqual(current.members, prior.members); assert.deepEqual(rows(f.store), afterRelease);
  const freshSnapshot = f.engine.reviewSnapshot(f.projectId);
  assert.notEqual(freshSnapshot.id, oldSnapshot.id);
});


test("chat continuation resumes a released restoration under fresh authority, never during quarantine",async t=>{
  const f=fixture(t);f.quarantine();const state=(await f.request("GET",statusPath)).json();
  const body={text:"Continue the restored project with a new direction",editing:true,scopeIds:[f.project.id],resumeFromStopId:state.receipt.restoreId};
  denied(await f.request("POST",`${f.path}/messages`,body,"fresh-after-restore"));
  assert.equal((await f.request("POST",releasePath,exact(state),"reviewed-restore")).statusCode,200);
  const result=await f.request("POST",`${f.path}/messages`,body,"fresh-after-restore");
  assert.equal(result.statusCode,200,result.body);
  assert.equal(f.service.snapshot(f.project.id).control.paused,false);
  assert.ok(f.service.snapshot(f.project.id).holds.some(h=>h.active&&h.ownerId===result.json().requestId));
  assert.equal(f.provider.acceptedCount(),0);
});
