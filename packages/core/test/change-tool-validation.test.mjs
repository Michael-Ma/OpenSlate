import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToolArguments } from '../dist/index.js';

function failure(tool, input, version = '5.0.0') {
  let refusal;
  assert.throws(() => parseToolArguments(tool, input, version), error => {
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.match(error.message, new RegExp(`^${tool} arguments are invalid: `));
    refusal = error.message;
    return true;
  });
  return refusal;
}

test('proposal unsupported fields identify the containing path and exact registered alternatives', () => {
  const message = failure('propose_change', { patch: { updateShots: [{ id: 'private-shot-id', motion: 'private motion', reauthorPrompts: true, 'private/key~field': 'private value' }] } });
  assert.match(message, /\/patch\/updateShots\/0 has unsupported fields; allowed fields: id, desiredFrames, motion, imagePrompt, videoPrompt, narration/);
  assert.doesNotMatch(message, /private|reauthorPrompts/);
  const nested = failure('propose_change', { patch: { updateShots: [{ id: 'private-shot-id', narration: { mode: 'generated', text: 'private writing', voice: 'stock', 'private narrator': 'private value' } }] } });
  assert.match(nested, /\/patch\/updateShots\/0\/narration has unsupported fields; allowed fields: mode, text, voice/);
  assert.doesNotMatch(nested, /private/);
});

test('proposal required, type, enum and range errors carry paths and registered allowed fields', () => {
  const message = failure('propose_change', { patch: { updateShots: [{ desiredFrames: -1, motion: 123, narration: { mode: 'private mode', voice: 'private voice' } }] } });
  assert.match(message, /\/patch\/updateShots\/0\/id is required; allowed fields: id, desiredFrames, motion, imagePrompt, videoPrompt, narration/);
  assert.match(message, /\/patch\/updateShots\/0\/desiredFrames must be at least 1; allowed fields:/);
  assert.match(message, /\/patch\/updateShots\/0\/motion must be string; allowed fields:/);
  assert.match(message, /\/patch\/updateShots\/0\/narration\/mode must be one of: undecided, none, generated, uploaded; allowed fields: mode, text, voice/);
  assert.doesNotMatch(message, /private|123/);
});

test('preparation diagnostics use the locked grammar for nested fields and never echo values', () => {
  const input = { variant: 'project', expectedHeadVersion: 3, creative: { updateShots: [{ id: 'private-shot', motion: 'private motion', 'private/field': 'private prompt' }] } };
  const message = failure('prepare_change', input);
  assert.match(message, /\/creative\/updateShots\/0 has unsupported fields; allowed fields: id, purpose, action, framing, motion, desiredFrames, imagePrompt, videoPrompt, narration, reauthorPrompts/);
  assert.doesNotMatch(message, /private/);
  const legacy = failure('prepare_change', input, '1.0.0');
  assert.match(legacy, /allowed fields: id, purpose, action, framing, motion, desiredFrames, imagePrompt, videoPrompt, reauthorPrompts/);
  assert.doesNotMatch(legacy, /narration|private/);
});

test('preparation root and nested required and value constraints stay correctable', () => {
  const message = failure('prepare_change', { variant: 'private variant', creative: { updateShots: [{ id: 'private shot', desiredFrames: 10801, narration: { mode: 'none', voice: 'stock' } }] } });
  assert.match(message, /\/expectedHeadVersion is required; allowed fields: variant, expectedHeadVersion/);
  assert.match(message, /\/variant must be one of: workflow, project, plan; allowed fields:/);
  assert.match(message, /\/creative\/updateShots\/0\/desiredFrames must be at most 10800; allowed fields:/);
  assert.match(message, /\/creative\/updateShots\/0\/narration\/text is required; allowed fields: mode, text, voice/);
  assert.doesNotMatch(message, /private/);
});

test('change-tool diagnostics stay bounded and disclose only registered paths', () => {
  for (const tool of ['propose_change', 'prepare_change']) {
    const updates = Array.from({ length: 400 }, () => ({ id: 'private-shot', desiredFrames: -1, motion: 'private value', 'private/key~field': 'private value' }));
    const input = tool === 'propose_change' ? { patch: { updateShots: updates } } : { variant: 'project', expectedHeadVersion: 0, creative: { updateShots: updates } };
    const message = failure(tool, input);
    assert.ok(message.length <= 1800, `${tool} diagnostic was ${message.length} characters`);
    assert.match(message, /additional validation errors/);
    assert.doesNotMatch(message, /private/);
  }
});
