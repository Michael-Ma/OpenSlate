import test from 'node:test';
import assert from 'node:assert/strict';
import { makeImageDiscussion, makeMessageCommand, makeQuestionReply, reviewIdentity, reviewMatchesProject, approvalPayload, previewOutput, conversation, pollingDelay, durationLabel, errorMessage } from '../src/model.ts';

const artifact = (id = 'frame-1', sha = 'a'.repeat(64)) => ({ artifactId: id, sha256: sha, kind: 'image' });
const project = () => ({ id: 'project', name: 'Boots', activePlanId: 'plan', headVersion: 3, revisionId: 'revision', shots: [{ id: 'shot-1' }, { id: 'shot-2' }] });
const snapshot = () => ({ project: project(), outputs: [], previousPreviews: [], messages: [], plan: { nodes: [{ id: 'render', kind: 'render' }] } });
const review = () => ({ id: 'snapshot', planId: 'plan', headVersion: 3, revisionId: 'revision', members: [1, 2].map(n => ({ videoNodeId: `video-${n}`, shotId: `shot-${n}`, keyframe: artifact(`frame-${n}`), approvalDigest: `approval-${n}`, ready: true, approved: false, motionPrompt: `Move toward boot ${n}`, durationFrames: 180, profileLabel: 'fixture-video-v1' })) });
const displayed = { 'video-1': 'a'.repeat(64), 'video-2': 'a'.repeat(64) };

test('a scoped message deduplicates only selected shots and captures retry text and identity', () => {
  const ids = ['shot-1', 'shot-1']; const command = makeMessageCommand(project(), '  Tighter framing  ', ids, 'request-1'); ids.push('shot-2');
  assert.deepEqual(command, { key: 'request-1', projectId: 'project', body: { text: 'Tighter framing', scopeIds: ['shot-1'], editing: true } });
  assert.deepEqual(makeMessageCommand(project(), 'Keep the mood', [], 'request-2').body.scopeIds, ['project']);
});
test('fake and offline chat explicitly carry no edit hold authority', () => {
  assert.equal(makeMessageCommand(project(), 'What next?', ['shot-1'], 'request', false).body.editing, false);
});
test('image discussion freezes one exact reference without edit or continuation authority', () => {
  const selected = artifact(), command = makeImageDiscussion('project', selected, 'image-discussion');
  selected.sha256 = 'b'.repeat(64);
  assert.deepEqual(command.body.images, [{ artifactId: 'frame-1', sha256: 'a'.repeat(64) }]);
  assert.equal(command.body.editing, false); assert.equal(command.body.continuationRequestId, undefined);
  assert.deepEqual(command.body.scopeIds, ['project']); assert.equal(command.key, 'image-discussion');
  assert.throws(() => makeImageDiscussion('project', { ...selected, kind: 'video' }, 'key'));
  assert.throws(() => makeImageDiscussion('project', { ...selected, sha256: 'bad' }, 'key'));
});
test('messages reject missing, oversized and stale scopes instead of broadening them', () => {
  for (const text of [' ', 'a'.repeat(16001)]) assert.throws(() => makeMessageCommand(project(), text, [], 'key'));
  assert.throws(() => makeMessageCommand(project(), 'Edit', ['removed-shot'], 'key'), /selected shot changed/);
  assert.throws(() => makeMessageCommand(project(), 'Edit', [], ''), /retry identity/);
});
test('pending question reply is exclusive and cannot acquire selected-shot or other continuation fields', () => {
  const question = { id: 'question', state: 'pending', requestId: 'earlier' };
  assert.deepEqual(makeQuestionReply('project', question, '  Keep warm light. ', 'reply-key'), { projectId: 'project', key: 'reply-key', body: { text: 'Keep warm light.', replyToQuestionId: 'question' } });
  assert.throws(() => makeQuestionReply('project', { ...question, state: 'answered' }, 'Again', 'key'), /already been answered/);
  assert.throws(() => makeQuestionReply('project', question, ' ', 'key'));
});
test('review identity ignores a newly materialized snapshot id and order but preserves exact review meaning', () => {
  const original = review(); const same = structuredClone(original); same.id = 'another-snapshot'; same.members.reverse();
  assert.equal(reviewIdentity(original), reviewIdentity(same));
  for (const mutate of [r => r.planId = 'next', r => r.headVersion++, r => r.revisionId = 'next', r => r.members[0].keyframe.sha256 = 'b'.repeat(64), r => r.members[0].keyframe.artifactId = 'new-file', r => r.members[0].motionPrompt = 'Move away', r => r.members[0].durationFrames = 90, r => r.members[0].profileLabel = 'other-profile', r => r.members[0].approvalDigest = 'changed', r => r.members[0].approved = true, r => r.members[0].ready = false]) {
    const changed = structuredClone(original); mutate(changed); assert.notEqual(reviewIdentity(original), reviewIdentity(changed));
  }
});
test('review eligibility checks all project identity guards', () => {
  assert.equal(reviewMatchesProject(review(), snapshot()), true);
  for (const field of ['activePlanId', 'headVersion', 'revisionId']) { const next = snapshot(); next.project[field] = 'changed'; assert.equal(reviewMatchesProject(review(), next), false); }
  assert.equal(reviewMatchesProject(null, snapshot()), false);
});
test('approval is an explicit subset of exact displayed frames with the saved selection identity', () => {
  const current = review(); assert.deepEqual(approvalPayload(current, ['video-2'], displayed, reviewIdentity(current)), { snapshotId: 'snapshot', videoNodeIds: ['video-2'] });
  const originalIdentity = reviewIdentity(current); current.members[1].motionPrompt = 'Other move';
  assert.throws(() => approvalPayload(current, ['video-2'], displayed, originalIdentity), /storyboard changed/);
});
test('approval fails for missing display bytes, undecodable frames, incomplete terms and stale membership', () => {
  const current = review();
  for (const ids of [[], ['video-1', 'video-1'], ['unknown']]) assert.throws(() => approvalPayload(current, ids, displayed, reviewIdentity(current)));
  for (const hashes of [{}, { ...displayed, 'video-1': '' }, { ...displayed, 'video-1': 'wrong' }]) assert.throws(() => approvalPayload(current, ['video-1'], hashes, reviewIdentity(current)));
  for (const mutate of [r => r.id = null, r => r.members[0].ready = false, r => r.members[0].approved = true, r => r.members[0].keyframe = null, r => r.members[0].approvalDigest = null, r => r.members[0].motionPrompt = '', r => r.members[0].durationFrames = 0, r => r.members[0].profileLabel = '']) {
    const changed = review(); mutate(changed); assert.throws(() => approvalPayload(changed, ['video-1'], displayed, reviewIdentity(changed)));
  }
});
test('a previous assembled preview remains available until its replacement is ready, including reload', () => {
  const state = snapshot(); const previous = { nodeId: 'old-render', artifact: { ...artifact('previous'), kind: 'video' }, fixture: true }; state.previousPreviews = [previous];
  assert.deepEqual(previewOutput(JSON.parse(JSON.stringify(state))), { artifact: previous.artifact, previous: true });
  state.outputs = [{ nodeId: 'render', artifact: { ...artifact('latest'), kind: 'video' } }];
  assert.deepEqual(previewOutput(state), { artifact: state.outputs[0].artifact, previous: false });
  assert.equal(previewOutput(snapshot()), null);
});
test('persisted conversation order is kept, including responses and unanswered requests', () => {
  const state = snapshot(); state.conversation = [{ id: 'a', role: 'user', text: 'Edit' }, { id: 'b', role: 'assistant', text: 'Which shot?' }, { id: 'c', role: 'user', text: 'Shot 1' }];
  assert.deepEqual(conversation(state), state.conversation);
  delete state.conversation; state.messages = [{ id: 'a', text: 'Older user message', state: 'pending' }];
  assert.deepEqual(conversation(state), [{ id: 'a', role: 'user', text: 'Older user message', state: 'pending' }]);
});
test('polling slows for hidden or disconnected tabs and has a bounded retry interval', () => {
  assert.equal(pollingDelay(0), 4000); assert.equal(pollingDelay(0, true), 15000);
  assert.ok(pollingDelay(3) > pollingDelay(1)); assert.equal(pollingDelay(100), 30000); assert.equal(pollingDelay(-1), 4000);
});
test('planned durations and failure guidance are explicit', () => {
  assert.equal(durationLabel(180), '6s'); assert.equal(durationLabel(4500), '2:30');
  assert.match(errorMessage('QUESTION_STALE'), /question/); assert.match(errorMessage('ARTIFACT_CHANGED'), /bytes changed/);
});
