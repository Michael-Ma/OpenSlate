import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/generation-fixture.mjs';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { makeDirectorKeyframes } from '../dist/application/director-keyframes.js';
import { NarrationService } from '../dist/narration/service.js';

const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
const binding = (f, kind) => f.store.list('node_binding', f.project.id).find(b => b.node.kind === kind && b.node.shotId === 'shot-0');
function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
function director(f, t, scopeIds = ['shot-0']) {
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'openslate-b1-recovery-skills-'));
  t.after(() => { writable(snapshotRoot); rmSync(snapshotRoot, { recursive: true, force: true }); });
  const saved = createDirectorSkillLock({ repositoryRoot: fileURLToPath(new URL('../../../', import.meta.url)), snapshotRoot }, '6.0.0');
  const contexts = new DirectorContextService(f.service, saved.environment);
  contexts.bootstrapLock(f.project.id, saved.lock);
  const human = f.service.beginRequest(f.project.id, 'local-user', 'Make new keyframes for the requested shots.', { source: 'user', editing: true, scopeIds });
  const actor = f.service.openEpoch(f.project.id, human).actor;
  contexts.capture(f.project.id, actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  return input => makeDirectorKeyframes(f.service, f.project.id, actor, randomUUID(), input, new NarrationService(f.service), () => { throw Error('No narration requested'); });
}
async function unknownVideo(f) {
  ok(await f.post(await f.get())); await f.finish();
  ok(await f.post(await f.get(), 'video'));
  f.provider.setMode(binding(f, 'video').id, 'unknown_after_accept');
  await f.engine.runReady();
  return f.engine.attempts(f.project.id).find(a => a.request.kind === 'video');
}

test('a detached unanswered clip identifies its human recovery before new keyframes, preserves liability and accepts a later result only as history', async t => {
  const f = fixture(t), old = await unknownVideo(f);
  assert.equal(old.phase, 'submission_unknown'); assert.equal(old.taskId, null);
  ok(await f.call('POST', '/storyboard', { kind: 'shot', field: 'imagePrompt', id: 'shot-0', value: 'The accepted new location', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }));
  await f.engine.runReady();
  assert.equal(binding(f, 'video').candidateId, null, 'the changed recipe detaches the old video candidate');
  assert.ok(!f.engine.currentAttemptIds(f.project.id).includes(old.id));
  const http = await f.post(await f.get(), 'image', randomUUID(), { targetShotIds: ['shot-0'], regenerate: true });
  assert.equal(http.statusCode, 409); assert.equal(http.json().error.code, 'ATTEMPT_EXISTS');
  const httpRecovery = http.json().error.details;
  assert.equal(httpRecovery.total, 1); assert.equal(httpRecovery.attempts[0].attemptId, old.id);
  const starts = f.provider.acceptedCount(), invoke = director(f, t);
  const before = f.store.db.prepare('SELECT kind,id,body FROM entities ORDER BY kind,id').all();
  const result = await invoke({ shotIds: ['shot-0'], regenerate: true });
  assert.deepEqual(result.started, []); assert.equal(result.refused[0].code, 'ATTEMPT_EXISTS');
  assert.match(result.next, /^Use the recovery steps for the requested scenes to choose the next action\./);
  assert.match(result.next, /Preserve unresolved work for reconciliation before any further submission/);
  assert.doesNotMatch(result.next, /No generation started/);
  const recovery = result.refused[0].recovery;
  assert.deepEqual(recovery, httpRecovery, 'HTTP and Director refusals carry the same allowlisted human recovery');
  assert.equal(recovery.total, 1); assert.equal(recovery.truncated, false);
  assert.deepEqual(recovery.attempts.map(({ attemptId, nodeId, shotId, kind, phase, detached }) => ({ attemptId, nodeId, shotId, kind, phase, detached })),
    [{ attemptId: old.id, nodeId: old.nodeId, shotId: 'shot-0', kind: 'video', phase: 'submission_unknown', detached: true }]);
  const resolution = recovery.attempts[0].resolution;
  assert.equal(resolution.action, 'human_release'); assert.match(resolution.instruction, /Keyframes.*Give up/);
  assert.match(resolution.instruction, /both jobs may be charged/); assert.match(resolution.instruction, /Director must not release or resubmit/);
  assert.deepEqual(resolution.release, { actor: 'human', method: 'POST', path: `/api/projects/${f.project.id}/attempts/${old.id}/release`,
    body: { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true } });
  assert.equal(f.provider.acceptedCount(), starts);
  assert.deepEqual(f.store.db.prepare("SELECT kind,id,body FROM entities WHERE kind!='director_keyframes_receipt' ORDER BY kind,id").all(), before,
    'the refusal publishes only its receipt and does not alter execution or creative state');
  const unresolved = f.provider.lookup.bind(f.provider);
  f.provider.lookup = async id => id === old.id ? { type: 'unknown', diagnostic: 'No retained provider answer' } : unresolved(id);
  await f.engine.reconcile(); await f.engine.runReady();
  assert.equal(f.provider.acceptedCount(), starts, 'recovery observes the original attempt without another purchase');
  const overview = await f.overview();
  assert.equal(overview.shots['shot-0'].video.state, 'no_answer'); assert.equal(overview.shots['shot-0'].video.attemptId, old.id);
  const bad = await f.call('POST', `/attempts/${old.id}/release`, { ...resolution.release.body, acknowledgeDoubleCharge: false });
  assert.equal(bad.json().error.code, 'DOUBLE_CHARGE_NOT_ACKNOWLEDGED'); assert.equal(f.store.get('attempt', old.id).released, undefined);
  const key = randomUUID(), release = () => f.call('POST', `/attempts/${old.id}/release`, resolution.release.body, key);
  const released = ok(await release()); assert.deepEqual(ok(await release()), released);
  assert.equal(f.store.get('reservation', old.reservationId).state, 'reserved');
  await f.engine.runReady(); assert.equal(f.provider.acceptedCount(), starts, 'human release itself never starts generation');
  ok(await f.post(await f.get(), 'image', randomUUID(), { targetShotIds: ['shot-0'], regenerate: true }));
  await f.finish(); const selectedFrame = binding(f, 'image').outputs.image;
  assert.equal(f.provider.acceptedCount(), starts + 1, 'only the fresh human generation press buys new work');
  f.provider.lookup = unresolved; await f.engine.reconcile();
  const completed = f.store.get('attempt', old.id);
  assert.equal(completed.phase, 'succeeded'); assert.ok(completed.outputs.video);
  assert.equal(f.store.get('reservation', old.reservationId).state, 'charged');
  assert.deepEqual(binding(f, 'video').outputs, {}, 'a late old clip cannot publish into the new recipe');
  assert.deepEqual(binding(f, 'image').outputs.image, selectedFrame);
  assert.equal(f.provider.acceptedCount(old.id), 1);
});

test('a known running keyframe names its job but never offers release, and unrelated shots do not enter the refusal', async t => {
  const f = fixture(t); ok(await f.post(await f.get()));
  f.provider.setMode(binding(f, 'image').id, 'pending'); await f.engine.runReady();
  ok(await f.post(await f.get('scene-1')));
  const unrelated = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image' && b.node.shotId === 'shot-1');
  f.provider.setMode(unrelated.id, 'unknown_after_accept'); await f.engine.runReady();
  const attempt = f.engine.attempts(f.project.id)[0], invoke = director(f, t), starts = f.provider.acceptedCount();
  const result = await invoke({ shotIds: ['shot-0'], regenerate: true });
  assert.deepEqual(result.started, []); assert.equal(result.refused[0].code, 'ATTEMPT_EXISTS');
  const recovery = result.refused[0].recovery;
  assert.equal(recovery.total, 1); assert.equal(recovery.attempts[0].attemptId, attempt.id);
  assert.equal(recovery.attempts[0].phase, 'remote_pending'); assert.equal(recovery.attempts[0].detached, false);
  assert.equal(recovery.attempts[0].resolution.action, 'follow_existing_job'); assert.equal(recovery.attempts[0].resolution.release, undefined);
  assert.ok(!JSON.stringify(recovery).includes(attempt.request.args.prompt), 'recovery does not expose request prompts');
  assert.equal(f.provider.acceptedCount(), starts);
});

test('the maximum 400-scene request preserves every refusal within the one-MiB tool-result bound', async t => {
  const f = fixture(t); ok(await f.post(await f.get()));
  f.provider.setMode(binding(f, 'image').id, 'unknown_after_accept'); await f.engine.runReady();
  const original = binding(f, 'image'), attempt = f.engine.attempts(f.project.id)[0], saved = f.store.getProject(f.project.id);
  const shots = Array.from({ length: 400 }, (_, index) => ({ ...saved.shots[0], id: `shot-${index}`, sceneId: `scene-${index}` }));
  const scenes = shots.map(shot => ({ ...saved.scenes[0], id: shot.sceneId }));
  f.store.saveProject({ ...saved, shots, scenes, maxFrames: 72000 }, saved.headVersion);
  const candidate = f.store.get('candidate', original.candidateId), grant = f.store.get('grant', candidate.grantId);
  const reservation = f.store.get('reservation', attempt.reservationId);
  // The old provider attempts are retained liabilities, like the detached video
  // in the snapshot. No provider submission is made to construct this fixture.
  for (let index = 1; index < shots.length; index++) {
    const id = `retired-image-${index}`, candidateId = `old-candidate-${index}`, grantId = `old-grant-${index}`;
    f.store.insert('grant', grantId, f.project.id, { ...grant, id: grantId, scopeId: shots[index].id });
    f.store.insert('candidate', candidateId, f.project.id, { ...candidate, id: candidateId, nodeId: id, grantId });
    f.store.insert('node_binding', id, f.project.id, { ...original, id, state: 'retired', candidateId,
      node: { ...original.node, id, shotId: shots[index].id } });
    const reservationId = `old-reservation-${index}`;
    f.store.insert('attempt', `old-attempt-${index}`, f.project.id, { ...attempt, id: `old-attempt-${index}`, nodeId: id, candidateId,
      reservationId, request: { ...attempt.request, attemptId: `old-attempt-${index}`, nodeId: id } });
    f.store.insert('reservation', reservationId, f.project.id, { ...reservation, id: reservationId, attemptId: `old-attempt-${index}` });
  }
  const starts = f.provider.acceptedCount(), invoke = director(f, t, [f.project.id]);
  const result = await invoke({ sceneIds: scenes.map(scene => scene.id) });
  assert.deepEqual(result.started, []); assert.equal(result.refused.length, 400);
  assert.ok(result.refused.every(refusal => refusal.code === 'ATTEMPT_EXISTS' && refusal.recovery.total === 1));
  assert.equal(result.refused.reduce((count, refusal) => count + refusal.recovery.attempts.length, 0), 20);
  assert.equal(result.refused.filter(refusal => refusal.recovery.truncated).length, 380);
  assert.ok(result.refused.every(refusal => /Open this scene in Keyframes/.test(refusal.recovery.instruction)), 'omitted identities still point to the existing human recovery');
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024 * 1024);
  assert.equal(f.provider.acceptedCount(), starts);
});
