import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '@openslate/core';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { wave } from './speech-execution-fixture.mjs';

const latest = f => f.store.list('scene_confirmation', f.project.id).at(-1);
const speechAttempts = f => f.engine.attempts(f.project.id).filter(a => a.request.kind === 'speech');

async function queuedConfirmation(t, options = {}) {
  const f = await confirmationFixture(t, { modes: ['none'], ...options });
  await f.make(); await f.tick(5);
  for (const [field, value] of [['mode', 'generated'], ['text', 'One unchanged voice line for this clip']]) {
    await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field, value,
      expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  }
  await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.runner.advance();
  assert.equal(latest(f).steps[0].step, 'attach', 'the speech step published its durable candidate');
  assert.equal(f.calls.speech, 0, 'publication has not dispatched the voice');
  return f;
}

async function freshConfirm(f, oldRun, originalSegment) {
  const callsBefore = f.calls.speech;
  await f.openFrames();
  const body = await f.confirmBody(), key = randomUUID();
  const first = await f.call('POST', '/scenes/scene-0/confirm', body, key).then(f.ok);
  assert.notEqual(first.confirmationId, oldRun.id, 'a fresh human press owns the new confirmation');
  const replay = await f.call('POST', '/scenes/scene-0/confirm', body, key).then(f.ok);
  assert.deepEqual(replay, first, 'a lost response replays the exact new press');
  await f.restart(); await f.tick(14);
  const view = await f.overview(), run = latest(f);
  assert.equal(run.state, 'done', JSON.stringify(view.scenes[0].confirmation));
  assert.equal(view.shots['shot-0'].video.state, 'ready');
  assert.equal(f.calls.speech, 1, 'all confirmations together buy the unchanged line once');
  if (callsBefore) assert.equal(f.calls.speech, callsBefore, 'a paid line is reused without another provider call');
  const attempts = speechAttempts(f);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].phase, 'succeeded');
  assert.equal(f.store.get('reservation', attempts[0].reservationId).state, 'charged');
  assert.equal(f.store.list('narration_speech_review', f.project.id).length, callsBefore ? 1 : 2,
    'only an unsent detached candidate needs a new press, never a second paid attempt');
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 1);
  assert.equal(f.narration.workspaceSnapshot(f.project.id).segments[0].script.id, originalSegment,
    'new authority preserves the unchanged immutable voice section');
  assert.equal(f.store.get('scene_confirmation', oldRun.id).state, oldRun.state,
    'the new press never resumes or borrows the old run');
  const project = f.store.getProject(f.project.id);
  assert.equal(digest(f.store.get('project_revision', project.revisionId).project), digest(project),
    'speech and video publication retain coherent immutable project evidence');
  const grants = f.store.list('grant', f.project.id), paid = f.engine.attempts(f.project.id);
  await f.call('POST', '/scenes/scene-0/confirm', body, key).then(f.ok);
  await f.tick(3);
  assert.deepEqual(f.store.list('grant', f.project.id), grants, 'replaying the completed press grants no new spend');
  assert.deepEqual(f.engine.attempts(f.project.id), paid, 'replaying the completed press dispatches nothing');
}

for (const stage of ['queued', 'paid-unattached', 'accepted']) {
  test(`M1 own-shot motion edit after ${stage} speech blocks the old confirm; fresh Confirm buys the line once`, async t => {
    const f = await queuedConfirmation(t);
    const originalSegment = latest(f).steps[0].speechInput.segmentRevisionId;
    if (stage !== 'queued') { await f.engine.runReady(); await f.engine.reconcile(); }
    if (stage === 'accepted') { await f.runner.advance(); await f.runner.advance(); }
    await f.call('POST', '/storyboard', { kind: 'shot', id: 'shot-0', field: 'motion', value: 'Pan slowly toward the ferry',
      expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
    await f.tick(6);
    const oldRun = latest(f);
    assert.equal(oldRun.state, 'blocked');
    assert.equal(oldRun.blocker.code, 'SCENE_REVIEW_STALE');
    assert.equal(f.calls.speech, stage === 'queued' ? 0 : 1);
    assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 0,
      'the old confirmation cannot buy a clip from edited direction');
    await freshConfirm(f, oldRun, originalSegment);
  });
}

for (const stage of ['queued', 'paid-unattached', 'attached']) {
  test(`M1 Stop after ${stage} speech then Continue requires fresh Confirm and buys the line once`, async t => {
    const f = await queuedConfirmation(t);
    const originalSegment = latest(f).steps[0].speechInput.segmentRevisionId;
    if (stage !== 'queued') await f.engine.runReady();
    if (stage === 'attached') { await f.engine.reconcile(); await f.runner.advance(); }
    const stopped = await f.call('POST', '/controls', { action: 'stop' }).then(f.ok);
    const oldRun = latest(f), callsAtStop = f.calls.speech;
    assert.equal(oldRun.state, 'cancelled');
    if (stage === 'queued') assert.ok(stopped.stopped.detachedJobs > 0);
    await f.restart(); await f.tick(3);
    await f.call('POST', '/controls', { action: 'resume', expectedAuthorityId: stopped.stopped.stopId }).then(f.ok);
    await f.tick(4);
    assert.equal(f.calls.speech, callsAtStop, 'Continue never reauthorizes an unsent voice');
    assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 0,
      'Continue never reauthorizes the cancelled video confirmation');
    await freshConfirm(f, oldRun, originalSegment);
  });
}

test('M1 a fresh Confirm after Stop/Continue refuses a still-pending voice, then reuses its settled result', async t => {
  let entered, release;
  const sent = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await queuedConfirmation(t, { fetch: async () => {
    entered(); await held;
    return new Response(wave(24000), { headers: { 'content-type': 'audio/wav' } });
  } });
  const originalSegment = latest(f).steps[0].speechInput.segmentRevisionId;
  const pending = f.engine.runReady(); await sent;
  assert.equal(speechAttempts(f)[0].phase, 'submitting');
  const stopped = await f.call('POST', '/controls', { action: 'stop' }).then(f.ok);
  const oldRun = latest(f);
  await f.call('POST', '/controls', { action: 'resume', expectedAuthorityId: stopped.stopped.stopId }).then(f.ok);
  const grants = f.store.list('grant', f.project.id);
  const refused = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody());
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().error.code, 'ATTEMPT_EXISTS');
  assert.equal(f.calls.speech, 1);
  assert.deepEqual(f.store.list('grant', f.project.id), grants, 'unsettled speech cannot create replacement paid authority');
  release(); await pending; await f.engine.reconcile();
  await freshConfirm(f, oldRun, originalSegment);
});

test('M1 a fresh Confirm after Stop/Continue never retries an unknown voice outcome', async t => {
  const f = await queuedConfirmation(t, { fetch: async () => { throw Error('synthetic lost provider response'); } });
  await f.engine.runReady(); await f.runner.advance();
  assert.equal(speechAttempts(f)[0].phase, 'submission_unknown');
  assert.equal(latest(f).blocker.code, 'SUBMISSION_UNKNOWN');
  const stopped = await f.call('POST', '/controls', { action: 'stop' }).then(f.ok);
  await f.call('POST', '/controls', { action: 'resume', expectedAuthorityId: stopped.stopped.stopId }).then(f.ok);
  const grants = f.store.list('grant', f.project.id), attempts = speechAttempts(f);
  for (let press = 0; press < 2; press++) {
    const refused = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody());
    assert.equal(refused.statusCode, 409, refused.body);
    assert.equal(refused.json().error.code, 'SUBMISSION_UNKNOWN');
    await f.tick(2);
  }
  assert.equal(f.calls.speech, 1, 'fresh human presses still cannot blindly resend an unknown paid call');
  assert.equal(speechAttempts(f).length, 1);
  const current = speechAttempts(f)[0];
  assert.equal(current.id, attempts[0].id);
  assert.equal(current.phase, 'submission_unknown');
  assert.equal(current.reservationId, attempts[0].reservationId);
  assert.deepEqual(current.request, attempts[0].request, 'reconciliation preserves the original dispatch identity and paid input');
  assert.deepEqual(f.store.list('grant', f.project.id), grants);
  assert.notEqual(f.store.get('reservation', attempts[0].reservationId).state, 'released', 'unknown speech retains possible liability');
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 0);
});
