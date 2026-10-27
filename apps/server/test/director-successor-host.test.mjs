import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseToolArguments } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { filmPlanningGuidance } from '../dist/application/film-planning-guidance.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { projectFixture } from './execution-fixture.mjs';

function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-successor-host-'));
  const store = new Store(join(root, 'app.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  let project = service.createProject('Successor host');
  const shape = projectFixture(project.id, 1);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId,
    shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.insert('project_revision', project.revisionId, project.id, { project });
  const config = { repositoryRoot: fileURLToPath(new URL('../../../', import.meta.url)), snapshotRoot: join(root, 'skills') };
  const saved = createDirectorSkillLock(config, '6.0.0');
  const contexts = new DirectorContextService(service, saved.environment);
  contexts.bootstrapLock(project.id, saved.lock);
  const human = service.beginRequest(project.id, 'local-user', 'Discuss this scene', { scopeIds: ['scene-0'], editing: false });
  const bridge = service.openEpoch(project.id, human);
  const turn = { id: randomUUID(), projectId: project.id, requestId: human.requestId, epochId: bridge.actor.epochId, state: 'completed' };
  store.insert('director_turn', turn.id, project.id, turn);
  contexts.capture(project.id, bridge.actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  t.after(() => { provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  return { root, store, provider, service, project, config, saved, human, bridge, turn, tools: new ToolInvocationService(service) };
}
const note = { anchor: { shotIds: ['shot-0'] }, kind: 'observation', blocking: false,
  text: 'Check the saved direction.', choices: [{ kind: 'accept', label: 'Keep it' }] };

test('6.0.0 host context names the new fields and scene actions while 5.0.0 keeps its locked wording', t => {
  const f = fixture(t);
  const old = filmPlanningGuidance(f.service, f.project.id, f.human.requestId, '5.0.0', true);
  assert.match(old.procedure.join('\n'), /For a save-only request/);
  assert.match(old.procedure.join('\n'), /locked creative schema has no separate scene title field/);
  const input = createDirectorInput(f.service, { ...f.config, endpoint: 'http://127.0.0.1:3101' })(f.turn, f.human, f.bridge);
  assert.equal(input.bridge.toolContractVersion, '6.0.0');
  const context = JSON.parse(input.context), guide = context.filmPlanning, procedure = guide.procedure.join('\n');
  assert.match(procedure, /For every writing request/);
  assert.match(procedure, /Never author image, review or video declarations/);
  assert.match(procedure, /Never combine creative edits with source/);
  assert.match(procedure, /only timeline and render source/);
  assert.match(procedure, /createScenes.title.*purpose holds the scene direction/);
  assert.match(procedure, /Coverage, timing and narration range belong in story/);
  assert.match(procedure, /1 to 3 words.*40 characters.*Close-up, Medium or Wide/);
  assert.match(procedure, /On a shot with media.*purpose, action, framing.*desiredFrames.*narration.*propose_change/);
  assert.match(procedure, /updateScenes \[\{id, title\?, purpose\?\}\]/);
  assert.match(procedure, /PROPOSAL_REQUIRED is a refused direct save/);
  assert.match(procedure, /Pure text with no media impact may apply directly/);
  assert.doesNotMatch(procedure, /locked creative schema has no separate scene title/);
  assert.match(context.instructions, /Contract 6.0.0 saves scene.title separately/);
  assert.match(guide.surface, /^Chat: typed scene confirmation choices are also available in Keyframes\. Plan: .*Keyframes: .*"Make keyframes".*"Confirm frames & generate video".*Film: .*Assets/);
  assert.match(procedure, /Listening and recording edits are optional/);
  assert.ok(f.saved.lock.skills.every(skill => skill.version === '7.0.0'));
  assert.deepEqual(parseToolArguments('record_notes', guide.notes.example, '6.0.0').arguments, guide.notes.example);
  assert.equal(f.provider.acceptedCount(), 0);
});

test('6.0.0 notes context lists saved notes and malformed notes retain a known failed receipt', async t => {
  const f = fixture(t);
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'invalid', 'record_notes', { notes: [{ ...note, anchor: { shotId: 'shot-0' } }] }), { code: 'VALIDATION_ERROR' });
  const refusal = f.store.list('tool_invocation', f.project.id).find(call => call.callId === 'invalid');
  assert.equal(refusal.state, 'failed'); assert.equal(refusal.toolContractVersion, '6.0.0');
  assert.equal(f.store.list('director_note', f.project.id).length, 0);
  const saved = await f.tools.invoke(f.project.id, f.bridge.actor, 'corrected', 'record_notes', { notes: [note] });
  const context = f.service.readContext(f.project.id, f.bridge.actor, { section: 'notes' });
  assert.ok(context.coverage.sections.includes('notes'));
  assert.equal(context.items[0].noteId, saved.notes[0].noteId);
  assert.equal(f.provider.acceptedCount(), 0);
});

for (const tool of ['record_notes', 'propose_change']) test(`6.0.0 ${tool} lost reply reconciles the exact receipt without resubmission`, async t => {
  const f = fixture(t), before = f.store.getProject(f.project.id);
  const args = tool === 'record_notes' ? { notes: [note] } : { patch: { updateShots: [{ id: 'shot-0', framing: 'Close-up', action: 'Wait at the rail' }] } };
  const kind = tool === 'record_notes' ? 'director_note' : 'director_proposal';
  const original = f.store.put.bind(f.store); let lose = true;
  f.store.put = (entityKind, ...rest) => { if (entityKind === 'tool_invocation' && lose) { lose = false; throw Error('Lost tool reply'); } return original(entityKind, ...rest); };
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'lost', tool, args), { code: 'TOOL_CALL_UNRESOLVED' });
  f.store.put = original;
  await assert.rejects(f.tools.invoke(f.project.id, f.bridge.actor, 'lost', tool, args), { code: 'TOOL_CALL_UNRESOLVED' });
  assert.equal(f.store.list(kind, f.project.id).length, 1);
  const call = f.store.list('tool_invocation', f.project.id).find(call => call.callId === 'lost');
  const epoch = f.store.get('epoch', f.bridge.actor.epochId);
  f.store.put('epoch', epoch.id, f.project.id, { ...epoch, state: 'revoked' });
  f.tools.reconcileEpoch(f.project.id, epoch.id); f.tools.reconcileEpoch(f.project.id, epoch.id);
  const result = f.store.get('tool_reconciliation', call.id);
  assert.equal(result.state, 'effect_confirmed');
  assert.ok(result.receipt);
  assert.equal(f.store.list(kind, f.project.id).length, 1);
  assert.deepEqual(f.store.getProject(f.project.id), before);
  for (const entityKind of ['grant', 'candidate', 'attempt', 'reservation']) assert.equal(f.store.list(entityKind, f.project.id).length, 0, entityKind);
  assert.equal(f.provider.acceptedCount(), 0);
});


test('contract-6 host guidance directs requested keyframes and eligible transcription while video requires a clicked chat or workspace choice', t => {
  const f = fixture(t), input = createDirectorInput(f.service, { ...f.config, endpoint: 'http://127.0.0.1:3101' })(f.turn, f.human, f.bridge);
  const context = JSON.parse(input.context), guide = context.filmPlanning.procedure.join('\n');
  assert.match(guide, /fresh human editing conversation.*make_keyframes.*sceneIds or shotIds/);
  assert.match(guide, /regenerate: true requires explicit shotIds/);
  assert.match(guide, /Report actual started keyframes, voice lines and price\/quote/);
  assert.match(guide, /per-scene refusal codes/);
  assert.match(guide, /Reviews, review replies, automatic, read-only and discuss-only turns cannot start paid work/);
  assert.match(guide, /Stop halts unsent work/);
  assert.match(guide, /audio attachment was sent with this fresh human editing request/);
  assert.match(guide, /Never automatically attach, adopt or accept its transcript/);
  assert.match(guide, /record one scene-anchored note per scene with a confirm_video choice/);
  assert.match(guide, /Confirm in this chat or in Keyframes/);
  assert.match(guide, /Offering a choice in an editing or keyframe-review turn starts nothing and costs nothing/);
  assert.match(guide, /"yes", "ok" or "go ahead" replies are not confirmation/);
  assert.match(context.instructions, /call make_keyframes for exactly those scenes or shots/);
  assert.match(context.instructions, /record a scene-anchored note for each with a confirm_video choice/);
  assert.match(context.instructions, /Chat replies such as yes, ok or go ahead are not confirmation/);
  assert.match(context.instructions, /Claim a start only after the application reports it/);
  assert.match(context.instructions, /prepare_recording_transcription may start priced owned transcription/);
  assert.doesNotMatch(context.instructions, /audio tools only prepare pending suggestions/);
  const historical = filmPlanningGuidance(f.service, f.project.id, f.human.requestId, '5.0.0', true).procedure.join('\n');
  assert.match(historical, /Only a human press may start paid speech or transcription/);
  assert.doesNotMatch(historical, /make_keyframes/);
  for (const entityKind of ['director_note', 'grant', 'candidate', 'attempt', 'reservation']) assert.equal(f.store.list(entityKind, f.project.id).length, 0, entityKind);
  assert.equal(f.provider.acceptedCount(), 0);
});
