import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { digest, newId } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { CodexDirectorRuntime } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { DirectorToolSettings } from '../dist/application/director-tools-upgrade.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { installRecoveryQuarantine } from '../dist/application/installation-recovery.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
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

for (const version of ['1.0.0', '2.0.0', '3.0.0', '4.0.0']) test(`next native ${version} request automatically loads V6 while historical evidence and all production authority stay unchanged`, async t => {
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
  assert.equal(input.resumeThreadId, undefined); assert.equal(input.bridge.toolContractVersion, '5.0.0');
  assert.equal(context.toolContract.lockId, successor.id); assert.equal(context.toolContract.lockDigest, successor.lockDigest);
  assert.equal(context.filmPlanning.narrationWriting.toolAvailable, true); assert.equal(context.filmPlanning.narrationWriting.upgradeRequired, false);
  assert.equal(context.snapshot.applicationCapabilities.narration.speechSynthesis.toolAvailable, true, 'the FIRST native snapshot advertises its actual bound catalog');
  assert.equal(context.snapshot.applicationCapabilities.narration.transcription.toolAvailable, true);
  assert.equal(context.snapshot.guard.applicationCapabilitiesDigest, digest(context.snapshot.applicationCapabilities));
  assert.ok(context.filmPlanning.procedure.some(text => text.includes('Writing needs no generation or spending permission')));
  assert.equal(f.store.get('director_epoch_lock', input.epochId).lockId, successor.id);
  assert.deepEqual(f.store.get('director_skill_lock', saved.lock.id).lock, saved.lock);
  assert.equal(f.store.get('director_epoch_lock', oldBridge.actor.epochId).lockId, saved.lock.id);
  assert.deepEqual(f.store.get('director_context', captured.activation.contextSnapshotId).snapshot, captured.snapshot);
  assert.deepEqual(f.store.getProject(f.project.id), canonical);
  for (const kind of preservedKinds) assert.deepEqual(f.store.list(kind, f.project.id), preserved[kind], kind);
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
  for (const variant of ['custom', 'tampered', 'unsupported']) {
    const f = fixture(t); await f.director.configure(f.project.id, { mode: 'native', binaryPath: process.execPath, model: 'test-model' }, 'setup');
    const shipped = createDirectorSkillLock(f.configuration, '1.0.0').lock;
    const { lockDigest: _, ...body } = shipped;
    if (variant === 'custom') body.prompts = body.prompts.slice(0, 1);
    if (variant === 'unsupported') body.compatibility = { ...body.compatibility, toolContract: '99.0.0' };
    const lock = { ...body, lockDigest: variant === 'tampered' ? '0'.repeat(64) : digest(body) };
    f.store.insert('director_skill_lock', lock.id, f.project.id, { id: lock.id, projectId: f.project.id, lock });
    const before = f.store.getProject(f.project.id), human = f.service.beginRequest(f.project.id, 'local-user', 'Use this project'), turn = f.director.enqueue(f.project.id, human);
    f.director.tick(); await f.director.settle();
    assert.equal(f.store.get('director_turn', turn.id).errorCode, 'DIRECTOR_GUIDANCE_UNSUPPORTED');
    assert.match(f.director.status(f.project.id).message, /Saved work is retained/);
    assert.equal(f.calls.length, 0); assert.equal(f.store.list('native_model_start', f.project.id).length, 0);
    assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1); assert.deepEqual(f.store.getProject(f.project.id), before);
  }
});

test('compatible maintenance is fenced by installation recovery and never rewrites restored authority', t => {
  const f = fixture(t); f.install('2.0.0'); const current = f.fresh('Restored request');
  installRecoveryQuarantine(f.store, { restoreId: newId(), backupId: newId(), backupManifestSha256: 'a'.repeat(64), sourceDatabaseSha256: 'b'.repeat(64),
    originalDataRoot: f.root, backupCreatedAt: '2026-10-02T00:00:00.000Z', restoredAt: '2026-10-03T00:00:00.000Z' });
  assert.throws(() => f.prepareInput(current.turn, current.human, current.bridge), { code: 'INSTALLATION_QUARANTINED' });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1); assert.equal(f.calls.length, 0);
});

test('a repeated first-input preparation keeps one successor and one epoch binding', t => {
  const f = fixture(t); f.install('3.0.0'); const current = f.fresh('Fresh V4 input');
  const first = f.prepareInput(current.turn, current.human, current.bridge), second = f.prepareInput(current.turn, current.human, current.bridge);
  assert.equal(first.bridge.toolContractVersion, '5.0.0'); assert.equal(second.bridge.toolContractVersion, '5.0.0');
  assert.equal(JSON.parse(first.context).toolContract.lockId, JSON.parse(second.context).toolContract.lockId);
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2); assert.equal(f.store.list('director_epoch_lock', f.project.id).length, 1);
  assert.equal(f.store.db.prepare("SELECT count(*) total FROM events WHERE project_id=? AND json_extract(body,'$.kind')='director.lock_installed' AND json_extract(body,'$.payload.source')='application_compatible_upgrade'").get(f.project.id).total, 1);
});

test('changed predecessor snapshot bytes and setup configuration fail before installing a successor', t => {
  const f = fixture(t), saved = f.install('2.0.0'), current = f.fresh('Verify old guidance');
  const entry = join(f.configuration.snapshotRoot, saved.lock.skills[0].packageDigest, 'SKILL.md');
  chmodSync(entry, 0o600); writeFileSync(entry, 'Changed saved package');
  assert.throws(() => f.prepareInput(current.turn, current.human, current.bridge), { code: 'DIRECTOR_GUIDANCE_UNSUPPORTED' });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1);
  const g = fixture(t); g.install('3.0.0'); const next = g.fresh('Verify setup'); let count = 0;
  const settings = new DirectorToolSettings(g.service, () => (++count === 1 ? g.configuration : { ...g.configuration, runtimeId: 'changed-runtime' }));
  assert.throws(() => settings.currentForFreshTurn(g.project.id, next.bridge.actor, next.turn.id), { code: 'DIRECTOR_TOOLS_STALE' });
  assert.equal(g.store.list('director_skill_lock', g.project.id).length, 1);
});

test('a migrated shot-scoped request writes its script through V4 without generation permission or project-wide narration edits', async t => {
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
  assert.equal(f.store.get('director_turn', turn.id).state, 'completed');
  const records = () => readFileSync(join(f.root, 'protocol.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const discovered = records().find(row => row.kind === 'discovered-skills').skills;
  assert.equal(discovered.length, 4, 'both original V3 and successor V4 packages remain discoverable');
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

 test('a fresh V4 project loads V6 guidance with the notes catalog while prior V4 snapshots remain exact', t => {
  const f=fixture(t), saved=createDirectorSkillLock(f.configuration,'4.0.0','4');
  new DirectorContextService(f.service,saved.environment).bootstrapLock(f.project.id,saved.lock);
  const current=f.fresh('Use the current scene workflow'),before=f.store.getProject(f.project.id);
  const input=f.prepareInput(current.turn,current.human,current.bridge);
  assert.equal(input.bridge.toolContractVersion,'5.0.0');
  const installed=f.store.list('director_skill_lock',f.project.id).at(-1).lock;
  assert.ok(installed.skills.every(skill=>skill.version==='6.0.0'));
  const context=JSON.parse(input.context);assert.doesNotMatch(context.instructions,/finite spending approval/);assert.doesNotMatch(context.filmPlanning.procedure.join(' '),/account usage or spending allowance is separate/);
  const overview=f.service.readContext(f.project.id,current.bridge.actor,{});assert.equal(overview.applicationCapabilities.version,6);assert.doesNotMatch(JSON.stringify(overview.applicationCapabilities),/separate spending allowance|obtain human plan review/);
  assert.deepEqual(f.store.get('director_skill_lock',saved.lock.id).lock,saved.lock);
  assert.deepEqual(f.store.getProject(f.project.id),before);
  for(const kind of ['grant','candidate','attempt','external_allowance'])assert.equal(f.store.list(kind,f.project.id).length,0);
 });
