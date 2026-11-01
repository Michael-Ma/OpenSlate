import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@openslate/core';
import { ExecutionRegistry, registerExecutionProvider } from '@openslate/providers';
import { InstalledProviderCatalog, selectedProviderProfiles } from '../dist/application/provider-catalog.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { normalizeStepInput } from '../dist/code-plan/identity.js';
import { modelDescriptions } from '../dist/code-plan/models.js';
import { modelPrice } from '../dist/code-plan/models.js';
import { codePlanProviderArgs } from '../dist/code-plan/provider-input.js';
import { readCodeFilm, wireCodePlans } from '../dist/code-plan/director.js';
import { unitQuote } from '../dist/generation-quotes.js';
import { realCodeFixture, videoProfile, imageSource } from './code-plan-providers-fixture.mjs';
import { codexImageProfile } from './codex-image-execution-fixture.mjs';

const legacy = { ...videoProfile, id: 'viggle-live-six-seconds', minFrames: 180, maxFrames: 180 };
const ratios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const modes = ['reference', 'first_frame', 'first_last_frame', 'text'];
const route = { adapter: 'viggle-h3', version: '1' };
const key = new EnvironmentMediaCredentials(() => 'synthetic-fixture-key');
const provider = registerExecutionProvider({ submit: async () => assert.fail('No provider calls'), lookup: async () => assert.fail('No provider calls'), poll: async () => assert.fail('No provider calls') }, route);
const registry = new ExecutionRegistry([provider]);
const options = { registry, credentials: key, enabledExecutions: [route], mediaTools: { video: true } };
const builtin = new InstalledProviderCatalog(options).view().profiles.find(row => row.id === 'viggle-h3').profile;

test('built-in Viggle installs without a config file and keeps every readiness fence', () => {
  assert.deepEqual(builtin, { id: 'viggle-h3', revision: '1', kind: 'video', adapter: 'viggle-h3', executionVersion: '1',
    configuration: { model: 'MiniMax-H3', settings: { quality: 'low', resolution: '768p', aspectRatio: '16:9' } },
    minFrames: 150, maxFrames: 450, maxConcurrency: 1, unitCostMicros: '750000', maxRetries: 0 });
  assert.deepEqual(new InstalledProviderCatalog(options).codeMediaProfiles(), [builtin]);
  assert.equal(new InstalledProviderCatalog().view().profiles.some(row => row.id === builtin.id), false);
  for (const override of [{ registry: undefined }, { credentials: new EnvironmentMediaCredentials(() => undefined) }, { mediaTools: { video: false } }, { enabledExecutions: [] }])
    assert.deepEqual(new InstalledProviderCatalog({ ...options, ...override }).codeMediaProfiles(), []);
});

test('code selections replace every configured Viggle once while graph selection retains exact bytes and provenance', () => {
  const other = { ...legacy, id: 'other-viggle', maxFrames: 450 };
  const catalog = new InstalledProviderCatalog({ ...options, configuration: { version: 1, profiles: [legacy, other].map(profile => ({ label: profile.id, profile })) } });
  assert.deepEqual(catalog.codeMediaProfiles(), [builtin]);
  for (const profile of [legacy, other, builtin]) {
    const selection = catalog.select(catalog.digest, [profile.id]);
    const graph = selectedProviderProfiles(selection), code = selectedProviderProfiles(selection, 'code');
    assert.deepEqual(graph.profiles.find(row => row.kind === 'video'), profile);
    assert.deepEqual(code.profiles.find(row => row.kind === 'video'), builtin);
    assert.equal(code.provenance.profileIds.includes(builtin.id), true);
    assert.equal(code.provenance.profileIds.includes(legacy.id), false);
    code.profiles.find(row => row.kind === 'video').maxFrames = 180;
    assert.equal(selectedProviderProfiles(selection, 'code').profiles.find(row => row.kind === 'video').maxFrames, 450);
  }
  assert.deepEqual(catalog.view().profiles.find(row => row.id === legacy.id).profile, legacy);
  const conflict = { ...legacy, id: builtin.id };
  assert.throws(() => new InstalledProviderCatalog({ ...options, configuration: { version: 1, profiles: [{ label: 'Collision', profile: conflict }] } }), { code: 'PROVIDER_CATALOG_INVALID' });
  const exact = new InstalledProviderCatalog({ ...options, configuration: { version: 1, profiles: [{ label: 'Exact built-in', profile: builtin }] } });
  assert.deepEqual(exact.codeMediaProfiles(), [builtin]);
});

test('new code films pin built-in Viggle without configuration and map a selected six-second profile', async t => {
  for (const configured of [false, true]) {
    const f = await realCodeFixture(t, { newFilm: true, profiles: configured ? [codexImageProfile, legacy] : [codexImageProfile],
      selected: [codexImageProfile.id, configured ? legacy.id : builtin.id] });
    const lock = f.store.get('capability_lock', f.project.capabilityLockId);
    assert.deepEqual(lock.profiles.filter(row => row.kind === 'video'), [builtin]);
    assert.equal(lock.providerSelection.profileIds.includes(builtin.id), true);
    assert.equal(lock.providerSelection.profileIds.includes(legacy.id), false);
    assert.equal(f.plans.steps(f.project.id).length, 0);
    assert.equal(f.calls.video, 0);
  }
});

const source = (model, seconds, fields = "aspectRatio:'9:16'") => `export default async function(ctx){await ctx.video({model:'${model}',prompt:'The person walks forward as the camera follows',durationSeconds:${seconds},${fields}});}`;

test('ten-second vertical Viggle plan dry-runs, reserves the N6 table and dispatches exact wire values', async t => {
  const f = await realCodeFixture(t, { newFilm: true, profiles: [codexImageProfile, legacy], videoSeconds: 10, videoSize: '160x288' });
  wireCodePlans(f.service, f.plans);
  await f.submit(imageSource); await f.finish();
  const frame = f.plans.steps(f.project.id)[0].result.artifact;
  const program = source(builtin.id, 10, `references:[${JSON.stringify(frame)}],aspectRatio:'9:16'`);
  const preview = await f.plans.dryRun(f.project.id, program);
  assert.deepEqual(preview.findings, []); assert.equal(preview.certainMicros, '500000');
  assert.equal(f.calls.video, 0);
  await f.submit(program); await f.finish();
  const step = f.plans.steps(f.project.id).find(row => row.kind === 'video');
  assert.equal(step.state, 'succeeded'); assert.equal(step.priceMicros, '500000');
  assert.equal(f.form.get('duration_s'), '10'); assert.equal(f.form.get('aspect_ratio'), '9:16'); assert.equal(f.form.get('enhance'), 'false');
  assert.equal(f.form.get('resolution'), '768p'); assert.equal(f.form.get('quality'), 'low');
  assert.equal(f.store.get('viggle_h3_execution_mapping', step.attemptId).estimatedMicros, '500000');
  assert.equal(f.plans.view(f.project.id).spentMicros, '500000');
  const facts = f.plans.stepDetail(f.project.id, step.key).output;
  assert.equal(facts.width, 160); assert.equal(facts.height, 288); assert.equal(facts.durationSeconds, 10);
  assert.deepEqual(readCodeFilm(f.service, f.project.id).steps.find(row => row.key === step.key).output, facts);
  const saved = structuredClone(step), calls = { ...f.calls };
  await f.restart(); await f.submit(program); await f.finish();
  assert.deepEqual(f.calls, calls); assert.deepEqual(f.plans.steps(f.project.id).find(row => row.key === step.key).input, saved.input);
  f.noGraph();
});

test('four- and sixteen-second plans are refused before intent or dispatch with the installed range', async t => {
  const f = await realCodeFixture(t, { newFilm: true, profiles: [codexImageProfile, legacy] });
  for (const seconds of [4, 16]) {
    const program = source(builtin.id, seconds), preview = await f.plans.dryRun(f.project.id, program);
    assert.match(preview.findings.find(row => row.code === 'RUNTIME_ERROR').detail, /5–15 seconds/);
    await assert.rejects(f.submit(program), error => error.code === 'CODE_PLAN_REJECTED' && /5–15 seconds/.test(JSON.stringify(error.details)));
    for (const fields of [{ references: [{ kind: 'image', sha256: 'a'.repeat(64) }] }, { firstFrame: { kind: 'image', sha256: 'a'.repeat(64) } },
      { firstFrame: { kind: 'image', sha256: 'a'.repeat(64) }, lastFrame: { kind: 'image', sha256: 'b'.repeat(64) } }, { aspectRatio: '9:16' }])
      assert.throws(() => normalizeStepInput('video', { model: builtin.id, durationSeconds: seconds, ...fields }, f.execution.models(f.project.id)), /5–15 seconds/);
  }
  assert.equal(f.execution.attempts(f.project.id).length, 0); assert.equal(f.calls.video, 0);
});

test('saved six-second film retains its exact lock, step keys, prices and outcomes across restart without purchases', async t => {
  const f = await realCodeFixture(t, { profiles: [codexImageProfile, legacy], videoSeconds: 6 });
  const program = source(legacy.id, 6); await f.submit(program); await f.finish();
  const lock = f.store.get('capability_lock', f.project.capabilityLockId), steps = f.plans.steps(f.project.id), calls = { ...f.calls };
  assert.deepEqual(lock.profiles.filter(row => row.kind === 'video'), [legacy]);
  assert.equal(steps[0].priceMicros, '120000');
  assert.deepEqual(f.plans.availableModels(f.project.id).find(row => row.id === legacy.id).durationSeconds, { min: 6, max: 6 });
  await f.restart(); await f.tick(); await f.submit(program); await f.finish();
  assert.deepEqual(f.store.get('capability_lock', f.project.capabilityLockId), lock);
  assert.deepEqual(f.plans.steps(f.project.id).map(row => ({ key: row.key, input: row.input, result: row.result, price: row.priceMicros, attempt: row.attemptId })),
    steps.map(row => ({ key: row.key, input: row.input, result: row.result, price: row.priceMicros, attempt: row.attemptId })));
  assert.deepEqual(f.calls, calls); assert.equal(f.plans.view(f.project.id).spentMicros, '120000');
});

const vendorProfiles = [
  ['seedance', 'seedance-1-0-pro-fast-251015', 2, 12],
  ['seedance', 'dreamina-seedance-2-0-mini-260615', 4, 15],
  ['seedance', 'dreamina-seedance-2-0-260128', 4, 15],
  ['fal-video-i2v', 'fal-ai/kling-video/v3/standard/image-to-video', 3, 15],
  ['fal-video-i2v', 'fal-ai/veo3.1/fast/image-to-video', 4, 8],
  ['fal-video-i2v', 'alibaba/wan-3.0/image-to-video', 2, 30],
].map(([adapter, model, min, max], i) => ({ ...legacy, id: `video-${i}`, adapter, minFrames: min * 30, maxFrames: max * 30,
  configuration: { model, settings: { resolution: '720p' } } }));

test('read_film lists Viggle, every Seedance and fal model ratios, effective lengths and modes', async t => {
  const f = await realCodeFixture(t, { newFilm: true, profiles: [codexImageProfile, legacy, ...vendorProfiles], selected: [codexImageProfile.id, legacy.id],
    configuration: { seedance: true, falVideo: true, seedanceDownloadHosts: ['media.example.test'], falVideoDownloadHosts: ['media.example.test'] } });
  wireCodePlans(f.service, f.plans);
  const models = readCodeFilm(f.service, f.project.id).models, videos = models.filter(row => row.kind === 'video');
  assert.equal(videos.length, 7);
  const viggle = videos.find(row => row.id === builtin.id);
  assert.deepEqual(viggle.aspectRatios, ratios); assert.deepEqual(viggle.durationSeconds, { min: 5, max: 15 }); assert.deepEqual(viggle.videoModes, modes);
  for (const [i, profile] of vendorProfiles.entries()) {
    const row = videos.find(row => row.id === profile.id);
    assert.deepEqual(row.durationSeconds, { min: profile.minFrames / 30, max: profile.maxFrames / 30 });
    assert.deepEqual(row.aspectRatios, i < 3 ? ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive']
      : i === 3 ? ['adaptive'] : i === 4 ? ['auto', '16:9', '9:16'] : ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']);
    assert.deepEqual(row.videoModes, i === 0 || i === 4 ? ['first_frame'] : i < 3 ? modes : ['first_frame', 'first_last_frame']);
  }
  assert.equal(f.calls.video, 0);
});

test('descriptions intersect saved bounds and discrete fal durations without mutating profiles', () => {
  for (const profile of [legacy, ...vendorProfiles]) {
    const restricted = { ...profile, minFrames: 150, maxFrames: 240 }, before = digest(restricted);
    const row = modelDescriptions({ test: { kind: 'video', profile: restricted } })[0];
    assert.deepEqual(row.durationSeconds, { min: profile.configuration.model.includes('veo') ? 6 : 5, max: 8 });
    if (profile.configuration.model.includes('veo')) assert.deepEqual(row.durationValuesSeconds, [6, 8]);
    assert.equal(digest(restricted), before);
  }
  assert.deepEqual(modelDescriptions({ fake: { kind: 'video' } })[0].durationSeconds, { min: 1, max: 360 });
});

test('legacy profiles with no duration in the vendor range never advertise an inverted interval', () => {
  const profile = { ...legacy, minFrames: 90, maxFrames: 90 };
  assert.deepEqual(modelDescriptions({ legacy: { kind: 'video', profile } })[0].durationSeconds, { min: null, max: null });
});

test('all four built-in Viggle modes accept both duration boundaries with the N6 price table', () => {
  const frame = { kind: 'image', sha256: 'a'.repeat(64) }, model = { kind: 'video', profile: builtin };
  const inputs = [{ references: [frame] }, { firstFrame: frame }, { firstFrame: frame, lastFrame: frame }, { aspectRatio: '9:16' }];
  for (const [i, fields] of inputs.entries()) for (const seconds of [5, 15]) {
    const input = normalizeStepInput('video', { model: builtin.id, prompt: 'Walk forward, camera follows', durationSeconds: seconds, ...fields }, { [builtin.id]: model });
    assert.equal(codePlanProviderArgs(builtin, input, { enhance: false }).durationFrames, seconds * 30);
    assert.equal(modelPrice(model, input), String(seconds * (i === 0 || i === 2 ? 50000 : 30000)));
  }
});

test('Viggle priceBasis exposes only the pinned resolution and scalar mode prices', () => {
  for (const profile of [builtin, legacy, ...['1080p', '2k', '4k'].map(resolution => ({ ...builtin,
    configuration: { ...builtin.configuration, settings: { ...builtin.configuration.settings, resolution } } }))]) {
    const row = modelDescriptions({ pinned: { kind: 'video', profile, priceUnit: 'input' } })[0];
    const resolution = profile.configuration.settings.resolution;
    assert.equal(row.priceBasis.resolution, resolution); assert.equal(row.priceBasis.resolutions, undefined);
    for (const [mode, credits] of Object.entries(row.priceBasis.creditsPer5Seconds)) {
      assert.equal(typeof credits, 'number');
      assert.equal(modelPrice({ kind: 'video', profile }, { durationSeconds: 5, ...(mode === 'reference' ? { references: [{}] }
        : mode === 'first_last_frame' ? { firstFrame: {}, lastFrame: {} } : mode === 'first_frame' ? { firstFrame: {} } : {}) }), String(credits * 10000));
    }
    assert.equal(JSON.stringify(row.priceBasis).match(/480p|768p|1080p|2k|4k/g).length, 1);
  }
});

test('graph selection and quotes retain the configured six-second profile and per-call price', async t => {
  const f = await realCodeFixture(t, { newFilm: true, profiles: [codexImageProfile, legacy] }), catalog = f.mediaRuntime.providerCatalog;
  const graph = f.service.createProject('Unchanged graph', catalog.select(catalog.digest, [codexImageProfile.id, legacy.id]), 'graph');
  const lock = f.store.get('capability_lock', graph.capabilityLockId);
  assert.deepEqual(lock.profiles.filter(row => row.kind === 'video'), [legacy]);
  assert.equal(lock.providerSelection.profileIds.includes(builtin.id), false);
  assert.equal(unitQuote(lock, 'video').micros, legacy.unitCostMicros);
  assert.equal(f.store.list('attempt', graph.id).length, 0); assert.equal(f.calls.video, 0);
});
