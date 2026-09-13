import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonical, digest } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { createInstallationBackup, inspectInstallationBackup } from '../dist/persistence/installation-backup.js';
import { restoreInstallationBackup } from '../dist/persistence/installation-restore.js';
import { InstallationRecoveryGuard, releaseRecovery } from '../dist/application/installation-recovery.js';
import { resolveTranscriptionPreparationIntent } from '../dist/execution/transcription-preparation.js';
import { preparationEngineFixture, current, rows } from './transcription-preparation-engine-fixture.mjs';

function clean(path) { if (!existsSync(path)) return; if (lstatSync(path).isDirectory()) {
  chmodSync(path, 0o700); for (const name of readdirSync(path)) clean(join(path, name)); } rmSync(path, { recursive: true, force: true }); }
async function fixture(t) {
  const f = await preparationEngineFixture(t); await f.engine.runReady(f.project.id);
  assert.equal(current(f).phase, 'preparing'); assert.equal(current(f).preparation.waitCount, 1);
  new FakeProvider(join(f.directory, 'fake-provider.sqlite')).close();
  // The actual import already retained both managed copies; this fixture owns its disposable staging file.
  unlinkSync(f.sourcePath);
  f.backupParent = mkdtempSync(join(tmpdir(), 'openslate-preparation-restore-'));
  f.destination = join(f.backupParent, 'backup'); f.archive = join(f.backupParent, 'original-installation');
  t.after(() => clean(f.backupParent)); return f;
}
const backup = f => createInstallationBackup({ sourceRoot: f.directory, destination: f.destination });
const authority = f => canonical(Object.fromEntries(['candidate', 'grant', 'reservation', 'external_allowance', 'external_allowance_consumption',
  'narration_audio', 'narration_segment', 'narration_cue', 'narration_acceptance', 'narration_canonical'].map(kind => [kind, rows(f, kind)])));

test('actual same-root restore preserves waiting proof/source but never resumes imported conversion or first POST', async t => {
  const f = await fixture(t), attempt = current(f), proof = resolveTranscriptionPreparationIntent(f.store, attempt);
  const before = { project: f.store.getProject(f.project.id), authority: authority(f), attempt, calls: { ...f.calls } };
  const original = readFileSync(join(f.directory, 'media', 'blobs', `${proof.source.originalSha256}.source`));
  const normalized = readFileSync(join(f.directory, 'media', 'blobs', `${proof.source.sha256}.wav`));
  f.store.close(); const saved = await backup(f); assert.deepEqual(await inspectInstallationBackup({ directory: saved.directory }), saved);
  assert.deepEqual(readFileSync(join(saved.directory, 'media', 'blobs', `${proof.source.originalSha256}.source`)), original);
  assert.deepEqual(readFileSync(join(saved.directory, 'media', 'blobs', `${proof.source.sha256}.wav`)), normalized);
  renameSync(f.directory, f.archive); const restored = await restoreInstallationBackup({ directory: saved.directory, destination: f.directory });
  assert.equal(restored.status, 'restored'); f.reopen();
  assert.deepEqual(current(f), before.attempt); assert.deepEqual(resolveTranscriptionPreparationIntent(f.store, current(f)), proof);
  assert.equal(authority(f), before.authority); assert.deepEqual(f.store.getProject(f.project.id), before.project);
  await assert.rejects(f.engine.reconcile(f.project.id), { code: 'INSTALLATION_QUARANTINED' });
  const guard = new InstallationRecoveryGuard(f.store), view = guard.snapshot();
  assert.equal(view.counts.preparingJobs, 1); assert.equal(view.counts.unknownJobs, 0); assert.equal(view.counts.knownJobs, 0);
  releaseRecovery(f.store, { restoreId: view.receipt.restoreId, expectedReceiptDigest: view.receiptDigest, expectedSummaryDigest: view.summaryDigest },
    { principalId: 'offline-human', commandId: 'release-exact-waiting-installation' });
  assert.equal(f.store.get('execution_control', f.project.id).paused, true);
  await f.engine.reconcile(f.project.id); assert.deepEqual(current(f), before.attempt);
  assert.throws(() => guard.assertFirstSubmit(f.project.id, attempt.id), { code: 'RESTORED_AUTHORITY_REQUIRES_NEW' });
  // Even a controlled fresh worker lease does not remove the permanent imported-first-submit fence.
  const leased = f.store.put('attempt', attempt.id, f.project.id, { ...current(f), leaseOwner: 'restored-proof-check',
    leaseEpoch: attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
  await assert.rejects(f.worker.bridge.resume(leased.request, { signal: new AbortController().signal,
    expectedLease: { owner: leased.leaseOwner, epoch: leased.leaseEpoch }, eligibility: () => ({ type: 'ready' }) }), { code: 'RESTORED_AUTHORITY_REQUIRES_NEW' });
  assert.equal(authority(f), before.authority); assert.deepEqual(f.calls, before.calls);
  for (const kind of ['transcription_audio_intent', 'transcription_execution_mapping', 'transcription_execution_dispatch', 'transcription_execution_result']) assert.equal(rows(f, kind).length, 0);
  assert.equal(digest(resolveTranscriptionPreparationIntent(f.store, current(f))), digest(proof));
  // The summary does not confuse damaged protocol evidence with positive non-submission proof.
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='transcription_preparation_intent' AND id=?").run(canonical({ ...proof, sourceEndSample: 1 }), proof.id);
  const beforeSnapshot = f.store.db.prepare('SELECT kind,id,body,version FROM entities ORDER BY kind,id').all();
  const damaged = guard.snapshot(); assert.equal(Object.hasOwn(damaged.counts, 'preparingJobs'), false); assert.equal(damaged.counts.unknownJobs, 1);
  assert.deepEqual(f.store.db.prepare('SELECT kind,id,body,version FROM entities ORDER BY kind,id').all(), beforeSnapshot);
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='transcription_preparation_intent' AND id=?").run(canonical(proof), proof.id);
});

test('backup rejects missing proof, stripped metadata, changed source provenance, liability and absent owned bytes', async t => {
  for (const damage of ['missing_proof', 'metadata', 'source_record', 'source_bytes', 'settlement']) {
    const f = await fixture(t), attempt = current(f), proof = resolveTranscriptionPreparationIntent(f.store, attempt);
    if (damage === 'missing_proof') f.store.db.prepare("DELETE FROM entities WHERE kind='transcription_preparation_intent' AND id=?").run(attempt.id);
    else if (damage === 'metadata') { const value = { ...attempt }; delete value.preparation;
      f.store.db.prepare("UPDATE entities SET body=? WHERE kind='attempt' AND id=?").run(canonical(value), attempt.id); }
    else if (damage === 'source_record') { const ref = proof.sourceRecord, value = f.store.get(ref.kind, ref.id);
      f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical({ ...value, altered: true }), ref.kind, ref.id); }
    else if (damage === 'source_bytes') unlinkSync(join(f.directory, 'media', 'blobs', `${proof.source.originalSha256}.source`));
    else { f.store.transaction(() => {
      f.store.put('attempt', attempt.id, f.project.id, { ...attempt, phase: 'failed', leaseExpiresAt: 0,
        failure: { id: 'PREPARATION_OBSOLETE', technical: false, source: 'application:submission-preparation/1', retryAllowed: false } });
      // Deliberately commit the invalid half-settlement; an application transaction must also release its reservation.
    }); }
    await assert.rejects(backup(f)); assert.equal(existsSync(f.destination), false); assert.equal(f.calls.http, 0);
  }
});
