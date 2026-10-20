import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DEFAULT_PROFILES, DomainError } from '@openslate/core';
import { fixtureOutputs } from '@openslate/providers';
import { Engine } from '../dist/execution/engine.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { GenerationOverviewReader } from '../dist/generation-overview.js';
import { ProtectedVideoDownloader } from '../dist/execution/video-download.js';
import { setup } from './execution-fixture.mjs';
import { fixture, accepted, completed, due, json, taskId } from './viggle-h3-execution-fixture.mjs';

function capacityFixture(t) {
  const profiles = DEFAULT_PROFILES.map(p => ({ ...p, maxConcurrency: 3 }));
  const f = setup(t, { count: 3, imagesOnly: true, profiles });
  const outputs = new ExecutionOutputStore(f.store, { rootDir: join(f.directory, 'outputs') });
  const engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, profiles, outputStore: outputs });
  const polls = [], lookups = [];
  f.provider.submit = async request => ({ type: 'accepted', taskId: `task-${request.attemptId}` });
  f.provider.poll = async (taskId, request) => { polls.push(request.attemptId); return { type: 'accepted', taskId }; };
  f.provider.lookup = async id => { lookups.push(id); return { type: 'unknown', diagnostic: 'still unresolved' }; };
  return { ...f, engine, outputs, polls, lookups };
}

test('R2: all three accepted jobs are polled in one reconciliation cycle without inventing no-answer evidence', async t => {
  const f = capacityFixture(t);
  await f.engine.runReady();
  const before = f.engine.attempts(f.projectId);
  assert.equal(before.length, 3);
  assert.ok(before.every(a => a.phase === 'remote_pending'));
  const result = await f.engine.reconcile();
  assert.equal(result.reconciled, 3);
  assert.deepEqual(new Set(f.polls), new Set(before.map(a => a.id)));
  assert.ok(f.engine.attempts(f.projectId).every(a => a.phase === 'remote_pending' && a.leaseExpiresAt === 0));
  assert.ok(f.store.list('execution_evidence', f.projectId).every(e => e.outcome.type === 'accepted'));
});

test('R2: released old unknown jobs do not starve a newer accepted job and remain monitored', async t => {
  const f = capacityFixture(t), newer = f.plan.nodes.at(-1).id, order = [];
  f.provider.submit = async request => request.nodeId === newer ? { type: 'accepted', taskId: `task-${request.attemptId}` }
    : { type: 'unknown', diagnostic: 'lost submit reply' };
  await f.engine.runReady();
  for (const a of f.engine.attempts(f.projectId).filter(a => a.phase === 'submission_unknown')) f.engine.releaseAttempt(f.projectId, a.id, 'local-user', true);
  const recover = f.outputs.recoverCompletion.bind(f.outputs);
  f.outputs.recoverCompletion = (...args) => { order.push(args[1]); return recover(...args); };
  f.provider.poll = async (taskId, request) => { f.polls.push(request.attemptId); return { type: 'completed', taskId, outputs: fixtureOutputs(request) }; };
  await f.engine.reconcile();
  const attempts = f.engine.attempts(f.projectId), recent = attempts.find(a => a.nodeId === newer);
  assert.equal(order[0], recent.id);
  assert.deepEqual(f.polls, [recent.id]);
  assert.equal(recent.phase, 'succeeded');
  assert.equal(f.lookups.length, 2);
  assert.ok(attempts.filter(a => a.released).every(a => a.phase === 'submission_unknown'));
});

for (const location of ['recovery', 'poll']) for (const code of ['OUTPUT_STORE_BUSY', 'OUTPUT_STORE_DISK_FULL', 'MEDIA_BUSY', 'ENOSPC', 'EMFILE']) {
  test(`R2: ${code} in ${location} releases the lease without changing accepted phase or evidence`, async t => {
    const f = capacityFixture(t);
    await f.engine.runReady();
    const before = f.store.list('execution_evidence', f.projectId);
    const fail = async () => { throw code.startsWith('E') ? Object.assign(Error('local capacity'), { code }) : new DomainError(code, 'local capacity'); };
    if (location === 'recovery') f.outputs.recoverCompletion = fail;
    else f.provider.poll = fail;
    await f.engine.reconcile();
    assert.deepEqual(f.store.list('execution_evidence', f.projectId), before);
    assert.ok(f.engine.attempts(f.projectId).every(a => a.phase === 'remote_pending' && a.leaseExpiresAt === 0));
    assert.equal(f.polls.length, 0);
  });
}

test('R2: a late local capacity error cannot release a newer worker lease', async t => {
  const f = capacityFixture(t);
  await f.engine.runReady();
  let replacement;
  f.outputs.recoverCompletion = async (_projectId, id) => {
    const a = f.store.get('attempt', id);
    const newer = { ...a, leaseOwner: 'new-owner', leaseEpoch: a.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 };
    f.store.put('attempt', id, f.projectId, newer);
    replacement = newer;
    throw new DomainError('OUTPUT_STORE_BUSY', 'local capacity');
  };
  await f.engine.reconcile();
  assert.deepEqual(f.store.get('attempt', replacement.id), replacement);
});

async function startVideo(f) {
  await f.engine.runReady();
  f.attempt = f.engine.attempts(f.project.id).at(-1);
  f.request = f.attempt.request;
  assert.equal(f.attempt.phase, 'remote_pending');
  due(f);
}
function assertIngestion(f, code) {
  const a = f.store.get('attempt', f.attempt.id);
  assert.equal(a.phase, 'ingesting');
  assert.equal(a.taskId, taskId);
  assert.equal(a.leaseExpiresAt, 0);
  const reader = new GenerationOverviewReader(f.production);
  const overview = reader.read(f.project.id), slot = overview.shots[f.project.shots[0].id].video;
  assert.equal(slot.state, 'running');
  assert.equal(slot.phase, 'ingesting');
  assert.equal(slot.ingestionIssue.code, code);
  assert.ok(Number.isFinite(Date.parse(slot.ingestionIssue.at)));
  assert.equal(slot.failure, undefined);
  assert.ok(!overview.scenes[0].blockers.some(b => b.code === 'no_answer_in_scene'));
  assert.throws(() => f.engine.releaseAttempt(f.project.id, a.id, 'local-user', true), { code: 'ATTEMPT_NOT_RELEASABLE' });
  assert.equal(f.calls.post, 1);
  assert.ok(!JSON.stringify(slot).includes('signature='));
  return slot.ingestionIssue;
}

test('R2: a finished clip on a refused host remains ingesting with a sanitized locator issue', async t => {
  const f = await fixture(t, { additionalProfiles: [DEFAULT_PROFILES.find(p => p.kind === 'image')], deferAdmission: true, ingest: true, fetch: async (_url, init) => init.method === 'POST' ? accepted()
    : json({ id: taskId, status: 'ready', progress: 100, video_url: 'https://refused.example.test/clip.mp4?signature=secret', alpha_url: null,
      created_at: '2026-09-13T00:00:00Z', completed_at: '2026-09-13T00:00:30Z', error: null, seed: 1 }) });
  await startVideo(f);
  await f.engine.reconcile();
  const issue = assertIngestion(f, 'OUTPUT_DOWNLOAD_LOCATOR');
  await f.engine.reconcile();
  assert.deepEqual(assertIngestion(f, 'OUTPUT_DOWNLOAD_LOCATOR'), issue, 'cooldown cannot erase a known download issue');
  assert.equal(f.calls.download, 0);
});

test('R2: an expired returned locator remains ingesting and cannot offer release or a second purchase', async t => {
  const downloader = new ProtectedVideoDownloader({ allowedHosts: ['media.example.test'],
    lookup: async () => { throw Error('expired locator must be refused before DNS'); } });
  const source = downloader.source.bind(downloader);
  downloader.source = receipt => source({ ...receipt, source: { ...receipt.source, expiresAt: '2000-01-01T00:00:00Z' } });
  const f = await fixture(t, { additionalProfiles: [DEFAULT_PROFILES.find(p => p.kind === 'image')], deferAdmission: true, ingest: true, bridgeOptions: { downloader },
    fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() });
  await startVideo(f);
  await f.engine.reconcile();
  assertIngestion(f, 'OUTPUT_DOWNLOAD_EXPIRED');
  await f.engine.runReady();
  assert.equal(f.calls.post, 1);
  assert.equal(f.engine.attempts(f.project.id).length, 1);
});

test('R2: a transient completed-clip download issue heals on the next poll and clears its projection', async t => {
  let status = 503;
  const f = await fixture(t, { additionalProfiles: [DEFAULT_PROFILES.find(p => p.kind === 'image')], deferAdmission: true, ingest: true, downloadStatus: () => status,
    fetch: async (_url, init) => init.method === 'POST' ? accepted() : completed() });
  await startVideo(f);
  await f.engine.reconcile();
  assertIngestion(f, 'OUTPUT_DOWNLOAD_FAILED');
  status = 200; due(f);
  await f.engine.reconcile();
  const a = f.store.get('attempt', f.attempt.id);
  assert.equal(a.phase, 'succeeded');
  assert.equal(f.store.get('reservation', a.reservationId).state, 'charged');
  const slot = new GenerationOverviewReader(f.production).read(f.project.id).shots[f.project.shots[0].id].video;
  assert.equal(slot.state, 'ready');
  assert.equal(slot.ingestionIssue, undefined);
  assert.equal(f.store.get('attempt_ingestion_issue', a.id).active, false);
  assert.equal(f.calls.post, 1);
  assert.equal(f.calls.query, 2);
  assert.equal(f.calls.download, 2);
});

test('R2: durable provider completion survives a lost polling lease and a later unknown GET', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const downloader = { source: () => async function* () {
    entered.resolve(); await release.promise;
    throw new DomainError('OUTPUT_DOWNLOAD_LOCATOR', 'refused host');
  } };
  let unknown = false;
  const f = await fixture(t, { additionalProfiles: [DEFAULT_PROFILES.find(p => p.kind === 'image')], deferAdmission: true,
    ingest: true, bridgeOptions: { downloader }, fetch: async (_url, init) => {
      if (init.method === 'POST') return accepted();
      if (unknown) throw Error('temporary GET failure');
      return completed();
    } });
  await startVideo(f);
  const running = f.engine.reconcile();
  await entered.promise;
  const a = f.store.get('attempt', f.attempt.id), replacement = { ...a, leaseOwner: 'replacement-worker', leaseEpoch: a.leaseEpoch + 1, leaseExpiresAt: 0 };
  f.store.put('attempt', a.id, f.project.id, replacement);
  release.resolve(); await running;
  assert.deepEqual(f.store.get('attempt', a.id), replacement, 'late failure cannot publish under another lease');
  const engine = new Engine(f.store, f.bridge, f.engineOptions);
  await engine.reconcile();
  assertIngestion(f, 'OUTPUT_DOWNLOAD_FAILED');
  unknown = true; due(f);
  await engine.reconcile();
  assertIngestion(f, 'OUTPUT_DOWNLOAD_FAILED');
  assert.equal(f.calls.post, 1);
  assert.equal(f.calls.query, 2);
});
