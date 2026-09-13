import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOpenAITranscriptionOptions } from '../dist/index.js';

test('cheap transcription options use the existing exact model/language/timing contract', () => {
  for (const language of [null, 'en', 'zh']) assert.equal(validateOpenAITranscriptionOptions({ model: 'whisper-1', language, timing: 'word' }), undefined);
  for (const [patch, code] of [[{ model: 'gpt-4o-transcribe' }, 'UNSUPPORTED_MODEL'], [{ language: 'auto' }, 'INVALID_LANGUAGE'], [{ language: 'en-US' }, 'INVALID_LANGUAGE'], [{ timing: 'segment' }, 'UNSUPPORTED_TIMING']])
    assert.throws(() => validateOpenAITranscriptionOptions({ model: 'whisper-1', language: null, timing: 'word', ...patch }), { code });
});
test('cheap option validation rejects accessors, inherited fields and extras without invoking them', () => {
  let invoked = 0;
  for (const input of [{ model: 'whisper-1', language: null, get timing() { invoked++; return 'word'; } },
    Object.assign(Object.create({ timing: 'word' }), { model: 'whisper-1', language: null }), { model: 'whisper-1', language: null, timing: 'word', input: {} }, null])
    assert.throws(() => validateOpenAITranscriptionOptions(input));
  assert.equal(invoked, 0);
});
