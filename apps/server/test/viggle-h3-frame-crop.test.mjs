import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { canonical, digest } from '@openslate/core';
import { describeViggleH3Request } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { ViggleH3Execution } from '../dist/execution/viggle-h3-execution.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { resolveViggleAdmission, resolveViggleFrame, viggleFramePin } from '../dist/execution/viggle-h3-authority.js';
import { assertViggleH3ExecutionMapping } from '../dist/execution/viggle-h3-receipts.js';
import { assertViggleRecords, assertViggleSpoolLineage } from '../dist/execution/viggle-h3-lineage.js';
import { createInstallationBackup, inspectInstallationBackup } from '../dist/persistence/installation-backup.js';
import { restoreInstallationBackup } from '../dist/persistence/installation-restore.js';
import { InstallationRecoveryGuard, releaseRecovery } from '../dist/application/installation-recovery.js';
import { fixture, context, due, rows, taskId, accepted, completed, hash } from './viggle-h3-execution-fixture.mjs';

const filmKind = aspect => ({ version: 'film-kind@1', kind: 'social', format: { platform: 'other', aspect } });
const mapping = f => f.store.get('viggle_h3_execution_mapping', f.attempt.id);
function tamper(f, value) {
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='viggle_h3_execution_mapping' AND id=?").run(canonical(value), value.id);
}
function restart(f, denyNetwork = false) {
  f.store.close(); f.store = new Store(f.path); f.stores.push(f.store);
  f.outputs = new ExecutionOutputStore(f.store, { rootDir: join(f.directory, 'execution-output') });
  f.bridge = new ViggleH3Execution({ ...f.bridgeOptions, store: f.store, outputStore: f.outputs, ...(denyNetwork ? {
    credentials: new EnvironmentMediaCredentials(() => { throw Error('No credentials during replay'); }),
    fetch: async () => { throw Error('No HTTP during replay'); }
  } : {}) });
  f.engine = new Engine(f.store, f.bridge, { ...f.engineOptions, outputStore: f.outputs });
}
async function prepare(f, saved) {
  return f.bridge.prepare(f.attempt, undefined, resolveViggleFrame(f.store, f.attempt, saved?.firstFrame), saved);
}
async function saveLegacyMapping(f) {
  const admission = resolveViggleAdmission(f.store, f.request), frame = resolveViggleFrame(f.store, f.attempt);
  const prepared = await prepare(f);
  const original = { ...prepared.request, firstFrame: { bytes: readFileSync(f.imagePath), sha256: f.reference.sha256,
    width: f.image.width, height: f.image.height, byteLength: f.image.byteLength, mediaType: 'image/png' } };
  const value = { id: f.attempt.id, version: 1, projectId: f.project.id, attemptId: f.attempt.id, requestDigest: digest(f.request),
    profileDigest: f.request.profile.digest, profileDefinitionDigest: digest(admission.profile), profileDefinition: admission.profile,
    capabilityLockId: admission.capabilityLock.id, capabilityLockDigest: digest(admission.capabilityLock),
    allowanceId: admission.allowance.id, allowanceDigest: digest(admission.allowance), consumptionDigest: digest(admission.consumption),
    estimatedMicros: admission.reservation.micros, firstFrame: viggleFramePin(frame), transport: describeViggleH3Request(original) };
  assertViggleH3ExecutionMapping(f.attempt, value);
  f.store.insert('viggle_h3_execution_mapping', value.id, f.project.id, value); return value;
}

for (const [aspect, source, target] of [['9:16', [1024, 1536], [864, 1536]], ['16:9', [1536, 1024], [1536, 864]]]) {
  test(`${aspect} uploads an exact-shape PNG and repeats preparation byte-identically`, async t => {
    let uploaded, body;
    const f = await fixture(t, { filmKind: filmKind(aspect), pngSize: source, fetch: async (url, init) => {
      body = Buffer.from(init.body);
      const form = await new Request(url, { method: 'POST', headers: init.headers, body }).formData();
      assert.equal(form.get('aspect_ratio'), aspect); uploaded = Buffer.from(await form.get('first_frame_image').arrayBuffer()); return accepted();
    } });
    const first = await prepare(f), second = await prepare(f);
    assert.deepEqual(first, second); assert.deepEqual(describeViggleH3Request(first.request), describeViggleH3Request(second.request));
    assert.deepEqual(await f.bridge.submit(f.request, context(f)), { type: 'accepted', taskId });
    assert.deepEqual(uploaded, first.request.firstFrame.bytes);
    assert.deepEqual([uploaded.readUInt32BE(16), uploaded.readUInt32BE(20)], target);
    const compressed = [];
    for (let offset = 8; offset < uploaded.length;) {
      const length = uploaded.readUInt32BE(offset);
      if (uploaded.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed.push(uploaded.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    assert.equal(inflateSync(Buffer.concat(compressed)).length, (1 + target[0] * 3) * target[1]);
    const saved = mapping(f);
    assert.deepEqual(saved.firstFrameCrop, { recipe: 'center-crop-v1', sourceWidth: source[0], sourceHeight: source[1], width: target[0], height: target[1] });
    assert.deepEqual(saved.transport, describeViggleH3Request(first.request)); assert.equal(saved.transport.bodySha256, hash(body));
    assert.equal(saved.transport.firstFrame.sha256, hash(uploaded)); assert.notEqual(hash(uploaded), f.reference.sha256);
    assert.deepEqual(readFileSync(f.imagePath), f.png); assert.equal(saved.firstFrame.artifactDigest, digest(f.image));
    assert.equal(saved.firstFrame.approvalDigest, digest(f.approval)); assert.equal(saved.firstFrame.snapshotDigest, digest(f.review));
    assertViggleRecords(f.store, f.attempt.id);
    restart(f, true);
    const afterRestart = await prepare(f, saved);
    assert.deepEqual(describeViggleH3Request(afterRestart.request), saved.transport);
    assert.deepEqual(await f.bridge.submit(f.request), { type: 'accepted', taskId });
    assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0);
  });
}

for (const [aspect, size] of [['1:1', [256, 256]], ['9:16', [864, 1536]], ['16:9', [1536, 864]]]) {
  test(`${aspect} ${size.join('x')} sends unchanged original PNG bytes`, async t => {
    let uploaded;
    const f = await fixture(t, { filmKind: filmKind(aspect), pngSize: size, fetch: async (url, init) => {
      const form = await new Request(url, { method: 'POST', headers: init.headers, body: Buffer.from(init.body) }).formData();
      uploaded = Buffer.from(await form.get('first_frame_image').arrayBuffer()); return accepted();
    } });
    assert.equal((await f.bridge.submit(f.request, context(f))).type, 'accepted');
    assert.deepEqual(uploaded, f.png); assert.equal(Object.hasOwn(mapping(f), 'firstFrameCrop'), false);
    assert.equal(mapping(f).transport.firstFrame.sha256, f.reference.sha256); assertViggleRecords(f.store, f.attempt.id);
  });
}

test('a profile-selected 9:16 attempt crops even without a film aspect argument', async t => {
  const f = await fixture(t, { pngSize: [1024, 1536], profileSettings: { aspectRatio: '9:16' } });
  assert.equal(Object.hasOwn(f.request.args, 'aspect'), false);
  assert.equal((await f.bridge.submit(f.request, context(f))).type, 'accepted');
  assert.deepEqual([mapping(f).transport.firstFrame.width, mapping(f).transport.firstFrame.height], [864, 1536]);
  assertViggleRecords(f.store, f.attempt.id);
});

test('a saved crop mapping before first dispatch re-prepares canonically after restart', async t => {
  const f = await fixture(t, { filmKind: filmKind('9:16'), pngSize: [1024, 1536] });
  const preparation = await prepare(f), legacy = await saveLegacyMapping(f);
  const saved = { ...legacy, firstFrameCrop: preparation.crop, transport: describeViggleH3Request(preparation.request) };
  tamper(f, saved); assertViggleRecords(f.store, f.attempt.id); restart(f);
  assert.equal((await f.bridge.submit(f.request, context(f))).type, 'accepted');
  assert.equal(canonical(mapping(f)), canonical(saved)); assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0);
  assertViggleRecords(f.store, f.attempt.id);
});

test('a saved pre-crop mapping re-prepares, replays and reconciles using the exact original upload', async t => {
  let body, uploaded;
  const f = await fixture(t, { filmKind: filmKind('9:16'), pngSize: [1024, 1536], fetch: async (url, init) => {
    if (init.method !== 'POST') return completed();
    body = Buffer.from(init.body);
    const form = await new Request(url, { method: 'POST', headers: init.headers, body }).formData();
    uploaded = Buffer.from(await form.get('first_frame_image').arrayBuffer()); return accepted();
  } });
  const saved = await saveLegacyMapping(f), identity = canonical(saved);
  restart(f);
  for (let n = 0; n < 2; n++) {
    const prepared = await prepare(f, saved);
    assert.equal(prepared.crop, undefined); assert.deepEqual(prepared.request.firstFrame.bytes, f.png);
    assert.deepEqual(describeViggleH3Request(prepared.request), saved.transport);
  }
  assert.equal((await f.bridge.submit(f.request, context(f))).type, 'accepted');
  assert.deepEqual(uploaded, f.png); assert.equal(hash(body), saved.transport.bodySha256); assert.equal(canonical(mapping(f)), identity);
  due(f); const result = await f.bridge.poll(taskId, f.request); assert.equal(result.type, 'completed');
  assertViggleSpoolLineage(f.store, f.attempt, result.outputs[0].storage.spoolId);
  restart(f, true);
  assert.equal((await f.bridge.lookup(f.attempt.id)).type, 'completed');
  assert.equal((await f.bridge.submit(f.request)).type, 'completed');
  assertViggleRecords(f.store, f.attempt.id); assert.equal(canonical(mapping(f)), identity);
  await f.engine.reconcile(); assert.equal(canonical(mapping(f)), identity);
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 1); assert.equal(f.calls.download, 1);
});

test('crop record tampering fails receipt and completed-spool lineage checks', async t => {
  const f = await fixture(t, { filmKind: filmKind('9:16'), pngSize: [1024, 1536], fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() });
  await f.bridge.submit(f.request, context(f)); due(f); const result = await f.bridge.poll(taskId, f.request);
  assert.equal(result.type, 'completed'); const saved = mapping(f), crop = saved.firstFrameCrop, spoolId = result.outputs[0].storage.spoolId;
  const invalid = [
    { ...saved, firstFrameCrop: { ...crop, recipe: 'center-crop-v2' } },
    { ...saved, firstFrameCrop: { ...crop, width: crop.width - 1 } },
    { ...saved, firstFrameCrop: { ...crop, width: crop.width - 18, height: crop.height - 32 } },
    { ...saved, firstFrameCrop: { ...crop, left: 80 } },
    { ...saved, firstFrameCrop: { ...crop, sourceHeight: 1504 } },
    Object.fromEntries(Object.entries(saved).filter(([key]) => key !== 'firstFrameCrop'))
  ];
  for (const value of invalid) {
    assert.throws(() => assertViggleH3ExecutionMapping(f.attempt, value)); tamper(f, value);
    assert.throws(() => assertViggleRecords(f.store, f.attempt.id));
    assert.throws(() => assertViggleSpoolLineage(f.store, f.attempt, spoolId));
    await assert.rejects(f.bridge.submit(f.request));
  }
  // This remains a valid crop geometry but is not the approved source's dimensions.
  const foreignSource = { ...saved, firstFrameCrop: { ...crop, sourceWidth: 1026 } };
  assert.doesNotThrow(() => assertViggleH3ExecutionMapping(f.attempt, foreignSource)); tamper(f, foreignSource);
  assert.throws(() => assertViggleRecords(f.store, f.attempt.id), /approved PNG/);
  assert.throws(() => assertViggleSpoolLineage(f.store, f.attempt, spoolId), /approved PNG/);
  let invoked = false; const accessor = { ...crop };
  Object.defineProperty(accessor, 'width', { get() { invoked = true; return crop.width; } });
  assert.throws(() => assertViggleH3ExecutionMapping(f.attempt, { ...saved, firstFrameCrop: accessor })); assert.equal(invoked, false);
  tamper(f, saved); assertViggleSpoolLineage(f.store, f.attempt, spoolId);
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 1); assert.equal(f.calls.download, 1);
});

test('a cropped upload with a lost POST reply remains charged and never submits again after restart', async t => {
  const f = await fixture(t, { filmKind: filmKind('9:16'), pngSize: [1024, 1536], deferAdmission: true,
    fetch: async () => { throw Error('controlled lost reply'); } });
  await f.engine.runReady(); f.attempt = rows(f, 'attempt')[0]; f.request = f.attempt.request;
  assert.equal(f.attempt.phase, 'failed'); assert.equal(f.attempt.failure.id, 'SUBMISSION_RESPONSE_LOST');
  assert.equal(f.store.get('reservation', f.attempt.reservationId).state, 'charged');
  assert.ok(mapping(f).firstFrameCrop); const original = canonical(mapping(f)); restart(f, true);
  for (let n = 0; n < 3; n++) {
    await f.engine.reconcile(); await f.engine.runReady();
    assert.equal((await f.bridge.submit(f.request)).failureId, 'SUBMISSION_RESPONSE_LOST');
  }
  assert.equal(canonical(mapping(f)), original); assertViggleRecords(f.store, f.attempt.id);
  assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0); assert.equal(rows(f, 'attempt').length, 1);
});

for (const legacy of [false, true]) test(`${legacy ? 'legacy uncropped' : 'cropped'} multipart identity survives backup inspection and same-root restore`, async t => {
  const f = await fixture(t, { filmKind: filmKind('9:16'), pngSize: [1024, 1536],
    fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() });
  if (legacy) await saveLegacyMapping(f);
  assert.equal((await f.bridge.submit(f.request, context(f))).type, 'accepted');
  due(f); const result = await f.bridge.poll(taskId, f.request); assert.equal(result.type, 'completed');
  const saved = canonical(mapping(f)), calls = { ...f.calls };
  const exported = await createInstallationBackup({ sourceRoot: f.root, destination: join(f.parent, 'backup') });
  await inspectInstallationBackup({ directory: exported.directory });
  f.store.close(); renameSync(f.root, join(f.parent, 'original-installation'));
  await restoreInstallationBackup({ directory: exported.directory, destination: f.root });
  // restart() closes the already closed store idempotently and opens the restored root with HTTP/credentials denied.
  restart(f, true);
  const snapshot = new InstallationRecoveryGuard(f.store).snapshot();
  releaseRecovery(f.store, { restoreId: snapshot.receipt.restoreId, expectedReceiptDigest: snapshot.receiptDigest, expectedSummaryDigest: snapshot.summaryDigest },
    { principalId: 'offline-human', commandId: 'reviewed-f1-restore' });
  assert.equal(canonical(mapping(f)), saved); assert.deepEqual(readFileSync(f.imagePath), f.png);
  assert.equal((await f.bridge.lookup(f.attempt.id)).type, 'completed');
  assert.equal((await f.bridge.submit(f.request)).type, 'completed');
  assertViggleSpoolLineage(f.store, f.attempt, result.outputs[0].storage.spoolId); assertViggleRecords(f.store, f.attempt.id);
  assert.deepEqual(f.calls, calls);
});
