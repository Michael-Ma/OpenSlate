import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compilePlan, DEFAULT_PROFILES, DomainError, canonical, digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Engine } from "../dist/execution/engine.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { ExecutionIngestionRouter } from "../dist/execution/ingestion-router.js";
import { audioArtifactId, audioDerivationId } from "../dist/execution/audio-derivation.js";
import { SpoolAudioIngestor } from "../dist/execution/spool-audio-ingester.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { Store } from "../dist/persistence/store.js";
import { createInstallationBackup, inspectInstallationBackup } from "../dist/persistence/installation-backup.js";
import { restoreInstallationBackup } from "../dist/persistence/installation-restore.js";
import { installRecoveryQuarantine, releaseRecovery } from "../dist/application/installation-recovery.js";
import { projectFixture } from "./execution-fixture.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function wav(rate, channels, samples) {
  const bytes = Buffer.alloc(44 + samples * channels * 2); bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
}
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "openslate-engine-audio-"))), dbPath = join(root, "openslate.sqlite"), artifactDir = join(root, "artifacts");
  const provider = new FakeProvider(join(root, "fake-provider.sqlite")), project = projectFixture(randomUUID(), 0);
  let store = new Store(dbPath), engine, outputs, handler;
  const calls = { submit: 0, poll: 0, lookup: 0, normalization: 0, ingestion: 0 };
  const raw = wav(24000, 1, 24000), normalized = wav(48000, 2, 48000);
  const normalizedSha = sha(normalized);
  const create = () => {
    outputs = new ExecutionOutputStore(store, { rootDir: join(root, "execution-output") });
    engine = new Engine(store, provider, { artifactDir, outputStore: outputs,
      outputIngestor: new ExecutionIngestionRouter({ audio: { async ingest(input) { calls.ingestion++; return handler(input); } } }) });
  };
  const derive = async input => {
    const { attempt, output } = input; engine.recovery.assertWritable(attempt.projectId);
    const owned = await outputs.resolveOutput(attempt.projectId, attempt.id, output, { signal: input.signal });
    const id = audioDerivationId(attempt.projectId, attempt.id), artifactId = audioArtifactId(id);
    let intent = store.get("audio_derivation_intent", id);
    if (!intent) intent = store.insert("audio_derivation_intent", id, attempt.projectId, { version: 1, attemptId: attempt.id,
      requestDigest: digest(attempt.request), slotId: digest({ projectId: attempt.projectId, attemptId: attempt.id, port: "audio" }),
      spoolId: owned.spool.id, rawSha256: output.sha256, rawByteLength: output.byteLength, artifactId, recipe: "generated-audio-v1",
      rawPcm: { sampleRate: 24000, channels: 1, sampleCount: 24000, bitsPerSample: 16 }, normalization: { version: 1,
        recipe: "pcm-s16le-48khz-stereo-v1", toolchainDigest: "a".repeat(64), maxInputBytes: 32 * 1024 ** 2,
        maxOutputBytes: 256 * 1024 ** 2, maxSamples: 48000 * 360, timeoutMs: 120000 } });
    const index = join(root, "audio-derivations", "completions", `${id}.json`);
    let receipt;
    if (existsSync(index)) receipt = JSON.parse(readFileSync(index));
    else {
      calls.normalization++;
      const sourceBody = { artifactId, kind: "audio", originalSha256: output.sha256, originalByteLength: output.byteLength,
        sha256: normalizedSha, byteLength: normalized.length, probe: { durationSeconds: 1,
          audio: { streamIndex: 0, sampleRate: 48000, channels: 2, samples: 48000, durationSeconds: 1, codec: "pcm_s16le" } },
        toolchainDigest: intent.normalization.toolchainDigest };
      const source = { ...sourceBody, id: digest(sourceBody) };
      receipt = { id, version: 1, projectId: attempt.projectId, attemptId: attempt.id, intentDigest: digest(intent), source,
        normalizedSamples: 48000, endpointDeltaNumerator: 0 };
      mkdirSync(join(root, "audio-derivations", "completions"), { recursive: true }); writeFileSync(index, canonical(receipt));
      mkdirSync(join(artifactDir, attempt.projectId), { recursive: true });
      writeFileSync(join(artifactDir, attempt.projectId, `${normalizedSha}.wav`), normalized);
    }
    return { type: "normalized_audio", derivation: receipt, artifact: { id: artifactId, projectId: attempt.projectId, attemptId: attempt.id,
      artifact: { artifactId, kind: "audio", sha256: receipt.source.sha256 }, path: join(artifactDir, attempt.projectId, `${normalizedSha}.wav`),
      mimeType: "audio/wav", fixture: false, origin: "generated_audio", physicalDurationSeconds: 1, byteLength: receipt.source.byteLength,
      outputReceiptId: owned.spool.receiptId, outputSpoolId: owned.spool.id, derivationId: id, sourceDescriptorId: receipt.source.id },
      mediaSource: { id: artifactId, projectId: attempt.projectId, source: receipt.source, origin: "generated_audio", attemptId: attempt.id, derivationId: id } };
  };
  handler = derive; create(); store.createProject(project);
  const plan = compilePlan(`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{
    return p.speech("voice",{profile:"fake-speech-v1",text:"Leather boots",voice:"demo"});});`,
  { project, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: randomUUID });
  const node = plan.nodes[0], grant = engine.createGrant(project.id, project.id, "speech", "offline-human", "initial_slot"), planId = randomUUID();
  store.transaction(() => { engine.installPlan(project.id, planId, plan, { [node.id]: grant.id }); store.saveProject({ ...project, activePlanId: planId }, 0); });
  const original = store.getProject(project.id);
  provider.submit = async request => {
    calls.submit++;
    const receipt = outputs.recordReceipt(project.id, { attemptId: request.attemptId, expectedRequestDigest: digest(request), port: "audio", kind: "audio",
      mimeType: "audio/wav", vendorTaskId: null, diagnosticRequestId: "synthetic-speech", source: { kind: "returned_bytes", sha256: sha(raw), byteLength: raw.length } });
    await outputs.spool(project.id, receipt.id, async function* () { yield raw; }); return outputs.recoverCompletion(project.id, request.attemptId);
  };
  provider.poll = async () => { calls.poll++; throw Error("Known audio must not poll"); };
  provider.lookup = async () => { calls.lookup++; throw Error("Known audio must not look up or resubmit"); };
  t.after(() => { if (store.db.open) store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, projectId: project.id, original, node, raw, normalized, calls, derive, setHandler(value) { handler = value; },
    get store() { return store; }, get engine() { return engine; }, get outputs() { return outputs; },
    expire() { const attempt = engine.attempts(project.id)[0]; store.put("attempt", attempt.id, project.id, { ...attempt, leaseExpiresAt: 0 }); },
    close() { if (store.db.open) store.close(); provider.close(); },
    reopen() { if (store.db.open) store.close(); store = new Store(dbPath); create(); } };
}

test("tagged generated audio atomically publishes measured artifact, derivation and source without narration adoption", async t => {
  const f = fixture(t); await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId)[0], artifact = f.store.list("artifact", f.projectId)[0];
  assert.equal(attempt.phase, "succeeded"); assert.equal(attempt.taskId, null); assert.equal(artifact.origin, "generated_audio");
  assert.deepEqual(readFileSync(artifact.path), f.normalized); assert.notEqual(artifact.artifact.sha256, sha(f.raw));
  assert.equal(artifact.physicalDurationSeconds, 1); assert.equal(f.store.list("audio_derivation_receipt", f.projectId).length, 1);
  assert.equal(f.store.get("media_source", artifact.id).source.sha256, artifact.artifact.sha256);
  assert.equal(f.store.get("reservation", attempt.reservationId).state, "charged");
  assert.deepEqual(f.store.getProject(f.projectId), f.original);
  for (const kind of ["narration_audio", "narration_cue", "narration_acceptance", "narration_canonical"]) assert.deepEqual(f.store.list(kind, f.projectId), []);
  f.reopen(); await f.engine.reconcile(); await f.engine.runReady();
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0, normalization: 1, ingestion: 1 });
});

test("SQL failure after filesystem audio completion rolls back all artifact/source rows and reopens without provider or normalization replay", async t => {
  const f = fixture(t), insert = f.store.insert.bind(f.store); let fail = true;
  f.store.insert = (...args) => { const result = insert(...args); if (args[0] === "audio_derivation_receipt" && fail) { fail = false; throw Error("synthetic SQL rollback"); } return result; };
  await assert.rejects(f.engine.runReady(), /synthetic SQL rollback/);
  for (const kind of ["artifact", "audio_derivation_receipt", "media_source"]) assert.deepEqual(f.store.list(kind, f.projectId), []);
  const attempt = f.engine.attempts(f.projectId)[0]; assert.equal(attempt.phase, "ingesting");
  assert.equal(f.store.get("reservation", attempt.reservationId).state, "reserved");
  assert.equal(f.store.list("audio_derivation_intent", f.projectId).length, 1);
  f.expire(); f.reopen(); await f.engine.reconcile();
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded");
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0, normalization: 1, ingestion: 2 });
});

test("real audio normalization survives SQL rollback and same-root backup restore without another decode or provider call", async t => {
  const f = fixture(t), copies = mkdtempSync(join(tmpdir(), "openslate-audio-backup-proof-"));
  const clean = path => { if (!existsSync(path)) return; if (statSync(path).isDirectory()) {
    chmodSync(path, 0o700); for (const name of readdirSync(path)) clean(join(path, name)); } rmSync(path, { recursive: true, force: true }); };
  t.after(() => clean(copies));
  const paths = { ffmpegPath: process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg"),
    ffprobePath: process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe") };
  const setRealHandler = recovered => {
    const media = new LocalMediaService({ rootDir: join(f.root, "media"), allowedInputRoots: [f.outputs.rootDir], ...paths });
    const original = media.importMedia.bind(media);
    media.importMedia = async (...args) => { assert.equal(recovered, false, "completed recovery must not decode again"); f.calls.normalization++; return original(...args); };
    if (recovered) media.describeAudioNormalization = async () => { throw Error("completed recovery must not select a new recipe"); };
    const ingester = new SpoolAudioIngestor(f.outputs, media, { rootDir: join(f.root, "audio-derivations") });
    f.setHandler(input => ingester.ingest(input));
  };
  setRealHandler(false);
  const insert = f.store.insert.bind(f.store); let fail = true;
  f.store.insert = (...args) => { const result = insert(...args); if (args[0] === "audio_derivation_receipt" && fail) { fail = false; throw Error("actual audio SQL rollback"); } return result; };
  await assert.rejects(f.engine.runReady(), /actual audio SQL rollback/);
  assert.deepEqual(f.store.list("artifact", f.projectId), []); assert.deepEqual(f.store.list("audio_derivation_receipt", f.projectId), []);
  const intent = f.store.list("audio_derivation_intent", f.projectId)[0], completionPath = `audio-derivations/completions/${intent.id}.json`;
  const completion = JSON.parse(readFileSync(join(f.root, completionPath)));
  assert.equal(completion.normalizedSamples, 48000); assert.equal(completion.source.probe.audio.sampleRate, 48000);
  assert.equal(completion.source.probe.audio.channels, 2); assert.equal(completion.endpointDeltaNumerator, 0);
  f.expire();
  const backup = await createInstallationBackup({ sourceRoot: f.root, destination: join(copies, "backup") });
  assert.ok(backup.manifest.files.some(file => file.path === completionPath)); await inspectInstallationBackup({ directory: backup.directory });
  f.close(); renameSync(f.root, join(copies, "original"));
  const restored = await restoreInstallationBackup({ directory: backup.directory, destination: f.root });
  assert.equal(restored.status, "restored");
  f.reopen(); setRealHandler(true);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, completionPath))), completion);
  const recovery = f.engine.recovery.snapshot(); assert.equal(recovery.state, "quarantined");
  await assert.rejects(f.engine.reconcile(), { code: "INSTALLATION_QUARANTINED" });
  assert.equal(f.calls.ingestion, 1);
  releaseRecovery(f.store, { restoreId: recovery.receipt.restoreId, expectedReceiptDigest: recovery.receiptDigest, expectedSummaryDigest: recovery.summaryDigest },
    { principalId: "human", commandId: "release-restored-audio" });
  const savedAttempt = f.engine.attempts(f.projectId)[0];
  assert.throws(() => f.engine.recovery.assertFirstSubmit(f.projectId, savedAttempt.id), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  await f.engine.reconcile();
  const artifact = f.store.list("artifact", f.projectId)[0]; assert.equal(artifact.origin, "generated_audio");
  assert.equal(artifact.artifact.sha256, completion.source.sha256); assert.equal(artifact.physicalDurationSeconds, 1);
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded"); assert.deepEqual(f.store.getProject(f.projectId), f.original);
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0, normalization: 1, ingestion: 2 });
});

test("invalid tagged audio identity or an untagged WAV cannot be published", async t => {
  for (const mutate of [result => { result.derivation.intentDigest = "0".repeat(64); },
    result => { result.artifact.projectId = "foreign"; }, result => { result.artifact.outputSpoolId = "0".repeat(64); },
    result => { result.artifact.artifact.sha256 = "0".repeat(64); }, result => { result.derivation.normalizedSamples--; },
    result => { result.mediaSource.requestId = "invented-human-upload"; }, result => result.artifact]) {
    const f = fixture(t); f.setHandler(async input => { const result = await f.derive(input); return mutate(result) ?? result; });
    await assert.rejects(f.engine.runReady(), { code: "AUDIO_DERIVATION_CONFLICT" });
    assert.deepEqual(f.store.list("artifact", f.projectId), []); assert.deepEqual(f.store.list("media_source", f.projectId), []);
    assert.equal(f.engine.attempts(f.projectId)[0].phase, "ingesting"); assert.equal(f.calls.submit, 1);
  }
});

test("normalized audio byte verification fails closed even with a plausible metadata receipt", async t => {
  const f = fixture(t); f.setHandler(async input => { const result = await f.derive(input); const bytes = Buffer.from(f.normalized); bytes[44] = 1; writeFileSync(result.artifact.path, bytes); return result; });
  await assert.rejects(f.engine.runReady(), { code: "ARTIFACT_CORRUPT" }); assert.deepEqual(f.store.list("artifact", f.projectId), []);
});

test("known audio MEDIA_BUSY releases only the owned lease and recovers immediately without another provider call", async t => {
  const f = fixture(t); let busy = true;
  f.setHandler(input => { if (busy) { busy = false; throw new DomainError("MEDIA_BUSY", "synthetic worker occupied"); } return f.derive(input); });
  await f.engine.runReady(); const attempt = f.engine.attempts(f.projectId)[0];
  assert.equal(attempt.phase, "ingesting"); assert.equal(attempt.leaseExpiresAt, 0); assert.equal(f.store.get("reservation", attempt.reservationId).state, "reserved");
  f.reopen(); await f.engine.reconcile(); assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded");
  assert.deepEqual(f.calls, { submit: 1, poll: 0, lookup: 0, normalization: 1, ingestion: 2 });
});

test("late audio MEDIA_BUSY cannot overwrite a replacement owner", async t => {
  const f = fixture(t); let replacement;
  f.setHandler(input => {
    const current = f.store.get("attempt", input.attempt.id);
    replacement = { ...current, leaseOwner: "replacement", leaseEpoch: current.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 };
    f.store.put("attempt", current.id, f.projectId, replacement); throw new DomainError("MEDIA_BUSY", "synthetic delayed busy");
  });
  await f.engine.runReady(); assert.deepEqual(f.store.get("attempt", replacement.id), replacement); assert.deepEqual(f.store.list("artifact", f.projectId), []);
});

test("lease loss and retirement during local audio work preserve history without selecting stale bindings", async t => {
  for (const lost of [false, true]) {
    const f = fixture(t); f.setHandler(async input => {
      const result = await f.derive(input);
      if (lost) { const current = f.store.get("attempt", input.attempt.id); f.store.put("attempt", current.id, f.projectId,
        { ...current, leaseOwner: "replacement", leaseEpoch: current.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 }); }
      else { const binding = f.store.get("node_binding", f.node.id); f.store.put("node_binding", binding.id, f.projectId, { ...binding, state: "retired" }); }
      return result;
    });
    await f.engine.runReady(); assert.deepEqual(f.store.get("node_binding", f.node.id).outputs, {});
    assert.equal(f.store.list("artifact", f.projectId).length, lost ? 0 : 1);
    assert.equal(f.store.list("audio_derivation_intent", f.projectId).length, 1);
  }
});

test("quarantine blocks local audio recovery; human release permits existing results but never imported first submission", async t => {
  const f = fixture(t); f.setHandler(() => { throw new DomainError("MEDIA_BUSY", "synthetic unavailable worker"); });
  await f.engine.runReady(); const attempt = f.engine.attempts(f.projectId)[0], count = f.calls.ingestion;
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64),
    sourceDatabaseSha256: "b".repeat(64), originalDataRoot: f.root, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
  await assert.rejects(f.engine.reconcile(), { code: "INSTALLATION_QUARANTINED" }); assert.equal(f.calls.ingestion, count);
  const state = f.engine.recovery.snapshot();
  releaseRecovery(f.store, { restoreId: state.receipt.restoreId, expectedReceiptDigest: state.receiptDigest, expectedSummaryDigest: state.summaryDigest },
    { principalId: "local-user", commandId: randomUUID() });
  assert.throws(() => f.engine.recovery.assertFirstSubmit(f.projectId, attempt.id), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  f.setHandler(f.derive); f.reopen(); await f.engine.reconcile();
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded"); assert.equal(f.calls.submit, 1); assert.equal(f.calls.lookup, 0);
});

test("Store pins audio intent/receipt/source and rejects foreign references and invented upload authority", async t => {
  const f = fixture(t); await f.engine.runReady();
  const intent = f.store.list("audio_derivation_intent", f.projectId)[0], receipt = f.store.list("audio_derivation_receipt", f.projectId)[0];
  assert.throws(() => f.store.put("audio_derivation_intent", intent.id, f.projectId, { ...intent, extra: true }), { code: "IMMUTABLE_RECORD" });
  assert.throws(() => f.store.put("audio_derivation_receipt", receipt.id, f.projectId, { ...receipt, extra: true }), { code: "IMMUTABLE_RECORD" });
  const foreign = projectFixture(randomUUID(), 0); f.store.createProject(foreign);
  assert.throws(() => f.store.insert("audio_derivation_intent", intent.id, foreign.id, { ...intent, projectId: foreign.id }), { code: "SCOPE_DENIED" });
  const source = f.store.get("media_source", intent.artifactId);
  assert.throws(() => f.store.put("media_source", source.id, f.projectId, { ...source, requestId: "invented" }), { code: "IDENTITY_MISMATCH" });
});
