import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { codePlanFixture } from './code-plan-e2e-fixture.mjs';
import { readCodeFilm, wireCodePlans } from '../dist/code-plan/director.js';

const json = JSON.stringify;
const film = body => `export default async function(ctx) { ${body} }`;
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const f = await codePlanFixture(); t.after(() => f.close());
  f.id = (await f.create()).id;
  wireCodePlans(f.service, f.runtime);
  f.submit = source => f.runtime.submit(f.id, { source, basedOnVersion: f.runtime.getRun(f.id)?.planVersion ?? null,
    author: 'user', invocationId: randomUUID() });
  f.artifact = (name, { projectId = f.id, kind = 'image', ...extra } = {}) => {
    const id = randomUUID(), artifact = { artifactId: id, kind, sha256: hash(name) };
    f.store.insert('artifact', id, projectId, { id, projectId, artifact, path: join(f.paths.artifacts, id),
      fixture: false, attemptId: null, physicalDurationSeconds: null, ...extra });
    return artifact;
  };
  return f;
}
async function until(f, predicate) {
  for (let pass = 0; pass < 40; pass++) {
    await f.runtime.tick(); const view = f.runtime.view(f.id);
    assert.notEqual(view.state, 'error', json(view.error));
    assert.notEqual(view.state, 'paused_budget');
    if (predicate(view)) return view;
  }
  assert.fail(json(f.runtime.view(f.id)));
}
const done = f => until(f, view => view.state === 'done');
const snapshot = f => json({ entities: f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all(),
  project: f.store.getProject(f.id), events: f.store.readEvents(f.id), calls: f.calls });

test('shared sheet survives keyframe confirmation, reference-mode clip and an artifact-literal rewrite', async t => {
  const f = await fixture(t);
  const source = sheet => film(`
    await ctx.shot({id:'opening'});
    ${sheet ? `const sheet={ok:true,artifact:${json(sheet)}};` : `const sheet=await ctx.image({prompt:'Shared character sheet'});`}
    if(!sheet.ok)return;
    const k=await ctx.keyframe('opening',{prompt:'Opening composition',references:[sheet.artifact],video:{durationSeconds:6}});
    if(k.ok)await ctx.video({...k.input,shot:'opening',prompt:'Move gently',durationSeconds:6});`);
  await f.submit(source());
  const waiting = await until(f, view => view.choices.some(choice => !choice.stale && !Object.hasOwn(choice, 'answer')));
  const sheet = waiting.steps.find(step => step.label === 'Shared character sheet').artifact;
  const keyframe = waiting.steps.find(step => step.kind === 'image' && step.shotId === 'opening').artifact;
  assert.notEqual(sheet.artifactId, keyframe.artifactId);
  assert.deepEqual(waiting.references, [sheet]);
  const choice = waiting.choices[0], answer = choice.options.find(option => option.keyframeInput === 'keyframe_and_references');
  assert.ok(answer);
  f.runtime.answer(f.id, { choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, answer });
  const finished = await done(f), video = f.runtime.steps(f.id).find(step => step.kind === 'video');
  assert.deepEqual(video.input.references.map(ref => ref.sha256), [keyframe.sha256, sheet.sha256]);
  assert.deepEqual(finished.references, [sheet]);
  const beforeCalls = f.calls.submit.length, beforeSpent = finished.spentMicros;
  await f.submit(source(sheet)); const rewritten = await done(f);
  assert.equal(rewritten.steps.find(step => step.artifact?.artifactId === sheet.artifactId).reached, false);
  assert.deepEqual(rewritten.references, [sheet]);
  assert.equal(f.calls.submit.length, beforeCalls); assert.equal(rewritten.spentMicros, beforeSpent);
  const before = snapshot(f);
  assert.deepEqual((await f.view(f.id)).references, [sheet]);
  assert.deepEqual(readCodeFilm(f.service, f.id).references, [sheet]);
  assert.deepEqual(f.runtime.view(f.id), rewritten);
  assert.equal(snapshot(f), before, 'view, HTTP and Director reads must not write or dispatch');
});

test('reduced upload inputs resolve to the original and deduplicate original/copy uses', async t => {
  const f = await fixture(t), original = f.artifact('Upload', { origin: 'supplied_image', name: 'portrait.png' });
  const reduced = f.artifact('Reduced upload');
  f.store.insert('code_plan_image_reference', original.artifactId, f.id,
    { id: original.artifactId, projectId: f.id, source: original, reference: reduced });
  await f.submit(film(`await ctx.image({prompt:'Use the portrait',references:${json([reduced, original, reduced])}});
    await ctx.video({prompt:'Move the portrait',firstFrame:${json(reduced)},durationSeconds:6});`));
  assert.deepEqual((await done(f)).references, [original]);
  await f.restart();
  assert.deepEqual(f.runtime.view(f.id).references, [original]);
});

test('references, first and last frames follow journal first use rather than artifact or replay order', async t => {
  const f = await fixture(t), [d, c, a, b] = ['D', 'C', 'A', 'B'].map(name => f.artifact(name));
  const image = `await ctx.image({prompt:'Two references',references:${json([b, a, b])}});`;
  const frames = `await ctx.video({prompt:'Start and end',firstFrame:${json(a)},lastFrame:${json(c)},durationSeconds:6});`;
  const refs = `await ctx.video({prompt:'Reference clip',references:${json([d, b])},durationSeconds:6});`;
  await f.submit(film(image + frames + refs)); assert.deepEqual((await done(f)).references, [b, a, c, d]);
  const journal = f.runtime.steps(f.id).map(step => step.key), beforeCalls = f.calls.submit.length;
  await f.submit(film(refs + frames + image)); const reordered = await done(f);
  assert.notDeepEqual(f.runtime.getRun(f.id).reachedStepKeys, journal);
  assert.deepEqual(reordered.references, [b, a, c, d]);
  assert.equal(f.calls.submit.length, beforeCalls);
});

test('unreached inputs disappear even when their owned pictures remain in the journal', async t => {
  const f = await fixture(t), retired = f.artifact('Retired reference'), current = f.artifact('Current reference');
  await f.submit(film(`await ctx.image({prompt:'Retired image',references:${json([retired])}});`));
  assert.deepEqual((await done(f)).references, [retired]);
  await f.submit(film(`await ctx.video({prompt:'Current clip',firstFrame:${json(current)},durationSeconds:6});`));
  const view = await done(f);
  assert.equal(view.steps.find(step => step.label === 'Retired image').reached, false);
  assert.deepEqual(view.references, [current]);
});

test('view filters foreign, unknown and non-image inputs from a reached persisted step', async t => {
  const f = await fixture(t), own = f.artifact('Owned input');
  await f.submit(film(`await ctx.image({prompt:'Owned picture',references:${json([own])}});`)); await done(f);
  const other = (await f.create()).id, foreign = f.artifact('Foreign input', { projectId: other });
  const unknown = { artifactId: randomUUID(), kind: 'image', sha256: hash('Missing input') };
  const audio = f.artifact('Audio input', { kind: 'audio' }), step = f.runtime.steps(f.id)[0];
  // Invalid inputs cannot pass normal admission. Simulate a damaged historical journal without executing it.
  f.store.put('code_plan_step', step.id, f.id, { ...step, input: { ...step.input,
    references: [foreign, unknown, audio, { ...own, sha256: unknown.sha256 }, own], firstFrame: null, lastFrame: 'bad' } });
  const before = snapshot(f);
  assert.deepEqual(f.runtime.view(f.id).references, [own]); assert.equal(snapshot(f), before);
});

test('legacy choice-linked keyframes are excluded without an explicit shot annotation', async t => {
  const f = await fixture(t);
  await f.submit(film(`const k=await ctx.image({prompt:'Legacy frame'});if(!k.ok)return;
    await ctx.choose('opening-keyframe',{question:'Choose a frame',options:[k.artifact]});
    await ctx.video({prompt:'Legacy movement',firstFrame:k.artifact,durationSeconds:6});`));
  const waiting = await until(f, view => view.choices.length === 1), choice = waiting.choices[0];
  f.runtime.answer(f.id, { choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, answer: choice.options[0] });
  const view = await done(f), image = f.runtime.steps(f.id).find(step => step.kind === 'image');
  assert.equal(image.shotId, undefined);
  assert.equal(view.steps.find(step => step.key === image.key).shotId, 'opening');
  assert.equal(Object.hasOwn(view, 'references'), false);
});

test('references stop at 24 distinct owned images in first-use order', async t => {
  const f = await fixture(t), pictures = Array.from({ length: 27 }, (_, index) => f.artifact(`Reference ${index}`));
  const body = [0, 9, 18].map(start => `await ctx.video({prompt:'Batch ${start}',references:${json(pictures.slice(start, start + 9))},durationSeconds:6});`).join('\n');
  await f.submit(film(body)); assert.deepEqual((await done(f)).references, pictures.slice(0, 24));
});

test('no plan, unused images and an empty latest plan omit the references field', async t => {
  const f = await fixture(t); f.artifact('Unused upload', { origin: 'supplied_image' });
  assert.equal(Object.hasOwn(f.runtime.view(f.id), 'references'), false);
  await f.submit(film(`await ctx.image({prompt:'Unused sheet'});`));
  assert.equal(Object.hasOwn(await done(f), 'references'), false);
  const image = f.runtime.steps(f.id)[0].result.artifact;
  await f.submit(film(`await ctx.video({prompt:'Used sheet',firstFrame:${json(image)},durationSeconds:6});`));
  assert.deepEqual((await done(f)).references, [image]);
  await f.submit(film(`await ctx.log('No media');`));
  assert.equal(Object.hasOwn(await done(f), 'references'), false);
});
