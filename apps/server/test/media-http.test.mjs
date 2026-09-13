import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../dist/app.js";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { ProductionService } from "../dist/application/service.js";
import { LocalMediaService, MediaApplicationService, registerMediaRoutes } from "../dist/media/index.js";
import { ManagedUploadStore } from "../dist/narration/managed-upload.js";
import { FakeProvider } from "@openslate/providers";
import { compilePlan, DEFAULT_PROFILES, DomainError, newId } from "@openslate/core";

const execute = promisify(execFile);
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
let inputs, bytes;
before(async () => {
  inputs = await mkdtemp(join(tmpdir(), "openslate-media-http-input-")); const path = join(inputs, "clip.mp4");
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=1", "-an", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", path], { timeout: 10000 });
  bytes = await readFile(path);
});
after(async () => { await rm(inputs, { recursive: true, force: true }); });
async function fixture(t, maxBytes) {
  const dir = await mkdtemp(join(tmpdir(), "openslate-media-http-")), store = new Store(join(dir, "db.sqlite")), provider = new FakeProvider(join(dir, "fake.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(dir, "artifacts") }), production = new ProductionService(store, engine);
  const project = production.createProject("HTTP supplied render"), uploads = new ManagedUploadStore({ rootDir: join(dir, "uploads"), ...(maxBytes ? { maxBytes } : {}) });
  const local = new LocalMediaService({ rootDir: join(dir, "media"), allowedInputRoots: [uploads.rootDir], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const media = new MediaApplicationService(production, local), token = "test-local-token-with-enough-characters";
  const app = createApp({ service: production, localToken: token }); registerMediaRoutes(app, { production, media, uploads });
  const path = `/api/projects/${project.id}/media`;
  const request = (method, url, payload, key = newId(), extra = {}) => app.inject({ method, url, ...(payload !== undefined ? { payload } : {}), headers: { host: "127.0.0.1", authorization: `Bearer ${token}`, "idempotency-key": key, ...extra } });
  const upload = (key = newId(), requestId, payload = bytes) => request("POST", `${path}/uploads?expectedHeadVersion=${store.getProject(project.id).headVersion}${requestId ? `&requestId=${requestId}` : ""}`, payload, key, { "content-type": "application/octet-stream" });
  const install = () => {
    const current = store.getProject(project.id), planId = newId();
    const source = `definePlan({baseRevision:${JSON.stringify(current.revisionId)}},p=>{const timeline=p.timeline("timeline",{takes:[${current.artifacts.filter(a => a.kind === "video").map(a => `p.asset(${JSON.stringify(a.artifactId)})`).join(",")}]});return p.render("render",{timeline,width:160,height:90});});`;
    const compiled = compilePlan(source, { project: current, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: newId });
    store.transaction(() => {
      engine.installPlan(project.id, planId, compiled); store.saveProject({ ...current, revisionId: newId(), activePlanId: planId }, current.headVersion);
      for (const hold of store.list("hold", project.id)) if (hold.active) engine.releaseHold(project.id, hold.id, hold.ownerId);
    });
    return { expectedHeadVersion: store.getProject(project.id).headVersion, renderNodeId: compiled.nodes.find(n => n.kind === "render").id };
  };
  t.after(async () => { await app.close(); store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, app, store, provider, engine, production, project, local, media, uploads, path, request, upload, install };
}
async function waitJob(f, id, predicate) {
  for (let count = 0; count < 300; count++) {
    const response = await f.request("GET", `${f.path}/renders/${id}`); assert.equal(response.statusCode, 200, response.body);
    const job = response.json().job; if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Render status did not reach the expected state");
}

test("authenticated binary uploads reuse one explicit import session and GET creates no new messages", async t => {
  const f = await fixture(t);
  const unauthenticated = await f.app.inject({ method: "POST", url: `${f.path}/uploads?expectedHeadVersion=0`, payload: bytes,
    headers: { host: "127.0.0.1", "content-type": "application/octet-stream", "idempotency-key": "denied" } });
  assert.equal(unauthenticated.statusCode, 403); assert.equal(f.store.list("media_import", f.project.id).length, 0);
  const first = await f.upload("one"); assert.equal(first.statusCode, 200, first.body);
  const requestId = first.json().requestId;
  const second = await f.upload("two", requestId); assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().requestId, requestId);
  assert.equal(f.store.list("hold", f.project.id).filter(h => h.active).length, 1);
  const before = f.store.list("message", f.project.id).length, snapshot = await f.request("GET", f.path);
  assert.equal(snapshot.statusCode, 200); assert.equal(snapshot.json().sources.length, 2);
  assert.equal(f.store.list("message", f.project.id).length, before);
  assert.deepEqual(await readdir(f.uploads.rootDir), []);
  const invalid = await f.request("POST", `${f.path}/uploads?expectedHeadVersion=2&path=/tmp/private`, bytes, "path", { "content-type": "application/octet-stream" });
  assert.equal(invalid.statusCode, 400); assert.equal(f.provider.acceptedCount(), 0);
  const continued = await f.request("POST", `${f.path}/uploads?expectedHeadVersion=2&continuationRequestId=${requestId}`, bytes, "continued", { "content-type": "application/octet-stream" });
  assert.equal(continued.statusCode, 200, continued.body); assert.notEqual(continued.json().requestId, requestId);
  assert.equal(f.store.list("hold", f.project.id).filter(h => h.active).length, 1);
  assert.equal(f.store.list("hold", f.project.id).find(h => h.ownerId === requestId).active, false);
});

test("clip library excludes audio while retaining both supplied and generated video sources", async t => {
  const f = await fixture(t); assert.equal((await f.upload()).statusCode, 200);
  const original = f.store.list("media_source", f.project.id)[0];
  // Classification fixture only: no claim these extra metadata rows were generated or ingested.
  const installMetadata = (id, kind, origin) => {
    const source = { ...original.source, artifactId: id, kind };
    if (kind === "audio") source.probe = { durationSeconds: 1, audio: { samples: 48000, sampleRate: 48000, channels: 2 } };
    const body = { id, projectId: f.project.id, source, origin, attemptId: "projection-fixture", derivationId: "projection-fixture" };
    f.store.db.prepare("INSERT INTO entities(kind,id,project_id,body) VALUES('media_source',?,?,?)").run(id, f.project.id, JSON.stringify(body));
    return source;
  };
  installMetadata("generated-audio", "audio", "generated_audio");
  installMetadata("other-audio", "audio", "generated_video");
  const video = installMetadata("generated-video", "video", "generated_video");
  const changes = f.store.db.prepare("SELECT total_changes() AS n").get().n;
  const response = await f.request("GET", f.path); assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().sources.map(source => source.artifactId), [original.source.artifactId, video.artifactId]);
  assert.ok(response.json().sources.every(source => source.kind === "video" && source.frames === 30));
  assert.equal(f.store.db.prepare("SELECT total_changes() AS n").get().n, changes);
  assert.equal(f.store.list("media_source", f.project.id).length, 4, "projection does not delete audio provenance");
  assert.equal(f.provider.acceptedCount(), 0);
});

test("render HTTP returns a job, survives synchronous admission failure, and explicit replay can start it", async t => {
  const f = await fixture(t); assert.equal((await f.upload()).statusCode, 200); const body = f.install();
  const original = f.media.run.bind(f.media); let calls = 0;
  f.media.run = (...args) => { calls++; if (calls === 1) throw new DomainError("MEDIA_PAUSED", "Synthetic synchronous admission failure"); return original(...args); };
  const started = await f.request("POST", `${f.path}/renders`, body, "run-once"); assert.equal(started.statusCode, 202, started.body);
  const id = started.json().job.id;
  const blocked = await waitJob(f, id, j => j.errorCode === "MEDIA_PAUSED"); assert.equal(blocked.state, "prepared");
  const retry = await f.request("POST", `${f.path}/renders`, body, "run-once"); assert.equal(retry.statusCode, 202, retry.body); assert.equal(retry.json().job.id, id);
  const finished = await waitJob(f, id, j => j.state === "published"); assert.equal(calls, 2); assert.equal(finished.totalFrames, 30);
  const artifact = await f.request("GET", `/api/projects/${f.project.id}/artifacts/${finished.artifact.artifactId}/content`);
  assert.equal(artifact.statusCode, 200, artifact.body); assert.equal(artifact.headers["content-type"], "video/mp4"); assert.ok(artifact.rawPayload.length > 0);
  const recovered = await f.request("POST", `${f.path}/renders/${id}/recover`, {}, "recover-done"); assert.equal(recovered.statusCode, 202, recovered.body);
  await waitJob(f, id, j => j.state === "published"); assert.equal(calls, 2);
  const other = f.production.createProject("Other project");
  const foreign = await f.request("GET", `/api/projects/${other.id}/media/renders/${id}`); assert.equal(foreign.statusCode, 404);
  f.engine.setPaused(f.project.id, true, started.json().requestId);
  const prepared = await f.request("POST", `${f.path}/renders`, body, "paused-job"); assert.equal(prepared.statusCode, 202, prepared.body);
  const pending = await waitJob(f, prepared.json().job.id, job => job.errorCode === "MEDIA_PAUSED"); assert.equal(pending.canRun, true);
  f.engine.setPaused(f.project.id, false, started.json().requestId);
  const explicitRun = await f.request("POST", `${f.path}/renders/${pending.id}/run`, {}, "later-run"); assert.equal(explicitRun.statusCode, 202, explicitRun.body);
  assert.equal((await waitJob(f, pending.id, job => job.state === "published")).canRun, false);
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.store.list("attempt", f.project.id).length, 0);
});

test("server close aborts and awaits its background render before returning", async t => {
  const f = await fixture(t); assert.equal((await f.upload()).statusCode, 200); const body = f.install();
  let entered, exited = false;
  const began = new Promise(resolve => { entered = resolve; });
  f.local.render = async (_manifest, { signal }) => {
    entered();
    await new Promise((resolve, reject) => {
      const stop = () => { exited = true; reject(new DomainError("MEDIA_CANCELLED", "Synthetic cancellable child")); };
      if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
    });
  };
  const response = await f.request("POST", `${f.path}/renders`, body, "close"); assert.equal(response.statusCode, 202, response.body);
  await began; await f.app.close();
  assert.equal(exited, true); assert.equal(f.store.get("media_render", response.json().job.id).state, "cancelled");
  assert.equal(f.store.get("media_preview", f.project.id), undefined);
});

test("oversize and empty upload bodies are rejected without canonical artifacts or leftover staging files", async t => {
  const f = await fixture(t, 100);
  const large = await f.upload("too-large"); assert.equal(large.statusCode, 409, large.body); assert.equal(large.json().error.code, "UPLOAD_TOO_LARGE");
  assert.equal(typeof large.json().requestId, "string");
  const empty = await f.upload("empty", large.json().requestId, Buffer.alloc(0)); assert.equal(empty.statusCode, 400, empty.body);
  assert.equal(empty.json().requestId, large.json().requestId); assert.equal(f.store.list("hold", f.project.id).filter(h => h.active).length, 1);
  assert.equal(f.store.list("artifact", f.project.id).length, 0); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});
