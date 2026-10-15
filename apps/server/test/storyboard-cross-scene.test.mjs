import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PROFILES } from '@openslate/core';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
import { GenerationOverviewReader } from '../dist/generation-overview.js';

function fixture(t) {
  const f = setup(t, { count: 3 }), service = new ProductionService(f.store, f.engine);
  const project = f.store.getProject(f.projectId);
  f.store.insert('capability_lock', project.capabilityLockId, project.id, { profiles: DEFAULT_PROFILES });
  const app = createApp({ service, localToken: 'cross-scene-test-token' });
  t.after(() => app.close());
  const head = () => f.store.getProject(f.projectId);
  const command = (body, key = randomUUID()) => app.inject({
    method: 'POST', url: `/api/projects/${f.projectId}/storyboard`,
    headers: { host: '127.0.0.1', authorization: 'Bearer cross-scene-test-token', 'idempotency-key': key },
    payload: { expectedHeadVersion: head().headVersion, ...body },
  });
  return { ...f, service, app, head, command };
}

test('cross-scene move keeps paid frames and clips, invalidates assembly only, and updates scene membership', async t => {
  const f = fixture(t);
  for (let round = 0; round < 2; round++) { await f.engine.runReady(); await f.engine.reconcile(); }
  const review = f.engine.reviewSnapshot(f.projectId);
  f.engine.approve(f.projectId, review.id, review.members.map(row => row.videoNodeId), 'cross-scene-review');
  for (let round = 0; round < 2; round++) { await f.engine.runReady(); await f.engine.reconcile(); }
  const before = f.head(), bindings = f.store.list('node_binding', f.projectId), outputs = f.engine.outputs(f.projectId);
  const attempts = f.engine.attempts(f.projectId), grants = f.store.list('grant', f.projectId);
  assert.equal(outputs.length, 6);
  // Local assembly bindings are separate from the paid per-shot operations.
  const video = bindings.find(row => row.node.kind === 'video');
  for (const kind of ['timeline', 'render']) {
    const id = `cross-scene-${kind}`;
    f.store.insert('node_binding', id, f.projectId, { ...video, id,
      node: { ...video.node, id, kind, shotId: null, inputs: [], requires: [] } });
  }
  const response = await f.command({ kind: 'moveShot', id: 'shot-0', sceneId: 'scene-1' });
  assert.equal(response.statusCode, 200, response.body);
  const after = f.head();
  assert.deepEqual(after.shots.map(row => row.id), ['shot-1', 'shot-0', 'shot-2']);
  assert.deepEqual(after.shots.find(row => row.id === 'shot-0'), { ...before.shots[0], sceneId: 'scene-1' });
  assert.deepEqual(after.scenes, before.scenes);
  assert.deepEqual(after.cues, before.cues);
  for (const binding of bindings) assert.deepEqual(f.store.get('node_binding', binding.id), binding);
  assert.deepEqual(f.engine.outputs(f.projectId), outputs);
  for (const kind of ['timeline', 'render']) {
    const binding = f.store.get('node_binding', `cross-scene-${kind}`);
    assert.equal(binding.candidateId, null);
    assert.deepEqual(binding.outputs, {});
    assert.deepEqual(binding.outdated.fields, ['moveShot']);
  }
  assert.deepEqual(f.engine.attempts(f.projectId), attempts);
  assert.deepEqual(f.store.list('grant', f.projectId), grants);
  assert.ok(!f.store.list('hold', f.projectId).some(row => row.active));
  const overview = new GenerationOverviewReader(f.service).read(f.projectId);
  assert.deepEqual(overview.scenes.map(row => row.shotIds), [[], ['shot-1', 'shot-0'], ['shot-2']]);
  assert.equal(overview.shots['shot-0'].label, '2.2');
  for (const shot of Object.values(overview.shots)) {
    assert.equal(shot.keyframe.state, 'ready');
    assert.equal(shot.video.state, 'ready');
  }
});

test('cross-scene HTTP move is keyed, version fenced, and refuses foreign destination or reorder targets atomically', async t => {
  const f = fixture(t), expectedHeadVersion = f.head().headVersion;
  const body = { kind: 'moveShot', id: 'shot-0', sceneId: 'scene-1', beforeId: 'shot-1', expectedHeadVersion };
  const key = randomUUID(), first = await f.command(body, key), cursor = f.store.cursor(f.projectId);
  assert.equal(first.statusCode, 200, first.body);
  const replay = await f.command(body, key);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), first.json());
  assert.equal(f.store.cursor(f.projectId), cursor);
  assert.equal((await f.command(body)).json().error.code, 'REVISION_CONFLICT');
  for (const [input, code] of [
    [{ sceneId: 'foreign' }, 'NOT_FOUND'],
    [{ beforeId: 'shot-2' }, 'VALIDATION_ERROR'],
    [{ beforeId: 'shot-0' }, 'VALIDATION_ERROR'],
  ]) {
    const response = await f.command({ ...body, expectedHeadVersion: f.head().headVersion, ...input });
    assert.equal(response.json().error.code, code, response.body);
    assert.equal(f.store.cursor(f.projectId), cursor);
  }
  const conflict = await f.command({ ...body, beforeId: undefined }, key);
  assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(f.store.cursor(f.projectId), cursor);
});

test('a shot can move to an empty scene and one Undo restores its original scene without new paid work', async t => {
  const f = fixture(t);
  const added = await f.command({ kind: 'addScene', value: 'Empty destination' });
  assert.equal(added.statusCode, 200, added.body);
  const before = f.head(), sceneId = before.scenes.at(-1).id;
  const moved = await f.command({ kind: 'moveShot', id: 'shot-0', sceneId });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.deepEqual(f.head().shots.find(row => row.id === 'shot-0'), { ...before.shots[0], sceneId });
  const undone = await f.command({ kind: 'undo', commandId: moved.json().commandId });
  assert.equal(undone.statusCode, 200, undone.body);
  assert.deepEqual(f.head().shots, before.shots);
  assert.deepEqual(f.head().scenes, before.scenes);
  assert.equal(f.engine.attempts(f.projectId).length, 0);
});
