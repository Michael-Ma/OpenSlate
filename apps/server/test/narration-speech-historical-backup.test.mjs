import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, planSourceBaseRevision, shotIntentDigest } from '@openslate/core';
import { createInstallationBackup, inspectInstallationBackup } from '../dist/persistence/installation-backup.js';
import { narrationSpeechFixture } from './narration-speech-fixture.mjs';

async function historicalFixture(t) {
  const f = await narrationSpeechFixture(t, { plan: true });
  const current = f.store.getProject(f.project.id), base = f.store.get('plan', current.activePlanId).compiled;
  const sourceRevisionId = planSourceBaseRevision(base);
  // This legacy direct-store fixture bypasses normal revision publication; retain
  // the exact preparation snapshot as real plan publication would have done.
  const original = f.store.list('prepared', f.project.id).find(row => row.next.revisionId === sourceRevisionId).next;
  f.store.put('project_revision', sourceRevisionId, f.project.id, { project: original });
  const shots = structuredClone(current.shots);
  shots[1].motion = 'A newly saved camera move'; shots[1].revisionId = randomUUID();
  shots[1].promptIntent.video = shotIntentDigest(shots[1], 'video');
  const saved = f.store.saveProject({ ...current, shots, revisionId: randomUUID() }, current.headVersion);
  f.store.insert('project_revision', saved.revisionId, saved.id, { project: saved });
  const dormant = f.store.list('node_binding', saved.id).find(binding => binding.node.kind === 'video' && binding.node.shotId === 'shot-1');
  f.store.put('node_binding', dormant.id, saved.id, { ...dormant, candidateId: null, outputs: {} });
  return { ...f, base, saved, dormant, sourceRevisionId };
}

for (const reviewed of [false, true]) test(`backup recomposes a ${reviewed ? 'reviewed' : 'prepared'} standalone voice against its exact historical visual source`, async t => {
  const f = await historicalFixture(t), before = f.store.getProject(f.project.id), grants = f.store.list('grant', before.id).length;
  const proposal = await f.prepare();
  assert.deepEqual(f.store.getProject(before.id), before, 'speech preparation keeps the saved project and visual work intact');
  assert.deepEqual(proposal.compiled.nodes.filter(node => node.alias !== proposal.operation.alias), f.base.nodes);
  assert.deepEqual(proposal.compiled.gates, f.base.gates);
  assert.equal(planSourceBaseRevision(proposal.compiled), f.sourceRevisionId);
  assert.notEqual(proposal.baseProject.revisionId, f.sourceRevisionId);
  if (reviewed) await f.review(proposal);
  assert.equal(f.store.list('grant', before.id).length, grants + Number(reviewed));
  assert.equal(f.store.get('node_binding', f.dormant.id).candidateId, null, 'speech cannot reactivate the detached video grant');
  assert.deepEqual(f.store.get('node_binding', f.dormant.id).outputs, {});
  assert.equal(f.store.list('attempt', before.id).length, 0);
  assert.equal(f.calls.http, 0);
  f.store.close(); f.provider.close();
  const backup = await createInstallationBackup({ sourceRoot: f.root, destination: join(f.parent, 'historical-backup') });
  assert.deepEqual(await inspectInstallationBackup({ directory: backup.directory }), backup);
});

test('historical speech backup still rejects a forged original visual project snapshot', async t => {
  const f = await historicalFixture(t);
  await f.prepare();
  const original = f.store.get('project_revision', f.sourceRevisionId);
  original.project.shots[0].action = 'Forged visual action';
  original.project.shots[0].promptIntent.image = shotIntentDigest(original.project.shots[0], 'image');
  original.project.shots[0].promptIntent.video = shotIntentDigest(original.project.shots[0], 'video');
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='project_revision' AND id=?").run(canonical(original), f.sourceRevisionId);
  await assert.rejects(createInstallationBackup({ sourceRoot: f.root, destination: join(f.parent, 'forged-historical-backup') }));
});
