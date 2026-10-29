import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { digest, DomainError, shotIntentDigest } from '@openslate/core';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { projectFixture, sourceFor } from './execution-fixture.mjs';
import { DirectorContextService } from '../dist/application/director-context.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { resolveGeneratedNarrationAudio } from '../dist/narration/generated-audio.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
async function fixture(t, { version = '6.0.0', scopeIds, editing = true, source = 'user', ...options } = {}) {
  const f = await confirmationFixture(t, { modes: ['generated', 'none', 'generated', 'none'], ...options });
  const shape = projectFixture(f.project.id, f.project.shots.length);
  const project = f.store.getProject(f.project.id);
  project.scenes = shape.scenes.slice(0, 2);
  project.shots = project.shots.map((shot, index) => {
    const next = { ...shot, sceneId: index < 2 ? 'scene-0' : 'scene-1' };
    next.promptIntent = { image: shotIntentDigest(next, 'image'), video: shotIntentDigest(next, 'video') };
    return next;
  });
  f.project = f.store.saveProject(project, project.headVersion);
  f.store.put('project_revision', project.revisionId, project.id, { project: f.project });
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'openslate-director-keyframes-skills-'));
  t.after(() => { writable(snapshotRoot); rmSync(snapshotRoot, { recursive: true, force: true }); });
  f.saved = createDirectorSkillLock({ repositoryRoot, snapshotRoot }, version);
  f.contexts = new DirectorContextService(f.production, f.saved.environment);
  f.contexts.bootstrapLock(f.project.id, f.saved.lock);
  f.openTurn = (text = 'Make all keyframes and their voice lines.', options = {}) => {
    for (const prior of f.store.list('director_turn', f.project.id).filter(turn => turn.state === 'running'))
      f.store.put('director_turn', prior.id, f.project.id, { ...prior, state: 'completed' });
    const human = f.production.beginRequest(f.project.id, 'local-user', text, { source, editing, ...(scopeIds ? { scopeIds } : {}), ...options });
    const bridge = f.production.openEpoch(f.project.id, human);
    const at = new Date().toISOString();
    const turn = { id: randomUUID(), projectId: f.project.id, requestId: human.requestId, epochId: bridge.actor.epochId,
      runtimeId: 'offline-fixture', state: 'running', dispatched: true, nativeThreadId: null, nativeTurnId: null,
      owner: null, leaseExpiresAt: 0, errorCode: null, createdAt: at, updatedAt: at };
    f.store.insert('director_turn', turn.id, f.project.id, turn);
    f.contexts.capture(f.project.id, bridge.actor, { lockId: f.saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
    return { human, bridge, turn };
  };
  Object.assign(f, f.openTurn());
  f.tools = new ToolInvocationService(f.production, { narrationSpeech: f.narrationSpeech, enqueueVoice: f.runner.enqueueKeyframes });
  f.invoke = (input = { sceneIds: ['scene-0', 'scene-1'] }, callId = randomUUID(), actor = f.bridge.actor) =>
    f.tools.invoke(f.project.id, actor, callId, 'make_keyframes', input);
  f.effects = () => f.production.snapshot(f.project.id).turns.find(turn => turn.id === f.turn.id).effects.generation;
  f.blocks = () => f.production.snapshot(f.project.id).turns.find(turn => turn.id === f.turn.id).effects.blocked;
  return f;
}
function noPaidWork(f) {
  for (const kind of ['grant', 'candidate', 'attempt', 'reservation', 'director_generation_effect'])
    assert.equal(f.store.list(kind, f.project.id).length, 0, kind);
  assert.equal(f.provider.acceptedCount(), 0);
  assert.equal(f.calls.speech, 0);
}
function save(f, mutate) {
  const project = f.store.getProject(f.project.id);
  mutate(project);
  project.headVersion++; project.revisionId = randomUUID();
  f.store.saveProject(project, project.headVersion - 1);
  f.store.put('project_revision', project.revisionId, project.id, { project });
}

test('a human message makes every scene keyframe and voice once, with its quote in turn effects', async t => {
  const f = await fixture(t), before = await f.overview();
  const input = { sceneIds: ['scene-0', 'scene-1'] }, result = await f.invoke(input, 'all-keyframes');
  assert.deepEqual(result.refused, []);
  assert.deepEqual(f.blocks(), []);
  assert.deepEqual(result.started.map(scene => ({ sceneId: scene.sceneId, shotIds: scene.shotIds, keyframes: scene.keyframes, voiceLines: scene.voiceLines, quote: scene.quote })),
    before.scenes.map(scene => ({ sceneId: scene.sceneId, shotIds: scene.shotIds, keyframes: 2, voiceLines: 1, quote: scene.quotes.makeKeyframes })));
  assert.equal(f.store.get('message', f.human.requestId).state, 'active');
  const effects = f.effects(); assert.equal(effects.length, 2);
  for (const [index, effect] of effects.entries()) {
    assert.equal(effect.kind, 'keyframes'); assert.deepEqual(effect.sceneIds, [result.started[index].sceneId]);
    assert.deepEqual(effect.shotIds, result.started[index].shotIds); assert.equal(effect.keyframes, 2); assert.equal(effect.voiceLines, 1);
    assert.deepEqual(effect.quote, before.scenes[index].quotes.makeKeyframes); assert.ok(Number.isFinite(Date.parse(effect.at)));
  }
  const queued = await f.overview();
  assert.ok(queued.scenes.every(scene => scene.keyframesRun?.state === 'running'));
  assert.deepEqual(await f.invoke(input, 'all-keyframes'), result);
  await f.tick(20);
  const ready = await f.overview();
  assert.equal(f.provider.acceptedCount(), 4); assert.equal(f.calls.speech, 2);
  assert.ok(ready.scenes.every(scene => scene.counts.keyframesReady === 2 && scene.keyframesRun?.state === 'done'));
  assert.equal(ready.shots['shot-0'].narration.state, 'ready'); assert.equal(ready.shots['shot-2'].narration.state, 'ready');
  assert.equal(f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'video').length, 0);
  assert.deepEqual(await f.invoke(input, 'all-keyframes'), result); await f.tick(3);
  assert.equal(f.provider.acceptedCount(), 4); assert.equal(f.calls.speech, 2); assert.deepEqual(f.effects(), effects);
  const imageGrants = f.store.list('grant', f.project.id).filter(grant => grant.kind === 'image');
  assert.equal(imageGrants.length, 4); assert.ok(imageGrants.every(grant => grant.authorityId === f.human.requestId));
});

test('a scene needing direction is refused while another scene still starts', async t => {
  const f = await fixture(t);
  save(f, project => { project.shots[0].promptState = 'placeholder'; });
  const input = { sceneIds: ['scene-0', 'scene-1'] }, result = await f.invoke(input, 'mixed-refusal');
  assert.deepEqual(result.started.map(row => row.sceneId), ['scene-1']);
  assert.deepEqual(result.refused.map(row => [row.sceneId, row.code]), [['scene-0', 'DIRECTION_REQUIRED']]);
  assert.ok(result.refused[0].message);
  const blocks = f.blocks();
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { kind: 'keyframes', sceneId: 'scene-0', code: 'DIRECTION_REQUIRED', shotIds: ['shot-0'], at: blocks[0].at });
  assert.ok(Number.isFinite(Date.parse(blocks[0].at)));
  await f.tick(15);
  assert.equal(f.provider.acceptedCount(), 2); assert.equal(f.calls.speech, 1);
  const view = await f.overview(); assert.equal(view.shots['shot-0'].keyframe.state, 'direction_required');
  assert.deepEqual(f.effects().map(effect => effect.sceneIds), [['scene-1']]);
  assert.deepEqual(await f.invoke(input, 'mixed-refusal'), result);
  assert.equal(f.store.list('director_generation_block', f.project.id).length, 1);
  assert.deepEqual(f.blocks(), blocks);
});

for (const known of [false, true]) test(`a stale prompt refusal uses ${known ? 'known stale shots' : 'the exact requested scene shots'} and replays one historical block`, async t => {
  const f = await fixture(t), apply = f.production.applyCompiledSceneGeneration.bind(f.production);
  f.production.applyCompiledSceneGeneration = () => { throw new DomainError('STALE_PROMPT_INTENT', 'Synthetic stale prompt refusal', known ? { shotIds: ['shot-1', 'shot-2'] } : undefined); };
  const input = { shotIds: ['shot-0', 'shot-1'] }, result = await f.invoke(input, 'stale-prompts');
  f.production.applyCompiledSceneGeneration = apply;
  assert.deepEqual(result.started, []); assert.equal(result.refused[0].code, 'STALE_PROMPT_INTENT');
  const blocks = f.blocks();
  assert.equal(blocks.length, 1); assert.equal(blocks[0].code, 'STALE_PROMPT_INTENT');
  assert.deepEqual(blocks[0].shotIds, known ? ['shot-1'] : ['shot-0', 'shot-1']);
  assert.equal(blocks[0].attempts, undefined);
  assert.deepEqual(await f.invoke(input, 'stale-prompts'), result);
  assert.deepEqual(f.blocks(), blocks); noPaidWork(f);
  const prior = f.turn.id;
  Object.assign(f, f.openTurn('Make only a fresh take for the second scene.'));
  assert.deepEqual(f.blocks(), []);
  assert.deepEqual(f.production.snapshot(f.project.id).turns.find(turn => turn.id === prior).effects.blocked, blocks);
});

test('film Stop cancels unsent Director frames and voice lines across restart', async t => {
  const f = await fixture(t); await f.invoke();
  await f.call('POST', '/controls', { action: 'stop' }).then(f.ok);
  await f.restart(); await f.tick(12);
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.calls.speech, 0);
  assert.equal(f.engine.attempts(f.project.id).length, 0);
  assert.ok((await f.overview()).scenes.every(scene => scene.keyframesRun?.state === 'cancelled'));
});

for (const [name, options] of [['discuss-only', { editing: false }], ['automatic', { source: 'director' }], ['application', { source: 'app' }]]) {
  test(`${name} turns cannot authorize Director keyframes`, async t => {
    const f = await fixture(t, options);
    await assert.rejects(f.invoke(), error => ['ACTOR_DENIED', 'ORIGIN_NOT_AUTHORIZED'].includes(error.code)); noPaidWork(f);
  });
}

test('a downgraded epoch and a keyframe-review reply cannot authorize Director keyframes', async t => {
  const f = await fixture(t);
  const epoch = f.store.get('epoch', f.bridge.actor.epochId);
  f.store.put('epoch', epoch.id, f.project.id, { ...epoch, state: 'read_only' });
  await assert.rejects(f.invoke(), error => ['ACTOR_DENIED', 'ORIGIN_NOT_AUTHORIZED'].includes(error.code)); noPaidWork(f);
  const next = f.openTurn('Please make every keyframe.', { editing: true });
  f.store.insert('keyframe_review_request', next.human.requestId, f.project.id, { id: next.human.requestId, projectId: f.project.id });
  await assert.rejects(f.invoke(undefined, 'review-reply', next.bridge.actor), error => ['ACTOR_DENIED', 'ORIGIN_NOT_AUTHORIZED'].includes(error.code)); noPaidWork(f);
});

for (const version of ['1.0.0', '5.0.0']) test(`contract ${version} cannot invoke make_keyframes`, async t => {
  const f = await fixture(t, { version });
  await assert.rejects(f.invoke(), error => ['ORIGIN_NOT_AUTHORIZED', 'NOT_FOUND'].includes(error.code)); noPaidWork(f);
});

test('a lost tool receipt preserves one publication and replay never buys it again', async t => {
  const f = await fixture(t), put = f.store.put.bind(f.store);
  let lost = false;
  f.store.put = (...args) => {
    if (!lost && args[0] === 'tool_invocation' && args[3].state === 'succeeded') { lost = true; throw Error('Synthetic lost receipt after generation publication'); }
    return put(...args);
  };
  const input = { sceneIds: ['scene-0'] };
  await assert.rejects(f.invoke(input, 'lost-keyframe-receipt'), { code: 'TOOL_CALL_UNRESOLVED' });
  f.store.put = put;
  const invocation = f.store.list('tool_invocation', f.project.id).find(row => row.callId === 'lost-keyframe-receipt');
  assert.equal(invocation.state, 'unresolved'); assert.equal(f.store.list('director_generation_effect', f.project.id).length, 1);
  const before = f.store.list('candidate', f.project.id).length;
  await f.restart();
  f.tools = new ToolInvocationService(f.production, { narrationSpeech: f.narrationSpeech, enqueueVoice: f.runner.enqueueKeyframes });
  await assert.rejects(f.invoke(input, 'lost-keyframe-receipt'), { code: 'TOOL_CALL_UNRESOLVED' });
  assert.equal(f.store.list('candidate', f.project.id).length, before);
  await f.tick(15); assert.equal(f.provider.acceptedCount(), 2); assert.equal(f.calls.speech, 1);
  await assert.rejects(f.invoke(input, 'lost-keyframe-receipt'), { code: 'TOOL_CALL_UNRESOLVED' });
  assert.equal(f.provider.acceptedCount(), 2); assert.equal(f.calls.speech, 1);
});

test('an interrupted started tool invocation cannot silently dispatch generation on replay', async t => {
  const f = await fixture(t), callId = 'interrupted-keyframes', input = { sceneIds: ['scene-0'] };
  const id = digest({ projectId: f.project.id, epochId: f.bridge.actor.epochId, callId });
  f.store.insert('tool_invocation', id, f.project.id, { id, projectId: f.project.id, requestId: f.human.requestId,
    epochId: f.bridge.actor.epochId, callId, tool: 'make_keyframes', toolContractVersion: '6.0.0', catalogDigest: f.saved.lock.bindings.find(binding => binding.kind === 'handler').digest,
    skillLockId: f.saved.lock.id, argumentsDigest: digest(input), state: 'started', result: null, resultDigest: null, error: null });
  await assert.rejects(f.invoke(input, callId), { code: 'TOOL_CALL_UNRESOLVED' }); noPaidWork(f);
});

test('regeneration requires exact shots and buys only those requested new takes', async t => {
  const f = await fixture(t);
  await assert.rejects(f.invoke({ sceneIds: ['scene-0'], regenerate: true }), { code: 'VALIDATION_ERROR' }); noPaidWork(f);
  await f.invoke(); await f.tick(20);
  const before = (await f.overview()).shots, frames = f.provider.acceptedCount();
  const result = await f.invoke({ shotIds: ['shot-1'], regenerate: true });
  assert.deepEqual(result.refused, []); assert.equal(result.started.length, 1);
  assert.deepEqual(result.started[0].shotIds, ['shot-1']); assert.equal(result.started[0].keyframes, 1); assert.equal(result.started[0].voiceLines, 0);
  await f.tick(6); const after = (await f.overview()).shots;
  assert.equal(f.provider.acceptedCount(), frames + 1); assert.equal(f.calls.speech, 2);
  for (const shotId of ['shot-0', 'shot-2', 'shot-3']) assert.deepEqual(after[shotId].keyframe.artifact, before[shotId].keyframe.artifact);
  assert.notEqual(after['shot-1'].keyframe.artifact.artifactId, before['shot-1'].keyframe.artifact.artifactId);
});

test('scoped keyframe requests refuse other scenes and preserve another request hold', async t => {
  const f = await fixture(t, { scopeIds: ['shot-0'] });
  const unrelated = f.production.beginRequest(f.project.id, 'local-user', 'Keep editing the other scene.', { concurrency: 'alongside', scopeIds: ['scene-1'] });
  const result = await f.invoke({ shotIds: ['shot-0', 'shot-2'] });
  assert.deepEqual(result.started.map(row => row.shotIds), [['shot-0']]);
  assert.deepEqual(result.refused.map(row => [row.sceneId, row.code]), [['scene-1', 'SCOPE_DENIED']]);
  assert.ok(f.store.list('hold', f.project.id).some(hold => hold.ownerId === unrelated.requestId && hold.scopeId === 'scene-1' && hold.active));
  await f.tick(12); assert.equal(f.provider.acceptedCount(), 1); assert.equal(f.calls.speech, 1);
  assert.equal((await f.overview()).shots['shot-2'].keyframe.state, 'none');
});

test('superseding the human message fences generation and cached receipt replay', async t => {
  const f = await fixture(t), input = { shotIds: ['shot-1'] };
  await f.invoke(input, 'superseded-keyframes');
  f.production.beginRequest(f.project.id, 'local-user', 'Use a different film direction.');
  await assert.rejects(f.invoke(input, 'superseded-keyframes'), { code: 'EPOCH_REVOKED' });
  await assert.rejects(f.invoke({ shotIds: ['shot-3'] }), { code: 'EPOCH_REVOKED' });
  await f.tick(10); assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.calls.speech, 0);
});

test('keyframe authority cannot authorize a video plan declaration', async t => {
  const f = await fixture(t, { modes: ['none', 'none', 'none', 'none'] });
  await f.invoke(); await f.tick(6);
  const project = f.store.getProject(f.project.id), grants = f.store.list('grant', f.project.id).length;
  const outcome = await f.tools.invoke(f.project.id, f.bridge.actor, 'video-plan-refused', 'prepare_change', {
    variant: 'plan', expectedHeadVersion: project.headVersion, source: sourceFor(project),
  });
  assert.equal(outcome.state, 'awaiting_human_generation'); assert.equal(outcome.generationStarted, false);
  assert.match(outcome.next, /Previously saved writing is retained/);
  assert.match(outcome.next, /Save any remaining writing with a creative patch without source/);
  assert.match(outcome.next, /make_keyframes within the current human request's scope/);
  assert.match(outcome.next, /confirm_video choice after frame review/);
  assert.match(outcome.next, /Only a returned prepared-change ID can be applied/);
  assert.doesNotMatch(outcome.next, /This call saved no|No generation started|returned no prepared-change ID/);
  assert.equal(f.store.list('grant', f.project.id).length, grants);
  assert.equal(f.store.list('approval', f.project.id).length, 0);
  assert.equal(f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'video').length, 0);
});

test('a conversation keyframe request buys only a missing voice when current frames are already saved', async t => {
  const f = await fixture(t); await f.invoke(); await f.tick(20);
  const before = await f.overview(), frames = f.provider.acceptedCount();
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'text', value: 'A newly requested voice line.', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const next = f.openTurn('Make the revised voice line for scene one.'); Object.assign(f, next);
  const result = await f.invoke({ sceneIds: ['scene-0'] });
  assert.deepEqual(result.refused, []); assert.equal(result.started.length, 1);
  assert.equal(result.started[0].keyframes, 0); assert.equal(result.started[0].voiceLines, 1); assert.equal(result.started[0].quote.units, 1);
  assert.equal(f.effects()[0].keyframes, 0); assert.equal(f.effects()[0].voiceLines, 1);
  await f.tick(15); const after = await f.overview();
  assert.equal(f.provider.acceptedCount(), frames); assert.equal(f.calls.speech, 3);
  assert.equal(after.shots['shot-0'].narration.state, 'ready', JSON.stringify(after.scenes[0].keyframesRun));
  for (const shotId of Object.keys(before.shots)) assert.deepEqual(after.shots[shotId].keyframe.artifact, before.shots[shotId].keyframe.artifact);
});

test('an active scene confirmation is refused without blocking another scene', async t => {
  const f = await fixture(t), id = randomUUID();
  f.store.insert('scene_confirmation', id, f.project.id, { id, actor: f.human, projectId: f.project.id,
    sceneId: 'scene-0', kind: 'video', state: 'running', createdAt: new Date().toISOString(),
    sceneIntentDigest: 'synthetic-guard', guardDigest: 'synthetic-guard', framePins: [], frames: [], steps: [] });
  const result = await f.invoke();
  assert.deepEqual(result.started.map(row => row.sceneId), ['scene-1']);
  assert.deepEqual(result.refused.map(row => [row.sceneId, row.code]), [['scene-0', 'CONFIRMATION_RUNNING']]);
  assert.deepEqual(f.effects().map(effect => effect.sceneIds), [['scene-1']]);
  assert.deepEqual(f.blocks().map(({ sceneId, code, shotIds }) => ({ sceneId, code, shotIds })),
    [{ sceneId: 'scene-0', code: 'CONFIRMATION_RUNNING', shotIds: ['shot-0', 'shot-1'] }]);
});

test('an unknown submitted keyframe is never bought again with a new tool-call identity', async t => {
  const f = await fixture(t); await f.invoke({ shotIds: ['shot-1'] }); await f.tick(5);
  const attempt = f.engine.attempts(f.project.id).find(row => row.request.kind === 'image');
  f.store.put('attempt', attempt.id, f.project.id, { ...attempt, phase: 'submission_unknown' });
  const grants = f.store.list('grant', f.project.id).length, candidates = f.store.list('candidate', f.project.id).length;
  const result = await f.invoke({ shotIds: ['shot-1'], regenerate: true });
  assert.deepEqual(result.started, []); assert.equal(result.refused.length, 1);
  assert.match(result.next, /Use the recovery steps for the requested scenes to choose the next action/);
  assert.match(result.next, /Preserve unresolved work for reconciliation before any further submission/);
  assert.doesNotMatch(result.next, /No generation started|Follow each refusal/);
  assert.ok(['ATTEMPT_EXISTS', 'SUBMISSION_UNKNOWN'].includes(result.refused[0].code));
  assert.equal(f.store.list('grant', f.project.id).length, grants); assert.equal(f.store.list('candidate', f.project.id).length, candidates);
  assert.equal(f.provider.acceptedCount(), 1);
  const blocks = f.blocks();
  assert.equal(blocks.length, 1); assert.equal(blocks[0].code, 'ATTEMPT_EXISTS');
  assert.deepEqual(blocks[0].shotIds, ['shot-1']);
  assert.deepEqual(blocks[0].attempts, [{ attemptId: attempt.id, shotId: 'shot-1', kind: 'image', phase: 'submission_unknown', action: 'human_release' }]);
  assert.doesNotMatch(JSON.stringify(blocks), /"release"|"body"|acknowledgeDoubleCharge|nodeId|resolution|prompt|request|provider|\/api\//);
});

for (const action of ['supersede', 'stop']) test(`${action} during isolated keyframe composition prevents old paid publication`, async t => {
  const f = await fixture(t);
  const pending = f.invoke({ shotIds: ['shot-1'] }, `composition-${action}`);
  assert.equal(f.store.list('director_keyframes_receipt', f.project.id).length, 1, 'the tool reached its asynchronous generation preparation');
  assert.equal(f.store.list('candidate', f.project.id).length, 0);
  if (action === 'supersede') f.production.beginRequest(f.project.id, 'local-user', 'Change the direction before making frames.');
  else await f.call('POST', '/controls', { action: 'stop' }).then(f.ok);
  await pending.then(result => {
    assert.deepEqual(result.started, []); assert.equal(result.refused.length, 1);
    assert.ok(['EPOCH_REVOKED', 'ACTOR_DENIED', 'EXECUTION_PAUSED'].includes(result.refused[0].code));
  }, error => { assert.ok(['EPOCH_REVOKED', 'ACTOR_DENIED', 'EXECUTION_PAUSED'].includes(error.code), error.message); });
  noPaidWork(f); await f.tick(3); noPaidWork(f);
  const blocks = f.blocks();
  assert.equal(blocks.length, 1); assert.deepEqual(blocks[0].shotIds, ['shot-1']);
  assert.ok(['EPOCH_REVOKED', 'ACTOR_DENIED', 'EXECUTION_PAUSED'].includes(blocks[0].code));
});

test('a partial unexpected failure reconciles the exact started scenes without dispatching the remainder', async t => {
  const f = await fixture(t), apply = f.production.applyCompiledSceneGeneration.bind(f.production);
  let publications = 0;
  f.production.applyCompiledSceneGeneration = (...args) => {
    if (++publications === 2) throw Error('Synthetic process loss before second scene publication');
    return apply(...args);
  };
  await assert.rejects(f.invoke(undefined, 'partial-unknown'), { code: 'TOOL_CALL_UNRESOLVED' });
  f.production.applyCompiledSceneGeneration = apply;
  const call = f.store.list('tool_invocation', f.project.id).find(row => row.callId === 'partial-unknown');
  const saved = f.store.get('director_keyframes_receipt', call.id);
  assert.equal(saved.complete, false); assert.deepEqual(saved.started.map(scene => scene.sceneId), ['scene-0']);
  const candidates = f.store.list('candidate', f.project.id).length;
  await assert.rejects(f.invoke(undefined, 'partial-unknown'), { code: 'TOOL_CALL_UNRESOLVED' });
  assert.equal(publications, 2); assert.equal(f.store.list('candidate', f.project.id).length, candidates);
  f.production.beginRequest(f.project.id, 'local-user', 'Continue after inspecting the partial keyframe operation.');
  f.tools.reconcileEpoch(f.project.id, f.bridge.actor.epochId);
  const reconciliation = f.store.get('tool_reconciliation', call.id);
  assert.equal(reconciliation.state, 'effect_confirmed'); assert.equal(reconciliation.receipt.complete, false);
  assert.deepEqual(reconciliation.receipt.started.map(scene => scene.sceneId), ['scene-0']);
  f.tools.reconcileEpoch(f.project.id, f.bridge.actor.epochId);
  assert.equal(f.store.list('tool_reconciliation', f.project.id).length, 1);
  assert.equal(f.store.list('candidate', f.project.id).length, candidates); assert.equal(publications, 2);
  await f.tick(4); assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.calls.speech, 0);
});

test('an editable human answer inherited from a keyframe-review question cannot start paid work', async t => {
  const f = await fixture(t), review = f.production.beginRequest(f.project.id, 'local-user', 'Review these returned frames.', { source: 'app', editing: false });
  f.store.insert('keyframe_review_request', review.requestId, f.project.id, { requestId: review.requestId, action: 'keyframe_review', sceneId: 'scene-0', batchDigest: 'synthetic-review-batch' });
  const id = randomUUID();
  f.store.insert('director_question', id, f.project.id, { id, projectId: f.project.id, requestId: review.requestId, answerRequestId: f.human.requestId,
    state: 'answered', question: 'Would you like another frame?', answer: 'Yes, please make one.', scopeIds: ['scene-0'] });
  await assert.rejects(f.invoke(), { code: 'ORIGIN_NOT_AUTHORIZED' }); noPaidWork(f);
});

test('a Director keyframe call cannot spend through another editable request hold', async t => {
  const f = await fixture(t, { scopeIds: ['shot-1'] });
  const holder = f.production.beginRequest(f.project.id, 'local-user', 'Hold this shot for another edit.', { concurrency: 'alongside', scopeIds: ['shot-1'] });
  const result = await f.invoke({ shotIds: ['shot-1'] });
  assert.deepEqual(result.started, []); assert.deepEqual(result.refused.map(row => [row.sceneId, row.code]), [['scene-0', 'SCOPE_HELD']]);
  assert.ok(f.store.list('hold', f.project.id).some(hold => hold.active && hold.ownerId === holder.requestId)); noPaidWork(f);
});

test('replaying a still-composing keyframe call cannot dispatch a second publication', async t => {
  const f = await fixture(t), input = { shotIds: ['shot-1'] };
  const pending = f.invoke(input, 'same-inflight-keyframes');
  await assert.rejects(f.invoke(input, 'same-inflight-keyframes'), { code: 'TOOL_CALL_UNRESOLVED' });
  const result = await pending; assert.equal(result.started.length, 1);
  await f.tick(5); assert.equal(f.provider.acceptedCount(), 1); assert.equal(f.calls.speech, 0);
  assert.equal(f.store.list('director_generation_effect', f.project.id).length, 1);
});

test('a voice-only Director request cannot spend through a foreign hold or record a generation effect', async t => {
  const f = await fixture(t); await f.invoke(); await f.tick(20);
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'text', value: 'A blocked revised line.', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  Object.assign(f, f.openTurn('Make the missing line for scene one.'));
  const holder = f.production.beginRequest(f.project.id, 'local-user', 'Hold this line for another edit.', { concurrency: 'alongside', scopeIds: ['shot-0'] });
  const grants = f.store.list('grant', f.project.id).length, candidates = f.store.list('candidate', f.project.id).length;
  const result = await f.invoke({ sceneIds: ['scene-0'] });
  assert.deepEqual(result.started, []); assert.deepEqual(result.refused.map(row => [row.sceneId, row.code]), [['scene-0', 'SCOPE_HELD']]);
  assert.deepEqual(f.effects(), []); assert.equal(f.store.list('grant', f.project.id).length, grants); assert.equal(f.store.list('candidate', f.project.id).length, candidates);
  assert.ok(f.store.list('hold', f.project.id).some(hold => hold.active && hold.ownerId === holder.requestId));
  await f.tick(4); assert.equal(f.calls.speech, 2);
});

for (const { restoreOriginal, sameSession } of [{ restoreOriginal: false }, { restoreOriginal: true }, { restoreOriginal: true, sameSession: true }]) test(`finishing a paid revised voice preserves a later ${sameSession ? 'same-session ' : ''}${restoreOriginal ? 'A to B to A recording choice' : 'recording choice'}`, async t => {
  const f = await fixture(t); await f.invoke(); await f.tick(20);
  const alternativeDraft = f.store.get('narration_shot_draft', digest({ projectId: f.project.id, shotId: 'shot-2' }));
  const alternativeId = f.narration.workspaceSnapshot(f.project.id).state.entries.find(entry => entry.segmentId === alternativeDraft.segmentId).audioId;
  const alternative = resolveGeneratedNarrationAudio(f.store, f.project.id, alternativeId);
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'text', value: 'A paid revision with a later recording choice.', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  Object.assign(f, f.openTurn('Make the revised voice for scene one.'));
  await f.invoke({ sceneIds: ['scene-0'] }); await f.tick(1);
  const run = f.store.list('scene_confirmation', f.project.id).find(row => row.actor.requestId === f.human.requestId);
  assert.equal(run.steps[0].step, 'attach');
  const step = run.steps[0], state = f.narration.workspaceSnapshot(f.project.id).state;
  const selectionActor = sameSession ? { kind: 'human', principalId: 'local-user', requestId: f.store.get('narration_session', step.sessionId).requestId } : f.human;
  await f.narration.attachGeneratedAudio(f.project.id, selectionActor, { expectedVersion: state.version,
    segmentId: step.speechInput.segmentId, segmentRevisionId: step.speechInput.segmentRevisionId,
    artifactId: alternative.artifact.id, artifactDigest: alternative.artifactDigest,
    generationEvidenceDigest: alternative.generationEvidenceDigest, key: 'later-human-recording-choice' });
  if (restoreOriginal) {
    assert.ok(step.attachmentAudioId);
    const original = resolveGeneratedNarrationAudio(f.store, f.project.id, step.attachmentAudioId);
    await f.narration.attachGeneratedAudio(f.project.id, selectionActor, { expectedVersion: f.narration.workspaceSnapshot(f.project.id).state.version,
      segmentId: step.speechInput.segmentId, segmentRevisionId: step.speechInput.segmentRevisionId,
      artifactId: original.artifact.id, artifactDigest: original.artifactDigest,
      generationEvidenceDigest: original.generationEvidenceDigest, key: 'later-human-restored-recording-choice' });
  }
  await f.tick(12);
  const after = await f.overview();
  assert.equal(after.scenes[0].keyframesRun.state, 'blocked'); assert.equal(after.scenes[0].keyframesRun.blocker.code, 'NARRATION_SPEECH_STALE');
  assert.equal(f.narration.workspaceSnapshot(f.project.id).state.entries.find(entry => entry.segmentId === step.speechInput.segmentId).audioId, restoreOriginal ? step.attachmentAudioId : alternativeId);
  assert.equal(f.calls.speech, 3); assert.equal(f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'video').length, 0);
});

test('aborting a tool during isolated keyframe composition prevents paid publication', async t => {
  const f = await fixture(t), controller = new AbortController();
  const pending = f.tools.invoke(f.project.id, f.bridge.actor, 'abort-composing-keyframes', 'make_keyframes', { shotIds: ['shot-1'] }, { signal: controller.signal });
  assert.equal(f.store.list('director_keyframes_receipt', f.project.id).length, 1);
  assert.equal(f.store.list('candidate', f.project.id).length, 0);
  controller.abort();
  const result = await pending;
  assert.deepEqual(result.started, []); assert.deepEqual(result.refused.map(scene => scene.code), ['TOOL_CALL_CANCELLED']);
  noPaidWork(f); await f.tick(3); noPaidWork(f);
});

const refusalOf = promise => promise.then(() => assert.fail('expected a refusal'), error => error);
const propose = (f, patch) => f.tools.invoke(f.project.id, f.bridge.actor, randomUUID(), 'propose_change', { patch });

test('make_keyframes refuses shots an open proposal would re-prompt until the person accepts it, then makes the accepted prompt', async t => {
  const f = await fixture(t);
  const proposal = await propose(f, { updateShots: [{ id: 'shot-0', imagePrompt: 'A brand-new close-up prompt for the first shot' }] });
  assert.equal(proposal.state, 'held');
  // The same turn, the proposed shot: refused before any paid work, with the next step in the refusal itself.
  const refusal = await refusalOf(f.invoke({ shotIds: ['shot-0'] }, 'pending-proposal'));
  assert.equal(refusal.code, 'PROPOSAL_PENDING');
  assert.match(refusal.message, /old prompt/); assert.match(refusal.message, /Wait for the person to accept/);
  assert.deepEqual(refusal.details.shotIds, ['shot-0']); assert.deepEqual(refusal.details.proposalIds, [proposal.proposalId]);
  assert.match(refusal.details.next, /call make_keyframes again/);
  assert.equal(f.store.get('tool_invocation', digest({ projectId: f.project.id, epochId: f.bridge.actor.epochId, callId: 'pending-proposal' })).error.code, 'PROPOSAL_PENDING');
  // A scene request that includes the shot is refused for the same reason; nothing was bought or recorded as a block.
  assert.equal((await refusalOf(f.invoke({ sceneIds: ['scene-0'] }))).code, 'PROPOSAL_PENDING');
  noPaidWork(f);
  assert.equal(f.store.list('director_keyframes_receipt', f.project.id).length, 0);
  assert.deepEqual(f.blocks(), []);
  // Shots the proposal does not touch can be made now, and a motion-only proposal never holds a keyframe.
  await propose(f, { updateShots: [{ id: 'shot-2', videoPrompt: 'The camera drifts slowly left' }] });
  const other = await f.invoke({ sceneIds: ['scene-1'] }, 'other-scene');
  assert.deepEqual(other.refused, []); assert.deepEqual(other.started.map(row => row.sceneId), ['scene-1']);
  // The person accepts on the card; a new request makes the shot from the accepted prompt.
  const accepted = await f.call('POST', `/director/proposals/${proposal.proposalId}/accept`, { previewDigest: f.store.get('director_proposal', proposal.proposalId).previewDigest });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(f.store.getProject(f.project.id).shots.find(shot => shot.id === 'shot-0').imagePrompt, 'A brand-new close-up prompt for the first shot');
  Object.assign(f, f.openTurn('Now make the first shot.'));
  const made = await f.invoke({ shotIds: ['shot-0'] }, 'after-accept');
  assert.deepEqual(made.refused, []); assert.deepEqual(made.started.map(row => row.sceneId), ['scene-0']);
});

test('a rejected or stale proposal no longer holds its shot for make_keyframes', async t => {
  const f = await fixture(t);
  const proposal = await propose(f, { updateShots: [{ id: 'shot-0', action: 'She turns toward the window' }] });
  assert.equal((await refusalOf(f.invoke({ shotIds: ['shot-0'] }))).code, 'PROPOSAL_PENDING');
  const rejected = await f.call('POST', `/director/proposals/${proposal.proposalId}/reject`, {});
  assert.equal(rejected.statusCode, 200, rejected.body);
  assert.deepEqual((await f.invoke({ shotIds: ['shot-0'] }, 'after-reject')).refused, []);
  // The person edits the shot underneath an open proposal: the card turns stale and cannot be accepted, so it holds nothing.
  const g = await fixture(t);
  const held = await propose(g, { updateShots: [{ id: 'shot-0', imagePrompt: 'Another prompt entirely' }] });
  save(g, project => { project.shots[0].revisionId = randomUUID(); project.shots[0].framing = 'Wide'; });
  const result = await g.invoke({ shotIds: ['shot-0'] }, 'stale-proposal').catch(error => ({ refused: [{ code: error.code }] }));
  assert.ok(!result.refused.some(row => row.code === 'PROPOSAL_PENDING'), JSON.stringify(result.refused));
  assert.equal(g.store.get('director_proposal', held.proposalId).state, 'held', 'the stored row stays; only its view is stale');
});
