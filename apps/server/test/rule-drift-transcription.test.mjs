import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { digest, shotIntentDigest } from '@openslate/core';
import { createInstallationBackup, inspectInstallationBackup } from '../dist/persistence/installation-backup.js';
import { ownedTranscriptionFixture } from './owned-transcription-fixture.mjs';
import { projectFixture, sourceFor } from './execution-fixture.mjs';

async function fixture(t) {
  const f = await ownedTranscriptionFixture(t);
  const current = f.store.getProject(f.project.id), shape = projectFixture(current.id, 2);
  const original = f.store.saveProject({ ...current, ...shape, capabilityLockId: current.capabilityLockId }, current.headVersion);
  f.store.put('project_revision', original.revisionId, original.id, { project: original });
  f.production.authorize(original.id, f.human, original.shots.flatMap(shot => ['image', 'video'].map(kind => ({ scopeId: shot.id, kind }))), randomUUID());
  const prepared = await f.production.prepare(original.id, f.actor, { variant: 'plan', expectedHeadVersion: original.headVersion, source: sourceFor(original) });
  f.production.apply(original.id, f.actor, prepared.id);
  const project = f.store.getProject(original.id), base = f.store.get('plan', project.activePlanId).compiled;
  project.revisionId = randomUUID();
  for (const shot of project.shots) {
    shot.revisionId = randomUUID(); shot.action = `Accepted new writing for ${shot.id}`;
    shot.imagePrompt = `Accepted new image for ${shot.id}`; shot.videoPrompt = `Accepted new motion for ${shot.id}`;
    shot.promptIntent = { image: shotIntentDigest(shot, 'image'), video: shotIntentDigest(shot, 'video') };
  }
  const saved = f.store.saveProject(project, project.headVersion);
  f.store.put('project_revision', saved.revisionId, saved.id, { project: saved });
  return { ...f, original, base };
}

test('owned recording transcription prepares, publishes and backs up without recompiling unrelated accepted picture edits', async t => {
  const f = await fixture(t), before = f.store.getProject(f.project.id);
  const paid = ['grant', 'candidate', 'attempt'].map(kind => f.store.list(kind, f.project.id));
  const proposal = await f.prepare();
  assert.deepEqual(proposal.compiled.nodes.filter(node => node.kind !== 'transcription'), f.base.nodes);
  assert.deepEqual(proposal.compiled.gates, f.base.gates);
  assert.deepEqual(f.store.getProject(f.project.id), before);
  assert.deepEqual(['grant', 'candidate', 'attempt'].map(kind => f.store.list(kind, f.project.id)), paid);
  assert.equal(f.provider.acceptedCount(), 0);
  assert.equal(proposal.baseProject.digest, digest(before));
  const input = { key: randomUUID(), proposalId: proposal.id, proposalDigest: digest(proposal) };
  const receipt = await f.service.review(f.project.id, f.human, input);
  const published = f.store.get('plan', receipt.applied.activePlanId).compiled;
  assert.deepEqual(published, proposal.compiled);
  assert.deepEqual(published.nodes.filter(node => node.kind !== 'transcription'), f.base.nodes);
  assert.deepEqual(published.gates, f.base.gates);
  for (const [index, kind] of ['grant', 'candidate', 'attempt'].entries()) {
    for (const old of paid[index]) assert.deepEqual(f.store.get(kind, old.id), old);
    assert.equal(f.store.list(kind, f.project.id).length, paid[index].length + (kind === 'attempt' ? 0 : 1));
  }
  const grant = f.store.get('grant', receipt.grantId);
  assert.equal(grant.kind, 'transcription'); assert.equal(grant.authorityId, f.human.requestId);
  assert.deepEqual(await f.service.review(f.project.id, f.human, input), receipt);
  assert.equal(f.provider.acceptedCount(), 0);
  f.store.close(); f.provider.close();
  const backup = await createInstallationBackup({ sourceRoot: f.root, destination: join(f.parent, 'historical-picture-backup') });
  assert.deepEqual(await inspectInstallationBackup({ directory: backup.directory }), backup);
});

for (const corruption of ['missing_snapshot', 'forged_snapshot', 'forged_recipe']) test(`historical transcription preserves refusal for ${corruption}`, async t => {
  const f = await fixture(t), project = f.store.getProject(f.project.id);
  if (corruption === 'missing_snapshot') f.store.db.prepare("DELETE FROM entities WHERE kind='project_revision' AND id=?").run(f.original.revisionId);
  else if (corruption === 'forged_snapshot') {
    const record = f.store.get('project_revision', f.original.revisionId);
    record.project.shots[0].action = 'Forged source action under the original revision';
    record.project.shots[0].promptIntent = { image: shotIntentDigest(record.project.shots[0], 'image'), video: shotIntentDigest(record.project.shots[0], 'video') };
    f.store.db.prepare("UPDATE entities SET body=? WHERE kind='project_revision' AND id=?").run(JSON.stringify(record), f.original.revisionId);
  } else {
    const plan = f.store.get('plan', project.activePlanId);
    plan.compiled.nodes[0].args.prompt = 'Forged cached recipe';
    f.store.db.prepare("UPDATE entities SET body=? WHERE kind='plan' AND id=?").run(JSON.stringify(plan), plan.id);
  }
  const before = ['grant', 'candidate', 'attempt', 'owned_transcription_proposal'].map(kind => f.store.list(kind, f.project.id));
  await assert.rejects(f.prepare());
  assert.deepEqual(['grant', 'candidate', 'attempt', 'owned_transcription_proposal'].map(kind => f.store.list(kind, f.project.id)), before);
  assert.equal(f.provider.acceptedCount(), 0);
});
