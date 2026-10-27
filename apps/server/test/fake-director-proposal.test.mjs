import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { FakeWorkflowDirector } from '../dist/application/fake-director.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { directorProposals, proposalCommand } from '../dist/application/director-proposals.js';
import { editStoryboard } from '../dist/storyboard.js';
import { projectFixture } from './execution-fixture.mjs';

function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}

function fixture(t, { toolContract = '6.0.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-fake-proposal-'));
  const store = new Store(join(root, 'state.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') }), service = new ProductionService(store, engine);
  let project = service.createProject('Scripted typed proposal decision');
  const shape = projectFixture(project.id, 2);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId,
    shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.insert('project_revision', project.revisionId, project.id, { project });
  const prepare = createDirectorInput(service, { repositoryRoot: fileURLToPath(new URL('../../../', import.meta.url)),
    snapshotRoot: join(root, 'skills'), endpoint: 'http://127.0.0.1:3196', defaultToolContract: toolContract });
  const tools = new ToolInvocationService(service);
  const startTurn = ({ text = 'Discuss this scene', editing = false, source = 'user', review = false } = {}) => {
    const human = service.beginRequest(project.id, 'local-user', text, { source, editing, scopeIds: ['scene-0'] });
    if (review) store.insert('keyframe_review_request', human.requestId, project.id, { requestId: human.requestId, sceneId: 'scene-0' });
    const bridge = service.openEpoch(project.id, human);
    const turn = { id: randomUUID(), projectId: project.id, requestId: human.requestId, epochId: bridge.actor.epochId,
      state: 'running', runtimeId: 'fake-workflow-v1', createdAt: new Date().toISOString() };
    store.insert('director_turn', turn.id, project.id, turn);
    return { human, bridge, turn, input: prepare(turn, human, bridge) };
  };
  const propose = async ({ link = true } = {}) => {
    const seed = startTurn();
    const proposal = await tools.invoke(project.id, seed.bridge.actor, randomUUID(), 'propose_change', {
      patch: { updateShots: [{ id: 'shot-0', desiredFrames: 240 }] },
    });
    const note = link ? (await tools.invoke(project.id, seed.bridge.actor, randomUUID(), 'record_notes', { notes: [{
      anchor: { shotIds: ['shot-0'] }, kind: 'recommendation', blocking: false, text: 'Make the opening eight seconds.',
      choices: [{ kind: 'proposal', proposalId: proposal.proposalId }, { kind: 'accept', label: 'Keep timing' }],
    }] })).notes[0] : null;
    store.put('director_turn', seed.turn.id, project.id, { ...seed.turn, state: 'completed' });
    return { proposal, note };
  };
  const run = async ({ demoCommand, ...options } = {}) => {
    const active = startTurn({ editing: true, ...options }), events = [];
    if (demoCommand) store.insert('demo_command', active.human.requestId, project.id, demoCommand);
    const before = { accepted: provider.acceptedCount(), attempts: engine.attempts(project.id),
      candidates: store.list('candidate', project.id), grants: store.list('grant', project.id),
      confirmations: store.list('scene_confirmation', project.id), budget: engine.budget(project.id) };
    const result = await new FakeWorkflowDirector(service).start(active.input, { onEvent: event => events.push(event) });
    assert.deepEqual({ accepted: provider.acceptedCount(), attempts: engine.attempts(project.id),
      candidates: store.list('candidate', project.id), grants: store.list('grant', project.id),
      confirmations: store.list('scene_confirmation', project.id), budget: engine.budget(project.id) }, before,
    'a proposal decision has no paid generation effect');
    return { ...active, result, events, calls: store.list('tool_invocation', project.id).filter(call => call.requestId === active.human.requestId) };
  };
  t.after(() => { store.close(); provider.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  return { store, service, project, propose, run };
}

test('V6 fake Director accepts a named proposal from the typed message, settles its note and exposes Undo provenance', async t => {
  const f = fixture(t), { proposal, note } = await f.propose();
  const { result, human, events, calls, input } = await f.run({ text: `accept proposal ${note.letter.toUpperCase()}` });
  assert.equal(result.status, 'completed'); assert.match(result.text, /Accepted proposal A; updated duration\. Undo is available\./);
  assert.equal(events.at(-1).text, result.text);
  assert.deepEqual(calls.map(call => call.tool), ['read_context', 'accept_proposal']);
  assert.ok(calls.every(call => call.state === 'succeeded'));
  assert.deepEqual(calls[1].result.proposal.decision, { action: 'accept', actor: 'director_on_user_request', requestId: human.requestId,
    at: calls[1].result.proposal.decision.at });
  assert.equal(f.store.getProject(f.project.id).shots[0].desiredFrames, 240);
  assert.equal(f.store.get('director_note', note.noteId).resolution.resultRef, proposal.proposalId);
  assert.equal(directorProposals(f.service, f.project.id).proposals[0].state, 'accepted');
  const undone = proposalCommand(f.service, f.project.id, proposal.proposalId, 'undo', randomUUID());
  assert.equal(undone.proposal.state, 'undone');
  assert.equal(f.store.getProject(f.project.id).shots[0].desiredFrames, f.project.shots[0].desiredFrames);
  assert.equal(f.store.get('director_note', note.noteId).state, 'open');
  const context = JSON.parse(input.context);
  assert.match(context.instructions, /accept_proposal or reject_proposal with \{proposalId\}/);
  assert.match(context.instructions, /continue other requested work using the accepted prompts/i);
  assert.ok(context.instructions.includes('For video, point to the Confirm card in the chat or in Keyframes; offer a fresh one if the old one is settled or stale.'));
});

for (const verb of ['reject', 'decline']) test(`V6 fake Director handles explicit ${verb} without claiming a saved edit or Undo`, async t => {
  const f = fixture(t), { proposal, note } = await f.propose(), before = f.store.getProject(f.project.id);
  const { result, human, calls } = await f.run({ text: `${verb} proposal ${note.letter}` });
  assert.match(result.text, /Declined proposal a; the saved direction stays as it was\./);
  assert.doesNotMatch(result.text, /Undo|updated|Accepted/);
  assert.deepEqual(calls.map(call => call.tool), ['read_context', 'reject_proposal']);
  assert.deepEqual(f.store.getProject(f.project.id), before);
  const saved = directorProposals(f.service, f.project.id).proposals.find(row => row.proposalId === proposal.proposalId);
  assert.equal(saved.state, 'rejected'); assert.equal(saved.decision.requestId, human.requestId);
  assert.equal(f.store.get('director_note', note.noteId).state, 'open', 'decline matches the existing human route');
});

test('V6 fake Director accepts an unlinked proposal by exact ID', async t => {
  const f = fixture(t), { proposal } = await f.propose({ link: false });
  const { result, calls } = await f.run({ text: `accept proposal ${proposal.proposalId}` });
  assert.match(result.text, /^Accepted proposal /); assert.equal(calls[1].state, 'succeeded');
  assert.equal(f.store.getProject(f.project.id).shots[0].desiredFrames, 240);
});

for (const options of [{ source: 'app' }, { editing: false }, { review: true }]) test(`V6 fake Director truthfully reports proposal refusal for ${JSON.stringify(options)}`, async t => {
  const f = fixture(t), { note } = await f.propose(), before = f.store.getProject(f.project.id);
  const { result, calls } = await f.run({ text: `accept proposal ${note.letter}`, ...options });
  assert.match(result.text, /current state: held \(PROPOSAL_DECISION_NOT_AUTHORIZED\)\. Open the current proposal notes/);
  assert.doesNotMatch(result.text, /^Accepted|Undo is available/);
  assert.deepEqual(calls.map(call => call.tool), ['read_context'], 'authorization refuses the decision before invocation dispatch');
  assert.deepEqual(f.store.getProject(f.project.id), before);
});

for (const settled of ['accepted', 'stale']) test(`V6 fake Director reports the ${settled} state after a refused late acceptance`, async t => {
  const f = fixture(t), { proposal, note } = await f.propose();
  if (settled === 'accepted') proposalCommand(f.service, f.project.id, proposal.proposalId, 'accept', randomUUID(), proposal.previewDigest);
  else editStoryboard(f.service, f.project.id, { kind: 'shot', id: 'shot-0', field: 'desiredFrames', value: '210',
    expectedHeadVersion: f.store.getProject(f.project.id).headVersion }, randomUUID());
  const before = f.store.getProject(f.project.id), { result, calls } = await f.run({ text: `accept proposal ${note.letter}` });
  assert.match(result.text, new RegExp(`current state: ${settled} \\(PROPOSAL_STALE\\)\\. Open the current proposal notes`));
  assert.doesNotMatch(result.text, /^Accepted|Undo is available/);
  assert.equal(calls.find(call => call.tool === 'accept_proposal').state, 'failed');
  assert.deepEqual(f.store.getProject(f.project.id), before);
});

test('V6 fake Director points a missing proposal decision to current notes without inventing a preview or effect', async t => {
  const f = fixture(t), before = f.store.getProject(f.project.id);
  const { result, calls } = await f.run({ text: 'accept proposal missing' });
  assert.match(result.text, /current state: unavailable \(NOT_FOUND\)\. Open the current proposal notes and choose the proposal to act on/);
  assert.doesNotMatch(result.text, /^Accepted|Undo is available|current preview|was not accepted/);
  assert.deepEqual(calls.map(call => call.tool), ['read_context', 'accept_proposal']);
  assert.equal(calls[1].state, 'failed');
  assert.equal(directorProposals(f.service, f.project.id).proposals.length, 0);
  assert.deepEqual(f.store.getProject(f.project.id), before);
});

test('V6 fake Director preserves an unresolved acceptance receipt without retrying or denying the saved effect', async t => {
  const f = fixture(t), { note } = await f.propose(), put = f.store.put.bind(f.store);
  let lost = false;
  f.store.put = (kind, ...args) => {
    if (kind === 'tool_invocation' && args[2].tool === 'accept_proposal' && args[2].state === 'succeeded' && !lost) {
      lost = true; throw Error('synthetic lost decision receipt');
    }
    return put(kind, ...args);
  };
  let run;
  try { run = await f.run({ text: `accept proposal ${note.letter}` }); }
  finally { f.store.put = put; }
  assert.equal(lost, true);
  assert.match(run.result.text, /waiting for the service's answer\. Check the saved decision receipts; current state: accepted/);
  assert.doesNotMatch(run.result.text, /was not accepted|^Accepted|Undo is available/);
  assert.deepEqual(run.calls.map(call => call.tool), ['read_context', 'accept_proposal']);
  assert.equal(run.calls[1].state, 'unresolved');
  assert.equal(f.store.getProject(f.project.id).shots[0].desiredFrames, 240);
});

test('V5 fake Director preserves its historical path and never calls proposal-decision tools', async t => {
  const f = fixture(t, { toolContract: '5.0.0' }), { proposal, note } = await f.propose();
  const { result, calls } = await f.run({ text: `accept proposal ${note.letter}` });
  assert.doesNotMatch(result.text, /^Accepted|Undo is available/);
  assert.ok(calls.every(call => !['accept_proposal', 'reject_proposal'].includes(call.tool)));
  assert.equal(directorProposals(f.service, f.project.id).proposals.find(row => row.proposalId === proposal.proposalId).state, 'held');
});

test('scripted framing proposal reports its saved proposal and one next decision', async t => {
  const f = fixture(t), before = f.store.getProject(f.project.id);
  const { result, calls } = await f.run({ demoCommand: { action: 'close_up', shotId: 'shot-0' } });
  assert.match(result.text, /proposal is ready.*Review its Now\/After preview/);
  assert.doesNotMatch(result.text, /no replacement|has not|did not|cannot|still need/i);
  assert.deepEqual(calls.map(call => call.tool), ['read_context', 'propose_change', 'record_notes']);
  assert.ok(calls.every(call => call.state === 'succeeded'));
  assert.equal(directorProposals(f.service, f.project.id).proposals[0].state, 'held');
  assert.deepEqual(f.store.getProject(f.project.id), before);
  const note = f.service.snapshot(f.project.id).notes[0];
  assert.match(note.text, /Review the Now\/After preview before accepting/);
  assert.doesNotMatch(note.text, /no replacement|has not|did not|cannot/i);
});

test('scripted existing framing reports the current direction without a no-change disclaimer', async t => {
  const f = fixture(t), before = f.store.getProject(f.project.id);
  const { result, calls } = await f.run({ demoCommand: { action: 'wide', shotId: 'shot-0' } });
  assert.match(result.text, /already has this scripted demo direction.*Keep the current direction or choose another edit/);
  assert.doesNotMatch(result.text, /No change|no replacement|did not|cannot/i);
  assert.deepEqual(calls.map(call => call.tool), ['read_context', 'record_notes']);
  assert.equal(directorProposals(f.service, f.project.id).proposals.length, 0);
  assert.deepEqual(f.store.getProject(f.project.id), before);
  assert.doesNotMatch(f.service.snapshot(f.project.id).notes[0].text, /No change|no replacement|did not|cannot/i);
});
