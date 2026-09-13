import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCreationCommand, providerEstimate, canUseDemo, providerExecutionStatus, PROVIDER_KIND_CHOICES, providerSelectionForKind, selectedProviderForKind } from '../src/provider-model.ts';

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

test('audio selectors retain independent image/video/audio choices and reset to the unchanged default request', () => {
  const defaults = ['image', 'video', 'speech', 'transcription'].map(kind => `fake-${kind}-v1`);
  const profiles = ['image', 'video', 'speech', 'transcription'].flatMap((kind, i) => [
    { id: defaults[i], profile: { kind, adapter: 'fake' } }, { id: `external-${kind}`, profile: { kind, adapter: `external-${kind}` } },
  ]);
  const catalog = { catalogDigest: 'a'.repeat(64), defaults, profiles }, original = structuredClone(catalog);
  assert.deepEqual(PROVIDER_KIND_CHOICES.map(choice => choice.kind), ['image', 'video', 'speech', 'transcription']);
  assert.equal(selectedProviderForKind(catalog, null, 'speech').id, 'fake-speech-v1');
  const partial = { expectedCatalogDigest: catalog.catalogDigest, profileIds: ['external-image', 'fake-video-v1'] };
  assert.equal(selectedProviderForKind(catalog, partial, 'transcription').id, 'fake-transcription-v1', 'older partial selection still displays its default audio choice');
  let selection = providerSelectionForKind(catalog, partial, 'speech', 'external-speech');
  assert.deepEqual(selection.profileIds, ['external-image', 'fake-video-v1', 'external-speech', 'fake-transcription-v1']);
  selection = providerSelectionForKind(catalog, selection, 'transcription', 'external-transcription');
  selection = providerSelectionForKind(catalog, selection, 'video', 'external-video');
  assert.deepEqual(selection.profileIds, ['external-image', 'external-video', 'external-speech', 'external-transcription']);
  const command = projectCreationCommand('Boots', 'audio-choice', selection); selection.profileIds[2] = 'changed';
  assert.equal(command.body.profileIds[2], 'external-speech');
  for (const kind of ['image', 'video', 'speech', 'transcription']) {
    selection = providerSelectionForKind(catalog, { expectedCatalogDigest: catalog.catalogDigest, profileIds: command.body.profileIds }, kind, `fake-${kind}-v1`);
    command.body.profileIds = selection?.profileIds ?? defaults;
  }
  assert.equal(selection, null); assert.deepEqual(projectCreationCommand('Boots', 'defaults', selection), { key: 'defaults', body: { name: 'Boots' } });
  assert.deepEqual(catalog, original);
});

test('a changed catalog or a provider from another operation cannot be substituted through an audio selector', () => {
  const catalog = { catalogDigest: 'a'.repeat(64), defaults: [], profiles: [{ id: 'voice', profile: { kind: 'speech' } }, { id: 'recognition', profile: { kind: 'transcription' } }] };
  assert.throws(() => providerSelectionForKind(catalog, { expectedCatalogDigest: 'b'.repeat(64), profileIds: ['voice'] }, 'transcription', 'recognition'), /Refresh/);
  assert.throws(() => providerSelectionForKind(catalog, null, 'speech', 'recognition'), /Refresh/);
  assert.throws(() => providerSelectionForKind(catalog, null, 'transcription', 'missing'), /Refresh/);
});
