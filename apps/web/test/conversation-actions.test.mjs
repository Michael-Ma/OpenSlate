import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationSceneState, exposedSceneFrameKey, makeConversationSceneCommand, sceneGenerationLabels, sceneShotMediaStatus } from '../src/conversation-actions-model.ts';
import { PendingCommandRegistry } from '../src/pending-command.ts';

const hash = 'a'.repeat(64), director = { mode: 'native', status: 'idle' };
function fixture() {
  const shot = (id, sceneId = 'scene') => ({ id, sceneId, revisionId: `shot-${id}`, imagePrompt: `Image ${id}`, videoPrompt: `Motion ${id}`, desiredFrames: 90 });
  const snapshot = { project: { id: 'project', headVersion: 4, revisionId: 'revision', scenes: [{ id: 'scene' }, { id: 'other' }], shots: [shot('one'), shot('two'), shot('foreign', 'other')] }, control: { paused: false }, questions: [] };
  const row = id => ({ shotId: id, purpose: `Purpose ${id}`, image: { kind: 'image', artifactId: `frame-${id}`, sha256: hash }, imageComplete: true, imageFixture: false, motionPrompt: `Actual ${id}`, plannedFrames: 90, durationFrames: 180, videoComplete: false, videoProfileLabel: 'retained-six-second-model', videoSettings: { quality: 'high' }, narrationPending: false, imagePending: false, videoPending: false, blockedCode: null });
  const view = { projectId: 'project', sceneId: 'scene', headVersion: 4, revisionId: 'revision', reviewedControlAuthorityId: null, reviewedHoldDigest: 'b'.repeat(64), busy: false, paused: false, imageProfileLabel: 'chosen-image', videoProfileLabel: 'default-video', rows: [row('one'), row('two')] };
  const exposed = Object.fromEntries(view.rows.map(item => [exposedSceneFrameKey(view.projectId, view.revisionId, item.shotId, item.image.artifactId, item.image.sha256), true]));
  return { snapshot, view, exposed };
}

test('video decision requires every exact current image actually displayed on the right', () => {
  const { snapshot, view, exposed } = fixture();
  assert.equal(conversationSceneState(view, snapshot, director, exposed).canGenerate, true);
  for (const wrong of [{}, { ...exposed, [Object.keys(exposed)[0]]: false }, {
    [exposedSceneFrameKey('project', 'previous-revision', 'one', 'frame-one', hash)]: true,
    [Object.keys(exposed)[1]]: true,
  }, {
    [exposedSceneFrameKey('project', 'revision', 'one', 'other-artifact', hash)]: true,
    [Object.keys(exposed)[1]]: true,
  }, {
    [exposedSceneFrameKey('other-project', 'revision', 'one', 'frame-one', hash)]: true,
    [Object.keys(exposed)[1]]: true,
  }]) {
    const state = conversationSceneState(view, snapshot, director, wrong);
    assert.equal(state.framesReady, false); assert.equal(state.canGenerate, false);
    assert.throws(() => makeConversationSceneCommand(view, snapshot, director, wrong, 'key'), /Display every current keyframe/);
  }
});

test('full scene decision lists exact unfinished targets without borrowing another scene or changing retained recipes', () => {
  const { snapshot, view, exposed } = fixture();
  view.rows[0].videoComplete = true;
  const state = conversationSceneState(view, snapshot, director, exposed);
  assert.deepEqual(state.targets.map(row => row.shotId), ['two']);
  assert.equal(state.targets[0].durationFrames, 180); assert.equal(state.targets[0].videoProfileLabel, 'retained-six-second-model');
  assert.deepEqual(state.targets[0].videoSettings, { quality: 'high' });
  const command = makeConversationSceneCommand(view, snapshot, director, exposed, 'same-key');
  assert.equal(command.path, '/api/projects/project/scenes/scene/generate');
  assert.deepEqual(command.body, { headVersion: 4, revisionId: 'revision', kind: 'video', reviewedFrames: [{ shotId: 'two', artifactId: 'frame-two', sha256: hash }], reviewedControlAuthorityId: null, reviewedHoldDigest: 'b'.repeat(64) });
  assert.deepEqual(command.metadata, { sceneId: 'scene', kind: 'video', revisionId: 'revision' });
});

test('missing images request only scene keyframes; video remains a later explicit decision', () => {
  const { snapshot, view } = fixture();
  view.rows[0].image = null; view.rows[0].imageComplete = false;
  const state = conversationSceneState(view, snapshot, director, {});
  assert.equal(state.stage, 'image'); assert.equal(state.canGenerate, true); assert.deepEqual(state.targets.map(row => row.shotId), ['one']);
  const command = makeConversationSceneCommand(view, snapshot, director, {}, 'key');
  assert.equal(command.body.kind, 'image'); assert.deepEqual(command.body.reviewedFrames, []);
});

test('stale/foreign/duplicated or missing shot views cannot mint a scene action', () => {
  for (const change of [view => { view.projectId = 'other'; }, view => { view.headVersion++; }, view => { view.revisionId = 'old'; }, view => { view.sceneId = 'deleted'; }, view => { view.rows.pop(); }, view => { view.rows[1].shotId = 'one'; }, view => { view.rows.reverse(); }, view => { view.rows[1].shotId = 'foreign'; }]) {
    const { snapshot, view, exposed } = fixture(); change(view);
    assert.equal(conversationSceneState(view, snapshot, director, exposed).fresh, false);
    assert.throws(() => makeConversationSceneCommand(view, snapshot, director, exposed, 'key'), /scene changed/);
  }
});

test('Stop, running turns, pending current answers, and current saved jobs suppress fresh generation', () => {
  const changes = [
    ({ snapshot }) => { snapshot.control.paused = true; },
    ({ view }) => { view.paused = true; },
    ({ view }) => { view.busy = true; },
    ({ snapshot }) => { snapshot.questions = [{ state: 'pending', canAnswer: true }]; },
    ({ view }) => { view.rows[0].imagePending = true; },
    ({ view }) => { view.rows[0].videoPending = true; },
    ({ view }) => { view.rows[0].blockedCode = 'SUBMISSION_UNKNOWN'; },
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.equal(conversationSceneState(f.view, f.snapshot, director, f.exposed).canGenerate, false); assert.throws(() => makeConversationSceneCommand(f.view, f.snapshot, director, f.exposed, 'key')); }
  const { snapshot, view, exposed } = fixture();
  for (const status of ['running', 'waiting_user']) assert.equal(conversationSceneState(view, snapshot, { ...director, status }, exposed).canGenerate, false);
  snapshot.questions = [{ state: 'pending', canAnswer: false }];
  assert.equal(conversationSceneState(view, snapshot, director, exposed).canGenerate, true, 'historical unanswerable question cannot block current work');
});

test('narration timing and unsupported motion prevent video while narration links stay available before images', () => {
  const { snapshot, view, exposed } = fixture(); view.rows[1].narrationPending = true;
  let state = conversationSceneState(view, snapshot, director, exposed);
  assert.deepEqual(state.narrationShotIds, ['two']); assert.equal(state.canGenerate, false); assert.match(state.reason, /narration timing/);
  view.rows[0].imageComplete = false; view.rows[0].image = null;
  state = conversationSceneState(view, snapshot, director, exposed); assert.equal(state.stage, 'image'); assert.equal(state.canGenerate, true); assert.deepEqual(state.narrationShotIds, ['two']);
  view.rows[0].imageComplete = true; view.rows[0].image = { kind: 'image', artifactId: 'frame-one', sha256: hash }; view.rows[1].narrationPending = false;
  view.rows[1].motionPrompt = ''; assert.match(conversationSceneState(view, snapshot, director, exposed).reason, /motion/);
  view.rows[1].motionPrompt = 'Motion'; view.rows[1].blockedCode = 'PROFILE_INCOMPATIBLE'; assert.equal(conversationSceneState(view, snapshot, director, exposed).canGenerate, false);
});

test('scene/shot labels use persistent scene membership and chronology; terminal and empty states have no action', () => {
  const { snapshot, view, exposed } = fixture();
  assert.deepEqual(sceneGenerationLabels(snapshot, 'scene'), { scene: 'Scene 01', shots: { one: 'Shot 1.1', two: 'Shot 1.2' } });
  assert.deepEqual(sceneGenerationLabels(snapshot, 'other'), { scene: 'Scene 02', shots: { foreign: 'Shot 2.1' } });
  view.rows.forEach(row => row.videoComplete = true);
  assert.equal(conversationSceneState(view, snapshot, director, exposed).stage, 'complete'); assert.throws(() => makeConversationSceneCommand(view, snapshot, director, exposed, 'key'), /saved/);
  view.rows = []; snapshot.project.shots = snapshot.project.shots.filter(shot => shot.sceneId !== 'scene');
  assert.equal(conversationSceneState(view, snapshot, director, exposed).stage, 'empty'); assert.throws(() => makeConversationSceneCommand(view, snapshot, director, exposed, 'key'), /Add shots/);
});

test('unconfirmed submission status takes precedence over completed-looking rows', () => {
  const { view } = fixture(); view.rows[0].videoComplete = true; view.rows[0].blockedCode = 'SUBMISSION_UNKNOWN';
  assert.equal(sceneShotMediaStatus(view.rows[0]), 'Job outcome unconfirmed');
});

test('lost scene response retains a frozen exact decision across remount and cannot be replaced by new intent', async () => {
  const { snapshot, view, exposed } = fixture(), registry = new PendingCommandRegistry();
  const command = makeConversationSceneCommand(view, snapshot, director, exposed, 'scene-once'); let calls = 0;
  const fail = Object.assign(new Error('Response lost'), { code: 'NETWORK_ERROR' });
  await registry.run('project', command, async () => { calls++; throw fail; }, cause => cause.code === 'NETWORK_ERROR');
  const saved = registry.snapshot('project').command;
  view.rows[0].image.sha256 = 'c'.repeat(64); snapshot.project.revisionId = 'new-revision';
  assert.equal(saved.key, 'scene-once'); assert.equal(saved.body.revisionId, 'revision'); assert.equal(saved.body.reviewedFrames[0].sha256, hash);
  assert.equal(await registry.run('project', { ...command, key: 'replacement' }, async () => { calls++; }, () => false), false);
  assert.equal(calls, 1); assert.throws(() => saved.body.reviewedFrames.push({}), TypeError);
  await registry.run('project', saved, async exact => { calls++; assert.equal(exact, saved); return { sceneId: 'scene' }; }, () => false);
  assert.equal(calls, 2); assert.equal(registry.snapshot('project').command, null);
});
