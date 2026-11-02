import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { codePlanFixture } from './code-plan-e2e-fixture.mjs';
import { realCodeFixture, videoProfile, miniMaxProfile, imageSource } from './code-plan-providers-fixture.mjs';
import { codexImageProfile } from './codex-image-execution-fixture.mjs';
import { pngBytes } from './viggle-h3-execution-fixture.mjs';
import { musicProfile, musicWave, musicReply } from './gemini-music-fixture.mjs';
import { wireCodePlans, readCodeFilm } from '../dist/code-plan/director.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { projectAssets } from '../dist/asset-library.js';

const film = body => `export default async function(ctx) { ${body} }`;
const json = JSON.stringify;
const modes = ['keyframe_and_references', 'references_only', 'first_frame'];
async function fake(t) {
  const f = await codePlanFixture(); t.after(() => f.close()); const { id } = await f.create();
  f.id = id; f.plans = f.runtime;
  f.submit = source => f.runtime.submit(id, { source, basedOnVersion: f.runtime.getRun(id)?.planVersion ?? null, author: 'user', invocationId: randomUUID() });
  return f;
}
async function until(f, predicate) {
  for (let pass = 0; pass < 30; pass++) {
    await f.plans.tick(); const view = f.plans.view(f.id);
    assert.notEqual(view.state, 'error', json(view.error));
    if (predicate(view)) return view;
  }
  assert.fail(json(f.plans.view(f.id)));
}
const done = f => until(f, view => ['done', 'done_with_failures'].includes(view.state));
const waiting = f => until(f, view => view.choices.some(choice => !Object.hasOwn(choice, 'answer')));
function answer(f, choice, mode) {
  const option = choice.options.find(option => option.keyframeInput === mode); assert.ok(option, mode);
  f.plans.answer(f.id, { choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, answer: option });
  return option;
}
const refused = (operation, code) => assert.rejects(operation, error => error.code === 'CODE_PLAN_REJECTED'
  && error.details.diff.findings.some(finding => finding.code === 'RUNTIME_ERROR' && finding.detail.includes(code)));

async function real(t, profile = videoProfile) {
  const f = await realCodeFixture(t, { profiles: [codexImageProfile, profile], videoSeconds: 6 }); f.id = f.project.id;
  wireCodePlans(f.service, f.plans);
  await f.submit(imageSource); await f.finish();
  f.reference = f.plans.steps(f.id)[0].result.artifact;
  f.png = pngBytes(360, 640); // Distinct from the shared reference, so the gate must check real content.
  f.clipSettings = { model: profile.id, durationSeconds: 6, ...(profile.adapter === 'viggle-h3' ? { aspectRatio: '9:16' } : {}) };
  f.input = { model: codexImageProfile.id, prompt: 'Full body in the shared room', references: [f.reference], video: f.clipSettings };
  f.source = (input = f.input, use = '...keyframe.input', extra = '') => film(`
    await ctx.shot({id:'opening',title:'The room wakes'});
    const keyframe = await ctx.keyframe('opening', ${json(input)}); if (!keyframe.ok) { await ctx.log(JSON.stringify(keyframe)); return; }
    await ctx.log(JSON.stringify(keyframe));
    await ctx.video({${use},shot:'opening',prompt:'Walk toward the window',...${json(f.clipSettings)}}); ${extra}`);
  return f;
}

test('declared-shot video without a keyframe is refused on submit without dispatch or charge', async t => {
  const f = await fake(t);
  for (const annotation of ['', ',shot:"opening"', ',shot:"undeclared"']) {
    await refused(f.submit(film(`await ctx.shot({id:'opening'}); await ctx.video({prompt:'Move',aspectRatio:'16:9'${annotation}});`)), 'CODE_PLAN_KEYFRAME_REQUIRED');
  }
  assert.equal(f.plans.steps(f.id).length, 0); assert.equal(f.calls.submit.length, 0);
  assert.equal(f.plans.view(f.id).spentMicros, '0'); assert.equal(f.plans.view(f.id).planVersion, null);
});

test('keyframe validates declared shot and required video before starting an image', async t => {
  const f = await fake(t);
  for (const body of [
    `await ctx.keyframe('opening',{prompt:'Dawn',video:{durationSeconds:6}});`,
    `await ctx.shot({id:'opening'});await ctx.keyframe('opening',{prompt:'Dawn'});`,
    `await ctx.shot({id:'opening'});await ctx.keyframe('opening',{prompt:'Dawn',video:{}});`,
  ]) await assert.rejects(f.submit(film(body)), { code: 'CODE_PLAN_REJECTED' });
  assert.equal(f.calls.submit.length, 0); assert.equal(f.plans.steps(f.id).length, 0);
});

test('concurrent pipelines show and use the first ready card while another frame is pending', async t => {
  const f = await fake(t), submit = f.provider.submit.bind(f.provider);
  f.provider.submit = request => { if (request.kind === 'image' && request.args.prompt === 'Second') f.provider.setMode(request.nodeId, 'pending'); return submit(request); };
  await f.submit(film(`const shots=['First','Second'];for(const id of shots)await ctx.shot({id});
    await Promise.all(shots.map(async shot=>{const k=await ctx.keyframe(shot,{prompt:shot,video:{durationSeconds:6}});
      if(k.ok)await ctx.video({...k.input,shot,prompt:shot,durationSeconds:6});}));`));
  const view = await waiting(f); assert.equal(view.choices.length, 1); assert.equal(view.choices[0].question, 'First');
  assert.equal(view.steps.filter(step => step.kind === 'image').length, 2);
  answer(f, view.choices[0], 'first_frame');
  const continued = await until(f, view => view.steps.some(step => step.kind === 'video' && step.state === 'succeeded'));
  assert.equal(continued.choices.length, 1); assert.equal(continued.state, 'waiting');
  assert.equal(continued.steps.find(step => step.kind === 'image' && step.shotId === 'Second').state, 'in_flight');
});

for (const mode of modes) test(`confirmed ${mode}: one image, ordered flat options, actual model prices and exact video input`, async t => {
  const profile = { ...videoProfile, configuration: { ...videoProfile.configuration, settings: { ...videoProfile.configuration.settings, resolution: '768p' } } };
  const f = await real(t, profile), model = readCodeFilm(f.service, f.id).models.find(row => row.id === profile.id);
  assert.deepEqual(model.videoModes, ['reference', 'first_frame', 'first_last_frame', 'text']);
  assert.equal(model.priceBasis.creditsPer5Seconds.reference, 25); assert.equal(model.priceBasis.creditsPer5Seconds.first_frame, 15);
  await f.submit(f.source());
  const view = await waiting(f), choice = view.choices[0], frame = view.steps.find(step => step.shotId === 'opening').artifact;
  assert.equal(choice.choiceId, 'opening-keyframe'); assert.equal(choice.question, 'The room wakes');
  assert.deepEqual(choice.options.map(option => option.keyframeInput), modes);
  assert.deepEqual(choice.options.map(option => option.priceMicros), ['300000', '300000', '180000']);
  for (const option of choice.options) {
    assert.deepEqual(option.references, [f.reference]);
    assert.deepEqual({ artifactId: option.artifactId, kind: option.kind, sha256: option.sha256 }, frame);
    assert.equal(option.artifact, undefined);
  }
  assert.equal(f.plans.steps(f.id).filter(step => step.kind === 'video').length, 0); assert.equal(f.calls.video, 0);
  const before = { ...f.calls }; await f.plans.replay(f.id); assert.deepEqual(f.calls, before);
  answer(f, choice, mode); await f.finish();
  const step = f.plans.steps(f.id).find(step => step.kind === 'video'), ref = artifact => ({ kind: artifact.kind, sha256: artifact.sha256 });
  if (mode === 'first_frame') { assert.deepEqual(step.input.firstFrame, ref(frame)); assert.equal(step.input.references, undefined); }
  else { assert.deepEqual(step.input.references, (mode === 'references_only' ? [f.reference] : [frame, f.reference]).map(ref)); assert.equal(step.input.firstFrame, undefined); }
  const result = JSON.parse(f.plans.getRun(f.id).logs[0]);
  assert.equal(result.choice, mode); assert.deepEqual(result.frame, frame);
  assert.deepEqual(result.input, mode === 'first_frame' ? { firstFrame: frame } : { references: mode === 'references_only' ? [f.reference] : [frame, f.reference] });
  assert.equal(step.priceMicros, choice.options.find(option => option.keyframeInput === mode).priceMicros); assert.equal(f.calls.video, 1);
  const calls = { ...f.calls }; await f.submit(f.source()); await f.finish(); assert.deepEqual(f.calls, calls); f.noGraph();
});

test('model capabilities remove unsupported options, no references removes references_only, Viggle truncates to four', async t => {
  const f = await real(t, miniMaxProfile);
  assert.deepEqual(readCodeFilm(f.service, f.id).models.find(row => row.id === miniMaxProfile.id).videoModes, ['first_frame']);
  await f.submit(f.source()); let view = await waiting(f);
  assert.deepEqual(view.choices[0].options.map(option => option.keyframeInput), ['first_frame']);
  assert.equal(view.choices[0].options[0].priceMicros, '100000');
  // Reference-capable models preserve the person's list but cap the combined video input.
  const g = await real(t);
  assert.ok(readCodeFilm(g.service, g.id).models.find(row => row.id === videoProfile.id).videoModes.includes('reference'));
  const input = { ...g.input, references: Array(4).fill(g.reference) };
  await g.submit(g.source(input)); view = await waiting(g);
  const choice = view.choices[0]; assert.equal(choice.options[0].references.length, 4);
  answer(g, choice, 'keyframe_and_references'); await g.finish();
  const video = g.plans.steps(g.id).find(step => step.kind === 'video');
  assert.equal(video.input.references.length, 4); assert.equal(video.input.references[0].sha256, choice.options[0].sha256);
  assert.deepEqual(video.input.references.slice(1).map(ref => ref.sha256), Array(3).fill(g.reference.sha256));
  await g.submit(g.source({ ...g.input, references: [] })); view = await waiting(g);
  const without = view.choices.find(choice => !Object.hasOwn(choice, 'answer'));
  assert.deepEqual(without.options.map(option => option.keyframeInput), ['keyframe_and_references', 'first_frame']);
});

for (const mode of modes) test(`${mode}: altered input is refused, variants reuse the card and first-frame retakes respect the answer`, async t => {
  const f = await real(t); await f.submit(f.source()); const view = await waiting(f); const choice = view.choices[0];
  answer(f, choice, mode); await f.finish(); const before = { ...f.calls };
  const badInputs = mode === 'references_only'
    ? ['firstFrame:keyframe.frame', 'firstFrame:keyframe.input.references[0],lastFrame:keyframe.frame', 'references:[keyframe.frame]']
    : [`references:${json([f.reference])}`];
  for (const use of badInputs) await refused(f.submit(f.source(f.input, use)), 'CODE_PLAN_KEYFRAME_INPUT');
  for (const shot of ['', "shot:'missing',"]) await refused(f.submit(f.source(f.input, '...keyframe.input,variant:"unconfirmed-shot"').replace("shot:'opening',", shot)), 'CODE_PLAN_KEYFRAME_REQUIRED');
  assert.deepEqual(f.calls, before);
  await f.submit(f.source(f.input, '...keyframe.input,variant:"retake-1"')); await f.finish();
  assert.equal(f.calls.video, before.video + 1); assert.equal(f.calls.start, before.start); assert.equal(f.plans.choices(f.id).length, 1);
  const retake = f.source(f.input, 'firstFrame:keyframe.frame,variant:"framing-retake"');
  if (mode === 'references_only') await refused(f.submit(retake), 'CODE_PLAN_KEYFRAME_INPUT');
  else { await f.submit(retake); await f.finish(); assert.equal(f.calls.video, before.video + 2); }
  assert.equal(f.plans.choices(f.id).length, 1);
});

test('a duration change asks again even when the model has the same flat price', async t => {
  const f = await fake(t), source = durationSeconds => film(`await ctx.shot({id:'opening'});
    const k=await ctx.keyframe('opening',{prompt:'Same image',video:{durationSeconds:${durationSeconds}}});if(k.ok)await ctx.log(k.choice);`);
  await f.submit(source(6)); const first = (await waiting(f)).choices[0]; answer(f, first, 'first_frame'); await done(f);
  const images = f.calls.submit.length;
  await f.submit(source(7)); const changed = (await waiting(f)).choices.find(choice => !Object.hasOwn(choice, 'answer'));
  assert.notEqual(changed.optionsDigest, first.optionsDigest); assert.equal(f.calls.submit.length, images);
});

test('unchanged keyframes retain answers across versions/restart; prompt, variant, references, duration and model edits ask again', async t => {
  const f = await real(t); await f.submit(f.source()); const first = (await waiting(f)).choices[0];
  answer(f, first, 'keyframe_and_references'); await f.finish(); const before = { ...f.calls };
  await f.restart(); wireCodePlans(f.service, f.plans);
  await f.submit(f.source() + '\n// Refactor only'); await f.finish(); assert.deepEqual(f.calls, before);
  for (const input of [
    { ...f.input, prompt: 'Changed composition' }, { ...f.input, variant: 'picture-2' }, { ...f.input, references: [] },
    { ...f.input, video: { ...f.clipSettings, durationSeconds: 7 } },
  ]) {
    const images = f.calls.start; await f.submit(f.source(input)); const view = await waiting(f);
    const choice = view.choices.find(choice => !Object.hasOwn(choice, 'answer'));
    assert.notEqual(choice.optionsDigest, first.optionsDigest);
    assert.equal(f.calls.video, before.video);
    assert.equal(f.calls.start - images, input.video.durationSeconds === 7 ? 0 : 1);
  }
  // Model change uses a real second installed video profile and the original image result.
  const g = await realCodeFixture(t, { newFilm: true, profiles: [codexImageProfile, videoProfile, miniMaxProfile],
    selected: [codexImageProfile.id, videoProfile.id], configuration: { h3: true, h3DownloadHosts: ['media.example.test'] } }); g.id = g.project.id;
  wireCodePlans(g.service, g.plans);
  const source = model => film(`await ctx.shot({id:'opening'}); const k=await ctx.keyframe('opening',{prompt:'Model switch',video:{model:${json(model)},durationSeconds:6}}); if(k.ok)await ctx.log(k.choice);`);
  assert.ok(readCodeFilm(g.service, g.id).models.some(model => model.id === miniMaxProfile.id));
  await g.submit(source('viggle-h3')); let view = await waiting(g); answer(g, view.choices[0], 'first_frame'); await g.finish();
  const images = g.calls.start; await g.submit(source(miniMaxProfile.id)); view = await waiting(g);
  assert.equal(g.calls.start, images); assert.equal(view.choices.filter(choice => !Object.hasOwn(choice, 'answer')).length, 1);
});

test('journaled videos replay and re-cut without a keyframe or new charge; a new shot clip still needs confirmation', async t => {
  const f = await fake(t);
  const original = film(`const image=await ctx.image({prompt:'Historical frame'});if(!image.ok)return;
    const clip=await ctx.video({firstFrame:image.artifact,prompt:'Saved movement',durationSeconds:6});if(!clip.ok)return;
    await ctx.render([{artifact:clip.artifact,startFrame:0,durationFrames:30}]);`);
  await f.submit(original); await done(f); const before = f.calls.submit.length, spent = f.plans.view(f.id).spentMicros;
  const declared = original.replace('const image=', `await ctx.shot({id:'opening'});const image=`);
  await f.submit(declared); await done(f); assert.equal(f.calls.submit.length, before);
  await f.submit(declared.replace('durationFrames:30', 'durationFrames:20')); await done(f);
  assert.deepEqual(f.calls.submit.slice(before).map(call => call.kind), ['render']);
  assert.equal(f.plans.choices(f.id).length, 0); assert.equal(f.plans.view(f.id).spentMicros, spent);
  await refused(f.submit(declared.replace('Saved movement', 'New movement')), 'CODE_PLAN_KEYFRAME_REQUIRED');
  assert.equal(f.calls.submit.filter(call => call.kind === 'video').length, 1);
});

test('failed keyframe image returns the failed result to the plan and creates no choice', async t => {
  const f = await fake(t), submit = f.provider.submit.bind(f.provider);
  f.provider.submit = request => { f.provider.setMode(request.nodeId, 'technical_failure'); return submit(request); };
  f.provider.poll = async taskId => ({ type: 'failed', taskId, failureId: 'KEYFRAME_FAILED', technical: false, retryAllowed: false });
  await f.submit(film(`await ctx.shot({id:'opening'});const k=await ctx.keyframe('opening',{prompt:'Failed image',video:{durationSeconds:6}});await ctx.log(JSON.stringify(k));`));
  await done(f); const result = JSON.parse(f.plans.getRun(f.id).logs[0]);
  assert.equal(result.ok, false); assert.equal(typeof result.error.code, 'string');
  assert.equal(f.plans.choices(f.id).length, 0); assert.equal(f.plans.steps(f.id).filter(step => step.kind === 'video').length, 0);
});

for (const contract of ['0.1.0', '0.2.0']) test(`${contract}: keyframe is undefined and declared shots have no gate`, async t => {
  const f = await fake(t), lock = createDirectorSkillLock({ repositoryRoot: process.cwd(), snapshotRoot: join(f.root, 'historical-skills') }, contract).lock;
  f.store.put('director_skill_lock', lock.id, f.id, { id: lock.id, projectId: f.id, lock });
  const source = film(`if(typeof ctx.keyframe!=='undefined'||typeof ctx.review!=='undefined')throw Error('leaked capability');
    await ctx.shot({id:'opening'});const frame=await ctx.image({prompt:'Old picture'});if(frame.ok)await ctx.video({firstFrame:frame.artifact,prompt:'Old movement'});`);
  await f.submit(source); await done(f); const before = f.calls.submit.length;
  await f.submit(source); await done(f); assert.equal(f.calls.submit.length, before); assert.equal(f.plans.choices(f.id).length, 0);
});

for (const contract of ['0.2.0', '0.3.0']) test(`${contract}: unannotated sheets are numbered references, annotated frames remain keyframes`, async t => {
  const f = await fake(t), lock = createDirectorSkillLock({ repositoryRoot: process.cwd(), snapshotRoot: join(f.root, 'asset-skills') }, contract).lock;
  f.store.put('director_skill_lock', lock.id, f.id, { id: lock.id, projectId: f.id, lock });
  await f.submit(film(`await ctx.image({prompt:'Shared sheet'});await ctx.image({prompt:'Shared plate'});await ctx.image({prompt:'Shot frame',shot:'opening'});`));
  await done(f); const assets = projectAssets(f.service, f.store.getProject(f.id));
  assert.deepEqual(assets.map(item => [item.role, item.takeIndex]), [['keyframe', 1], ['reference', 2], ['reference', 1]]);
  await f.restart(); assert.deepEqual(projectAssets(f.service, f.store.getProject(f.id)), assets);
});

test('an old frame with no shot annotation stays a keyframe when its choice names the shot', async t => {
  const f = await fake(t), lock = createDirectorSkillLock({ repositoryRoot: process.cwd(), snapshotRoot: join(f.root, 'asset-skills') }, '0.2.0').lock;
  f.store.put('director_skill_lock', lock.id, f.id, { id: lock.id, projectId: f.id, lock });
  await f.submit(film(`const frame=await ctx.image({prompt:'Old frame'});await ctx.choose('opening-keyframe',{question:'Which frame?',options:[frame.artifact]});`));
  await until(f, view => view.choices.length === 1);
  assert.deepEqual(projectAssets(f.service, f.store.getProject(f.id)).map(item => [item.role, item.shotId]), [['keyframe', 'opening']]);
});

test('19.5s music requests 30s; re-cut to 21s retains the measured track, identity and charge', async t => {
  const calls = [];
  const f = await realCodeFixture(t, { profiles: [musicProfile], configuration: { music: true }, transport: {
    musicFetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return new Response(json(musicReply(musicWave(32))), { headers: { 'content-type': 'application/json' } }); },
  } });
  const source = seconds => film(`const filmSamples=${seconds}*48000;const music=await ctx.music({prompt:'Warm piano',durationSeconds:Math.ceil(filmSamples/48000/30)*30});
    if(!music.ok)return; if(music.durationSamples-music.leadInSamples<filmSamples)throw Error('short track');await ctx.log(JSON.stringify({samples:music.durationSamples,filmSamples}));`);
  await f.submit(source(19.5)); await f.finish();
  const step = f.plans.steps(f.project.id)[0]; assert.equal(step.input.durationSeconds, 30); assert.equal(calls.length, 1);
  await f.restart(); await f.submit(source(21)); await f.finish();
  assert.equal(calls.length, 1); assert.equal(f.plans.steps(f.project.id).length, 1); assert.equal(f.plans.steps(f.project.id)[0].key, step.key);
  assert.equal(f.plans.view(f.project.id).spentMicros, '80000');
  assert.ok(JSON.parse(f.plans.getRun(f.project.id).logs[0]).samples >= 21 * 48000);
});
