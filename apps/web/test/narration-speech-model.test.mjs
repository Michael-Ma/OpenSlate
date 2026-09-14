import test from 'node:test';
import assert from 'node:assert/strict';
import { canReviewSpeech, speechPrepareCommand, speechReviewCommand, speechStatus } from '../src/narration-speech-model.ts';
const fixture = () => {
  const view = { headVersion: 2, revisionId: 'rev', session: { id: 'session', state: 'active' }, snapshot: { segments: [
    { entry: { segmentId: 'section' }, script: { id: 'section-rev', text: 'Made to last.', textKind: 'draft', source: { kind: 'generated' } } },
  ] } };
  const detail = { proposal: { id: 'proposal', proposalDigest: 'a'.repeat(64), baseProject: { headVersion: 2, revisionId: 'rev' },
    segment: { segmentId: 'section', segmentRevisionId: 'section-rev', text: 'Made to last.' } }, eligibility: { current: true, code: null }, application: null };
  const options = { profiles: [{ id: 'speech' }], voices: ['cedar'], capabilities: { configured: true } }; return { view, detail, options };
};
test('speech preparation selects saved revision without sending replacement words or spending authority', () => {
  const f = fixture(), command = speechPrepareCommand('p', 'key', f.view, 'section', f.options, 'speech', 'cedar', 'Warm');
  assert.deepEqual(command.body, { sessionId: 'session', expectedHeadVersion: 2, segmentId: 'section', segmentRevisionId: 'section-rev', profileId: 'speech', voice: 'cedar', instructions: 'Warm' });
  assert.equal(command.path, '/api/projects/p/narration/speech-proposals'); assert.equal(command.key, 'key');
});
test('speech review binds exact proposal digest and current saved words', () => {
  const f = fixture(); assert.equal(canReviewSpeech(f.detail, f.view), true);
  assert.deepEqual(speechReviewCommand('p', 'review-key', f.view, f.detail).body, { sessionId: 'session', proposalId: 'proposal', proposalDigest: 'a'.repeat(64) });
  f.view.snapshot.segments[0].script.text = 'Changed words'; assert.equal(canReviewSpeech(f.detail, f.view), false);
  assert.throws(() => speechReviewCommand('p', 'k', f.view, f.detail));
});
test('refresh errors, stale session or section, and previously applied proposals cannot be approved', () => {
  for (const mutate of [f => f.view.session.state = 'stale', f => f.view.headVersion++, f => f.view.snapshot.segments[0].script.id = 'changed',
    f => f.detail.application = { candidateId: 'candidate' }, f => f.detail.eligibility.current = false, f => f.detail.eligibility.code = 'blocked']) {
    const f = fixture(); mutate(f); assert.equal(canReviewSpeech(f.detail, f.view), false);
  }
  const f = fixture(); assert.equal(canReviewSpeech(f.detail, f.view, true), false);
});
test('speech preparation rejects unfinished text, wrong source intent, and unavailable models', () => {
  for (const mutate of [f => f.view.snapshot.segments[0].script.textKind = 'notes', f => f.view.snapshot.segments[0].script.source.kind = 'uploaded',
    f => f.options.capabilities.configured = false, f => f.options.profiles = [], f => f.options.voices = []]) {
    const f = fixture(); mutate(f); assert.throws(() => speechPrepareCommand('p', 'k', f.view, 'section', f.options, 'speech', 'cedar', ''));
  }
});
test('unrelated section edits keep exact speech review eligible', () => {
  const f = fixture(); f.view.snapshot.segments.push({ entry: { segmentId: 'other' }, script: { id: 'other-rev', text: 'Another section', textKind: 'draft', source: { kind: 'generated' } } });
  assert.equal(canReviewSpeech(f.detail, f.view), true);
});
test('speech status explains uncertain results and separate attachment', () => {
  assert.match(speechStatus('submission_unknown'), /not be repeated/); assert.match(speechStatus('succeeded'), /attach/); assert.match(speechStatus('ready'), /spending/);
});
