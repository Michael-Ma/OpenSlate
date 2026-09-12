import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { chmodSync, existsSync, linkSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../../../packages/core/dist/index.js";
import { Engine } from "../dist/execution/engine.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { SpoolImageIngestor } from "../dist/execution/spool-image-ingester.js";
import { LocalImageStore } from "../dist/media/local-images.js";
import { setup } from "./execution-fixture.mjs";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
let temporary, png;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "openslate-spool-engine-"));
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180", "-frames:v", "1", "-threads", "1", join(temporary, "image.png")], { timeout: 15000 });
  png = await readFile(join(temporary, "image.png"));
});
after(async () => rm(temporary, { recursive: true, force: true }));

async function fixture(t, { kind = "image", defaultIngester = false, count = 1 } = {}) {
  const f = setup(t, { count, imagesOnly: kind === "image" });
  if (kind === "video") {
    await f.engine.runReady(); await f.engine.reconcile();
    const review = f.engine.reviewSnapshot(f.projectId); f.engine.approve(f.projectId, review.id, [review.members[0].videoNodeId], "human-review");
  }
  const outputStore = new ExecutionOutputStore(f.store, { rootDir: join(f.directory, "outputs") });
  const images = new LocalImageStore({ rootDir: join(f.artifactDir, "images"), ffmpegPath, ffprobePath });
  const outputIngestor = new SpoolImageIngestor(outputStore, images);
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore, ...(defaultIngester ? {} : { outputIngestor }) });
  const calls = { submit: 0, poll: 0, lookup: 0 };
  const make = async (request, { bytes = png, vendorTaskId = null, diagnosticRequestId = "diagnostic-only" } = {}) => {
    const receipt = outputStore.recordReceipt(f.projectId, { attemptId: request.attemptId, expectedRequestDigest: digest(request),
      port: request.kind, kind: request.kind, mimeType: request.kind === "image" ? "image/png" : "video/mp4", vendorTaskId, diagnosticRequestId,
      source: { kind: "returned_bytes", sha256: hash(bytes), byteLength: bytes.length } });
    await outputStore.spool(f.projectId, receipt.id, async function* () { yield bytes; });
    return outputStore.recoverCompletion(f.projectId, request.attemptId);
  };
  f.provider.submit = async request => { calls.submit++; return make(request); };
  f.provider.poll = async () => { calls.poll++; throw Error("unexpected provider polling"); };
  f.provider.lookup = async () => { calls.lookup++; throw Error("unexpected provider lookup"); };
  return { ...f, engine, outputStore, outputIngestor, images, calls, make };
}
function latest(f) { return f.engine.attempts(f.projectId).at(-1); }
function reserved(f) { return f.store.get("reservation", latest(f).reservationId).state; }

test("synchronous owned PNG completion publishes exact bytes without inventing a task", async t => {
  const f = await fixture(t); await f.engine.runReady();
  const attempt = latest(f), record = f.store.get("artifact", attempt.outputs.image.artifactId);
  assert.equal(attempt.phase, "succeeded"); assert.equal(attempt.taskId, null); assert.equal(reserved(f), "charged");
  assert.equal(record.fixture, false); assert.equal(record.artifact.sha256, hash(png)); assert.deepEqual(readFileSync(record.path), png);
  assert.equal(record.width, 320); assert.equal(record.height, 180); assert.equal(record.byteLength, png.length);
  assert.equal(record.outputReceiptId, record.outputSpoolId); assert.equal(record.validationDigest.length, 64);
  const evidence = f.store.list("execution_evidence", f.projectId)[0];
  assert.equal(evidence.outcome.version, 2); assert.equal(evidence.outcome.vendorTaskId, null);
  assert.equal(evidence.outcomeDigest, digest(evidence.outcome));
  assert.ok(!JSON.stringify(evidence).includes("bytesBase64")); assert.ok(!JSON.stringify(evidence).includes("diagnostic-only"));
  assert.equal(f.engine.outputs(f.projectId)[0].fixture, false); assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0 });
});

test("a durable winning slot recovers before provider lookup after the submit result was lost", async t => {
  const f = await fixture(t);
  f.provider.submit = async request => { f.calls.submit++; await f.make(request); throw Error("crash after durable output, before outcome evidence"); };
  await f.engine.runReady(); assert.equal(latest(f).phase, "submission_unknown"); assert.equal(reserved(f), "reserved");
  const restarted = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore, outputIngestor: f.outputIngestor });
  await restarted.reconcile();
  assert.equal(latest(f).phase, "succeeded"); assert.equal(latest(f).taskId, null); assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0 });
});

test("slot manifests recover missing database completion records before any provider call", async t => {
  const f = await fixture(t), put = f.store.put.bind(f.store);
  f.provider.submit = async request => {
    f.calls.submit++;
    f.store.put = (...args) => { if (args[0] === "execution_output_spool") throw Error("interrupted spool database write"); return put(...args); };
    try { return await f.make(request); } finally { f.store.put = put; }
  };
  await f.engine.runReady(); assert.equal(f.store.list("execution_output_spool", f.projectId).length, 0);
  await f.engine.reconcile();
  assert.equal(latest(f).phase, "succeeded"); assert.equal(f.store.list("execution_output_slot", f.projectId).length, 1);
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0 });
});

test("lease loss during controlled local recovery aborts its signal without a provider call or publication", { timeout: 10000 }, async t => {
  const f = await fixture(t);
  f.provider.submit = async request => { f.calls.submit++; await f.make(request); throw Error("lost return after durable slot"); };
  await f.engine.runReady();
  const recover = f.outputStore.recoverCompletion.bind(f.outputStore); let entered, release, recoverySignal;
  const started = new Promise(resolve => { entered = resolve; }), barrier = new Promise(resolve => { release = resolve; });
  f.outputStore.recoverCompletion = async (...args) => { recoverySignal = args[2].signal; entered(); await barrier; return recover(...args); };
  const worker = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore, outputIngestor: f.outputIngestor, leaseMs: 3000 });
  const running = worker.reconcile();
  try {
    await started; const attempt = latest(f);
    f.store.put("attempt", attempt.id, f.projectId, { ...attempt, leaseOwner: "replacement-recovery-worker", leaseEpoch: attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
    if (!recoverySignal.aborted) await once(recoverySignal, "abort", { signal: AbortSignal.timeout(6000) });
    assert.equal(recoverySignal.aborted, true);
  } finally { release(); await running; f.outputStore.recoverCompletion = recover; }
  assert.equal(latest(f).leaseOwner, "replacement-recovery-worker"); assert.equal(latest(f).phase, "submission_unknown");
  assert.equal(reserved(f), "reserved"); assert.equal(f.store.list("artifact", f.projectId).length, 0);
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0 });
});

test("V2 evidence replay preserves its digest and does not contact the provider", async t => {
  const f = await fixture(t, { defaultIngester: true });
  await assert.rejects(f.engine.runReady(), { code: "INVALID_PROVIDER_OUTPUT" });
  assert.equal(latest(f).phase, "ingesting"); assert.equal(reserved(f), "reserved");
  const before = f.store.list("execution_evidence", f.projectId)[0], attempt = latest(f);
  f.store.put("attempt", attempt.id, f.projectId, { ...attempt, leaseExpiresAt: 0 });
  const restarted = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore, outputIngestor: f.outputIngestor });
  await restarted.reconcile();
  assert.equal(latest(f).phase, "succeeded"); assert.deepEqual(f.store.get("execution_evidence", before.id), before);
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0 });
});

test("missing or mismatched receipt references remain unknown without artifact publication", async t => {
  for (const corrupt of [value => { value.receiptId = "c".repeat(64); value.outputs[0].storage.spoolId = value.receiptId; },
    value => { value.outputs[0].sha256 = "0".repeat(64); }, value => { value.outputs[0].byteLength++; },
    value => { value.vendorTaskId = "conflicting-remote-task"; }]) {
    const f = await fixture(t);
    f.provider.submit = async request => { f.calls.submit++; const value = await f.make(request); corrupt(value); return value; };
    await f.engine.runReady(); assert.equal(latest(f).phase, "submission_unknown"); assert.equal(reserved(f), "reserved");
    assert.equal(latest(f).taskId, null, "unbound receipts cannot supply another task identity");
    assert.equal(f.store.list("artifact", f.projectId).length, 0); assert.equal(f.engine.outputs(f.projectId).length, 0);
    await f.engine.reconcile(); assert.equal(latest(f).phase, "succeeded");
    assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0 });
  }
});

test("only the first winning receipt can become the execution completion", async t => {
  const f = await fixture(t);
  f.provider.submit = async request => {
    f.calls.submit++; const first = await f.make(request);
    const refreshed = f.outputStore.recordReceipt(f.projectId, { attemptId: request.attemptId, expectedRequestDigest: digest(request),
      port: "image", kind: "image", mimeType: "image/png", vendorTaskId: null, diagnosticRequestId: "refreshed",
      source: { kind: "returned_bytes", sha256: hash(png), byteLength: png.length } });
    await f.outputStore.spool(f.projectId, refreshed.id, async function* () { yield png; });
    const changed = structuredClone(first); changed.receiptId = refreshed.id; changed.outputs[0].storage.spoolId = refreshed.id;
    assert.throws(() => f.outputStore.assertCompletion(f.projectId, request.attemptId, changed), { code: "OUTPUT_SLOT_CONFLICT" });
    return changed;
  };
  await f.engine.runReady(); assert.equal(latest(f).phase, "submission_unknown");
  await f.engine.reconcile(); assert.equal(latest(f).phase, "succeeded");
  const slot = f.store.list("execution_output_slot", f.projectId)[0], artifact = f.store.list("artifact", f.projectId)[0];
  assert.equal(artifact.outputSpoolId, slot.spoolId); assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0 });
});

test("one attempt cannot adopt another attempt's valid receipt even in the same project", async t => {
  const f = await fixture(t, { count: 2 }); let ready;
  const first = new Promise(resolve => { ready = resolve; }), firstNode = f.plan.nodes[0].id;
  f.provider.submit = async request => {
    f.calls.submit++; const value = await f.make(request);
    if (request.nodeId === firstNode) { ready(value); return value; }
    return first;
  };
  await f.engine.runReady();
  const attempts = f.engine.attempts(f.projectId);
  assert.equal(attempts.find(attempt => attempt.nodeId === firstNode).phase, "succeeded");
  assert.equal(attempts.find(attempt => attempt.nodeId !== firstNode).phase, "submission_unknown");
  assert.equal(f.store.list("artifact", f.projectId).length, 1);
  await f.engine.reconcile();
  assert.ok(f.engine.attempts(f.projectId).every(attempt => attempt.phase === "succeeded"));
  assert.equal(f.store.list("artifact", f.projectId).length, 2); assert.deepEqual(f.calls, { submit: 2, poll: 0, lookup: 0 });
});

test("a receipt cannot replace an already known remote task with a synchronous null task", async t => {
  const f = await fixture(t);
  f.provider.submit = async request => { f.calls.submit++; await f.make(request); return { type: "accepted", taskId: "accepted-task" }; };
  await f.engine.runReady(); await f.engine.reconcile();
  assert.equal(latest(f).phase, "submission_unknown"); assert.equal(latest(f).taskId, "accepted-task");
  assert.equal(reserved(f), "reserved"); assert.equal(f.store.list("artifact", f.projectId).length, 0);
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0 });
});

test("corrupt or undecodable PNG spools preserve evidence and unresolved liability", async t => {
  for (const mode of ["corrupt", "truncated"]) {
    const f = await fixture(t);
    f.provider.submit = async request => {
      f.calls.submit++; const value = await f.make(request, { bytes: mode === "truncated" ? png.subarray(0, 40) : png });
      if (mode === "corrupt") {
        const owned = await f.outputStore.resolveOwned(f.projectId, value.receiptId); chmodSync(owned.path, 0o600); writeFileSync(owned.path, Buffer.alloc(png.length));
      }
      return value;
    };
    await assert.rejects(f.engine.runReady());
    assert.equal(latest(f).phase, "ingesting"); assert.equal(reserved(f), "reserved"); assert.equal(f.store.list("artifact", f.projectId).length, 0);
    assert.equal(f.store.list("execution_evidence", f.projectId)[0].outcome.type, "completed");
  }
});

test("ingester results cannot lose their receipt provenance or alter measured byte length", async t => {
  for (const mutate of [record => { record.outputReceiptId = "wrong"; }, record => { record.outputSpoolId = "wrong"; }, record => { record.byteLength++; }]) {
    const f = await fixture(t), engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore,
      outputIngestor: { async ingest(input) { const record = await f.outputIngestor.ingest(input); mutate(record); return record; } } });
    await assert.rejects(engine.runReady(), { code: "INVALID_PROVIDER_OUTPUT" });
    assert.equal(reserved(f), "reserved"); assert.equal(f.store.list("artifact", f.projectId).length, 0);
  }
});

test("a PNG finishing after its node is retired remains history without selecting a stale output", async t => {
  const f = await fixture(t), engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore,
    outputIngestor: { async ingest(input) {
      const record = await f.outputIngestor.ingest(input), binding = f.store.get("node_binding", input.attempt.nodeId);
      f.store.put("node_binding", binding.id, f.projectId, { ...binding, state: "retired" }); return record;
    } } });
  await engine.runReady(); assert.equal(latest(f).phase, "succeeded"); assert.equal(reserved(f), "charged");
  assert.equal(f.store.list("artifact", f.projectId).length, 1); assert.equal(engine.outputs(f.projectId).length, 0);
});

test("the PNG ingester explicitly rejects video instead of pretending its bytes were normalized", async t => {
  const f = await fixture(t, { kind: "video" });
  await assert.rejects(f.engine.runReady(), { code: "OUTPUT_INGESTION_UNSUPPORTED" });
  assert.equal(latest(f).phase, "ingesting"); assert.equal(reserved(f), "reserved");
  assert.equal(Object.keys(latest(f).outputs).length, 0); assert.equal(f.store.list("media_source", f.projectId).length, 0);
});

test("the streamed Engine integrity boundary accepts a synthetic 65-MiB spool without the inline cap", async t => {
  // This injected host hook tests file integrity only, not MP4 decoding or production video ingestion.
  const f = await fixture(t, { kind: "video" }), chunk = Buffer.alloc(1024 * 1024, 0x5a), hasher = createHash("sha256");
  for (let n = 0; n < 65; n++) hasher.update(chunk);
  const sha256 = hasher.digest("hex");
  f.provider.submit = async request => {
    f.calls.submit++;
    const receipt = f.outputStore.recordReceipt(f.projectId, { attemptId: request.attemptId, expectedRequestDigest: digest(request),
      port: "video", kind: "video", mimeType: "video/mp4", vendorTaskId: "synthetic-video-task", diagnosticRequestId: null,
      source: { kind: "returned_bytes", sha256, byteLength: 65 * chunk.length } });
    await f.outputStore.spool(f.projectId, receipt.id, async function* () { for (let n = 0; n < 65; n++) yield chunk; });
    return f.outputStore.recoverCompletion(f.projectId, request.attemptId);
  };
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, outputStore: f.outputStore, outputIngestor: {
    async ingest({ attempt, output }) {
      const owned = await f.outputStore.resolveOutput(attempt.projectId, attempt.id, output), path = join(f.artifactDir, `${sha256}.mp4`);
      linkSync(owned.path, path); const id = digest({ attemptId: attempt.id, test: "synthetic-integrity-only" });
      return { id, projectId: attempt.projectId, attemptId: attempt.id, artifact: { artifactId: id, kind: "video", sha256 },
        path, mimeType: "video/mp4", fixture: false, physicalDurationSeconds: 1, byteLength: output.byteLength,
        outputReceiptId: output.storage.spoolId, outputSpoolId: output.storage.spoolId };
    },
  } });
  await engine.runReady(); assert.equal(latest(f).phase, "succeeded"); assert.equal(latest(f).taskId, "synthetic-video-task");
  const evidence = f.store.list("execution_evidence", f.projectId).find(item => item.attemptId === latest(f).id);
  assert.ok(JSON.stringify(evidence).length < 2048); assert.equal(evidence.outcome.outputs[0].byteLength, 65 * chunk.length);
});
