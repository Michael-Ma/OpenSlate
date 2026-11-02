import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PROFILES, RECIPE_DIGEST, STAGE_CONTRACTS_DIGEST } from '@openslate/core';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { directorNotes, openBlockingNotes, recordNotes } from '../dist/application/director-notes.js';
import { proposeChange, proposalCommand } from '../dist/application/director-proposals.js';
import { editStoryboard } from '../dist/storyboard.js';

function fixture(t) {
  const f = setup(t), service = new ProductionService(f.store, f.engine);
  const project = f.store.getProject(f.projectId);
  f.store.insert('capability_lock', project.capabilityLockId, project.id,
    { profiles: DEFAULT_PROFILES, recipeDigest: RECIPE_DIGEST, stageContractsDigest: STAGE_CONTRACTS_DIGEST });
  for (const shot of project.shots) shot.narration = { mode: 'generated', text: 'A voice line.', voice: 'stock' };
  f.store.saveProject(project, project.headVersion);
  const human = service.beginRequest(f.projectId, 'local-user', 'Review these lines', { editing: false });
  const { actor } = service.openEpoch(f.projectId, human);
  f.store.insert('director_turn', 'note-turn', f.projectId, { id: 'note-turn', projectId: f.projectId, requestId: actor.requestId, epochId: actor.epochId, state: 'completed' });
  const note = shotId => ({ anchor: { shotIds: [shotId] }, kind: 'recommendation', blocking: true,
    text: 'Shorten this voice line.', choices: [{ kind: 'accept', label: 'Keep it' }, { kind: 'edit_field', shotId, field: 'narration' }] });
  recordNotes(service, f.projectId, actor, 'note-call', { notes: project.shots.map(shot => note(shot.id)) });
  const edit = input => editStoryboard(service, f.projectId,
    { expectedHeadVersion: f.store.getProject(f.projectId).headVersion, ...input }, randomUUID());
  return { ...f, service, edit, actor };
}

for (const writer of ['human', 'publication']) test(`a ${writer} narration-only edit stales its blocking note while preserving picture revision and sibling notes`, t => {
  const f = fixture(t), before = f.store.getProject(f.projectId), bindings = f.store.list('node_binding', f.projectId);
  const grants = f.store.list('grant', f.projectId);
  if (writer === 'human') f.edit({ kind: 'narration', id: 'shot-0', field: 'text', value: 'A revised shorter line.' });
  else {
    const actor = f.service.beginRequest(f.projectId, 'local-user', 'Apply the reviewed narration',
      { source: 'app', editing: true, concurrency: 'alongside', scopeIds: ['shot-0'] });
    f.service.publishHumanCreativePatch(f.projectId, actor,
      { updateShots: [{ id: 'shot-0', narration: { mode: 'generated', text: 'A revised shorter line.', voice: 'stock' }, reauthorPrompts: true }] });
  }
  const after = f.store.getProject(f.projectId);
  assert.equal(after.shots[0].revisionId, before.shots[0].revisionId, 'voice writing must preserve the picture revision');
  assert.deepEqual(directorNotes(f.store, f.projectId).map(note => note.state), ['stale', 'open']);
  assert.equal(openBlockingNotes(f.store, f.projectId, 'scene-0').length, 0);
  assert.equal(openBlockingNotes(f.store, f.projectId, 'scene-1').length, 1);
  assert.deepEqual(f.store.list('grant', f.projectId), grants);
  assert.equal(f.engine.attempts(f.projectId).length, 0);
  for (const binding of bindings.filter(binding => binding.node.kind === 'image'))
    assert.deepEqual(f.store.get('node_binding', binding.id), binding);
  const cursor = f.store.cursor(f.projectId);
  directorNotes(f.store, f.projectId);
  assert.equal(f.store.cursor(f.projectId), cursor, 'staleness reads do not mutate persisted history');
});

test('cross-scene movement stales a shot note without changing its frame or picture revision', t => {
  const f = fixture(t), before = f.store.getProject(f.projectId), bindings = f.store.list('node_binding', f.projectId);
  f.edit({ kind: 'moveShot', id: 'shot-0', sceneId: 'scene-1' });
  const after = f.store.getProject(f.projectId);
  assert.equal(after.shots.find(shot => shot.id === 'shot-0').revisionId, before.shots[0].revisionId);
  assert.deepEqual(directorNotes(f.store, f.projectId).map(note => note.state), ['stale', 'open']);
  for (const binding of bindings) assert.deepEqual(f.store.get('node_binding', binding.id), binding);
});

test('a picture edit stales its own note and leaves the other shot note current', t => {
  const f = fixture(t);
  f.edit({ kind: 'shot', id: 'shot-0', field: 'imagePrompt', value: 'A new close view of the boot' });
  assert.deepEqual(directorNotes(f.store, f.projectId).map(note => note.state), ['stale', 'open']);
});

test('proposal accept then Undo refreshes the reopened note basis to the restored shot', t => {
  const f = fixture(t), before = f.store.getProject(f.projectId);
  const proposal = proposeChange(f.service, f.projectId, f.actor, 'proposal-call',
    { patch: { updateShots: [{ id: 'shot-0', motion: 'Pan right' }] } });
  const receipt = recordNotes(f.service, f.projectId, f.actor, 'proposal-note-call', { notes: [{ anchor: { shotIds: ['shot-0'] },
    kind: 'recommendation', blocking: false, text: 'Use this motion.', choices: [{ kind: 'proposal', proposalId: proposal.proposalId }] }] });
  const noteId = receipt.notes[0].noteId;
  proposalCommand(f.service, f.projectId, proposal.proposalId, 'accept', 'accept-proposal', proposal.previewDigest);
  assert.equal(directorNotes(f.store, f.projectId).find(note => note.noteId === noteId).state, 'resolved');
  proposalCommand(f.service, f.projectId, proposal.proposalId, 'undo', 'undo-proposal');
  assert.equal(f.store.getProject(f.projectId).shots[0].motion, before.shots[0].motion);
  const reopened = directorNotes(f.store, f.projectId).find(note => note.noteId === noteId);
  assert.equal(reopened.state, 'open');
  assert.equal(reopened.resolution, undefined);
  assert.equal(f.engine.attempts(f.projectId).length, 0);
});

test('a note with a legacy revision-only basis stays readable and follows its original revision fence', t => {
  const f = fixture(t), note = f.store.list('director_note', f.projectId)[0];
  const basis = f.store.get('director_note_basis', note.noteId);
  f.store.put('director_note_basis', note.noteId, f.projectId,
    { ...basis, shots: basis.shots.map(({ id, revisionId }) => ({ id, revisionId })) });
  assert.equal(directorNotes(f.store, f.projectId)[0].state, 'open');
  f.edit({ kind: 'shot', id: 'shot-0', field: 'motion', value: 'Pan right' });
  assert.equal(directorNotes(f.store, f.projectId)[0].state, 'stale');
});
