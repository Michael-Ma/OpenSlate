import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { generateScene, sceneView } from '../dist/scene-generation.js';
import { projectFixture, refreshIntent } from './execution-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
async function fixture(t, scopes, pendingOtherScene = false) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-rule-drift-selection-'));
  const store = new Store(join(root, 'state.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') }), production = new ProductionService(store, engine);
  let project = production.createProject('Request authority and selected work');
  const shape = projectFixture(project.id, 4);
  shape.scenes = shape.scenes.slice(0, 2);
  shape.shots = shape.shots.map((shot, index) => {
    const next = { ...shot, sceneId: index < 2 ? 'scene-0' : 'scene-1', narration: { mode: 'none', text: '', voice: 'stock' } };
    refreshIntent(next); return next;
  });
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId }, 0);
  store.put('project_revision', project.revisionId, project.id, { project });
  if (pendingOtherScene) {
    const { view } = sceneView(production, project.id, 'scene-1');
    await generateScene(production, project.id, 'scene-1', { kind: 'image', headVersion: view.headVersion,
      revisionId: view.revisionId, reviewedFrames: [], reviewedHoldDigest: view.reviewedHoldDigest,
      reviewedControlAuthorityId: view.reviewedControlAuthorityId }, 'earlier-scene-one-generation');
    assert.equal(store.list('candidate', project.id).length, 2);
    assert.equal(provider.acceptedCount(), 0);
  }
  const saved = createDirectorSkillLock({ repositoryRoot, snapshotRoot: join(root, 'skills') }, '6.0.0');
  const contexts = new DirectorContextService(production, saved.environment);
  contexts.bootstrapLock(project.id, saved.lock);
  const human = production.beginRequest(project.id, 'local-user', 'Make the selected keyframes while I keep editing the remainder.',
    { scopeIds: scopes ?? [project.id] });
  const bridge = production.openEpoch(project.id, human), turnId = randomUUID();
  store.insert('director_turn', turnId, project.id, { id: turnId, projectId: project.id, requestId: human.requestId,
    epochId: bridge.actor.epochId, state: 'running', runtimeId: 'offline-rule-drift-selection', createdAt: new Date().toISOString() });
  contexts.capture(project.id, bridge.actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  const tools = new ToolInvocationService(production);
  t.after(() => { store.close(); provider.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  return { store, provider, engine, production, project, human,
    invoke: (input, key = randomUUID()) => tools.invoke(project.id, bridge.actor, key, 'make_keyframes', input),
    holds: () => store.list('hold', project.id).filter(hold => hold.active && hold.ownerId === human.requestId).map(hold => hold.scopeId).sort(),
  };
}

for (const selection of [
  { title: 'whole-film request, one scene', scopes: undefined, input: { sceneIds: ['scene-0'] }, remaining: ['scene-1'], selected: ['shot-0', 'shot-1'] },
  { title: 'whole-film request, one shot', scopes: undefined, input: { shotIds: ['shot-0'] }, remaining: ['scene-1', 'shot-1'], selected: ['shot-0'] },
  { title: 'scene request, one shot', scopes: ['scene-0'], input: { shotIds: ['shot-0'] }, remaining: ['shot-1'], selected: ['shot-0'] },
]) test(`${selection.title}: scene publication keeps the original request's unselected edit holds`, async t => {
  const f = await fixture(t, selection.scopes), key = 'selected-keyframes';
  const result = await f.invoke(selection.input, key);
  assert.deepEqual(result.refused, []);
  assert.deepEqual(result.started.flatMap(scene => scene.shotIds), selection.selected);
  assert.deepEqual(f.holds(), selection.remaining, 'publishing selected work must preserve holds on the rest of the same request');
  const holds = f.store.list('hold', f.project.id), candidates = f.store.list('candidate', f.project.id);
  assert.deepEqual(await f.invoke(selection.input, key), result);
  assert.deepEqual(f.store.list('hold', f.project.id), holds, 'replay cannot release or renew unselected holds');
  assert.deepEqual(f.store.list('candidate', f.project.id), candidates, 'replay cannot buy another take');
  for (let pass = 0; pass < 5; pass++) { await f.engine.runReady(); await f.engine.reconcile(); }
  assert.equal(f.provider.acceptedCount(), selection.selected.length, 'remaining holds must still allow the reviewed selection to run');
  assert.deepEqual(f.holds(), selection.remaining);
  assert.deepEqual(f.store.list('grant', f.project.id).map(grant => grant.scopeId).sort(), selection.selected);
  assert.ok(f.store.list('grant', f.project.id).every(grant => grant.authorityId === f.human.requestId));
});

test('whole-film scene decisions consume only their own holds until every selected scene is published', async t => {
  const f = await fixture(t);
  const first = await f.invoke({ sceneIds: ['scene-0'] });
  assert.deepEqual(first.refused, []); assert.deepEqual(f.holds(), ['scene-1']);
  const second = await f.invoke({ sceneIds: ['scene-1'] });
  assert.deepEqual(second.refused, []); assert.deepEqual(f.holds(), []);
  for (let pass = 0; pass < 5; pass++) { await f.engine.runReady(); await f.engine.reconcile(); }
  assert.equal(f.provider.acceptedCount(), 4);
  assert.equal(f.store.list('grant', f.project.id).length, 4);
});

test('a selected scene cannot release an unselected scene\'s already granted candidates for dispatch', async t => {
  const f = await fixture(t, undefined, true);
  const prior = f.store.list('candidate', f.project.id);
  const result = await f.invoke({ sceneIds: ['scene-0'] });
  assert.deepEqual(result.refused, []); assert.deepEqual(f.holds(), ['scene-1']);
  for (let pass = 0; pass < 5; pass++) { await f.engine.runReady(); await f.engine.reconcile(); }
  const attempts = f.engine.attempts(f.project.id);
  assert.equal(f.provider.acceptedCount(), 2);
  assert.deepEqual(attempts.map(attempt => f.store.get('node_binding', attempt.nodeId).node.shotId).sort(), ['shot-0', 'shot-1']);
  assert.ok(prior.every(candidate => !attempts.some(attempt => attempt.candidateId === candidate.id)), 'unselected granted work stays held');
  assert.deepEqual(f.holds(), ['scene-1']);
});
