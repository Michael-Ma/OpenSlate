import test from 'node:test';
import assert from 'node:assert/strict';
import { translateMsg } from '../../src/next/i18n/translate.ts';
import { draftProblems, emptyDraft, idTail, narratorChoices, narratorName, narratorRequest, registerRequest, revokeRequest, voiceCards } from '../../src/next/model/settings-voice.ts';

const en = (m) => translateMsg('en', m);
const voices = [
  { id: 'openai-custom:voice_m7f3a', identityId: 'a'.repeat(64), label: 'Michael (my voice)', provider: 'openai', ready: true, state: 'registered', providerAccessVerified: false },
  { id: 'elevenlabs-personal:abc123', identityId: 'b'.repeat(64), label: 'Studio take', provider: 'elevenlabs', ready: false, state: 'provider_unavailable', providerAccessVerified: false },
  { id: 'openai-custom:voice_old99', identityId: 'c'.repeat(64), label: 'Old voice', provider: 'openai', ready: false, state: 'revoked', providerAccessVerified: false },
];

test('the narrator offers stock voices and ready personal voices only', () => {
  const choices = narratorChoices('cedar', voices);
  assert.equal(choices.stock.length, 13);
  assert.deepEqual(choices.stock.filter((o) => o.isDefault).map((o) => o.name), ['Cedar']);
  assert.deepEqual(choices.personal.map((o) => o.value), ['openai-custom:voice_m7f3a']);
  assert.equal(choices.unavailable, null);
  assert.equal(narratorName('marin', voices), 'Marin');
  assert.equal(narratorName('openai-custom:voice_m7f3a', voices), 'Michael (my voice)');
  assert.deepEqual(narratorRequest('marin', 12), { path: '/settings/voice', body: { narratorVoice: 'marin', expectedHeadVersion: 12 } });
});

test('a saved narrator voice that was revoked shows as unavailable, never silently replaced', () => {
  const choices = narratorChoices('openai-custom:voice_old99', voices);
  assert.deepEqual(choices.unavailable, { value: 'openai-custom:voice_old99', name: 'Old voice', isDefault: false });
});

test('personal voice cards say provider, a short voice id and consent; only usable ones show Ready', () => {
  const cards = voiceCards(voices);
  assert.deepEqual(cards.map((c) => [c.provider, c.idTail, en(c.status), en(c.note), c.canRevoke]), [
    ['OpenAI', '…7f3a', 'Ready', 'consent recorded', true],
    ['ElevenLabs', '…c123', "Can't be used yet", "ElevenLabs isn't connected to narration yet", true],
    ['OpenAI', '…ld99', 'Revoked', 'revoked; lines already made keep their audio', false],
  ]);
  assert.equal(idTail('elevenlabs-personal:ab'), 'ab');
  assert.deepEqual(revokeRequest('a'.repeat(64)), { path: `/narration/personal-voices/${'a'.repeat(64)}/revoke`, body: {} });
});

test('Add voice stays off until the name, the voice id and both consents are there', () => {
  const draft = emptyDraft();
  assert.deepEqual(draftProblems(draft).map(en), ['Give the voice a name.', 'OpenAI voice IDs start with voice_.', 'Both confirmations are needed.']);
  const named = { ...draft, label: 'My voice', voiceId: 'voice_abc', ownVoice: true };
  assert.deepEqual(draftProblems(named).map(en), ['Both confirmations are needed.']);
  assert.deepEqual(draftProblems({ ...named, permitSynthesis: true }), []);
  assert.deepEqual(draftProblems({ ...named, permitSynthesis: true, provider: 'elevenlabs', voiceId: 'abc-123' }), []);
  assert.equal(en(draftProblems({ ...named, permitSynthesis: true, provider: 'elevenlabs', voiceId: 'a b' })[0]), 'Enter the voice ID: letters, numbers, - and _.');
});

test('registration sends both consents as literal true', () => {
  const request = registerRequest({ label: ' My voice ', provider: 'openai', voiceId: ' voice_abc ', ownVoice: true, permitSynthesis: true }, 12);
  assert.deepEqual(request, { path: '/narration/personal-voices', body: { expectedHeadVersion: 12, label: 'My voice', provider: 'openai', providerVoiceId: 'voice_abc', ownVoice: true, permitSynthesis: true } });
});
