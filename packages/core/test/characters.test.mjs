import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PROFILES, composeScenePlan, shotIntentDigest,
  CHARACTER_LIMITS, assertCharacterPlan, bindCharacterReferences, characterAppearances, characterContinuityIssues,
  characterDirection, characterSheetPrompt, characterSheetPromptDigest, charactersNeedingSheets, wardrobeFor, withCharacterDirection,
} from '../dist/index.js';

const sha = c => c.repeat(64);
const sheet = (artifactId, c = 'a') => ({ artifactId, sha256: sha(c), promptDigest: sha('d'), approvedAt: '2026-10-28T10:00:00.000Z' });
function plan() {
  return {
    scenes: [{ id: 'office', revisionId: 'r', purpose: 'Ticket office at closing' }, { id: 'harbour', revisionId: 'r', purpose: 'Dawn harbour' }],
    characters: [
      { id: 'mara', revisionId: 'r', name: 'Mara', identity: 'Woman in her thirties, short black hair, freckles, slim build.',
        baseOutfit: 'grey wool coat', sheet: sheet('sheet-mara'),
        wardrobe: [{ sceneId: 'office', outfit: 'rain-dark trench coat over a navy jumper' }, { sceneId: 'harbour', outfit: 'yellow oilskin jacket and rubber boots', notes: 'hair wet' }] },
      { id: 'clerk', revisionId: 'r', name: 'Clerk', identity: 'Old man, white beard, round glasses.', sheet: null,
        wardrobe: [{ sceneId: 'office', outfit: 'brown cardigan and sleeve garters' }] },
    ],
    shots: [
      { id: 's1', sceneId: 'office', imagePrompt: 'Mara at the counter, rain-dark trench coat over a navy jumper.', referenceArtifactIds: ['sheet-mara'], characterIds: ['mara', 'clerk'] },
      { id: 's2', sceneId: 'office', imagePrompt: 'The clerk stamps the ticket.', referenceArtifactIds: [], characterIds: ['clerk'] },
      { id: 's3', sceneId: 'harbour', imagePrompt: 'Mara on the pier in a rain-dark trench coat over a navy jumper.', referenceArtifactIds: ['upload-1'], characterIds: ['mara'] },
      { id: 's4', sceneId: 'harbour', imagePrompt: 'Empty harbour.', referenceArtifactIds: [] },
    ],
  };
}

test('wardrobe resolves per scene, falls back to the base outfit and reports unplanned scenes as null', () => {
  const [mara, clerk] = plan().characters;
  assert.equal(wardrobeFor(mara, 'harbour').outfit, 'yellow oilskin jacket and rubber boots');
  assert.equal(wardrobeFor(mara, 'harbour').fallback, false);
  assert.deepEqual(wardrobeFor({ ...mara, wardrobe: [] }, 'harbour'), { sceneId: 'harbour', outfit: 'grey wool coat', fallback: true });
  assert.equal(wardrobeFor(clerk, 'harbour'), null);
});

test('appearances count shots; only characters seen more than once need a sheet', () => {
  const p = plan();
  assert.deepEqual(characterAppearances(p).get('mara'), { shotIds: ['s1', 's3'], sceneIds: ['office', 'harbour'] });
  assert.deepEqual(charactersNeedingSheets(p).map(c => c.id), ['mara', 'clerk']);
  p.shots[1].characterIds = [];
  assert.deepEqual(charactersNeedingSheets(p).map(c => c.id), ['mara']);
});

test('plan validation rejects unknown scenes, duplicate outfits, duplicate names, unknown casting and loose sheets', () => {
  assert.doesNotThrow(() => assertCharacterPlan(plan()));
  assert.doesNotThrow(() => assertCharacterPlan({ scenes: [], shots: [] }));
  const cases = [
    [p => { p.characters[0].wardrobe[0].sceneId = 'gone'; }, /unknown scene/],
    [p => { p.characters[0].wardrobe[1].sceneId = 'office'; }, /two outfits/],
    [p => { p.characters[1].name = ' mara '; }, /Two characters/],
    [p => { p.shots[0].characterIds = ['ghost']; }, /unknown character/],
    [p => { p.shots[0].characterIds = ['mara', 'mara']; }, /once/],
    [p => { p.characters[0].sheet = { artifactId: 'x', sha256: 'nope', promptDigest: sha('d'), approvedAt: 'now' }; }, /exact approved image/],
    [p => { p.characters[0].wardrobe[0].outfit = 'x'.repeat(CHARACTER_LIMITS.outfit + 1); }, /Outfit/],
    [p => { p.characters[1].identity = ''; }, /identity/],
  ];
  for (const [mutate, message] of cases) { const p = plan(); mutate(p); assert.throws(() => assertCharacterPlan(p), message); }
});

test('the sheet prompt asks for four labelled views of one person in a neutral outfit and is stable', () => {
  const [mara, clerk] = plan().characters;
  const prompt = characterSheetPrompt(mara, { aspect: '3:2', style: 'painterly, muted palette' });
  for (const part of ['full-body front view', 'full-body side view', 'full-body back view', 'face close-up', 'Landscape 3:2', 'grey wool coat', 'short black hair', 'Rendering style: painterly'])
    assert.ok(prompt.includes(part), part);
  assert.ok(!prompt.includes('oilskin'), 'a scene outfit never leaks into the identity sheet');
  assert.match(characterSheetPrompt(clerk), /Square canvas[\s\S]*neutral grey clothes/);
  assert.equal(characterSheetPromptDigest(prompt), characterSheetPromptDigest(characterSheetPrompt(mara, { aspect: '3:2', style: 'painterly, muted palette' })));
  assert.notEqual(characterSheetPromptDigest(prompt), characterSheetPromptDigest(characterSheetPrompt(mara)));
});

test('binding puts approved sheets first in casting order, keeps other references and drops retired sheets', () => {
  const p = plan();
  p.characters[1].sheet = sheet('sheet-clerk', 'b');
  const shot = { ...p.shots[0], referenceArtifactIds: ['upload-1', 'sheet-mara-old', 'sheet-mara'] };
  const binding = bindCharacterReferences(p, shot, ['sheet-mara-old']);
  assert.deepEqual(binding.referenceArtifactIds, ['sheet-mara', 'sheet-clerk', 'upload-1']);
  assert.deepEqual(binding.bound, [{ characterId: 'mara', reference: 1 }, { characterId: 'clerk', reference: 2 }]);
  assert.deepEqual(binding.unbound, []);
  assert.equal(binding.overLimit, false);
  const crowded = bindCharacterReferences(p, { ...shot, referenceArtifactIds: Array.from({ length: 8 }, (_, i) => `ref-${i}`) });
  assert.equal(crowded.referenceArtifactIds.length, CHARACTER_LIMITS.referencesPerShot);
  assert.equal(crowded.overLimit, true);
  assert.deepEqual(bindCharacterReferences(plan(), plan().shots[1]).unbound, ['clerk']);
});

test('character direction names the reference, identity and this scene\'s outfit and replaces itself idempotently', () => {
  const p = plan(), shot = p.shots[2];
  const block = characterDirection(p, shot);
  assert.match(block, /Mara \(reference image 1 is their character sheet/);
  assert.match(block, /Wearing in this scene: yellow oilskin jacket and rubber boots \(hair wet\)\./);
  assert.ok(!block.includes('trench'));
  const once = withCharacterDirection(shot.imagePrompt, block);
  assert.equal(withCharacterDirection(once, block), once);
  assert.ok(once.startsWith('Mara on the pier'));
  assert.equal(withCharacterDirection(once, ''), shot.imagePrompt);
  assert.match(characterDirection(p, p.shots[1]), /- Clerk: Old man[^\n]*Wearing in this scene: brown cardigan/);
  assert.ok(!characterDirection(p, p.shots[1]).includes('reference image'), 'no reference is claimed without an approved sheet');
  assert.equal(characterDirection(p, p.shots[3]), '');
  assert.equal(withCharacterDirection('  Uncast prompt.\n', ''), '  Uncast prompt.\n', 'an uncast prompt is left byte-identical');
});

test('continuity checks report missing sheets and wardrobe, unbound or stale sheets and copied outfits', () => {
  const p = plan();
  p.characters[1].wardrobe = [];
  p.shots.push({ id: 's5', sceneId: 'harbour', imagePrompt: 'x', referenceArtifactIds: ['sheet-old'], characterIds: ['ghost'] });
  const issues = characterContinuityIssues(p, ['sheet-old']).map(i => [i.code, i.severity, i.characterId ?? null, i.shotId ?? i.sceneId ?? null]);
  assert.deepEqual(issues, [
    ['WARDROBE_MISSING', 'blocking', 'clerk', 'office'],
    ['SHEET_REQUIRED', 'blocking', 'clerk', null],
    ['SHEET_NOT_BOUND', 'blocking', 'mara', 's3'],
    ['WARDROBE_PROMPT_MISMATCH', 'warning', 'mara', 's3'],
    ['UNKNOWN_CHARACTER', 'blocking', 'ghost', 's5'],
    ['SHEET_STALE_BINDING', 'blocking', null, 's5'],
  ]);
  const uniform = plan();
  uniform.characters[0].wardrobe = uniform.characters[0].wardrobe.map(w => ({ ...w, outfit: 'Grey wool coat' }));
  assert.ok(characterContinuityIssues(uniform).some(i => i.code === 'WARDROBE_UNIFORM' && i.severity === 'info'));
});

test('a bound sheet reaches the keyframe image node as its first reference input with the character block in the prompt', () => {
  const p = plan(), sheetRef = { artifactId: 'sheet-mara', kind: 'image', sha256: sha('a') };
  const shot = { id: 's3', revisionId: 'r', sceneId: 'harbour', purpose: 'Mara waits', action: 'Mara on the pier', framing: 'Wide', motion: 'Static',
    desiredFrames: 150, imagePrompt: 'Mara on the pier at dawn.', videoPrompt: 'Fog drifts.', referenceArtifactIds: [], cueId: null, characterIds: ['mara'],
    narration: { mode: 'none', text: '', voice: 'stock' }, promptIntent: {} };
  const binding = bindCharacterReferences(p, shot);
  shot.referenceArtifactIds = binding.referenceArtifactIds;
  shot.imagePrompt = withCharacterDirection(shot.imagePrompt, characterDirection(p, shot, binding));
  shot.promptIntent = { image: shotIntentDigest(shot, 'image'), video: shotIntentDigest(shot, 'video') };
  const project = { id: 'project', revisionId: 'revision-1', headVersion: 1, name: 'Film', brief: '', story: '', scenes: p.scenes, characters: p.characters,
    narration: { script: '', source: 'undecided' }, maxFrames: 10800, capabilityLockId: 'lock', shots: [shot], cues: [], artifacts: [sheetRef], activePlanId: null };
  const result = composeScenePlan(null, [{ shotId: 's3', kind: 'image', profileId: 'fake-image-v1' }],
    { project, profiles: structuredClone(DEFAULT_PROFILES), logicalIds: {}, allocateId: randomUUID });
  const image = result.nodes.find(n => n.kind === 'image' && n.shotId === 's3');
  assert.deepEqual(image.inputs.map(i => [i.role, i.order, i.source.artifact.artifactId]), [['reference', 0, 'sheet-mara']]);
  assert.match(image.args.prompt, /reference image 1 is their character sheet[\s\S]*yellow oilskin/);
  assert.equal(image.intentDigest, shot.promptIntent.image);
});
