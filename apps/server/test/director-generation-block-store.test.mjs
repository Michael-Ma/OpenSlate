import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { Store } from '../dist/persistence/store.js';
import { fixture } from './request-fixture.mjs';

function context(f, projectId = f.project.id) {
  const human = f.service.beginRequest(projectId, 'local-user', 'Make the requested keyframes.');
  const bridge = f.service.openEpoch(projectId, human);
  return { projectId, requestId: human.requestId, epochId: bridge.actor.epochId };
}
function block(scope, id = 'generation-block') {
  return { id, ...scope, key: 'make-keyframes-call', block: { kind: 'keyframes', sceneId: 'scene-0', code: 'ATTEMPT_EXISTS',
    shotIds: ['shot-0'], attempts: [{ attemptId: 'existing-attempt', shotId: 'shot-0', kind: 'image', phase: 'submission_unknown', action: 'human_release' }],
    at: '2026-10-27T12:00:00.000Z' } };
}
function putBlock(store, value, projectId = value.projectId) {
  return store.put('director_generation_block', value.id, projectId, value);
}

test('generation blocks require their original request and epoch from the same project', t => {
  const f = fixture(t), original = context(f), later = context(f), foreign = context(f, f.service.createProject('Other film').id);
  const valid = block(original);
  assert.deepEqual(putBlock(f.store, valid), valid);
  for (const [label, changes, code] of [
    ['missing request', { requestId: undefined }, 'REFERENCE_REQUIRED'],
    ['missing epoch', { epochId: undefined }, 'REFERENCE_REQUIRED'],
    ['unknown request', { requestId: 'missing-request' }, 'SCOPE_DENIED'],
    ['unknown epoch', { epochId: 'missing-epoch' }, 'SCOPE_DENIED'],
    ['new request with original epoch', { requestId: later.requestId }, 'SCOPE_DENIED'],
    ['original request with new epoch', { epochId: later.epochId }, 'SCOPE_DENIED'],
    ['foreign request', { requestId: foreign.requestId }, 'SCOPE_DENIED'],
    ['foreign epoch', { epochId: foreign.epochId }, 'SCOPE_DENIED'],
    ['foreign request and epoch', { requestId: foreign.requestId, epochId: foreign.epochId }, 'SCOPE_DENIED'],
  ]) {
    const value = { ...valid, id: label, ...changes };
    assert.throws(() => putBlock(f.store, value), { code }, label);
    assert.equal(f.store.get('director_generation_block', value.id), undefined, label);
  }
  assert.throws(() => putBlock(f.store, { ...valid, id: 'foreign-body', projectId: foreign.projectId }, original.projectId), { code: 'SCOPE_DENIED' });
  assert.throws(() => putBlock(f.store, { ...valid, id: 'foreign-row' }, foreign.projectId), { code: 'SCOPE_DENIED' });
  assert.deepEqual(f.store.list('director_generation_block', original.projectId), [valid]);
  assert.deepEqual(f.store.list('director_generation_block', foreign.projectId), []);
});

test('generation block history is immutable after later edits fence its original epoch', t => {
  const f = fixture(t), original = context(f), saved = block(original);
  putBlock(f.store, saved);
  const later = context(f);
  assert.equal(f.store.get('epoch', original.epochId).state, 'revoked');
  assert.deepEqual(putBlock(f.store, saved), saved);
  for (const changes of [
    { key: 'new-call' },
    { requestId: later.requestId, epochId: later.epochId },
    { block: { ...saved.block, code: 'SCENE_NOT_READY' } },
    { block: { ...saved.block, sceneId: 'scene-1' } },
    { block: { ...saved.block, shotIds: ['shot-1'] } },
    { block: { ...saved.block, attempts: [] } },
    { block: { ...saved.block, attempts: [{ ...saved.block.attempts[0], action: 'follow_existing_job' }] } },
    { block: { ...saved.block, at: '2026-10-28T12:00:00.000Z' } },
  ]) {
    assert.throws(() => putBlock(f.store, { ...saved, ...changes }), { code: 'IMMUTABLE_RECORD' });
    assert.deepEqual(f.store.get('director_generation_block', saved.id), saved);
  }
  assert.throws(() => putBlock(f.store, saved, f.service.createProject('Other film').id), { code: 'SCOPE_DENIED' });
  assert.deepEqual(f.store.list('director_generation_block', original.projectId), [saved]);
});

test('database backup and restore preserve generation blocks and effects as immutable turn history', async t => {
  const f = fixture(t), original = context(f), saved = block(original);
  const effect = { id: 'generation-effect', ...original, key: saved.key, effect: { kind: 'keyframes', sceneIds: ['scene-1'], shotIds: ['shot-1'],
    keyframes: 1, voiceLines: 0, quote: { micros: '0', units: 1, unitMicros: '0', priceUnknown: true }, at: saved.block.at } };
  putBlock(f.store, saved); f.store.insert('director_generation_effect', effect.id, original.projectId, effect);
  context(f);
  const backup = join(dirname(f.store.path), 'generation-history-backup.sqlite'), destination = join(dirname(f.store.path), 'generation-history-restored.sqlite');
  await f.store.backup(backup); Store.restore(backup, destination);
  const restored = new Store(destination);
  try {
    for (const [kind, value] of [['director_generation_block', saved], ['director_generation_effect', effect]]) {
      assert.deepEqual(restored.list(kind, original.projectId), [value]);
      assert.equal(restored.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, value.id).body,
        f.store.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, value.id).body);
      assert.deepEqual(restored.put(kind, value.id, original.projectId, value), value);
      assert.throws(() => restored.put(kind, value.id, original.projectId, { ...value, key: 'replacement-call' }), { code: 'IMMUTABLE_RECORD' });
    }
    assert.equal(restored.get('epoch', original.epochId).state, 'revoked');
    assert.equal(restored.get('message', original.requestId).id, original.requestId);
  } finally { restored.close(); }
});
