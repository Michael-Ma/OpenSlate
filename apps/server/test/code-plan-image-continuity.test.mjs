import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@openslate/core';
import { CODEX_IMAGE_LIMITS, describeCodexImageInput } from '@openslate/providers';
import { normalizeStepInput, stepKey } from '../dist/code-plan/identity.js';
import { codePlanProviderArgs } from '../dist/code-plan/provider-input.js';
import { modelDescriptions } from '../dist/code-plan/models.js';
import { readCodeFilm, wireCodePlans } from '../dist/code-plan/director.js';
import { assertImageReferenceRecords } from '../dist/execution/codex-image-plan.js';
import { realCodeFixture, imageSource, videoProfile } from './code-plan-providers-fixture.mjs';
import { codexImageProfile, codexApiProfile } from './codex-image-execution-fixture.mjs';
import { pngBytes } from './viggle-h3-execution-fixture.mjs';

const source = input => `export default async function(ctx){await ctx.image(${JSON.stringify(input)});}`;
const models = profile => ({ [profile.id]: { kind: 'image', profile, profileDefinitionDigest: digest(profile) } });

for (const [aspectRatio, width, height, aspect] of [
  ['9:16', 1024, 1536, '9:16'], ['16:9', 1536, 1024, '16:9'],
]) test(`${aspectRatio} dry run and fake Codex dispatch use the nearest real canvas`, async t => {
  const f = await realCodeFixture(t), inputs = [];
  const prepare = f.transport.prepare;
  f.transport.prepare = async input => { inputs.push(input); return prepare(input); };
  f.png = pngBytes(width, height);
  await f.restart();
  const plan = source({ prompt: 'The same quiet room', aspectRatio });
  const diff = await f.plans.dryRun(f.project.id, plan);
  assert.equal(diff.findings.length, 0); assert.equal(diff.newSteps.length, 1); assert.equal(f.calls.prepare, 0);
  await f.submit(plan); await f.finish();
  assert.equal(f.calls.start, 1); assert.equal(inputs.length, 1);
  assert.deepEqual([inputs[0].width, inputs[0].height, inputs[0].aspect], [width, height, aspect]);
  assert.equal(describeCodexImageInput(inputs[0]).policy, 'codex-image-turn-v2');
  const step = f.plans.steps(f.project.id)[0], result = f.store.get('artifact', step.result.artifact.artifactId);
  assert.equal(step.input.aspectRatio, aspectRatio); assert.deepEqual([result.width, result.height], [width, height]);
  await f.restart(); await f.tick(); assert.equal(f.calls.start, 1); f.noGraph();
});

for (const [aspectRatio, width, height] of [['1:1', 1024, 1024], ['2:3', 1024, 1536], ['3:2', 1536, 1024]])
  test(`${aspectRatio} maps to a supported Codex canvas without altering the profile`, () => {
    const input = normalizeStepInput('image', { model: codexImageProfile.id, prompt: 'Room', aspectRatio }, models(codexImageProfile));
    const args = codePlanProviderArgs(codexImageProfile, input);
    assert.deepEqual([args.width, args.height], [width, height]);
    assert.equal(args.profileDigest, codePlanProviderArgs(codexImageProfile, { prompt: 'Room' }).profileDigest);
  });

test('an unchanged prompt-only image keeps its original input, step key and completed work', async t => {
  const f = await realCodeFixture(t), plan = source({ prompt: 'A window at dawn' });
  const legacy = { model: codexImageProfile.id, prompt: 'A window at dawn', profileDefinitionDigest: digest(codexImageProfile) };
  assert.deepEqual(normalizeStepInput('image', { prompt: legacy.prompt }, f.execution.models(f.project.id)), legacy);
  await f.submit(plan); await f.finish();
  const original = f.plans.steps(f.project.id)[0];
  assert.equal(original.key, digest({ kind: 'image', input: legacy }));
  const diff = await f.plans.dryRun(f.project.id, plan);
  assert.equal(diff.newSteps.length, 0); assert.equal(diff.reusedSteps, 1);
  await f.submit(plan); await f.finish(); assert.equal(f.calls.start, 1);
  const explicit = normalizeStepInput('image', { prompt: legacy.prompt, aspectRatio: '1:1' }, f.execution.models(f.project.id));
  assert.notEqual(stepKey('image', explicit), original.key); f.noGraph();
});

test('Codex returned dimensions are measured rather than assumed from its canvas preference', async t => {
  const f = await realCodeFixture(t); f.png = pngBytes(941, 1672);
  await f.submit(source({ prompt: 'Portrait room', aspectRatio: '9:16' })); await f.finish();
  const step = f.plans.steps(f.project.id)[0], mapping = f.store.get('codex_image_execution_mapping', step.attemptId);
  assert.deepEqual([mapping.transport.width, mapping.transport.height], [1024, 1536]);
  const artifact = f.store.get('artifact', step.result.artifact.artifactId);
  assert.deepEqual([artifact.width, artifact.height], [941, 1672]); assert.equal(f.calls.start, 1);
});

test('eight ordered owned PNG references reach the fake native turn as local images', async t => {
  const f = await realCodeFixture(t), inputs = [];
  const prepare = f.transport.prepare;
  f.transport.prepare = async input => { inputs.push(input); return prepare(input); };
  await f.restart();
  const generated = [];
  for (let i = 0; i < 8; i++) {
    f.png = pngBytes(320 + i, 320);
    await f.submit(source({ prompt: `Reference ${i}` })); await f.finish();
    generated.push(f.plans.steps(f.project.id).find(row => row.input.prompt === `Reference ${i}`).result.artifact);
  }
  const references = [generated[4], generated[1], generated[7], generated[0], generated[6], generated[3], generated[5], generated[2]];
  const plan = source({ prompt: 'Reuse room and props', references, aspectRatio: '9:16' });
  const diff = await f.plans.dryRun(f.project.id, plan); assert.equal(diff.findings.length, 0);
  await f.submit(plan); await f.finish();
  assert.deepEqual(inputs.at(-1).images.map(image => image.sha256), references.map(ref => ref.sha256));
  assert.deepEqual(inputs.at(-1).images.map(image => image.artifactId), references.map(ref => ref.artifactId));
  assert.equal(inputs.at(-1).images.length, 8); f.noGraph();
});

for (const [name, change, message] of [
  ['nine references', ref => Array(9).fill(ref), /at most 8/],
  ['a video reference', ref => [{ ...ref, kind: 'video' }], /PNG image artifacts/],
  ['a foreign artifact with the same image hash', ref => [{ ...ref, artifactId: 'foreign-image' }], /owned by this film/],
  ['an unknown image hash', ref => [{ ...ref, sha256: 'f'.repeat(64) }], /owned by this film/],
  ['a non-array references field', ref => ref, /references: \[ownedImageArtifact/],
]) test(`dry run refuses ${name} before any admission`, async t => {
  const f = await realCodeFixture(t); await f.submit(imageSource); await f.finish();
  const ref = f.plans.steps(f.project.id)[0].result.artifact;
  const plan = source({ prompt: 'Keep room', references: change(ref) });
  const before = { ...f.calls }, count = f.execution.attempts(f.project.id).length;
  const diff = await f.plans.dryRun(f.project.id, plan);
  assert.equal(diff.newSteps.length, 0); assert.ok(diff.findings.some(row => message.test(row.detail)), JSON.stringify(diff));
  await assert.rejects(f.submit(plan), { code: 'CODE_PLAN_REJECTED' });
  assert.deepEqual(f.calls, before); assert.equal(f.execution.attempts(f.project.id).length, count); f.noGraph();
});

for (const [name, patch, message] of [
  ['JPEG metadata', { mimeType: 'image/jpeg' }, /validated PNG/],
  ['an oversized reference', { byteLength: CODEX_IMAGE_LIMITS.referenceBytes + 1 }, /at most 4 MiB/],
  ['oversized dimensions', { width: CODEX_IMAGE_LIMITS.dimension + 1 }, /4096px/],
]) test(`dry run refuses ${name} using shared reference limits`, async t => {
  const f = await realCodeFixture(t); await f.submit(imageSource); await f.finish();
  const ref = f.plans.steps(f.project.id)[0].result.artifact, record = f.store.get('artifact', ref.artifactId);
  // Corrupt only disposable fixture metadata; dispatch must never be needed to discover this.
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?").run(JSON.stringify({ ...record, ...patch }), record.id);
  const diff = await f.plans.dryRun(f.project.id, source({ prompt: 'Room', references: [ref] }));
  assert.equal(diff.newSteps.length, 0); assert.ok(diff.findings.some(row => message.test(row.detail)), JSON.stringify(diff));
  assert.equal(f.calls.start, 1);
});

test('dry run refuses a total reference payload over 24 MiB', async t => {
  const f = await realCodeFixture(t); await f.submit(imageSource); await f.finish();
  const ref = f.plans.steps(f.project.id)[0].result.artifact, record = f.store.get('artifact', ref.artifactId);
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?").run(JSON.stringify({ ...record, byteLength: CODEX_IMAGE_LIMITS.referenceBytes }), record.id);
  const diff = await f.plans.dryRun(f.project.id, source({ prompt: 'Room', references: Array(7).fill(ref) }));
  assert.ok(diff.findings.some(row => /24 MiB in total/.test(row.detail)), JSON.stringify(diff)); assert.equal(f.calls.start, 1);
  const bounded = { ...record, byteLength: CODEX_IMAGE_LIMITS.referenceBytes };
  assert.doesNotThrow(() => assertImageReferenceRecords(Array(6).fill(bounded), 'CODE_PLAN_INPUT'));
});

test('OpenAI image facts advertise only its pinned aspect and unsupported ratios fail dry run', async t => {
  const f = await realCodeFixture(t, { profiles: [codexApiProfile, videoProfile], configuration: { image: true } });
  wireCodePlans(f.service, f.plans);
  const model = readCodeFilm(f.service, f.project.id).models.find(row => row.id === codexApiProfile.id);
  assert.deepEqual(model.imageAspectRatios, ['1:1']); assert.equal(model.maxReferences, 8);
  for (const aspectRatio of ['9:16', '16:9', '4:3']) {
    const diff = await f.plans.dryRun(f.project.id, source({ model: codexApiProfile.id, prompt: 'Room', aspectRatio }));
    assert.ok(diff.findings.some(row => /accepts image aspectRatio: 1:1/.test(row.detail)), JSON.stringify(diff));
  }
  const diff = await f.plans.dryRun(f.project.id, source({ model: codexApiProfile.id, prompt: 'Room', aspectRatio: '1:1' }));
  assert.equal(diff.findings.length, 0); assert.equal(f.execution.attempts(f.project.id).length, 0);
  const portrait = { ...codexApiProfile, configuration: { ...codexApiProfile.configuration, settings: { ...codexApiProfile.configuration.settings, width: 1024, height: 1536 } } };
  assert.deepEqual(modelDescriptions(models(portrait))[0].imageAspectRatios, ['2:3']);
  assert.deepEqual([codePlanProviderArgs(portrait, { prompt: 'Room', aspectRatio: '2:3' }).width, codePlanProviderArgs(portrait, { prompt: 'Room', aspectRatio: '2:3' }).height], [1024, 1536]);
});

test('Codex refuses unsupported ratios and conflicting dimensions at plan time with a repair message', async t => {
  const f = await realCodeFixture(t);
  for (const [input, message] of [
    [{ aspectRatio: '4:3' }, /accepts image aspectRatio/],
    [{ aspectRatio: '9:16', width: 941, height: 1672 }, /explicit dimensions must match/],
    [{ width: 1024, height: 1536 }, /Use aspectRatio/],
  ]) {
    const diff = await f.plans.dryRun(f.project.id, source({ prompt: 'Room', ...input }));
    assert.equal(diff.newSteps.length, 0); assert.ok(diff.findings.some(row => message.test(row.detail)), JSON.stringify(diff));
  }
  assert.equal(f.calls.start, 0); assert.equal(f.execution.attempts(f.project.id).length, 0);
});

test('read_film lists image ratios and reference limits, with no executable validation data', async t => {
  const f = await realCodeFixture(t); wireCodePlans(f.service, f.plans);
  const rows = readCodeFilm(f.service, f.project.id).models, image = rows.find(row => row.id === codexImageProfile.id);
  assert.deepEqual(image.imageAspectRatios, ['1:1', '2:3', '3:2', '9:16', '16:9']); assert.equal(image.maxReferences, 8);
  assert.equal(Object.hasOwn(image, 'validateImageReferences'), false);
  assert.equal(Object.hasOwn(rows.find(row => row.id === videoProfile.id), 'imageAspectRatios'), false);
  const unknown = { ...codexApiProfile, adapter: 'other-image' };
  assert.equal(modelDescriptions(models(unknown))[0].maxReferences, 0);
});
