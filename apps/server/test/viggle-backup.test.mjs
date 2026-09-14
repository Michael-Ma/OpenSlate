import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, renameSync, readFileSync, chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from '@openslate/core';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { ViggleH3Execution } from '../dist/execution/viggle-h3-execution.js';
import { SpoolVideoIngestor } from '../dist/execution/spool-video-ingester.js';
import { createInstallationBackup, inspectInstallationBackup } from '../dist/persistence/installation-backup.js';
import { restoreInstallationBackup } from '../dist/persistence/installation-restore.js';
import { InstallationRecoveryGuard, releaseRecovery } from '../dist/application/installation-recovery.js';
import { fixture, context, due, accepted, completed, taskId, rows } from './viggle-h3-execution-fixture.mjs';

const backup = f => createInstallationBackup({ sourceRoot: f.root, destination: join(f.parent, 'backup') });
const expire = f => { const a = f.store.get('attempt', f.attempt.id); f.store.put('attempt', a.id, f.project.id, { ...a, leaseExpiresAt: 0 }); };
async function downloaded(t) {
  const f = await fixture(t, { ingest: true, fetch: (_url, init) => init.method === 'POST' ? accepted() : completed() });
  assert.equal((await f.bridge.submit(f.request, context(f))).type, 'accepted'); due(f);
  assert.equal((await f.bridge.poll(taskId, f.request, context(f))).type, 'completed');
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 1); assert.equal(f.calls.download, 1); return f;
}
function reopen(f) {
  f.store = new Store(f.path); f.stores.push(f.store);
  f.outputs = new ExecutionOutputStore(f.store, { rootDir: join(f.root, 'execution-output') });
  f.bridge = new ViggleH3Execution({ ...f.bridgeOptions, store: f.store, outputStore: f.outputs });
  f.ingester = new SpoolVideoIngestor(f.outputs, f.media, { rootDir: join(f.root, 'video-derivations') });
  f.engine = new Engine(f.store, f.bridge, { ...f.engineOptions, outputStore: f.outputs, outputIngestor: f.ingester });
}
function release(f) {
  const guard = new InstallationRecoveryGuard(f.store), view = guard.snapshot();
  releaseRecovery(f.store, { restoreId: view.receipt.restoreId, expectedReceiptDigest: view.receiptDigest, expectedSummaryDigest: view.summaryDigest },
    { principalId: 'human', commandId: 'release-reviewed-offline-viggle-backup' }); return guard;
}

test('Viggle published normalized output survives real same-root backup and restore without another provider call', async t => {
  const f = await downloaded(t); expire(f); await f.engine.reconcile();
  assert.equal(f.store.get('attempt', f.attempt.id).phase, 'succeeded');
  const artifact = rows(f, 'artifact').find(row => row.artifact.kind === 'video'), project = f.store.getProject(f.project.id);
  assert.ok(artifact); const bytes = readFileSync(artifact.path), calls = { ...f.calls };
  const exported = await backup(f); await inspectInstallationBackup({ directory: exported.directory });
  assert.ok(exported.manifest.files.some(file => file.path.startsWith('video-derivations/completions/')));
  f.store.close(); renameSync(f.root, join(f.parent, 'original-installation'));
  await restoreInstallationBackup({ directory: exported.directory, destination: f.root }); reopen(f);
  await assert.rejects(f.engine.reconcile(), { code: 'INSTALLATION_QUARANTINED' });
  release(f); await f.engine.reconcile();
  assert.deepEqual(f.store.getProject(f.project.id), project); assert.deepEqual(readFileSync(artifact.path), bytes);
  assert.deepEqual(f.calls, calls); assert.equal(rows(f, 'video_derivation_receipt').length, 1);
});

test('Viggle filesystem normalization completion recovers after restore with no normalization or POST replay', async t => {
  const f = await downloaded(t), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === 'video_derivation_receipt') throw Error('interrupt SQL publication'); return insert(...args); };
  expire(f); await assert.rejects(f.engine.reconcile(), /interrupt SQL publication/); f.store.insert = insert;
  assert.equal(rows(f, 'video_derivation_receipt').length, 0); assert.equal(f.calls.normalization, 1);
  const calls = { ...f.calls }, exported = await backup(f);
  f.store.close(); renameSync(f.root, join(f.parent, 'original-installation'));
  await restoreInstallationBackup({ directory: exported.directory, destination: f.root }); reopen(f); release(f);
  f.media.importMedia = async () => { throw Error('must reuse durable normalization'); };
  f.media.describeNormalization = async () => { throw Error('must reuse pinned recipe'); };
  expire(f); await f.engine.reconcile();
  assert.equal(f.store.get('attempt', f.attempt.id).phase, 'succeeded'); assert.deepEqual(f.calls, calls);
});

test('Viggle backup rejects missing completion lineage, foreign row identity and altered reviewed input', async t => {
  const damage = [
    f => f.store.db.prepare("DELETE FROM entities WHERE kind='viggle_h3_execution_observation'").run(),
    f => f.store.db.prepare("UPDATE entities SET id='wrong-key' WHERE kind='viggle_h3_execution_dispatch'").run(),
    f => { f.store.db.pragma('foreign_keys = OFF'); f.store.db.prepare("UPDATE entities SET project_id='foreign-project' WHERE kind='viggle_h3_execution_mapping'").run(); f.store.db.pragma('foreign_keys = ON'); },
    f => { chmodSync(f.imagePath, 0o600); writeFileSync(f.imagePath, Buffer.alloc(f.png.length)); },
    f => { const mapping = rows(f, 'viggle_h3_execution_mapping')[0]; f.store.db.prepare("UPDATE entities SET body=? WHERE kind='viggle_h3_execution_mapping'").run(canonical({ ...mapping, transport: { ...mapping.transport, bodySha256: '0'.repeat(64) } })); },
  ];
  for (const mutate of damage) {
    const f = await downloaded(t); expire(f); await f.engine.reconcile(); mutate(f);
    await assert.rejects(backup(f)); assert.equal(existsSync(join(f.parent, 'backup')), false);
  }
});

test('a saved Viggle normalization intent cannot replace missing provider completion evidence', async t => {
  const f = await downloaded(t), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === 'video_derivation_receipt') throw Error('interrupt publication'); return insert(...args); };
  expire(f); await assert.rejects(f.engine.reconcile(), /interrupt publication/); f.store.insert = insert;
  assert.equal(rows(f, 'video_derivation_intent').length, 1);
  f.store.db.prepare("DELETE FROM entities WHERE kind='viggle_h3_execution_observation'").run();
  expire(f); await assert.rejects(f.engine.reconcile());
  assert.equal(rows(f, 'video_derivation_receipt').length, 0);
  assert.equal(rows(f, 'artifact').filter(row => row.artifact.kind === 'video').length, 0);
  assert.equal(f.calls.post, 1); assert.equal(f.calls.normalization, 1);
});
