import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCreativePatch, parseChangeProposal, parseToolArguments, toolCatalog, toolHandlerId } from '../dist/index.js';

const prepare = creative => ({ variant: 'project', expectedHeadVersion: 0, creative });
const shot = { key: 'shot', sceneId: 'scene', purpose: 'Reveal the ferry', action: 'Passenger boards', framing: 'Wide', motion: 'Slow push', desiredFrames: 180, imagePrompt: 'Ferry ramp', videoPrompt: 'Passenger boards slowly', referenceArtifactIds: [], cueId: null };

test('V6 notes accept the exact confirm_video choice while V5 keeps its saved grammar', () => {
  const note = { anchor: { sceneId: 'scene' }, kind: 'recommendation', blocking: false, text: 'Confirm this scene for video.', choices: [{ kind: 'confirm_video', sceneId: 'scene' }, { kind: 'reply' }] };
  for (const anchor of [{ sceneId: 'scene' }, { shotIds: ['shot'] }]) {
    const input = { notes: [{ ...note, anchor }] };
    assert.deepEqual(parseToolArguments('record_notes', input, '6.0.0').arguments, input);
    assert.throws(() => parseToolArguments('record_notes', input, '5.0.0'), { code: 'VALIDATION_ERROR' });
  }
  for (const choice of [{ kind: 'confirm_video' }, { kind: 'confirm_video', sceneId: '' }, { kind: 'confirm_video', sceneId: 'scene', label: 'Confirm' }, { kind: 'confirm_video', shotIds: ['shot'] }])
    assert.throws(() => parseToolArguments('record_notes', { notes: [{ ...note, choices: [choice] }] }, '6.0.0'), { code: 'VALIDATION_ERROR' });
  const legacy = { notes: [{ ...note, choices: [{ kind: 'accept', label: 'Keep it' }, { kind: 'regenerate_keyframe', shotIds: ['shot'] }] }] };
  for (const version of ['5.0.0', '6.0.0']) assert.deepEqual(parseToolArguments('record_notes', legacy, version).arguments, legacy);
});

test('V6 proposes all creative shot fields and scene title independently of purpose', () => {
  const patch = { updateShots: [{ id: 'shot', purpose: 'Departure', action: 'Passenger turns', framing: 'Close-up', motion: 'Slow pan', desiredFrames: 240, imagePrompt: 'Passenger', videoPrompt: 'Passenger turns slowly', narration: { mode: 'none', text: '', voice: 'stock' } }], updateScenes: [{ id: 'scene', title: 'Last Ferry', purpose: 'Leave the harbor behind' }] };
  assert.deepEqual(parseToolArguments('propose_change', { patch }, '6.0.0').arguments, { patch });
  assert.deepEqual(parseToolArguments('propose_change', { patch: { updateScenes: [{ id: 'scene', title: 'Last Ferry' }] } }, '6.0.0').arguments.patch.updateScenes, [{ id: 'scene', title: 'Last Ferry' }]);
  assert.equal(toolHandlerId('6.0.0'), 'director-tools@6');
  assert.deepEqual(toolCatalog('6.0.0').names, [...toolCatalog('5.0.0').names, 'make_keyframes']);
  for (const row of [{ id: 'scene' }, { id: 'scene', title: null }]) assert.throws(() => parseToolArguments('propose_change', { patch: { updateScenes: [row] } }, '6.0.0'), { code: 'VALIDATION_ERROR' });
  assert.throws(() => parseToolArguments('propose_change', { patch: { updateShots: [{ id: 'shot', framing: 'Wide', reauthorPrompts: true }] } }, '6.0.0'), { code: 'VALIDATION_ERROR' });
});

test('V6 creative framing is a bounded one-to-three-word label for creates, updates and proposals', () => {
  for (const framing of ['Close-up', 'Medium', 'Wide', 'Extreme close up', 'x'.repeat(40)]) {
    for (const creative of [{ createShots: [{ ...shot, framing }] }, { updateShots: [{ id: 'shot', framing, reauthorPrompts: true }] }])
      assert.deepEqual(parseToolArguments('prepare_change', prepare(creative), '6.0.0').arguments, prepare(creative));
    assert.equal(parseToolArguments('propose_change', { patch: { updateShots: [{ id: 'shot', framing }] } }, '6.0.0').arguments.patch.updateShots[0].framing, framing);
  }
  for (const framing of ['', 'A long four words', 'x'.repeat(41), ' Wide', 'Wide ', 'Wide\nshot', 'Wide\n', 'Two  spaces']) {
    for (const creative of [{ createShots: [{ ...shot, framing }] }, { updateShots: [{ id: 'shot', framing }] }])
      assert.throws(() => parseToolArguments('prepare_change', prepare(creative), '6.0.0'), { code: 'VALIDATION_ERROR' });
    assert.throws(() => parseToolArguments('propose_change', { patch: { updateShots: [{ id: 'shot', framing }] } }, '6.0.0'), { code: 'VALIDATION_ERROR' });
  }
});

test('V6 scene titles are short names while purpose remains a full direction', () => {
  for (const title of ['Last Ferry', 'One two three four five six', 'x'.repeat(60)]) {
    for (const creative of [{ createScenes: [{ key: 'scene', title, purpose: 'A descriptive scene direction with coverage explained in story.' }] }, { updateScenes: [{ id: 'scene', title }] }, { updateScenes: [{ id: 'scene', title, purpose: 'Another direction' }] }])
      assert.deepEqual(parseToolArguments('prepare_change', prepare(creative), '6.0.0').arguments, prepare(creative));
  }
  assert.deepEqual(parseToolArguments('prepare_change', prepare({ createScenes: [{ key: 'scene', purpose: 'Historical optional title' }] }), '6.0.0').arguments.creative.createScenes[0], { key: 'scene', purpose: 'Historical optional title' });
  for (const title of ['', 'One two three four five six seven', 'x'.repeat(61), 'Name\nDirection', 'Name\n']) {
    assert.throws(() => parseToolArguments('prepare_change', prepare({ createScenes: [{ key: 'scene', title, purpose: 'Direction' }] }), '6.0.0'), { code: 'VALIDATION_ERROR' });
    assert.throws(() => parseToolArguments('propose_change', { patch: { updateScenes: [{ id: 'scene', title }] } }, '6.0.0'), { code: 'VALIDATION_ERROR' });
  }
  assert.throws(() => parseToolArguments('prepare_change', prepare({ updateScenes: [{ id: 'scene' }] }), '6.0.0'), { code: 'VALIDATION_ERROR' });
});

test('older tool epochs refuse all successor fields and preserve their original framing grammar', () => {
  for (const version of ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0']) {
    for (const creative of [{ createScenes: [{ key: 'scene', title: 'Ferry', purpose: 'Departure' }] }, { updateScenes: [{ id: 'scene', title: 'Ferry' }] }])
      assert.throws(() => parseToolArguments('prepare_change', prepare(creative), version), { code: 'VALIDATION_ERROR' });
    const creative = { updateShots: [{ id: 'shot', framing: 'A full descriptive framing sentence remains valid historically', reauthorPrompts: true }] };
    assert.deepEqual(parseToolArguments('prepare_change', prepare(creative), version).arguments, prepare(creative));
  }
  for (const field of ['purpose', 'action', 'framing']) assert.throws(() => parseToolArguments('propose_change', { patch: { updateShots: [{ id: 'shot', [field]: 'Wide' }] } }, '5.0.0'), { code: 'VALIDATION_ERROR' });
  assert.throws(() => parseToolArguments('propose_change', { patch: { updateScenes: [{ id: 'scene', title: 'Ferry' }] } }, '5.0.0'), { code: 'VALIDATION_ERROR' });
});

test('creative parser and application save independent scene titles without migrating old scenes', () => {
  const before = { id: 'film', brief: '', story: '', narration: { source: 'undecided', script: '' }, scenes: [{ id: 'old', revisionId: 'old-revision', purpose: 'Original direction' }], shots: [], cues: [], artifacts: [] };
  const original = structuredClone(before);
  const proposal = parseChangeProposal(prepare({ createScenes: [{ key: 'new', title: 'Last Ferry', purpose: 'Leave the harbor' }], updateScenes: [{ id: 'old', title: 'Harbor' }] }));
  const after = applyCreativePatch(before, proposal.creative, shot => shot);
  assert.deepEqual(before, original);
  assert.deepEqual(after.scenes.map(({ title, purpose }) => ({ title, purpose })), [{ title: 'Harbor', purpose: 'Original direction' }, { title: 'Last Ferry', purpose: 'Leave the harbor' }]);
  assert.notEqual(after.scenes[0].revisionId, before.scenes[0].revisionId);
  const changed = applyCreativePatch(after, parseChangeProposal(prepare({ updateScenes: [{ id: 'old', purpose: 'New direction' }] })).creative, shot => shot);
  assert.equal(changed.scenes[0].title, 'Harbor');
  assert.equal(changed.scenes[0].purpose, 'New direction');
  const undo = applyCreativePatch(after, parseChangeProposal(prepare({ updateScenes: [{ id: 'old', title: null }] })).creative, shot => shot);
  assert.equal(Object.hasOwn(undo.scenes[0], 'title'), false, 'internal undo restores an absent title exactly');
  assert.throws(() => parseToolArguments('prepare_change', prepare({ updateScenes: [{ id: 'old', title: null }] }), '6.0.0'), { code: 'VALIDATION_ERROR' });
});

test('internal creative parsing and inverse publication preserve long human scene titles while V6 still refuses to author them', () => {
  const title = 'A human scene title with many words and a detailed description '.repeat(10).trim();
  const before = { id: 'film', brief: '', story: '', narration: { source: 'undecided', script: '' }, scenes: [{ id: 'old', revisionId: 'old-revision', title, purpose: 'Original direction' }], shots: [], cues: [], artifacts: [] };
  const after = applyCreativePatch(before, parseChangeProposal(prepare({ updateScenes: [{ id: 'old', title: 'Last Ferry' }] })).creative, shot => shot);
  const inverse = prepare({ updateScenes: [{ id: 'old', title }] });
  const restored = applyCreativePatch(after, parseChangeProposal(inverse).creative, shot => shot);
  assert.equal(restored.scenes[0].title, title);
  assert.equal(restored.scenes[0].purpose, before.scenes[0].purpose);
  const create = prepare({ createScenes: [{ key: 'new', title, purpose: 'Saved human direction' }] });
  assert.equal(parseChangeProposal(create).creative.createScenes[0].title, title);
  for (const proposal of [inverse, create]) assert.throws(() => parseToolArguments('prepare_change', proposal, '6.0.0'), { code: 'VALIDATION_ERROR' });
  assert.throws(() => parseToolArguments('propose_change', { patch: inverse.creative }, '6.0.0'), { code: 'VALIDATION_ERROR' });
});
