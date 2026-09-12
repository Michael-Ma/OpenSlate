import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../../../packages/core/dist/index.js";
import { Engine } from "../dist/execution/engine.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { SpoolVideoIngestor } from "../dist/execution/spool-video-ingester.js";
import { videoDerivationId, VIDEO_DERIVATION_LIMITS } from "../dist/execution/video-derivation.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { setup } from "./execution-fixture.mjs";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
let temporary, raw, shortRaw;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "openslate-generated-video-"));
  for (const seconds of [6, 2]) {
    const path = join(temporary, `${seconds}.mp4`);
    await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=24", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100",
      "-t", String(seconds), "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-metadata", "comment=raw provider fixture", path], { timeout: 30000 });
  }
  raw = await readFile(join(temporary, "6.mp4")); shortRaw = await readFile(join(temporary, "2.mp4"));
});
after(async () => rm(temporary, { recursive: true, force: true }));

async function fixture(t, bytes = raw) {
  const f = setup(t, { count: 1 });
  await f.engine.runReady(); await f.engine.reconcile();
  const review = f.engine.reviewSnapshot(f.projectId); f.engine.approve(f.projectId, review.id, [review.members[0].videoNodeId], "human-review");
  const outputStore = new ExecutionOutputStore(f.store, { rootDir: join(f.directory, "outputs") });
  const media = new LocalMediaService({ rootDir: join(f.directory, "normalized"), allowedInputRoots: [outputStore.rootDir], ffmpegPath, ffprobePath });
  const outputIngestor = new SpoolVideoIngestor(outputStore, media, { rootDir: join(f.directory, "derivations") });
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore, outputIngestor });
  const calls = { submit: 0, poll: 0, lookup: 0, normalize: 0, recipe: 0 };
  const importMedia = media.importMedia.bind(media), describe = media.describeNormalization.bind(media);
  media.describeNormalization = async (...args) => { calls.recipe++; return describe(...args); };
  media.importMedia = async (...args) => {
    calls.normalize++;
    const intent = f.store.list("video_derivation_intent", f.projectId)[0];
    assert.ok(intent, "normalization must have a durable intent first");
    assert.equal(args[0].artifactId, intent.artifactId); return importMedia(...args);
  };
  f.provider.submit = async request => {
    calls.submit++;
    const receipt = outputStore.recordReceipt(f.projectId, { attemptId: request.attemptId, expectedRequestDigest: digest(request),
      port: "video", kind: "video", mimeType: "video/mp4", vendorTaskId: "offline-video-task", diagnosticRequestId: null,
      source: { kind: "returned_bytes", sha256: hash(bytes), byteLength: bytes.length } });
    await outputStore.spool(f.projectId, receipt.id, async function* () { yield bytes; });
    return outputStore.recoverCompletion(f.projectId, request.attemptId);
  };
  f.provider.poll = async () => { calls.poll++; throw Error("unexpected provider polling"); };
  f.provider.lookup = async () => { calls.lookup++; throw Error("unexpected provider lookup"); };
  return { ...f, engine, outputStore, outputIngestor, media, calls };
}
const latest = f => f.engine.attempts(f.projectId).find(attempt => attempt.request.kind === "video");
function expire(f) { const attempt = latest(f); f.store.put("attempt", attempt.id, f.projectId, { ...attempt, leaseExpiresAt: 0 }); }
const artifacts = f => f.store.list("artifact", f.projectId).filter(record => record.artifact.kind === "video");
const indexPath = f => join(f.outputIngestor.rootDir, "completions", `${videoDerivationId(f.projectId, latest(f).id)}.json`);
function unresolved(f) {
  const attempt = latest(f); assert.equal(attempt.phase, "ingesting"); assert.deepEqual(attempt.outputs, {});
  assert.equal(f.store.get("reservation", attempt.reservationId).state, "reserved");
  assert.equal(artifacts(f).length, 0); assert.equal(f.store.list("media_source", f.projectId).length, 0);
  assert.equal(f.store.list("video_derivation_receipt", f.projectId).length, 0);
}

test("generated MP4 derives a measured silent 30-fps source with separate raw and normalized identities, usable by rendering", async t => {
  const f = await fixture(t); await f.engine.runReady();
  const attempt = latest(f), record = artifacts(f)[0], source = f.store.get("media_source", record.id);
  const intent = f.store.list("video_derivation_intent", f.projectId)[0], receipt = f.store.get("video_derivation_receipt", intent.id);
  assert.equal(attempt.phase, "succeeded"); assert.equal(attempt.taskId, "offline-video-task");
  assert.equal(f.store.get("reservation", attempt.reservationId).state, "charged");
  assert.equal(intent.requestDigest, digest(attempt.request)); assert.equal(intent.rawSha256, hash(raw));
  assert.equal(receipt.source.originalSha256, hash(raw)); assert.notEqual(record.artifact.sha256, hash(raw));
  assert.equal(record.artifact.sha256, hash(readFileSync(record.path))); assert.equal(record.fixture, false);
  assert.equal(record.physicalDurationSeconds, 6); assert.equal(receipt.source.probe.video.frames, 180);
  assert.equal(receipt.source.probe.video.frameRate, "30/1"); assert.equal(receipt.source.probe.audio, undefined);
  assert.equal(source.origin, "generated_video"); assert.equal(source.requestId, undefined); assert.equal(source.attemptId, attempt.id);
  assert.equal(record.outputSpoolId, intent.spoolId); assert.equal(record.derivationId, receipt.id);
  assert.deepEqual(JSON.parse(readFileSync(indexPath(f), "utf8")), receipt);
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0, normalize: 1, recipe: 1 });
  const manifest = await f.media.freezeManifest({ projectId: f.projectId, targetRevisionId: f.store.getProject(f.projectId).revisionId,
    width: 160, height: 90, clips: [{ source: source.source, startFrame: 30, durationFrames: 90, fit: "contain" }] });
  const rendered = await f.media.render(manifest); assert.equal(rendered.artifact.probe.video.frames, 90);
});

test("SQL publication failure rolls back artifact, generated source, receipt and charge; restart reuses durable normalized bytes", async t => {
  const f = await fixture(t), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "video_derivation_receipt") throw Error("SQL publication interrupted"); return insert(...args); };
  try { await assert.rejects(f.engine.runReady(), /SQL publication interrupted/); } finally { f.store.insert = insert; }
  unresolved(f); assert.ok(existsSync(indexPath(f))); assert.equal(f.calls.normalize, 1);
  f.media.describeNormalization = async () => { throw Error("recovery must not probe a changed or missing toolchain"); };
  f.media.importMedia = async () => { throw Error("recovery must not repeat normalization"); };
  expire(f); const restarted = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore, outputIngestor: f.outputIngestor });
  await restarted.reconcile(); assert.equal(latest(f).phase, "succeeded"); assert.equal(artifacts(f).length, 1);
  assert.equal(f.store.list("media_source", f.projectId).length, 1); assert.equal(f.store.list("video_derivation_receipt", f.projectId).length, 1);
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0, normalize: 1, recipe: 1 });
});

test("lease loss after durable normalization retains recovery bytes but prevents publication by the old worker", async t => {
  const f = await fixture(t), writeIndex = f.outputIngestor.writeIndex.bind(f.outputIngestor);
  f.outputIngestor.writeIndex = async receipt => {
    await writeIndex(receipt); const attempt = latest(f);
    f.store.put("attempt", attempt.id, f.projectId, { ...attempt, leaseOwner: "replacement-worker", leaseEpoch: attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
  };
  await assert.rejects(f.engine.runReady(), { code: "VIDEO_DERIVATION_LEASE_LOST" }); unresolved(f);
  assert.ok(existsSync(indexPath(f))); f.outputIngestor.writeIndex = writeIndex;
  expire(f); await f.engine.reconcile(); assert.equal(latest(f).phase, "succeeded");
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0, normalize: 1, recipe: 1 });
});

test("physically short output preserves measured failure evidence and never repeats its completed normalization", async t => {
  const f = await fixture(t, shortRaw);
  await assert.rejects(f.engine.runReady(), { code: "VIDEO_TOO_SHORT" }); unresolved(f);
  const receipt = JSON.parse(readFileSync(indexPath(f), "utf8")); assert.equal(receipt.source.probe.video.frames, 60);
  expire(f); await assert.rejects(f.engine.reconcile(), { code: "VIDEO_TOO_SHORT" }); unresolved(f);
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0, normalize: 1, recipe: 1 });
});

test("normalization keeps its 128-MiB input cap even when spool storage accepts larger MP4 files", async t => {
  const f = await fixture(t);
  const guarded = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore, outputIngestor: {
    ingest(input) { return f.outputIngestor.ingest({ ...input, output: { ...input.output, byteLength: VIDEO_DERIVATION_LIMITS.inputBytes + 1 } }); },
  } });
  await assert.rejects(guarded.runReady(), { code: "VIDEO_NORMALIZATION_INPUT_LIMIT" }); unresolved(f);
  assert.equal(f.calls.normalize, 0); assert.equal(f.calls.recipe, 0); assert.equal(f.store.list("video_derivation_intent", f.projectId).length, 0);
  const oversized = new LocalMediaService({ rootDir: join(f.directory, "oversized"), allowedInputRoots: [f.outputStore.rootDir], ffmpegPath, ffprobePath, limits: { maxInputBytes: 256 * 1024 * 1024 } });
  assert.throws(() => new SpoolVideoIngestor(f.outputStore, oversized, { rootDir: join(f.directory, "oversized-deriver") }), { code: "VIDEO_DERIVATION_CONFIGURATION" });
});

test("an incomplete derivation cannot change its pinned recipe after restart", async t => {
  const f = await fixture(t);
  f.media.importMedia = async () => { f.calls.normalize++; throw Error("crash before local normalization completes"); };
  await assert.rejects(f.engine.runReady(), /crash before local normalization/); unresolved(f);
  const intent = f.store.list("video_derivation_intent", f.projectId)[0]; assert.ok(intent); assert.equal(existsSync(indexPath(f)), false);
  f.media.describeNormalization = async () => ({ ...intent.normalization, toolchainDigest: "0".repeat(64) });
  expire(f); await assert.rejects(f.engine.reconcile(), { code: "VIDEO_DERIVATION_RECIPE_CHANGED" }); unresolved(f);
  assert.equal(f.calls.normalize, 1); assert.deepEqual(f.store.get("video_derivation_intent", intent.id), intent);
});

test("corrupt durable normalization metadata or normalized bytes cannot trigger regeneration or publication", async t => {
  for (const mode of ["index", "bytes"]) {
    const f = await fixture(t), insert = f.store.insert.bind(f.store);
    f.store.insert = (...args) => { if (args[0] === "video_derivation_receipt") throw Error("interrupt SQL"); return insert(...args); };
    try { await assert.rejects(f.engine.runReady(), /interrupt SQL/); } finally { f.store.insert = insert; }
    const path = indexPath(f), receipt = JSON.parse(readFileSync(path, "utf8"));
    if (mode === "index") { receipt.source.originalSha256 = "0".repeat(64); chmodSync(path, 0o600); writeFileSync(path, JSON.stringify(receipt)); }
    else { const verified = await f.media.verifiedSource(receipt.source); chmodSync(verified.path, 0o600); writeFileSync(verified.path, Buffer.alloc(receipt.source.byteLength)); }
    expire(f); await assert.rejects(f.engine.reconcile()); unresolved(f);
    assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0, normalize: 1, recipe: 1 });
  }
});

test("tagged normalized results cannot alter raw provenance or source authority; untagged results still require the raw hash", async t => {
  for (const mode of ["raw-hash", "source-authority", "contradictory-duration", "untagged"]) {
    const f = await fixture(t), guarded = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore, outputIngestor: {
      async ingest(input) {
        const result = structuredClone(await f.outputIngestor.ingest(input));
        if (mode === "raw-hash") result.derivation.source.originalSha256 = "0".repeat(64);
        if (mode === "source-authority") result.mediaSource.requestId = "invented-human-request";
        if (mode === "contradictory-duration") {
          result.derivation.source.probe.durationSeconds = 60;
          const { id, ...body } = result.derivation.source; result.derivation.source.id = digest(body);
        }
        return mode === "untagged" ? result.artifact : result;
      },
    } });
    await assert.rejects(guarded.runReady(), { code: mode === "untagged" ? "INVALID_PROVIDER_OUTPUT" : "VIDEO_DERIVATION_CONFLICT" }); unresolved(f);
    expire(f); await f.engine.reconcile(); assert.equal(latest(f).phase, "succeeded"); assert.equal(f.calls.normalize, 1);
    assert.equal(f.calls.submit, 1); assert.equal(f.calls.poll + f.calls.lookup, 0);
  }
});

test("a normalized video completed after its binding retires stays history without replacing current output", async t => {
  const f = await fixture(t), guarded = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore, outputIngestor: {
    async ingest(input) { const result = await f.outputIngestor.ingest(input), binding = f.store.get("node_binding", input.attempt.nodeId);
      f.store.put("node_binding", binding.id, f.projectId, { ...binding, state: "retired" }); return result; },
  } });
  await guarded.runReady(); assert.equal(latest(f).phase, "succeeded"); assert.equal(artifacts(f).length, 1);
  assert.equal(f.store.list("media_source", f.projectId).length, 1); assert.equal(guarded.outputs(f.projectId).filter(item => item.artifact.kind === "video").length, 0);
});
