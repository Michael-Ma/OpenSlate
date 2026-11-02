import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { digest } from '@openslate/core';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { FakeProvider } from '@openslate/providers';
import { createApp } from '../dist/app.js';
import { projectFixture, refreshIntent } from './execution-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sceneIds = ['scene-0', 'scene-1', 'scene-2'];
const shotIds = Array.from({ length: 6 }, (_, index) => `shot-${index}`);
const shotsFor = sceneId => shotIds.filter((_, index) => `scene-${Math.floor(index / 2)}` === sceneId);
function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}

async function fixture(t, pending) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-cross-scene-grants-'));
  const store = new Store(join(root, 'state.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') }), service = new ProductionService(store, engine);
  let project = service.createProject('Three scenes after an accepted new script');
  const shape = projectFixture(project.id, shotIds.length);
  shape.scenes = shape.scenes.slice(0, 3);
  shape.shots = shape.shots.map((shot, index) => {
    const next = { ...shot, sceneId: `scene-${Math.floor(index / 2)}`, narration: { mode: 'none', text: '', voice: 'stock' } };
    refreshIntent(next); return next;
  });
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId }, 0);
  store.put('project_revision', project.revisionId, project.id, { project });
  const token = 'offline-cross-scene-grants-local-token', app = createApp({ service, localToken: token, logger: false });
  t.after(async () => {
    await app.close(); store.close(); provider.close(); writable(root); rmSync(root, { recursive: true, force: true });
  });
  const f = { root, store, provider, engine, service, project };
  f.call = (method, path, payload, key = randomUUID()) => app.inject({ method, url: `/api/projects/${project.id}${path}`,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': key },
    ...(payload === undefined ? {} : { payload }) });
  f.ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  f.view = sceneId => f.call('GET', `/scenes/${sceneId}/generation`).then(f.ok);
  f.body = async (sceneId, targetShotIds) => {
    const view = await f.view(sceneId);
    return { headVersion: view.headVersion, revisionId: view.revisionId, kind: 'image', reviewedFrames: [],
      reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId,
      ...(targetShotIds ? { targetShotIds } : {}) };
  };
  f.press = async (sceneId, targetShotIds) => {
    const body = await f.body(sceneId, targetShotIds), key = randomUUID();
    const replay = () => f.call('POST', `/scenes/${sceneId}/generate`, body, key).then(f.ok);
    return { result: await replay(), replay };
  };
  f.finish = async () => { for (let i = 0; i < 6; i++) { await engine.runReady(); await engine.reconcile(); } };
  f.bindings = () => store.list('node_binding', project.id).filter(binding => binding.state === 'active' && binding.node.kind === 'image');
  f.paid = () => ({ grants: store.list('grant', project.id), candidates: store.list('candidate', project.id), attempts: engine.attempts(project.id), accepted: provider.acceptedCount() });

  for (const sceneId of sceneIds) { await f.press(sceneId); await f.finish(); }
  assert.equal(provider.acceptedCount(), 6);
  assert.ok(f.bindings().every(binding => binding.candidateId && binding.outputs.image));

  const saved = createDirectorSkillLock({ repositoryRoot, snapshotRoot: join(root, 'skills') }, '6.0.0');
  const contexts = new DirectorContextService(service, saved.environment);
  contexts.bootstrapLock(project.id, saved.lock);
  f.tools = new ToolInvocationService(service);
  f.completeTurns = () => {
    for (const turn of store.list('director_turn', project.id).filter(turn => turn.state === 'running'))
      store.put('director_turn', turn.id, project.id, { ...turn, state: 'completed' });
  };
  f.openTurn = () => {
    f.completeTurns();
    const human = service.beginRequest(project.id, 'local-user', 'Make the requested keyframes from the accepted new script.', { scopeIds: [project.id] });
    const bridge = service.openEpoch(project.id, human), turnId = randomUUID();
    store.insert('director_turn', turnId, project.id, { id: turnId, projectId: project.id, requestId: human.requestId,
      epochId: bridge.actor.epochId, state: 'running', runtimeId: 'offline-cross-scene-grants', createdAt: new Date().toISOString() });
    contexts.capture(project.id, bridge.actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
    return { human, bridge, turnId };
  };

  // Use the same held-proposal and authenticated human acceptance paths as a script rewrite.
  const writing = f.openTurn();
  const proposal = await f.tools.invoke(project.id, writing.bridge.actor, 'new-script', 'propose_change', {
    patch: { updateShots: shotIds.map(id => ({ id, action: `The new script changes ${id}.`,
      imagePrompt: `New-script keyframe for ${id}`, videoPrompt: `New-script movement for ${id}` })) },
  });
  f.completeTurns();
  const accepted = f.ok(await f.call('POST', `/director/proposals/${proposal.proposalId}/accept`, { previewDigest: proposal.previewDigest }));
  assert.equal(accepted.proposal.state, 'accepted');
  assert.ok(store.getProject(project.id).shots.every(shot => shot.imagePrompt === `New-script keyframe for ${shot.id}`));
  assert.equal(provider.acceptedCount(), 6, 'accepting the new script buys no media');

  if (pending === 'failed') {
    // Exhaust each candidate's bounded technical retry through the fake provider.
    // These nonnull, empty-output failed candidates match the diagnostic snapshot.
    for (const binding of f.bindings()) provider.setMode(binding.id, ['technical_failure', 'technical_failure']);
    for (const sceneId of sceneIds) { await f.press(sceneId); await f.finish(); }
    assert.ok(f.bindings().every(binding => binding.candidateId && !Object.keys(binding.outputs).length));
    assert.ok(engine.attempts(project.id).slice(6).every(attempt => attempt.phase === 'failed'));
    assert.equal(engine.attempts(project.id).length, 18);
  } else {
    // A direct Plan edit detaches each previous frame while keeping its old recipe.
    // The compiler preserves siblings' old recipes until their own generation press.
    for (const id of shotIds) f.ok(await f.call('POST', '/storyboard', {
      expectedHeadVersion: store.getProject(project.id).headVersion, kind: 'shotFields', id,
      fields: { action: `Final new-script action for ${id}`, imagePrompt: `Final new-script frame for ${id}`, videoPrompt: `Final new-script motion for ${id}` },
    }));
    assert.ok(f.bindings().every(binding => binding.candidateId === null && !Object.keys(binding.outputs).length && binding.outdated));
  }
  for (const sceneId of sceneIds) assert.ok((await f.view(sceneId)).rows.every(row => !row.imageComplete));
  f.generate = async (mode, input) => {
    if (mode === 'human') return f.press(input.sceneIds[0], input.shotIds);
    const callId = randomUUID(), actor = f.turn.bridge.actor;
    const replay = () => f.tools.invoke(project.id, actor, callId, 'make_keyframes', input);
    const result = await replay();
    assert.deepEqual(result.refused, [], JSON.stringify(result.refused));
    assert.deepEqual(result.started.flatMap(scene => scene.shotIds).sort(), (input.shotIds ?? input.sceneIds.flatMap(shotsFor)).sort());
    return { result, replay };
  };
  return f;
}

function bindingWork(binding) {
  return { id: binding.id, node: binding.node, candidateId: binding.candidateId, outputs: binding.outputs,
    outdated: binding.outdated, retainedTake: binding.retainedTake };
}
function assertNewPaidWork(f, before, selected, authorityId) {
  const after = f.paid();
  const grants = after.grants.filter(grant => !before.grants.some(old => old.id === grant.id));
  const candidates = after.candidates.filter(candidate => !before.candidates.some(old => old.id === candidate.id));
  assert.equal(grants.length, selected.length);
  assert.deepEqual(grants.map(grant => grant.scopeId).sort(), [...selected].sort());
  assert.ok(grants.every(grant => grant.kind === 'image' && grant.origin === 'user_change' && grant.authorityId === authorityId));
  assert.equal(candidates.length, selected.length);
  assert.deepEqual(candidates.map(candidate => f.store.get('grant', candidate.grantId).scopeId).sort(), [...selected].sort());
  assert.ok(candidates.every(candidate => grants.some(grant => grant.id === candidate.grantId)));
  const attempts = after.attempts.filter(attempt => !before.attempts.some(old => old.id === attempt.id));
  assert.equal(attempts.length, selected.length);
  assert.deepEqual(attempts.map(attempt => f.store.get('node_binding', attempt.nodeId).node.shotId).sort(), [...selected].sort());
  assert.ok(attempts.every(attempt => attempt.phase === 'succeeded' && attempt.request.kind === 'image'));
  assert.equal(after.accepted, before.accepted + selected.length);
}

for (const pending of ['failed', 'detached']) for (const mode of ['director', 'human']) {
  test(`${mode}: a new script with ${pending} sibling keyframes generates each scene with only its exact grants`, async t => {
    const f = await fixture(t, pending);
    if (mode === 'director') f.turn = f.openTurn();
    const original = new Map(f.bindings().map(binding => [binding.node.shotId, bindingWork(binding)]));
    const done = new Set();
    for (const sceneId of sceneIds) {
      const selected = shotsFor(sceneId), before = f.paid();
      const command = await f.generate(mode, { sceneIds: [sceneId] });
      const published = f.paid();
      assert.deepEqual(await command.replay(), command.result);
      assert.deepEqual(f.paid(), published, 'exact command replay creates no additional work');
      await f.finish();
      assertNewPaidWork(f, before, selected, mode === 'director' ? f.turn.human.requestId : command.result.requestId);
      selected.forEach(id => done.add(id));
      for (const binding of f.bindings().filter(binding => !done.has(binding.node.shotId)))
        assert.deepEqual(bindingWork(binding), original.get(binding.node.shotId), `unselected ${binding.node.shotId} stays pending`);
      for (const other of sceneIds.filter(id => !shotsFor(id).every(shotId => done.has(shotId))))
        assert.ok((await f.view(other)).rows.every(row => !row.imageComplete));
      const finished = f.paid();
      assert.deepEqual(await command.replay(), command.result);
      await f.finish(); assert.deepEqual(f.paid(), finished, 'settled replay cannot buy another take');
    }
    for (const sceneId of sceneIds) assert.ok((await f.view(sceneId)).rows.every(row => row.imageComplete));
    assert.ok(f.engine.attempts(f.project.id).every(attempt => attempt.request.kind === 'image'));
  });

  test(`${mode}: a selected shot leaves ${pending} same-scene and cross-scene siblings untouched`, async t => {
    const f = await fixture(t, pending);
    if (mode === 'director') f.turn = f.openTurn();
    const before = f.paid(), bindings = new Map(f.bindings().map(binding => [binding.node.shotId, bindingWork(binding)]));
    const input = mode === 'director' ? { shotIds: ['shot-0'] } : { sceneIds: ['scene-0'], shotIds: ['shot-0'] };
    const command = await f.generate(mode, input);
    assert.deepEqual(await command.replay(), command.result);
    await f.finish();
    assertNewPaidWork(f, before, ['shot-0'], mode === 'director' ? f.turn.human.requestId : command.result.requestId);
    for (const binding of f.bindings().filter(binding => binding.node.shotId !== 'shot-0'))
      assert.deepEqual(bindingWork(binding), bindings.get(binding.node.shotId));
    const view = await f.view('scene-0');
    assert.equal(view.rows.find(row => row.shotId === 'shot-0').imageComplete, true);
    assert.equal(view.rows.find(row => row.shotId === 'shot-1').imageComplete, false);
  });
}

for (const pending of ['failed', 'detached']) test(`Director: one whole-film call starts all three scenes with ${pending} old candidates exactly once`, async t => {
  const f = await fixture(t, pending); f.turn = f.openTurn();
  const before = f.paid(), command = await f.generate('director', { sceneIds });
  assert.deepEqual(command.result.started.map(scene => scene.sceneId), sceneIds);
  assert.deepEqual(await command.replay(), command.result);
  await f.finish(); assertNewPaidWork(f, before, shotIds, f.turn.human.requestId);
  const finished = f.paid();
  assert.deepEqual(await command.replay(), command.result);
  await f.finish(); assert.deepEqual(f.paid(), finished);
});

test('Director: the snapshot whole-film explicit regeneration call buys only one fresh take per requested shot', async t => {
  const f = await fixture(t, 'failed'); f.turn = f.openTurn();
  const before = f.paid();
  const command = await f.generate('director', { shotIds: [...shotIds], regenerate: true });
  assert.deepEqual(command.result.started.map(scene => scene.sceneId), sceneIds);
  assert.deepEqual(await command.replay(), command.result);
  await f.finish(); assertNewPaidWork(f, before, shotIds, f.turn.human.requestId);
  const oldAttemptIds = new Set(before.attempts.map(attempt => attempt.id));
  assert.deepEqual(f.engine.attempts(f.project.id).filter(attempt => oldAttemptIds.has(attempt.id)), before.attempts,
    'new scene decisions retain the earlier failed receipts');
  const finished = f.paid();
  assert.deepEqual(await command.replay(), command.result);
  await f.finish(); assert.deepEqual(f.paid(), finished);
});

test('human: a stale scene review after a script edit creates no grants, candidates or attempts', async t => {
  const f = await fixture(t, 'detached'), body = await f.body('scene-0');
  f.ok(await f.call('POST', '/storyboard', { expectedHeadVersion: body.headVersion, kind: 'shot', id: 'shot-0', field: 'imagePrompt', value: 'A later human frame direction' }));
  const before = f.paid(), response = await f.call('POST', '/scenes/scene-0/generate', body);
  assert.notEqual(response.statusCode, 200);
  assert.equal(response.json().error.code, 'SCENE_REVIEW_STALE');
  assert.deepEqual(f.paid(), before);
});

test('Director: a later human request fences keyframe generation without granting sibling work', async t => {
  const f = await fixture(t, 'failed'); f.turn = f.openTurn();
  f.service.beginRequest(f.project.id, 'local-user', 'Use a later script instead.', { scopeIds: [f.project.id] });
  const before = f.paid();
  await assert.rejects(f.tools.invoke(f.project.id, f.turn.bridge.actor, 'stale-new-script', 'make_keyframes', { sceneIds }),
    { code: 'EPOCH_REVOKED' });
  assert.deepEqual(f.paid(), before);
});

test('trusted scene publication refuses missing, widened, wrong-kind and foreign-scope operation lists without paid work', async t => {
  const f = await fixture(t, 'failed'), project = f.store.getProject(f.project.id);
  const plan = f.store.get('plan', project.activePlanId).compiled;
  const nodes = f.bindings(), first = nodes.find(binding => binding.node.shotId === 'shot-0').id;
  const other = nodes.find(binding => binding.node.shotId === 'shot-2').id;
  const actor = f.service.beginRequest(project.id, 'local-user', 'Generate only scene zero.',
    { concurrency: 'alongside', holdScopeIds: [], scopeIds: ['scene-0'] });
  const wholeFilm = f.service.beginRequest(project.id, 'local-user', 'Review film-wide work.',
    { concurrency: 'alongside', holdScopeIds: [], scopeIds: [project.id] });
  const before = f.paid(), records = f.store.list('prepared', project.id), plans = f.store.list('plan', project.id), head = f.store.getProject(project.id);
  const publish = (ids, kind = 'image', human = actor) => f.service.applyCompiledSceneGeneration(project.id, human, plan, {},
    project.headVersion, digest(f.store.get('capability_lock', project.capabilityLockId)), kind, ids);
  for (const ids of [undefined, null, {}, first, [], [first, first], ['unknown-operation'], [first, other], [other]])
    assert.throws(() => publish(ids), { code: 'SCOPE_DENIED' });
  assert.throws(() => publish([first, other], 'image', wholeFilm), { code: 'SCOPE_DENIED' });
  assert.throws(() => publish([first], 'video'), { code: 'SCOPE_DENIED' });
  assert.throws(() => publish([first]), { code: 'ORIGIN_NOT_AUTHORIZED' }, 'a valid selected operation still requires its own unused grant');
  assert.deepEqual(f.paid(), before);
  assert.deepEqual(f.store.list('prepared', project.id), records);
  assert.deepEqual(f.store.list('plan', project.id), plans);
  assert.deepEqual(f.store.getProject(project.id), head);
});
