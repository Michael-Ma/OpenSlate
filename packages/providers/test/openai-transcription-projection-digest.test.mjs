import test from 'node:test';
import assert from 'node:assert/strict';
import { digestOpenAITranscriptionProjection, parseOpenAITranscriptionResponse } from '../dist/index.js';
const parse = input => parseOpenAITranscriptionResponse({ bytes: Buffer.from(JSON.stringify(input)), mimeType: 'application/json', sourceDurationSeconds: 1 });
const base = { text: 'Hello world.', language: 'english', duration: 1, words: [{ word: 'Hello', start: .1, end: .4 }, { word: 'world.', start: .5, end: .9 }] };
const project = result => ({ text: result.text, reportedLanguage: result.reportedLanguage, reportedDurationSeconds: result.reportedDurationSeconds, words: result.words, timingIssues: result.timingIssues, usage: result.usage });

test('projection digest preserves exact existing decoder identity and survives JSON key reordering', () => {
  for (const input of [base, { ...base, text: '', words: [] }, { ...base, usage: { type: 'duration', seconds: 1 }, words: [{ word: 'Hello', start: 1e300, end: 1e300 }] }]) {
    const { result } = parse(input), projection = project(result);
    assert.equal(digestOpenAITranscriptionProjection(projection), result.resultDigest);
    const reordered = Object.fromEntries(Object.entries(projection).reverse());
    reordered.words = projection.words.map(word => Object.fromEntries(Object.entries(word).reverse()));
    reordered.timingIssues = projection.timingIssues.map(issue => Object.fromEntries(Object.entries(issue).reverse()));
    assert.equal(digestOpenAITranscriptionProjection(reordered), result.resultDigest);
  }
});
test('projection semantic fields change the digest while reported vendor model stays outside it', () => {
  const a = parse(base), b = parse({ ...base, model: 'unknown-model' });
  assert.equal(a.result.resultDigest, b.result.resultDigest);
  const value = project(a.result);
  for (const edit of [v => { v.text += '!'; }, v => { v.words[0].startSeconds += .01; }, v => { v.reportedLanguage = 'Chinese'; },
    v => { v.reportedDurationSeconds = 2; }, v => { v.usage = { type: 'duration', seconds: 1 }; }, v => { v.timingIssues.push({ code: 'text_word_mismatch', wordIndex: null }); }]) {
    const changed = structuredClone(value); edit(changed); assert.notEqual(digestOpenAITranscriptionProjection(changed), a.result.resultDigest);
  }
});
test('projection helper rejects malformed, accessor, sparse and oversized data without calling user code', () => {
  let invoked = 0; const value = project(parse(base).result), invalid = [];
  invalid.push({ ...value, get text() { invoked++; return ''; } });
  invalid.push({ ...value, words: [{ word: 'x', get startSeconds() { invoked++; return 0; }, endSeconds: 1 }] });
  const sparse = new Array(1); invalid.push({ ...value, words: sparse });
  const array = [{ word: 'x', startSeconds: 0, endSeconds: 1 }]; Object.defineProperty(array, '0', { get() { invoked++; return null; } }); invalid.push({ ...value, words: array });
  invalid.push({ ...value, timingIssues: [{ code: { toString() { invoked++; return 'word_overlap'; } }, wordIndex: 0 }] });
  invalid.push({ ...value, words: [{ word: 'x'.repeat(1025), startSeconds: 0, endSeconds: 1 }] });
  invalid.push({ ...value, words: Array(8193).fill(value.words[0]) });
  invalid.push({ ...value, usage: { type: 'duration', seconds: Infinity } });
  invalid.push({ ...value, text: 'a'.repeat(262145) }); invalid.push({ ...value, rawResponseBytes: Buffer.from('{}') });
  invalid.push({ ...value, timingIssues: [{ code: 'word_overlap', wordIndex: 2 }] });
  invalid.push({ ...value, words: [{ word: 'x', startSeconds: 2, endSeconds: 1 }] }); invalid.push(null);
  for (const input of invalid) assert.throws(() => digestOpenAITranscriptionProjection(input));
  assert.equal(invoked, 0);
});
