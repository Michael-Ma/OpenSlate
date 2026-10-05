import test from 'node:test';
import assert from 'node:assert/strict';
import { directorPlan, planScopeLabel } from '../src/director-plan-model.ts';

const director = {mode:'native',status:'idle'};
const state=()=>({project:{id:'p',headVersion:2,revisionId:'r',activePlanId:'plan',brief:'Boot film',scenes:[{id:'scene'}],shots:[{id:'a',sceneId:'scene'},{id:'b',sceneId:'scene'}]},
  messages:[{id:'edit',text:'Keep the boot visible. Change only the first shot.'}],holds:[{id:'hold',active:true,ownerId:'edit',scopeId:'a'}],
  pendingEditContinuations:[{requestId:'edit',scopeIds:['a'],holdsDigest:'digest'}],attempts:[],outputs:[],questions:[],plan:{id:'plan',nodes:[]}});

test('unfinished writing resumes only exact authenticated held groups and retains stable scope IDs',()=>{
  const s=state(),p=directorPlan(s,director,null);assert.equal(p.state,'unfinished');assert.equal(p.canResume,true);
  assert.deepEqual(p.edits[0],{requestId:'edit',scopeIds:['a'],scope:'Shot 1.1',direction:s.messages[0].text});
  s.holds[0].active=false;assert.equal(directorPlan(s,director,null).edits.length,0);
});
test('running, waiting for an answer, paused and unknown generation never offer a saved-edit Resume',()=>{
  const s=state();let p=directorPlan(s,{...director,status:'running'},null);assert.equal(p.state,'working');assert.equal(p.action,null);assert.equal(p.canResume,false);
  s.questions=[{id:'q',state:'pending',canAnswer:true,questions:[{header:'Narration'}]}];p=directorPlan(s,director,null);assert.equal(p.action,'answer');assert.equal(p.questionId,'q');assert.equal(p.canResume,false);
  s.control={paused:true};p=directorPlan(s,director,null);assert.equal(p.state,'stopped');assert.equal(p.action,'chat');assert.equal(p.canResume,false);
  s.control.paused=false;s.questions=[];s.attempts=[{phase:'submission_unknown'}];p=directorPlan(s,director,null);assert.equal(p.state,'uncertain');assert.equal(p.action,'generation');assert.equal(p.canResume,false);
});
test('a selected shot cannot silently borrow whole-film or partially covered continuation authority',()=>{
  const s=state();assert.equal(directorPlan(s,director,null,true,['b']).edits.length,0);
  s.pendingEditContinuations[0].scopeIds=['a','b'];s.holds.push({id:'h2',active:true,ownerId:'edit',scopeId:'b'});
  assert.equal(directorPlan(s,director,null,true,['a']).edits.length,0);
  assert.equal(directorPlan(s,director,null,true,['scene']).edits.length,1);
  assert.deepEqual(directorPlan(s,director,null,true,['p']).edits[0].scopeIds,['a','b']);
});
test('manual storyboard edits are saved changes rather than an interrupted Director request',()=>{
  const s=state();s.latestStoryboardEdit={requestId:'edit'};const p=directorPlan(s,director,null);
  assert.equal(p.state,'saved');assert.equal(p.action,'generation');assert.equal(p.canResume,false);assert.equal(p.edits.length,0);
});
test('historical questions and stale keyframe reviews cannot masquerade as the next human decision',()=>{
  const s=state();s.holds=[];s.pendingEditContinuations=[];s.questions=[{id:'old',state:'pending',canAnswer:false,questions:[]}];
  const r={planId:'plan',headVersion:1,revisionId:'r',members:[{ready:true,keyframe:{},approved:false}]};
  assert.equal(directorPlan(s,director,r).state,'idle');r.headVersion=2;assert.equal(directorPlan(s,director,r).state,'review');
});
test('saved-media counts only current-plan outputs and deduplicates one artifact across output ports',()=>{
  const s=state();s.plan.nodes=[{id:'image',kind:'image'}];s.outputs=[{nodeId:'image',artifact:{artifactId:'img',kind:'image'}},{nodeId:'image',artifact:{artifactId:'img',kind:'image'}},{nodeId:'old',artifact:{artifactId:'old',kind:'video'}}];
  assert.equal(directorPlan(s,director,null).saved,'1 scene · 2 shots · 1 image saved.');
  s.plan.id='old-plan';assert.equal(directorPlan(s,director,null).saved,'1 scene · 2 shots saved.');
});
test('a transfer resolving the hold removes Resume and advances to the actual current review',()=>{
  const s=state();assert.equal(directorPlan(s,director,null).state,'unfinished');s.holds[0].active=false;s.pendingEditContinuations=[];
  const r={planId:'plan',headVersion:2,revisionId:'r',members:[{ready:true,keyframe:{artifactId:'image'},approved:false}]};
  const p=directorPlan(s,director,r);assert.equal(p.state,'review');assert.equal(p.action,'frames');assert.equal(p.canResume,false);
});
test('scene and whole-film scope labels remain readable after shot reordering',()=>{
  const s=state();assert.equal(planScopeLabel(s,['p']),'Whole film');assert.equal(planScopeLabel(s,['scene']),'Scene 1');
  s.project.shots.reverse();assert.equal(planScopeLabel(s,['a']),'Shot 1.2');
});
test('an empty project does not invent saved conversation or a Resume capability without a native Director',()=>{
 const s=state();s.project.shots=[];s.project.scenes=[];s.project.brief='';s.messages=[];
 assert.equal(directorPlan(s,director,null).saved,'Project saved.');
 const p=directorPlan(state(),{mode:'offline',status:'not_connected'},null);assert.equal(p.canResume,false);assert.match(p.next,/Project settings/);
});
