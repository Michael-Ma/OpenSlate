import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { composeScenePlan, digest } from '@openslate/core';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { editStoryboard } from '../dist/storyboard.js';
import { generateScene, sceneView } from '../dist/scene-generation.js';

async function ready(t, otherScene = false) {
  const f = await confirmationFixture(t, { modes: otherScene ? ['none', 'none'] : ['none'] });
  if (otherScene) {
    const project = f.store.getProject(f.project.id);
    project.scenes.push({ id: 'scene-1', revisionId: randomUUID(), purpose: 'An independent scene' });
    project.shots[1].sceneId = 'scene-1';
    const saved = f.store.saveProject({ ...project, revisionId: randomUUID() }, project.headVersion);
    f.store.put('project_revision', saved.revisionId, saved.id, { project: saved });
  }
  await f.make(); await f.tick(5); await f.openFrames();
  return f;
}

function edit(f, input) {
  return editStoryboard(f.production, f.project.id, {
    ...input, expectedHeadVersion: f.store.getProject(f.project.id).headVersion,
  }, randomUUID());
}

for (const change of ['scene title', 'shot motion']) test(`runner video composition preserves an unrelated ${change} edit`, async t => {
  const f = await ready(t, true);
  const confirmation = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  const advancing = f.runner.advance(); // The isolated composition worker is now outstanding.
  const receipt = edit(f, change === 'scene title'
    ? { kind: 'sceneTitle', id: 'scene-1', value: 'A new independent title' }
    : { kind: 'shot', id: 'shot-1', field: 'motion', value: 'A new independent camera move' });
  await advancing;
  const row = f.store.get('scene_confirmation', confirmation.confirmationId);
  assert.equal(row.state, 'done', JSON.stringify(row.blocker));
  assert.equal(row.videoInput, undefined, 'new checkpoints do not persist film-head tokens');
  const project = f.store.getProject(f.project.id);
  assert.ok(project.headVersion > receipt.headVersion);
  if (change === 'scene title') assert.equal(project.scenes[1].title, 'A new independent title');
  else assert.equal(project.shots[1].motion, 'A new independent camera move');
  await f.tick(5);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 1);
  assert.equal((await f.overview()).scenes[0].counts.videosReady, 1);
  assert.equal(f.calls.speech, 0);
});

test('restart resolves a committed video publication after an unrelated edit without buying it again', async t => {
  const f = await ready(t, true);
  const confirmation = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.runner.advance();
  const published = f.store.get('scene_confirmation', confirmation.confirmationId);
  assert.equal(published.state, 'done');
  assert.equal(published.videoInput, undefined);
  // Model a crash after the atomic generation receipt but before the runner checkpoint.
  const interrupted = { ...published, state: 'running' };
  delete interrupted.videoResult;
  f.store.put('scene_confirmation', interrupted.id, f.project.id, interrupted);
  edit(f, { kind: 'sceneTitle', id: 'scene-1', value: 'A title saved before restart' });
  const candidates = f.store.list('candidate', f.project.id), grants = f.store.list('grant', f.project.id);
  await f.restart(); await f.tick(6);
  const resumed = f.store.get('scene_confirmation', confirmation.confirmationId);
  assert.equal(resumed.state, 'done', JSON.stringify(resumed.blocker));
  assert.deepEqual(resumed.videoResult, published.videoResult);
  assert.deepEqual(f.store.list('candidate', f.project.id), candidates);
  assert.deepEqual(f.store.list('grant', f.project.id), grants);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 1);
  assert.equal(f.provider.acceptedCount(), 2);
});

test('runner recomposes over an unrelated scene publication and preserves its candidate and saved media', async t => {
  const f = await ready(t, true);
  const otherActor = f.production.beginRequest(f.project.id, 'local-user', 'Make the independent scene frame', {
    source: 'app', concurrency: 'alongside', scopeIds: ['scene-1'], holdScopeIds: [],
  });
  f.production.authorize(f.project.id, otherActor, [{ scopeId: 'shot-1', kind: 'image' }], randomUUID());
  const other = sceneView(f.production, f.project.id, 'scene-1');
  const aliases = { ...(f.store.get('logical_ids', f.project.id)?.aliases ?? {}) };
  const otherPlan = composeScenePlan(other.plan, [{ shotId: 'shot-1', kind: 'image', profileId: other.profiles.image.id }], {
    project: other.project, profiles: other.lock.profiles, logicalIds: aliases, allocateId: randomUUID,
  });
  const confirmation = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  const advancing = f.runner.advance();
  f.store.transaction(() => f.production.applyCompiledSceneGeneration(f.project.id, otherActor, otherPlan, aliases,
    f.store.getProject(f.project.id).headVersion, digest(other.lock), 'image',
    otherPlan.nodes.filter(node => node.kind === 'image' && node.shotId === 'shot-1').map(node => node.id)));
  const saved = f.store.list('node_binding', f.project.id).find(b => b.node.shotId === 'shot-1');
  await advancing;
  const row = f.store.get('scene_confirmation', confirmation.confirmationId);
  assert.equal(row.state, 'done', JSON.stringify(row.blocker));
  const retained = f.store.get('node_binding', saved.id);
  assert.equal(retained.state, 'active');
  assert.equal(retained.candidateId, saved.candidateId);
  assert.deepEqual(retained.node, saved.node);
  assert.equal(retained.planId, f.store.getProject(f.project.id).activePlanId);
  await f.tick(6);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.nodeId === saved.id).length, 1);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 1);
  assert.ok(f.store.get('node_binding', saved.id).outputs.image);
  assert.equal(f.provider.acceptedCount(), 3, 'each frame and the reviewed video are bought once');
});

test('runner narrows a film hold using the current scenes when an independent scene is added during composition', async t => {
  const f = await ready(t, true);
  const owner = f.production.beginRequest(f.project.id, 'local-user', 'Unfinished film direction', {
    source: 'app', concurrency: 'alongside', scopeIds: [f.project.id],
  });
  const confirmation = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  const advancing = f.runner.advance();
  edit(f, { kind: 'addScene', value: 'A scene added while the runner works' });
  const added = f.store.getProject(f.project.id).scenes.find(s => !['scene-0', 'scene-1'].includes(s.id));
  await advancing;
  const row = f.store.get('scene_confirmation', confirmation.confirmationId);
  assert.equal(row.state, 'done', JSON.stringify(row.blocker));
  const held = f.store.list('hold', f.project.id).filter(h => h.active && h.ownerId === owner.requestId).map(h => h.scopeId).sort();
  assert.deepEqual(held, ['scene-1', added.id].sort());
});

test('runner video composition still refuses a changed shot in its reviewed scene', async t => {
  const f = await ready(t);
  const confirmation = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  const advancing = f.runner.advance();
  edit(f, { kind: 'shot', id: 'shot-0', field: 'motion', value: 'An unconfirmed camera move' });
  await advancing; await f.tick(3);
  const row = f.store.get('scene_confirmation', confirmation.confirmationId);
  assert.equal(row.state, 'blocked');
  assert.equal(row.blocker.code, 'SCENE_REVIEW_STALE');
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 0);
  assert.equal(f.store.list('candidate', f.project.id).filter(c => f.store.get('node_binding', c.nodeId)?.node.kind === 'video').length, 0);
});

test('runner video composition refuses a frame pin detached while its worker is outstanding', async t => {
  const f = await ready(t);
  const confirmation = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  const image = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image');
  const advancing = f.runner.advance();
  f.store.put('node_binding', image.id, f.project.id, { ...image, outputs: {} });
  await advancing; await f.tick(3);
  const row = f.store.get('scene_confirmation', confirmation.confirmationId);
  assert.equal(row.state, 'blocked');
  assert.equal(row.blocker.code, 'SCENE_REVIEW_STALE');
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 0);
});

test('per-shot regeneration refuses a running video confirmation without changing its pins or holds', async t => {
  const f = await ready(t);
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  const bindings = f.store.list('node_binding', f.project.id), holds = f.store.list('hold', f.project.id),
    messages = f.store.list('message', f.project.id), grants = f.store.list('grant', f.project.id);
  const view = await f.call('GET', '/scenes/scene-0/generation').then(f.ok);
  const refused = await f.call('POST', '/scenes/scene-0/generate', {
    headVersion: view.headVersion, revisionId: view.revisionId, kind: 'image', targetShotIds: ['shot-0'], regenerate: true,
    reviewedFrames: [], reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId,
  });
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().error.code, 'CONFIRMATION_RUNNING');
  assert.deepEqual(f.store.list('node_binding', f.project.id), bindings);
  assert.deepEqual(f.store.list('hold', f.project.id), holds);
  assert.deepEqual(f.store.list('message', f.project.id), messages);
  assert.deepEqual(f.store.list('grant', f.project.id), grants);
  await f.tick(5);
  assert.equal((await f.overview()).scenes[0].confirmation.state, 'done');
});

test('a video confirmation arriving during image composition prevents regeneration from detaching its pin', async t => {
  const f = await ready(t), body = await f.confirmBody();
  const view = sceneView(f.production, f.project.id, 'scene-0').view;
  const bindings = f.store.list('node_binding', f.project.id);
  const regenerating = generateScene(f.production, f.project.id, 'scene-0', {
    headVersion: view.headVersion, revisionId: view.revisionId, kind: 'image', targetShotIds: ['shot-0'], regenerate: true,
    reviewedFrames: [], reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId,
  }, randomUUID(), f.narration);
  f.runner.confirm(f.project.id, 'scene-0', body, randomUUID());
  await assert.rejects(regenerating, error => error.code === 'CONFIRMATION_RUNNING');
  assert.deepEqual(f.store.list('node_binding', f.project.id), bindings);
  await f.tick(5);
  assert.equal((await f.overview()).scenes[0].confirmation.state, 'done');
  assert.equal(f.provider.acceptedCount(), 2, 'the original frame and one reviewed clip were bought');
});
