import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';

const imageBinding = f => f.store.list('node_binding', f.project.id).find(b => b.state === 'active' && b.node.kind === 'image' && b.node.shotId === 'shot-0');
const imageAttempts = (f, candidateId) => f.engine.attempts(f.project.id).filter(a => a.candidateId === candidateId);

async function twoFrames(t) {
  const f = await confirmationFixture(t, { modes: ['none'] });
  await f.make(); await f.tick(5);
  const earlier = (await f.overview()).shots['shot-0'].keyframe.artifact;
  await f.make({ targetShotIds: ['shot-0'], regenerate: true }); await f.tick(5);
  const current = imageBinding(f);
  assert.notEqual(current.outputs.image.artifactId, earlier.artifactId);
  assert.equal((await f.overview()).shots['shot-0'].video.artifact, undefined, 'the regression must exercise a first video confirmation');
  return { f, earlier, current };
}

function assertRestored(f, current) {
  const restored = imageBinding(f);
  assert.equal(restored.candidateId, current.candidateId, 'restore the retained candidate as the execution selection');
  assert.deepEqual(restored.outputs, current.outputs, 'the retained frame must be a real execution input');
  assert.equal(restored.retainedTake, undefined, 'a settled replacement must not leave display-only frame state');
}

async function confirmAndUseEarlier(f, earlier, current) {
  assertRestored(f, current);
  await f.openFrames();
  const grantsBeforeConfirm = f.store.list('grant', f.project.id).length;
  const receipt = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.tick(8);
  const view = await f.overview();
  assert.equal(view.scenes[0].confirmation.state, 'done', JSON.stringify(view.scenes[0].confirmation));
  assert.equal(view.shots['shot-0'].video.state, 'ready');
  const videos = f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video');
  assert.equal(videos.length, 1, 'the confirmation must buy exactly one clip');
  assert.equal(videos[0].phase, 'succeeded');
  assert.ok(videos[0].request.inputs.some(a => a.artifactId === current.outputs.image.artifactId), 'the clip must use the restored retained frame');
  assert.equal(f.store.get('scene_confirmation', receipt.confirmationId).state, 'done');
  assert.equal(f.store.list('grant', f.project.id).length, grantsBeforeConfirm + 1);
  const grants = f.store.list('grant', f.project.id), attempts = f.engine.attempts(f.project.id);
  const takes = await f.call('GET', '/shots/shot-0/takes').then(f.ok);
  assert.equal(takes.keyframes.find(t => t.artifact.artifactId === earlier.artifactId).selectable, true);
  await f.call('POST', `/shots/shot-0/takes/${earlier.artifactId}/use`).then(f.ok);
  assert.equal((await f.overview()).shots['shot-0'].keyframe.artifact.artifactId, earlier.artifactId);
  await f.call('POST', `/shots/shot-0/takes/${current.outputs.image.artifactId}/use`).then(f.ok);
  assert.equal((await f.overview()).shots['shot-0'].keyframe.artifact.artifactId, current.outputs.image.artifactId,
    'the restored old frame itself remains selectable when it is an earlier take');
  assert.deepEqual(f.store.list('grant', f.project.id), grants, 'using a take must not create paid authority');
  assert.deepEqual(f.engine.attempts(f.project.id), attempts, 'using a take must not buy another attempt');
}

for (const mode of ['technical_failure', 'reject_before_accept']) test(`R2 ${mode} restores retained keyframe only after the replacement exhausts its automatic retries, then confirms a clip`, async t => {
  const { f, earlier, current } = await twoFrames(t);
  f.provider.setMode(current.id, [mode, mode]);
  await f.make({ targetShotIds: ['shot-0'], regenerate: true });
  const replacement = imageBinding(f), count = f.provider.acceptedCount();
  await f.engine.runReady(); await f.engine.reconcile();
  const first = imageAttempts(f, replacement.candidateId);
  assert.equal(first.length, 1); assert.equal(first[0].phase, 'failed');
  assert.equal(imageBinding(f).candidateId, replacement.candidateId, 'a remaining automatic retry must keep its candidate');
  assert.deepEqual(imageBinding(f).retainedTake.outputs, current.outputs);
  assert.deepEqual(imageBinding(f).outputs, {});
  await f.engine.runReady(); await f.engine.reconcile();
  const failed = imageAttempts(f, replacement.candidateId);
  assert.equal(failed.length, 2); assert.ok(failed.every(a => a.phase === 'failed'));
  for (const attempt of failed) assert.equal(f.store.get('reservation', attempt.reservationId).state, mode === 'technical_failure' ? 'charged' : 'released');
  assertRestored(f, current);
  await f.restart(); await f.tick(3);
  assert.equal(imageAttempts(f, replacement.candidateId).length, 2, 'restoration and restart must not retry the failed replacement');
  assert.equal(f.provider.acceptedCount(), count + (mode === 'technical_failure' ? 2 : 0));
  await confirmAndUseEarlier(f, earlier, current);
});

test('R2 Stop restores a queued unsent replacement frame and Continue never buys its detached candidate', async t => {
  const { f, earlier, current } = await twoFrames(t);
  await f.make({ targetShotIds: ['shot-0'], regenerate: true });
  const replacement = imageBinding(f), count = f.provider.acceptedCount();
  assert.equal(imageAttempts(f, replacement.candidateId).length, 0);
  const receipt = await f.call('POST', '/controls', { action: 'stop' }).then(f.ok);
  assert.ok(receipt.stopped.detachedJobs > 0);
  assertRestored(f, current);
  await f.restart();
  await f.call('POST', '/controls', { action: 'resume', expectedAuthorityId: receipt.stopped.stopId }).then(f.ok);
  await f.tick(3);
  assert.equal(imageAttempts(f, replacement.candidateId).length, 0);
  assert.equal(f.provider.acceptedCount(), count, 'Continue does not reauthorize the unsent replacement');
  await confirmAndUseEarlier(f, earlier, current);
});

test('R2 releasing a no-answer replacement restores its current frame and a late paid result stays an earlier take', async t => {
  const { f, earlier, current } = await twoFrames(t);
  f.provider.setMode(current.id, 'unknown_after_accept');
  await f.make({ targetShotIds: ['shot-0'], regenerate: true }); await f.engine.runReady();
  const replacement = imageBinding(f), unknown = imageAttempts(f, replacement.candidateId)[0];
  assert.equal(unknown.phase, 'submission_unknown');
  const count = f.provider.acceptedCount();
  await f.call('POST', `/attempts/${unknown.id}/release`, { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true }).then(f.ok);
  assertRestored(f, current);
  const released = f.store.get('attempt', unknown.id);
  assert.equal(released.phase, 'submission_unknown'); assert.ok(released.released);
  assert.notEqual(f.store.get('reservation', unknown.reservationId).state, 'released', 'human release must preserve possible liability');
  await f.restart(); await f.engine.reconcile();
  const late = f.store.get('attempt', unknown.id);
  assert.equal(late.phase, 'succeeded'); assert.ok(late.released);
  assert.equal(f.store.get('reservation', unknown.reservationId).state, 'charged');
  assert.equal(f.provider.acceptedCount(), count, 'late reconciliation must never resubmit');
  assertRestored(f, current);
  const takes = await f.call('GET', '/shots/shot-0/takes').then(f.ok);
  assert.equal(takes.keyframes.length, 3);
  assert.equal(takes.keyframes.find(t => t.artifact.artifactId === late.outputs.image.artifactId).current, false);
  await confirmAndUseEarlier(f, earlier, current);
});

test('R2 a temporary retained-frame replacement cannot detach a queued confirmation voice or strand it after frame restoration', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] });
  await f.make(); await f.tick(5);
  for (const [field, value] of [['mode', 'generated'], ['text', 'A voice requested with the confirmed clip']]) {
    await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field, value,
      expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  }
  await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(1);
  const current = imageBinding(f), voice = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'speech');
  assert.ok(voice.candidateId); assert.equal(f.calls.speech, 0);
  // Model an independently published, same-spec replacement without changing
  // any of the original confirmation's authored inputs or speech authority.
  const project = f.store.getProject(f.project.id), plan = f.store.get('plan', project.activePlanId), planId = randomUUID();
  const grant = f.engine.createGrant(project.id, 'shot-0', 'image', 'synthetic-same-spec-replacement');
  f.store.transaction(() => {
    f.engine.installPlan(project.id, planId, plan.compiled, { [current.id]: grant.id });
    const replacement = f.store.get('node_binding', current.id);
    f.store.put('node_binding', current.id, project.id, { ...replacement,
      retainedTake: { candidateId: current.candidateId, outputs: current.outputs } });
    f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion);
    for (const hold of f.store.list('hold', project.id).filter(h => h.active)) f.engine.releaseHold(project.id, hold.id, hold.ownerId);
  });
  f.provider.setMode(current.id, ['technical_failure', 'technical_failure']);
  const replacementId = imageBinding(f).candidateId;
  const result = await f.engine.runReady();
  assert.ok(result.blocked.some(b => b.nodeId === voice.id && b.code === 'SCENE_REVIEW_STALE'));
  assert.equal(f.store.get('node_binding', voice.id).candidateId, voice.candidateId, 'a temporarily unavailable pin must not detach the confirmation speech candidate');
  assert.equal(f.store.get('node_binding', voice.id).outdatedReason, undefined);
  await f.tick(10);
  assert.equal(imageAttempts(f, replacementId).length, 2);
  assertRestored(f, current);
  const view = await f.overview();
  assert.equal(view.scenes[0].confirmation.state, 'done', JSON.stringify(view.scenes[0].confirmation));
  assert.equal(view.shots['shot-0'].video.state, 'ready');
  assert.equal(f.calls.speech, 1);
  assert.equal(f.engine.attempts(project.id).filter(a => a.request.kind === 'speech').length, 1);
  assert.equal(f.engine.attempts(project.id).filter(a => a.request.kind === 'video').length, 1);
});
