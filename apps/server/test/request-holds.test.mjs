import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DirectorSupervisor } from '../dist/application/director-supervisor.js';
import { proposeChange, proposalCommand, directorProposals } from '../dist/application/director-proposals.js';
import { editStoryboard } from '../dist/storyboard.js';
import { fixture } from './helpers/generation-fixture.mjs';
import { digest, toolCatalog, toolHandlerId } from '@openslate/core';

const identity = input => Object.fromEntries(['projectId', 'requestId', 'epochId', 'turnId'].map(key => [key, input[key]]));
const completed = input => ({ ...identity(input), status: 'completed', text: 'Discussed.', dispatched: true });
const holds = (f, requestId) => f.store.list('hold', f.project.id).filter(h => h.active && (!requestId || h.ownerId === requestId));
const actor = (f, text = 'Consider this scene', options = {}) => f.service.beginRequest(f.project.id, 'local-user', text, { scopeIds: ['scene-0'], ...options });
const release = (f, requestId, key = randomUUID(), payload) => f.call('POST', `/requests/${requestId}/release-holds`, payload, key);
function supervisor(t, f, start, options = {}) {
  const s = new DirectorSupervisor(f.service, { id: 'offline-holds', start: async (input, context) => {
    // These proposal fixtures exercise the current, immutable tool contract.
    const body = { id: randomUUID(), compatibility: { toolContract: '5.0.0' }, skills: [],
      bindings: [{ kind: 'handler', id: toolHandlerId('5.0.0'), digest: toolCatalog('5.0.0').digest }] };
    const lock = { ...body, lockDigest: digest(body) };
    f.store.insert('director_skill_lock', lock.id, f.project.id, { projectId: f.project.id, lock });
    f.store.insert('director_epoch_lock', input.epochId, f.project.id,
      { projectId: f.project.id, epochId: input.epochId, requestId: input.requestId, lockId: lock.id });
    return start(input, context);
  } }, { mode: 'fake', ...options });
  t.after(() => s.close());
  return s;
}
async function run(s, f, human) {
  const turn = s.enqueue(f.project.id, human);
  s.tick(); await s.settle();
  return f.store.get('director_turn', turn.id);
}

for (const [state, code] of [['completed', null], ['failed', 'FAKE_FAILURE'], ['interrupted', null], ['unknown', 'RUNTIME_RUN_TIMEOUT']]) {
  test(`an editing Director ${state}${code === 'RUNTIME_RUN_TIMEOUT' ? ' timeout' : ''} releases only its own resolved holds`, async t => {
    const f = fixture(t), human = actor(f);
    const sibling = actor(f, 'Separate unfinished edit', { scopeIds: ['scene-1'], concurrency: 'alongside' });
    const s = supervisor(t, f, async input => ({ ...completed(input), status: state, ...(code ? { error: { code, message: 'Offline result' } } : {}) }));
    assert.equal((await run(s, f, human)).state, state);
    assert.equal(holds(f, human.requestId).length, 0);
    assert.equal(holds(f, sibling.requestId).length, 1);
    assert.equal(f.provider.acceptedCount(), 0);
  });
}

test('a failed input preparation releases its request without dispatching a model', async t => {
  const f = fixture(t), human = actor(f); let calls = 0;
  const s = supervisor(t, f, async input => { calls++; return completed(input); }, { prepareInput() { throw Error('Offline context failure'); } });
  assert.equal((await run(s, f, human)).state, 'failed');
  assert.equal(calls, 0); assert.equal(holds(f, human.requestId).length, 0);
});

test('an expired foreign Director owner releases resolved holds without replaying the unknown turn', async t => {
  const f = fixture(t), human = actor(f), bridge = f.service.openEpoch(f.project.id, human); let calls = 0;
  const s = supervisor(t, f, async input => { calls++; return completed(input); }, { now: () => 3000 });
  const turn = s.enqueue(f.project.id, human);
  f.store.put('director_turn', turn.id, f.project.id, { ...turn, state: 'running', owner: 'lost-owner', epochId: bridge.actor.epochId, leaseExpiresAt: 2000, dispatched: true });
  s.tick(); await s.settle(); s.tick();
  assert.equal(f.store.get('director_turn', turn.id).errorCode, 'OWNER_LOST');
  assert.equal(holds(f, human.requestId).length, 0); assert.equal(calls, 0);
});

test('a pending Director question retains holds until its exact request is let go', async t => {
  const f = fixture(t), human = actor(f);
  const s = supervisor(t, f, async (input, { onEvent }) => {
    await onEvent({ ...identity(input), kind: 'pending_input', nativeRequestId: 'question', questions: [] });
    return completed(input);
  });
  assert.equal((await run(s, f, human)).state, 'waiting_user');
  assert.equal(holds(f, human.requestId).length, 1);
  const receipt = await release(f, human.requestId);
  assert.equal(receipt.statusCode, 200, receipt.body);
  assert.equal(holds(f, human.requestId).length, 0);
  assert.equal(f.service.snapshot(f.project.id).questions[0].canAnswer, false);
  assert.equal(s.status(f.project.id).status, 'idle'); assert.equal(s.status(f.project.id).activeRequestId, null);
});

for (const action of ['accept', 'reject']) test(`a held proposal releases terminal holds before ${action} resolves it`, async t => {
  const f = fixture(t), human = actor(f); let proposal;
  const s = supervisor(t, f, async input => {
    proposal = proposeChange(f.service, f.project.id, f.service.actorForBridge(f.project.id, input.bridge.credential), randomUUID(), { patch: { updateShots: [{ id: 'shot-0', motion: 'Pan toward the ferry' }] } });
    return completed(input);
  });
  assert.equal((await run(s, f, human)).state, 'completed');
  assert.equal(holds(f, human.requestId).length, 0);
  proposalCommand(f.service, f.project.id, proposal.proposalId, action, randomUUID(), proposal.previewDigest);
  assert.equal(holds(f, human.requestId).length, 0);
  assert.equal(f.provider.acceptedCount(), 0);
});

test('a proposal made stale by an alongside human edit does not retain terminal holds', async t => {
  const f = fixture(t), human = actor(f); let proposal;
  const s = supervisor(t, f, async input => {
    proposal = proposeChange(f.service, f.project.id, f.service.actorForBridge(f.project.id, input.bridge.credential), randomUUID(), { patch: { updateShots: [{ id: 'shot-0', motion: 'Director movement' }] } });
    editStoryboard(f.service, f.project.id, { kind: 'shot', id: 'shot-0', field: 'motion', value: 'Human movement', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }, randomUUID());
    return completed(input);
  });
  assert.equal((await run(s, f, human)).state, 'completed');
  assert.equal(f.store.get('director_proposal', proposal.proposalId).state, 'held', 'the durable source state remains unchanged');
  assert.equal(directorProposals(f.service, f.project.id).proposals[0].state, 'stale');
  assert.equal(holds(f, human.requestId).length, 0);
});

test('a later alongside edit does not restore terminal proposal holds or replay the turn', async t => {
  const f = fixture(t), human = actor(f); let calls = 0;
  const s = supervisor(t, f, async input => {
    calls++;
    proposeChange(f.service, f.project.id, f.service.actorForBridge(f.project.id, input.bridge.credential), randomUUID(), { patch: { updateShots: [{ id: 'shot-0', motion: 'Director movement' }] } });
    return completed(input);
  });
  await run(s, f, human); assert.equal(holds(f, human.requestId).length, 0);
  editStoryboard(f.service, f.project.id, { kind: 'shot', id: 'shot-0', field: 'motion', value: 'Human movement', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }, randomUUID());
  s.tick(); await s.settle();
  assert.equal(holds(f, human.requestId).length, 0); assert.equal(calls, 1);
  const cursor = f.store.cursor(f.project.id); s.tick();
  assert.equal(f.store.cursor(f.project.id), cursor, 'reconciliation records no repeated release');
});

test('a fresh supervisor retires legacy resolved terminal holds without dispatching the model', async t => {
  const f = fixture(t), human = actor(f); let calls = 0;
  const s = supervisor(t, f, async input => { calls++; return completed(input); });
  const turn = s.enqueue(f.project.id, human);
  f.store.put('director_turn', turn.id, f.project.id, { ...turn, state: 'completed' });
  s.tick(); await s.settle();
  assert.equal(holds(f, human.requestId).length, 0); assert.equal(calls, 0);
});

for (const apply of [false, true]) test(`a ${apply ? 'published' : 'still pending'} prepared change ${apply ? 'allows' : 'prevents'} automatic hold release`, async t => {
  const f = fixture(t), human = actor(f, 'Revise the film', { scopeIds: [f.project.id] }); let prepared, director;
  const s = supervisor(t, f, async input => {
    director = f.service.actorForBridge(f.project.id, input.bridge.credential);
    prepared = await f.service.prepare(f.project.id, director, { variant: 'project', expectedHeadVersion: f.store.getProject(f.project.id).headVersion, creative: { brief: 'A quiet ferry crossing' } });
    if (apply) f.service.apply(f.project.id, director, prepared.id);
    return completed(input);
  });
  assert.equal((await run(s, f, human)).state, 'completed');
  assert.equal(holds(f, human.requestId).length, apply ? 0 : 1);
  if (!apply) {
    assert.throws(() => f.service.apply(f.project.id, director, prepared.id), { code: 'EPOCH_REVOKED' });
    const receipt = await release(f, human.requestId);
    assert.equal(receipt.statusCode, 200, receipt.body);
    assert.equal(holds(f, human.requestId).length, 0);
  }
});

test('superseding releases the old owner even with pending prepared work and preserves unrelated holds', async t => {
  const f = fixture(t), original = actor(f), bridge = f.service.openEpoch(f.project.id, original);
  const prepared = await f.service.prepare(f.project.id, bridge.actor, { variant: 'project', expectedHeadVersion: f.store.getProject(f.project.id).headVersion, creative: { updateShots: [{ id: 'shot-0', motion: 'Old movement', reauthorPrompts: true }] } });
  const sibling = actor(f, 'Other scene', { scopeIds: ['scene-1'], concurrency: 'alongside' });
  const replacement = actor(f, 'New scene direction', { supersede: 'intersecting' });
  assert.equal(holds(f, original.requestId).length, 0);
  assert.equal(holds(f, sibling.requestId).length, 1);
  assert.equal(holds(f, replacement.requestId).length, 1);
  assert.throws(() => f.service.apply(f.project.id, bridge.actor, prepared.id), { code: 'EPOCH_REVOKED' });
});

test('superseding a queued turn retires its holds immediately and does not dispatch it', async t => {
  const f = fixture(t), original = actor(f); let calls = 0;
  const s = supervisor(t, f, async input => { calls++; return completed(input); });
  const old = s.enqueue(f.project.id, original), replacement = actor(f, 'Replace the queued edit');
  assert.equal(holds(f, original.requestId).length, 0);
  s.tick(); await s.settle();
  assert.equal(f.store.get('director_turn', old.id).state, 'interrupted');
  assert.equal(holds(f, replacement.requestId).length, 1); assert.equal(calls, 0);
});

test('release-holds is keyed, bodyless and owned; replay cannot affect another request or mint authority', async t => {
  const f = fixture(t), human = actor(f), other = actor(f, 'Other scene', { scopeIds: ['scene-1'], concurrency: 'alongside' });
  const bridge = f.service.openEpoch(f.project.id, human);
  const prepared = await f.service.prepare(f.project.id, human, { variant: 'project', expectedHeadVersion: f.store.getProject(f.project.id).headVersion, creative: { updateShots: [{ id: 'shot-0', motion: 'An unfinished edit', reauthorPrompts: true }] } });
  const before = ['grant', 'candidate', 'attempt', 'message'].map(kind => f.store.list(kind, f.project.id).length);
  assert.equal((await release(f, human.requestId, null)).json().error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal((await release(f, human.requestId, 'body', {})).json().error.code, 'VALIDATION_ERROR');
  const foreign = f.service.beginRequest(f.project.id, 'other-user', 'Their edit', { concurrency: 'alongside', scopeIds: ['scene-1'] });
  assert.equal((await release(f, foreign.requestId)).json().error.code, 'ACTOR_DENIED');
  assert.equal((await release(f, 'missing')).statusCode, 404);
  const receipt = await release(f, human.requestId, 'let-go'); assert.equal(receipt.statusCode, 200, receipt.body);
  assert.deepEqual(receipt.json(), { requestId: human.requestId, releasedHolds: 1 });
  const cursor = f.store.cursor(f.project.id);
  assert.deepEqual((await release(f, human.requestId, 'let-go')).json(), receipt.json());
  assert.equal(f.store.cursor(f.project.id), cursor);
  assert.equal((await release(f, other.requestId, 'let-go')).json().error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(holds(f, other.requestId).length, 1); assert.equal(holds(f, foreign.requestId).length, 1);
  assert.equal(f.store.get('epoch', bridge.actor.epochId).state, 'revoked');
  assert.throws(() => f.service.apply(f.project.id, human, prepared.id), { code: 'ACTOR_DENIED' });
  assert.deepEqual(['grant', 'candidate', 'attempt', 'message'].map(kind => f.store.list(kind, f.project.id).length), before.map((n, i) => n + (i === 3 ? 1 : 0)));
  assert.equal((await release(f, human.requestId, 'already-free')).json().releasedHolds, 0);
});

for (const running of [false, true]) test(`release-holds refuses a ${running ? 'running' : 'queued'} Director and leaves ownership intact`, async t => {
  const f = fixture(t), human = actor(f); let unblock;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const s = supervisor(t, f, async input => { await barrier; return completed(input); });
  const turn = s.enqueue(f.project.id, human);
  try {
    if (running) { s.tick(); await new Promise(resolve => setImmediate(resolve)); }
    const response = await release(f, human.requestId, 'busy');
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'DIRECTOR_WORKING');
    assert.equal(f.store.get('director_turn', turn.id).state, running ? 'running' : 'queued');
    assert.equal(f.store.get('message', human.requestId).state, 'active'); assert.equal(holds(f, human.requestId).length, 1);
  } finally { unblock(); await s.settle(); }
  if (running) assert.equal((await release(f, human.requestId, 'busy')).statusCode, 200, 'a refused key can be retried when work settles');
});

test('release-holds refuses a request in another project', async t => {
  const f = fixture(t), project = f.service.createProject('Other project');
  const human = f.service.beginRequest(project.id, 'local-user', 'Other film edit');
  const response = await release(f, human.requestId);
  assert.equal(response.statusCode, 404); assert.equal(f.store.list('hold', project.id).filter(h => h.active).length, 1);
});

test('edit_pending overview names the exact scoped owner and releasing it lets a queued job dispatch', async t => {
  const f = fixture(t), generated = await f.post(await f.get(), 'image'); assert.equal(generated.statusCode, 200, generated.body);
  const human = actor(f), other = actor(f, 'Unrelated edit', { scopeIds: ['scene-1'], concurrency: 'alongside' });
  await f.engine.runReady();
  const slot = (await f.overview()).shots['shot-0'].keyframe;
  assert.equal(slot.waiting.code, 'edit_pending'); assert.equal(slot.waiting.requestId, human.requestId);
  const response = await release(f, human.requestId); assert.equal(response.statusCode, 200, response.body);
  assert.notEqual((await f.overview()).shots['shot-0'].keyframe.waiting?.code, 'edit_pending', 'an old persisted wait does not resurrect a released hold');
  assert.equal((await f.engine.runReady()).dispatched, 1);
  assert.equal(holds(f, other.requestId).length, 1); assert.equal(f.provider.acceptedCount(), 1);
});

test('an unlinked held proposal does not hold queued keyframe work after reasoning finishes', async t => {
  const f = fixture(t), generated = await f.post(await f.get(), 'image'); assert.equal(generated.statusCode, 200, generated.body);
  const human = actor(f); let proposal;
  const s = supervisor(t, f, async input => {
    proposal = proposeChange(f.service, f.project.id, f.service.actorForBridge(f.project.id, input.bridge.credential), randomUUID(),
      { patch: { updateShots: [{ id: 'shot-0', motion: 'Pan toward the ferry' }] } });
    return completed(input);
  });
  await f.engine.runReady(); assert.equal(f.provider.acceptedCount(), 0);
  assert.equal((await run(s, f, human)).state, 'completed');
  assert.equal(directorProposals(f.service, f.project.id).proposals.find(p => p.proposalId === proposal.proposalId).state, 'held');
  assert.equal(holds(f, human.requestId).length, 0);
  assert.equal((await f.engine.runReady()).dispatched, 1); assert.equal(f.provider.acceptedCount(), 1);
});
