import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compilePlan, DEFAULT_PROFILES, planSourceBaseRevision, rebaseNarrationPlanIsolated, shotIntentDigest } from '../dist/index.js';
function fixture({ explicitNarration = false, externalMusic = false } = {}) {
  const image = { artifactId: 'reference', kind: 'image', sha256: 'a'.repeat(64) }, oldAudio = { artifactId: 'old-audio', kind: 'audio', sha256: 'b'.repeat(64) }, music = { artifactId: 'music', kind: 'audio', sha256: 'c'.repeat(64) };
  const shot = { id: 'shot', revisionId: 'shot-r0', sceneId: 'scene', purpose: 'Leather boots', action: 'Boot on table', framing: 'Wide', motion: 'Push', desiredFrames: 180, imagePrompt: 'Leather boot', videoPrompt: 'Slow push', referenceArtifactIds: [image.artifactId], cueId: explicitNarration ? 'old-cue' : null, narration: { mode: explicitNarration ? 'uploaded' : 'none', text: '', voice: 'stock' }, ...(explicitNarration ? { narrationTimingMode: 'within_shot' } : {}) };
  const oldCue = { id: 'old-cue', meaning: 'An old voice', durationFrames: 30, placementFrames: 0, accepted: true, measured: true, audio: oldAudio };
  const before = { id: 'project', revisionId: 'revision-before', headVersion: 0, name: 'Movie', brief: 'Boots', story: 'A reveal', scenes: [{ id: 'scene', revisionId: 'scene-r0', purpose: 'Product' }], narration: { script: '', source: 'undecided' }, shots: [shot], cues: explicitNarration ? [oldCue] : [], artifacts: [image, oldAudio, music], activePlanId: null, maxFrames: 10800, capabilityLockId: 'lock' };
  shot.promptIntent = { image: shotIntentDigest(shot, 'image'), video: shotIntentDigest(shot, 'video', before.cues[0]) };
  const source = `definePlan({baseRevision:"revision-before"},p=>{const s=p.shot("shot@shot-r0");const frame=p.image("frame",{intent:s,profile:"fake-image-v1",prompt:"Leather boot",references:[p.asset("reference")]});const gate=p.humanReview("gate",{shots:[{intent:s,keyframe:frame,videoProfile:"fake-video-v1",motionPrompt:"Slow push",seconds:6}]});const clip=p.video("clip",{intent:s,profile:"fake-video-v1",firstFrame:p.approvedImage(frame,gate),prompt:"Slow push",seconds:6});const timeline=p.timeline("timeline",{takes:[clip]${explicitNarration || externalMusic ? `,narration:p.asset("${externalMusic ? 'music' : 'old-audio'}")` : ''}${explicitNarration ? ',cueRange:"old-cue"' : ''},transition:"cut"});return p.render("final",{timeline,width:160,height:90,format:"mp4"});});`;
  const logicalIds = {}, base = compilePlan(source, { project: before, profiles: DEFAULT_PROFILES, logicalIds, allocateId: randomUUID });
  const after = structuredClone(before), audio = { artifactId: 'new-audio', kind: 'audio', sha256: 'd'.repeat(64) };
  after.revisionId = 'revision-after'; after.headVersion = 1; after.artifacts.push(audio); after.cues = [{ ...oldCue, id: 'new-cue', meaning: 'New words', durationFrames: 60, audio }];
  after.shots[0].revisionId = 'shot-r1'; after.shots[0].cueId = 'new-cue'; after.shots[0].narrationTimingMode = 'within_shot'; after.shots[0].narration = { mode: 'uploaded', text: 'New words', voice: 'stock' };
  after.shots[0].promptIntent.video = shotIntentDigest(after.shots[0], 'video', after.cues[0]);
  return { before, after, base, logicalIds };
}
test('derived narration rebase preserves paid specs/review and export geometry while refreshing cues and base reference', async () => {
  const f = fixture(), result = await rebaseNarrationPlanIsolated(f.base, f.before, { project: f.after, profiles: DEFAULT_PROFILES, logicalIds: f.logicalIds, allocateId: randomUUID }, { allowedNarrationSourceKeys: [] });
  assert.equal(planSourceBaseRevision(result), f.after.revisionId);
  for (const node of result.nodes.filter(node => ['image','video'].includes(node.kind))) { const old = f.base.nodes.find(old => old.id === node.id); assert.equal(node.specDigest, old.specDigest); assert.equal(node.shotRevisionId, 'shot-r1'); }
  assert.deepEqual(result.gates, f.base.gates); assert.equal(result.nodes.find(node => node.kind === 'timeline').args.cues[0].audioHash, 'd'.repeat(64));
  assert.deepEqual(result.nodes.find(node => node.kind === 'render').args, f.base.nodes.find(node => node.kind === 'render').args);
  assert.notEqual(result.nodes.find(node => node.kind === 'render').specDigest, f.base.nodes.find(node => node.kind === 'render').specDigest);
});
test('old explicit narration and cue references rebase only from committed source selection', async () => {
  const f = fixture({ explicitNarration: true }), result = await rebaseNarrationPlanIsolated(f.base, f.before, { project: f.after, profiles: DEFAULT_PROFILES, logicalIds: f.logicalIds, allocateId: randomUUID }, { allowedNarrationSourceKeys: ['artifact:old-audio'] });
  const timeline = result.nodes.find(node => node.kind === 'timeline'); assert.equal(timeline.inputs.some(input => input.destinationPort === 'narration'), false); assert.equal(timeline.args.cues[0].audioHash, 'd'.repeat(64)); assert.ok(result.source.includes('new-cue'));
});
test('unknown explicit audio, changed visual timing and changed original source remain fail closed', async () => {
  const external = fixture({ externalMusic: true });
  await assert.rejects(rebaseNarrationPlanIsolated(external.base, external.before, { project: external.after, profiles: DEFAULT_PROFILES, logicalIds: external.logicalIds, allocateId: randomUUID }, { allowedNarrationSourceKeys: [] }), { code: 'NARRATION_PLAN_REBASE_UNSUPPORTED' });
  const changed = fixture(); changed.after.shots[0].desiredFrames = 150; changed.after.shots[0].promptIntent.video = shotIntentDigest(changed.after.shots[0], 'video', changed.after.cues[0]);
  await assert.rejects(rebaseNarrationPlanIsolated(changed.base, changed.before, { project: changed.after, profiles: DEFAULT_PROFILES, logicalIds: changed.logicalIds, allocateId: randomUUID }, { allowedNarrationSourceKeys: [] }));
  const tampered = fixture(); tampered.base.source = tampered.base.source.replace('width:160', 'width:320');
  await assert.rejects(rebaseNarrationPlanIsolated(tampered.base, tampered.before, { project: tampered.after, profiles: DEFAULT_PROFILES, logicalIds: tampered.logicalIds, allocateId: randomUUID }, { allowedNarrationSourceKeys: [] }), { code: 'NARRATION_PLAN_REBASE_UNSUPPORTED' });
});
