import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToolArguments, toolCatalog } from '@openslate/core';
import { seven } from './helpers/contract-seven-fixture.mjs';

const code = async (promise) => { try { await promise; } catch (error) { return error.code; } assert.fail('expected a refusal'); };
const okJson = async (response) => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
const resolve = (f, noteId, choiceIndex) => f.call('POST', `/director/notes/${noteId}/resolve`, { choiceIndex, expectedVersion: f.store.get('director_note', noteId).version });
const look = (styleId, label, extra = {}) => ({ styleId, libraryVersion: '8.0.0', label,
  traits: { palette: 'natural neutrals', lighting: 'flat fluorescent', lensFormat: '28mm phone-like lens', texture: 'fine digital noise', composition: 'centred subject, middle band', productionDesign: 'generic supermarket' },
  imageBlock: `${label}: natural neutrals, flat fluorescent light, 28mm lens.`, motionBlock: 'Live action, 30 fps video feel.',
  motion: { cameraGrammar: 'locked-off or slow push', frameRateFeel: '30fps-video', motionScale: 'subtle' },
  negatives: ['clean blank screens'], anchors: { referenceArtifactIds: [], characterSheets: [] }, variationAxes: ['timeOfDay'], rationale: `${label} fits a relatable skit.`, ...extra });
const options = [
  { tier: 'safe', fits: 'Real-looking world makes the absurd goose hit harder.', risk: 'Models drift to a glossy look.', style: look('grounded-realism', 'Grounded realism') },
  { tier: 'distinct', fits: 'Phone-footage feel reads as native.', risk: 'Handheld drift can blur the stare.', style: look('documentary-handheld', 'Phone footage') },
  { tier: 'bold', fits: 'Cartoon physics licenses the gag.', risk: 'Faces vary between shots.', cost: 'Usually needs more keyframe takes.', style: look('stylized-3d-feature', 'Stylized 3D') },
];

test('propose_visual_style is a 7.0.0 tool only; the 6.0.0 catalog is unchanged', () => {
  assert.ok(toolCatalog('7.0.0').names.includes('propose_visual_style'));
  assert.ok(!toolCatalog('6.0.0').names.includes('propose_visual_style'));
  assert.doesNotThrow(() => parseToolArguments('propose_visual_style', { options: options.slice(0, 2) }, '7.0.0'));
  for (const bad of [{ options: options.slice(0, 1) }, { options: [...options, options[0]] }, { options: [{ ...options[0], tier: 'wild' }, options[1]] },
    { options: [{ ...options[0], style: { ...options[0].style, revisionId: 'x' } }, options[1]] }])
    assert.throws(() => parseToolArguments('propose_visual_style', bad, '7.0.0'));
});

test('a style card saves nothing until the person chooses; the choice saves that full look with Undo', async t => {
  const f = seven(t), turn = f.openTurn({ editing: false, text: 'Suggest some looks.' }), before = f.saved();
  const card = await turn.call('propose_visual_style', { options });
  assert.equal(card.state, 'awaiting_choice'); assert.equal(card.applied, false);
  assert.deepEqual(f.saved(), before, 'the card changes nothing');
  const note = f.store.get('director_note', card.noteId);
  // The note matches docs/ai/ui-v8/contracts.md: one accept per option in order with the option label, then reply.
  assert.deepEqual(note.anchor, {});
  assert.deepEqual(note.choices, [...options.map(o => ({ kind: 'accept', label: o.style.label })), { kind: 'reply' }]);
  assert.deepEqual(note.styleProposal, { options: options.map(o => ({ styleId: o.style.styleId, label: o.style.label, fits: o.fits, risk: o.risk, ...(o.cost ? { cost: o.cost } : {}), tier: o.tier })) });
  assert.equal(JSON.stringify(note).includes('imageBlock'), false, 'the browser view carries no full style');
  // Editing the film does not stale a whole-film style card.
  await okJson(await f.call('POST', '/storyboard', { expectedHeadVersion: f.head(), kind: 'shot', id: 'shot-0', field: 'action', value: 'A new action' }));
  // The person picks the third look (choice index 3 is the reply, so index 2 is the last option).
  const resolved = await okJson(await resolve(f, card.noteId, 2));
  assert.equal(resolved.state, 'resolved');
  const saved = f.saved().visualStyle;
  assert.equal(saved.styleId, 'stylized-3d-feature'); assert.equal(saved.imageBlock, options[2].style.imageBlock); assert.ok(saved.revisionId);
  assert.equal(f.store.list('director_style_proposal', f.project.id).length, 1);
  // The choice is the person's own storyboard command: one Undo removes the look again.
  const commandId = f.store.get('director_note', card.noteId).resolution.resultRef;
  await okJson(await f.call('POST', '/storyboard', { expectedHeadVersion: f.head(), kind: 'undo', commandId }));
  assert.equal(f.saved().visualStyle, undefined);
  assert.equal((await resolve(f, card.noteId, 0)).json().error.code, 'NOTE_ALREADY_SETTLED');
  // A later card names the current look.
  await okJson(await resolve(f, (await f.openTurn().call('propose_visual_style', { options: options.slice(0, 2) })).noteId, 0));
  const next = await f.openTurn().call('propose_visual_style', { text: 'Two other looks.', options: options.slice(1) });
  assert.equal(f.store.get('director_note', next.noteId).styleProposal.currentStyleId, 'grounded-realism');
  assert.equal(f.store.get('director_note', next.noteId).text, 'Two other looks.');
});

test('style card refusals: duplicate looks, unknown anchors, and the person cannot send a look directly', async t => {
  const f = seven(t), before = f.saved();
  assert.equal(await code(f.openTurn().call('propose_visual_style', { options: [options[0], { ...options[1], style: { ...options[1].style, label: options[0].style.label } }] })), 'VALIDATION_ERROR');
  assert.equal(await code(f.openTurn().call('propose_visual_style', { options: [options[0], { ...options[1], style: look('x', 'X', { anchors: { referenceArtifactIds: ['missing'], characterSheets: [] } }) }] })), 'SCOPE_DENIED');
  assert.equal(f.store.list('director_note', f.project.id).length, 0);
  const direct = await f.call('POST', '/storyboard', { expectedHeadVersion: f.head(), kind: 'visualStyle', style: options[0].style });
  assert.equal(direct.statusCode, 400, 'the internal style command is not an HTTP storyboard command');
  assert.deepEqual(f.saved(), before);
});
