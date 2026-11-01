import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
import { projectAssets } from '../dist/asset-library.js';
import { CodePlanRuntime } from '../dist/code-plan/index.js';
import { codePlanFitWarning } from '../dist/code-plan/fit-warning.js';
import { installRecoveryQuarantine } from '../dist/application/installation-recovery.js';
import { realCodeFixture, videoProfile } from './code-plan-providers-fixture.mjs';
import { codexImageProfile } from './codex-image-execution-fixture.mjs';

const at = '2026-10-31T00:00:00.000Z', token = 'n5-offline-assets-inspection-token';
const hash = value => createHash('sha256').update(value).digest('hex');
const ref = (id, kind = 'image') => ({ artifactId: id, kind, sha256: hash(id) });
const snapshot = f => JSON.stringify({ rows: f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all(),
  project: f.store.getProject(f.projectId), events: f.store.readEvents(f.projectId) });
function fixture(t, code = true) {
  const f = setup(t, { count: 1 });
  if (code) { const p = f.store.getProject(f.projectId); f.store.saveProject({ ...p, planMode: 'code' }, p.headVersion); }
  f.service = new ProductionService(f.store, f.engine);
  f.inspectionAttempts = [];
  f.attempts = () => f.inspectionAttempts;
  f.runtime = new CodePlanRuntime(f.store, { execution: { attempts: f.attempts, accounting: () => ({ charged: 0n, unknown: 0n, inFlight: 0n }) } });
  f.app = createApp({ service: f.service, codePlans: f.runtime, localToken: token, logger: false }); t.after(() => f.app.close());
  f.get = (path, id = f.projectId, headers = {}) => f.app.inject({ method: 'GET', url: `/api/projects/${id}${path}`,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, ...headers } });
  f.put = (kind, id, row) => f.store.put(kind, id, f.projectId, JSON.parse(JSON.stringify({ id, projectId: f.projectId, ...row })));
  f.artifact = (id, kind, extra = {}) => {
    const artifact = ref(id, kind);
    f.put('artifact', id, { artifact, path: '/private/n5-local-file', mimeType: 'test/fixture', fixture: false, attemptId: null,
      physicalDurationSeconds: null, ...extra });
    f.put('asset_metadata', `artifact:${id}`, { createdAt: at });
    return artifact;
  };
  f.step = (key, kind, input = {}, extra = {}) => {
    const artifact = f.artifact(`${key}-file`, kind === 'image' ? 'image' : ['video', 'render'].includes(kind) ? 'video' : 'audio',
      kind === 'image' ? { width: 1344, height: 768 } : { physicalDurationSeconds: 6 });
    const step = { key, kind, input: { model: `test-${kind}`, ...input }, shotId: 'opening', state: 'succeeded', attemptId: null,
      result: { ok: true, artifact, artifacts: [artifact] }, priceMicros: '10000', createdAt: at, updatedAt: at, ...extra };
    f.put('code_plan_step', key, step); return { ...step, artifact };
  };
  f.poster = (source, width = 1344, height = 768) => {
    const poster = f.artifact(`${source.artifactId}-poster`, 'image', { width, height });
    f.put('code_plan_poster', source.artifactId, { source, poster }); return poster;
  };
  f.run = (reachedStepKeys, shots = [{ id: 'opening', sceneId: 'code-scene', purpose: 'Opening' }]) => f.put('code_plan_run', f.projectId,
    { planVersion: 1, state: 'done', now: 0, seed: 1, ceilingMicros: '1000000', lastPassAt: at, error: null, reachedStepKeys,
      declarations: { scenes: [{ id: 'code-scene', title: 'Code scene' }], shots }, logs: [] });
  f.assets = () => projectAssets(f.service, f.store.getProject(f.projectId));
  return f;
}

test('graph assets retain their exact serialized snapshot without code-plan joins', t => {
  const f = fixture(t, false), p = f.store.getProject(f.projectId);
  const old = f.artifact('old', 'image', { attemptId: 'attempt-old' }), chosen = f.artifact('chosen', 'image', { attemptId: 'attempt-chosen' }), clip = f.artifact('clip', 'video', { attemptId: 'attempt-clip' });
  const upload = f.artifact('upload', 'image', { origin: 'supplied_image', name: 'Reference' });
  const originalList = f.store.list.bind(f.store);
  f.store.list = (kind, projectId) => kind === 'attempt' && projectId === f.projectId
    ? [old, chosen, clip].map(artifact => ({ id: `attempt-${artifact.artifactId}`, nodeId: 'snapshot-node', createdAt: at }))
    : originalList(kind, projectId);
  f.put('node_binding', 'snapshot-node', { node: { shotId: 'shot-0' }, state: 'active', planId: p.activePlanId, outputs: { image: chosen, video: clip } });
  // Stray code rows cannot alter a graph film.
  f.put('code_plan_poster', clip.artifactId, { source: clip, poster: old }); f.run(['ignored']);
  const base = (artifact, role, extra = {}) => ({ artifact: { artifactId: artifact.artifactId, sha256: artifact.sha256, kind: artifact.kind }, role, ...extra, current: artifact === chosen || artifact === clip,
    source: role === 'upload' ? 'imported' : 'generated', label: role === 'upload' ? 'Reference' : `Product · Show the product · ${role} ${artifact === chosen ? 2 : 1}`, createdAt: at });
  const expected = [base(upload, 'upload'), base(clip, 'clip', { shotId: 'shot-0', sceneId: 'scene-0', takeIndex: 1 }),
    base(chosen, 'keyframe', { shotId: 'shot-0', sceneId: 'scene-0', takeIndex: 2 }), base(old, 'keyframe', { shotId: 'shot-0', sceneId: 'scene-0', takeIndex: 1 })];
  assert.equal(JSON.stringify(f.assets()), JSON.stringify(expected));
});

test('graph pictures expose measured dimensions and omit unknown dimensions', t => {
  const f = fixture(t, false); f.artifact('sized', 'image', { width: 768, height: 1344 }); f.artifact('unknown', 'image');
  assert.deepEqual(f.assets().map(({ width, height }) => ({ width, height })), [{ width: undefined, height: undefined }, { width: 768, height: 1344 }]);
});

test('graph clips use known poster dimensions without changing their role or selection', t => {
  const f = fixture(t, false), clip = f.artifact('clip', 'video'); f.poster(clip, 768, 1344);
  const item = f.assets().find(item => item.artifact.artifactId === 'clip');
  assert.equal(item.role, 'clip'); assert.equal(item.current, false); assert.ok(!item.poster);
  assert.deepEqual([item.width, item.height], [768, 1344]);
});

test('code assets join declared shots, choices, reached steps, roles, takes and posters without storyboard reads', async t => {
  const f = fixture(t), unchosen = f.step('unchosen', 'image'), chosen = f.step('chosen', 'image'), historical = f.step('history', 'image');
  const consumed = f.step('consumed', 'image'), free = f.step('no-choice', 'image', {}, { shotId: 'another' });
  const clip = f.step('clip', 'video', { firstFrame: { kind: 'image', sha256: consumed.artifact.sha256 } });
  const music = f.step('music', 'music'), voice = f.step('voice', 'speech'), render = f.step('render', 'render');
  const poster = f.poster(clip.artifact), renderPoster = f.poster(render.artifact, 1080, 1920);
  f.artifact('imported', 'image', { origin: 'supplied_image', name: 'Reference' });
  f.put('code_plan_choice', 'choice', { choiceId: 'opening-keyframe', options: [unchosen.artifact, { artifact: chosen.artifact }, consumed.artifact], answer: { artifact: chosen.artifact } });
  f.run([unchosen.key, chosen.key, consumed.key, free.key, clip.key, music.key, voice.key, render.key],
    [{ id: 'opening', sceneId: 'code-scene', purpose: 'Opening' }, { id: 'another', sceneId: 'code-scene' }]);
  const before = snapshot(f), p = f.store.getProject(f.projectId);
  Object.defineProperty(p, 'shots', { get() { throw Error('Code assets must not inspect storyboard shots'); } });
  const assets = projectAssets(f.service, p), byKey = new Map(assets.map(item => [item.stepKey, item]));
  assert.equal(assets.length, 10); assert.ok(assets.every(item => !item.artifact.artifactId.endsWith('-poster')));
  for (const [key, role] of [['unchosen', 'keyframe'], ['chosen', 'keyframe'], ['clip', 'clip'], ['music', 'music'], ['voice', 'voice'], ['render', 'export']]) {
    const item = byKey.get(key); assert.equal(item.role, role); assert.equal(item.shotId, 'opening'); assert.equal(item.sceneId, 'code-scene');
  }
  assert.deepEqual(['unchosen', 'chosen', 'history', 'consumed'].map(key => byKey.get(key).takeIndex), [1, 2, 3, 4]);
  assert.deepEqual(['unchosen', 'chosen', 'history', 'consumed', 'no-choice', 'clip', 'music', 'voice', 'render'].map(key => byKey.get(key).current),
    [false, true, false, true, true, true, true, true, true]);
  assert.equal(byKey.get('clip').takeIndex, 1); assert.equal(byKey.get('no-choice').takeIndex, 1);
  assert.deepEqual(byKey.get('clip').poster, poster); assert.deepEqual(byKey.get('render').poster, renderPoster);
  assert.deepEqual([byKey.get('clip').width, byKey.get('clip').height], [1344, 768]);
  assert.deepEqual([byKey.get('render').width, byKey.get('render').height], [1080, 1920]);
  const imported = assets.find(item => item.artifact.artifactId === 'imported'); assert.equal(imported.role, 'upload'); assert.equal(imported.source, 'imported');
  const response = await f.get('/assets?role=music&sceneId=code-scene'); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().total, 1);
  assert.equal(snapshot(f), before); assert.equal(historical.kind, 'image');
});

test('legacy code assets link exact keyframes and normalized first-frame clips through shot-keyframe choices', t => {
  const f = fixture(t), frame = f.step('frame', 'image', {}, { shotId: undefined });
  const clip = f.step('clip', 'video', { firstFrame: { sha256: frame.artifact.sha256, kind: 'image' } }, { shotId: undefined });
  f.put('code_plan_choice', 'choice', { choiceId: 'opening-keyframe', options: [frame.artifact], answer: frame.artifact }); f.run([frame.key, clip.key]);
  assert.ok(f.assets().every(item => item.shotId === 'opening' && item.sceneId === 'code-scene' && item.current));
});

test('step detail preserves whole prompt, speech text and motion, resolves normalized media and is read-only through HTTP and quarantine', async t => {
  const f = fixture(t), prompt = 'Full prompt. '.repeat(80), image = f.step('image', 'image', { prompt, variant: 'take-2' });
  const clip = f.step('clip', 'video', { firstFrame: { kind: 'image', sha256: image.artifact.sha256 }, prompt, durationSeconds: 6, aspectRatio: '9:16' });
  f.poster(clip.artifact); const voice = f.step('voice', 'speech', { text: prompt }); const motion = f.step('motion', 'video', { motion: prompt });
  const render = f.step('render', 'render'); f.poster(render.artifact, 1080, 1920);
  f.run([image.key, clip.key, voice.key, motion.key, render.key]);
  const before = snapshot(f);
  assert.equal(f.runtime.view(f.projectId).steps.find(step => step.key === image.key).label.length, 200);
  for (const step of [image, clip, voice, motion]) assert.equal(f.runtime.stepDetail(f.projectId, step.key).prompt, prompt);
  const detail = f.runtime.stepDetail(f.projectId, clip.key);
  assert.deepEqual(detail.firstFrame, image.artifact); assert.deepEqual(detail.output, { width: 1344, height: 768, durationSeconds: 6 });
  assert.equal(detail.aspectRatio, '9:16'); assert.equal(detail.durationSeconds, 6); assert.equal(detail.attempts, 0); assert.ok(!detail.call);
  assert.equal(f.runtime.stepDetail(f.projectId, image.key).variant, 'take-2');
  assert.deepEqual(f.runtime.stepDetail(f.projectId, render.key).output, { width: 1080, height: 1920, durationSeconds: 6 });
  assert.equal(snapshot(f), before);
  for (const [id, key, status, code] of [[f.projectId, 'missing', 404, 'NOT_FOUND'], ['missing', 'clip', 404, 'NOT_FOUND']]) {
    const response = await f.get(`/code-plan/steps/${key}`, id); assert.equal(response.statusCode, status, response.body); assert.equal(response.json().error.code, code);
  }
  const graph = f.service.createProject('Graph'); const refused = await f.get('/code-plan/steps/clip', graph.id);
  assert.equal(refused.statusCode, 409); assert.equal(refused.json().error.code, 'CODE_PLAN_MODE');
  assert.equal((await f.get('/code-plan/steps/clip', f.projectId, { authorization: '' })).statusCode, 403);
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: 'a'.repeat(64), sourceDatabaseSha256: 'b'.repeat(64),
    originalDataRoot: f.directory, backupCreatedAt: at, restoredAt: at });
  const quarantined = snapshot(f), response = await f.get('/code-plan/steps/clip'); assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.json(), detail);
  assert.equal(snapshot(f), quarantined);
});

const adapterRows = [
  ['viggle-h3', 'viggle_h3_execution_mapping'], ['minimax-h3', 'h3_execution_mapping'], ['seedance', 'video_i2v_mapping'],
  ['fal-video-i2v', 'video_i2v_mapping'], ['gemini-lyria', 'lyria_dispatch'], ['codex-image', 'codex_image_execution_mapping'],
  ['openai-image', 'image_execution_mapping'], ['openai-speech', 'speech_execution_mapping'],
];
for (const [adapter, mappingKind] of adapterRows) test(`${adapter} step details allow only recorded scalars and never expose mapping credentials, headers, paths or signed URLs`, async t => {
  const f = fixture(t), step = f.step('step', 'video', { prompt: 'Slow push' }, { attemptId: 'latest' });
  const secrets = { apiKey: 'sk-n5-key-secret', authorization: 'Bearer n5-header-secret', path: '/private/n5-path-secret',
    url: 'https://vendor.invalid/output?signature=n5-signed-secret' };
  const config = { model: 'provider-model', settings: { resolution: '1080p', quality: 'high', ...secrets } };
  const attempt = { fingerprint: step.key, taskId: 'task-123', request: { execution: { adapter, version: '1' }, profile: { configuration: config },
    args: { durationFrames: 180, seed: 42, voice: 'alloy', settings: { ratio: '9:16', generateAudio: true, ...secrets }, ...secrets } } };
  f.inspectionAttempts = [{ id: 'old', projectId: f.projectId, ...attempt, taskId: 'old-task' }, { id: 'latest', projectId: f.projectId, ...attempt }];
  const transport = { model: 'recorded-model', resolution: '768p', quality: 'low', aspectRatio: '9:16', durationSeconds: 6,
    width: 768, height: 1344, seed: 12, instrumental: true, voice: 'alloy', requestDigest: hash('transport'), ...secrets,
    headers: { authorization: secrets.authorization }, body: secrets, nested: { ...secrets } };
  // N2 video and Lyria do not store a wire description; their saved attempt carries those settings.
  const hasTransport = !['seedance', 'fal-video-i2v', 'gemini-lyria'].includes(adapter);
  // Inject contaminated persisted read shapes; production Store validators reject such writes.
  // This exercises the HTTP projection independently of that earlier defense.
  let mapping = { id: 'latest', projectId: f.projectId, ...(hasTransport ? { transport } : {}), requestDigest: hash('intent'), ...secrets,
    native: secrets, firstFrame: { ...secrets }, firstFrameCrop: { sourceWidth: 1344, sourceHeight: 768, width: 432, height: 768, ...secrets },
    lastFrameCrop: { sourceWidth: 1024, sourceHeight: 1536, width: 864, height: 1536, ...secrets } };
  const originalGet = f.store.get.bind(f.store);
  f.store.get = (kind, id) => kind === mappingKind && id === 'latest' ? mapping : originalGet(kind, id);
  f.run([step.key]); const before = snapshot(f), response = await f.get('/code-plan/steps/step'); assert.equal(response.statusCode, 200, response.body);
  const detail = response.json(), call = detail.call; assert.equal(detail.attempts, 2); assert.equal(call.adapter, adapter); assert.equal(call.taskId, 'task-123');
  assert.equal(call.providerModel, hasTransport ? 'recorded-model' : 'provider-model');
  assert.equal(call.settings.resolution, hasTransport ? '768p' : '1080p');
  assert.deepEqual(call.firstFrameCrop, { sourceWidth: 1344, sourceHeight: 768, width: 432, height: 768 });
  assert.deepEqual(call.lastFrameCrop, { sourceWidth: 1024, sourceHeight: 1536, width: 864, height: 1536 });
  assert.equal(call.requestDigest, hash(hasTransport ? 'transport' : 'intent'));
  for (const secret of Object.values(secrets)) assert.ok(!response.body.includes(secret), secret);
  for (const key of Object.keys(call.settings)) assert.ok(['model','resolution','quality','aspectRatio','ratio','durationSeconds','durationFrames','width','height','seed','generateAudio','instrumental','voice'].includes(key), key);
  assert.ok(Object.values(call.settings).every(value => ['string', 'number', 'boolean'].includes(typeof value))); assert.equal(snapshot(f), before);
  // Also refuse unsafe strings placed under an otherwise allowed key or task/digest field.
  mapping = { id: 'latest', projectId: f.projectId, transport: { model: secrets.apiKey, quality: secrets.authorization, voice: secrets.path, resolution: secrets.url, seed: secrets, generateAudio: [secrets] }, requestDigest: secrets.url };
  f.inspectionAttempts[1] = { id: 'latest', projectId: f.projectId, ...attempt, taskId: secrets.url };
  const malicious = await f.get('/code-plan/steps/step'); assert.equal(malicious.statusCode, 200);
  for (const secret of Object.values(secrets)) assert.ok(!malicious.body.includes(secret), secret);
});

test('fit warning counts severe cover placements, skips missing sizes and leaves step identity and storage untouched', t => {
  const landscape = ref('landscape', 'video'), portrait = ref('portrait', 'video'), unknown = ref('unknown', 'video');
  const sizes = new Map([[`video:${landscape.sha256}`, { width: 1344, height: 768 }], [`video:${portrait.sha256}`, { width: 768, height: 1344 }]]);
  const input = rows => ({ timeline: rows, width: 1080, height: 1920 });
  assert.deepEqual(codePlanFitWarning(input([{ artifact: landscape, fit: 'cover' }]), sizes), { clips: 1, keptPercent: 32 });
  assert.equal(codePlanFitWarning(input([{ artifact: portrait, fit: 'cover' }]), sizes), undefined);
  assert.equal(codePlanFitWarning(input([{ artifact: landscape, fit: 'contain' }]), sizes), undefined);
  assert.equal(codePlanFitWarning(input([landscape, { artifact: unknown, fit: 'cover' }]), sizes), undefined);
  assert.equal(codePlanFitWarning({ timeline: [], width: 0, height: 1920 }, sizes), undefined);
  assert.deepEqual(codePlanFitWarning(input(Array(5).fill({ artifact: landscape, fit: 'cover' })), sizes), { clips: 5, keptPercent: 32 });
  assert.equal(codePlanFitWarning(input([{ artifact: landscape, fit: 'cover' }]), new Map([[`video:${landscape.sha256}`, { width: -1, height: 768 }]])), undefined);
  const f = fixture(t), clip = f.step('clip', 'video'); f.poster(clip.artifact);
  const render = f.step('render', 'render', input(Array(5).fill({ artifact: { kind: 'video', sha256: clip.artifact.sha256 }, fit: 'cover' })));
  f.run([clip.key, render.key]); const before = snapshot(f), view = f.runtime.view(f.projectId);
  assert.deepEqual(view.steps.find(step => step.key === render.key).fitWarning, { clips: 5, keptPercent: 32 });
  assert.ok(!view.steps.find(step => step.key === clip.key).fitWarning); assert.equal(snapshot(f), before); assert.equal(view.steps.at(-1).key, render.key);
});

test('offline adapter execution publishes inspectable assets, actual call settings and render warnings across restart', async t => {
  const f = await realCodeFixture(t);
  await f.submit(`export default async function(ctx) {
    ctx.scene({id:'scene'}); ctx.shot({id:'opening',sceneId:'scene'});
    const frame=await ctx.image({model:'${codexImageProfile.id}',prompt:'Dawn',shot:'opening'}); if(!frame.ok) return;
    const clip=await ctx.video({model:'${videoProfile.id}',firstFrame:frame.artifact,prompt:'Drift',durationSeconds:3,aspectRatio:'9:16',shot:'opening'});
    if(clip.ok) await ctx.render({timeline:[{artifact:clip.artifact,fit:'cover'}],width:90,height:160});
  }`);
  await f.finish();
  const view = f.plans.view(f.project.id), steps = new Map(view.steps.map(step => [step.kind, step]));
  const assets = projectAssets(f.service, f.store.getProject(f.project.id));
  assert.equal(assets.length, 3); assert.ok(assets.every(item => item.current && item.stepKey));
  assert.deepEqual(assets.map(item => item.role).sort(), ['clip','export','keyframe']);
  assert.equal(assets.find(item => item.role === 'clip').sceneId, 'scene');
  const image = f.plans.stepDetail(f.project.id, steps.get('image').key), video = f.plans.stepDetail(f.project.id, steps.get('video').key);
  assert.equal(image.call.adapter, 'codex-image'); assert.equal(image.call.providerModel, 'gpt-6-astra');
  assert.deepEqual(image.output, { width: 320, height: 320 });
  assert.equal(video.call.adapter, 'viggle-h3'); assert.equal(video.call.settings.aspectRatio, '9:16');
  assert.equal(video.call.settings.durationSeconds, 3); assert.equal(video.call.settings.resolution, '480p'); assert.ok(video.call.taskId);
  assert.deepEqual(video.call.firstFrameCrop, { sourceWidth: 320, sourceHeight: 320, width: 180, height: 320 });
  assert.deepEqual(video.output, { width: 160, height: 90, durationSeconds: 3 }); assert.deepEqual(video.firstFrame, steps.get('image').artifact);
  assert.deepEqual(steps.get('render').fitWarning, { clips: 1, keptPercent: 32 });
  const calls = { ...f.calls }; await f.restart();
  assert.deepEqual(projectAssets(f.service, f.store.getProject(f.project.id)), assets);
  assert.deepEqual(f.plans.stepDetail(f.project.id, steps.get('video').key), video); assert.deepEqual(f.calls, calls); f.noGraph();
});

test('reference clips link one unambiguous shot and keep consumed pictures current in Assets', t => {
 const f=fixture(t),a=f.step('a','image',{}, {shotId:undefined}),b=f.step('b','image',{}, {shotId:undefined});
 const clip=f.step('clip','video',{references:[{kind:'image',sha256:a.artifact.sha256}]},{shotId:undefined});
 f.put('code_plan_choice','choice-a',{choiceId:'opening-keyframe',options:[a.artifact,b.artifact],answer:b.artifact});
 f.run([b.key,clip.key]);
 const assets=f.assets();assert.equal(assets.find(row=>row.stepKey===clip.key).shotId,'opening');
 assert.equal(assets.find(row=>row.stepKey===a.key).current,true,'a reached reference counts even when its generating call is no longer reached');
 const detail=f.runtime.stepDetail(f.projectId,clip.key);assert.equal(detail.mode,'reference');assert.deepEqual(detail.references,[a.artifact]);
 const last=f.step('last','video',{firstFrame:a.artifact,lastFrame:b.artifact});
 assert.deepEqual(f.runtime.stepDetail(f.projectId,last.key).lastFrame,b.artifact);
 const ambiguous=f.step('ambiguous','video',{references:[a.artifact,b.artifact]},{shotId:undefined});
 f.put('code_plan_choice','choice-b',{choiceId:'other-keyframe',options:[b.artifact],answer:b.artifact});
 f.run([clip.key,ambiguous.key]);assert.equal(f.assets().find(row=>row.stepKey===ambiguous.key).shotId,undefined);
});
