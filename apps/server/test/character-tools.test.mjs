import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { DirectorContextService } from '../dist/application/director-context.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { applyCharacterChange, makeCharacterSheets, readCharacters } from '../dist/application/character-tools.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
/** A locked Director conversation on the fake image model; no provider is called. */
async function fixture(t) {
  const f = await confirmationFixture(t, { modes: ['none', 'none'] });
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'openslate-character-tools-skills-'));
  t.after(() => { writable(snapshotRoot); rmSync(snapshotRoot, { recursive: true, force: true }); });
  f.saved = createDirectorSkillLock({ repositoryRoot, snapshotRoot }, '6.0.0');
  f.contexts = new DirectorContextService(f.production, f.saved.environment);
  f.contexts.bootstrapLock(f.project.id, f.saved.lock);
  f.turn = (text, options = {}) => {
    const human = f.production.beginRequest(f.project.id, 'local-user', text, { source: 'user', editing: true, ...options });
    const bridge = f.production.openEpoch(f.project.id, human);
    f.contexts.capture(f.project.id, bridge.actor, { lockId: f.saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
    return { human, actor: bridge.actor };
  };
  f.ctx = actor => ({ service: f.production, projectId: f.project.id, actor, invocationId: randomUUID() });
  return f;
}

test('a fresh human request lets the Director cast characters and start sheets, never approve them', async t => {
  const f = await fixture(t), { actor } = f.turn('Cast Mara in both shots and make her character sheet.');
  const [first, second] = f.store.getProject(f.project.id).shots;
  const change = applyCharacterChange(f.ctx(actor), { createCharacters: [{ key: 'mara', name: 'Mara', identity: 'Short black hair, freckles.',
    wardrobe: [{ sceneId: first.sceneId, outfit: 'trench coat' }] }], casting: [{ shotId: first.id, characterIds: ['mara'] }, { shotId: second.id, characterIds: ['mara'] }] });
  const mara = change.keys.mara;
  assert.equal(readCharacters(f.ctx(actor)).characters[0].needsSheet, true);
  const ctx = f.ctx(actor), receipt = makeCharacterSheets(ctx, { characterIds: [mara] });
  assert.equal(receipt.started.length, 1); assert.deepEqual(receipt.quote, { micros: '100', units: 1, unitMicros: '100', priceUnknown: false });
  assert.deepEqual(makeCharacterSheets(ctx, { characterIds: [mara] }), receipt, 'a replayed invocation starts nothing new');
  assert.equal(f.store.list('character_sheet_job', f.project.id).length, 1);
  assert.equal(f.store.get('character_sheet_job', receipt.started[0].nodeId).requestId, actor.requestId, 'the grant spends the human request');
  for (let i = 0; i < 6; i++) { await f.engine.runReady(); await f.engine.reconcile(); }
  assert.throws(() => makeCharacterSheets(f.ctx(actor), { characterIds: [mara] }), { code: 'CHARACTER_SHEET_EXISTS' });
  assert.equal(makeCharacterSheets(f.ctx(actor), { characterIds: [mara], regenerate: true }).started.length, 1);
  assert.equal(f.store.getProject(f.project.id).characters[0].sheet, null, 'the Director has no way to approve');
  // A conversation scoped to one shot cannot spend a sheet for a character who is not in it.
  const ivo = applyCharacterChange(f.ctx(f.turn('Add Ivo.').actor), { createCharacters: [{ key: 'ivo', name: 'Ivo', identity: 'Tall, grey beard.' }] }).keys.ivo;
  const scoped = f.turn('Just tweak this shot.', { scopeIds: [first.id] });
  assert.throws(() => makeCharacterSheets(f.ctx(scoped.actor), { characterIds: [ivo] }), { code: 'SCOPE_DENIED' });
  assert.throws(() => applyCharacterChange(f.ctx(scoped.actor), { updateCharacters: [{ id: ivo, name: 'Ivan' }] }), { code: 'SCOPE_DENIED' });
});
