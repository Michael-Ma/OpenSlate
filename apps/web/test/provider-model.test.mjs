import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCreationCommand, providerEstimate, canUseDemo } from '../src/provider-model.ts';

test('project creation preserves old default payload and detaches exact catalog choices for retry', () => {
  assert.deepEqual(projectCreationCommand('  Boots  ', 'key', null), { key: 'key', body: { name: 'Boots' } });
  const selection = { expectedCatalogDigest: 'a'.repeat(64), profileIds: ['installed-image', 'fake-video-v1'] };
  const request = projectCreationCommand('Boots', 'same-command', selection);
  selection.expectedCatalogDigest = 'b'.repeat(64); selection.profileIds[0] = 'other-image';
  assert.deepEqual(request, { key: 'same-command', body: { name: 'Boots', expectedCatalogDigest: 'a'.repeat(64), profileIds: ['installed-image', 'fake-video-v1'] } });
  for (const invalid of [{ expectedCatalogDigest: 'bad', profileIds: ['image'] }, { expectedCatalogDigest: 'a'.repeat(64), profileIds: [] },
    { expectedCatalogDigest: 'a'.repeat(64), profileIds: ['same', 'same'] }, { expectedCatalogDigest: 'a'.repeat(64), profileIds: ['https://example.test'] }])
    assert.throws(() => projectCreationCommand('Boots', 'key', invalid));
});

test('cost display preserves micro-dollar precision and distinguishes demo credits from configured estimates', () => {
  assert.equal(providerEstimate({ estimatedCost: { basis: 'fixture', unitMicros: '1000' } }), 'Demo · no media API calls');
  assert.equal(providerEstimate({ estimatedCost: { basis: 'host_configured', unitMicros: '1' } }), 'Configured estimate: $0.000001 USD / attempt');
  assert.equal(providerEstimate({ estimatedCost: { basis: 'host_configured', unitMicros: '1250000' } }), 'Configured estimate: $1.25 USD / attempt');
  assert.equal(providerEstimate({ estimatedCost: { basis: 'host_configured', unitMicros: '999999999999999999' } }), 'Configured estimate: $999999999999.999999 USD / attempt');
  assert.equal(providerEstimate({ estimatedCost: null }), 'Estimate unavailable');
});

test('demo availability follows saved media profiles instead of director mode or friendly labels', () => {
  const demo = ['fake-image-v1', 'fake-video-v1', 'fake-speech-v1'].map(id => ({ id, profile: { adapter: 'fake' } }));
  assert.equal(canUseDemo(demo), true);
  assert.equal(canUseDemo([{ id: 'fake-image-v1', profile: { adapter: 'openai-image' } }, ...demo.slice(1)]), false);
  assert.equal(canUseDemo(demo.slice(1)), false);
});
