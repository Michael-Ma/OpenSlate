import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { digest, parseToolArguments, shotVideoTiming } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { verifySkillLock } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { FakeWorkflowDirector } from '../dist/application/fake-director.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { createApp } from '../dist/app.js';
import { projectFixture } from './execution-fixture.mjs';
import { directorNotes } from '../dist/application/director-notes.js';
import { editStoryboard } from '../dist/storyboard.js';
import { proposalCommand, rebaseProposal } from '../dist/application/director-proposals.js';
function writable(path) { chmodSync(path, 0o700); for (const e of readdirSync(path, {withFileTypes:true})) if(e.isDirectory()) writable(join(path,e.name)); }
function fixture(t, {scope=['scene-0'], editing=false, turnState='completed'}={}) {
 const root=mkdtempSync(join(tmpdir(),'openslate-notes-')),store=new Store(join(root,'state.sqlite')),provider=new FakeProvider(join(root,'fake.sqlite'));
 const engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),service=new ProductionService(store,engine);
 let project=service.createProject('Notes');const shape=projectFixture(project.id,2);
 project=store.saveProject({...project,...shape,capabilityLockId:project.capabilityLockId,shots:shape.shots.map(s=>({...s,narration:{mode:'none',text:'',voice:'stock'}}))},0);
 store.insert('project_revision',project.revisionId,project.id,{project});
 const config={repositoryRoot:fileURLToPath(new URL('../../../',import.meta.url)),snapshotRoot:join(root,'skills')};
 const saved=createDirectorSkillLock(config);verifySkillLock(saved.lock,saved.environment);
 new DirectorContextService(service,saved.environment).bootstrapLock(project.id,saved.lock);
 const human=service.beginRequest(project.id,'local-user','Discuss this scene',{scopeIds:scope==='project'?[project.id]:scope,editing}),bridge=service.openEpoch(project.id,human),turn={id:randomUUID(),projectId:project.id,requestId:human.requestId,epochId:bridge.actor.epochId,state:turnState,runtimeId:"fixture",createdAt:"2026-10-15T00:00:00Z"};
 store.insert('director_turn',turn.id,project.id,turn);
 new DirectorContextService(service,saved.environment).capture(project.id,bridge.actor,{lockId:saved.lock.id,selectedSkillIds:['production','plan-authoring']});
 const token='notes_fixture_token_123456789',app=createApp({service,localToken:token});
 const http=(method,path,payload,key='key')=>app.inject({method,url:`/api/projects/${project.id}${path}`,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,...(key?{'idempotency-key':key}:{})},...(payload?{payload}:{})});
 const tools=new ToolInvocationService(service), note=(overrides={})=>({anchor:{shotIds:['shot-0']},kind:'observation',blocking:false,text:'Consider the opening direction',choices:[{kind:'accept',label:'Keep it'}],...overrides});
 const record=(notes=[note()],id=randomUUID())=>tools.invoke(project.id,bridge.actor,id,'record_notes',{notes});
 const resolve=(id,input,key='resolve')=>http('POST',`/director/notes/${id}/resolve`,input,key);
 t.after(async()=>{await app.close();store.close();provider.close();writable(root);rmSync(root,{recursive:true,force:true});});
 return {root,store,provider,engine,service,project,bridge,human,turn,config,saved,tools,http,note,record,resolve};
}

const patch = (row={desiredFrames:240})=>({patch:{updateShots:[{id:'shot-0',...row}]}});
const propose=(f,input=patch(),key=randomUUID())=>f.tools.invoke(f.project.id,f.bridge.actor,key,'propose_change',input);
const accept=(f,p,key=randomUUID())=>f.http('POST',`/director/proposals/${p.proposalId}/accept`,{previewDigest:p.previewDigest},key);
const edit=(f,id,field,value)=>editStoryboard(f.service,f.project.id,{kind:'shot',id,field,value,expectedHeadVersion:f.store.getProject(f.project.id).headVersion},randomUUID());
const list=async f=>(await f.http('GET','/director/proposals')).json().proposals;

test('read-only proposal places no holds or media authority and reconciles a lost receipt',async t=>{
 const f=fixture(t),before=f.store.getProject(f.project.id),holds=f.store.list('hold',f.project.id),p=await propose(f,patch(),'one');
 assert.equal(p.state,'held');assert.deepEqual(await propose(f,patch(),'one'),p);assert.deepEqual(f.store.list('hold',f.project.id),holds);assert.deepEqual(f.store.getProject(f.project.id),before);assert.equal(f.store.list('grant',f.project.id).length,0);
 await assert.rejects(propose(f,patch({motion:'Pan'}),'one'),{code:'IDEMPOTENCY_CONFLICT'});
 const original=f.store.put.bind(f.store);let fail=true;
 f.store.put=(kind,...args)=>{if(kind==='tool_invocation'&&fail){fail=false;throw Error('lost response');}return original(kind,...args);};
 await assert.rejects(propose(f,patch({motion:'Pan'}),'lost'),{code:'TOOL_CALL_UNRESOLVED'});f.store.put=original;
 const call=f.store.list('tool_invocation',f.project.id).find(c=>c.callId==='lost');const epoch=f.store.get('epoch',f.bridge.actor.epochId);f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'revoked'});f.tools.reconcileEpoch(f.project.id,f.bridge.actor.epochId);f.tools.reconcileEpoch(f.project.id,f.bridge.actor.epochId);
 assert.equal(f.store.get('tool_reconciliation',call.id).state,'effect_confirmed');assert.equal(f.store.list('director_proposal',f.project.id).length,2);assert.equal(f.provider.acceptedCount(),0);
});
test('accept publishes once alongside a running Director, retains unrelated request holds; typed send still interrupts',async t=>{
 const f=fixture(t,{editing:true,turnState:'running'});
 const p=await propose(f),key=randomUUID(),accepted=await accept(f,p,key);assert.equal(accepted.statusCode,200,accepted.body);
 assert.equal(f.store.getProject(f.project.id).shots[0].desiredFrames,240);const version=f.store.getProject(f.project.id).headVersion;
 assert.deepEqual((await accept(f,p,key)).json(),accepted.json());assert.equal(f.store.getProject(f.project.id).headVersion,version);
 assert.equal(f.store.get('epoch',f.bridge.actor.epochId).state,'active');assert.equal(f.store.get('message',f.human.requestId).state,'active');assert.equal(f.store.get('director_turn',f.turn.id).state,'running');
 assert.ok(f.store.list('hold',f.project.id).filter(h=>h.active).every(h=>h.ownerId===f.human.requestId));
 f.service.beginRequest(f.project.id,'local-user','A new typed direction');assert.equal(f.store.get('epoch',f.bridge.actor.epochId).state,'revoked');
});
test('reject fences a stale scene press without changing the film; routes require keys and principal/project ownership',async t=>{
 const f=fixture(t),p=await propose(f),before=f.store.getProject(f.project.id);
 assert.equal((await accept(f,p,null)).json().error.code,'IDEMPOTENCY_KEY_REQUIRED');
 assert.throws(()=>proposalCommand(f.service,f.project.id,p.proposalId,'accept','foreign',p.previewDigest,'another-user'),{code:'ACTOR_DENIED'});
 const other=f.service.createProject('Other');assert.throws(()=>proposalCommand(f.service,other.id,p.proposalId,'reject','foreign'),{code:'NOT_FOUND'});
 const beforeView=(await f.http('GET','/scenes/scene-0/generation')).json();
 const rejected=await f.http('POST',`/director/proposals/${p.proposalId}/reject`,{},'reject');assert.equal(rejected.statusCode,200,rejected.body);assert.equal(rejected.json().proposal.state,'rejected');assert.deepEqual(f.store.getProject(f.project.id),before);
 const fresh=(await f.http('GET','/scenes/scene-0/generation')).json(),rejectRequest=f.store.list('message',f.project.id).at(-1);
 assert.equal(rejectRequest.editing,true);assert.equal(rejectRequest.concurrency,'alongside');
 assert.equal(fresh.currentRequestId,rejectRequest.id);assert.notEqual(fresh.currentRequestId,beforeView.currentRequestId);
 assert.equal(fresh.headVersion,beforeView.headVersion);assert.equal(fresh.revisionId,beforeView.revisionId);
 const cursor=f.store.cursor(f.project.id),messages=f.store.list('message',f.project.id).length;
 const stale=await f.http('POST','/scenes/scene-0/generate',{headVersion:beforeView.headVersion,revisionId:beforeView.revisionId,
  expectedRequestId:beforeView.currentRequestId,kind:'image',reviewedFrames:[],reviewedHoldDigest:beforeView.reviewedHoldDigest,
  reviewedControlAuthorityId:beforeView.reviewedControlAuthorityId},'stale-before-rejection');
 assert.equal(stale.statusCode,409,stale.body);assert.equal(stale.json().error.code,'SCENE_REVIEW_STALE');
 assert.equal(f.store.cursor(f.project.id),cursor);assert.equal(f.store.list('grant',f.project.id).length,0);assert.equal(f.store.list('candidate',f.project.id).length,0);
 assert.deepEqual((await f.http('POST',`/director/proposals/${p.proposalId}/reject`,{},'reject')).json(),rejected.json());
 assert.equal(f.store.list('message',f.project.id).length,messages);assert.equal((await f.http('GET','/scenes/scene-0/generation')).json().currentRequestId,rejectRequest.id);
 assert.deepEqual(f.store.getProject(f.project.id),before);
 assert.equal((await accept(f,p)).json().error.code,'PROPOSAL_STALE');assert.equal(f.provider.acceptedCount(),0);
});
test('unrelated shot edit rebases but changed timeline preview must be reviewed again',async t=>{
 const f=fixture(t),p=await propose(f);edit(f,'shot-1','desiredFrames','210');
 const [fresh]=await list(f);assert.equal(fresh.state,'held');assert.notEqual(fresh.previewDigest,p.previewDigest);
 assert.equal((await accept(f,p)).json().error.code,'PROPOSAL_PREVIEW_CHANGED');
 const accepted=await accept(f,fresh);assert.equal(accepted.statusCode,200,accepted.body);
 assert.deepEqual(f.store.getProject(f.project.id).shots.map(s=>s.desiredFrames),[240,210]);
});
for(const field of ['motion','imagePrompt']) test(`a touched shot's newer ${field} edit expires the proposal`,async t=>{
 const f=fixture(t),p=await propose(f);edit(f,'shot-0',field,'New direction');
 const [stale]=await list(f);assert.equal(stale.state,'stale');assert.equal(stale.staleReason,'SHOT_CHANGED');
 assert.equal((await accept(f,p)).json().error.code,'PROPOSAL_STALE');
});
test('scene revision expiry and pure rebase-or-expire',async t=>{
 const f=fixture(t),p=await propose(f,{patch:{updateScenes:[{id:'scene-0',purpose:'Arrival'}]}}),record=f.store.get('director_proposal',p.proposalId);
 assert.equal(rebaseProposal(f.store.getProject(f.project.id),record).state,'held');
 editStoryboard(f.service,f.project.id,{kind:'scene',id:'scene-0',value:'Human scene',expectedHeadVersion:f.store.getProject(f.project.id).headVersion},randomUUID());
 assert.deepEqual(rebaseProposal(f.store.getProject(f.project.id),record),{state:'stale',staleReason:'SHOT_CHANGED'});
 assert.equal((await accept(f,p)).json().error.code,'PROPOSAL_STALE');
});
test('new media changes preview even without a project revision',async t=>{
 const f=fixture(t),p=await propose(f),project=f.store.getProject(f.project.id),shot=project.shots[0];
 f.store.insert('node_binding','image',project.id,{id:'image',state:'active',planId:project.activePlanId,node:{kind:'image',shotId:shot.id,intentDigest:shot.promptIntent.image,args:{prompt:shot.imagePrompt}},outputs:{main:{artifactId:'frame'}}});
 assert.equal((await accept(f,p)).json().error.code,'PROPOSAL_PREVIEW_CHANGED');assert.ok((await list(f))[0].preview.effects.some(e=>e.effect==='keeps_keyframe'));
});
test('accept resolves its proposal note; undo is selective, reports leftAlone and reopens note',async t=>{
 const f=fixture(t),p=await propose(f,patch({desiredFrames:240,motion:'Pan left'}));
 const n=(await f.record([f.note({choices:[{kind:'proposal',proposalId:p.proposalId},{kind:'accept',label:'Keep'}]})])).notes[0];
 assert.equal((await f.resolve(n.noteId,{expectedVersion:1,choiceIndex:0},'unaccepted')).json().error.code,'NOTE_RESULT_INVALID');
 const accepted=await accept(f,p);assert.equal(accepted.statusCode,200,accepted.body);assert.equal(accepted.json().proposal.noteId,n.noteId);
 assert.equal(f.service.snapshot(f.project.id).notes.find(x=>x.noteId===n.noteId).state,'resolved');
 edit(f,'shot-0','motion','Human pan right');
 const key=randomUUID(),undone=await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},key);assert.equal(undone.statusCode,200,undone.body);
 assert.deepEqual(undone.json().leftAlone,[{shotId:'shot-0',field:'motion'}]);assert.equal(undone.json().proposal.state,'undone');
 const shot=f.store.getProject(f.project.id).shots[0];assert.equal(shot.desiredFrames,180);assert.equal(shot.motion,'Human pan right');
 const note=f.service.snapshot(f.project.id).notes.find(x=>x.noteId===n.noteId);assert.equal(note.state,'open');assert.equal(note.resolution,undefined);assert.equal(note.version,3);
 assert.deepEqual((await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},key)).json(),undone.json());
 const version=f.store.getProject(f.project.id).headVersion;assert.equal((await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},'again')).statusCode,200);assert.equal(f.store.getProject(f.project.id).headVersion,version);
});
test('duration-only accept and inverse preserve exact keyframe binding and preview',async t=>{
 const f=fixture(t),project=f.store.getProject(f.project.id),shot=project.shots[0],b={id:'image',state:'active',planId:project.activePlanId,node:{kind:'image',shotId:shot.id,intentDigest:shot.promptIntent.image,args:{prompt:shot.imagePrompt}},outputs:{main:{artifactId:'frame'}}};
 f.store.insert('node_binding',b.id,project.id,b);const p=await propose(f);assert.ok(p.preview.effects.some(e=>e.effect==='keeps_keyframe'));
 assert.equal((await accept(f,p)).statusCode,200);const result=await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},'undo');assert.equal(result.statusCode,200,result.body);
 assert.deepEqual(f.store.get('node_binding',b.id).outputs,b.outputs);assert.ok(result.json().proposal.preview.effects.some(e=>e.effect==='keeps_keyframe'));assert.equal(result.json().proposal.preview.timeline[0].afterSeconds,6);
});
test('Director prepare and propose cannot overwrite human fields after capture, even ABA; another field remains allowed',async t=>{
 const f=fixture(t,{editing:true});const original=f.project.shots[0].imagePrompt;
 edit(f,'shot-0','imagePrompt','Human prompt');edit(f,'shot-0','imagePrompt',original);
 await assert.rejects(propose(f,patch({imagePrompt:'Director overwrite'})),{code:'HUMAN_EDITED_FIELD'});
 await assert.rejects(f.service.prepare(f.project.id,f.bridge.actor,{variant:'project',expectedHeadVersion:f.store.getProject(f.project.id).headVersion,creative:{updateShots:[{id:'shot-0',imagePrompt:'Director overwrite',reauthorPrompts:true}]}}),{code:'HUMAN_EDITED_FIELD'});
 const allowed=await propose(f,patch({motion:'Another field'}));assert.equal(allowed.state,'held');
});
test('an accepted proposal fences the running Director field and rejects stale prepared writes',async t=>{
 const f=fixture(t,{editing:true}),p=await propose(f);assert.equal((await accept(f,p)).statusCode,200);
 await assert.rejects(propose(f),{code:'HUMAN_EDITED_FIELD'});
 assert.equal(f.store.get('epoch',f.bridge.actor.epochId).state,'active');
});
test('proposal survives a newer typed request but restored authority cannot accept it',async t=>{
 const f=fixture(t),p=await propose(f);f.service.beginRequest(f.project.id,'local-user','New direction',{scopeIds:['shot-1']});
 assert.equal((await accept(f,p)).statusCode,200);
 const g=fixture(t),q=await propose(g),original=g.service.recovery.isImported.bind(g.service.recovery);
 g.service.recovery.isImported=(projectId,kind,id)=>kind==='message'&&id===g.human.requestId||original(projectId,kind,id);
 assert.equal((await list(g))[0].staleReason,'RESTORED_PROJECT');assert.equal((await accept(g,q)).json().error.code,'PROPOSAL_STALE');
});
test('no-op, duplicate, out-of-scope and plan-bearing proposals have no committed effects',async t=>{
 const f=fixture(t);
 for(const [input,code] of [[patch({desiredFrames:180}),'VALIDATION_ERROR'],[{patch:{updateShots:[{id:'shot-0',motion:'Pan'},{id:'shot-0',desiredFrames:240}]}},'VALIDATION_ERROR'],[{patch:{updateShots:[{id:'shot-1',desiredFrames:240}]}},'SCOPE_DENIED'],[{...patch(),source:'code'},'VALIDATION_ERROR']]) await assert.rejects(propose(f,input),{code});
 assert.equal(f.store.list('director_proposal',f.project.id).length,0);assert.equal(f.store.list('hold',f.project.id).filter(h=>h.active).length,0);
});
test('narration-only changes expire held proposals even when picture revision stays unchanged',async t=>{
 const f=fixture(t),p=await propose(f),before=f.store.getProject(f.project.id).shots[0].revisionId;
 editStoryboard(f.service,f.project.id,{kind:'narration',id:'shot-0',field:'text',value:'Human writing',expectedHeadVersion:f.store.getProject(f.project.id).headVersion},randomUUID());
 assert.equal((await list(f))[0].state,'stale');assert.equal((await accept(f,p)).json().error.code,'PROPOSAL_STALE');
 await assert.rejects(propose(f,patch({narration:{mode:'none',text:'',voice:'stock'}})),{code:'HUMAN_EDITED_FIELD'});
});
test('undo respects a later accepted proposal touching the same field',async t=>{
 const f=fixture(t),p=await propose(f);assert.equal((await accept(f,p)).statusCode,200);
 // A fresh turn can propose further changes; the original captured turn remains fenced.
 const human=f.service.beginRequest(f.project.id,'local-user','Discuss a later change',{editing:false,scopeIds:['shot-0']}),bridge=f.service.openEpoch(f.project.id,human);
 f.store.insert('director_turn','later-turn',f.project.id,{requestId:human.requestId,epochId:bridge.actor.epochId,state:'completed'});
 new DirectorContextService(f.service,f.saved.environment).capture(f.project.id,bridge.actor,{lockId:f.saved.lock.id,selectedSkillIds:['production','plan-authoring']});
 const q=await f.tools.invoke(f.project.id,bridge.actor,'later','propose_change',patch({desiredFrames:270}));assert.equal((await accept(f,q)).statusCode,200);
 const undo=await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},'old-undo');assert.equal(undo.statusCode,200,undo.body);assert.deepEqual(undo.json().leftAlone,[{shotId:'shot-0',field:'desiredFrames'}]);assert.equal(f.store.getProject(f.project.id).shots[0].desiredFrames,270);
});
test('undo restores an originally absent narration field and leaves scene edits alone',async t=>{
 const f=fixture(t);const project=f.store.getProject(f.project.id);delete project.shots[0].narration;f.store.saveProject(project,project.headVersion);
 const p=await propose(f,patch({narration:{mode:'generated',text:'Welcome aboard',voice:'stock'}}));assert.equal((await accept(f,p)).statusCode,200);
 const undo=await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},'undo');assert.equal(undo.statusCode,200,undo.body);assert.equal(f.store.getProject(f.project.id).shots[0].narration,undefined);
});
test('note resolve after accepting a proposal returns the saved choice; note links must stay in scope',async t=>{
 const f=fixture(t),p=await propose(f),n=(await f.record([f.note({choices:[{kind:'proposal',proposalId:p.proposalId}]})])).notes[0];
 assert.equal((await accept(f,p)).statusCode,200);
 const result=await f.resolve(n.noteId,{expectedVersion:1,choiceIndex:0,resultRef:p.proposalId},'resolved-via-accept');assert.equal(result.statusCode,200,result.body);assert.equal(result.json().state,'resolved');
 await assert.rejects(f.record([f.note({anchor:{shotIds:['shot-1']},choices:[{kind:'proposal',proposalId:p.proposalId}]})]),{code:'SCOPE_DENIED'});
});
test('actual running fake Director survives hand edit, proposal accept and note resolution then completes',async t=>{
 const f=fixture(t),{DirectorSupervisor}=await import('../dist/application/director-supervisor.js');
 let ready,release;const started=new Promise(r=>ready=r),barrier=new Promise(r=>release=r);let signal,actor;
 const runtime={id:'bounded-fake',async start(input,options){signal=options.signal;actor={kind:'director',principalId:'local-user',requestId:input.requestId,epochId:input.epochId};ready();await barrier;return {projectId:input.projectId,requestId:input.requestId,epochId:input.epochId,turnId:input.turnId,status:'completed',text:'Alongside work preserved.',dispatched:true};}};
 const supervisor=new DirectorSupervisor(f.service,runtime,{mode:'fake',prepareInput:createDirectorInput(f.service,{...f.config,endpoint:'http://127.0.0.1:3105'})});
 t.after(async()=>{release();await supervisor.close();});
 const human=f.service.beginRequest(f.project.id,'local-user','Work on this film',{scopeIds:[f.project.id]}),turn=supervisor.enqueue(f.project.id,human);supervisor.tick();await started;
 try {
 const p=await f.tools.invoke(f.project.id,actor,'live-proposal','propose_change',patch()),n=(await f.tools.invoke(f.project.id,actor,'live-note','record_notes',{notes:[f.note()]})).notes[0];
 const resolved=await f.resolve(n.noteId,{expectedVersion:1,choiceIndex:0},'live-resolve');assert.equal(resolved.statusCode,200,resolved.body);
 edit(f,'shot-1','motion','Human movement');const accepted=await accept(f,p);assert.equal(accepted.statusCode,200,accepted.body);
 supervisor.tick();assert.equal(signal.aborted,false);assert.equal(f.store.get('director_turn',turn.id).state,'running');
 await assert.rejects(f.service.prepare(f.project.id,actor,{variant:'project',expectedHeadVersion:f.store.getProject(f.project.id).headVersion,creative:{updateShots:[{id:'shot-1',motion:'Stale Director movement',reauthorPrompts:true}]}}),{code:'HUMAN_EDITED_FIELD'});
 release();await supervisor.settle();assert.equal(f.store.get('director_turn',turn.id).state,'completed');
 assert.ok(f.service.snapshot(f.project.id).conversation.some(m=>m.text==='Alongside work preserved.'));
 } finally { release(); await supervisor.close(); }
});
test('prepared Director changes cannot apply over a later human edit; failed accept rolls back atomically',async t=>{
 const f=fixture(t,{editing:true}),prepared=await f.service.prepare(f.project.id,f.bridge.actor,{variant:'project',expectedHeadVersion:f.store.getProject(f.project.id).headVersion,creative:{updateShots:[{id:'shot-0',imagePrompt:'Prepared old prompt',reauthorPrompts:true}]}});
 edit(f,'shot-0','imagePrompt','Human wins');assert.throws(()=>f.service.apply(f.project.id,f.bridge.actor,prepared.id),{code:'HUMAN_EDITED_FIELD'});
 const p=await propose(f),before=f.store.getProject(f.project.id),messages=f.store.list('message',f.project.id).length,original=f.store.saveProject.bind(f.store);let fail=true;
 f.store.saveProject=(...args)=>{if(fail){fail=false;throw Error('synthetic publication failure');}return original(...args);};
 const rejected=await accept(f,p,'atomic');assert.notEqual(rejected.statusCode,200);f.store.saveProject=original;
 assert.deepEqual(f.store.getProject(f.project.id),before);assert.equal(f.store.list('message',f.project.id).length,messages);assert.equal((await list(f)).find(row=>row.proposalId===p.proposalId).state,'held');
 assert.equal((await accept(f,p,'atomic')).statusCode,200);assert.equal(f.provider.acceptedCount(),0);
});
test('actual fake media matches proposal effects: duration keeps frame, outdates clip, and never dispatches by accepting',async t=>{
 const f=fixture(t);
 for(const kind of ['image','video']) {
  const view=(await f.http('GET','/scenes/scene-0/generation')).json();
  const response=await f.http('POST','/scenes/scene-0/generate',{kind,headVersion:view.headVersion,revisionId:view.revisionId,reviewedHoldDigest:view.reviewedHoldDigest,reviewedControlAuthorityId:view.reviewedControlAuthorityId,reviewedFrames:kind==='video'?view.rows.map(r=>({shotId:r.shotId,artifactId:r.image.artifactId,sha256:r.image.sha256})):[]},randomUUID());assert.equal(response.statusCode,200,response.body);
  for(let i=0;i<6;i++){await f.engine.runReady();await f.engine.reconcile();}
 }
 const human=f.service.beginRequest(f.project.id,'local-user','Discuss this shot',{editing:false,scopeIds:['shot-0']}),bridge=f.service.openEpoch(f.project.id,human);
 f.store.insert('director_turn','media-review',f.project.id,{requestId:human.requestId,epochId:bridge.actor.epochId,state:'completed'});
 new DirectorContextService(f.service,f.saved.environment).capture(f.project.id,bridge.actor,{lockId:f.saved.lock.id,selectedSkillIds:['production','plan-authoring']});
 const p=await f.tools.invoke(f.project.id,bridge.actor,'media-proposal','propose_change',patch()),frame=f.engine.outputs(f.project.id).find(o=>o.artifact.kind==='image');
 assert.deepEqual(p.preview.effects.map(e=>e.effect),['keeps_keyframe','clip_remade']);const count=f.provider.acceptedCount();assert.equal(count,2);
 assert.equal((await accept(f,p)).statusCode,200);assert.equal(f.provider.acceptedCount(),count);
 const overview=(await f.http('GET','/generation')).json();assert.equal(overview.shots['shot-0'].keyframe.state,'ready');assert.equal(overview.shots['shot-0'].video.state,'outdated');
 assert.equal(f.engine.outputs(f.project.id).find(o=>o.nodeId===frame.nodeId).artifact.artifactId,frame.artifact.artifactId);
 assert.equal((await f.engine.runReady()).dispatched,0);assert.equal(f.provider.acceptedCount(),count);
});
test('note route only acknowledges the proposal accept route and cannot resolve another note with the accepted ID',async t=>{
 const f=fixture(t),p=await propose(f),choice={kind:'proposal',proposalId:p.proposalId};
 const n=(await f.record([f.note({choices:[choice]})])).notes[0];
 const first=await f.resolve(n.noteId,{expectedVersion:1,choiceIndex:0,resultRef:p.proposalId},'before-accept');assert.equal(first.json().error.code,'NOTE_RESULT_INVALID');
 const accepted=await accept(f,p);assert.equal(accepted.statusCode,200,accepted.body);
 const before=f.service.snapshot(f.project.id).notes.find(note=>note.noteId===n.noteId),cursor=f.store.cursor(f.project.id);
 for(const expectedVersion of [1,2]) {
  const ack=await f.resolve(n.noteId,{expectedVersion,choiceIndex:0,resultRef:p.proposalId},`ack-${expectedVersion}`);assert.equal(ack.statusCode,200,ack.body);assert.deepEqual(ack.json(),before);assert.equal(f.store.cursor(f.project.id),cursor);
 }
 assert.equal((await f.resolve(n.noteId,{expectedVersion:2,choiceIndex:0,resultRef:'other'},'wrong-ref')).json().error.code,'NOTE_RESULT_INVALID');
 const later=(await f.record([f.note({choices:[choice]})])).notes[0];
 const rejected=await f.resolve(later.noteId,{expectedVersion:1,choiceIndex:0,resultRef:p.proposalId},'no-new-resolution');assert.equal(rejected.json().error.code,'NOTE_RESULT_INVALID');
 assert.equal(f.service.snapshot(f.project.id).notes.find(note=>note.noteId===later.noteId).state,'open');
});
test('proposal preview includes the paid take B8 retains while a replacement is pending',async t=>{
 const f=fixture(t),project=f.store.getProject(f.project.id),shot=project.shots[0];
 f.store.insert('node_binding','retained-image',project.id,{id:'retained-image',state:'active',planId:project.activePlanId,node:{kind:'image',shotId:shot.id,intentDigest:shot.promptIntent.image,args:{prompt:shot.imagePrompt}},outputs:{},retainedTake:{candidateId:null,outputs:{image:{artifactId:'retained-frame',sha256:'a'.repeat(64),kind:'image'}}}});
 const p=await propose(f);assert.deepEqual(p.preview.effects,[{shotId:shot.id,effect:'keeps_keyframe'}]);
});

for (const field of ['brief', 'story', 'narrationScript', 'narrationSource']) test(`project ${field} human edits fence the original Director cursor after later context capture and ABA`, async t => {
 const f=fixture(t,{scope:'project',editing:true});
 if (field==='narrationScript') { const project=f.store.getProject(f.project.id);project.narration.script='Original global script';f.store.saveProject(project,project.headVersion); }
 const original=field==='narrationScript'?f.store.getProject(f.project.id).narration.script:field==='narrationSource'?f.project.narration.source:f.project[field];
 const directorValue=field==='narrationSource'?'generated':'Earlier Director draft';
 const prepared=await f.service.prepare(f.project.id,f.bridge.actor,{variant:'project',expectedHeadVersion:f.store.getProject(f.project.id).headVersion,creative:{[field]:directorValue}});
 for (const value of [field==='narrationSource'?'uploaded':'Human project wording',original]) {
  if (field==='narrationScript'||field==='narrationSource') {
   const human=f.service.beginRequest(f.project.id,'local-user','Edit project wording',{source:'app',concurrency:'alongside',editing:true,scopeIds:[f.project.id]});
   f.service.publishHumanCreativePatch(f.project.id,human,{[field]:value});
  } else editStoryboard(f.service,f.project.id,{kind:'treatment',field,value,expectedHeadVersion:f.store.getProject(f.project.id).headVersion},randomUUID());
 }
 new DirectorContextService(f.service,f.saved.environment).capture(f.project.id,f.bridge.actor,{lockId:f.saved.lock.id,selectedSkillIds:['production','plan-authoring']});
 await assert.rejects(f.service.prepare(f.project.id,f.bridge.actor,{variant:'project',expectedHeadVersion:f.store.getProject(f.project.id).headVersion,creative:{[field]:directorValue}}),{code:'HUMAN_EDITED_FIELD'});
 assert.throws(()=>f.service.apply(f.project.id,f.bridge.actor,prepared.id),{code:'HUMAN_EDITED_FIELD'});
 const untouched=field==='brief'?'story':'brief';
 const allowed=await f.service.prepare(f.project.id,f.bridge.actor,{variant:'project',expectedHeadVersion:f.store.getProject(f.project.id).headVersion,creative:{[untouched]:'Independent project field'}});
 assert.ok(allowed.id);assert.equal(f.store.get('epoch',f.bridge.actor.epochId).state,'active');
});

function acceptedNarration(f) {
 const project=f.store.getProject(f.project.id),shot=project.shots[0];
 Object.assign(shot,{desiredFrames:240,narration:{mode:'generated',text:'Accepted original line',voice:'stock'},narrationPending:false,narrationTimingMode:'within_shot',narrationFit:'extend_shot',cueId:'accepted-original'});
 project.cues.push({id:shot.cueId,meaning:shot.narration.text,durationFrames:210,placementFrames:0,audio:{artifactId:'original-audio',sha256:'a'.repeat(64),kind:'audio'},accepted:true,measured:true});
 f.store.saveProject(project,project.headVersion);return f.store.getProject(project.id);
}
test('proposal acceptance and prepared publication refuse a shot shorter than its accepted narration',async t=>{
 const f=fixture(t),before=acceptedNarration(f),p=await propose(f,patch({desiredFrames:180}));
 const response=await accept(f,p);assert.equal(response.json().error?.code,'SHOT_SHORTER_THAN_NARRATION',response.body);
 assert.deepEqual(f.store.getProject(f.project.id),before);assert.equal((await list(f))[0].state,'held');
 const human=f.service.beginRequest(f.project.id,'local-user','Shorten through shared publication',{source:'app',concurrency:'alongside',editing:true,scopeIds:['shot-0']});
 const prepared=await f.service.prepare(f.project.id,human,{variant:'project',expectedHeadVersion:before.headVersion,creative:{updateShots:[{id:'shot-0',desiredFrames:180,reauthorPrompts:true}]}});
 assert.throws(()=>f.service.apply(f.project.id,human,prepared.id),{code:'SHOT_SHORTER_THAN_NARRATION'});
 assert.deepEqual(f.store.getProject(f.project.id),before);assert.equal(f.provider.acceptedCount(),0);
});
for (const mode of ['generated','none']) test(`undo of a ${mode} narration proposal restores exact accepted readiness and fit`,async t=>{
 const f=fixture(t),before=acceptedNarration(f),p=await propose(f,patch({narration:{mode,text:mode==='none'?'':'Proposed replacement line',voice:'stock'}}));
 assert.equal((await accept(f,p)).statusCode,200);
 const undo=await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},randomUUID());assert.equal(undo.statusCode,200,undo.body);
 const after=f.store.getProject(f.project.id),old=before.shots[0],shot=after.shots[0];
 for (const field of ['narration','cueId','narrationPending','narrationTimingMode','narrationFit']) assert.deepEqual(shot[field],old[field],field);
 assert.deepEqual(after.cues,before.cues);assert.equal(shotVideoTiming(after,shot).ready,true);assert.deepEqual(undo.json().leftAlone,[]);
});
test('narration proposal undo preserves a later audio acceptance while undoing independent duration',async t=>{
 const f=fixture(t);acceptedNarration(f);const p=await propose(f,patch({desiredFrames:270,narration:{mode:'generated',text:'Proposed replacement line',voice:'stock'}}));
 assert.equal((await accept(f,p)).statusCode,200);
 const later=f.store.getProject(f.project.id),shot=later.shots[0];
 Object.assign(shot,{cueId:'new-audio',narrationPending:false,narrationFit:'cut_to_shot'});
 later.cues.push({id:'new-audio',meaning:shot.narration.text,durationFrames:180,placementFrames:0,audio:{artifactId:'later-audio',sha256:'b'.repeat(64),kind:'audio'},accepted:true,measured:true});
 f.store.saveProject(later,later.headVersion);
 const undo=await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},randomUUID());assert.equal(undo.statusCode,200,undo.body);
 const after=f.store.getProject(f.project.id);assert.equal(after.shots[0].desiredFrames,240);
 for (const field of ['narration','cueId','narrationPending','narrationTimingMode','narrationFit']) assert.deepEqual(after.shots[0][field],shot[field],field);
 assert.deepEqual(after.cues,later.cues);assert.deepEqual(undo.json().leftAlone,[{shotId:'shot-0',field:'narration'}]);assert.equal(shotVideoTiming(after,after.shots[0]).ready,true);
});
test('narration proposal undo preserves changes to an original cue while it was detached',async t=>{
 const f=fixture(t);acceptedNarration(f);const p=await propose(f,patch({narration:{mode:'none',text:'',voice:'stock'}}));
 assert.equal((await accept(f,p)).statusCode,200);
 const later=f.store.getProject(f.project.id);later.cues[0].accepted=false;f.store.saveProject(later,later.headVersion);
 const undo=await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},randomUUID());assert.equal(undo.statusCode,200,undo.body);
 const after=f.store.getProject(f.project.id);assert.deepEqual(after.shots[0].narration,later.shots[0].narration);assert.equal(after.shots[0].cueId,null);
 assert.deepEqual(after.cues,later.cues);assert.deepEqual(undo.json().leftAlone,[{shotId:'shot-0',field:'narration'}]);
});
test('narration proposal undo restores absent acceptance flags exactly',async t=>{
 const f=fixture(t),before=acceptedNarration(f);delete before.shots[0].narrationPending;delete before.shots[0].narrationFit;f.store.saveProject(before,before.headVersion);
 const p=await propose(f,patch({narration:{mode:'generated',text:'Proposed line',voice:'stock'}}));assert.equal((await accept(f,p)).statusCode,200);
 assert.equal((await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},randomUUID())).statusCode,200);
 const after=f.store.getProject(f.project.id);assert.equal(Object.hasOwn(after.shots[0],'narrationPending'),false);assert.equal(Object.hasOwn(after.shots[0],'narrationFit'),false);assert.equal(shotVideoTiming(after,after.shots[0]).ready,true);
});
test('narration proposal undo preserves a later audio edit even when acceptance metadata returns to its old values',async t=>{
 const f=fixture(t);acceptedNarration(f);const p=await propose(f,patch({narration:{mode:'generated',text:'Proposed line',voice:'stock'}}));assert.equal((await accept(f,p)).statusCode,200);
 const before=f.store.getProject(f.project.id);
 // Durable field receipts survive an audio fit edit followed by its own inverse (ABA).
 for (let i=0;i<2;i++) f.store.appendEvent(f.project.id,'human.fields_changed',{requestId:`later-audio-${i}`,fields:[{shotId:'shot-0',field:'narrationFit'}]});
 const undo=await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},randomUUID());assert.equal(undo.statusCode,200,undo.body);
 assert.deepEqual(f.store.getProject(f.project.id),before);assert.deepEqual(undo.json().leftAlone,[{shotId:'shot-0',field:'narration'}]);
});
test('legacy narration proposals without acceptance snapshots leave narration alone and undo other fields',async t=>{
 const f=fixture(t);acceptedNarration(f);const p=await propose(f,patch({desiredFrames:270,narration:{mode:'generated',text:'Historical proposed line',voice:'stock'}}));assert.equal((await accept(f,p)).statusCode,200);
 const record=f.store.get('director_proposal',p.proposalId);delete record.accepted.narration;delete record.accepted.cursor;f.store.put('director_proposal',record.id,f.project.id,record);
 const before=f.store.getProject(f.project.id),undo=await f.http('POST',`/director/proposals/${p.proposalId}/undo`,{},randomUUID());assert.equal(undo.statusCode,200,undo.body);
 const after=f.store.getProject(f.project.id);assert.equal(after.shots[0].desiredFrames,240);
 for (const field of ['narration','cueId','narrationPending','narrationTimingMode','narrationFit']) assert.deepEqual(after.shots[0][field],before.shots[0][field],field);
 assert.deepEqual(after.cues,before.cues);assert.deepEqual(undo.json().leftAlone,[{shotId:'shot-0',field:'narration'}]);
});
