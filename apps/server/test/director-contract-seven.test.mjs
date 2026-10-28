import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { digest, FILM_KINDS, FILM_KIND_VERSION, normalizeFilmKind, toolCatalog, toolContractAtLeast, parseToolArguments, V6_TOOL_NAMES } from '@openslate/core';
import { SHIPPED_DIRECTOR_GUIDANCE } from '../dist/application/director-shipped-guidance.js';
import { editStoryboard } from '../dist/storyboard.js';
import { isMusicVideoProject } from '../dist/narration/music-video.js';
import { filmPlanningGuidance } from '../dist/application/film-planning-guidance.js';
import { LocalMusicAnalyzer, suggestedSectionShots } from '../dist/media/music-analyzer.js';
import { attachDirector, seven } from './helpers/contract-seven-fixture.mjs';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';

const code = async (promise) => { try { await promise; } catch (error) { return error.code; } assert.fail('expected a refusal'); };
const sha = (seed) => (seed.repeat(64)).slice(0, 64);
function addAudio(f, { id = randomUUID(), label = 'Song', role = 'music', seconds = 60 } = {}) {
  f.store.insert('narration_audio', id, f.project.id, { id, projectId: f.project.id, declaredOrigin: 'uploaded', requestId: randomUUID(), role,
    media: { kind: 'audio', sha256: sha(id.replace(/[^a-f0-9]/g, '') || 'a'), byteLength: seconds * 192000, probe: { audio: { samples: seconds * 48000, sampleRate: 48000, channels: 2 } } } });
  f.store.insert('audio_library_label', id, f.project.id, { label, role });
  return id;
}
function cacheTiming(f, audioId) {
  const audio = f.store.get('narration_audio', audioId);
  f.store.put('song_timing', audioId, f.project.id, { id: audioId, projectId: f.project.id, sha256: audio.media.sha256, timing: {
    version: 'song-timing@1', durationSamples: 60 * 48000, durationFrames: 1800, bpm: 120,
    beatFrames: Array.from({ length: 120 }, (_, i) => i * 15), sectionStartFrames: [0, 600, 1200] } });
}
const human = (f, body) => f.call('POST', '/storyboard', { expectedHeadVersion: f.head(), ...body });
const okJson = async (response) => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
const resolve = (f, note, choiceIndex = 0) => f.call('POST', `/director/notes/${note.noteId}/resolve`, { choiceIndex, expectedVersion: f.store.get('director_note', note.noteId).version });
/** Shot and scene identity and order, without per-edit revision IDs. */
const shape = (project) => ({ scenes: project.scenes.map(scene => scene.id), shots: project.shots.map(({ id, sceneId, desiredFrames }) => ({ id, sceneId, desiredFrames })), soundtrack: project.soundtrack });

test('contract 7.0.0 adds tools without changing any shipped catalog', () => {
  const six = toolCatalog('6.0.0'), next = toolCatalog('7.0.0');
  const pin = SHIPPED_DIRECTOR_GUIDANCE.filter(row => row.toolContract === '6.0.0').at(-1);
  assert.equal(six.digest, pin.handlerDigest, '6.0.0 descriptors are byte-for-byte unchanged');
  for (const row of SHIPPED_DIRECTOR_GUIDANCE) assert.ok(SHIPPED_DIRECTOR_GUIDANCE.some(pin => pin.toolContract === row.toolContract && toolCatalog(row.toolContract).digest === pin.handlerDigest), row.toolContract);
  assert.deepEqual([...six.names], [...V6_TOOL_NAMES]);
  assert.ok(six.names.every(name => next.names.includes(name)));
  for (const name of ['set_soundtrack', 'move_shot', 'move_scene', 'start_export', 'undo_edit', 'delete_shots', 'delete_scene', 'use_take', 'analyze_music', 'make_character_sheets'])
    assert.ok(next.names.includes(name) && !six.names.includes(name), name);
  assert.ok(toolContractAtLeast('7.0.0', '6.0.0') && !toolContractAtLeast('6.0.0', '7.0.0'));
  assert.throws(() => parseToolArguments('control_execution', { action: 'stop' }, '6.0.0'), /registered schema/);
  assert.throws(() => parseToolArguments('prepare_change', { variant: 'project', expectedHeadVersion: 0, creative: { project: { filmKind: { kind: 'music_video' } } } }, '6.0.0'));
  assert.throws(() => parseToolArguments('set_soundtrack', {}, '7.0.0'), 'an empty soundtrack change is refused by schema');
  assert.equal(parseToolArguments('set_soundtrack', { audioId: null }, '7.0.0').arguments.audioId, null);
});

test('6.0.0 Directors keep their catalog: new tools and actions are unknown or invalid', async t => {
  const f = seven(t, { version: '6.0.0' }), turn = f.openTurn();
  assert.equal(await code(turn.call('move_shot', { shotId: 'shot-0', sceneId: 'scene-1' })), 'NOT_FOUND');
  assert.equal(await code(turn.call('control_execution', { action: 'stop' })), 'VALIDATION_ERROR');
  assert.equal(await code(turn.call('read_context', { section: 'audio_library' })), 'VALIDATION_ERROR');
  assert.equal(f.store.get('execution_control', f.project.id)?.paused ?? false, false);
  // The successor-only behaviour of 6.0.0 still applies: notes context includes proposals.
  assert.ok(Array.isArray((await turn.call('read_context', { section: 'notes' })).proposals));
});

test('set_soundtrack runs the person\'s soundtrack commands with identical results, and undo_edit reverts the last one', async t => {
  const director = seven(t), person = seven(t);
  const a = addAudio(director, { id: 'song-a' }), b = addAudio(person, { id: 'song-a' });
  const turn = director.openTurn({ text: 'Use my song at full volume.' });
  const receipt = await turn.call('set_soundtrack', { audioId: a, gainMilliDb: 0 });
  assert.equal(receipt.commandIds.length, 2);
  await okJson(await human(person, { kind: 'soundtrack', field: 'audioId', value: b }));
  await okJson(await human(person, { kind: 'soundtrack', field: 'gainMilliDb', value: '0' }));
  assert.deepEqual(director.saved().soundtrack, person.saved().soundtrack);
  assert.deepEqual(director.saved().soundtrack, { audioId: 'song-a', gainMilliDb: 0 });
  const label = (f, id) => { const { projectId: _p, ...rest } = f.store.get('audio_library_label', id); return rest; };
  assert.deepEqual(label(director, a), label(person, b));
  const edit = director.store.get('storyboard_edit', receipt.commandIds[1]);
  assert.equal(edit.origin.director.requestId, turn.human.requestId, 'the edit records which conversation ran it');
  const undone = await turn.call('undo_edit', { commandId: receipt.commandIds[1] });
  assert.equal(undone.undone, 'storyboard_command');
  assert.equal(director.saved().soundtrack.gainMilliDb, -18000);
  // null is the person's "No music".
  await director.openTurn({ text: 'No music.' }).call('set_soundtrack', { audioId: null });
  assert.equal(director.saved().soundtrack, null);
  assert.equal(director.provider.acceptedCount(), 0);
});

test('set_soundtrack refusals: scene scope, discuss-only, app turns, unknown audio and fields before music', async t => {
  const f = seven(t), audio = addAudio(f), before = f.saved();
  assert.equal(await code(f.openTurn({ scopeIds: ['scene-0'] }).call('set_soundtrack', { audioId: audio })), 'SCOPE_DENIED');
  assert.notEqual(await code(f.openTurn({ editing: false }).call('set_soundtrack', { audioId: audio })), undefined);
  assert.equal(await code(f.openTurn({ source: 'app' }).call('set_soundtrack', { audioId: audio })), 'ORIGIN_NOT_AUTHORIZED');
  assert.equal(await code(f.openTurn().call('set_soundtrack', { audioId: 'not-owned' })), 'NOT_FOUND');
  assert.equal(await code(f.openTurn().call('set_soundtrack', { startFrame: 30 })), 'VALIDATION_ERROR', 'same refusal as the person: select music first');
  assert.deepEqual(shape(f.saved()), shape(before));
});

test('move_shot and move_scene match the person\'s moves; the request scope bounds them and the arguments only select', async t => {
  const director = seven(t, { count: 3 }), person = seven(t, { count: 3 });
  const turn = director.openTurn();
  const moved = await turn.call('move_shot', { shotId: 'shot-2', sceneId: 'scene-0', beforeId: 'shot-0' });
  assert.deepEqual(moved.shotOrder, ['shot-2', 'shot-0']);
  await turn.call('move_scene', { sceneId: 'scene-1', beforeId: 'scene-0' });
  await okJson(await human(person, { kind: 'moveShot', id: 'shot-2', sceneId: 'scene-0', beforeId: 'shot-0' }));
  await okJson(await human(person, { kind: 'moveScene', id: 'scene-1', beforeId: 'scene-0' }));
  assert.deepEqual(shape(director.saved()), shape(person.saved()));

  // A conversation about scene 0 and shot 1 may not move shot 1 into scene 2; selecting shot 0 moves only shot 0.
  const scoped = director.openTurn({ scopeIds: ['scene-0'] }), before = shape(director.saved());
  assert.equal(await code(scoped.call('move_shot', { shotId: 'shot-1', sceneId: 'scene-0' })), 'SCOPE_DENIED');
  assert.equal(await code(scoped.call('move_scene', { sceneId: 'scene-2' })), 'SCOPE_DENIED');
  assert.deepEqual(shape(director.saved()), before);
  await scoped.call('move_shot', { shotId: 'shot-0', sceneId: 'scene-0', beforeId: 'shot-2' });
  assert.deepEqual(director.saved().shots.map(s => s.id), ['shot-0', 'shot-2', 'shot-1']);
  assert.equal(await code(director.openTurn().call('move_shot', { shotId: 'shot-0', sceneId: 'scene-1', beforeId: 'shot-2' })), 'VALIDATION_ERROR', 'beforeId must be in the destination scene');
  assert.equal(await code(director.openTurn().call('move_shot', { shotId: 'missing', sceneId: 'scene-1' })), 'NOT_FOUND');
});

test('prepare_change places new scenes and shots with beforeId and sets filmKind and visualStyle', async t => {
  const f = seven(t), turn = f.openTurn();
  const draft = { key: 'new', sceneId: 'scene-1', beforeId: 'shot-1', purpose: 'Insert', action: 'A gull lands', framing: 'Wide', motion: 'Hold', desiredFrames: 120,
    imagePrompt: 'A gull lands on the rail', videoPrompt: 'The gull settles', referenceArtifactIds: [], cueId: null, narration: { mode: 'none', text: '', voice: 'stock' } };
  const style = { styleId: 'grounded-realism', libraryVersion: '8.0.0', label: 'Grounded realism',
    traits: { palette: 'warm neutrals', lighting: 'soft side key', lensFormat: '35mm f/2.8', texture: 'fine grain', composition: 'eye level', productionDesign: 'lived-in' },
    imageBlock: 'Grounded realism, warm neutrals, soft side key.', motionBlock: 'Live action, 24 fps.',
    motion: { cameraGrammar: 'slow dolly', frameRateFeel: '24fps-cinematic', motionScale: 'subtle' },
    negatives: ['clean frame'], anchors: { referenceArtifactIds: [], characterSheets: [] }, variationAxes: ['timeOfDay'], rationale: 'Fits a quiet ferry story.' };
  const prepared = await turn.call('prepare_change', { variant: 'project', expectedHeadVersion: f.head(), creative: {
    project: { filmKind: { kind: 'music_video', subtype: 'performance', basis: { kind: 'stated' } }, visualStyle: style },
    createScenes: [{ key: 'opening', title: 'Opening', purpose: 'Open on the water', beforeId: 'scene-0' }], createShots: [draft] } });
  await turn.call('apply_change', { preparedId: prepared.preparedId });
  const saved = f.saved();
  assert.equal(saved.scenes[0].title, 'Opening');
  assert.deepEqual(saved.shots.filter(s => s.sceneId === 'scene-1').map(s => s.action), ['A gull lands', 'A boot on a bench']);
  assert.deepEqual(saved.filmKind, { version: FILM_KIND_VERSION, kind: 'music_video', subtype: 'performance', basis: { kind: 'stated' } });
  assert.equal(saved.visualStyle.styleId, 'grounded-realism');
  assert.ok(saved.visualStyle.revisionId, 'the application issues the style revision');
  assert.ok(isMusicVideoProject(saved), 'filmKind decides, even though the brief never says music video');
  // An unknown insert target is refused by the same patch application.
  assert.equal(await code(f.openTurn().call('prepare_change', { variant: 'project', expectedHeadVersion: f.head(), creative: { createShots: [{ ...draft, key: 'x', beforeId: 'shot-0' }] } })), 'SCOPE_DENIED');
  assert.equal(await code(f.openTurn().call('prepare_change', { variant: 'project', expectedHeadVersion: f.head(), creative: { project: { filmKind: { kind: 'opera' } } } })), 'VALIDATION_ERROR');
  assert.equal(await code(f.openTurn().call('prepare_change', { variant: 'project', expectedHeadVersion: f.head(), creative: { project: { filmKind: 'explainer' } } })), 'VALIDATION_ERROR', 'the catalog takes the structured record only');
  assert.equal(await code(f.openTurn().call('prepare_change', { variant: 'project', expectedHeadVersion: f.head(), creative: { project: { filmKind: { kind: 'music_video', subtype: 'skit' } } } })), 'VALIDATION_ERROR', 'subtype belongs to its kind');
  assert.equal(f.saved().filmKind.subtype, 'performance', 'a refused change saves nothing');
  assert.ok(FILM_KINDS.includes('music_video') && FILM_KINDS.includes('explainer'));
});

test('filmKind replaces the text detection; text stays only as the fallback', () => {
  const base = { name: 'Ferry', brief: 'A music video for our song', story: '' };
  assert.equal(isMusicVideoProject(base), true);
  assert.equal(isMusicVideoProject({ ...base, filmKind: 'explainer' }), false);
  assert.equal(isMusicVideoProject({ name: 'x', brief: 'y', story: 'z', filmKind: 'music_video' }), true);
  assert.equal(isMusicVideoProject({ ...base, filmKind: { version: FILM_KIND_VERSION, kind: 'social', subtype: 'skit' } }), false);
  assert.equal(isMusicVideoProject({ ...base, filmKind: { version: FILM_KIND_VERSION, kind: 'undecided' } }), true, 'undecided falls back to the words');
  assert.equal(isMusicVideoProject({ name: 'x', brief: 'y', story: 'z', filmKind: { version: FILM_KIND_VERSION, kind: 'music_video' } }), true);
});

test('read_context exposes filmKind and what intake still has to ask; a stored pre-structure string reads as the record', async t => {
  const f = seven(t);
  const fresh = await f.openTurn().call('read_context', {});
  assert.equal(fresh.project.filmKind, null);
  assert.deepEqual(fresh.project.filmKindIntake.ask, ['kind', 'aspect'], 'kind and aspect must be settled before planning');
  const asked = { kind: 'undecided', format: { platform: 'ig_reels' }, basis: { platform: 'stated' } };
  const turn = f.openTurn();
  await turn.call('apply_change', { preparedId: (await turn.call('prepare_change', { variant: 'project', expectedHeadVersion: f.head(), creative: { project: { filmKind: asked } } })).preparedId });
  const waiting = await f.openTurn().call('read_context', {});
  assert.equal(waiting.project.filmKind.kind, 'undecided');
  assert.deepEqual(waiting.project.filmKindIntake.ask, ['kind'], 'Reels settles the aspect');
  assert.equal(waiting.project.filmKindIntake.defaults.aspect, '9:16');
  // The owner's example, saved after the person answered.
  const ig = { kind: 'social', subtype: 'skit', tones: ['comedy'], format: { platform: 'ig_reels', aspect: '9:16', targetSeconds: 20 }, audience: 'general', source: 'generated',
    basis: { kind: 'asked', subtype: 'inferred', tones: 'stated', platform: 'stated', aspect: 'default', lengthBand: 'stated', audience: 'default', source: 'default' } };
  const next = f.openTurn();
  await next.call('apply_change', { preparedId: (await next.call('prepare_change', { variant: 'project', expectedHeadVersion: f.head(), creative: { project: { filmKind: ig } } })).preparedId });
  const read = await f.openTurn().call('read_context', { section: 'overview' });
  assert.deepEqual(read.project.filmKind, { version: FILM_KIND_VERSION, ...ig, format: { ...ig.format, lengthBand: 'up_to_30s' } });
  assert.deepEqual(read.project.filmKindIntake.ask, []);
  // 7.0.0 never shipped, but a development database may hold the old flat string.
  const saved = f.store.getProject(f.project.id);
  f.store.saveProject({ ...saved, filmKind: 'music_video' }, saved.headVersion);
  assert.deepEqual(f.saved().filmKind, normalizeFilmKind('music_video'));
  assert.equal(f.saved().filmKind.kind, 'music_video');
  assert.ok(isMusicVideoProject(f.saved()));
  assert.equal((await f.openTurn().call('read_context', {})).project.filmKind.kind, 'music_video');
});

test('6.0.0 read_context has no filmKind fields', async t => {
  const f = seven(t, { version: '6.0.0' });
  const read = await f.openTurn().call('read_context', {});
  assert.equal('filmKind' in read.project, false);
  assert.equal('filmKindIntake' in read.project, false);
});

test('delete_shots writes a card; only the person\'s click deletes, with the same result and Undo as their delete', async t => {
  const director = seven(t, { count: 3 }), person = seven(t, { count: 3 });
  const turn = director.openTurn({ text: 'Delete the last shot.' }), before = shape(director.saved());
  const card = await turn.call('delete_shots', { shotIds: ['shot-2'] });
  assert.equal(card.state, 'awaiting_confirmation'); assert.equal(card.applied, false);
  assert.deepEqual(shape(director.saved()), before, 'nothing is deleted by the tool');
  const note = director.store.get('director_note', card.noteId);
  assert.deepEqual(note.choices.map(c => c.kind), ['confirm_delete_shots', 'accept']);
  // A Director cannot settle its own card: accept_proposal does not resolve notes, and another Director call cannot either.
  assert.equal(await code(director.openTurn({ text: 'yes' }).call('accept_proposal', { proposalId: note.letter })), 'NOT_FOUND');
  assert.deepEqual(shape(director.saved()), before);
  const resolved = await okJson(await resolve(director, card));
  assert.equal(resolved.state, 'resolved');
  await okJson(await human(person, { kind: 'deleteShot', id: 'shot-2' }));
  assert.deepEqual(shape(director.saved()), shape(person.saved()));
  // The deletion is one storyboard command with the person's Undo.
  const commandId = director.store.get('director_note', card.noteId).resolution.resultRef;
  await okJson(await human(director, { kind: 'undo', commandId }));
  assert.deepEqual(shape(director.saved()), before);
});

test('delete cards: keep, stale cards, multi-shot Undo and refusals', async t => {
  const f = seven(t, { count: 3 });
  const keep = await f.openTurn().call('delete_shots', { shotIds: ['shot-0'] });
  await okJson(await resolve(f, keep, 1));
  assert.ok(f.saved().shots.some(s => s.id === 'shot-0'), 'Keep deletes nothing');
  assert.equal((await resolve(f, keep, 0)).json().error.code, 'NOTE_ALREADY_SETTLED');

  const stale = await f.openTurn().call('delete_shots', { shotIds: ['shot-1'] });
  await okJson(await human(f, { kind: 'shot', id: 'shot-1', field: 'action', value: 'A different action' }));
  assert.equal((await resolve(f, stale)).json().error.code, 'NOTE_STALE');
  assert.ok(f.saved().shots.some(s => s.id === 'shot-1'));

  const before = shape(f.saved()), both = await f.openTurn().call('delete_shots', { shotIds: ['shot-0', 'shot-2'] });
  await okJson(await resolve(f, both));
  assert.deepEqual(f.saved().shots.map(s => s.id), ['shot-1']);
  await okJson(await human(f, { kind: 'undo', commandId: f.store.get('director_note', both.noteId).resolution.resultRef }));
  assert.deepEqual(shape(f.saved()), before, 'one Undo restores every shot of the card');

  assert.equal(await code(f.openTurn({ scopeIds: ['scene-0'] }).call('delete_shots', { shotIds: ['shot-1'] })), 'SCOPE_DENIED');
  assert.equal(await code(f.openTurn().call('delete_shots', { shotIds: ['missing'] })), 'NOT_FOUND');
  assert.equal(await code(f.openTurn().call('delete_scene', { sceneId: 'scene-0' })), 'SCENE_HAS_SHOTS');
  assert.equal(await code(f.openTurn({ source: 'app' }).call('delete_scene', { sceneId: 'scene-0', withShots: true })), 'ORIGIN_NOT_AUTHORIZED');
  assert.deepEqual(shape(f.saved()), before);
});

test('delete_scene card deletes the scene and its shots only on the click, like the person\'s delete', async t => {
  const director = seven(t), person = seven(t);
  const card = await director.openTurn({ scopeIds: ['scene-1'] }).call('delete_scene', { sceneId: 'scene-1', withShots: true });
  assert.ok(director.saved().scenes.some(s => s.id === 'scene-1'));
  await okJson(await resolve(director, card));
  await okJson(await human(person, { kind: 'deleteScene', id: 'scene-1', withShots: true }));
  assert.deepEqual(shape(director.saved()), shape(person.saved()));
});

test('use_take refuses takes the shot cannot use and writes no card', async t => {
  const f = seven(t), before = f.store.list('director_note', f.project.id).length;
  assert.equal(await code(f.openTurn().call('use_take', { shotId: 'shot-0', artifactId: 'unknown' })), 'NOT_FOUND');
  assert.equal(await code(f.openTurn({ scopeIds: ['scene-1'] }).call('use_take', { shotId: 'shot-0', artifactId: 'unknown' })), 'SCOPE_DENIED');
  assert.equal(f.store.list('director_note', f.project.id).length, before);
});

test('control_execution stop is the person\'s Stop; resume is a card the person confirms', async t => {
  const director = seven(t), person = seven(t);
  const stopped = await director.openTurn({ text: 'Stop everything.' }).call('control_execution', { action: 'stop' });
  assert.equal(stopped.action, 'stop');
  await okJson(await person.call('POST', '/controls', { action: 'stop' }));
  for (const f of [director, person]) {
    assert.equal(f.store.get('execution_control', f.project.id).paused, true);
    assert.ok(f.store.list('epoch', f.project.id).every(epoch => epoch.state === 'revoked'));
    assert.equal(f.store.list('execution_stop', f.project.id).length, 1);
  }
  assert.equal(await code(director.openTurn({ scopeIds: ['scene-0'] }).call('control_execution', { action: 'resume' })), 'SCOPE_DENIED');
  const card = await director.openTurn({ text: 'Continue.' }).call('control_execution', { action: 'resume' });
  assert.equal(card.state, 'awaiting_confirmation');
  assert.equal(director.store.get('execution_control', director.project.id).paused, true, 'resume starts nothing');
  await okJson(await resolve(director, card));
  assert.equal(director.store.get('execution_control', director.project.id).paused, false);
  assert.equal(await code(director.openTurn().call('control_execution', { action: 'resume' })), 'NOT_STOPPED');
  assert.equal(await code(director.openTurn({ scopeIds: ['scene-0'] }).call('control_execution', { action: 'stop' })), 'SCOPE_DENIED');
  // pause keeps its 6.0.0 meaning: a request-scoped hold.
  const holds = await director.openTurn().call('control_execution', { action: 'pause' });
  assert.ok(Array.isArray(holds) && holds.length === 1);
});

test('start_export runs the same export start as the person, under the Director call identity', async t => {
  const calls = [], exports = { start: async (projectId, input, key) => { calls.push({ projectId, input, key }); return { id: 'export-1', state: 'prepared' }; } };
  const f = seven(t, { toolOptions: { exports } });
  const result = await f.openTurn({ text: 'Export it.' }).call('start_export', {}, 'call-export');
  assert.deepEqual(result.export, { id: 'export-1', state: 'prepared' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, { expectedHeadVersion: f.head() });
  assert.match(calls[0].key, /^director-tool:/);
  assert.equal(await code(f.openTurn({ scopeIds: ['scene-0'] }).call('start_export', {})), 'SCOPE_DENIED');
  assert.equal(calls.length, 1);
  const bare = seven(t);
  assert.equal(await code(bare.openTurn().call('start_export', {})), 'TOOL_CAPABILITY_UNAVAILABLE');
  const routes = readFileSync(new URL('../dist/media/routes.js', import.meta.url), 'utf8');
  assert.match(routes, /launcher\.start\(/, 'the person\'s Export route calls the same launcher');
});

test('analyze_music is free and read-only, uses the local timing analyzer and leaves an enrichment slot', async t => {
  const f = seven(t), audio = addAudio(f); cacheTiming(f, audio);
  const before = f.saved(), cursor = f.store.cursor(f.project.id);
  const analysis = await f.openTurn({ editing: false, text: 'What is the tempo?' }).call('analyze_music', { audioId: audio });
  assert.equal(analysis.analyzer, 'local-song-timing@1');
  assert.equal(analysis.tempo.bpm, 120);
  assert.equal(analysis.durationFrames, 1800);
  assert.deepEqual(analysis.sections.map(s => [s.startSeconds, s.endSeconds]), [[0, 20], [20, 40], [40, 60]]);
  for (const section of analysis.sections) {
    assert.equal(section.suggestedShotFrames.reduce((a, b) => a + b, 0), section.endFrame - section.startFrame);
    assert.ok(section.suggestedShotFrames.every(n => n >= 90 && n <= 450));
    assert.equal(section.label, undefined, 'the local analyzer never invents labels');
  }
  assert.equal(analysis.lyrics, undefined); assert.equal(analysis.vocalRanges, undefined);
  assert.ok(analysis.fit && typeof analysis.fit.targetFrames === 'number');
  assert.deepEqual(f.saved(), before);
  assert.deepEqual(f.store.readEvents(f.project.id, cursor).map(e => e.kind).filter(kind => kind.startsWith('storyboard') || kind.startsWith('project') || kind.startsWith('human')), [], 'no domain change');
  assert.equal(await code(f.openTurn().call('analyze_music', { audioId: 'missing' })), 'NOT_FOUND');
  const uncached = addAudio(f);
  assert.equal(await code(f.openTurn().call('analyze_music', { audioId: uncached })), 'NARRATION_MEDIA_UNAVAILABLE');

  // The second slot (a later GPT-6 Astra listener) may add labels and lyrics only.
  const enriched = seven(t);
  enriched.tools = new (f.tools.constructor)(enriched.service, { musicAnalyzers: { local: new LocalMusicAnalyzer(enriched.service), enrichment: { id: 'test-listener', analyze: async () => ({
    analyzer: 'test-listener', sections: [{ label: 'verse' }, { label: 'chorus' }], lyrics: [{ startSeconds: 1, endSeconds: 2, text: 'la' }] }) } } });
  const song = addAudio(enriched); cacheTiming(enriched, song);
  const labelled = await enriched.openTurn().call('analyze_music', { audioId: song });
  assert.deepEqual(labelled.sections.map(s => s.label), ['verse', 'chorus', undefined]);
  assert.equal(labelled.tempo.bpm, 120, 'enrichment never replaces measured timing');
  assert.equal(labelled.lyrics.length, 1);
  assert.deepEqual(suggestedSectionShots(0, 60, [], null), [90]);
});

test('read_context audio_library lists owned recordings, roles, cached timing and the soundtrack', async t => {
  const f = seven(t), song = addAudio(f, { label: 'Ferry song' }), voice = addAudio(f, { label: 'Take 1', role: 'upload' });
  cacheTiming(f, song);
  await f.openTurn().call('set_soundtrack', { audioId: voice });
  const page = await f.openTurn({ editing: false }).call('read_context', { section: 'audio_library' });
  const rows = Object.fromEntries(page.items.map(row => [row.audioId, row]));
  assert.equal(rows[song].label, 'Ferry song'); assert.equal(rows[song].role, 'music'); assert.equal(rows[song].durationSeconds, 60);
  assert.deepEqual(rows[song].songTiming, { bpm: 120, sectionStartSeconds: [0, 20, 40] });
  assert.equal(rows[voice].isSoundtrack, true); assert.equal(rows[voice].role, 'music', 'choosing it as music relabels it, as for the person');
  assert.equal(page.soundtrack.audioId, voice);
});

test('character tools dispatch to the character module; mixed patches are refused before it', async t => {
  const f = seven(t), before = f.saved();
  // A patch mixing character fields with other creative fields is refused before the character module saves anything.
  assert.equal(await code(f.openTurn().call('prepare_change', { variant: 'project', expectedHeadVersion: f.head(), creative: {
    brief: 'New brief', createCharacters: [{ key: 'mara', name: 'Mara', identity: 'Tall' }] } })), 'VALIDATION_ERROR');
  assert.deepEqual(f.saved(), before);
  const empty = await f.openTurn().call('read_context', { section: 'characters' });
  assert.deepEqual(empty.characters, []);
  assert.equal(await code(f.openTurn().call('make_character_sheets', { characterIds: ['c1'] })), 'NOT_FOUND');
  const created = await f.openTurn().call('prepare_change', { variant: 'project', expectedHeadVersion: f.head(), creative: {
    createCharacters: [{ key: 'mara', name: 'Mara', identity: 'Tall, grey coat' }], updateShots: [{ id: 'shot-0', characterIds: ['mara'] }] } });
  assert.deepEqual(created.changedShotIds, ['shot-0']);
  const read = await f.openTurn().call('read_context', { section: 'characters' });
  assert.deepEqual(read.characters.map(character => character.name), ['Mara']);
  assert.deepEqual(read.casting.find(row => row.shotId === 'shot-0').characterIds, [created.keys.mara]);
});

test('7.0.0 Directors keep make_keyframes authority, and music wording no longer calls choosing a song a human action', async t => {
  const f = seven(t);
  const refusal = await code(f.openTurn().call('make_keyframes', { sceneIds: ['scene-0'] })).catch(() => null);
  assert.ok(!['ORIGIN_NOT_AUTHORIZED', 'CAPABILITY_MISMATCH'].includes(refusal), `7.0.0 epochs are authorized (${refusal})`);
  const input = readFileSync(new URL('../dist/application/director-input.js', import.meta.url), 'utf8');
  assert.doesNotMatch(input, /Music and other paid generation remain human actions/);
  for (const version of ['6.0.0', '7.0.0']) {
    const guidance = JSON.stringify(filmPlanningGuidance(f.service, f.project.id, f.openTurn().human.requestId, version));
    assert.match(guidance, /Generating new music is a paid action only the person confirms/);
    assert.match(guidance, version === '7.0.0' ? /use set_soundtrack/ : /point the person to Film/);
  }
});

test('a lost 7.0.0 edit receipt reconciles from its storyboard command without running it again', async t => {
  const f = seven(t, { count: 3 }), turn = f.openTurn(), callId = 'lost-move';
  const id = digest({ projectId: f.project.id, epochId: turn.bridge.actor.epochId, callId });
  // The transport recorded a start, the person's move command committed, and the result was lost.
  f.store.insert('tool_invocation', id, f.project.id, { id, projectId: f.project.id, requestId: turn.human.requestId, epochId: turn.bridge.actor.epochId, callId,
    tool: 'move_shot', toolContractVersion: '7.0.0', catalogDigest: toolCatalog('7.0.0').digest, skillLockId: f.lock.id,
    argumentsDigest: digest({ shotId: 'shot-2', sceneId: 'scene-0' }), state: 'started', result: null, resultDigest: null, error: null });
  const committed = editStoryboard(f.service, f.project.id, { kind: 'moveShot', id: 'shot-2', sceneId: 'scene-0', expectedHeadVersion: f.head() }, `director-tool:${id}`,
    { director: { requestId: turn.human.requestId, epochId: turn.bridge.actor.epochId, invocationId: id } });
  await assert.rejects(turn.call('move_shot', { shotId: 'shot-2', sceneId: 'scene-0' }, callId), { code: 'TOOL_CALL_UNRESOLVED' });
  await okJson(await f.call('POST', '/controls', { action: 'stop' }));
  const edits = f.store.list('storyboard_edit', f.project.id).length;
  f.tools.reconcileEpoch(f.project.id, turn.bridge.actor.epochId);
  const reconciled = f.store.get('tool_reconciliation', id);
  assert.equal(reconciled.state, 'effect_confirmed');
  assert.deepEqual(reconciled.receipt.commandIds, [committed.commandId]);
  assert.equal(f.store.list('storyboard_edit', f.project.id).length, edits);
});

test('editStoryboard deleteShots refuses duplicates and unknown shots like deleteShot', async t => {
  const f = seven(t, { count: 3 });
  assert.throws(() => editStoryboard(f.service, f.project.id, { kind: 'deleteShots', ids: ['shot-0', 'shot-0'], expectedHeadVersion: f.head() }, randomUUID()), /distinct/);
  assert.throws(() => editStoryboard(f.service, f.project.id, { kind: 'deleteShots', ids: ['nope'], expectedHeadVersion: f.head() }, randomUUID()), /does not belong/);
});

async function twoTakes(t) {
  const f = await confirmationFixture(t, { modes: ['none'] });
  await f.make(); await f.tick(5); await f.openFrames();
  await f.call('POST', '/scenes/scene-0/confirm', await f.confirmBody()).then(f.ok); await f.tick(6);
  await f.make({ targetShotIds: ['shot-0'], regenerate: true }); await f.tick(4);
  const takes = await f.call('GET', '/shots/shot-0/takes').then(f.ok);
  assert.deepEqual(takes.keyframes.map(take => take.current), [true, false]);
  f.service = f.production;
  return { f, earlier: takes.keyframes[1].artifact.artifactId };
}
const takeState = async f => { const view = (await f.call('GET', '/generation').then(f.ok)).shots['shot-0'];
  return { keyframe: view.keyframe.artifact, video: view.video.state }; };

test('use_take writes a card; the click switches to the earlier take exactly as the person\'s Use take', async t => {
  const director = await twoTakes(t), person = await twoTakes(t);
  attachDirector(director.f, { t });
  const before = await takeState(director.f);
  const card = await director.f.openTurn({ text: 'Use the first keyframe.' }).call('use_take', { shotId: 'shot-0', artifactId: director.earlier });
  assert.equal(card.state, 'awaiting_confirmation');
  assert.deepEqual(await takeState(director.f), before, 'the tool switches nothing');
  await director.f.call('POST', `/director/notes/${card.noteId}/resolve`, { choiceIndex: 0, expectedVersion: 1 }).then(director.f.ok);
  await person.f.call('POST', `/shots/shot-0/takes/${person.earlier}/use`).then(person.f.ok);
  const a = await takeState(director.f), b = await takeState(person.f);
  assert.equal(a.keyframe.artifactId, director.earlier); assert.equal(b.keyframe.artifactId, person.earlier);
  assert.equal(a.video, b.video, 'both outdate the clip the same way');
  assert.equal(await code(director.f.openTurn().call('use_take', { shotId: 'shot-0', artifactId: director.earlier })), 'ALREADY_COMPLETE');
});
