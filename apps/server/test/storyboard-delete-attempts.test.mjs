import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '@openslate/core';
import { setup, projectFixture } from './execution-fixture.mjs';
import { narrationSpeechFixture } from './narration-speech-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { editStoryboard } from '../dist/storyboard.js';

function fixture(t, options = {}) {
  const f = setup(t, { count: 1, ...options });
  const service = new ProductionService(f.store, f.engine);
  const edit = body => editStoryboard(service, f.projectId, {
    expectedHeadVersion: f.store.getProject(f.projectId).headVersion, ...body,
  }, randomUUID());
  return { ...f, service, edit };
}

async function prepareKind(f, kind) {
  if (kind === 'video') {
    await f.engine.runReady();
    await f.engine.reconcile();
    const review = f.engine.reviewSnapshot(f.projectId);
    f.engine.approve(f.projectId, review.id, review.members.map(row => row.videoNodeId), 'delete-test-review');
  }
  return f.plan.nodes.find(node => node.kind === kind && node.shotId === 'shot-0');
}

function assertDeleteRefused(f, shotId = 'shot-0') {
  const before = f.store.getProject(f.projectId);
  const bindings = f.store.list('node_binding', f.projectId);
  const attempts = f.engine.attempts(f.projectId);
  const holds = f.store.list('hold', f.projectId);
  const messages = f.store.list('message', f.projectId);
  const cursor = f.store.cursor(f.projectId);
  assert.throws(() => f.edit({ kind: 'deleteShot', id: shotId }), { code: 'ATTEMPTS_RUNNING' });
  assert.deepEqual(f.store.getProject(f.projectId), before);
  assert.deepEqual(f.store.list('node_binding', f.projectId), bindings);
  assert.deepEqual(f.engine.attempts(f.projectId), attempts);
  assert.deepEqual(f.store.list('hold', f.projectId), holds);
  assert.deepEqual(f.store.list('message', f.projectId), messages);
  assert.equal(f.store.cursor(f.projectId), cursor);
}

for (const kind of ['image', 'video']) {
  for (const [mode, phase] of [['pending', 'remote_pending'], ['unknown_after_accept', 'submission_unknown']]) {
    test(`deleteShot refuses a ${phase} ${kind} attempt until its exact job settles`, async t => {
      const f = fixture(t), node = await prepareKind(f, kind);
      f.provider.setMode(node.id, mode);
      await f.engine.runReady();
      const attempt = f.engine.attempts(f.projectId).find(row => row.nodeId === node.id);
      assert.equal(attempt.phase, phase);
      assertDeleteRefused(f);
      const accepted = f.provider.acceptedCount();
      if (mode === 'pending') f.provider.complete(attempt.taskId);
      await f.engine.reconcile();
      assert.equal(f.store.get('attempt', attempt.id).phase, 'succeeded');
      const artifacts = f.store.list('artifact', f.projectId);
      f.edit({ kind: 'deleteShot', id: 'shot-0' });
      assert.equal(f.store.getProject(f.projectId).shots.length, 0);
      assert.deepEqual(f.store.list('artifact', f.projectId), artifacts);
      assert.equal((await f.engine.runReady()).dispatched, 0);
      assert.equal(f.provider.acceptedCount(), accepted);
    });
  }

  test(`deleteShot refuses an in-flight ${kind} submission before the provider replies`, async t => {
    const f = fixture(t), node = await prepareKind(f, kind);
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const submit = f.provider.submit.bind(f.provider);
    f.provider.submit = async request => {
      entered.resolve();
      await release.promise;
      return submit(request);
    };
    const running = f.engine.runReady();
    await entered.promise;
    try {
      const attempt = f.engine.attempts(f.projectId).find(row => row.nodeId === node.id);
      assert.equal(attempt.phase, 'submitting');
      assertDeleteRefused(f);
    } finally {
      release.resolve();
      await running;
    }
    await f.engine.reconcile();
    f.edit({ kind: 'deleteShot', id: 'shot-0' });
    assert.equal(f.store.getProject(f.projectId).shots.length, 0);
  });

  test(`deleteShot allows a terminal failed ${kind} attempt without dispatching its retry`, async t => {
    const f = fixture(t), node = await prepareKind(f, kind);
    f.provider.setMode(node.id, 'technical_failure');
    await f.engine.runReady();
    await f.engine.reconcile();
    const attempt = f.engine.attempts(f.projectId).find(row => row.nodeId === node.id);
    assert.equal(attempt.phase, 'failed');
    const accepted = f.provider.acceptedCount();
    f.edit({ kind: 'deleteShot', id: 'shot-0' });
    assert.equal(f.store.getProject(f.projectId).shots.length, 0);
    assert.equal((await f.engine.runReady()).dispatched, 0);
    assert.equal(f.provider.acceptedCount(), accepted);
  });
}

test('deleteShot keeps released unknown work protected until reconciliation settles it', async t => {
  const f = fixture(t, { imagesOnly: true }), node = f.plan.nodes[0];
  f.provider.setMode(node.id, 'unknown_after_accept');
  await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId)[0];
  f.engine.releaseAttempt(f.projectId, attempt.id, 'local-user', true);
  assert.equal(f.store.get('attempt', attempt.id).phase, 'submission_unknown');
  assert.equal(f.store.get('node_binding', node.id).candidateId, null);
  assertDeleteRefused(f);
  await f.engine.reconcile();
  assert.equal(f.store.get('attempt', attempt.id).phase, 'succeeded');
  f.edit({ kind: 'deleteShot', id: 'shot-0' });
  assert.equal(f.store.getProject(f.projectId).shots.length, 0);
  assert.equal(f.provider.acceptedCount(attempt.id), 1);
});

test('deleteShot ignores unresolved attempts belonging only to another shot', async t => {
  const f = fixture(t, { count: 2, imagesOnly: true });
  const node = f.plan.nodes.find(row => row.shotId === 'shot-0');
  f.provider.setMode(node.id, 'pending');
  await f.engine.runReady();
  await f.engine.reconcile();
  const attempt = f.engine.attempts(f.projectId).find(row => row.nodeId === node.id);
  assert.equal(attempt.phase, 'remote_pending');
  f.edit({ kind: 'deleteShot', id: 'shot-1' });
  assert.deepEqual(f.store.getProject(f.projectId).shots.map(row => row.id), ['shot-0']);
  assert.deepEqual(f.store.get('attempt', attempt.id), attempt);
});

test('deleteShot refuses unresolved section speech for every mapped shot without dispatching it', async t => {
  const f = await narrationSpeechFixture(t, { realSpeech: true });
  const before = f.store.getProject(f.project.id);
  const project = { ...projectFixture(f.project.id, 2), capabilityLockId: before.capabilityLockId };
  const segment = f.view().segments[0];
  project.shots[0].narration = { mode: 'generated', text: segment.script.text, voice: 'stock' };
  f.store.saveProject(project, before.headVersion);
  const current = f.store.getProject(project.id);
  f.store.insert('project_revision', current.revisionId, current.id, { project: current });
  for (const shot of project.shots) f.store.put('narration_shot_draft', digest({ projectId: project.id, shotId: shot.id }), project.id, {
    projectId: project.id, shotId: shot.id, segmentId: segment.entry.segmentId,
    ...(shot.narration ? { intentDigest: digest(shot.narration) } : {}),
  });
  const proposal = await f.prepare(), applied = await f.review(proposal);
  f.issue(applied);
  const attempt = f.admit(applied);
  assert.equal(attempt.request.kind, 'speech');
  assert.equal(f.store.get('node_binding', attempt.nodeId).node.shotId, null);
  const edits = {
    ...f, projectId: project.id,
    edit: body => editStoryboard(f.production, project.id, {
      expectedHeadVersion: f.store.getProject(project.id).headVersion, ...body,
    }, randomUUID()),
  };
  for (const shot of project.shots) assertDeleteRefused(edits, shot.id);
  assert.deepEqual(f.store.get('attempt', attempt.id), attempt);
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});
