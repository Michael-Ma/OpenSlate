import test from 'node:test';
import assert from 'node:assert/strict';
import { apiProxyTarget, DEFAULT_API_ORIGIN } from '../dev-proxy.ts';

test('the dev proxy never targets the live studio on 3001 unless asked to', () => {
  assert.equal(apiProxyTarget({}), DEFAULT_API_ORIGIN);
  assert.doesNotMatch(apiProxyTarget({}), /:3001\b/);
  assert.equal(apiProxyTarget({ OPENSLATE_API_ORIGIN: 'http://127.0.0.1:3001' }), 'http://127.0.0.1:3001');
});
