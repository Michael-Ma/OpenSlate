import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, chmodSync, existsSync, readdirSync, unlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { canonical, digest, DomainError } from "@openslate/core";
import { transcriptionAudioId, assertTranscriptionAudioIntent, assertTranscriptionAudioReceipt } from "../dist/execution/transcription-audio.js";
import { inspectPcmWave } from "../dist/media/pcm-wave.js";
import { fixture, wav, sha } from "./transcription-audio-fixture.mjs";

test("owned media and unaccepted narration recordings prepare complete separate derivatives without adopting content", async t => {
  for (const sourceKind of ["media_source", "narration_audio"]) {
    const f = await fixture(t, { sourceKind, samples: 48001 }), before = f.store.getProject(f.project.id);
    const result = await f.prepare(), intent = f.store.get("transcription_audio_intent", result.receipt.id);
    assert.equal(intent.sourceStartSample, 0); assert.equal(intent.sourceEndSample, f.source.probe.audio.samples);
    assert.deepEqual(intent.sourceRecord, { kind: sourceKind, id: f.source.artifactId, digest: digest(f.record) });
    assert.equal(result.receipt.audio.sampleRate, 16000); assert.equal(result.receipt.audio.channels, 1);
    assert.ok(Math.abs(result.receipt.audio.endDelta48kSamples) <= 3);
    const pcm = await inspectPcmWave(result.path, 25000000); assert.equal(pcm.sha256, result.receipt.audio.sha256);
    assert.deepEqual(readFileSync(join(f.root, "media", "blobs", `${f.source.sha256}.wav`)), f.originalBytes);
    assert.deepEqual(f.store.getProject(f.project.id), before);
    for (const kind of ["artifact", "narration_cue", "narration_acceptance", "narration_canonical"]) assert.deepEqual(f.store.list(kind, f.project.id), []);
    const calls = { ...f.calls }; f.reopen(); assert.deepEqual(await f.prepare(), result); assert.deepEqual(f.calls, calls);
    assert.equal("path" in f.store.get("transcription_audio_receipt", result.receipt.id), false);
  }
});

test("targeted provenance lookup ignores unrelated history and never scans a source family", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 200; i++) f.store.insert("media_source", `unrelated-${i}`, f.project.id, { source: { invalid: true } });
  const list = f.store.list.bind(f.store);
  f.store.list = (kind, ...args) => { assert.ok(kind !== "media_source" && kind !== "narration_audio", "must use fixed-ID lookups"); return list(kind, ...args); };
  await f.prepare(); assert.equal(f.calls.derive, 1);
});

test("changed frozen input, foreign source, or conflicting matching descriptor fails before recipe selection", async t => {
  for (const corrupt of [
    f => ({ ...f.attempt, request: { ...f.request, inputs: [{ ...f.request.inputs[0], sha256: "0".repeat(64) }] } }),
    f => { f.store.db.prepare("UPDATE entities SET body=? WHERE kind=? AND id=?").run(canonical({ ...f.record, projectId: "foreign" }), f.sourceKind, f.record.id); return f.attempt; },
    f => { const { id, ...body } = f.source; body.toolchainDigest = "a".repeat(64); const source = { ...body, id: digest(body) };
      f.store.insert("narration_audio", f.source.artifactId, f.project.id, { media: source }); return f.attempt; },
  ]) {
    const f = await fixture(t); await assert.rejects(f.prepare(corrupt(f)));
    assert.deepEqual(f.calls, { describe: 0, derive: 0 }); assert.deepEqual(f.store.list("transcription_audio_intent", f.project.id), []);
  }
});

test("an absent or pre-entry replacement lease cannot prepare a recording", async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.prepare(f.attempt, { signal: f.controller.signal }), { code: "TRANSCRIPTION_AUDIO_LEASE_LOST" });
  f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: "replacement", leaseEpoch: 2 });
  await assert.rejects(f.prepare(), { code: "TRANSCRIPTION_AUDIO_LEASE_LOST" }); assert.equal(f.calls.describe, 0);
});

test("captured original signal survives option mutation and cancels before intent publication", async t => {
  const f = await fixture(t), options = f.options(), attempt = structuredClone(f.attempt), verified = f.media.verifiedSource.bind(f.media);
  let entered, resume; const at = new Promise(resolve => entered = resolve), wait = new Promise(resolve => resume = resolve);
  f.media.verifiedSource = async (...args) => { entered(); await wait; assert.equal(args[1].signal, f.controller.signal); return verified(...args); };
  const running = f.service.prepare(attempt, options); await at;
  options.signal = new AbortController().signal; options.expectedLease.owner = "changed"; attempt.request.inputs.length = 0;
  f.controller.abort(); resume(); await assert.rejects(running, { code: "MEDIA_CANCELLED" });
  assert.deepEqual(f.store.list("transcription_audio_intent", f.project.id), []); assert.equal(f.calls.describe, 0);
});

test("lease loss during source verification prevents a new intent or conversion", async t => {
  const f = await fixture(t), verified = f.media.verifiedSource.bind(f.media);
  f.media.verifiedSource = async (...args) => { const result = await verified(...args);
    f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: "replacement", leaseEpoch: 2 }); return result; };
  await assert.rejects(f.prepare(), { code: "TRANSCRIPTION_AUDIO_LEASE_LOST" }); assert.equal(f.calls.describe, 0);
});

test("SQL failure after immutable completion recovers after reopen without toolchain lookup or another conversion", async t => {
  const f = await fixture(t), put = f.store.put.bind(f.store); let failed = false;
  f.store.put = (...args) => { const value = put(...args); if (args[0] === "transcription_audio_receipt" && !failed) { failed = true; throw Error("synthetic SQL receipt failure"); } return value; };
  await assert.rejects(f.prepare(), /synthetic SQL receipt failure/);
  assert.equal(f.store.list("transcription_audio_receipt", f.project.id).length, 0);
  const id = transcriptionAudioId(f.project.id, f.attempt.id); assert.ok(existsSync(join(f.root, "audio-derivatives", "completions", `${id}.json`)));
  const calls = { ...f.calls }; f.reopen(); await f.prepare(); assert.deepEqual(f.calls, calls);
});

test("incomplete conversion requires its pinned recipe and never substitutes a new toolchain", async t => {
  const f = await fixture(t); f.media.deriveTranscriptionAudio = async () => { throw new DomainError("MEDIA_BUSY", "test occupied"); };
  await assert.rejects(f.prepare(), { code: "MEDIA_BUSY" });
  const describe = f.media.describeTranscriptionAudio.bind(f.media);
  f.media.describeTranscriptionAudio = async (...args) => ({ ...await describe(...args), toolchainDigest: "a".repeat(64) });
  await assert.rejects(f.prepare(), { code: "TRANSCRIPTION_AUDIO_RECIPE_CHANGED" }); assert.equal(f.store.list("transcription_audio_intent", f.project.id).length, 1);
});

test("late lease loss retains completed filesystem evidence but cannot publish SQL or borrow the replacement owner", async t => {
  const f = await fixture(t), derive = f.media.deriveTranscriptionAudio.bind(f.media);
  f.media.deriveTranscriptionAudio = (input, options) => derive(input, { ...options, persistCompletion: async (...args) => {
    f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: "replacement", leaseEpoch: 2 }); await options.persistCompletion(...args);
  } });
  await assert.rejects(f.prepare(), { code: "TRANSCRIPTION_AUDIO_LEASE_LOST" }); assert.equal(f.store.list("transcription_audio_receipt", f.project.id).length, 0);
  const current = f.store.get("attempt", f.attempt.id), calls = { ...f.calls }; f.reopen(); await f.prepare(current); assert.deepEqual(f.calls, calls);
});

test("late abort before installation preserves cancellation and permits only the documented pre-index local repeat gap", async t => {
  const f = await fixture(t), derive = f.media.deriveTranscriptionAudio.bind(f.media);
  f.media.deriveTranscriptionAudio = (input, options) => derive(input, { ...options, persistCompletion: async (...args) => {
    f.controller.abort(); await options.persistCompletion(...args);
  } });
  await assert.rejects(f.prepare(), { code: "MEDIA_CANCELLED" });
  assert.equal(f.calls.derive, 1); assert.equal(f.store.list("transcription_audio_receipt", f.project.id).length, 0);
  assert.deepEqual(readdirSync(join(f.files.rootDir, "completions")), []); assert.deepEqual(readdirSync(join(f.files.rootDir, "tmp")), []);
  await assert.rejects(f.prepare(), { code: "MEDIA_CANCELLED" }); assert.equal(f.calls.derive, 1);
});

test("late abort after durable index rejects the result while retaining exact restart recovery", async t => {
  const f = await fixture(t), install = f.files.install.bind(f.files);
  f.files.install = async (...args) => { const result = await install(...args); f.controller.abort(); return result; };
  await assert.rejects(f.prepare(), { code: "MEDIA_CANCELLED" });
  assert.equal(f.store.list("transcription_audio_receipt", f.project.id).length, 0);
  assert.equal(readdirSync(join(f.files.rootDir, "completions")).length, 1);
  const calls = { ...f.calls }; f.reopen();
  await f.service.prepare(f.attempt, { ...f.options(), signal: new AbortController().signal }); assert.deepEqual(f.calls, calls);
});

test("simultaneous preparations share the local worker and produce one immutable conversion", async t => {
  const f = await fixture(t), derive = f.media.deriveTranscriptionAudio.bind(f.media);
  let entered, resume; const at = new Promise(resolve => entered = resolve), wait = new Promise(resolve => resume = resolve);
  f.media.deriveTranscriptionAudio = (input, options) => derive(input, { ...options, persistCompletion: async (...args) => {
    entered(); await wait; return options.persistCompletion(...args);
  } });
  const first = f.prepare(); await at;
  try { await assert.rejects(f.prepare(), { code: "MEDIA_BUSY" }); } finally { resume(); }
  const result = await first; assert.equal(f.calls.derive, 1); assert.equal(f.store.list("transcription_audio_receipt", f.project.id).length, 1);
  f.reopen(); assert.deepEqual(await f.prepare(), result); assert.equal(f.calls.derive, 1);
});

test("changed original bytes fail before conversion even when all saved metadata remains unchanged", async t => {
  const f = await fixture(t), path = join(f.root, "media", "blobs", `${f.source.sha256}.wav`);
  chmodSync(path, 0o600); const bytes = readFileSync(path); bytes[bytes.length - 1] ^= 1; writeFileSync(path, bytes);
  await assert.rejects(f.prepare()); assert.deepEqual(f.calls, { describe: 0, derive: 0 });
  assert.equal(f.store.list("transcription_audio_intent", f.project.id).length, 0);
});

test("a measured endpoint failure remains durable evidence and is rejected again without reconversion", async t => {
  const f = await fixture(t), bad = wav(15900, 16000, 1), path = join(f.parent, "short-derivative.wav"); writeFileSync(path, bad);
  f.media.deriveTranscriptionAudio = async (_input, options) => { f.calls.derive++;
    await options.persistCompletion({ sha256: sha(bad), byteLength: bad.length, sampleRate: 16000, channels: 1, bitsPerSample: 16,
      sampleCount: 15900, endDelta48kSamples: 15900 * 3 - f.source.probe.audio.samples }, path); };
  await assert.rejects(f.prepare(), { code: "TRANSCRIPTION_AUDIO_ENDPOINT_MISMATCH" });
  assert.equal(f.store.list("transcription_audio_receipt", f.project.id).length, 0);
  f.reopen(); await assert.rejects(f.prepare(), { code: "TRANSCRIPTION_AUDIO_ENDPOINT_MISMATCH" }); assert.equal(f.calls.derive, 1);
});

test("completed derivative corruption, symlinks, and changed provenance fail independent replay checks", async t => {
  for (const change of [
    (f, result) => { chmodSync(result.path, 0o600); const bytes = readFileSync(result.path); bytes[bytes.length - 1] ^= 1; writeFileSync(result.path, bytes); },
    (f, result) => { unlinkSync(result.path); symlinkSync(join(f.root, "media", "blobs", `${f.source.sha256}.wav`), result.path); },
    f => f.store.db.prepare("UPDATE entities SET body=? WHERE kind=? AND id=?").run(canonical({ ...f.record, requestId: "changed" }), f.sourceKind, f.record.id),
  ]) { const f = await fixture(t), result = await f.prepare(); change(f, result); f.reopen(); await assert.rejects(f.prepare()); assert.equal(f.calls.derive, 1); }
});

test("strict immutable intent and receipt reject ranges, paths, changed identities and measured geometry", async t => {
  const f = await fixture(t), result = await f.prepare(), intent = f.store.get("transcription_audio_intent", result.receipt.id);
  for (const changed of [{ ...intent, sourceStartSample: 1 }, { ...intent, path: "/unowned" }, { ...intent, sourceRecord: { ...intent.sourceRecord, digest: "0".repeat(64) } }])
    assert.throws(() => assertTranscriptionAudioIntent(changed, f.attempt, { kind: f.sourceKind, record: f.record }));
  assert.throws(() => assertTranscriptionAudioReceipt(intent, { ...result.receipt, audio: { ...result.receipt.audio, sampleRate: 48000 } }));
  assert.throws(() => f.store.put("transcription_audio_receipt", result.receipt.id, f.project.id,
    { ...result.receipt, audio: { ...result.receipt.audio, sha256: "a".repeat(64) } }), { code: "IMMUTABLE_RECORD" });
});
