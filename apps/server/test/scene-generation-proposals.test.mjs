import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shotIntentDigest } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
import { projectFixture } from './execution-fixture.mjs';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { proposeChange, proposalCommand } from '../dist/application/director-proposals.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'openslate-b1-prompts-'));
  const store = new Store(join(directory, 'store.sqlite'));
  const provider = new FakeProvider(join(directory, 'provider.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(directory, 'artifacts') });
  const service = new ProductionService(store, engine);
  let project = service.createProject('Accepted location proposals');
  const shape = projectFixture(project.id, 3);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId,
    shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.put('project_revision', project.revisionId, project.id, { project });
  const configuration = { repositoryRoot: fileURLToPath(new URL('../../../', import.meta.url)), snapshotRoot: join(directory, 'skills') };
  const saved = createDirectorSkillLock(configuration, '6.0.0');
  new DirectorContextService(service, saved.environment).bootstrapLock(project.id, saved.lock);
  const token = randomBytes(32).toString('base64url');
  const app = createApp({ service, localToken: token, logger: false });
  t.after(async () => { await app.close(); store.close(); provider.close(); const writable = path => { chmodSync(path, 0o700); for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name)); }; writable(directory); rmSync(directory, { recursive: true, force: true }); });
  const request = async (method, path, payload, key = randomUUID()) => app.inject({ method,
    url: `/api/projects/${project.id}${path}`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': key },
    ...(payload ? { payload } : {}) });
  const generate = async (sceneId, key = randomUUID()) => {
    const view = (await request('GET', `/scenes/${sceneId}/generation`)).json();
    return request('POST', `/scenes/${sceneId}/generate`, { kind: 'image', headVersion: view.headVersion,
      revisionId: view.revisionId, reviewedFrames: [], reviewedHoldDigest: view.reviewedHoldDigest,
      reviewedControlAuthorityId: view.reviewedControlAuthorityId }, key);
  };
  const finish = async () => { for (let count = 0; count < 4; count++) { await engine.runReady(); await engine.reconcile(); } };
  const accept = (shotId, direction = false) => {
    const human = service.beginRequest(project.id, 'local-user', 'Suggest a location change', { scopeIds: [shotId], editing: false });
    const { actor } = service.openEpoch(project.id, human);
    new DirectorContextService(service, saved.environment).capture(project.id, actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
    const turnId = randomUUID();
    store.insert('director_turn', turnId, project.id, { id: turnId, projectId: project.id,
      requestId: actor.requestId, epochId: actor.epochId, state: 'completed' });
    const proposal = proposeChange(service, project.id, actor, randomUUID(), { patch: { updateShots: [{ id: shotId,
      imagePrompt: `Accepted location for ${shotId}`, videoPrompt: `Accepted movement for ${shotId}`,
      ...(direction ? { purpose: `New purpose for ${shotId}`, action: 'Cross the new location', motion: 'Track left' } : {}) }] } });
    const receipt = proposalCommand(service, project.id, proposal.proposalId, 'accept', randomUUID(), proposal.previewDigest);
    assert.equal(receipt.proposal.state, 'accepted');
    return receipt;
  };
  return { store, engine, service, provider, project, generate, finish, accept };
}

for (const direction of [false, true]) test(`accepted ${direction ? 'direction and prompt' : 'prompt-only'} proposals in multiple scenes permit scoped generation in any order`, async t => {
  const f = fixture(t);
  for (const scene of f.project.scenes) {
    const initial = await f.generate(scene.id); assert.equal(initial.statusCode, 200, initial.body); await f.finish();
  }
  const spent = f.provider.acceptedCount(), candidates = f.store.list('candidate', f.project.id).length;
  for (const shot of f.project.shots) f.accept(shot.id, direction);
  assert.equal(f.provider.acceptedCount(), spent, 'acceptance buys no media');
  assert.equal(f.store.list('candidate', f.project.id).length, candidates, 'acceptance grants no generation');
  const accepted = f.store.getProject(f.project.id);
  for (const shot of accepted.shots) {
    assert.equal(shot.promptIntent.image, shotIntentDigest(shot, 'image'));
    assert.equal(shot.promptIntent.video, shotIntentDigest(shot, 'video'));
  }
  for (const index of [1, 2, 0]) {
    const shot = accepted.shots[index], before = f.store.list('node_binding', f.project.id);
    const unaffected = before.filter(binding => binding.node.shotId !== shot.id);
    const key = randomUUID(), result = await f.generate(shot.sceneId, key);
    assert.equal(result.statusCode, 200, result.body);
    const after = f.store.list('node_binding', f.project.id);
    for (const old of unaffected) {
      const current = after.find(binding => binding.id === old.id);
      assert.deepEqual({ ...current, planId: old.planId }, old, 'unselected media and candidates stay exact');
    }
    assert.deepEqual(f.store.getProject(f.project.id).shots, accepted.shots, 'compilation never restores historical creative state');
    await f.finish();
    const attempts = f.engine.attempts(f.project.id).filter(attempt => attempt.nodeId === after.find(binding => binding.node.shotId === shot.id).id);
    assert.equal(attempts.at(-1).request.args.prompt, shot.imagePrompt);
    assert.equal(f.provider.acceptedCount(), spent + [1, 2, 0].indexOf(index) + 1);
  }
});
