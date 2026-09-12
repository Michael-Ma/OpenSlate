import test from 'node:test';
import assert from 'node:assert/strict';
import { PendingCommandRegistry, pendingCommandsFor, activeProjectEdit } from '../src/pending-command.ts';
const uncertain = error => error.code === 'NETWORK_ERROR';
const network = () => Object.assign(new Error('response lost'), { code: 'NETWORK_ERROR' });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const request = (project = 'one') => ({ path: `/api/projects/${project}/media/uploads?expectedHeadVersion=2`, key: 'saved-request', file: new File(['original clip bytes'], 'clip.mp4') });

test('an upload survives unmount/remount without duplicate dispatch or changing its bytes and request identity', async () => {
  const api = {}, registry = pendingCommandsFor(api), response = deferred(), original = request(); let calls = 0, oldNotifications = 0, newNotifications = 0;
  const unsubscribe = registry.subscribe('one', () => oldNotifications++);
  const running = registry.run('one', original, async command => { calls++; assert.equal(command.file, original.file); return response.promise; }, uncertain);
  assert.equal(registry.snapshot('one').running, true); unsubscribe(); const oldCount = oldNotifications;
  const remounted = pendingCommandsFor(api), retained = remounted.snapshot('one').command;
  assert.equal(remounted, registry); assert.equal(retained.key, original.key); assert.equal(retained.path, original.path); assert.equal(await retained.file.text(), 'original clip bytes');
  remounted.subscribe('one', () => newNotifications++);
  assert.equal(await remounted.run('one', retained, async () => { calls++; }, uncertain), false);
  assert.equal(calls, 1); response.resolve({ requestId: 'request' }); await running;
  assert.equal(oldNotifications, oldCount, 'unmounted views receive no completion update'); assert.equal(newNotifications, 1);
  assert.equal(remounted.snapshot('one').command, null); assert.equal(remounted.snapshot('one').lastSuccess, true); assert.equal(remounted.snapshot('one').lastWasUpload, true);
  assert.equal(remounted.snapshot('one').settledCommand.file, undefined, 'confirmed uploads release retained file bytes');
});

test('a lost response retains exact captured data and only an explicit exact retry can dispatch', async () => {
  const registry = new PendingCommandRegistry(), response = deferred(), form = { expectedHeadVersion: 4, selection: ['original'] };
  const original = { path: '/api/projects/one/media/renders', key: 'render-once', body: form }; let calls = 0;
  const running = registry.run('one', original, async command => { calls++; assert.deepEqual(command.body, { expectedHeadVersion: 4, selection: ['original'] }); return response.promise; }, uncertain);
  form.expectedHeadVersion = 99; form.selection.push('new'); original.path = '/api/projects/other/media/renders'; original.key = 'different';
  response.reject(network()); await running;
  const saved = registry.snapshot('one').command;
  assert.deepEqual(saved.body, { expectedHeadVersion: 4, selection: ['original'] }); assert.equal(saved.key, 'render-once'); assert.equal(saved.path, '/api/projects/one/media/renders');
  assert.throws(() => saved.body.selection.push('tampered'), TypeError);
  assert.equal(await registry.run('one', original, async () => { calls++; }, uncertain), false, 'cannot replace an uncertain action with new intent');
  let notifications = 0; registry.subscribe('one', () => notifications++); assert.equal(calls, 1, 'remount/subscription never retries automatically');
  assert.equal(await registry.run('one', saved, async command => { calls++; assert.equal(command, saved); return {}; }, uncertain), true);
  assert.equal(calls, 2); assert.equal(notifications, 2); assert.equal(registry.snapshot('one').settledVersion, 2); assert.equal(registry.snapshot('one').command, null);
});

test('late completion updates only its original project and an API instance cannot adopt another session retry', async () => {
  const firstApi = {}, secondApi = {}, first = pendingCommandsFor(firstApi), second = pendingCommandsFor(secondApi), response = deferred(); let projectTwoNotifications = 0;
  first.subscribe('two', () => projectTwoNotifications++);
  const running = first.run('one', request('one'), () => response.promise, uncertain);
  assert.equal(first.snapshot('two').command, null); assert.equal(second.snapshot('one').command, null);
  response.reject(network()); await running;
  assert.equal(projectTwoNotifications, 0); assert.equal(first.snapshot('two').settledVersion, 0); assert.equal(second.snapshot('one').settledVersion, 0);
  assert.equal(first.snapshot('one').error.code, 'NETWORK_ERROR'); assert.ok(first.snapshot('one').command);
});

test('known rejection releases the slot for corrected intent while preserving the error for a remounted view', async () => {
  const registry = new PendingCommandRegistry(), failure = Object.assign(new Error('stale'), { code: 'REVISION_CONFLICT' });
  await registry.run('one', request(), async () => { throw failure; }, uncertain);
  assert.equal(registry.snapshot('one').command, null); assert.equal(registry.snapshot('one').error, failure); assert.equal(registry.snapshot('one').running, false);
  const corrected = { ...request(), key: 'corrected-request' };
  assert.equal(await registry.run('one', corrected, async () => ({}), uncertain), true);
  assert.equal(registry.snapshot('one').error, null); assert.equal(registry.snapshot('one').settledVersion, 2);
});

test('persisted active editing scope restores continuation and excludes superseded, read-only or shot-only requests', () => {
  const active = { id: 'saved-import', state: 'active', editing: true, scopeIds: ['project'] };
  const messages = [active, { ...active, id: 'old', state: 'superseded' }, { ...active, id: 'question', editing: false }, { ...active, id: 'shot', scopeIds: ['shot'] }, { ...active, id: 'foreign', scopeIds: ['other'] }];
  assert.equal(activeProjectEdit(messages, 'project'), 'saved-import');
  assert.equal(activeProjectEdit(messages.slice(1), 'project'), null);
  assert.equal(activeProjectEdit([...messages, { ...active, id: 'continued' }], 'project'), 'continued');
});

test('narration preparation retains its result and UI metadata across unmount and an exact retry', async () => {
  const api = {}, registry = pendingCommandsFor(api, 'narration'), response = deferred();
  const metadata = { label: 'Ready to review', effect: { kind: 'prepare' } };
  const command = { path: '/api/projects/one/narration/prepare', key: 'prepare-once', body: { sessionId: 'session', expectedHeadVersion: 3 }, metadata };
  let notifications = 0, calls = 0;
  const unsubscribe = registry.subscribe('one', () => notifications++);
  const running = registry.run('one', command, async () => { calls++; return response.promise; }, uncertain);
  unsubscribe(); const before = notifications;
  metadata.effect.kind = 'tampered';
  const remounted = pendingCommandsFor(api, 'narration');
  assert.equal(remounted.snapshot('one').running, true);
  assert.equal(pendingCommandsFor(api).snapshot('one').running, false, 'media and narration have distinct command slots');
  assert.equal(await remounted.run('one', remounted.snapshot('one').command, async () => { calls++; }, uncertain), false);
  response.reject(network()); await running;
  assert.equal(notifications, before, 'completion never calls an unmounted view');
  const saved = remounted.snapshot('one').command;
  assert.deepEqual(saved.metadata, { label: 'Ready to review', effect: { kind: 'prepare' } });
  const prepared = { id: 'prepared', requestId: 'request', shotImpact: [{ shotId: 'shot' }] };
  await remounted.run('one', saved, async () => { calls++; return prepared; }, uncertain);
  prepared.shotImpact[0].shotId = 'changed';
  const completion = pendingCommandsFor(api, 'narration').snapshot('one');
  assert.equal(calls, 2); assert.equal(completion.command, null); assert.equal(completion.lastSuccess, true);
  assert.deepEqual(completion.settledCommand, saved); assert.equal(completion.result.shotImpact[0].shotId, 'shot');
  assert.throws(() => completion.result.shotImpact.push({}), TypeError);
});
