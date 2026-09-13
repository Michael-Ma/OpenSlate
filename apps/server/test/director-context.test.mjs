import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkillCatalog, createSkillLock, SKILL_TOOL_IDS } from '@openslate/director';
import { FakeProvider } from '@openslate/providers';
import { digest } from '@openslate/core';
import { ProductionService } from '../dist/application/service.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
function writable(path) { chmodSync(path, 0o755); for (const item of readdirSync(path, { withFileTypes: true })) if (item.isDirectory()) writable(join(path, item.name)); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-director-context-'));
  const environment = { snapshotRoot: join(root, 'skills'), compatibility: { toolContract: '1.0.0', planLanguage: '1.0.0', workflowContract: '1.0.0' }, availableToolIds: [...SKILL_TOOL_IDS] };
  const catalog = loadSkillCatalog({ ...environment, packageRoots: [join(repo, 'skills/production'), join(repo, 'skills/plan-authoring')] });
  const lock = createSkillLock(catalog, { selectedSkillIds: ['production', 'plan-authoring'], bindings: [], prompts: [{ id: 'production/intake@1', skillId: 'production', path: 'references/stages/intake.md' }] });
  const provider = new FakeProvider(join(root, 'fake.sqlite')); let store, service, contexts;
  const reopen = () => { if (store?.db.open) store.close(); store = new Store(join(root, 'project.sqlite')); service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') })); contexts = new DirectorContextService(service, environment); return { store, service, contexts }; };
  reopen(); const project = service.createProject('Context fixture'); const human = service.beginRequest(project.id, 'human', 'Make a boots ad');
  contexts.installLock(project.id, human, lock); const bridge = service.openEpoch(project.id, human);
  t.after(() => { store.close(); provider.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  return { root, environment, lock, store, service, contexts, project, human, bridge, reopen };
}

test('context and selected pinned skills persist while a new request gets fresh state after restart', t => {
  const f = fixture(t);
  const first = f.contexts.capture(f.project.id, f.bridge.actor, { lockId: f.lock.id, selectedSkillIds: ['production'], stageBindings: [{ stageId: 'intake', scopeId: f.project.id, promptId: 'production/intake@1' }] });
  const read = f.contexts.readSkill(f.project.id, f.bridge.actor, first.activation.activationId, { skillId: 'production', path: 'references/stages/intake.md' });
  assert.equal(read.evidence.sha256, first.activation.stageBindings[0].promptSha256);
  assert.equal(f.store.list('skill_read', f.project.id).length, 1);
  const r = f.reopen();
  const secondHuman = r.service.beginRequest(f.project.id, 'human', 'Use uploaded narration');
  const secondBridge = r.service.openEpoch(f.project.id, secondHuman);
  const second = r.contexts.capture(f.project.id, secondBridge.actor, { lockId: f.lock.id, selectedSkillIds: ['production'] });
  assert.equal(first.activation.skills[0].packageDigest, second.activation.skills[0].packageDigest);
  assert.notEqual(first.activation.contextSnapshotId, second.activation.contextSnapshotId);
  assert.notEqual(first.activation.contextDigest, second.activation.contextDigest);
  assert.equal(second.snapshot.messages[0].text, 'Use uploaded narration');
  assert.deepEqual(r.store.get('director_context', first.activation.contextSnapshotId).snapshot, first.snapshot);
  assert.throws(() => r.contexts.readSkill(f.project.id, f.bridge.actor, first.activation.activationId, { skillId: 'production', path: 'SKILL.md' }), { code: 'EPOCH_REVOKED' });
  assert.throws(() => r.contexts.readSkill(f.project.id, secondBridge.actor, first.activation.activationId, { skillId: 'production', path: 'SKILL.md' }), { code: 'SCOPE_DENIED' });
});

test('lock installation is application-only and activation/context provenance cannot be overwritten', t => {
  const f = fixture(t);
  assert.throws(() => f.contexts.installLock(f.project.id, f.bridge.actor, f.lock), { code: 'ACTOR_DENIED' });
  const captured = f.contexts.capture(f.project.id, f.bridge.actor, { lockId: f.lock.id, selectedSkillIds: [] });
  assert.throws(() => f.contexts.readSkill(f.project.id, f.bridge.actor, captured.activation.activationId, { skillId: 'production', path: 'SKILL.md' }), { code: 'SKILL_NOT_ACTIVATED' });
  const row = f.store.get('director_context', captured.activation.contextSnapshotId);
  assert.throws(() => f.store.put('director_context', row.id, f.project.id, { ...row, contextDigest: 'changed' }), { code: 'IMMUTABLE_RECORD' });
  const other = f.service.createProject('Other project'); const human = f.service.beginRequest(other.id, 'human', 'Use a different project'); const bridge = f.service.openEpoch(other.id, human);
  assert.throws(() => f.contexts.capture(other.id, bridge.actor, { lockId: f.lock.id, selectedSkillIds: ['production'] }), { code: 'SCOPE_DENIED' });
  assert.equal(f.store.list('director_context', other.id).length, 0);
});

test('captured application capability facts are digest-bound and detached from saved context and skill locks', t => {
  const f = fixture(t), beforeLock = structuredClone(f.store.get('director_skill_lock', f.lock.id));
  const captured = f.contexts.capture(f.project.id, f.bridge.actor, { lockId: f.lock.id, selectedSkillIds: ['production'] });
  const expected = structuredClone(captured.snapshot);
  assert.equal(captured.activation.contextDigest, digest(expected));
  assert.equal(expected.guard.applicationCapabilitiesDigest, digest(expected.applicationCapabilities));
  assert.equal(expected.applicationCapabilities.narration.speechSynthesis.available, false);
  captured.snapshot.applicationCapabilities.narration.speechSynthesis.available = true;
  assert.notEqual(digest(captured.snapshot), captured.activation.contextDigest, 'capability changes invalidate the captured context identity');
  const saved = f.store.get('director_context', captured.activation.contextSnapshotId);
  assert.deepEqual(saved.snapshot, expected);
  assert.equal(saved.contextDigest, digest(expected));
  const r = f.reopen();
  assert.deepEqual(r.store.get('director_context', captured.activation.contextSnapshotId), saved);
  assert.deepEqual(r.store.get('director_skill_lock', f.lock.id), beforeLock);
  assert.equal(r.service.readContext(f.project.id, f.bridge.actor).applicationCapabilities.narration.speechSynthesis.available, false);
});

test('stage prompt claims are checked and an epoch cannot switch skill locks', t => {
  const f = fixture(t), options = { lockId: f.lock.id, selectedSkillIds: ['production'] };
  for (const stage of [
    { stageId: 'invented', scopeId: f.project.id, promptId: 'production/intake@1' },
    { stageId: 'intake', scopeId: f.project.id, promptId: 'production/story@1' },
    { stageId: 'intake', scopeId: f.project.id, promptId: 'production/intake@1', proposalId: 'not-a-proposal' },
  ]) assert.throws(() => f.contexts.capture(f.project.id, f.bridge.actor, { ...options, stageBindings: [stage] }));
  assert.equal(f.store.list('skill_activation', f.project.id).length, 0);
  f.contexts.capture(f.project.id, f.bridge.actor, options);
  const catalog = loadSkillCatalog({ ...f.environment, packageRoots: [join(repo, 'skills/production'), join(repo, 'skills/plan-authoring')] });
  const successor = createSkillLock(catalog, { selectedSkillIds: ['production'], bindings: [], prompts: [] });
  f.contexts.installLock(f.project.id, f.human, successor);
  assert.throws(() => f.contexts.capture(f.project.id, f.bridge.actor, { lockId: successor.id, selectedSkillIds: ['production'] }), { code: 'CAPABILITY_MISMATCH' });
  assert.equal(f.store.list('skill_activation', f.project.id).length, 1);
});
