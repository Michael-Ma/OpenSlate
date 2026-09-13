import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, compilePlan, compilePlanIsolated, composeTranscriptionPlan, composeTranscriptionPlanIsolated, DEFAULT_PROFILES,
  PLAN_LIMITS, shotIntentDigest } from '../dist/index.js';

const operation = () => ({ alias: 'uploaded-transcript', profileId: 'fake-transcription-v1', inputBindingId: 'draft-recording', language: 'auto' });
function fixture() {
  const context = { project: { id: 'project', revisionId: 'revision-1', headVersion: 1, name: 'Boots', brief: '', story: '', scenes: [],
    narration: { script: '', source: 'undecided' }, maxFrames: 10800, capabilityLockId: 'lock', shots: [], cues: [], artifacts: [], activePlanId: null },
    profiles: structuredClone(DEFAULT_PROFILES), logicalIds: {}, allocateId: randomUUID,
    transcriptionInputs: [{ id: 'draft-recording', digest: 'd'.repeat(64), consumerAlias: 'uploaded-transcript',
      artifact: { artifactId: 'owned-draft', kind: 'audio', sha256: 'a'.repeat(64) } }] };
  return context;
}
function videoFixture(shotCount = 2) {
  const context = fixture(); context.localExecution = { adapter: 'local-media', version: '1' };
  const refs = [], frames = [], reviews = [], takes = [];
  for (let i = 0; i < shotCount; i++) {
    const shot = { id: `shot-${i}`, revisionId: `shot-revision-${i}`, sceneId: 'scene', purpose: `Purpose ${i}`, action: 'Boot on a bench',
      framing: 'Close-up', motion: 'Slow push', desiredFrames: 180, imagePrompt: `Frame ${i}`, videoPrompt: `Move ${i}`, referenceArtifactIds: [], cueId: null,
      promptIntent: { image: '', video: '' } };
    shot.promptIntent.image = shotIntentDigest(shot, 'image'); shot.promptIntent.video = shotIntentDigest(shot, 'video'); context.project.shots.push(shot);
    refs.push(`const shot${i}=plan.shot(${JSON.stringify(shot.id)});`);
    frames.push(`const image${i}=plan.image("frame-${i}",{intent:shot${i},profile:"fake-image-v1",references:[],prompt:"Frame ${i}"});`);
    reviews.push(`const review${i}=plan.humanReview("review-${i}",{shots:[{intent:shot${i},keyframe:image${i},videoProfile:"fake-video-v1",motionPrompt:"Move ${i}",seconds:6}]});`);
    takes.push(`const video${i}=plan.video("take-${i}",{intent:shot${i},profile:"fake-video-v1",firstFrame:plan.approvedImage(image${i},review${i}),prompt:"Move ${i}",seconds:6});`);
  }
  const source = `definePlan({baseRevision:"revision-1"},plan=>{${refs.join('')}${frames.join('')}${reviews.join('')}${takes.join('')}
    const __openslate_transcription=plan.timeline("edit",{takes:[${Array.from({ length: shotCount }, (_, index) => `video${index}`).join(',')}],transition:"cut"});
    return plan.render("preview",{timeline:__openslate_transcription,format:"mp4"});});`;
  return { context, base: compilePlan(source, context) };
}
const detached = context => ({ ...structuredClone(Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'allocateId'))), allocateId: randomUUID });

test('null base creates only the owned transcription without canonical audio, script or acceptance', () => {
  const context = fixture(), before = canonical(context.project), result = composeTranscriptionPlan(null, operation(), context);
  assert.deepEqual(result.nodes.map(node => node.kind), ['transcription']); assert.deepEqual(result.gates, []);
  assert.deepEqual(result.nodes[0].applicationInput, { kind: 'owned_transcription', id: 'draft-recording', digest: 'd'.repeat(64) });
  assert.deepEqual(result.nodes[0].inputs[0].source.artifact, context.transcriptionInputs[0].artifact);
  assert.equal(canonical(context.project), before); assert.equal(context.project.artifacts.length, 0);
  assert.equal(result.nodes[0].args.language, 'auto'); assert.equal(result.nodes[0].args.timing, 'word');
  assert.equal(result.canonicalSource.split('\n').filter(line => line.includes('return')).length, 1);
  assert.equal(context.logicalIds['uploaded-transcript'], result.nodes[0].id);
});

test('full multi-shot plan composition preserves every prior node, review gate and original returned render', () => {
  const { context, base } = videoFixture(), saved = canonical(base), oldReturn = base.canonicalSource.split('\n').find(line => line.trim().startsWith('return'));
  context.project.revisionId = 'current-revision'; context.project.headVersion++;
  const result = composeTranscriptionPlan(base, operation(), context);
  assert.deepEqual(result.nodes.filter(node => node.alias !== 'uploaded-transcript'), base.nodes); assert.deepEqual(result.gates, base.gates);
  assert.equal(result.canonicalSource.split('\n').find(line => line.trim().startsWith('return')), oldReturn);
  assert.match(result.canonicalSource, /const __openslate_transcription_ = plan\.transcription/);
  assert.match(result.canonicalSource, /"baseRevision": "current-revision"/); assert.equal(canonical(base), saved);
  const roundtrip = compilePlan(result.canonicalSource, detached(context)); assert.deepEqual(roundtrip.nodes, result.nodes); assert.equal(roundtrip.graphDigest, result.graphDigest);
});

test('isolated and pure composition agree exactly with pinned logical IDs; original compile worker remains compatible', async () => {
  const { context, base } = videoFixture(); context.logicalIds['uploaded-transcript'] = 'known-transcription-id'; context.project.revisionId = 'current';
  const pure = composeTranscriptionPlan(base, operation(), detached(context)), isolated = await composeTranscriptionPlanIsolated(base, operation(), context);
  assert.deepEqual(isolated, pure); assert.ok(Object.isFrozen(isolated.nodes.find(node => node.alias === 'uploaded-transcript').applicationInput));
  assert.ok(Object.isFrozen(isolated.nodes.find(node => node.kind === 'render').args.localExecution));
  const ordinary = await compilePlanIsolated(isolated.canonicalSource, context); assert.deepEqual(ordinary.nodes, isolated.nodes); assert.equal(ordinary.graphDigest, isolated.graphDigest);
});

test('isolated composition preserves a complete 60-shot six-minute plan within the worker deadline', { timeout: 15000 }, async t => {
  const { context, base } = videoFixture(60); assert.equal(base.nodes.length, 122); assert.equal(base.gates.length, 60);
  assert.equal(base.nodes.find(node => node.kind === 'timeline').args.durationFrames, 10800);
  context.project.revisionId = 'next-six-minute-revision';
  const started = performance.now(), result = await composeTranscriptionPlanIsolated(base, operation(), context);
  t.diagnostic(`60 shots, 122 existing operations and 60 gates composed in ${(performance.now() - started).toFixed(1)} ms; worker deadline ${PLAN_LIMITS.timeoutMs} ms`);
  assert.equal(result.nodes.length, 123); assert.deepEqual(result.nodes.filter(node => node.alias !== 'uploaded-transcript'), base.nodes);
  assert.deepEqual(result.gates, base.gates);
  assert.equal(result.canonicalSource.split('\n').find(line => line.trim().startsWith('return')), base.canonicalSource.split('\n').find(line => line.trim().startsWith('return')));
});

test('saved aliases can be reconstructed into an empty caller map only after successful composition', async () => {
  const { context, base } = videoFixture(); context.logicalIds = {};
  const result = await composeTranscriptionPlanIsolated(base, operation(), context);
  for (const item of [...base.nodes, ...base.gates]) assert.equal(context.logicalIds[item.alias], item.id);
  assert.deepEqual(result.nodes.filter(node => node.alias !== 'uploaded-transcript'), base.nodes);
});

test('appending another recording preserves an existing owned transcription and requires its retained catalog binding', async () => {
  const context = fixture(), base = composeTranscriptionPlan(null, operation(), context), added = { ...operation(), alias: 'second-transcript', inputBindingId: 'second-recording' };
  context.transcriptionInputs.push({ id: added.inputBindingId, digest: 'e'.repeat(64), consumerAlias: added.alias,
    artifact: { artifactId: 'another-owned-draft', kind: 'audio', sha256: 'b'.repeat(64) } });
  const result = await composeTranscriptionPlanIsolated(base, added, context);
  assert.deepEqual(result.nodes.filter(node => node.alias !== added.alias), base.nodes); assert.equal(result.nodes.length, 2);
  assert.equal(result.canonicalSource.split('\n').find(line => line.trim().startsWith('return')), base.canonicalSource.split('\n').find(line => line.trim().startsWith('return')));
  context.transcriptionInputs.shift(); const before = canonical(context.logicalIds);
  await assert.rejects(composeTranscriptionPlanIsolated(base, { ...added, alias: 'third' }, context)); assert.equal(canonical(context.logicalIds), before);
});

test('alias conflicts, stale graph/source pairs and changed current shot inputs leave caller identities untouched', async () => {
  const cases = [
    ({ context }) => ({ op: { ...operation(), alias: 'preview' } }),
    ({ base }) => { base.nodes[0].args.prompt = 'Not the saved operation'; },
    ({ base }) => { base.graphDigest = 'f'.repeat(64); },
    ({ base }) => { base.gates[0].members[0].recipeDigest = 'f'.repeat(64); },
    ({ base }) => { base.canonicalSource = base.canonicalSource.replace('Frame 0', 'Changed canonical source'); },
    ({ context }) => { context.project.shots[0].action = 'Changed current action'; },
  ];
  for (const mutate of cases) {
    const f = videoFixture(), changed = mutate(f), before = canonical(f.context.logicalIds);
    assert.throws(() => composeTranscriptionPlan(f.base, changed?.op ?? operation(), f.context)); assert.equal(canonical(f.context.logicalIds), before);
    await assert.rejects(composeTranscriptionPlanIsolated(f.base, changed?.op ?? operation(), f.context)); assert.equal(canonical(f.context.logicalIds), before);
  }
});

test('unsupported original syntax cannot be laundered through the restricted printer', async () => {
  for (const change of [source => source.replace('plan.image(', 'plan.image?.('), source => source.replace('plan.image(', 'plan["image"]('),
    source => source.replace('baseRevision:', '["baseRevision"]:'), source => source.replace('const shot0=', 'const shot0: any=')]) {
    const { context, base } = videoFixture(); base.source = change(base.source); const before = canonical(context.logicalIds);
    assert.throws(() => composeTranscriptionPlan(base, operation(), context));
    await assert.rejects(composeTranscriptionPlanIsolated(base, operation(), context)); assert.equal(canonical(context.logicalIds), before);
  }
});

test('isolated composition uses captured source, operation, project, catalog and original abort signal', async () => {
  const { context, base } = videoFixture(), savedBase = structuredClone(base), op = operation(), expected = detached(context); expected.logicalIds[op.alias] = 'pinned-new-id'; context.logicalIds[op.alias] = 'pinned-new-id';
  const signal = new AbortController(), options = { signal: signal.signal };
  const pending = composeTranscriptionPlanIsolated(base, op, context, options);
  base.nodes[0].args.prompt = 'later mutation'; base.source = 'invalid'; op.alias = 'later-alias'; context.project.shots = [];
  context.transcriptionInputs[0].artifact.sha256 = 'b'.repeat(64); options.signal = new AbortController().signal;
  const result = await pending; assert.deepEqual(result, composeTranscriptionPlan(savedBase, operation(), expected));
  const cancelledContext = fixture(), controller = new AbortController(), cancellationOptions = { signal: controller.signal };
  const cancelled = composeTranscriptionPlanIsolated(null, operation(), cancelledContext, cancellationOptions);
  cancellationOptions.signal = new AbortController().signal; controller.abort();
  await assert.rejects(cancelled, { code: 'PLAN_COMPOSITION_CANCELLED' }); assert.deepEqual(cancelledContext.logicalIds, {});
});
test('cancelled, concurrently changed or replaced logical maps never receive a partial worker result', async () => {
  const preCancelled = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(composeTranscriptionPlanIsolated(null, operation(), preCancelled, { signal: controller.signal }), { code: 'PLAN_COMPOSITION_CANCELLED' });
  assert.deepEqual(preCancelled.logicalIds, {});
  for (const replace of [false, true]) {
    const context = fixture(), original = context.logicalIds, pending = composeTranscriptionPlanIsolated(null, operation(), context);
    if (replace) context.logicalIds = {}; else context.logicalIds.concurrent = 'another-id';
    await assert.rejects(pending, { code: 'REVISION_CONFLICT' }); assert.equal(Object.hasOwn(original, 'uploaded-transcript'), false);
    assert.equal(Object.hasOwn(context.logicalIds, 'uploaded-transcript'), false);
  }
  const frozen = fixture(); Object.preventExtensions(frozen.logicalIds);
  await assert.rejects(composeTranscriptionPlanIsolated(null, operation(), frozen), { code: 'REVISION_CONFLICT' }); assert.deepEqual(frozen.logicalIds, {});
});

test('accessors, proxies and oversized or deeply nested source are rejected without invoking caller code', async () => {
  let called = 0;
  const context = fixture(); Object.defineProperty(context, 'profiles', { enumerable: true, get() { called++; return []; } });
  await assert.rejects(composeTranscriptionPlanIsolated(null, operation(), context)); assert.equal(called, 0);
  const source = fixture(); source.project = new Proxy(source.project, { ownKeys() { called++; return []; } });
  await assert.rejects(composeTranscriptionPlanIsolated(null, operation(), source)); assert.equal(called, 0);
  const { context: bounded, base } = videoFixture(), ids = canonical(bounded.logicalIds);
  for (const text of ['x'.repeat(PLAN_LIMITS.sourceBytes + 1), '('.repeat(PLAN_LIMITS.depth + 1)]) {
    await assert.rejects(composeTranscriptionPlanIsolated({ ...base, source: text }, operation(), bounded), { code: 'PLAN_LIMIT' });
    assert.equal(canonical(bounded.logicalIds), ids);
  }
});
