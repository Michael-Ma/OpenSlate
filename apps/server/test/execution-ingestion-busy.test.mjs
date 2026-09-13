import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../../../packages/core/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { SpoolVideoIngestor } from "../dist/execution/spool-video-ingester.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { setup } from "./execution-fixture.mjs";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
let directory, raw;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openslate-busy-video-")); const path = join(directory, "raw.mp4");
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30", "-t", "6",
    "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", path], { timeout: 30000 });
  raw = await readFile(path);
});
after(async () => rm(directory, { recursive: true, force: true }));

async function fixture(t) {
  const f = setup(t, { count: 2 }); await f.engine.runReady(); await f.engine.reconcile();
  const review = f.engine.reviewSnapshot(f.projectId); f.engine.approve(f.projectId, review.id, review.members.map(member => member.videoNodeId), "human-review");
  const normalizerStarted = Promise.withResolvers(), releaseNormalizer = Promise.withResolvers(), busyObserved = Promise.withResolvers(), releaseBusy = Promise.withResolvers();
  const calls = { submit: 0, poll: 0, lookup: 0, normalize: 0 }; let firstPreparation = true, store = f.store, engine;
  const createEngine = () => {
    const outputStore = new ExecutionOutputStore(store, { rootDir: join(f.directory, "outputs") });
    const media = new LocalMediaService({ rootDir: join(f.directory, "normalized"), allowedInputRoots: [outputStore.rootDir], ffmpegPath, ffprobePath });
    const describe = media.describeNormalization.bind(media), normalize = media.importMedia.bind(media);
    media.describeNormalization = async (...args) => {
      if (firstPreparation) { firstPreparation = false; normalizerStarted.resolve(); await releaseNormalizer.promise; }
      return describe(...args);
    };
    media.importMedia = async (...args) => { calls.normalize++; return normalize(...args); };
    const ingester = new SpoolVideoIngestor(outputStore, media, { rootDir: join(f.directory, "derivations") });
    return new Engine(store, f.provider, { artifactDir: f.artifactDir, outputStore, outputIngestor: {
      async ingest(input) {
        try { return await ingester.ingest(input); }
        catch (error) { if (error.code === "MEDIA_BUSY") { busyObserved.resolve(input.attempt); await releaseBusy.promise; } throw error; }
      },
    } });
  };
  const initialOutputs = new ExecutionOutputStore(store, { rootDir: join(f.directory, "outputs") });
  f.provider.submit = async request => {
    calls.submit++;
    const receipt = initialOutputs.recordReceipt(f.projectId, { attemptId: request.attemptId, expectedRequestDigest: digest(request), port: "video", kind: "video",
      mimeType: "video/mp4", vendorTaskId: `video-${request.attemptId}`, diagnosticRequestId: null,
      source: { kind: "returned_bytes", sha256: createHash("sha256").update(raw).digest("hex"), byteLength: raw.length } });
    await initialOutputs.spool(f.projectId, receipt.id, async function* () { yield raw; });
    return initialOutputs.recoverCompletion(f.projectId, request.attemptId);
  };
  f.provider.poll = async () => { calls.poll++; throw Error("Completed spool must not poll the provider"); };
  f.provider.lookup = async () => { calls.lookup++; throw Error("Completed spool must not look up the provider"); };
  engine = createEngine();
  return { ...f, get store() { return store; }, get engine() { return engine; }, calls, normalizerStarted, releaseNormalizer, busyObserved, releaseBusy,
    reopen() { store.close(); store = new Store(f.dbPath); t.after(() => { if (store.db.open) store.close(); }); engine = createEngine(); } };
}
const videos = f => f.engine.attempts(f.projectId).filter(attempt => attempt.request.kind === "video");

test("busy local normalization releases only its lease and resumes two completed spools immediately after restart", async t => {
  const f = await fixture(t), running = f.engine.runReady().then(result => ({ result }), error => ({ error }));
  let blocked;
  try { await f.normalizerStarted.promise; blocked = await f.busyObserved.promise; }
  finally { f.releaseBusy.resolve(); f.releaseNormalizer.resolve(); }
  const settled = await running, busy = f.store.get("attempt", blocked.id);
  assert.equal(busy.leaseExpiresAt, 0, "completed work must not wait for the renewed 30-second lease");
  assert.equal(settled.error, undefined); assert.equal(busy.phase, "ingesting"); assert.deepEqual(busy.outputs, {});
  assert.equal(f.store.get("reservation", busy.reservationId).state, "reserved");
  assert.equal(f.store.list("execution_output_spool", f.projectId).length, 2);
  const evidence = f.store.list("execution_evidence", f.projectId).filter(item => item.attemptId === busy.id);
  assert.ok(evidence.some(item => item.outcome.type === "completed" && item.outcome.version === 2));
  assert.equal(videos(f).filter(attempt => attempt.phase === "succeeded").length, 1);
  f.reopen(); await f.engine.reconcile();
  assert.ok(videos(f).every(attempt => attempt.phase === "succeeded"));
  assert.equal(f.engine.outputs(f.projectId).filter(output => output.artifact.kind === "video").length, 2);
  assert.deepEqual(f.calls, { submit: 2, poll: 0, lookup: 0, normalize: 2 });
  assert.equal(f.store.list("execution_evidence", f.projectId).filter(item => item.attemptId === busy.id).length, evidence.length);
});

test("a late MEDIA_BUSY cannot release or overwrite a replacement owner's lease", async t => {
  const f = await fixture(t), running = f.engine.runReady().then(result => ({ result }), error => ({ error }));
  let replacement;
  try {
    await f.normalizerStarted.promise; const busy = await f.busyObserved.promise, current = f.store.get("attempt", busy.id);
    replacement = { ...current, leaseOwner: "replacement-worker", leaseEpoch: current.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 };
    f.store.put("attempt", current.id, f.projectId, replacement);
  } finally { f.releaseBusy.resolve(); f.releaseNormalizer.resolve(); }
  assert.equal((await running).error, undefined);
  assert.deepEqual(f.store.get("attempt", replacement.id), replacement);
  await f.engine.reconcile(); assert.deepEqual(f.store.get("attempt", replacement.id), replacement);
  assert.equal(videos(f).filter(attempt => attempt.phase === "succeeded").length, 1);
  assert.deepEqual(f.calls, { submit: 2, poll: 0, lookup: 0, normalize: 1 });
});
