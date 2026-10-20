import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical } from '@openslate/core';
import { CodexDirectorRuntime, FakeDirectorRuntime } from '@openslate/director';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { DirectorSupervisor } from '../dist/application/director-supervisor.js';
import { FakeWorkflowDirector } from '../dist/application/fake-director.js';

function fixture(t, createRuntime, mutateInput = input => input) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-director-refusal-'));
  const store = new Store(join(root, 'app.sqlite')), provider = new FakeProvider(join(root, 'provider.sqlite'));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  const runtime = createRuntime(root, service), project = service.createProject('Known unsent Director turn');
  const supervisor = new DirectorSupervisor(service, runtime, { mode: runtime.id === 'codex-app-server' ? 'native' : 'fake',
    prepareInput: (turn, _human, bridge) => mutateInput({ projectId: project.id, requestId: turn.requestId, epochId: bridge.actor.epochId, turnId: turn.id,
      text: 'Discuss the saved film', context: canonical(service.readContext(project.id, bridge.actor)), skills: [],
      bridge: { endpoint: 'http://127.0.0.1:12991', projectId: project.id, credential: bridge.token, entrypoint: join(root, 'unused-mcp.js') } }) });
  t.after(async () => { await supervisor.close(); await runtime.close?.(); store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  const actor = service.beginRequest(project.id, 'human', 'Discuss the saved film');
  const turn = supervisor.enqueue(project.id, actor);
  return { root, store, provider, service, runtime, project, supervisor, turn };
}

function native(root) {
  // Every case below refuses before version checking; there is no native executable or model to call.
  return new CodexDirectorRuntime({ command: { file: join(root, 'no-native-executable') }, cwd: root, env: {}, model: 'fixture', runtimeVersion: '0.153.4',
    policy: { mode: 'local', id: 'fixture', runtimeVersion: '0.153.4', config: { default_permissions: 'fixture', permissions: { fixture: { network: { enabled: false } } } } } });
}

async function assertRefused(f, code) {
  f.supervisor.tick(); await f.supervisor.settle();
  const saved = f.store.get('director_turn', f.turn.id);
  assert.equal(saved.errorCode, code);
  assert.equal(saved.state, 'failed', 'a definite no-start refusal has no unknown outcome');
  assert.equal(saved.dispatched, false, 'dispatch intent alone does not claim the adapter started');
  assert.equal(saved.nativeThreadId, null); assert.equal(saved.nativeTurnId, null);
  assert.equal(f.store.get('epoch', saved.epochId).state, 'revoked');
  assert.equal(f.store.list('hold', f.project.id).filter(row => row.active).length, 0);
  assert.equal(f.store.list('attempt', f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
  f.supervisor.tick(); await f.supervisor.settle();
  assert.deepEqual(f.store.get('director_turn', f.turn.id), saved, 'a refusal never automatically retries');
}

for (const adapter of ['fake', 'native']) {
  for (const invalid of ['text', 'bridge']) test(`${adapter} input ${invalid} refusal stays failed and undispatched`, async t => {
    let handlerCalls = 0;
    const f = fixture(t, root => adapter === 'native' ? native(root) : new FakeDirectorRuntime(() => { handlerCalls++; return { status: 'completed', text: 'Unexpected' }; }),
      input => invalid === 'text' ? { ...input, text: '' } : { ...input, bridge: { ...input.bridge, endpoint: 'http://192.0.2.1:12991' } });
    await assertRefused(f, invalid === 'text' ? 'RUNTIME_INPUT_INVALID' : 'BRIDGE_ENDPOINT_INVALID');
    assert.equal(handlerCalls, 0);
  });
}

test('closed native runtime refusal stays failed and undispatched', async t => {
  const f = fixture(t, native); await f.runtime.close();
  await assertRefused(f, 'RUNTIME_CLOSED');
});

test('scripted Director bridge refusal stays failed and undispatched before any tool', async t => {
  const f = fixture(t, (_root, service) => new FakeWorkflowDirector(service),
    input => ({ ...input, bridge: { ...input.bridge, credential: 'unbound-bridge-token'.repeat(3) } }));
  await assertRefused(f, 'EPOCH_REVOKED');
  assert.equal(f.store.list('tool_invocation', f.project.id).length, 0);
});

test('scripted Director epoch mismatch stays failed and undispatched before any tool', async t => {
  const f = fixture(t, (_root, service) => {
    const runtime = new FakeWorkflowDirector(service);
    return { id: runtime.id, start: (input, options) => runtime.start({ ...input, epochId: 'another-epoch' }, options) };
  });
  await assertRefused(f, 'EPOCH_REVOKED');
  assert.equal(f.store.list('tool_invocation', f.project.id).length, 0);
});

test('busy native runtime refusal stays failed and undispatched without starting another run', async t => {
  let starts = 0;
  const f = fixture(t, root => {
    const runtime = native(root);
    return { id: runtime.id, close: () => runtime.close(), start: async (input, options) => {
      starts++;
      // Invalid projected images yield before the native version check. The synchronous
      // project reservation still fences a simultaneous second start of that project.
      const first = runtime.start({ ...input, images: [{ path: 'relative', sha256: '0'.repeat(64), mediaType: 'image/png' }] });
      try { return await runtime.start(input, options); }
      finally { const result = await first; assert.equal(result.dispatched, false); assert.equal(result.error.code, 'RUNTIME_IMAGES_INVALID'); }
    } };
  });
  await assertRefused(f, 'RUNTIME_BUSY'); assert.equal(starts, 1);
});

test('an ordinary exception after runtime invocation remains unknown even with a refusal code', async t => {
  let starts = 0;
  const f = fixture(t, () => ({ id: 'synthetic-started-runtime', start: async () => { starts++; throw Object.assign(new Error('Completion lost'), { code: 'RUNTIME_BUSY' }); } }));
  f.supervisor.tick(); await f.supervisor.settle();
  const saved = f.store.get('director_turn', f.turn.id);
  assert.equal(saved.state, 'unknown'); assert.equal(saved.dispatched, true); assert.equal(saved.errorCode, 'RUNTIME_BUSY');
  f.supervisor.tick(); await f.supervisor.settle(); assert.equal(starts, 1, 'unknown work is never replayed');
});

test('a lost owner before durable dispatch intent is failed without claiming an unknown model outcome', async t => {
  let starts = 0;
  const f = fixture(t, () => ({ id: 'synthetic-unstarted-runtime', start: async () => { starts++; throw new Error('Unexpected'); } }));
  f.store.put('director_turn', f.turn.id, f.project.id, { ...f.turn, state: 'running', owner: 'lost-before-dispatch', leaseExpiresAt: 1 });
  f.supervisor.tick(); await f.supervisor.settle();
  const saved = f.store.get('director_turn', f.turn.id);
  assert.equal(saved.state, 'failed'); assert.equal(saved.dispatched, false); assert.equal(saved.errorCode, 'OWNER_LOST');
  f.supervisor.tick(); await f.supervisor.settle(); assert.equal(starts, 0);
});
