import test from 'node:test';
import assert from 'node:assert/strict';
import { projectActivity } from '../src/project-activity.ts';
const director={mode:'native',status:'idle'};
const state=()=>({project:{id:'p',activePlanId:'plan',headVersion:1,revisionId:'rev',shots:[{id:'s'}]},attempts:[],holds:[],outputs:[],questions:[],plan:{id:'plan',nodes:[]}});
test('connection loss hides stale activity and pauses explain provider work may continue',()=>{
 const s=state();s.attempts=[{phase:'remote_pending'}];assert.equal(projectActivity(s,director,null,false).label,'Connecting');
 s.control={paused:true};const v=projectActivity(s,director,null);assert.equal(v.label,'Paused');assert.match(v.detail,/may still run/);
});
test('unconfirmed prior outcomes are not labelled idle or failed and never suggest regeneration',()=>{
 const s=state();s.attempts=[{phase:'submission_unknown'}];const v=projectActivity(s,director,null);assert.equal(v.label,'Checking a previous job');assert.match(v.detail,/without submitting a replacement/);assert.equal(v.next.target,'usage');
});
test('local preparation and active provider work stay distinct from a running director',()=>{
 const s=state();s.attempts=[{phase:'ingesting'}];assert.equal(projectActivity(s,director,null).label,'Preparing media');
 s.attempts=[{phase:'remote_pending'}];assert.equal(projectActivity(s,director,null).label,'Generating');
 s.attempts=[];assert.equal(projectActivity(s,{...director,status:'running'},null).label,'Planning');
});
test('historical failures do not claim current activity; actionable questions take priority over review',()=>{
 const s=state();s.attempts=[{phase:'failed'},{phase:'succeeded'}];assert.equal(projectActivity(s,director,null).label,'Idle');
 s.questions=[{state:'pending',canAnswer:true}];assert.equal(projectActivity(s,director,null).next.target,'conversation');
 s.questions[0].canAnswer=false;assert.equal(projectActivity(s,director,null).label,'Idle');
});
test('only exact current review yields review action, and current export yields watch action',()=>{
 const s=state(),r={planId:'plan',headVersion:1,revisionId:'rev',members:[{ready:true,approved:false}]};assert.equal(projectActivity(s,director,r).next.target,'review');
 assert.equal(projectActivity(s,director,{...r,headVersion:0}).label,'Idle');
 s.plan.nodes=[{id:'render',kind:'render'}];s.outputs=[{nodeId:'render',artifact:{kind:'video'}}];assert.equal(projectActivity(s,director,null).next.target,'export');
});
