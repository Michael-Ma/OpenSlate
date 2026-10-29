import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compilePlan, composeScenePlan, digest } from "../../../packages/core/dist/index.js";
import { FalH3LipSyncProvider, falH3LipSyncPriceMicros } from "../../../packages/providers/dist/index.js";
import { FalH3LipSyncExecution } from "../dist/execution/fal-lipsync-execution.js";
import { lipSyncSettings, LIP_SYNC_TAIL_SAMPLES } from "../dist/execution/lip-sync.js";
import { lipSyncRoute } from "../dist/execution/lip-sync-routing.js";
import { lipSyncAudio } from "../dist/media/song-segment.js";
import { sceneRow } from "../dist/scene-row.js";
import { quote } from "../dist/generation-quotes.js";
import { profilePolicy } from "../dist/application/provider-catalog.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { readMediaExecutionConfiguration } from "../dist/application/media-execution-config.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { ProtectedVideoDownloader } from "../dist/execution/video-download.js";
import { SpoolVideoIngestor } from "../dist/execution/spool-video-ingester.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { Engine } from "../dist/execution/engine.js";
import { Store } from "../dist/persistence/store.js";
import { projectFixture } from "./execution-fixture.mjs";

// Every call below goes to a fake fal transport. No request leaves this process.
const key = "offline-fal-id:offline-fal-secret", taskId = "764cabcf-b745-4b3e-ae38-1200304cf45b";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const SUBMIT = "https://queue.fal.run/minimax/h3-max/lip-sync/image-to-video";
const STATUS = `https://queue.fal.run/minimax/h3-max/requests/${taskId}/status`, RESULT = `https://queue.fal.run/minimax/h3-max/requests/${taskId}`;
const INITIATE = "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";
const SONG_SECONDS = 20, SONG_SAMPLES = SONG_SECONDS * 48000;
const profile = { id: "fal-lipsync-768p", revision: "1", kind: "video", adapter: "fal-h3-lipsync", executionVersion: "1",
  configuration: { model: "minimax/h3-max/lip-sync/image-to-video", settings: { resolution: "768P" } },
  minFrames: 150, maxFrames: 450, maxConcurrency: 1, unitCostMicros: "1300000", maxRetries: 0 };

let temporary, png, video;
function stereoSong(samples) {
  const data = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) { data.writeInt16LE(i % 30000, i * 4); data.writeInt16LE(-(i % 20000), i * 4 + 2); }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8, "ascii"); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write("data", 36, "ascii"); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "openslate-fal-fixtures-"));
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=320x320", "-frames:v", "1", "-threads", "1", join(temporary, "frame.png")], { timeout: 30000 });
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=24", "-t", "6.2", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", join(temporary, "raw.mp4")], { timeout: 30000 });
  png = await readFile(join(temporary, "frame.png")); video = await readFile(join(temporary, "raw.mp4"));
});
after(async () => rm(temporary, { recursive: true, force: true }));

/** Default fake fal: uploads succeed, the POST is accepted, the request is still running. */
function falRoute(calls, overrides = {}) {
  return async (url, init) => {
    calls.log.push(`${init.method} ${url}`);
    if (url === INITIATE) { calls.initiate++; const body = JSON.parse(init.body);
      return overrides.initiate?.(body) ?? json({ upload_url: `https://upload.example.test/put/${calls.initiate}`, file_url: `https://v3.fal.media/files/${calls.initiate}/${body.file_name}` }); }
    if (url.startsWith("https://upload.example.test/")) { calls.put++; calls.uploads.push({ headers: init.headers, bytes: Buffer.from(init.body) }); return overrides.put?.() ?? new Response(null, { status: 200 }); }
    if (url === SUBMIT) { calls.post++; calls.bodies.push(init.body); return overrides.submit ? overrides.submit(init) : json({ request_id: taskId, status_url: STATUS, response_url: RESULT, queue_position: 0 }); }
    if (url === STATUS) { calls.status++; return overrides.status?.() ?? json({ status: "IN_PROGRESS", request_id: taskId }, 202); }
    if (url === RESULT) { calls.result++; return overrides.result?.() ?? json({ video: { url: "https://media.example.test/lipsync.mp4" }, seed: 7, duration: 6.2 }); }
    throw Error(`unexpected fal call ${init.method} ${url}`);
  };
}

function fixture(t, options = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "openslate-fal-execution-"))), path = join(directory, "store.sqlite");
  const store = new Store(path), project = projectFixture(randomUUID(), 1), artifactRoot = join(directory, "artifacts"); mkdirSync(artifactRoot);
  const reference = { artifactId: randomUUID(), kind: "image", sha256: hash(png) };
  const song = stereoSong(SONG_SAMPLES), songPath = join(directory, "song.wav"); writeFileSync(songPath, song);
  const audioId = "song-1", songSha = hash(song);
  project.artifacts = [reference]; project.shots[0].performance = "singing"; project.soundtrack = { audioId, gainMilliDb: 0, startFrame: options.startFrame ?? 0 };
  store.createProject(project);
  store.insert("narration_audio", audioId, project.id, { id: audioId, projectId: project.id, role: "music", declaredOrigin: "uploaded", requestId: "import",
    media: { id: audioId, artifactId: audioId, kind: "audio", originalSha256: songSha, originalByteLength: song.length, sha256: songSha, byteLength: song.length,
      probe: { durationSeconds: SONG_SECONDS, audio: { samples: SONG_SAMPLES, sampleRate: 48000, channels: 2 } }, toolchainDigest: "c".repeat(64) } });
  const imagePath = join(artifactRoot, `${reference.artifactId}.png`); writeFileSync(imagePath, png);
  store.insert("artifact", reference.artifactId, project.id, { artifact: reference, path: imagePath, mimeType: "image/png", fixture: false,
    origin: "supplied_image", attemptId: null, physicalDurationSeconds: null, byteLength: png.length, width: 320, height: 320,
    validationDigest: digest({ sha256: reference.sha256, syntheticDecode: true }) });
  const outputs = new ExecutionOutputStore(store, { rootDir: join(directory, "outputs") }), clock = { value: Date.now() };
  const calls = { initiate: 0, put: 0, post: 0, status: 0, result: 0, download: 0, credentials: 0, log: [], bodies: [], uploads: [] };
  const credentials = new EnvironmentMediaCredentials(name => { calls.credentials++; assert.equal(name, "OPENSLATE_FAL_API_KEY"); return options.credential ? options.credential() : key; });
  const fetch = options.fetch ? async (url, init) => { calls.log.push(`${init.method} ${url}`); if (url === SUBMIT) calls.post++; return options.fetch(url, init); } : falRoute(calls, options.fal);
  const downloader = new ProtectedVideoDownloader({ allowedHosts: ["media.example.test"], lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    request: (args, callback) => {
      calls.download++; const client = new EventEmitter(); let body, destroyed = false;
      client.destroy = () => { if (!destroyed) { destroyed = true; args.signal.removeEventListener("abort", abort); body?.destroy(); queueMicrotask(() => client.emit("close")); } return client; };
      const abort = () => { body?.destroy(Error("cancelled")); client.emit("error", Error("cancelled")); client.destroy(); };
      args.signal.addEventListener("abort", abort, { once: true });
      client.end = () => queueMicrotask(() => { body = Readable.from([video]); body.on("error", () => {}); body.statusCode = 200;
        body.headers = { "content-type": "video/mp4", "content-length": String(video.length) }; callback(body); }); return client;
    } });
  const songSource = async input => { assert.equal(input.audioId, audioId); assert.equal(input.sha256, songSha); return songPath; };
  const bridgeOptions = { store, outputStore: outputs, artifactRoot, credentials, downloader, songSource, fetch, timeoutMs: 10000, now: () => clock.value };
  const bridge = new FalH3LipSyncExecution(bridgeOptions);
  const media = options.ingest ? new LocalMediaService({ rootDir: join(directory, "normalized"), allowedInputRoots: [outputs.rootDir], ffmpegPath, ffprobePath }) : undefined;
  const engine = new Engine(store, bridge, { artifactDir: artifactRoot, profiles: [profile], outputStore: outputs,
    ...(media ? { outputIngestor: new SpoolVideoIngestor(outputs, media, { rootDir: join(directory, "derivations") }) } : {}),
    externalAdmission: { authorize: claim => { const id = randomUUID(); store.insert("offline_fal_allowance", id, claim.projectId, { attemptId: claim.attemptId }); return { allowanceId: id }; } } });
  const shot = project.shots[0], settings = { lipSync: lipSyncSettings(project, shot.id, { audioId, sha256: songSha, samples: SONG_SAMPLES }, 180) };
  const q = JSON.stringify;
  const source = `definePlan({baseRevision:${q(project.revisionId)}},p=>{const shot=p.shot(${q(shot.id)});const frame=p.asset(${q(reference.artifactId)});const review=p.humanReview("review",{shots:[{intent:shot,keyframe:frame,videoProfile:${q(profile.id)},motionPrompt:${q(shot.videoPrompt)},seconds:6,settings:${q(settings)}}]});return p.video("video",{intent:shot,profile:${q(profile.id)},firstFrame:p.approvedImage(frame,review),prompt:${q(shot.videoPrompt)},seconds:6,settings:${q(settings)}});});`;
  const plan = compilePlan(source, { project, profiles: [profile], logicalIds: {}, allocateId: randomUUID }), node = plan.nodes.find(node => node.kind === "video"), planId = randomUUID();
  const grant = engine.createGrant(project.id, shot.id, "video", "offline-human", "initial_slot"); engine.installPlan(project.id, planId, plan, { [node.id]: grant.id });
  store.saveProject({ ...project, activePlanId: planId }, 0); const review = engine.reviewSnapshot(project.id); engine.approve(project.id, review.id, [node.id], "offline-review");
  const admit = () => engine.admit(project.id, node.id, engine.resolveInputs(project.id, node).fingerprint), attempt = options.deferAdmission ? undefined : admit();
  t.after(() => { if (store.db.open) store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, path, store, project, reference, profile, outputs, clock, calls, bridgeOptions, bridge, engine, attempt, request: attempt?.request, settings, songPath, song };
}
const rows = (f, kind) => f.store.list(kind, f.project.id);
const context = f => ({ expectedLease: { owner: f.attempt.leaseOwner, epoch: f.attempt.leaseEpoch } });
const attempt = f => f.engine.attempts(f.project.id)[0];
const due = f => { f.clock.value = rows(f, "fal_lipsync_poll_schedule")[0].nextPollAt; };
const wake = f => { const { unknownWait: _wait, ...current } = attempt(f); f.store.put("attempt", current.id, f.project.id, { ...current, leaseExpiresAt: 0 }); };

test("submit uploads the keyframe and the shot's song segment, then POSTs one fal queue request with the Key header", async t => {
  const f = fixture(t);
  assert.deepEqual(await f.bridge.submit(f.request, context(f)), { type: "accepted", taskId });
  assert.deepEqual(f.calls.log, [`POST ${INITIATE}`, "PUT https://upload.example.test/put/1", `POST ${INITIATE}`, "PUT https://upload.example.test/put/2", `POST ${SUBMIT}`]);
  // The presigned PUT never carries the API key.
  for (const upload of f.calls.uploads) assert.equal(upload.headers.Authorization, undefined);
  assert.deepEqual(f.calls.uploads[0].bytes, png);
  const body = JSON.parse(f.calls.bodies[0]), wav = f.calls.uploads[1].bytes;
  assert.deepEqual(body, { image_url: "https://v3.fal.media/files/1/keyframe-" + hash(png).slice(0, 16) + ".png", audio_url: `https://v3.fal.media/files/2/song-${hash(wav).slice(0, 16)}.wav`,
    resolution: "768P", enable_transcription: false, enable_safety_checker: true });
  // 6 s clip + 0.2 s tail of mono 48 kHz PCM16: the output lasts as long as this audio.
  assert.equal(wav.length, 44 + (180 * 1600 + LIP_SYNC_TAIL_SAMPLES) * 2); assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt32LE(24), 48000);
  const mapping = rows(f, "fal_lipsync_execution_mapping")[0], dispatch = rows(f, "fal_lipsync_execution_dispatch")[0];
  assert.equal(dispatch.bodySha256, hash(f.calls.bodies[0])); assert.equal(dispatch.mappingDigest, digest(mapping));
  assert.deepEqual(mapping.lipSync, f.settings.lipSync); assert.equal(mapping.transport.audio.sha256, hash(wav));
  // Replays never POST again.
  assert.deepEqual(await f.bridge.submit(f.request), { type: "accepted", taskId }); assert.deepEqual(await f.bridge.lookup(f.request.attemptId), { type: "accepted", taskId });
  assert.equal(f.calls.post, 1); assert.equal(f.calls.initiate, 2);
  const saved = JSON.stringify([rows(f, "fal_lipsync_execution_mapping"), rows(f, "fal_lipsync_execution_dispatch"), rows(f, "fal_lipsync_execution_submit")]);
  assert.equal(saved.includes(key), false); assert.equal(saved.includes("fal.media"), false); assert.equal(saved.includes(f.directory), false);
});

test("the song segment is cut from the film clock, downmixed, and padded with silence where the music has not started", async t => {
  const f = fixture(t, { startFrame: 30 });
  const shot = f.project.shots[0], settings = lipSyncSettings(f.store.getProject(f.project.id), shot.id, { audioId: "song-1", sha256: hash(f.song), samples: SONG_SAMPLES }, 180);
  assert.deepEqual(settings, { version: 1, audio: "mix", audioId: "song-1", sha256: hash(f.song), startSample: 0, durationSamples: 180 * 1600 + LIP_SYNC_TAIL_SAMPLES - 48000,
    shotOffsetSamples: 48000, clipSamples: 180 * 1600 + LIP_SYNC_TAIL_SAMPLES });
  const wav = await lipSyncAudio(f.songPath, settings);
  assert.equal(wav.readInt16LE(44 + 47999 * 2), 0, "silent before the music starts");
  // Sample 1 of the song: L=1, R=-1 -> mono 0; sample 10 of the song: (10 + -10)/2 = 0; check an asymmetric one.
  const at = 25000, left = at % 30000, right = -(at % 20000);
  assert.equal(wav.readInt16LE(44 + (48000 + at) * 2), Math.round((left + right) / 2));
  // Music that never plays under the shot: no lip sync.
  assert.equal(lipSyncSettings({ ...f.store.getProject(f.project.id), soundtrack: { audioId: "song-1", gainMilliDb: 0, startFrame: 600 } }, shot.id, { audioId: "song-1", sha256: hash(f.song), samples: SONG_SAMPLES }, 180), null);
});

test("polling waits for its cooldown, reads status, then fetches the result and completes through the measured video derivation", async t => {
  let state = "IN_QUEUE";
  const f = fixture(t, { deferAdmission: true, ingest: true, fal: { status: () => state === "done" ? json({ status: "COMPLETED", request_id: taskId }) : json({ status: state, request_id: taskId }, 202) } });
  await f.engine.runReady(); assert.equal(attempt(f).phase, "remote_pending"); assert.equal(attempt(f).taskId, taskId);
  await f.engine.reconcile(); assert.equal(f.calls.status, 0, "cooldown first");
  due(f); await f.engine.reconcile(); assert.equal(f.calls.status, 1); assert.equal(attempt(f).phase, "remote_pending");
  state = "done"; due(f); await f.engine.reconcile();
  const current = attempt(f), artifact = f.store.get("artifact", current.outputs.video.artifactId);
  assert.equal(current.phase, "succeeded"); assert.equal(artifact.fixture, false); assert.equal(f.store.get("reservation", current.reservationId).state, "charged");
  assert.equal(f.calls.post, 1); assert.equal(f.calls.status, 2); assert.equal(f.calls.result, 1); assert.equal(f.calls.download, 1);
  await f.engine.reconcile(); assert.equal(f.calls.post, 1); assert.equal(f.calls.result, 1);
});

test("a fal refusal before any request id is not charged; a failed free upload never reaches the paid POST", async t => {
  for (const mode of ["refused", "upload"]) {
    const f = fixture(t, { deferAdmission: true, fal: mode === "refused"
      ? { submit: () => json({ detail: [{ loc: ["body", "image_url"], msg: "Face not found", type: "face_detection_error", url: "https://docs.fal.ai/errors" }] }, 422) }
      : { put: () => new Response("denied", { status: 403 }) } });
    await f.engine.runReady(); const current = attempt(f);
    assert.equal(current.phase, "failed"); assert.equal(f.store.get("reservation", current.reservationId).state, "released");
    assert.equal(f.engine.budget(f.project.id).committedMicros, "0");
    const submit = rows(f, "fal_lipsync_execution_submit")[0];
    if (mode === "refused") { assert.equal(f.calls.post, 1); assert.equal(submit.observation.kind, "rejected"); assert.equal(submit.observation.error.errorType, "face_detection_error"); }
    else { assert.equal(f.calls.post, 0); assert.equal(rows(f, "fal_lipsync_execution_dispatch").length, 0); assert.equal(submit.observation.code, "LOCAL_UPLOAD_FAILED"); }
    await f.engine.reconcile(); await f.engine.runReady(); assert.equal(f.engine.attempts(f.project.id).length, 1);
  }
});

test("a lost submission reply is never resubmitted: it stays in flight to the cross-host deadline, then counts as possibly charged", async t => {
  const f = fixture(t, { deferAdmission: true, fal: { submit: () => { throw Error("connection reset after send"); } } });
  await f.engine.runReady(); const dispatch = rows(f, "fal_lipsync_execution_dispatch")[0];
  assert.equal(attempt(f).phase, "submission_unknown"); assert.equal(f.calls.post, 1);
  assert.equal(f.store.get("reservation", attempt(f).reservationId).state, "reserved");
  f.clock.value = dispatch.createdAt + 119999; wake(f); await f.engine.reconcile(); assert.equal(attempt(f).phase, "submission_unknown");
  f.clock.value += 1; wake(f); await f.engine.reconcile();
  const final = attempt(f); assert.equal(final.phase, "failed"); assert.equal(final.failure.id, "SUBMISSION_RESPONSE_LOST"); assert.equal(final.failure.retryAllowed, false);
  assert.equal(f.store.get("reservation", final.reservationId).state, "charged");
  for (let cycle = 0; cycle < 4; cycle++) { await f.engine.reconcile(); assert.equal((await f.engine.runReady()).dispatched, 0); }
  // A fresh bridge after restart reads no key and makes no call.
  const restarted = new FalH3LipSyncExecution({ ...f.bridgeOptions, credentials: new EnvironmentMediaCredentials(() => { throw Error("must not read keys"); }), fetch: async () => { throw Error("must not call fal"); } });
  assert.equal((await restarted.submit(final.request)).type, "failed"); assert.equal(f.calls.post, 1); assert.equal(f.engine.attempts(f.project.id).length, 1);
});

test("an ambiguous 5xx POST stays unknown and reserved, unlike a documented refusal", async t => {
  const f = fixture(t, { deferAdmission: true, fal: { submit: () => json({ detail: "runner_server_error", error_type: "runner_server_error" }, 500) } });
  await f.engine.runReady(); const current = attempt(f);
  assert.equal(current.phase, "submission_unknown"); assert.equal(f.store.get("reservation", current.reservationId).state, "reserved");
  assert.equal((await f.bridge.submit(current.request)).type, "unknown"); assert.equal(f.calls.post, 1);
});

test("accepted, then failed on fal: a terminal failure that may be charged, with no automatic retry", async t => {
  const f = fixture(t, { deferAdmission: true, fal: { status: () => json({ status: "COMPLETED", request_id: taskId, error: "Generation failed", error_type: "generation_timeout" }) } });
  await f.engine.runReady(); due(f); await f.engine.reconcile();
  const current = attempt(f); assert.equal(current.phase, "failed"); assert.equal(current.failure.retryAllowed, false); assert.equal(current.failure.technical, false);
  assert.equal(f.store.get("reservation", current.reservationId).state, "charged");
  assert.equal(rows(f, "fal_lipsync_execution_observation")[0].observation.error.errorType, "generation_timeout");
  assert.equal((await f.bridge.lookup(current.id)).type, "failed"); assert.equal(f.calls.result, 0); assert.equal(f.calls.download, 0); assert.equal(f.calls.post, 1);
});

test("unknown polling answers keep the request and only poll again after backoff", async t => {
  const f = fixture(t, { fal: { status: () => json({ detail: "rate limited" }, 429, { "retry-after": "30" }) } });
  await f.bridge.submit(f.request, context(f)); due(f);
  assert.deepEqual(await f.bridge.poll(taskId, f.request), { type: "unknown", diagnostic: "Lip-sync polling unresolved: FAL_RATE_LIMITED", taskId });
  const schedule = rows(f, "fal_lipsync_poll_schedule")[0]; assert.ok(schedule.nextPollAt - f.clock.value >= 30000);
  assert.equal((await f.bridge.poll(taskId, f.request)).type, "accepted"); assert.equal(f.calls.status, 1); assert.equal(f.calls.post, 1);
});

test("the reviewed song window is rechecked before dispatch: moving the music refuses without a POST", async t => {
  const f = fixture(t), project = f.store.getProject(f.project.id);
  f.store.saveProject({ ...project, soundtrack: { ...project.soundtrack, startFrame: 15 } }, project.headVersion);
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected");
  assert.equal(f.calls.post, 0); assert.equal(f.calls.initiate, 0); assert.equal(rows(f, "fal_lipsync_execution_submit")[0].observation.code, "LOCAL_INPUT_INVALID");
});

test("missing fal key is a recorded pre-dispatch refusal", async t => {
  const f = fixture(t, { credential: () => undefined });
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected");
  assert.equal(rows(f, "fal_lipsync_execution_submit")[0].observation.code, "LOCAL_CREDENTIAL_UNAVAILABLE"); assert.equal(f.calls.log.length, 0);
});

test("fal receipts cannot be rewritten", async t => {
  const f = fixture(t); await f.bridge.submit(f.request, context(f));
  for (const kind of ["fal_lipsync_execution_mapping", "fal_lipsync_execution_dispatch", "fal_lipsync_execution_submit"]) {
    const saved = rows(f, kind)[0]; assert.throws(() => f.store.put(kind, saved.id, f.project.id, { ...saved, requestDigest: "0".repeat(64) }));
  }
  const schedule = rows(f, "fal_lipsync_poll_schedule")[0];
  assert.throws(() => f.store.put("fal_lipsync_poll_schedule", schedule.id, f.project.id, { ...schedule, taskId: "another-request-id" }));
  assert.throws(() => f.store.put("fal_lipsync_poll_schedule", schedule.id, f.project.id, { ...schedule, policy: { ...schedule.policy, initialMs: 1000 } }), { code: "IMMUTABLE_RECORD" });
  const submit = rows(f, "fal_lipsync_execution_submit")[0];
  assert.throws(() => f.store.put("fal_lipsync_execution_submit", submit.id, f.project.id, { ...submit, observedAt: submit.observedAt + 1 }), { code: "IMMUTABLE_RECORD" });
});

test("quotes price lip sync per second of audio by resolution, with the long-clip multiplier", () => {
  assert.equal(falH3LipSyncPriceMicros("768P", 6.2), 496000);
  assert.equal(falH3LipSyncPriceMicros("480P", 10), 500000); assert.equal(falH3LipSyncPriceMicros("1080P", 1), 160000); assert.equal(falH3LipSyncPriceMicros("2K", 1), 320000);
  assert.equal(falH3LipSyncPriceMicros("768P", 15), 1200000); assert.equal(falH3LipSyncPriceMicros("768P", 15.2), Math.ceil(15.2 * 80000 * 1.2));
  const viggle = { id: "viggle", revision: "1", kind: "video", adapter: "viggle-h3", executionVersion: "1", configuration: { model: "MiniMax-H3", settings: { quality: "low", resolution: "768p", aspectRatio: "16:9" } },
    minFrames: 90, maxFrames: 450, maxConcurrency: 1, unitCostMicros: "150000", maxRetries: 0 };
  const lock = { profiles: [viggle, profile] };
  const rowsToQuote = [{ imageComplete: true, videoComplete: false, videoProfileLabel: profile.id, durationFrames: 180 },
    { imageComplete: true, videoComplete: false, videoProfileLabel: viggle.id, durationFrames: 180 },
    { imageComplete: true, videoComplete: true, videoProfileLabel: profile.id, durationFrames: 450 }];
  assert.deepEqual(quote(lock, rowsToQuote, "confirmVideo"), { micros: String(496000 + 150000), units: 2, unitMicros: "0", priceUnknown: false });
  // The installed profile's flat estimate reserves at least the longest clip at the published price.
  assert.equal(profilePolicy(profile).credential, "fal-video");
  assert.throws(() => profilePolicy({ ...profile, unitCostMicros: "1000000" }), { code: "PROVIDER_CATALOG_INVALID" });
  assert.throws(() => profilePolicy({ ...profile, configuration: { ...profile.configuration, settings: { resolution: "4K" } } }), { code: "PROVIDER_CATALOG_INVALID" });
  assert.throws(() => profilePolicy({ ...profile, minFrames: 120 }), { code: "PROVIDER_CATALOG_INVALID" });
});

test("a fal key enables lip sync with the default fal CDN download hosts; without one the configuration reads as before", () => {
  assert.deepEqual(readMediaExecutionConfiguration({}), { image: false, codexImage: false, h3: false, speech: false, transcription: false, h3DownloadHosts: [], viggleH3: false, viggleH3DownloadHosts: [] });
  const configured = readMediaExecutionConfiguration({ OPENSLATE_FAL_API_KEY: "id:secret" });
  assert.equal(configured.falLipSync, true); assert.deepEqual(configured.falLipSyncDownloadHosts, ["v3.fal.media", "v3b.fal.media", "fal.media"]);
  assert.equal(readMediaExecutionConfiguration({ OPENSLATE_FAL_API_KEY: "id:secret", OPENSLATE_ENABLE_FAL_LIPSYNC: "0" }).falLipSync, undefined);
});

test("singing shots route to the lip-sync profile with their song window; ordinary shots stay on the video profile", () => {
  const viggle = { id: "viggle", revision: "1", kind: "video", adapter: "viggle-h3", executionVersion: "1", configuration: { model: "MiniMax-H3", settings: { quality: "low", resolution: "768p", aspectRatio: "16:9" } },
    minFrames: 90, maxFrames: 450, maxConcurrency: 1, unitCostMicros: "150000", maxRetries: 0 };
  const image = { id: "fake-image-v1", revision: "1", kind: "image", adapter: "fake", maxConcurrency: 2, unitCostMicros: "100", maxRetries: 1 };
  const project = projectFixture(randomUUID(), 2);
  project.shots[0].performance = "singing"; project.soundtrack = { audioId: "song-1", gainMilliDb: 0 };
  const audio = { id: "song-1", projectId: project.id, media: { kind: "audio", sha256: "a".repeat(64), probe: { audio: { samples: SONG_SAMPLES, sampleRate: 48000, channels: 2 } } } };
  const store = { get: (kind, id) => kind === "narration_audio" && id === "song-1" ? audio : undefined };
  const lock = { profiles: [image, viggle, profile] };
  const context = (route) => ({ snapshot: { project, outputs: [], attempts: [], currentAttemptIds: [] }, plan: null, lock, profiles: { image, video: viggle },
    holds: [], review: null, bindings: [], approvals: [], fixtures: {}, lipSync: route });
  const singing = lipSyncRoute(store, project, lock, project.shots[0]), ordinary = lipSyncRoute(store, project, lock, project.shots[1]);
  assert.equal(singing.state, "planned"); assert.equal(ordinary, null);
  const sung = sceneRow(project.shots[0], context(singing)), plain = sceneRow(project.shots[1], context(ordinary));
  assert.equal(sung.videoProfileLabel, profile.id); assert.equal(sung.durationFrames, 180);
  assert.deepEqual(sung.videoSettings, { lipSync: lipSyncSettings(project, project.shots[0].id, { audioId: "song-1", sha256: "a".repeat(64), samples: SONG_SAMPLES }, 180) });
  assert.deepEqual(sung.lipSync, { state: "planned", profileId: profile.id });
  assert.equal(plain.videoProfileLabel, viggle.id); assert.deepEqual(plain.videoSettings, {}); assert.equal("lipSync" in plain, false);
  // No lip-sync profile pinned, or no song: honest fallback to the normal model.
  assert.deepEqual(lipSyncRoute(store, project, { profiles: [image, viggle] }, project.shots[0]), { state: "unavailable", reason: "no_profile" });
  assert.deepEqual(lipSyncRoute(store, { ...project, soundtrack: null }, lock, project.shots[0]), { state: "unavailable", reason: "no_song" });
  const fallback = sceneRow(project.shots[0], context({ state: "unavailable", reason: "no_song" }));
  assert.equal(fallback.videoProfileLabel, viggle.id); assert.deepEqual(fallback.lipSync, { state: "unavailable", reason: "no_song" });
  // Direction text alone never routes to paid lip sync.
  assert.equal(lipSyncRoute(store, project, lock, { ...project.shots[1], purpose: "She sings the chorus" }), null);
});

test("scene composition binds the reviewed lip-sync settings into both the review and the video", () => {
  const project = projectFixture(randomUUID(), 1), shot = project.shots[0];
  const image = { id: "fake-image-v1", revision: "1", kind: "image", adapter: "fake", maxConcurrency: 2, unitCostMicros: "100", maxRetries: 1 };
  const settings = { lipSync: { version: 1, audio: "mix", audioId: "song-1", sha256: "a".repeat(64), startSample: 0, durationSamples: 297600, shotOffsetSamples: 0, clipSamples: 297600 } };
  const context = { project, profiles: [image, profile], logicalIds: {}, allocateId: randomUUID };
  const keyframes = composeScenePlan(null, [{ shotId: shot.id, kind: "image", profileId: image.id }], context);
  const frameNode = keyframes.nodes.find(row => row.kind === "image"), frame = { artifactId: randomUUID(), kind: "image", sha256: "b".repeat(64) };
  const compiled = composeScenePlan(keyframes, [{ shotId: shot.id, kind: "video", profileId: profile.id, frame, frameNodeId: frameNode.id, settings }], context);
  const node = compiled.nodes.find(row => row.kind === "video");
  assert.equal(node.profileId, profile.id); assert.deepEqual(node.args.settings, settings); assert.equal(node.args.durationFrames, 180);
  assert.equal(compiled.gates.length, 1);
  assert.throws(() => composeScenePlan(null, [{ shotId: shot.id, kind: "image", profileId: image.id, settings }], { project, profiles: [image, profile], logicalIds: {}, allocateId: randomUUID }),
    { code: "SCENE_PLAN_INVALID" });
});

test("the fal transport maps queue status, refusals and malformed answers without guessing", async () => {
  const answer = (handler) => new FalH3LipSyncProvider({ apiKey: key, fetch: async (url, init) => handler(url, init) });
  const body = JSON.stringify({ image_url: "https://v3.fal.media/a.png", audio_url: "https://v3.fal.media/a.wav", resolution: "768P", enable_transcription: false, enable_safety_checker: true });
  const sha = hash(body);
  const header = await answer(async (_url, init) => { assert.equal(init.headers.Authorization, `Key ${key}`); return json({ request_id: taskId }); }).submit(body, sha);
  assert.equal(header.kind, "accepted");
  assert.equal((await answer(async () => json({ detail: "bad key" }, 401)).submit(body, sha)).error.category, "auth");
  assert.equal((await answer(async () => json({ detail: "slow down" }, 429)).submit(body, sha)).kind, "rejected");
  assert.equal((await answer(async () => json({ ok: true })).submit(body, sha)).kind, "unknown");
  assert.equal((await answer(async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.test" } })).submit(body, sha)).kind, "unknown");
  assert.equal((await answer(async () => { throw Error("never sent"); }).submit(body, "0".repeat(64))).kind, "rejected", "a changed body is refused locally");
  assert.equal((await answer(async () => json({ status: "IN_QUEUE", request_id: taskId, queue_position: 3 }, 202)).poll(taskId)).status, "queued");
  assert.equal((await answer(async () => json({ status: "MYSTERY" })).poll(taskId)).kind, "unknown");
  assert.equal((await answer(async () => json({ status: "IN_PROGRESS", request_id: "someone-else-1234" })).poll(taskId)).kind, "unknown");
  const leaked = await answer(async url => url.endsWith("/status") ? json({ status: "COMPLETED" }) : json({ video: { url: `https://v3.fal.media/x.mp4?k=${key}` } })).poll(taskId);
  assert.equal(leaked.kind, "unknown", "an output URL carrying the key is never trusted");
  const modelError = await answer(async url => url.endsWith("/status") ? json({ status: "COMPLETED" }) : json({ detail: [{ loc: ["body"], msg: "x", type: "no_media_generated", url: "u" }] }, 422)).poll(taskId);
  assert.equal(modelError.kind, "failed"); assert.equal(modelError.error.errorType, "no_media_generated");
  assert.equal((await answer(async () => json({})).poll("../escape")).kind, "unknown");
});

test("shotPerformance marks a shot as singing (or not) as one undoable edit that keeps every current clip", async t => {
  const { setup } = await import("./execution-fixture.mjs");
  const { ProductionService } = await import("../dist/application/service.js");
  const { editStoryboard } = await import("../dist/storyboard.js");
  const f = setup(t), service = new ProductionService(f.store, f.engine);
  const edit = (body, key = randomUUID()) => editStoryboard(service, f.projectId, { expectedHeadVersion: f.store.getProject(f.projectId).headVersion, ...body }, key);
  const before = f.store.getProject(f.projectId), [a, b] = before.shots, bindings = f.store.list("node_binding", f.projectId);
  assert.equal("performance" in a, false, "ordinary shots carry no performance field");
  const receipt = edit({ kind: "shotPerformance", id: a.id, value: "singing" });
  const after = f.store.getProject(f.projectId);
  assert.equal(after.shots[0].performance, "singing"); assert.equal("performance" in after.shots[1], false);
  assert.equal(after.shots[0].promptIntent.video, a.promptIntent.video, "intent digests are unchanged");
  for (const binding of bindings) assert.equal(f.store.get("node_binding", binding.id).candidateId, binding.candidateId);
  edit({ kind: "undo", commandId: receipt.commandId }); assert.equal("performance" in f.store.getProject(f.projectId).shots[0], false);
  edit({ kind: "shotPerformance", id: a.id, value: "singing" }); edit({ kind: "shotPerformance", id: a.id, value: "none" });
  assert.equal("performance" in f.store.getProject(f.projectId).shots[0], false);
  for (const value of ["rapping", undefined]) assert.throws(() => edit({ kind: "shotPerformance", id: b.id, value }), { code: "VALIDATION_ERROR" });
  assert.throws(() => edit({ kind: "shotPerformance", id: "foreign", value: "singing" }), { code: "NOT_FOUND" });
});

test("new real-video projects pin the ready lip-sync profile after the chosen ones; it is never selectable as the video model", async t => {
  const { ProductionService } = await import("../dist/application/service.js");
  const { InstalledProviderCatalog } = await import("../dist/application/provider-catalog.js");
  const { ExecutionRegistry, FakeProvider, registerExecutionProvider } = await import("../../../packages/providers/dist/index.js");
  const directory = mkdtempSync(join(tmpdir(), "openslate-fal-catalog-")), store = new Store(join(directory, "store.sqlite"));
  const fake = new FakeProvider(join(directory, "fake.sqlite")), engine = new Engine(store, fake, { artifactDir: join(directory, "artifacts") });
  t.after(() => { fake.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const viggle = { id: "viggle", revision: "1", kind: "video", adapter: "viggle-h3", executionVersion: "1", configuration: { model: "MiniMax-H3", settings: { quality: "low", resolution: "768p", aspectRatio: "16:9" } },
    minFrames: 90, maxFrames: 450, maxConcurrency: 1, unitCostMicros: "150000", maxRetries: 0 };
  const port = adapter => registerExecutionProvider({ submit: async () => { throw Error("No provider calls"); }, lookup: async () => { throw Error("No provider calls"); }, poll: async () => { throw Error("No provider calls"); } }, { adapter, version: "1" });
  const catalogFor = keys => new InstalledProviderCatalog({ configuration: { version: 1, profiles: [{ label: "Lip sync", profile }, { label: "Viggle", profile: viggle }] },
    registry: new ExecutionRegistry([port("viggle-h3"), port("fal-h3-lipsync")]), credentials: new EnvironmentMediaCredentials(name => keys.includes(name) ? "set" : undefined),
    mediaTools: { image: true, video: true }, enabledExecutions: [{ adapter: "viggle-h3", version: "1" }, { adapter: "fal-h3-lipsync", version: "1" }] });
  const ready = catalogFor(["OPENSLATE_VIGGLE_API_KEY", "OPENSLATE_FAL_API_KEY"]);
  assert.deepEqual(ready.lipSyncProfiles(), [profile]); assert.deepEqual(catalogFor(["OPENSLATE_VIGGLE_API_KEY"]).lipSyncProfiles(), [], "no fal key, no pin");
  assert.throws(() => ready.select(ready.digest, [profile.id]), { code: "PROVIDER_SELECTION_INVALID" });
  const service = new ProductionService(store, engine, undefined, { newProjectLocalExecution: { adapter: "local-media", version: "1" }, newProjectLocalExecutionFor: "external-video",
    newProjectLipSyncProfiles: ready.lipSyncProfiles() });
  const project = service.createProject("Music video", ready.select(ready.digest, [viggle.id]));
  const lock = store.get("capability_lock", project.capabilityLockId);
  assert.deepEqual(lock.profiles.filter(row => row.kind === "video").map(row => row.id), ["viggle", profile.id]);
  assert.equal(lock.profiles.find(row => row.kind === "video").id, "viggle", "the first video profile is still the chosen one");
  // The demo (no selection) never gains a paid route.
  const demo = service.createProject("Demo");
  assert.equal(store.get("capability_lock", demo.capabilityLockId).profiles.some(row => row.adapter === "fal-h3-lipsync"), false);
});
