import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { verifySkillLock } from '@openslate/director';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { DirectorContextService } from '../dist/application/director-context.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
async function fixture(t, options = {}) {
  const f = await confirmationFixture(t, { modes: ['none'], ...options });
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'openslate-chat-confirm-skills-'));
  t.after(() => { writable(snapshotRoot); rmSync(snapshotRoot, { recursive: true, force: true }); });
  const saved = createDirectorSkillLock({ repositoryRoot, snapshotRoot }, options.toolContract ?? '6.0.0');
  verifySkillLock(saved.lock, saved.environment);
  const contexts = new DirectorContextService(f.production, saved.environment);
  contexts.bootstrapLock(f.project.id, saved.lock);
  f.openTurn = ({ scopeIds = [f.project.id], editing = true, review = false } = {}) => {
    const human = f.production.beginRequest(f.project.id, 'local-user', review ? 'Review the returned keyframes.' : 'Discuss generation for these scenes.',
      { editing, scopeIds, ...(review ? { source: 'app' } : {}), concurrency: 'alongside', holdScopeIds: [] });
    if (review) f.store.insert('keyframe_review_request', human.requestId, f.project.id,
      { requestId: human.requestId, action: 'keyframe_review', sceneId: 'scene-0', batchDigest: 'synthetic-review-batch' });
    const bridge = f.production.openEpoch(f.project.id, human), turnId = randomUUID();
    f.store.insert('director_turn', turnId, f.project.id,
      { id: turnId, projectId: f.project.id, requestId: human.requestId, epochId: bridge.actor.epochId, state: 'completed' });
    contexts.capture(f.project.id, bridge.actor, { lockId: saved.lock.id,
      ...(saved.lock.schemaVersion === 2 ? {} : { selectedSkillIds: ['production', 'plan-authoring'] }) });
    return { human, bridge, turnId };
  };
  f.tools = new ToolInvocationService(f.production, { narrationSpeech: f.narrationSpeech, enqueueVoice: f.runner.enqueueKeyframes });
  f.note = (overrides = {}) => ({ anchor: { sceneId: 'scene-0' }, kind: 'recommendation', blocking: false,
    text: 'Confirm the reviewed frames and video recipe here.', choices: [{ kind: 'confirm_video', sceneId: 'scene-0' }], ...overrides });
  f.record = async (turn, notes = [f.note()]) => {
    const receipt = await f.tools.invoke(f.project.id, turn.bridge.actor, randomUUID(), 'record_notes', { notes });
    return receipt.notes.map(note => f.store.get('director_note', note.noteId));
  };
  f.findNote = id => f.production.snapshot(f.project.id).notes.find(note => note.noteId === id);
  f.resolve = (note, extra = {}, key = randomUUID()) => f.call('POST', `/director/notes/${note.noteId}/resolve`,
    { choiceIndex: 0, expectedVersion: note.version, ...extra }, key);
  f.ready = async () => { await f.make(); await f.tick(6); await f.openFrames(); };
  return f;
}
function paidState(f) {
  return Object.fromEntries(['grant', 'candidate', 'attempt', 'reservation', 'scene_confirmation', 'scene_generation_action', 'director_generation_effect']
    .map(kind => [kind, f.store.list(kind, f.project.id)]));
}
function commandState(f) {
  return { project: f.store.getProject(f.project.id), paid: paidState(f), cursor: f.store.cursor(f.project.id),
    ...Object.fromEntries(['message', 'hold', 'node_binding', 'director_note', 'plan', 'logical_ids'].map(kind => [kind, f.store.list(kind, f.project.id)])) };
}
async function regenerateBody(f, shotIds) {
  const view = await f.call('GET', '/scenes/scene-0/generation').then(f.ok);
  return { headVersion: view.headVersion, revisionId: view.revisionId, kind: 'image', reviewedFrames: [],
    reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId,
    targetShotIds: shotIds, regenerate: true };
}

async function saveClips(f) {
  await f.ready();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.tick(10);
  assert.ok(Object.values((await f.overview()).shots).every(shot => shot.video.state === 'ready'));
}

for (const toolContract of ['7.0.0', '7.1.0']) test(`${toolContract} saved-scene note grammar preserves its exact confirm/remake policy`, async t => {
  const f = await fixture(t, { toolContract }); await saveClips(f);
  const turn = f.openTurn(), remake = f.note({ choices: [{ kind: 'remake_clip', shotIds: ['shot-0'] }] });
  const before = paidState(f), purchases = f.provider.acceptedCount();
  if (toolContract === '7.1.0') {
    const [note] = await f.record(turn, [remake]);
    assert.deepEqual(note.choices, [{ kind: 'remake_clip', shotIds: ['shot-0'] }]);
    await assert.rejects(f.record(turn), error => error.code === 'SCENE_VIDEO_SAVED'
      && /remake_clip.*shots the person named.*human press/.test(error.message));
  } else {
    assert.equal((await f.record(turn))[0].choices[0].kind, 'confirm_video');
    await assert.rejects(f.record(turn, [remake]), { code: 'VALIDATION_ERROR' });
  }
  assert.deepEqual(paidState(f), before); assert.equal(f.provider.acceptedCount(), purchases);
});

test('7.1.0 remake notes require saved in-scope clips, ready frames and one scene, with atomic refusal', async t => {
  const f = await fixture(t, { toolContract: '7.1.0', modes: ['none', 'none'] }); await f.ready();
  let turn = f.openTurn();
  const note = shotIds => f.note({ choices: [{ kind: 'remake_clip', shotIds }] });
  await assert.rejects(f.record(turn, [note(['shot-0'])]), { code: 'CLIP_NOT_SAVED' });
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(10);
  turn = f.openTurn();
  for (const invalid of [note(['missing-shot']), note(['shot-0', 'shot-0']), note(['shot-0', 'shot-1', 'missing-shot'])]) {
    await assert.rejects(f.record(turn, [note(['shot-0']), invalid]), error => ['SCOPE_DENIED', 'VALIDATION_ERROR'].includes(error.code));
    assert.equal(f.store.list('director_note', f.project.id).length, 0, 'invalid batches save no partial note');
  }
  const project = f.store.getProject(f.project.id);
  project.scenes.push({ ...project.scenes[0], id: 'scene-foreign', title: 'Other scene' });
  project.shots[1].sceneId = 'scene-foreign';
  f.store.saveProject(project, project.headVersion);
  turn = f.openTurn();
  await assert.rejects(f.record(turn, [f.note({ anchor: { shotIds: ['shot-0', 'shot-1'] }, choices: [{ kind: 'remake_clip', shotIds: ['shot-0', 'shot-1'] }] })]), { code: 'VALIDATION_ERROR' });
  const foreign = f.openTurn({ scopeIds: ['shot-0'] });
  await assert.rejects(f.record(foreign, [f.note({ anchor: { shotIds: ['shot-1'] }, choices: [{ kind: 'remake_clip', shotIds: ['shot-1'] }] })]), { code: 'SCOPE_DENIED' });
});

test('a Keyframes clip remake press settles only covered remake notes without settling frame-remake choices', async t => {
  const f = await fixture(t, { toolContract: '7.1.0', modes: ['none', 'none'] }); await saveClips(f);
  const [all, subset, keyframe] = await f.record(f.openTurn(), [
    f.note({ choices: [{ kind: 'remake_clip', shotIds: ['shot-0', 'shot-1'] }] }),
    f.note({ choices: [{ kind: 'reply' }, { kind: 'remake_clip', shotIds: ['shot-0'] }] }),
    f.note({ choices: [{ kind: 'regenerate_keyframe', shotIds: ['shot-0'] }] }),
  ]);
  const view = await f.overview(), shot = view.shots['shot-0'];
  const receipt = await f.call('POST', '/scenes/scene-0/remake-clips', {
    targetShotIds: ['shot-0'], confirmationDigest: view.scenes[0].confirmationDigest,
    reviewedFrames: [{ shotId: 'shot-0', artifactId: shot.keyframe.artifact.artifactId, sha256: shot.keyframe.artifact.sha256 }],
    expectedEstimateMicros: shot.quotes.remakeClip.micros,
  }).then(f.ok);
  const settled = f.findNote(subset.noteId);
  assert.equal(settled.state, 'resolved'); assert.equal(settled.resolution.elsewhere, true);
  assert.equal(settled.resolution.choiceIndex, 1); assert.equal(settled.resolution.resultRef, receipt.confirmationId);
  assert.equal(f.findNote(all.noteId).state, 'open'); assert.equal(f.findNote(keyframe.noteId).state, 'open');
  assert.equal((await f.resolve(subset, { choiceIndex: 1, resultRef: receipt.confirmationId })).json().error.code, 'NOTE_ALREADY_SETTLED');
});

test('confirm_video choices stay inside their scene anchor and do not replace a blocking keep choice', async t => {
  const f = await fixture(t, { modes: ['none', 'none'] });
  const project = f.store.getProject(f.project.id);
  project.scenes.push({ ...project.scenes[0], id: 'scene-1', title: 'Another scene' });
  project.shots[1].sceneId = 'scene-1';
  f.store.saveProject(project, project.headVersion);
  const turn = f.openTurn();
  const valid = [f.note(), f.note({ anchor: { shotIds: ['shot-0'] } })];
  assert.equal((await f.record(turn, valid)).length, 2);
  for (const invalid of [
    f.note({ choices: [{ kind: 'confirm_video', sceneId: 'missing-scene' }] }),
    f.note({ choices: [{ kind: 'confirm_video', sceneId: 'scene-1' }] }),
    f.note({ anchor: { shotIds: ['shot-0', 'shot-1'] } }),
  ]) {
    await assert.rejects(f.record(turn, [f.note(), invalid]), { code: 'SCOPE_DENIED' });
    assert.equal(f.store.list('director_note', f.project.id).length, 2, 'an invalid batch saves no partial note');
  }
  await assert.rejects(f.record(turn, [f.note({ blocking: true })]), error =>
    error.code === 'VALIDATION_ERROR' && error.details?.reason === 'missing_keep_choice');
  const [blocking] = await f.record(turn, [f.note({ blocking: true,
    choices: [{ kind: 'confirm_video', sceneId: 'scene-0' }, { kind: 'accept', label: 'Keep the current frames' }] })]);
  assert.equal(blocking.blocking, true);
  assert.equal(f.provider.acceptedCount(), 0);
  assert.ok(Object.values(paidState(f)).every(rows => rows.length === 0));
});

test('offering a confirmation in a read-only keyframe review starts no work and spends nothing', async t => {
  const f = await fixture(t); await f.ready();
  const turn = f.openTurn({ editing: false, review: true, scopeIds: ['shot-0'] });
  const before = paidState(f), project = f.store.getProject(f.project.id), purchases = f.provider.acceptedCount();
  assert.equal(f.store.get('epoch', turn.bridge.actor.epochId).state, 'read_only');
  const [note] = await f.record(turn, [f.note({ anchor: { shotIds: ['shot-0'] } })]);
  assert.equal(note.state, 'open'); assert.equal(note.choices[0].kind, 'confirm_video');
  await f.tick(3);
  assert.deepEqual(paidState(f), before);
  assert.deepEqual(f.store.getProject(f.project.id), project);
  assert.equal(f.provider.acceptedCount(), purchases); assert.equal(f.calls.speech, 0);
});

test('only a matching later human scene confirmation can resolve a confirm_video choice', async t => {
  const f = await fixture(t); await f.ready();
  const earlier = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  await f.tick(8);
  const [note] = await f.record(f.openTurn());
  // A real human edit stales the note. The later real confirmation deliberately skips
  // stale notes, leaving the explicit resultRef validation path available to exercise.
  await f.call('POST', '/storyboard', { kind: 'shot', id: 'shot-0', field: 'motion', value: 'A newly reviewed slow camera move.',
    expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  assert.equal(f.findNote(note.noteId).state, 'stale');
  await f.openFrames();
  const later = await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok);
  assert.equal(f.findNote(note.noteId).state, 'stale');
  for (const resultRef of [undefined, 'invented-confirmation', earlier.confirmationId]) {
    const response = await f.resolve(note, resultRef ? { resultRef } : {});
    assert.equal(response.json().error.code, 'NOTE_RESULT_INVALID', response.body);
  }
  const original = f.store.get('scene_confirmation', later.confirmationId);
  // These adversarial identities reuse a genuine persisted receipt and its later
  // event, so the refusal must check ownership, scene and kind rather than just time.
  for (const change of [{ sceneId: 'scene-foreign' }, { kind: 'keyframes' }]) {
    f.store.put('scene_confirmation', original.id, f.project.id, { ...original, ...change });
    const response = await f.resolve(note, { resultRef: original.id });
    assert.equal(response.json().error.code, 'NOTE_RESULT_INVALID', response.body);
    f.store.put('scene_confirmation', original.id, f.project.id, original);
  }
  const foreignProject = f.production.createProject('Foreign confirmation evidence');
  const foreignActor = f.production.beginRequest(foreignProject.id, 'local-user', 'Confirm another film.', { source: 'app' });
  f.store.insert('scene_confirmation', foreignActor.requestId, foreignProject.id,
    { ...original, id: foreignActor.requestId, projectId: foreignProject.id, actor: foreignActor });
  f.store.appendEvent(foreignProject.id, 'scene.confirmation_changed',
    { confirmationId: foreignActor.requestId, sceneId: 'scene-0', state: 'running' });
  const foreign = await f.resolve(note, { resultRef: foreignActor.requestId });
  assert.equal(foreign.json().error.code, 'NOTE_RESULT_INVALID', foreign.body);
  const before = paidState(f), purchases = f.provider.acceptedCount();
  const resolved = await f.resolve(note, { resultRef: later.confirmationId }).then(f.ok);
  assert.equal(resolved.state, 'resolved'); assert.equal(resolved.resolution.resultRef, later.confirmationId);
  assert.equal(resolved.resolution.elsewhere, undefined);
  assert.deepEqual(paidState(f), before); assert.equal(f.provider.acceptedCount(), purchases);
});

test('workspace confirmation settles every matching open choice and chat later gets NOTE_ALREADY_SETTLED', async t => {
  const f = await fixture(t); await f.ready();
  const notes = await f.record(f.openTurn(), [f.note({ choices: [{ kind: 'reply' }, { kind: 'confirm_video', sceneId: 'scene-0' }] }),
    f.note(), f.note({ choices: [{ kind: 'regenerate_keyframe', shotIds: ['shot-0'] }] })]);
  const body = await f.confirmBody(), receipt = await f.call('POST', '/scenes/scene-0/confirm', body, 'workspace-confirm').then(f.ok);
  for (const [index, original] of notes.slice(0, 2).entries()) {
    const note = f.findNote(original.noteId);
    assert.equal(note.state, 'resolved'); assert.equal(note.version, 2);
    assert.equal(note.resolution.choiceIndex, index === 0 ? 1 : 0);
    assert.equal(note.resolution.elsewhere, true); assert.equal(note.resolution.resultRef, receipt.confirmationId);
    const stalePress = await f.resolve(original, { choiceIndex: index === 0 ? 1 : 0, resultRef: receipt.confirmationId });
    assert.equal(stalePress.json().error.code, 'NOTE_ALREADY_SETTLED', stalePress.body);
  }
  assert.equal(f.findNote(notes[2].noteId).state, 'open');
  const cursor = f.store.cursor(f.project.id);
  assert.deepEqual(await f.call('POST', '/scenes/scene-0/confirm', body, 'workspace-confirm').then(f.ok), receipt);
  assert.equal(f.store.cursor(f.project.id), cursor);
  await f.tick(8);
  await f.call('POST', '/storyboard', { kind: 'shot', id: 'shot-0', field: 'motion', value: 'A later human camera move.',
    expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  for (const original of notes.slice(0, 2)) {
    assert.equal(f.findNote(original.noteId).state, 'resolved', 'later changed evidence cannot stale a settled note');
    assert.equal(f.findNote(original.noteId).resolution.resultRef, receipt.confirmationId);
  }
});

test('concurrent different-key scene confirms admit one video purchase', async t => {
  const f = await fixture(t); await f.ready();
  const [note] = await f.record(f.openTurn());
  const purchases = f.provider.acceptedCount(), body = await f.confirmBody();
  const responses = await Promise.all(['chat-press', 'workspace-press'].map(key => f.call('POST', '/scenes/scene-0/confirm', body, key)));
  assert.equal(responses.filter(response => response.statusCode === 200).length, 1);
  const refusal = responses.find(response => response.statusCode !== 200);
  assert.ok(['SCENE_REVIEW_STALE', 'CONFIRMATION_RUNNING'].includes(refusal.json().error.code), refusal.body);
  assert.equal(f.store.list('scene_confirmation', f.project.id).filter(row => row.kind === 'video').length, 1);
  assert.equal(f.store.list('grant', f.project.id).filter(grant => grant.kind === 'video').length, 1);
  await f.tick(10);
  assert.equal(f.provider.acceptedCount(), purchases + 1);
  assert.equal(f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'video').length, 1);
  assert.equal((await f.overview()).scenes[0].counts.videosReady, 1);
  assert.equal(f.findNote(note.noteId).state, 'resolved');
});

test('keyframe regeneration settles covered choices only and resolved visual evidence stays settled', async t => {
  const f = await fixture(t, { modes: ['none', 'none'] }); await f.ready();
  const turn = f.openTurn(), [all, subset] = await f.record(turn, [f.note({ choices: [{ kind: 'regenerate_keyframe', shotIds: ['shot-0', 'shot-1'] }] }),
    f.note({ choices: [{ kind: 'regenerate_keyframe', shotIds: ['shot-0'] }] })]);
  const partial = await f.make({ regenerate: true, targetShotIds: ['shot-0'] });
  assert.equal(f.findNote(all.noteId).state, 'open');
  const settledSubset = f.findNote(subset.noteId);
  assert.equal(settledSubset.state, 'resolved'); assert.equal(settledSubset.resolution.elsewhere, true);
  assert.equal(settledSubset.resolution.resultRef, partial.receipt.requestId);
  await f.tick(6);
  assert.equal(f.findNote(all.noteId).state, 'open');
  const view = await f.overview(), artifact = view.shots['shot-0'].keyframe.artifact;
  // Identity-only projection of the actual fake output; this makes no visual claim.
  const nextTurn = f.openTurn(), seen = { shotId: 'shot-0', artifactId: artifact.artifactId, sha256: artifact.sha256 };
  f.store.insert('request_keyframe_projection', nextTurn.human.requestId, f.project.id,
    { projectId: f.project.id, epochId: nextTurn.bridge.actor.epochId, images: [seen] });
  const [visual] = await f.record(nextTurn, [f.note({ seenKeyframe: seen, choices: [{ kind: 'regenerate_keyframe', shotIds: ['shot-0'] }] })]);
  const full = await f.make({ regenerate: true, targetShotIds: ['shot-0', 'shot-1'] });
  for (const original of [all, visual]) {
    const note = f.findNote(original.noteId);
    assert.equal(note.state, 'resolved'); assert.equal(note.resolution.elsewhere, true);
    assert.equal(note.resolution.resultRef, full.receipt.requestId);
  }
  assert.deepEqual(f.findNote(subset.noteId).resolution, settledSubset.resolution, 'a later superset press cannot replace the first result');
  // The normal fake adapter deterministically repeats identical image bytes. Give
  // these replacement fixture outputs a valid different hash to exercise staleness
  // from the actual image publication, while keeping all execution/receipt checks.
  const poll = f.provider.poll.bind(f.provider);
  f.provider.poll = async taskId => {
    const outcome = await poll(taskId);
    if (outcome.type !== 'completed') return outcome;
    return { ...outcome, outputs: outcome.outputs.map(output => {
      if (output.mimeType !== 'image/svg+xml') return output;
      const bytes = Buffer.concat([Buffer.from(output.bytesBase64, 'base64'), Buffer.from('\n<!-- replacement fixture -->')]);
      return { ...output, bytesBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
    }) };
  };
  await f.tick(8);
  assert.notEqual((await f.overview()).shots['shot-0'].keyframe.artifact.sha256, seen.sha256);
  assert.equal(f.findNote(visual.noteId).state, 'resolved', 'the replacement that settled this note must not stale it');
});

test('make_keyframes regeneration settles elsewhere using its scene action identity', async t => {
  const f = await fixture(t, { modes: ['none', 'none'] }); await f.ready();
  const turn = f.openTurn(), [note] = await f.record(turn,
    [f.note({ choices: [{ kind: 'regenerate_keyframe', shotIds: ['shot-0', 'shot-1'] }] })]);
  const before = f.provider.acceptedCount();
  const result = await f.tools.invoke(f.project.id, turn.bridge.actor, 'director-new-takes', 'make_keyframes',
    { shotIds: ['shot-0', 'shot-1'], regenerate: true });
  assert.deepEqual(result.refused, []); assert.equal(result.started.length, 1);
  const actions = f.store.db.prepare("SELECT id,body FROM entities WHERE kind='scene_generation_action' AND project_id=?").all(f.project.id);
  const action = actions.find(row => { const value = JSON.parse(row.body); return value.requestId === turn.human.requestId && value.regenerate; });
  assert.ok(action); assert.notEqual(action.id, turn.human.requestId);
  const resolved = f.findNote(note.noteId);
  assert.equal(resolved.state, 'resolved'); assert.equal(resolved.resolution.elsewhere, true);
  assert.equal(resolved.resolution.resultRef, action.id);
  await f.tick(8);
  assert.equal(f.provider.acceptedCount(), before + 2);
  assert.equal(f.findNote(note.noteId).state, 'resolved');
  assert.equal(f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'video').length, 0);
});

for (const command of ['confirmation', 'regeneration']) test(`a failed note settlement rolls back the whole ${command} command before buying`, async t => {
  const f = await fixture(t); await f.ready();
  const [note] = await f.record(f.openTurn(), [command === 'confirmation' ? f.note() :
    f.note({ choices: [{ kind: 'regenerate_keyframe', shotIds: ['shot-0'] }] })]);
  const path = command === 'confirmation' ? '/scenes/scene-0/confirm' : '/scenes/scene-0/generate';
  const body = command === 'confirmation' ? await f.confirmBody() : await regenerateBody(f, ['shot-0']);
  const before = commandState(f), purchases = f.provider.acceptedCount(), put = f.store.put.bind(f.store);
  let injected = false;
  f.store.put = (kind, id, projectId, value) => {
    if (kind === 'director_note' && id === note.noteId && value.state === 'resolved') {
      injected = true; throw Error('injected note settlement write failure');
    }
    return put(kind, id, projectId, value);
  };
  let failed;
  try { failed = await f.call('POST', path, body, 'atomic-settlement'); } finally { f.store.put = put; }
  assert.equal(injected, true, 'the command must attempt note settlement inside its transaction');
  assert.equal(failed.statusCode, 500, failed.body);
  assert.deepEqual(commandState(f), before);
  await f.tick(3); assert.equal(f.provider.acceptedCount(), purchases);
  assert.equal(f.findNote(note.noteId).state, 'open');
  await f.call('POST', path, body, 'atomic-settlement').then(f.ok);
  await f.tick(8);
  assert.equal(f.findNote(note.noteId).state, 'resolved');
  assert.equal(f.provider.acceptedCount(), purchases + 1, 'the successful retry buys exactly one new take');
});
