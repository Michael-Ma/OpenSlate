import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@openslate/core';
import { createTranscriptionPreparationIntent, resolveTranscriptionPreparationIntent } from '../dist/execution/transcription-preparation.js';
import { assertTranscriptionPreparationAttemptState } from '../dist/persistence/transcription-preparation-state.js';
import { transcriptionFixture, context, rows } from './transcription-execution-fixture.mjs';

const put = (f, value) => f.store.put('attempt', value.id, f.project.id, value);
const now = f => f.store.get('attempt', f.attempt.id);
async function waiting(t) {
  const f = await transcriptionFixture(t);
  const outcome = await f.bridge.start(f.request, { ...context(f), signal: new AbortController().signal,
    eligibility: () => ({ type: 'deferred', reason: 'paused' }) });
  assert.equal(outcome.type, 'preparation_deferred'); f.attempt = now(f); return f;
}

test('legacy attempts retain exact absent-protocol JSON and cannot enter preparing without proof', async t => {
  const f = await transcriptionFixture(t), before = canonical(f.attempt);
  put(f, f.attempt); assert.equal(canonical(now(f)), before);
  assert.equal(Object.hasOwn(now(f), 'preparation'), false);
  assert.throws(() => put(f, { ...f.attempt, phase: 'preparing' }), { code: 'SUBMISSION_PREPARATION_INVALID' });
  assert.equal(canonical(now(f)), before); assert.equal(rows(f, 'transcription_preparation_intent').length, 0);
});

test('waiting proof pins real consumed authority, full recording and historical profile without new spending or media work', async t => {
  const f = await waiting(t), proof = resolveTranscriptionPreparationIntent(f.store, f.attempt);
  assert.equal(proof.id, f.attempt.id); assert.equal(proof.requestDigest, digest(f.request));
  assert.equal(proof.reservation.id, f.attempt.reservationId); assert.equal(proof.reservation.micros, '100');
  assert.equal(proof.profileDefinitionDigest, digest(f.profile)); assert.equal(proof.sourceRecord.id, f.audio.id);
  assert.equal(proof.source.sha256, f.request.inputs[0].sha256); assert.equal(proof.sourceStartSample, 0); assert.equal(proof.sourceEndSample, 48000);
  assert.deepEqual(f.attempt.preparation, { intentId: f.attempt.id, intentDigest: digest(proof), waitCount: 0, nextEligibleAt: 0 });
  for (const kind of ['attempt', 'reservation', 'external_allowance_consumption']) assert.equal(rows(f, kind).length, 1);
  for (const kind of ['transcription_audio_intent', 'transcription_execution_mapping', 'transcription_execution_dispatch', 'transcription_execution_result']) assert.equal(rows(f, kind).length, 0);
  assert.deepEqual(f.calls, { http: 0, credentials: 0, prepare: 0, upload: 0 });
  f.store.put('transcription_preparation_intent', proof.id, f.project.id, proof);
  for (const changed of [{ ...proof, sourceEndSample: 47999 }, { ...proof, candidateDigest: 'f'.repeat(64) },
    { ...proof, reservation: { ...proof.reservation, micros: '101' } }, { ...proof, arbitrary: true }])
    assert.throws(() => f.store.put('transcription_preparation_intent', proof.id, f.project.id, changed));
  const other = f.production.createProject('Another project');
  assert.throws(() => f.store.insert('transcription_preparation_intent', proof.id, other.id, { ...proof, projectId: other.id }));
});

test('metadata is exact and bounded; generic updates cannot remove proof or widen preparation into unknown work', async t => {
  const f = await waiting(t), saved = canonical(now(f)), metadata = f.attempt.preparation;
  const absent = { ...f.attempt }; delete absent.preparation;
  for (const changed of [absent, { ...f.attempt, preparation: null },
    ...[{ ...metadata, extra: true }, { ...metadata, intentDigest: 'f'.repeat(64) }, { ...metadata, intentId: 'wrong' },
      { ...metadata, waitCount: -1 }, { ...metadata, waitCount: 1_000_001 }, { ...metadata, waitCount: 0.5 },
      { ...metadata, nextEligibleAt: -1 }, { ...metadata, nextEligibleAt: Number.MAX_SAFE_INTEGER + 1 }].map(preparation => ({ ...f.attempt, preparation })),
    ...['submitting', 'submission_unknown', 'ingesting', 'succeeded', 'remote_pending', 'failed'].map(phase => ({ ...f.attempt, phase }))])
    assert.throws(() => put(f, changed), { code: 'SUBMISSION_PREPARATION_INVALID' });
  assert.equal(canonical(now(f)), saved);
});

test('proof installation rolls back with its attempt transition and cannot attach to uncertain historical work', async t => {
  const f = await transcriptionFixture(t), proof = createTranscriptionPreparationIntent(f.store, f.attempt), before = canonical(f.attempt);
  assert.throws(() => f.store.transaction(() => {
    f.store.insert('transcription_preparation_intent', proof.id, f.project.id, proof);
    put(f, { ...f.attempt, phase: 'preparing', preparation: { intentId: proof.id, intentDigest: digest(proof), waitCount: 1, nextEligibleAt: 0 } });
  }), { code: 'SUBMISSION_PREPARATION_INVALID' });
  assert.equal(rows(f, 'transcription_preparation_intent').length, 0); assert.equal(canonical(now(f)), before);
  put(f, { ...f.attempt, phase: 'submission_unknown' });
  assert.throws(() => f.store.insert('transcription_preparation_intent', proof.id, f.project.id, proof), { code: 'SUBMISSION_PREPARATION_INVALID' });
});

test('busy metadata can advance while waiting; exact pre-marker obsolete settlement preserves proof and consumed history', async t => {
  const f = await waiting(t), proof = rows(f, 'transcription_preparation_intent')[0], consumption = canonical(rows(f, 'external_allowance_consumption'));
  const updated = put(f, { ...f.attempt, preparation: { ...f.attempt.preparation, waitCount: 2, nextEligibleAt: Date.now() + 500 }, leaseExpiresAt: 0 });
  assert.throws(() => put(f, f.attempt), { code: 'SUBMISSION_PREPARATION_INVALID' });
  const failed = { ...updated, phase: 'failed', failure: { id: 'PREPARATION_OBSOLETE', technical: false, source: 'application:submission-preparation/1', retryAllowed: false } };
  f.store.transaction(() => {
    put(f, failed); const reservation = f.store.get('reservation', failed.reservationId);
    f.store.put('reservation', reservation.id, f.project.id, { ...reservation, state: 'released' });
  });
  assertTranscriptionPreparationAttemptState(f.store, now(f)); assert.deepEqual(resolveTranscriptionPreparationIntent(f.store, now(f)), proof);
  assert.equal(canonical(rows(f, 'external_allowance_consumption')), consumption);
  assert.throws(() => put(f, { ...now(f), phase: 'preparing' }), { code: 'SUBMISSION_PREPARATION_INVALID' });
  assert.throws(() => put(f, { ...now(f), preparation: { ...updated.preparation, waitCount: 3 } }), { code: 'SUBMISSION_PREPARATION_INVALID' });
});

test('retained local not-dispatched result settles through lookup without re-entering preparation or spending', async t => {
  const f = await waiting(t), record = { id: f.attempt.id, projectId: f.project.id, version: 1, attemptId: f.attempt.id,
    requestDigest: digest(f.request), mappingDigest: null, dispatchDigest: null, observation: { kind: 'not_dispatched', code: 'LOCAL_CANCELLED' } };
  f.store.insert('transcription_execution_result', record.id, f.project.id, record);
  put(f, { ...now(f), leaseEpoch: f.attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
  const outcome = await f.bridge.lookup(f.attempt.id, f.request);
  assert.equal(outcome.type, 'rejected'); await f.engine.handle(now(f), outcome);
  assert.equal(now(f).phase, 'failed'); assert.equal(f.store.get('reservation', f.attempt.reservationId).state, 'released');
  assert.deepEqual(now(f).preparation, f.attempt.preparation); assertTranscriptionPreparationAttemptState(f.store, now(f));
  assert.deepEqual(f.calls, { http: 0, credentials: 0, prepare: 0, upload: 0 });
});

test('missing or corrupt saved proof and changed owned artifact prevent lease refresh before local work', async t => {
  for (const damage of ['missing', 'source', 'artifact']) {
    const f = await waiting(t), proof = rows(f, 'transcription_preparation_intent')[0];
    if (damage === 'missing') f.store.db.prepare("DELETE FROM entities WHERE kind='transcription_preparation_intent' AND id=?").run(proof.id);
    else if (damage === 'source') f.store.db.prepare("UPDATE entities SET body=? WHERE kind='transcription_preparation_intent' AND id=?").run(canonical({ ...proof, sourceEndSample: 1 }), proof.id);
    else { const record = f.store.get('artifact', f.audio.id);
      f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?").run(canonical({ ...record, artifact: { ...record.artifact, durationFrames: 1 } }), record.id); }
    assert.throws(() => put(f, { ...f.attempt, leaseEpoch: f.attempt.leaseEpoch + 1 }), { code: 'SUBMISSION_PREPARATION_INVALID' });
    assert.deepEqual(f.calls, { http: 0, credentials: 0, prepare: 0, upload: 0 });
  }
});

test('the exact first dispatch exits preparing once and retains immutable protocol metadata', async t => {
  const f = await waiting(t), outcome = await f.bridge.resume(f.request, { ...context(f), signal: new AbortController().signal,
    eligibility: () => ({ type: 'ready' }) });
  assert.equal(outcome.type, 'completed'); assert.equal(now(f).phase, 'submitting');
  assert.equal(rows(f, 'transcription_execution_dispatch').length, 1); assert.deepEqual(now(f).preparation, f.attempt.preparation);
  assertTranscriptionPreparationAttemptState(f.store, now(f));
  assert.throws(() => put(f, { ...now(f), phase: 'preparing' }), { code: 'SUBMISSION_PREPARATION_INVALID' });
  assert.throws(() => put(f, { ...now(f), preparation: { ...f.attempt.preparation, waitCount: 1 } }), { code: 'SUBMISSION_PREPARATION_INVALID' });
  const calls = { ...f.calls }; assert.equal((await f.bridge.submit(f.request, context(f))).type, 'completed'); assert.deepEqual(f.calls, calls);
});

test('transport cannot replace the proof-pinned lock with another valid matching profile lock', async t => {
  const f = await waiting(t), lockId = 'alternate-retained-lock';
  const lock = f.store.insert('capability_lock', lockId, f.project.id, { profiles: [f.profile] });
  const insert = f.store.insert.bind(f.store); let rejected = false;
  f.store.insert = (kind, id, projectId, value) => {
    if (kind !== 'transcription_execution_mapping') return insert(kind, id, projectId, value);
    try { return insert(kind, id, projectId, { ...value, capabilityLockId: lock.id, capabilityLockDigest: digest(lock) }); }
    catch (error) { rejected = error.code === 'SUBMISSION_PREPARATION_INVALID'; throw error; }
  };
  await assert.rejects(f.bridge.resume(f.request, { ...context(f), signal: new AbortController().signal, eligibility: () => ({ type: 'ready' }) }),
    { code: 'SUBMISSION_PREPARATION_INVALID' });
  assert.equal(rejected, true); assert.equal(f.calls.http, 0);
  assert.equal(rows(f, 'transcription_execution_mapping').length, 0); assert.equal(rows(f, 'transcription_execution_dispatch').length, 0);
});
