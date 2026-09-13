import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest, DomainError, providerProfileArguments } from '@openslate/core';
import { registerExecutionProvider } from '@openslate/providers';
import { Engine } from '../dist/execution/engine.js';
import { Store } from '../dist/persistence/store.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { OpenAITranscriptionExecution } from '../dist/execution/openai-transcription-execution.js';
import { TranscriptionAudioService } from '../dist/execution/transcription-audio-service.js';
import { TranscriptionAudioStore } from '../dist/media/transcription-audio-store.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { SpoolTranscriptIngestor } from '../dist/execution/spool-transcript-ingestor.js';
import { ExecutionIngestionRouter } from '../dist/execution/ingestion-router.js';
import { DurableExternalAdmission } from '../dist/execution/durable-external-admission.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { ExternalAllowanceService, allowanceIssueContextDigest } from '../dist/application/external-allowances.js';
import { resolveOwnedTranscriptionAttempt } from '../dist/execution/owned-transcription-execution.js';
import { ownedTranscriptionFixture, key, rows, draft } from './owned-transcription-fixture.mjs';

const raw = Buffer.from(' \n{"text":"Hello.","language":"english","duration":0.1,"words":[{"word":"Hello.","start":0,"end":0.08}]}\n');
const data = f => ['projects', 'entities', 'commands', 'events'].map(table => f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
const current = f => rows(f, 'attempt').find(attempt => attempt.nodeId === f.node.id);
const unchangedNarration = f => canonical(['narration_state', 'narration_segment', 'narration_audio', 'narration_cue', 'narration_acceptance', 'narration_canonical']
  .map(kind => [kind, rows(f, kind)]));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function releaseHolds(f) { for (const hold of rows(f, 'hold')) if (hold.active) f.engine.releaseHold(f.project.id, hold.id, hold.ownerId); }
function editSection(f, index = 0) {
  f.human = f.production.beginRequest(f.project.id, 'human', 'Edit the selected section.');
  const view = f.narration.snapshot(f.project.id, f.human), old = view.segments[index];
  f.narration.reviseSegments(f.project.id, f.human, view.state.version, key(), { update: [{ segmentId: old.entry.segmentId, draft: draft('Changed wording.') }] });
  releaseHolds(f);
}
function due(f) {
  const attempt = current(f);
  f.store.put('attempt', attempt.id, f.project.id, { ...attempt, leaseExpiresAt: 0,
    ...(attempt.phase === 'preparing' ? { preparation: { ...attempt.preparation, nextEligibleAt: 0 } } : {}) });
}
async function fixture(t, options = {}) {
  const f = await ownedTranscriptionFixture(t, options);
  f.proposal = await f.prepare();
  f.applied = await f.service.review(f.project.id, f.human, { key: key(), proposalId: f.proposal.id, proposalDigest: digest(f.proposal) });
  f.node = f.proposal.compiled.nodes.find(node => node.alias === f.proposal.operation.alias);
  f.sourceBinding = f.store.get('owned_transcription_source', f.proposal.sourceBinding.id);
  f.calls = { http: 0, keys: 0, prepare: 0, derive: 0, upload: 0 };
  f.control = { busy: false, beforeStart: undefined, afterUpload: undefined, fetch: undefined };
  const derive = f.media.deriveTranscriptionAudio.bind(f.media);
  f.media.deriveTranscriptionAudio = async (...args) => { f.calls.derive++; return derive(...args); };
  f.outputs = new ExecutionOutputStore(f.store, { rootDir: join(f.root, 'execution-output') });
  f.files = new TranscriptionAudioStore({ rootDir: join(f.root, 'audio-derivatives') });
  f.preparation = new TranscriptionAudioService(f.store, f.media, f.files);
  const prepare = f.preparation.prepare.bind(f.preparation), upload = f.files.readUpload.bind(f.files);
  f.preparation.prepare = async (...args) => { f.calls.prepare++; if (f.control.busy) throw new DomainError('MEDIA_BUSY', 'controlled local contention'); return prepare(...args); };
  f.files.readUpload = async (...args) => { f.calls.upload++; const result = await upload(...args); if (f.control.afterUpload) await f.control.afterUpload(); return result; };
  f.bridge = new OpenAITranscriptionExecution({ store: f.store, outputStore: f.outputs, preparation: f.preparation,
    credentials: new EnvironmentMediaCredentials(() => { f.calls.keys++; return 'synthetic-owned-transcription'; }),
    fetch: async (...args) => { f.calls.http++; return f.control.fetch ? f.control.fetch(...args) : new Response(raw, { headers: { 'content-type': 'application/json' } }); }, timeoutMs: 5000 });
  const port = { identity: { adapter: 'openai-transcription', version: '1' },
    async start(...args) { if (f.control.beforeStart) await f.control.beforeStart(); return f.bridge.start(...args); },
    resume: f.bridge.resume.bind(f.bridge) };
  f.engine = new Engine(f.store, f.bridge, { artifactDir: f.artifactDir, profiles: f.profiles, outputStore: f.outputs,
    outputIngestor: new ExecutionIngestionRouter({ transcription: new SpoolTranscriptIngestor(f.outputs, f.media, f.files, { artifactDir: f.artifactDir }) }),
    externalAdmission: new DurableExternalAdmission(f.store, () => {}), submissionPreparation: port });
  releaseHolds(f);
  f.approve = () => {
    const input = { profileDigest: String(providerProfileArguments(f.profile).profileDigest), profileDefinitionDigest: digest(f.profile),
      selections: [{ candidateId: f.applied.candidateId, nodeId: f.node.id, specDigest: f.node.specDigest }], maxAttempts: 1,
      maxEstimatedMicros: '100', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    const actor = f.production.beginRequest(f.project.id, 'human', 'Approve one synthetic transcription attempt.',
      { editing: false, scopeIds: [f.project.id], contextDigest: allowanceIssueContextDigest(f.project.id, input) });
    return new ExternalAllowanceService(f.store).issue(f.project.id, actor, input);
  };
  if (options.allowance !== false) f.allowance = f.approve();
  return f;
}
function reopen(t, f) {
  f.store.close(); const store = new Store(join(f.root, 'openslate.sqlite')); t.after(() => { if (store.db.open) store.close(); });
  const outputs = new ExecutionOutputStore(store, { rootDir: join(f.root, 'execution-output') });
  const media = new LocalMediaService({ rootDir: join(f.root, 'media'), allowedInputRoots: [f.inputs], ffmpegPath: '/unavailable/ffmpeg', ffprobePath: '/unavailable/ffprobe' });
  const forbidden = () => { throw Error('completed recovery cannot submit, prepare, convert or use credentials'); };
  media.importMedia = media.deriveTranscriptionAudio = media.describeTranscriptionAudio = forbidden;
  const files = new TranscriptionAudioStore({ rootDir: join(f.root, 'audio-derivatives') });
  const bridge = registerExecutionProvider({ submit: forbidden, poll: forbidden, lookup: forbidden }, { adapter: 'openai-transcription', version: '1' });
  const engine = new Engine(store, bridge, { artifactDir: f.artifactDir, profiles: f.profiles, outputStore: outputs,
    outputIngestor: new ExecutionIngestionRouter({ transcription: new SpoolTranscriptIngestor(outputs, media, files, { artifactDir: f.artifactDir }) }) });
  return { ...f, store, engine, outputs, media, files, bridge };
}

test('uploaded recording without script executes only after review and separate finite allowance, with exact request and source identity', async t => {
  const f = await fixture(t, { allowance: false }), before = unchangedNarration(f);
  assert.equal(rows(f, 'narration_segment').length, 0); assert.equal(rows(f, 'narration_acceptance').length, 0);
  assert.equal(f.store.getProject(f.project.id).artifacts.length, 0, 'owned source is not canonical project audio');
  const blocked = await f.engine.runReady(); assert.equal(blocked.dispatched, 0); assert.equal(rows(f, 'attempt').length, 0);
  assert.equal(f.calls.http, 0); f.approve();
  let wire;
  f.control.fetch = async (url, options) => { wire = await new Request(url, options).formData(); return new Response(raw, { headers: { 'content-type': 'application/json' } }); };
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 1); assert.deepEqual(result.blocked, []);
  const attempt = current(f), candidate = rows(f, 'transcript_candidate')[0], artifact = f.store.get('artifact', candidate.artifactId);
  assert.equal(attempt.phase, 'succeeded'); assert.equal(attempt.ordinal, 1);
  assert.deepEqual(attempt.applicationInput, { version: 1, binding: { kind: 'owned_transcription', id: f.sourceBinding.id, digest: digest(f.sourceBinding) },
    application: { id: f.applied.applicationId, digest: digest(f.store.get('owned_transcription_application', f.applied.applicationId)) } });
  assert.equal(Object.hasOwn(attempt.request, 'applicationInput'), false); assert.deepEqual(attempt.request.args, f.node.args);
  assert.deepEqual(attempt.request.inputs, [f.sourceBinding.artifact]);
  assert.equal(wire.get('model'), 'whisper-1'); assert.equal(wire.has('language'), false); assert.deepEqual(wire.getAll('timestamp_granularities[]'), ['word']);
  for (const kind of ['transcription_preparation_intent', 'transcription_audio_intent']) assert.deepEqual(rows(f, kind)[0].sourceRecord, f.sourceBinding.sourceRecord);
  assert.equal(candidate.status, 'unreviewed'); assert.deepEqual(candidate.source.record, f.sourceBinding.sourceRecord);
  assert.deepEqual(attempt.outputs.cues, artifact.artifact); assert.deepEqual(readFileSync(artifact.path), raw);
  assert.equal(f.store.get('reservation', attempt.reservationId).state, 'charged'); assert.equal(rows(f, 'external_allowance_consumption').length, 1);
  assert.equal(f.calls.http, 1); assert.equal(f.calls.derive, 1); assert.equal(unchangedNarration(f), before);
  const calls = { ...f.calls }; await f.engine.reconcile(); await f.engine.runReady(); assert.deepEqual(f.calls, calls);
});

test('same owned recording retains narration provenance despite an equivalent media_source row', async t => {
  const f = await fixture(t);
  f.store.insert('media_source', f.audio.id, f.project.id, { id: f.audio.id, projectId: f.project.id, source: f.source });
  await f.engine.runReady(); assert.equal(current(f).phase, 'succeeded');
  for (const kind of ['transcription_preparation_intent', 'transcription_audio_intent']) assert.deepEqual(rows(f, kind)[0].sourceRecord, f.sourceBinding.sourceRecord);
  assert.deepEqual(rows(f, 'transcript_candidate')[0].source.record, f.sourceBinding.sourceRecord);
});

test('candidate publication rollback reopens saved result with exact owned history and no provider or conversion', async t => {
  const f = await fixture(t, { section: true }), insert = f.store.insert.bind(f.store); let injected = 0;
  f.store.insert = (...args) => { if (args[0] === 'transcript_candidate') { injected++; throw Error('INJECTED_OWNED_CANDIDATE_PUBLICATION'); } return insert(...args); };
  await assert.rejects(f.engine.runReady(), /INJECTED_OWNED_CANDIDATE_PUBLICATION/); f.store.insert = insert;
  assert.equal(injected, 1); assert.equal(current(f).phase, 'ingesting'); assert.equal(rows(f, 'transcript_candidate').length, 0);
  const identity = structuredClone(current(f).applicationInput), calls = { ...f.calls };
  editSection(f); const afterEdit = unchangedNarration(f); due(f); const g = reopen(t, f);
  assert.equal((await g.engine.reconcile()).reconciled, 1); assert.equal(current(g).phase, 'succeeded');
  assert.deepEqual(current(g).applicationInput, identity); assert.equal(rows(g, 'transcript_candidate').length, 1);
  assert.equal(unchangedNarration(g), afterEdit); assert.deepEqual(f.calls, calls); assert.equal(f.calls.http, 1); assert.equal(f.calls.derive, 1);
});

test('busy preparation resumes its same attempt, allowance and reviewed source', async t => {
  const f = await fixture(t); f.control.busy = true; await f.engine.runReady();
  const first = current(f), consumption = rows(f, 'external_allowance_consumption'); assert.equal(first.phase, 'preparing');
  assert.equal(f.calls.http, 0); assert.equal(f.calls.derive, 0); assert.equal(rows(f, 'transcription_preparation_intent').length, 1);
  f.control.busy = false; due(f); await f.engine.reconcile(); const final = current(f);
  assert.equal(final.id, first.id); assert.equal(final.phase, 'succeeded'); assert.equal(final.reservationId, first.reservationId);
  assert.deepEqual(rows(f, 'external_allowance_consumption'), consumption); assert.equal(f.calls.http, 1); assert.equal(f.calls.derive, 1);
});

for (const boundary of ['before admission', 'after admission before proof', 'waiting', 'after upload'])
test(`selected section change ${boundary} cannot authorize the first POST`, async t => {
  const f = await fixture(t, { section: true });
  if (boundary === 'before admission') editSection(f);
  if (boundary === 'after admission before proof') f.control.beforeStart = () => editSection(f);
  if (boundary === 'after upload') f.control.afterUpload = () => { f.control.afterUpload = undefined; editSection(f); };
  if (boundary === 'waiting') f.control.busy = true;
  const result = await f.engine.runReady();
  if (boundary === 'before admission') { assert.equal(result.dispatched, 0); assert.equal(rows(f, 'attempt').length, 0); assert.equal(rows(f, 'external_allowance_consumption').length, 0); }
  else {
    if (boundary === 'waiting') { editSection(f); f.control.busy = false; due(f); await f.engine.reconcile(); }
    assert.equal(current(f).phase, 'failed'); assert.equal(current(f).failure.id, 'PREPARATION_OBSOLETE');
    assert.equal(rows(f, 'transcription_preparation_intent').length, 1, 'positive no-dispatch proof retained');
    assert.equal(rows(f, 'external_allowance_consumption').length, 1); assert.equal(rows(f, 'reservation')[0].state, 'released');
  }
  assert.equal(f.calls.http, 0); assert.equal(rows(f, 'transcription_execution_dispatch').length, 0); assert.equal(rows(f, 'transcription_execution_result').length, 0);
});

test('unrelated section edit retains exact selected section eligibility', async t => {
  const f = await fixture(t, { section: true }); editSection(f, 1); await f.engine.runReady();
  assert.equal(current(f).phase, 'succeeded'); assert.equal(f.calls.http, 1);
});

test('actual late provider completion retains original history after a selected-section edit', async t => {
  const f = await fixture(t, { section: true }), entered = deferred(), release = deferred();
  f.control.fetch = async () => { entered.resolve(); await release.promise; return new Response(raw, { headers: { 'content-type': 'application/json' } }); };
  const running = f.engine.runReady(); let before;
  try { await entered.promise; editSection(f); before = unchangedNarration(f); } finally { release.resolve(); await running; }
  assert.equal(f.calls.http, 1); assert.equal(current(f).phase, 'succeeded'); assert.equal(rows(f, 'transcript_candidate')[0].status, 'unreviewed');
  assert.equal(unchangedNarration(f), before); assert.ok(resolveOwnedTranscriptionAttempt(f.store, current(f)));
});

test('missing immutable artifact bytes stop admission before allowance consumption', async t => {
  const f = await fixture(t), artifact = f.store.get('artifact', f.audio.id);
  chmodSync(artifact.path, 0o600); writeFileSync(artifact.path, Buffer.from('changed source bytes')); const before = data(f);
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 0); assert.equal(result.blocked[0].code, 'ARTIFACT_CORRUPT');
  assert.equal(rows(f, 'attempt').length, 0); assert.equal(rows(f, 'external_allowance_consumption').length, 0); assert.deepEqual(data(f), before);
});

test('direct plan replay rejects unknown grant keys and purpose-bound grant with removed or changed link', async t => {
  const f = await fixture(t), project = f.store.getProject(f.project.id), before = data(f);
  assert.throws(() => f.engine.installPlan(f.project.id, project.activePlanId, f.proposal.compiled, { unknown: f.applied.grantId }), { code: 'APPLICATION_INPUT_UNAVAILABLE' });
  for (const change of ['removed', 'different']) {
    const plan = structuredClone(f.proposal.compiled), node = plan.nodes.find(node => node.id === f.node.id);
    if (change === 'removed') delete node.applicationInput; else node.applicationInput.digest = 'f'.repeat(64);
    assert.throws(() => f.engine.installPlan(f.project.id, project.activePlanId, plan, { [node.id]: f.applied.grantId }), { code: 'APPLICATION_INPUT_UNAVAILABLE' });
  }
  assert.deepEqual(data(f), before);
});

test('a persisted candidate cannot lose its reviewed node link before source reads or admission', async t => {
  const f = await fixture(t), binding = f.store.get('node_binding', f.node.id), node = structuredClone(binding.node); delete node.applicationInput;
  f.store.put('node_binding', node.id, f.project.id, { ...binding, node }); let reads = 0;
  f.engine.resolveInputs = () => { reads++; throw Error('unreviewed input must not reach file reads'); };
  const before = data(f); assert.throws(() => f.engine.admit(f.project.id, node.id, 'unused'), { code: 'APPLICATION_INPUT_UNAVAILABLE' });
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 0); assert.equal(reads, 0); assert.deepEqual(data(f), before);
});

test('saved owned attempt metadata cannot be dropped or rebound to another application', async t => {
  const f = await fixture(t); f.control.busy = true; await f.engine.runReady(); const attempt = current(f), before = data(f);
  for (const change of ['removed', 'digest']) {
    const invalid = structuredClone(attempt); if (change === 'removed') delete invalid.applicationInput; else invalid.applicationInput.application.digest = 'f'.repeat(64);
    assert.throws(() => resolveOwnedTranscriptionAttempt(f.store, invalid), { code: 'OWNED_TRANSCRIPTION_AUTHORIZATION_INVALID' });
    assert.throws(() => f.store.put('attempt', invalid.id, f.project.id, invalid));
  }
  assert.deepEqual(data(f), before);
});

test('ordinary ProductionService shot edit retains and resumes unchanged owned transcription in its complete successor plan', async t => {
  const f = await fixture(t, { plan: true }); f.control.busy = true; await f.engine.runReady();
  const waiting = current(f), binding = f.store.get('node_binding', f.node.id), project = f.store.getProject(f.project.id);
  assert.equal(waiting.phase, 'preparing');
  const human = f.production.beginRequest(f.project.id, 'human', 'Widen the first shot while keeping the recording transcription.');
  f.production.authorize(f.project.id, human, ['image', 'video'].map(kind => ({ scopeId: project.shots[0].id, kind })), key());
  const source = f.proposal.compiled.canonicalSource.replace(JSON.stringify(f.proposal.baseProject.revisionId), JSON.stringify(project.revisionId));
  const prepared = await f.production.prepare(f.project.id, human, { variant: 'plan', expectedHeadVersion: project.headVersion, source,
    creative: { updateShots: [{ id: project.shots[0].id, framing: 'Wider framing.', reauthorPrompts: true }] } });
  const applied = f.production.apply(f.project.id, human, prepared.id), retained = f.store.get('node_binding', f.node.id);
  assert.notEqual(applied.activePlanId, project.activePlanId); assert.deepEqual(retained.node, binding.node); assert.equal(retained.candidateId, binding.candidateId);
  assert.equal(f.store.get('plan', applied.activePlanId).compiled.nodes.length, f.proposal.compiled.nodes.length);
  releaseHolds(f); f.control.busy = false; due(f); await f.engine.reconcile();
  assert.equal(current(f).id, waiting.id); assert.equal(current(f).phase, 'succeeded'); assert.equal(f.calls.http, 1);
  assert.equal(rows(f, 'external_allowance_consumption').length, 1); assert.equal(rows(f, 'owned_transcription_application').length, 1);
});
