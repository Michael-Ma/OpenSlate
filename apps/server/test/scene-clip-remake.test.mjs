import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { quote } from '../dist/generation-quotes.js';
import { compilePlan, composeScenePlan, digest } from '@openslate/core';
import { sceneView } from '../dist/scene-generation.js';

async function saved(t, modes = ['none']) {
  const f = await confirmationFixture(t, { modes });
  await f.make(); await f.tick(14); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.tick(10);
  assert.equal((await f.overview()).scenes[0].counts.videosReady, modes.length);
  return f;
}
async function remakeBody(f, targetShotIds = ['shot-0']) {
  const view = await f.overview();
  return { targetShotIds, confirmationDigest: view.scenes[0].confirmationDigest,
    reviewedFrames: targetShotIds.map(shotId => ({ shotId, artifactId: view.shots[shotId].keyframe.artifact.artifactId, sha256: view.shots[shotId].keyframe.artifact.sha256 })),
    expectedEstimateMicros: targetShotIds.reduce((sum, id) => sum + BigInt(view.shots[id].quotes.remakeClip.micros), 0n).toString() };
}
const remake = (f, body, key) => f.call('POST', '/scenes/scene-0/remake-clips', body, key);
const selected = f => f.store.list('node_binding', f.project.id).filter(b => b.state === 'active' && ['image', 'video'].includes(b.node.kind))
  .map(({ id, node, candidateId, outputs }) => ({ id, kind: node.kind, shotId: node.shotId, candidateId, outputs }));

test('a 1.1-only remake keeps its exact approved keyframe and saved voice, replaces one clip only on success, and replays without work', async t => {
  const f = await saved(t, ['generated', 'none', 'none', 'none']);
  const before = await f.overview(), bindings = selected(f), attempts = f.engine.attempts(f.project.id), speech = f.calls.speech;
  assert.deepEqual(before.shots['shot-0'].remakeClip, { available: true });
  assert.equal(before.shots['shot-0'].quotes.remakeClip.units, 1);
  const priorVideo = attempts.find(a => a.request.kind === 'video' && a.nodeId === bindings.find(b => b.kind === 'video' && b.shotId === 'shot-0').id);
  const body = await remakeBody(f), key = randomUUID(), receipt = await remake(f, body, key).then(f.ok);
  assert.deepEqual(await remake(f, body, key).then(f.ok), receipt);
  assert.equal((await f.overview()).shots['shot-0'].video.artifact.artifactId, before.shots['shot-0'].video.artifact.artifactId);
  await f.runner.advance();
  const pending = await f.overview();
  assert.equal(pending.shots['shot-0'].video.state, 'ready');
  assert.equal(pending.shots['shot-0'].video.artifact.artifactId, before.shots['shot-0'].video.artifact.artifactId);
  assert.equal(pending.shots['shot-0'].video.replacement.state, 'queued');
  const video = selected(f).find(b => b.kind === 'video' && b.shotId === 'shot-0');
  f.provider.setMode(video.id, 'pending'); await f.engine.runReady();
  const newAttempt = f.engine.attempts(f.project.id).at(-1);
  assert.deepEqual(newAttempt.request.inputs, priorVideo.request.inputs, 'the exact frame artifact and sha256 pin are reused');
  assert.deepEqual(newAttempt.request.args, priorVideo.request.args, 'saved motion, profile, settings and duration are reused');
  assert.equal((await f.overview()).shots['shot-0'].video.replacement.state, 'running');
  f.provider.complete(newAttempt.taskId); await f.tick(5);
  const after = await f.overview();
  assert.notEqual(after.shots['shot-0'].video.artifact.artifactId, before.shots['shot-0'].video.artifact.artifactId);
  assert.deepEqual(after.shots['shot-0'].keyframe, before.shots['shot-0'].keyframe);
  assert.deepEqual(after.shots['shot-0'].narration, before.shots['shot-0'].narration);
  assert.equal(f.calls.speech, speech);
  assert.equal(f.engine.attempts(f.project.id).length, attempts.length + 1);
  assert.deepEqual(selected(f).filter(b => b.shotId !== 'shot-0' || b.kind === 'image'), bindings.filter(b => b.shotId !== 'shot-0' || b.kind === 'image'));
  assert.ok(f.engine.attempts(f.project.id).some(a => Object.values(a.outputs).some(o => o.artifactId === before.shots['shot-0'].video.artifact.artifactId)), 'old clip stays in immutable attempt history');
  assert.deepEqual(await remake(f, body, key).then(f.ok), receipt); await f.tick(2);
  assert.equal(f.engine.attempts(f.project.id).length, attempts.length + 1);
});

test('a terminal remake failure restores its old clip as the actual current selection', async t => {
  const f = await saved(t), before = await f.overview(), old = selected(f).find(b => b.kind === 'video');
  await remake(f, await remakeBody(f)).then(f.ok); await f.runner.advance();
  f.provider.setMode(old.id, 'reject_before_accept');
  const submit = f.provider.submit.bind(f.provider);
  f.provider.submit = async request => ({ ...await submit(request), technical: false, retryAllowed: false });
  await f.engine.runReady(); await f.tick(2);
  const after = await f.overview(), binding = f.store.get('node_binding', old.id);
  assert.deepEqual(after.shots['shot-0'].video.artifact, before.shots['shot-0'].video.artifact);
  assert.equal(after.shots['shot-0'].video.state, 'ready');
  assert.equal(after.shots['shot-0'].video.replacement, undefined);
  assert.equal(binding.candidateId, old.candidateId); assert.deepEqual(binding.outputs, old.outputs); assert.equal(binding.retainedTake, undefined);
});

for (const mode of ['pending', 'unknown_after_accept']) test(`${mode} on a remake blocks another press and exposes its existing job without submitting twice`, async t => {
  const f = await saved(t), oldClip = (await f.overview()).shots['shot-0'].video.artifact;
  await remake(f, await remakeBody(f)).then(f.ok); await f.runner.advance();
  const binding = selected(f).find(b => b.kind === 'video');
  f.provider.setMode(binding.id, mode); await f.engine.runReady();
  const count = f.provider.acceptedCount(), attempts = f.engine.attempts(f.project.id).length, view = await f.overview();
  assert.deepEqual(view.shots['shot-0'].video.artifact, oldClip);
  assert.equal(view.shots['shot-0'].video.replacement.state, mode === 'pending' ? 'running' : 'no_answer');
  assert.deepEqual(view.shots['shot-0'].remakeClip, { available: false, code: 'ATTEMPT_EXISTS' });
  const refused = await remake(f, await remakeBody(f));
  assert.equal(refused.json().error.code, 'ATTEMPT_EXISTS', refused.body);
  assert.equal(f.provider.acceptedCount(), count); assert.equal(f.engine.attempts(f.project.id).length, attempts);
});

test('remake refuses unsaved clips, foreign shots, duplicate IDs and more than four shots', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] }); await f.make(); await f.tick(5); await f.openFrames();
  const body = await remakeBody(f);
  assert.equal((await remake(f, body)).json().error.code, 'CLIP_NOT_SAVED');
  const project = f.store.getProject(f.project.id), foreign = { ...project.shots[0], id: 'foreign-shot', sceneId: 'foreign-scene' };
  const next = f.store.saveProject({ ...project, scenes: [...project.scenes, { ...project.scenes[0], id: 'foreign-scene' }], shots: [...project.shots, foreign] }, project.headVersion);
  f.store.put('project_revision', next.revisionId, next.id, { project: next });
  const fresh = await remakeBody(f);
  for (const targetShotIds of [['foreign-shot'], ['shot-0', 'shot-0'], ['a', 'b', 'c', 'd', 'e']]) {
    const result = await remake(f, { ...fresh, targetShotIds });
    assert.equal(result.json().error.code, 'VALIDATION_ERROR', result.body);
  }
  assert.equal(f.store.list('scene_confirmation', f.project.id).length, 0);
});

test('stale confirmation and request guards, changed estimate, unopened frame and edit holds refuse atomically', async t => {
  const f = await saved(t), body = await remakeBody(f), grants = f.store.list('grant', f.project.id).length;
  for (const [extra, code] of [[{ confirmationDigest: 'f'.repeat(64) }, 'SCENE_REVIEW_STALE'], [{ expectedRequestId: 'newer-request' }, 'SCENE_REVIEW_STALE'], [{ expectedEstimateMicros: '99999' }, 'ESTIMATE_CHANGED']]) {
    const result = await remake(f, { ...body, ...extra });
    assert.equal(result.json().error.code, code, result.body);
    assert.equal(f.store.list('grant', f.project.id).length, grants);
  }
  const hold = f.production.beginRequest(f.project.id, 'local-user', 'Edit this shot', { scopeIds: ['shot-0'], source: 'app', concurrency: 'alongside' });
  const held = await remake(f, await remakeBody(f));
  assert.equal(held.json().error.code, 'SCOPE_HELD', held.body);
  assert.deepEqual((await f.overview()).shots['shot-0'].remakeClip, { available: false, code: 'SCOPE_HELD' });
  for (const h of f.store.list('hold', f.project.id).filter(h => h.active && h.ownerId === hold.requestId)) f.engine.releaseHold(f.project.id, h.id, hold.requestId);
  for (const view of f.store.list('frame_view', f.project.id)) f.store.put('frame_view', view.id, f.project.id, { ...view, principal: 'another-user' });
  f.store.appendEvent(f.project.id, 'test.frame_views_removed', {});
  const unopened = await remake(f, await remakeBody(f));
  assert.equal(unopened.json().error.code, 'SCENE_REVIEW_STALE', unopened.body);
  assert.equal((await f.overview()).shots['shot-0'].remakeClip.available, false);
});

test('the existing human generate route also remakes only the named saved clip', async t => {
  const f = await saved(t, ['none', 'none']), view = await f.call('GET', '/scenes/scene-0/generation').then(f.ok);
  const body = await remakeBody(f, ['shot-1']);
  const result = await f.call('POST', '/scenes/scene-0/generate', { headVersion: view.headVersion, revisionId: view.revisionId,
    kind: 'video', regenerate: true, targetShotIds: body.targetShotIds, reviewedFrames: body.reviewedFrames,
    reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId,
    expectedEstimateMicros: body.expectedEstimateMicros }).then(f.ok);
  assert.deepEqual(result.shotIds, ['shot-1']);
  const count = f.engine.attempts(f.project.id).length; await f.tick(5);
  assert.equal(f.engine.attempts(f.project.id).length, count + 1);
});

test('a different shot remake preserves a sibling replacement candidate, selected clip and unknown-job recovery identity', async t => {
  const f = await saved(t, ['none', 'none']);
  await remake(f, await remakeBody(f, ['shot-1'])).then(f.ok); await f.runner.advance();
  const first = selected(f).find(b => b.kind === 'video' && b.shotId === 'shot-1');
  f.provider.setMode(first.id, 'unknown_after_accept'); await f.engine.runReady();
  const sibling = f.store.get('node_binding', first.id), attempt = f.engine.attempts(f.project.id).at(-1);
  const body = await remakeBody(f);
  await remake(f, body).then(f.ok); await f.runner.advance();
  const after = f.store.get('node_binding', first.id);
  assert.equal(after.candidateId, sibling.candidateId); assert.deepEqual(after.outputs, sibling.outputs); assert.deepEqual(after.retainedTake, sibling.retainedTake);
  const view = await f.overview();
  assert.equal(view.shots['shot-1'].video.replacement.attemptId, attempt.id);
  assert.equal(view.shots['shot-1'].video.replacement.state, 'no_answer');
});

test('a durable remake rebases over another scene publication while preserving both the old clip and independent candidate', async t => {
  const f = await confirmationFixture(t, { modes: ['none', 'none'] });
  const project = f.store.getProject(f.project.id);
  project.scenes.push({ id: 'scene-1', revisionId: randomUUID(), purpose: 'An independent scene' });
  project.shots[1].sceneId = 'scene-1';
  const changed = f.store.saveProject({ ...project, revisionId: randomUUID() }, project.headVersion);
  f.store.put('project_revision', changed.revisionId, changed.id, { project: changed });
  await f.make(); await f.tick(5); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(5);
  const oldClip = (await f.overview()).shots['shot-0'].video.artifact;
  const otherActor = f.production.beginRequest(f.project.id, 'local-user', 'Make an independent scene frame', {
    source: 'app', concurrency: 'alongside', scopeIds: ['scene-1'], holdScopeIds: [],
  });
  f.production.authorize(f.project.id, otherActor, [{ scopeId: 'shot-1', kind: 'image' }], randomUUID());
  const other = sceneView(f.production, f.project.id, 'scene-1');
  const aliases = { ...(f.store.get('logical_ids', f.project.id)?.aliases ?? {}) };
  const otherPlan = composeScenePlan(other.plan, [{ shotId: 'shot-1', kind: 'image', profileId: other.profiles.image.id }], {
    project: other.project, profiles: other.lock.profiles, logicalIds: aliases, allocateId: randomUUID,
  });
  const receipt = await remake(f, await remakeBody(f)).then(f.ok), advancing = f.runner.advance();
  f.store.transaction(() => f.production.applyCompiledSceneGeneration(f.project.id, otherActor, otherPlan, aliases,
    f.store.getProject(f.project.id).headVersion, digest(other.lock), 'image',
    otherPlan.nodes.filter(node => node.kind === 'image' && node.shotId === 'shot-1').map(node => node.id)));
  const sibling = selected(f).find(binding => binding.shotId === 'shot-1');
  await advancing;
  const row = f.store.get('scene_confirmation', receipt.confirmationId);
  assert.equal(row.state, 'done', JSON.stringify(row.blocker));
  assert.deepEqual((await f.overview()).shots['shot-0'].video.artifact, oldClip);
  const retained = selected(f).find(binding => binding.id === sibling.id);
  assert.equal(retained.candidateId, sibling.candidateId); assert.deepEqual(retained.outputs, sibling.outputs);
  await f.tick(5);
  assert.notEqual((await f.overview()).shots['shot-0'].video.artifact.artifactId, oldClip.artifactId);
  assert.equal(f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'video').length, 2);
});

test('a sibling with ambiguous takes makes a saved target unavailable like the remake command', async t => {
  const f = await saved(t, ['none', 'none']), project = f.store.getProject(f.project.id);
  const prior = f.store.get('plan', project.activePlanId).compiled;
  const source = prior.canonicalSource
    .replace(/"baseRevision":\s*"[^"]+"/, `"baseRevision": ${JSON.stringify(project.revisionId)}`)
    .replace('  return [', `  return [p.image("sibling-alternative", {intent:p.shot("shot-1"),profile:"fake-image-v1",prompt:${JSON.stringify(project.shots[1].imagePrompt)}}), `);
  assert.notEqual(source, prior.canonicalSource);
  const aliases = { ...(f.store.get('logical_ids', project.id)?.aliases ?? {}) };
  const lock = f.store.get('capability_lock', project.capabilityLockId);
  const compiled = compilePlan(source, { project, profiles: lock.profiles, logicalIds: aliases, allocateId: randomUUID });
  const alternative = compiled.nodes.find(node => node.alias === 'sibling-alternative');
  const grant = f.engine.createGrant(project.id, 'shot-1', 'image', 'synthetic-alternative-human', 'user_change'), planId = randomUUID();
  f.store.transaction(() => {
    f.engine.installPlan(project.id, planId, compiled, { [alternative.id]: grant.id });
    f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion);
  });
  const view = await f.overview();
  assert.equal(view.shots['shot-0'].video.state, 'ready');
  assert.equal(view.shots['shot-1'].keyframe.state, 'choose_take');
  assert.equal(view.scenes[0].confirmationDigest, null);
  assert.deepEqual(view.shots['shot-0'].remakeClip, { available: false, code: 'SCENE_SELECTION_REQUIRED' });
  const target = view.shots['shot-0'].keyframe.artifact;
  const result = await remake(f, { confirmationDigest: '0'.repeat(64), targetShotIds: ['shot-0'],
    reviewedFrames: [{ shotId: 'shot-0', artifactId: target.artifactId, sha256: target.sha256 }] });
  assert.equal(result.json().error.code, 'SCENE_SELECTION_REQUIRED', result.body);
});

test('per-shot remake quotes use the saved video profile and duration and exclude speech and keyframes', () => {
  const lock = { profiles: [{ id: 'video-a', kind: 'video', adapter: 'fake', unitCostMicros: '500000' },
    { id: 'video-b', kind: 'video', adapter: 'fake', unitCostMicros: '900000' }, { id: 'speech', kind: 'speech', adapter: 'fake', unitCostMicros: '200000' }], preferredProfileIds: { video: 'video-a' } };
  const row = { imageComplete: true, videoComplete: true, videoProfileLabel: 'video-b', durationFrames: 180,
    narration: { mode: 'generated', ready: false, recordingCurrent: false, profileId: 'speech' } };
  assert.deepEqual(quote(lock, [row], 'remakeClip'), { micros: '900000', units: 1, unitMicros: '900000', priceUnknown: false });
  assert.equal(quote(lock, [row, row], 'remakeClip').micros, '1800000');
});
