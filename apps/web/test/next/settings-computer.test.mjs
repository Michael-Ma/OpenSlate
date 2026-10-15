import test from 'node:test';
import assert from 'node:assert/strict';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';
import { computerView } from '../../src/next/model/settings-computer.ts';

const en = (m) => translateMsg('en', m);
const ready = { configurationValid: true, registered: true, mediaTools: { required: true, available: true }, credential: { required: true, present: true, backendUnavailable: false, apiValidated: false }, spendingPermissionRequired: false, enabledByHost: true, realExecutionEnabled: true };
const demo = { ...ready, mediaTools: { required: false, available: true }, credential: { required: false, present: null, backendUnavailable: false, apiValidated: false }, enabledByHost: false, realExecutionEnabled: false };
const option = (id, kind, adapter, readiness = ready) => ({ id, label: id, profile: { id, kind, adapter, unitCostMicros: '1' }, estimatedCost: { currency: 'USD', unitMicros: '1', basis: adapter === 'fake' ? 'fixture' : 'host_configured', actualVendorPriceVerified: false }, readiness });
const setup = (patch = {}) => ({ selection: { mode: 'native', binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' }, selectionDigest: 'd'.repeat(64), busy: false, changeAvailable: true, changeAppliesTo: 'next_turn', defaults: { binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' }, locked: true, modelCalls: 0, modelChoices: [], modelCatalogStatus: 'ready', modelCatalogCheckedAt: null, ...patch });

const catalog = { catalogDigest: 'c'.repeat(64), defaults: [], realExecutionEnabled: true, profiles: [
  option('fake-image-v1', 'image', 'fake', demo),
  option('gpt-image', 'image', 'openai-image', { ...ready, mediaTools: { required: true, available: true } }),
  option('minimax', 'video', 'minimax-h3'),
  option('viggle', 'video', 'viggle-h3', { ...ready, realExecutionEnabled: false, credential: { required: true, present: false, backendUnavailable: false, apiValidated: false } }),
  option('tts', 'speech', 'openai-speech'),
  option('whisper', 'transcription', 'openai-transcription'),
] };

test('this computer lists Codex, FFmpeg and each key a model needs, with the jobs that use it', () => {
  const view = computerView(catalog, setup(), null);
  assert.equal(view.demoOnly, false);
  assert.deepEqual(view.rows.map((r) => [r.id, en(r.name), en(r.status), r.tone]), [
    ['codex', 'Codex', 'Found', 'ok'],
    ['ffmpeg', 'FFmpeg', 'Found', 'ok'],
    ['key-openai', 'OpenAI key', 'Set', 'ok'],
    ['key-minimax', 'MiniMax key', 'Set', 'ok'],
    ['key-viggle', 'Viggle key', 'Not set', 'missing'],
  ]);
  assert.deepEqual(view.rows[2].jobs.map((id) => translate('en', id)), ['Keyframes', 'Narration', 'Transcription']);
  assert.deepEqual(view.rows[4].jobs.map((id) => translate('en', id)), ['Video']);
});

test('Codex and FFmpeg say plainly when they are missing or not checked', () => {
  const noFfmpeg = { ...catalog, profiles: catalog.profiles.map((o) => (o.profile.kind === 'video' ? { ...o, readiness: { ...o.readiness, mediaTools: { required: true, available: false } } } : o)) };
  const rows = computerView(noFfmpeg, setup({ selection: { mode: 'fake' }, defaults: { binaryPath: '', model: 'm' }, modelCatalogStatus: 'unchecked' }), null).rows;
  assert.deepEqual([en(rows[0].status), en(rows[0].detail)], ['Not found', 'Install Codex and sign in, then check again. The Director, written plans and Codex images need it.']);
  assert.equal(en(rows[1].status), 'Not found');
  assert.equal(en(computerView(catalog, setup({ modelCatalogStatus: 'unchecked' }), null).rows[0].status), 'Not checked');
  assert.equal(en(computerView(catalog, setup({ modelCatalogStatus: 'blocked' }), null).rows[0].status), 'Needs attention');
  assert.equal(en(computerView(catalog, null, 'SERVICE_UNAVAILABLE').rows[0].status), 'Not reported');
});

test('a computer with only the stand-ins says so and lists no keys', () => {
  const view = computerView({ ...catalog, profiles: [catalog.profiles[0]] }, setup(), null);
  assert.equal(view.demoOnly, true);
  assert.deepEqual(view.rows.map((r) => r.id), ['codex', 'ffmpeg']);
  assert.equal(en(view.rows[1].status), 'Not checked');
});
