import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, newId, parseToolArguments, toolCatalog } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { SKILL_LIMITS, verifySkillLockSnapshots } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { DirectorToolSettings } from '../dist/application/director-tools-upgrade.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { SHIPPED_DIRECTOR_RELEASES, isCurrentShippedDirectorGuidance, verifyShippedDirectorGuidance } from '../dist/application/director-shipped-guidance.js';
import { contractSevenRepository, seven } from './helpers/contract-seven-fixture.mjs';
import { projectFixture } from './execution-fixture.mjs';
import { packageDigest } from '../../../packages/director/test/skill-release-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const code = async (promise) => { try { await promise; } catch (error) { return error.code; } assert.fail('expected a refusal'); };
function writable(path) { chmodSync(path, 0o700); for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name)); }
const setProject = (f, fields) => f.store.saveProject({ ...f.saved(), ...fields }, f.head());
/** A fresh request, epoch and running turn with nothing captured yet. */
function freshTurn(f, { text = 'Plan the film.', editing = true, runtimeId = 'offline-release' } = {}) {
  for (const prior of f.store.list('director_turn', f.project.id).filter(turn => turn.state === 'running'))
    f.store.put('director_turn', prior.id, f.project.id, { ...prior, state: 'completed' });
  const human = f.service.beginRequest(f.project.id, 'local-user', text, { editing });
  const bridge = f.service.openEpoch(f.project.id, human);
  const turn = { id: newId(), projectId: f.project.id, requestId: human.requestId, epochId: bridge.actor.epochId, runtimeId, state: 'running',
    dispatched: false, nativeThreadId: null, nativeTurnId: null, owner: null, leaseExpiresAt: 0, errorCode: null, createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' };
  f.store.insert('director_turn', turn.id, f.project.id, turn);
  return { human, bridge, turn, call: (tool, input, callId = randomUUID()) => f.tools.invoke(f.project.id, bridge.actor, callId, tool, input) };
}
const prepare = (f, turn) => createDirectorInput(f.service, { ...f.skillConfiguration, endpoint: 'http://127.0.0.1:3101' })(turn.turn, turn.human, turn.bridge);

test('read_guidance joins only the 7.0.0 catalog; the 6.0.0 catalog is unchanged', () => {
  assert.ok(toolCatalog('7.0.0').names.includes('read_guidance'));
  assert.ok(!toolCatalog('6.0.0').names.includes('read_guidance'));
  const tool = toolCatalog('7.0.0').descriptors.find(item => item.name === 'read_guidance');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(parseToolArguments('read_guidance', { package: 'craft-story' }, '7.0.0').arguments, { package: 'craft-story' });
  for (const input of [{}, { package: 'Craft' }, { package: 'craft-story', path: '/etc/passwd' }, { package: 'craft-story', path: 'a.txt' }, { package: 'craft-story', extra: 1 }])
    assert.throws(() => parseToolArguments('read_guidance', input, '7.0.0'), JSON.stringify(input));
});

test('a release lock injects only the routed entries and the core references, and Codex enables only routed skills', t => {
  const f = seven(t);
  assert.equal(f.lock.schemaVersion, 2); assert.equal(f.lock.skills.length, 6);
  setProject(f, { filmKind: 'music_video' });
  const turn = freshTurn(f), input = prepare(f, turn), context = JSON.parse(input.context);
  const routed = ['production', 'plan-authoring', 'type-music-video', 'craft-story'];
  assert.deepEqual(context.references.map(ref => `${ref.skillId}/${ref.path}`),
    [...routed.map(id => `${id}/SKILL.md`), 'production/references/current-contract.md', 'production/references/notes.md']);
  assert.deepEqual(input.skills.map(skill => skill.name).sort(), [...routed].sort(), 'native input enables exactly the routed packages');
  assert.deepEqual(context.guidance.routing.selected, routed);
  assert.equal(context.guidance.routing.reasons['type-music-video'], 'route:type');
  assert.deepEqual(context.guidance.packages.map(item => [item.package, item.injected]).sort(),
    [['craft-characters', false], ['craft-story', true], ['format-social-vertical', false], ['plan-authoring', true], ['production', true], ['type-music-video', true]]);
  assert.match(context.instructions, /read_guidance \{package, path\}/);
  // Lazy: nothing beyond entries and the two core references, so references and stage files stay out of context.
  for (const marker of ['MUSIC-VIDEO-SECTION-MAP', 'CRAFT-STORY-FRAMEWORKS']) assert.doesNotMatch(input.context, new RegExp(marker));
  assert.ok(!context.references.some(ref => ref.path.startsWith('references/stages/')));
  const locked = verifySkillLockSnapshots(f.lock, f.skillConfiguration.snapshotRoot);
  const allBytes = locked.reduce((sum, skill) => sum + skill.files.filter(file => file.path.endsWith('.md')).reduce((total, file) => total + file.bytes, 0), 0);
  const injectedBytes = context.references.reduce((sum, ref) => sum + Buffer.byteLength(ref.content), 0);
  const lazyBytes = allBytes - injectedBytes;
  console.log(`release context: injected ${injectedBytes} of ${allBytes} locked guidance bytes; context ${Buffer.byteLength(input.context)} bytes`);
  assert.ok(lazyBytes > injectedBytes / 2, `most stage and reference text stays lazy: ${lazyBytes} lazy, ${injectedBytes} injected`);
  assert.ok(Buffer.byteLength(input.context) < allBytes + 64 * 1024, 'the whole context is smaller than the locked guidance plus snapshot');
  // The activation records the routing decision; every injected file left a skill_read marked inject.
  const activation = f.store.list('skill_activation', f.project.id).at(-1);
  assert.equal(activation.activation.schemaVersion, 2); assert.equal(activation.activation.readable, 'lock');
  assert.deepEqual(activation.activation.routing.selected, routed);
  const reads = f.store.list('skill_read', f.project.id).filter(row => row.epochId === turn.bridge.actor.epochId);
  assert.equal(reads.length, context.references.length); assert.ok(reads.every(row => row.via === 'inject' && row.evidence.via === 'inject'));
});

test('routing follows saved facts: general falls back, characters add their craft package on the next turn', t => {
  const f = seven(t);
  let context = JSON.parse(prepare(f, freshTurn(f)).context);
  assert.deepEqual(context.guidance.routing.selected, ['production', 'plan-authoring', 'craft-story']);
  assert.equal(context.guidance.routing.reasons['craft-story'], 'fallback');
  setProject(f, { filmKind: 'music_video', characters: [{ id: 'c1', revisionId: 'r1', name: 'Mara', identity: 'Tall, short dark hair.', wardrobe: [], sheet: null }] });
  context = JSON.parse(prepare(f, freshTurn(f)).context);
  assert.deepEqual(context.guidance.routing.selected, ['production', 'plan-authoring', 'type-music-video', 'craft-story', 'craft-characters']);
  assert.equal(context.guidance.routing.reasons['craft-characters'], 'when:has_characters');
  assert.deepEqual(context.guidance.routing.selected, f.store.list('skill_activation', f.project.id).at(-1).activation.routing.selected);
});

test('read_guidance reads any package in the conversation\'s lock, records a skill_read and changes nothing', async t => {
  const f = seven(t), turn = f.openTurn({ editing: false, text: 'Discuss the song.' }), before = f.saved();
  const read = await turn.call('read_guidance', { package: 'craft-characters' });
  assert.equal(read.package, 'craft-characters'); assert.equal(read.path, 'SKILL.md');
  assert.match(read.content, /^---\nname: craft-characters/);
  assert.equal(read.packageDigest, f.lock.skills.find(skill => skill.id === 'craft-characters').packageDigest);
  assert.equal(read.sha256, createHash('sha256').update(read.content).digest('hex'));
  const reference = await turn.call('read_guidance', { package: 'type-music-video', path: 'references/section-map.md' });
  assert.match(reference.content, /MUSIC-VIDEO-SECTION-MAP/);
  const rows = f.store.list('skill_read', f.project.id).filter(row => row.epochId === turn.bridge.actor.epochId && row.via === 'read_guidance');
  assert.deepEqual(rows.map(row => `${row.evidence.skillId}/${row.evidence.path}`), ['craft-characters/SKILL.md', 'type-music-video/references/section-map.md']);
  assert.ok(rows.every(row => row.evidence.via === 'read_guidance' && row.bytes > 0));
  assert.deepEqual(f.saved(), before, 'reading guidance never changes the film');
  // Scope: only packages and declared files of this lock.
  assert.equal(await code(turn.call('read_guidance', { package: 'craft-music-timing' })), 'SKILL_NOT_LOCKED');
  assert.equal(await code(turn.call('read_guidance', { package: 'craft-story', path: 'references/missing.md' })), 'SKILL_PACKAGE_INVALID');
  assert.equal(await code(turn.call('read_guidance', { package: 'craft-story', path: 'openslate.skill.json' })), 'SKILL_PACKAGE_INVALID');
  assert.equal(await code(turn.call('read_guidance', { package: 'craft-story', path: 'references/../SKILL.md' })), 'SKILL_PACKAGE_INVALID');
  const calls = f.store.list('tool_invocation', f.project.id).filter(call => call.tool === 'read_guidance');
  assert.deepEqual(calls.map(call => call.state).sort(), ['failed', 'failed', 'failed', 'failed', 'succeeded', 'succeeded']);
});

test('read_guidance works in keyframe reviews and stops at the per-conversation read limit', async t => {
  const f = seven(t), turn = f.openTurn();
  f.store.insert('keyframe_review_request', turn.human.requestId, f.project.id, { requestId: turn.human.requestId, action: 'keyframe_review', sceneId: 'scene-0', batchDigest: 'offline' });
  assert.equal((await turn.call('read_guidance', { package: 'craft-story' })).package, 'craft-story');
  for (let index = 1; index < SKILL_LIMITS.guidanceReadsPerActivation; index++) await turn.call('read_guidance', { package: 'craft-characters' });
  assert.equal(await code(turn.call('read_guidance', { package: 'craft-story' })), 'GUIDANCE_READ_LIMIT');
  assert.equal(f.store.list('skill_read', f.project.id).filter(row => row.epochId === turn.bridge.actor.epochId && row.via === 'read_guidance').length, SKILL_LIMITS.guidanceReadsPerActivation);
  // A new conversation starts with a fresh allowance.
  assert.equal((await f.openTurn().call('read_guidance', { package: 'craft-story' })).package, 'craft-story');
});

test('a 6.0.0 conversation keeps its V7 lock: read_guidance is unknown and all V7 files are injected as before', async t => {
  const f = seven(t, { version: '6.0.0' });
  assert.equal(f.lock.schemaVersion, 1);
  const turn = freshTurn(f), input = prepare(f, turn), context = JSON.parse(input.context);
  assert.equal(input.bridge.toolContractVersion, '6.0.0'); assert.equal(context.guidance, undefined);
  const files = verifySkillLockSnapshots(f.lock, f.skillConfiguration.snapshotRoot).flatMap(skill => skill.manifest.files.map(path => `${skill.id}/${path}`));
  assert.deepEqual(context.references.map(ref => `${ref.skillId}/${ref.path}`).sort(), files.sort());
  assert.equal(f.store.list('skill_activation', f.project.id).at(-1).activation.schemaVersion, 1);
  assert.equal(await code(turn.call('read_guidance', { package: 'production' })), 'NOT_FOUND');
});

/** A saved V7 (6.0.0) native project, ready for a fresh native turn with a synthetic shipped v8 release. */
function upgradeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-release-upgrade-'));
  const store = new Store(join(root, 'app.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  let project = service.createProject('Release upgrade');
  const shape = projectFixture(project.id, 1);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId,
    shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.insert('project_revision', project.revisionId, project.id, { project });
  t.after(() => { provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  const snapshotRoot = join(root, 'native', project.id, 'workspace', '.agents', 'skills');
  const saved = createDirectorSkillLock({ repositoryRoot, snapshotRoot, runtimeId: 'codex-app-server' }, '6.0.0');
  new DirectorContextService(service, saved.environment).bootstrapLock(project.id, saved.lock);
  const checkout = contractSevenRepository(join(root, 'checkout'));
  const releaseDigest = digest(JSON.parse(readFileSync(join(checkout, 'skills/v8/release.json'), 'utf8')));
  const releases = [{ toolContract: '7.0.0', guidanceVersion: '8.0.0', handlerDigest: toolCatalog('7.0.0').digest, releaseDigest }];
  const configuration = { repositoryRoot: checkout, snapshotRoot, runtimeId: 'codex-app-server' };
  const f = { root, store, provider, service, project, v7: saved, releases, configuration, tools: new ToolInvocationService(service) };
  f.saved = () => store.getProject(project.id); f.head = () => f.saved().headVersion;
  f.settings = (rows = releases) => new DirectorToolSettings(service, () => configuration, () => false, rows);
  f.prepare = (turn, settings = f.settings()) => createDirectorInput(service, { ...configuration, endpoint: 'http://127.0.0.1:3101', freshTurnGuidance: settings })(turn.turn, turn.human, turn.bridge);
  return f;
}

test('with no shipped release, fresh native turns keep upgrading within 6.0.0 exactly as before', t => {
  const f = upgradeFixture(t);
  assert.deepEqual(SHIPPED_DIRECTOR_RELEASES, [], 'no v8 release ships yet');
  const turn = freshTurn(f, { runtimeId: 'codex-app-server' }), input = f.prepare(turn, f.settings([]));
  assert.equal(input.bridge.toolContractVersion, '6.0.0');
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1, 'the current V7 identity needs no successor');
  assert.equal(f.settings([]).status(f.project.id).availableVersion, '6.0.0');
});

test('a fresh native turn upgrades a saved V7 lock to the shipped v8 release; held 6.0.0 proposals stay acceptable', async t => {
  const f = upgradeFixture(t);
  // A 6.0.0 conversation holds a proposal for the person.
  const first = freshTurn(f, { editing: false, text: 'Discuss and propose a slower shot.', runtimeId: 'codex-app-server' });
  new DirectorContextService(f.service, f.v7.environment).capture(f.project.id, first.bridge.actor, { lockId: f.v7.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  const proposal = await first.call('propose_change', { patch: { updateShots: [{ id: 'shot-0', desiredFrames: 240 }] } });
  assert.equal(f.store.get('director_proposal', proposal.proposalId).state, 'held');
  const settings = f.settings();
  assert.equal(settings.status(f.project.id).upgradeAvailable, true); assert.equal(settings.status(f.project.id).availableVersion, '7.0.0');
  // The next fresh native turn installs the release lock as a successor and routes it.
  const next = freshTurn(f, { text: 'Accept the proposal.', runtimeId: 'codex-app-server' }), input = f.prepare(next, settings);
  const locks = f.store.list('director_skill_lock', f.project.id), successor = locks.at(-1).lock;
  assert.equal(locks.length, 2); assert.equal(successor.schemaVersion, 2); assert.equal(successor.release.releaseDigest, f.releases[0].releaseDigest);
  assert.deepEqual(f.store.get('director_skill_lock', f.v7.lock.id).lock, f.v7.lock, 'the predecessor row is unchanged');
  assert.ok(isCurrentShippedDirectorGuidance(successor, f.releases)); assert.ok(!isCurrentShippedDirectorGuidance(f.v7.lock, f.releases));
  verifyShippedDirectorGuidance(successor, f.configuration, f.releases);
  const event = f.store.db.prepare("SELECT body FROM events WHERE project_id=? AND body LIKE '%director.lock_installed%' ORDER BY sequence DESC LIMIT 1").get(f.project.id);
  assert.match(event.body, /application_compatible_upgrade/); assert.match(event.body, new RegExp(f.v7.lock.id));
  assert.equal(input.bridge.toolContractVersion, '7.0.0');
  assert.deepEqual(JSON.parse(input.context).guidance.routing.selected, ['production', 'plan-authoring', 'craft-story']);
  // Every release package's snapshot is disabled-by-default native input except the routed ones.
  assert.deepEqual(input.skills.map(skill => skill.name).sort(), ['craft-story', 'plan-authoring', 'production']);
  assert.equal(settings.status(f.project.id).upgradeAvailable, false);
  // The held 6.0.0 proposal is accepted from the 7.0.0 conversation.
  const accepted = await next.call('accept_proposal', { proposalId: proposal.proposalId });
  assert.equal(accepted.state ?? accepted.proposal?.state, 'accepted', JSON.stringify(accepted));
  assert.equal(f.saved().shots.find(shot => shot.id === 'shot-0').desiredFrames, 240);
  // A later fresh turn keeps the current release lock.
  f.prepare(freshTurn(f, { text: 'Continue.', runtimeId: 'codex-app-server' }), settings);
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 2);
});

test('the release upgrade refuses a checkout whose release differs from the shipped pin', t => {
  const f = upgradeFixture(t);
  const rows = [{ ...f.releases[0], releaseDigest: '0'.repeat(64) }];
  assert.throws(() => f.prepare(freshTurn(f, { runtimeId: 'codex-app-server' }), f.settings(rows)), { code: 'DIRECTOR_GUIDANCE_FILES_UNAVAILABLE' });
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1);
  assert.equal(packageDigest(join(f.configuration.repositoryRoot, 'skills/v8/craft-story')).length, 64);
});

test('the manual upgrade can target the shipped release, and a release lock is current afterwards', t => {
  const f = upgradeFixture(t), settings = f.settings();
  const status = settings.status(f.project.id);
  const result = settings.upgrade(f.project.id, { expectedLockId: status.lockId, expectedLockDigest: status.lockDigest, targetVersion: '7.0.0' }, 'upgrade-1');
  assert.equal(result.receipt.toolContract, '7.0.0'); assert.equal(result.upgradeAvailable, false);
  assert.equal(f.store.list('director_skill_lock', f.project.id).at(-1).lock.schemaVersion, 2);
  assert.throws(() => f.settings([]).upgrade(f.project.id, { expectedLockId: result.lockId, expectedLockDigest: result.lockDigest, targetVersion: '7.0.0' }, 'upgrade-2'), { code: 'VALIDATION_ERROR' });
});
