import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { digest } from '@openslate/core';
import { continuedRequestAuthorities } from '../dist/application/pending-edit-continuation.js';

function fixture(t) { const f = setup(t), service = new ProductionService(f.store, f.engine); return { ...f, service }; }
const active = f => f.store.list('hold', f.projectId).filter(h => h.active);

test('one covering human message continues several selected edits, retaining unrelated holds and immutable attempts', async t => {
  const f = fixture(t), first = f.service.beginRequest(f.projectId, 'local-user', 'Change shot one', { scopeIds: ['shot-0'] });
  const oldEpoch = f.service.openEpoch(f.projectId, first);
  const second = f.service.beginRequest(f.projectId, 'local-user', 'Refine its motion', { scopeIds: ['shot-0'] });
  const unrelated = f.service.beginRequest(f.projectId, 'local-user', 'Separate second shot edit', { scopeIds: ['shot-1'] });
  const review = f.service.pendingEditContinuation(f.projectId, 'local-user', ['shot-0']);
  assert.deepEqual(new Set(review.requestIds), new Set([first.requestId, second.requestId]));
  const before = { grants: f.store.list('grant', f.projectId), attempts: f.engine.attempts(f.projectId), project: f.store.getProject(f.projectId) };
  const actor = f.service.beginRequest(f.projectId, 'local-user', 'Use a softer camera movement and continue these saved edits', { scopeIds: ['shot-0'], continueEdits: review, key: 'covering-message' });
  assert.deepEqual(active(f).map(h => h.ownerId).sort(), [actor.requestId, unrelated.requestId].sort());
  assert.equal(f.store.get('epoch', oldEpoch.actor.epochId).state, 'revoked');
  const edges = f.store.list('request_continuation', f.projectId);
  assert.equal(edges.length, 2); assert.ok(edges.every(edge => edge.toRequestId === actor.requestId));
  assert.deepEqual(f.store.list('grant', f.projectId), before.grants); assert.deepEqual(f.engine.attempts(f.projectId), before.attempts); assert.deepEqual(f.store.getProject(f.projectId), before.project);
  assert.deepEqual(f.service.beginRequest(f.projectId, 'local-user', 'Use a softer camera movement and continue these saved edits', { scopeIds: ['shot-0'], continueEdits: review, key: 'covering-message' }), actor);
  assert.equal(f.store.list('request_continuation', f.projectId).length, 2);
});

test('continuation digest rejects stale hold changes before revoking the current epoch or creating records', t => {
  const f = fixture(t), old = f.service.beginRequest(f.projectId, 'local-user', 'Old edit', { scopeIds: ['shot-0'] });
  const review = f.service.pendingEditContinuation(f.projectId, 'local-user', ['shot-0']);
  f.engine.setHold(f.projectId, { scopeId: 'scene-0', ownerId: old.requestId });
  const epoch = f.service.openEpoch(f.projectId, old), cursor = f.store.cursor(f.projectId), count = f.store.list('message', f.projectId).length;
  assert.throws(() => f.service.beginRequest(f.projectId, 'local-user', 'Continue', { scopeIds: [f.projectId], continueEdits: review }), { code: 'CONTINUATION_CHANGED' });
  assert.equal(f.store.cursor(f.projectId), cursor); assert.equal(f.store.list('message', f.projectId).length, count); assert.equal(f.store.get('epoch', epoch.actor.epochId).state, 'active');
  const next = f.store.getProject(f.projectId); f.store.saveProject({ ...next, brief: 'New brief' }, next.headVersion);
  assert.throws(() => f.service.beginRequest(f.projectId, 'local-user', 'Continue', { scopeIds: [f.projectId], continueEdits: review }), { code: 'REVISION_CONFLICT' });
});

test('partial owner coverage, another principal, duplicate IDs and read-only continuation cannot transfer authority', t => {
  const f = fixture(t), local = f.service.beginRequest(f.projectId, 'local-user', 'Both shots', { scopeIds: ['shot-0', 'shot-1'] });
  const foreign = f.service.beginRequest(f.projectId, 'another-user', 'Private authority', { scopeIds: ['shot-0'] });
  assert.equal(f.service.pendingEditContinuation(f.projectId, 'local-user', ['shot-0']), null);
  const review = f.service.pendingEditContinuation(f.projectId, 'local-user', [f.projectId]);
  assert.deepEqual(review.requestIds, [local.requestId]);
  for (const options of [
    { scopeIds: ['shot-0'], continueEdits: review },
    { scopeIds: [f.projectId], continueEdits: review, editing: false },
    { scopeIds: [f.projectId], continueEdits: { ...review, requestIds: [local.requestId, local.requestId] } },
    { scopeIds: [f.projectId], continueEdits: { ...review, requestIds: [foreign.requestId] } },
    { scopeIds: [f.projectId], continueEdits: review, continuationRequestId: local.requestId },
  ]) assert.throws(() => f.service.beginRequest(f.projectId, 'local-user', 'Bad continuation', options));
  assert.equal(active(f).length, 3); assert.equal(f.store.list('request_continuation', f.projectId).length, 0);
});

test('scene continuation covers its shot holds and aggregate projection uses a stable browser-safe digest', t => {
  const f = fixture(t), actor = f.service.beginRequest(f.projectId, 'local-user', 'Edit scene', { scopeIds: ['shot-0'] });
  const snapshot = f.service.snapshot(f.projectId), groups = snapshot.pendingEditContinuations;
  const review = f.service.pendingEditContinuation(f.projectId, 'local-user', ['scene-0']);
  assert.equal(review.holdsDigest, digest(groups.map(group => [group.requestId, group.holdsDigest])));
  const next = f.service.beginRequest(f.projectId, 'local-user', 'Resolve this scene', { scopeIds: ['scene-0'], continueEdits: review });
  assert.deepEqual(active(f).map(h => h.ownerId), [next.requestId]); assert.equal(f.store.list('request_continuation', f.projectId)[0].fromRequestId, actor.requestId);
});

test('linear continuation traversal includes only ancestors, handles duplicate/cyclic links and long reversed history', () => {
 const edges=Array.from({length:1500},(_,i)=>({fromRequestId:`request-${i}`,toRequestId:`request-${i+1}`}));
 edges.push({fromRequestId:'unrelated-a',toRequestId:'unrelated-b'},{fromRequestId:'request-3',toRequestId:'request-4'},{fromRequestId:'request-20',toRequestId:'request-10'});
 const authorities=continuedRequestAuthorities({list:()=>edges},'project','request-1500');
 assert.equal(authorities.size,1501);assert.ok(authorities.has('request-0'));assert.ok(!authorities.has('unrelated-a'));assert.ok(!authorities.has('unrelated-b'));
 const smaller=continuedRequestAuthorities({list:()=>edges},'project','request-100');assert.equal(smaller.size,101);
});


test('one fresh message resumes an observed Stop and transfers two held edits without new grants or duplicate continuation', t => {
  const f = fixture(t), first = f.service.beginRequest(f.projectId, 'local-user', 'Edit first shot', { scopeIds: ['shot-0'] }), second = f.service.beginRequest(f.projectId, 'local-user', 'Edit second shot', { scopeIds: ['shot-1'] });
  const stop = f.service.beginRequest(f.projectId, 'local-user', 'Stop conversation and generation', { editing: false, key: 'stop-request' });
  const before = { grants: f.store.list('grant', f.projectId), attempts: f.engine.attempts(f.projectId), project: f.store.getProject(f.projectId) };
  f.service.control(f.projectId, stop, 'stop'); assert.equal(f.store.get('execution_control', f.projectId).paused, true); assert.equal(active(f).length, 2);
  const options = { scopeIds: [f.projectId], resumeFromStopId: stop.requestId, key: 'resume-two-edits' };
  const resumed = f.service.beginRequest(f.projectId, 'local-user', 'Continue with the saved changes', options);
  assert.equal(f.store.get('execution_control', f.projectId).paused, false); assert.deepEqual(active(f).map(hold => hold.ownerId), [resumed.requestId]);
  const edges = f.store.list('request_continuation', f.projectId); assert.deepEqual(new Set(edges.map(edge => edge.fromRequestId)), new Set([first.requestId, second.requestId])); assert.ok(edges.every(edge => edge.toRequestId === resumed.requestId));
  assert.deepEqual(f.store.list('grant', f.projectId), before.grants); assert.deepEqual(f.engine.attempts(f.projectId), before.attempts); assert.deepEqual(f.store.getProject(f.projectId), before.project); assert.equal(f.provider.acceptedCount(), 0);
  assert.deepEqual(f.service.beginRequest(f.projectId, 'local-user', 'Continue with the saved changes', options), resumed); assert.equal(f.store.list('request_continuation', f.projectId).length, 2);
  const laterStop = f.service.beginRequest(f.projectId, 'local-user', 'Stop again', { editing: false }); f.service.control(f.projectId, laterStop, 'stop');
  f.service.beginRequest(f.projectId, 'local-user', 'Continue with the saved changes', options); assert.equal(f.store.get('execution_control', f.projectId).paused, true, 'replaying an old resume cannot undo a later Stop');
});
