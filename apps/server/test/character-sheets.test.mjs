import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
import { projectAssets } from '../dist/asset-library.js';
import { recordCharacterSheetTake, characterSheetTakes, retiredSheetArtifactIds, isApprovedSheet } from '../dist/character-sheets.js';
import { characterSheetQuote } from '../dist/generation-quotes.js';
import { characterSheetPrompt, characterSheetPromptDigest } from '../../../packages/core/dist/index.js';

const token = 'character-sheet-test-token-123456789';
const png = (id, projectId, c, extra = {}) => ({ id, projectId, artifact: { artifactId: id, kind: 'image', sha256: c.repeat(64) }, path: '/private/never-listed.png',
  mimeType: 'image/png', fixture: false, attemptId: null, physicalDurationSeconds: null, byteLength: 1000, width: 1024, height: 1024, ...extra });
function cast(f) {
  const p = f.store.getProject(f.projectId);
  p.characters = [{ id: 'mara', revisionId: 'r1', name: 'Mara', identity: 'Short black hair, freckles.', baseOutfit: 'grey coat', sheet: null,
    wardrobe: p.scenes.map(scene => ({ sceneId: scene.id, outfit: `outfit for ${scene.id}` })) }];
  p.shots.forEach(shot => { shot.characterIds = ['mara']; });
  f.store.saveProject(p, p.headVersion);
  return f.store.getProject(f.projectId);
}

test('sheet takes record exact PNGs of an existing character and stay immutable history', t => {
  const f = setup(t, { imagesOnly: true });
  const p = cast(f), prompt = characterSheetPrompt(p.characters[0]);
  f.store.insert('artifact', 'sheet-1', p.id, png('sheet-1', p.id, 'a'));
  f.store.insert('artifact', 'not-png', p.id, png('not-png', p.id, 'b', { mimeType: 'image/jpeg' }));
  const take = recordCharacterSheetTake(f.store, { id: 'take-1', projectId: p.id, characterId: 'mara', artifact: { artifactId: 'sheet-1', kind: 'image', sha256: 'a'.repeat(64) }, prompt, attemptId: null });
  assert.equal(take.promptDigest, characterSheetPromptDigest(prompt));
  assert.deepEqual(characterSheetTakes(f.store, p.id).map(x => x.id), ['take-1']);
  const base = { projectId: p.id, characterId: 'mara', artifact: { artifactId: 'sheet-1', kind: 'image', sha256: 'a'.repeat(64) }, prompt, attemptId: null };
  assert.throws(() => recordCharacterSheetTake(f.store, { ...base, id: 'take-1' }), /already exists/);
  assert.throws(() => recordCharacterSheetTake(f.store, { ...base, id: 'take-2', characterId: 'ghost' }), /unknown character/);
  assert.throws(() => recordCharacterSheetTake(f.store, { ...base, id: 'take-3', artifact: { ...base.artifact, sha256: 'c'.repeat(64) } }), /exact PNG/);
  assert.throws(() => recordCharacterSheetTake(f.store, { ...base, id: 'take-4', artifact: { artifactId: 'not-png', kind: 'image', sha256: 'b'.repeat(64) } }), /exact PNG/);
  assert.throws(() => recordCharacterSheetTake(f.store, { ...base, id: 'take-5', prompt: ' ' }), /prompt/);
});

test('the asset library lists sheets per character with take numbers and marks only the approved one in use', async t => {
  const f = setup(t, { imagesOnly: true });
  const service = new ProductionService(f.store, f.engine), app = createApp({ service, localToken: token, logger: false }); t.after(() => app.close());
  let p = cast(f);
  const prompt = characterSheetPrompt(p.characters[0]);
  for (const [id, c] of [['sheet-1', 'a'], ['sheet-2', 'b']]) {
    f.store.insert('artifact', id, p.id, png(id, p.id, c));
    recordCharacterSheetTake(f.store, { id: `take-${id}`, projectId: p.id, characterId: 'mara', artifact: { artifactId: id, kind: 'image', sha256: c.repeat(64) }, prompt, attemptId: null });
  }
  p.characters[0].sheet = { artifactId: 'sheet-2', sha256: 'b'.repeat(64), promptDigest: characterSheetPromptDigest(prompt), approvedAt: new Date().toISOString() };
  f.store.saveProject(p, p.headVersion); p = f.store.getProject(p.id);
  const sheets = projectAssets(service, p).filter(item => item.role === 'character_sheet');
  assert.deepEqual(sheets.map(x => [x.artifact.artifactId, x.takeIndex, x.current, x.characterId, x.label, x.source, x.shotId ?? null]),
    [['sheet-2', 2, true, 'mara', 'Mara', 'imported', null], ['sheet-1', 1, false, 'mara', 'Mara', 'imported', null]]);
  const takes = characterSheetTakes(f.store, p.id);
  assert.deepEqual(retiredSheetArtifactIds(p, takes), ['sheet-1']);
  assert.deepEqual(takes.map(take => isApprovedSheet(p, take)), [false, true]);
  const response = await app.inject({ url: `/api/projects/${p.id}/assets?role=character_sheet`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().total, 2);
  assert.doesNotMatch(response.body, /private|never-listed/);
  assert.equal(f.engine.attempts(p.id).length, 0, 'listing sheets starts no work');
});

test('a sheet quote uses the pinned image profile: Codex is the $0 subscription, metered profiles multiply, unpriced is unknown', () => {
  const codex = { id: 'codex', kind: 'image', adapter: 'codex-image', unitCostMicros: '0' };
  const metered = { id: 'metered', kind: 'image', adapter: 'openai-image', unitCostMicros: '40000' };
  const unpriced = { id: 'unpriced', kind: 'image', adapter: 'openai-image', unitCostMicros: '0' };
  assert.deepEqual(characterSheetQuote({ profiles: [codex] }, 2), { micros: '0', units: 2, unitMicros: '0', priceUnknown: false, subscription: 'codex' });
  assert.deepEqual(characterSheetQuote({ profiles: [codex, metered], preferredProfileIds: { image: 'metered' } }, 3), { micros: '120000', units: 3, unitMicros: '40000', priceUnknown: false });
  assert.equal(characterSheetQuote({ profiles: [unpriced] }, 1).priceUnknown, true);
  assert.equal(characterSheetQuote({ profiles: [] }, 1).priceUnknown, true);
  assert.deepEqual(characterSheetQuote({ profiles: [codex] }, 0), { micros: '0', units: 0, unitMicros: '0', priceUnknown: false });
  assert.throws(() => characterSheetQuote({ profiles: [codex] }, 33), RangeError);
});
