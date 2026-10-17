import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToolArguments, toolCatalog } from '../dist/index.js';

const note = () => ({
  anchor: { shotIds: ['shot-0'] }, kind: 'observation', blocking: false,
  text: '[redacted observation]',
  seenKeyframe: { shotId: 'shot-0', artifactId: 'artifact-0', sha256: 'a'.repeat(64) },
  choices: [{ kind: 'accept', label: 'Keep' }, { kind: 'reply' }],
});
function failure(input) {
  assert.throws(() => parseToolArguments('record_notes', input, '5.0.0'), error => {
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.match(error.message, /^record_notes arguments are invalid: /);
    return true;
  });
  try { parseToolArguments('record_notes', input, '5.0.0'); } catch (error) { return error.message; }
  assert.fail('Expected record_notes validation failure');
}

test('redacted LIVE-3 singular shot anchor returns a correctable field reason', () => {
  const notes = [note(), note()];
  for (const entry of notes) entry.anchor = { shotId: 'shot-0' };
  const reason = failure({ notes });
  assert.match(reason, /\/notes\/0\/anchor must include sceneId or shotIds \(an array of shot IDs\)/);
  assert.match(reason, /\/notes\/1\/anchor must include sceneId or shotIds/);
  assert.match(reason, /\/notes\/0\/anchor has unsupported fields; allowed fields: sceneId, shotIds/);
  assert.doesNotMatch(reason, /redacted observation|artifact-0|shot-0/);
});

test('note validation exposes only a stable safe reason for localized failure notices', () => {
  for (const anchor of [{ shotId: 'shot-0' }, null, { shotIds: [] }, { shotIds: ['shot-0', 'shot-0'] }]) {
    assert.throws(() => parseToolArguments('record_notes', { notes: [{ ...note(), anchor }] }, '5.0.0'), {
      code: 'VALIDATION_ERROR', details: { reason: 'invalid_anchor' },
    });
  }
  for (const input of [{ notes: [] }, { notes: [{ ...note(), text: '' }] }]) {
    assert.throws(() => parseToolArguments('record_notes', input, '5.0.0'), {
      code: 'VALIDATION_ERROR', details: { reason: 'invalid_arguments' },
    });
  }
});

test('corrected LIVE-3 notes and every registered choice remain accepted without rewriting', () => {
  const notes = [note(), { ...note(), anchor: { sceneId: 'scene-0' }, choices: [
    { kind: 'proposal', proposalId: 'proposal-0' },
    { kind: 'regenerate_keyframe', shotIds: ['shot-0'] },
    { kind: 'edit_field', shotId: 'shot-0', field: 'imagePrompt' },
  ] }];
  const input = { notes };
  const parsed = parseToolArguments('record_notes', input, '5.0.0');
  assert.deepEqual(parsed.arguments, input);
  assert.notEqual(parsed.arguments, input);
});

test('note field errors describe required values, types and registered limits', () => {
  const entry = note();
  delete entry.text;
  entry.blocking = 'private supplied value';
  entry.seenKeyframe.sha256 = 'private supplied hash';
  entry.anchor.shotIds = [];
  const reason = failure({ notes: [entry] });
  assert.match(reason, /\/notes\/0\/text is required/);
  assert.match(reason, /\/notes\/0\/blocking must be boolean/);
  assert.match(reason, /\/notes\/0\/seenKeyframe\/sha256 must be a 64-character lowercase hexadecimal SHA-256/);
  assert.match(reason, /\/notes\/0\/anchor\/shotIds must contain at least 1 item/);
  assert.doesNotMatch(reason, /private supplied/);
  assert.match(failure({ notes: Array.from({ length: 7 }, note) }), /\/notes must contain at most 6 items/);
  assert.match(failure({ notes: [{ ...note(), text: 'x'.repeat(601) }] }), /\/notes\/0\/text must contain at most 600 characters/);
});

test('choice diagnostics report the selected variant and omit irrelevant alternatives', () => {
  const missingLabel = failure({ notes: [{ ...note(), choices: [{ kind: 'accept' }] }] });
  assert.match(missingLabel, /\/notes\/0\/choices\/0\/label is required/);
  assert.doesNotMatch(missingLabel, /proposalId|shotIds|\/field|must equal/);
  const wrongField = failure({ notes: [{ ...note(), choices: [{ kind: 'edit_field', shotId: 'shot-0', field: 'private field' }] }] });
  assert.match(wrongField, /\/notes\/0\/choices\/0\/field must be one of: narration, imagePrompt, motion/);
  assert.doesNotMatch(wrongField, /private field|proposalId|\/label/);
  const wrongKind = failure({ notes: [{ ...note(), choices: [{ kind: 'private choice' }] }] });
  assert.match(wrongKind, /\/notes\/0\/choices\/0\/kind must be one of: accept, proposal, regenerate_keyframe, edit_field, reply/);
  assert.doesNotMatch(wrongKind, /private choice|proposalId|\/label/);
});

test('diagnostics never echo extra property names or user text and remain bounded', () => {
  const entry = { ...note(), kind: 'private kind', text: 'private note '.repeat(100) };
  entry.anchor['private/key~name'] = 'private value';
  entry.choices = [{ kind: 'reply', 'private/key~name': 'private value' }];
  const reason = failure({ notes: Array.from({ length: 6 }, () => entry), 'private root': true });
  assert.doesNotMatch(reason, /private/);
  assert.ok(reason.length <= 1800, `diagnostic was ${reason.length} characters`);
  assert.match(reason, /additional validation errors/);
});

test('non-note tool errors and registered V5 input schema are unchanged', () => {
  assert.throws(() => parseToolArguments('propose_change', { patch: {} }, '5.0.0'), {
    code: 'VALIDATION_ERROR', message: 'Tool arguments do not match the registered schema',
  });
  const schema = toolCatalog('5.0.0').descriptors.find(tool => tool.name === 'record_notes').inputSchema;
  assert.deepEqual(Object.keys(schema.properties.notes.items.properties.anchor.properties), ['sceneId', 'shotIds']);
  assert.equal(schema.properties.notes.maxItems, 6);
  assert.equal(schema.properties.notes.items.properties.text.maxLength, 600);
});
