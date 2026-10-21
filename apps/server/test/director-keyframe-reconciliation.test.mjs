import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { DirectorContextService } from '../dist/application/director-context.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';

function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
async function fixture(t) {
  const f = await confirmationFixture(t, { modes: ['none', 'none'] });
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'openslate-keyframe-reconciliation-skills-'));
  t.after(() => { writable(snapshotRoot); rmSync(snapshotRoot, { recursive: true, force: true }); });
  const saved = createDirectorSkillLock({ repositoryRoot: fileURLToPath(new URL('../../../', import.meta.url)), snapshotRoot }, '6.0.0');
  const contexts = new DirectorContextService(f.production, saved.environment);
  contexts.bootstrapLock(f.project.id, saved.lock);
  f.human = f.production.beginRequest(f.project.id, 'local-user', 'Make the keyframes for both shots.');
  f.bridge = f.production.openEpoch(f.project.id, f.human);
  contexts.capture(f.project.id, f.bridge.actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  f.tools = new ToolInvocationService(f.production, { enqueueVoice: f.runner.enqueueKeyframes });
  f.invoke = (callId, input = { sceneIds: ['scene-0'] }) => f.tools.invoke(f.project.id, f.bridge.actor, callId, 'make_keyframes', input);
  f.invocation = callId => f.store.list('tool_invocation', f.project.id).find(call => call.callId === callId);
  f.fence = () => {
    const epoch = f.store.get('epoch', f.bridge.actor.epochId);
    f.store.put('epoch', epoch.id, f.project.id, { ...epoch, state: 'revoked' });
  };
  f.reconcile = () => f.tools.reconcileEpoch(f.project.id, f.bridge.actor.epochId);
  return f;
}

function loseInitialReceiptReply(f) {
  const insert = f.store.insert.bind(f.store);
  let lost = false;
  f.store.insert = (...args) => {
    const value = insert(...args);
    if (!lost && args[0] === 'director_keyframes_receipt') {
      lost = true;
      throw Error('Synthetic crash after initial receipt, before any scene publication');
    }
    return value;
  };
  return () => { f.store.insert = insert; };
}

test('an interrupted empty keyframe receipt remains needs_followup without claiming a generation effect', async t => {
  const f = await fixture(t), restore = loseInitialReceiptReply(f);
  await assert.rejects(f.invoke('before-publication'), { code: 'TOOL_CALL_UNRESOLVED' }); restore();
  const call = f.invocation('before-publication'), saved = f.store.get('director_keyframes_receipt', call.id);
  assert.equal(call.state, 'unresolved'); assert.equal(saved.complete, false);
  assert.deepEqual(saved.started, []); assert.deepEqual(saved.refused, []);
  await assert.rejects(f.invoke('before-publication'), { code: 'TOOL_CALL_UNRESOLVED' });
  f.fence(); f.reconcile(); f.reconcile();
  const reconciliation = f.store.get('tool_reconciliation', call.id);
  assert.equal(reconciliation.state, 'needs_followup'); assert.equal(reconciliation.receipt, null);
  assert.equal(f.store.list('tool_reconciliation', f.project.id).length, 1);
  for (const kind of ['grant', 'candidate', 'attempt', 'reservation', 'director_generation_effect']) assert.equal(f.store.list(kind, f.project.id).length, 0, kind);
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.calls.speech, 0);
});

test('a scene committed before its progress checkpoint is recovered from its atomic effect after restart', async t => {
  const f = await fixture(t), put = f.store.put.bind(f.store);
  let lost = false;
  f.store.put = (...args) => {
    if (!lost && args[0] === 'director_keyframes_receipt' && args[3].started.length) {
      lost = true;
      throw Error('Synthetic crash after scene publication, before its progress checkpoint');
    }
    return put(...args);
  };
  await assert.rejects(f.invoke('after-publication'), { code: 'TOOL_CALL_UNRESOLVED' }); f.store.put = put;
  const call = f.invocation('after-publication'), saved = f.store.get('director_keyframes_receipt', call.id);
  assert.equal(saved.complete, false); assert.deepEqual(saved.started, []);
  const effects = f.store.list('director_generation_effect', f.project.id), candidates = f.store.list('candidate', f.project.id);
  assert.equal(effects.length, 1); assert.equal(candidates.length, 2);
  assert.equal(effects[0].key, `director-keyframes:${call.id}:scene-0`);
  await f.restart();
  f.tools = new ToolInvocationService(f.production, { enqueueVoice: f.runner.enqueueKeyframes });
  await assert.rejects(f.invoke('after-publication'), { code: 'TOOL_CALL_UNRESOLVED' });
  f.fence(); f.reconcile(); f.reconcile();
  const reconciliation = f.store.get('tool_reconciliation', call.id);
  assert.equal(reconciliation.state, 'effect_confirmed'); assert.equal(reconciliation.receipt.complete, false);
  assert.deepEqual(reconciliation.receipt.started, [{ ...effects[0].effect, sceneId: 'scene-0' }]);
  assert.deepEqual(reconciliation.receipt.refused, []);
  assert.deepEqual(f.store.list('director_generation_effect', f.project.id), effects);
  assert.deepEqual(f.store.list('candidate', f.project.id), candidates);
  assert.equal(f.store.list('tool_reconciliation', f.project.id).length, 1);
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.calls.speech, 0, 'reconciliation dispatches no paid work');
});

test('a different successful invocation in the same request cannot settle an empty interrupted keyframe call', async t => {
  const f = await fixture(t);
  const first = await f.invoke('published-first', { shotIds: ['shot-0'] });
  assert.equal(first.started.length, 1);
  const effects = f.store.list('director_generation_effect', f.project.id), candidates = f.store.list('candidate', f.project.id);
  const changedEffect = structuredClone(effects[0]); changedEffect.effect.keyframes++;
  assert.throws(() => f.store.put('director_generation_effect', changedEffect.id, f.project.id, changedEffect), { code: 'IMMUTABLE_RECORD' });
  const firstCall = f.invocation('published-first'), completed = f.store.get('director_keyframes_receipt', firstCall.id);
  assert.equal(completed.complete, true);
  assert.throws(() => f.store.put('director_keyframes_receipt', firstCall.id, f.project.id, { ...completed, started: [] }), { code: 'IMMUTABLE_RECORD' });
  const restore = loseInitialReceiptReply(f);
  await assert.rejects(f.invoke('interrupted-second', { shotIds: ['shot-1'] }), { code: 'TOOL_CALL_UNRESOLVED' }); restore();
  const second = f.invocation('interrupted-second');
  f.fence(); f.reconcile();
  assert.equal(f.store.get('tool_reconciliation', second.id).state, 'needs_followup');
  assert.equal(f.store.get('tool_reconciliation', second.id).receipt, null);
  assert.equal(f.store.get('tool_reconciliation', f.invocation('published-first').id), undefined);
  assert.deepEqual(f.store.list('director_generation_effect', f.project.id), effects);
  assert.deepEqual(f.store.list('candidate', f.project.id), candidates);
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.calls.speech, 0);
});
