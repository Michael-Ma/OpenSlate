import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { shotIntentDigest } from '@openslate/core';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { projectFixture } from './execution-fixture.mjs';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { makeDirectorKeyframes } from '../dist/application/director-keyframes.js';
import { sceneConfirmationIdForCandidate, automaticRetriesLeft } from '../dist/execution/retry-eligibility.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
async function fixture(t, { mode = 'director', narration = true, splitScenes = false } = {}) {
  const f = await confirmationFixture(t, { modes: Array(splitScenes ? 2 : 1).fill(narration ? 'generated' : 'none') });
  if (splitScenes) {
    const project = f.store.getProject(f.project.id), shape = projectFixture(project.id, 2);
    project.scenes = shape.scenes;
    project.shots = project.shots.map((shot, index) => {
      const next = { ...shot, sceneId: shape.scenes[index].id };
      next.promptIntent = { image: shotIntentDigest(next, 'image'), video: shotIntentDigest(next, 'video') };
      return next;
    });
    f.project = f.store.saveProject(project, project.headVersion);
    f.store.put('project_revision', f.project.revisionId, f.project.id, { project: f.project });
  }
  if (mode === 'press') { f.start = () => f.make(); return f; }
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'openslate-keyframe-run-identity-'));
  t.after(() => { writable(snapshotRoot); rmSync(snapshotRoot, { recursive: true, force: true }); });
  const saved = createDirectorSkillLock({ repositoryRoot, snapshotRoot }, '6.0.0');
  const contexts = new DirectorContextService(f.production, saved.environment);
  contexts.bootstrapLock(f.project.id, saved.lock);
  f.human = f.production.beginRequest(f.project.id, 'local-user', 'Make the requested scenes\' keyframes and their voice lines.');
  const bridge = f.production.openEpoch(f.project.id, f.human);
  contexts.capture(f.project.id, bridge.actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  f.start = () => makeDirectorKeyframes(f.production, f.project.id, bridge.actor, randomUUID(),
    { sceneIds: f.project.scenes.map(scene => scene.id) }, f.narration, f.runner.enqueueKeyframes);
  return f;
}
function imageBindings(f) { return f.store.list('node_binding', f.project.id).filter(binding => binding.node.kind === 'image'); }

test('same-request Director scenes retain distinct candidate-to-voice-run identities and immutable human authority', async t => {
  const f = await fixture(t, { splitScenes: true }); await f.start();
  const runs = f.store.list('scene_confirmation', f.project.id), bindings = imageBindings(f);
  assert.equal(runs.length, 2); assert.notEqual(runs[0].id, runs[1].id);
  assert.equal(f.store.list('scene_confirmation_candidate', f.project.id).length, 2);
  for (const binding of bindings) {
    const candidate = f.store.get('candidate', binding.candidateId), grant = f.store.get('grant', candidate.grantId);
    const run = runs.find(row => row.sceneId === f.project.shots.find(shot => shot.id === binding.node.shotId).sceneId);
    assert.equal(grant.authorityId, f.human.requestId);
    assert.equal(run.actor.requestId, f.human.requestId);
    assert.equal(sceneConfirmationIdForCandidate(f.store, f.project.id, candidate.id), run.id);
  }
  const first = f.store.get('scene_confirmation_candidate', bindings[0].candidateId);
  assert.throws(() => f.store.put('scene_confirmation_candidate', first.id, f.project.id,
    { ...first, confirmationId: runs.find(run => run.id !== first.confirmationId).id }), { code: 'IMMUTABLE_RECORD' });
  assert.throws(() => f.store.put('scene_confirmation_candidate', first.id, f.project.id,
    { ...first, candidateId: bindings[1].candidateId }), { code: 'IDENTITY_MISMATCH' });
  const other = f.production.createProject('Foreign scene-run mapping');
  assert.throws(() => f.store.insert('scene_confirmation_candidate', first.id, other.id, first), { code: 'SCOPE_DENIED' });
});

for (const mode of ['press', 'director']) test(`${mode} keyframe images retain their voice run's mutation fence before admission`, async t => {
  const f = await fixture(t, { mode }); await f.start();
  const binding = imageBindings(f)[0], project = f.store.getProject(f.project.id);
  // Narration is outside the image prompt, but belongs to this run's exact reviewed shot.
  project.shots[0].narration.text = 'A different voice line before paid admission.';
  project.headVersion++; project.revisionId = randomUUID();
  f.store.saveProject(project, project.headVersion - 1);
  f.store.put('project_revision', project.revisionId, project.id, { project });
  const result = await f.engine.runReady();
  assert.ok(result.blocked.some(row => row.nodeId === binding.id && row.code === 'SCENE_REVIEW_STALE'));
  assert.equal(f.engine.attempts(project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

for (const mode of ['press', 'director']) test(`${mode} keyframe voice-run images never acquire automatic paid technical retries`, async t => {
  const f = await fixture(t, { mode }); await f.start();
  const binding = imageBindings(f)[0]; f.provider.setMode(binding.id, ['technical_failure', 'complete']);
  await f.engine.runReady(); await f.engine.reconcile();
  const [failed] = f.engine.attempts(f.project.id);
  assert.equal(failed.phase, 'failed'); assert.equal(failed.failure.technical, true); assert.equal(failed.failure.retryAllowed, true);
  assert.equal(automaticRetriesLeft(f.store, failed, 1), 0);
  await f.engine.runReady(); await f.engine.reconcile(); await f.engine.runReady();
  assert.equal(f.engine.attempts(f.project.id).length, 1); assert.equal(f.provider.acceptedCount(), 1);
});

test('a Director scene without a voice runner preserves ordinary image retry behavior', async t => {
  const f = await fixture(t, { narration: false }); await f.start();
  const binding = imageBindings(f)[0];
  assert.deepEqual(f.store.list('scene_confirmation', f.project.id), []);
  assert.deepEqual(f.store.list('scene_confirmation_candidate', f.project.id), []);
  assert.equal(sceneConfirmationIdForCandidate(f.store, f.project.id, binding.candidateId), null);
  f.provider.setMode(binding.id, ['technical_failure', 'complete']);
  await f.engine.runReady(); await f.engine.reconcile();
  assert.equal(automaticRetriesLeft(f.store, f.engine.attempts(f.project.id)[0], 1), 1);
  await f.engine.runReady(); await f.engine.reconcile();
  assert.equal(f.engine.attempts(f.project.id).length, 2); assert.equal(f.provider.acceptedCount(), 2);
});
