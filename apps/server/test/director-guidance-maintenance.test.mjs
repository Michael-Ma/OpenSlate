import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { digest, newId, toolCatalog } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { CodexDirectorRuntime } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { DirectorToolSettings } from '../dist/application/director-tools-upgrade.js';
import { SHIPPED_DIRECTOR_GUIDANCE, isCurrentShippedDirectorGuidance, verifyShippedDirectorGuidance } from '../dist/application/director-shipped-guidance.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { installRecoveryQuarantine } from '../dist/application/installation-recovery.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const earlierV7 = JSON.parse(readFileSync(new URL('./fixtures/director-guidance-v7-before-k1.json', import.meta.url), 'utf8'));
const earlierV6 = JSON.parse(readFileSync(new URL('./fixtures/director-guidance-v6-3b3edf7.json', import.meta.url), 'utf8'));
test('shipped Director guidance identities cannot be changed at runtime', () => {
  assert.ok(Object.isFrozen(SHIPPED_DIRECTOR_GUIDANCE)); assert.ok(SHIPPED_DIRECTOR_GUIDANCE.every(Object.isFrozen));
  assert.throws(() => SHIPPED_DIRECTOR_GUIDANCE.push(SHIPPED_DIRECTOR_GUIDANCE[0]), TypeError);
  assert.throws(() => { SHIPPED_DIRECTOR_GUIDANCE[0].handlerDigest = '0'.repeat(64); }, TypeError);
});
function writable(path) { chmodSync(path, 0o700); for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name)); }
function fixture(t, start, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-guidance-maintenance-')), store = new Store(join(root, 'app.sqlite'));
  const provider = new FakeProvider(join(root, 'fake.sqlite')), service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  const calls = [], config = { repositoryRoot, dataDirectory: root, endpoint: 'http://127.0.0.1:3001',
    setup: async () => ({ readiness: { status: 'ready' }, runtimeOptions: {} }),
    makeRuntime: () => ({ id: 'codex-app-server', start: async (input, options) => {
      calls.push(input); await options.onEvent({ ...input, kind: 'runtime_started', nativeThreadId: `fixture-${input.turnId}` });
      await start?.(input, service); return { ...input, status: 'completed', dispatched: true, text: 'Saved fixture response', nativeThreadId: `fixture-${input.turnId}` };
    } }), ...overrides };
  const director = new LocalDirectorController(service, config), project = service.createProject('Guidance fixture');
  const configuration = { repositoryRoot, snapshotRoot: join(root, 'native', project.id, 'workspace', '.agents', 'skills'), runtimeId: 'codex-app-server' };
  const settings = new DirectorToolSettings(service, () => configuration);
  const prepareInput = createDirectorInput(service, { ...configuration, endpoint: config.endpoint, freshTurnGuidance: settings });
  t.after(async () => { await director.close(); provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  const install = version => { const saved = createDirectorSkillLock(configuration, version); new DirectorContextService(service, saved.environment).bootstrapLock(project.id, saved.lock); return saved; };
  const fresh = text => {
    for (const turn of store.list('director_turn', project.id).filter(turn => turn.state === 'running')) store.put('director_turn', turn.id, project.id, { ...turn, state: 'interrupted' });
    const human = service.beginRequest(project.id, 'local-user', text), bridge = service.openEpoch(project.id, human);
    const turn = { id: newId(), projectId: project.id, requestId: human.requestId, epochId: bridge.actor.epochId,
      runtimeId: 'codex-app-server', state: 'running', dispatched: false, nativeThreadId: null, nativeTurnId: null,
      owner: null, leaseExpiresAt: 0, errorCode: null, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' };
    store.insert('director_turn', turn.id, project.id, turn); return { human, bridge, turn };
  };
  return { root, store, provider, service, director, project, configuration, settings, prepareInput, calls, install, fresh };
}

function installEarlierV6(f) {
  const earlierRoot = join(f.root, 'earlier-3b3edf7');
  for (const [path, bytes] of Object.entries(earlierV6.files)) {
    const target = join(earlierRoot, 'skills', 'v6', path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  const saved = createDirectorSkillLock({ ...f.configuration, repositoryRoot: earlierRoot }, '5.0.0');
  const { lockDigest: _, ...body } = structuredClone(saved.lock);
  body.bindings = body.bindings.map(binding => binding.kind === 'handler' ? { ...binding, digest: earlierV6.handlerDigest } : binding);
  const lock = { ...body, lockDigest: digest(body) };
  assert.deepEqual(lock.skills.map(({ id, packageDigest }) => ({ id, packageDigest })), [
    { id: 'plan-authoring', packageDigest: 'acabdc1c95c2f7115a1748ff5946827363c3ad313552c65e77dc9efafd9b4233' },
    { id: 'production', packageDigest: 'd80b6256dddc96a4b705ec5965ba4e7387d8f3440fa8c0f2bde94d36050c164f' },
  ], 'the fixture contains the actual earlier V6 package bytes');
  new DirectorContextService(f.service, { ...saved.environment, bindings: lock.bindings }).bootstrapLock(f.project.id, lock);
  return lock;
}

for (const version of ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0']) test(`next native ${version} request automatically loads V7 while historical evidence and generation authority stay unchanged`, async t => {
  const f = fixture(t); await f.director.configure(f.project.id, { mode: 'native', binaryPath: process.execPath, model: 'test-model' }, 'setup');
  const saved = f.install(version), oldHuman = f.service.beginRequest(f.project.id, 'local-user', 'Earlier unfinished request'), oldBridge = f.service.openEpoch(f.project.id, oldHuman);
  const captured = new DirectorContextService(f.service, saved.environment).capture(f.project.id, oldBridge.actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  const oldCall = await new ToolInvocationService(f.service).invoke(f.project.id, oldBridge.actor, 'old-context', 'read_context', {});
  assert.ok(oldCall.guard.applicationCapabilitiesDigest);
  const oldPrepared = await f.service.prepare(f.project.id, oldBridge.actor, { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Old unaccepted proposal' } });
  const human = f.service.beginRequest(f.project.id, 'local-user', 'Write the narration for my next shot'), canonical = f.store.getProject(f.project.id);
  const preservedKinds = ['hold', 'prepared', 'message', 'grant', 'candidate', 'attempt', 'approval', 'external_allowance', 'narration_revision', 'tool_invocation'];
  const preserved = Object.fromEntries(preservedKinds.map(kind => [kind, f.store.list(kind, f.project.id)]));
  const turn = f.director.enqueue(f.project.id, human); f.director.tick(); await f.director.settle();
  assert.equal(f.store.get('director_turn', turn.id).state, 'completed'); assert.equal(f.calls.length, 1);
  const input = f.calls[0], context = JSON.parse(input.context), successor = f.store.list('director_skill_lock', f.project.id).at(-1).lock;
  assert.equal(input.resumeThreadId, undefined); assert.equal(input.bridge.toolContractVersion, '6.0.0');
  assert.equal(context.toolContract.lockId, successor.id); assert.equal(context.toolContract.lockDigest, successor.lockDigest);
  assert.equal(context.filmPlanning.narrationWriting.toolAvailable, true); assert.equal(context.filmPlanning.narrationWriting.upgradeRequired, false);
  assert.equal(context.snapshot.applicationCapabilities.narration.speechSynthesis.toolAvailable, true, 'the FIRST native snapshot advertises its actual bound catalog');
  assert.equal(context.snapshot.applicationCapabilities.narration.transcription.toolAvailable, true);
  assert.equal(context.snapshot.guard.applicationCapabilitiesDigest, digest(context.snapshot.applicationCapabilities));
  assert.ok(context.filmPlanning.procedure.some(text => text.includes('Writing needs no generation or spending permission')));
  // The Director names the studio's actual views and actions, not the retired Storyboard/Timeline or a button color.
  assert.match(context.filmPlanning.surface, /^Plan: .*Keyframes: .*"Confirm frames & generate video".*Film: .*Assets/);
  assert.doesNotMatch(context.filmPlanning.surface, /Storyboard|Timeline|green/);
  assert.equal(f.store.get('director_epoch_lock', input.epochId).lockId, successor.id);
  assert.deepEqual(f.store.get('director_skill_lock', saved.lock.id).lock, saved.lock);
  assert.equal(f.store.get('director_epoch_lock', oldBridge.actor.epochId).lockId, saved.lock.id);
  assert.deepEqual(f.store.get('director_context', captured.activation.contextSnapshotId).snapshot, captured.snapshot);
  assert.deepEqual(f.store.getProject(f.project.id), canonical);
  for (const kind of preservedKinds) assert.deepEqual(f.store.list(kind, f.project.id), kind === 'hold'
    ? preserved[kind].map(hold => hold.ownerId === human.requestId ? { ...hold, active: false } : hold) : preserved[kind], kind);
  assert.equal(f.store.get('message', human.requestId).state, 'active', 'terminal hold release does not replace its request');
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2);
  assert.throws(() => f.service.apply(f.project.id, human, oldPrepared.id), { code: 'ACTOR_DENIED' }, 'a later request cannot adopt an old prepared proposal');
  const next = f.service.beginRequest(f.project.id, 'local-user', 'Read the same project', { editing: false });
  f.director.enqueue(f.project.id, next); f.director.tick(); await f.director.settle();
  assert.equal(f.calls.length, 2); assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2, 'maintenance does not install another successor');
});

test('an active bound legacy epoch retains its exact catalog and cannot upgrade mid-turn', t => {
  const f = fixture(t), saved = f.install('4.0.0'), current = f.fresh('Already running');
  const context = new DirectorContextService(f.service, saved.environment).capture(f.project.id, current.bridge.actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  const input = f.prepareInput(current.turn, current.human, current.bridge);
  assert.equal(input.bridge.toolContractVersion, '4.0.0'); assert.equal(JSON.parse(input.context).filmPlanning.narrationWriting.toolAvailable, true);
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1);
  assert.equal(f.store.get('skill_activation', context.activation.activationId).activation.lockId, saved.lock.id);
});

test('unbound epochs with prior tool work, dispatched turns or a concurrent old epoch cannot be upgraded', async t => {
  const f = fixture(t); f.install('1.0.0'); const current = f.fresh('Unbound work');
  await new ToolInvocationService(f.service).invoke(f.project.id, current.bridge.actor, 'before-input', 'read_context', {});
  assert.throws(() => f.prepareInput(current.turn, current.human, current.bridge), { code: 'DIRECTOR_GUIDANCE_IN_FLIGHT' });
  const next = f.fresh('Fresh attempt'); f.store.put('director_turn', next.turn.id, f.project.id, { ...next.turn, dispatched: true });
  assert.throws(() => f.prepareInput(next.turn, next.human, next.bridge), { code: 'DIRECTOR_GUIDANCE_IN_FLIGHT' });
  const idle = f.fresh('New current request'), other = f.service.beginRequest(f.project.id, 'local-user', 'Read concurrently', { editing: false });
  f.service.openEpoch(f.project.id, other);
  assert.throws(() => f.prepareInput(idle.turn, idle.human, idle.bridge), { code: 'DIRECTOR_TOOLS_BUSY' });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1); assert.equal(f.calls.length, 0);
});

test('custom, tampered and unsupported predecessor locks fail before dispatch with an actionable application message', async t => {
  for (const variant of ['custom', 'tampered', 'unsupported', 'catalog', 'binding']) {
    const f = fixture(t); await f.director.configure(f.project.id, { mode: 'native', binaryPath: process.execPath, model: 'test-model' }, 'setup');
    const shipped = createDirectorSkillLock(f.configuration, '1.0.0').lock;
    const { lockDigest: _, ...body } = shipped;
    if (variant === 'custom') body.prompts = body.prompts.slice(0, 1);
    if (variant === 'unsupported') body.compatibility = { ...body.compatibility, toolContract: '99.0.0' };
    if (variant === 'catalog') body.bindings = body.bindings.map(binding => binding.kind === 'handler' ? { ...binding, digest: '0'.repeat(64) } : binding);
    if (variant === 'binding') body.bindings = body.bindings.map(binding => binding.kind === 'recipe' ? { ...binding, digest: '0'.repeat(64) } : binding);
    const lock = { ...body, lockDigest: variant === 'tampered' ? '0'.repeat(64) : digest(body) };
    f.store.insert('director_skill_lock', lock.id, f.project.id, { id: lock.id, projectId: f.project.id, lock });
    const before = f.store.getProject(f.project.id), human = f.service.beginRequest(f.project.id, 'local-user', 'Use this project'), turn = f.director.enqueue(f.project.id, human);
    f.director.tick(); await f.director.settle();
    assert.equal(f.store.get('director_turn', turn.id).errorCode, 'DIRECTOR_GUIDANCE_UNSUPPORTED');
    assert.equal(f.store.get('director_turn', turn.id).state, 'failed'); assert.equal(f.store.get('director_turn', turn.id).dispatched, false);
    assert.match(f.director.status(f.project.id).message, /This film's Director guidance does not match any version this OpenSlate ships\./);
    assert.doesNotMatch(f.director.status(f.project.id).message, /Restore the matching application files/);
    assert.match(f.director.status(f.project.id).message, /Saved work is retained/);
    assert.equal(f.calls.length, 0); assert.equal(f.store.list('native_model_start', f.project.id).length, 0);
    assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1); assert.deepEqual(f.store.getProject(f.project.id), before);
  }
});

test('the real 3b3edf7 V6 packages and old 5.0.0 catalog upgrade to V7 without rewriting the predecessor', t => {
  const f = fixture(t), saved = installEarlierV6(f), current = f.fresh('Continue after updating OpenSlate');
  const input = f.prepareInput(current.turn, current.human, current.bridge), successor = f.store.list('director_skill_lock', f.project.id).at(-1).lock;
  assert.equal(input.bridge.toolContractVersion, '6.0.0'); assert.ok(successor.skills.every(skill => skill.version === '7.0.0'));
  assert.deepEqual(f.store.get('director_skill_lock', saved.id).lock, saved);
  assert.equal(f.store.get('director_epoch_lock', current.bridge.actor.epochId).lockId, successor.id);
  assert.equal(f.store.list('attempt', f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test('predecessor verification uses shipped pins and its snapshots when repository historical text has evolved', t => {
  const f = fixture(t), saved = f.install('4.0.0'), current = f.fresh('Use the saved predecessor'), checkout = join(f.root, 'later-checkout');
  cpSync(join(repositoryRoot, 'skills', 'v5'), join(checkout, 'skills', 'v5'), { recursive: true });
  cpSync(join(repositoryRoot, 'skills', 'v7'), join(checkout, 'skills', 'v7'), { recursive: true });
  writeFileSync(join(checkout, 'skills', 'v5', 'production', 'references', 'audio-proposals.md'), 'A changed checkout must not change a saved snapshot.\n');
  const settings = new DirectorToolSettings(f.service, () => ({ ...f.configuration, repositoryRoot: checkout }));
  const successor = settings.currentForFreshTurn(f.project.id, current.bridge.actor, current.turn.id);
  assert.equal(successor.compatibility.toolContract, '6.0.0'); assert.deepEqual(f.store.get('director_skill_lock', saved.lock.id).lock, saved.lock);
});

for (const historical of ['earlier-package-and-catalog', 'current-package-and-old-catalog']) test(`native startup ignores historical runtime bindings after checking saved snapshots: ${historical}`, async t => {
  const policy = { mode: 'local', id: 'fixture', runtimeVersion: '0.153.4', config: { 'skills.config': [] } };
  const f = fixture(t, undefined, { setup: async () => ({ readiness: { status: 'ready' }, runtimeOptions: { policy } }) });
  await f.director.configure(f.project.id, { mode: 'native', binaryPath: process.execPath, model: 'test-model' }, 'setup');
  if (historical === 'earlier-package-and-catalog') installEarlierV6(f);
  else {
    const built = createDirectorSkillLock(f.configuration, '5.0.0'), { lockDigest: _, ...body } = structuredClone(built.lock);
    body.bindings = body.bindings.map(binding => binding.kind === 'handler' ? { ...binding, digest: earlierV6.handlerDigest } : binding);
    const lock = { ...body, lockDigest: digest(body) }; f.store.insert('director_skill_lock', lock.id, f.project.id, { id: lock.id, projectId: f.project.id, lock });
  }
  const current = createDirectorSkillLock(f.configuration, '6.0.0').lock;
  f.store.insert('director_skill_lock', current.id, f.project.id, { id: current.id, projectId: f.project.id, lock: current });
  const human = f.service.beginRequest(f.project.id, 'local-user', 'Start with the current guidance'), turn = f.director.enqueue(f.project.id, human);
  f.director.tick(); await f.director.settle();
  assert.equal(f.store.get('director_turn', turn.id).state, 'completed'); assert.equal(f.store.get('director_turn', turn.id).errorCode, null);
  assert.equal(f.calls.length, 1); assert.equal(f.store.list('native_model_start', f.project.id).length, 1);
});

for (const refusal of ['corrupt-history', 'invalid-policy']) test(`native startup preflight ${refusal} is failed before dispatch intent`, async t => {
  const policy = { mode: 'local', id: 'fixture', runtimeVersion: '0.153.4', config: { 'skills.config': refusal === 'invalid-policy' ? [{ path: '/unexpected', enabled: true }] : [] } };
  const f = fixture(t, undefined, { setup: async () => ({ readiness: { status: 'ready' }, runtimeOptions: { policy } }) });
  await f.director.configure(f.project.id, { mode: 'native', binaryPath: process.execPath, model: 'test-model' }, 'setup');
  const old = f.install('2.0.0'), current = createDirectorSkillLock(f.configuration, '6.0.0').lock;
  f.store.insert('director_skill_lock', current.id, f.project.id, { id: current.id, projectId: f.project.id, lock: current });
  if (refusal === 'corrupt-history') {
    const entry = join(f.configuration.snapshotRoot, old.lock.skills[0].packageDigest, 'SKILL.md'); chmodSync(entry, 0o600); writeFileSync(entry, 'Changed old snapshot');
  }
  const human = f.service.beginRequest(f.project.id, 'local-user', 'Refuse safely'), turn = f.director.enqueue(f.project.id, human);
  f.director.tick(); await f.director.settle();
  const saved = f.store.get('director_turn', turn.id);
  assert.equal(saved.state, 'failed'); assert.equal(saved.dispatched, false);
  assert.equal(saved.errorCode, refusal === 'corrupt-history' ? 'SKILL_SNAPSHOT_INVALID' : 'CAPABILITY_MISMATCH');
  assert.equal(f.calls.length, 0); assert.equal(f.store.list('native_model_start', f.project.id).length, 0);
  assert.equal(f.store.readEvents(f.project.id, 0).filter(event => event.kind === 'director.dispatch_intent').length, 0);
  f.director.tick(); await f.director.settle(); assert.equal(f.calls.length, 0, 'a refusal is never automatically replayed');
});

test('compatible maintenance is fenced by installation recovery and never rewrites restored authority', t => {
  const f = fixture(t); f.install('2.0.0'); const current = f.fresh('Restored request');
  installRecoveryQuarantine(f.store, { restoreId: newId(), backupId: newId(), backupManifestSha256: 'a'.repeat(64), sourceDatabaseSha256: 'b'.repeat(64),
    originalDataRoot: f.root, backupCreatedAt: '2026-10-02T00:00:00.000Z', restoredAt: '2026-10-03T00:00:00.000Z' });
  assert.throws(() => f.prepareInput(current.turn, current.human, current.bridge), { code: 'INSTALLATION_QUARANTINED' });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1); assert.equal(f.calls.length, 0);
});

test('a repeated first-input preparation keeps one successor and one epoch binding', t => {
  const f = fixture(t); f.install('3.0.0'); const current = f.fresh('Fresh V7 input');
  const first = f.prepareInput(current.turn, current.human, current.bridge), second = f.prepareInput(current.turn, current.human, current.bridge);
  assert.equal(first.bridge.toolContractVersion, '6.0.0'); assert.equal(second.bridge.toolContractVersion, '6.0.0');
  assert.equal(JSON.parse(first.context).toolContract.lockId, JSON.parse(second.context).toolContract.lockId);
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2); assert.equal(f.store.list('director_epoch_lock', f.project.id).length, 1);
  assert.equal(f.store.db.prepare("SELECT count(*) total FROM events WHERE project_id=? AND json_extract(body,'$.kind')='director.lock_installed' AND json_extract(body,'$.payload.source')='application_compatible_upgrade'").get(f.project.id).total, 1);
});

test('native writing context separates save-only work from human generation and supplies compact card labels', t => {
  const f = fixture(t); f.install('5.0.0');
  const current = f.fresh('Save the story and two shots only; do not generate media.');
  const saved = f.store.list('director_skill_lock', f.project.id).at(-1).lock;
  new DirectorContextService(f.service, createDirectorSkillLock(f.configuration, '5.0.0').environment).capture(f.project.id, current.bridge.actor, { lockId: saved.id, selectedSkillIds: ['production', 'plan-authoring'] });
  const input = f.prepareInput(current.turn, current.human, current.bridge), guide = JSON.parse(input.context).filmPlanning;
  const procedure = guide.procedure.join('\n');
  assert.match(procedure, /save-only request.*variant="project".*without source or requestNewTakes/i);
  assert.match(procedure, /do not prepare an executable generation plan/i);
  assert.match(procedure, /saved writing.*successful.*human.*generation.*next step/i);
  assert.match(procedure, /framing.*1 to 3 words.*Close-up.*Medium.*Wide/i);
  assert.match(procedure, /scene.*at most about 6 words/i);
  assert.match(procedure, /locked creative schema.*no separate scene title.*purpose.*short name/i);
  assert.match(procedure, /descriptions.*shot purpose.*imagePrompt.*videoPrompt/i);
  for (const kind of ['prepared', 'grant', 'candidate', 'attempt']) assert.equal(f.store.list(kind, f.project.id).length, 0, kind);
  assert.equal(f.provider.acceptedCount(), 0);
});

test('changed predecessor snapshot bytes and setup configuration fail before installing a successor', t => {
  const f = fixture(t), saved = f.install('2.0.0'), current = f.fresh('Verify old guidance');
  const entry = join(f.configuration.snapshotRoot, saved.lock.skills[0].packageDigest, 'SKILL.md');
  chmodSync(entry, 0o600); writeFileSync(entry, 'Changed saved package');
  assert.throws(() => f.prepareInput(current.turn, current.human, current.bridge), { code: 'SKILL_SNAPSHOT_INVALID' });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1);
  const g = fixture(t); g.install('3.0.0'); const next = g.fresh('Verify setup'); let count = 0;
  const settings = new DirectorToolSettings(g.service, () => (++count === 1 ? g.configuration : { ...g.configuration, runtimeId: 'changed-runtime' }));
  assert.throws(() => settings.currentForFreshTurn(g.project.id, next.bridge.actor, next.turn.id), { code: 'DIRECTOR_TOOLS_STALE' });
  assert.equal(g.store.list('director_skill_lock', g.project.id).length, 1);
});

test('a migrated shot-scoped request writes its script through V7 without generation permission or project-wide narration edits', async t => {
  let selectedId;
  const f = fixture(t, async (input, service) => {
    const actor = { kind: 'director', principalId: 'local-user', requestId: input.requestId, epochId: input.epochId };
    const tools = new ToolInvocationService(service), prepared = await tools.invoke(input.projectId, actor, 'write-only', 'prepare_change',
      { variant: 'project', expectedHeadVersion: service.store.getProject(input.projectId).headVersion,
        creative: { updateShots: [{ id: selectedId, narration: { mode: 'generated', text: 'Made for the road ahead.', voice: 'stock' }, reauthorPrompts: true }] } });
    await tools.invoke(input.projectId, actor, 'apply-writing', 'apply_change', { preparedId: prepared.preparedId });
  });
  const human = f.service.beginRequest(f.project.id, 'local-user', 'Seed two saved shots');
  const seed = await f.service.prepare(f.project.id, human, { variant: 'project', expectedHeadVersion: 0, creative: {
    brief: 'Two product shots', createScenes: [{ key: 'scene', purpose: 'Product' }], createShots: [0, 1].map(i => ({
      key: `shot${i}`, sceneId: 'scene', purpose: `Product shot ${i}`, action: 'Boot', framing: 'Close', motion: 'Slow push', desiredFrames: 180,
      imagePrompt: `Image ${i}`, videoPrompt: `Video ${i}`, referenceArtifactIds: [], cueId: null,
      narration: { mode: 'none', text: '', voice: 'stock' },
    })) } });
  f.service.apply(f.project.id, human, seed.id); const before = f.store.getProject(f.project.id); selectedId = before.shots[0].id;
  await f.director.configure(f.project.id, { mode: 'native', binaryPath: process.execPath, model: 'test-model' }, 'setup'); f.install('1.0.0');
  const edit = f.service.beginRequest(f.project.id, 'local-user', 'Add this narration to the opening shot only', { scopeIds: [selectedId] });
  const turn = f.director.enqueue(f.project.id, edit); f.director.tick(); await f.director.settle();
  assert.equal(f.store.get('director_turn', turn.id).state, 'completed'); const after = f.store.getProject(f.project.id);
  assert.equal(after.shots[0].narration.text, 'Made for the road ahead.'); assert.equal(after.shots[0].narration.mode, 'generated');
  assert.deepEqual(after.shots[1], before.shots[1]); assert.deepEqual(after.narration, before.narration);
  for (const kind of ['grant', 'candidate', 'attempt', 'external_allowance', 'narration_acceptance']) assert.equal(f.store.list(kind, f.project.id).length, 0, kind);
  assert.equal(f.provider.acceptedCount(), 0);
});

test('native projection disables late historical packages while retaining their bytes and rejecting unknown discovered skills', async t => {
  const fixtureEntry = fileURLToPath(new URL('../../../packages/director/test/runtime-fixture.mjs', import.meta.url));
  const f = fixture(t, undefined, {
    setup: async input => ({ readiness: { status: 'ready' }, runtimeOptions: {
      command: { file: process.execPath, args: [fixtureEntry] }, cwd: input.directories.projection,
      env: { FIXTURE_SCENARIO: 'discover-project-skills', FIXTURE_LOG: join(f.root, 'protocol.jsonl') },
      model: 'offline-fixture', runtimeVersion: '0.153.4',
      policy: { mode: 'local', id: 'fixture', runtimeVersion: '0.153.4', config: {
        default_permissions: 'fixture', permissions: { fixture: { filesystem: { '/': 'none' }, network: { enabled: false } } }, 'skills.config': [],
      } }, limits: { requestTimeoutMs: 5000, shutdownGraceMs: 500 },
    } }),
    makeRuntime: result => new CodexDirectorRuntime(result.runtimeOptions),
  });
  await f.director.configure(f.project.id, { mode: 'native', binaryPath: process.execPath, model: 'offline-fixture' }, 'setup');
  const old = f.install('3.0.0');
  const bytes = old.lock.skills.map(skill => { const root = join(f.configuration.snapshotRoot, skill.packageDigest); return readdirSync(root, { recursive: true }).filter(file => file.endsWith('.md') || file.endsWith('.json')).map(file => [join(root, file), readFileSync(join(root, file)).toString('base64')]); }).flat();
  const human = f.service.beginRequest(f.project.id, 'local-user', 'Read the current project'), turn = f.director.enqueue(f.project.id, human);
  f.director.tick(); await f.director.settle();
  assert.equal(f.store.get('director_turn', turn.id).state, 'completed', JSON.stringify(f.store.get('director_turn', turn.id)));
  const records = () => readFileSync(join(f.root, 'protocol.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const discovered = records().find(row => row.kind === 'discovered-skills').skills;
  assert.equal(discovered.length, 4, 'both original V3 and successor V7 packages remain discoverable');
  assert.equal(discovered.filter(row => row.enabled).length, 2);
  for (const skill of old.lock.skills) assert.equal(discovered.find(row => row.path.includes(skill.packageDigest)).enabled, false);
  const current = f.store.list('director_skill_lock', f.project.id).at(-1).lock;
  for (const skill of current.skills) assert.equal(discovered.find(row => row.path.includes(skill.packageDigest)).enabled, true);
  for (const [path, before] of bytes) assert.equal(readFileSync(path).toString('base64'), before, path);
  assert.deepEqual(f.store.get('director_skill_lock', old.lock.id).lock, old.lock);
  assert.equal(records().filter(row => row.method === 'turn/start').length, 1);
  const unknown = join(f.configuration.snapshotRoot, 'not-owned'); mkdirSync(unknown);
  writeFileSync(join(unknown, 'SKILL.md'), '---\nname: unknown-third-party\ndescription: Never activated\n---\nUnowned instructions.');
  const nextHuman = f.service.beginRequest(f.project.id, 'local-user', 'Check the project again'), next = f.director.enqueue(f.project.id, nextHuman);
  f.director.tick(); await f.director.settle();
  assert.equal(f.store.get('director_turn', next.id).errorCode, 'RUNTIME_SKILLS_UNEXPECTED');
  assert.equal(f.store.get('director_turn', next.id).dispatched, false);
  assert.equal(f.store.list('native_model_start', f.project.id).length, 1, 'the second offline run fails before native dispatch');
  assert.equal(records().filter(row => row.method === 'turn/start').length, 1);
  assert.equal(f.store.list('grant', f.project.id).length, 0); assert.equal(f.store.list('attempt', f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

 test('a fresh V4 project loads V7 guidance with the notes catalog while prior V4 snapshots remain exact', t => {
  const f=fixture(t), saved=createDirectorSkillLock(f.configuration,'4.0.0','4');
  new DirectorContextService(f.service,saved.environment).bootstrapLock(f.project.id,saved.lock);
  const current=f.fresh('Use the current scene workflow'),before=f.store.getProject(f.project.id);
  const input=f.prepareInput(current.turn,current.human,current.bridge);
  assert.equal(input.bridge.toolContractVersion,'6.0.0');
  const installed=f.store.list('director_skill_lock',f.project.id).at(-1).lock;
  assert.ok(installed.skills.every(skill=>skill.version==='7.0.0'));
  const context=JSON.parse(input.context);assert.doesNotMatch(context.instructions,/finite spending approval/);assert.doesNotMatch(context.filmPlanning.procedure.join(' '),/account usage or spending allowance is separate/);
  const overview=f.service.readContext(f.project.id,current.bridge.actor,{});assert.equal(overview.applicationCapabilities.version,6);assert.doesNotMatch(JSON.stringify(overview.applicationCapabilities),/separate spending allowance|obtain human plan review/);
  assert.deepEqual(f.store.get('director_skill_lock',saved.lock.id).lock,saved.lock);
  assert.deepEqual(f.store.getProject(f.project.id),before);
  for(const kind of ['grant','candidate','attempt','external_allowance'])assert.equal(f.store.list(kind,f.project.id).length,0);
 });


function installEarlierV7(f) {
  const earlierRoot = join(f.root, 'earlier-v7-before-k1');
  for (const [path, bytes] of Object.entries(earlierV7.files)) {
    const target = join(earlierRoot, 'skills', 'v7', path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  const saved = createDirectorSkillLock({ ...f.configuration, repositoryRoot: earlierRoot }, '6.0.0');
  const { lockDigest: _, ...body } = structuredClone(saved.lock);
  body.bindings = body.bindings.map(binding => binding.kind === 'handler' ? { ...binding, digest: earlierV7.catalog.digest } : binding);
  const lock = { ...body, lockDigest: digest(body) };
  new DirectorContextService(f.service, { ...saved.environment, bindings: lock.bindings }).bootstrapLock(f.project.id, lock);
  return lock;
}

test('K1 preserves the exact earlier 6.0.0 catalog and V7 package identity alongside the amended current pins', t => {
  const f = fixture(t), previous = installEarlierV7(f);
  assert.equal(digest(earlierV7.catalog), 'cdcdbdd52bdc451888a76867f5f08af2d063f692346a6c9a63eb0226724295db');
  assert.equal(earlierV7.catalog.digest, '282275ce2d97c274f0e064357dac77a8d06e57fd8a58de37e187faf79e5a97ec');
  assert.deepEqual(previous.skills.map(({ id, packageDigest }) => ({ id, packageDigest })), [
    { id: 'plan-authoring', packageDigest: 'a618b775c426712398ede04c0db8d36b647792adbd3ae1dff263507b19498fdf' },
    { id: 'production', packageDigest: '545d188a97105db9f78d43c5f8ebd260357a537b036e670fdef9158ee6fd80e8' },
  ]);
  verifyShippedDirectorGuidance(previous, f.configuration);
  assert.equal(isCurrentShippedDirectorGuidance(previous), false);
  const current = createDirectorSkillLock(f.configuration, '6.0.0').lock;
  verifyShippedDirectorGuidance(current, f.configuration);
  assert.equal(isCurrentShippedDirectorGuidance(current), true);
  const pins = SHIPPED_DIRECTOR_GUIDANCE.filter(row => row.toolContract === '6.0.0');
  assert.equal(pins.length, 2);
  assert.equal(pins[0].handlerDigest, earlierV7.catalog.digest);
  assert.equal(pins[1].handlerDigest, toolCatalog('6.0.0').digest);
  assert.equal(pins[1].planAuthoringDigest, current.skills.find(skill => skill.id === 'plan-authoring').packageDigest);
  assert.equal(pins[1].productionDigest, current.skills.find(skill => skill.id === 'production').packageDigest);
});

test('a saved pre-K1 6.0.0/V7 project upgrades on its fresh native turn without changing old locks or snapshot bytes', t => {
  const f = fixture(t), previous = installEarlierV7(f);
  const snapshotFiles = previous.skills.flatMap(skill => {
    const root = join(f.configuration.snapshotRoot, skill.packageDigest);
    return readdirSync(root, { recursive: true }).filter(path => path.endsWith('.md') || path.endsWith('.json')).map(path => [join(root, path), readFileSync(join(root, path), 'utf8')]);
  });
  const fresh = f.fresh('Make keyframes for the whole film');
  const input = f.prepareInput(fresh.turn, fresh.human, fresh.bridge), current = f.store.list('director_skill_lock', f.project.id).at(-1).lock;
  assert.notEqual(current.id, previous.id); assert.equal(isCurrentShippedDirectorGuidance(current), true);
  assert.equal(JSON.parse(input.context).toolContract.digest, toolCatalog('6.0.0').digest);
  assert.equal(f.store.get('director_epoch_lock', fresh.bridge.actor.epochId).lockId, current.id);
  assert.deepEqual(f.store.get('director_skill_lock', previous.id).lock, previous);
  for (const [path, content] of snapshotFiles) assert.equal(readFileSync(path, 'utf8'), content);
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2);
  f.prepareInput(fresh.turn, fresh.human, fresh.bridge);
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2, 'repeated preparation keeps one amendment lock');
  for (const kind of ['grant', 'candidate', 'attempt', 'reservation']) assert.equal(f.store.list(kind, f.project.id).length, 0, 'upgrading guidance grants no generation authority');
  assert.equal(f.provider.acceptedCount(), 0);
});

test('an explicit pre-K1 6.0.0 amendment reports its availability and replays without reinstalling', t => {
  const f = fixture(t), previous = installEarlierV7(f), before = f.store.getProject(f.project.id);
  assert.equal(f.settings.status(f.project.id).upgradeAvailable, true);
  const input = { expectedLockId: previous.id, expectedLockDigest: previous.lockDigest, targetVersion: '6.0.0' };
  const result = f.settings.upgrade(f.project.id, input, 'explicit-k1-amendment');
  assert.equal(result.upgradeAvailable, false); assert.notEqual(result.lockId, previous.id);
  assert.equal(isCurrentShippedDirectorGuidance(f.store.get('director_skill_lock', result.lockId).lock), true);
  assert.deepEqual(f.store.get('director_skill_lock', previous.id).lock, previous);
  assert.deepEqual(f.store.getProject(f.project.id), before);
  const cursor = f.store.cursor(f.project.id);
  const replay = new DirectorToolSettings(f.service, () => { throw Error('Replay must not reload packages'); });
  assert.deepEqual(replay.upgrade(f.project.id, input, 'explicit-k1-amendment'), result);
  assert.equal(f.store.cursor(f.project.id), cursor); assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2);
  assert.throws(() => f.settings.upgrade(f.project.id, { expectedLockId: result.lockId,
    expectedLockDigest: result.lockDigest, targetVersion: '6.0.0' }, 'already-current'), { code: 'DIRECTOR_TOOLS_STALE' });
  for (const kind of ['message', 'epoch', 'grant', 'candidate', 'attempt', 'reservation'])
    assert.equal(f.store.list(kind, f.project.id).length, 0);
});

test('an explicit same-version amendment refuses an unrecognized predecessor identity', t => {
  const f = fixture(t), previous = installEarlierV7(f), { lockDigest: _, ...body } = structuredClone(previous);
  body.id = newId(); body.bindings = body.bindings.map(binding => binding.kind === 'handler'
    ? { ...binding, digest: 'a'.repeat(64) } : binding);
  const custom = { ...body, lockDigest: digest(body) };
  f.store.insert('director_skill_lock', custom.id, f.project.id, { id: custom.id, projectId: f.project.id, lock: custom });
  assert.throws(() => f.settings.upgrade(f.project.id, { expectedLockId: custom.id,
    expectedLockDigest: custom.lockDigest, targetVersion: '6.0.0' }, 'unknown-amendment'), { code: 'DIRECTOR_GUIDANCE_UNSUPPORTED' });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2);
  for (const kind of ['grant', 'candidate', 'attempt', 'reservation']) assert.equal(f.store.list(kind, f.project.id).length, 0);
});
