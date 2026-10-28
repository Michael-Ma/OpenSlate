import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '@openslate/core';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { startDirectorAttachmentTranscription } from '../dist/application/director-attachment-transcription.js';
import { directorTurnViews } from '../dist/application/director-turn-view.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { Engine } from '../dist/execution/engine.js';
import { GenerationOverviewReader } from '../dist/generation-overview.js';
import { ConfiguredExternalAdmission } from '../dist/execution/durable-external-admission.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { ExecutionIngestionRouter } from '../dist/execution/ingestion-router.js';
import { OpenAITranscriptionExecution } from '../dist/execution/openai-transcription-execution.js';
import { SpoolTranscriptIngestor } from '../dist/execution/spool-transcript-ingestor.js';
import { TranscriptionAudioService } from '../dist/execution/transcription-audio-service.js';
import { TranscriptionAudioStore } from '../dist/media/transcription-audio-store.js';
import { ownedTranscriptionFixture, rows } from './owned-transcription-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const privateText = 'PRIVATE_TRANSCRIPT_AND_PROVIDER_PROSE';
const raw = Buffer.from(JSON.stringify({ text: privateText, language: 'english', duration: 0.1,
  words: [{ word: privateText, start: 0, end: 0.08 }] }));
const latch = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function writable(path) {
  chmodSync(path, 0o700);
  for (const item of readdirSync(path, { withFileTypes: true })) if (item.isDirectory()) writable(join(path, item.name));
}
async function fixture(t) {
  const f = await ownedTranscriptionFixture(t), skills = mkdtempSync(join(tmpdir(), 'openslate-director-outcomes-'));
  t.after(() => { writable(skills); rmSync(skills, { recursive: true, force: true }); });
  f.human = f.production.beginRequest(f.project.id, 'human', 'Transcribe this exact attached recording.', {
    attachments: [{ artifactId: f.audio.id, sha256: f.audio.media.sha256 }],
  });
  f.actor = f.production.openEpoch(f.project.id, f.human).actor;
  const configured = createDirectorSkillLock({ repositoryRoot, snapshotRoot: skills }, '6.0.0');
  const contexts = new DirectorContextService(f.production, configured.environment);
  contexts.bootstrapLock(f.project.id, configured.lock);
  contexts.capture(f.project.id, f.actor, { lockId: configured.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  const at = new Date().toISOString();
  f.turn = { id: randomUUID(), projectId: f.project.id, requestId: f.actor.requestId, epochId: f.actor.epochId,
    runtimeId: 'scripted', state: 'completed', createdAt: at, updatedAt: at, owner: null, leaseExpiresAt: 0,
    nativeThreadId: null, nativeTurnId: null, dispatched: true, errorCode: null };
  f.store.insert('director_turn', f.turn.id, f.project.id, f.turn);
  f.inputValue = f.input();
  f.published = await startDirectorAttachmentTranscription({ service: f.production, transcriptions: f.service,
    projectId: f.project.id, actor: f.actor, key: f.inputValue.key, input: f.inputValue });
  f.outputs = new ExecutionOutputStore(f.store, { rootDir: join(f.root, 'execution-output') });
  f.files = new TranscriptionAudioStore({ rootDir: join(f.root, 'audio-derivatives') });
  f.preparation = new TranscriptionAudioService(f.store, f.media, f.files);
  f.calls = 0;
  f.fetch = async () => new Response(raw, { headers: { 'content-type': 'application/json' } });
  f.bridge = new OpenAITranscriptionExecution({ store: f.store, outputStore: f.outputs, preparation: f.preparation,
    credentials: new EnvironmentMediaCredentials(() => 'synthetic-director-transcription'),
    fetch: async (...args) => { f.calls++; return f.fetch(...args); }, timeoutMs: 1000 });
  f.engine = new Engine(f.store, f.bridge, { artifactDir: f.artifactDir, profiles: f.profiles, outputStore: f.outputs,
    outputIngestor: new ExecutionIngestionRouter({ transcription: new SpoolTranscriptIngestor(f.outputs, f.media, f.files, { artifactDir: f.artifactDir }) }),
    externalAdmission: new ConfiguredExternalAdmission(f.store, () => {}), submissionPreparation: f.bridge });
  for (const hold of rows(f, 'hold')) if (hold.active) f.engine.releaseHold(f.project.id, hold.id, hold.ownerId);
  f.read = () => directorTurnViews(f.production, f.project.id).find(turn => turn.id === f.turn.id).effects.generation[0];
  f.attempt = () => rows(f, 'attempt').filter(attempt => attempt.candidateId === f.published.receipt.candidateId).at(-1);
  return f;
}
function assertReadOnly(f, expected) {
  const before = canonical(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all()), cursor = f.store.cursor(f.project.id), calls = f.calls;
  const first = f.read(); assert.deepEqual(first.transcription, expected);
  if (first.transcription.failure) first.transcription.failure.code = 'LOCAL_MUTATION';
  assert.deepEqual(f.read().transcription, expected, 'reads return independent safe objects');
  assert.equal(canonical(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all()), before);
  assert.equal(f.store.cursor(f.project.id), cursor); assert.equal(f.calls, calls);
  assert.equal(canonical(f.read()).includes(privateText), false, 'turn effects do not contain transcript text or provider prose');
}

test('Director transcription outcome is live from queued publication through dispatch to ready without changing its stored receipt', async t => {
  const f = await fixture(t), stored = canonical(rows(f, 'director_generation_effect'));
  assertReadOnly(f, { state: 'running' });
  const entered = latch(), gate = latch();
  f.fetch = async () => { entered.resolve(); await gate.promise; return new Response(raw, { headers: { 'content-type': 'application/json' } }); };
  const running = f.engine.runReady();
  try {
    await entered.promise;
    assertReadOnly(f, { state: 'running', attemptId: f.attempt().id });
  } finally { gate.resolve(); await running; }
  assert.equal(f.attempt().phase, 'succeeded');
  assertReadOnly(f, { state: 'ready', attemptId: f.attempt().id });
  assert.equal(canonical(rows(f, 'director_generation_effect')), stored);
  assert.equal(f.calls, 1); assert.equal(rows(f, 'transcript_candidate').length, 1);
  assert.equal(f.published.effect.transcription, undefined, 'immutable publication receipts remain snapshots');
});

test('Director transcription no-answer becomes a charged terminal lost-reply failure on a later read without resubmission', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await fixture(t); f.fetch = async () => { throw Error(privateText); };
  await f.engine.runReady();
  assert.equal(f.attempt().phase, 'submission_unknown');
  assertReadOnly(f, { state: 'no_answer', attemptId: f.attempt().id });
  const marker = f.store.get('transcription_execution_dispatch', f.attempt().id);
  t.mock.timers.setTime(Date.parse(marker.createdAt) + 180001);
  f.store.put('attempt', f.attempt().id, f.project.id, { ...f.attempt(), leaseExpiresAt: 0, unknownWait: { count: 0, nextEligibleAt: 0 } });
  await f.engine.reconcile(); const attempt = f.attempt();
  assert.equal(attempt.phase, 'failed'); assert.equal(f.store.get('reservation', attempt.reservationId).state, 'charged');
  const failure = f.read().transcription?.failure;
  assert.deepEqual(failure, { code: 'SUBMISSION_RESPONSE_LOST', technical: true, retryAllowed: false,
    autoRetriesLeft: 0, charged: true, at: rows(f, 'execution_evidence').at(-1).recordedAt });
  assertReadOnly(f, { state: 'failed', attemptId: attempt.id, failure });
  for (let i = 0; i < 3; i++) { await f.engine.reconcile(); assert.equal((await f.engine.runReady()).dispatched, 0); }
  assert.equal(f.calls, 1); assert.equal(rows(f, 'attempt').length, 1);
});

test('Director transcription provider refusal exposes only allowlisted terminal metadata and released charge', async t => {
  const f = await fixture(t);
  f.fetch = async () => new Response(JSON.stringify({ error: { message: privateText, type: 'invalid_request_error', code: null } }), {
    status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'PRIVATE_RPC_BODY' },
  });
  await f.engine.runReady(); const attempt = f.attempt();
  assert.equal(attempt.phase, 'failed'); assert.equal(f.store.get('reservation', attempt.reservationId).state, 'released');
  const failure = f.read().transcription?.failure;
  assert.deepEqual(failure, { code: attempt.failure.id, technical: false, retryAllowed: false,
    autoRetriesLeft: 0, charged: false, at: rows(f, 'execution_evidence').at(-1).recordedAt });
  assertReadOnly(f, { state: 'failed', attemptId: attempt.id, failure });
  assert.equal(canonical(f.read()).includes('PRIVATE_RPC_BODY'), false);
  assert.equal(f.calls, 1);
});

test('giving up a restarted Director transcription clears the restart strip without losing its attempt or polling it twice', async t => {
  const f = await fixture(t);
  f.fetch = async () => { throw Error(privateText); };
  await f.engine.runReady();
  const attempt = f.attempt();
  assert.equal(attempt.phase, 'submission_unknown');
  f.store.put('attempt', attempt.id, f.project.id, { ...attempt, createdAt: '2000-01-01T00:00:00.000Z',
    leaseExpiresAt: 0, unknownWait: { count: 0, nextEligibleAt: 0 } });
  f.store.appendEvent(f.project.id, 'test.restarted_transcription', {});
  const reader = new GenerationOverviewReader(f.production);
  assert.deepEqual(reader.read(f.project.id).restartCasualties, [attempt.id]);
  assert.deepEqual(f.read().transcription, { state: 'no_answer', attemptId: attempt.id });
  const history = canonical(rows(f, 'director_generation_effect'));
  f.engine.releaseAttempt(f.project.id, attempt.id, 'local-user', true);
  assert.deepEqual(reader.read(f.project.id).restartCasualties, []);
  // Still polled for a late result, but no longer offered to give up again.
  assert.deepEqual(f.read().transcription, { state: 'no_answer' });
  assert.ok(f.attempt().released);
  assert.equal(f.attempt().phase, 'submission_unknown');
  assert.equal(f.store.get('reservation', attempt.reservationId).state, 'reserved');
  let lookups = 0;
  const lookup = f.bridge.lookup.bind(f.bridge);
  f.bridge.lookup = async (...args) => { lookups++; return lookup(...args); };
  await f.engine.reconcile();
  assert.equal(lookups, 1, 'the original unknown attempt remains under reconciliation');
  assert.equal(f.calls, 1, 'there is no second transcription submission');
  assert.equal(rows(f, 'attempt').length, 1);
  assert.equal(canonical(rows(f, 'director_generation_effect')), history);
  assert.deepEqual(reader.read(f.project.id).restartCasualties, []);
});

test('Director transcription outcome stays tied to the original operation across a recovered alias and later turn', async t => {
  const f = await fixture(t);
  const aliasInput = f.input({ key: 'new-call-same-recording' });
  const alias = await startDirectorAttachmentTranscription({ service: f.production, transcriptions: f.service,
    projectId: f.project.id, actor: f.actor, key: aliasInput.key, input: aliasInput });
  assert.equal(alias.receipt.candidateId, f.published.receipt.candidateId);
  f.production.beginRequest(f.project.id, 'human', 'Start another conversation after this one.');
  assertReadOnly(f, { state: 'running' });
  const original = f.store.get('director_attachment_transcription', rows(f, 'director_attachment_transcription')[0].id);
  assert.equal(original.key, f.inputValue.key);
  assert.equal(rows(f, 'director_generation_effect').length, 1);
});

test('Director transcription with missing historical linkage stays no-answer without borrowing another publication', async t => {
  const f = await fixture(t), aliasInput = f.input({ key: 'retained-alias-of-original' });
  await startDirectorAttachmentTranscription({ service: f.production, transcriptions: f.service,
    projectId: f.project.id, actor: f.actor, key: aliasInput.key, input: aliasInput });
  const original = rows(f, 'director_attachment_transcription').find(record => record.key === f.inputValue.key);
  // Adversarial historical-data damage; normal writes keep publication evidence immutable.
  f.store.db.prepare("DELETE FROM entities WHERE kind='director_attachment_transcription' AND id=?").run(original.id);
  assert.equal(rows(f, 'director_attachment_transcription').length, 1, 'a different call still names this audio and candidate');
  assertReadOnly(f, { state: 'no_answer' });
  assert.equal(f.calls, 0); assert.equal(rows(f, 'attempt').length, 0);
});
