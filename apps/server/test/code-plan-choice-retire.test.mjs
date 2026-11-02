import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { codePlanFixture } from './code-plan-e2e-fixture.mjs';
import { codeDirectorInput, readCodeFilm, triggerCodePlanRepairs, wireCodePlans } from '../dist/code-plan/director.js';
import { CODE_PLAN_GUIDANCE_DIGEST, createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { projectAssets } from '../dist/asset-library.js';

const film = body => `export default async function(ctx) { ${body} }`;
const sceneOnly = film(`await ctx.scene({id:'room',purpose:'The last agreed premise'});`);
const original = shots();
const live = view => view.choices.filter(choice => !choice.stale);
const sameCard = (a, b) => a.choiceId === b.choiceId && a.optionsDigest === b.optionsDigest;
const card = (view, id) => live(view).find(choice => choice.choiceId === `${id}-keyframe`);

function shots({ second = 'Second picture', reference = 'Shared room' } = {}) {
  return film(`await ctx.scene({id:'room',purpose:'The last agreed premise'});
    const ref=await ctx.image({prompt:${JSON.stringify(reference)}});if(!ref.ok)return;
    const shots=[{id:'one',prompt:'First picture'},{id:'two',prompt:${JSON.stringify(second)}}];
    for(const shot of shots)await ctx.shot({id:shot.id,sceneId:'room',title:shot.id});
    await Promise.all(shots.map(async shot=>{
      const k=await ctx.keyframe(shot.id,{prompt:shot.prompt,references:[ref.artifact],video:{durationSeconds:6}});
      if(k.ok)await ctx.video({...k.input,shot:shot.id,prompt:'Move '+shot.id,durationSeconds:6});
    }));`);
}
async function fixture(t) {
  const f = await codePlanFixture(); t.after(() => f.close()); f.id = (await f.create()).id;
  wireCodePlans(f.service, f.runtime);
  f.submit = source => f.runtime.submit(f.id, { source, author: 'user',
    basedOnVersion: f.runtime.getRun(f.id)?.planVersion ?? null, invocationId: randomUUID() });
  f.view = () => f.runtime.view(f.id);
  f.rows = () => f.runtime.choices(f.id);
  f.until = async predicate => {
    for (let i = 0; i < 40; i++) {
      await f.runtime.tick(); const view = f.view();
      assert.notEqual(view.state, 'error', JSON.stringify(view.error));
      if (predicate(view)) return view;
    }
    assert.fail(JSON.stringify(f.view()));
  };
  f.waiting = () => f.until(view => live(view).length === 2 && live(view).every(choice => choice.askedAt));
  f.answer = choice => f.runtime.answer(f.id, { ...choice, answer: choice.options.find(option => option.keyframeInput === 'first_frame') ?? choice.options[0] });
  return f;
}
const submissions = f => f.calls.submit.map(call => [call.kind, call.attemptId]);
const rowFor = (f, choice) => f.rows().find(row => sameCard(row, choice));
function observeChoiceWrites(f) {
  const put = f.store.put.bind(f.store), writes = [];
  f.store.put = (kind, ...args) => { if (kind === 'code_plan_choice') writes.push(structuredClone(args)); return put(kind, ...args); };
  return writes;
}

for (const answered of [false, true]) test(`shot 2 edit retires only its card; shot 1 ${answered ? 'answer and paid clip survive' : 'keeps its original question time'}`, async t => {
  const f = await fixture(t); await f.submit(original); let view = await f.waiting();
  const first = card(view, 'one'), second = card(view, 'two');
  if (answered) {
    f.answer(first);
    view = await f.until(view => view.steps.some(step => step.shotId === 'one' && step.kind === 'video' && step.state === 'succeeded'));
  }
  const stored = rowFor(f, first), calls = submissions(f), spent = view.spentMicros;
  await f.submit(shots({ second: 'A different second picture' }));
  assert.deepEqual(rowFor(f, first), stored, 'submitting must not reset surviving cards');
  view = await f.until(view => !!card(view, 'two') && card(view, 'two').optionsDigest !== second.optionsDigest);
  assert.equal(rowFor(f, second).stale, true); assert.deepEqual(rowFor(f, first), stored);
  assert.ok(card(view, 'two').askedAt); assert.equal(card(view, 'one').askedAt, first.askedAt);
  assert.deepEqual(f.calls.submit.slice(calls.length).map(call => call.kind), ['image']);
  assert.equal(BigInt(view.spentMicros) - BigInt(spent), 10000n);
  assert.equal(f.calls.submit.filter(call => call.kind === 'video').length, answered ? 1 : 0);
});

test('changing a shared reference retires every dependent keyframe card', async t => {
  const f = await fixture(t); await f.submit(original); const before = (await f.waiting()).choices;
  await f.submit(shots({ reference: 'A completely different shared room' }));
  const view = await f.until(view => live(view).length === 2 && before.every(choice => rowFor(f, choice).stale));
  assert.equal(view.choices.length, 4); assert.ok(live(view).every(choice => choice.askedAt));
  assert.equal(f.calls.submit.filter(call => call.kind === 'image').length, 6);
});

test('scene-only retires all cards for free; returning restores pictures, answers and clips without rebuying', async t => {
  const f = await fixture(t); await f.submit(original); const initial = await f.waiting();
  const first = card(initial, 'one'), second = card(initial, 'two'); f.answer(first);
  await f.until(view => view.steps.some(step => step.kind === 'video' && step.state === 'succeeded'));
  const answered = rowFor(f, first), calls = submissions(f), spent = f.view().spentMicros;
  await f.submit(sceneOnly); const retired = await f.until(view => view.state === 'done');
  assert.ok(retired.choices.every(choice => choice.stale)); assert.deepEqual(submissions(f), calls);
  assert.equal(retired.spentMicros, spent); assert.deepEqual(retired.declarations.scenes, [{ id: 'room', purpose: 'The last agreed premise' }]);
  const staleRows = f.rows(), writes = observeChoiceWrites(f), events = f.events(f.id);
  const response = await f.http('POST', `/api/projects/${f.id}/code-plan/choices`, {
    choiceId: second.choiceId, optionsDigest: second.optionsDigest, answer: second.options[0],
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json().error, { code: 'CODE_PLAN_CHOICE_STALE', message: 'This card no longer applies' });
  assert.deepEqual(f.rows(), staleRows); assert.deepEqual(f.events(f.id), events);
  const repeat = await f.http('POST', `/api/projects/${f.id}/code-plan/choices`, {
    choiceId: first.choiceId, optionsDigest: first.optionsDigest, answer: answered.answer,
  });
  assert.equal(repeat.statusCode, 200, repeat.body); assert.deepEqual(f.rows(), staleRows); assert.equal(writes.length, 0);
  assert.throws(() => f.runtime.answerChoice(f.id, first.choiceId, first.optionsDigest, first.options.find(option => option.keyframeInput !== 'first_frame')),
    { code: 'CODE_PLAN_CHOICE_STALE', message: 'This card no longer applies' });
  assert.equal(readCodeFilm(f.service, f.id).choices.length, 0); assert.equal(f.view().choices.length, 2);
  await f.restart(); wireCodePlans(f.service, f.runtime);
  await f.submit(original); const restored = await f.waiting();
  assert.equal(restored.choices.length, 2); assert.ok(restored.choices.every(choice => !Object.hasOwn(choice, 'stale')));
  assert.deepEqual(rowFor(f, first), answered); assert.ok(card(restored, 'two').askedAt > second.askedAt);
  assert.deepEqual(submissions(f), calls); assert.equal(restored.spentMicros, spent);
});

test('plain text choices retire and reappear with the same identity, preserving answers', async t => {
  const f = await fixture(t), source = film(`await ctx.choose('tone',{question:'Tone?',options:['warm','cool']});`);
  await f.submit(source); let view = await f.until(view => live(view).length === 1); const choice = live(view)[0];
  assert.ok(choice.askedAt);
  await f.submit(sceneOnly); await f.until(view => view.state === 'done');
  assert.throws(() => f.answer(choice), { code: 'CODE_PLAN_CHOICE_STALE' });
  await f.submit(source); view = await f.until(view => live(view).length === 1);
  assert.ok(live(view)[0].askedAt > choice.askedAt); f.answer(live(view)[0]); await f.until(view => view.state === 'done');
  const answered = f.rows()[0]; await f.submit(sceneOnly); await f.until(view => view.state === 'done');
  f.answer(choice); assert.deepEqual(f.rows()[0], { ...answered, stale: true });
  await f.submit(source); await f.until(view => view.state === 'done');
  assert.deepEqual(f.rows()[0], answered); assert.equal(f.calls.submit.length, 0);
});

for (const [name, body, message] of [
  ['programming error', `throw Error('broken pass');`, /broken pass/],
  ['CPU limit', `while(true){}`, /CPU limit/],
]) test(`${name} does not change existing choice liveness or backfill`, async t => {
  const f = await fixture(t); await f.submit(original); await f.waiting();
  const rows = f.rows(); const { askedAt: _askedAt, ...undated } = rows[0];
  f.store.put('code_plan_choice', undated.id, f.id, undated); const before = f.rows(), writes = observeChoiceWrites(f);
  // Invalid source cannot pass submit's dry run; the low-level runtime entry exercises persisted-pass failures.
  f.runtime.submitPlan(f.id, film(body)); const run = await f.runtime.replay(f.id);
  assert.equal(run.state, 'error'); assert.match(run.error.message, message);
  assert.deepEqual(f.rows(), before); assert.equal(writes.length, 0);
});

for (const stop of [false, true]) test(`${stop ? 'shutdown' : 'a newer version'} abandons choice settlement from an unfinished pass`, async t => {
  const f = await fixture(t); await f.submit(original); await f.waiting(); const before = f.rows();
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), submit = f.execution.submit.bind(f.execution);
  f.execution.submit = async id => { entered.resolve(); await release.promise; return submit(id); };
  await f.submit(film(`await ctx.image({prompt:'Work overtaken before settlement'});`));
  const pass = f.runtime.replay(f.id);
  try {
    await entered.promise;
    if (stop) f.runtime.stop(); else await f.submit(original);
  } finally { release.resolve(); }
  await pass; assert.deepEqual(f.rows(), before);
  if (!stop) { await f.runtime.replay(f.id); assert.deepEqual(f.rows(), before); }
});

test('a surviving card never flickers or moves; repeated and idle passes do not rewrite its row', async t => {
  const f = await fixture(t); await f.submit(original); await f.waiting();
  const before = f.rows(), writes = observeChoiceWrites(f);
  const preview = await f.runtime.dryRun(f.id, sceneOnly); assert.equal(preview.findings.length, 0);
  assert.deepEqual(f.rows(), before); assert.equal(writes.length, 0);
  await f.submit(original + '\n// Refactor only'); assert.deepEqual(f.rows(), before);
  await f.runtime.replay(f.id); await f.runtime.replay(f.id); await f.runtime.tick();
  assert.deepEqual(f.rows(), before); assert.equal(writes.length, 0);
});

test('backfill dates a frame from its image step and only dates reached unanswered text choices', async t => {
  const f = await fixture(t), text = film(`await Promise.all([
    ctx.choose('waiting',{question:'Wait?',options:['yes','no']}),
    ctx.choose('answered',{question:'Answer?',options:[null,'no']}),
    ctx.choose('gone',{question:'Gone?',options:['yes']})]);`);
  await f.submit(original); await f.waiting(); await f.submit(text); await f.until(view => live(view).length === 3);
  const answered = live(f.view()).find(choice => choice.choiceId === 'answered');
  f.runtime.answerChoice(f.id, answered.choiceId, answered.optionsDigest, null);
  for (const row of f.rows()) { const { askedAt: _askedAt, ...undated } = row; f.store.put('code_plan_choice', row.id, f.id, undated); }
  // Keep the reached text unanswered/answered rows, leaving the other text row and both frames unreached.
  const source = film(`await Promise.all([ctx.choose('waiting',{question:'Wait?',options:['yes','no']}),
    ctx.choose('answered',{question:'Answer?',options:[null,'no']})]);`);
  await f.submit(source); const run = await f.runtime.replay(f.id);
  for (const row of f.rows()) {
    if (row.choiceId.endsWith('-keyframe')) {
      const step = f.runtime.steps(f.id).find(step => step.result?.ok && step.result.artifact.artifactId === row.options[0].artifactId);
      assert.equal(row.askedAt, step.updatedAt); assert.equal(row.stale, true);
    } else if (row.choiceId === 'waiting') { assert.equal(row.askedAt, run.lastPassAt); assert.equal(row.stale, undefined); }
    else { assert.equal(Object.hasOwn(row, 'askedAt'), false); assert.equal(row.stale, row.choiceId === 'gone' ? true : undefined); }
  }
  const writes = observeChoiceWrites(f); await f.runtime.replay(f.id); assert.equal(writes.length, 0);
});

test('reached legacy keyframes backfill from their image steps even when already answered', async t => {
  const f = await fixture(t); await f.submit(original); const view = await f.waiting();
  f.answer(card(view, 'one'));
  await f.until(view => view.steps.some(step => step.kind === 'video' && step.state === 'succeeded'));
  for (const row of f.rows()) { const { askedAt: _askedAt, ...undated } = row; f.store.put('code_plan_choice', row.id, f.id, undated); }
  const calls = submissions(f); await f.runtime.replay(f.id);
  for (const row of f.rows()) {
    const step = f.runtime.steps(f.id).find(step => step.kind === 'image' && step.result?.ok && step.result.artifact.artifactId === row.options[0].artifactId);
    assert.equal(row.askedAt, step.updatedAt); assert.equal(row.stale, undefined);
  }
  assert.deepEqual(submissions(f), calls);
});

test('a retired card cannot make its still-used picture non-current or infer a current shot', async t => {
  const f = await fixture(t); await f.submit(original); const view = await f.waiting(), choice = card(view, 'one');
  const frame = choice.options[0], reference = { artifactId: frame.artifactId, sha256: frame.sha256, kind: 'image' };
  await f.submit(film(`await ctx.image({prompt:'Use the retired picture as a reference',references:[${JSON.stringify(reference)}]});`));
  await f.until(view => view.state === 'done');
  assert.equal(rowFor(f, choice).stale, true);
  assert.equal(projectAssets(f.service, f.store.getProject(f.id)).find(item => item.artifact.artifactId === reference.artifactId).current, true);
  // The same original frame can remain reached as a shared reference without asking for a keyframe card.
  const shared = film(`const ref=await ctx.image({prompt:'Shared room'});if(ref.ok)await ctx.image({prompt:'First picture',references:[ref.artifact]});`);
  await f.submit(shared); await f.until(view => view.state === 'done');
  let asset = projectAssets(f.service, f.store.getProject(f.id)).find(item => item.artifact.artifactId === reference.artifactId);
  assert.equal(asset.current, true); assert.equal(asset.shotId, undefined); assert.equal(asset.role, 'reference');
  // Video reference use keeps an unreached picture current as well.
  await f.submit(film(`await ctx.video({firstFrame:${JSON.stringify(reference)},prompt:'Current clip',durationSeconds:6});`));
  await f.until(view => view.state === 'done');
  asset = projectAssets(f.service, f.store.getProject(f.id)).find(item => item.artifact.artifactId === reference.artifactId);
  assert.equal(asset.current, true);
  assert.equal(f.view().steps.find(step => step.kind === 'video' && step.reached).shotId, undefined);
});

test('a retired card keeps naming the shot of the frames and clips it made', async t => {
  const f = await fixture(t); await f.submit(original); const first = card(await f.waiting(), 'one'); f.answer(first);
  await f.until(view => view.steps.some(step => step.kind === 'video' && step.state === 'succeeded'));
  // Strip the explicit annotation, as in plans written before steps carried a shot.
  for (const step of f.runtime.steps(f.id)) if (step.shotId) { const { shotId: _shotId, ...row } = step; f.store.put('code_plan_step', step.id, f.id, row); }
  await f.submit(sceneOnly); await f.until(view => view.state === 'done');
  assert.equal(rowFor(f, first).stale, true);
  const history = f.view().steps.filter(step => !step.reached && (step.kind === 'video' || step.artifact?.artifactId === first.options[0].artifactId));
  assert.deepEqual(history.map(step => [step.kind, step.shotId]).sort(), [['image', 'one'], ['video', 'one']]);
  const frame = projectAssets(f.service, f.store.getProject(f.id)).find(item => item.artifact.artifactId === first.options[0].artifactId);
  assert.equal(frame.role, 'keyframe'); assert.equal(frame.shotId, 'one'); assert.equal(frame.current, false);
});

test('a stale keyframe cannot name a current media failure', async t => {
  const f = await fixture(t); await f.submit(original); const view = await f.waiting(), choice = card(view, 'one');
  const frame = choice.options[0], reference = { artifactId: frame.artifactId, sha256: frame.sha256, kind: 'image' };
  const submit = f.provider.submit.bind(f.provider);
  f.provider.submit = request => { if (request.kind === 'video') f.provider.setMode(request.nodeId, 'technical_failure'); return submit(request); };
  f.provider.poll = async taskId => ({ type: 'failed', taskId, failureId: 'CURRENT_CLIP_FAILED', technical: false, retryAllowed: false });
  await f.submit(film(`await ctx.video({firstFrame:${JSON.stringify(reference)},prompt:'Unlabelled current movement',durationSeconds:6});`));
  await f.until(view => view.state === 'done_with_failures');
  assert.equal(rowFor(f, choice).stale, true);
  const queued = []; triggerCodePlanRepairs(f.service, (...args) => queued.push(args));
  assert.equal(queued.length, 1);
  assert.equal(f.store.list('code_plan_failure_request', f.id)[0].shotLabel, 'Unlabelled current movement');
});

test('a held then cancelled clip with no attempt cannot bypass a later keyframe gate', async t => {
  const f = await fixture(t); await f.submit(original); const first = card(await f.waiting(), 'one');
  f.runtime.hold(f.id, 'before-clip'); f.answer(first);
  await f.until(view => view.steps.some(step => step.kind === 'video' && step.state === 'absent'));
  const video = f.runtime.steps(f.id).find(step => step.kind === 'video'); assert.equal(video.attemptId, null);
  const frame = first.options[0], ref = { artifactId: frame.artifactId, sha256: frame.sha256, kind: 'image' };
  const source = film(`await ctx.shot({id:'one'});await ctx.video({shot:'one',firstFrame:${JSON.stringify(ref)},prompt:'Move one',durationSeconds:6});`);
  const preview = await f.runtime.dryRun(f.id, source);
  assert.ok(preview.findings.some(finding => finding.detail.includes('CODE_PLAN_KEYFRAME_REQUIRED')));
  await f.submit(sceneOnly); await f.until(view => view.state === 'done');
  assert.equal(f.runtime.steps(f.id).find(step => step.key === video.key).state, 'cancelled');
  f.runtime.release(f.id, 'before-clip');
  await assert.rejects(f.submit(source), error => error.code === 'CODE_PLAN_REJECTED'
    && error.details.diff.findings.some(finding => finding.detail.includes('CODE_PLAN_KEYFRAME_REQUIRED')));
  assert.equal(f.calls.submit.filter(call => call.kind === 'video').length, 0);
});

test('a film pinned to the previous guidance gets a working fresh turn with retirement instructions', async t => {
  const f = await fixture(t), configuration = { repositoryRoot: process.cwd(), snapshotRoot: join(f.root, 'guidance') };
  const { lock } = createDirectorSkillLock(configuration, '0.3.0');
  const previous = { ...lock, id: randomUUID(), skills: [{ ...lock.skills[0],
    packageDigest: '44e04baebda8387188164e7e23742b1c8fd2f09579ae22ef7ec9c46e70d845bc' }] };
  assert.notEqual(previous.skills[0].packageDigest, CODE_PLAN_GUIDANCE_DIGEST);
  f.store.insert('director_skill_lock', previous.id, f.id, { id: previous.id, projectId: f.id, lock: previous });
  const human = f.service.beginRequest(f.id, 'local-user', 'Other story ideas, please', { editing: false });
  const bridge = f.service.openEpoch(f.id, human), turn = { id: randomUUID(), projectId: f.id, requestId: human.requestId };
  const input = codeDirectorInput(f.service, { ...configuration, endpoint: 'http://127.0.0.1:3107' }, turn, bridge);
  const context = JSON.parse(input.context), active = f.store.get('director_skill_lock', context.toolContract.lockId);
  assert.notEqual(active.id, previous.id); assert.equal(active.lock.skills[0].packageDigest, CODE_PLAN_GUIDANCE_DIGEST);
  assert.match(context.references.find(ref => ref.path === 'SKILL.md').content, /retire those cards first: submit the plan/);
  assert.equal(f.calls.submit.length, 0);
});
