import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCreativePatch, parseChangeProposal, shotIntentDigest, shotVideoTiming, workflowReadiness } from '../dist/index.js';
const shot = { id: 'shot', revisionId: 'r', sceneId: 'scene', purpose: 'Leather', action: 'Boot', framing: 'Close', motion: 'Push', desiredFrames: 195, imagePrompt: 'Boot', videoPrompt: 'Push', promptIntent: { image: '', video: '' }, referenceArtifactIds: [], cueId: null };
const project = { id: 'project', revisionId: 'r', headVersion: 0, name: 'Film', brief: 'Leather', story: 'Product', scenes: [{ id: 'scene', revisionId: 'r', purpose: 'Craft' }], narration: { script: '', source: 'undecided' }, maxFrames: 10800, capabilityLockId: 'lock', shots: [shot], cues: [], artifacts: [], activePlanId: null };

test('explicit no narration is ready from planned duration, undecided intent and missing speech remain gaps', () => {
  assert.deepEqual(shotVideoTiming(project, shot), { ready: false, reason: 'narration_undecided' });
  const silent = { ...shot, narration: { mode: 'none', text: '', voice: 'stock' } };
  assert.deepEqual(shotVideoTiming(project, silent), { ready: true, source: 'planned_duration', frames: 195 });
  assert.equal(workflowReadiness({ ...project, shots: [silent] }).scopes[0].videoTiming, 'ready');
  assert.equal(workflowReadiness({ ...project, shots: [silent] }).narration.inputState, 'no_narration');
  assert.deepEqual(shotVideoTiming(project, { ...silent, cueId: 'cue' }), { ready: false, reason: 'silent_cue_conflict' });
  assert.deepEqual(shotVideoTiming(project, { ...silent, narration: { ...silent.narration, mode: 'generated' } }), { ready: false, reason: 'audio_pending' });
});
test('narrated shots recheck accepted measured duration; audio choice does not supply timing evidence', () => {
  const cue = { id: 'cue', meaning: 'Leather', durationFrames: 195, placementFrames: 0, accepted: true, measured: true, audio: { artifactId: 'a', sha256: 'a'.repeat(64), kind: 'audio' } };
  assert.equal(shotVideoTiming({ cues: [cue] }, { ...shot, cueId: cue.id }).source, 'accepted_audio');
  assert.deepEqual(shotVideoTiming({ cues: [cue] }, { ...shot, cueId: cue.id, narrationPending: true }), { ready: false, reason: 'audio_pending' });
  const readiness=workflowReadiness({...project,cues:[cue],shots:[{...shot,cueId:cue.id,narrationPending:true,narration:{mode:'generated',text:'New words.',voice:'stock'}}]});
  assert.equal(readiness.narration.inputState,'script_without_accepted_audio');assert.equal(readiness.narration.hasScript,true);assert.deepEqual(readiness.narration.acceptedMeasuredCues,[]);
  for (const changed of [{ ...cue, accepted: false }, { ...cue, measured: false }, { ...cue, durationFrames: 180 }]) assert.equal(shotVideoTiming({ cues: [changed] }, { ...shot, cueId: cue.id }).ready, false);
});
test('validated director narration updates detach only the silent shot cue and retain historical project cues', () => {
  const cue = { id: 'cue', accepted: true }, narrated = { ...project, cues: [cue], shots: [{ ...shot, cueId: cue.id }] };
  const proposal = parseChangeProposal({ variant: 'project', expectedHeadVersion: 0, creative: { updateShots: [{ id: shot.id, narration: { mode: 'none', text: '', voice: 'stock' }, reauthorPrompts: true }] } });
  const next = applyCreativePatch(narrated, proposal.creative, s => s);
  assert.equal(next.shots[0].cueId, null); assert.equal(next.shots[0].narration.mode, 'none'); assert.deepEqual(next.cues, [cue]); assert.equal(narrated.shots[0].cueId, cue.id);
  assert.throws(() => parseChangeProposal({ variant: 'project', expectedHeadVersion: 0, creative: { updateShots: [{ id: shot.id, narration: { mode: 'none', text: '', voice: 'stock', accepted: true } }] } }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => parseChangeProposal({ variant: 'project', expectedHeadVersion: 0, creative: { updateShots: [{ id: shot.id, narrationPending: false }] } }), { code: 'VALIDATION_ERROR' });
});

test('conversational writing changes preserve visual revision and cue evidence but derive a pending audio gap',()=>{
 const cue={id:'cue',accepted:true},before={...project,cues:[cue],shots:[{...shot,cueId:'cue',narration:{mode:'uploaded',text:'Old words.',voice:'stock'}}]};
 const proposal=parseChangeProposal({variant:'project',expectedHeadVersion:0,creative:{updateShots:[{id:shot.id,narration:{mode:'generated',text:'New words.',voice:'personal'},reauthorPrompts:true}]}});
 const next=applyCreativePatch(before,proposal.creative,s=>s);assert.equal(next.shots[0].revisionId,shot.revisionId);assert.equal(next.shots[0].narrationPending,true);assert.equal(next.shots[0].cueId,'cue');assert.deepEqual(next.cues,[cue]);
});

test('protected voiceover timing keeps the planned picture slot while accepting actual shorter audio',()=>{
 const cue={id:'cue',meaning:'A short voiceover',durationFrames:30,placementFrames:0,accepted:true,measured:true,audio:{artifactId:'audio',sha256:'a'.repeat(64),kind:'audio'}};
 const overlay={...shot,desiredFrames:180,cueId:cue.id,narrationTimingMode:'within_shot',narration:{mode:'uploaded',text:'Short line.',voice:'stock'}};
 assert.equal(shotVideoTiming({cues:[cue]},overlay).ready,true);assert.equal(shotVideoTiming({cues:[cue]},overlay).frames,180);assert.equal(shotVideoTiming({cues:[{...cue,durationFrames:181}]},overlay).ready,false);
 assert.equal(shotVideoTiming({cues:[cue]},{...overlay,narrationTimingMode:undefined}).ready,false);
 const silent={...overlay,cueId:null,narration:{mode:'none',text:'',voice:'stock'}};
 assert.equal(shotIntentDigest(overlay,'video',cue),shotIntentDigest(silent,'video'));
 assert.equal(shotIntentDigest(overlay,'video',cue),shotIntentDigest(overlay,'video',{...cue,meaning:'Other words',durationFrames:120}),'voiceover writing and actual source duration are not picture-generation instructions');
 assert.throws(()=>parseChangeProposal({variant:'project',expectedHeadVersion:0,creative:{updateShots:[{id:shot.id,narrationTimingMode:'within_shot'}]}}),{code:'VALIDATION_ERROR'});
});


test('accepted audio material does not hide pending or undecided shot timing coverage', () => {
  const cue = { id: 'cue', meaning: 'Leather', durationFrames: 195, placementFrames: 0, accepted: true, measured: true, audio: { artifactId: 'a', sha256: 'a'.repeat(64), kind: 'audio' } };
  const mixed = { ...project, narration: { script: 'Accepted opening words', source: 'uploaded' }, cues: [cue], shots: [
    { ...shot, cueId: cue.id }, { ...shot, id: 'missing', narration: { mode: 'generated', text: 'New words', voice: 'stock' } }, { ...shot, id: 'silent', narration: { mode: 'none', text: '', voice: 'stock' } },
  ] };
  const readiness = workflowReadiness(mixed); assert.equal(readiness.narration.inputState, 'accepted_audio');
  assert.deepEqual(readiness.narration.timingCoverage, { total: 3, ready: 2, pending: 1 });
  assert.equal(readiness.scopes.find(scope => scope.shotId === 'missing').timing.reason, 'audio_pending');
  mixed.shots[0].narrationPending = true;
  assert.deepEqual(workflowReadiness(mixed).narration.timingCoverage, { total: 3, ready: 1, pending: 2 });
});


test('native narration writing with reconfirmed unchanged prompts preserves the visual revision; real visual changes do not', () => {
  const bind = (s, c) => ({ ...s, promptIntent: { image: shotIntentDigest(s, 'image', c), video: shotIntentDigest(s, 'video', c) } });
  const original = bind({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } });
  const before = { ...project, shots: [original] };
  const update = { id: original.id, imagePrompt: original.imagePrompt, videoPrompt: original.videoPrompt,
    narration: { mode: 'generated', text: 'Crafted for every step.', voice: 'stock' }, reauthorPrompts: true };
  const after = applyCreativePatch(before, { updateShots: [update] }, bind).shots[0];
  assert.equal(after.revisionId, original.revisionId); assert.deepEqual(after.promptIntent, original.promptIntent);
  assert.equal(after.narrationPending, true); assert.equal(after.cueId, null);
  const visualChange = applyCreativePatch(before, { updateShots: [{ ...update, imagePrompt: 'New visual direction' }] }, bind).shots[0];
  assert.notEqual(visualChange.revisionId, original.revisionId); assert.equal(visualChange.imagePrompt, 'New visual direction');
  const reconfirm = applyCreativePatch(before, { updateShots: [{ id: original.id, imagePrompt: original.imagePrompt, reauthorPrompts: true }] }, bind).shots[0];
  assert.notEqual(reconfirm.revisionId, original.revisionId, 'ordinary explicit prompt reconfirmation retains its existing revision behavior');
});
