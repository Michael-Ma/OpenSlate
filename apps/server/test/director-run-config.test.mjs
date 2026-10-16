import test from 'node:test';
import assert from 'node:assert/strict';
import { readDirectorRunTimeout } from '../dist/application/director-run-config.js';

test('Director deadline retains three minutes by default and accepts only finite explicit host limits', () => {
  assert.equal(readDirectorRunTimeout({}), 180000);
  assert.equal(readDirectorRunTimeout({ OPENSLATE_DIRECTOR_RUN_TIMEOUT_MS: '' }), 180000);
  for (const value of ['1000', '360000', '600000']) assert.equal(readDirectorRunTimeout({ OPENSLATE_DIRECTOR_RUN_TIMEOUT_MS: value }), Number(value));
  for (const value of ['999', '600001', '-1', 'NaN', 'Infinity', '180000.5', ' 180000', '1e5'])
    assert.throws(() => readDirectorRunTimeout({ OPENSLATE_DIRECTOR_RUN_TIMEOUT_MS: value }), { code: 'CONFIGURATION_ERROR' });
});
