import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, FILM_KIND_KINDS, newId, toolCatalog } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { loadSkillRelease, skillReleaseBudget } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { createDirectorReleaseLock, releaseDirectory } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { DirectorToolSettings } from '../dist/application/director-tools-upgrade.js';
import { SHIPPED_DIRECTOR_RELEASES, isShippedDirectorRelease, verifyShippedDirectorGuidance } from '../dist/application/director-shipped-guidance.js';
import { projectFixture } from './execution-fixture.mjs';
import { packageDigest } from '../../../packages/director/test/skill-release-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const shipped = join(repositoryRoot, 'skills/v8.1.0');
const row = SHIPPED_DIRECTOR_RELEASES.find(item => item.guidanceVersion === '8.1.0');
const latest = SHIPPED_DIRECTOR_RELEASES.at(-1);
const read = (pkg, path) => readFileSync(join(shipped, pkg, path), 'utf8');
function writable(path) { chmodSync(path, 0o700); for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name)); }

function freshFilm(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-skills-v810-'));
  const store = new Store(join(root, 'state.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  let project = service.createProject('Remake one clip');
  const shape = projectFixture(project.id, 2);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId,
    shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.put('project_revision', project.revisionId, project.id, { project });
  t.after(() => { provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  const configuration = { repositoryRoot, snapshotRoot: join(root, 'skills'), endpoint: 'http://127.0.0.1:3101', runtimeId: 'codex-app-server' };
  const f = { root, store, service, project, configuration };
  f.turn = (text, options = {}) => {
    for (const prior of store.list('director_turn', project.id).filter(turn => turn.state === 'running')) store.put('director_turn', prior.id, project.id, { ...prior, state: 'completed' });
    const human = service.beginRequest(project.id, 'local-user', text, { editing: true });
    const bridge = service.openEpoch(project.id, human);
    const turn = { id: newId(), projectId: project.id, requestId: human.requestId, epochId: bridge.actor.epochId, runtimeId: configuration.runtimeId,
      state: 'running', dispatched: false, nativeThreadId: null, nativeTurnId: null, owner: null, leaseExpiresAt: 0, errorCode: null,
      createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z' };
    store.insert('director_turn', turn.id, project.id, turn);
    const input = createDirectorInput(service, { ...configuration, ...options })(turn, human, bridge);
    return { input, bridge, context: JSON.parse(input.context) };
  };
  return f;
}

test('8.1.0 pins contract 7.1.0 and every generated package; all 8.0.x release identities stay intact', t => {
  assert.equal(row.toolContract, '7.1.0');
  assert.equal(row.handlerDigest, toolCatalog('7.1.0').digest);
  const release = JSON.parse(readFileSync(join(shipped, 'release.json'), 'utf8'));
  assert.equal(row.releaseDigest, digest(release));
  assert.equal(release.release, '8.1.0'); assert.equal(release.toolContract, '7.1.0');
  assert.equal(release.packages.length, 22);
  for (const pin of release.packages) {
    assert.equal(pin.version, '8.1.0', `${pin.id} compatibility changes with the tool contract`);
    assert.equal(pin.packageDigest, packageDigest(join(shipped, pin.id)));
    assert.equal(JSON.parse(read(pin.id, 'openslate.skill.json')).compatibility.toolContract, '7.1.0');
  }
  assert.deepEqual(SHIPPED_DIRECTOR_RELEASES.slice(0, 3).map(item => [item.guidanceVersion, item.toolContract, item.releaseDigest]), [
    ['8.0.0', '7.0.0', 'da01dfb4cb255b5f5de38c097da5c9a9a3c95bc0a0a1809ce0f5126b39dab3b2'],
    ['8.0.1', '7.0.0', '8663b6a96e5cfa5b40c5a616ae316d4c64f72dc0750bdc6627cfc2c89a0935e0'],
    ['8.0.2', '7.0.0', 'c1509e31ab84582f29e147aea7adb3de6d2951b5f116eeb836d1ca0a395c0802'],
  ]);
  const root = mkdtempSync(join(tmpdir(), 'openslate-v810-budget-'));
  t.after(() => { writable(root); rmSync(root, { recursive: true, force: true }); });
  const loaded = loadSkillRelease({ snapshotRoot: join(root, 'skills'), compatibility: { toolContract: '7.1.0', planLanguage: '1.0.0', workflowContract: '1.0.0' },
    availableToolIds: [...toolCatalog('7.1.0').names], releaseRoot: shipped, routeKinds: FILM_KIND_KINDS });
  const budget = skillReleaseBudget(loaded);
  assert.deepEqual(budget.violations, []);
  console.log(`v8.1.0 worst-case injection: ${budget.worstCaseInjectedWords} of ${loaded.release.budget.injectedWords} words`);
});

test('8.1.0 injected guidance distinguishes missing clips, saved-clip remakes and new keyframes', () => {
  const contract = read('production', 'references/current-contract.md');
  assert.match(contract, /tool contract `7\.1\.0`/);
  assert.match(contract, /`confirm_video` is only for clips still to make/);
  assert.match(contract, /SCENE_VIDEO_SAVED.*remake_clip/);
  assert.match(contract, /Only a new frame uses `regenerate_keyframe`; the Director never starts video/);
  const video = read('production', 'references/stages/video.md');
  assert.match(video, /1–4 distinct shots in one scene, each with a saved clip and ready keyframe/);
  assert.match(video, /keeps the approved keyframe and its crop, reuses saved motion, video prompt, duration and voice line/);
  assert.match(video, /keeps the old clip current until the new clip succeeds/);
  assert.match(video, /Failure preserves the old clip/);
  assert.match(video, /never use it to remake only a clip/);
  for (const [pkg, path] of [['production', 'references/notes.md'], ['plan-authoring', 'references/grammar.md'],
    ['craft-continuity-review', 'SKILL.md'], ['craft-comedy', 'references/review-checklist.md'], ['type-social', 'SKILL.md']])
    assert.match(read(pkg, path), /remake_clip/, `${pkg}/${path} teaches saved-clip remakes`);
});

test('new films lock the latest release on their first native turn and receive its tool contract', t => {
  const f = freshFilm(t), turn = f.turn('Plan this film.');
  assert.equal(turn.input.bridge.toolContractVersion, latest.toolContract);
  const locks = f.store.list('director_skill_lock', f.project.id);
  assert.equal(locks.length, 1);
  assert.deepEqual(locks[0].lock.release, { version: latest.guidanceVersion, releaseDigest: latest.releaseDigest });
  assert.equal(turn.context.toolContract.lockId, locks[0].lock.id);
  verifyShippedDirectorGuidance(locks[0].lock, f.configuration);
});

for (const version of ['8.0.0', '8.0.1', '8.0.2']) test(`${version} locks still verify and upgrade once on a fresh native turn without changing their bound epoch`, t => {
  const f = freshFilm(t), previousRow = SHIPPED_DIRECTOR_RELEASES.find(item => item.guidanceVersion === version);
  const previous = createDirectorReleaseLock(f.configuration, previousRow.toolContract, version, previousRow.releaseDigest);
  const before = readFileSync(join(f.configuration.snapshotRoot, previousRow.releaseDigest, 'release.json'));
  assert.equal(releaseDirectory(version), version === '8.0.0' ? 'skills/v8' : `skills/v${version}`);
  verifyShippedDirectorGuidance(previous.lock, f.configuration);
  assert.ok(isShippedDirectorRelease(previous.lock));
  new DirectorContextService(f.service, previous.environment).bootstrapLock(f.project.id, previous.lock);
  const bound = f.turn('Continue with the saved guidance.');
  assert.equal(bound.context.toolContract.lockId, previous.lock.id);
  assert.equal(bound.input.bridge.toolContractVersion, '7.0.0');
  const settings = new DirectorToolSettings(f.service, () => f.configuration);
  assert.equal(settings.status(f.project.id).upgradeAvailable, true);
  const fresh = f.turn('Use the current guidance.', { freshTurnGuidance: settings });
  const locks = f.store.list('director_skill_lock', f.project.id);
  assert.equal(locks.length, 2);
  assert.deepEqual(locks.at(-1).lock.release, { version: latest.guidanceVersion, releaseDigest: latest.releaseDigest });
  assert.equal(fresh.input.bridge.toolContractVersion, latest.toolContract);
  assert.deepEqual(f.store.get('director_skill_lock', previous.lock.id).lock, previous.lock);
  assert.equal(f.store.get('director_epoch_lock', bound.bridge.actor.epochId).lockId, previous.lock.id);
  assert.deepEqual(readFileSync(join(f.configuration.snapshotRoot, previousRow.releaseDigest, 'release.json')), before);
  verifyShippedDirectorGuidance(previous.lock, f.configuration);
  assert.equal(settings.status(f.project.id).upgradeAvailable, false);
  f.turn('Another fresh turn.', { freshTurnGuidance: settings });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2);
});
