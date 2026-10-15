import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';

test('keyframe press prices and makes image plus voice, attaches and accepts fitting speech once', async t => {
  const f = await confirmationFixture(t);
  const before = await f.overview();
  assert.equal(before.scenes[0].quotes.makeKeyframes.units, 3);
  const key = randomUUID(), { body, receipt } = await f.make({ expectedEstimateMicros: before.scenes[0].quotes.makeKeyframes.micros }, key);
  await f.tick(14);
  assert.equal(f.calls.speech, 1);
  assert.equal(f.provider.acceptedCount(), 2);
  const view = await f.overview();
  assert.equal(view.shots['shot-0'].narration.measuredSeconds, 1);
  assert.equal(view.shots['shot-0'].narration.fits, true);
  assert.equal(f.store.getProject(f.project.id).shots[0].narrationPending, false);
  assert.equal(view.scenes[0].quotes.confirmVideo.units, 2);
  assert.deepEqual(await f.call('POST', '/scenes/scene-0/generate', body, key).then(f.ok), receipt);
  await f.tick(3); assert.equal(f.calls.speech, 1);
});

test('7.4 second voice on six seconds stays attached, measured and blocked before video', async t => {
  const f = await confirmationFixture(t, { seconds: 7.4 }); await f.make(); await f.tick(12);
  const view = await f.overview();
  assert.equal(view.shots['shot-0'].narration.measuredSeconds, 7.4);
  assert.equal(view.shots['shot-0'].narration.fits, false);
  assert.equal(f.store.getProject(f.project.id).shots[0].narrationPending, true);
  assert.ok(view.scenes[0].blockers.some(b => b.code === 'narration_too_long'));
  assert.equal(f.calls.speech, 1);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 0);
});

test('durable confirm replays the original receipt, reports progress, and generates reviewed clips', async t => {
  const f = await confirmationFixture(t); await f.make(); await f.tick(12); await f.openFrames();
  const body = await f.confirmBody(), key = randomUUID();
  const receipt = await f.call('POST', '/scenes/scene-0/confirm', body, key).then(f.ok);
  assert.equal(receipt.state, 'running');
  assert.equal((await f.overview()).scenes[0].confirmation.state, 'running');
  assert.ok((await f.overview()).scenes[0].blockers.some(b => b.code === 'confirmation_running'));
  await f.restart(); await f.tick(10);
  const view = await f.overview();
  assert.equal(view.scenes[0].confirmation.state, 'done', JSON.stringify(view.scenes[0].confirmation));
  assert.equal(view.scenes[0].counts.videosReady, 2);
  assert.equal(f.calls.speech, 1);
  assert.deepEqual(await f.call('POST', '/scenes/scene-0/confirm', body, key).then(f.ok), receipt);
});

test('confirm rejects changed frames and stale estimates atomically and requires a command key', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] }); await f.make(); await f.tick(5); await f.openFrames();
  const body = await f.confirmBody(), grants = f.store.list('grant', f.project.id).length;
  const stale = { ...body, reviewedFrames: [{ ...body.reviewedFrames[0], sha256: '0'.repeat(64) }] };
  for (const [input, code] of [[stale, 'SCENE_REVIEW_STALE'], [{ ...body, expectedEstimateMicros: '9999' }, 'ESTIMATE_CHANGED']]) {
    const r = await f.call('POST', '/scenes/scene-0/confirm', input); assert.equal(r.json().error.code, code, r.body);
    assert.equal(f.store.list('grant', f.project.id).length, grants);
    assert.equal(f.store.list('scene_confirmation', f.project.id).length, 0);
  }
  assert.equal((await f.call('POST', '/scenes/scene-0/confirm', body, null)).json().error.code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('Stop cancels unsent confirmation steps and restart never resumes them', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] }); await f.make(); await f.tick(5); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  const before = f.engine.attempts(f.project.id).length;
  await f.call('POST', '/controls', { action: 'stop' }).then(f.ok);
  await f.restart(); await f.tick(5);
  assert.equal((await f.overview()).scenes[0].confirmation.state, 'cancelled');
  assert.equal(f.engine.attempts(f.project.id).length, before);
});

async function addGeneratedAfterFrames(f, shotId = 'shot-0') {
  const p = f.store.getProject(f.project.id);
  await f.call('POST', '/storyboard', { kind: 'narration', id: shotId, field: 'mode', value: 'generated', expectedHeadVersion: p.headVersion }).then(f.ok);
  await f.call('POST', '/storyboard', { kind: 'narration', id: shotId, field: 'text', value: 'New measured voice line', expectedHeadVersion: f.store.getProject(p.id).headVersion }).then(f.ok);
}

test('legacy missing line confirm resumes after speech/attach across restart with one paid speech attempt', async t => {
  const f = await confirmationFixture(t, { modes: ['none', 'none'] }); await f.make(); await f.tick(5);
  await addGeneratedAfterFrames(f); await f.openFrames();
  const body = await f.confirmBody(), key = randomUUID();
  const receipt = await f.call('POST', '/scenes/scene-0/confirm', body, key).then(f.ok);
  await f.tick(1); // speech plan published, no dispatch yet
  assert.equal((await f.overview()).scenes[0].confirmation.currentStep, 'attach');
  await f.tick(1); // completed speech attached; accept still unsent
  assert.equal((await f.overview()).scenes[0].confirmation.currentStep, 'accept');
  assert.equal(f.calls.speech, 1);
  await f.restart(); await f.tick(10);
  const view = await f.overview();
  assert.equal(view.scenes[0].confirmation.state, 'done', JSON.stringify(view.scenes[0].confirmation));
  assert.equal(view.scenes[0].counts.videosReady, 2);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'speech').length, 1);
  assert.equal(f.calls.speech, 1);
  assert.deepEqual(await f.call('POST', '/scenes/scene-0/confirm', body, key).then(f.ok), receipt);
});

test('Stop after speech publication cancels unsent voice/video without resubmission', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] }); await f.make(); await f.tick(5); await addGeneratedAfterFrames(f); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.tick(1); await f.call('POST', '/controls', { action: 'stop' }).then(f.ok);
  await f.restart(); await f.tick(8);
  assert.equal(f.calls.speech, 0);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind !== 'image').length, 0);
  assert.equal((await f.overview()).scenes[0].confirmation.state, 'cancelled');
});

for (const state of ['failed', 'unknown']) test(`${state} voice blocks confirm before video and never retries a paid step`, async t => {
  const f = await confirmationFixture(t, { modes: ['none'], speechRetries: 2,
    fetch: async () => { if (state === 'unknown') throw new Error('synthetic lost response'); return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'synthetic rejection' } }), { status: 400, headers: { 'content-type': 'application/json' } }); } });
  await f.make(); await f.tick(5); await addGeneratedAfterFrames(f); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(8);
  const view = await f.overview();
  assert.equal(view.scenes[0].confirmation.state, 'blocked');
  assert.equal(view.scenes[0].confirmation.blocker.code, state === 'unknown' ? 'SUBMISSION_UNKNOWN' : 'NARRATION_SPEECH_FAILED');
  assert.equal(view.shots['shot-0'].narration.state, state === 'unknown' ? 'no_answer' : 'failed');
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'speech').length, 1);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 0);
  assert.equal(f.calls.speech, 1);
});

test('an edit between paid speech publication and dispatch fences the old confirm before any spend', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] }); await f.make(); await f.tick(5); await addGeneratedAfterFrames(f); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(1);
  await f.call('POST', '/storyboard', { kind: 'shot', id: 'shot-0', field: 'motion', value: 'A different motion', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  await f.tick(6);
  assert.equal(f.calls.speech, 0);
  assert.equal((await f.overview()).scenes[0].confirmation.blocker.code, 'SCENE_REVIEW_STALE');
});

test('mixed none, uploaded and generated narration confirms to video with exact owned audio', async t => {
  const { writeFileSync } = await import('node:fs'), { join } = await import('node:path'), { wave } = await import('./speech-execution-fixture.mjs');
  const f = await confirmationFixture(t, { modes: ['none', 'none', 'none'] }); await f.make(); await f.tick(6);
  await addGeneratedAfterFrames(f, 'shot-2');
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-1', field: 'mode', value: 'uploaded', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-1', field: 'text', value: 'Uploaded human voice', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const initialized = await f.call('POST', '/narration/shots/shot-1/initialize', { mode: 'uploaded', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const actor = { kind: 'human', principalId: 'local-user', requestId: initialized.session.requestId };
  const path = join(f.root, 'upload.wav'); writeFileSync(path, wave(24000));
  const audio = await f.narration.importAudio(f.project.id, actor, { path, declaredOrigin: 'uploaded', key: randomUUID() });
  f.narration.bindAudio(f.project.id, actor, f.narration.workspaceSnapshot(f.project.id).state.version, randomUUID(), initialized.segment.entry.segmentId, audio.id);
  await f.openFrames(); await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.tick(16);
  const view = await f.overview();
  assert.equal(view.scenes[0].confirmation.state, 'done', JSON.stringify(view.scenes[0].confirmation));
  assert.equal(view.scenes[0].counts.videosReady, 3);
  assert.equal(f.calls.speech, 1); assert.ok(f.store.getProject(f.project.id).shots.every(s => !s.narrationPending));
});

test('restart after speech publication but before its checkpoint replays that exact operation', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] }); await f.make(); await f.tick(5); await addGeneratedAfterFrames(f); await f.openFrames();
  const receipt = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  const original = f.narrationSpeech.request.bind(f.narrationSpeech);
  f.narrationSpeech.request = async (...args) => { await original(...args); throw new Error('simulated process death after publication'); };
  await assert.rejects(f.runner.advanceOne(f.store.get('scene_confirmation', receipt.confirmationId)), /simulated process death/);
  await f.restart(); await f.tick(12);
  assert.equal((await f.overview()).scenes[0].confirmation.state, 'done');
  assert.equal(f.calls.speech, 1);
  assert.equal(f.store.list('narration_speech_proposal', f.project.id).length, 1);
});

test('an unknown voice cannot be bought again by a new confirmation key', async t => {
  const f = await confirmationFixture(t, { modes: ['none'], fetch: async () => { throw Error('lost'); } });
  await f.make(); await f.tick(5); await addGeneratedAfterFrames(f); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(5);
  const before = f.store.list('grant', f.project.id).length;
  const response = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody());
  assert.equal(response.json().error.code, 'SUBMISSION_UNKNOWN', response.body);
  assert.equal(f.store.list('grant', f.project.id).length, before);
  assert.equal(f.calls.speech, 1);
});

test('editing narration outdates only its voice; the next keyframe press buys only the missing line', async t => {
  const f = await confirmationFixture(t); await f.make(); await f.tick(12);
  const before = await f.overview(), images = f.provider.acceptedCount();
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'text', value: 'A revised line', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const edited = await f.overview();
  assert.deepEqual(edited.shots['shot-0'].keyframe, before.shots['shot-0'].keyframe);
  assert.equal(edited.shots['shot-0'].narration.state, 'text_only');
  assert.equal(edited.scenes[0].quotes.makeKeyframes.units, 1);
  await f.make({ expectedEstimateMicros: edited.scenes[0].quotes.makeKeyframes.micros }); await f.tick(12);
  assert.equal(f.calls.speech, 2); assert.equal(f.provider.acceptedCount(), images);
  assert.equal((await f.overview()).shots['shot-0'].narration.text, 'A revised line');
});

test('Stop while speech is already sent retains the result but cancels later acceptance and video', async t => {
  const { wave } = await import('./speech-execution-fixture.mjs');
  let entered, release; const sent = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  const f = await confirmationFixture(t, { modes: ['none'], fetch: async () => { entered(); await held; return new Response(wave(24000), { headers: { 'content-type': 'audio/wav' } }); } });
  await f.make(); await f.tick(5); await addGeneratedAfterFrames(f); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(1);
  const pending = f.tick(1); await sent;
  await f.call('POST', '/controls', { action: 'stop' }).then(f.ok); release(); await pending;
  await f.restart(); await f.tick(4);
  assert.equal((await f.overview()).scenes[0].confirmation.state, 'cancelled');
  assert.equal(f.calls.speech, 1); assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'video').length, 0);
  assert.equal(f.store.list('narration_acceptance', f.project.id).length, 0);
});

test('restart after canonical acceptance before checkpoint replays the exact acceptance', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] }); await f.make(); await f.tick(5); await addGeneratedAfterFrames(f); await f.openFrames();
  const receipt = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(2);
  const original = f.canonical.apply.bind(f.canonical);
  f.canonical.apply = async (...args) => { await original(...args); throw Error('simulated death after accept'); };
  await assert.rejects(f.runner.advanceOne(f.store.get('scene_confirmation', receipt.confirmationId)), /simulated death/);
  await f.restart(); await f.tick(10);
  assert.equal((await f.overview()).scenes[0].confirmation.state, 'done');
  assert.equal(f.calls.speech, 1); assert.equal(f.store.list('narration_canonical', f.project.id).length, 1);
});

test('targeted keyframes buy only the named shot and its missing voice; regeneration re-quotes voice', async t => {
  const f = await confirmationFixture(t, { modes: ['generated', 'generated'] });
  await f.make({ targetShotIds: ['shot-1'], expectedEstimateMicros: String(BigInt(f.profiles[0].unitCostMicros) + 100n) }); await f.tick(12);
  assert.equal(f.calls.speech, 1); assert.equal(f.provider.acceptedCount(), 1);
  assert.equal((await f.overview()).shots['shot-0'].keyframe.state, 'none');
  assert.equal((await f.overview()).shots['shot-0'].narration.state, 'text_only');
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-1', field: 'text', value: 'New line for the same shot', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const overview = await f.overview();
  const quoted = overview.shots['shot-1'].quotes.regenerateKeyframe;
  assert.equal(quoted.units, 2);
  await f.make({ targetShotIds: ['shot-1'], regenerate: true, expectedEstimateMicros: quoted.micros }); await f.tick(12);
  assert.equal(f.calls.speech, 2); assert.equal(f.provider.acceptedCount(), 2);
  assert.equal(f.engine.attempts(f.project.id).filter(a => a.request.kind === 'speech').length, 2);
});

test('same-spec frame replacement fences an already queued voice before dispatch', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] }); await f.make(); await f.tick(5); await addGeneratedAfterFrames(f); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(1);
  // Simulates a same-spec replacement of the current conditioning candidate by another application operation.
  const binding = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image');
  f.store.put('node_binding', binding.id, f.project.id, { ...binding, outputs: {}, candidateId: null });
  await f.tick(4);
  assert.equal(f.calls.speech, 0);
  assert.equal((await f.overview()).scenes[0].confirmation.blocker.code, 'SCENE_REVIEW_STALE');
});

test('open blocking Director note refuses confirmation before any voice attempt, grant or record', async t => {
  const { recordNotes } = await import('../dist/application/director-notes.js');
  const f = await confirmationFixture(t, { modes: ['none'] }); await f.make(); await f.tick(4);
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'mode', value: 'generated', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'text', value: 'A voice line still to buy.', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const human = f.production.beginRequest(f.project.id, 'local-user', 'Review the scene', { editing: false, scopeIds: ['scene-0'] });
  const epoch = f.production.openEpoch(f.project.id, human), turnId = randomUUID();
  f.store.insert('director_turn', turnId, f.project.id, { id: turnId, projectId: f.project.id, requestId: human.requestId, epochId: epoch.actor.epochId, state: 'completed' });
  recordNotes(f.production, f.project.id, epoch.actor, randomUUID(), { notes: [{ anchor: { shotIds: ['shot-0'] }, kind: 'recommendation', blocking: true,
    text: 'Review the opening before making clips.', choices: [{ kind: 'accept', label: 'Keep the opening' }] }] });
  await f.openFrames();
  const body = await f.confirmBody(), grants = f.store.list('grant', f.project.id), records = f.store.list('scene_confirmation', f.project.id), cursor = f.store.cursor(f.project.id);
  const response = await f.call('POST', '/scenes/scene-0/confirm', body);
  assert.equal(response.json().error.code, 'RECOMMENDATION_OPEN', response.body);
  await f.tick(3);
  assert.equal(f.calls.speech, 0); assert.ok(!f.engine.attempts(f.project.id).some(a => a.request.kind === 'speech'));
  assert.deepEqual(f.store.list('grant', f.project.id), grants); assert.deepEqual(f.store.list('scene_confirmation', f.project.id), records);
  assert.equal(f.store.cursor(f.project.id), cursor);
});

test('server-owned voice writing derives Chinese language from CJK text', async t => {
  const f = await confirmationFixture(t, { modes: ['generated'] });
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'text', value: '最后一班渡轮驶向灯火。', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  await f.make(); await f.tick(12);
  const segment = f.narration.workspaceSnapshot(f.project.id).segments[0];
  assert.equal(segment.script.language, 'zh'); assert.equal(segment.script.text, '最后一班渡轮驶向灯火。');
  assert.equal(f.calls.speech, 1); assert.equal(f.store.getProject(f.project.id).shots[0].narrationPending, false);
});
