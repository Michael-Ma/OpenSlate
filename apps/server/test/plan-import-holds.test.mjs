import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../dist/app.js';
import { fixture as generationFixture } from './helpers/generation-fixture.mjs';

function fixture(t) {
  const f = generationFixture(t), actors = [], token = randomBytes(32).toString('base64url');
  const app = createApp({ service: f.service, localToken: token, logger: false, director: {
    status() { return { mode: 'native', status: 'idle' }; },
    enqueue(_projectId, actor) { actors.push(actor); }, tick() {},
  } });
  t.after(() => app.close());
  const call = (suffix, payload, key = randomUUID()) => app.inject({
    method: 'POST', url: `/api/projects/${f.project.id}/plan-imports${suffix}`,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': key }, payload,
  });
  const draft = async () => {
    const project = f.store.getProject(f.project.id);
    const response = await call('', { name: 'story.md', text: 'A new story with the same shots.', expectedHeadVersion: project.headVersion });
    assert.equal(response.statusCode, 200, response.body);
    const actor = actors.at(-1), bridge = f.service.openEpoch(project.id, actor);
    const prepared = await f.service.prepare(project.id, bridge.actor, { variant: 'workflow', expectedHeadVersion: project.headVersion,
      creative: { story: 'The imported story preserves every existing shot.' } });
    return { actor, bridge, prepared, body: { preparedId: prepared.id, proposalDigest: prepared.proposalDigest } };
  };
  return { ...f, callImport: call, draft };
}

test('confirming a story import releases its project hold and queued video dispatches without another human press', async t => {
  const f = fixture(t), id = f.project.id;
  let response = await f.post(await f.get('scene-1'));
  assert.equal(response.statusCode, 200, response.body);
  await f.finish();
  response = await f.post(await f.get('scene-1'), 'video');
  assert.equal(response.statusCode, 200, response.body);
  const grants = f.store.list('grant', id), candidates = f.store.list('candidate', id);
  const { actor, bridge, prepared, body } = await f.draft();
  assert.ok(f.store.list('hold', id).some(hold => hold.active && hold.ownerId === actor.requestId && hold.scopeId === id));
  const held = await f.engine.runReady();
  assert.equal(held.dispatched, 0);
  assert.ok(held.blocked.some(row => row.code === 'EXECUTION_HELD'));
  assert.equal((await f.overview()).shots['shot-1'].video.waiting.code, 'edit_pending');
  assert.equal(f.provider.acceptedCount(), 1);

  const key = randomUUID(), confirmed = await f.callImport(`/${actor.requestId}/confirm`, body, key);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const continuation = f.store.list('request_continuation', id).find(row => row.fromRequestId === actor.requestId);
  assert.ok(continuation);
  const confirmRequest = f.store.get('message', continuation.toRequestId);
  assert.equal(confirmRequest.source, 'app');
  assert.equal(confirmRequest.editing, true);
  assert.equal(f.store.get('epoch', bridge.actor.epochId).state, 'revoked');
  assert.equal(f.store.get('plan_import', actor.requestId).state, 'confirmed');
  assert.equal(f.store.getProject(id).story, prepared.next.story);
  assert.deepEqual(f.store.list('hold', id).filter(hold => hold.active), []);
  assert.deepEqual(f.service.snapshot(id).pendingEditContinuations, []);
  assert.deepEqual(f.store.list('grant', id), grants);
  assert.deepEqual(f.store.list('candidate', id), candidates);
  assert.equal(f.provider.acceptedCount(), 1, 'the confirm itself starts no generation');

  await f.finish();
  assert.equal((await f.get('scene-1')).rows[0].videoComplete, true);
  assert.equal(f.provider.acceptedCount(), 2);
  assert.equal(f.engine.attempts(id).length, 2);

  const newer = f.service.beginRequest(id, 'local-user', 'Edit another shot after confirming the import', { scopeIds: ['shot-0'] });
  const newerHolds = f.store.list('hold', id).filter(hold => hold.active);
  const messages = f.store.list('message', id), continuations = f.store.list('request_continuation', id);
  assert.ok(newerHolds.some(hold => hold.ownerId === newer.requestId));
  assert.deepEqual((await f.callImport(`/${actor.requestId}/confirm`, body, key)).json(), confirmed.json());
  const repeated = await f.callImport(`/${actor.requestId}/confirm`, body);
  assert.equal(repeated.json().error.code, 'IMPORT_STALE');
  assert.deepEqual(f.store.list('hold', id).filter(hold => hold.active), newerHolds);
  assert.deepEqual(f.store.list('message', id), messages);
  assert.deepEqual(f.store.list('request_continuation', id), continuations);
  assert.equal(f.provider.acceptedCount(), 2);
});

test('failed import publication keeps the original hold and the same confirm key can succeed after rollback', async t => {
  const f = fixture(t), id = f.project.id, { actor, body } = await f.draft(), key = randomUUID();
  const holds = f.store.list('hold', id), messages = f.store.list('message', id), project = f.store.getProject(id);
  const apply = f.service.apply.bind(f.service);
  f.service.apply = () => { throw new Error('Injected import publication failure'); };
  const failed = await f.callImport(`/${actor.requestId}/confirm`, body, key);
  assert.equal(failed.statusCode, 500, failed.body);
  assert.deepEqual(f.store.list('hold', id), holds);
  assert.deepEqual(f.store.list('message', id), messages);
  assert.deepEqual(f.store.list('request_continuation', id), []);
  assert.deepEqual(f.store.getProject(id), project);
  assert.equal(f.store.get('plan_import', actor.requestId).state, 'pending');

  f.service.apply = apply;
  const confirmed = await f.callImport(`/${actor.requestId}/confirm`, body, key);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.deepEqual(f.store.list('hold', id).filter(hold => hold.active), []);
  assert.equal(f.store.list('request_continuation', id).length, 1);
  assert.equal(f.engine.attempts(id).length, 0);
  assert.equal(f.store.list('grant', id).length, 0);
});
