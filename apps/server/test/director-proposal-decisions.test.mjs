import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FakeProvider } from '@openslate/providers';
import { verifySkillLock } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { DIRECTOR_PROJECTION_LIMITS } from '../dist/application/context-projection.js';
import { decideProposal, directorProposals } from '../dist/application/director-proposals.js';
import { createApp } from '../dist/app.js';
import { editStoryboard } from '../dist/storyboard.js';
import { projectFixture } from './execution-fixture.mjs';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}
function directorFixture(t, f, snapshotRoot, version = '6.0.0') {
  const saved = createDirectorSkillLock({ repositoryRoot, snapshotRoot }, version);
  verifySkillLock(saved.lock, saved.environment);
  const contexts = new DirectorContextService(f.service, saved.environment);
  contexts.bootstrapLock(f.project.id, saved.lock);
  f.openTurn = ({ source = 'user', editing = true, scopeIds = [f.project.id], review = false, reviewReply = false, text = 'Accept the named proposal.' } = {}) => {
    for (const prior of f.store.list('director_turn', f.project.id).filter(turn => turn.state === 'running'))
      f.store.put('director_turn', prior.id, f.project.id, { ...prior, state: 'completed' });
    const human = f.service.beginRequest(f.project.id, 'local-user', text, { source, editing, scopeIds });
    if (review) f.store.insert('keyframe_review_request', human.requestId, f.project.id,
      { requestId: human.requestId, action: 'keyframe_review', sceneId: 'scene-0', batchDigest: 'offline-review-batch' });
    if (reviewReply) {
      const reviewRequestId = randomUUID();
      f.store.insert('keyframe_review_request', reviewRequestId, f.project.id,
        { requestId: reviewRequestId, action: 'keyframe_review', sceneId: 'scene-0', batchDigest: 'offline-review-batch' });
      f.store.insert('director_question', randomUUID(), f.project.id,
        { requestId: reviewRequestId, answerRequestId: human.requestId, state: 'answered' });
    }
    const bridge = f.service.openEpoch(f.project.id, human);
    const turn = { id: randomUUID(), projectId: f.project.id, requestId: human.requestId, epochId: bridge.actor.epochId,
      state: 'running', runtimeId: 'offline-proposal-fixture', createdAt: new Date().toISOString() };
    f.store.insert('director_turn', turn.id, f.project.id, turn);
    contexts.capture(f.project.id, bridge.actor, { lockId: saved.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
    return { human, bridge, turn };
  };
  f.tools ??= new ToolInvocationService(f.service);
  f.initial = f.openTurn({ editing: false, text: 'Discuss these scenes and propose a direction.' });
  f.propose = (patch = { updateShots: [{ id: 'shot-0', desiredFrames: 240 }] }, turn = f.initial, callId = randomUUID()) =>
    f.tools.invoke(f.project.id, turn.bridge.actor, callId, 'propose_change', { patch });
  f.record = async (proposals, turn = f.initial) => {
    const result = await f.tools.invoke(f.project.id, turn.bridge.actor, randomUUID(), 'record_notes', { notes: [{
      anchor: { shotIds: ['shot-0'] }, kind: 'recommendation', blocking: false, text: 'Use the proposed direction.',
      choices: [...proposals.map(proposal => ({ kind: 'proposal', proposalId: proposal.proposalId })), { kind: 'accept', label: 'Keep it' }],
    }] });
    return f.store.get('director_note', result.notes[0].noteId);
  };
  f.decide = (turn, proposalId, action = 'accept', callId = randomUUID()) =>
    f.tools.invoke(f.project.id, turn.bridge.actor, callId, `${action}_proposal`, { proposalId });
  f.banner = (proposal, action = 'accept', key = randomUUID()) => f.call('POST', `/director/proposals/${proposal.proposalId}/${action}`,
    action === 'accept' ? { previewDigest: proposal.previewDigest } : {}, key);
  f.proposal = proposalId => directorProposals(f.service, f.project.id).proposals.find(proposal => proposal.proposalId === proposalId);
  f.acceptedEvents = () => f.store.readEvents(f.project.id).filter(event => event.kind === 'proposal.changed' && event.payload.state === 'accepted');
  return f;
}
function fixture(t, { version = '6.0.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-proposal-decisions-'));
  const store = new Store(join(root, 'state.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') }), service = new ProductionService(store, engine);
  let project = service.createProject('Proposal decisions');
  const shape = projectFixture(project.id, 2);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId,
    shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.put('project_revision', project.revisionId, project.id, { project });
  const token = 'offline-proposal-decision-local-token', app = createApp({ service, localToken: token });
  const call = (method, path, payload, key = randomUUID()) => app.inject({ method, url: `/api/projects/${project.id}${path}`,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, ...(key === null ? {} : { 'idempotency-key': key }) },
    ...(payload === undefined ? {} : { payload }) });
  t.after(async () => { await app.close(); store.close(); provider.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  return directorFixture(t, { root, store, provider, engine, service, project, call }, join(root, 'skills'), version);
}
function effectState(f) {
  return { project: f.store.getProject(f.project.id), ...Object.fromEntries(
    ['message', 'director_note', 'director_proposal', 'hold', 'grant', 'candidate', 'attempt', 'reservation', 'node_binding']
      .map(kind => [kind, f.store.list(kind, f.project.id)])) };
}
function edit(f, shotId, field, value) {
  return editStoryboard(f.service, f.project.id, { kind: 'shot', id: shotId, field, value,
    expectedHeadVersion: f.store.getProject(f.project.id).headVersion }, randomUUID());
}
function resolutionWithoutTime(note) {
  const { at, ...resolution } = note.resolution;
  assert.ok(Number.isFinite(Date.parse(at)));
  return resolution;
}

test('a typed accept applies the banner patch and note resolution, preserving human-message provenance', async t => {
  const f = fixture(t), patch = { updateShots: [{ id: 'shot-0', desiredFrames: 240, action: 'The passenger turns toward the ferry.' }] };
  const proposal = await f.propose(patch), note = await f.record([proposal]), before = f.store.getProject(f.project.id);
  const turn = f.openTurn({ text: `Accept proposal ${note.letter}, then continue.` });
  const accepted = await f.decide(turn, note.letter.toUpperCase());
  assert.equal(accepted.proposal.state, 'accepted');
  assert.equal(accepted.proposal.proposalId, proposal.proposalId);
  assert.equal(accepted.proposal.noteId, note.noteId);
  assert.equal(accepted.proposal.requestId, f.initial.human.requestId, 'the proposal retains its creation request');
  assert.deepEqual({ ...accepted.proposal.decision, at: undefined }, {
    action: 'accept', actor: 'director_on_user_request', requestId: turn.human.requestId, at: undefined,
  });
  assert.ok(Number.isFinite(Date.parse(accepted.proposal.decision.at)));
  const after = f.store.getProject(f.project.id);
  assert.equal(after.headVersion, before.headVersion + 1);
  assert.equal(after.shots[0].desiredFrames, 240);
  assert.equal(after.shots[0].action, patch.updateShots[0].action);
  assert.deepEqual(after.shots[1], before.shots[1]);
  assert.deepEqual(resolutionWithoutTime(f.store.get('director_note', note.noteId)), { choiceIndex: 0, resultRef: proposal.proposalId, elsewhere: true });
  const event = f.acceptedEvents().at(-1);
  assert.equal(event.payload.requestId, turn.human.requestId);
  assert.equal(event.payload.actor, 'director_on_user_request');
  assert.deepEqual(f.proposal(proposal.proposalId).decision, accepted.proposal.decision);
  const view = (await f.call('GET', '/director/proposals')).json().proposals.find(row => row.proposalId === proposal.proposalId);
  assert.deepEqual(view.decision, accepted.proposal.decision);
  assert.equal(f.provider.acceptedCount(), 0);
  assert.equal(f.store.list('grant', f.project.id).length, 0);

  const bannerFixture = fixture(t), bannerProposal = await bannerFixture.propose(patch), bannerNote = await bannerFixture.record([bannerProposal]);
  const banner = await bannerFixture.banner(bannerProposal);
  assert.equal(banner.statusCode, 200, banner.body);
  assert.deepEqual(banner.json().proposal.accepted.touchedFields, accepted.proposal.accepted.touchedFields);
  const bannerResolution = resolutionWithoutTime(bannerFixture.store.get('director_note', bannerNote.noteId));
  assert.deepEqual({ ...bannerResolution, resultRef: proposal.proposalId }, resolutionWithoutTime(f.store.get('director_note', note.noteId)));
  for (const field of ['desiredFrames', 'action', 'imagePrompt', 'videoPrompt'])
    assert.equal(bannerFixture.store.getProject(bannerFixture.project.id).shots[0][field], after.shots[0][field]);
});

test('a typed decline records its message and leaves the linked note open exactly as banner decline does', async t => {
  const f = fixture(t), proposal = await f.propose(), note = await f.record([proposal]);
  const turn = f.openTurn({ text: `Decline proposal ${note.letter}.` }), before = f.store.getProject(f.project.id);
  const result = await f.decide(turn, proposal.proposalId, 'reject');
  assert.equal(result.proposal.state, 'rejected');
  assert.equal(result.proposal.decision.action, 'reject');
  assert.equal(result.proposal.decision.actor, 'director_on_user_request');
  assert.equal(result.proposal.decision.requestId, turn.human.requestId);
  assert.deepEqual(f.store.getProject(f.project.id), before);
  const current = f.store.get('director_note', note.noteId);
  assert.equal(current.state, 'open'); assert.equal(current.resolution, undefined); assert.equal(current.version, note.version);
  assert.equal(f.provider.acceptedCount(), 0);
  const event = f.store.readEvents(f.project.id).findLast(row => row.kind === 'proposal.changed');
  assert.equal(event.payload.requestId, turn.human.requestId); assert.equal(event.payload.actor, 'director_on_user_request');
});

for (const action of ['accept', 'reject']) {
  for (const [label, options, mutate] of [
    ['an app-created turn', { source: 'app' }],
    ['an automatic Director turn', { source: 'director' }],
    ['a keyframe-review turn even with editing enabled', { source: 'user', editing: true, review: true }],
    ['an answer to a keyframe-review question even with editing enabled', { reviewReply: true }],
    ['a discuss-only human turn', { editing: false }],
    ['a read-only epoch despite editable request metadata', {}, (f, turn) => {
      const epoch = f.store.get('epoch', turn.bridge.actor.epochId);
      f.store.put('epoch', epoch.id, f.project.id, { ...epoch, state: 'read_only' });
    }],
  ]) test(`${action}_proposal refuses ${label} without film, note, holds or media effects`, async t => {
    const f = fixture(t), proposal = await f.propose(); await f.record([proposal]);
    const turn = f.openTurn(options); mutate?.(f, turn);
    const before = effectState(f);
    await assert.rejects(f.decide(turn, proposal.proposalId, action), { code: 'PROPOSAL_DECISION_NOT_AUTHORIZED' });
    assert.deepEqual(effectState(f), before); assert.equal(f.provider.acceptedCount(), 0);
  });
}

test('the domain decision entry point also refuses a human actor and an app-source Director actor', async t => {
  const f = fixture(t), proposal = await f.propose(), turn = f.openTurn({ source: 'app' }), before = effectState(f);
  for (const actor of [turn.human, turn.bridge.actor])
    assert.throws(() => decideProposal(f.service, f.project.id, actor, randomUUID(), { proposalId: proposal.proposalId }, 'accept'),
      { code: 'PROPOSAL_DECISION_NOT_AUTHORIZED' });
  assert.deepEqual(effectState(f), before);
});

for (const action of ['accept', 'reject']) test(`${action}_proposal cannot decide a proposal outside the current human message scope`, async t => {
  const f = fixture(t), proposal = await f.propose(), turn = f.openTurn({ scopeIds: ['scene-1'] }), before = effectState(f);
  await assert.rejects(f.decide(turn, proposal.proposalId, action), { code: 'SCOPE_DENIED' });
  assert.deepEqual(effectState(f), before);
});

test('the application accepts using the current digest after an unrelated timeline edit', async t => {
  const f = fixture(t), proposal = await f.propose(), turn = f.openTurn();
  edit(f, 'shot-1', 'desiredFrames', '210');
  const current = f.proposal(proposal.proposalId);
  assert.equal(current.state, 'held'); assert.notEqual(current.previewDigest, proposal.previewDigest);
  const result = await f.decide(turn, proposal.proposalId);
  assert.equal(result.proposal.state, 'accepted');
  assert.deepEqual(f.store.getProject(f.project.id).shots.map(shot => shot.desiredFrames), [240, 210]);
  assert.equal(f.acceptedEvents().length, 1);
});

for (const action of ['accept', 'reject']) test(`${action}_proposal refuses a proposal made stale by a touched-shot edit`, async t => {
  const f = fixture(t), proposal = await f.propose();
  edit(f, 'shot-0', 'motion', 'Human direction after the proposal');
  const turn = f.openTurn(), before = effectState(f);
  await assert.rejects(f.decide(turn, proposal.proposalId, action), { code: 'PROPOSAL_STALE' });
  assert.deepEqual(effectState(f), before); assert.equal(f.acceptedEvents().length, 0);
});

for (const state of ['accepted', 'rejected', 'undone']) test(`typed decisions refuse an already ${state} proposal`, async t => {
  const f = fixture(t), proposal = await f.propose(), turn = f.openTurn();
  await f.decide(turn, proposal.proposalId, state === 'rejected' ? 'reject' : 'accept');
  if (state === 'undone') {
    const undo = await f.banner(proposal, 'undo'); assert.equal(undo.statusCode, 200, undo.body);
  }
  const before = effectState(f);
  for (const action of ['accept', 'reject'])
    await assert.rejects(f.decide(turn, proposal.proposalId, action), { code: 'PROPOSAL_STALE' });
  assert.deepEqual(effectState(f), before);
});

test('a banner accept wins before a typed accept and the latter reports the settled refusal', async t => {
  const f = fixture(t), proposal = await f.propose(), turn = f.openTurn();
  const banner = await f.banner(proposal); assert.equal(banner.statusCode, 200, banner.body);
  const before = effectState(f);
  await assert.rejects(f.decide(turn, proposal.proposalId), { code: 'PROPOSAL_STALE' });
  assert.deepEqual(effectState(f), before); assert.equal(f.acceptedEvents().length, 1);
});

test('a typed accept wins before the banner and web Undo restores the exact fields and reopens its note', async t => {
  const f = fixture(t), proposal = await f.propose(), note = await f.record([proposal]), before = f.store.getProject(f.project.id);
  const turn = f.openTurn(), accepted = await f.decide(turn, proposal.proposalId), version = f.store.getProject(f.project.id).headVersion;
  const late = await f.banner(proposal);
  assert.equal(late.statusCode, 409, late.body); assert.equal(late.json().error.code, 'PROPOSAL_STALE');
  assert.equal(f.store.getProject(f.project.id).headVersion, version); assert.equal(f.acceptedEvents().length, 1);
  const key = randomUUID(), undone = await f.banner(proposal, 'undo', key);
  assert.equal(undone.statusCode, 200, undone.body); assert.equal(undone.json().proposal.state, 'undone');
  assert.deepEqual(undone.json().leftAlone, []);
  const restored = f.store.getProject(f.project.id);
  for (const { shotId, field } of accepted.proposal.accepted.touchedFields)
    assert.deepEqual(restored.shots.find(shot => shot.id === shotId)[field], before.shots.find(shot => shot.id === shotId)[field]);
  assert.equal(f.store.get('director_note', note.noteId).state, 'open');
  assert.equal(f.store.get('director_note', note.noteId).resolution, undefined);
  assert.deepEqual((await f.banner(proposal, 'undo', key)).json(), undone.json());
  assert.equal(f.store.getProject(f.project.id).headVersion, restored.headVersion);
});

test('simultaneous banner and typed accepts publish exactly once', async t => {
  const f = fixture(t), proposal = await f.propose(), turn = f.openTurn(), before = f.store.getProject(f.project.id);
  const results = await Promise.allSettled([f.banner(proposal), f.decide(turn, proposal.proposalId)]);
  const banner = results[0], tool = results[1];
  assert.equal(banner.status, 'fulfilled');
  const bannerAccepted = banner.value.statusCode === 200, toolAccepted = tool.status === 'fulfilled';
  assert.equal(Number(bannerAccepted) + Number(toolAccepted), 1);
  if (!bannerAccepted) assert.equal(banner.value.json().error.code, 'PROPOSAL_STALE');
  if (!toolAccepted) assert.equal(tool.reason.code, 'PROPOSAL_STALE');
  assert.equal(f.store.getProject(f.project.id).headVersion, before.headVersion + 1);
  assert.equal(f.acceptedEvents().length, 1); assert.equal(f.provider.acceptedCount(), 0);
});

test('an exact invocation replay returns its first receipt without accepting or publishing twice', async t => {
  const f = fixture(t), proposal = await f.propose(), turn = f.openTurn(), key = 'one-typed-accept';
  const first = await f.decide(turn, proposal.proposalId, 'accept', key), state = effectState(f), cursor = f.store.cursor(f.project.id);
  assert.deepEqual(await f.decide(turn, proposal.proposalId, 'accept', key), first);
  assert.deepEqual(effectState(f), state); assert.equal(f.store.cursor(f.project.id), cursor);
  await assert.rejects(f.decide(turn, proposal.proposalId, 'reject', key), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(effectState(f), state); assert.equal(f.acceptedEvents().length, 1);
});

test('a committed typed accept with a lost transport receipt reconciles without replaying the decision', async t => {
  const f = fixture(t), proposal = await f.propose(), turn = f.openTurn(), original = f.store.put.bind(f.store);
  let loseReceipt = true;
  f.store.put = (kind, id, projectId, value) => {
    if (kind === 'tool_invocation' && value.state === 'succeeded' && loseReceipt) { loseReceipt = false; throw Error('synthetic lost typed-accept receipt'); }
    return original(kind, id, projectId, value);
  };
  await assert.rejects(f.decide(turn, proposal.proposalId, 'accept', 'lost-typed-accept'), { code: 'TOOL_CALL_UNRESOLVED' });
  f.store.put = original;
  assert.equal(f.proposal(proposal.proposalId).state, 'accepted');
  const state = effectState(f), call = f.store.list('tool_invocation', f.project.id).find(row => row.callId === 'lost-typed-accept');
  await assert.rejects(f.decide(turn, proposal.proposalId, 'accept', 'lost-typed-accept'), { code: 'TOOL_CALL_UNRESOLVED' });
  const epoch = f.store.get('epoch', turn.bridge.actor.epochId);
  f.store.put('epoch', epoch.id, f.project.id, { ...epoch, state: 'revoked' });
  f.tools.reconcileEpoch(f.project.id, epoch.id); f.tools.reconcileEpoch(f.project.id, epoch.id);
  const reconciliation = f.store.get('tool_reconciliation', call.id);
  assert.equal(reconciliation.state, 'effect_confirmed');
  assert.equal(reconciliation.receipt.proposal.proposalId, proposal.proposalId);
  assert.equal(reconciliation.receipt.proposal.decision.requestId, turn.human.requestId);
  assert.deepEqual(effectState(f), state); assert.equal(f.acceptedEvents().length, 1); assert.equal(f.provider.acceptedCount(), 0);
});

test('failure to persist the authoritative decision receipt rolls back publication, notes and the nested command together', async t => {
  const f = fixture(t), proposal = await f.propose(); await f.record([proposal]);
  const turn = f.openTurn(), state = effectState(f), insert = f.store.insert.bind(f.store);
  const commandCount = () => f.store.db.prepare('SELECT COUNT(*) AS count FROM commands').get().count;
  const beforeCommands = commandCount();
  f.store.insert = (kind, ...args) => {
    if (kind === 'director_proposal_decision_receipt') throw Error('synthetic authoritative receipt persistence failure');
    return insert(kind, ...args);
  };
  await assert.rejects(f.decide(turn, proposal.proposalId, 'accept', 'decision-receipt-fails'), { code: 'TOOL_CALL_UNRESOLVED' });
  f.store.insert = insert;
  assert.deepEqual(effectState(f), state);
  assert.equal(commandCount(), beforeCommands, 'the nested proposal command and publication command both roll back');
  assert.equal(f.proposal(proposal.proposalId).state, 'held');
  assert.equal(f.store.list('director_proposal_decision_receipt', f.project.id).length, 0);
  assert.equal(f.acceptedEvents().length, 0);
  await assert.rejects(f.decide(turn, proposal.proposalId, 'accept', 'decision-receipt-fails'), { code: 'TOOL_CALL_UNRESOLVED' });
  assert.deepEqual(effectState(f), state);
  const call = f.store.list('tool_invocation', f.project.id).find(row => row.callId === 'decision-receipt-fails');
  const epoch = f.store.get('epoch', turn.bridge.actor.epochId);
  f.store.put('epoch', epoch.id, f.project.id, { ...epoch, state: 'revoked' });
  f.tools.reconcileEpoch(f.project.id, epoch.id);
  assert.equal(f.store.get('tool_reconciliation', call.id).state, 'needs_followup');
  assert.deepEqual(effectState(f), state); assert.equal(f.provider.acceptedCount(), 0);
});

test('a note letter naming several proposal choices is ambiguous while an exact proposal ID remains usable', async t => {
  const f = fixture(t), first = await f.propose(), second = await f.propose({ updateShots: [{ id: 'shot-0', desiredFrames: 270 }] });
  const note = await f.record([first, second]), turn = f.openTurn(), before = effectState(f);
  await assert.rejects(f.decide(turn, note.letter), { code: 'PROPOSAL_AMBIGUOUS' });
  assert.deepEqual(effectState(f), before);
  const result = await f.decide(turn, first.proposalId);
  assert.equal(result.proposal.state, 'accepted'); assert.equal(f.proposal(second.proposalId).state, 'rejected');
});

test('a letter reused in project history fails closed even when only one linked proposal is still held', async t => {
  const f = fixture(t), first = await f.propose(), firstNote = await f.record([first]), initialTurn = f.openTurn();
  await f.decide(initialTurn, first.proposalId, 'reject');
  const secondTurn = f.openTurn({ editing: false, text: 'Propose another duration.' });
  const second = await f.propose({ updateShots: [{ id: 'shot-0', desiredFrames: 270 }] }, secondTurn);
  const secondNote = await f.record([second], secondTurn);
  assert.equal(secondNote.letter, firstNote.letter, 'letters are assigned per turn');
  const turn = f.openTurn(), before = effectState(f);
  await assert.rejects(f.decide(turn, firstNote.letter), { code: 'PROPOSAL_AMBIGUOUS' });
  assert.deepEqual(effectState(f), before);
  assert.equal((await f.decide(turn, second.proposalId)).proposal.state, 'accepted');
});

test('V6 notes context exposes current proposal subjects, states and decision provenance without mutating them', async t => {
  const f = fixture(t), declined = await f.propose(), accepted = await f.propose({ updateShots: [{ id: 'shot-0', desiredFrames: 270 }] });
  await f.record([declined]); await f.record([accepted]);
  const turn = f.openTurn(), read = () => f.service.readContext(f.project.id, turn.bridge.actor, { section: 'notes' });
  let state = effectState(f), cursor = f.store.cursor(f.project.id), context = read();
  assert.deepEqual(context.proposals.map(proposal => [proposal.proposalId, proposal.state]).sort(),
    [[declined.proposalId, 'held'], [accepted.proposalId, 'held']].sort());
  assert.ok(context.proposals.every(proposal => proposal.preview.changes.length > 0));
  assert.equal(context.items.length, 2);
  assert.deepEqual(effectState(f), state); assert.equal(f.store.cursor(f.project.id), cursor);
  await f.decide(turn, declined.proposalId, 'reject'); await f.decide(turn, accepted.proposalId);
  state = effectState(f); cursor = f.store.cursor(f.project.id); context = read();
  for (const [proposalId, expectedState, action] of [[declined.proposalId, 'rejected', 'reject'], [accepted.proposalId, 'accepted', 'accept']]) {
    const proposal = context.proposals.find(row => row.proposalId === proposalId);
    assert.equal(proposal.state, expectedState);
    assert.equal(proposal.decision.action, action);
    assert.equal(proposal.decision.actor, 'director_on_user_request');
    assert.equal(proposal.decision.requestId, turn.human.requestId);
    assert.deepEqual(proposal.decision, f.proposal(proposalId).decision);
  }
  assert.deepEqual(effectState(f), state); assert.equal(f.store.cursor(f.project.id), cursor);
});

test('V6 notes and unlinked proposals share bounded pages with complete records and a stable data guard', async t => {
  const f = fixture(t), original = await f.propose(), note = await f.record([original]);
  const record = f.store.get('director_proposal', original.proposalId);
  for (let index = 0; index < DIRECTOR_PROJECTION_LIMITS.records + 4; index++) {
    const id = randomUUID();
    f.store.insert('director_proposal', id, f.project.id, { ...record, id, invocationId: randomUUID() });
  }
  const turn = f.openTurn(), expected = directorProposals(f.service, f.project.id).proposals;
  const state = effectState(f), cursor = f.store.cursor(f.project.id), pages = [], proposals = [], notes = [];
  let offset = 0;
  do {
    const page = f.service.readContext(f.project.id, turn.bridge.actor, { section: 'notes', offset });
    pages.push(page); proposals.push(...page.proposals); notes.push(...page.items);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= DIRECTOR_PROJECTION_LIMITS.bytes);
    assert.ok(page.page.returned <= DIRECTOR_PROJECTION_LIMITS.records);
    assert.equal(page.page.total, expected.length);
    assert.equal(page.page.offset, offset);
    assert.equal(page.coverage.proposalRecords.total, expected.length);
    assert.equal(page.coverage.proposalRecords.returned, page.proposals.length);
    if (page.page.nextOffset !== null) {
      assert.equal(page.page.nextOffset, offset + page.page.returned);
      assert.ok(page.page.nextOffset > offset, 'every nonterminal page advances');
    }
    offset = page.page.nextOffset;
  } while (offset !== null);
  assert.ok(pages.length > 1);
  assert.deepEqual(proposals, expected);
  assert.equal(new Set(proposals.map(proposal => proposal.proposalId)).size, expected.length);
  assert.deepEqual(notes.map(item => item.noteId), [note.noteId]);
  assert.ok(pages.every(page => page.guard.dataDigest === pages[0].guard.dataDigest));
  assert.ok(pages.every(page => page.guard.domainCursor === pages[0].guard.domainCursor));
  assert.deepEqual(effectState(f), state); assert.equal(f.store.cursor(f.project.id), cursor);
  const changed = f.store.get('director_proposal', expected.at(-1).proposalId);
  f.store.put('director_proposal', changed.id, f.project.id, { ...changed, state: 'rejected' });
  const refreshed = f.service.readContext(f.project.id, turn.bridge.actor, { section: 'notes' });
  assert.notEqual(refreshed.guard.dataDigest, pages[0].guard.dataDigest, 'proposal-only changes invalidate the shared notes guard');
});

test('V5 notes context keeps its prior note-only response without the V6 proposals field', async t => {
  const f = fixture(t, { version: '5.0.0' }), proposal = await f.propose(), note = await f.record([proposal]);
  const state = effectState(f), cursor = f.store.cursor(f.project.id);
  const context = f.service.readContext(f.project.id, f.initial.bridge.actor, { section: 'notes' });
  assert.equal(Object.hasOwn(context, 'proposals'), false);
  assert.deepEqual(context.items.map(item => item.noteId), [note.noteId]);
  assert.deepEqual(effectState(f), state); assert.equal(f.store.cursor(f.project.id), cursor);
});

test('accept then make_keyframes in the same typed turn generates from the accepted direction', async t => {
  const f = await confirmationFixture(t, { modes: ['none'] });
  f.service = f.production;
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'openslate-accept-then-keyframes-skills-'));
  t.after(() => { writable(snapshotRoot); rmSync(snapshotRoot, { recursive: true, force: true }); });
  f.tools = new ToolInvocationService(f.service, { narrationSpeech: f.narrationSpeech, enqueueVoice: f.runner.enqueueKeyframes });
  directorFixture(t, f, snapshotRoot);
  const before = f.store.getProject(f.project.id).shots[0];
  const proposal = await f.propose({ updateShots: [{ id: 'shot-0', action: 'The passenger steps aboard the last ferry.', framing: 'Close-up' }] });
  const note = await f.record([proposal]);
  const turn = f.openTurn({ text: `Accept proposal ${note.letter}, then generate all the new keyframes.` });
  await f.decide(turn, note.letter);
  const accepted = f.store.getProject(f.project.id).shots[0];
  assert.notEqual(accepted.imagePrompt, before.imagePrompt);
  const generation = await f.tools.invoke(f.project.id, turn.bridge.actor, 'frames-after-typed-accept', 'make_keyframes', { sceneIds: ['scene-0'] });
  assert.deepEqual(generation.refused, []); assert.equal(generation.started.length, 1);
  const image = f.store.list('node_binding', f.project.id).find(binding => binding.state === 'active' && binding.node.kind === 'image');
  assert.equal(image.node.args.prompt, accepted.imagePrompt);
  const imageGrants = f.store.list('grant', f.project.id).filter(grant => grant.kind === 'image');
  assert.equal(imageGrants.length, 1); assert.equal(imageGrants[0].authorityId, turn.human.requestId);
  await f.tick(8);
  assert.equal(f.provider.acceptedCount(), 1);
  assert.equal(f.engine.attempts(f.project.id).filter(attempt => attempt.request.kind === 'video').length, 0);
});
