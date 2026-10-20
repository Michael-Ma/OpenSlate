import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { digest, parseToolArguments } from '@openslate/core';
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
function writable(path) { chmodSync(path, 0o700); for (const e of readdirSync(path, {withFileTypes:true})) if(e.isDirectory()) writable(join(path,e.name)); }
function fixture(t, {scope=['scene-0'], editing=false}={}) {
 const root=mkdtempSync(join(tmpdir(),'openslate-notes-')),store=new Store(join(root,'state.sqlite')),provider=new FakeProvider(join(root,'fake.sqlite'));
 const engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),service=new ProductionService(store,engine);
 let project=service.createProject('Notes');const shape=projectFixture(project.id,2);
 project=store.saveProject({...project,...shape,capabilityLockId:project.capabilityLockId,shots:shape.shots.map(s=>({...s,narration:{mode:'none',text:'',voice:'stock'}}))},0);
 store.insert('project_revision',project.revisionId,project.id,{project});
 const config={repositoryRoot:fileURLToPath(new URL('../../../',import.meta.url)),snapshotRoot:join(root,'skills')};
 const saved=createDirectorSkillLock(config,'5.0.0');verifySkillLock(saved.lock,saved.environment);
 new DirectorContextService(service,saved.environment).bootstrapLock(project.id,saved.lock);
 const human=service.beginRequest(project.id,'local-user','Discuss this scene',{scopeIds:scope==='project'?[project.id]:scope,editing}),bridge=service.openEpoch(project.id,human),turn={id:randomUUID(),projectId:project.id,requestId:human.requestId,epochId:bridge.actor.epochId,state:"completed"};
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
test('V6 manifest verifies and notes schema is bounded and strict',t=>{
 const f=fixture(t);assert.ok(f.saved.lock.skills.every(s=>s.version==='6.0.0'));
 const valid={notes:[f.note()]};assert.deepEqual(parseToolArguments('record_notes',valid,'5.0.0').arguments,valid);
 for(const value of [{notes:[]},{notes:Array(7).fill(f.note())},{notes:[f.note({anchor:{}})]},{notes:[f.note({text:'x'.repeat(601)})]},{notes:[f.note({choices:[{kind:'accept',label:'Keep',paid:true}]})]},{notes:[f.note({anchor:{shotIds:['shot-0','shot-0']}})]},{notes:[f.note({choices:[{kind:'edit_field',shotId:'shot-0',field:'duration'}]})]}]) assert.throws(()=>parseToolArguments('record_notes',value,'5.0.0'),{code:'VALIDATION_ERROR'});
 assert.throws(()=>parseToolArguments('record_notes',valid,'4.0.0'),{code:'NOT_FOUND'});
});
test('read-only notes have ordered letters, replay exactly, snapshot and context list records',async t=>{
 const f=fixture(t),before=f.store.getProject(f.project.id);assert.equal(f.store.get('epoch',f.bridge.actor.epochId).state,'read_only');
 const a=await f.record([f.note(),f.note({kind:'recommendation'})],'first');assert.deepEqual(a.notes.map(n=>n.letter),['a','b']);
 assert.deepEqual(await f.record([f.note(),f.note({kind:'recommendation'})],'first'),a);assert.equal((await f.record()).notes[0].letter,'c');
 const snapshot=await f.http('GET','');assert.equal(snapshot.json().notes.length,3);assert.deepEqual(f.store.getProject(f.project.id),before);
 const context=f.service.readContext(f.project.id,f.bridge.actor,{section:'notes'});assert.equal(context.items.length,3);assert.ok(context.coverage.sections.includes('notes'));
 await assert.rejects(f.record([f.note({text:'Changed'})],'first'),{code:'IDEMPOTENCY_CONFLICT'});
 assert.equal(f.provider.acceptedCount(),0);
});
test('anchors, choices and unseen visual claims cannot escape scope; calls are atomic',async t=>{
 const f=fixture(t);
 for(const bad of [f.note({anchor:{shotIds:['shot-1']}}),f.note({anchor:{sceneId:'scene-1'}}),f.note({choices:[{kind:'regenerate_keyframe',shotIds:['shot-1']}]}),f.note({seenKeyframe:{shotId:'shot-0',artifactId:'made-up',sha256:'a'.repeat(64)}})]) await assert.rejects(f.record([f.note(),bad]),{code:'SCOPE_DENIED'});
 await assert.rejects(f.record([f.note({blocking:true,choices:[{kind:'reply'}]})]),{code:'VALIDATION_ERROR'});
 assert.equal(f.store.list('director_note',f.project.id).length,0);
});
test('note domain refusals identify the failed field and correction without losing scope or atomicity',async t=>{
 const f=fixture(t);
 const cases=[
  [f.note({anchor:{shotIds:['shot-1']}}),'SCOPE_DENIED','outside_scope',/\/notes\/1\/anchor\/shotIds.*request.*Read.*shots/i],
  [f.note({choices:[{kind:'regenerate_keyframe',shotIds:['shot-1']}]}),'SCOPE_DENIED','outside_scope',/\/notes\/1\/choices\/0.*anchored shots/i],
  [f.note({blocking:true,choices:[{kind:'reply'}]}),'VALIDATION_ERROR','missing_keep_choice',/\/notes\/1\/choices.*accept.*keep/i],
  [f.note({seenKeyframe:{shotId:'shot-0',artifactId:'made-up',sha256:'a'.repeat(64)}}),'SCOPE_DENIED','unseen_keyframe',/\/notes\/1\/seenKeyframe.*attachedKeyframes/],
 ];
 for(const [bad,code,reason,message] of cases){
  await assert.rejects(f.record([f.note(),bad]),error=>error.code===code&&error.details?.reason===reason&&message.test(error.message));
  assert.deepEqual(f.service.snapshot(f.project.id).turns[0].notesSaveFailure,{code,reason});
 }
 assert.equal(f.store.list('director_note',f.project.id).length,0);
});
test('regeneration choices refuse cross-scene shots at their exact path without saving any notes',async t=>{
 const f=fixture(t,{scope:'project'}),cross=f.note({anchor:{shotIds:['shot-0','shot-1']},choices:[{kind:'regenerate_keyframe',shotIds:['shot-0','shot-1']}]});
 await assert.rejects(f.record([f.note(),cross],'cross-scene'),error=>error.code==='VALIDATION_ERROR'&&error.details?.reason==='invalid_arguments'
   &&/\/notes\/1\/choices\/0\/shotIds.*one scene.*separate choices or notes/i.test(error.message));
 assert.equal(f.store.list('director_note',f.project.id).length,0);
 assert.equal(f.store.list('director_notes_receipt',f.project.id).length,0);
 assert.deepEqual(f.service.snapshot(f.project.id).turns[0].notesSaveFailure,{code:'VALIDATION_ERROR',reason:'invalid_arguments'});
 assert.equal(f.provider.acceptedCount(),0);
});
test('a cross-scene anchor may offer separate feasible regeneration choices per scene',async t=>{
 const f=fixture(t,{scope:'project'}),choices=[{kind:'regenerate_keyframe',shotIds:['shot-0']},{kind:'regenerate_keyframe',shotIds:['shot-1']}];
 await f.record([f.note({anchor:{shotIds:['shot-0','shot-1']},choices})]);
 assert.deepEqual(f.store.list('director_note',f.project.id)[0].choices,choices);
 assert.equal(f.provider.acceptedCount(),0);
});
test('proposal and preparation schema refusals persist safe correctable receipts and never create work',async t=>{
 const f=fixture(t),before=f.store.getProject(f.project.id);
 for(const tool of ['propose_change','prepare_change']){
  const changes={updateShots:[{id:'private-shot',motion:'private motion','private/key~field':'private value'}]};
  const input=tool==='propose_change'?{patch:changes}:{variant:'project',expectedHeadVersion:before.headVersion,creative:changes};
  const invoke=()=>f.tools.invoke(f.project.id,f.bridge.actor,`invalid-${tool}`,tool,input);
  await assert.rejects(invoke(),error=>error.code==='VALIDATION_ERROR'&&new RegExp(`/${tool==='propose_change'?'patch':'creative'}/updateShots/0.*allowed fields:`).test(error.message)&&!/private/.test(error.message));
  const receipt=f.store.list('tool_invocation',f.project.id).find(row=>row.callId===`invalid-${tool}`);
  assert.equal(receipt.state,'failed');assert.equal(receipt.error.code,'VALIDATION_ERROR');
  assert.doesNotMatch(JSON.stringify(receipt),/private/);
  const cursor=f.store.cursor(f.project.id);await assert.rejects(invoke(),{code:'VALIDATION_ERROR'});assert.equal(f.store.cursor(f.project.id),cursor);
  await assert.rejects(f.tools.invoke(f.project.id,f.bridge.actor,`invalid-${tool}`,tool,{...input,extra:'changed'}),{code:'IDEMPOTENCY_CONFLICT'});
 }
 assert.deepEqual(f.store.getProject(f.project.id),before);
 for(const kind of ['prepared','director_proposal','director_note','grant','candidate','attempt'])assert.equal(f.store.list(kind,f.project.id).length,0,kind);
 assert.equal(f.provider.acceptedCount(),0);
});
test('corrected LIVE-3 payload preserves exact seen-keyframe evidence and refuses a fabricated replacement',async t=>{
 const f=fixture(t),seen={shotId:'shot-0',artifactId:'fixture-frame',sha256:'a'.repeat(64)};
 // Synthetic projection tests application identity validation; it makes no visual-quality claim.
 f.store.insert('request_keyframe_projection',f.bridge.actor.requestId,f.project.id,{projectId:f.project.id,epochId:f.bridge.actor.epochId,images:[seen]});
 const note=f.note({text:'[redacted observation]',seenKeyframe:seen,choices:[{kind:'accept',label:'Keep'},{kind:'reply'}]});
 const wrong={...note,anchor:{shotId:'shot-0'}};
 await assert.rejects(f.record([wrong],'live-wrong'),{code:'VALIDATION_ERROR'});
 const saved=await f.record([note],'live-corrected');assert.equal(saved.notes.length,1);
 assert.deepEqual(f.store.list('director_note',f.project.id)[0].seenKeyframe,seen);
 await assert.rejects(f.record([{...note,seenKeyframe:{...seen,artifactId:'another-frame'}}],'fabricated'),{code:'SCOPE_DENIED'});
 assert.equal(f.store.list('director_note',f.project.id).length,1);
});
test('unknown note save is reported as uncertain until exact committed receipt reconciliation',async t=>{
 const f=fixture(t),original=f.store.put.bind(f.store);let fail=true;
 f.store.put=(kind,...args)=>{if(kind==='tool_invocation'&&fail){fail=false;throw Error('lost result');}return original(kind,...args);};
 await assert.rejects(f.record([f.note()],'uncertain'),{code:'TOOL_CALL_UNRESOLVED'});f.store.put=original;
 assert.deepEqual(f.service.snapshot(f.project.id).turns[0].notesSaveFailure,{code:'TOOL_CALL_UNRESOLVED',reason:'unknown'});
 await assert.rejects(f.record([f.note()],'uncertain'),{code:'TOOL_CALL_UNRESOLVED'});
 assert.equal(f.store.list('director_note',f.project.id).length,1);
 const epoch=f.store.get('epoch',f.bridge.actor.epochId);f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'revoked'});
 f.tools.reconcileEpoch(f.project.id,epoch.id);
 assert.equal(f.service.snapshot(f.project.id).turns[0].notesSaveFailure,null);
 assert.equal(f.store.list('director_note',f.project.id).length,1);
});
test('a later successful batch cannot hide an earlier unreconciled note save',async t=>{
 const f=fixture(t),original=f.store.put.bind(f.store);let fail=true;
 f.store.put=(kind,...args)=>{if(kind==='tool_invocation'&&fail){fail=false;throw Error('lost result');}return original(kind,...args);};
 await assert.rejects(f.record([f.note()],'earlier-uncertain'),{code:'TOOL_CALL_UNRESOLVED'});f.store.put=original;
 await f.record([f.note({text:'A separate second point.'})],'later-success');
 assert.deepEqual(f.service.snapshot(f.project.id).turns[0].notesSaveFailure,{code:'TOOL_CALL_UNRESOLVED',reason:'unknown'});
 const epoch=f.store.get('epoch',f.bridge.actor.epochId);f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'revoked'});
 f.tools.reconcileEpoch(f.project.id,epoch.id);
 assert.equal(f.service.snapshot(f.project.id).turns[0].notesSaveFailure,null);
 assert.equal(f.store.list('director_note',f.project.id).length,2);
});
test('a lost note receipt reconciles exact committed effect without invoking again',async t=>{
 const f=fixture(t),original=f.store.put.bind(f.store);let fail=true;
 f.store.put=(kind,...args)=>{if(kind==='tool_invocation'&&fail){fail=false;throw Error('lost result');}return original(kind,...args);};
 await assert.rejects(f.record([f.note()],'lost'),{code:'TOOL_CALL_UNRESOLVED'});f.store.put=original;
 const call=f.store.list('tool_invocation',f.project.id).find(c=>c.callId==='lost');assert.equal(f.store.list('director_note',f.project.id).length,1);
 const epoch=f.store.get('epoch',f.bridge.actor.epochId);f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'revoked'});
 f.tools.reconcileEpoch(f.project.id,epoch.id);f.tools.reconcileEpoch(f.project.id,epoch.id);
 const result=f.store.get('tool_reconciliation',call.id);assert.equal(result.state,'effect_confirmed');assert.equal(result.receipt.notes[0].letter,'a');
});
test('accept is keyed, preserves resolution in context, unaccepted proposals refused and stale accepts refused',async t=>{
 const f=fixture(t),a=(await f.record()).notes[0],input={choiceIndex:0,expectedVersion:1};
 assert.equal((await f.resolve(a.noteId,input,null)).json().error.code,'IDEMPOTENCY_KEY_REQUIRED');
 const accepted=await f.resolve(a.noteId,input);assert.equal(accepted.statusCode,200,accepted.body);assert.equal(accepted.json().state,'resolved');
 assert.deepEqual((await f.resolve(a.noteId,input)).json(),accepted.json());
 assert.equal((await f.resolve(a.noteId,{...input,choiceIndex:1})).json().error.code,'IDEMPOTENCY_CONFLICT');
 assert.deepEqual(f.service.readContext(f.project.id,f.bridge.actor,{section:'notes'}).items[0].resolution,accepted.json().resolution);
 await assert.rejects(f.record([f.note({choices:[{kind:'proposal',proposalId:'future'}]})]),{code:'SCOPE_DENIED'});
 const stale=(await f.record()).notes[0],p=f.store.getProject(f.project.id);f.store.saveProject({...p,shots:p.shots.map(s=>s.id==='shot-0'?{...s,revisionId:randomUUID()}:s)},p.headVersion);
 assert.equal(f.service.snapshot(f.project.id).notes.find(n=>n.noteId===stale.noteId).state,'stale');assert.equal((await f.resolve(stale.noteId,input,'stale')).json().error.code,'NOTE_STALE');
});
test('Keep it rejects every linked held proposal in the same keyed command and leaves unlinked proposals alone',async t=>{
 const f=fixture(t,{editing:true}),propose=motion=>f.tools.invoke(f.project.id,f.bridge.actor,randomUUID(),'propose_change',{patch:{updateShots:[{id:'shot-0',motion}]}});
 const linked=[await propose('Slow drift'),await propose('Hold steady')],unlinked=await propose('Soft tracking');
 const note=(await f.record([f.note({choices:[...linked.map(proposal=>({kind:'proposal',proposalId:proposal.proposalId})),{kind:'accept',label:'Keep it'}]})])).notes[0];
 f.service.releaseFinishedRequestHolds(f.project.id,f.human.requestId);
 assert.equal(f.store.list('hold',f.project.id).filter(hold=>hold.active&&hold.requestId===f.human.requestId).length,0);
 const input={choiceIndex:2,expectedVersion:1},response=await f.resolve(note.noteId,input,'keep');
 assert.equal(response.statusCode,200,response.body);assert.equal(response.json().state,'resolved');
 for(const proposal of linked)assert.equal(f.store.get('director_proposal',proposal.proposalId).state,'rejected');
 assert.equal(f.store.get('director_proposal',unlinked.proposalId).state,'held');
 assert.equal(f.store.list('hold',f.project.id).filter(hold=>hold.active).length,0);
 const cursor=f.store.cursor(f.project.id);assert.deepEqual((await f.resolve(note.noteId,input,'keep')).json(),response.json());assert.equal(f.store.cursor(f.project.id),cursor);
 assert.equal(f.store.readEvents(f.project.id).filter(event=>event.kind==='proposal.changed'&&event.payload.state==='rejected').length,2);
 assert.equal(f.provider.acceptedCount(),0);
});
test('an alternate human field edit rejects a linked stale held proposal only after validating the result',async t=>{
 const f=fixture(t),proposal=await f.tools.invoke(f.project.id,f.bridge.actor,'proposal','propose_change',{patch:{updateShots:[{id:'shot-0',motion:'A slower drift'}]}});
 const note=(await f.record([f.note({choices:[{kind:'proposal',proposalId:proposal.proposalId},{kind:'edit_field',shotId:'shot-0',field:'motion'}]})])).notes[0];
 const input={choiceIndex:1,expectedVersion:1,resultRef:'invented'};
 assert.equal((await f.resolve(note.noteId,input,'invalid-edit')).json().error.code,'NOTE_RESULT_INVALID');
 assert.equal(f.store.get('director_proposal',proposal.proposalId).state,'held');
 const edit=await f.http('POST','/storyboard',{kind:'shot',id:'shot-0',field:'motion',value:'The person chose a still frame',expectedHeadVersion:f.store.getProject(f.project.id).headVersion},'alternate-edit');
 assert.equal(edit.statusCode,200,edit.body);
 assert.equal((await f.http('GET','/director/proposals')).json().proposals[0].state,'stale');
 const resolved=await f.resolve(note.noteId,{...input,resultRef:edit.json().commandId},'valid-edit');assert.equal(resolved.statusCode,200,resolved.body);
 assert.equal(f.store.get('director_proposal',proposal.proposalId).state,'rejected');
 assert.equal(f.store.getProject(f.project.id).shots.find(shot=>shot.id==='shot-0').motion,'The person chose a still frame');
});
test('an alternate human reply rejects its linked held proposal',async t=>{
 const f=fixture(t),proposal=await f.tools.invoke(f.project.id,f.bridge.actor,'proposal','propose_change',{patch:{updateShots:[{id:'shot-0',motion:'Slow drift'}]}});
 const note=(await f.record([f.note({choices:[{kind:'proposal',proposalId:proposal.proposalId},{kind:'reply'}]})])).notes[0];
 const reply=f.service.beginRequest(f.project.id,'local-user','Use the first direction',{editing:false,scopeIds:['shot-0']});
 const resolved=await f.resolve(note.noteId,{choiceIndex:1,expectedVersion:1,resultRef:reply.requestId},'alternate-reply');assert.equal(resolved.statusCode,200,resolved.body);
 assert.equal(f.store.get('director_proposal',proposal.proposalId).state,'rejected');
});
test('a rejection write failure rolls back both the note resolution and proposal changes',async t=>{
 const f=fixture(t),proposal=await f.tools.invoke(f.project.id,f.bridge.actor,'proposal','propose_change',{patch:{updateShots:[{id:'shot-0',motion:'Slow drift'}]}});
 const note=(await f.record([f.note({choices:[{kind:'proposal',proposalId:proposal.proposalId},{kind:'accept',label:'Keep it'}]})])).notes[0],before=f.store.cursor(f.project.id);
 const put=f.store.put.bind(f.store);f.store.put=(kind,...args)=>{if(kind==='director_proposal')throw Error('synthetic write refusal');return put(kind,...args);};
 const input={choiceIndex:1,expectedVersion:1},failed=await f.resolve(note.noteId,input,'atomic-resolution');assert.equal(failed.statusCode,500);f.store.put=put;
 assert.equal(f.store.get('director_note',note.noteId).state,'open');assert.equal(f.store.get('director_proposal',proposal.proposalId).state,'held');assert.equal(f.store.cursor(f.project.id),before);
 const resolved=await f.resolve(note.noteId,input,'atomic-resolution');assert.equal(resolved.statusCode,200,resolved.body);
 assert.equal(f.store.get('director_proposal',proposal.proposalId).state,'rejected');
});
test('blocking open notes gate video on the server and overview; accept unblocks while nonblocking notes stay open',async t=>{
 const f=fixture(t);await f.record();const blocking=(await f.record([f.note({kind:'recommendation',blocking:true})])).notes[0];
 const overview=await f.http('GET','/generation');assert.ok(overview.json().scenes[0].blockers.some(b=>b.code==='recommendation_open'));
 const view=(await f.http('GET','/scenes/scene-0/generation')).json();assert.equal(view.openNotes.length,2);assert.equal(view.blockingNotes.length,1);assert.ok(view.notesDigest);
 const post=()=>f.http('POST','/scenes/scene-0/generate',{kind:'video',headVersion:view.headVersion,revisionId:view.revisionId,reviewedFrames:[],reviewedHoldDigest:view.reviewedHoldDigest,reviewedControlAuthorityId:view.reviewedControlAuthorityId},randomUUID());
 assert.equal((await post()).json().error.code,'RECOMMENDATION_OPEN');await f.resolve(blocking.noteId,{choiceIndex:0,expectedVersion:1});
 assert.ok(!(await f.http('GET','/generation')).json().scenes[0].blockers.some(b=>b.code==='recommendation_open'));
 assert.notEqual((await post()).json().error?.code,'RECOMMENDATION_OPEN');assert.equal(f.provider.acceptedCount(),0);
});
test('fake Scene request emits honest observation and narration recommendation through the tool service',async t=>{
 const f=fixture(t),prepare=createDirectorInput(f.service,{...f.config,endpoint:'http://127.0.0.1:3105'}),input=prepare(f.turn,f.human,f.bridge);
 const result=await new FakeWorkflowDirector(f.service).start(input);assert.match(result.text,/Scripted demo review/);
 const notes=f.service.snapshot(f.project.id).notes;assert.deepEqual(notes.map(n=>n.letter),['a','b']);assert.deepEqual(notes.map(n=>n.kind),['observation','recommendation']);assert.ok(notes[0].choices.some(c=>c.kind==='regenerate_keyframe'));assert.ok(notes[1].choices.some(c=>c.kind==='edit_field'&&c.field==='narration'));assert.equal(f.provider.acceptedCount(),0);
});
test('mutable notes guidance gives a schema-valid example within the exact request scope',t=>{
 const f=fixture(t,{scope:['scene-1']}),prepare=createDirectorInput(f.service,{...f.config,endpoint:'http://127.0.0.1:3105'});
 const guide=JSON.parse(prepare(f.turn,f.human,f.bridge).context).filmPlanning.notes;
 assert.deepEqual(guide.example.notes[0].anchor,{shotIds:['shot-1']});
 assert.deepEqual(parseToolArguments('record_notes',guide.example,'5.0.0').arguments,guide.example);
 assert.match(guide.schema,/anchor\.shotIds.*array.*anchor\.shotId is not/);
 assert.match(guide.limits,/1 to 6.*600.*1 to 4.*1 to 3/);
 assert.match(guide.validation,/within this same turn/);assert.match(guide.validation,/never blindly resubmit an unknown outcome/);
 assert.match(guide.evidence,/exact attachedKeyframes entry/);
});
test('legacy failed note receipts expose a safe fallback without diagnostic text',t=>{
 const f=fixture(t),id=randomUUID();
 f.store.insert('tool_invocation',id,f.project.id,{id,projectId:f.project.id,requestId:f.bridge.actor.requestId,epochId:f.bridge.actor.epochId,
  callId:'legacy',tool:'record_notes',argumentsDigest:'a'.repeat(64),state:'failed',result:null,resultDigest:null,
  error:{code:'VALIDATION_ERROR',message:'private historical diagnostic'}});
 const turn=f.service.snapshot(f.project.id).turns[0];
 assert.deepEqual(turn.notesSaveFailure,{code:'VALIDATION_ERROR',reason:'unavailable'});
 assert.doesNotMatch(JSON.stringify(turn),/private historical diagnostic/);
});
test('resolution requires the matching human edit; stale edit choice resolves with saved resultRef',async t=>{
 const f=fixture(t),n=(await f.record([f.note({choices:[{kind:'edit_field',shotId:'shot-0',field:'imagePrompt'}]})])).notes[0];
 const input={choiceIndex:0,expectedVersion:1,resultRef:'invented'};assert.equal((await f.resolve(n.noteId,input,'bad')).json().error.code,'NOTE_RESULT_INVALID');
 const edit=await f.http('POST','/storyboard',{kind:'shot',id:'shot-0',field:'imagePrompt',value:'A new frame direction',expectedHeadVersion:f.store.getProject(f.project.id).headVersion},'edit');assert.equal(edit.statusCode,200,edit.body);
 const resolved=await f.resolve(n.noteId,{...input,resultRef:edit.json().commandId},'good');assert.equal(resolved.statusCode,200,resolved.body);assert.equal(resolved.json().resolution.resultRef,edit.json().commandId);
});

async function scenePress(f, kind, extra={}) {
 const view=(await f.http('GET','/scenes/scene-0/generation')).json();
 return f.http('POST','/scenes/scene-0/generate',{kind,headVersion:view.headVersion,revisionId:view.revisionId,reviewedHoldDigest:view.reviewedHoldDigest,reviewedControlAuthorityId:view.reviewedControlAuthorityId,
 reviewedFrames:kind==='video'?view.rows.filter(r=>!r.videoComplete).map(r=>({shotId:r.shotId,artifactId:r.image.artifactId,sha256:r.image.sha256})):[],...extra},randomUUID());
}
async function finish(f) {for(let i=0;i<6;i++){await f.engine.runReady();await f.engine.reconcile();}}

test('blocking recommendation allows images, refuses paid video, then accept permits actual fake video',async t=>{
 const f=fixture(t),note=(await f.record([f.note({blocking:true,kind:'recommendation'})])).notes[0];
 const image=await scenePress(f,'image');assert.equal(image.statusCode,200,image.body);await finish(f);
 const before=f.provider.acceptedCount();assert.equal(before,1);
 assert.equal((await scenePress(f,'video')).json().error.code,'RECOMMENDATION_OPEN');assert.equal(f.provider.acceptedCount(),before);
 const staleDigest=(await f.http('GET','/scenes/scene-0/generation')).json().notesDigest;
 await f.resolve(note.noteId,{choiceIndex:0,expectedVersion:1});
 assert.equal((await scenePress(f,'video',{notesDigest:staleDigest})).json().error.code,'SCENE_REVIEW_STALE');
 const video=await scenePress(f,'video');assert.equal(video.statusCode,200,video.body);await finish(f);assert.equal(f.provider.acceptedCount(),before+1);
});
test('regenerate choice accepts only the subsequent exact human regeneration press, never starts work itself',async t=>{
 const f=fixture(t),note=(await f.record([f.note({choices:[{kind:'regenerate_keyframe',shotIds:['shot-0']}]})])).notes[0];
 const image=await scenePress(f,'image');assert.equal(image.statusCode,200,image.body);await finish(f);
 const input={choiceIndex:0,expectedVersion:1,resultRef:image.json().requestId};
 assert.equal((await f.resolve(note.noteId,input,'ordinary-image')).json().error.code,'NOTE_RESULT_INVALID');
 const regen=await scenePress(f,'image',{regenerate:true,targetShotIds:['shot-0']});assert.equal(regen.statusCode,200,regen.body);
 const before=f.provider.acceptedCount(),resolved=await f.resolve(note.noteId,{...input,resultRef:regen.json().requestId},'regeneration');
 assert.equal(resolved.statusCode,200,resolved.body);assert.equal(resolved.json().resolution.resultRef,regen.json().requestId);assert.equal(f.provider.acceptedCount(),before);
});
test('an alternate human keyframe regeneration rejects the linked held proposal without dispatching extra work',async t=>{
 const f=fixture(t),proposal=await f.tools.invoke(f.project.id,f.bridge.actor,'proposal','propose_change',{patch:{updateShots:[{id:'shot-0',motion:'Slow drift'}]}});
 const note=(await f.record([f.note({choices:[{kind:'proposal',proposalId:proposal.proposalId},{kind:'regenerate_keyframe',shotIds:['shot-0']}]})])).notes[0];
 const image=await scenePress(f,'image');assert.equal(image.statusCode,200,image.body);await finish(f);
 const regen=await scenePress(f,'image',{regenerate:true,targetShotIds:['shot-0']});assert.equal(regen.statusCode,200,regen.body);
 const before=f.provider.acceptedCount(),resolved=await f.resolve(note.noteId,{choiceIndex:1,expectedVersion:1,resultRef:regen.json().requestId},'alternate-regeneration');
 assert.equal(resolved.statusCode,200,resolved.body);assert.equal(f.provider.acceptedCount(),before);
 assert.equal(f.store.get('director_proposal',proposal.proposalId).state,'rejected');
});
test('reply choices require a saved human reply and preserve it in the resolution',async t=>{
 const f=fixture(t),note=(await f.record([f.note({choices:[{kind:'reply'}]})])).notes[0],input={choiceIndex:0,expectedVersion:1};
 assert.equal((await f.resolve(note.noteId,input,'missing-reply')).json().error.code,'NOTE_RESULT_INVALID');
 const reply=f.service.beginRequest(f.project.id,'local-user','Keep the quiet opening',{editing:false,scopeIds:['shot-0']});
 const resolved=await f.resolve(note.noteId,{...input,resultRef:reply.requestId},'reply');assert.equal(resolved.statusCode,200,resolved.body);
});

test('seen frame sha changes stale a note without a shot edit; identical bytes keep it current',async t=>{
 const f=fixture(t),seen={shotId:'shot-0',artifactId:'frame-1',sha256:'a'.repeat(64)};
 // Trusted projection fixture models the frozen turn-start vision receipt; no image provider or native model is called.
 const id=randomUUID();f.store.insert('request_keyframe_projection',f.human.requestId,f.project.id,{id:f.human.requestId,projectId:f.project.id,requestId:f.human.requestId,epochId:f.bridge.actor.epochId,images:[{...seen,nodeId:'frame-node',candidateId:null,thumbnailSha256:'c'.repeat(64),tile:0}]});
 const p=f.store.getProject(f.project.id);f.store.saveProject({...p,activePlanId:'frame-plan'},p.headVersion);
 const binding={id:'frame-node',state:'active',planId:'frame-plan',node:{shotId:'shot-0',kind:'image'},outputs:{image:{artifactId:'frame-1',sha256:seen.sha256}}};
 f.store.insert('node_binding',binding.id,f.project.id,binding);
 const note=(await f.record([f.note({seenKeyframe:seen})])).notes[0];assert.equal(directorNotes(f.store,f.project.id)[0].state,'open');
 f.store.put('node_binding',binding.id,f.project.id,{...binding,outputs:{image:{artifactId:'same-bytes',sha256:seen.sha256}}});assert.equal(directorNotes(f.store,f.project.id)[0].state,'open');
 f.store.put('node_binding',binding.id,f.project.id,{...binding,outputs:{image:{artifactId:'new-frame',sha256:'b'.repeat(64)}}});assert.equal(directorNotes(f.store,f.project.id)[0].state,'stale');
 assert.equal((await f.resolve(note.noteId,{choiceIndex:0,expectedVersion:1})).json().error.code,'NOTE_STALE');
});
test('letters continue beyond z and notes context pages include all complete records',async t=>{
 const f=fixture(t);for(let i=0;i<5;i++)await f.record(Array.from({length:6},()=>f.note()));
 const notes=f.service.snapshot(f.project.id).notes;assert.equal(notes.length,30);assert.deepEqual(notes.slice(25,29).map(n=>n.letter),['z','aa','ab','ac']);
 const a=f.service.readContext(f.project.id,f.bridge.actor,{section:'notes'}),b=f.service.readContext(f.project.id,f.bridge.actor,{section:'notes',offset:a.page.nextOffset});
 assert.deepEqual([...a.items,...b.items],notes);assert.equal(a.guard.dataDigest,b.guard.dataDigest);
});
