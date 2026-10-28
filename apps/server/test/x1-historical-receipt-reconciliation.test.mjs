import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { digest } from '@openslate/core';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';

function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
function fixture(t, predecessor, tool = 'record_notes') {
  let snapshotRoot;
  t.after(() => { if (snapshotRoot) writable(snapshotRoot); });
  const f = setup(t), service = new ProductionService(f.store, f.engine);
  const snapshot = JSON.parse(readFileSync(new URL(`./fixtures/director-guidance-v7-before-${predecessor}.json`, import.meta.url), 'utf8'));
  const checkout = join(f.directory, 'old-application'); snapshotRoot = join(f.directory, 'snapshots');
  for (const [path, content] of Object.entries(snapshot.files)) {
    const target = join(checkout, 'skills', 'v7', path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content);
  }
  const created = createDirectorSkillLock({ repositoryRoot: checkout, snapshotRoot }, '6.0.0');
  const { lockDigest: _, ...body } = structuredClone(created.lock);
  body.bindings = body.bindings.map(binding => binding.kind === 'handler' ? { ...binding, digest: snapshot.catalog.digest } : binding);
  const lock = { ...body, lockDigest: digest(body) };
  const actor = service.beginRequest(f.projectId, 'local-user', 'The original conversation'), { actor: director } = service.openEpoch(f.projectId, actor);
  const call = { id: 'historical-call', projectId: f.projectId, requestId: actor.requestId, epochId: director.epochId,
    callId: 'original-call', tool, toolContractVersion: '6.0.0', catalogDigest: snapshot.catalog.digest, skillLockId: lock.id,
    argumentsDigest: digest({ original: 'arguments' }), state: 'unresolved', result: null, resultDigest: null, error: { code: 'TOOL_CALL_UNRESOLVED', message: 'lost reply' } };
  f.store.insert('director_skill_lock', lock.id, f.projectId, { id: lock.id, projectId: f.projectId, lock });
  f.store.insert('director_epoch_lock', director.epochId, f.projectId,
    { projectId: f.projectId, requestId: actor.requestId, epochId: director.epochId, lockId: lock.id });
  f.store.insert('tool_invocation', call.id, f.projectId, call);
  const receipt = tool === 'record_notes' ? { notes: [{ noteId: 'original-note', letter: 'a' }] } : { proposalId: 'original-proposal', state: 'held' };
  const receiptKind = tool === 'record_notes' ? 'director_notes_receipt' : 'director_proposal_receipt';
  f.store.insert(receiptKind, call.id, f.projectId,
    { projectId: f.projectId, requestId: actor.requestId, epochId: director.epochId, argumentsDigest: call.argumentsDigest, receipt });
  const epoch = f.store.get('epoch', director.epochId);
  f.store.put('epoch', epoch.id, f.projectId, { ...epoch, state: 'revoked' });
  return { ...f, service, call, lock, receipt, receiptKind, tools: new ToolInvocationService(service), epoch };
}

for (const predecessor of ['k1', 'n1', 'p1']) for (const tool of ['record_notes', 'propose_change'])
  test(`a pre-${predecessor} committed ${tool} receipt reconciles through its exact original lock after amendment`, t => {
    const f = fixture(t, predecessor, tool), before = f.store.getProject(f.projectId);
    const grants = f.store.list('grant', f.projectId), candidates = f.store.list('candidate', f.projectId);
    f.tools.reconcileEpoch(f.projectId, f.call.epochId);
    assert.equal(f.store.get('tool_reconciliation', f.call.id).state, 'effect_confirmed');
    assert.deepEqual(f.store.get('tool_reconciliation', f.call.id).receipt, f.receipt);
    const cursor = f.store.cursor(f.projectId); f.tools.reconcileEpoch(f.projectId, f.call.epochId);
    assert.equal(f.store.cursor(f.projectId), cursor, 'reconciliation is idempotent');
    assert.deepEqual(f.store.getProject(f.projectId), before);
    assert.deepEqual(f.store.list('grant', f.projectId), grants);
    assert.deepEqual(f.store.list('candidate', f.projectId), candidates);
    assert.equal(f.engine.attempts(f.projectId).length, 0); assert.equal(f.provider.acceptedCount(), 0);
  });

for (const variant of ['unknown-catalog', 'tampered-lock', 'malformed-lock', 'malformed-skill', 'unknown-package', 'extra-handler', 'mismatched-handler', 'wrong-lock', 'wrong-epoch-request', 'wrong-receipt-arguments'])
  test(`historical receipt reconciliation refuses ${variant}`, t => {
    const f = fixture(t, 'p1');
    if (variant === 'unknown-catalog') f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.catalogDigest',?) WHERE kind='tool_invocation' AND id=?").run('0'.repeat(64), f.call.id);
    if (variant === 'tampered-lock') f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.lock.lockDigest',?) WHERE kind='director_skill_lock' AND id=?").run('0'.repeat(64), f.lock.id);
    if (variant === 'malformed-lock') f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.lock',null) WHERE kind='director_skill_lock' AND id=?").run(f.lock.id);
    if (['unknown-package', 'malformed-skill', 'extra-handler', 'mismatched-handler'].includes(variant)) {
      const { lockDigest: _, ...body } = structuredClone(f.lock);
      if (variant === 'unknown-package') body.skills[0].packageDigest = '0'.repeat(64);
      if (variant === 'malformed-skill') body.skills = [null, body.skills[1]];
      if (variant === 'extra-handler') body.bindings.push({ kind: 'handler', id: 'unknown-handler', digest: '0'.repeat(64) });
      if (variant === 'mismatched-handler') body.bindings.find(binding => binding.kind === 'handler').digest = '0'.repeat(64);
      f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.lock',json(?)) WHERE kind='director_skill_lock' AND id=?")
        .run(JSON.stringify({ ...body, lockDigest: digest(body) }), f.lock.id);
    }
    if (variant === 'wrong-lock') f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.skillLockId',?) WHERE kind='tool_invocation' AND id=?").run('another-lock', f.call.id);
    if (variant === 'wrong-epoch-request') f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.requestId',?) WHERE kind='director_epoch_lock' AND id=?").run('another-request', f.call.epochId);
    if (variant === 'wrong-receipt-arguments') f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.argumentsDigest',?) WHERE kind=? AND id=?").run('0'.repeat(64), f.receiptKind, f.call.id);
    f.tools.reconcileEpoch(f.projectId, f.call.epochId);
    assert.equal(f.store.get('tool_reconciliation', f.call.id).state, 'needs_followup');
    assert.equal(f.engine.attempts(f.projectId).length, 0); assert.equal(f.provider.acceptedCount(), 0);
  });
