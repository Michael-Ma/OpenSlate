import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, toolCatalog } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { createApp } from '../dist/app.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const draft = text => ({ text, textKind: 'draft', language: 'en', meaning: text, source: { kind: 'generated', voice: null, profileRevisionId: null } });
function writable(path) { chmodSync(path, 0o755); for (const item of readdirSync(path, { withFileTypes: true })) if (item.isDirectory()) writable(join(path, item.name)); }
function fixture(t, version = '2.0.0') {
  const root = mkdtempSync(join(tmpdir(), 'openslate-narration-tools-'));
  const provider = new FakeProvider(join(root, 'provider.sqlite'));
  const config = { repositoryRoot, snapshotRoot: join(root, 'skills'), endpoint: 'http://127.0.0.1:3001' };
  let store, service, tools, input;
  const reopen = () => {
    if (store?.db.open) store.close();
    store = new Store(join(root, 'state.sqlite')); service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
    tools = new ToolInvocationService(service); input = createDirectorInput(service, config);
    return { store, service, tools, input };
  };
  reopen(); const project = service.createProject('Narration tools');
  const configured = createDirectorSkillLock(config, version);
  new DirectorContextService(service, configured.environment).bootstrapLock(project.id, configured.lock);
  const activate = (text = 'Write the missing narration', options = {}) => {
    const human = service.beginRequest(project.id, 'human', text, options), bridge = service.openEpoch(project.id, human);
    const runInput = input({ id: 'test-turn', projectId: project.id, requestId: human.requestId }, human, bridge);
    return { human, bridge, runInput };
  };
  const first = activate();
  t.after(() => { store.close(); provider.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  return { root, config, project, provider, store, service, tools, input, lock: configured.lock, activate, reopen, ...first };
}

test('v2 saves narration drafts without media tools and preserves exact unrelated acceptance and canonical state', async t => {
  const f = fixture(t), before = f.store.getProject(f.project.id), holds = f.store.list('hold', f.project.id);
  const first = await f.tools.invoke(f.project.id, f.bridge.actor, 'add', 'revise_narration_draft', { expectedVersion: 0, patch: { add: [draft('Handmade leather'), draft('Built to last')] } });
  assert.equal(first.version, 1); assert.equal(first.canonicalApplied, false); assert.equal(first.segments.length, 2);
  const accepted = f.tools.narration.accept(f.project.id, f.human, 1, 'accept-script', 'script', first.segments.map(row => row.segmentRevisionId));
  const next = await f.tools.invoke(f.project.id, f.bridge.actor, 'edit', 'revise_narration_draft', { expectedVersion: 2, patch: { update: [{ segmentId: first.segments[0].segmentId, draft: draft('Crafted leather boots') }] } });
  const saved = f.tools.narration.snapshot(f.project.id, f.bridge.actor);
  assert.equal(next.version, 3); assert.equal(saved.segments[0].accepted.script, false); assert.equal(saved.segments[1].accepted.script, true);
  assert.deepEqual(saved.segments[1].entry, accepted.segments[1].entry);
  assert.deepEqual(f.store.getProject(f.project.id), before); assert.deepEqual(f.store.list('hold', f.project.id), holds);
  assert.equal(f.store.list('attempt', f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
  assert.throws(() => f.tools.narration.accept(f.project.id, f.bridge.actor, 3, 'forged', 'script', [next.segments[0].segmentRevisionId]), { code: 'ACTOR_DENIED' });
});

test('schema forbids human decisions, media/timing fields, and canonical narration through v2 prepare', async t => {
  const f = fixture(t);
  for (const patch of [{ add: [{ ...draft('x'), accepted: true }] }, { add: [{ ...draft('x'), audioId: 'recording' }] },
    { add: [{ ...draft('x'), source: { kind: 'uploaded', path: '/private/secret' } }] }, { placements: [] }, { accept: ['script'] }])
    await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'forged', 'revise_narration_draft', { expectedVersion: 0, patch }), { code: 'VALIDATION_ERROR' });
  for (const creative of [{ narrationScript: 'bypass' }, { narrationSource: 'uploaded' }])
    await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'canonical', 'prepare_change', { variant: 'project', expectedHeadVersion: 0, creative }), { code: 'VALIDATION_ERROR' });
  assert.equal(f.store.list('narration_revision', f.project.id).length, 0); assert.equal(f.store.list('tool_invocation', f.project.id).length, 0);
});

test('old locks and unbound old epochs cannot acquire v2 capabilities from model arguments or new defaults', async t => {
  const f = fixture(t, '1.0.0');
  assert.equal(f.runInput.bridge.toolContractVersion, '1.0.0');
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'new-tool', 'revise_narration_draft', { expectedVersion: 0, patch: { add: [draft('x')] } }), { code: 'NOT_FOUND' });
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'new-section', 'read_context', { section: 'narration' }), { code: 'VALIDATION_ERROR' });
  const legacy = await f.tools.invoke(f.project.id, f.bridge.actor, 'legacy-prepare', 'prepare_change', { variant: 'project', expectedHeadVersion: 0, creative: { narrationScript: 'Legacy behavior' } });
  assert.ok(legacy.preparedId);
  const r = f.reopen(), human = r.service.beginRequest(f.project.id, 'human', 'Continue after restart'), bridge = r.service.openEpoch(f.project.id, human);
  const next = r.input({ id: 'next-turn', projectId: f.project.id, requestId: human.requestId }, human, bridge);
  assert.equal(next.bridge.toolContractVersion, '1.0.0'); assert.equal(r.store.list('director_skill_lock', f.project.id).length, 1);
  const other = r.service.createProject('Old unbound'), otherHuman = r.service.beginRequest(other.id, 'human', 'Draft'), unbound = r.service.openEpoch(other.id, otherHuman);
  await assert.rejects(r.tools.invoke(other.id, unbound.actor, 'new-tool', 'revise_narration_draft', { expectedVersion: 0, patch: { add: [draft('x')] } }), { code: 'NOT_FOUND' });
});

test('new project configuration defaults to v2 and existing epochs retain their selected lock', async t => {
  const f = fixture(t, '1.0.0'), successor = createDirectorSkillLock(f.config, '2.0.0');
  new DirectorContextService(f.service, successor.environment).installLock(f.project.id, f.human, successor.lock);
  const same = f.input({ id: 'same-turn', projectId: f.project.id, requestId: f.human.requestId }, f.human, f.bridge);
  assert.equal(same.bridge.toolContractVersion, '1.0.0');
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'old-still', 'revise_narration_draft', { expectedVersion: 0, patch: { add: [draft('x')] } }), { code: 'NOT_FOUND' });
  assert.equal(f.activate('Fresh request after explicit upgrade').runInput.bridge.toolContractVersion, '2.0.0');
  const project = f.service.createProject('New default'), human = f.service.beginRequest(project.id, 'human', 'Hello', { editing: false }), bridge = f.service.openEpoch(project.id, human);
  const fresh = f.input({ id: 'new-turn', projectId: project.id, requestId: human.requestId }, human, bridge);
  assert.equal(fresh.bridge.toolContractVersion, '2.0.0'); assert.equal(f.store.list('hold', project.id).length, 0);
});

test('draft command replay survives restart and old versions cannot append duplicate sections', async t => {
  const f = fixture(t), args = { expectedVersion: 0, patch: { add: [draft('Saved once')] } };
  const saved = await f.tools.invoke(f.project.id, f.bridge.actor, 'stable', 'revise_narration_draft', args);
  const r = f.reopen(), cursor = r.store.cursor(f.project.id);
  assert.deepEqual(await r.tools.invoke(f.project.id, f.bridge.actor, 'stable', 'revise_narration_draft', args), saved);
  assert.equal(r.store.cursor(f.project.id), cursor);
  await assert.rejects(r.tools.invoke(f.project.id, f.bridge.actor, 'stable', 'revise_narration_draft', { ...args, patch: { add: [draft('different')] } }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(r.tools.invoke(f.project.id, f.bridge.actor, 'different-native-call', 'revise_narration_draft', args), { code: 'REVISION_CONFLICT' });
  assert.equal(r.tools.narration.snapshot(f.project.id, f.bridge.actor).segments.length, 1);
  const record = r.store.list('tool_invocation', f.project.id)[0];
  assert.equal(record.toolContractVersion, '2.0.0'); assert.equal(record.catalogDigest, toolCatalog('2.0.0').digest); assert.equal(record.skillLockId, f.lock.id);
});

test('uncertain draft completion reconciles exact domain receipt after restart without repeating mutation', async t => {
  const f = fixture(t), original = f.tools.narration.reviseSegments.bind(f.tools.narration);
  f.tools.narration.reviseSegments = (...args) => { original(...args); throw new Error('lost domain response'); };
  const args = { expectedVersion: 0, patch: { add: [draft('Durable text')] } };
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'uncertain', 'revise_narration_draft', args), { code: 'TOOL_CALL_UNRESOLVED' });
  const r = f.reopen();
  await assert.rejects(r.tools.invoke(f.project.id, f.bridge.actor, 'uncertain', 'revise_narration_draft', args), { code: 'TOOL_CALL_UNRESOLVED' });
  r.service.beginRequest(f.project.id, 'human', 'Continue from saved evidence');
  r.tools.reconcileEpoch(f.project.id, f.bridge.actor.epochId);
  const receipt = r.store.list('tool_reconciliation', f.project.id)[0];
  assert.equal(receipt.state, 'effect_confirmed'); assert.equal(receipt.receipt.version, 1); assert.equal(receipt.receipt.segments.length, 1);
  assert.equal(r.store.list('narration_revision', f.project.id).length, 1); assert.equal(r.store.list('narration_segment', f.project.id).length, 1);
  assert.equal(receipt.receiptDigest, digest(receipt.receipt));
});

test('project scope, read-only authority, current epoch and cross-project identities constrain draft writes', async t => {
  const f = fixture(t), args = { expectedVersion: 0, patch: { add: [draft('x')] } };
  const other = f.service.createProject('Other project');
  await assert.rejects(f.tools.invoke(other.id, f.bridge.actor, 'cross-project', 'revise_narration_draft', args), { code: 'ACTOR_DENIED' });
  const readonly = f.activate('Just inspect', { editing: false });
  await assert.rejects(f.tools.invoke(f.project.id, readonly.bridge.actor, 'read-only', 'revise_narration_draft', args), { code: 'ACTOR_DENIED' });
  const current = f.activate('Replace earlier request');
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'revoked', 'revise_narration_draft', args), { code: 'EPOCH_REVOKED' });
  const prepared = await f.service.prepare(f.project.id, current.bridge.actor, { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'A leather boots commercial', createScenes: [{ key: 'scene', purpose: 'Scene' }] } });
  f.service.apply(f.project.id, current.bridge.actor, prepared.id);
  const scene = f.store.getProject(f.project.id).scenes[0]; const scoped = f.activate('Scene-only change', { scopeIds: [scene.id] });
  await assert.rejects(f.tools.invoke(f.project.id, scoped.bridge.actor, 'scope', 'revise_narration_draft', args), { code: 'SCOPE_DENIED' });
  assert.equal(f.store.list('narration_revision', f.project.id).length, 0);
});

test('narration read projection is bounded, paginated and excludes local recording paths', async t => {
  const f = fixture(t);
  await f.tools.invoke(f.project.id, f.bridge.actor, 'bulk', 'revise_narration_draft', { expectedVersion: 0, patch: { add: Array.from({ length: 25 }, (_, i) => draft('Section '+i)) } });
  f.store.insert('narration_audio', 'recording', f.project.id, { declaredOrigin: 'uploaded', requestId: f.human.requestId,
    media: { path: '/private/never-expose.wav', originalPath: '/private/original.wav', sha256: 'a'.repeat(64), probe: { audio: { samples: 48000, sampleRate: 48000 } } } });
  let offset = 0; const segments = [], recordings = [], gaps = []; let firstDigest;
  do {
    const page = await f.tools.invoke(f.project.id, f.bridge.actor, 'page-'+offset, 'read_context', { section: 'narration', offset });
    const json = JSON.stringify(page); assert.ok(Buffer.byteLength(json) <= 512 * 1024); assert.equal(json.includes('/private/'), false);
    firstDigest ??= page.guard.dataDigest; assert.equal(page.guard.dataDigest, firstDigest);
    segments.push(...page.narrationDraft.segments); recordings.push(...page.audioLibrary); gaps.push(...page.narrationDraft.readiness.gaps);
    offset = page.page.nextOffset;
  } while (offset !== null);
  assert.equal(segments.length, 25); assert.equal(recordings.length, 1); assert.ok(gaps.length > 25);
  assert.equal(recordings[0].samples, 48000); assert.equal(recordings[0].originEvidence, 'human_declared_supplied_recording');
});

test('a large legal script produces compact recoverable receipt and new sections can be reordered by saved IDs', async t => {
  const f = fixture(t), saved = await f.tools.invoke(f.project.id, f.bridge.actor, 'large', 'revise_narration_draft',
    { expectedVersion: 0, patch: { add: Array.from({ length: 80 }, (_, i) => ({ ...draft('x'.repeat(15000)), meaning: 'Section '+i })) } });
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) < 40 * 1024); assert.equal(saved.segments.length, 80);
  const order = saved.segments.map(row => row.segmentId).reverse();
  const changed = await f.tools.invoke(f.project.id, f.bridge.actor, 'order', 'revise_narration_draft', { expectedVersion: 1, patch: { order } });
  assert.deepEqual(changed.segments.map(row => row.segmentId), order);
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'bad-order', 'revise_narration_draft', { expectedVersion: 2, patch: { add: [draft('new')], order } }), { code: 'NARRATION_INVALID_INPUT' });
  assert.equal(f.tools.narration.snapshot(f.project.id, f.bridge.actor).state.version, 2);
});

test('authenticated HTTP uses server epoch catalog even when the caller claims another version', async t => {
  const f = fixture(t), app = createApp({ service: f.service }); t.after(() => app.close());
  const headers = { host: '127.0.0.1', authorization: 'Bearer '+f.bridge.token, 'x-openslate-tool-call-id': 'http-draft', 'x-openslate-tool-contract': '1.0.0' };
  const result = await app.inject({ method: 'POST', url: `/internal/projects/${f.project.id}/tools/revise_narration_draft`, headers,
    payload: { expectedVersion: 0, patch: { add: [draft('HTTP draft')] } } });
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().version, 1);
  f.service.beginRequest(f.project.id, 'human', 'Fence previous browser work');
  const stale = await app.inject({ method: 'POST', url: `/internal/projects/${f.project.id}/tools/revise_narration_draft`, headers,
    payload: { expectedVersion: 0, patch: { add: [draft('HTTP draft')] } } });
  assert.equal(stale.statusCode, 403); assert.equal(stale.json().error.code, 'EPOCH_REVOKED');
});

test('in-flight invocation pins its catalog fields before a handler can complete', async t => {
  const f = fixture(t); let entered, release;
  const arrived = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const original = f.service.prepare.bind(f.service);
  f.service.prepare = async (...args) => { entered(); await gate; return original(...args); };
  const pending = f.tools.invoke(f.project.id, f.bridge.actor, 'pending', 'prepare_change', { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Pinned' } });
  await arrived;
  const row = f.store.list('tool_invocation', f.project.id)[0]; assert.equal(row.state, 'started');
  for (const field of ['toolContractVersion', 'catalogDigest', 'skillLockId'])
    assert.throws(() => f.store.put('tool_invocation', row.id, f.project.id, { ...row, [field]: null }), { code: 'IMMUTABLE_RECORD' });
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'pending', 'prepare_change', { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Pinned' } }), { code: 'TOOL_CALL_UNRESOLVED' });
  release(); await pending;
  assert.equal(f.store.list('prepared', f.project.id).length, 1);
});
