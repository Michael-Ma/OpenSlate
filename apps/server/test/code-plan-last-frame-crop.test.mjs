import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonical } from '@openslate/core';
import { centerCropPng, describeViggleH3Request } from '@openslate/providers';
import { assertViggleH3ExecutionMapping } from '../dist/execution/viggle-h3-receipts.js';
import { assertViggleMappingAdmission, resolveViggleAdmission } from '../dist/execution/viggle-h3-authority.js';
import { assertViggleRecords } from '../dist/execution/viggle-h3-lineage.js';
import { viggleBackupClosure } from '../dist/persistence/viggle-backup.js';
import { realCodeFixture, imageSource, videoProfile } from './code-plan-providers-fixture.mjs';
import { pngBytes } from './viggle-h3-execution-fixture.mjs';

async function seed(t, firstSize = [320, 320], lastSize) {
  const f = await realCodeFixture(t, { videoSeconds: 6 });
  f.firstBytes = f.png = pngBytes(...firstSize);
  await f.submit(imageSource); await f.finish();
  f.first = f.plans.steps(f.project.id).find(step => step.kind === 'image').result.artifact;
  if (lastSize) {
    f.lastBytes = f.png = pngBytes(...lastSize);
    await f.submit(imageSource.replace('dawn', 'dusk')); await f.finish();
    f.last = f.plans.steps(f.project.id).filter(step => step.kind === 'image').at(-1).result.artifact;
  } else { f.last = f.first; f.lastBytes = f.firstBytes; }
  f.source = (aspect = '9:16', fields = `firstFrame:${JSON.stringify(f.first)},lastFrame:${JSON.stringify(f.last)}`) =>
    `export default async function(ctx){await ctx.video({model:'${videoProfile.id}',prompt:'The pose is the joke',durationSeconds:6,aspectRatio:'${aspect}',${fields}});}`;
  f.step = () => f.plans.steps(f.project.id).find(step => step.kind === 'video');
  f.attempt = () => f.store.get('attempt', f.step().attemptId);
  f.mapping = () => f.store.get('viggle_h3_execution_mapping', f.step().attemptId);
  f.bridge = () => f.mediaRuntime.registry.resolve({ adapter: 'viggle-h3', version: '1' });
  f.backup = () => viggleBackupClosure(f.store, async () => assert.fail('No output manifest read needed'), record => readFile(record.path)).records(f.step().attemptId);
  f.tamper = value => f.store.db.prepare("UPDATE entities SET body=? WHERE kind='viggle_h3_execution_mapping' AND id=?").run(canonical(value), value.id);
  return f;
}
const publicCrop = crop => crop && { sourceWidth: crop.sourceWidth, sourceHeight: crop.sourceHeight, width: crop.width, height: crop.height };

for (const aspect of ['9:16', '16:9']) for (const different of [false, true]) {
  test(`${aspect} crops ${different ? 'different source sizes independently' : 'the same source for both frames'} and replays after restart`, async t => {
    const f = await seed(t, [320, 320], different ? [640, 480] : undefined), source = f.source(aspect);
    await f.submit(source); await f.finish();
    const saved = f.mapping(), attempt = f.attempt();
    const first = centerCropPng(f.firstBytes, aspect), last = centerCropPng(f.lastBytes, aspect);
    assert.ok(first.crop); assert.ok(last.crop);
    assert.deepEqual(saved.firstFrameCrop, first.crop); assert.deepEqual(saved.lastFrameCrop, last.crop);
    for (const [name, expected, description] of [['first_frame_image', first, saved.transport.firstFrame], ['last_frame_image', last, saved.transport.lastFrame]]) {
      assert.deepEqual(Buffer.from(await f.form.get(name).arrayBuffer()), expected.bytes);
      assert.deepEqual([description.width, description.height], [expected.crop.width, expected.crop.height]);
      assert.equal(description.width * Number(aspect.split(':')[1]), description.height * Number(aspect.split(':')[0]));
    }
    assert.equal(saved.firstFrame.artifactId, f.first.artifactId); assert.equal(saved.lastFrame.artifactId, f.last.artifactId);
    assert.equal(attempt.request.inputs.length, different ? 2 : 1);
    assertViggleRecords(f.store, attempt.id);
    const detail = f.plans.stepDetail(f.project.id, f.step().key);
    assert.deepEqual(detail.call.firstFrameCrop, publicCrop(first.crop)); assert.deepEqual(detail.call.lastFrameCrop, publicCrop(last.crop));
    const identity = canonical(saved), calls = { ...f.calls };
    await f.restart();
    const prepared = await f.bridge().prepare(f.attempt());
    assert.deepEqual(describeViggleH3Request(prepared.request), saved.transport);
    assert.equal((await f.bridge().submit(f.attempt().request)).type, 'completed');
    await f.submit(source); await f.finish();
    assert.equal(canonical(f.mapping()), identity); assert.deepEqual(f.calls, calls); f.noGraph();
  });
}

for (const [name, firstSize, lastSize, firstCrop, lastCrop] of [
  ['both exact', [180, 320], [360, 640], false, false],
  ['only last needs crop', [180, 320], [640, 480], false, true],
  ['only first needs crop', [320, 320], [360, 640], true, false],
]) test(`${name}: exact-ratio frames retain their original bytes and omit crop facts`, async t => {
  const f = await seed(t, firstSize, lastSize); await f.submit(f.source()); await f.finish();
  const saved = f.mapping(), detail = f.plans.stepDetail(f.project.id, f.step().key);
  for (const [field, name, bytes, cropped] of [['firstFrameCrop', 'first_frame_image', f.firstBytes, firstCrop], ['lastFrameCrop', 'last_frame_image', f.lastBytes, lastCrop]]) {
    assert.equal(Object.hasOwn(saved, field), cropped); assert.equal(Object.hasOwn(detail.call, field), cropped);
    if (!cropped) assert.deepEqual(Buffer.from(await f.form.get(name).arrayBuffer()), bytes);
  }
  assertViggleRecords(f.store, f.attempt().id);
});

test('last-frame crop tampering or missing facts cannot validate, replay or bypass owned source checks', async t => {
  const f = await seed(t, [320, 320], [640, 480]); await f.submit(f.source()); await f.finish();
  const saved = f.mapping(), attempt = f.attempt(), crop = saved.lastFrameCrop;
  for (const changed of [
    { ...crop, recipe: 'center-crop-v2' }, { ...crop, width: crop.width - 1 },
    { ...crop, width: crop.width - 18, height: crop.height - 32 }, { ...crop, sourceHeight: 448 },
    { ...crop, left: 10 }, Object.fromEntries(Object.entries(crop).filter(([key]) => key !== 'sourceWidth')), null, undefined,
  ]) {
    const invalid = { ...saved, lastFrameCrop: changed };
    if (changed === undefined) delete invalid.lastFrameCrop;
    assert.throws(() => assertViggleH3ExecutionMapping(attempt, invalid));
    f.tamper(invalid); assert.throws(() => assertViggleRecords(f.store, attempt.id));
    await assert.rejects(f.bridge().submit(attempt.request));
  }
  // The geometry is still deterministic; only the owned artifact establishes the source size.
  const foreignSource = { ...saved, lastFrameCrop: { ...crop, sourceWidth: crop.sourceWidth + 2 } };
  assert.doesNotThrow(() => assertViggleH3ExecutionMapping(attempt, foreignSource));
  assert.throws(() => assertViggleMappingAdmission(resolveViggleAdmission(f.store, attempt.request, foreignSource), foreignSource), /image evidence/);
  f.tamper(foreignSource); assert.throws(() => assertViggleRecords(f.store, attempt.id));
  f.tamper(saved); assertViggleRecords(f.store, attempt.id); assert.equal(f.calls.video, 1);
});

test('last crop accessors are rejected without invoking either the field or nested accessors', async t => {
  const f = await seed(t); await f.submit(f.source()); await f.finish();
  const saved = f.mapping(); let invoked = false;
  const field = { ...saved }, crop = { ...saved.lastFrameCrop };
  Object.defineProperty(field, 'lastFrameCrop', { get() { invoked = true; return crop; } });
  assert.throws(() => assertViggleH3ExecutionMapping(f.attempt(), field)); assert.equal(invoked, false);
  Object.defineProperty(crop, 'width', { get() { invoked = true; return saved.lastFrameCrop.width; } });
  assert.throws(() => assertViggleH3ExecutionMapping(f.attempt(), { ...saved, lastFrameCrop: crop })); assert.equal(invoked, false);
});

for (const mode of ['reference', 'text', 'first_frame']) test(`${mode} rejects lastFrameCrop; reference images remain uncropped`, async t => {
  const f = await seed(t, [320, 320], [640, 480]);
  const fields = mode === 'reference' ? `references:${JSON.stringify([f.first, f.last])}` : mode === 'first_frame' ? `firstFrame:${JSON.stringify(f.first)}` : '';
  await f.submit(f.source('9:16', fields)); await f.finish();
  const saved = f.mapping(); assert.equal(Object.hasOwn(saved, 'lastFrameCrop'), false);
  const crop = centerCropPng(f.lastBytes, '9:16').crop;
  assert.throws(() => assertViggleH3ExecutionMapping(f.attempt(), { ...saved, lastFrameCrop: crop }));
  if (mode === 'reference') {
    assert.equal(Object.hasOwn(saved, 'firstFrameCrop'), false);
    const files = f.form.getAll('reference_image');
    assert.deepEqual(Buffer.from(await files[0].arrayBuffer()), f.firstBytes); assert.deepEqual(Buffer.from(await files[1].arrayBuffer()), f.lastBytes);
  }
});

test('an accepted cropped pair survives restart before polling and never repeats its POST', async t => {
  const f = await seed(t, [320, 320], [640, 480]);
  const bridge = f.bridge(), submit = bridge.submit.bind(bridge);
  bridge.submit = async (...args) => { await submit(...args); throw Error('Controlled lost local reply after persisted vendor acceptance'); };
  await f.submit(f.source()); await f.tick(); await f.execution.awaitIdle();
  assert.equal(f.attempt().phase, 'submission_unknown'); assert.ok(f.mapping().lastFrameCrop);
  const identity = canonical(f.mapping()); await f.restart(); await f.finish();
  assert.equal(f.step().state, 'succeeded'); assert.equal(canonical(f.mapping()), identity);
  assert.equal(f.calls.video, 1); assert.equal(f.calls.poll, 1); assertViggleRecords(f.store, f.attempt().id);
});

test('saved pre-Q2b receipts without lastFrameCrop retain their uncropped last upload and replay identity', async t => {
  const f = await seed(t, [320, 320], [640, 480]);
  const bridge = f.bridge(), prepare = bridge.prepare.bind(bridge);
  // Simulate the previous uploader before it saves any mapping or dispatch identity.
  bridge.prepare = async (...args) => {
    const prepared = await prepare(...args), record = f.store.get('artifact', f.last.artifactId);
    prepared.request.lastFrame = { bytes: f.lastBytes, sha256: f.last.sha256, width: record.width, height: record.height, byteLength: record.byteLength, mediaType: 'image/png' };
    delete prepared.lastFrameCrop; return prepared;
  };
  const source = f.source(); await f.submit(source); await f.finish();
  const saved = f.mapping(), identity = canonical(saved), calls = { ...f.calls };
  assert.ok(saved.firstFrameCrop); assert.equal(Object.hasOwn(saved, 'lastFrameCrop'), false);
  assert.deepEqual(Buffer.from(await f.form.get('last_frame_image').arrayBuffer()), f.lastBytes);
  assertViggleRecords(f.store, f.attempt().id); await f.backup();
  await f.restart(); assert.equal((await f.bridge().submit(f.attempt().request)).type, 'completed');
  await f.submit(source); await f.finish();
  assert.equal(canonical(f.mapping()), identity); assert.deepEqual(f.calls, calls); await f.backup();
});
