import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sceneConfirmationGuard } from '../dist/scene-confirmation-state.js';
import { projectFixture } from './execution-fixture.mjs';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';

test('a confirmation guard excludes scene metadata, siblings and runner-derived fields', () => {
  const project = projectFixture('guard-project'), lock = { id: 'lock', profiles: [] };
  const pin = { shotId: 'shot-0', artifactId: 'frame', sha256: 'a'.repeat(64), nodeId: 'image-node' };
  const guard = sceneConfirmationGuard(project, 'shot-0', lock, pin), edited = structuredClone(project);
  edited.scenes[0] = { ...edited.scenes[0], title: 'New scene title', purpose: 'New scene purpose', revisionId: 'new-scene-revision' };
  edited.shots[1] = { ...edited.shots[1], sceneId: edited.shots[0].sceneId, imagePrompt: 'Different sibling image', videoPrompt: 'Different sibling motion', desiredFrames: 240 };
  edited.shots[0] = { ...edited.shots[0], revisionId: 'derived-revision', cueId: 'accepted-voice', narrationTimingMode: 'within_shot', narrationPending: false };
  edited.cues = [{ id: 'accepted-voice', meaning: 'Accepted voice line', durationFrames: 30 }];
  edited.activePlanId = 'new-plan';
  assert.equal(sceneConfirmationGuard(edited, 'shot-0', lock, pin), guard);
});

test('a confirmation guard fences the own shot, exact frame pin and model lock', () => {
  const project = projectFixture('guard-project'), lock = { id: 'lock', profiles: [] };
  const pin = { shotId: 'shot-0', artifactId: 'frame', sha256: 'a'.repeat(64), nodeId: 'image-node' };
  const guard = sceneConfirmationGuard(project, 'shot-0', lock, pin);
  for (const [field, value] of Object.entries({ sceneId: 'other-scene', purpose: 'Other purpose', action: 'Other action', framing: 'Close-up', motion: 'Orbit',
    desiredFrames: 240, referenceArtifactIds: ['other-reference'], imagePrompt: 'Other image', videoPrompt: 'Other motion', narration: { mode: 'generated', text: 'Other words', voice: 'stock' } })) {
    const edited = structuredClone(project); edited.shots[0][field] = value;
    assert.notEqual(sceneConfirmationGuard(edited, 'shot-0', lock, pin), guard, field);
  }
  for (const [field, value] of Object.entries({ artifactId: 'other-frame', sha256: 'b'.repeat(64), nodeId: 'other-image-node' })) {
    assert.notEqual(sceneConfirmationGuard(project, 'shot-0', lock, { ...pin, [field]: value }), guard, `pin.${field}`);
  }
  assert.notEqual(sceneConfirmationGuard(project, 'shot-0', { ...lock, profiles: [{ id: 'other-model' }] }, pin), guard);
  assert.notEqual(sceneConfirmationGuard({ ...project, shots: project.shots.slice(1) }, 'shot-0', lock, pin), guard);
  const timed = structuredClone(project); timed.shots[0].cueId = 'picture-cue'; timed.cues = [{ id: 'picture-cue', meaning: 'Timed visual intent', durationFrames: 90 }];
  const timedGuard = sceneConfirmationGuard(timed, 'shot-0', lock, pin);
  for (const [field, value] of Object.entries({ meaning: 'Different timing intent', durationFrames: 120 })) {
    const edited = structuredClone(timed); edited.cues[0][field] = value;
    assert.notEqual(sceneConfirmationGuard(edited, 'shot-0', lock, pin), timedGuard, `cue.${field}`);
  }
});

async function queuedThirdClip(t) {
  const f = await confirmationFixture(t, { modes: ['none', 'none', 'none'] });
  await f.make(); await f.tick(6); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.runner.advance();
  const videos = f.store.list('node_binding', f.project.id).filter(b => b.node.kind === 'video');
  assert.equal(videos.length, 3);
  const held = videos.filter(b => b.node.shotId !== 'shot-2'), queued = videos.find(b => b.node.shotId === 'shot-2');
  for (const binding of held) f.provider.setMode(binding.id, 'pending');
  await f.engine.runReady();
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 2);
  assert.equal(f.store.get('node_wait', queued.id).code, 'CAPACITY_EXCEEDED');
  assert.equal((await f.overview()).shots['shot-2'].video.state, 'queued');
  return { f, queued, completeHeld: async () => {
    for (const attempt of f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video')) f.provider.complete(attempt.taskId);
    await f.engine.reconcile();
  } };
}

for (const edit of ['scene title', 'sibling image prompt']) test(`a ${edit} edit after confirm does not fence a queued remaining clip`, async t => {
  const { f, queued, completeHeld } = await queuedThirdClip(t);
  const body = edit === 'scene title' ? { kind: 'sceneTitle', id: 'scene-0', value: 'Renamed after confirming' }
    : { kind: 'shot', id: 'shot-0', field: 'imagePrompt', value: 'A changed sibling keyframe' };
  await f.call('POST', '/storyboard', { ...body, expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  await completeHeld(); await f.engine.runReady(); await f.engine.reconcile();
  const attempts = f.engine.attempts(f.project.id).filter(a => a.nodeId === queued.id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].phase, 'succeeded');
  assert.equal(f.provider.acceptedCount(attempts[0].id), 1);
  assert.equal((await f.overview()).shots['shot-2'].video.state, 'ready');
  assert.equal(f.store.get('node_wait', queued.id), undefined);
});

test('an own-shot change at admission takes off the stale confirmation and offers a new Confirm', async t => {
  const { f, queued, completeHeld } = await queuedThirdClip(t);
  // Exercise admission itself: a writer changed the source while its old candidate remained attached.
  const project = f.store.getProject(f.project.id), shot = project.shots.find(s => s.id === 'shot-2');
  shot.videoPrompt = 'A new exact motion recipe'; shot.revisionId = randomUUID();
  f.store.saveProject(project, project.headVersion);
  await completeHeld(); await f.engine.runReady();
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.nodeId === queued.id).length, 0);
  const binding = f.store.get('node_binding', queued.id), view = await f.overview();
  assert.equal(binding.candidateId, null);
  assert.equal(f.store.get('node_wait', queued.id), undefined);
  assert.equal(view.shots['shot-2'].video.takenOff, 'confirmation_stale');
  assert.notEqual(view.shots['shot-2'].video.state, 'queued');
  assert.deepEqual(view.scenes[0].videoTargets, ['shot-2']);
  assert.ok(view.scenes[0].confirmationDigest);
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.tick(5);
  assert.equal((await f.overview()).shots['shot-2'].video.state, 'ready');
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video' && a.nodeId === queued.id).length, 1);
});

for (const kind of ['keyframes', 'video']) test(`a legacy running ${kind} confirmation without shot guards blocks visibly before speech dispatch`, async t => {
  const f = await confirmationFixture(t, { modes: [kind === 'keyframes' ? 'generated' : 'none'] });
  await f.make();
  if (kind === 'video') {
    await f.tick(5);
    for (const [field, value] of [['mode', 'generated'], ['text', 'A legacy confirmation voice line']]) {
      await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field, value, expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
    }
    await f.openFrames();
    await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  }
  await f.runner.advance();
  const row = f.store.list('scene_confirmation', f.project.id).find(r => r.kind === kind);
  assert.equal(row.steps[0].step, 'attach');
  assert.equal(f.calls.speech, 0);
  delete row.shotGuardDigests; // Persisted before the per-shot guard contract existed.
  f.store.put('scene_confirmation', row.id, f.project.id, row);
  await f.runner.advance(); await f.tick(4);
  const current = f.store.get('scene_confirmation', row.id);
  assert.equal(current.state, 'blocked');
  assert.equal(current.blocker.code, 'SCENE_REVIEW_STALE');
  assert.equal(f.calls.speech, 0);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'speech' || a.request.kind === 'video').length, 0);
});
