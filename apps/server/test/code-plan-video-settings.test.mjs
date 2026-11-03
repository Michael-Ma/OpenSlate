import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, codePlanExportSize, digest } from '@openslate/core';
import { vigglePriceMicros } from '@openslate/providers';
import { realCodeFixture, settleLostSubmission, miniMaxProfile } from './code-plan-providers-fixture.mjs';
import { codexImageProfile } from './codex-image-execution-fixture.mjs';
import { pending } from './viggle-h3-execution-fixture.mjs';
import { createApp } from '../dist/app.js';
import { StudioSessions } from '../dist/studio-sessions.js';
import { readCodeFilm, wireCodePlans } from '../dist/code-plan/director.js';
import { resolveCodePlanProviderAdmission } from '../dist/code-plan/provider-authority.js';
import { normalizeStepInput, stepKey } from '../dist/code-plan/identity.js';
import { installRecoveryQuarantine } from '../dist/application/installation-recovery.js';

const resolutions = ['480p', '768p', '1080p', '2k'];
const film = body => `export default async function(ctx) { ${body} }`;
const clip = (variant = '', extra = '') => `ctx.video({prompt:'A cat walks',durationSeconds:6,aspectRatio:'16:9',variant:${JSON.stringify(variant)}${extra}})`;
const lockOf = f => f.store.get('capability_lock', f.project.capabilityLockId);
const rows = f => Object.fromEntries(['code_plan_step', 'attempt', 'artifact'].map(kind => [kind, f.store.list(kind, f.project.id)]));
async function fixture(t, changes = {}) {
  const f = await realCodeFixture(t, { newFilm: true, videoSeconds: 6, ...changes });
  wireCodePlans(f.service, f.plans); return f;
}
async function waitChoice(f) {
  for (let i = 0; i < 12; i++) {
    await f.tick(); const view = f.plans.view(f.project.id);
    assert.notEqual(view.state, 'error', JSON.stringify(view.error));
    const choice = view.choices.find(row => !row.stale && !Object.hasOwn(row, 'answer'));
    if (choice) return choice;
  }
  assert.fail('No keyframe choice');
}
function httpFixture(t, f) {
  const sessions = new StudioSessions(), paired = sessions.connect(sessions.issueLaunch());
  const app = createApp({ service: f.service, codePlans: f.plans, studioSessions: sessions,
    providerCatalog: f.mediaRuntime.providerCatalog, musicListener: null });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1', origin: 'http://127.0.0.1:5173', cookie: paired.cookie.split(';')[0], 'x-openslate-csrf': paired.csrf };
  return (method, payload, projectId = f.project.id, path = 'code-plan/video-settings', override = {}) => app.inject({ method,
    url: `/api/projects/${projectId}/${path}`, headers: { ...headers, ...override }, ...(payload === undefined ? {} : { payload }) });
}

test('new code films lock high/1080p, while a saved built-in low/768p film replays without purchases', async t => {
  const f = await fixture(t), id = f.project.id;
  assert.deepEqual(f.plans.videoSettings(id), { version: 1, projectId: id, model: 'viggle-h3', quality: 'high', resolution: '1080p',
    options: resolutions.map(resolution => ({ resolution, pricing: f.plans.videoSettings(id).options.find(row => row.resolution === resolution).pricing })),
    exportSize: { width: 1920, height: 1080 }, appliesTo: 'unsent' });
  assert.equal(lockOf(f).profiles.find(row => row.id === 'viggle-h3').configuration.settings.quality, 'high');
  assert.equal(f.store.get('code_plan_settings', id)?.videoResolution, undefined, 'new default is pinned, not injected into journal keys');
  const lock = lockOf(f), legacy = { ...lock.profiles.find(row => row.id === 'viggle-h3'), revision: '1',
    configuration: { model: 'MiniMax-H3', settings: { quality: 'low', resolution: '768p', aspectRatio: '16:9' } } };
  // Seed a historical database row before any work exists; the production store forbids mutating locks.
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='capability_lock' AND id=?")
    .run(JSON.stringify({ ...lock, profiles: lock.profiles.map(row => row.id === legacy.id ? legacy : row) }), lock.id);
  assert.equal(f.plans.videoSettings(id).resolution, '768p');
  await f.submit(film(`await ${clip()};`)); await f.finish();
  assert.equal(f.form.get('quality'), 'low'); assert.equal(f.form.get('resolution'), '768p');
  const saved = rows(f), calls = { ...f.calls }, savedLock = lockOf(f);
  await f.restart(); await f.submit(film(`await ${clip()};`)); await f.finish();
  assert.deepEqual(rows(f), saved); assert.deepEqual(f.calls, calls); assert.deepEqual(lockOf(f), savedLock);
});

test('setting changes preserve existing steps/attempts/artifacts and key identity; queued clips use the new price and settings', async t => {
  const f = await fixture(t), id = f.project.id, http = httpFixture(t, f), original = f.viggleFetch;
  f.viggleFetch = (url, init) => init.method === 'POST' ? original(url, init) : pending();
  const source = film(`await Promise.all([${clip('first')},${clip('second')}]);`);
  await f.submit(source); await f.tick();
  assert.equal(f.calls.video, 1);
  const before = rows(f), lock = lockOf(f), keys = before.code_plan_step.map(row => row.key);
  assert.equal(before.code_plan_step.filter(row => !row.attemptId).length, 1);
  assert.equal(before.attempt[0].request.profile.configuration.settings.resolution, '1080p');
  assert.equal((await http('PUT', { resolution: '480p' })).statusCode, 200);
  assert.deepEqual(rows(f), before, 'PUT itself creates or modifies no media work');
  assert.deepEqual(lockOf(f), lock); assert.equal(f.calls.video, 1);
  const models = f.execution.models(id), input = normalizeStepInput('video', { prompt: 'A cat walks', durationSeconds: 6, aspectRatio: '16:9', variant: 'second' }, models);
  assert.ok(keys.includes(stepKey('video', input))); assert.equal(input.resolution, undefined);
  const estimate = await f.plans.dryRun(id, source);
  assert.equal(estimate.certainMicros, '120000'); assert.equal(estimate.reusedSteps, 1);
  f.viggleFetch = original; await f.finish();
  assert.deepEqual(f.plans.steps(id).map(row => row.key), keys);
  const second = f.plans.steps(id).find(row => row.input.variant === 'second'), attempt = f.store.get('attempt', second.attemptId);
  assert.equal(attempt.request.profile.configuration.settings.resolution, '480p');
  assert.equal(second.priceMicros, '120000'); assert.equal(f.form.get('resolution'), '480p');
  assert.equal(f.store.get('viggle_h3_execution_mapping', second.attemptId).estimatedMicros, '120000');
  assert.equal(f.plans.stepDetail(id, second.key).call.settings.resolution, '480p');
  assert.equal(f.plans.stepDetail(id, keys[0]).call.settings.resolution, '1080p');
  const saved = rows(f), calls = { ...f.calls };
  f.plans.setVideoSettings(id, '2k'); await f.restart(); await f.finish();
  assert.deepEqual(rows(f), saved); assert.deepEqual(f.calls, calls);
  resolveCodePlanProviderAdmission(f.store, attempt.request);
  f.noGraph();
});

test('retakes and consented retries use the current resolution; previous attempt receipts and unknown liability stay immutable', async t => {
  const f = await fixture(t), id = f.project.id;
  await f.submit(film(`await ${clip()};`)); await f.finish();
  const first = f.plans.steps(id)[0], saved = f.store.get('attempt', first.attemptId);
  f.plans.setVideoSettings(id, '2k');
  await f.submit(film(`await ${clip('retake')};`)); await f.finish();
  const retake = f.plans.steps(id).find(row => row.input.variant === 'retake');
  assert.equal(retake.priceMicros, '360000'); assert.equal(f.form.get('resolution'), '2k');
  assert.deepEqual(f.store.get('attempt', first.attemptId), saved);
  const working = f.viggleFetch;
  f.viggleFetch = async () => { throw Error('offline lost POST reply'); };
  await f.submit(film(`await ${clip('retry')};`)); await settleLostSubmission(f,t); await f.finish();
  const step = f.plans.steps(id).find(row => row.input.variant === 'retry'), attempt = f.store.get('attempt', step.attemptId);
  assert.equal(step.result.error.code, 'SUBMISSION_RESPONSE_LOST'); assert.equal(step.result.error.retry, 'consent');
  const previous = structuredClone(attempt), record = f.store.get('code_plan_execution', attempt.id);
  f.viggleFetch = working;
  f.plans.setVideoSettings(id, '480p'); f.plans.retryStep(id, { stepKey: step.key, consent: { by: 'person' } }); await f.finish();
  const retried = f.plans.steps(id).find(row => row.key === step.key);
  assert.notEqual(retried.attemptId, attempt.id); assert.equal(retried.priceMicros, '120000');
  assert.equal(f.store.get('attempt', retried.attemptId).request.profile.configuration.settings.resolution, '480p');
  assert.deepEqual(f.store.get('attempt', attempt.id), previous); assert.deepEqual(f.store.get('code_plan_execution', attempt.id), record);
  assert.equal(f.execution.accounting(id).total, 300000n + 360000n + 360000n + 120000n);
  assert.equal(f.execution.accounting(id).unknown, 360000n);
});

test('open keyframe prices, dry-run and read_film follow settings; answered input choices survive repricing', async t => {
  const f = await fixture(t), id = f.project.id;
  const source = film(`ctx.shot({id:'opening'}); const k=await ctx.keyframe('opening',{prompt:'A cat',video:{durationSeconds:6,aspectRatio:'16:9'}});
    if(k.ok) await ctx.video({...k.input,shot:'opening',prompt:'A cat walks',durationSeconds:6,aspectRatio:'16:9'});`);
  await f.submit(source); const first = await waitChoice(f);
  assert.deepEqual(first.options.map(row => row.priceMicros), ['360000', '300000']);
  const imageKeys = f.plans.steps(id).map(row => row.key), calls = { ...f.calls };
  f.plans.setVideoSettings(id, '480p'); await f.tick();
  const choice = f.plans.view(id).choices.find(row => !row.stale);
  assert.equal(choice.askedAt, first.askedAt);
  assert.deepEqual(choice.options.map(row => row.priceMicros), ['180000', '120000']);
  assert.deepEqual(f.calls, calls); assert.deepEqual(f.plans.steps(id).map(row => row.key), imageKeys);
  const described = readCodeFilm(f.service, id).models.find(row => row.id === 'viggle-h3');
  assert.equal(described.priceBasis.resolution, '480p'); assert.equal(described.priceBasis.creditsPer5Seconds.first_frame, 10);
  const answer = choice.options.find(row => row.keyframeInput === 'first_frame');
  f.plans.answer(id, { choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, answer });
  const answered = f.plans.choices(id).find(row => row.answer);
  f.plans.hold(id, 'keep-unsent');
  f.plans.setVideoSettings(id, '1080p');
  const preview = await f.plans.dryRun(id, source);
  assert.equal(preview.certainMicros, '300000'); assert.deepEqual(preview.findings, []);
  await f.tick();
  assert.deepEqual(f.plans.choices(id).find(row => row.id === answered.id), answered);
  assert.equal(f.plans.view(id).choices.filter(row => !row.stale).length, 1);
  f.plans.release(id, 'keep-unsent'); await f.finish();
  assert.equal(f.form.get('resolution'), '1080p'); assert.equal(f.calls.video, 1);
});

test('GET/PUT contract, all exact rates, authentication, 400/409 and ceiling persistence; Director cannot set resolution', async t => {
  const f = await fixture(t), id = f.project.id, http = httpFixture(t, f), before = rows(f);
  let response = await http('GET'); assert.equal(response.statusCode, 200, response.body);
  const view = response.json(); assert.deepEqual(Object.keys(view).sort(), ['appliesTo','exportSize','model','options','projectId','quality','resolution','version']);
  assert.deepEqual(view.options.map(row => row.resolution), resolutions);
  for (const option of view.options) for (const mode of option.pricing.modes) {
    assert.equal(mode.microsPerSecond, String(BigInt(vigglePriceMicros({ mode: mode.mode, resolution: option.resolution, durationSeconds: 5, enhance: false })) / 5n));
  }
  for (const resolution of resolutions) {
    response = await http('PUT', { resolution }); assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().resolution, resolution); assert.deepEqual((await http('GET')).json(), response.json());
    assert.deepEqual(response.json().exportSize, codePlanExportSize(f.project, resolution));
    const provider = (await http('GET', undefined, id, 'settings/models')).json().options.find(row => row.id === 'viggle-h3');
    assert.deepEqual(provider.pricing, response.json().options.find(row => row.resolution === resolution).pricing);
  }
  assert.deepEqual(rows(f), before); assert.equal(f.calls.video, 0);
  const events = f.store.readEvents(id).filter(row => row.kind === 'code_plan.changed'); assert.ok(events.length >= 4);
  for (const resolution of ['720p', '4k', '', null, 480, true, {}, []]) {
    response = await http('PUT', { resolution }); assert.equal(response.statusCode, 400, response.body); assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  }
  for (const body of [{}, { resolution: '768p', quality: 'low' }]) assert.equal((await http('PUT', body)).statusCode, 400);
  assert.equal((await http('PUT', { resolution: '480p' }, id, undefined, { 'x-openslate-csrf': 'bad' })).statusCode, 403);
  const graph = f.service.createProject('Graph', undefined, 'graph'), fakeCode = f.service.createProject('Fake', undefined, 'code');
  for (const project of [graph, fakeCode]) for (const method of ['GET','PUT']) {
    response = await http(method, method === 'PUT' ? { resolution: '480p' } : undefined, project.id);
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'CODE_PLAN_VIDEO_SETTINGS_UNAVAILABLE');
  }
  assert.equal((await http('GET', undefined, 'missing')).statusCode, 404);
  f.plans.setCeiling(id, { ceilingMicros: '1234567', by: 'person' });
  f.plans.setVideoSettings(id, '768p'); f.plans.setCeiling(id, { ceilingMicros: '2345678', by: 'person' });
  assert.deepEqual(f.store.get('code_plan_settings', id), { id, projectId:id, ceilingMicros: '2345678', videoResolution: '768p' });
  assert.equal(f.plans.view(id).ceilingMicros, '2345678');
  const invalid = film(`await ${clip('', ",resolution:'480p'")};`);
  await assert.rejects(f.submit(invalid), error => error.code === 'CODE_PLAN_REJECTED' && /resolution/.test(canonical(error.details)));
  await assert.rejects(f.submit(film(`ctx.shot({id:'opening'}); await ctx.keyframe('opening',{prompt:'A cat',video:{durationSeconds:6,resolution:'480p'}});`)),
    error => error.code === 'CODE_PLAN_REJECTED' && /resolution/.test(canonical(error.details)));
  assert.equal(f.execution.attempts(id).length, 0);
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: 'a'.repeat(64), sourceDatabaseSha256: 'b'.repeat(64),
    originalDataRoot: f.root, backupCreatedAt: '2026-11-01T00:00:00.000Z', restoredAt: '2026-11-02T00:00:00.000Z' });
  assert.equal((await http('PUT', { resolution: '480p' })).json().error.code, 'INSTALLATION_QUARANTINED');
});

test('a non-Viggle code film refuses video settings', async t => {
  const f = await fixture(t, { profiles: [codexImageProfile, miniMaxProfile] }), http = httpFixture(t, f);
  for (const method of ['GET', 'PUT']) assert.equal((await http(method, method === 'PUT' ? { resolution: '1080p' } : undefined)).statusCode, 409);
});

test('export attempts capture resolution/aspect sizes without rekeying, and saved renders replay unchanged', async t => {
  const f = await fixture(t), id = f.project.id;
  await f.submit(film(`await ${clip()};`)); await f.finish();
  const artifact = f.plans.steps(id)[0].result.artifact;
  // Exercise actual local capture/render once. Explicit Director dimensions cannot override the film policy.
  f.plans.setVideoSettings(id, '480p');
  const source = film(`await ctx.render({timeline:[${JSON.stringify(artifact)}],width:1280,height:720});`);
  await f.submit(source); await f.finish();
  const render = f.plans.steps(id).find(row => row.kind === 'render'), attempt = f.store.get('attempt', render.attemptId);
  assert.deepEqual([attempt.request.args.width, attempt.request.args.height], [854,480]);
  const output = f.store.get('artifact', render.result.artifact.artifactId); assert.deepEqual([output.width,output.height], [854,480]);
  const saved = rows(f), calls = { ...f.calls };
  f.plans.setVideoSettings(id, '1080p'); await f.submit(source); await f.finish();
  assert.deepEqual(rows(f), saved); assert.deepEqual(f.calls, calls);
  // Preparation is synchronous and captures all aspect/resolution combinations in the immutable request.
  for (const aspect of ['16:9','9:16','1:1']) for (const resolution of resolutions) {
    const project = f.store.getProject(id);
    f.store.saveProject({ ...project, filmKind: { version:'film-kind@1',kind:'social',format:{aspect} } }, project.headVersion);
    f.plans.setVideoSettings(id, resolution);
    const input = normalizeStepInput('render', { timeline:[artifact],variant:`${aspect}-${resolution}` });
    const prepared = f.execution.prepare(id, stepKey('render',input), 'render', input);
    assert.deepEqual({width:prepared.request.args.width,height:prepared.request.args.height}, codePlanExportSize(f.store.getProject(id),resolution));
  }
});

test('derived submission locks refuse tampered quality or a replaced source profile', async t => {
  const f = await fixture(t), id = f.project.id;
  f.plans.setVideoSettings(id, '480p'); await f.submit(film(`await ${clip()};`)); await f.finish();
  const attempt = f.execution.attempts(id)[0], derived = f.store.get('capability_lock', attempt.request.providerUse.capabilityLockId);
  assert.notEqual(derived.id, f.project.capabilityLockId);
  resolveCodePlanProviderAdmission(f.store, attempt.request);
  const source = lockOf(f), tampered = structuredClone(source);
  tampered.profiles.find(row => row.id === 'viggle-h3').configuration.settings.quality = 'low';
  assert.throws(() => f.store.put('capability_lock', source.id, id, tampered), { code:'IMMUTABLE_RECORD' });
  // Corrupt-disk fixture: even bypassing Store cannot give the attempt another source profile.
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='capability_lock' AND id=?").run(JSON.stringify(tampered), source.id);
  assert.throws(() => resolveCodePlanProviderAdmission(f.store, attempt.request), { code:'CODE_PLAN_PROVIDER_AUTHORITY' });
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='capability_lock' AND id=?").run(JSON.stringify(source), source.id);
  assert.equal(digest(lockOf(f)), digest(source));
});
