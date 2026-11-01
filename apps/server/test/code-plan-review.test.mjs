import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadImage } from '@napi-rs/canvas';
import { codePlanFixture } from './code-plan-e2e-fixture.mjs';
import { readClipFrames } from '../dist/code-plan/clip-frames.js';
import { runMediaProcess } from '../dist/media/process.js';
import { triggerCodePlanRepairs } from '../dist/code-plan/director.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';

const identity = input => Object.fromEntries(['projectId', 'requestId', 'epochId', 'turnId'].map(key => [key, input[key]]));
const completed = input => ({ ...identity(input), status: 'completed', text: 'Reviewed', dispatched: true });
const plan = (take = 'one', extra = '') => `export default async function film(ctx) {
  const image = await ctx.image({ prompt: "review frame" }); if (!image.ok) return;
  const clip = await ctx.video({ firstFrame: image.artifact, motion: "Jump then land", durationSeconds: 6, variant: ${JSON.stringify(take)}, shot: "shot-1" }); if (!clip.ok) return;
  ${extra}
  await ctx.review("cut", { clips: [clip.artifact], note: "Watch the landing before cutting" });
  ctx.log("after review");
  await ctx.render([{ artifact: clip.artifact, startFrame: 0, durationFrames: 30 }]);
}`;
async function fixture(t) { const f = await codePlanFixture(); t.after(() => f.close()); const project = await f.create(); return { f, id: project.id }; }
const submit = (f, id, source) => f.runtime.submit(id, { source, basedOnVersion: f.runtime.getRun(id)?.planVersion ?? null, author: 'user', invocationId: `test-${f.runtime.getRun(id)?.planVersion ?? 0}` });
async function review(f, id) {
  for (let at = 0; at < 25; at++) { await f.runtime.tick(); if (f.runtime.getRun(id)?.state === 'reviewing') return f.runtime.view(id); }
  assert.fail(JSON.stringify(f.runtime.getRun(id)));
}
const purchases = f => f.calls.submit.filter(call => call.kind === 'image' || call.kind === 'video');

test('review stops execution, starts one fake turn, transports pictures, trims, replays and renders without another purchase', async t => {
  const { f, id } = await fixture(t);
  await submit(f, id, plan());
  const waiting = await review(f, id);
  assert.equal(waiting.reviews[0].state, 'waiting'); assert.equal(waiting.reviews[0].clipCount, 1);
  assert.ok(!waiting.logs.includes('after review')); assert.equal(waiting.steps.filter(step => step.kind === 'render').length, 0);
  const bought = purchases(f).length;
  const view = await f.until(id, view => view.state === 'done', 'reviewed render');
  assert.equal(view.planVersion, 2); assert.equal(view.reviews[0].state, 'done'); assert.ok(view.logs.includes('after review'));
  assert.equal(purchases(f).length, bought);
  const render = f.runtime.steps(id).find(step => step.kind === 'render');
  assert.equal(render.input.timeline[0].startFrame, 6); assert.equal(render.input.timeline[0].durationFrames, 21);
  const turns = f.store.list('code_plan_review_request', id); assert.equal(turns.length, 1);
  assert.equal(f.store.get('message', turns[0].requestId).source, 'app');
  const saved = f.store.list('tool_invocation', id).find(call => call.tool === 'read_clip_frames');
  assert.equal(saved.state, 'succeeded'); assert.equal(saved.result.frames.length, 2);
  assert.match(saved.result.sheet.sha256, /^[a-f0-9]{64}$/); assert.ok(saved.result.sheet.byteLength > 0);
  const entities = f.store.db.prepare('SELECT body FROM entities WHERE project_id=?').all(id);
  assert.ok(entities.every(row => !row.body.includes('"mimeType":"image/jpeg"') && !row.body.includes('/9j/')));
  for (let at = 0; at < 3; at++) await f.tick();
  assert.equal(f.store.list('code_plan_review_request', id).length, 1);
  const renderSheet = await readClipFrames(f.store, id, { artifactId: render.result.artifact.artifactId });
  assert.equal(renderSheet.metadata.stepKey, render.key, 'owned renders are watchable too');
  const edited = f.runtime.source(id, view.planVersion).source.replace('Watch the landing before cutting', 'Check the final landing');
  await submit(f, id, edited);
  const revised = await f.until(id, view => view.state === 'done', 'note-only edit');
  assert.equal(revised.reviews[0].note, 'Check the final landing');
  assert.equal(f.store.list('code_plan_review_request', id).length, 1); assert.equal(purchases(f).length, bought);
});

test('retakes get new review identities; only four turns are allowed and the fifth logs and continues', async t => {
  const { f, id } = await fixture(t); let turns = 0;
  f.director.fake.runtime.start = async input => { turns++; return completed(input); };
  for (let take = 1; take <= 5; take++) {
    await submit(f, id, plan(String(take)));
    const view = await f.until(id, view => view.state === 'done', `take ${take}`);
    assert.equal(view.reviews.length, 1, 'only the latest pass');
    if (take === 5) assert.equal(view.logs.filter(line => line.includes('all 4 review turns')).length, 1);
  }
  assert.equal(turns, 4); assert.equal(f.store.list('code_plan_review', id).length, 5);
  assert.equal(purchases(f).length, 6, 'one reused image and five videos');
});

test('a repeated read_clip_frames call rebuilds its image but keeps only one metadata receipt', async t => {
  const { f, id } = await fixture(t);
  f.director.fake.runtime.start = async input => {
    const clip = JSON.parse(input.context).review.clips[0], calls = new ToolInvocationService(f.service);
    const actor = f.service.actorForBridge(id, input.bridge.credential);
    const first = await calls.invoke(id, actor, 'watch-twice', 'read_clip_frames', { artifactId: clip.artifactId });
    const second = await calls.invoke(id, actor, 'watch-twice', 'read_clip_frames', { artifactId: clip.artifactId });
    assert.deepEqual(second, first);
    assert.equal(first.content[1].mimeType, 'image/jpeg');
    const rows = f.store.list('tool_invocation', id).filter(row => row.tool === 'read_clip_frames');
    assert.equal(rows.length, 1); assert.ok(!('content' in rows[0].result));
    assert.equal(rows[0].result.sheet.sha256, JSON.parse(first.content[0].text).sheet.sha256);
    return completed(input);
  };
  await submit(f, id, plan()); await f.until(id, view => view.state === 'done', 'read replay');
  assert.equal(purchases(f).length, 2);
});

test('already dispatched work keeps finishing while code after review stays stopped', async t => {
  const { f, id } = await fixture(t);
  await submit(f, id, plan('parallel', 'const background = ctx.image({prompt:"background work"});'));
  await review(f, id);
  for (let at = 0; at < 4; at++) await f.runtime.tick();
  const view = f.runtime.view(id);
  assert.equal(view.state, 'reviewing');
  assert.equal(view.steps.filter(step => step.kind === 'image' && step.state === 'succeeded').length, 2);
  assert.ok(!view.logs.includes('after review')); assert.equal(view.steps.filter(step => step.kind === 'render').length, 0);
});

for (const status of ['failed', 'unknown', 'interrupted', 'waiting_user']) test(`terminal review ${status} cannot leave the film stuck`, async t => {
  const { f, id } = await fixture(t); let turns = 0;
  f.director.fake.runtime.start = async (input, options) => {
    turns++;
    if (status === 'waiting_user') await options.onEvent({ ...identity(input), kind: 'pending_input', nativeRequestId: 'review-question', questions: [] });
    return { ...completed(input), status: status === 'waiting_user' ? 'completed' : status,
      ...(status === 'failed' || status === 'unknown' ? { error: { code: 'TEST_FAILURE', message: 'offline failure' } } : {}) };
  };
  await submit(f, id, plan());
  const view = await f.until(id, view => view.state === 'done', status);
  assert.equal(turns, 1);
  assert.equal(view.reviews[0].state, ['failed', 'unknown'].includes(status) ? 'failed' : 'done');
  if (view.reviews[0].state === 'failed') assert.equal(view.logs.filter(line => line.includes('failed; continuing')).length, 1);
});

test('restart retains waiting and queued review identity and never starts a second turn', async t => {
  const { f, id } = await fixture(t);
  await submit(f, id, plan()); await review(f, id);
  await f.restart();
  triggerCodePlanRepairs(f.service, (id, actor) => f.director.enqueue(id, actor));
  assert.equal(f.store.list('code_plan_review_request', id).length, 1);
  assert.equal(f.store.list('director_turn', id)[0].state, 'queued');
  await f.restart();
  await f.until(id, view => view.state === 'done', 'restart review');
  assert.equal(f.store.list('code_plan_review_request', id).length, 1);
  assert.equal(f.store.list('director_turn', id).length, 1);
});

test('an expired dispatched review becomes failed after restart without a replacement turn', async t => {
  const { f, id } = await fixture(t);
  await submit(f, id, plan()); await review(f, id);
  triggerCodePlanRepairs(f.service, (id, actor) => f.director.enqueue(id, actor));
  const turn = f.store.list('director_turn', id)[0];
  f.store.put('director_turn', turn.id, id, { ...turn, state: 'running', owner: 'lost-owner', leaseExpiresAt: 0, dispatched: true });
  await f.restart();
  const view = await f.until(id, view => view.state === 'done', 'expired review');
  assert.equal(view.reviews[0].state, 'failed'); assert.equal(f.store.list('code_plan_review_request', id).length, 1);
  assert.equal(purchases(f).length, 2);
});

test('a newer plan that removes a waiting checkpoint cannot start its obsolete review turn', async t => {
  const { f, id } = await fixture(t);
  await submit(f, id, plan()); await review(f, id);
  await submit(f, id, 'export default async function(ctx) { ctx.log("The person changed the plan"); }');
  assert.deepEqual(f.runtime.view(id).reviews, []);
  triggerCodePlanRepairs(f.service, () => assert.fail('obsolete review started'));
  await f.runtime.tick(); assert.equal(f.runtime.getRun(id).state, 'done');
  assert.equal(f.store.list('code_plan_review_request', id).length, 0);
});

test('paused and held reviews wait; a person turn and pending question take precedence', async t => {
  const { f, id } = await fixture(t);
  await submit(f, id, plan()); await review(f, id);
  f.runtime.hold(id, 'person-hold'); triggerCodePlanRepairs(f.service, () => assert.fail('held review started'));
  f.runtime.release(id, 'person-hold');
  f.engine.setPaused(id, true, 'local-user'); triggerCodePlanRepairs(f.service, () => assert.fail('paused review started'));
  f.engine.setPaused(id, false, 'local-user');
  const person = f.service.beginRequest(id, 'local-user', 'Please discuss the landing', { editing: false });
  const turn = f.director.enqueue(id, person);
  triggerCodePlanRepairs(f.service, () => assert.fail('person should go first'));
  f.director.fake.runtime.start = async input => {
    assert.equal(input.requestId, person.requestId);
    return completed(input);
  };
  f.director.tick(); await f.director.settle();
  assert.equal(f.store.get('director_turn', turn.id).state, 'completed');
  f.store.put('director_question', 'pending', id, { id: 'pending', requestId: person.requestId, state: 'pending' });
  triggerCodePlanRepairs(f.service, () => assert.fail('pending question'));
  const question = f.store.get('director_question', 'pending'); f.store.put('director_question', 'pending', id, { ...question, state: 'answered' });
  let started = 0; triggerCodePlanRepairs(f.service, () => { started++; }); assert.equal(started, 1);
});

test('review turns cannot borrow human words to change ceiling or retry; they may submit a retake within the ceiling', async t => {
  const { f, id } = await fixture(t);
  let attempts = 0;
  f.director.fake.runtime.start = async input => {
    const context = JSON.parse(input.context); assert.equal(context.review.clips[0].shot, 'shot-1');
    assert.match(input.text, /not the person speaking/); assert.equal(context.review.clips[0].durationFrames, 30);
    assert.ok(context.review.clips[0].width > 0 && context.review.clips[0].height > 0);
    const calls = new ToolInvocationService(f.service), actor = f.service.actorForBridge(id, input.bridge.credential);
    await assert.rejects(calls.invoke(id, actor, 'no-limit', 'set_spend_limit', { ceilingMicros: '100000000', quote: 'Retakes' }), { code: 'CODE_PLAN_PERSON_CONSENT_REQUIRED' });
    await assert.rejects(calls.invoke(id, actor, 'no-retry', 'retry_step', { stepKey: context.review.clips[0].stepKey, quote: 'Retakes' }), { code: 'CODE_PLAN_PERSON_CONSENT_REQUIRED' });
    if (++attempts === 1) await calls.invoke(id, actor, 'retake', 'submit_plan', { source: plan('replacement'), basedOnVersion: context.film.planVersion, summary: 'A retake within the saved ceiling' });
    return completed(input);
  };
  await submit(f, id, plan()); const view = await f.until(id, view => view.state === 'done', 'bounded retake');
  assert.equal(attempts, 2); assert.equal(view.ceilingMicros, '4000000'); assert.equal(purchases(f).length, 3);
});

test('foreign and non-video review artifacts are refused before a checkpoint is persisted', async t => {
  const { f, id } = await fixture(t), foreign = await f.create();
  for (const ref of [{ artifactId: 'foreign', kind: 'video', sha256: 'a'.repeat(64) }, { artifactId: 'image', kind: 'image', sha256: 'b'.repeat(64) }]) {
    f.store.put('artifact', ref.artifactId, ref.kind === 'video' ? foreign.id : id, { id: ref.artifactId, projectId: ref.kind === 'video' ? foreign.id : id, artifact: ref });
    await assert.rejects(submit(f, id, `export default async function(ctx) { await ctx.review('bad', {clips:[${JSON.stringify(ref)}], note:'bad'}); }`), { code: 'CODE_PLAN_REJECTED' });
  }
  assert.equal(f.store.list('code_plan_review', id).length, 0);
});

test('0.2.0 runs keep media step keys, have no ctx.review, and refuse read_clip_frames', async t => {
  const { f, id } = await fixture(t);
  const lock = createDirectorSkillLock({ repositoryRoot: process.cwd(), snapshotRoot: join(f.root, 'old-skills') }, '0.2.0').lock;
  f.store.put('director_skill_lock', lock.id, id, { id: lock.id, projectId: id, lock });
  const source = 'export default async function(ctx) { if (typeof ctx.review !== "undefined") throw Error("review leaked"); await ctx.image({prompt:"old image"}); }';
  await submit(f, id, source); await f.until(id, view => view.state === 'done', 'old film');
  const keys = f.runtime.view(id).steps.map(step => step.key), bought = purchases(f).length;
  await submit(f, id, source); await f.until(id, view => view.state === 'done', 'old replay');
  assert.deepEqual(f.runtime.view(id).steps.map(step => step.key), keys); assert.equal(purchases(f).length, bought);
  await assert.rejects(submit(f, id, 'export default async function(ctx) { await ctx.review("no",{clips:[],note:"no"}); }'), { code: 'CODE_PLAN_REJECTED' });
});

test('15-second 768x1344 clip produces labelled bounded JPEG and measured motion inside the 30-second bridge timeout', async t => {
  const { f, id } = await fixture(t), path = join(f.root, 'motion.mp4');
  const ffmpeg = process.env.OPENSLATE_FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
  await runMediaProcess(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=768x1344:r=30:d=15', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-pix_fmt', 'yuv420p', path], { cwd: f.root, timeoutMs: 30000 });
  const bytes = readFileSync(path), sha256 = createHash('sha256').update(bytes).digest('hex');
  const artifact = { artifactId: 'motion', kind: 'video', sha256 };
  f.store.put('artifact', 'motion', id, { id: 'motion', projectId: id, path, artifact, width: 768, height: 1344, physicalDurationSeconds: 15, fixture: false });
  const start = performance.now(), result = await readClipFrames(f.store, id, { artifactId: 'motion' });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 30000, `sheet took ${elapsed}ms`); t.diagnostic(`768x1344/15s sheet: ${Math.round(elapsed)} ms, ${result.metadata.sheet.byteLength} bytes`);
  const metadata = result.metadata; assert.equal(metadata.durationFrames, 450); assert.equal(metadata.frames.length, 30);
  assert.ok(metadata.frames.includes(120)); assert.equal(metadata.motion[0], 0); assert.ok(metadata.motion.some(value => value > 0));
  assert.ok(metadata.motion.every(value => value >= 0 && value <= 1)); assert.deepEqual(result.content.map(block => block.type), ['text', 'image']);
  const jpeg = Buffer.from(result.content[1].data, 'base64'), image = await loadImage(jpeg);
  assert.ok(Math.max(image.width, image.height) <= 2048); assert.ok(jpeg.length <= 1.5 * 1024 * 1024);
  assert.equal(createHash('sha256').update(jpeg).digest('hex'), metadata.sheet.sha256);
  writeFileSync('/tmp/q3-contact-sheet.jpg', jpeg);
  await assert.rejects(readClipFrames(f.store, id, { artifactId: 'motion', endFrame: 36, everyFrames: 1 }), error => error.code === 'CODE_PLAN_FRAME_LIMIT' && /everyFrames >= 2/.test(error.message));
  await assert.rejects(readClipFrames(f.store, id, { artifactId: 'motion', startFrame: 450 }), { code: 'CODE_PLAN_FRAME_RANGE' });
  await assert.rejects(readClipFrames(f.store, 'foreign-film', { artifactId: 'motion' }), { code: 'CODE_PLAN_ARTIFACT_INVALID' });
});
