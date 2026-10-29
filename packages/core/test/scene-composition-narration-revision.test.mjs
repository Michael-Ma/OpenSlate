import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compilePlan, composeScenePlan, DEFAULT_PROFILES, shotIntentDigest } from '../dist/index.js';

function fixture() {
  const shots = [0, 1].map(index => {
    const shot = { id: `shot-${index}`, revisionId: `shot-revision-${index}`, sceneId: 'scene', purpose: 'A short scene', action: 'Wait',
      framing: 'Wide', motion: 'Slow push', desiredFrames: 180, imagePrompt: `Frame ${index}`, videoPrompt: `Move ${index}`,
      referenceArtifactIds: [], cueId: null };
    return { ...shot, promptIntent: { image: shotIntentDigest(shot, 'image'), video: shotIntentDigest(shot, 'video') } };
  });
  const context = { project: { id: 'project', revisionId: 'project-before', headVersion: 1, name: 'Film', brief: 'A short film', story: '',
    scenes: [{ id: 'scene', revisionId: 'scene-revision', purpose: 'A short scene' }], narration: { script: '', source: 'undecided' },
    maxFrames: 10800, capabilityLockId: 'lock', shots, cues: [], artifacts: [], activePlanId: null },
  profiles: structuredClone(DEFAULT_PROFILES), logicalIds: {}, allocateId: randomUUID };
  let source = 'definePlan({baseRevision:"project-before"},p=>{';
  for (let index = 0; index < 2; index++) source += `const s${index}=p.shot("shot-${index}");`
    + `const i${index}=p.image("image-${index}",{intent:s${index},profile:"fake-image-v1",prompt:"Frame ${index}",width:256,height:256});`
    + `const g${index}=p.humanReview("gate-${index}",{shots:[{intent:s${index},keyframe:i${index},videoProfile:"fake-video-v1",motionPrompt:"Move ${index}",seconds:6}]});`
    + `const v${index}=p.video("video-${index}",{intent:s${index},profile:"fake-video-v1",firstFrame:p.approvedImage(i${index},g${index}),prompt:"Move ${index}",seconds:6});`;
  const base = compilePlan(source + 'return [v0,v1];});', context);
  context.project.revisionId = 'project-after'; context.project.shots[0].revisionId = 'narration-accepted';
  const selected = context.project.shots[1];
  Object.assign(selected, { revisionId: 'new-video-direction', motion: 'Track left', videoPrompt: 'Track left with the person' });
  selected.promptIntent.video = shotIntentDigest(selected, 'video');
  const operations = [{ shotId: selected.id, kind: 'video', profileId: 'fake-video-v1',
    nodeId: base.nodes.find(node => node.alias === 'video-1').id, frameNodeId: base.nodes.find(node => node.alias === 'image-1').id,
    frame: { artifactId: 'reviewed-frame', kind: 'image', sha256: 'a'.repeat(64) } }];
  return { context, base, operations };
}

test('a sibling narration-only revision preserves exact media while another shot gets its current video recipe', () => {
  const { context, base, operations } = fixture();
  const compiled = composeScenePlan(base, operations, context);
  for (const old of base.nodes.filter(node => node.shotId === 'shot-0')) {
    const current = compiled.nodes.find(node => node.id === old.id);
    assert.equal(current.shotRevisionId, 'narration-accepted');
    assert.deepEqual({ ...current, shotRevisionId: old.shotRevisionId }, old);
  }
  assert.deepEqual(compiled.gates.find(gate => gate.alias === 'gate-0'), base.gates.find(gate => gate.alias === 'gate-0'));
  assert.equal(compiled.nodes.find(node => node.alias === 'video-1').args.prompt, 'Track left with the person');
});

for (const field of ['motion', 'framing']) test(`a changed sibling ${field} specification remains outside the selected video authority`, () => {
  const { context, base, operations } = fixture(), sibling = context.project.shots[0];
  sibling[field] = 'Changed paid visual intent';
  sibling.promptIntent = { image: shotIntentDigest(sibling, 'image'), video: shotIntentDigest(sibling, 'video') };
  assert.throws(() => composeScenePlan(base, operations, context), { code: 'SCENE_PLAN_INVALID' });
});
