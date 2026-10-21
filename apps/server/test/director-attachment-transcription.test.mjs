import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digest } from '@openslate/core';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { hasDirectorAudioAttachment, startDirectorAttachmentTranscription, readDirectorAttachmentTranscription } from '../dist/application/director-attachment-transcription.js';
import { requestedTranscriptionHoldIds } from '../dist/narration/request-holds.js';
import { ownedTranscriptionFixture } from './owned-transcription-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const rows = (f, kind) => f.store.list(kind, f.project.id);
const latch = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
function writable(path) { chmodSync(path, 0o700); for (const item of readdirSync(path, { withFileTypes: true })) if (item.isDirectory()) writable(join(path, item.name)); }
// Adversarial fixture-only corruption bypasses persistence immutability; ordinary attachment setup uses beginRequest.
function seedMessage(f, patch) {
  const request = f.store.get('message', f.actor.requestId);
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='message' AND id=?").run(canonical(JSON.parse(JSON.stringify({ ...request, ...patch }))), request.id);
}
async function fixture(t, version = '6.0.0') {
  const f = await ownedTranscriptionFixture(t), skills = mkdtempSync(join(tmpdir(), 'openslate-director-attachment-skills-'));
  f.human = f.production.beginRequest(f.project.id, 'human', 'What does my attached recording say?', {
    attachments: [{ artifactId: f.audio.id, sha256: f.audio.media.sha256 }],
  });
  f.actor = f.production.openEpoch(f.project.id, f.human).actor;
  t.after(() => { writable(skills); rmSync(skills, { recursive: true, force: true }); });
  const configured = createDirectorSkillLock({ repositoryRoot, snapshotRoot: skills }, version);
  const contexts = new DirectorContextService(f.production, configured.environment);
  contexts.bootstrapLock(f.project.id, configured.lock);
  contexts.capture(f.project.id, f.actor, { lockId: configured.lock.id, selectedSkillIds: ['production', 'plan-authoring'] });
  f.lock = configured.lock;
  f.start = (input = f.input(), options = {}) => startDirectorAttachmentTranscription({ service: f.production,
    transcriptions: f.service, projectId: f.project.id, actor: f.actor, key: input.key, input, ...options });
  return f;
}
const noPaidWork = f => {
  for (const kind of ['grant', 'candidate', 'attempt', 'reservation', 'director_generation_effect']) assert.equal(rows(f, kind).length, 0, kind);
  assert.equal(f.provider.acceptedCount(), 0);
};

test('6.0.0 transcribes only its own attached audio through owned publication with one priced effect and no narration adoption', async t => {
  const f = await fixture(t), input = f.input(), narration = canonical(f.narration.workspaceSnapshot(f.project.id));
  const result = await f.start(input), review = f.store.get('owned_transcription_review', result.receipt.reviewId);
  assert.equal(result.proposal.requestId, f.actor.requestId); assert.equal(review.requestId, f.actor.requestId);
  assert.equal(review.requested, true); assert.equal(result.proposal.compiled.nodes.length, 1);
  assert.equal(result.proposal.compiled.nodes[0].kind, 'transcription');
  assert.deepEqual(result.effect, { kind: 'transcription', sceneIds: [], shotIds: [], keyframes: 0, voiceLines: 0,
    quote: { micros: '100', units: 1, unitMicros: '100', priceUnknown: false }, at: result.effect.at });
  assert.ok(Number.isFinite(Date.parse(result.effect.at)));
  assert.equal(rows(f, 'grant').length, 1); assert.equal(rows(f, 'candidate').length, 1);
  assert.equal(rows(f, 'director_generation_effect').length, 1);
  assert.equal(canonical(f.narration.workspaceSnapshot(f.project.id)), narration);
  assert.equal(rows(f, 'narration_acceptance').length, 0); assert.equal(rows(f, 'transcript_candidate').length, 0);
  assert.equal(f.provider.acceptedCount(), 0, 'publication queues work; no live provider is used');
  const cursor = f.store.cursor(f.project.id);
  assert.deepEqual(await f.start(input), result); assert.equal(f.store.cursor(f.project.id), cursor);
  await assert.rejects(f.start({ ...input, language: 'en' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(rows(f, 'grant').length, 1); assert.equal(rows(f, 'director_generation_effect').length, 1);
  const saved = rows(f, 'director_attachment_transcription')[0];
  assert.throws(() => f.store.put('director_attachment_transcription', saved.id, f.project.id, { ...saved, state: 'started' }), { code: 'IMMUTABLE_RECORD' });
  assert.throws(() => f.store.put('message', f.actor.requestId, f.project.id, { ...f.store.get('message', f.actor.requestId), attachments: [] }), { code: 'IMMUTABLE_RECORD' });
});

for (const selection of ['missing', 'wrong_hash', 'other_file', 'other_project'])
test(`attachment transcription refuses ${selection} evidence before preparation`, async t => {
  const f = await fixture(t);
  if (selection === 'missing') seedMessage(f, { attachments: undefined });
  if (selection === 'wrong_hash') seedMessage(f, { attachments: [{ artifactId: f.audio.id, sha256: 'a'.repeat(64) }] });
  if (selection === 'other_file') seedMessage(f, { attachments: [{ artifactId: 'different-file', sha256: f.audio.media.sha256 }] });
  if (selection === 'other_project') f.store.db.prepare("UPDATE entities SET body=? WHERE kind='narration_audio' AND id=?")
    .run(canonical({ ...f.audio, projectId: 'another-project' }), f.audio.id);
  assert.equal(hasDirectorAudioAttachment(f.production, f.project.id, f.actor, f.audio.id), false);
  await assert.rejects(f.start(), { code: 'ORIGIN_NOT_AUTHORIZED' });
  assert.equal(rows(f, 'owned_transcription_proposal').length, 0); noPaidWork(f);
});

for (const authority of ['5.0.0', 'review', 'read_only', 'app', 'director', 'human'])
test(`attachment transcription refuses ${authority} authority`, async t => {
  const f = await fixture(t, authority === '5.0.0' ? authority : '6.0.0');
  if (authority === 'review') f.store.insert('keyframe_review_request', f.actor.requestId, f.project.id, { requestId: f.actor.requestId });
  if (authority === 'read_only') {
    const epoch = f.store.get('epoch', f.actor.epochId); f.store.put('epoch', epoch.id, f.project.id, { ...epoch, state: 'read_only' });
  }
  if (authority === 'app' || authority === 'director') seedMessage(f, { source: authority });
  await assert.rejects(f.start(f.input(), authority === 'human' ? { actor: f.human } : {}),
    { code: authority === 'read_only' ? 'ACTOR_DENIED' : 'ORIGIN_NOT_AUTHORIZED' });
  noPaidWork(f);
});

for (const change of ['stop', 'read_only', 'supersede'])
test(`a ${change} during asynchronous owned verification rolls paid publication and effect back together`, async t => {
  const f = await fixture(t), gate = latch(), entered = latch(), original = f.media.verifiedSource.bind(f.media);
  let once = false;
  f.media.verifiedSource = async (...args) => {
    const value = await original(...args);
    if (!once) { once = true; entered.release(); await gate.promise; }
    return value;
  };
  const running = f.start(); await entered.promise;
  if (change === 'stop') f.production.control(f.project.id, f.human, 'stop');
  if (change === 'read_only') { const epoch = f.store.get('epoch', f.actor.epochId); f.store.put('epoch', epoch.id, f.project.id, { ...epoch, state: 'read_only' }); }
  if (change === 'supersede') f.production.beginRequest(f.project.id, 'human', 'Replace that conversation direction.');
  gate.release();
  await assert.rejects(running, { code: change === 'stop' ? 'EPOCH_REVOKED' : 'ACTOR_DENIED' });
  noPaidWork(f);
});

test('attachment transcription retains the original request cutoff and cannot ignore a later human hold', async t => {
  const f = await fixture(t), originalCursor = f.store.readEvents(f.project.id).find(event => event.kind === 'message.recorded' && event.payload.requestId === f.actor.requestId).sequence;
  const later = f.production.beginRequest(f.project.id, 'human', 'Keep this later edit held.', { concurrency: 'alongside' });
  const laterHold = rows(f, 'hold').find(hold => hold.ownerId === later.requestId && hold.active);
  const result = await f.start(), review = f.store.get('owned_transcription_review', result.receipt.reviewId);
  assert.equal(review.requestedAtCursor, originalCursor);
  assert.equal(requestedTranscriptionHoldIds(f.store, f.project.id, result.receipt.candidateId).includes(laterHold.id), false);
  assert.equal(f.store.get('hold', laterHold.id).active, true);
});

test('an unknown attachment request outcome is never blindly submitted again', async t => {
  const f = await fixture(t), input = f.input(); let calls = 0;
  f.service.request = async () => { calls++; throw Error('Lost owned-transcription response'); };
  await assert.rejects(f.start(input), /Lost owned-transcription response/);
  await assert.rejects(f.start(input), { code: 'TOOL_CALL_UNRESOLVED' });
  assert.equal(calls, 1); assert.equal(rows(f, 'director_attachment_transcription')[0].state, 'started'); noPaidWork(f);
});

test('a paid attachment publication survives reply loss and reconciles immutable evidence without resubmission', async t => {
  const f = await fixture(t), input = f.input(), original = f.service.request.bind(f.service); let calls = 0;
  f.service.request = async (...args) => { calls++; await original(...args); throw Error('Lost reply after publication'); };
  await assert.rejects(f.start(input), /Lost reply after publication/);
  const record = rows(f, 'director_attachment_transcription')[0]; assert.equal(record.state, 'succeeded');
  f.service.request = () => { throw Error('Never request again'); };
  const result = await f.start(input);
  assert.deepEqual(result, readDirectorAttachmentTranscription(f.production, f.project.id, record));
  assert.equal(calls, 1); assert.equal(rows(f, 'grant').length, 1); assert.equal(rows(f, 'director_generation_effect').length, 1);
});

test('6.0.0 ToolInvocation starts an attached recording exactly once and includes its priced effect', async t => {
  const f = await fixture(t), tools = new ToolInvocationService(f.production, { ownedTranscription: f.service });
  const { key: _key, ...args } = f.input();
  const result = await tools.invoke(f.project.id, f.actor, 'transcribe-own-attachment', 'prepare_recording_transcription', args);
  assert.equal(result.state, 'requested');
  assert.deepEqual(result.generation.quote, { micros: '100', units: 1, unitMicros: '100', priceUnknown: false });
  const cursor = f.store.cursor(f.project.id);
  assert.deepEqual(await tools.invoke(f.project.id, f.actor, 'transcribe-own-attachment', 'prepare_recording_transcription', args), result);
  assert.equal(f.store.cursor(f.project.id), cursor); assert.equal(rows(f, 'grant').length, 1);
});

test('message attachment refs are validated, cloned and included in message idempotency', async t => {
  const f = await fixture(t), refs = [{ artifactId: f.audio.id, sha256: f.audio.media.sha256 }], key = 'exact-attached-message';
  const accepted = f.production.beginRequest(f.project.id, 'human', 'Read this audio.', { key, attachments: refs });
  refs[0].sha256 = 'b'.repeat(64);
  assert.equal(f.store.get('message', accepted.requestId).attachments[0].sha256, f.audio.media.sha256);
  assert.deepEqual(f.production.beginRequest(f.project.id, 'human', 'Read this audio.', { key,
    attachments: [{ artifactId: f.audio.id, sha256: f.audio.media.sha256 }] }), accepted);
  assert.throws(() => f.production.beginRequest(f.project.id, 'human', 'Read this audio.', { key, attachments: refs }), { code: 'IDEMPOTENCY_CONFLICT' });
  for (const attachments of [[], Array.from({ length: 9 }, (_, index) => ({ artifactId: `audio-${index}`, sha256: 'a'.repeat(64) })),
    [refs[0], refs[0]], [{ artifactId: f.audio.id, sha256: 'not-a-hash' }], [{ ...refs[0], path: '/untrusted' }]])
    assert.throws(() => f.production.beginRequest(f.project.id, 'human', 'Read this audio.', { attachments }), { code: 'VALIDATION_ERROR' });
});

test('a concurrent replay while owned verification is pending never calls the request path twice', async t => {
  const f = await fixture(t), entered = latch(), gate = latch(), original = f.service.request.bind(f.service), input = f.input(); let calls = 0;
  f.service.request = async (...args) => { calls++; entered.release(); await gate.promise; return original(...args); };
  const first = f.start(input); await entered.promise;
  const pending = rows(f, 'director_attachment_transcription')[0];
  for (const field of ['audioId', 'operationDigest']) assert.throws(() => f.store.put('director_attachment_transcription', pending.id, f.project.id,
    { ...pending, [field]: field === 'audioId' ? 'another-recording' : 'a'.repeat(64) }), { code: 'IMMUTABLE_RECORD' });
  await assert.rejects(f.start(input), { code: 'TOOL_CALL_UNRESOLVED' });
  await assert.rejects(f.start({ ...input, key: 'different-concurrent-call' }), { code: 'TOOL_CALL_UNRESOLVED' });
  gate.release(); await first;
  assert.equal(calls, 1); assert.equal(rows(f, 'grant').length, 1); assert.equal(rows(f, 'director_generation_effect').length, 1);
});

test('lost ToolInvocation transcription response reconciles its original publication after epoch fencing', async t => {
  const f = await fixture(t), tools = new ToolInvocationService(f.production, { ownedTranscription: f.service });
  const original = f.service.request.bind(f.service), { key: _key, ...args } = f.input(); let calls = 0;
  f.service.request = async (...input) => { calls++; await original(...input); throw Error('Controlled loss after paid publication'); };
  await assert.rejects(tools.invoke(f.project.id, f.actor, 'lost-attached-transcription', 'prepare_recording_transcription', args), { code: 'TOOL_CALL_UNRESOLVED' });
  assert.equal(rows(f, 'tool_invocation')[0].state, 'unresolved');
  f.production.beginRequest(f.project.id, 'human', 'Continue from the saved exact transcript job.');
  f.service.request = () => { throw Error('Reconciliation must not request again'); };
  const reconciler = new ToolInvocationService(f.production);
  reconciler.reconcileEpoch(f.project.id, f.actor.epochId);
  const result = rows(f, 'tool_reconciliation')[0];
  assert.equal(result.state, 'effect_confirmed'); assert.equal(result.receipt.state, 'requested');
  assert.equal(result.receipt.generation.kind, 'transcription'); assert.equal(result.receipt.generation.quote.micros, '100');
  reconciler.reconcileEpoch(f.project.id, f.actor.epochId);
  assert.equal(calls, 1); assert.equal(rows(f, 'tool_reconciliation').length, 1); assert.equal(rows(f, 'grant').length, 1);
});

test('a different tool call cannot resubmit the same attached audio after an unknown request outcome', async t => {
  const f = await fixture(t), tools = new ToolInvocationService(f.production, { ownedTranscription: f.service });
  const original = f.service.request.bind(f.service), { key: _key, ...args } = f.input(); let calls = 0;
  f.service.request = async () => { calls++; throw Error('Unknown original request outcome'); };
  await assert.rejects(tools.invoke(f.project.id, f.actor, 'first-unknown-audio', 'prepare_recording_transcription', args), { code: 'TOOL_CALL_UNRESOLVED' });
  f.service.request = async (...input) => { calls++; return original(...input); };
  await assert.rejects(tools.invoke(f.project.id, f.actor, 'new-id-same-unknown-audio', 'prepare_recording_transcription', args), { code: 'TOOL_CALL_UNRESOLVED' });
  await assert.rejects(tools.invoke(f.project.id, f.actor, 'new-language-same-unknown-audio', 'prepare_recording_transcription', {
    ...args, language: 'en',
  }), { code: 'TOOL_CALL_UNRESOLVED' });
  assert.equal(calls, 1); noPaidWork(f);
});

test('a different tool call recovers the same audio publication after reply loss without buying twice', async t => {
  const f = await fixture(t), tools = new ToolInvocationService(f.production, { ownedTranscription: f.service });
  const original = f.service.request.bind(f.service), { key: _key, ...args } = f.input(); let calls = 0;
  f.service.request = async (...input) => { calls++; await original(...input); throw Error('Lost published request response'); };
  await assert.rejects(tools.invoke(f.project.id, f.actor, 'first-published-audio', 'prepare_recording_transcription', args), { code: 'TOOL_CALL_UNRESOLVED' });
  const prior = rows(f, 'director_attachment_transcription')[0];
  f.service.request = async (...input) => { calls++; return original(...input); };
  const result = await tools.invoke(f.project.id, f.actor, 'new-id-same-published-audio', 'prepare_recording_transcription', {
    ...args, expectedHeadVersion: f.store.getProject(f.project.id).headVersion,
  });
  assert.equal(result.candidateId, prior.receipt.candidateId); assert.equal(calls, 1);
  assert.equal(rows(f, 'grant').length, 1); assert.equal(rows(f, 'candidate').length, 1); assert.equal(rows(f, 'director_generation_effect').length, 1);
});

test('a recovered attachment publication reconciles its new call after another lost reply without buying twice', async t => {
  const f = await fixture(t), input = f.input(), original = await f.start(input), tools = new ToolInvocationService(f.production, { ownedTranscription: f.service });
  const { key: _key, ...args } = f.input(), finish = tools.finish.bind(tools); let lost = false;
  f.service.request = () => { throw Error('Recovering the same recording must not submit again'); };
  tools.finish = (...values) => {
    if (!lost && values[2] === 'succeeded') { lost = true; throw Error('Lost recovered result before recording it'); }
    return finish(...values);
  };
  await assert.rejects(tools.invoke(f.project.id, f.actor, 'lost-recovered-audio', 'prepare_recording_transcription', args), { code: 'TOOL_CALL_UNRESOLVED' });
  const alias = rows(f, 'director_attachment_transcription').find(record => record.key.startsWith('director-tool:'));
  assert.notEqual(alias.id, rows(f, 'director_attachment_transcription')[0].id);
  assert.notEqual(alias.inputDigest, digest(input), 'the recovered call retains its own exact input identity');
  assert.equal(alias.receipt.candidateId, original.receipt.candidateId);
  assert.deepEqual(readDirectorAttachmentTranscription(f.production, f.project.id, alias), original);
  f.production.beginRequest(f.project.id, 'human', 'Continue after the recovered transcript job.');
  tools.reconcileEpoch(f.project.id, f.actor.epochId);
  const reconciled = rows(f, 'tool_reconciliation')[0];
  assert.equal(reconciled.state, 'effect_confirmed'); assert.equal(reconciled.receipt.candidateId, original.receipt.candidateId);
  assert.equal(rows(f, 'grant').length, 1); assert.equal(rows(f, 'candidate').length, 1); assert.equal(rows(f, 'director_generation_effect').length, 1);
});
