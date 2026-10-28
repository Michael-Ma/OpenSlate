import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { codexImageFixture } from './codex-image-execution-fixture.mjs';
import { pngBytes } from './viggle-h3-execution-fixture.mjs';
import { assertCodexImageCurrentSelection } from '../dist/execution/codex-image-authority.js';
import { generateCharacterSheets, characterView } from '../dist/characters.js';
import { characterSheetTakes } from '../dist/character-sheets.js';

/** Codex image with an injected native transport: no real image is ever generated. */
async function fixture(t) {
  const f = codexImageFixture(t), bytes = pngBytes();
  f.transport.start = async prepared => { f.calls.start++; return { kind: 'completed', threadId: prepared.session.threadId, turnId: 'turn-sheet', itemId: 'image-sheet', bytes, revisedPrompt: 'Native revised prompt' }; };
  f.build(); f.selected = await f.seed(); f.engine = f.runtime.engine; f.bridge = f.engine.registry.resolve({ adapter: 'codex-image', version: '1' });
  const projectId = f.selected.projectId, project = f.store.getProject(projectId);
  const characters = ['Mara', 'Ivo'].map(name => ({ id: name.toLowerCase(), revisionId: randomUUID(), name, identity: `${name}: short black hair, freckles.`, wardrobe: [], sheet: null }));
  f.store.saveProject({ ...project, characters }, project.headVersion);
  f.projectId = projectId; f.bytes = bytes;
  f.start = characterId => generateCharacterSheets(f.production, projectId, { characterIds: [characterId], expectedEstimateMicros: '0' }, randomUUID()).started[0];
  f.admit = nodeId => { const binding = f.store.get('node_binding', nodeId); return f.engine.admit(projectId, nodeId, f.engine.resolveInputs(projectId, binding.node).fingerprint); };
  return f;
}

test('a Codex sheet node passes authority with no shot, runs at 1:1 and records a PNG take', async t => {
  const f = await fixture(t);
  assert.deepEqual(characterView(f.production, f.projectId).sheetQuote, { micros: '0', units: 1, unitMicros: '0', priceUnknown: false, subscription: 'codex' });
  assert.throws(() => generateCharacterSheets(f.production, f.projectId, { characterIds: ['mara'], expectedEstimateMicros: '1' }, randomUUID()), { code: 'ESTIMATE_CHANGED' });
  const job = f.start('mara'), attempt = f.admit(job.nodeId);
  assert.equal(f.store.get('node_binding', job.nodeId).node.shotId, null);
  assert.equal(attempt.request.args.width, 1024); assert.equal(attempt.request.args.height, 1024);
  assert.equal(attempt.request.args.prompt, characterView(f.production, f.projectId).characters[0].sheetPrompt);
  assertCodexImageCurrentSelection(f.store, attempt);
  const result = await f.bridge.submit(attempt.request, { expectedLease: { owner: attempt.leaseOwner, epoch: attempt.leaseEpoch } });
  assert.equal(result.type, 'completed'); assert.equal(f.calls.start, 1); assert.equal(f.calls.api, 0);
  const current = f.store.get('attempt', attempt.id); f.store.put('attempt', current.id, current.projectId, { ...current, leaseExpiresAt: 0 });
  await f.engine.reconcile();
  assert.equal(f.store.get('attempt', attempt.id).phase, 'succeeded');
  const [take] = characterSheetTakes(f.store, f.projectId);
  assert.equal(take.id, job.nodeId); assert.equal(take.characterId, 'mara'); assert.equal(take.attemptId, attempt.id);
  assert.deepEqual(readFileSync(f.store.get('artifact', take.artifact.artifactId).path), f.bytes);
  assert.equal(characterView(f.production, f.projectId).characters[0].sheetState, 'review');
});

test('a forged or stale sheet prompt, an unrecorded sheet node and an unsupported model all fail', async t => {
  const f = await fixture(t);
  const job = f.start('ivo'), attempt = f.admit(job.nodeId);
  const binding = f.store.get('node_binding', job.nodeId), record = f.store.get('character_sheet_job', job.nodeId);
  const forge = node => {
    f.store.put('node_binding', binding.id, f.projectId, { ...binding, node });
    f.store.put('character_sheet_job', record.id, f.projectId, { ...record, node });
    // Stored attempts are immutable; the authority check reads only this request identity.
    return { ...attempt, specDigest: node.specDigest, request: { ...attempt.request, args: node.args } };
  };
  // Consistent forgery of binding, job record and attempt: the prompt is still not the sheet template.
  const forged = forge({ ...binding.node, specDigest: 'f'.repeat(64), args: { ...binding.node.args, prompt: 'A photo of someone else entirely.' } });
  assert.throws(() => assertCodexImageCurrentSelection(f.store, forged), { code: 'CODEX_IMAGE_SELECTION_CHANGED', message: /sheet prompt differs/ });
  // A sheet node without its recorded job is not a sheet.
  forge(binding.node); f.store.put('character_sheet_job', record.id, f.projectId, { ...record, node: { ...record.node, alias: 'other' } });
  assert.throws(() => assertCodexImageCurrentSelection(f.store, attempt), { code: 'CODEX_IMAGE_SELECTION_CHANGED', message: /not an exact recorded/ });
  f.store.put('character_sheet_job', record.id, f.projectId, record);
  assertCodexImageCurrentSelection(f.store, attempt);
  // Editing the character's identity after admission makes the sheet stale before dispatch.
  const project = f.store.getProject(f.projectId);
  f.store.saveProject({ ...project, characters: project.characters.map(c => c.id === 'ivo' ? { ...c, identity: 'Tall, grey beard.' } : c) }, project.headVersion);
  assert.throws(() => assertCodexImageCurrentSelection(f.store, attempt), { code: 'CODEX_IMAGE_SELECTION_CHANGED' });
  // The shot-owned guard is unchanged: an image with neither a shot nor a character still fails.
  const { characterId: _c, ...unowned } = binding.node;
  f.store.put('node_binding', binding.id, f.projectId, { ...binding, node: unowned });
  assert.throws(() => assertCodexImageCurrentSelection(f.store, attempt), { code: 'CODEX_IMAGE_SELECTION_CHANGED' });
  // Sheets refuse an image model whose execution path keeps shot-only guards.
  const lock = f.store.get('capability_lock', project.capabilityLockId), lockId = randomUUID(), latest = f.store.getProject(f.projectId);
  f.store.saveProject({ ...latest, capabilityLockId: lockId }, latest.headVersion);
  f.store.insert('capability_lock', lockId, f.projectId, { ...lock, id: lockId, preferredProfileIds: { ...lock.preferredProfileIds, image: 'api-image' },
    profiles: [...lock.profiles, { id: 'api-image', revision: 'v1', kind: 'image', adapter: 'openai-image', executionVersion: '1', maxConcurrency: 1, unitCostMicros: '1000', maxRetries: 0, configuration: { model: 'gpt-image-1', settings: {} } }] });
  assert.throws(() => generateCharacterSheets(f.production, f.projectId, { characterIds: ['mara'], expectedEstimateMicros: '1000' }, randomUUID()), { code: 'CHARACTER_SHEET_PROFILE_UNSUPPORTED' });
});
