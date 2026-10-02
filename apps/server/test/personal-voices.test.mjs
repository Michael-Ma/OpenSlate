import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@openslate/core';
import { PersonalVoiceService, projectPersonalVoices, assertPersonalVoiceCurrent } from '../dist/narration/personal-voices.js';
import { narrationSpeechFixture, key } from './narration-speech-fixture.mjs';
import { speechFixture, context } from './speech-execution-fixture.mjs';
import { projectNarrationSpeechOptions } from '../dist/narration/narration-speech-projection.js';

function owner(f, options = {}) {
  const human = f.production.beginRequest(f.project.id, 'local-user', 'Register my consented provider voice.', options);
  const service = new PersonalVoiceService(f.production);
  const input = patch => ({ key: key(), expectedHeadVersion: f.store.getProject(f.project.id).headVersion, label: 'My voice', provider: 'openai', providerVoiceId: 'voice_fixture', ownVoice: true, permitSynthesis: true, ...patch });
  return { human, service, input };
}

test('human registration is durable, project-owned, consented and idempotent with no media calls or grants', async t => {
  const f = await narrationSpeechFixture(t), { human, service, input } = owner(f), command = input();
  const before = f.store.list('grant', f.project.id).length;
  const voice = service.register(f.project.id, human, command);
  assert.deepEqual(service.register(f.project.id, human, command), voice);
  assert.equal(voice.selector, 'openai-custom:voice_fixture'); assert.equal(voice.providerAccessVerified, false);
  assert.equal(voice.id, digest({ projectId: f.project.id, voice: voice.selector }));
  assert.equal(voice.consent.requestId, human.requestId); assert.equal(f.store.list('grant', f.project.id).length, before);
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
  assert.doesNotThrow(() => assertPersonalVoiceCurrent(f.store, f.project.id, voice.selector));
  assert.equal(projectPersonalVoices(f.store, f.project.id)[0].ready, true);
  const options = projectNarrationSpeechOptions(f.production, f.project.id);
  assert.ok(options.voices.includes(voice.selector)); assert.equal(options.personalVoices[0].label, 'My voice');
  const other = f.production.createProject('Other project');
  assert.throws(() => assertPersonalVoiceCurrent(f.store, other.id, voice.selector), { code: 'PERSONAL_VOICE_NOT_ENROLLED' });
});

test('director consent, missing ownership/permission, arbitrary IDs, stale edits and changed replay are rejected', async t => {
  const f = await narrationSpeechFixture(t), { human, service, input } = owner(f);
  const director = f.production.openEpoch(f.project.id, human).actor;
  assert.throws(() => service.register(f.project.id, director, input()), { code: 'ACTOR_DENIED' });
  for (const patch of [{ ownVoice: false }, { permitSynthesis: false }, { providerVoiceId: 'https://private.invalid' }, { label: '' }, { extra: 'field' }]) assert.throws(() => service.register(f.project.id, human, input(patch)), { code: 'PERSONAL_VOICE_INVALID' });
  assert.throws(() => service.register(f.project.id, human, input({ expectedHeadVersion: 99 })), { code: 'REVISION_CONFLICT' });
  const command = input(); service.register(f.project.id, human, command);
  assert.throws(() => service.register(f.project.id, human, { ...command, label: 'Changed' }));
  f.production.beginRequest(f.project.id, 'local-user', 'A new edit');
  assert.throws(() => service.register(f.project.id, human, input()), { code: 'ACTOR_DENIED' });
});

test('revocation keeps identity/history but blocks new use and never falls back to a stock voice', async t => {
  const f = await narrationSpeechFixture(t), { human, service, input } = owner(f);
  const voice = service.register(f.project.id, human, input()), command = { key: key(), identityId: voice.id };
  const revoked = service.revoke(f.project.id, human, command); assert.deepEqual(service.revoke(f.project.id, human, command), revoked);
  assert.equal(projectPersonalVoices(f.store, f.project.id)[0].ready, false);
  assert.equal(projectPersonalVoices(f.store, f.project.id)[0].state, 'revoked');
  assert.deepEqual(f.store.get('personal_voice', voice.id), voice);
  assert.throws(() => assertPersonalVoiceCurrent(f.store, f.project.id, voice.selector), { code: 'PERSONAL_VOICE_REVOKED' });
  assert.throws(() => service.register(f.project.id, human, input()), { code: 'PERSONAL_VOICE_REVOKED' });
  assert.ok(!projectNarrationSpeechOptions(f.production, f.project.id).voices.includes(voice.selector));
});

test('unconnected provider identities can be retained but are never exposed as ready speech voices', async t => {
  const f = await narrationSpeechFixture(t), { human, service, input } = owner(f);
  const voice = service.register(f.project.id, human, input({ provider: 'elevenlabs', providerVoiceId: 'fixture_voice' }));
  assert.equal(projectPersonalVoices(f.store, f.project.id)[0].state, 'provider_unavailable');
  assert.throws(() => assertPersonalVoiceCurrent(f.store, f.project.id, voice.selector), { code: 'PERSONAL_VOICE_PROVIDER_UNAVAILABLE' });
  assert.ok(!projectNarrationSpeechOptions(f.production, f.project.id).voices.includes(voice.selector));
});

test('fresh speech proposals require the enrolled selector and revoked voices fail preparation', async t => {
  const f = await narrationSpeechFixture(t), { human, service, input } = owner(f);
  const actor = f.production.openEpoch(f.project.id, human).actor;
  const prepare = voice => f.service.prepare(f.project.id, actor, f.input({ voice }));
  await assert.rejects(prepare('openai-custom:voice_fixture'), { code: 'PERSONAL_VOICE_NOT_ENROLLED' });
  const identity = service.register(f.project.id, human, input());
  const proposal = await prepare(identity.selector); assert.equal(proposal.operation.voice, identity.selector);
  service.revoke(f.project.id, human, { key: key(), identityId: identity.id });
  await assert.rejects(prepare(identity.selector), { code: 'PERSONAL_VOICE_REVOKED' });
  assert.equal(f.store.get('narration_speech_proposal', proposal.id).operation.voice, identity.selector);
});

test('actual speech bridge refuses a revoked first dispatch while completed evidence recovers after revocation', async t => {
  const f = speechFixture(t, { voice: 'openai-custom:voice_fixture', deferAdmission: true }), { human, service, input } = owner(f, { editing: false });
  const identity = service.register(f.project.id, human, input());
  f.attempt = f.admit(); f.request = f.attempt.request;
  service.revoke(f.project.id, human, { key: key(), identityId: identity.id });
  const rejected = await f.bridge.submit(f.request, context(f)); assert.equal(rejected.type, 'rejected'); assert.equal(rejected.certainty, 'not_accepted');
  assert.equal(f.store.get('speech_execution_result', f.attempt.id).observation.kind, 'not_dispatched');
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
  const g = speechFixture(t, { voice: 'openai-custom:voice_fixture', deferAdmission: true }), owned = owner(g, { editing: false });
  const registered = owned.service.register(g.project.id, owned.human, owned.input());
  g.attempt = g.admit(); g.request = g.attempt.request;
  const completed = await g.bridge.submit(g.request, context(g)); assert.equal(completed.type, 'completed');
  owned.service.revoke(g.project.id, owned.human, { key: key(), identityId: registered.id });
  assert.deepEqual(await g.bridge.lookup(g.attempt.id), completed); assert.deepEqual(await g.bridge.submit(g.request), completed);
  assert.deepEqual(g.calls, { http: 1, credentials: 1 });
});

test('consent revoked during credential resolution records positive no-dispatch evidence instead of an unknown paid submission', t => {
  let revoke;
  const f = speechFixture(t, { voice: 'openai-custom:voice_fixture', deferAdmission: true, credential: () => { revoke(); return 'offline-key'; } });
  const owned = owner(f, { editing: false }), registered = owned.service.register(f.project.id, owned.human, owned.input());
  f.attempt = f.admit(); f.request = f.attempt.request;
  revoke = () => owned.service.revoke(f.project.id, owned.human, { key: key(), identityId: registered.id });
  return f.bridge.submit(f.request, context(f)).then(result => {
    assert.equal(result.type, 'rejected'); assert.equal(result.certainty, 'not_accepted');
    assert.equal(f.store.list('speech_execution_dispatch', f.project.id).length, 0);
    assert.equal(f.store.get('speech_execution_result', f.attempt.id).observation.kind, 'not_dispatched');
    assert.deepEqual(f.calls, { http: 0, credentials: 1 });
  });
});

test('revoking a reviewed personal voice blocks admission before any attempt, reservation or allowance consumption', async t => {
  const f = await narrationSpeechFixture(t, { realSpeech: true }), service = new PersonalVoiceService(f.production);
  const human = f.production.beginRequest(f.project.id, 'local-user', 'Consent for my narration voice.', { editing: false });
  const identity = service.register(f.project.id, human, { key: key(), expectedHeadVersion: f.store.getProject(f.project.id).headVersion,
    label: 'My voice', provider: 'openai', providerVoiceId: 'voice_fixture', ownVoice: true, permitSynthesis: true });
  const proposal = await f.prepare(f.input({ voice: identity.selector })), applied = await f.review(proposal);
  f.issue(applied); service.revoke(f.project.id, human, { key: key(), identityId: identity.id });
  assert.throws(() => f.admit(applied), { code: 'PERSONAL_VOICE_REVOKED' });
  for (const kind of ['attempt', 'reservation', 'external_allowance_consumption', 'speech_execution_dispatch']) assert.equal(f.store.list(kind, f.project.id).length, 0);
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});
