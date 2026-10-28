import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILES } from '@openslate/core';
import { GenerationOverviewReader } from '../dist/generation-overview.js';
import { ProtectedVideoDownloader } from '../dist/execution/video-download.js';
import { readGenerationJobBlockers } from '../dist/application/generation-blockers.js';
import { fixture, accepted, completed, pending, due } from './viggle-h3-execution-fixture.mjs';

// Rule-drift review section 3, decisions R2 (confirm discard) and R3 (detach a job that keeps running).

async function startVideo(f) {
  await f.engine.runReady();
  f.attempt = f.engine.attempts(f.project.id).at(-1);
  assert.equal(f.attempt.phase, 'remote_pending');
  due(f);
}
const human = (f, text) => f.production.beginRequest(f.project.id, 'local-user', text, { source: 'app', editing: false, scopeIds: [f.project.id] });
const videoSlot = f => new GenerationOverviewReader(f.production).read(f.project.id).shots[f.project.shots[0].id].video;
const evidence = f => f.store.list('execution_evidence', f.project.id).filter(row => row.attemptId === f.attempt.id).length;

async function expiredDownload(t) {
  const downloader = new ProtectedVideoDownloader({ allowedHosts: ['media.example.test'],
    lookup: async () => { throw Error('expired locator must be refused before DNS'); } });
  const source = downloader.source.bind(downloader);
  downloader.source = receipt => source({ ...receipt, source: { ...receipt.source, expiresAt: '2000-01-01T00:00:00Z' } });
  const f = await fixture(t, { additionalProfiles: [DEFAULT_PROFILES.find(p => p.kind === 'image')], deferAdmission: true, ingest: true, bridgeOptions: { downloader },
    fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() });
  await startVideo(f);
  await f.engine.reconcile();
  assert.equal(f.store.get('attempt', f.attempt.id).phase, 'ingesting');
  assert.equal(videoSlot(f).ingestionIssue.code, 'OUTPUT_DOWNLOAD_EXPIRED');
  return f;
}

test('R2: a finished clip whose download expired can be discarded after confirmation, keeping its charge and history', async t => {
  const f = await expiredDownload(t), id = f.attempt.id, history = evidence(f), unacknowledged = human(f, 'Discard');
  const events = f.store.readEvents(f.project.id).length;
  assert.throws(() => f.production.discardAttempt(f.project.id, unacknowledged, id, { expectedPhase: 'ingesting', acknowledgeDiscard: false }),
    { code: 'DISCARD_NOT_ACKNOWLEDGED' });
  assert.equal(f.store.readEvents(f.project.id).length, events, 'a refused discard writes nothing');
  const receipt = f.production.discardAttempt(f.project.id, human(f, 'Discard the expired clip; it stays charged.'), id, { expectedPhase: 'ingesting', acknowledgeDiscard: true });
  assert.equal(receipt.attemptId, id); assert.equal(receipt.shotId, f.project.shots[0].id); assert.ok(Date.parse(receipt.discardedAt));
  const a = f.store.get('attempt', id);
  assert.equal(a.phase, 'failed'); assert.equal(a.failure.id, 'OUTPUT_DISCARDED'); assert.equal(a.failure.retryAllowed, false);
  assert.equal(a.discarded.by, 'local-user'); assert.equal(a.discarded.code, 'OUTPUT_DOWNLOAD_EXPIRED');
  assert.equal(a.taskId, f.attempt.taskId ?? a.taskId);
  assert.equal(f.store.get('reservation', a.reservationId).state, 'charged', 'the finished job stays billed');
  assert.equal(evidence(f), history, 'provider history is kept');
  const issue = f.store.get('attempt_ingestion_issue', id);
  assert.equal(issue.code, 'OUTPUT_DOWNLOAD_EXPIRED'); assert.equal(issue.active, false); assert.ok(issue.resolvedAt);
  assert.ok(f.store.readEvents(f.project.id).some(event => event.kind === 'attempt.discarded' && event.payload.attemptId === id));
  // The shot is free to be made again: nothing runs, nothing blocks, and the job is never polled or bought again.
  const slot = videoSlot(f);
  assert.notEqual(slot.state, 'running'); assert.equal(slot.ingestionIssue, undefined); assert.equal(slot.takenOff, 'released');
  assert.equal(readGenerationJobBlockers(f.production, f.project.id, [f.project.shots[0].id]), undefined);
  const queries = f.calls.query;
  await f.engine.reconcile(); await f.engine.runReady();
  assert.equal(f.calls.query, queries); assert.equal(f.calls.post, 1); assert.equal(f.engine.attempts(f.project.id).length, 1);
  assert.throws(() => f.production.discardAttempt(f.project.id, human(f, 'Again'), id, { expectedPhase: 'ingesting', acknowledgeDiscard: true }),
    { code: 'ATTEMPT_NOT_DISCARDABLE' });
});

test('R2: discard refuses running, unanswered and healthy ingesting jobs', async t => {
  const f = await fixture(t, { additionalProfiles: [DEFAULT_PROFILES.find(p => p.kind === 'image')], deferAdmission: true });
  await startVideo(f);
  assert.throws(() => f.engine.discardAttempt(f.project.id, f.attempt.id, 'local-user', true), { code: 'ATTEMPT_NOT_DISCARDABLE' });
  const a = f.store.get('attempt', f.attempt.id);
  f.store.put('attempt', a.id, f.project.id, { ...a, phase: 'ingesting' });
  assert.throws(() => f.engine.discardAttempt(f.project.id, a.id, 'local-user', true), { code: 'ATTEMPT_NOT_DISCARDABLE' },
    'an ingesting job without a recorded output problem keeps working');
  assert.equal(f.store.get('reservation', a.reservationId).state, 'reserved');
});

test('R3: a job the provider keeps reporting as running can be detached; it stays billed, is still polled slowly, and a late result is kept', async t => {
  let ready = false;
  const f = await fixture(t, { additionalProfiles: [DEFAULT_PROFILES.find(p => p.kind === 'image')], deferAdmission: true, ingest: true,
    fetch: async (_url, init) => init.method === 'POST' ? accepted() : ready ? completed() : pending() });
  await startVideo(f);
  for (let cycle = 0; cycle < 3; cycle++) { due(f); await f.engine.reconcile(); }
  const id = f.attempt.id;
  assert.equal(f.store.get('attempt', id).phase, 'remote_pending');
  assert.throws(() => f.production.releaseAttempt(f.project.id, human(f, 'Give up'), id, { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true }),
    { code: 'ATTEMPT_NOT_RELEASABLE' }, 'a running job is not an unanswered one');
  assert.throws(() => f.production.releaseAttempt(f.project.id, human(f, 'Detach'), id, { expectedPhase: 'remote_pending', acknowledgeDoubleCharge: false }),
    { code: 'DOUBLE_CHARGE_NOT_ACKNOWLEDGED' });
  const receipt = f.production.releaseAttempt(f.project.id, human(f, 'Stop waiting for this running job; it may still be charged.'), id,
    { expectedPhase: 'remote_pending', acknowledgeDoubleCharge: true });
  assert.equal(receipt.attemptId, id);
  const a = f.store.get('attempt', id);
  assert.equal(a.phase, 'remote_pending', 'detaching never infers failure'); assert.equal(a.failure, null); assert.ok(a.released);
  assert.equal(f.store.get('reservation', a.reservationId).state, 'reserved', 'no refund is inferred');
  const slot = videoSlot(f);
  assert.notEqual(slot.state, 'running'); assert.equal(slot.takenOff, 'released'); assert.deepEqual(slot.releasedAttemptIds, [id]);
  assert.equal(readGenerationJobBlockers(f.production, f.project.id, [f.project.shots[0].id]), undefined);
  // Still polled, but on a slower schedule once nobody waits for it.
  const before = f.calls.query; due(f); await f.engine.reconcile();
  assert.equal(f.calls.query, before + 1);
  const schedule = f.store.get('viggle_h3_poll_schedule', id);
  assert.ok(schedule.nextPollAt - f.clock.value >= 300_000, 'a detached job is polled at most every five minutes');
  // The late result lands as history: charged, never published over the shot.
  ready = true; due(f); await f.engine.reconcile();
  const late = f.store.get('attempt', id);
  assert.equal(late.phase, 'succeeded'); assert.equal(f.store.get('reservation', late.reservationId).state, 'charged');
  assert.deepEqual(f.store.get('node_binding', f.node.id).outputs, {});
  assert.equal(f.calls.post, 1);
});
