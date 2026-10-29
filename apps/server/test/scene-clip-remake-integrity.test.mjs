import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { editStoryboard } from '../dist/storyboard.js';

async function saved(t) {
  const f = await confirmationFixture(t);
  await f.make(); await f.tick(12); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.tick(8);
  assert.equal((await f.overview()).scenes[0].counts.videosReady, 2);
  return f;
}

async function body(f, targetShotIds = ['shot-0']) {
  const view = await f.overview();
  return { confirmationDigest: view.scenes[0].confirmationDigest, targetShotIds,
    expectedEstimateMicros: targetShotIds.reduce((sum, id) => sum + BigInt(view.shots[id].quotes.remakeClip.micros), 0n).toString(),
    reviewedFrames: targetShotIds.map(shotId => ({ shotId, artifactId: view.shots[shotId].keyframe.artifact.artifactId,
      sha256: view.shots[shotId].keyframe.artifact.sha256 })) };
}

test('a remake publication lost before checkpoint replays after restart without another candidate, voice or charge', async t => {
  const f = await saved(t), input = await body(f), key = randomUUID();
  const receipt = await f.call('POST', '/scenes/scene-0/remake-clips', input, key).then(f.ok);
  await f.runner.advance();
  const published = f.store.get('scene_confirmation', receipt.confirmationId);
  assert.equal(published.state, 'done', JSON.stringify(published.blocker));
  const interrupted = { ...published, state: 'running' };
  delete interrupted.videoResult;
  f.store.put('scene_confirmation', interrupted.id, f.project.id, interrupted);
  const grants = f.store.list('grant', f.project.id), candidates = f.store.list('candidate', f.project.id);
  await f.restart(); await f.tick(8);
  assert.equal(f.store.get('scene_confirmation', receipt.confirmationId).state, 'done');
  assert.deepEqual(f.store.list('grant', f.project.id), grants);
  assert.deepEqual(f.store.list('candidate', f.project.id), candidates);
  assert.deepEqual(await f.call('POST', '/scenes/scene-0/remake-clips', input, key).then(f.ok), receipt);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 3);
  assert.equal(f.provider.acceptedCount(), 5, 'two original frames, two original clips and one replacement');
  assert.equal(f.calls.speech, 1);
  assert.equal(f.engine.budget(f.project.id).committedMicros, '3300');
});

test('Stop before remake dispatch preserves the selected clip and never resumes unsent work on restart', async t => {
  const f = await saved(t), before = await f.overview(), attempts = f.engine.attempts(f.project.id).length;
  const receipt = await f.call('POST', '/scenes/scene-0/remake-clips', await body(f)).then(f.ok);
  await f.call('POST', '/controls', { action: 'stop' }).then(f.ok);
  await f.restart(); await f.tick(6);
  assert.equal(f.store.get('scene_confirmation', receipt.confirmationId).state, 'cancelled');
  assert.equal(f.engine.attempts(f.project.id).length, attempts);
  assert.deepEqual((await f.overview()).shots['shot-0'].video.artifact, before.shots['shot-0'].video.artifact);
  assert.equal(f.calls.speech, 1);
});

test('an edit during remake composition fences the old request before a candidate or paid job is created', async t => {
  const f = await saved(t), candidates = f.store.list('candidate', f.project.id), attempts = f.engine.attempts(f.project.id);
  const receipt = await f.call('POST', '/scenes/scene-0/remake-clips', await body(f)).then(f.ok);
  const advancing = f.runner.advance();
  editStoryboard(f.production, f.project.id, { kind: 'shot', id: 'shot-0', field: 'motion', value: 'A newly requested camera move',
    expectedHeadVersion: f.store.getProject(f.project.id).headVersion }, randomUUID());
  await advancing; await f.tick(6);
  const row = f.store.get('scene_confirmation', receipt.confirmationId);
  assert.equal(row.state, 'blocked'); assert.equal(row.blocker.code, 'SCENE_REVIEW_STALE');
  assert.deepEqual(f.store.list('candidate', f.project.id), candidates);
  assert.deepEqual(f.engine.attempts(f.project.id), attempts);
  assert.equal(f.calls.speech, 1);
});

test('a changed remake quote refuses atomically before buying a clip or another voice line', async t => {
  const f = await saved(t), before = await f.overview(), budget = f.engine.budget(f.project.id), accepted = f.provider.acceptedCount();
  const candidates = f.store.list('candidate', f.project.id), grants = f.store.list('grant', f.project.id);
  const response = await f.call('POST', '/scenes/scene-0/remake-clips', { ...await body(f), expectedEstimateMicros: '999999' });
  assert.equal(response.json().error.code, 'ESTIMATE_CHANGED', response.body);
  await f.tick(8);
  assert.equal(f.provider.acceptedCount(), accepted);
  assert.deepEqual(f.store.list('candidate', f.project.id), candidates);
  assert.deepEqual(f.store.list('grant', f.project.id), grants);
  assert.equal(f.engine.budget(f.project.id).committedMicros, budget.committedMicros);
  assert.deepEqual((await f.overview()).shots['shot-0'].video.artifact, before.shots['shot-0'].video.artifact);
  assert.equal(f.calls.speech, 1);
});
