import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, DomainError } from "@openslate/core";
import { createInstallationBackup, inspectInstallationBackup, installationBackupFileKind } from "../dist/persistence/installation-backup.js";
import { restoreInstallationBackup } from "../dist/persistence/installation-restore.js";
import { InstallationRecoveryGuard, releaseRecovery } from "../dist/application/installation-recovery.js";
import { transcriptionAudioId } from "../dist/execution/transcription-audio.js";
import { fixture, wav, sha } from "./transcription-audio-fixture.mjs";

const backup = f => createInstallationBackup({ sourceRoot: f.root, destination: join(f.parent, "backup") });
const release = f => {
  const recovery = new InstallationRecoveryGuard(f.store), view = recovery.snapshot();
  releaseRecovery(f.store, { restoreId: view.receipt.restoreId, expectedReceiptDigest: view.receiptDigest, expectedSummaryDigest: view.summaryDigest },
    { principalId: "human", commandId: "release-this-exact-restored-installation" }); return recovery;
};

test("filesystem-only transcription completion survives actual same-root restore and human release without conversion or source adoption", async t => {
  const f = await fixture(t, { sourceKind: "narration_audio" }), put = f.store.put.bind(f.store);
  f.store.put = (...args) => { const result = put(...args); if (args[0] === "transcription_audio_receipt") throw Error("SQL commit failed after completed derivative"); return result; };
  await assert.rejects(f.prepare(), /SQL commit failed/);
  const id = transcriptionAudioId(f.project.id, f.attempt.id), completionPath = `audio-derivatives/completions/${id}.json`;
  const receipt = JSON.parse(readFileSync(join(f.root, completionPath))), originalIntent = f.store.get("transcription_audio_intent", id);
  const originalProject = f.store.getProject(f.project.id), originalSource = f.store.get("narration_audio", f.record.id);
  writeFileSync(join(f.files.rootDir, "tmp", "unfinished.tmp"), "not-published");
  const exported = await backup(f); await inspectInstallationBackup({ directory: exported.directory });
  assert.ok(exported.manifest.files.some(file => file.path === completionPath));
  assert.ok(exported.manifest.files.some(file => file.path === `audio-derivatives/blobs/${receipt.audio.sha256}.wav`));
  assert.equal(exported.manifest.files.some(file => file.path.includes("unfinished.tmp")), false);
  assert.equal(f.store.list("transcription_audio_receipt", f.project.id).length, 0);
  f.store.close(); renameSync(f.root, join(f.parent, "original-installation"));
  await restoreInstallationBackup({ directory: exported.directory, destination: f.root }); f.reopen();
  await assert.rejects(f.prepare(), { code: "INSTALLATION_QUARANTINED" });
  const guard = release(f), restored = f.store.get("attempt", f.attempt.id);
  assert.equal(restored.phase, "submitting", "restore retains the original attempt phase as history");
  assert.throws(() => guard.assertFirstSubmit(f.project.id, restored.id), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  // Controlled equivalent of the existing reconciler's replacement claim; this component never claims a lease itself.
  const claimed = f.store.put("attempt", restored.id, f.project.id, { ...restored, phase: "submission_unknown", leaseOwner: "restore-worker", leaseEpoch: restored.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
  const calls = { ...f.calls }, recovered = await f.prepare(claimed); assert.deepEqual(f.calls, calls);
  assert.deepEqual(recovered.receipt, receipt); assert.equal(sha(readFileSync(recovered.path)), receipt.audio.sha256);
  assert.deepEqual(f.store.get("transcription_audio_intent", id), originalIntent);
  assert.deepEqual(f.store.getProject(f.project.id), originalProject); assert.deepEqual(f.store.get("narration_audio", f.record.id), originalSource);
  for (const kind of ["artifact", "narration_cue", "narration_acceptance", "narration_canonical"]) assert.deepEqual(f.store.list(kind, f.project.id), []);
  assert.equal(f.calls.derive, 1);
});

test("restored incomplete intent cannot start conversion even after human release and a fresh worker lease", async t => {
  const f = await fixture(t); f.media.deriveTranscriptionAudio = async () => { throw new DomainError("MEDIA_BUSY", "occupied"); };
  await assert.rejects(f.prepare(), { code: "MEDIA_BUSY" }); const exported = await backup(f);
  f.store.close(); renameSync(f.root, join(f.parent, "original-installation"));
  await restoreInstallationBackup({ directory: exported.directory, destination: f.root }); f.reopen(); release(f);
  const restored = f.store.get("attempt", f.attempt.id), current = f.store.put("attempt", restored.id, f.project.id,
    { ...restored, phase: "submitting", leaseOwner: "new-worker", leaseEpoch: restored.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
  await assert.rejects(f.prepare(current), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  assert.equal(f.store.list("transcription_audio_receipt", f.project.id).length, 0);
});

test("backup rejects a lost original, changed request/provenance, or missing derivative completion", async t => {
  for (const damage of [
    f => unlinkSync(join(f.root, "media", "blobs", `${f.source.sha256}.wav`)),
    f => f.store.db.prepare("UPDATE entities SET body=? WHERE kind='attempt' AND id=?").run(canonical({ ...f.attempt, request: { ...f.request, args: { changed: true } } }), f.attempt.id),
    f => f.store.db.prepare("UPDATE entities SET body=? WHERE kind=? AND id=?").run(canonical({ ...f.record, requestId: "changed" }), f.sourceKind, f.record.id),
    (f, result) => unlinkSync(join(f.files.rootDir, "completions", `${result.receipt.id}.json`)),
  ]) {
    const f = await fixture(t), result = await f.prepare(); damage(f, result);
    await assert.rejects(backup(f)); assert.equal(existsSync(join(f.parent, "backup")), false);
  }
});

test("backup keeps a measured endpoint failure as evidence without accepting it or scheduling another conversion", async t => {
  const f = await fixture(t), bytes = wav(15900, 16000, 1), path = join(f.parent, "short.wav"); writeFileSync(path, bytes);
  f.media.deriveTranscriptionAudio = async (_input, options) => { f.calls.derive++;
    await options.persistCompletion({ sha256: sha(bytes), byteLength: bytes.length, sampleRate: 16000, channels: 1, bitsPerSample: 16,
      sampleCount: 15900, endDelta48kSamples: 15900 * 3 - f.source.probe.audio.samples }, path); };
  await assert.rejects(f.prepare(), { code: "TRANSCRIPTION_AUDIO_ENDPOINT_MISMATCH" });
  const exported = await backup(f); await inspectInstallationBackup({ directory: exported.directory });
  assert.equal(f.store.list("transcription_audio_receipt", f.project.id).length, 0);
  assert.ok(exported.manifest.files.some(file => file.path.startsWith("audio-derivatives/completions/")));
  f.reopen(); await assert.rejects(f.prepare(), { code: "TRANSCRIPTION_AUDIO_ENDPOINT_MISMATCH" }); assert.equal(f.calls.derive, 1);
});

test("derivative backup names remain fixed and do not introduce transcript or temporary namespaces", () => {
  const id = "a".repeat(64);
  assert.equal(installationBackupFileKind(`audio-derivatives/blobs/${id}.wav`), "owned_media");
  assert.equal(installationBackupFileKind(`audio-derivatives/completions/${id}.json`), "owned_metadata");
  for (const path of [`audio-derivatives/tmp/${id}.wav`, `audio-derivatives/blobs/${id}.mp3`, `audio-derivatives/transcripts/${id}.json`])
    assert.equal(installationBackupFileKind(path), null);
});
