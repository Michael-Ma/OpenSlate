import test from 'node:test';
import assert from 'node:assert/strict';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';

test('credential metadata reports readiness without revealing keys or arbitrary environment contents', () => {
  const values = { OPENSLATE_OPENAI_API_KEY: 'synthetic-openai-secret', OPENSLATE_MINIMAX_API_KEY: 'synthetic-minimax-secret', OPENSLATE_VIGGLE_API_KEY: 'synthetic-viggle-secret', PRIVATE_OTHER_KEY: 'unrelated' }, reads = [];
  const credentials = new EnvironmentMediaCredentials(name => { reads.push(name); return values[name]; });
  assert.deepEqual(credentials.status(), { backend: 'environment', credentials: [{ id: 'openai-media', configured: true }, { id: 'minimax-video', configured: true }, { id: 'viggle-video', configured: true }] });
  assert.equal(credentials.resolve('openai-media'), values.OPENSLATE_OPENAI_API_KEY);
  assert.equal(credentials.resolve('minimax-video'), values.OPENSLATE_MINIMAX_API_KEY);
  assert.equal(credentials.resolve('viggle-video'), values.OPENSLATE_VIGGLE_API_KEY);
  assert.equal(JSON.stringify(credentials), '{}'); assert.ok(!JSON.stringify(credentials.status()).includes('secret'));
  assert.ok(reads.every(name => ['OPENSLATE_OPENAI_API_KEY', 'OPENSLATE_MINIMAX_API_KEY', 'OPENSLATE_VIGGLE_API_KEY'].includes(name)));
});

test('unknown aliases cannot select another environment secret', () => {
  let reads = 0; const credentials = new EnvironmentMediaCredentials(() => { reads++; return 'secret'; });
  for (const id of ['PRIVATE_OTHER_KEY', '__proto__', 'constructor', 'env:OPENSLATE_OPENAI_API_KEY', 'OPENSLATE_VIGGLE_API_KEY', 'env:OPENSLATE_VIGGLE_API_KEY', ''])
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


test('each fixed provider alias is isolated and a missing Viggle key cannot borrow another provider credential', () => {
  const aliases = [['openai-media', 'OPENSLATE_OPENAI_API_KEY'], ['minimax-video', 'OPENSLATE_MINIMAX_API_KEY'], ['viggle-video', 'OPENSLATE_VIGGLE_API_KEY']];
  for (const [selectedId, selectedName] of aliases) {
    const reads = [], credentials = new EnvironmentMediaCredentials(name => { reads.push(name); return name === selectedName ? 'synthetic-selected-secret' : undefined; });
    assert.deepEqual(credentials.status().credentials, aliases.map(([id]) => ({ id, configured: id === selectedId })));
    for (const [id, name] of aliases) {
      reads.length = 0;
      if (id === selectedId) assert.equal(credentials.resolve(id), 'synthetic-selected-secret');
      else assert.throws(() => credentials.resolve(id), error => error.code === 'MEDIA_CREDENTIAL_MISSING');
      assert.deepEqual(reads, [name]);
    }
  }
  const credentials = new EnvironmentMediaCredentials(name => name === 'OPENSLATE_VIGGLE_API_KEY' ? undefined : 'synthetic-other-provider-secret');
  assert.throws(() => credentials.resolve('viggle-video'), error => error.code === 'MEDIA_CREDENTIAL_MISSING');
});

test('Viggle readiness and failures are sanitized, detached metadata with the same key validation bounds', () => {
  for (const value of [undefined, '', 'synthetic key', 'synthetic\nkey', '\x00synthetic', 'x'.repeat(8193)]) {
    const credentials = new EnvironmentMediaCredentials(name => name === 'OPENSLATE_VIGGLE_API_KEY' ? value : undefined);
    assert.deepEqual(credentials.status().credentials.find(item => item.id === 'viggle-video'), { id: 'viggle-video', configured: false });
    assert.throws(() => credentials.resolve('viggle-video'), error => error.code === 'MEDIA_CREDENTIAL_MISSING' && !String(error).includes('synthetic'));
  }
  let value = 'first-synthetic-viggle-secret';
  const credentials = new EnvironmentMediaCredentials(name => name === 'OPENSLATE_VIGGLE_API_KEY' ? value : undefined);
  const status = credentials.status(); status.credentials.find(item => item.id === 'viggle-video').configured = false;
  assert.equal(credentials.status().credentials.find(item => item.id === 'viggle-video').configured, true);
  assert.equal(JSON.stringify(credentials), '{}'); assert.ok(!JSON.stringify(credentials.status()).includes(value));
  assert.equal(credentials.resolve('viggle-video'), value); value = 'rotated-synthetic-viggle-secret';
  assert.equal(credentials.resolve('viggle-video'), value); value = 'x'.repeat(8192); assert.equal(credentials.resolve('viggle-video').length, 8192);
  value = ''; assert.throws(() => credentials.resolve('viggle-video'), error => error.code === 'MEDIA_CREDENTIAL_MISSING');
  const broken = new EnvironmentMediaCredentials(() => { throw Error('synthetic private Viggle detail'); });
  for (const call of [() => broken.status(), () => broken.resolve('viggle-video')]) assert.throws(call,
    error => error.code === 'MEDIA_CREDENTIAL_UNAVAILABLE' && !String(error).includes('synthetic private') && !JSON.stringify(error).includes('synthetic private'));
});
