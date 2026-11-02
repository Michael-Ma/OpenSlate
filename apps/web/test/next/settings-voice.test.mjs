import test from 'node:test';
import assert from 'node:assert/strict';
import { translateMsg } from '../../src/next/i18n/translate.ts';
import { draftProblems, emptyDraft, idTail, narratorChoices, narratorName, narratorRequest, registerRequest, revokeRequest, undoTarget, usableNarrator, voiceCards } from '../../src/next/model/settings-voice.ts';

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

test('Undo goes back only to a voice that can still narrate, and only while the change is the current setting', () => {
  assert.equal(usableNarrator('cedar', voices), true);
  assert.equal(usableNarrator('openai-custom:voice_m7f3a', voices), true);
  assert.equal(usableNarrator('openai-custom:voice_old99', voices), false, 'revoked');
  assert.equal(usableNarrator('elevenlabs-personal:abc123', voices), false, 'not usable for narration');
  assert.equal(undoTarget({ previous: 'cedar', set: 'marin' }, 'marin', voices), 'cedar');
  assert.equal(undoTarget({ previous: 'cedar', set: 'marin' }, 'ash', voices), null, 'changed again since');
  assert.equal(undoTarget({ previous: 'openai-custom:voice_old99', set: 'marin' }, 'marin', voices), null, 'the old voice was revoked since');
  assert.equal(undoTarget(null, 'marin', voices), null);
});

const voiceModel = await import('../../src/next/model/settings-voice.ts');
const undoOrigin = { projectId: 'film-a', projectEpoch: 1 };
const undoChange = { previous: 'cedar', set: 'marin' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

test('B17 #6 narrator Undo reads the saved voice and matching fresh head instead of the old form head', async () => {
  const reads = [];
  const prepared = await voiceModel.prepareNarratorUndo(undoChange, undoOrigin, async path => {
    reads.push(path);
    return path.endsWith('/settings/voice') ? { narratorVoice: 'marin', headVersion: 13 } : { voices, headVersion: 13 };
  }, () => undoOrigin);
  assert.deepEqual(reads.sort(), ['/api/projects/film-a/narration/personal-voices', '/api/projects/film-a/settings/voice']);
  assert.equal(prepared.request.path, '/api/projects/film-a/settings/voice');
  assert.deepEqual(prepared.request.body, { narratorVoice: 'cedar', expectedHeadVersion: 13 });
  assert.equal(prepared.target, 'cedar');
});

test('B17 #6 narrator Undo refuses another saved choice, revoked voices and mismatched read baselines', async () => {
  const read = (saved, personalHead = saved.headVersion) => async path => path.endsWith('/settings/voice') ? saved : { voices, headVersion: personalHead };
  assert.equal(await voiceModel.prepareNarratorUndo(undoChange, undoOrigin, read({ narratorVoice: 'ash', headVersion: 14 }), () => undoOrigin), null);
  assert.equal(await voiceModel.prepareNarratorUndo({ previous: voices[2].id, set: 'marin' }, undoOrigin, read({ narratorVoice: 'marin', headVersion: 14 }), () => undoOrigin), null);
  assert.deepEqual(await voiceModel.prepareNarratorUndo(undoChange, undoOrigin, read({ narratorVoice: 'marin', headVersion: 14 }, 15), () => undoOrigin), { kind: 'waiting' });
});

test('B17 #6 narrator Undo is fenced before and after reads, including A to B to A', async () => {
  let current = { projectId: 'film-b', projectEpoch: 2 };
  let reads = 0;
  assert.equal(await voiceModel.prepareNarratorUndo(undoChange, undoOrigin, async () => { reads++; }, () => current), null);
  assert.equal(reads, 0);
  current = undoOrigin;
  const saved = deferred();
  const pending = voiceModel.prepareNarratorUndo(undoChange, undoOrigin, async path => path.endsWith('/settings/voice') ? saved.promise : { voices, headVersion: 13 }, () => current);
  current = { projectId: 'film-a', projectEpoch: 3 };
  saved.resolve({ narratorVoice: 'marin', headVersion: 13 });
  assert.equal(await pending, null);
});

test('B17 #6 narrator Undo does not prepare a write after a failed fresh read', async () => {
  await assert.rejects(voiceModel.prepareNarratorUndo(undoChange, undoOrigin, async () => { throw new TypeError('offline'); }, () => undoOrigin), /offline/);
});
