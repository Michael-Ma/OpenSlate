import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { canonical, digest, providerProfileArguments } from '@openslate/core';
import { ExternalAllowanceService, allowanceIssueContextDigest } from '../dist/application/external-allowances.js';
import { InstallationRecoveryGuard, installRecoveryQuarantine, releaseRecovery } from '../dist/application/installation-recovery.js';
import { OwnedTranscriptionService } from '../dist/narration/owned-transcription-service.js';
import { resolveOwnedTranscriptionApplication } from '../dist/narration/owned-transcription-authorization.js';
import { ownedTranscriptionFixture, key, draft, rows, bodies, transcriptionProfile } from './owned-transcription-fixture.mjs';
import { generatedNarrationFixture, selection as generatedSelection } from './generated-narration-fixture.mjs';

const data = f => ['projects', 'entities', 'commands', 'events'].map(table =>
  canonical(f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
const authorityKinds = ['grant', 'candidate', 'prepared', 'owned_transcription_review', 'owned_transcription_application'];
const narrationKinds = ['narration_state', 'narration_segment', 'narration_audio', 'narration_cue', 'narration_revision', 'narration_acceptance', 'narration_canonical'];
const noSpending = f => {
  assert.equal(rows(f, 'external_allowance_consumption').length, 0);
  assert.equal(rows(f, 'attempt').filter(attempt => attempt.request.kind === 'transcription').length, 0);
  assert.equal(rows(f, 'reservation').filter(reservation =>
    f.store.get('attempt', reservation.attemptId)?.request.kind === 'transcription').length, 0);
};
const reviewInput = proposal => ({ key: key(), proposalId: proposal.id, proposalDigest: digest(proposal) });
async function fixture(t, options = {}) {
  const f = await ownedTranscriptionFixture(t, options);
  f.proposal = await f.prepare(); f.reviewInput = reviewInput(f.proposal);
  f.review = (input = f.reviewInput, options = {}, human = f.human) => f.service.review(f.project.id, human, input, options);
  return f;
}
function latch() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
const entered = (gate, running) => Promise.race([gate.entered, running.then(() => assert.fail('Review finished before the verification barrier'))]);
function suspendVerification(f) {
  const entered = latch(), released = latch(), original = f.media.verifiedSource.bind(f.media); let source, signal, calls = 0;
  f.media.verifiedSource = async (...args) => {
    calls++; signal = args[1]?.signal; source = await original(...args); entered.release(); await released.promise; return source;
  };
  return { entered: entered.promise, release: released.release, get source() { return source; }, get signal() { return signal; }, get calls() { return calls; } };
}
async function failWhileVerifying(f, mutate, expected, options = {}) {
  const gate = suspendVerification(f), running = f.review(f.reviewInput, options); let before;
  try { await entered(gate, running); await mutate(gate); before = data(f); gate.release(); await assert.rejects(running, expected); }
  finally { gate.release(); await running.catch(() => {}); }
  assert.deepEqual(data(f), before); noSpending(f);
}
function assertReceipt(f, result) {
  const proposal = f.proposal, source = f.store.get('owned_transcription_source', proposal.sourceBinding.id);
  const review = f.store.get('owned_transcription_review', result.reviewId), application = f.store.get('owned_transcription_application', result.applicationId);
  const grant = f.store.get('grant', result.grantId), candidate = f.store.get('candidate', result.candidateId);
  const prepared = f.store.get('prepared', result.applied.preparedId), plan = f.store.get('plan', result.applied.activePlanId);
  const node = proposal.compiled.nodes.find(node => node.alias === proposal.operation.alias);
  assert.deepEqual(Object.keys(result).sort(), ['proposalId', 'proposalDigest', 'reviewId', 'applicationId', 'grantId', 'candidateId', 'applied'].sort());
  assert.equal(result.proposalId, proposal.id); assert.equal(result.proposalDigest, digest(proposal));
  assert.equal(review.id, grant.id); assert.equal(application.id, candidate.id); assert.equal(candidate.grantId, grant.id);
  assert.equal(grant.kind, 'transcription'); assert.equal(grant.scopeId, f.project.id); assert.equal(grant.authorityId, f.human.requestId);
  assert.equal(review.requestId, f.human.requestId); assert.equal(review.principalId, f.human.principalId);
  assert.deepEqual(review.proposal, { id: proposal.id, digest: digest(proposal) });
  assert.deepEqual(review.sourceBinding, { id: source.id, digest: digest(source) });
  assert.equal(review.nodeId, node.id); assert.equal(review.specDigest, node.specDigest); assert.equal(review.compiledDigest, digest(proposal.compiled));
  assert.equal(review.grantDigest, digest(grant)); assert.equal(application.candidateDigest, digest(candidate));
  assert.deepEqual(application.review, { id: review.id, digest: digest(review) });
  assert.deepEqual(application.prepared, { id: prepared.id, digest: digest(prepared) });
  assert.deepEqual(application.plan, { id: plan.id, digest: digest(plan) });
  const revision = f.store.get('project_revision', result.applied.revisionId);
  assert.deepEqual(application.projectRevision, { id: revision.id, digest: digest(revision) });
  assert.deepEqual(application.receipt, result.applied); assert.deepEqual(plan.compiled, proposal.compiled);
  assert.equal(prepared.requestId, f.human.requestId); assert.equal(prepared.principalId, f.human.principalId); assert.equal(prepared.epochId, null);
  assert.deepEqual(prepared.grantBindings, { [node.id]: grant.id });
  assert.deepEqual(f.store.get('owned_transcription_proposal', proposal.id), proposal);
  assert.deepEqual(f.store.get('logical_ids', f.project.id).aliases, proposal.logicalIds);
  assert.equal(f.store.get('node_binding', node.id).candidateId, candidate.id);
  return { review, application, grant, candidate, prepared, plan, source, node };
}

test('upload-first human review publishes one exact grant and application without spending or narration acceptance', async t => {
  const f = await fixture(t), beforeNarration = bodies(f, narrationKinds), before = f.store.getProject(f.project.id);
  const gate = suspendVerification(f), protectedBefore = bodies(f, authorityKinds), running = f.review();
  try {
    await entered(gate, running); assert.equal(bodies(f, authorityKinds), protectedBefore); assert.deepEqual(f.store.getProject(f.project.id), before);
    assert.equal(f.provider.acceptedCount(), 0); noSpending(f); gate.release();
    const result = await running; assertReceipt(f, result);
    for (const kind of authorityKinds) assert.equal(rows(f, kind).length, 1, kind);
    assert.equal(result.applied.headVersion, before.headVersion + 1); assert.equal(bodies(f, narrationKinds), beforeNarration);
    assert.deepEqual(f.store.getProject(f.project.id).artifacts, []); assert.equal(rows(f, 'external_allowance').length, 0);
    assert.equal(f.provider.acceptedCount(), 0); noSpending(f);
  } finally { gate.release(); await running.catch(() => {}); }
});

test('full two-shot publication retains existing outputs, grants and candidates and the returned render', async t => {
  const f = await ownedTranscriptionFixture(t, { plan: true });
  assert.equal((await f.engine.runReady()).dispatched, 2); await f.engine.reconcile();
  const oldOutputs = f.engine.outputs(f.project.id), oldCandidates = rows(f, 'candidate'), oldGrants = rows(f, 'grant');
  assert.equal(oldOutputs.length, 2); const base = f.store.get('plan', f.store.getProject(f.project.id).activePlanId).compiled;
  f.proposal = await f.prepare(); f.reviewInput = reviewInput(f.proposal);
  const result = await f.service.review(f.project.id, f.human, f.reviewInput); assertReceipt(f, result);
  const current = f.store.get('plan', result.applied.activePlanId).compiled;
  assert.deepEqual(current.nodes.filter(node => node.alias !== f.proposal.operation.alias), base.nodes); assert.deepEqual(current.gates, base.gates);
  assert.equal(current.canonicalSource.split('\n').find(line => line.trim().startsWith('return')), base.canonicalSource.split('\n').find(line => line.trim().startsWith('return')));
  assert.deepEqual(f.engine.outputs(f.project.id), oldOutputs);
  for (const candidate of oldCandidates) assert.deepEqual(f.store.get('candidate', candidate.id), candidate);
  for (const grant of oldGrants) assert.deepEqual(f.store.get('grant', grant.id), grant);
  assert.equal(rows(f, 'candidate').length, oldCandidates.length + 1); assert.equal(rows(f, 'grant').length, oldGrants.length + 1);
  assert.equal(f.provider.acceptedCount(), 2); noSpending(f);
});

test('a second request appends a different recording while retaining the first reviewed node, candidate and historical chain', async t => {
  const f = await fixture(t, { plan: true }), first = await f.review(), firstProposal = f.proposal;
  const firstChain = resolveOwnedTranscriptionApplication(f.store, f.project.id, first.candidateId);
  const firstPlan = f.store.get('plan', first.applied.activePlanId).compiled;
  const priorCandidates = rows(f, 'candidate'), priorGrants = rows(f, 'grant');
  f.human = f.production.beginRequest(f.project.id, 'human', 'Also recognize this second recording without changing the first.');
  const nextActor = f.production.openEpoch(f.project.id, f.human).actor;
  const bytes = await readFile(f.originalPath), differentPath = join(f.inputs, 'second-recording.wav');
  for (let offset = 44; offset < bytes.length; offset += 2) bytes.writeInt16LE(Math.trunc(bytes.readInt16LE(offset) / 2), offset);
  await writeFile(differentPath, bytes);
  const secondAudio = await f.narration.importAudio(f.project.id, f.human, { path: differentPath, declaredOrigin: 'uploaded', key: key() });
  assert.notEqual(secondAudio.id, f.audio.id); assert.notEqual(secondAudio.media.sha256, f.audio.media.sha256);
  const before = bodies(f, ['grant', 'candidate', 'owned_transcription_review', 'owned_transcription_application']), head = f.store.getProject(f.project.id);
  f.proposal = await f.service.prepare(f.project.id, nextActor, { key: key(), expectedHeadVersion: head.headVersion, audioId: secondAudio.id,
    sourceRecordDigest: digest(secondAudio), profileId: f.profile.id, language: 'en', target: { kind: 'recording' } });
  assert.equal(bodies(f, ['grant', 'candidate', 'owned_transcription_review', 'owned_transcription_application']), before);
  assert.deepEqual(f.store.getProject(f.project.id), head);
  assert.deepEqual(f.proposal.compiled.nodes.filter(node => node.alias !== f.proposal.operation.alias), firstPlan.nodes);
  assert.deepEqual(f.proposal.compiled.gates, firstPlan.gates);
  f.reviewInput = reviewInput(f.proposal); const second = await f.review(); assertReceipt(f, second);
  assert.notEqual(second.candidateId, first.candidateId); assert.notEqual(second.grantId, first.grantId);
  for (const candidate of priorCandidates) assert.deepEqual(f.store.get('candidate', candidate.id), candidate);
  for (const grant of priorGrants) assert.deepEqual(f.store.get('grant', grant.id), grant);
  assert.deepEqual(resolveOwnedTranscriptionApplication(f.store, f.project.id, first.candidateId), firstChain);
  const secondChain = resolveOwnedTranscriptionApplication(f.store, f.project.id, second.candidateId);
  assert.equal(secondChain.source.sourceRecord.id, secondAudio.id); assert.equal(secondChain.proposal.requestId, nextActor.requestId);
  const firstNode = firstProposal.compiled.nodes.find(node => node.alias === firstProposal.operation.alias);
  assert.deepEqual(f.store.get('node_binding', firstNode.id).node, firstNode);
  assert.equal(f.store.get('node_binding', firstNode.id).candidateId, first.candidateId);
  assert.equal(f.store.get('node_binding', firstNode.id).planId, second.applied.activePlanId);
  assert.deepEqual(f.store.get('owned_transcription_proposal', firstProposal.id), firstProposal);
  assert.equal(rows(f, 'owned_transcription_source').length, 2); assert.equal(rows(f, 'owned_transcription_review').length, 2);
  assert.equal(rows(f, 'owned_transcription_application').length, 2); assert.equal(rows(f, 'candidate').length, priorCandidates.length + 1);
  assert.equal(f.provider.acceptedCount(), 0); noSpending(f);
});

test('human review of a retained generated recording preserves exact speech and normalization provenance without another call', async t => {
  const f = await generatedNarrationFixture(t, { extraProfiles: [structuredClone(transcriptionProfile)] });
  await f.narration.attachGeneratedAudio(f.project.id, f.human, generatedSelection(f));
  // This shared fixture starts its speech plan directly in Engine. Supply the
  // saved aliases that ordinary application publication already maintains.
  const active = f.store.get('plan', f.store.getProject(f.project.id).activePlanId).compiled;
  f.store.put('logical_ids', f.project.id, f.project.id, { aliases: Object.fromEntries([...active.nodes, ...active.gates].map(node => [node.alias, node.id])) });
  const prepared = await f.production.prepare(f.project.id, f.human, { variant: 'project',
    expectedHeadVersion: f.store.getProject(f.project.id).headVersion, creative: { brief: 'Keep the generated recording for recognition review.' } });
  f.production.apply(f.project.id, f.human, prepared.id);
  const service = new OwnedTranscriptionService(f.narration, join(f.root, 'artifacts')), audio = f.view().segments[0].audio;
  const artifact = f.store.get('artifact', audio.id), mediaSource = f.store.get('media_source', audio.id), originalCalls = { ...f.calls };
  const preserved = bodies(f, [...narrationKinds, 'speech_execution_mapping', 'speech_execution_dispatch', 'speech_execution_result',
    'audio_derivation_intent', 'audio_derivation_receipt', 'attempt', 'reservation', 'external_allowance', 'external_allowance_consumption']);
  f.proposal = await service.prepare(f.project.id, f.human, { key: key(), expectedHeadVersion: f.store.getProject(f.project.id).headVersion,
    audioId: audio.id, sourceRecordDigest: digest(audio), profileId: transcriptionProfile.id, language: 'auto', target: { kind: 'recording' } });
  const result = await service.review(f.project.id, f.human, reviewInput(f.proposal)); assertReceipt(f, result);
  assert.deepEqual(f.calls, originalCalls); assert.deepEqual(f.store.get('artifact', audio.id), artifact);
  assert.deepEqual(f.store.get('media_source', audio.id), mediaSource); assert.equal(artifact.origin, 'generated_audio');
  assert.equal(bodies(f, [...narrationKinds, 'speech_execution_mapping', 'speech_execution_dispatch', 'speech_execution_result',
    'audio_derivation_intent', 'audio_derivation_receipt', 'attempt', 'reservation', 'external_allowance', 'external_allowance_consumption']), preserved);
  const chain = resolveOwnedTranscriptionApplication(f.store, f.project.id, result.candidateId);
  assert.equal(chain.source.sourceRecord.digest, digest(audio)); assert.equal(chain.source.artifactRecordDigest, digest(artifact));
  assert.equal(chain.source.sourceRecord.id, audio.id); assert.equal(rows(f, 'attempt').filter(attempt => attempt.request.kind === 'transcription').length, 0);
});

test('review creates its exact grant without borrowing an earlier unused generic transcription grant', async t => {
  const f = await fixture(t), [unused] = f.production.authorize(f.project.id, f.human, [{ scopeId: f.project.id, kind: 'transcription' }], key());
  const result = await f.review(); assertReceipt(f, result); assert.notEqual(result.grantId, unused.id);
  assert.deepEqual(f.store.get('grant', unused.id), unused); assert.ok(!rows(f, 'candidate').some(candidate => candidate.grantId === unused.id));
  noSpending(f);
});

test('ordinary preparation excludes a reviewed unused grant even after its audio becomes canonical', async t => {
  const f = await fixture(t), proposal = f.proposal, node = proposal.compiled.nodes[0];
  // Trusted interrupted-publication fixture: a valid pre-install review is not
  // transferable to ordinary preparation, even without a consumed candidate.
  const grant = f.engine.createGrant(f.project.id, f.project.id, 'transcription', f.human.requestId, 'user_change');
  f.store.insert('owned_transcription_review', grant.id, f.project.id, { id: grant.id, version: 1, projectId: f.project.id,
    requestId: f.human.requestId, principalId: f.human.principalId, proposal: { id: proposal.id, digest: digest(proposal) },
    grantDigest: digest(grant), sourceBinding: proposal.sourceBinding, nodeId: node.id, specDigest: node.specDigest, compiledDigest: digest(proposal.compiled) });
  const project = f.store.getProject(f.project.id), source = f.store.get('owned_transcription_source', proposal.sourceBinding.id);
  const canonicalProject = f.store.saveProject({ ...project, revisionId: key(), artifacts: [source.artifact] }, project.headVersion);
  f.store.insert('project_revision', canonicalProject.revisionId, f.project.id, { project: canonicalProject });
  const before = data(f);
  await assert.rejects(f.production.prepare(f.project.id, f.human, { variant: 'plan', expectedHeadVersion: canonicalProject.headVersion,
    source: `definePlan({baseRevision:${JSON.stringify(canonicalProject.revisionId)}},p=>{return p.transcription("different-operation",{profile:${JSON.stringify(f.profile.id)},audio:p.asset(${JSON.stringify(f.audio.id)}),language:"auto",timing:"word",settings:{}});});` }),
  { code: 'ORIGIN_NOT_AUTHORIZED' });
  assert.deepEqual(data(f), before); assert.equal(rows(f, 'candidate').length, 0); noSpending(f);
});

test('review rejects unknown fields, accessors and a mismatched proposal digest before reading media', async t => {
  const f = await fixture(t); let getterCalls = 0, reads = 0;
  const getter = { ...f.reviewInput }; Object.defineProperty(getter, 'proposalDigest', { enumerable: true, get() { getterCalls++; return f.reviewInput.proposalDigest; } });
  f.media.verifiedSource = () => { reads++; throw Error('Invalid review cannot read media'); }; const before = data(f);
  for (const input of [{ ...f.reviewInput, grantBindings: {} }, getter, { ...f.reviewInput, proposalDigest: 'e'.repeat(64) }])
    await assert.rejects(f.review(input), error => typeof error.code === 'string' && error.code.startsWith('OWNED_TRANSCRIPTION_'));
  assert.equal(getterCalls, 0); assert.equal(reads, 0); assert.deepEqual(data(f), before);
});

for (const kind of ['director', 'read-only', 'foreign principal', 'foreign project', 'shot-only'])
test(`review rejects ${kind} authority before media reads or mutations`, async t => {
  const f = await fixture(t, { plan: kind === 'shot-only' }); let actor = f.human;
  if (kind === 'director') actor = f.actor;
  if (kind === 'read-only') actor = f.production.beginRequest(f.project.id, 'human', 'Only discuss the recording.', { editing: false });
  if (kind === 'foreign principal') actor = { ...actor, principalId: 'other-person' };
  if (kind === 'foreign project') { const project = f.production.createProject('Other'); actor = f.production.beginRequest(project.id, 'human', 'Review another project'); }
  if (kind === 'shot-only') actor = f.production.beginRequest(f.project.id, 'human', 'Only this shot.', { scopeIds: [f.project.shots[0].id] });
  let reads = 0; f.media.verifiedSource = () => { reads++; throw Error('Denied review must not read media'); };
  const before = data(f); await assert.rejects(f.review(f.reviewInput, {}, actor), { code: kind === 'shot-only' ? 'SCOPE_DENIED' : 'ACTOR_DENIED' });
  assert.equal(reads, 0); assert.deepEqual(data(f), before);
});

test('fresh explicit human review can approve a prior director proposal without rewriting its original authorship or holds', async t => {
  const f = await fixture(t), proposal = structuredClone(f.proposal), source = f.store.get('owned_transcription_source', proposal.sourceBinding.id), originalRequestId = f.human.requestId;
  f.human = f.production.beginRequest(f.project.id, 'human', 'I reviewed this exact recording and recognition plan.');
  assert.equal(f.store.get('message', originalRequestId).state, 'superseded');
  assert.equal(f.store.get('epoch', f.actor.epochId).state, 'revoked');
  const result = await f.review(); assertReceipt(f, result);
  assert.deepEqual(f.store.get('owned_transcription_proposal', proposal.id), proposal);
  assert.deepEqual(f.store.get('owned_transcription_source', source.id), source);
  assert.ok(rows(f, 'hold').some(hold => hold.ownerId === originalRequestId && hold.active));
  assert.ok(rows(f, 'hold').filter(hold => hold.ownerId === f.human.requestId).every(hold => !hold.active));
  noSpending(f);
});

test('review replay precedes missing media and later project state, while the exact key cannot change its payload', async t => {
  const f = await fixture(t), result = await f.review(), file = (await f.media.verifiedSource(f.source)).path;
  await unlink(file); const project = f.store.getProject(f.project.id); f.store.saveProject({ ...project, brief: 'Later project state.' }, project.headVersion);
  f.media.verifiedSource = () => assert.fail('Replay cannot read missing media'); const before = data(f);
  assert.deepEqual(await f.review(), result); assert.deepEqual(data(f), before);
  await assert.rejects(f.review({ ...f.reviewInput, proposalDigest: 'f'.repeat(64) }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(data(f), before); noSpending(f);
});

test('concurrent identical review commands converge on one grant, candidate and application receipt', async t => {
  const f = await fixture(t), gate = suspendVerification(f), first = f.review(), second = f.review();
  try {
    await entered(gate, first); gate.release(); const results = await Promise.all([first, second]); assert.deepEqual(results[0], results[1]);
    assertReceipt(f, results[0]); for (const kind of authorityKinds) assert.equal(rows(f, kind).length, 1, kind); noSpending(f);
  } finally { gate.release(); await Promise.allSettled([first, second]); }
});

test('even exact review replay rejects a superseded reviewer', async t => {
  const f = await fixture(t); await f.review(); f.production.beginRequest(f.project.id, 'human', 'Replace the review request.');
  const before = data(f); await assert.rejects(f.review(), { code: 'ACTOR_DENIED' }); assert.deepEqual(data(f), before);
});

test('a different command key cannot apply the same proposal twice after its reviewed head has advanced', async t => {
  const f = await fixture(t); await f.review(); const before = data(f);
  await assert.rejects(f.review({ ...f.reviewInput, key: key() }), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(data(f), before); assert.equal(rows(f, 'candidate').length, 1); assert.equal(rows(f, 'grant').length, 1); noSpending(f);
});

test('review captures original actor, exact payload, signal and artifact root before awaiting media', async t => {
  const f = await fixture(t), actor = structuredClone(f.human), input = structuredClone(f.reviewInput), originalInput = structuredClone(input);
  const controller = new AbortController(), options = { signal: controller.signal }, gate = suspendVerification(f);
  const running = f.review(input, options, actor);
  try {
    await entered(gate, running); assert.equal(gate.signal, controller.signal); input.proposalId = key(); input.proposalDigest = 'a'.repeat(64);
    actor.principalId = 'replaced-person'; options.signal = new AbortController().signal; f.service.artifactDir = join(f.parent, 'wrong-artifacts');
    gate.release(); const result = await running; assertReceipt(f, result); assert.equal(result.proposalDigest, originalInput.proposalDigest); noSpending(f);
  } finally { gate.release(); await running.catch(() => {}); }
});

test('original review cancellation survives replacing the supplied options object signal', async t => {
  const f = await fixture(t), controller = new AbortController(), options = { signal: controller.signal };
  await failWhileVerifying(f, () => { options.signal = new AbortController().signal; controller.abort(); }, { code: 'OWNED_TRANSCRIPTION_CANCELLED' }, options);
});

test('already-cancelled review performs no media read, grant issuance or command publication', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  f.media.verifiedSource = () => assert.fail('Cancelled review cannot read media'); const before = data(f);
  await assert.rejects(f.review(f.reviewInput, { signal: controller.signal }), { code: 'OWNED_TRANSCRIPTION_CANCELLED' }); assert.deepEqual(data(f), before);
});

for (const change of ['request', 'head', 'lock', 'source', 'artifact', 'section', 'stage', 'aliases'])
test(`review rejects a concurrent ${change} change after verifying the actual recording`, async t => {
  const f = await fixture(t, { section: change === 'section' });
  const expected = { request: 'ACTOR_DENIED', head: 'REVISION_CONFLICT', lock: 'CAPABILITY_MISMATCH', source: 'OWNED_TRANSCRIPTION_STALE',
    artifact: 'OWNED_TRANSCRIPTION_STALE', section: 'OWNED_TRANSCRIPTION_STALE', stage: 'STAGE_BINDING_CONFLICT', aliases: 'REVISION_CONFLICT' }[change];
  await failWhileVerifying(f, () => {
    if (change === 'request') f.production.beginRequest(f.project.id, 'human', 'Supersede the reviewing request.');
    if (change === 'head') { const p = f.store.getProject(f.project.id); f.store.saveProject({ ...p, brief: 'Concurrent edit.' }, p.headVersion); }
    if (change === 'lock') f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.recipeDigest',?) WHERE kind='capability_lock' AND id=?").run('f'.repeat(64), f.project.capabilityLockId);
    if (change === 'source') f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.declaredOrigin','generated') WHERE kind='narration_audio' AND id=?").run(f.audio.id);
    if (change === 'artifact') f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.path','/changed/recording.wav') WHERE kind='artifact' AND id=?").run(f.audio.id);
    if (change === 'section') f.revise({ update: [{ segmentId: f.view().segments[0].entry.segmentId, draft: draft('A changed selected section.') }] });
    if (change === 'stage') { const id = Object.keys(f.proposal.stageVersions)[0]; f.store.put('stage', id, f.project.id, { id, bindingVersion: (f.proposal.stageVersions[id] ?? 0) + 1 }); }
    if (change === 'aliases') f.store.put('logical_ids', f.project.id, f.project.id, { aliases: { unrelated: key() } });
  }, { code: expected });
});

test('equal-byte recording replacement still invalidates the exact reviewed section target', async t => {
  const f = await fixture(t, { section: true }), alternate = await f.narration.importAudio(f.project.id, f.human,
    { path: f.originalPath, declaredOrigin: 'uploaded', key: key() });
  assert.equal(alternate.media.sha256, f.audio.media.sha256); assert.notEqual(alternate.id, f.audio.id);
  await failWhileVerifying(f, () => f.bind(0, alternate.id), { code: 'OWNED_TRANSCRIPTION_STALE' });
});

test('unrelated section edits preserve the selected recording review and every narration choice', async t => {
  const f = await fixture(t, { section: true }), gate = suspendVerification(f), running = f.review();
  try {
    await entered(gate, running); f.revise({ update: [{ segmentId: f.view().segments[1].entry.segmentId, draft: draft('Only the other section changes.') }] });
    const before = bodies(f, narrationKinds); gate.release(); const result = await running; assertReceipt(f, result);
    assert.equal(bodies(f, narrationKinds), before); noSpending(f);
  } finally { gate.release(); await running.catch(() => {}); }
});

test('changed owned file bytes cannot pass a descriptor-only human review', async t => {
  const f = await fixture(t);
  await failWhileVerifying(f, async gate => {
    const bytes = await readFile(gate.source.path); bytes[bytes.length - 1] ^= 1;
    await chmod(gate.source.path, 0o644); await writeFile(gate.source.path, bytes);
  }, { code: 'NARRATION_ARTIFACT_INVALID' });
});

for (const change of ['head', 'cancel'])
test(`review rechecks ${change} after the actual isolated composition result arrives`, { timeout: 15000 }, async t => {
  const f = await fixture(t), controller = new AbortController(), original = Worker.prototype.on; let hit = false, before;
  t.mock.method(Worker.prototype, 'on', function(event, listener) {
    if (event !== 'message') return original.call(this, event, listener);
    return original.call(this, event, function(message) {
      if (!hit && message.ok && message.plan?.nodes.some(node => node.applicationInput)) {
        hit = true;
        if (change === 'head') { const p = f.store.getProject(f.project.id); f.store.saveProject({ ...p, brief: 'Changed as compilation finishes.' }, p.headVersion); }
        else controller.abort();
        before = data(f);
      }
      listener.call(this, message);
    });
  });
  await assert.rejects(f.review(f.reviewInput, { signal: controller.signal }), { code: change === 'head' ? 'REVISION_CONFLICT' : 'OWNED_TRANSCRIPTION_CANCELLED' });
  assert.equal(hit, true); assert.deepEqual(data(f), before); noSpending(f);
});

for (const boundary of ['grant', 'owned_transcription_review', 'prepared', 'candidate', 'plan', 'owned_transcription_application', 'command'])
test(`failure after ${boundary} publication rolls back all authority, holds, project and command state`, async t => {
  const f = await fixture(t), previousRequest = f.human.requestId;
  f.human = f.production.beginRequest(f.project.id, 'human', 'Review the exact proposal with my new request.');
  const before = data(f), insert = f.store.insert.bind(f.store), sql = f.store.db.prepare.bind(f.store.db), failure = Error(`injected ${boundary} failure`); let hits = 0;
  f.store.insert = (...args) => { const result = insert(...args); if (args[0] === boundary) { hits++; throw failure; } return result; };
  f.store.db.prepare = statement => {
    const compiled = sql(statement);
    if (boundary === 'command' && statement.startsWith('INSERT INTO commands(')) return { run: (...args) => { compiled.run(...args); hits++; throw failure; } };
    return compiled;
  };
  try { await assert.rejects(f.review(), error => error === failure); }
  finally { f.store.insert = insert; f.store.db.prepare = sql; }
  assert.equal(hits, 1); assert.deepEqual(data(f), before); noSpending(f);
  const result = await f.review(); assertReceipt(f, result); for (const kind of authorityKinds) assert.equal(rows(f, kind).length, 1, kind);
  assert.ok(rows(f, 'hold').some(hold => hold.ownerId === previousRequest && hold.active));
  assert.ok(rows(f, 'hold').filter(hold => hold.ownerId === f.human.requestId).every(hold => !hold.active));
  const saved = data(f); assert.deepEqual(await f.review(), result); assert.deepEqual(data(f), saved); noSpending(f);
});

for (const boundary of ['owned_transcription_application', 'command'])
test(`original cancellation after ${boundary} insertion still rolls back the complete human publication`, async t => {
  const f = await fixture(t), controller = new AbortController(), options = { signal: controller.signal }, before = data(f);
  const insert = f.store.insert.bind(f.store), sql = f.store.db.prepare.bind(f.store.db); let hits = 0;
  const cancel = () => { hits++; options.signal = new AbortController().signal; controller.abort(); };
  f.store.insert = (...args) => { const result = insert(...args); if (args[0] === boundary) cancel(); return result; };
  f.store.db.prepare = statement => {
    const compiled = sql(statement);
    if (boundary === 'command' && statement.startsWith('INSERT INTO commands(')) return { run: (...args) => { const result = compiled.run(...args); cancel(); return result; } };
    return compiled;
  };
  try { await assert.rejects(f.review(f.reviewInput, options), { code: 'OWNED_TRANSCRIPTION_CANCELLED' }); }
  finally { f.store.insert = insert; f.store.db.prepare = sql; }
  assert.equal(hits, 1); assert.deepEqual(data(f), before); noSpending(f);
  assertReceipt(f, await f.review()); assert.equal(rows(f, 'candidate').length, 1); noSpending(f);
});

test('a separate exact one-start spending allowance does not create another candidate or automatically execute review', async t => {
  const f = await fixture(t), result = await f.review(); assertReceipt(f, result); noSpending(f);
  const node = f.proposal.compiled.nodes.find(node => node.alias === f.proposal.operation.alias), allowances = new ExternalAllowanceService(f.store);
  const input = { profileDigest: providerProfileArguments(f.profile).profileDigest, profileDefinitionDigest: digest(f.profile),
    selections: [{ candidateId: result.candidateId, nodeId: node.id, specDigest: node.specDigest }], maxAttempts: 1,
    maxEstimatedMicros: f.profile.unitCostMicros, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const before = bodies(f, [...authorityKinds, ...narrationKinds, 'hold', 'epoch']), project = f.store.getProject(f.project.id);
  const human = f.production.beginRequest(f.project.id, 'human', 'Approve this exact one-start recognition estimate.',
    { editing: false, contextDigest: allowanceIssueContextDigest(f.project.id, input) });
  const allowance = allowances.issue(f.project.id, human, input), summary = allowances.list(f.project.id, human)[0];
  assert.equal(allowance.maxAttempts, 1); assert.equal(summary.remainingAttempts, 1); assert.equal(summary.usedAttempts, 0);
  assert.equal(summary.remainingEstimatedMicros, f.profile.unitCostMicros); assert.deepEqual(f.store.getProject(f.project.id), project);
  assert.equal(bodies(f, [...authorityKinds, ...narrationKinds, 'hold', 'epoch']), before); assert.equal(f.provider.acceptedCount(), 0); noSpending(f);
});

test('released restoration cannot turn an imported ungranted proposal into fresh human generation authority', async t => {
  const f = await fixture(t);
  installRecoveryQuarantine(f.store, { restoreId: key(), backupId: key(), backupManifestSha256: 'a'.repeat(64), sourceDatabaseSha256: 'b'.repeat(64),
    originalDataRoot: f.root, backupCreatedAt: '2026-09-12T00:00:00.000Z', restoredAt: '2026-09-13T00:00:00.000Z' });
  const guard = new InstallationRecoveryGuard(f.store), view = guard.snapshot();
  releaseRecovery(f.store, { restoreId: view.receipt.restoreId, expectedReceiptDigest: view.receiptDigest, expectedSummaryDigest: view.summaryDigest },
    { principalId: 'human', commandId: key() });
  f.human = f.production.beginRequest(f.project.id, 'human', 'Fresh review cannot revive imported approval.');
  const before = data(f); await assert.rejects(f.review(), { code: 'RESTORED_AUTHORITY_REQUIRES_NEW' });
  assert.deepEqual(data(f), before); noSpending(f);
});
