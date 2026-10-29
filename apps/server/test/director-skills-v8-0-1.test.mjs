import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, FILM_KIND_KINDS, newId, parseToolArguments, toolCatalog } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { loadSkillRelease, routeSkills, SKILL_LIMITS, skillReleaseBudget } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { createDirectorReleaseLock, createDirectorSkillLock, releaseDirectory } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { DirectorToolSettings } from '../dist/application/director-tools-upgrade.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { SHIPPED_DIRECTOR_RELEASES, createCurrentShippedDirectorSkillLock, isCurrentShippedDirectorGuidance, isShippedDirectorRelease, verifyShippedDirectorGuidance } from '../dist/application/director-shipped-guidance.js';
import { projectFixture } from './execution-fixture.mjs';
import { packageDigest } from '../../../packages/director/test/skill-release-fixture.mjs';

/** Release 8.0.1 (skills/v8.0.1), offline: no provider, no Codex. */
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const shipped = join(repositoryRoot, 'skills/v8.0.1'), previous = join(repositoryRoot, 'skills/v8');
const releaseJson = (root = shipped) => JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'));
const file = (pkg, path) => readFileSync(join(shipped, pkg, path), 'utf8');
function writable(path) { chmodSync(path, 0o700); for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name)); }

function freshFilm(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-skills-v801-'));
  const store = new Store(join(root, 'state.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  let project = service.createProject('A funny Reel');
  const shape = projectFixture(project.id, 2);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId, shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.put('project_revision', project.revisionId, project.id, { project });
  t.after(() => { provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  const configuration = { repositoryRoot, snapshotRoot: join(root, 'skills'), endpoint: 'http://127.0.0.1:3101' };
  const f = { root, store, service, project, configuration, tools: new ToolInvocationService(service) };
  f.saved = () => store.getProject(project.id);
  f.turn = (text = 'Plan the film.', runtimeId = 'offline-skills-v801', options = {}) => {
    for (const prior of store.list('director_turn', project.id).filter(turn => turn.state === 'running')) store.put('director_turn', prior.id, project.id, { ...prior, state: 'completed' });
    const human = service.beginRequest(project.id, 'local-user', text, { editing: true });
    const bridge = service.openEpoch(project.id, human);
    const turn = { id: newId(), projectId: project.id, requestId: human.requestId, epochId: bridge.actor.epochId, runtimeId, state: 'running', dispatched: false,
      nativeThreadId: null, nativeTurnId: null, owner: null, leaseExpiresAt: 0, errorCode: null, createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' };
    store.insert('director_turn', turn.id, project.id, turn);
    const input = createDirectorInput(service, { ...configuration, ...options })(turn, human, bridge);
    return { input, bridge, context: JSON.parse(input.context), call: (tool, args) => f.tools.invoke(project.id, bridge.actor, randomUUID(), tool, args) };
  };
  return f;
}

test('historical 8.0.0 and 8.0.1 rows stay pinned; new films lock the latest release', t => {
  // Pin test: the exact shipped rows. Never edit a row; append a successor.
  assert.deepEqual(SHIPPED_DIRECTOR_RELEASES.slice(0, 2).map(row => ({ ...row })), [
    { toolContract: '7.0.0', guidanceVersion: '8.0.0', handlerDigest: 'e99bf5bd4b04cff07732a2997fb25fe0e052b8efbc893514a307ec163871dc92', releaseDigest: 'da01dfb4cb255b5f5de38c097da5c9a9a3c95bc0a0a1809ce0f5126b39dab3b2' },
    { toolContract: '7.0.0', guidanceVersion: '8.0.1', handlerDigest: 'e99bf5bd4b04cff07732a2997fb25fe0e052b8efbc893514a307ec163871dc92', releaseDigest: '8663b6a96e5cfa5b40c5a616ae316d4c64f72dc0750bdc6627cfc2c89a0935e0' },
  ]);
  const row = SHIPPED_DIRECTOR_RELEASES.find(row => row.guidanceVersion === '8.0.1'), release = releaseJson(), before = releaseJson(previous);
  assert.equal(row.releaseDigest, digest(release), 'skills/v8.0.1/release.json is the pinned release');
  assert.equal(SHIPPED_DIRECTOR_RELEASES[0].releaseDigest, digest(before), 'skills/v8 is unchanged');
  assert.equal(row.handlerDigest, toolCatalog('7.0.0').digest);
  assert.equal(release.release, '8.0.1'); assert.equal(release.toolContract, '7.0.0');
  for (const pin of release.packages) assert.equal(packageDigest(join(shipped, pin.id)), pin.packageDigest, `${pin.id} matches its release pin`);
  // A changed package has a new minor version and digest; every other package is byte-identical to its 8.0.0 pin.
  const changed = release.packages.filter(pin => { const old = before.packages.find(item => item.id === pin.id); return old.packageDigest !== pin.packageDigest; });
  assert.deepEqual(changed.map(pin => `${pin.id}@${pin.version}`).sort(), ['craft-shot-prompting@8.1.0', 'craft-visual-style@8.1.0', 'plan-authoring@8.1.0', 'production@8.1.0']);
  for (const pin of release.packages) if (!changed.includes(pin)) assert.deepEqual(pin, before.packages.find(item => item.id === pin.id));
  assert.deepEqual({ routes: release.routes, fallback: release.fallback, inject: release.inject, budget: release.budget, core: release.core },
    { routes: before.routes, fallback: before.fallback, inject: before.inject, budget: before.budget, core: before.core });
  // Release directories: a major lives in skills/vN, every later release in its own full-version directory.
  assert.deepEqual(['8', '8.0.0', '8.0.1', '8.1.0'].map(releaseDirectory), ['skills/v8', 'skills/v8', 'skills/v8.0.1', 'skills/v8.1.0']);
  assert.throws(() => releaseDirectory('../8'), { code: 'DIRECTOR_GUIDANCE_UNSUPPORTED' });
  const root = mkdtempSync(join(tmpdir(), 'openslate-v801-pin-')); t.after(() => { writable(root); rmSync(root, { recursive: true, force: true }); });
  const configuration = { repositoryRoot, snapshotRoot: join(root, 'skills') };
  const { lock } = createCurrentShippedDirectorSkillLock(configuration);
  const latest = SHIPPED_DIRECTOR_RELEASES.at(-1);
  assert.deepEqual(lock.release, { version: latest.guidanceVersion, releaseDigest: latest.releaseDigest });
  assert.ok(isCurrentShippedDirectorGuidance(lock) && isShippedDirectorRelease(lock));
  verifyShippedDirectorGuidance(lock, configuration);
  // The 8.0.0 lock still verifies from its snapshots and is a shipped, no longer current, identity.
  const old = createDirectorSkillLock(configuration, '7.0.0').lock;
  assert.equal(old.release.version, '8.0.0'); verifyShippedDirectorGuidance(old, configuration);
  assert.ok(isShippedDirectorRelease(old) && !isCurrentShippedDirectorGuidance(old));
});

test('8.0.1 guidance: propose, wait for acceptance, then make keyframes', () => {
  const production = file('production', 'SKILL.md'), contract = file('production', 'references/current-contract.md'), keyframes = file('production', 'references/keyframes.md');
  assert.match(production, /\*\*Propose, wait, then make\.\*\*/);
  assert.match(production, /Never call `make_keyframes` in the same turn for shots whose prompt or direction an open proposal changes/);
  assert.match(production, /`PROPOSAL_PENDING`/);
  // The injected contract carries it too, so it applies before any read.
  assert.ok(releaseJson().inject.some(entry => entry.package === 'production' && entry.path === 'references/current-contract.md'));
  assert.match(contract, /propose, wait for acceptance, then make/); assert.match(contract, /PROPOSAL_PENDING/);
  assert.match(keyframes, /a take made now would use the old prompt/); assert.match(keyframes, /make that shot's keyframes after it is accepted/);
  // The 8.0.0 bytes are untouched.
  assert.doesNotMatch(readFileSync(join(previous, 'production/SKILL.md'), 'utf8'), /PROPOSAL_PENDING/);
});

test('8.0.1 consolidates the intake reads: the acceptance run’s first turn needs 13 distinct files, not 21 counted reads', async t => {
  const manifest = id => JSON.parse(file(id, 'openslate.skill.json')).files;
  assert.ok(!manifest('production').includes('references/shared-planning.md') && manifest('production').includes('references/routing.md'));
  assert.ok(!manifest('plan-authoring').includes('references/example.md') && manifest('plan-authoring').includes('references/example-context.json'));
  assert.deepEqual(manifest('craft-shot-prompting'), ['SKILL.md', 'references/prompts.md']);
  assert.deepEqual(manifest('craft-visual-style'), ['SKILL.md', 'references/looks.md']);
  for (const [pkg, path, text] of [['production', 'references/routing.md', '## Shared planning rules'], ['production', 'references/routing.md', 'Clips shorter than 3 s are not available'],
    ['plan-authoring', 'references/grammar.md', '## The creative-patch example'], ['plan-authoring', 'references/grammar.md', 'Guidance package `8.1.0`'],
    ['craft-shot-prompting', 'references/prompts.md', '## Keyframe prompts'], ['craft-shot-prompting', 'references/prompts.md', '## Motion prompts'],
    ['craft-visual-style', 'references/looks.md', '## Style library 8.0.0'], ['craft-visual-style', 'references/looks.md', '## The visualStyle record']])
    assert.ok(file(pkg, path).includes(text), `${pkg}/${path} has ${text}`);
  // No link in the release points at a removed file.
  for (const pin of releaseJson().packages) for (const path of manifest(pin.id)) if (path.endsWith('.md'))
    for (const [, target] of file(pin.id, path).matchAll(/\]\(((?:\.\.\/|references\/)[^)#\s]+)/g)) {
      const resolved = join(shipped, pin.id, path.includes('/') ? join(path, '..') : '', target);
      assert.ok(existsSync(resolved), `${pin.id}/${path} links ${target}`);
    }
  // The first turn of the 20 s IG skit, read for read (skill_read rows of ~/openslate-ig-test, mapped to 8.0.1 paths).
  const f = freshFilm(t), turn = f.turn('a 20 s funny IG Reels video, 9:16, 4 shots of 5 s');
  assert.equal(turn.input.bridge.toolContractVersion, '7.0.0');
  const reads = [['production', 'references/routing.md'], ['plan-authoring', 'references/grammar.md'], ['craft-comedy', 'SKILL.md'], ['type-social', 'SKILL.md'],
    ['format-social-vertical', 'SKILL.md'], ['craft-comedy', 'SKILL.md'], ['type-social', 'SKILL.md'], ['format-social-vertical', 'SKILL.md'],
    ['craft-comedy', 'references/premises-and-beats.md'], ['craft-shot-prompting', 'references/prompts.md'], ['craft-visual-style', 'references/looks.md'],
    ['craft-comedy', 'references/short-form.md'], ['craft-comedy', 'references/review-checklist.md'], ['craft-style-prompting', 'references/realism.md'],
    ['format-social-vertical', 'references/guide.md'], ['type-social', 'SKILL.md'], ['craft-style-prompting', 'references/3d-and-tactile.md']];
  for (const [pkg, path] of reads) assert.equal((await turn.call('read_guidance', { package: pkg, path })).path, path);
  const rows = f.store.list('skill_read', f.project.id).filter(row => row.epochId === turn.bridge.actor.epochId && row.via === 'read_guidance');
  const counted = rows.filter(row => !row.repeat);
  assert.equal(counted.length, 13, '8.0.0 counted 17 distinct files and 4 repeats against the allowance'); assert.equal(rows.length - counted.length, 4, 'the four repeats are free');
  assert.ok(counted.reduce((sum, row) => sum + row.bytes, 0) <= SKILL_LIMITS.guidanceReadBytes);
  assert.ok(SKILL_LIMITS.guidanceReadsPerActivation - counted.length >= 18, 'most of the turn allowance is left');
});

test('a turn reads up to the distinct-file and byte allowance, then gets a refusal it can work around', async t => {
  const f = freshFilm(t), turn = f.turn('Read everything.');
  const files = turn.context.guidance.packages.flatMap(pkg => pkg.files.filter(path => path.endsWith('.md')).map(path => [pkg.package, path]));
  assert.ok(files.length > SKILL_LIMITS.guidanceReadsPerActivation, `${files.length} files in the lock`);
  let refusal;
  for (const [pkg, path] of files) {
    try { await turn.call('read_guidance', { package: pkg, path }); }
    catch (error) { refusal = error; break; }
  }
  assert.equal(refusal?.code, 'GUIDANCE_READ_LIMIT');
  const counted = f.store.list('skill_read', f.project.id).filter(row => row.epochId === turn.bridge.actor.epochId && row.via === 'read_guidance' && !row.repeat);
  assert.ok(counted.length <= SKILL_LIMITS.guidanceReadsPerActivation);
  assert.ok(counted.reduce((sum, row) => sum + row.bytes, 0) <= SKILL_LIMITS.guidanceReadBytes);
  assert.match(refusal.message, /This turn's guidance allowance is used/); assert.match(refusal.message, /continue this turn with the guidance already in your context/i);
  assert.deepEqual(Object.keys(refusal.details).sort(), ['maxBytes', 'maxFiles', 'next', 'readBytes', 'readFiles']);
  // A file already read this turn can still be read again, and the next turn starts fresh.
  assert.equal((await turn.call('read_guidance', { package: counted[0].evidence.skillId, path: counted[0].evidence.path })).path, counted[0].evidence.path);
  assert.equal((await f.turn('Next message.').call('read_guidance', { package: 'craft-story' })).package, 'craft-story');
});

test('8.0.1 stays inside the injected word budget for every kind, and its look record is a valid style option', t => {
  const root = mkdtempSync(join(tmpdir(), 'openslate-v801-budget-')); t.after(() => { writable(root); rmSync(root, { recursive: true, force: true }); });
  const release = loadSkillRelease({ snapshotRoot: join(root, 'skills'), compatibility: { toolContract: '7.0.0', planLanguage: '1.0.0', workflowContract: '1.0.0' },
    availableToolIds: [...toolCatalog('7.0.0').names], releaseRoot: shipped, routeKinds: FILM_KIND_KINDS });
  const budget = skillReleaseBudget(release), limit = release.release.budget.injectedWords;
  assert.deepEqual(budget.violations, []);
  for (const kind of FILM_KIND_KINDS) for (const aspect of ['16:9', '9:16']) {
    const decision = routeSkills({ version: 'film-kind@1', kind, format: { aspect } }, release, ['has_characters', 'has_soundtrack', 'narration_planned', 'has_visual_style', 'audience:kids']);
    assert.ok(budget.injectedWords(decision) <= limit, `${kind} ${aspect}`);
  }
  console.log(`v8.0.1 worst-case injection: ${budget.worstCaseInjectedWords} of ${limit} words`);
  const looks = file('craft-visual-style', 'references/looks.md');
  const option = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(looks)[1]);
  const second = { ...option, tier: 'distinct', style: { ...option.style, styleId: 'documentary-handheld', label: 'Documentary handheld' } };
  assert.doesNotThrow(() => parseToolArguments('propose_visual_style', { options: [option, second] }, '7.0.0'));
  for (const [, id, family] of looks.matchAll(/^\| `([a-z0-9-]+)` \| [^|]+ \| ([a-z0-9-]+) \|/gm))
    assert.match(file('craft-style-prompting', `references/${family}.md`), new RegExp(`^## ${id}$`, 'm'), `${id} in ${family}.md`);
});

test('a saved 8.0.0 film moves to 8.0.1 on its next fresh native turn; the 8.0.0 lock row stays', t => {
  const f = freshFilm(t), configuration = { repositoryRoot, snapshotRoot: join(f.root, 'native-skills'), runtimeId: 'codex-app-server' };
  const v800 = createDirectorSkillLock(configuration, '7.0.0');
  assert.equal(v800.lock.release.version, '8.0.0');
  new DirectorContextService(f.service, v800.environment).bootstrapLock(f.project.id, v800.lock);
  const settings = new DirectorToolSettings(f.service, () => configuration, () => false, SHIPPED_DIRECTOR_RELEASES.slice(0, 2));
  assert.equal(settings.status(f.project.id).upgradeAvailable, true);
  const turn = f.turn('Continue the film.', 'codex-app-server', { ...configuration, freshTurnGuidance: settings });
  assert.equal(turn.input.bridge.toolContractVersion, '7.0.0');
  const locks = f.store.list('director_skill_lock', f.project.id);
  assert.equal(locks.length, 2); assert.equal(locks.at(-1).lock.release.version, '8.0.1');
  assert.deepEqual(f.store.get('director_skill_lock', v800.lock.id).lock, v800.lock);
  assert.equal(settings.status(f.project.id).upgradeAvailable, false);
});


test('an 8.0.1 lock still verifies and upgrades once on a fresh native turn while its bound epoch keeps its lock', t => {
  const f = freshFilm(t), configuration = { repositoryRoot, snapshotRoot: join(f.root, 'native-skills'), runtimeId: 'codex-app-server' };
  const row = SHIPPED_DIRECTOR_RELEASES.find(row => row.guidanceVersion === '8.0.1');
  const previous = createDirectorReleaseLock(configuration, row.toolContract, row.guidanceVersion, row.releaseDigest);
  verifyShippedDirectorGuidance(previous.lock, configuration);
  new DirectorContextService(f.service, previous.environment).bootstrapLock(f.project.id, previous.lock);
  const bound = f.turn('Continue with the saved lock.', 'codex-app-server', configuration);
  assert.equal(bound.context.toolContract.lockId, previous.lock.id);
  const settings = new DirectorToolSettings(f.service, () => configuration);
  assert.equal(settings.status(f.project.id).upgradeAvailable, true);
  const turn = f.turn('Fresh turn after the release.', 'codex-app-server', { ...configuration, freshTurnGuidance: settings });
  const latest = SHIPPED_DIRECTOR_RELEASES.at(-1), locks = f.store.list('director_skill_lock', f.project.id);
  assert.equal(locks.length, 2);
  assert.deepEqual(locks.at(-1).lock.release, { version: latest.guidanceVersion, releaseDigest: latest.releaseDigest });
  assert.deepEqual(f.store.get('director_skill_lock', previous.lock.id).lock, previous.lock);
  const boundRow = f.store.get('director_epoch_lock', bound.bridge.actor.epochId);
  assert.equal(boundRow.lockId, previous.lock.id);
  assert.equal(settings.status(f.project.id).upgradeAvailable, false);
  f.turn('Another fresh turn.', 'codex-app-server', { ...configuration, freshTurnGuidance: settings });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2);
  assert.notEqual(turn.context.toolContract.lockId, previous.lock.id);
});
