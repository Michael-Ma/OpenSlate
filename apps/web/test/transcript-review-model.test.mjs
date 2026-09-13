import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTranscriptCandidates, transcriptActionNotice, transcriptIssueText, transcriptPreviewMatches, transcriptSelectionFields } from '../src/transcript-review-model.ts';
import { pendingCommandsFor } from '../src/pending-command.ts';

const candidate = { id: 'candidate', candidateDigest: 'a'.repeat(64), audioId: 'recording', wordCount: 2 };
const row = { entry: { segmentId: 'section' }, script: { id: 'writing-v4' }, audio: { id: 'recording' } };
const preview = () => ({ candidateId: candidate.id, candidateDigest: candidate.candidateDigest, audioId: 'recording', startWordIndex: 0, endWordIndex: 2,
  policy: 'trim-join-ascii-space-v1', text: 'Leather boots.', selectedTextDigest: 'b'.repeat(64), writing: { allowed: true, code: null },
  timing: { allowed: false, startSample: null, endSample: null, issues: [{ source: 'parser', code: 'word_outside_source', wordIndex: 1 }], issueCoverage: { returned: 1, total: 1 } }, warnings: [] });

test('recognized words remain usable when suggested timing is flagged, with exact current section identity only', () => {
  const p = preview(), before = structuredClone(p), fields = transcriptSelectionFields(row, p, 'words');
  assert.deepEqual(fields, { segmentId: 'section', segmentRevisionId: 'writing-v4', audioId: 'recording', candidateId: 'candidate', candidateDigest: 'a'.repeat(64), startWordIndex: 0, endWordIndex: 2, selectedTextDigest: 'b'.repeat(64) });
  assert.throws(() => transcriptSelectionFields(row, p, 'timing'), /valid selection/);
  assert.deepEqual(p, before); assert.equal('accepted' in fields, false); assert.equal('startSample' in fields, false);
  p.timing.allowed = true; p.writing.allowed = false;
  assert.deepEqual(transcriptSelectionFields(row, p, 'timing'), fields);
  assert.throws(() => transcriptSelectionFields(row, p, 'words'));
  assert.throws(() => transcriptSelectionFields({ ...row, audio: { id: 'new-recording' } }, p, 'timing'));
  assert.throws(() => transcriptSelectionFields({ ...row, audio: null }, p, 'timing'));
});

test('a late preview for a different candidate, digest, audio or selected range cannot enable adoption', () => {
  const p = preview(); assert.equal(transcriptPreviewMatches(p, candidate, 'recording', 0, 2), true);
  for (const patch of [{ candidateId: 'other' }, { candidateDigest: 'f'.repeat(64) }, { audioId: 'other' }, { startWordIndex: 1 }, { endWordIndex: 1 }]) {
    assert.equal(transcriptPreviewMatches({ ...p, ...patch }, candidate, 'recording', 0, 2), false);
  }
  assert.equal(transcriptPreviewMatches(null, candidate, 'recording', 0, 2), false);
  assert.equal(transcriptPreviewMatches(p, undefined, 'recording', 0, 2), false);
});

test('paged transcript inventory cannot combine another recording, changed inventory or skipped page', () => {
  const first = { audioId: 'recording', candidates: [candidate], coverage: { offset: 0, scanned: 20, total: 22, nextOffset: 20, dataDigest: 'inventory' } };
  const second = { audioId: 'recording', candidates: [{ ...candidate, id: 'older' }], coverage: { offset: 20, scanned: 2, total: 22, nextOffset: null, dataDigest: 'inventory' } };
  const result = appendTranscriptCandidates(first, second);
  assert.equal(result.candidates.length, 2); assert.equal(result.coverage.scanned, 22); assert.equal(first.candidates.length, 1);
  for (const value of [{ ...second, audioId: 'other' }, { ...second, coverage: { ...second.coverage, dataDigest: 'changed' } }, { ...second, coverage: { ...second.coverage, offset: 21 } }]) assert.throws(() => appendTranscriptCandidates(first, value), /Refresh/);
});

test('lost transcript replies retain the original reviewed body across remount and report no-op against its original version', async () => {
  const api = {}, registry = pendingCommandsFor(api, 'narration'), body = { sessionId: 'session', expectedVersion: 12, ...transcriptSelectionFields(row, preview(), 'words') };
  const command = { path: '/api/projects/project/narration/transcript-words', key: 'original-key', body, metadata: { effect: { kind: 'transcript_words', segmentId: 'section' } } };
  await registry.run('project', command, async () => { throw Error('reply lost'); }, () => true);
  body.expectedVersion = 99; body.candidateDigest = 'changed'; row.script.id = 'writing-v5';
  const remount = pendingCommandsFor(api, 'narration'), pending = remount.snapshot('project').command;
  assert.equal(pending.body.expectedVersion, 12); assert.equal(pending.body.segmentRevisionId, 'writing-v4'); assert.equal(pending.body.candidateDigest, candidate.candidateDigest);
  assert.equal(await remount.run('project', { ...command, key: 'new' }, async () => assert.fail('must not replace retry'), () => false), false);
  await remount.run('project', pending, async saved => { assert.equal(saved.key, 'original-key'); return { state: { version: 12 } }; }, () => false);
  const settled = remount.snapshot('project');
  assert.match(transcriptActionNotice('words', settled.settledCommand.body.expectedVersion, settled.result.state.version), /already matches/);
  assert.match(transcriptActionNotice('words', 12, 13), /script, recording and timing separately/);
  assert.match(transcriptActionNotice('timing', 12, 13), /timing separately/);
  row.script.id = 'writing-v4';
});

test('timing warnings have readable explanations and unknown issues remain blocking advice', () => {
  assert.match(transcriptIssueText('source_range_exceeded'), /beyond the recording/);
  assert.match(transcriptIssueText('text_word_mismatch'), /full text differs/);
  assert.match(transcriptIssueText('unrecognized'), /enter timing manually/);
});
