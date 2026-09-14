import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTranscriptionProposals, canReviewTranscription, transcriptionBlockReason, transcriptionExecutionNotice, transcriptionExecutionText, transcriptionPrepareCommand, transcriptionReviewCommand, transcriptionTarget } from '../src/owned-transcription-model.ts';
import { narrationContinuation } from '../src/narration-model.ts';
import { pendingCommandsFor } from '../src/pending-command.ts';

const audio = () => ({ id: 'recording', sourceRecordDigest: 'a'.repeat(64), declaredOrigin: 'uploaded', media: { artifactId: 'recording', sha256: 'b'.repeat(64) } });
const row = () => ({ entry: { segmentId: 'section', audioId: 'recording' }, script: { id: 'writing-v2' }, audio: audio() });
const view = () => ({ headVersion: 4, revisionId: 'revision4', session: { id: 'session', requestId: 'request', state: 'active' }, snapshot: { state: { version: 12 }, segments: [] } });
const options = () => ({ version: 1, profiles: [{ id: 'whisper-profile', model: 'whisper-1' }], languages: ['auto', 'en'], timing: 'word', capabilities: { implemented: true, configured: true, audioTools: true, providerReadiness: 'check_project_provider_settings', directorToolAvailable: false } });
const detail = () => ({ proposal: { id: 'proposal', proposalDigest: 'c'.repeat(64), target: { kind: 'recording' }, baseProject: { headVersion: 4, revisionId: 'revision4' } }, eligibility: { current: true, code: null }, application: null, execution: { state: 'not_applied', generationCandidateId: null } });

test('independent uploaded recording can be proposed without section, narration version or acceptance', () => {
  const state = view(), recording = audio(), before = structuredClone({ state, recording });
  const command = transcriptionPrepareCommand('project', 'prepare-key', state, recording, options(), 'whisper-profile', 'auto');
  assert.deepEqual(command.body, { sessionId: 'session', expectedHeadVersion: 4, audioId: 'recording', sourceRecordDigest: 'a'.repeat(64), profileId: 'whisper-profile', language: 'auto', target: { kind: 'recording' } });
  assert.equal(command.path, '/api/projects/project/narration/transcription-proposals');
  assert.equal(command.key, 'prepare-key'); assert.deepEqual({ state, recording }, before);
  for (const forbidden of ['expectedVersion', 'accepted', 'grantId', 'allowanceId', 'candidateId', 'sourcePath']) assert.equal(forbidden in command.body, false);
});

test('section targeting pins the selected saved revision and exact audio identity, never equal bytes alone', () => {
  const recording = audio(), section = row();
  assert.deepEqual(transcriptionTarget(recording, section), { kind: 'section', segmentId: 'section', segmentRevisionId: 'writing-v2', audioId: 'recording' });
  assert.throws(() => transcriptionTarget(recording, { ...section, audio: { ...recording, id: 'other' } }), /exact recording/);
  assert.throws(() => transcriptionTarget(recording, { ...section, entry: { ...section.entry, audioId: null } }), /exact recording/);
  assert.throws(() => transcriptionTarget(recording, { ...section, audio: null }), /exact recording/);
});

test('artifact-only generated listing cannot be mistaken for an owned narration source', () => {
  const generated = { ...audio(), originEvidence: 'verified_generated_audio', sourceRecordDigest: undefined };
  assert.throws(() => transcriptionPrepareCommand('project', 'key', view(), generated, options(), 'whisper-profile', 'auto'), /Attach/);
  for (const sourceRecordDigest of ['wrong', 'A'.repeat(64)]) assert.throws(() => transcriptionPrepareCommand('project', 'key', view(), { ...generated, sourceRecordDigest }, options(), 'whisper-profile', 'auto'));
  generated.sourceRecordDigest = 'd'.repeat(64);
  assert.equal(transcriptionPrepareCommand('project', 'key', view(), generated, options(), 'whisper-profile', 'auto').body.sourceRecordDigest, 'd'.repeat(64));
});

test('preparation needs current session, saved model, supported language and configured local tools', () => {
  for (const state of [{ ...view(), session: null }, { ...view(), session: { ...view().session, state: 'stale' } }]) assert.throws(() => transcriptionPrepareCommand('project', 'key', state, audio(), options(), 'whisper-profile', 'auto'));
  for (const field of ['implemented', 'configured', 'audioTools']) {
    const choice = options(); choice.capabilities[field] = false;
    assert.throws(() => transcriptionPrepareCommand('project', 'key', view(), audio(), choice, 'whisper-profile', 'auto'));
  }
  assert.throws(() => transcriptionPrepareCommand('project', 'key', view(), audio(), options(), 'unsaved', 'auto'));
  assert.throws(() => transcriptionPrepareCommand('project', 'key', view(), audio(), options(), 'whisper-profile', 'invented'));
  // A browser action does not require a director tool and does not infer paid permission from readiness.
  assert.equal(transcriptionPrepareCommand('project', 'key', view(), audio(), options(), 'whisper-profile', 'en').body.language, 'en');
});

test('human review binds exact proposal and current session, with no automatic spending or source rewrite', () => {
  const command = transcriptionReviewCommand('project', 'review-key', view(), detail());
  assert.deepEqual(command.body, { sessionId: 'session', proposalId: 'proposal', proposalDigest: 'c'.repeat(64) });
  assert.equal(command.path, '/api/projects/project/narration/transcription-reviews');
  for (const patch of [{ application: { candidateId: 'already-applied' } }, { eligibility: { current: false, code: 'REVISION_CONFLICT' } }, { eligibility: { current: true, code: 'RESTORED_AUTHORITY_REQUIRES_NEW' } }]) assert.equal(canReviewTranscription({ ...detail(), ...patch }, view()), false);
  for (const patch of [{ headVersion: 5 }, { revisionId: 'different-same-head' }, { session: null }, { session: { ...view().session, state: 'stale' } }]) assert.equal(canReviewTranscription(detail(), { ...view(), ...patch }), false);
  assert.throws(() => transcriptionReviewCommand('project', 'key', view(), { ...detail(), proposal: { ...detail().proposal, proposalDigest: 'invalid' } }));
});

test('transcription lost reply shares the narration pending slot and survives remount without replacing its exact review', async () => {
  const api = {}, registry = pendingCommandsFor(api, 'narration'), command = transcriptionReviewCommand('project', 'review-key', view(), detail());
  await registry.run('project', command, async () => { throw Error('lost reply'); }, () => true);
  command.body.proposalDigest = 'mutated'; command.body.sessionId = 'new-session';
  const remount = pendingCommandsFor(api, 'narration'), saved = remount.snapshot('project').command;
  assert.equal(saved.body.proposalDigest, 'c'.repeat(64)); assert.equal(saved.body.sessionId, 'session');
  assert.equal(await remount.run('project', { path: '/audio', key: 'other-edit' }, async () => assert.fail('no parallel narration edit'), () => false), false);
  await remount.run('project', saved, async input => { assert.equal(input.key, 'review-key'); return { receipt: { candidateId: 'generation-candidate', proposalId: 'proposal' } }; }, () => false);
  assert.equal(remount.snapshot('project').result.receipt.candidateId, 'generation-candidate');
  assert.equal(remount.snapshot('other-project').command, null);
});

test('failed or pending eligibility refresh cannot reuse a formerly current detail to approve', () => {
  for (const verification of [{ checking: true, failed: false }, { checking: false, failed: true }]) {
    assert.equal(canReviewTranscription(detail(), view(), verification), false);
    assert.throws(() => transcriptionReviewCommand('project', 'key', view(), detail(), verification), /fresh review/);
  }
  assert.equal(canReviewTranscription(detail(), view(), { checking: false, failed: false }), true);
});

test('a known section edit or audio replacement disables approval even when project head has not changed', () => {
  const saved = detail(), state = view(); saved.proposal.target = transcriptionTarget(audio(), row()); state.snapshot.segments = [row()];
  assert.equal(canReviewTranscription(saved, state), true);
  for (const section of [{ ...row(), script: { id: 'new-writing' } }, { ...row(), audio: { ...audio(), id: 'same-byte-replacement' } }, { ...row(), entry: { segmentId: 'section', audioId: null } }]) {
    const changed = { ...state, snapshot: { ...state.snapshot, segments: [section] } };
    assert.equal(changed.headVersion, state.headVersion); assert.equal(canReviewTranscription(saved, changed), false);
  }
  assert.equal(canReviewTranscription(saved, view()), false);
});

test('preparation lost reply preserves source, independent target and original head across later project changes', async () => {
  const api = {}, registry = pendingCommandsFor(api, 'narration'), state = view(), recording = audio();
  const command = transcriptionPrepareCommand('project', 'key', state, recording, options(), 'whisper-profile', 'auto');
  await registry.run('project', command, async () => { throw Error('lost'); }, () => true);
  recording.id = 'replacement'; recording.sourceRecordDigest = 'f'.repeat(64); state.headVersion++;
  const saved = pendingCommandsFor(api, 'narration').snapshot('project').command;
  assert.equal(saved.body.expectedHeadVersion, 4); assert.equal(saved.body.audioId, 'recording'); assert.equal(saved.body.sourceRecordDigest, 'a'.repeat(64)); assert.deepEqual(saved.body.target, { kind: 'recording' });
});

test('proposal pages preserve unavailable rows and refuse a changed inventory or skipped offset', () => {
  const first = { proposals: [{ id: 'one', proposal: null, unavailableCode: 'PROPOSAL_UNAVAILABLE' }], coverage: { offset: 0, scanned: 20, total: 21, nextOffset: 20, dataDigest: 'inventory', readBytes: 100 } };
  const next = { proposals: [{ id: 'two', proposal: detail().proposal, unavailableCode: null }], coverage: { offset: 20, scanned: 1, total: 21, nextOffset: null, dataDigest: 'inventory', readBytes: 50 } };
  const merged = appendTranscriptionProposals(first, next); assert.equal(merged.proposals.length, 2); assert.equal(merged.coverage.readBytes, 150); assert.equal(merged.coverage.scanned, 21); assert.equal(first.proposals.length, 1);
  for (const coverage of [{ ...next.coverage, dataDigest: 'new' }, { ...next.coverage, offset: 19 }]) assert.throws(() => appendTranscriptionProposals(first, { ...next, coverage }), /Refresh/);
});

test('continuation names only the displayed request and separately acknowledges a saved session', () => {
  const state = { ...view(), session: { ...view().session, state: 'stale' }, continuationRequest: { id: 'current-project-request', text: 'Continue boots' } };
  assert.deepEqual(narrationContinuation(state), { continuationSessionId: 'session', continuationRequestId: 'current-project-request' });
  assert.deepEqual(narrationContinuation({ ...state, continuationRequest: null }), { continuationSessionId: 'session' });
  assert.deepEqual(narrationContinuation({ ...state, session: null }), { continuationRequestId: 'current-project-request' });
  assert.deepEqual(narrationContinuation({ ...state, session: null, continuationRequest: null }), {});
  assert.throws(() => narrationContinuation(view()), /already active/);
});

test('progress distinguishes local waiting from uncertain paid response and transcript adoption', () => {
  assert.match(transcriptionExecutionText('preparing'), /local audio preparation/);
  assert.match(transcriptionExecutionText('submission_unknown'), /existing request/);
  assert.match(transcriptionExecutionText('ready'), /spending/);
  assert.match(transcriptionExecutionText('succeeded'), /review/);
  assert.doesNotMatch(transcriptionExecutionText('succeeded'), /accepted|adopted/);
  assert.match(transcriptionBlockReason('RESTORED_AUTHORITY_REQUIRES_NEW'), /new transcription plan/);
});

test('first-dispatch blockers stay visible alongside ready or preparing, while observed historical outcomes remain intact', () => {
  for (const state of ['ready', 'preparing']) {
    for (const [code, text] of [['EXECUTION_PAUSED', /execution is paused/], ['EXECUTION_HELD', /editing request/],
      ['INSTALLATION_QUARANTINED', /recovery is reviewed/], ['RESTORED_AUTHORITY_REQUIRES_NEW', /restored history/]]) {
      const notice = transcriptionExecutionNotice({ state, code });
      assert.equal(notice.status, transcriptionExecutionText(state)); assert.match(notice.blocker, text);
    }
  }
  const obsolete = transcriptionExecutionNotice({ state: 'unavailable', code: 'SUBMISSION_PREPARATION_OBSOLETE' });
  assert.match(obsolete.blocker, /no longer matches/);
  for (const state of ['submission_unknown', 'ingesting', 'succeeded', 'failed']) {
    const notice = transcriptionExecutionNotice({ state, code: null });
    assert.equal(notice.status, transcriptionExecutionText(state)); assert.equal(notice.blocker, null);
  }
});
