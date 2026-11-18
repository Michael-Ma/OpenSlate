import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { CODE_PLAN_TOOL_CONTRACT, digest } from '@openslate/core';
import { directorSkillEnvironment } from '../dist/application/director-capabilities.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { cutListFindings, repeatedRowFindings } from '../dist/code-plan/cut-findings.js';
import { codePlanFixture } from './code-plan-e2e-fixture.mjs';

const cut = (seconds, proof) => ({ sees: 'A shadow crosses the sill', seconds, clip: 'opening', ...(proof === undefined ? {} : { proof }) });
const proof = ['The curtain rises', 'The shadow moves', 'The bell answers'];
const scene = (cuts = [], list = proof) => ({ cuts, proof: list });
const shape = { code: 'PROOF_SHAPE', detail: 'Write proof as a list of up to three sentences, and mark a cut with proof: 1, 2 or 3.' };
const unseen = detail => ({ code: 'PROOF_UNSEEN', detail });
const short = detail => ({ code: 'PROOF_SHORT', detail });
const cutsShape = { code: 'CUTS_SHAPE', detail: 'Use at most 64 cuts: an array of objects with string sees, positive number seconds and string clip.' };

for (const [name, scenes, expected] of [
  ['all three proofs above a third', [scene([cut(1, 1), cut(1, 2), cut(1, 3), cut(2)])], []],
  ['exactly a third is enough', [scene([cut(1, 1), cut(2)], ['The curtain rises'])], []],
  ['one missing takes precedence over a short duration', [scene([cut(1, 1), cut(1, 3), cut(10)])], [unseen('No cut shows proof 2.')]],
  ['two missing in list order', [scene([cut(1, 1)])], [unseen('No cut shows proofs 2 and 3.')]],
  ['no cuts field', [{ proof }], [unseen('No cut shows proofs 1, 2 and 3.')]],
  ['empty cuts', [scene()], [unseen('No cut shows proofs 1, 2 and 3.')]],
  ['4.5 seconds of 25, counting repeated marks', [scene([cut(1, 1), cut(1, 1), cut(1, 2), cut(1.5, 3), cut(20.5)])],
    [short('The cuts that show the proof total 4.5 of 25 seconds; the take needs at least a third of the film.')]],
  ['round both durations to two decimal places', [scene([cut(1.455, 1), cut(7.333)], ['The curtain rises'])],
    [short('The cuts that show the proof total 1.46 of 8.79 seconds; the take needs at least a third of the film.')]],
  ['legacy cuts without proof', [{ cuts: [cut(2)] }], []],
  ['orphan mark without proof', [{ cuts: [cut(1, 1)] }], [shape]],
  ['a list in another scene cannot supply an orphan mark', [{ cuts: [cut(1, 1)] }, scene([cut(1, 1)], ['The curtain rises'])], [shape]],
  ['the first proof uses its own cuts and ignores later proof lists', [scene([cut(1, 1)]), scene([cut(1, 2), cut(1, 3)], {})],
    [unseen('No cut shows proofs 2 and 3.')]],
  ['only the proof scene contributes to the ratio', [{ cuts: [cut(20)] }, scene([cut(1, 1)], ['The curtain rises'])], []],
  ['240 characters are accepted', [scene([cut(1, 1)], ['x'.repeat(240)])], []],
  ['malformed cuts suppress missing proof and mark validation', [scene([cut(0, 1), cut(1, 4)], proof)], [cutsShape]],
  ['malformed cuts with orphan mark report cuts shape only', [{ cuts: [cut(0, 1)] }], [cutsShape]],
  ['both shapes are malformed', [scene(null, [])], [cutsShape, shape]],
  ['the shared cut bound applies before proof coverage', [{ cuts: Array(64).fill(cut(1)) }, scene([cut(1, 1)])], [cutsShape]],
  ...[null, 'a sentence', [], [...proof, 'A fourth proof'], [''], ['  '], ['x'.repeat(241)], [1], Array(1)]
    .map((list, index) => [`bad proof list ${index + 1}`, [scene([cut(1, 1)], list)], [shape]]),
  ...[0, -1, 4, 1.5, '1', null].map(mark => [`bad mark ${JSON.stringify(mark)}`, [scene([cut(1, mark)])], [shape]]),
  ['a mark must fit the list, even below four', [scene([cut(1, 2)], ['The curtain rises'])], [shape]],
]) test(`proof advice: ${name}`, () => {
  assert.deepEqual(cutListFindings(scenes, []), expected);
});

test('malformed annotated cuts report shape only, while legacy cuts retain shot warnings', () => {
  const shots = [{ id: 'opening' }];
  assert.deepEqual(cutListFindings([{ cuts: null, proof }], shots), [cutsShape]);
  assert.deepEqual(cutListFindings([{ cuts: null }], shots), [cutsShape,
    { code: 'CUTS_UNUSED_SHOT', detail: 'No cut names these shots: opening.' }]);
});

const video = { kind: 'video', sha256: 'a'.repeat(64) };
const image = { kind: 'image', sha256: 'a'.repeat(64) };
const otherVideo = { kind: 'video', sha256: 'b'.repeat(64) };
const range = (startFrame, durationFrames, extra) => ({ artifact: video, startFrame, durationFrames, ...extra });
const still = (durationFrames, zoom) => ({ artifact: image, durationFrames, zoom });
const pigeon = [
  { artifact: otherVideo, durationFrames: 90 },
  range(57, 30), still(15, { scale: 1.4, x: 0.2 }),
  range(57, 30), still(15, { x: 0.2, scale: 1.4 }),
  range(57, 30), still(15, { scale: 1.4, x: 0.2 }),
  range(0, 30),
];
const repeat = (...sentences) => [{ code: 'ROW_REPEATED', detail: `${sentences.join(' ')} A repeat should change: closer, shorter or a different moment.` }];
const sameClip = 'Rows 1 and 2 show the same part of one clip.';
const sourceLengths = new Map([[`video:${video.sha256}`, { durationFrames: 30 }]]);

for (const [name, timeline, expected, sources = new Map()] of [
  ['pigeon timeline', pigeon, repeat('Rows 2, 4 and 6 show the same part of one clip.', 'Rows 3, 5 and 7 hold the same picture.')],
  ['disjoint ranges', [range(0, 30), range(30, 30)], []],
  ['still with different zoom', [still(15, { scale: 2 }), still(15, { scale: 1.4 })], []],
  ['changed framing', [range(0, 30), range(0, 30, { zoom: { scale: 2 } })], []],
  ['same picture regardless of row length', [still(1), still(30)], repeat('Rows 1 and 2 hold the same picture.')],
  ['same hash across artifact kinds', [range(0, 30), still(30)], []],
  ['different hashes', [range(0, 30), { artifact: otherVideo, durationFrames: 30 }], []],
  ['overlap of 20 of 30', [range(0, 30), range(10, 30)], repeat(sameClip)],
  ['overlap of 15 of 30', [range(0, 30), range(15, 30)], []],
  ['overlap of 10 of 30', [range(0, 30), range(20, 30)], []],
  ['overlap compares to the shorter range', [range(0, 80), range(10, 15)], repeat(sameClip)],
  ['transitive ranges join one group even out of timeline order', [range(0, 30), range(20, 30), range(10, 30)],
    repeat('Rows 1, 2 and 3 show the same part of one clip.')],
  ['bare and wrapped refs share content identity', [video, { artifact: { ...video, artifactId: 'copy' }, durationFrames: 30 }], repeat(sameClip), sourceLengths],
  ['unknown length skipped', [video, range(0, 30)], []],
  ['fit, speed and holds are outside the comparison', [range(0, 30), range(0, 30, { fit: 'cover', speed: 2, holdFrames: 10 })], repeat(sameClip)],
  ['shows at most three groups in timeline order', [0, 1, 2, 3].flatMap(x => [still(15, { scale: 2, x }), still(15, { scale: 2, x })]),
    repeat('Rows 1 and 2 hold the same picture.', 'Rows 3 and 4 hold the same picture.', 'Rows 5 and 6 hold the same picture.')],
  ['64th row is included', [range(0, 30), ...Array(62).fill(null), range(0, 30)], repeat('Rows 1 and 64 show the same part of one clip.')],
  ['comparison is bounded at 64 rows', [range(0, 30), ...Array(63).fill(null), range(0, 30)], []],
  ['opaque historical render input', undefined, []],
]) test(`repeat advice: ${name}`, () => {
  assert.deepEqual(repeatedRowFindings({ timeline }, sources), expected);
});

function film(scene, repeated) {
  return `export default async function(ctx) {
    await ctx.scene(${JSON.stringify({ id: 'room', ...scene })});
    await ctx.shot({ id:'opening' });
    const k = await ctx.keyframe('opening', { prompt: 'Sunlight on the sill', video: { durationSeconds: 6 } });
    if (!k.ok) return;
    const clip = await ctx.video({ ...k.input, shot: 'opening', prompt: 'A shadow crosses the sill', durationSeconds: 6 });
    if (!clip.ok) return;
    await ctx.render([0, 30, ${repeated ? 0 : 60}].map(startFrame => ({ artifact: clip.artifact, startFrame, durationFrames: 30 })));
  }`;
}

async function submitThroughTool(f, id, source) {
  const request = f.service.beginRequest(id, 'local-user', 'Edit the cut list');
  const { actor } = f.service.openEpoch(id, request);
  // Fixture for an already-bound turn. Exercise the current catalog and handler independently of guidance activation.
  const { compatibility, bindings } = directorSkillEnvironment({ snapshotRoot: f.root }, CODE_PLAN_TOOL_CONTRACT);
  const body = { schemaVersion: 1, id: randomUUID(), compatibility, bindings, skills: [], prompts: [] };
  const lock = { ...body, lockDigest: digest(body) };
  f.store.insert('director_skill_lock', lock.id, id, { id: lock.id, projectId: id, lock });
  f.store.insert('director_epoch_lock', actor.epochId, id, {
    id: actor.epochId, epochId: actor.epochId, projectId: id, requestId: actor.requestId, lockId: lock.id,
  });
  return new ToolInvocationService(f.service, { codePlans: f.runtime }).invoke(id, actor, 'save', 'submit_plan', {
    source, basedOnVersion: f.runtime.getRun(id)?.planVersion ?? null, summary: 'Edit the cut list',
  });
}

for (const repeated of [false, true]) test(`submit_plan preserves media and choice identity with ${repeated ? 'repeated' : 'distinct'} ranges`, async t => {
  const f = await codePlanFixture();
  t.after(() => f.close());
  const { id } = await f.create();
  const cuts = [cut(1), cut(1), cut(1)];
  const startingSource = film({ cuts }, repeated);
  const submit = source => submitThroughTool(f, id, source);
  const settled = () => f.until(id, view => view.state === 'done', 'rendered film');
  await submit(startingSource);
  const waiting = await f.until(id, view => view.choices.length > 0, 'keyframe choice');
  const { choiceId, optionsDigest, options } = waiting.choices[0];
  f.runtime.answer(id, { choiceId, optionsDigest, answer: options.find(choice => choice.keyframeInput === 'first_frame') });
  const before = await settled(), calls = structuredClone(f.calls.submit);

  const { diff: baseline } = await submit(startingSource);
  await settled();
  const repeatAdvice = repeated ? repeat('Rows 1 and 3 show the same part of one clip.') : [];
  assert.deepEqual(baseline.findings, repeatAdvice);
  assert.equal(baseline.reusedSteps, 3);
  const annotate = cuts => film({ obvious: 'The sun rises', proof, cuts }, repeated);
  const marked = cuts.map((row, index) => ({ ...row, proof: index + 1 }));
  for (const [source, findings] of [
    [annotate(marked), repeatAdvice],
    [annotate(cuts), [...repeatAdvice, unseen('No cut shows proofs 1, 2 and 3.')]],
  ]) {
    const { version, diff } = await submit(source);
    assert.deepEqual(diff, { ...baseline, findings });
    const after = await settled();
    assert.equal(after.planVersion, version);
    assert.deepEqual(after.versions[0].diff, diff);
    assert.deepEqual(after.steps.map(({ key, priceMicros }) => [key, priceMicros]), before.steps.map(({ key, priceMicros }) => [key, priceMicros]));
    assert.deepEqual(after.choices, before.choices);
    assert.deepEqual(f.calls.submit, calls);
  }
});
