import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';

test('credential metadata reports readiness without revealing keys or arbitrary environment contents', () => {
  const values = { OPENSLATE_OPENAI_API_KEY: 'synthetic-openai-secret', OPENSLATE_MINIMAX_API_KEY: 'synthetic-minimax-secret', PRIVATE_OTHER_KEY: 'unrelated' }, reads = [];
  const credentials = new EnvironmentMediaCredentials(name => { reads.push(name); return values[name]; });
  assert.deepEqual(credentials.status(), { backend: 'environment', credentials: [{ id: 'openai-media', configured: true }, { id: 'minimax-video', configured: true }] });
  assert.equal(credentials.resolve('openai-media'), values.OPENSLATE_OPENAI_API_KEY);
  assert.equal(credentials.resolve('minimax-video'), values.OPENSLATE_MINIMAX_API_KEY);
  assert.equal(JSON.stringify(credentials), '{}'); assert.ok(!JSON.stringify(credentials.status()).includes('secret'));
  assert.ok(reads.every(name => ['OPENSLATE_OPENAI_API_KEY', 'OPENSLATE_MINIMAX_API_KEY'].includes(name)));
});

test('unknown aliases cannot select another environment secret', () => {
  let reads = 0; const credentials = new EnvironmentMediaCredentials(() => { reads++; return 'secret'; });
  for (const id of ['PRIVATE_OTHER_KEY', '__proto__', 'constructor', 'env:OPENSLATE_OPENAI_API_KEY', ''])
    assert.throws(() => credentials.resolve(id), error => error.code === 'MEDIA_CREDENTIAL_UNKNOWN' && !error.message.includes(id || 'impossible'));
  assert.equal(reads, 0);
});

test('missing, malformed and oversized keys fail with sanitized diagnostics', () => {
  for (const value of [undefined, '', 'key\nvalue', ' key', '\x00secret', 'x'.repeat(8193)]) {
    const credentials = new EnvironmentMediaCredentials(() => value);
    assert.ok(credentials.status().credentials.every(item => !item.configured));
    assert.throws(() => credentials.resolve('openai-media'), error => error.code === 'MEDIA_CREDENTIAL_MISSING');
  }
  const credentials = new EnvironmentMediaCredentials(() => { throw new Error('synthetic private credential source detail'); });
  assert.throws(() => credentials.resolve('openai-media'), error => error.code === 'MEDIA_CREDENTIAL_UNAVAILABLE' && !JSON.stringify(error).includes('synthetic private'));
});

test('rotation is resolved at use time without caching an old secret', () => {
  let key = 'first-test-key'; const credentials = new EnvironmentMediaCredentials(() => key);
  assert.equal(credentials.resolve('openai-media'), key); key = 'second-test-key'; assert.equal(credentials.resolve('openai-media'), key);
  key = ''; assert.throws(() => credentials.resolve('openai-media'), error => error.code === 'MEDIA_CREDENTIAL_MISSING');
});
