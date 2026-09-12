import test from 'node:test';
import assert from 'node:assert/strict';
import { secondsToSamples, sampleSeconds, draftOf, preparationCurrent, narrationReviewState, narrationError, narrationTimingIssues } from '../src/narration-model.ts';

test('decimal timing round-trips exact 48 kHz samples without accumulating floating point drift', () => {
  for (const sample of [0, 1, 799, 800, 801, 1599, 1600, 1601, 288799, 333333, 17279999, 17280000]) assert.equal(secondsToSamples(sampleSeconds(sample)), sample);
  assert.equal(secondsToSamples('0.016667'), 800); assert.equal(secondsToSamples('360'), 17280000);
  for (const value of ['-1', '1e2', 'Infinity', '', '1,2', '0.1234567', '361', '01']) assert.throws(() => secondsToSamples(value));
});
test('a preview cannot be applied against a changed project, narration or session', () => {
  const prepared = { id: 'prepared', requestId: 'original-request', expectedHeadVersion: 4, expectedNarrationVersion: 12 }, view = { headVersion: 4, snapshot: { state: { version: 12 } }, session: { state: 'active', requestId: 'original-request' } };
  assert.equal(preparationCurrent(prepared, view), true);
  assert.equal(preparationCurrent(prepared, { ...view, headVersion: 5 }), false);
  assert.equal(preparationCurrent(prepared, { ...view, snapshot: { state: { version: 13 } } }), false);
  assert.equal(preparationCurrent(prepared, { ...view, session: { state: 'stale' } }), false);
  assert.equal(preparationCurrent(prepared, { ...view, session: { state: 'active', requestId: 'continued-request' } }), false, 'a new session cannot borrow an earlier request preview even when its versions match');
  assert.equal(preparationCurrent(null, view), false);
});
test('editable drafts exclude saved approval identities and do not mutate server state', () => {
  const saved = { ...draftOf(), id: 'saved', accepted: true, source: { kind: 'generated', voice: 'chosen', profileRevisionId: 'profile' } };
  const draft = draftOf(saved); draft.source.voice = 'different';
  assert.equal(saved.source.voice, 'chosen'); assert.equal('id' in draft, false); assert.equal('accepted' in draft, false);
  assert.deepEqual(draftOf().source, { kind: 'undecided' });
});

test('unsaved visible writing, timing or a retained new section blocks both review and applying an accepted preview', () => {
  const prepared = { id: 'prepared', requestId: 'request', expectedHeadVersion: 4, expectedNarrationVersion: 12 };
  const row = { entry: { segmentId: 'segment', atSample: 0 }, cue: { startSample: 0, endSample: 48000 }, accepted: { script: true, audio: true, timing: true } };
  const view = { headVersion: 4, snapshot: { state: { version: 12 }, segments: [row] }, session: { state: 'active', requestId: 'request' } };
  const clean = { writing: false, timing: false, newSection: draftOf() };
  assert.equal(narrationReviewState(view, prepared, clean).canApply, true);
  for (const edits of [{ ...clean, writing: true }, { ...clean, timing: true }, { ...clean, newSection: { ...draftOf(), text: 'Unsaved section, even after closing its form' } }, { ...clean, newSection: { ...draftOf(), source: { kind: 'uploaded' } } }]) {
    const state = narrationReviewState(view, prepared, edits);
    assert.equal(state.savedReady, true, 'saved acceptances are still valid');
    assert.equal(state.unsavedChanges, true); assert.equal(state.canReview, false); assert.equal(state.canApply, false);
  }
  assert.equal(narrationReviewState(view, prepared, clean).canReview, true, 'explicit revert can restore eligibility without throwing away the frozen preview');
  assert.equal(narrationReviewState(view, prepared, clean).canApply, true);
  const savedEdit = { ...view, snapshot: { ...view.snapshot, state: { version: 13 }, segments: [{ ...row, accepted: { ...row.accepted, script: false } }] } };
  assert.equal(narrationReviewState(savedEdit, prepared, clean).canApply, false, 'saving changed writing still needs fresh acceptance and preparation');
});
test('errors explain human recovery and preserve unknown error context', () => {
  assert.match(narrationError('NARRATION_SESSION_STALE', ''), /explicitly continue/);
  assert.match(narrationError('REVISION_CONFLICT', ''), /typed text is still here/);
  assert.equal(narrationError('OTHER', 'Preserve this explanation'), 'Preserve this explanation');
});


test('overlapping, sub-frame and over-limit saved cues are explained before canonical review', () => {
  const row = (atSample, startSample, endSample) => ({ entry: { atSample }, cue: { startSample, endSample } });
  assert.deepEqual(narrationTimingIssues([row(0, 48000, 96000), row(48000, 0, 48000)]), []);
  assert.match(narrationTimingIssues([row(0, 0, 48000), row(0, 0, 48000)])[0], /Section 2 begins before/);
  assert.match(narrationTimingIssues([row(0, 0, 799)])[0], /video frame/);
  assert.match(narrationTimingIssues([row(17280000, 0, 48000)])[0], /six-minute/);
});
