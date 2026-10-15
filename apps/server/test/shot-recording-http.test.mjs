import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OPENAI_SPEECH_VOICES } from '@openslate/providers';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';
import { wave } from './speech-execution-fixture.mjs';
import { createApp } from '../dist/app.js';

const headers = { host: '127.0.0.1', authorization: 'Bearer synthetic-local-token-for-confirmation' };
const raw = (f, bytes, { shotId = 'shot-0', expectedHeadVersion = f.store.getProject(f.project.id).headVersion, key = randomUUID(), type = 'application/octet-stream' } = {}) =>
  f.app.inject({ method: 'POST', url: `/api/projects/${f.project.id}/shots/${shotId}/narration/recording?expectedHeadVersion=${expectedHeadVersion}`,
    headers: { ...headers, 'content-type': type, ...(key === null ? {} : { 'idempotency-key': key }) }, payload: bytes });

test('one fitting raw recording accepts measured shot-relative narration alongside the Director without spending', async t => {
  const f = await confirmationFixture(t), before = f.store.getProject(f.project.id), actor = f.production.beginRequest(before.id, 'local-user', 'Keep planning this film'), bridge = f.production.openEpoch(before.id, actor);
  f.store.insert('director_context', 'recording-captured-context', before.id, { requestId: actor.requestId, epochId: bridge.actor.epochId, snapshot: f.production.readContext(before.id, bridge.actor) });
  const holds = f.store.list('hold', before.id).filter(h => h.active && h.ownerId === actor.requestId);
  const result = await raw(f, wave(24000)).then(f.ok), after = f.store.getProject(before.id), shot = after.shots[0];
  assert.equal(result.fits, true); assert.equal(result.measuredSeconds, 1); assert.equal(result.recording.samples, 48000);
  assert.equal(shot.narration.mode, 'uploaded'); assert.equal(shot.narrationPending, false); assert.equal(shot.desiredFrames, 180); assert.equal(shot.narrationTimingMode, 'within_shot');
  assert.deepEqual(after.shots[1], before.shots[1]); assert.equal(f.narration.workspaceSnapshot(before.id).segments[0].accepted.audio, true);
  assert.equal(f.canonical.workspaceCurrent(before.id).segments[0].placementMode, 'shot');
  assert.deepEqual((await f.overview()).shots['shot-0'].narration, { state: 'ready', text: 'Voice line 0', measuredSeconds: 1, fits: true });
  assert.equal(f.store.get('epoch', bridge.actor.epochId).state, 'active'); assert.equal(f.store.get('message', actor.requestId).state, 'active');
  assert.deepEqual(f.store.list('hold', before.id).filter(h => h.active && h.ownerId === actor.requestId), holds);
  assert.equal(f.store.list('hold', before.id).filter(h => h.active).length, holds.length);
  await assert.rejects(f.production.prepare(before.id, bridge.actor, { variant: 'project', expectedHeadVersion: after.headVersion,
    creative: { updateShots: [{ id: shot.id, narration: { mode: 'none', text: '', voice: 'stock' }, reauthorPrompts: true }] } }), { code: 'HUMAN_EDITED_FIELD' });
  assert.equal(f.calls.speech, 0); assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.store.list('grant', before.id).length, 0);
});

test('an overlong recording reports its measured length and is ready for the existing free fit command', async t => {
  const f = await confirmationFixture(t), result = await raw(f, wave(7.4 * 24000)).then(f.ok), project = f.store.getProject(f.project.id);
  assert.equal(result.fits, false); assert.equal(result.measuredSeconds, 7.4); assert.equal(result.shot.committed, false); assert.equal(project.shots[0].narration.mode, 'uploaded'); assert.equal(project.shots[0].narrationPending, true);
  assert.equal(f.narration.workspaceSnapshot(project.id).segments[0].audio.id, result.recording.id);
  assert.equal((await f.overview()).shots['shot-0'].narration.fits, false);
  await f.call('POST', '/shots/shot-0/narration-fit', { fit: 'extend_shot', expectedHeadVersion: project.headVersion }).then(f.ok);
  assert.equal(f.store.getProject(project.id).shots[0].desiredFrames, 240); assert.equal(f.store.getProject(project.id).shots[0].narrationPending, false);
  assert.equal(f.calls.speech, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test('one Undo restores the previous accepted narration, canonical placement and exact audio draft', async t => {
  const f = await confirmationFixture(t);
  await raw(f, wave(24000)).then(f.ok);
  const before = f.store.getProject(f.project.id), canonical = f.canonical.workspaceCurrent(before.id), snapshot = f.narration.workspaceSnapshot(before.id);
  const second = await raw(f, wave(48000)).then(f.ok);
  assert.notEqual(second.recording.id, snapshot.segments[0].audio.id);
  await f.call('POST', '/storyboard', { kind: 'undo', commandId: second.commandId, expectedHeadVersion: second.headVersion }).then(f.ok);
  const after = f.store.getProject(before.id), restored = f.narration.workspaceSnapshot(before.id);
  assert.deepEqual(after.shots, before.shots); assert.deepEqual(after.cues, before.cues); assert.deepEqual(after.narration, before.narration);
  assert.deepEqual(f.canonical.workspaceCurrent(before.id).segments, canonical.segments); assert.deepEqual(restored.segments, snapshot.segments);
  assert.ok(restored.state.version > snapshot.state.version);
  assert.equal((await f.overview()).shots['shot-0'].narration.measuredSeconds, 1);
  assert.equal(f.store.list('narration_audio', before.id).length, 2, 'immutable uploaded takes remain in the owned library');
});

test('Undo of a first overlong recording restores absent narration drafts and cannot overwrite a later workspace edit', async t => {
  const f = await confirmationFixture(t), before = f.store.getProject(f.project.id), result = await raw(f, wave(7 * 24000)).then(f.ok);
  await f.call('POST', '/storyboard', { kind: 'undo', commandId: result.commandId, expectedHeadVersion: result.headVersion }).then(f.ok);
  assert.deepEqual(f.store.getProject(before.id).shots, before.shots); assert.deepEqual(f.narration.workspaceSnapshot(before.id).segments, []);
  const second = await raw(f, wave(24000)).then(f.ok), session = second.shot.session;
  const state = f.narration.workspaceSnapshot(before.id);
  f.narration.reviseSegments(before.id, { kind: 'human', principalId: 'local-user', requestId: session.requestId }, state.state.version, randomUUID(), {
    update: [{ segmentId: state.segments[0].entry.segmentId, draft: { ...state.segments[0].script, text: 'Newer human words' } }],
  });
  const refused = await f.call('POST', '/storyboard', { kind: 'undo', commandId: second.commandId, expectedHeadVersion: second.headVersion });
  assert.equal(refused.json().error.code, 'UNDO_UNAVAILABLE'); assert.equal(f.narration.workspaceSnapshot(before.id).segments[0].script.text, 'Newer human words');
});

test('exact recording replay survives restart and refuses changed bytes, shot and version under the same key', async t => {
  const f = await confirmationFixture(t), bytes = wave(24000), options = { key: 'one-recording-press', expectedHeadVersion: f.project.headVersion }, result = await raw(f, bytes, options).then(f.ok);
  const version = f.store.getProject(f.project.id).headVersion, cursor = f.store.cursor(f.project.id);
  await f.restart(); assert.deepEqual(await raw(f, bytes, options).then(f.ok), result);
  assert.equal(f.store.getProject(f.project.id).headVersion, version); assert.equal(f.store.cursor(f.project.id), cursor);
  for (const [body, changed] of [[wave(48000), {}], [bytes, { expectedHeadVersion: version }], [bytes, { shotId: 'shot-1' }]]) {
    const response = await raw(f, body, { ...options, ...changed }); assert.equal(response.json().error.code, 'IDEMPOTENCY_CONFLICT', response.body);
  }
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1); assert.equal(f.store.list('storyboard_edit', f.project.id).length, 1); assert.equal(f.calls.speech, 0);
});

test('concurrent same-key uploads settle one exact recording and a replay after Undo does not reapply it', async t => {
  const f = await confirmationFixture(t), bytes = wave(24000), before = f.store.getProject(f.project.id), options = { key: 'concurrent-recording', expectedHeadVersion: before.headVersion };
  const results = await Promise.all([raw(f, bytes, options).then(f.ok), raw(f, bytes, options).then(f.ok)]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.store.list('narration_audio', before.id).length, 1); assert.equal(f.store.list('storyboard_edit', before.id).length, 1);
  await f.call('POST', '/storyboard', { kind: 'undo', commandId: results[0].commandId, expectedHeadVersion: results[0].headVersion }).then(f.ok);
  const afterUndo = f.store.getProject(before.id), cursor = f.store.cursor(before.id);
  assert.deepEqual(await raw(f, bytes, options).then(f.ok), results[0]); assert.deepEqual(f.store.getProject(before.id), afterUndo); assert.equal(f.store.cursor(before.id), cursor);
  await f.call('POST', '/storyboard', { kind: 'shot', id: 'shot-1', field: 'motion', value: 'A newer human direction', expectedHeadVersion: afterUndo.headVersion }).then(f.ok);
  const newer = f.store.getProject(before.id);
  assert.deepEqual(await raw(f, bytes, options).then(f.ok), results[0]); assert.deepEqual(f.store.getProject(before.id), newer);
});

function boundedGate(t) {
  let entered, release;
  let startTimer, gateTimer;
  const started = new Promise((resolve, reject) => {
    entered = () => { clearTimeout(startTimer); resolve(); };
    startTimer = setTimeout(() => reject(new Error('The fixture did not reach its async gate within 10 seconds')), 10000).unref();
  });
  const gate = new Promise(resolve => {
    release = () => { clearTimeout(gateTimer); resolve(); };
    gateTimer = setTimeout(release, 10000).unref();
  });
  t.after(() => { entered(); release(); });
  return { entered, started, gate, release };
}

async function deferImport(t, f) {
  const { entered, started, gate, release } = boundedGate(t);
  const original = f.media.importMedia.bind(f.media);
  f.media.importMedia = async (...args) => { const result = await original(...args); entered(); await gate; return result; };
  t.after(() => { release(); f.media.importMedia = original; });
  return { started, release };
}

test('a shot edit during async recording import refuses attachment and keeps the newer human project intact', async t => {
  const f = await confirmationFixture(t), deferred = await deferImport(t, f), pending = raw(f, wave(24000));
  await deferred.started;
  await f.call('POST', '/storyboard', { kind: 'shot', id: 'shot-0', field: 'motion', value: 'A later pan', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const changed = f.store.getProject(f.project.id); deferred.release();
  const response = await pending; assert.equal(response.json().error.code, 'REVISION_CONFLICT', response.body); assert.deepEqual(f.store.getProject(changed.id), changed);
  assert.equal(f.narration.workspaceSnapshot(changed.id).segments.length, 0); assert.equal(f.calls.speech, 0);
});

test('recording Undo retains unrelated narration edits completed while local import was running', async t => {
  const f = await confirmationFixture(t), deferred = await deferImport(t, f), pending = raw(f, wave(24000));
  await deferred.started;
  const session = await f.call('POST', '/narration/sessions', {}).then(f.ok);
  await f.call('POST', '/narration/segments', { sessionId: session.session.id, expectedVersion: 0, patch: { add: [{ text: 'A newer unrelated paragraph', textKind: 'draft', language: 'en', meaning: 'Elsewhere', source: { kind: 'undecided' } }] } }).then(f.ok);
  const unrelated = f.narration.workspaceSnapshot(f.project.id).segments[0]; deferred.release();
  const result = await pending.then(f.ok);
  await f.call('POST', '/storyboard', { kind: 'undo', commandId: result.commandId, expectedHeadVersion: result.headVersion }).then(f.ok);
  assert.deepEqual(f.narration.workspaceSnapshot(f.project.id).segments, [unrelated]);
});

test('recording Undo preserves a paid frame that completed during local import', async t => {
  const f = await confirmationFixture(t, { modes: ['none', 'none'] });
  await f.make(); await f.engine.runReady();
  const deferred = await deferImport(t, f), pending = raw(f, wave(24000)); await deferred.started;
  await f.tick(12);
  const completed = (await f.overview()).shots['shot-0'].keyframe.artifact; assert.ok(completed);
  deferred.release(); const result = await pending.then(f.ok);
  await f.call('POST', '/storyboard', { kind: 'undo', commandId: result.commandId, expectedHeadVersion: result.headVersion }).then(f.ok);
  assert.deepEqual((await f.overview()).shots['shot-0'].keyframe.artifact, completed);
});

test('recording Undo preserves a paid frame that completed during asynchronous canonical acceptance', async t => {
  const f = await confirmationFixture(t, { modes: ['none', 'none'] });
  await f.make(); await f.engine.runReady();
  const { entered, started, gate, release } = boundedGate(t), original = f.canonical.apply.bind(f.canonical);
  f.canonical.apply = async (...args) => { entered(); await gate; return original(...args); };
  t.after(() => release());
  const pending = raw(f, wave(24000)); await started;
  await f.tick(12);
  const completed = (await f.overview()).shots['shot-0'].keyframe.artifact; assert.ok(completed);
  release(); const result = await pending.then(f.ok);
  await f.call('POST', '/storyboard', { kind: 'undo', commandId: result.commandId, expectedHeadVersion: result.headVersion }).then(f.ok);
  assert.deepEqual((await f.overview()).shots['shot-0'].keyframe.artifact, completed);
});

test('an overlong replacement of identical writing marks the old accepted narration pending and is undoable', async t => {
  const f = await confirmationFixture(t); await raw(f, wave(24000)).then(f.ok);
  const before = f.store.getProject(f.project.id), previous = f.narration.workspaceSnapshot(before.id);
  const result = await raw(f, wave(7 * 24000)).then(f.ok);
  assert.equal(result.fits, false); assert.equal(f.store.getProject(before.id).shots[0].narrationPending, true);
  assert.equal((await f.overview()).shots['shot-0'].narration.fits, false);
  await f.call('POST', '/storyboard', { kind: 'undo', commandId: result.commandId, expectedHeadVersion: result.headVersion }).then(f.ok);
  assert.deepEqual(f.store.getProject(before.id).shots, before.shots); assert.deepEqual(f.narration.workspaceSnapshot(before.id).segments, previous.segments);
});

test('recording refuses wrong content type, empty bytes, stale versions, foreign shots and missing command keys', async t => {
  const f = await confirmationFixture(t), before = f.store.getProject(f.project.id);
  for (const [bytes, options, code] of [[wave(24000), { type: 'text/plain' }, 'VALIDATION_ERROR'], [Buffer.alloc(0), {}, 'VALIDATION_ERROR'],
    [wave(24000), { expectedHeadVersion: 999 }, 'REVISION_CONFLICT'], [wave(24000), { shotId: 'foreign-shot' }, 'NOT_FOUND'], [wave(24000), { key: null }, 'IDEMPOTENCY_KEY_REQUIRED']]) {
    const response = await raw(f, bytes, options); assert.equal(response.json().error.code, code, `${JSON.stringify({ bytes: bytes.length, options })} ${response.body}`); assert.deepEqual(f.store.getProject(before.id), before);
  }
  assert.equal(f.store.list('narration_audio', before.id).length, 0); assert.equal(f.store.list('grant', before.id).length, 0);
});

test('stock voice read lists bounded selectors and marks the film default without creating authority', async t => {
  const f = await confirmationFixture(t), cursor = f.store.cursor(f.project.id);
  const voices = await f.app.inject({ method: 'GET', url: '/api/narration/voices', headers }).then(f.ok);
  assert.deepEqual(voices.voices.map(v => v.id), OPENAI_SPEECH_VOICES); assert.deepEqual(voices.voices.filter(v => v.default), [{ id: 'cedar', default: true }]);
  assert.equal(voices.defaultNarratorVoice, 'cedar'); assert.equal(f.store.cursor(f.project.id), cursor);
  const project = f.store.getProject(f.project.id); f.store.saveProject({ ...project, narratorVoice: 'coral' }, project.headVersion);
  const selected = await f.app.inject({ method: 'GET', url: `/api/narration/voices?projectId=${project.id}`, headers }).then(f.ok);
  assert.deepEqual(selected.voices.filter(v => v.default), [{ id: 'coral', default: true }]);
});

test('stock voices are readable with only the application service and no configured narration tools', async t => {
  const f = await confirmationFixture(t), app = createApp({ service: f.production, localToken: 'synthetic-local-token-for-confirmation' });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/api/narration/voices', headers }).then(f.ok);
  assert.equal(response.voices.length, OPENAI_SPEECH_VOICES.length); assert.equal(response.defaultNarratorVoice, 'cedar');
});

test('storyboard stock voice selection drives a new speech request and retains the selected take across default changes', async t => {
  const f = await confirmationFixture(t);
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'voice', value: 'coral', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  assert.equal(f.store.getProject(f.project.id).shots[0].narration.voice, 'coral');
  const generated = await f.call('POST', '/narration/shots/shot-0/generate', { expectedHeadVersion: f.store.getProject(f.project.id).headVersion, profileId: 'offline-speech' }).then(f.ok);
  assert.equal(generated.proposal.voice, 'coral'); assert.equal(f.store.list('narration_speech_proposal', f.project.id)[0].operation.voice, 'coral');
  const project = f.store.getProject(f.project.id); f.store.saveProject({ ...project, narratorVoice: 'cedar' }, project.headVersion);
  assert.equal(f.store.list('narration_speech_proposal', project.id)[0].operation.voice, 'coral');
  const invalid = await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-1', field: 'voice', value: 'invented-voice', expectedHeadVersion: f.store.getProject(project.id).headVersion });
  assert.equal(invalid.json().error.code, 'VALIDATION_ERROR');
});

test('keyframe presses pin the per-shot stock selector through queued speech and restart', async t => {
  const f = await confirmationFixture(t);
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'voice', value: 'marin', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  await f.make();
  const project = f.store.getProject(f.project.id); f.store.saveProject({ ...project, narratorVoice: 'coral' }, project.headVersion);
  await f.restart(); await f.tick(12);
  const proposal = f.store.list('narration_speech_proposal', project.id)[0]; assert.equal(proposal.operation.voice, 'marin'); assert.equal(f.calls.speech, 1);
  assert.equal((await f.overview()).shots['shot-0'].narration.measuredSeconds, 1);
});

test('a new stock voice selection replaces an older materialized line on the next keyframe press', async t => {
  const f = await confirmationFixture(t);
  await f.make(); await f.tick(12);
  assert.equal(f.store.list('narration_speech_proposal', f.project.id)[0].operation.voice, 'cedar');
  await f.call('POST', '/storyboard', { kind: 'narration', id: 'shot-0', field: 'voice', value: 'marin', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const view = await f.call('GET', '/scenes/scene-0/generation').then(f.ok);
  assert.equal(view.rows[0].narration.voice, 'marin'); assert.equal(view.rows[0].narration.recordingCurrent, false);
  await f.make(); await f.tick(12);
  assert.equal(f.store.list('narration_speech_proposal', f.project.id).at(-1).operation.voice, 'marin'); assert.equal(f.calls.speech, 2);
});
