import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '@openslate/core';
import { createApp } from '../dist/app.js';
import { GenerationOverviewReader } from '../dist/generation-overview.js';
import { narrationSpeechFixture } from './narration-speech-fixture.mjs';

async function voiceFixture(t, options = {}) {
  const f = await narrationSpeechFixture(t, { plan: true, realSpeech: true, configuredAdmission: true, ...options });
  const segment = f.view().segments[0], project = f.store.getProject(f.project.id);
  project.shots[0].narration = { mode: 'generated', text: segment.script.text, voice: 'stock' };
  project.shots[0].narrationPending = true;
  project.revisionId = randomUUID();
  const saved = f.store.saveProject(project, project.headVersion);
  f.store.insert('project_revision', saved.revisionId, project.id, { project: saved });
  f.store.put('narration_shot_draft', digest({ projectId: project.id, shotId: 'shot-0' }), project.id,
    { shotId: 'shot-0', segmentId: segment.entry.segmentId });
  const proposal = await f.prepare(), application = await f.review(proposal);
  f.attempt = f.admit(application);
  f.reader = new GenerationOverviewReader(f.production, f.narration);
  f.voice = () => f.reader.read(project.id).shots['shot-0'].narration;
  f.context = { expectedLease: { owner: f.attempt.leaseOwner, epoch: f.attempt.leaseEpoch } };
  f.due = () => {
    const attempt = f.store.get('attempt', f.attempt.id);
    f.store.put('attempt', attempt.id, project.id, { ...attempt, leaseExpiresAt: 0, unknownWait: { count: 0, nextEligibleAt: 0 } });
  };
  return f;
}

test('voice lost reply exposes charged terminal failure from the actual reconciled attempt', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await voiceFixture(t, { fetch: async () => { throw Error('private provider response body'); } });
  assert.equal((await f.bridge.submit(f.attempt.request, f.context)).type, 'unknown');
  const dispatch = f.store.get('speech_execution_dispatch', f.attempt.id);
  t.mock.timers.setTime(Date.parse(dispatch.createdAt) + 120001);
  f.due(); await f.engine.reconcile();
  const settled = f.store.get('attempt', f.attempt.id), voice = f.voice();
  assert.equal(voice.state, 'failed');
  assert.deepEqual(voice.failure, { code: 'SUBMISSION_RESPONSE_LOST', technical: true, retryAllowed: false,
    autoRetriesLeft: 0, charged: true, at: f.store.list('execution_evidence', f.project.id).at(-1).recordedAt });
  assert.equal(f.store.get('reservation', settled.reservationId).state, 'charged');
  assert.equal(voice.attemptId, undefined);
  for (let i = 0; i < 3; i++) { await f.engine.reconcile(); await f.engine.runReady(); }
  assert.equal(f.calls.http, 1); assert.equal(f.engine.attempts(f.project.id).length, 1);
  assert.ok(!JSON.stringify(voice).includes('private provider response body'));
});

test('voice never dispatched exposes uncharged failure and exact no-dispatch proof', async t => {
  const f = await voiceFixture(t);
  f.due(); await f.engine.reconcile();
  const settled = f.store.get('attempt', f.attempt.id), voice = f.voice();
  assert.equal(voice.state, 'failed');
  assert.deepEqual(voice.failure, { code: settled.failure.id, technical: true, retryAllowed: false,
    autoRetriesLeft: 0, charged: false, at: f.store.list('execution_evidence', f.project.id).at(-1).recordedAt, notDispatched: true });
  assert.equal(f.store.get('reservation', settled.reservationId).state, 'released');
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});

test('voice provider refusal exposes the allowlisted uncharged failure without claiming no dispatch', async t => {
  const f = await voiceFixture(t, { fetch: async () => new Response(JSON.stringify({ error: { type: 'rate_limit_error', message: 'private refusal prose' } }),
    { status: 429, headers: { 'content-type': 'application/json', 'x-request-id': 'private-rpc-id' } }) });
  assert.equal((await f.bridge.submit(f.attempt.request, f.context)).type, 'rejected');
  f.due(); await f.engine.reconcile();
  const settled = f.store.get('attempt', f.attempt.id), voice = f.voice();
  assert.equal(voice.state, 'failed');
  assert.deepEqual(voice.failure, { code: settled.failure.id, technical: false, retryAllowed: false,
    autoRetriesLeft: 0, charged: false, at: f.store.list('execution_evidence', f.project.id).at(-1).recordedAt });
  assert.equal(f.calls.http, 1);
  assert.ok(!JSON.stringify(voice).includes('private'));
});

test('voice making and no-answer expose their exact attempt; human release keeps liability and clears current outcome', async t => {
  const f = await voiceFixture(t, { fetch: async () => { throw Error('offline unknown'); } });
  assert.equal(f.voice().state, 'making'); assert.equal(f.voice().attemptId, f.attempt.id);
  assert.equal(f.voice().failure, undefined);
  await f.bridge.submit(f.attempt.request, f.context);
  f.due(); await f.engine.reconcile();
  assert.equal(f.voice().state, 'no_answer'); assert.equal(f.voice().attemptId, f.attempt.id);
  assert.equal(f.voice().failure, undefined);
  const localToken = 'offline-voice-release-token', app = createApp({ service: f.production, localToken, logger: false });
  t.after(() => app.close());
  const key = randomUUID(), command = { method: 'POST', url: `/api/projects/${f.project.id}/attempts/${f.voice().attemptId}/release`,
    headers: { host: '127.0.0.1', authorization: `Bearer ${localToken}`, 'idempotency-key': key },
    payload: { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true } };
  const response = await app.inject(command);
  assert.equal(response.statusCode, 200, response.body);
  const receipt = response.json(), replay = await app.inject(command);
  assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), receipt);
  assert.equal(receipt.attemptId, f.attempt.id);
  assert.equal(f.voice().state, 'text_only'); assert.equal(f.voice().attemptId, undefined); assert.equal(f.voice().failure, undefined);
  assert.equal(f.store.get('reservation', f.attempt.reservationId).state, 'reserved');
  assert.equal(f.store.get('attempt', f.attempt.id).phase, 'submission_unknown');
  assert.equal(f.calls.http, 1);
});
