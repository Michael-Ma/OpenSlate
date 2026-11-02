import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compilePlan, composeScenePlan, DEFAULT_PROFILES, shotIntentDigest } from '@openslate/core';
import { projectFixture, sourceFor, refreshIntent } from './execution-fixture.mjs';
import { scenePlanCompositionProject } from '../dist/scene-plan-context.js';

function fixture({ cue = false, versioned = false, timeline = false, imagesOnly = false } = {}) {
  const original = projectFixture('project', 2);
  if (cue) {
    original.cues.push({ id: 'cue', meaning: 'Original words', durationFrames: 120, placementFrames: 0,
      audio: { artifactId: 'audio', sha256: 'a'.repeat(64), kind: 'audio' }, accepted: true, measured: true });
    original.shots[0].cueId = 'cue'; refreshIntent(original.shots[0], original.cues[0]);
  }
  const context = { project: original, profiles: structuredClone(DEFAULT_PROFILES), logicalIds: {}, allocateId: randomUUID };
  let source = sourceFor(original, imagesOnly);
  if (versioned) source = source.replace('p.shot("shot-0")', `p.shot(${JSON.stringify(`shot-0@${original.shots[0].revisionId}`)})`);
  if (timeline) source = source.replace('return [video0,video1];', 'const edit=p.timeline("timeline",{takes:[video0,video1]});return p.render("render",{timeline:edit});');
  const plan = compilePlan(source, context);
  const project = structuredClone(original); project.headVersion++; project.revisionId = randomUUID();
  for (const shot of project.shots) {
    shot.imagePrompt = `Accepted image for ${shot.id}`; shot.videoPrompt = `Accepted video for ${shot.id}`;
    shot.action = 'Accepted changed action'; shot.revisionId = randomUUID();
    refreshIntent(shot, project.cues.find(cue => cue.id === shot.cueId));
  }
  const history = [{ project: structuredClone(original) }], store = { list: () => history };
  const operations = [{ shotId: 'shot-1', kind: 'image', profileId: 'fake-image-v1', nodeId: plan.nodes.find(node => node.kind === 'image' && node.shotId === 'shot-1').id }];
  return { original, project, plan, context, history, store, operations };
}

test('composition uses proved historical siblings while preserving current selected direction and all original inputs', () => {
  const f = fixture(), original = structuredClone({ project: f.project, plan: f.plan, history: f.history });
  const project = scenePlanCompositionProject(f.project, f.plan, f.operations, () => f.history);
  assert.deepEqual(project.shots[0], f.original.shots[0]);
  assert.deepEqual(project.shots[1], f.project.shots[1]);
  const result = composeScenePlan(f.plan, f.operations, { ...f.context, project });
  assert.equal(result.nodes.find(node => node.kind === 'image' && node.shotId === 'shot-1').args.prompt, f.project.shots[1].imagePrompt);
  for (const node of f.plan.nodes.filter(node => node.shotId === 'shot-0')) assert.deepEqual(result.nodes.find(current => current.id === node.id), node);
  assert.deepEqual(result.gates.find(gate => gate.members.some(member => member.shotId === 'shot-0')), f.plan.gates.find(gate => gate.members.some(member => member.shotId === 'shot-0')));
  assert.deepEqual(f.project, original.project); assert.deepEqual(f.plan, original.plan); assert.deepEqual(f.history, original.history);
});

for (const corruption of ['missing', 'wrong prompt', 'wrong intent', 'video mismatch', 'foreign project']) test(`historical ${corruption} evidence cannot restore a picture recipe`, () => {
  const f = fixture();
  if (corruption === 'missing') f.history.length = 0;
  if (corruption === 'wrong prompt') f.history[0].project.shots[0].imagePrompt = 'An unproved prompt';
  if (corruption === 'wrong intent') f.history[0].project.shots[0].promptIntent.image = 'b'.repeat(64);
  if (corruption === 'video mismatch') f.history[0].project.shots[0].videoPrompt = 'A different video recipe';
  if (corruption === 'foreign project') f.history[0].project.id = 'another-project';
  assert.throws(() => scenePlanCompositionProject(f.project, f.plan, f.operations, () => f.history), { code: 'SCENE_PLAN_INVALID' });
});

test('a newer snapshot retaining a shot revision cannot replace exact saved prompt and intent proof', () => {
  const f = fixture(), newer = structuredClone(f.original);
  newer.headVersion++; newer.shots[0].videoPrompt = 'Newer narration-adjacent direction';
  f.history.unshift({ project: newer });
  assert.deepEqual(scenePlanCompositionProject(f.project, f.plan, f.operations, () => f.history).shots[0], f.original.shots[0]);
});

test('selected stale prompt intent stays refused and cannot borrow historical authorship', () => {
  const f = fixture(); f.project.shots[1].promptIntent.image = f.original.shots[1].promptIntent.image;
  const project = scenePlanCompositionProject(f.project, f.plan, f.operations, () => f.history);
  assert.equal(project.shots[1].promptIntent.image, f.original.shots[1].promptIntent.image);
  assert.notEqual(project.shots[1].promptIntent.image, shotIntentDigest(project.shots[1], 'image'));
  assert.throws(() => composeScenePlan(f.plan, f.operations, { ...f.context, project }), { code: 'STALE_PROMPT_INTENT' });
});

test('a saved historical cue is compilation-only and preserves an unselected video recipe', () => {
  const f = fixture({ cue: true });
  Object.assign(f.project.cues[0], { meaning: 'New accepted words', durationFrames: 150 });
  refreshIntent(f.project.shots[0], f.project.cues[0]);
  const project = scenePlanCompositionProject(f.project, f.plan, f.operations, () => f.history);
  assert.deepEqual(project.cues[0], f.original.cues[0]);
  assert.equal(f.project.cues[0].meaning, 'New accepted words');
  const result = composeScenePlan(f.plan, f.operations, { ...f.context, project });
  assert.deepEqual(result.nodes.find(node => node.kind === 'video' && node.shotId === 'shot-0'), f.plan.nodes.find(node => node.kind === 'video' && node.shotId === 'shot-0'));
});

test('a historical cue cannot overwrite a selected shot shared cue', () => {
  const f = fixture({ cue: true });
  Object.assign(f.project.cues[0], { meaning: 'Current selected words', durationFrames: 150 });
  f.project.shots[1].cueId = 'cue';
  for (const shot of f.project.shots) refreshIntent(shot, f.project.cues[0]);
  assert.throws(() => scenePlanCompositionProject(f.project, f.plan, f.operations, () => f.history), { code: 'SCENE_PLAN_INVALID' });
});


test('versioned historical shot references remain resolvable when only an unselected motion revision changed', () => {
  const f = fixture({ versioned: true, imagesOnly: true });
  Object.assign(f.project.shots[0], f.original.shots[0], { revisionId: randomUUID(), motion: 'New motion only', videoPrompt: 'New motion prompt' });
  refreshIntent(f.project.shots[0]);
  const project = scenePlanCompositionProject(f.project, f.plan, f.operations, () => f.history);
  assert.deepEqual(project.shots[0], f.original.shots[0]);
  assert.doesNotThrow(() => composeScenePlan(f.plan, f.operations, { ...f.context, project }));
});

test('historical sibling video and review stay exact when selected image changes its downstream timeline', () => {
  const f = fixture({ timeline: true });
  f.project.shots[1].desiredFrames = 240; refreshIntent(f.project.shots[1]);
  const project = scenePlanCompositionProject(f.project, f.plan, f.operations, () => f.history);
  const result = composeScenePlan(f.plan, f.operations, { ...f.context, project });
  for (const old of f.plan.nodes.filter(node => node.shotId === 'shot-0')) assert.deepEqual(result.nodes.find(node => node.id === old.id), old);
  assert.deepEqual(result.gates.find(gate => gate.members[0].shotId === 'shot-0'), f.plan.gates.find(gate => gate.members[0].shotId === 'shot-0'));
  assert.equal(result.nodes.find(node => node.kind === 'timeline').args.durationFrames, 420);
});
