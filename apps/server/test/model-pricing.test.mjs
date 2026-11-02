import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILES, digest } from '@openslate/core';
import { InstalledProviderCatalog } from '../dist/application/provider-catalog.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { modelPrice, projectModels } from '../dist/code-plan/models.js';
import { providerPricing } from '../dist/code-plan/model-pricing.js';
import { normalizeStepInput, videoModes } from '../dist/code-plan/identity.js';

const credentials = new EnvironmentMediaCredentials(() => undefined);
const builtin = new InstalledProviderCatalog({ credentials, enabledExecutions: [{ adapter: 'viggle-h3', version: '1' }] })
  .view().profiles.find(row => row.id === 'viggle-h3').profile;
const frame = { kind: 'image', sha256: 'a'.repeat(64) };
const inputs = { first_frame: { firstFrame: frame }, reference: { references: [frame] },
  first_last_frame: { firstFrame: frame, lastFrame: frame }, text: { aspectRatio: '16:9' } };
const profile = (adapter, model, settings, minimum, maximum) => ({ id: 'priced-video', revision: '1', kind: 'video', adapter, executionVersion: '1',
  configuration: { model, settings }, minFrames: minimum * 30, maxFrames: maximum * 30, maxConcurrency: 1, unitCostMicros: '1', maxRetries: 0 });
function installedModel(profile) {
  const catalog = new InstalledProviderCatalog({ credentials, configuration: { version: 1, profiles: [{ label: 'Video', profile }] } });
  const store = { getProject: () => ({ capabilityLockId: 'lock' }), get: () => ({ profiles: [profile] }) };
  return projectModels(store, 'film', catalog)[profile.id];
}

test('Viggle built-in per-second rates reproduce every six-second card price with enhance off', () => {
  const pricing = providerPricing(builtin), model = installedModel(builtin);
  assert.deepEqual(pricing, { unit: 'second', modes: [
    { mode: 'reference', microsPerSecond: '50000' }, { mode: 'first_frame', microsPerSecond: '30000' },
    { mode: 'first_last_frame', microsPerSecond: '50000' }, { mode: 'text', microsPerSecond: '30000' },
  ], minMicrosPerSecond: '30000', maxMicrosPerSecond: '50000' });
  assert.equal(model.defaults.durationSeconds, 6);
  for (const { mode, microsPerSecond } of pricing.modes) {
    const input = normalizeStepInput('video', { model: builtin.id, durationSeconds: 6, ...inputs[mode] }, { [builtin.id]: model });
    assert.equal(modelPrice(model, input), (BigInt(microsPerSecond) * 6n).toString());
  }
  assert.equal(modelPrice(model, { durationSeconds: 6, firstFrame: frame }), '180000');
  assert.equal(modelPrice(model, { durationSeconds: 6, references: [frame] }), '300000');
});

test('custom Viggle resolution uses the price function, independent of stale clip estimates and quality', () => {
  const configured = { ...structuredClone(builtin), id: 'custom-viggle', unitCostMicros: '999999999999999999',
    configuration: { model: 'MiniMax-H3', settings: { quality: 'high', resolution: '1080p', aspectRatio: '9:16' } } };
  assert.deepEqual(providerPricing(configured).modes.map(row => row.microsPerSecond), ['60000', '50000', '60000', '50000']);
  configured.unitCostMicros = '0';
  assert.equal(providerPricing(configured).minMicrosPerSecond, '50000');
});

test('legacy short Viggle profiles omit impossible reference mode without breaking catalog reads', () => {
  const short = { ...structuredClone(builtin), id: 'short-viggle', minFrames: 90, maxFrames: 120 };
  assert.deepEqual(installedModel(short).defaults, { durationSeconds: 4 });
  assert.deepEqual(providerPricing(short).modes.map(row => row.mode), ['first_frame', 'first_last_frame', 'text']);
});

for (const [modelId, settings, min, max, rate, modes, seconds] of [
  ['fal-ai/kling-video/v3/standard/image-to-video', { resolution: '720p' }, 3, 15, '84000', ['first_frame', 'first_last_frame'], 6],
  ['fal-ai/veo3.1/fast/image-to-video', { resolution: '4k', generateAudio: true }, 4, 8, '350000', ['first_frame'], 4],
  ['alibaba/wan-3.0/image-to-video', { resolution: '1080p', generateAudio: true }, 2, 30, '200000', ['first_frame', 'first_last_frame'], 6],
]) test(`fal ${modelId} reports its default resolution/audio rate and supported modes`, () => {
  const p = profile('fal-video-i2v', modelId, settings, min, max), model = installedModel(p), pricing = providerPricing(p);
  assert.deepEqual(pricing.modes, modes.map(mode => ({ mode, microsPerSecond: rate })));
  assert.equal(pricing.minMicrosPerSecond, rate); assert.equal(pricing.maxMicrosPerSecond, rate);
  assert.equal(model.defaults.durationSeconds, seconds);
  for (const mode of modes) assert.equal(modelPrice(model, { ...model.defaults, ...inputs[mode] }), (BigInt(rate) * BigInt(seconds)).toString());
});

test('Seedance adaptive estimates use the real token price for landscape inputs across all supported modes', () => {
  for (const [modelId, rate] of [['seedance-1-0-pro-fast-251015', '20592'], ['dreamina-seedance-2-0-mini-260615', '75600'], ['dreamina-seedance-2-0-260128', '151200']]) {
    const p = profile('seedance', modelId, { resolution: '720p' }, 4, 12), model = installedModel(p), pricing = providerPricing(p);
    assert.deepEqual(pricing.modes, videoModes(model).map(mode => ({ mode, microsPerSecond: rate })));
    for (const mode of videoModes(model)) {
      const input = { ...model.defaults, ...inputs[mode] };
      assert.equal(modelPrice(model, input, mode === 'text' ? undefined : { width: 1280, height: 720 }), (BigInt(rate) * 6n).toString());
    }
  }
});

test('Seedance token rounding becomes a conservative rate estimate without changing exact clip prices', () => {
  const p = profile('seedance', 'dreamina-seedance-2-0-mini-260615', { resolution: '720p', ratio: '4:3' }, 4, 15);
  const model = installedModel(p), snapshot = structuredClone(model), pricing = providerPricing(p);
  assert.ok(pricing.modes.every(row => row.microsPerSecond === '76077'));
  assert.equal(modelPrice(model, { ...model.defaults, firstFrame: frame }, { width: 1280, height: 720 }), '456459');
  assert.equal(modelPrice(model, { ...model.defaults, durationSeconds: 5, firstFrame: frame }, { width: 1280, height: 720 }), '380383');
  assert.deepEqual(model, snapshot);
});

test('per-call profiles omit duration pricing and retain exact prices and profile identity', () => {
  const direct = profile('minimax-h3', 'MiniMax-H3', { resolution: '768P' }, 4, 15);
  direct.unitCostMicros = '654321';
  const snapshot = structuredClone(direct), model = installedModel(direct);
  for (const p of [...DEFAULT_PROFILES, direct, { ...direct, id: 'max', configuration: { model: 'MiniMax-H3-Max', settings: { resolution: '480P' } }, minFrames: 150 }])
    assert.equal(providerPricing(p), undefined);
  for (const durationSeconds of [4, 6, 15]) assert.equal(modelPrice(model, { durationSeconds }), '654321');
  assert.equal(model.priceUnit, 'call'); assert.equal(model.profileDefinitionDigest, digest(snapshot));
  assert.deepEqual(direct, snapshot);
});
