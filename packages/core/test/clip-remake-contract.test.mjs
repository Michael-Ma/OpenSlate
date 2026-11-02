import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_TOOL_CONTRACT, parseToolArguments, toolCatalog, toolHandlerId } from '../dist/index.js';

const notes = shotIds => ({ notes: [{ anchor: { sceneId: 'scene' }, kind: 'recommendation', blocking: false,
  text: 'Remake the named clips from these approved frames.', choices: [{ kind: 'remake_clip', shotIds }] }] });

test('7.1.0 adds bounded distinct remake_clip choices without altering the shipped 7.0.0 catalog', () => {
  assert.equal(CURRENT_TOOL_CONTRACT, '7.1.0');
  assert.equal(toolCatalog('7.0.0').digest, 'e99bf5bd4b04cff07732a2997fb25fe0e052b8efbc893514a307ec163871dc92');
  assert.equal(toolHandlerId('7.0.0'), 'director-tools@7');
  assert.equal(toolHandlerId('7.1.0'), 'director-tools@7.1');
  assert.deepEqual(toolCatalog('7.1.0').names, toolCatalog('7.0.0').names);
  for (const shotIds of [['shot-0'], ['shot-0', 'shot-1', 'shot-2', 'shot-3']]) {
    const input = notes(shotIds);
    assert.deepEqual(parseToolArguments('record_notes', input, '7.1.0').arguments, input);
    assert.throws(() => parseToolArguments('record_notes', input, '7.0.0'), { code: 'VALIDATION_ERROR' });
  }
  for (const shotIds of [[], ['shot', 'shot'], ['a', 'b', 'c', 'd', 'e'], [''], [1]])
    assert.throws(() => parseToolArguments('record_notes', notes(shotIds), '7.1.0'), { code: 'VALIDATION_ERROR' });
  for (const name of ['record_notes', 'make_keyframes']) {
    const text = toolCatalog('7.1.0').descriptors.find(tool => tool.name === name).description;
    assert.match(text, /confirm_video.*clips still to make/);
    assert.match(text, /remake_clip/);
    assert.match(text, /regenerate_keyframe.*new frame|new frames.*regenerate_keyframe/);
    assert.match(text, /human press/);
  }
});
