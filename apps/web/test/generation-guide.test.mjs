import test from 'node:test';
import assert from 'node:assert/strict';
import { generationStep } from '../src/generation-guide-model.ts';
const director = { mode:'native', status:'idle' };
const snapshot = () => ({ project:{ id:'p',activePlanId:'plan',headVersion:2,revisionId:'rev',shots:[{id:'s'}] },
  plan:{id:'plan',nodes:[{id:'image',kind:'image',shotId:'s'},{id:'video',kind:'video',shotId:'s'},{id:'render',kind:'render',shotId:null}]},
  outputs:[],attempts:[],holds:[],questions:[] });
const review = () => ({ planId:'plan',headVersion:2,revisionId:'rev',members:[{videoNodeId:'video',shotId:'s',approved:false,ready:true}] });
const output = id => ({nodeId:id,artifact:{kind:id==='image'?'image':'video'}});
test('stopped work and pending questions guide conversation before generation', () => {
  const s=snapshot();s.control={paused:true};assert.equal(generationStep(s,review(),director,null).action,'chat');
  s.control.paused=false;s.questions=[{state:'pending'}];assert.equal(generationStep(s,review(),director,null).stage,'plan');
});
test('a missing current plan requires explicit shot permission rather than spending', () => {
  const s=snapshot();s.project.activePlanId='later';assert.equal(generationStep(s,null,director,null).action,'permission');
});
test('missing video requires exact current frame review before video costs', () => {
  const s=snapshot();s.outputs=[output('image')];const r=review();
  assert.equal(generationStep(s,r,director,null).action,'frames');
  r.members[0].approved=true;assert.equal(generationStep(s,r,director,null).stage,'clips');
  r.headVersion=1;assert.equal(generationStep(s,r,director,null).action,'frames');
});
test('old uncertain attempts cannot stop a new plan; current uncertainty never suggests a replacement', () => {
  const s=snapshot();s.attempts=[{nodeId:'old',phase:'submission_unknown'}];assert.notEqual(generationStep(s,null,director,null).label,'Checking an earlier submission');
  s.attempts.push({nodeId:'video',phase:'submission_unknown'});const costs={headVersion:2,revisionId:'rev',planId:'plan',candidates:[{nodeId:'video',operation:'video',selectionCurrent:true,workState:'uncertain',latestAttempt:{phase:'submission_unknown'}}]};const step=generationStep(s,null,director,costs);assert.match(step.detail,/existing job/);assert.equal(step.action,'costs');
});
test('video takes alone are not labeled as a finished export', () => {
  const s=snapshot();s.outputs=[output('image'),output('video')];assert.equal(generationStep(s,review(),director,null).label,'Review the timeline');
  s.outputs.push(output('render'));assert.equal(generationStep(s,review(),director,null).label,'Your export is ready');
});
test('stale allowance data cannot offer spending or reinterpret permission', () => {
  const s=snapshot(),c={headVersion:1,revisionId:'old',planId:'plan',candidates:[{nodeId:'image',selectionCurrent:true,unavailableCode:'ORIGIN_NOT_AUTHORIZED'}]};
  assert.equal(generationStep(s,null,director,c).label,'Preparing keyframes');
  c.headVersion=2;c.revisionId='rev';assert.equal(generationStep(s,null,director,c).action,'permission');
});

test('an uploaded-media assembly plan does not ask for unnecessary visual generation',()=>{
 const s=snapshot();s.plan.nodes=[{id:'timeline',kind:'timeline'},{id:'render',kind:'render'}];
 assert.equal(generationStep(s,null,director,null).action,'timeline');
});

test('saved held drafts expose generation permission instead of an approval-to-chat loop',()=>{
 const s=snapshot();s.plan=null;s.holds=[{active:true,scopeId:'p',ownerId:'earlier'}];
 assert.equal(generationStep(s,null,director,null).action,'permission');
});
test('finished keyframes alone advance to video preparation instead of claiming an export stage',()=>{
 const s=snapshot();s.plan.nodes=s.plan.nodes.filter(n=>n.kind==='image');s.outputs=[output('image')];
 const step=generationStep(s,null,director,null);assert.equal(step.stage,'clips');assert.equal(step.action,'permission');
});
test('an old unknown submission on a reused node cannot replace current candidate guidance',()=>{
 const s=snapshot();s.attempts=[{nodeId:'video',phase:'submission_unknown',candidateId:'old'}];
 const costs={headVersion:2,revisionId:'rev',planId:'plan',candidates:[{nodeId:'image',operation:'image',selectionCurrent:true,workState:'planned',latestAttempt:null}]};
 const step=generationStep(s,null,director,costs);assert.equal(step.stage,'frames');assert.notEqual(step.label,'Checking an earlier submission');
});

test('pending voiced intent cannot be treated as accepted video timing just because an old cue exists',()=>{
 const s=snapshot();s.project.shots=[{id:'s',narrationPending:true,narration:{mode:'generated'},cueId:'old-accepted'}];s.outputs=[output('image')];
 const step=generationStep(s,review(),director,null);assert.equal(step.action,'audio');assert.equal(step.shotId,'s');
});
