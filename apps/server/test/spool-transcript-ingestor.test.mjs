import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { appendFileSync, chmodSync, existsSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { canonical, digest } from "@openslate/core";
import { parseOpenAITranscriptionResponse } from "@openslate/providers";
import { SpoolTranscriptIngestor } from "../dist/execution/spool-transcript-ingestor.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { TranscriptionAudioStore } from "../dist/media/transcription-audio-store.js";
import { createTranscriptCandidate, resolveTranscriptionSpoolLineage } from "../dist/execution/transcript-candidate.js";
import { transcriptionFixture, context, rows, raw, payload, response, hash } from "./transcription-execution-fixture.mjs";

async function fixture(t, options = {}) {
  const f = await transcriptionFixture(t, options), completed = await f.bridge.submit(f.request, context(f));
  assert.equal(completed.type, "completed");
  const saved = f.store.get("attempt", f.attempt.id), attempt = { ...saved, phase: "ingesting", leaseExpiresAt: Date.now() + 60000 };
  f.store.put("attempt", saved.id, f.project.id, attempt);
  const media = new LocalMediaService({ rootDir: f.media.rootDir, allowedInputRoots: [f.directory], ffmpegPath: "/not-needed/ffmpeg", ffprobePath: "/not-needed/ffprobe" });
  const audio = new TranscriptionAudioStore({ rootDir: f.files.rootDir }), ingester = new SpoolTranscriptIngestor(f.outputs, media, audio, { artifactDir: f.artifactRoot });
  const calls = { source: 0, upload: 0 }, source = media.verifiedSource.bind(media), upload = audio.readUpload.bind(audio);
  media.verifiedSource = async (...args) => { calls.source++; return source(...args); };
  audio.readUpload = async (...args) => { calls.upload++; return upload(...args); };
  for (const method of ["importMedia", "describeAudioNormalization", "describeTranscriptionAudio", "deriveTranscriptionAudio"]) media[method] = async () => assert.fail("candidate ingestion cannot perform media conversion or tool discovery");
  f.preparation.prepare = async () => assert.fail("candidate ingestion cannot prepare audio");
  const input = { attempt, output: completed.outputs[0], artifactDir: f.artifactRoot, signal: new AbortController().signal };
  const mapping = rows(f, "transcription_execution_mapping")[0], rawPath = join(f.outputs.rootDir, "blobs", `${completed.outputs[0].sha256}.blob`);
  return { ...f, completed, media, audio, ingester, input, calls, providerCalls: f.calls, mapping, rawPath, ingest: inputOverride => ingester.ingest(inputOverride ?? input) };
}
function putBytes(path, bytes) { chmodSync(path, 0o600); writeFileSync(path, bytes); }
function change(f, kind, value) { f.store.db.prepare("UPDATE entities SET body=? WHERE kind=? AND id=?").run(canonical(value), kind, value.id); }
function replaceLease(f) { const saved = f.store.get("attempt", f.attempt.id); f.store.put("attempt", saved.id, f.project.id,
  { ...saved, leaseOwner: "replacement-ingestion", leaseEpoch: saved.leaseEpoch + 1, leaseExpiresAt: Date.now() + 60000 }); }
function unpublished(f) { assert.equal(rows(f, "transcript_candidate").length, 0); assert.equal(rows(f, "artifact").length, 1); assert.equal(rows(f, "media_source").length, 0); }

test("exact existing upload and raw response produce an immutable unreviewed candidate without tools or adoption", async t => {
  const f = await fixture(t), project = canonical(f.store.getProject(f.project.id)), narration = canonical(rows(f, "narration_acceptance"));
  const result = await f.ingest();
  assert.equal(result.type, "transcript_candidate"); assert.equal(result.artifact.origin, "transcription_response"); assert.equal(result.artifact.fixture, false);
  assert.equal(result.artifact.path, join(f.artifactRoot, f.project.id, `${hash(raw)}.json`)); assert.deepEqual(readFileSync(result.artifact.path), raw);
  assert.equal(statSync(result.artifact.path).mode & 0o777, 0o444); assert.equal(result.artifact.artifact.sha256, hash(raw)); assert.equal(result.artifact.byteLength, raw.length);
  assert.equal(result.artifact.transcriptCandidateId, result.candidate.id); assert.equal(result.artifact.outputReceiptId, f.completed.receiptId);
  const lineage = resolveTranscriptionSpoolLineage(f.store, f.input.attempt, f.completed.receiptId);
  const parsed = parseOpenAITranscriptionResponse({ bytes: raw, mimeType: "application/json", sourceDurationSeconds: 1 });
  assert.deepEqual(result.candidate, createTranscriptCandidate(lineage, parsed)); assert.ok(Buffer.byteLength(canonical(result.candidate)) <= 12 * 1024 ** 2);
  const inode = statSync(result.artifact.path).ino; assert.deepEqual(await f.ingest(), result); assert.equal(statSync(result.artifact.path).ino, inode);
  assert.equal(canonical(f.store.getProject(f.project.id)), project); assert.equal(canonical(rows(f, "narration_acceptance")), narration); unpublished(f);
  assert.deepEqual(f.calls, { source: 2, upload: 2 }); assert.deepEqual(f.providerCalls, { http: 1, credentials: 1, prepare: 1, upload: 1 });
});

test("empty speech and original out-of-range seconds remain unreviewed without rounding away issues", async t => {
  for (const empty of [true, false]) {
    const json = Buffer.from(JSON.stringify(empty ? payload({ text: "", words: [] }) : payload({ words: [
      { word: "Leather", start: 0.00002, end: 0.25 }, { word: "boots.", start: 0.5, end: 1.000001 },
    ] })));
    const f = await fixture(t, { fetch: async () => response(json) }), { candidate, artifact } = await f.ingest();
    assert.equal(candidate.status, "unreviewed"); assert.deepEqual(readFileSync(artifact.path), json);
    if (empty) { assert.deepEqual(candidate.projection.words, []); assert.equal(candidate.projection.text, ""); }
    else {
      assert.equal(candidate.projection.words[0].startSample, 1); assert.equal(candidate.projection.words[1].endSample, 48000);
      assert.equal(candidate.projection.words[1].endSeconds, 1.000001);
      assert.ok(candidate.projection.parserIssues.some(x => x.code === "word_outside_source"));
      assert.ok(candidate.projection.sampleIssues.some(x => x.code === "source_range_exceeded"));
    }
    unpublished(f);
  }
});

test("only the exact supported adapter and bounded raw JSON role can reach source reads", async t => {
  const f = await fixture(t);
  for (const input of [
    { ...f.input, attempt: { ...f.input.attempt, request: { ...f.request, execution: { adapter: "fake", version: "1" } } } },
    { ...f.input, output: { ...f.input.output, byteLength: 4 * 1024 ** 2 + 1 } },
    { ...f.input, output: { ...f.input.output, mimeType: "text/plain" } },
    { ...f.input, artifactDir: f.directory },
  ]) await assert.rejects(f.ingest(input));
  assert.deepEqual(f.calls, { source: 0, upload: 0 }); unpublished(f);
});

test("mapping, dispatch, result and consumed authority are independently required before media reads", async t => {
  const f = await fixture(t);
  for (const kind of ["transcription_execution_mapping", "transcription_execution_dispatch", "transcription_execution_result", "external_allowance_consumption"]) {
    const saved = f.store.db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(kind, f.attempt.id);
    f.store.db.prepare("UPDATE entities SET body='null' WHERE kind=? AND id=?").run(kind, f.attempt.id);
    try { await assert.rejects(f.ingest()); } finally { f.store.db.prepare("UPDATE entities SET body=? WHERE kind=? AND id=?").run(saved.body, kind, f.attempt.id); }
  }
  assert.deepEqual(f.calls, { source: 0, upload: 0 }); unpublished(f);
});

test("matching raw bytes from a competing receipt cannot bypass exact observed lineage", async t => {
  const f = await fixture(t), result = rows(f, "transcription_execution_result")[0];
  const alternate = f.outputs.recordReceipt(f.project.id, { attemptId: f.attempt.id, expectedRequestDigest: digest(f.request), port: "cues", kind: "data", mimeType: "application/json",
    vendorTaskId: null, diagnosticRequestId: "another-response", source: { kind: "returned_bytes", sha256: hash(raw), byteLength: raw.length } });
  await f.outputs.spool(f.project.id, alternate.id, async function* () { yield raw; });
  change(f, "transcription_execution_result", { ...result, observation: { ...result.observation, outputReceiptId: alternate.id,
    receipt: { ...result.observation.receipt, requestId: "another-response" } } });
  await assert.rejects(f.ingest()); assert.deepEqual(f.calls, { source: 0, upload: 0 }); unpublished(f);
});

test("source and derivative corruption cannot be hidden by valid response receipts", async t => {
  const f = await fixture(t), paths = [join(f.media.rootDir, "blobs", `${f.mapping.source.descriptor.sha256}.wav`),
    join(f.audio.rootDir, "blobs", `${f.mapping.derivative.sha256}.wav`)];
  for (const path of paths) {
    const saved = readFileSync(path), damaged = Buffer.from(saved); damaged[damaged.length - 1] ^= 1; putBytes(path, damaged);
    try { await assert.rejects(f.ingest()); } finally { putBytes(path, saved); }
  }
  unpublished(f); assert.equal(existsSync(join(f.artifactRoot, f.project.id, `${hash(raw)}.json`)), false);
});

test("actual derivative bytes reject a consistently forged structural multipart hash", async t => {
  const f = await fixture(t), old = rows(f, "transcription_execution_result")[0], mapping = { ...f.mapping, transport: { ...f.mapping.transport, bodySha256: "0".repeat(64) } };
  const dispatch = { ...rows(f, "transcription_execution_dispatch")[0], mappingDigest: digest(mapping), bodySha256: mapping.transport.bodySha256 };
  const result = { ...old, mappingDigest: digest(mapping), dispatchDigest: digest(dispatch), observation: { ...old.observation,
    receipt: { ...old.observation.receipt, bodySha256: mapping.transport.bodySha256 } } };
  for (const [kind, value] of [["transcription_execution_mapping", mapping], ["transcription_execution_dispatch", dispatch], ["transcription_execution_result", result]]) change(f, kind, value);
  await assert.rejects(f.ingest(), /multipart differs/); unpublished(f);
});

test("reparsing raw bytes rejects a forged compact response projection", async t => {
  const f = await fixture(t), old = rows(f, "transcription_execution_result")[0];
  change(f, "transcription_execution_result", { ...old, observation: { ...old.observation, result: { ...old.observation.result, resultDigest: "0".repeat(64) } } });
  await assert.rejects(f.ingest()); unpublished(f);
});

test("changed raw JSON and redirected media directories fail without overwriting existing evidence", async t => {
  const f = await fixture(t), original = readFileSync(f.rawPath);
  for (const damage of [() => { const value = Buffer.from(original); value[value.length - 1] ^= 1; putBytes(f.rawPath, value); },
    () => { chmodSync(f.rawPath, 0o600); truncateSync(f.rawPath, 100); }, () => { chmodSync(f.rawPath, 0o600); appendFileSync(f.rawPath, " "); }]) {
    damage(); try { await assert.rejects(f.ingest()); } finally { putBytes(f.rawPath, original); }
  }
  const directory = join(f.media.rootDir, "blobs"), moved = `${directory}-saved`; renameSync(directory, moved); symlinkSync(moved, directory);
  try { await assert.rejects(f.ingest()); } finally { unlinkSync(directory); renameSync(moved, directory); }
  unpublished(f);
});

test("bounded raw snapshot rejects growth or truncation during its own file read", async t => {
  for (const growth of [false, true]) await t.test(growth ? "growth" : "truncation", async t => {
    const f = await fixture(t), readExact = f.ingester.readExact.bind(f.ingester), original = fs.open;
    let copying = false, reached = false;
    f.ingester.readExact = async (...args) => { copying = true; return readExact(...args); };
    t.mock.method(fs, "open", async (path, ...args) => {
      const handle = await original(path, ...args);
      if (copying && path === f.rawPath && !reached) {
        const read = handle.read.bind(handle); handle.read = async (...args) => {
          const result = await read(...args);
          if (!reached) { reached = true; chmodSync(f.rawPath, 0o600); if (growth) appendFileSync(f.rawPath, " "); else truncateSync(f.rawPath, 100); }
          return result;
        };
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(f.ingest(), { code: "TRANSCRIPT_INGESTION_CONFLICT" }); assert.equal(reached, true); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    unpublished(f);
  });
});

test("original cancellation and ingestion lease survive mutable caller options across upload", async t => {
  for (const cancel of [true, false]) {
    const f = await fixture(t), controller = new AbortController(), input = { ...f.input, attempt: structuredClone(f.input.attempt), signal: controller.signal }, upload = f.audio.readUpload.bind(f.audio);
    f.audio.readUpload = async (...args) => { const value = await upload(...args); input.signal = new AbortController().signal;
      if (cancel) controller.abort(); else { replaceLease(f); Object.assign(input.attempt, f.store.get("attempt", f.attempt.id)); }
      return value;
    };
    await assert.rejects(f.ingest(input), { code: cancel ? "TRANSCRIPT_INGESTION_CANCELLED" : "TRANSCRIPT_INGESTION_LEASE_LOST" }); unpublished(f);
    assert.equal(existsSync(join(f.artifactRoot, f.project.id, `${hash(raw)}.json`)), false);
  }
});

test("a late completion cleanup abort retains only immutable raw bytes for exact retry", async t => {
  const f = await fixture(t), controller = new AbortController(), input = { ...f.input, signal: controller.signal }, original = fs.unlink; let reached = false;
  t.mock.method(fs, "unlink", async path => { const result = await original(path);
    if (String(path).startsWith(join(f.artifactRoot, f.project.id, ".media-"))) { reached = true; input.signal = new AbortController().signal; controller.abort(); }
    return result;
  });
  syncBuiltinESMExports();
  try { await assert.rejects(f.ingest(input), { code: "TRANSCRIPT_INGESTION_CANCELLED" }); assert.equal(reached, true); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  const path = join(f.artifactRoot, f.project.id, `${hash(raw)}.json`), inode = statSync(path).ino;
  assert.deepEqual(readFileSync(path), raw); unpublished(f);
  const next = await f.ingest(); assert.equal(statSync(next.artifact.path).ino, inode); assert.equal(readdirSync(join(f.artifactRoot, f.project.id)).some(name => name.startsWith(".media-")), false);
});

test("existing corrupt or symbolic raw artifact is never replaced", async t => {
  const f = await fixture(t), result = await f.ingest(), saved = readFileSync(result.artifact.path);
  putBytes(result.artifact.path, Buffer.alloc(saved.length));
  await assert.rejects(f.ingest()); assert.deepEqual(readFileSync(result.artifact.path), Buffer.alloc(saved.length));
  unlinkSync(result.artifact.path); symlinkSync(f.rawPath, result.artifact.path);
  await assert.rejects(f.ingest()); assert.deepEqual(readFileSync(f.rawPath), raw); unpublished(f);
});
