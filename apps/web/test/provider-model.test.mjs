import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCreationCommand, providerEstimate, canUseDemo, providerExecutionStatus } from '../src/provider-model.ts';

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

test('incompatible saved project takes precedence over ready installation in the human status text', () => {
  const provider = { readiness: { enabledByHost: true, realExecutionEnabled: true } };
  assert.match(providerExecutionStatus(provider), /^Provider ready/);
  const incompatible = { ...provider, projectExecution: { compatible: false, code: 'LOCAL_EXECUTION_UPGRADE_REQUIRED', message: 'Create a new project with video generation enabled on this computer.' } };
  assert.equal(providerExecutionStatus(incompatible), incompatible.projectExecution.message);
  assert.doesNotMatch(providerExecutionStatus(incompatible), /Provider ready/);
  assert.match(providerExecutionStatus({ ...provider, readiness: { enabledByHost: true, realExecutionEnabled: false } }), /setup is incomplete/);
  assert.match(providerExecutionStatus({ readiness: { realExecutionEnabled: false } }), /Generation is disabled/);
  assert.match(providerExecutionStatus({ ...incompatible, projectExecution: { compatible: false, code: null, message: null } }), /incompatible/);
});
