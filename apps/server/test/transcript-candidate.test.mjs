import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../../../packages/core/dist/index.js';
import { parseOpenAITranscriptionResponse } from '../../../packages/providers/dist/index.js';
import { createTranscriptCandidate, assertTranscriptCandidate, assertTranscriptCandidateIngestion, resolveTranscriptionSpoolLineage,
  transcriptArtifactId, transcriptCandidateId, TRANSCRIPT_CANDIDATE_LIMITS } from '../dist/execution/transcript-candidate.js';
import { transcriptionFixture, context, raw } from './transcription-execution-fixture.mjs';
import { compactTranscriptionExecutionResult } from '../dist/execution/transcription-execution-receipts.js';
let f, lineage, parsed, candidate, output;
const cleanup = [];
after(async () => { for (const close of cleanup) await close(); });
before(async () => {
  f = await transcriptionFixture({ after: fn => cleanup.push(fn) }); const completed = await f.bridge.submit(f.request, context(f)); assert.equal(completed.type, 'completed'); output = completed.outputs[0];
  lineage = resolveTranscriptionSpoolLineage(f.store, f.attempt, completed.receiptId);
  parsed = parseOpenAITranscriptionResponse({ bytes: raw, mimeType: 'application/json', sourceDurationSeconds: 1 }); candidate = createTranscriptCandidate(lineage, parsed);
});
const changed = edit => { const copy = structuredClone(candidate); edit(copy); return copy; };
const ingestion = value => ({ type: 'transcript_candidate', candidate: value,
  artifact: { id: value.artifactId, projectId: value.projectId, attemptId: value.attemptId,
    artifact: { artifactId: value.artifactId, kind: 'data', sha256: value.raw.sha256 }, path: `${f.artifactRoot}/${value.projectId}/${value.raw.sha256}.json`,
    mimeType: 'application/json', fixture: false, origin: 'transcription_response', physicalDurationSeconds: null,
    byteLength: value.raw.byteLength, outputReceiptId: value.raw.receiptId, outputSpoolId: value.raw.spoolId, transcriptCandidateId: value.id } });

test('candidate stores one mapped word array with independent raw, provider and candidate identities', () => {
  assert.equal(candidate.id, transcriptCandidateId(f.project.id, f.attempt.id, lineage.spool.id));
  assert.equal(candidate.artifactId, transcriptArtifactId(f.project.id, f.attempt.id, lineage.spool.id));
  assert.notEqual(candidate.id, candidate.artifactId); assert.notEqual(candidate.resultDigest, candidate.raw.sha256);
  assert.equal(candidate.resultDigest, parsed.result.resultDigest); assert.equal(candidate.status, 'unreviewed');
  assert.deepEqual(candidate.projection.words, parsed.result.words.map(word => ({ ...word, startSample: Math.floor(word.startSeconds * 48000 + .5), endSample: Math.floor(word.endSeconds * 48000 + .5) })));
  assert.equal(candidate.words, undefined); assert.equal(candidate.projection.timingIssues, undefined); assert.equal(candidate.rawResponseBytes, undefined);
  assert.deepEqual(createTranscriptCandidate(lineage, parsed), candidate); assertTranscriptCandidate(lineage, JSON.parse(JSON.stringify(candidate))); assertTranscriptCandidateIngestion(lineage, output, ingestion(candidate));
  assert.equal(f.store.list('transcript_candidate', f.project.id).length, 0, 'pure creation has no SQL publication or narration side effects');
});

test('every identity and transcript component is recomputed, not trusted from the candidate digest', () => {
  for (const edit of [v => { v.id = 'f'.repeat(64); }, v => { v.projectId = 'foreign'; }, v => { v.attemptId = 'foreign'; },
    v => { v.raw.spoolId = 'f'.repeat(64); }, v => { v.raw.receiptId = 'f'.repeat(64); }, v => { v.raw.sha256 = 'f'.repeat(64); },
    v => { v.mappingDigest = 'f'.repeat(64); }, v => { v.preparation.receiptDigest = 'f'.repeat(64); }, v => { v.source.endSample--; },
    v => { v.parser.version = 2; }, v => { v.status = 'accepted'; }, v => { v.projection.text = 'Changed'; },
    v => { v.projection.words[0].word = 'Changed'; }, v => { v.projection.words[0].startSeconds += .001; },
    v => { v.projection.reportedLanguage = 'french'; }, v => { v.projection.reportedModel = 'invented'; }, v => { v.projection.usage.seconds++; },
    v => { v.projection.parserIssues.push({ code: 'text_word_mismatch', wordIndex: null }); }, v => { v.resultDigest = digest(v.projection); }])
    assert.throws(() => assertTranscriptCandidate(lineage, changed(edit)));
});

test('sample coordinates, issue order and mapping policy cannot be repaired or replaced', () => {
  for (const edit of [v => { v.projection.words[0].startSample++; }, v => { v.projection.words.reverse(); }, v => { v.projection.words[0].startSample = null; },
    v => { v.projection.sampleIssues.push({ code: 'source_range_exceeded', wordIndex: 0 }); }, v => { v.projection.samplePolicy = 'floor-at-16k'; },
    v => { v.projection.words[0].confidence = .99; }]) assert.throws(() => assertTranscriptCandidate(lineage, changed(edit)));
});

test('creator rejects altered actual raw bytes and contradictions between parsed output and compact observation', () => {
  const bad = structuredClone(parsed); bad.result.rawResponseBytes[0] ^= 1; assert.throws(() => createTranscriptCandidate(lineage, bad));
  const wrongView = structuredClone(parsed); wrongView.result.rawResponseBytes = new Uint16Array(2); assert.throws(() => createTranscriptCandidate(lineage, wrongView));
  for (const key of ['reportedLanguage', 'reportedDurationSeconds', 'wordCount', 'textBytes', 'timingIssueCount']) {
    const changed = structuredClone(lineage); changed.result.observation.result[key] = typeof changed.result.observation.result[key] === 'string' ? 'wrong' : 999;
    const next = structuredClone(candidate); next.resultRecordDigest = digest(changed.result);
    assert.throws(() => assertTranscriptCandidate(changed, next), key);
  }
});

test('pure projection preserves no-speech, huge seconds, source-end rounding and original order', () => {
  // Synthetic lineage snapshots isolate projection policy; physical/admission checks are exercised separately.
  for (const body of [{ text: '', language: 'english', duration: 1, words: [] },
    { text: 'a b c', language: 'english', duration: 1, words: [{ word: 'a', start: 1 / 96000, end: .9 },
      { word: 'b', start: .4, end: 1 + .1 / 48000 }, { word: 'c', start: 1e300, end: 1e300 }] }]) {
    const value = parseOpenAITranscriptionResponse({ bytes: Buffer.from(JSON.stringify(body)), mimeType: 'application/json', sourceDurationSeconds: 1 });
    const selected = structuredClone(lineage); selected.result.observation.reportedModel = value.reportedModel;
    selected.result.observation.result = compactTranscriptionExecutionResult(value.result); selected.spool.sha256 = value.result.rawResponseSha256; selected.spool.byteLength = value.result.rawResponseBytes.byteLength;
    const result = createTranscriptCandidate(selected, value); assert.equal(result.projection.words.length, body.words.length);
    if (body.words.length) {
      assert.equal(result.projection.words[0].startSample, 1); assert.equal(result.projection.words[1].endSample, 48000);
      assert.equal(result.projection.words[2].startSample, null); assert.equal(result.projection.words[2].startSeconds, 1e300);
      assert.ok(result.projection.sampleIssues.some(issue => issue.wordIndex === 1 && issue.code === 'source_range_exceeded'));
      assert.ok(result.projection.sampleIssues.some(issue => issue.code === 'unsafe_sample_coordinate'));
    }
  }
});

test('derivative-duration parser identity is distinct from the original 48k sample endpoint', () => {
  const bytes = Buffer.from(JSON.stringify({ text: 'end', language: 'english', duration: 1, words: [{ word: 'end', start: .9, end: 1 }] }));
  const value = parseOpenAITranscriptionResponse({ bytes, mimeType: 'application/json', sourceDurationSeconds: 1 });
  const wrongDuration = parseOpenAITranscriptionResponse({ bytes, mimeType: 'application/json', sourceDurationSeconds: 47999 / 48000 });
  assert.notEqual(value.result.resultDigest, wrongDuration.result.resultDigest);
  const selected = structuredClone(lineage); selected.preparation.intent.sourceEndSample = 47999; selected.mapping.source.endSample = 47999;
  selected.result.observation.reportedModel = value.reportedModel; selected.result.observation.result = compactTranscriptionExecutionResult(value.result);
  selected.spool.sha256 = value.result.rawResponseSha256; selected.spool.byteLength = bytes.length;
  const result = createTranscriptCandidate(selected, value);
  assert.equal(result.projection.parserIssues.length, 0); assert.ok(result.projection.sampleIssues.some(issue => issue.code === 'source_range_exceeded'));
  assert.equal(result.projection.words[0].endSample, 48000, 'never clamp to original endpoint');
  assert.throws(() => createTranscriptCandidate(selected, wrongDuration));
});

test('candidate data bounds and own-data validation reject malformed graphs without invoking accessors', () => {
  assert.equal(TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes, 12 * 1024 ** 2); let called = 0;
  const accessor = changed(() => {}); Object.defineProperty(accessor.projection.words[0], 'word', { get() { called++; return 'Leather'; } });
  const cyclic = changed(() => {}); cyclic.projection.extra = cyclic;
  const malformed = [null, accessor, cyclic, changed(v => { v.projection.words = Array(8193).fill(v.projection.words[0]); }),
    changed(v => { v.projection.text = 'a'.repeat(TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes + 1); }),
    changed(v => { v.projection.words = new Array(2); }), changed(v => { v.projection.sampleIssues = Array(65537).fill(null); })];
  for (const value of malformed) assert.throws(() => assertTranscriptCandidate(lineage, value)); assert.equal(called, 0);
});

test('tagged publication cannot substitute raw artifact metadata, candidate backlink or extra fields', () => {
  for (const edit of [v => { v.artifact.artifact.sha256 = 'f'.repeat(64); }, v => { v.artifact.transcriptCandidateId = 'foreign'; },
    v => { v.artifact.origin = 'generated_audio'; }, v => { v.artifact.outputReceiptId = 'foreign'; }, v => { v.artifact.physicalDurationSeconds = 1; },
    v => { v.artifact.projectId = 'foreign'; }, v => { v.artifact.fixture = true; }, v => { v.artifact.arbitrary = true; }]) {
    const value = ingestion(candidate); edit(value); assert.throws(() => assertTranscriptCandidateIngestion(lineage, output, value));
  }
  const forged = { ...output, storage: { type: 'spool', spoolId: 'f'.repeat(64) } }; assert.throws(() => assertTranscriptCandidateIngestion(lineage, forged, ingestion(candidate)));
});

test('lineage resolver requires exact actual approval, source, dispatch and observed winning slot', () => {
  assert.deepEqual(resolveTranscriptionSpoolLineage(f.store, f.attempt, lineage.spool.id), lineage);
  const reader = transform => ({ db: f.store.db, getProject: f.store.getProject.bind(f.store), get: (kind, id) => transform(kind, id, f.store.get(kind, id)) });
  for (const missing of ['transcription_execution_mapping', 'transcription_execution_dispatch', 'transcription_execution_result', 'transcription_audio_intent', 'transcription_audio_receipt',
    'external_allowance_consumption', 'external_allowance', 'grant', 'candidate', 'reservation', 'execution_output_receipt', 'execution_output_spool', 'execution_output_slot', 'narration_audio'])
    assert.throws(() => resolveTranscriptionSpoolLineage(reader((kind, _id, value) => kind === missing ? undefined : value), f.attempt, lineage.spool.id), missing);
  assert.throws(() => resolveTranscriptionSpoolLineage(reader((kind, _id, value) => kind === 'execution_output_slot' ? { ...value, spoolId: 'f'.repeat(64) } : value), f.attempt, lineage.spool.id));
  assert.throws(() => resolveTranscriptionSpoolLineage(f.store, { ...f.attempt, request: { ...f.request, execution: { adapter: 'fake', version: '1' } } }, lineage.spool.id));
  assert.throws(() => resolveTranscriptionSpoolLineage(f.store, f.attempt, 'f'.repeat(64)));
});
