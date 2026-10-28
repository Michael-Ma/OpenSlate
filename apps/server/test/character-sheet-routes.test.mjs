import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../dist/persistence/index.js';
import { Engine } from '../dist/execution/index.js';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
import { projectAssets } from '../dist/asset-library.js';
import { characterSheetTakes } from '../dist/character-sheets.js';
import { CHARACTER_SHEET_PLAN_ID } from '../dist/execution/character-sheet-execution.js';
import { publishCharacters } from '../dist/characters.js';
import { readCharacters, applyCharacterChange, makeCharacterSheets } from '../dist/application/character-tools.js';
import { FakeProvider } from '../../../packages/providers/dist/index.js';
import { projectFixture } from './execution-fixture.mjs';

/** Fake-model studio: real routes, real engine, labelled fixture images. No provider is ever called. */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'openslate-characters-'));
  const store = new Store(join(directory, 'store.sqlite')), provider = new FakeProvider(join(directory, 'provider.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(directory, 'artifacts'), budgetMicros: '0' });
  const service = new ProductionService(store, engine);
  let project = service.createProject('Character fixture');
  const shape = projectFixture(project.id, 2);
  project = { ...project, ...shape, capabilityLockId: project.capabilityLockId, headVersion: 0,
    shots: shape.shots.map(s => ({ ...s, narration: { mode: 'none', text: '', voice: 'stock' } })) };
  store.saveProject(project, 0);
  store.put('project_revision', project.revisionId, project.id, { project });
  const token = randomBytes(32).toString('base64url'), app = createApp({ service, localToken: token, logger: false });
  t.after(async () => { await app.close(); store.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = (method, path, payload, key = randomUUID()) => app.inject({ method, url: `/api/projects/${project.id}${path}`,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) }, ...(payload ? { payload } : {}) });
  const finish = async () => { for (let i = 0; i < 6; i++) { await engine.runReady(); await engine.reconcile(); } };
  const keyframes = async (sceneId, extra = {}) => {
    const view = (await call('GET', `/scenes/${sceneId}/generation`)).json();
    return call('POST', `/scenes/${sceneId}/generate`, { headVersion: view.headVersion, revisionId: view.revisionId, kind: 'image', reviewedFrames: [],
      reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId, ...extra });
  };
  const head = () => store.getProject(project.id).headVersion;
  return { store, engine, service, app, projectId: project.id, call, finish, keyframes, head };
}
const cast = f => ({ expectedHeadVersion: f.head(), characters: [{ key: 'mara', name: 'Mara', identity: 'Short black hair, freckles, slight build, about thirty.',
  baseOutfit: 'plain grey overalls', wardrobe: [{ sceneId: 'scene-0', outfit: 'rain-dark trench coat' }, { sceneId: 'scene-1', outfit: 'yellow oilskin', notes: 'wet hair' }] }],
  casting: [{ shotId: 'shot-0', characterIds: ['mara'] }, { shotId: 'shot-1', characterIds: ['mara'] }] });
const imageBindings = f => f.store.list('node_binding', f.projectId).filter(b => b.state === 'active' && b.planId === f.store.getProject(f.projectId).activePlanId && b.node.kind === 'image');

test('characters: save, quote, generate, regenerate keeps takes, approve binds and stales keyframes in one revision', async t => {
  const f = fixture(t);
  const saved = await f.call('PUT', '/characters', cast(f));
  assert.equal(saved.statusCode, 200, saved.body);
  const maraId = saved.json().keys.mara;
  assert.deepEqual(saved.json().changedShotIds.sort(), ['shot-0', 'shot-1']);
  let project = f.store.getProject(f.projectId);
  assert.match(project.shots[0].imagePrompt, /Characters in this shot \(OpenSlate\):\n- Mara: .*Wearing in this scene: rain-dark trench coat\./);
  assert.match(project.shots[1].imagePrompt, /yellow oilskin \(wet hair\)/);
  // Make the keyframes the approval will later put out of date.
  for (const scene of ['scene-0', 'scene-1']) assert.equal((await f.keyframes(scene)).statusCode, 200);
  await f.finish();
  assert.ok(imageBindings(f).every(b => b.outputs.image), 'both keyframes exist');

  let view = (await f.call('GET', '/characters', undefined, null)).json();
  const mara = view.characters[0];
  assert.equal(mara.sheetState, 'none'); assert.equal(mara.needsSheet, true); assert.equal(view.sheetSupported, true);
  assert.deepEqual(view.sheetQuote, { micros: '100', units: 1, unitMicros: '100', priceUnknown: false });
  assert.match(mara.sheetPrompt, /^Character reference sheet for Mara\.\nSquare canvas/);
  assert.doesNotMatch(mara.sheetPrompt, /trench|oilskin/, 'scene wardrobe never reaches the sheet');
  assert.ok(view.issues.some(issue => issue.code === 'SHEET_REQUIRED'));

  // Refusals: price, head version, unknown character, missing price (schema).
  const generate = (body, key) => f.call('POST', `/characters/${maraId}/sheet/generate`, { expectedHeadVersion: f.head(), expectedEstimateMicros: '100', ...body }, key);
  assert.equal((await generate({ expectedEstimateMicros: '0' })).json().error.code, 'ESTIMATE_CHANGED');
  assert.equal((await generate({ expectedHeadVersion: 0 })).json().error.code, 'REVISION_CONFLICT');
  assert.equal((await f.call('POST', '/characters/ghost/sheet/generate', { expectedHeadVersion: f.head(), expectedEstimateMicros: '100' })).statusCode, 404);
  assert.equal((await f.call('POST', `/characters/${maraId}/sheet/generate`, { expectedHeadVersion: f.head() })).statusCode, 400);
  assert.equal((await f.call('POST', `/characters/${maraId}/sheet/generate`, { expectedHeadVersion: f.head(), expectedEstimateMicros: '100' }, null)).json().error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(f.store.list('character_sheet_job', f.projectId).length, 0, 'refusals start nothing');

  const key = randomUUID(), first = await generate({}, key);
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual((await generate({}, key)).json(), first.json(), 'exact replay adds no work');
  assert.equal(f.store.list('character_sheet_job', f.projectId).length, 1);
  assert.equal((await generate({})).json().error.code, 'ATTEMPT_EXISTS');
  const [job] = first.json().started;
  const binding = f.store.get('node_binding', job.nodeId);
  assert.equal(binding.planId, CHARACTER_SHEET_PLAN_ID); assert.equal(binding.node.shotId, null); assert.equal(binding.node.characterId, maraId);
  assert.equal(binding.node.args.width, 1024); assert.equal(binding.node.args.height, 1024); assert.equal(binding.node.args.prompt, mara.sheetPrompt);
  assert.equal(f.store.get('grant', f.store.get('candidate', binding.candidateId).grantId).scopeId, f.projectId);
  await f.finish();
  view = (await f.call('GET', '/characters', undefined, null)).json();
  assert.equal(view.characters[0].sheetState, 'review'); assert.equal(view.characters[0].takes.length, 1);
  assert.equal(view.characters[0].takes[0].takeId, job.nodeId); assert.equal(view.characters[0].job, null);

  // Regenerate is explicit and adds a take; the earlier take stays.
  assert.equal((await generate({})).json().error.code, 'CHARACTER_SHEET_EXISTS');
  const second = await generate({ regenerate: true });
  assert.equal(second.statusCode, 200, second.body);
  await f.finish();
  const takes = characterSheetTakes(f.store, f.projectId);
  assert.deepEqual(takes.map(take => take.id), [job.nodeId, second.json().started[0].nodeId]);
  assert.equal(projectAssets(f.service, f.store.getProject(f.projectId)).filter(item => item.role === 'character_sheet').length, 2);

  // Approve: one revision binds the sheet, rewrites both character blocks and puts both keyframes out of date.
  const attemptsBefore = f.engine.attempts(f.projectId).length, headBefore = f.head();
  const approve = await f.call('POST', `/characters/${maraId}/sheet/approve`, { expectedHeadVersion: headBefore, takeId: takes[1].id });
  assert.equal(approve.statusCode, 200, approve.body);
  assert.equal(f.head(), headBefore + 1, 'exactly one revision');
  project = f.store.getProject(f.projectId);
  const sheetId = takes[1].artifact.artifactId;
  assert.equal(project.characters[0].sheet.artifactId, sheetId);
  assert.ok(project.artifacts.some(a => a.artifactId === sheetId), 'the sheet is a registered project reference');
  for (const shot of project.shots) {
    assert.deepEqual(shot.referenceArtifactIds, [sheetId]);
    assert.match(shot.imagePrompt, /- Mara \(reference image 1 is their character sheet/);
  }
  for (const b of imageBindings(f)) {
    assert.equal(b.candidateId, null); assert.deepEqual(b.outputs, {}); assert.ok(b.outdated.fields.includes('characters'));
  }
  assert.deepEqual(approve.json().outdatedNodeIds.length >= 2, true);
  const event = f.store.readEvents(f.projectId).filter(e => e.kind === 'characters.changed').at(-1);
  assert.equal(event.payload.reason, 'approve_sheet'); assert.equal(event.payload.headVersion, headBefore + 1);
  await f.finish();
  assert.equal(f.engine.attempts(f.projectId).length, attemptsBefore, 'approval regenerates nothing');
  view = (await f.call('GET', '/characters', undefined, null)).json();
  assert.equal(view.characters[0].sheetState, 'approved');
  assert.deepEqual(view.characters[0].takes.map(take => take.approved), [false, true]);
  assert.ok(!view.issues.some(issue => ['SHEET_REQUIRED', 'SHEET_NOT_BOUND'].includes(issue.code)));
  assert.equal((await f.call('POST', `/characters/${maraId}/sheet/approve`, { expectedHeadVersion: f.head(), takeId: takes[1].id })).json().error.code, 'CHARACTER_SHEET_ALREADY_APPROVED');
  assert.equal((await f.call('POST', `/characters/${maraId}/sheet/approve`, { expectedHeadVersion: f.head(), takeId: 'missing' })).statusCode, 404);
  assert.equal((await f.call('POST', `/characters/${maraId}/sheet/approve`, { expectedHeadVersion: 0, takeId: takes[0].id })).json().error.code, 'REVISION_CONFLICT');

  // The person's Make keyframes now sends the approved sheet as the first reference; plan installs keep sheet bindings.
  assert.equal((await f.keyframes('scene-0')).statusCode, 200);
  const remade = imageBindings(f).find(b => b.node.shotId === 'shot-0');
  assert.equal(remade.node.inputs[0].source.artifact.artifactId, sheetId);
  assert.equal(f.store.get('node_binding', job.nodeId).state, 'retired', 'an older finished job left execution when a newer take started');
  assert.equal(f.store.get('node_binding', second.json().started[0].nodeId).state, 'active', 'a plan install never retires a sheet binding');

  // Approving the older take swaps the reference instead of adding it.
  await f.finish();
  await f.call('POST', `/characters/${maraId}/sheet/approve`, { expectedHeadVersion: f.head(), takeId: takes[0].id });
  assert.deepEqual(f.store.getProject(f.projectId).shots.map(s => s.referenceArtifactIds), [[takes[0].artifact.artifactId], [takes[0].artifact.artifactId]]);
});

test('character edits validate, import needs an uploaded image, and Director handlers keep their limits', async t => {
  const f = fixture(t);
  assert.equal((await f.call('PUT', '/characters', { ...cast(f), expectedHeadVersion: 99 })).json().error.code, 'REVISION_CONFLICT');
  const twins = cast(f); twins.characters.push({ ...twins.characters[0], key: 'twin' });
  assert.equal((await f.call('PUT', '/characters', twins)).json().error.code, 'VALIDATION_ERROR');
  const badScene = cast(f); badScene.characters[0].wardrobe = [{ sceneId: 'nowhere', outfit: 'coat' }];
  assert.equal((await f.call('PUT', '/characters', badScene)).statusCode, 403);
  const saved = (await f.call('PUT', '/characters', cast(f))).json(), maraId = saved.keys.mara;
  // Import refuses anything but an image the person uploaded to this film.
  f.store.insert('artifact', 'generated-png', f.projectId, { id: 'generated-png', projectId: f.projectId, artifact: { artifactId: 'generated-png', kind: 'image', sha256: 'a'.repeat(64) },
    path: '/nowhere.png', mimeType: 'image/png', fixture: false, attemptId: null, physicalDurationSeconds: null });
  assert.equal((await f.call('POST', `/characters/${maraId}/sheet/import`, { artifactId: 'generated-png', sha256: 'a'.repeat(64) })).json().error.code, 'CHARACTER_SHEET_INVALID');
  assert.equal((await f.call('POST', `/characters/${maraId}/sheet/approve`, { expectedHeadVersion: f.head(), takeId: 'none' })).statusCode, 404);
  // Deleting a character removes it from every cast and from the character blocks.
  const removed = await f.call('PUT', '/characters', { expectedHeadVersion: f.head(), characters: [] });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.ok(f.store.getProject(f.projectId).shots.every(s => (s.characterIds ?? []).length === 0 && !s.imagePrompt.includes('Characters in this shot')));

  // Director handlers: a person's request cannot call them, and media shots need a proposal.
  const human = f.service.beginRequest(f.projectId, 'local-user', 'Cast the film');
  const ctx = actor => ({ service: f.service, projectId: f.projectId, actor, invocationId: randomUUID() });
  assert.throws(() => readCharacters(ctx(human)), { code: 'ACTOR_DENIED' });
  assert.throws(() => makeCharacterSheets(ctx(human), { characterIds: [maraId] }), { code: 'ACTOR_DENIED' });
  const director = f.service.openEpoch(f.projectId, human).actor;
  const change = applyCharacterChange(ctx(director), { createCharacters: [{ key: 'ivo', name: 'Ivo', identity: 'Tall, grey beard.', wardrobe: [] }],
    casting: [{ shotId: 'shot-0', characterIds: ['ivo'] }] });
  assert.deepEqual(change.changedShotIds, ['shot-0']);
  const ivo = change.keys.ivo;
  assert.equal(readCharacters(ctx(director)).characters[0].id, ivo);
  assert.throws(() => makeCharacterSheets(ctx(director), { characterIds: [ivo] }), { code: 'ORIGIN_NOT_AUTHORIZED' }, 'sheets need a locked Director conversation');
  for (const scene of ['scene-0']) assert.equal((await f.keyframes(scene)).statusCode, 200);
  await f.finish();
  const before = f.head();
  assert.throws(() => applyCharacterChange(ctx(f.service.openEpoch(f.projectId, f.service.beginRequest(f.projectId, 'local-user', 'Change Ivo')).actor),
    { updateCharacters: [{ id: ivo, identity: 'Short, clean-shaven.' }] }), { code: 'PROPOSAL_REQUIRED' });
  assert.equal(f.head(), before, 'a refused change writes nothing');
  const project = f.store.getProject(f.projectId);
  assert.throws(() => publishCharacters(f.service, f.projectId, project, project.characters, new Map([['shot-0', []]]), 'test', { refuseShotsWithMedia: true }), { code: 'PROPOSAL_REQUIRED' });
});
