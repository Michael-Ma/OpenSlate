import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { wave } from './speech-execution-fixture.mjs';

const edit = (f, id, field, value) => f.call('POST', '/storyboard', { kind: 'shot', id, field, value,
  expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
const latest = f => f.store.list('scene_confirmation', f.project.id).at(-1);

for (const change of ['sibling', 'chat', 'own-motion', 'own-words']) test(`a dispatched paid line survives ${change} without buying it twice`, async t => {
  let entered, release;
  const sent = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  const f = await confirmationFixture(t, { fetch: async () => { entered(); await held; return new Response(wave(24000), { headers: { 'content-type': 'audio/wav' } }); } });
  await f.make(); await f.runner.advance();
  const pending = f.tick(1); await sent;
  if (change === 'chat') f.production.beginRequest(f.project.id, 'local-user', 'Consider another ending');
  else if (change === 'own-words') await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'text', value: 'Different words', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  else await edit(f, change === 'sibling' ? 'shot-1' : 'shot-0', 'motion', 'Move toward the harbour');
  release(); await pending; await f.tick(10);
  assert.equal(f.calls.speech, 1);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'speech' && a.phase === 'succeeded').length, 1);
  if (change === 'own-words') {
    assert.equal(f.store.list('narration_audio', f.project.id).length, 0, 'a stale paid take never replaces newly authored words');
    assert.equal(latest(f).blocker.code, 'NARRATION_SPEECH_STALE');
    assert.equal((await f.overview()).scenes[0].quotes.voice.units, 1);
  } else {
    assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
    const view = await f.overview();
    assert.equal(view.scenes[0].quotes.voice.units, 0);
    assert.equal(view.scenes[0].quotes.makeKeyframes.micros, '0');
    if (change === 'chat') {
      assert.equal(latest(f).state, 'blocked');
      assert.equal(latest(f).blocker.code, 'ACTOR_DENIED', 'saving a paid take grants no fresh timing acceptance authority');
      await f.make(); await f.tick(8);
      assert.equal(f.calls.speech, 1);
      assert.equal(latest(f).state, 'done');
    }
  }
});

for (const change of ['sibling', 'chat']) test(`video confirmation retains its paid line through ${change} and a fresh press makes the clips`, async t => {
  let entered, release;
  const sent = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  const f = await confirmationFixture(t, { modes: ['none', 'none'], fetch: async () => { entered(); await held; return new Response(wave(24000), { headers: { 'content-type': 'audio/wav' } }); } });
  await f.make(); await f.tick(5);
  for (const [field, value] of [['mode', 'generated'], ['text', 'A line for this scene']]) await f.call('POST', '/storyboard', {
    kind: 'narration', id: 'shot-0', field, value, expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  await f.openFrames(); await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.runner.advance(); const pending = f.tick(1); await sent;
  if (change === 'chat') f.production.beginRequest(f.project.id, 'local-user', 'Consider a quieter ending');
  else await edit(f, 'shot-1', 'motion', 'Pan toward the ferry');
  release(); await pending; await f.tick(8);
  assert.equal(latest(f).state, 'blocked');
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1); assert.equal(f.calls.speech, 1);
  assert.equal((await f.overview()).scenes[0].quotes.voice.units, 0);
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(12);
  assert.equal(f.calls.speech, 1); assert.equal((await f.overview()).scenes[0].counts.videosReady, 2);
  assert.equal(latest(f).state, 'done');
});

test('a new press recovers a succeeded unattached take from a blocked run at attach with no speech charge', async t => {
  const f = await confirmationFixture(t);
  await f.make(); await f.runner.advance(); await f.engine.runReady(); await f.engine.reconcile();
  let run = latest(f); assert.equal(run.steps[0].step, 'attach');
  assert.equal(f.calls.speech, 1); assert.equal(f.store.list('narration_audio', f.project.id).length, 0);
  f.store.put('scene_confirmation', run.id, f.project.id, { ...run, state: 'blocked', blocker: { code: 'SCENE_REVIEW_STALE', shotId: 'shot-0' } });
  f.store.appendEvent(f.project.id, 'scene.confirmation_changed', { confirmationId: run.id, state: 'blocked' });
  const view = await f.overview();
  assert.equal(view.scenes[0].quotes.makeKeyframes.units, 0);
  assert.equal(view.scenes[0].quotes.voice.units, 0);
  assert.equal(view.shots['shot-0'].quotes.regenerateKeyframe.units, 1);
  assert.equal(view.scenes[0].quotes.confirmVideo.units, 2);
  await f.make(); run = latest(f);
  assert.equal(run.steps[0].step, 'attach');
  await f.restart(); await f.tick(12);
  assert.equal(f.calls.speech, 1); assert.equal(latest(f).state, 'done');
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
  assert.equal(f.store.list('narration_speech_review', f.project.id).length, 1);
});

test('completed-take storage authority cannot cross shots or accept a mismatched segment, voice or profile', async t => {
  const f = await confirmationFixture(t);
  await f.make(); await f.runner.advance(); await f.engine.runReady(); await f.engine.reconcile();
  const run = latest(f), step = run.steps[0];
  const { reusableNarrationSpeech } = await import('../dist/narration-reusable-speech.js');
  const { resolveGeneratedNarrationAudio } = await import('../dist/narration/generated-audio.js');
  const intent = { segmentId: step.speechInput.segmentId, segmentRevisionId: step.speechInput.segmentRevisionId,
    text: step.speechResult.proposal.operation.text, voice: step.voice, profileId: step.profileId, profileRevisionId: step.profileRevisionId };
  assert.ok(reusableNarrationSpeech(f.production, f.project.id, intent));
  for (const patch of [{ segmentRevisionId: 'different-revision' }, { text: 'Different words' }, { voice: 'coral' }, { profileId: 'another-profile' }, { profileRevisionId: 'different-revision' }]) {
    assert.equal(reusableNarrationSpeech(f.production, f.project.id, { ...intent, ...patch }), undefined);
  }
  const attempt = f.engine.attempts(f.project.id).find(a => a.request.kind === 'speech');
  const selected = resolveGeneratedNarrationAudio(f.store, f.project.id, attempt.outputs.audio.artifactId);
  const actor = { kind: 'human', principalId: 'local-user', requestId: f.store.get('narration_session', step.sessionId).requestId };
  const input = { expectedVersion: f.narration.workspaceSnapshot(f.project.id).state.version, segmentId: intent.segmentId,
    segmentRevisionId: intent.segmentRevisionId, artifactId: selected.artifact.id, artifactDigest: selected.artifactDigest,
    generationEvidenceDigest: selected.generationEvidenceDigest, key: 'foreign-shot-attachment' };
  for (const completion of [{ confirmationId: run.id, shotId: 'shot-1' }, { confirmationId: 'unrelated-run', shotId: 'shot-0' }]) {
    await assert.rejects(f.narration.attachGeneratedAudio(f.project.id, actor, input, { completedSceneAttachment: completion }));
  }
  assert.equal(f.store.list('narration_audio', f.project.id).length, 0);
  await f.tick(8); assert.equal(f.calls.speech, 1);
});

test('restart after completed-take attachment before its checkpoint replays storage once', async t => {
  const f = await confirmationFixture(t);
  await f.make(); await f.runner.advance(); await f.engine.runReady(); await f.engine.reconcile();
  const run = latest(f), attach = f.narration.attachGeneratedAudio.bind(f.narration);
  f.narration.attachGeneratedAudio = async (...args) => { await attach(...args); throw Error('crash after storing paid take'); };
  await assert.rejects(f.runner.advanceOne(run), /crash after storing paid take/);
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
  await f.restart(); await f.tick(10);
  assert.equal(f.calls.speech, 1); assert.equal(latest(f).state, 'done');
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
  assert.equal(f.store.readEvents(f.project.id).filter(event => event.kind === 'narration.generated_audio_attached').length, 1);
});

test('an out-of-range first accept still voices the later shot on the first press', async t => {
  const f = await confirmationFixture(t, { modes: ['generated', 'generated'], seconds: 7.4 });
  await f.make();
  let view = await f.overview();
  assert.equal(view.scenes[0].keyframesRun.state, 'running');
  assert.ok(view.scenes[0].blockers.some(b => b.code === 'confirmation_running'));
  await f.tick(18); view = await f.overview();
  assert.equal(f.calls.speech, 2);
  assert.equal(f.store.list('narration_audio', f.project.id).length, 2);
  assert.equal(view.scenes[0].keyframesRun.state, 'blocked');
  assert.deepEqual(view.scenes[0].keyframesRun.blocker, { code: 'NARRATION_CUE_OUT_OF_RANGE', shotId: 'shot-0' });
  assert.ok(!view.scenes[0].blockers.some(b => b.code === 'confirmation_running'));
});

test('confirm refuses a displayed retained frame that is absent from its own image binding outputs', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] });
  await f.make(); await f.tick(5);
  await f.make({ regenerate: true, targetShotIds: ['shot-0'] });
  const image = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image' && b.state === 'active');
  f.provider.setMode(image.id, Array(10).fill('technical_failure')); await f.tick(6);
  assert.deepEqual(f.store.get('node_binding', image.id).outputs, {});
  await f.openFrames();
  const response = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody());
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, 'SCENE_REVIEW_STALE');
  assert.equal(f.store.list('scene_confirmation', f.project.id).filter(r => r.kind === 'video').length, 0);
  assert.equal(f.calls.speech, 0);
});

test('a detached pin at an unadmitted attach step blocks instead of silently waiting', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] });
  await f.make(); await f.tick(5);
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'mode', value: 'generated', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'text', value: 'A new voice line', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  await f.openFrames(); await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.runner.advance();
  const image = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image');
  f.store.put('node_binding', image.id, f.project.id, { ...image, outputs: {} });
  await f.runner.advance();
  assert.equal(latest(f).state, 'blocked'); assert.equal(latest(f).blocker.code, 'SCENE_REVIEW_STALE');
  assert.equal(f.calls.speech, 0);
});
