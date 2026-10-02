import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENAI_SPEECH_MODEL, OpenAISpeechAdapter, describeOpenAISpeechRequest } from '../dist/openai-speech.js';

test('custom selector pins the exact provider voice object without treating local enrollment as transport authority', async () => {
  const request = { model: OPENAI_SPEECH_MODEL, voice: 'openai-custom:voice_fixture', text: 'My exact narration.', instructions: '' };
  const description = describeOpenAISpeechRequest(request), bytes = Buffer.alloc(44); bytes.write('RIFF'); bytes.write('WAVE', 8);
  let calls = 0;
  const adapter = new OpenAISpeechAdapter({ apiKey: 'offline-key', fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    assert.deepEqual(JSON.parse(Buffer.from(init.body).toString()).voice, { id: 'voice_fixture' });
    return new Response(bytes, { headers: { 'content-type': 'audio/wav' } });
  } });
  const outcome = await adapter.submit(request, { attemptId: 'custom-1', expectedRequestDigest: description.requestDigest, expectedBodySha256: description.bodySha256 });
  assert.equal(outcome.kind, 'completed'); assert.equal(calls, 1); assert.equal(description.voice, request.voice);
  assert.notEqual(describeOpenAISpeechRequest({ ...request, voice: 'openai-custom:voice_other' }).bodySha256, description.bodySha256);
  for (const voice of ['voice_fixture', 'openai-custom:voice_', 'openai-custom:https://secret.invalid', 'elevenlabs-personal:fixture', { id: 'voice_fixture' }]) assert.throws(() => describeOpenAISpeechRequest({ ...request, voice }));
});
