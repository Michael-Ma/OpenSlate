import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { narrationSpeechFixture } from './narration-speech-fixture.mjs';
import { randomUUID } from 'node:crypto';
import { digest, planSourceBaseRevision } from '@openslate/core';

async function requestVoiceAfterFrames(f) {
  for (const [field, value] of [['mode', 'generated'], ['text', 'The saved voice line.']]) {
    await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field, value,
      expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  }
}

test('missing immutable visual source revision reports the specific keyframe recovery step before buying speech', async t => {
  const f = await narrationSpeechFixture(t, { plan: true });
  const before = f.store.getProject(f.project.id), shots = structuredClone(before.shots);
  shots[1].motion = 'Different saved motion'; shots[1].revisionId = randomUUID();
  const saved = f.store.saveProject({ ...before, shots, revisionId: randomUUID() }, before.headVersion);
  f.store.insert('project_revision', saved.revisionId, saved.id, { project: saved });
  const sourceRevisionId = planSourceBaseRevision(f.store.get('plan', before.activePlanId).compiled);
  f.store.db.prepare("DELETE FROM entities WHERE kind='project_revision' AND id=?").run(sourceRevisionId);
  const grants = f.store.list('grant', f.project.id).length, plans = f.store.list('plan', f.project.id).length;
  await assert.rejects(f.service.request(f.project.id, f.human, f.input()), error => {
    assert.equal(error.code, 'NARRATION_PLAN_REBASE_REQUIRED');
    assert.match(error.message, /Regenerate the affected shot keyframes/);
    return true;
  });
  assert.equal(f.store.list('grant', f.project.id).length, grants);
  assert.equal(f.store.list('plan', f.project.id).length, plans);
  assert.equal(f.store.list('narration_speech_proposal', f.project.id).length, 0);
  assert.equal(f.store.list('attempt', f.project.id).length, 0);
  assert.equal(f.calls.http, 0);
  assert.deepEqual(f.store.getProject(f.project.id), saved);
});

for (const checkpoint of ['before preparation', 'after preparation']) test(`the exact historical-graph voice request survives restart ${checkpoint} without another purchase`, async t => {
  const f = await confirmationFixture(t, { modes: ['none', 'none'] });
  await f.make(); await f.tick(5); await requestVoiceAfterFrames(f);
  await f.call('POST', '/storyboard', { kind: 'shot', id: 'shot-1', field: 'motion', value: 'Slow tracking motion',
    expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const actor = f.production.beginRequest(f.project.id, 'local-user', 'Make this saved voice line.',
    { source: 'app', concurrency: 'alongside', holdScopeIds: [], scopeIds: ['shot-0'] });
  const project = f.store.getProject(f.project.id), shot = project.shots[0];
  const input = { key: randomUUID(), expectedHeadVersion: project.headVersion, segmentId: shot.id,
    segmentRevisionId: digest({ shotId: shot.id, narration: shot.narration }), profileId: 'offline-speech', voice: 'coral', instructions: '' };
  if (checkpoint === 'after preparation') {
    await f.narrationSpeech.prepareRequest(project.id, actor, input);
    assert.equal(f.store.list('narration_speech_proposal', project.id).length, 1);
    assert.equal(f.store.list('grant', project.id).filter(grant => grant.kind === 'speech').length, 0);
    assert.equal(f.calls.speech, 0);
    assert.deepEqual(f.store.getProject(project.id), project, 'preparation never mutates the current project');
  }
  await f.restart();
  const result = await f.narrationSpeech.request(project.id, actor, input);
  assert.equal(f.store.list('narration_plan_rebase', project.id).length, 0);
  await f.tick(4);
  assert.equal(f.calls.speech, 1);
  await f.restart();
  assert.deepEqual(await f.narrationSpeech.request(project.id, actor, input), result);
  await f.tick(3);
  assert.equal(f.store.list('narration_plan_rebase', project.id).length, 0);
  assert.equal(f.store.list('grant', project.id).filter(grant => grant.kind === 'speech').length, 1);
  assert.equal(f.engine.attempts(project.id).filter(attempt => attempt.request.kind === 'speech').length, 1);
  assert.equal(f.calls.speech, 1);
});

test('invalid speech data cannot change a stale plan before its refusal', async t => {
  const f = await narrationSpeechFixture(t, { plan: true });
  const before = f.store.getProject(f.project.id), shots = structuredClone(before.shots);
  shots[1].revisionId = randomUUID();
  const saved = f.store.saveProject({ ...before, shots, revisionId: randomUUID() }, before.headVersion);
  f.store.insert('project_revision', saved.revisionId, saved.id, { project: saved });
  await assert.rejects(f.service.request(f.project.id, f.human, f.input({ profileId: 'missing-speech-profile' })), { code: 'NARRATION_SPEECH_INVALID' });
  assert.equal(f.store.list('narration_plan_rebase', saved.id).length, 0);
  assert.equal(f.store.list('narration_speech_proposal', saved.id).length, 0);
  assert.deepEqual(f.store.getProject(saved.id), saved);
});

for (const priorVideo of [false, true]) for (const press of ['confirm', 'voice-only keyframes']) for (const field of ['motion', 'desiredFrames', 'videoPrompt']) for (const shotId of ['shot-0', 'shot-1']) {
  test(`${press} composes speech after ${shotId === 'shot-0' ? 'its own' : 'a sibling'} ${field} edit${priorVideo ? ' with a prior video plan' : ''} and completes the clips`, async t => {
    const f = await confirmationFixture(t, { modes: ['none', 'none'] });
    await f.make(); await f.tick(5);
    if (priorVideo) {
      await f.openFrames();
      await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
      await f.tick(10);
      assert.equal((await f.overview()).scenes[0].counts.videosReady, 2);
    }
    const images = f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'image').length;
    await requestVoiceAfterFrames(f);
    await f.call('POST', '/storyboard', { kind: 'shot', id: shotId, field,
      value: field === 'desiredFrames' ? '240' : 'A slow push toward the doorway',
      expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
    if (priorVideo && press === 'confirm' && shotId !== 'shot-0') {
      const project = f.store.getProject(f.project.id);
      // Confirm settles narration only for clips it is making. Explicitly remake
      // the voiced shot too while preserving its saved picture and motion.
      await f.call('POST', '/storyboard', { kind: 'shot', id: 'shot-0', field: 'videoPrompt', value: project.shots[0].videoPrompt,
        expectedHeadVersion: project.headVersion }).then(f.ok);
    }
    const before = await f.overview();
    assert.equal(before.scenes[0].counts.keyframesReady, 2);
    assert.equal(before.scenes[0].quotes.makeKeyframes.units, 1, 'the next keyframes press buys only the missing line');
    if (press === 'confirm') {
      await f.openFrames();
      await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
    } else await f.make();
    await f.tick(14);
    const voiceRun = f.store.list('scene_confirmation', f.project.id).at(-1);
    assert.equal(voiceRun.state, 'done', JSON.stringify(voiceRun.blocker));
    assert.equal(f.calls.speech, 1);
    assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
    assert.equal(f.store.getProject(f.project.id).shots[0].narrationPending, false);
    assert.equal((await f.overview()).shots['shot-0'].narration.measuredSeconds, 1);
    const proposal = f.store.list('narration_speech_proposal', f.project.id).at(-1);
    const base = f.store.get('plan', proposal.basePlan.id).compiled;
    assert.deepEqual(proposal.compiled.nodes.filter(node => node.alias !== proposal.operation.alias), base.nodes);
    assert.deepEqual(proposal.compiled.gates, base.gates);
    assert.equal(planSourceBaseRevision(proposal.compiled), planSourceBaseRevision(base), 'the preserved graph keeps its truthful original source revision');
    assert.equal(f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'image').length, images,
      'rebasing the plan keeps the already returned keyframes');
    if (press !== 'confirm') {
      await f.openFrames();
      await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
      await f.tick(10);
    }
    const overview = await f.overview();
    assert.equal(overview.scenes[0].confirmation.state, 'done', JSON.stringify(overview.scenes[0].confirmation));
    assert.equal(overview.scenes[0].counts.videosReady, 2);
    assert.equal(f.calls.speech, 1, 'video confirmation reuses the accepted line');
    assert.equal(f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'speech').length, 1);
  });
}
