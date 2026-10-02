import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@openslate/core';
import { editStoryboard } from '../dist/storyboard.js';
import { narrationSpeechFixture, key } from './narration-speech-fixture.mjs';
import { projectFixture } from './execution-fixture.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Engine } from '../dist/execution/engine.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { SpoolAudioIngestor } from '../dist/execution/spool-audio-ingester.js';
import { DurableExternalAdmission } from '../dist/execution/durable-external-admission.js';
import { response } from './speech-execution-fixture.mjs';

async function mapped(t, options = {}) {
  const f = await narrationSpeechFixture(t, { realSpeech: true, ...options }), before = f.store.getProject(f.project.id);
  const project = { ...projectFixture(f.project.id, 2), capabilityLockId: before.capabilityLockId };
  project.shots[0].narration = { mode: 'generated', text: f.view().segments[0].script.text, voice: 'stock' };
  f.store.saveProject(project, before.headVersion); f.project = f.store.getProject(f.project.id);
  f.store.insert('project_revision', f.project.revisionId, f.project.id, { project: f.project });
  const segmentId = f.view().segments[0].entry.segmentId, shotId = f.project.shots[0].id;
  f.store.put('narration_shot_draft', digest({ projectId: f.project.id, shotId }), f.project.id, { projectId: f.project.id, shotId, segmentId, intentDigest: digest(f.project.shots[0].narration) });
  f.edit = (field, value, id = shotId) => editStoryboard(f.production, f.project.id, { expectedHeadVersion: f.store.getProject(f.project.id).headVersion, kind: 'narration', id, field, value }, key());
  f.prepareAndReview = async () => { f.proposal = await f.prepare(); f.applied = await f.review(f.proposal); f.issue(f.applied); };
  return f;
}
const context = attempt => ({ expectedLease: { owner: attempt.leaseOwner, epoch: attempt.leaseEpoch } });

for (const [field, value] of [['voice', 'personal'], ['text', 'Different spoken words.'], ['mode', 'none'], ['mode', 'uploaded']]) {
  test(`mapped shot ${field} edit rejects previously reviewed speech before admission without consuming any start`, async t => {
    const f = await mapped(t); await f.prepareAndReview(); f.edit(field, value);
    assert.throws(() => f.admit(f.applied), { code: 'NARRATION_SPEECH_STALE' });
    for (const kind of ['attempt', 'reservation', 'external_allowance_consumption', 'speech_execution_dispatch']) assert.equal(f.store.list(kind, f.project.id).length, 0);
    assert.deepEqual(f.calls, { http: 0, credentials: 0 });
  });
}

test('mapped intent changing after admission blocks the original first dispatch but leaves its exact history intact', async t => {
  const f = await mapped(t); await f.prepareAndReview(); const attempt = f.admit(f.applied), saved = f.store.get('narration_speech_proposal', f.proposal.id);
  f.edit('voice', 'personal');
  await assert.rejects(f.bridge.submit(attempt.request, context(attempt)), { code: 'NARRATION_SPEECH_STALE' });
  assert.equal(f.store.list('speech_execution_dispatch', f.project.id).length, 0); assert.deepEqual(f.calls, { http: 0, credentials: 0 });
  assert.deepEqual(f.store.get('narration_speech_proposal', f.proposal.id), saved);
});

test('unrelated shot preferences do not block reviewed speech for this shot', async t => {
  const f = await mapped(t); await f.prepareAndReview(); f.edit('voice', 'personal', f.project.shots[1].id);
  const attempt = f.admit(f.applied); assert.ok(attempt.id);
  assert.equal((await f.bridge.submit(attempt.request, context(attempt))).type, 'completed'); assert.equal(f.calls.http, 1);
});

test('current personal preference refuses stock preparation even if a legacy saved section has no selected voice', async t => {
  const f = await mapped(t), before = f.store.getProject(f.project.id);
  before.shots[0].narration.voice = 'personal'; before.revisionId = key(); f.store.saveProject(before, before.headVersion);
  const current = f.store.getProject(f.project.id); f.store.insert('project_revision', current.revisionId, f.project.id, { project: current });
  const actor = f.production.beginRequest(f.project.id, 'local-user', 'Prepare my own voice.'), director = f.production.openEpoch(f.project.id, actor).actor;
  await assert.rejects(f.service.prepare(f.project.id, director, f.input({ voice: 'coral' })), { code: 'PERSONAL_VOICE_REQUIRED' });
});

test('changed card writing requires saving the current shot script before a fresh speech proposal', async t => {
  const f = await mapped(t); f.edit('text', 'New words requested on the shot card.');
  const actor = f.production.beginRequest(f.project.id, 'local-user', 'Prepare the edited words.'), director = f.production.openEpoch(f.project.id, actor).actor;
  await assert.rejects(f.service.prepare(f.project.id, director, f.input()), { code: 'NARRATION_SPEECH_STALE' });
});

test('already completed speech keeps its exact recoverable output after mapped shot intent changes', async t => {
  const f = await mapped(t); await f.prepareAndReview(); const attempt = f.admit(f.applied);
  const completed = await f.bridge.submit(attempt.request, context(attempt)); assert.equal(completed.type, 'completed');
  f.edit('voice', 'personal'); assert.deepEqual(await f.bridge.lookup(attempt.id), completed); assert.equal(f.calls.http, 1);
});

test('a late actual normalized speech result stays historical after the shot switches to personal voice', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await mapped(t, { fetch: async () => { entered.resolve(); await release.promise; return response(); } }); await f.prepareAndReview();
  const media = new LocalMediaService({ rootDir: join(f.root, 'media'), allowedInputRoots: [f.outputs.rootDir],
    ffmpegPath: process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg'),
    ffprobePath: process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe') });
  const engine = new Engine(f.store, f.bridge, { artifactDir: f.artifactDir, profiles: f.profiles, outputStore: f.outputs,
    outputIngestor: new SpoolAudioIngestor(f.outputs, media, { rootDir: join(f.root, 'audio-derivations') }),
    externalAdmission: new DurableExternalAdmission(f.store, () => {}) });
  const running = engine.runReady(); await entered.promise; f.edit('voice', 'personal'); release.resolve(); await running;
  const attempt = f.store.list('attempt', f.project.id)[0]; assert.equal(attempt.phase, 'succeeded');
  assert.equal(f.store.list('artifact', f.project.id).length, 1); assert.equal(f.store.list('audio_derivation_receipt', f.project.id).length, 1);
  assert.equal(f.store.get('reservation', attempt.reservationId).state, 'charged');
  assert.deepEqual(f.store.get('node_binding', attempt.nodeId).outputs, {}); assert.equal(engine.outputs(f.project.id).length, 0);
  assert.equal(f.calls.http, 1); await engine.reconcile(); assert.equal(f.calls.http, 1);
});

test('post-marker unknown speech is reconciled without a fresh dispatch after mapped intent changes', async t => {
  const f = await mapped(t, { fetch: async () => { throw Error('Synthetic response lost after dispatch'); } }); await f.prepareAndReview();
  const attempt = f.admit(f.applied), outcome = await f.bridge.submit(attempt.request, context(attempt)); assert.equal(outcome.type, 'unknown');
  f.edit('mode', 'none'); assert.equal((await f.bridge.lookup(attempt.id)).type, 'unknown');
  assert.equal(f.store.list('speech_execution_dispatch', f.project.id).length, 1); assert.equal(f.calls.http, 1);
});
