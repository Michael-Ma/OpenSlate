import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { ToolBridge } from '@openslate/director';
import { ProductionService } from '../dist/application/service.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { createApp } from '../dist/app.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-tool-receipts-'));
  const provider = new FakeProvider(join(root, 'fake.sqlite'));
  let store, service, tools;
  const reopen = () => {
    if (store?.db.open) store.close();
    store = new Store(join(root, 'state.sqlite'));
    service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
    tools = new ToolInvocationService(service);
    return { store, service, tools };
  };
  reopen();
  const project = service.createProject('Tool transport');
  const human = service.beginRequest(project.id, 'human', 'Make a boots commercial');
  const bridge = service.openEpoch(project.id, human);
  t.after(() => { store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, service, tools, project, human, bridge, provider, reopen };
}

test('repeated scoped pause and preparation retain one request-owned hold', async t => {
  const f=fixture(t), first=f.store.list('hold',f.project.id);
  await f.tools.invoke(f.project.id,f.bridge.actor,'pause-1','control_execution',{action:'pause'});
  await f.tools.invoke(f.project.id,f.bridge.actor,'pause-2','control_execution',{action:'pause'});
  await f.tools.invoke(f.project.id,f.bridge.actor,'prepare-held','prepare_change',{variant:'project',expectedHeadVersion:0,creative:{brief:'A precise brief'}});
  assert.deepEqual(f.store.list('hold',f.project.id),first);
  const other=f.service.beginRequest(f.project.id,'human','Another edit',{concurrency:'alongside'});
  f.service.holdRequest(f.project.id,other);
  assert.equal(f.store.list('hold',f.project.id).filter(h=>h.active).length,2,'a different request cannot borrow or release the earlier hold');
});

test('completed invocation survives process recreation and same identity cannot change payload', async t => {
  const f = fixture(t);
  const proposal = { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Leather boots' } };
  const prepared = await f.tools.invoke(f.project.id, f.bridge.actor, 'prepare-1', 'prepare_change', proposal);
  const applied = await f.tools.invoke(f.project.id, f.bridge.actor, 'apply-1', 'apply_change', { preparedId: prepared.id });
  const r = f.reopen();
  const cursor = r.store.cursor(f.project.id);
  assert.deepEqual(await r.tools.invoke(f.project.id, f.bridge.actor, 'apply-1', 'apply_change', { preparedId: prepared.id }), applied);
  assert.equal(r.store.getProject(f.project.id).headVersion, 1);
  assert.equal(r.store.cursor(f.project.id), cursor);
  await assert.rejects(r.tools.invoke(f.project.id, f.bridge.actor, 'apply-1', 'apply_change', { preparedId: 'another' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(r.store.list('tool_invocation', f.project.id).length, 2);
  const record = r.store.list('tool_invocation', f.project.id)[1];
  assert.equal(record.resultDigest, digest(applied));
  assert.throws(() => r.store.put('tool_invocation', record.id, f.project.id, { ...record, result: null }), { code: 'IMMUTABLE_RECORD' });
});

async function savedWriting(f) {
  const prepared = await f.tools.invoke(f.project.id, f.bridge.actor, 'save-writing', 'prepare_change', {
    variant: 'project', expectedHeadVersion: 0, creative: {
      brief: 'A boat on water. Save writing only.', story: 'A boat gently drifts.',
      createScenes: [{ key: 'scene', purpose: 'Paper boat' }],
      createShots: [{ key: 'shot', sceneId: 'scene', purpose: 'Observe the boat', action: 'Boat on water', framing: 'Close-up',
        motion: 'Static', desiredFrames: 180, imagePrompt: 'A paper boat on water', videoPrompt: 'The boat drifts', referenceArtifactIds: [], cueId: null }],
    },
  });
  await f.tools.invoke(f.project.id, f.bridge.actor, 'apply-writing', 'apply_change', { preparedId: prepared.id });
  return f.store.getProject(f.project.id);
}
function imagePlan(project) {
  const shot = project.shots[0], q = JSON.stringify;
  return `definePlan({baseRevision:${q(project.revisionId)}},p=>{const shot=p.shot(${q(shot.id)});return p.image("keyframe",{intent:shot,profile:"fake-image-v1",references:[],prompt:${q(shot.imagePrompt)}});});`;
}

test('a generation preparation without a human press reports the next action and retains saved writing', async t => {
  const f = fixture(t), project = await savedWriting(f), proposal = { variant: 'plan', expectedHeadVersion: project.headVersion, source: imagePlan(project) };
  const outcome = await f.tools.invoke(f.project.id, f.bridge.actor, 'human-next', 'prepare_change', proposal);
  assert.equal(outcome.state, 'awaiting_human_generation');
  assert.equal(outcome.preparedId, null); assert.equal(outcome.applied, false); assert.equal(outcome.generationStarted, false);
  assert.deepEqual(outcome.savedProject, { revisionId: project.revisionId, headVersion: project.headVersion, activePlanId: null, sceneCount: 1, shotCount: 1 });
  assert.match(outcome.next, /expected next step/i); assert.match(outcome.next, /previously saved writing is retained/i);
  assert.match(outcome.next, /this call saved no writing or generation plan/i); assert.match(outcome.next, /person.*scene.*keyframes/i);
  assert.deepEqual(f.store.getProject(f.project.id), project);
  assert.equal(f.store.list('prepared', f.project.id).length, 1, 'only the earlier writing preparation exists');
  for (const kind of ['grant', 'candidate', 'attempt', 'reservation']) assert.equal(f.store.list(kind, f.project.id).length, 0, kind);
  assert.equal(f.provider.acceptedCount(), 0);
  const receipt = f.store.list('tool_invocation', f.project.id).find(row => row.callId === 'human-next');
  assert.equal(receipt.state, 'succeeded'); assert.equal(receipt.error, null);
  assert.deepEqual(receipt.result, outcome);
  const reopened = f.reopen(), cursor = reopened.store.cursor(f.project.id);
  reopened.service.prepare = async () => { throw Error('replay must not prepare again'); };
  assert.deepEqual(await reopened.tools.invoke(f.project.id, f.bridge.actor, 'human-next', 'prepare_change', proposal), outcome);
  assert.equal(reopened.store.cursor(f.project.id), cursor);
  await assert.rejects(reopened.tools.invoke(f.project.id, f.bridge.actor, 'apply-next-step', 'apply_change', { preparedId: outcome.preparedId }), { code: 'VALIDATION_ERROR' });
});

test('the next-action receipt preserves grant integrity and never authorizes an incomplete multi-operation plan', async t => {
  const f = fixture(t), project = await savedWriting(f);
  const [grant] = f.service.authorize(f.project.id, f.human, [{ scopeId: f.project.id, kind: 'speech' }], 'one-slot');
  const source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{const one=p.speech("one",{profile:"fake-speech-v1",text:"One",voice:"demo"});const two=p.speech("two",{profile:"fake-speech-v1",text:"Two",voice:"demo"});return [one,two];});`;
  const outcome = await f.tools.invoke(f.project.id, f.bridge.actor, 'incomplete-grants', 'prepare_change', { variant: 'plan', expectedHeadVersion: project.headVersion, source });
  assert.equal(outcome.state, 'awaiting_human_generation');
  assert.deepEqual(f.store.list('grant', f.project.id), [grant]);
  assert.equal(f.store.list('candidate', f.project.id).length, 0); assert.equal(f.store.list('attempt', f.project.id).length, 0);
  assert.deepEqual(f.store.getProject(f.project.id), project); assert.equal(f.provider.acceptedCount(), 0);
});

test('generation guidance cannot hide stale revisions, invalid plans or revoked epochs', async t => {
  const f = fixture(t), project = await savedWriting(f);
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'stale-generation', 'prepare_change', {
    variant: 'plan', expectedHeadVersion: 0, source: imagePlan(project),
  }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'invalid-generation', 'prepare_change', {
    variant: 'plan', expectedHeadVersion: project.headVersion, source: 'invalid source',
  }), error => error.code !== 'ORIGIN_NOT_AUTHORIZED' && error.code !== 'TOOL_CALL_UNRESOLVED');
  f.service.beginRequest(f.project.id, 'human', 'Use a different direction');
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'revoked-generation', 'prepare_change', {
    variant: 'plan', expectedHeadVersion: project.headVersion, source: imagePlan(project),
  }), { code: 'EPOCH_REVOKED' });
  for (const callId of ['stale-generation', 'invalid-generation']) assert.equal(f.store.list('tool_invocation', f.project.id).find(row => row.callId === callId).state, 'failed');
  assert.equal(f.store.list('candidate', f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test('in-progress transport replay never dispatches a second handler', async t => {
  const f = fixture(t); let release; let entered; let calls = 0;
  const waiting = new Promise(r => entered = r), gate = new Promise(r => release = r);
  const original = f.service.prepare.bind(f.service);
  f.service.prepare = async (...args) => { calls++; entered(); await gate; return original(...args); };
  const args = { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Boots' } };
  const pending = f.tools.invoke(f.project.id, f.bridge.actor, 'same-call', 'prepare_change', args);
  await waiting;
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'same-call', 'prepare_change', args), { code: 'TOOL_CALL_UNRESOLVED' });
  release(); await pending; assert.equal(calls, 1);
});

test('revoking authority while a preparation is pending also fences receipt replay', async t => {
  const f = fixture(t); let release;
  const gate = new Promise(r => release = r), original = f.service.prepare.bind(f.service);
  f.service.prepare = async (...args) => { await gate; return original(...args); };
  const args = { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Too late' } };
  const pending = f.tools.invoke(f.project.id, f.bridge.actor, 'old-call', 'prepare_change', args);
  f.service.beginRequest(f.project.id, 'human', 'Change the direction'); release();
  await assert.rejects(pending, { code: 'EPOCH_REVOKED' });
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'old-call', 'prepare_change', args), { code: 'EPOCH_REVOKED' });
  assert.equal(f.store.getProject(f.project.id).headVersion, 0);
  assert.equal(f.store.list('prepared', f.project.id).length, 0);
  assert.equal(f.store.list('tool_invocation', f.project.id)[0].state, 'failed');
});

test('unexpected failure after a domain commit remains unresolved across restart without reapplying', async t => {
  const f = fixture(t);
  const prepared = await f.service.prepare(f.project.id, f.bridge.actor, { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Committed once' } });
  const original = f.service.apply.bind(f.service);
  f.service.apply = (...args) => { original(...args); throw new Error('Simulated lost domain response'); };
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'uncertain', 'apply_change', { preparedId: prepared.id }), { code: 'TOOL_CALL_UNRESOLVED' });
  const r = f.reopen();
  await assert.rejects(r.tools.invoke(f.project.id, f.bridge.actor, 'uncertain', 'apply_change', { preparedId: prepared.id }), { code: 'TOOL_CALL_UNRESOLVED' });
  assert.equal(r.store.getProject(f.project.id).headVersion, 1);
  assert.equal(r.store.list('tool_invocation', f.project.id)[0].state, 'unresolved');
  assert.equal(r.service.readContext(f.project.id, f.bridge.actor).toolCalls[0].state, 'unresolved');
  assert.equal(f.provider.acceptedCount(), 0);
});

test('a crash with only a started record requires reconciliation, and forged arguments never reach a handler', async t => {
  const f = fixture(t), callId = 'interrupted';
  const id = digest({ projectId: f.project.id, epochId: f.bridge.actor.epochId, callId });
  f.store.insert('tool_invocation', id, f.project.id, { id, projectId: f.project.id, requestId: f.bridge.actor.requestId, epochId: f.bridge.actor.epochId, callId, tool: 'read_context', argumentsDigest: digest({}), state: 'started', result: null, resultDigest: null, error: null });
  const r = f.reopen();
  await assert.rejects(r.tools.invoke(f.project.id, f.bridge.actor, callId, 'read_context', {}), { code: 'TOOL_CALL_UNRESOLVED' });
  for (const body of [{ actor: 'human' }, [], { epochId: f.bridge.actor.epochId }])
    await assert.rejects(r.tools.invoke(f.project.id, f.bridge.actor, 'forged', 'read_context', body), { code: 'VALIDATION_ERROR' });
  assert.equal(r.store.list('tool_invocation', f.project.id).length, 1);
});

test('HTTP bridge header binds durable identity and credentials are checked before cached results', async t => {
  const f = fixture(t), app = createApp({ service: f.service }); t.after(() => app.close());
  const invoke = payload => app.inject({ method: 'POST', url: `/internal/projects/${f.project.id}/tools/read_context`, payload,
    headers: { host: '127.0.0.1', authorization: 'Bearer ' + f.bridge.token, 'x-openslate-tool-call-id': 'native-call' } });
  const first = await invoke({}); assert.equal(first.statusCode, 200, first.body);
  const missing = await app.inject({ method: 'POST', url: `/internal/projects/${f.project.id}/tools/read_context`, payload: {}, headers: { host: '127.0.0.1', authorization: 'Bearer ' + f.bridge.token } });
  assert.equal(missing.statusCode, 400); assert.equal(missing.json().error.code, 'VALIDATION_ERROR');
  const repeated = await invoke({}); assert.deepEqual(repeated.json(), first.json());
  f.service.beginRequest(f.project.id, 'human', 'Supersede this request');
  const rejected = await invoke({}); assert.equal(rejected.statusCode, 403); assert.equal(rejected.json().error.code, 'EPOCH_REVOKED');
  assert.equal(f.store.list('tool_invocation', f.project.id).length, 1);
});

test('downgraded epoch stays read only even while its originating human request is editable', async t => {
  const f = fixture(t);
  const prepared = await f.service.prepare(f.project.id, f.bridge.actor, { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Before downgrade' } });
  const epoch = f.store.get('epoch', f.bridge.actor.epochId);
  f.store.put('epoch', epoch.id, f.project.id, { ...epoch, state: 'read_only' });
  assert.throws(() => f.store.put('epoch', epoch.id, f.project.id, epoch), { code: 'EPOCH_REVOKED' });
  assert.equal(f.service.readContext(f.project.id, f.bridge.actor).project.id, f.project.id);
  assert.throws(() => f.service.apply(f.project.id, f.bridge.actor, prepared.id), { code: 'ACTOR_DENIED' });
  await assert.rejects(f.service.prepare(f.project.id, f.bridge.actor, { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Cannot mutate' } }), { code: 'ACTOR_DENIED' });
  assert.throws(() => f.service.holdRequest(f.project.id, f.bridge.actor), { code: 'ACTOR_DENIED' });
  assert.equal(f.store.getProject(f.project.id).headVersion, 0);
});

test('large legal preparation returns a compact durable ID instead of repeating its full project', async t => {
  const f = fixture(t);
  const scene = { key: 'scene', purpose: 'Craft details' };
  const shots = Array.from({ length: 40 }, (_, i) => ({ key: 'shot-' + i, sceneId: 'scene', purpose: 'Purpose '.repeat(1000), action: 'Craft '.repeat(1000), framing: 'Close up', motion: 'Static', desiredFrames: 180, imagePrompt: 'Leather '.repeat(1000), videoPrompt: 'Slow push '.repeat(1000), referenceArtifactIds: [], cueId: null }));
  const result = await f.tools.invoke(f.project.id, f.bridge.actor, 'large-prepare', 'prepare_change', { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Boots', story: 'Craft', createScenes: [scene], createShots: shots } });
  assert.ok(result.id);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(f.store.get('prepared', result.id))) > 1024 * 1024);
  assert.equal(f.store.list('tool_invocation', f.project.id)[0].state, 'succeeded');
});

test('actual local bridge reaches the application receipt boundary and replacement retains project state', async t => {
  const f = fixture(t), app = createApp({ service: f.service }); t.after(() => app.close());
  const endpoint = await app.listen({ host: '127.0.0.1', port: 0 });
  const bridge = new ToolBridge({ endpoint, projectId: f.project.id, credential: f.bridge.token });
  const prepared = await bridge.call('prepare_change', { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Preserved through MCP transport' } });
  assert.equal(prepared.isError, false); assert.ok(prepared.value.id);
  const applied = await bridge.call('apply_change', { preparedId: prepared.value.id });
  assert.equal(applied.isError, false); assert.equal(applied.value.headVersion, 1);
  assert.equal(f.store.list('tool_invocation', f.project.id).find(row => row.callId === applied.callId).result.headVersion, 1);
  const human = f.service.beginRequest(f.project.id, 'human', 'Keep the brief and continue');
  const next = f.service.openEpoch(f.project.id, human);
  const stale = await bridge.call('read_context', {}); assert.equal(stale.value.error.code, 'EPOCH_REVOKED');
  const replacement = new ToolBridge({ endpoint, projectId: f.project.id, credential: next.token });
  const context = await replacement.call('read_context', {});
  assert.equal(context.isError, false); assert.equal(context.value.project.brief, 'Preserved through MCP transport');
  assert.equal(f.store.list('tool_invocation', f.project.id).length, 3);
  assert.equal(f.provider.acceptedCount(), 0);
});
