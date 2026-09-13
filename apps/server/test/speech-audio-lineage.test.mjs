import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { digest } from "../../../packages/core/dist/index.js";
import { Engine } from "../dist/execution/engine.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { SpoolAudioIngestor } from "../dist/execution/spool-audio-ingester.js";
import { assertSpeechSpoolLineage } from "../dist/execution/audio-execution-lineage.js";
import { speechFixture, context, rows, bytes, wave, hash, restart } from "./speech-execution-fixture.mjs";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
function ingestion(f, { noTools = false } = {}) {
  const media = new LocalMediaService({ rootDir: join(f.directory, "media"), allowedInputRoots: [f.outputs.rootDir],
    ffmpegPath: noTools ? "/offline-unavailable/ffmpeg" : ffmpegPath, ffprobePath: noTools ? "/offline-unavailable/ffprobe" : ffprobePath });
  const ingester = new SpoolAudioIngestor(f.outputs, media, { rootDir: join(f.directory, "audio-derivations") });
  const calls = { describe: 0, normalize: 0, verified: 0, lookup: 0 };
  for (const [method, count] of [["describeAudioNormalization", "describe"], ["importMedia", "normalize"], ["verifiedSource", "verified"]]) {
    const original = media[method].bind(media);
    media[method] = async (...args) => { calls[count]++; return original(...args); };
  }
  f.bridge.lookup = f.bridge.poll = async () => { calls.lookup++; throw Error("generic spool recovery must not query the provider"); };
  const engine = new Engine(f.store, f.bridge, { artifactDir: f.artifactRoot, profiles: [f.profile], outputStore: f.outputs, outputIngestor: ingester });
  return { media, ingester, engine, calls };
}
function pending(f) {
  const attempt = f.store.get("attempt", f.attempt.id);
  f.store.put("attempt", attempt.id, f.project.id, { ...attempt, phase: "submission_unknown", leaseExpiresAt: 0 });
}
function unpublished(f) {
  assert.equal(f.store.get("attempt", f.attempt.id).phase, "ingesting");
  assert.equal(rows(f, "artifact").length, 0); assert.equal(rows(f, "media_source").length, 0);
  assert.equal(f.store.get("reservation", f.attempt.reservationId).state, "reserved");
}

for (const sameBytes of [true, false]) test(`Engine's spool-first recovery rejects another speech receipt with ${sameBytes ? "identical" : "different"} bytes before media work`, async t => {
  const f = speechFixture(t), spool = f.outputs.spool.bind(f.outputs), alternateBytes = sameBytes ? bytes : wave(48000); let alternate;
  f.outputs.spool = async (...args) => {
    if (!alternate) {
      alternate = f.outputs.recordReceipt(f.project.id, { attemptId: f.attempt.id, expectedRequestDigest: digest(f.request),
        port: "audio", kind: "audio", mimeType: "audio/wav", vendorTaskId: null, diagnosticRequestId: "different-observation",
        source: { kind: "returned_bytes", sha256: hash(alternateBytes), byteLength: alternateBytes.length } });
      await spool(f.project.id, alternate.id, async function* () { yield alternateBytes; });
    }
    return spool(...args);
  };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown");
  const observed = rows(f, "speech_execution_result")[0]; assert.notEqual(observed.observation.outputReceiptId, alternate.id);
  pending(f); const worker = ingestion(f, { noTools: true });
  await assert.rejects(worker.engine.reconcile(), { code: "SPEECH_EXECUTION_CONFLICT" }); unpublished(f);
  assert.deepEqual(worker.calls, { describe: 0, normalize: 0, verified: 0, lookup: 0 });
  assert.equal(rows(f, "audio_derivation_intent").length, 0); assert.deepEqual(rows(f, "speech_execution_result")[0], observed);
  assert.equal(f.calls.http, 1); assert.equal(rows(f, "execution_output_spool").some(item => item.id === alternate.id), true);
});

test("speech mapping, dispatch, result and consumed authority are independently required by ingestion", async t => {
  for (const kind of ["speech_execution_mapping", "speech_execution_dispatch", "speech_execution_result", "external_allowance_consumption"]) {
    const f = speechFixture(t); assert.equal((await f.bridge.submit(f.request, context(f))).type, "completed");
    f.store.db.prepare("DELETE FROM entities WHERE kind=?").run(kind); pending(f);
    const worker = ingestion(f, { noTools: true });
    await assert.rejects(worker.engine.reconcile(), { code: "SPEECH_EXECUTION_CONFLICT" }); unpublished(f);
    assert.deepEqual(worker.calls, { describe: 0, normalize: 0, verified: 0, lookup: 0 }); assert.equal(f.calls.http, 1);
  }
});

async function completedBeforeSql(t) {
  const f = speechFixture(t); assert.equal((await f.bridge.submit(f.request, context(f))).type, "completed"); pending(f);
  const worker = ingestion(f), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "artifact") throw Error("synthetic artifact publication rollback"); return insert(...args); };
  await assert.rejects(worker.engine.reconcile(), /synthetic artifact publication rollback/); f.store.insert = insert; unpublished(f);
  const intent = rows(f, "audio_derivation_intent")[0], index = join(worker.ingester.rootDir, "completions", `${intent.id}.json`);
  assert.ok(existsSync(index)); assert.equal(worker.calls.normalize, 1);
  return { f, worker, intent, receipt: JSON.parse(readFileSync(index, "utf8")) };
}

test("exact speech lineage allows durable normalization recovery after SQL rollback and reopen without tools or HTTP", async t => {
  const { f, worker, receipt } = await completedBeforeSql(t); pending(f);
  const next = { ...f, ...restart(f) }, recovered = ingestion(next, { noTools: true });
  await recovered.engine.reconcile();
  assert.equal(next.store.get("attempt", f.attempt.id).phase, "succeeded");
  const artifact = rows(next, "artifact")[0], observation = rows(next, "speech_execution_result")[0].observation;
  assert.equal(artifact.outputReceiptId, observation.outputReceiptId); assert.equal(artifact.artifact.sha256, receipt.source.sha256);
  assert.equal(recovered.calls.describe, 0); assert.equal(recovered.calls.normalize, 0); assert.equal(recovered.calls.lookup, 0);
  assert.equal(worker.calls.normalize, 1); assert.equal(f.calls.http, 1);
});

test("a saved normalization cannot bypass a missing completed speech observation after reopen", async t => {
  const { f } = await completedBeforeSql(t), result = rows(f, "speech_execution_result")[0];
  const changed = { ...result, observation: { kind: "unknown", code: "SYNTHETIC_AMBIGUITY", receipt: result.observation.receipt, retryAfterMs: null } };
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='speech_execution_result' AND id=?").run(JSON.stringify(changed), result.id); pending(f);
  const next = { ...f, ...restart(f) }, recovered = ingestion(next, { noTools: true });
  let completionReads = 0; recovered.ingester.readIndex = async () => { completionReads++; throw Error("must check speech provenance before completion reuse"); };
  await assert.rejects(recovered.engine.reconcile(), { code: "SPEECH_EXECUTION_CONFLICT" }); unpublished(next);
  assert.equal(completionReads, 0); assert.deepEqual(recovered.calls, { describe: 0, normalize: 0, verified: 0, lookup: 0 });
  assert.equal(f.calls.http, 1);
});

test("lineage guard is inert for historical fake and other execution contracts", () => {
  const store = { get() { throw Error("legacy guard must not read records"); }, getProject() { throw Error("legacy guard must not inspect current project"); }, db: null };
  for (const execution of [undefined, { adapter: "fake", version: "1" }, { adapter: "offline-speech-fixture", version: "1" }]) {
    assert.doesNotThrow(() => assertSpeechSpoolLineage(store, { request: { kind: "speech", ...(execution ? { execution } : {}) } }, "legacy-spool"));
  }
});
