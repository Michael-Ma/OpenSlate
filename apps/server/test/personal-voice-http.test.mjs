import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { registerPersonalVoiceRoutes } from '../dist/narration/personal-voice-routes.js';
import { narrationSpeechFixture, key } from './narration-speech-fixture.mjs';
const token = 'offline_personal_voice_http_token';

test('authenticated consent configuration is idempotent and creates no creative holds, epochs or paid authority', async t => {
  const f = await narrationSpeechFixture(t), app = createApp({ service: f.production, localToken: token });
  registerPersonalVoiceRoutes(app, f.production); await app.ready(); t.after(() => app.close());
  const url = `/api/projects/${f.project.id}/narration/personal-voices`;
  const headers = { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': key() };
  const payload = { expectedHeadVersion: f.store.getProject(f.project.id).headVersion, label: 'My narration', provider: 'openai', providerVoiceId: 'voice_http_fixture', ownVoice: true, permitSynthesis: true };
  const unchangedKinds = ['hold', 'epoch', 'grant', 'attempt', 'external_allowance'];
  const frozen = () => unchangedKinds.map(kind => f.store.list(kind, f.project.id));
  const before = frozen(), projectBefore = f.store.getProject(f.project.id);
  assert.equal((await app.inject({ method: 'POST', url, payload, headers: { ...headers, authorization: '' } })).statusCode, 403);
  const first = await app.inject({ method: 'POST', url, payload, headers }); assert.equal(first.statusCode, 200, first.body);
  const messages = f.store.list('message', f.project.id), request = messages.at(-1);
  assert.equal(request.editing, false); assert.equal(request.principalId, 'local-user');
  assert.deepEqual(frozen(), before); assert.deepEqual(f.store.getProject(f.project.id), projectBefore);
  assert.doesNotThrow(() => f.production.assertActor(f.project.id, f.actor, true));
  const replay = await app.inject({ method: 'POST', url, payload, headers }); assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), first.json()); assert.equal(f.store.list('message', f.project.id).length, messages.length);
  const read = await app.inject({ method: 'GET', url, headers }); assert.equal(read.json().voices[0].ready, true);
  const listed = read.json().voices[0], identity = first.json().voice;
  assert.equal(listed.id, identity.selector); assert.equal(listed.identityId, identity.id);
  assert.equal(listed.providerVoiceId, payload.providerVoiceId); assert.equal(listed.consentGrantedAt, identity.consent.recordedAt);
  assert.equal(listed.consentRevokedAt, undefined);
  const revoke = await app.inject({ method: 'POST', url: `${url}/${first.json().voice.id}/revoke`, payload: {}, headers: { ...headers, 'idempotency-key': key() } });
  assert.equal(revoke.statusCode, 200, revoke.body); assert.deepEqual(frozen(), before);
  const revoked = (await app.inject({ method: 'GET', url, headers })).json().voices[0];
  assert.equal(revoked.ready, false); assert.equal(revoked.id, identity.selector);
  assert.equal(revoked.consentGrantedAt, identity.consent.recordedAt); assert.equal(revoked.consentRevokedAt, revoke.json().revocation.createdAt);
  assert.doesNotThrow(() => f.production.assertActor(f.project.id, f.actor, true));
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});

test('invalid or stale registration rolls back its configuration request and consent record', async t => {
  const f = await narrationSpeechFixture(t), app = createApp({ service: f.production, localToken: token });
  registerPersonalVoiceRoutes(app, f.production); await app.ready(); t.after(() => app.close());
  const url = `/api/projects/${f.project.id}/narration/personal-voices`, headers = { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': key() };
  const payload = { expectedHeadVersion: 99, label: 'My narration', provider: 'openai', providerVoiceId: 'voice_http_fixture', ownVoice: true, permitSynthesis: true };
  const snapshot = () => ['projects', 'entities', 'commands', 'events'].map(table => f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const before = snapshot(); assert.equal((await app.inject({ method: 'POST', url, payload, headers })).statusCode, 409); assert.deepEqual(snapshot(), before);
  assert.equal((await app.inject({ method: 'POST', url, payload: { ...payload, expectedHeadVersion: 0, ownVoice: false }, headers })).statusCode, 400);
  assert.deepEqual(snapshot(), before);
});
