import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compilePlan, digest } from "../../../packages/core/dist/index.js";
import { MiniMaxH3Execution } from "../dist/execution/minimax-h3-execution.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { ProtectedVideoDownloader } from "../dist/execution/video-download.js";
import { SpoolVideoIngestor } from "../dist/execution/spool-video-ingester.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { Engine } from "../dist/execution/engine.js";
import { Store } from "../dist/persistence/store.js";
import { projectFixture } from "./execution-fixture.mjs";

const key = "offline-h3-credential", taskId = "known_h3_task", hash = bytes => createHash("sha256").update(bytes).digest("hex");
const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const pending = (status = "running") => json({ task: { id: taskId, model: "MiniMax-H3", status } });
const completed = (suffix = "one") => json({ task: { id: taskId, model: "MiniMax-H3", status: "succeeded", duration: 6,
  resolution: "768P", usage: { total_seconds: 6 }, content: { url: `https://media.example.test/output.mp4?signature=${suffix}` } } });
let temporary, png, video;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "openslate-h3-fixtures-"));
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=320x320", "-frames:v", "1", "-threads", "1", join(temporary, "frame.png")], { timeout: 30000 });
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=24", "-t", "6", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", join(temporary, "raw.mp4")], { timeout: 30000 });
  png = await readFile(join(temporary, "frame.png")); video = await readFile(join(temporary, "raw.mp4"));
});
after(async () => rm(temporary, { recursive: true, force: true }));

function fixture(t, options = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "openslate-h3-execution-"))), path = join(directory, "store.sqlite");
  const store = new Store(path), project = projectFixture(randomUUID(), 1), artifactRoot = join(directory, "artifacts"); mkdirSync(artifactRoot);
  const reference = { artifactId: randomUUID(), kind: "image", sha256: hash(png) };
  project.artifacts = [reference]; store.createProject(project);
  const imagePath = join(artifactRoot, `${reference.artifactId}.png`); writeFileSync(imagePath, png);
  store.insert("artifact", reference.artifactId, project.id, { artifact: reference, path: imagePath, mimeType: "image/png", fixture: false,
    origin: "supplied_image", attemptId: null, physicalDurationSeconds: null, byteLength: png.length, width: 320, height: 320,
    validationDigest: digest({ sha256: reference.sha256, syntheticDecode: true }) });
  const profile = { id: "offline-h3-video", revision: "1", kind: "video", adapter: "minimax-h3", executionVersion: "1",
    configuration: { model: options.model ?? "MiniMax-H3", settings: { resolution: "768P", ...options.profileSettings } },
    minFrames: 120, maxFrames: 450, maxConcurrency: 2, unitCostMicros: "300", maxRetries: 0 };
  const outputs = new ExecutionOutputStore(store, { rootDir: join(directory, "outputs") }), clock = { value: Date.now() };
  const calls = { post: 0, query: 0, download: 0, credentials: 0 };
  const credentials = new EnvironmentMediaCredentials(name => { calls.credentials++; assert.equal(name, "OPENSLATE_MINIMAX_API_KEY"); return options.credential ? options.credential() : key; });
  const fetch = async (url, init) => { calls[init.method === "POST" ? "post" : "query"]++;
    return options.fetch ? options.fetch(url, init) : init.method === "POST" ? json({ task_id: taskId }) : pending(); };
  const downloader = new ProtectedVideoDownloader({ allowedHosts: ["media.example.test"], lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    request: (args, callback) => {
      calls.download++; const client = new EventEmitter(); let body, destroyed = false;
      client.destroy = () => { if (!destroyed) { destroyed = true; args.signal.removeEventListener("abort", abort); body?.destroy(); queueMicrotask(() => client.emit("close")); } return client; };
      const abort = () => { body?.destroy(Error("cancelled")); client.emit("error", Error("cancelled")); client.destroy(); };
      args.signal.addEventListener("abort", abort, { once: true });
      client.end = () => queueMicrotask(() => { body = Readable.from([video]); body.on("error", () => {}); body.statusCode = options.downloadStatus?.() ?? 200;
        body.headers = { "content-type": "video/mp4", "content-length": String(video.length) }; callback(body); }); return client;
    } });
  const bridgeOptions = { store, outputStore: outputs, artifactRoot, credentials, downloader, fetch, timeoutMs: 10000, now: () => clock.value, ...options.bridgeOptions };
  const bridge = new MiniMaxH3Execution(bridgeOptions);
  const media = options.ingest ? new LocalMediaService({ rootDir: join(directory, "normalized"), allowedInputRoots: [outputs.rootDir], ffmpegPath, ffprobePath }) : undefined;
  const engine = new Engine(store, bridge, { artifactDir: artifactRoot, profiles: [profile], outputStore: outputs,
    ...(media ? { outputIngestor: new SpoolVideoIngestor(outputs, media, { rootDir: join(directory, "derivations") }) } : {}),
    externalAdmission: { authorize: claim => { const id = randomUUID(); store.insert("offline_h3_allowance", id, claim.projectId, { attemptId: claim.attemptId }); return { allowanceId: id }; } } });
  const q = JSON.stringify, shot = project.shots[0], settings = options.shotSettings ? `,settings:${q(options.shotSettings)}` : "";
  const source = `definePlan({baseRevision:${q(project.revisionId)}},p=>{const shot=p.shot(${q(shot.id)});const frame=p.asset(${q(reference.artifactId)});const review=p.humanReview("review",{shots:[{intent:shot,keyframe:frame,videoProfile:${q(profile.id)},motionPrompt:${q(shot.videoPrompt)},seconds:6${settings}}]});return p.video("video",{intent:shot,profile:${q(profile.id)},firstFrame:p.approvedImage(frame,review),prompt:${q(shot.videoPrompt)},seconds:6${settings}});});`;
  const plan = compilePlan(source, { project, profiles: [profile], logicalIds: {}, allocateId: randomUUID }), node = plan.nodes.find(node => node.kind === "video"), planId = randomUUID();
  const grant = engine.createGrant(project.id, shot.id, "video", "offline-human", "initial_slot"); engine.installPlan(project.id, planId, plan, { [node.id]: grant.id });
  store.saveProject({ ...project, activePlanId: planId }, 0); const review = engine.reviewSnapshot(project.id); engine.approve(project.id, review.id, [node.id], "offline-review");
  const admit = () => engine.admit(project.id, node.id, engine.resolveInputs(project.id, node).fingerprint), attempt = options.deferAdmission ? undefined : admit();
  t.after(() => { if (store.db.open) store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, path, store, project, artifactRoot, reference, imagePath, profile, outputs, clock, calls, credentials, fetch, downloader, bridgeOptions, bridge, engine, media, attempt, request: attempt?.request, admit };
}
const rows = (f, kind) => f.store.list(kind, f.project.id);
const context = f => ({ expectedLease: { owner: f.attempt.leaseOwner, epoch: f.attempt.leaseEpoch } });
function due(f) { f.clock.value = rows(f, "h3_poll_schedule")[0].nextPollAt; }
function attempt(f) { return f.engine.attempts(f.project.id)[0]; }

test("H3 first POST is bound to immutable mapping, exact wire SHA and unchanged reviewed PNG", async t => {
  const f = fixture(t, { fetch: async (url, init) => {
    assert.equal(url, "https://api.minimax.io/v2/video_generation");
    const mapping = rows(f, "h3_execution_mapping")[0], dispatch = rows(f, "h3_execution_dispatch")[0], body = JSON.parse(init.body);
    assert.equal(mapping.requestDigest, digest(f.request)); assert.equal(dispatch.mappingDigest, digest(mapping));
    assert.equal(dispatch.bodySha256, hash(init.body)); assert.equal(mapping.transport.bodySha256, hash(init.body));
    assert.notEqual(mapping.requestDigest, mapping.transport.requestDigest);
    assert.deepEqual(body.content, [{ type: "text", text: f.request.args.prompt }, { type: "image_url", role: "first_frame", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }]);
    assert.equal(body.duration, 6); assert.equal(body.resolution, "768P"); assert.equal(body.ratio, "adaptive");
    assert.equal(init.headers.Authorization, `Bearer ${key}`); return json({ task_id: taskId });
  } });
  const submitted = structuredClone(f.request), running = f.bridge.submit(submitted, context(f)); submitted.args.prompt = "later mutation";
  assert.deepEqual(await running, { type: "accepted", taskId }); assert.equal(rows(f, "h3_execution_submit")[0].observation.taskId, taskId);
  assert.deepEqual(await f.bridge.submit(f.request), { type: "accepted", taskId }); assert.deepEqual(await f.bridge.lookup(f.request.attemptId), { type: "accepted", taskId });
  assert.equal(f.calls.post, 1); assert.equal(f.calls.credentials, 1);
  const protectedRows = JSON.stringify([rows(f, "h3_execution_mapping"), rows(f, "h3_execution_dispatch"), rows(f, "h3_execution_submit")]);
  assert.equal(protectedRows.includes(key), false); assert.equal(protectedRows.includes("data:image"), false); assert.equal(protectedRows.includes(f.directory), false);
});

test("missing or replaced caller lease cannot create a first POST or seal another worker's preparation", async t => {
  const f = fixture(t); await assert.rejects(f.bridge.submit(f.request), { code: "H3_EXECUTION_NOT_DISPATCHABLE" });
  const old = context(f); f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: "replacement", leaseEpoch: f.attempt.leaseEpoch + 1 });
  await assert.rejects(f.bridge.submit(f.request, old), { code: "H3_EXECUTION_NOT_DISPATCHABLE" });
  assert.equal(rows(f, "h3_execution_mapping").length, 0); assert.equal(rows(f, "h3_execution_submit").length, 0); assert.equal(f.calls.post, 0);
});

test("a caller losing its lease during credential resolution cannot borrow the replacement for HTTP", async t => {
  const f = fixture(t, { credential: () => { const current = attempt(f); f.store.put("attempt", current.id, f.project.id, { ...current, leaseOwner: "replacement", leaseEpoch: current.leaseEpoch + 1 }); return key; } });
  await assert.rejects(f.bridge.submit(f.request, context(f)), { code: "H3_EXECUTION_NOT_DISPATCHABLE" });
  assert.equal(rows(f, "h3_execution_dispatch").length, 0); assert.equal(f.calls.post, 0);
});

test("concurrent H3 bridge instances claim only one POST and retain late acceptance after lease loss", async t => {
  let entered, release; const started = new Promise(resolve => { entered = resolve; }), barrier = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { fetch: async () => { entered(); await barrier; return json({ task_id: taskId }); } });
  const otherStore = new Store(f.path); t.after(() => otherStore.close());
  const second = new MiniMaxH3Execution({ ...f.bridgeOptions, store: otherStore, outputStore: new ExecutionOutputStore(otherStore, { rootDir: join(f.directory, "outputs") }) });
  const first = f.bridge.submit(f.request, context(f)); await started;
  try { assert.equal((await second.submit(f.request)).type, "unknown"); const current = attempt(f);
    f.store.put("attempt", current.id, f.project.id, { ...current, leaseOwner: "new-worker", leaseEpoch: current.leaseEpoch + 1 }); }
  finally { release(); }
  assert.deepEqual(await first, { type: "accepted", taskId }); assert.equal(f.calls.post, 1);
  assert.deepEqual(await second.lookup(f.request.attemptId), { type: "accepted", taskId }); assert.equal(rows(f, "h3_execution_dispatch").length, 1);
});

test("a persisted POST marker with an unknown result survives restart without resubmission or blind lookup", async t => {
  const f = fixture(t, { fetch: async () => { throw Error(`private ${key}`); } });
  const result = await f.bridge.submit(f.request, context(f)); assert.equal(result.type, "unknown");
  const second = new MiniMaxH3Execution({ ...f.bridgeOptions, credentials: new EnvironmentMediaCredentials(() => { throw Error("must not read keys"); }), fetch: async () => { throw Error("must not POST again"); } });
  assert.equal((await second.submit(f.request)).type, "unknown"); assert.equal((await second.lookup(f.request.attemptId)).type, "unknown");
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0); assert.equal(rows(f, "h3_execution_submit")[0].observation.kind, "unknown");
});

test("changed PNG bytes, fixture records, unsupported profile fields and creative overrides fail before HTTP", async t => {
  for (const mode of ["changed-bytes", "fixture", "extra-profile", "shot-override"]) {
    const f = fixture(t, mode === "extra-profile" ? { profileSettings: { quality: "high" } } : mode === "shot-override" ? { shotSettings: { resolution: "2K" } } : {});
    if (mode === "changed-bytes") writeFileSync(f.imagePath, Buffer.alloc(png.length));
    if (mode === "fixture") {
      const record = rows(f, "artifact")[0]; f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?").run(JSON.stringify({ ...record, fixture: true }), record.id);
    }
    const result = await f.bridge.submit(f.request, context(f)); assert.equal(result.type, "rejected"); assert.equal(result.retryAllowed, false);
    assert.equal(f.calls.post, 0); assert.equal(rows(f, "h3_execution_dispatch").length, 0);
  }
});

test("missing credentials are a recorded pre-dispatch rejection with no replacement authority", async t => {
  const f = fixture(t, { credential: () => undefined }); const result = await f.bridge.submit(f.request, context(f));
  assert.equal(result.type, "rejected"); assert.equal(result.retryAllowed, false); assert.equal(rows(f, "h3_execution_dispatch").length, 0);
  assert.equal(rows(f, "h3_execution_submit")[0].observation.code, "LOCAL_CREDENTIAL_UNAVAILABLE"); assert.equal(f.calls.post, 0);
});

test("durable known-task polling respects cooldown and capped exponential backoff across instances", async t => {
  const f = fixture(t); await f.bridge.submit(f.request, context(f));
  const otherStore = new Store(f.path); t.after(() => otherStore.close());
  const other = new MiniMaxH3Execution({ ...f.bridgeOptions, store: otherStore, outputStore: new ExecutionOutputStore(otherStore, { rootDir: join(f.directory, "outputs") }) });
  for (const delay of [2000, 4000, 8000, 15000, 15000]) {
    const next = rows(f, "h3_poll_schedule")[0].nextPollAt;
    f.clock.value = next - 1; const before = f.calls.query;
    for (let n = 0; n < 3; n++) assert.deepEqual(await other.poll(taskId, f.request), { type: "accepted", taskId });
    assert.equal(f.calls.query, before); f.clock.value = next; await f.bridge.poll(taskId, f.request);
    assert.equal(rows(f, "h3_poll_schedule")[0].nextPollAt - f.clock.value, delay);
  }
  assert.equal(f.calls.query, 5); assert.equal(f.calls.post, 1); assert.equal(rows(f, "h3_execution_observation").length, 1, "identical pending evidence is deduplicated");
  await assert.rejects(f.bridge.poll("another-task", f.request), { code: "H3_EXECUTION_CONFLICT" }); assert.equal(f.calls.query, 5);
});

test("known-task auth, quota and throttling responses honor bounded Retry-After without releasing identity", async t => {
  for (const [status, type] of [[401, "authorized_error"], [402, "insufficient_balance_error"], [429, "rate_limit_error"]]) {
    const f = fixture(t, { fetch: async (_url, init) => init.method === "POST" ? json({ task_id: taskId })
      : json({ type: "error", error: { type, http_code: String(status) } }, status, { "retry-after": "120" }) });
    await f.bridge.submit(f.request, context(f)); due(f); const result = await f.bridge.poll(taskId, f.request);
    assert.equal(result.type, "unknown"); assert.equal(result.taskId, taskId); assert.equal(rows(f, "h3_poll_schedule")[0].nextPollAt - f.clock.value, 120000);
    f.clock.value += 10000; await f.bridge.poll(taskId, f.request); assert.equal(f.calls.query, 1); assert.equal(f.calls.post, 1);
    assert.equal(f.store.get("reservation", f.attempt.reservationId).state, "reserved");
  }
});

test("an in-flight polling claim excludes a second worker; late pending, terminal and unknown facts cannot shorten replacement cooldown", async t => {
  for (const original of ["pending", "failed", "unknown"]) {
  let entered, release, first = true; const started = new Promise(resolve => { entered = resolve; }), barrier = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { fetch: async (_url, init) => { if (init.method === "POST") return json({ task_id: taskId });
    if (first) { first = false; entered(); await barrier;
      if (original === "failed") return pending("failed");
      if (original === "unknown") return json({ type: "error", error: { type: "rate_limit_error", http_code: "429" } }, 429, { "retry-after": "120" });
    } return pending(); } });
  await f.bridge.submit(f.request, context(f)); due(f); const running = f.bridge.poll(taskId, f.request); await started;
  try {
    await new MiniMaxH3Execution(f.bridgeOptions).poll(taskId, f.request); assert.equal(f.calls.query, 1);
    due(f); await new MiniMaxH3Execution(f.bridgeOptions).poll(taskId, f.request); assert.equal(f.calls.query, 2);
    const schedule = rows(f, "h3_poll_schedule")[0]; release(); await running;
    assert.deepEqual(rows(f, "h3_poll_schedule")[0], schedule);
    if (original === "failed") assert.equal((await f.bridge.lookup(f.request.attemptId)).type, "failed");
    if (original === "unknown") assert.ok(rows(f, "h3_execution_observation").some(row => row.observation.kind === "unknown"));
  } finally { release(); await running; }
  }
});

test("succeeded query stores protected locator before download and retries only known-task observation after download failure", async t => {
  let status = 403;
  const f = fixture(t, { fetch: async (_url, init) => init.method === "POST" ? json({ task_id: taskId }) : completed(String(f.calls.query)), downloadStatus: () => status });
  await f.bridge.submit(f.request, context(f)); due(f); const failed = await f.bridge.poll(taskId, f.request);
  assert.equal(failed.type, "unknown"); assert.equal(rows(f, "execution_output_receipt").length, 1); assert.equal(rows(f, "execution_output_spool").length, 0);
  await f.bridge.poll(taskId, f.request); assert.equal(f.calls.query, 1); assert.equal(f.calls.download, 1);
  status = 200; due(f); const result = await f.bridge.poll(taskId, f.request);
  assert.equal(result.type, "completed"); assert.equal(result.vendorTaskId, taskId); assert.equal(result.outputs[0].sha256, hash(video));
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 2); assert.equal(f.calls.download, 2);
  assert.equal(JSON.stringify(rows(f, "h3_execution_observation")).includes("signature"), false);
  assert.equal(JSON.stringify(result).includes("signature"), false);
  const before = { ...f.calls }; assert.deepEqual(await f.bridge.lookup(f.request.attemptId), result); assert.deepEqual(await f.bridge.poll(taskId, f.request), result);
  await assert.rejects(f.bridge.poll("another-task", f.request), { code: "H3_EXECUTION_CONFLICT" });
  assert.deepEqual(f.calls, before);
});

test("Engine H3 completion flows through raw spool and measured video derivation without another paid attempt", async t => {
  const f = fixture(t, { deferAdmission: true, ingest: true, fetch: async (_url, init) => init.method === "POST" ? json({ task_id: taskId }) : completed() });
  await f.engine.runReady(); assert.equal(attempt(f).phase, "remote_pending"); due(f); await f.engine.reconcile();
  const current = attempt(f), artifact = f.store.get("artifact", current.outputs.video.artifactId), source = f.store.get("media_source", artifact.id);
  assert.equal(current.phase, "succeeded"); assert.equal(current.taskId, taskId); assert.equal(artifact.fixture, false); assert.equal(artifact.physicalDurationSeconds, 6);
  assert.equal(source.source.originalSha256, hash(video)); assert.equal(source.source.probe.video.frames, 180); assert.notEqual(artifact.artifact.sha256, hash(video));
  assert.equal(f.store.get("reservation", current.reservationId).state, "charged"); assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 1); assert.equal(f.calls.download, 1);
  await f.engine.reconcile(); assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 1);
});

test("confirmed H3 failure and cancellation are charged terminal outcomes without technical retry permission", async t => {
  for (const status of ["failed", "cancelled"]) {
    const f = fixture(t, { deferAdmission: true, fetch: async (_url, init) => init.method === "POST" ? json({ task_id: taskId }) : pending(status) });
    await f.engine.runReady(); due(f); await f.engine.reconcile(); const current = attempt(f);
    assert.equal(current.phase, "failed"); assert.equal(current.failure.retryAllowed, false); assert.equal(current.failure.technical, false);
    assert.equal(f.store.get("reservation", current.reservationId).state, "charged");
    assert.equal((await f.bridge.lookup(current.id)).type, "failed"); assert.equal(f.calls.query, 1); assert.equal(f.calls.download, 0);
  }
});

test("an accepted task survives a bridge receipt-write failure through immutable Engine evidence", async t => {
  const f = fixture(t, { deferAdmission: true }), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "h3_execution_submit") throw Error("receipt SQL failure"); return insert(...args); };
  try { await f.engine.runReady(); } finally { f.store.insert = insert; }
  assert.equal(attempt(f).phase, "remote_pending"); assert.equal(attempt(f).taskId, taskId); assert.equal(rows(f, "h3_execution_submit").length, 0);
  await f.engine.reconcile(); assert.equal(rows(f, "h3_execution_submit")[0].observation.taskId, taskId);
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0);
});

test("H3 mapping, dispatch, task identity and polling policy cannot be rewritten", async t => {
  const f = fixture(t); await f.bridge.submit(f.request, context(f));
  for (const kind of ["h3_execution_mapping", "h3_execution_dispatch", "h3_execution_submit"]) {
    const saved = rows(f, kind)[0]; assert.throws(() => f.store.put(kind, saved.id, f.project.id, { ...saved, requestDigest: "0".repeat(64) }));
  }
  const schedule = rows(f, "h3_poll_schedule")[0];
  assert.throws(() => f.store.put("h3_poll_schedule", schedule.id, f.project.id, { ...schedule, taskId: "wrong-task" }));
  assert.throws(() => f.store.put("h3_poll_schedule", schedule.id, f.project.id, { ...schedule, policy: { ...schedule.policy, initialMs: 1000 } }), { code: "IMMUTABLE_RECORD" });
});

test("a marker without a returned task or saved observation never permits another POST after database reopen", async t => {
  const f = fixture(t, { fetch: async () => { throw Error("lost network result"); } }), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "h3_execution_submit") throw Error("crash before observation commit"); return insert(...args); };
  try { assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown"); } finally { f.store.insert = insert; }
  assert.equal(rows(f, "h3_execution_dispatch").length, 1); assert.equal(rows(f, "h3_execution_submit").length, 0);
  f.store.close(); const reopened = new Store(f.path);
  try {
    const bridge = new MiniMaxH3Execution({ ...f.bridgeOptions, store: reopened, outputStore: new ExecutionOutputStore(reopened, { rootDir: join(f.directory, "outputs") }),
      fetch: async () => { throw Error("must not submit"); }, credentials: new EnvironmentMediaCredentials(() => { throw Error("must not read credentials"); }) });
    assert.equal((await bridge.submit(f.request)).type, "unknown"); assert.equal((await bridge.lookup(f.request.attemptId)).type, "unknown"); assert.equal(f.calls.post, 1);
  } finally { reopened.close(); }
});

test("terminal polling evidence recovers after a crash before the cooldown pointer update", async t => {
  const f = fixture(t, { fetch: async (_url, init) => init.method === "POST" ? json({ task_id: taskId }) : pending("failed") });
  await f.bridge.submit(f.request, context(f)); due(f); const put = f.store.put.bind(f.store);
  f.store.put = (...args) => { if (args[0] === "h3_poll_schedule" && args[3].claimId === null) throw Error("crash before schedule completion"); return put(...args); };
  try { await assert.rejects(f.bridge.poll(taskId, f.request), /crash before schedule completion/); } finally { f.store.put = put; }
  assert.equal(rows(f, "h3_execution_observation")[0].observation.kind, "failed"); assert.equal(rows(f, "h3_poll_schedule")[0].lastObservationId, null);
  assert.equal((await f.bridge.lookup(f.request.attemptId)).type, "failed"); assert.equal(f.calls.query, 1); assert.equal(f.calls.post, 1);
});

test("a documented H3 POST rejection releases only its reservation while ambiguous acceptance stays reserved", async t => {
  for (const ambiguous of [false, true]) {
    const f = fixture(t, { deferAdmission: true, fetch: async () => ambiguous ? json({ error: "ambiguous" }, 500)
      : json({ type: "error", error: { type: "authorized_error", http_code: "401" } }, 401) });
    await f.engine.runReady(); const current = attempt(f);
    assert.equal(current.phase, ambiguous ? "submission_unknown" : "failed");
    assert.equal(f.store.get("reservation", current.reservationId).state, ambiguous ? "reserved" : "released");
    assert.equal((await f.bridge.submit(current.request)).type, ambiguous ? "unknown" : "rejected"); assert.equal(f.calls.post, 1);
  }
});

test("late accepted evidence survives both lease theft and bridge receipt-write failure, then restores its exact pollable task", async t => {
  const f = fixture(t, { deferAdmission: true, fetch: async (_url, init) => {
    if (init.method === "POST") {
      const current = attempt(f); f.store.put("attempt", current.id, f.project.id, { ...current, leaseOwner: "replacement-worker", leaseEpoch: current.leaseEpoch + 1 });
      return json({ task_id: taskId });
    }
    return pending();
  } }), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "h3_execution_submit") throw Error("lost bridge receipt write"); return insert(...args); };
  try { await f.engine.runReady(); } finally { f.store.insert = insert; }
  const original = attempt(f); assert.equal(original.taskId, null); assert.equal(original.leaseOwner, "replacement-worker");
  assert.ok(rows(f, "execution_evidence").some(value => value.outcome.type === "accepted" && value.outcome.taskId === taskId));
  f.store.put("attempt", original.id, f.project.id, { ...original, leaseExpiresAt: 0 });
  f.store.close(); const restoredStore = new Store(f.path);
  try {
    const outputs = new ExecutionOutputStore(restoredStore, { rootDir: join(f.directory, "outputs") });
    const bridge = new MiniMaxH3Execution({ ...f.bridgeOptions, store: restoredStore, outputStore: outputs });
    const engine = new Engine(restoredStore, bridge, { artifactDir: f.artifactRoot, profiles: [f.profile], outputStore: outputs });
    await engine.reconcile(); assert.equal(engine.attempts(f.project.id)[0].taskId, taskId); assert.equal(f.calls.post, 1);
    await engine.reconcile(); assert.equal(restoredStore.list("h3_execution_submit", f.project.id)[0].observation.taskId, taskId);
    f.clock.value = restoredStore.list("h3_poll_schedule", f.project.id)[0].nextPollAt;
    await engine.reconcile(); assert.equal(f.calls.query, 1); assert.equal(f.calls.post, 1);
  } finally { restoredStore.close(); }
});
