import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest } from '@openslate/core';
import { registerExecutionProvider } from '@openslate/providers';
import { Engine } from '../dist/execution/engine.js';
import { ExecutionIngestionRouter } from '../dist/execution/ingestion-router.js';
import { SpoolTranscriptIngestor } from '../dist/execution/spool-transcript-ingestor.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { DurableExternalAdmission } from '../dist/execution/durable-external-admission.js';
import { Store } from '../dist/persistence/store.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { TranscriptionAudioStore } from '../dist/media/transcription-audio-store.js';
import { transcriptionFixture, context, rows, raw, hash } from './transcription-execution-fixture.mjs';

const protectedState = f => canonical({ project: f.store.getProject(f.project.id),
  narration: ['narration_state', 'narration_segment', 'narration_audio', 'narration_cue', 'narration_acceptance', 'hold', 'approval']
    .map(kind => [kind, rows(f, kind)]) });
function ingester(f) { return new SpoolTranscriptIngestor(f.outputs, f.media, f.files, { artifactDir: f.artifactRoot }); }
function executor(f, handler = ingester(f), provider = f.bridge) {
  return new Engine(f.store, provider, { artifactDir: f.artifactRoot, profiles: [f.profile], outputStore: f.outputs,
    outputIngestor: new ExecutionIngestionRouter({ transcription: handler }),
    externalAdmission: new DurableExternalAdmission(f.store, () => {}) });
}
function expire(f) {
  const attempt = rows(f, 'attempt')[0]; f.store.put('attempt', attempt.id, f.project.id, { ...attempt, leaseExpiresAt: 0 }); return attempt;
}
function recovery(f) {
  f.store.close(); const store = new Store(f.path); f.stores.push(store);
  const outputs = new ExecutionOutputStore(store, { rootDir: join(f.directory, 'execution-output') });
  const media = new LocalMediaService({ rootDir: join(f.directory, 'media'), allowedInputRoots: [f.directory],
    ffmpegPath: '/unavailable-after-reopen/ffmpeg', ffprobePath: '/unavailable-after-reopen/ffprobe' });
  for (const method of ['importMedia', 'deriveTranscriptionAudio', 'describeTranscriptionAudio']) media[method] = async () => { throw Error('recovery cannot convert or probe'); };
  const files = new TranscriptionAudioStore({ rootDir: join(f.directory, 'audio-derivatives') });
  const forbidden = () => { throw Error('completed spool recovery cannot call the provider'); };
  const bridge = registerExecutionProvider({ submit: forbidden, lookup: forbidden, poll: forbidden }, { adapter: 'openai-transcription', version: '1' });
  return { ...f, store, outputs, media, files, bridge };
}

test('actual Engine publishes one exact unreviewed candidate and settles only after complete ingestion', async t => {
  const f = await transcriptionFixture(t, { deferAdmission: true }), before = protectedState(f), engine = executor(f);
  await engine.runReady();
  const attempt = rows(f, 'attempt')[0], candidate = rows(f, 'transcript_candidate')[0], artifact = f.store.get('artifact', candidate.artifactId);
  assert.equal(attempt.phase, 'succeeded'); assert.equal(f.store.get('reservation', attempt.reservationId).state, 'charged');
  assert.equal(rows(f, 'transcript_candidate').length, 1); assert.equal(candidate.status, 'unreviewed');
  assert.equal(candidate.raw.sha256, hash(raw)); assert.deepEqual(readFileSync(artifact.path), raw);
  assert.equal(artifact.origin, 'transcription_response'); assert.equal(artifact.transcriptCandidateId, candidate.id);
  assert.equal(artifact.artifact.kind, 'data'); assert.equal(artifact.physicalDurationSeconds, null);
  assert.deepEqual(attempt.outputs.cues, artifact.artifact); assert.deepEqual(f.store.get('node_binding', f.node.id).outputs.cues, artifact.artifact);
  assert.equal(rows(f, 'media_source').length, 0, 'a transcript never creates a media source');
  assert.equal(protectedState(f), before);
  const calls = structuredClone(f.calls); await engine.reconcile(); await engine.runReady(); assert.deepEqual(f.calls, calls);
  assert.equal(f.calls.http, 1); assert.equal(rows(f, 'external_allowance_consumption').length, 1);
});

test('a plain artifact cannot bypass the exact transcription candidate result contract', async t => {
  const f = await transcriptionFixture(t, { deferAdmission: true }), actual = ingester(f), before = protectedState(f);
  const engine = executor(f, { async ingest(input) { return (await actual.ingest(input)).artifact; } });
  await assert.rejects(engine.runReady(), { code: 'TRANSCRIPT_CANDIDATE_CONFLICT' });
  assert.equal(rows(f, 'transcript_candidate').length, 0); assert.equal(rows(f, 'artifact').length, 1);
  const attempt = rows(f, 'attempt')[0]; assert.equal(attempt.phase, 'ingesting');
  assert.equal(f.store.get('reservation', attempt.reservationId).state, 'reserved'); assert.equal(protectedState(f), before);
});

test('a fabricated transcript projection cannot be published with legitimate raw bytes', async t => {
  const f = await transcriptionFixture(t, { deferAdmission: true }), actual = ingester(f);
  const engine = executor(f, { async ingest(input) { const result = await actual.ingest(input); result.candidate.projection.text = 'Forged replacement wording'; return result; } });
  await assert.rejects(engine.runReady(), { code: 'TRANSCRIPT_CANDIDATE_CONFLICT' });
  assert.equal(rows(f, 'transcript_candidate').length, 0); assert.equal(rows(f, 'artifact').length, 1);
  assert.equal(rows(f, 'reservation')[0].state, 'reserved'); assert.equal(f.calls.http, 1);
});

test('candidate SQL failure rolls back artifact and settlement, then reopens without provider or media binaries', async t => {
  const f = await transcriptionFixture(t, { deferAdmission: true }), engine = executor(f), before = protectedState(f);
  const insert = f.store.insert.bind(f.store); let injected = 0;
  f.store.insert = (...args) => { if (args[0] === 'transcript_candidate') { injected++; throw Error('INJECTED_CANDIDATE_INSERT_FAILURE'); } return insert(...args); };
  await assert.rejects(engine.runReady(), /INJECTED_CANDIDATE_INSERT_FAILURE/); f.store.insert = insert;
  assert.equal(injected, 1); assert.equal(rows(f, 'artifact').length, 1); assert.equal(rows(f, 'transcript_candidate').length, 0);
  assert.equal(rows(f, 'reservation')[0].state, 'reserved'); assert.equal(rows(f, 'attempt')[0].phase, 'ingesting');
  assert.equal(rows(f, 'execution_output_slot').length, 1); assert.equal(protectedState(f), before);
  const calls = structuredClone(f.calls); expire(f); const reopened = recovery(f), next = executor(reopened);
  await next.reconcile();
  assert.equal(rows(reopened, 'attempt')[0].phase, 'succeeded'); assert.equal(rows(reopened, 'reservation')[0].state, 'charged');
  assert.equal(rows(reopened, 'transcript_candidate').length, 1); assert.equal(rows(reopened, 'artifact').length, 2);
  assert.equal(protectedState(reopened), before); assert.deepEqual(f.calls, calls);
  await next.reconcile(); await next.runReady(); assert.equal(rows(reopened, 'transcript_candidate').length, 1);
});

test('lease replacement at the ingestion handoff prevents stale publication and permits local recovery', async t => {
  const f = await transcriptionFixture(t, { deferAdmission: true }), actual = ingester(f), before = protectedState(f);
  const engine = executor(f, { async ingest(input) {
    const result = await actual.ingest(input), attempt = f.store.get('attempt', input.attempt.id);
    f.store.put('attempt', attempt.id, f.project.id, { ...attempt, leaseOwner: 'replacement-owner', leaseEpoch: attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
    return result;
  } });
  await engine.runReady(); assert.equal(rows(f, 'transcript_candidate').length, 0); assert.equal(rows(f, 'artifact').length, 1);
  assert.equal(rows(f, 'attempt')[0].phase, 'ingesting'); assert.equal(rows(f, 'reservation')[0].state, 'reserved');
  expire(f); const next = executor(f); await next.reconcile();
  assert.equal(rows(f, 'transcript_candidate').length, 1); assert.equal(rows(f, 'attempt')[0].phase, 'succeeded');
  assert.equal(protectedState(f), before); assert.equal(f.calls.http, 1);
});

test('Engine raw-spool recovery rejects an alternate identical-byte receipt without invoking lookup', async t => {
  const f = await transcriptionFixture(t), spool = f.outputs.spool.bind(f.outputs); let injected = false, lookup = 0;
  f.outputs.spool = async (...args) => {
    if (!injected) {
      injected = true;
      const alternate = f.outputs.recordReceipt(f.project.id, { attemptId: f.attempt.id, expectedRequestDigest: digest(f.request),
        port: 'cues', kind: 'data', mimeType: 'application/json', vendorTaskId: null, diagnosticRequestId: 'alternate-identical-response',
        source: { kind: 'returned_bytes', sha256: hash(raw), byteLength: raw.length } });
      await spool(f.project.id, alternate.id, async function* () { yield raw; });
    }
    return spool(...args);
  };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, 'unknown');
  f.bridge.lookup = async () => { lookup++; throw Error('provider lookup cannot lend missing lineage'); };
  expire(f); const engine = executor(f);
  await assert.rejects(engine.reconcile(), /[Tt]ranscript/);
  assert.equal(lookup, 0); assert.equal(f.calls.http, 1); assert.equal(rows(f, 'transcript_candidate').length, 0);
  assert.equal(rows(f, 'artifact').length, 1); assert.equal(rows(f, 'reservation')[0].state, 'reserved');
});
