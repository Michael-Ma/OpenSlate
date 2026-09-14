import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { canonical, compilePlan, compilePlanIsolated, composeSpeechPlan, composeSpeechPlanIsolated, DEFAULT_PROFILES,
  PLAN_LIMITS, SPEECH_COMPOSITION_LIMITS, shotIntentDigest } from '../dist/index.js';

const operation = () => ({ alias: 'section-recording', profileId: 'fake-speech-v1', text: 'A considered line.\nAnd its exact ending.', voice: 'coral', instructions: '' });
function fixture() {
  return { project: { id: 'project', revisionId: 'revision-1', headVersion: 1, name: 'Boots', brief: '', story: '', scenes: [],
    narration: { script: '', source: 'undecided' }, maxFrames: 10800, capabilityLockId: 'lock', shots: [], cues: [], artifacts: [], activePlanId: null },
    profiles: structuredClone(DEFAULT_PROFILES), logicalIds: {}, allocateId: randomUUID };
}
function mixedFixture() {
  const context = fixture(); context.localExecution = { adapter: 'local-media', version: '1' };
  context.transcriptionInputs = [{ id: 'existing-recording', digest: 'd'.repeat(64), consumerAlias: 'existing-transcript',
    artifact: { artifactId: 'owned-existing-take', kind: 'audio', sha256: 'a'.repeat(64) } }];
  const declarations = [], takes = [];
  for (let i = 0; i < 6; i++) {
    const shot = { id: `shot-${i}`, revisionId: `shot-revision-${i}`, sceneId: 'scene', purpose: `Purpose ${i}`, action: 'Boot on a bench',
      framing: 'Close-up', motion: 'Slow push', desiredFrames: 180, imagePrompt: `Frame ${i}`, videoPrompt: `Move ${i}`, referenceArtifactIds: [], cueId: null,
      promptIntent: { image: '', video: '' } };
    shot.promptIntent.image = shotIntentDigest(shot, 'image'); shot.promptIntent.video = shotIntentDigest(shot, 'video'); context.project.shots.push(shot);
    declarations.push(`const shot${i}=plan.shot("shot-${i}");const image${i}=plan.image("frame-${i}",{intent:shot${i},profile:"fake-image-v1",references:[],prompt:"Frame ${i}"});`,
      `const review${i}=plan.humanReview("review-${i}",{shots:[{intent:shot${i},keyframe:image${i},videoProfile:"fake-video-v1",motionPrompt:"Move ${i}",seconds:6}]});`,
      `const video${i}=plan.video("take-${i}",{intent:shot${i},profile:"fake-video-v1",firstFrame:plan.approvedImage(image${i},review${i}),prompt:"Move ${i}",seconds:6});`);
    takes.push(`video${i}`);
  }
  const source = `definePlan({baseRevision:"revision-1"},plan=>{${declarations.join('')}
    const oldAudio=plan.speech("existing-speech",{profile:"fake-speech-v1",text:"Earlier take",voice:"alloy"});
    const oldTranscript=plan.transcription("existing-transcript",{profile:"fake-transcription-v1",audio:plan.transcriptionInput("existing-recording"),language:"auto",timing:"word"});
    const __openslate_speech=plan.timeline("edit",{takes:[${takes.join(',')}],transition:"cut"});
    return plan.render("preview",{timeline:__openslate_speech,format:"mp4"});});`;
  return { context, base: compilePlan(source, context) };
}
const detached = context => ({ ...structuredClone(Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'allocateId'))), allocateId: randomUUID });
const returned = plan => plan.canonicalSource.split('\n').find(line => line.trim().startsWith('return'));

test('null base appends one exact speech operation without changing project narration or manufacturing authority', () => {
  const context = fixture(), before = canonical(context.project), op = operation(), result = composeSpeechPlan(null, op, context);
  assert.equal(result.nodes.length, 1); assert.equal(result.nodes[0].kind, 'speech'); assert.equal(result.nodes[0].shotId, null);
  assert.deepEqual(result.gates, []); assert.deepEqual(result.nodes[0].inputs, []); assert.equal(Object.hasOwn(result.nodes[0], 'applicationInput'), false);
  assert.equal(result.nodes[0].args.text, op.text); assert.equal(result.nodes[0].args.voice, op.voice); assert.equal(result.nodes[0].args.instructions, '');
  assert.deepEqual(result.nodes[0].args.settings, {}); assert.equal(canonical(context.project), before);
  assert.equal(context.logicalIds[op.alias], result.nodes[0].id); assert.equal(result.canonicalSource.includes('"instructions"'), false);
});

test('empty instructions preserve exact existing compiler bytes and nonempty instructions stay literal', () => {
  for (const instructions of ['', '  Softly.\nNo rewritten words.  ']) {
    const context = fixture(), op = { ...operation(), instructions, text: '  Quotes "here", café, 字, 😀.\nconst x = "not code";  ' };
    context.logicalIds[op.alias] = 'fixed-speech-id';
    const expectedSource = `definePlan({baseRevision:"revision-1"},p=>{return p.speech(${JSON.stringify(op.alias)},{profile:${JSON.stringify(op.profileId)},text:${JSON.stringify(op.text)},voice:${JSON.stringify(op.voice)}${instructions === '' ? '' : ',instructions:' + JSON.stringify(instructions)},settings:{}});});`;
    const expected = compilePlan(expectedSource, detached(context)), composed = composeSpeechPlan(null, op, context);
    assert.deepEqual(composed.nodes, expected.nodes); assert.equal(composed.graphDigest, expected.graphDigest); assert.equal(composed.canonicalSource, expected.canonicalSource);
    assert.equal(composed.nodes[0].args.text, op.text); assert.equal(composed.nodes[0].args.instructions, instructions);
  }
});

test('mixed six-shot plan preserves all sixteen old nodes, six reviews, local execution and owned transcription identity', async () => {
  const { context, base } = mixedFixture(), saved = canonical(base), beforeProject = canonical(context.project);
  assert.equal(base.nodes.length, 16); assert.equal(base.gates.length, 6);
  context.project.revisionId = 'new-publication-revision'; context.project.headVersion++;
  const result = await composeSpeechPlanIsolated(base, operation(), context);
  assert.equal(result.nodes.length, 17); assert.deepEqual(result.nodes.filter(node => node.alias !== operation().alias), base.nodes);
  assert.deepEqual(result.gates, base.gates); assert.equal(returned(result), returned(base)); assert.equal(canonical(base), saved);
  assert.match(result.canonicalSource, /const __openslate_speech_ = plan\.speech/);
  assert.match(result.canonicalSource, /"baseRevision": "new-publication-revision"/);
  assert.ok(Object.isFrozen(result.nodes.find(node => node.kind === 'render').args.localExecution));
  assert.ok(Object.isFrozen(result.nodes.find(node => node.alias === 'existing-transcript').applicationInput));
  const expectedProject = JSON.parse(beforeProject); expectedProject.revisionId = context.project.revisionId; expectedProject.headVersion++;
  assert.equal(canonical(context.project), canonical(expectedProject));
});

test('pure and isolated append agree exactly and ordinary compiler worker retains its old path', async () => {
  const { context, base } = mixedFixture(); context.logicalIds[operation().alias] = 'new-fixed-speech-id';
  const pure = composeSpeechPlan(base, operation(), detached(context));
  const isolated = await composeSpeechPlanIsolated(base, operation(), context); assert.deepEqual(isolated, pure);
  const ordinary = await compilePlanIsolated(isolated.canonicalSource, context);
  assert.deepEqual(ordinary.nodes, isolated.nodes); assert.deepEqual(ordinary.gates, isolated.gates); assert.equal(ordinary.graphDigest, isolated.graphDigest);
});

test('empty caller alias map reconstructs retained identities only after a successful append', async () => {
  const { context, base } = mixedFixture(); context.logicalIds = {};
  const result = await composeSpeechPlanIsolated(base, operation(), context);
  for (const item of [...base.nodes, ...base.gates]) assert.equal(context.logicalIds[item.alias], item.id);
  assert.deepEqual(result.nodes.filter(node => node.alias !== operation().alias), base.nodes);
});

test('an additional speech take preserves the earlier take without replacing its return', async () => {
  const context = fixture(), base = composeSpeechPlan(null, operation(), context), op = { ...operation(), alias: 'another-take', text: 'Changed words for another take.' };
  const result = await composeSpeechPlanIsolated(base, op, context);
  assert.equal(result.nodes.length, 2); assert.deepEqual(result.nodes.find(node => node.alias === operation().alias), base.nodes[0]); assert.equal(returned(result), returned(base));
});

test('stale graph, canonical source, reviews, current inputs or aliases fail without modifying caller identities', async () => {
  const changes = [
    ({ base }) => { base.graphDigest = 'f'.repeat(64); },
    ({ base }) => { base.nodes[0].args.prompt = 'Forged cached prompt'; },
    ({ base }) => { base.gates[0].members[0].recipeDigest = 'f'.repeat(64); },
    ({ base }) => { base.canonicalSource = base.canonicalSource.replace('Frame 0', 'Changed canonical source'); },
    ({ context }) => { context.project.shots[0].action = 'Changed meaning'; },
    ({ context }) => { context.transcriptionInputs[0].artifact.sha256 = 'b'.repeat(64); },
    ({ context }) => { context.transcriptionInputs = []; },
    f => { f.op.alias = 'review-0'; },
    f => { f.op.profileId = 'fake-image-v1'; },
    ({ context }) => { context.logicalIds.preview = 'different-render'; },
  ];
  for (const change of changes) {
    const f = { ...mixedFixture(), op: operation() }; change(f); const before = canonical(f.context.logicalIds);
    assert.throws(() => composeSpeechPlan(f.base, f.op, f.context)); assert.equal(canonical(f.context.logicalIds), before);
    await assert.rejects(composeSpeechPlanIsolated(f.base, f.op, f.context)); assert.equal(canonical(f.context.logicalIds), before);
  }
});

test('unsupported saved syntax cannot be laundered by reprinting its AST', async () => {
  for (const change of [source => source.replace('plan.image(', 'plan.image?.('), source => source.replace('plan.image(', 'plan["image"]('),
    source => source.replace('baseRevision:', '["baseRevision"]:'), source => source.replace('const shot0=', 'const shot0: any=')]) {
    const { context, base } = mixedFixture(), before = canonical(context.logicalIds); base.source = change(base.source);
    await assert.rejects(composeSpeechPlanIsolated(base, operation(), context)); assert.equal(canonical(context.logicalIds), before);
  }
});

test('caller mutations cannot replace the captured project, operation, profile, owned inputs or original signal', async () => {
  const { context, base } = mixedFixture(), op = operation(); context.logicalIds[op.alias] = 'new-pinned-id';
  const savedBase = structuredClone(base), savedOperation = structuredClone(op), savedContext = detached(context), controller = new AbortController(), replacement = new AbortController();
  const options = { signal: controller.signal }, pending = composeSpeechPlanIsolated(base, op, context, options);
  base.source = 'changed'; base.nodes[0].args.prompt = 'changed'; op.text = 'rewritten'; op.instructions = 'later instructions'; op.voice = 'different';
  context.project.shots = []; context.profiles.length = 0; context.transcriptionInputs[0].artifact.sha256 = 'c'.repeat(64); context.localExecution.version = '2';
  options.signal = replacement.signal; replacement.abort();
  assert.deepEqual(await pending, composeSpeechPlan(savedBase, savedOperation, savedContext));
});

test('original cancellation before or during worker work adds no logical identities', async () => {
  for (const initiallyAborted of [true, false]) {
    const context = fixture(), original = new AbortController(), options = { signal: original.signal };
    if (initiallyAborted) original.abort();
    const pending = composeSpeechPlanIsolated(null, operation(), context, options); options.signal = new AbortController().signal; original.abort();
    await assert.rejects(pending, { code: 'PLAN_COMPOSITION_CANCELLED' }); assert.deepEqual(context.logicalIds, {});
  }
});

test('cancellation arriving while the completed worker closes still prevents publication and ID merge', async () => {
  const terminate = Worker.prototype.terminate, original = new AbortController(), context = fixture(); let completedClose = false;
  Worker.prototype.terminate = async function () { const code = await terminate.call(this); completedClose = true; original.abort(); return code; };
  try {
    await assert.rejects(composeSpeechPlanIsolated(null, operation(), context, { signal: original.signal }), { code: 'PLAN_COMPOSITION_CANCELLED' });
    assert.equal(completedClose, true); assert.deepEqual(context.logicalIds, {});
  } finally { Worker.prototype.terminate = terminate; }
});

test('changed, replaced or nonextensible identity maps never receive a partial completed plan', async () => {
  for (const change of ['edit', 'replace', 'freeze']) {
    const context = fixture(), original = context.logicalIds, pending = composeSpeechPlanIsolated(null, operation(), context);
    if (change === 'edit') original.concurrent = 'later-id'; else if (change === 'replace') context.logicalIds = {}; else Object.preventExtensions(original);
    await assert.rejects(pending, { code: 'REVISION_CONFLICT' });
    assert.equal(Object.hasOwn(original, operation().alias), false); assert.equal(Object.hasOwn(context.logicalIds, operation().alias), false);
  }
});

test('operation, context and options require plain own data without running getters, proxies or allocators', async () => {
  let invoked = 0; const getter = () => { invoked++; throw Error('must not evaluate'); };
  const cases = [
    f => { Object.defineProperty(f.op, 'text', { enumerable: true, get: getter }); },
    f => { Object.defineProperty(f.context, 'profiles', { enumerable: true, get: getter }); },
    f => { Object.defineProperty(f.options, 'signal', { enumerable: true, get: getter }); },
    f => { f.context.project = new Proxy(f.context.project, { ownKeys: getter }); },
    f => { f.op = new Proxy(f.op, { getPrototypeOf: getter }); },
    f => { Object.defineProperty(f.context.profiles[0], 'kind', { enumerable: true, get: getter }); },
    f => { f.op.extra = true; }, f => { f.op.instructions = null; }, f => { f.op.voice = ''; },
    f => { f.op.text = 'broken\ud800'; }, f => { f.op.instructions = 'broken\udfff'; },
  ];
  for (const change of cases) {
    const f = { context: fixture(), op: operation(), options: {} }; f.context.allocateId = getter; change(f);
    await assert.rejects(composeSpeechPlanIsolated(null, f.op, f.context, f.options)); assert.deepEqual(f.context.logicalIds, {});
  }
  assert.equal(invoked, 0);
});

test('byte and structural bounds reject before caller identities can be changed', async () => {
  const cases = [
    f => { f.op.text = 'a'.repeat(SPEECH_COMPOSITION_LIMITS.payloadBytes + 1); },
    f => { f.op.alias = 'a'.repeat(257); },
    f => { f.base.source = 'x'.repeat(PLAN_LIMITS.sourceBytes + 1); },
    f => { f.base.source = '('.repeat(PLAN_LIMITS.depth + 1); },
    f => { let nested = {}; for (let i = 0; i < SPEECH_COMPOSITION_LIMITS.depth + 1; i++) nested = { child: nested }; f.context.project.extra = nested; },
  ];
  for (const change of cases) {
    const f = { ...mixedFixture(), op: operation() }; change(f); const before = canonical(f.context.logicalIds);
    await assert.rejects(composeSpeechPlanIsolated(f.base, f.op, f.context)); assert.equal(canonical(f.context.logicalIds), before);
  }
});
