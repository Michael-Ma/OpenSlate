import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { fixture as generationFixture } from './helpers/generation-fixture.mjs';
import { compilePlan } from '@openslate/core';

async function completed(t) {
  const f = await confirmationFixture(t, { modes: ['none'] });
  await f.make(); await f.tick(5); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(6);
  assert.equal((await f.overview()).shots['shot-0'].video.state, 'ready');
  return f;
}
const shot = async f => (await f.overview()).shots['shot-0'];
const undo = async (f, commandId) => f.call('POST', '/storyboard', { kind: 'undo', commandId, expectedHeadVersion: f.store.getProject(f.project.id).headVersion });
const edit = (f, field, value) => f.call('POST', '/storyboard', { kind: 'shot', id: 'shot-0', field, value, expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
const use = (f, artifactId, key) => f.call('POST', `/shots/shot-0/takes/${artifactId}/use`, undefined, key);

for (const completedBeforeUndo of [false, true]) test(`Undo reconnects an exact paid video ${completedBeforeUndo ? 'completed while edited' : 'still in flight'} without buying another`, async t => {
  const f = await confirmationFixture(t, { modes: ['none'] });
  await f.make(); await f.tick(5);
  const view = await f.call('GET', '/scenes/scene-0/generation').then(f.ok);
  await f.call('POST', '/scenes/scene-0/generate', { headVersion: view.headVersion, revisionId: view.revisionId, kind: 'video',
    reviewedFrames: view.rows.map(r => ({ shotId: r.shotId, artifactId: r.image.artifactId, sha256: r.image.sha256 })),
    reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId }).then(f.ok);
  const binding = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'video');
  f.provider.setMode(binding.id, 'pending'); await f.engine.runReady();
  const attempt = f.engine.attempts(f.project.id).find(a => a.nodeId === binding.id);
  assert.equal(attempt.phase, 'remote_pending');
  const receipt = await edit(f, 'videoPrompt', 'Temporary edit while the paid clip runs');
  if (completedBeforeUndo) { f.provider.complete(attempt.taskId); await f.engine.reconcile(); }
  const count = f.provider.acceptedCount(), grants = f.store.list('grant', f.project.id);
  await undo(f, receipt.commandId).then(f.ok);
  assert.equal(f.store.get('node_binding', binding.id).candidateId, attempt.candidateId, 'Undo reconnects the exact submitted candidate');
  assert.ok(f.store.get('candidate_stop', attempt.candidateId), 'reconnection never restores retry authority');
  if (!completedBeforeUndo) { await f.restart(); f.provider.complete(attempt.taskId); await f.engine.reconcile(); }
  const restored = await shot(f), finished = f.store.get('attempt', attempt.id);
  assert.equal(restored.video.state, 'ready'); assert.equal(restored.video.artifact.artifactId, finished.outputs.video.artifactId);
  await f.tick(3);
  assert.equal(f.provider.acceptedCount(), count); assert.deepEqual(f.store.list('grant', f.project.id), grants);
});

test('Undo reconnection cannot turn a later technical failure into an automatic paid retry', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] });
  await f.make(); await f.tick(5);
  const view = await f.call('GET', '/scenes/scene-0/generation').then(f.ok);
  await f.call('POST', '/scenes/scene-0/generate', { headVersion: view.headVersion, revisionId: view.revisionId, kind: 'video',
    reviewedFrames: view.rows.map(r => ({ shotId: r.shotId, artifactId: r.image.artifactId, sha256: r.image.sha256 })),
    reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId }).then(f.ok);
  const binding = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'video');
  f.provider.setMode(binding.id, 'pending'); await f.engine.runReady();
  const attempt = f.engine.attempts(f.project.id).find(a => a.nodeId === binding.id), receipt = await edit(f, 'videoPrompt', 'Temporary direction');
  await undo(f, receipt.commandId).then(f.ok);
  f.provider.db.prepare("UPDATE fake_jobs SET status='failed',failure_id=? WHERE id=?").run(randomUUID(), attempt.taskId);
  await f.tick(4);
  assert.equal(f.store.get('node_binding', binding.id).candidateId, attempt.candidateId);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.candidateId === attempt.candidateId).length, 1);
  assert.equal(f.provider.acceptedCount(), 2); assert.equal((await shot(f)).video.state, 'failed');
});

for (const conditioning of ['owned', 'shared']) test(`takes reports unsupported ${conditioning} conditioning frames as unselectable and refuses use atomically`, async t => {
  const f = generationFixture(t, { sharedScene: true }), ok = async r => { assert.equal(r.statusCode, 200, r.body); return r.json(); };
  let artifact;
  if (conditioning === 'owned') { await f.post(await f.get('scene-2')).then(ok); await f.finish(); artifact = (await f.get('scene-2')).rows[0].image; }
  let project = f.store.getProject(f.project.id);
  if (artifact) { project.artifacts.push(artifact); project = f.store.saveProject(project, project.headVersion); }
  const frame = artifact ? `p.asset(${JSON.stringify(artifact.artifactId)})` : 'p.image("shared",{profile:"fake-image-v1",prompt:"Shared frame"})';
  const source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{const frame=${frame};` +
    'const s=p.shot("shot-0");const r=p.humanReview("review",{shots:[{intent:s,keyframe:frame,videoProfile:"fake-video-v1",motionPrompt:"Slow push angle 0",seconds:6}]});' +
    'return p.video("clip",{intent:s,profile:"fake-video-v1",firstFrame:p.approvedImage(frame,r),prompt:"Slow push angle 0",seconds:6});});';
  const compiled = compilePlan(source, { project, profiles: f.store.get('capability_lock', project.capabilityLockId).profiles, logicalIds: {}, allocateId: randomUUID });
  const planId = randomUUID(), grants = Object.fromEntries(compiled.nodes.map(n => [n.id, f.engine.createGrant(project.id, n.shotId ?? project.id, n.kind, 'synthetic-human').id]));
  f.engine.installPlan(project.id, planId, compiled, grants); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion);
  await f.finish(); const review = f.engine.reviewSnapshot(project.id); f.engine.approve(project.id, review.id, review.members.map(m => m.videoNodeId), 'synthetic-human'); await f.finish();
  const takes = await f.call('GET', '/shots/shot-0/takes').then(ok);
  assert.equal(takes.keyframes.length, 1); assert.equal(takes.keyframes[0].selectable, false);
  const before = f.store.getProject(project.id), cursor = f.store.cursor(project.id), attempts = f.engine.attempts(project.id);
  const response = await use(f, takes.keyframes[0].artifact.artifactId);
  assert.equal(response.json().error.code, 'TAKE_NOT_SELECTABLE', response.body);
  assert.deepEqual(f.store.getProject(project.id), before); assert.equal(f.store.cursor(project.id), cursor); assert.deepEqual(f.engine.attempts(project.id), attempts);
});

test('regeneration keeps current frame and clip through dispatch/restart, then outdates clip only on success', async t => {
  const f = await completed(t), before = await shot(f);
  await f.make({ targetShotIds: ['shot-0'], regenerate: true });
  for (const view of [await shot(f), (await f.restart(), await shot(f))]) {
    assert.deepEqual(view.keyframe.artifact, before.keyframe.artifact); assert.deepEqual(view.video.artifact, before.video.artifact);
    assert.equal(view.keyframe.takeCount, 1); assert.equal(view.video.state, 'ready');
  }
  await f.engine.runReady();
  assert.deepEqual((await shot(f)).video.artifact, before.video.artifact);
  await f.tick(4);
  const after = await shot(f);
  assert.notEqual(after.keyframe.artifact.artifactId, before.keyframe.artifact.artifactId);
  assert.equal(after.keyframe.takeCount, 2); assert.equal(after.keyframe.opened, false);
  assert.equal(after.video.state, 'outdated'); assert.deepEqual(after.video.previous, before.video.artifact);
  const takes = await f.call('GET', '/shots/shot-0/takes').then(f.ok);
  assert.deepEqual(takes.keyframes.map(t => t.current), [true, false]);
  assert.deepEqual(takes.keyframes.map(t => t.selectable), [true, true]);
  assert.equal(takes.keyframes[1].artifact.artifactId, before.keyframe.artifact.artifactId);
});

test('failed regeneration retains current frame and clip and never invents another take', async t => {
  const f = await completed(t), before = await shot(f);
  f.provider.setMode(f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image').id, Array(10).fill('technical_failure'));
  await f.make({ targetShotIds: ['shot-0'], regenerate: true }); await f.tick(4);
  assert.ok(f.engine.attempts(f.project.id).some(a => a.phase === 'failed'));
  const after = await shot(f);
  assert.deepEqual(after.keyframe.artifact, before.keyframe.artifact); assert.deepEqual(after.video.artifact, before.video.artifact);
  assert.equal(after.keyframe.takeCount, 1); assert.equal(after.video.state, 'ready');
  // A fresh human press after a terminal failure also retains the original take.
  f.provider.setMode(f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image').id, 'complete');
  await f.make({ targetShotIds: ['shot-0'], regenerate: true });
  assert.deepEqual((await shot(f)).keyframe.artifact, before.keyframe.artifact);
  await f.tick(4); assert.equal((await shot(f)).keyframe.takeCount, 2);
});

test('use earlier take verifies bytes, publishes without grants, outdates clip, replays and undoes', async t => {
  const f = await completed(t), earlier = (await shot(f)).keyframe.artifact;
  await f.make({ targetShotIds: ['shot-0'], regenerate: true }); await f.tick(4);
  assert.equal((await f.call('GET', '/shots/shot-0/takes').then(f.ok)).keyframes.find(t => t.artifact.artifactId === earlier.artifactId).selectable, true);
  await f.openFrames(); await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(6);
  const before = await shot(f), project = f.store.getProject(f.project.id), grants = f.store.list('grant', f.project.id), attempts = f.engine.attempts(f.project.id);
  const artifact = f.store.get('artifact', earlier.artifactId), bytes = readFileSync(artifact.path), cursor = f.store.cursor(f.project.id);
  writeFileSync(artifact.path, 'corrupt');
  assert.equal((await use(f, earlier.artifactId)).json().error.code, 'ARTIFACT_CORRUPT');
  assert.equal(f.store.cursor(f.project.id), cursor);
  writeFileSync(artifact.path, bytes);
  const key = randomUUID(), receipt = await use(f, earlier.artifactId, key).then(f.ok);
  assert.deepEqual(await use(f, earlier.artifactId, key).then(f.ok), receipt);
  const switched = await shot(f);
  assert.deepEqual(switched.keyframe.artifact, earlier); assert.equal(switched.video.state, 'outdated');
  assert.deepEqual(switched.video.previous, before.video.artifact); assert.equal(switched.keyframe.takeCount, 2);
  assert.notEqual(f.store.getProject(f.project.id).activePlanId, project.activePlanId);
  assert.deepEqual(f.store.list('grant', f.project.id), grants); assert.deepEqual(f.engine.attempts(f.project.id), attempts);
  await undo(f, receipt.commandId).then(f.ok);
  const restored = await shot(f);
  assert.deepEqual(restored.keyframe.artifact, before.keyframe.artifact); assert.deepEqual(restored.video.artifact, before.video.artifact);
  await f.tick(3); assert.deepEqual(f.engine.attempts(f.project.id), attempts);
});

for (const [field, value] of [['imagePrompt', 'A different frame'], ['videoPrompt', 'A different movement'], ['desiredFrames', '240']])
  test(`undo ${field} restores exact media and preserves immutable attempts`, async t => {
    const f = await completed(t), before = await shot(f), attempts = f.engine.attempts(f.project.id);
    const receipt = await edit(f, field, value);
    await undo(f, receipt.commandId).then(f.ok);
    const after = await shot(f);
    assert.deepEqual(after.keyframe.artifact, before.keyframe.artifact); assert.deepEqual(after.video.artifact, before.video.artifact);
    assert.deepEqual(f.engine.attempts(f.project.id), attempts);
    assert.equal((await undo(f, receipt.commandId)).json().error.code, 'UNDO_UNAVAILABLE');
  });

test('undo is refused after paid work used the edited state, including unknown outcomes', async t => {
  const f = await completed(t), receipt = await edit(f, 'imagePrompt', 'New paid direction');
  f.provider.setMode(f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image').id, 'unknown_after_accept'); await f.make(); await f.engine.runReady();
  const before = f.store.getProject(f.project.id), cursor = f.store.cursor(f.project.id);
  const response = await undo(f, receipt.commandId);
  assert.equal(response.json().error.code, 'UNDO_UNAVAILABLE', response.body);
  assert.match(response.json().error.message, /Paid work/);
  assert.deepEqual(f.store.getProject(f.project.id), before); assert.equal(f.store.cursor(f.project.id), cursor);
});

test('take routes reject missing key, foreign shot/artifact, current take and live regeneration without side effects', async t => {
  const f = await completed(t), current = (await shot(f)).keyframe.artifact;
  for (const [path, key, code] of [
    [`/shots/shot-0/takes/${current.artifactId}/use`, null, 'IDEMPOTENCY_KEY_REQUIRED'],
    [`/shots/foreign/takes/${current.artifactId}/use`, 'foreign', 'NOT_FOUND'],
    ['/shots/shot-0/takes/foreign/use', 'artifact', 'NOT_FOUND'],
    [`/shots/shot-0/takes/${current.artifactId}/use`, 'current', 'ALREADY_COMPLETE'],
  ]) {
    const cursor = f.store.cursor(f.project.id), response = await f.call('POST', path, undefined, key);
    assert.equal(response.json().error.code, code, response.body); assert.equal(f.store.cursor(f.project.id), cursor);
  }
  await f.make({ targetShotIds: ['shot-0'], regenerate: true });
  assert.equal((await use(f, current.artifactId)).json().error.code, 'ATTEMPT_EXISTS');
});

test('undo byte verification fails atomically and the original identity can retry after repair', async t => {
  const f = await completed(t), before = await shot(f), receipt = await edit(f, 'imagePrompt', 'Different frame');
  const artifact = f.store.get('artifact', before.keyframe.artifact.artifactId), bytes = readFileSync(artifact.path), project = f.store.getProject(f.project.id), cursor = f.store.cursor(f.project.id);
  const key = randomUUID(), body = { kind: 'undo', commandId: receipt.commandId, expectedHeadVersion: project.headVersion };
  writeFileSync(artifact.path, 'corrupt undo source');
  const response = await f.call('POST', '/storyboard', body, key);
  assert.equal(response.json().error.code, 'ARTIFACT_CORRUPT', response.body);
  assert.deepEqual(f.store.getProject(f.project.id), project); assert.equal(f.store.cursor(f.project.id), cursor);
  writeFileSync(artifact.path, bytes);
  await f.call('POST', '/storyboard', body, key).then(f.ok);
  assert.deepEqual((await shot(f)).keyframe.artifact, before.keyframe.artifact);
});

for (const mismatch of ['intent', 'prompt', 'duration']) test(`undo never reattaches a take made for a different ${mismatch}`, async t => {
  const f = await completed(t);
  // Simulate an already stale paid binding; no edit may authenticate it by accident.
  const project = f.store.getProject(f.project.id), target = project.shots[0];
  if (mismatch === 'intent') target.action = 'A different action than the paid output';
  if (mismatch === 'prompt') target.imagePrompt = 'A prompt different from the paid frame';
  if (mismatch === 'duration') target.desiredFrames = 240;
  f.store.saveProject(project, project.headVersion);
  const receipt = await edit(f, mismatch === 'duration' ? 'videoPrompt' : 'imagePrompt', 'Another edit');
  await undo(f, receipt.commandId).then(f.ok);
  const view = await shot(f);
  if (mismatch === 'duration') assert.equal(view.video.artifact, undefined);
  else { assert.equal(view.keyframe.artifact, undefined); assert.equal(view.video.artifact, undefined); }
});

test('a terminally failed regeneration does not prevent selecting an earlier successful take', async t => {
  const f = await completed(t), earlier = (await shot(f)).keyframe.artifact;
  await f.make({ targetShotIds: ['shot-0'], regenerate: true }); await f.tick(4);
  f.provider.setMode(f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image').id, Array(10).fill('technical_failure'));
  await f.make({ targetShotIds: ['shot-0'], regenerate: true }); await f.tick(4);
  const before = await shot(f), receipt = await use(f, earlier.artifactId).then(f.ok);
  assert.deepEqual((await shot(f)).keyframe.artifact, earlier);
  await undo(f, receipt.commandId).then(f.ok);
  assert.deepEqual((await shot(f)).keyframe.artifact, before.keyframe.artifact);
});

test('released unknown regeneration can switch takes while its late result stays historical', async t => {
  const f = await completed(t), earlier = (await shot(f)).keyframe.artifact;
  await f.make({ targetShotIds: ['shot-0'], regenerate: true }); await f.tick(4);
  const node = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image');
  f.provider.setMode(node.id, 'unknown_after_accept');
  await f.make({ targetShotIds: ['shot-0'], regenerate: true }); await f.engine.runReady();
  const unknown = f.engine.attempts(f.project.id).find(a => a.phase === 'submission_unknown'); assert.ok(unknown);
  assert.equal((await use(f, earlier.artifactId)).json().error.code, 'ATTEMPT_EXISTS');
  await f.call('POST', `/attempts/${unknown.id}/release`, { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true }).then(f.ok);
  const grants = f.store.list('grant', f.project.id).length;
  await use(f, earlier.artifactId).then(f.ok); await f.tick(4);
  assert.deepEqual((await shot(f)).keyframe.artifact, earlier);
  assert.equal(f.store.list('grant', f.project.id).length, grants);
  assert.equal((await f.call('GET', '/shots/shot-0/takes').then(f.ok)).keyframes.length, 3);
});

test('HTTP shotFields outdates both media slots and a single Undo restores every field and exact paid take', async t => {
  const f = await completed(t), before = await shot(f), project = f.store.getProject(f.project.id), attempts = f.engine.attempts(f.project.id);
  const body = { kind: 'shotFields', id: 'shot-0', fields: { imagePrompt: 'New frame', motion: 'Pan right', desiredFrames: 240, videoPrompt: 'New video recipe' }, expectedHeadVersion: project.headVersion };
  const key = randomUUID(), receipt = await f.call('POST', '/storyboard', body, key).then(f.ok);
  assert.deepEqual(await f.call('POST', '/storyboard', body, key).then(f.ok), receipt);
  const edited = await shot(f); assert.equal(edited.keyframe.state, 'outdated'); assert.equal(edited.video.state, 'outdated');
  assert.deepEqual(edited.keyframe.previous, before.keyframe.artifact); assert.deepEqual(edited.video.previous, before.video.artifact);
  await undo(f, receipt.commandId).then(f.ok);
  assert.deepEqual(f.store.getProject(f.project.id).shots, project.shots);
  const restored = await shot(f); assert.deepEqual(restored.keyframe.artifact, before.keyframe.artifact); assert.deepEqual(restored.video.artifact, before.video.artifact);
  assert.deepEqual(f.engine.attempts(f.project.id), attempts); await f.tick(2); assert.deepEqual(f.engine.attempts(f.project.id), attempts);
});
