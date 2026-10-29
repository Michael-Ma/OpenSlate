import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { newId } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { DirectorToolSettings } from '../dist/application/director-tools-upgrade.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { createDirectorInput } from '../dist/application/director-input.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
function writable(path) { chmodSync(path, 0o700); for (const row of readdirSync(path, { withFileTypes: true })) if (row.isDirectory()) writable(join(path, row.name)); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-guidance-source-failure-')), store = new Store(join(root, 'app.sqlite'));
  const provider = new FakeProvider(join(root, 'fake.sqlite')), service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  const project = service.createProject('Saved shipped guidance'), snapshotRoot = join(root, 'snapshots'), checkout = join(root, 'checkout');
  const configuration = { repositoryRoot, snapshotRoot, runtimeId: 'codex-app-server' }, saved = createDirectorSkillLock(configuration, '4.0.0');
  new DirectorContextService(service, saved.environment).bootstrapLock(project.id, saved.lock);
  // The V7 checkout failures; release v8 source failures are covered in director-guidance-release.
  const settings = new DirectorToolSettings(service, () => ({ ...configuration, repositoryRoot: checkout }), () => false, []);
  const director = new LocalDirectorController(service, { repositoryRoot, dataDirectory: root, endpoint: 'http://127.0.0.1:3101', defaults: { binaryPath: process.execPath, model: 'offline-fixture' } });
  t.after(async () => { await director.close(); provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  const fresh = () => {
    for (const turn of store.list('director_turn', project.id)) if (turn.state === 'running') store.put('director_turn', turn.id, project.id, { ...turn, state: 'interrupted' });
    const human = service.beginRequest(project.id, 'local-user', 'Continue the saved film'), bridge = service.openEpoch(project.id, human);
    const turn = { id: newId(), projectId: project.id, requestId: human.requestId, epochId: bridge.actor.epochId, runtimeId: 'codex-app-server', state: 'running', dispatched: false,
      nativeThreadId: null, nativeTurnId: null, owner: null, leaseExpiresAt: 0, errorCode: null, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' };
    store.insert('director_turn', turn.id, project.id, turn); return { bridge, turn };
  };
  return { root, store, provider, service, project, snapshotRoot, checkout, saved, settings, director, fresh };
}

for (const variant of ['missing', 'malformed', 'unpinned']) test(`a shipped predecessor survives ${variant} current guidance files without installing an invalid successor`, t => {
  const f = fixture(t), current = f.fresh(), before = f.store.getProject(f.project.id), snapshots = readdirSync(f.snapshotRoot).sort();
  mkdirSync(f.checkout);
  if (variant !== 'missing') {
    cpSync(join(repositoryRoot, 'skills', 'v7'), join(f.checkout, 'skills', 'v7'), { recursive: true });
    if (variant === 'malformed') writeFileSync(join(f.checkout, 'skills', 'v7', 'production', 'openslate.skill.json'), '{invalid');
    else appendFileSync(join(f.checkout, 'skills', 'v7', 'production', 'SKILL.md'), '\nTemporary checkout edit for the refusal regression.\n');
  }
  assert.throws(() => f.settings.currentForFreshTurn(f.project.id, current.bridge.actor, current.turn.id), error => {
    assert.equal(error.code, 'DIRECTOR_GUIDANCE_FILES_UNAVAILABLE'); assert.match(error.message, /Restore the matching application files/);
    assert.doesNotMatch(error.message, /film's Director guidance does not match/); return true;
  });
  assert.deepEqual(f.store.list('director_skill_lock', f.project.id).map(row => row.lock), [f.saved.lock]);
  assert.deepEqual(readdirSync(f.snapshotRoot).sort(), snapshots, 'refused package bytes never enter native discovery as orphan snapshots');
  assert.deepEqual(f.store.getProject(f.project.id), before); assert.equal(f.store.list('director_epoch_lock', f.project.id).length, 0);
  assert.equal(f.store.readEvents(f.project.id, 0).filter(event => event.kind === 'director.lock_installed' && event.payload?.source === 'application_compatible_upgrade').length, 0);
  f.store.put('director_turn', current.turn.id, f.project.id, { ...current.turn, state: 'failed', errorCode: 'DIRECTOR_GUIDANCE_FILES_UNAVAILABLE' });
  assert.match(f.director.status(f.project.id).message, /current Director guidance files are missing or changed/);
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.store.list('native_model_start', f.project.id).length, 0);
  rmSync(f.checkout, { recursive: true }); cpSync(join(repositoryRoot, 'skills', 'v7'), join(f.checkout, 'skills', 'v7'), { recursive: true });
  const next = f.fresh(), successor = f.settings.currentForFreshTurn(f.project.id, next.bridge.actor, next.turn.id);
  assert.equal(successor.compatibility.toolContract, '6.0.0'); assert.ok(successor.skills.every(skill => skill.version === '7.0.0'));
  assert.deepEqual(readdirSync(f.snapshotRoot).sort(), [...snapshots, ...successor.skills.map(skill => skill.packageDigest)].sort());
});

test('fresh films cannot bootstrap unshipped current guidance', t => {
  const f = fixture(t), project = f.service.createProject('No saved Director lock'), human = f.service.beginRequest(project.id, 'local-user', 'Write the film'), bridge = f.service.openEpoch(project.id, human);
  const snapshots = readdirSync(f.snapshotRoot).sort(), prepare = createDirectorInput(f.service, { repositoryRoot: f.checkout, snapshotRoot: f.snapshotRoot, runtimeId: 'codex-app-server', endpoint: 'http://127.0.0.1:3101' });
  assert.throws(() => prepare({ id: newId(), projectId: project.id, requestId: human.requestId }, human, bridge), { code: 'DIRECTOR_GUIDANCE_FILES_UNAVAILABLE' });
  assert.equal(f.store.list('director_skill_lock', project.id).length, 0); assert.equal(f.store.list('director_epoch_lock', project.id).length, 0);
  assert.deepEqual(readdirSync(f.snapshotRoot).sort(), snapshots); assert.equal(f.provider.acceptedCount(), 0);
});

test('an explicit current tools upgrade validates shipped package pins before installation', t => {
  const f = fixture(t), snapshots = readdirSync(f.snapshotRoot).sort();
  assert.throws(() => f.settings.upgrade(f.project.id, { expectedLockId: f.saved.lock.id, expectedLockDigest: f.saved.lock.lockDigest, targetVersion: '6.0.0' }, 'current-upgrade'), { code: 'DIRECTOR_GUIDANCE_FILES_UNAVAILABLE' });
  assert.deepEqual(f.store.list('director_skill_lock', f.project.id).map(row => row.lock), [f.saved.lock]);
  assert.deepEqual(readdirSync(f.snapshotRoot).sort(), snapshots); assert.equal(f.provider.acceptedCount(), 0);
});

test('a Director mode change cannot install unshipped current guidance in the replacement snapshot root', async t => {
  const f = fixture(t), current = createDirectorSkillLock({ repositoryRoot, snapshotRoot: f.snapshotRoot, runtimeId: 'fake-workflow-v1' }, '6.0.0').lock;
  f.store.insert('director_skill_lock', current.id, f.project.id, { id: current.id, projectId: f.project.id, lock: current });
  let starts = 0;
  const director = new LocalDirectorController(f.service, { repositoryRoot: f.checkout, dataDirectory: f.root, endpoint: 'http://127.0.0.1:3101',
    defaults: { binaryPath: process.execPath, model: 'offline-fixture' }, setup: async () => ({ readiness: { status: 'ready' }, runtimeOptions: {} }),
    makeRuntime: () => ({ id: 'codex-app-server', start: async () => { starts++; throw Error('No native turn was requested'); } }) });
  t.after(() => director.close());
  await assert.rejects(director.changeSelection(f.project.id, { expectedSelectionDigest: director.settings(f.project.id).selectionDigest, selection: { mode: 'native', binaryPath: process.execPath, model: 'offline-fixture' } }, 'native-choice'), { code: 'DIRECTOR_GUIDANCE_FILES_UNAVAILABLE' });
  assert.equal(director.mode(f.project.id), 'fake'); assert.equal(f.store.list('director_skill_lock', f.project.id).at(-1).id, current.id);
  assert.deepEqual(readdirSync(join(f.root, 'native', f.project.id, 'workspace', '.agents', 'skills')), []);
  assert.equal(starts, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test('a corrupt saved predecessor snapshot still asks for its snapshot rather than application files', t => {
  const f = fixture(t), current = f.fresh(), entry = join(f.snapshotRoot, f.saved.lock.skills[0].packageDigest, 'SKILL.md');
  chmodSync(entry, 0o600); writeFileSync(entry, 'Corrupt saved snapshot');
  assert.throws(() => f.settings.currentForFreshTurn(f.project.id, current.bridge.actor, current.turn.id), error => {
    assert.equal(error.code, 'SKILL_SNAPSHOT_INVALID'); assert.match(error.message, /Restore the matching saved snapshot/); return true;
  });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1); assert.equal(f.provider.acceptedCount(), 0);
});
