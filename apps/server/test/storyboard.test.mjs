import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
import { editStoryboard } from '../dist/storyboard.js';
import { shotIntentDigest } from '@openslate/core';
function fixture(t) {
 const f=setup(t), service=new ProductionService(f.store,f.engine),token=randomBytes(32).toString('base64url');
 const app=createApp({service,localToken:token});t.after(()=>app.close());
 const edit=(body,key=randomUUID())=>editStoryboard(service,f.projectId,{expectedHeadVersion:f.store.getProject(f.projectId).headVersion,...body},key);
 return {...f,service,app,edit,token};
}
test('direct edit is durable, idempotent, preserves old epochs and never mints grants', async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),actor=f.service.beginRequest(f.projectId,'local-user','old direction',{editing:true}),epoch=f.service.openEpoch(f.projectId,actor), grants=f.store.list('grant',f.projectId).length;
 const body={kind:'shot',id:p.shots[0].id,field:'framing',value:'Close detail',expectedHeadVersion:p.headVersion},key=randomUUID();
 const receipt=f.edit(body,key);assert.equal(f.store.getProject(f.projectId).shots[0].framing,'Close detail');assert.deepEqual(f.edit(body,key),receipt);
 assert.equal(f.store.get('epoch',epoch.actor.epochId).state,'active');assert.equal(f.store.get('message',actor.requestId).state,'active');assert.equal(f.store.list('grant',f.projectId).length,grants);assert.equal(f.engine.attempts(f.projectId).length,0);
 assert.throws(()=>f.edit({...body,value:'stale'}),e=>e.code==='REVISION_CONFLICT');
});
test('reorder and delete/undo retain stable identities and narration, protect newer changes',t=>{
 const f=fixture(t),a=f.store.getProject(f.projectId).shots[0],b=f.store.getProject(f.projectId).shots[1];
 f.edit({kind:'narration',id:a.id,field:'mode',value:'generated'});f.edit({kind:'narration',id:a.id,field:'text',value:'Morning light.'});
 f.edit({kind:'moveShot',id:a.id,sceneId:b.sceneId});let p=f.store.getProject(f.projectId);assert.deepEqual(p.shots.map(x=>x.id),[b.id,a.id]);assert.equal(p.shots[1].narration.text,'Morning light.');
 const removed=f.edit({kind:'deleteShot',id:a.id});assert.equal(f.store.getProject(f.projectId).shots.length,1);f.edit({kind:'undo',commandId:removed.commandId});assert.equal(f.store.getProject(f.projectId).shots[1].id,a.id);
 assert.throws(()=>f.edit({kind:'undo',commandId:removed.commandId}),e=>e.code==='UNDO_UNAVAILABLE');
});
test('shot change detaches only affected candidates; motion preserves image and other shot',t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),prior=f.store.list('node_binding',f.projectId);
 f.edit({kind:'shot',id:p.shots[0].id,field:'motion',value:'Pan right'});
 for(const b of prior){const next=f.store.get('node_binding',b.id);assert.equal(next.candidateId,b.node.shotId===p.shots[0].id&&b.node.kind==='video'?null:b.candidateId);}
});
test('invalid commands roll back all records; stopped project stays stopped',t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),cursor=f.store.cursor(f.projectId);
 assert.throws(()=>f.edit({kind:'moveShot',id:p.shots[0].id,sceneId:'foreign'}));assert.equal(f.store.cursor(f.projectId),cursor);
 assert.throws(()=>f.edit({kind:'shot',id:p.shots[0].id,field:'desiredFrames',value:'Infinity'}));
 f.engine.setPaused(f.projectId,true,'stop');f.edit({kind:'scene',id:p.scenes[0].id,value:'Revised scene'});assert.equal(f.store.get('execution_control',f.projectId).paused,true);
});
test('HTTP direct-edit route requires authentication, revision and command identity',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),url=`/api/projects/${f.projectId}/storyboard`,body={kind:'addScene',expectedHeadVersion:p.headVersion};
 const call=(headers,payload=body)=>f.app.inject({method:'POST',url,headers:{host:'127.0.0.1',...headers},payload});
 assert.equal((await call({})).statusCode,403);
 const headers={authorization:`Bearer ${f.token}`,'idempotency-key':randomUUID()};assert.equal((await call(headers,{...body,extra:true})).statusCode,400);
 assert.equal((await call(headers)).statusCode,200);assert.equal(f.store.getProject(f.projectId).scenes.length,3);
});
test('direct edits retain their own scope without claiming unrelated conversation holds',t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId);
 const unrelated=f.service.beginRequest(f.projectId,'local-user','Independent second-shot edit',{editing:true,scopeIds:[p.shots[1].id]});
 const first=f.edit({kind:'shot',id:p.shots[0].id,field:'purpose',value:'First change'});
 const second=f.edit({kind:'shot',id:p.shots[0].id,field:'motion',value:'Second change'});
 const holds=f.store.list('hold',f.projectId).filter(x=>x.active);
 assert.ok(holds.some(x=>x.ownerId===unrelated.requestId));assert.ok(!holds.some(x=>x.ownerId===second.requestId));assert.equal(f.store.get('message',unrelated.requestId).state,'active');assert.ok(!holds.some(x=>x.ownerId===first.requestId));
 const view=f.service.snapshot(f.projectId);assert.equal(view.latestStoryboardEdit.requestId,second.requestId);
 assert.ok(!view.conversation.some(x=>x.requestId===second.requestId));assert.ok(view.conversation.some(x=>x.requestId===unrelated.requestId));
});
test('late provider completion after a direct edit is retained but cannot republish the old image',async t=>{
 const f=fixture(t);await f.engine.runReady();const attempts=f.engine.attempts(f.projectId).length;
 f.edit({kind:'shot',id:'shot-0',field:'framing',value:'Changed after submit'});await f.engine.reconcile();
 assert.equal(f.engine.attempts(f.projectId).length,attempts);assert.equal(f.store.list('artifact',f.projectId).length,2);
 assert.equal(f.engine.outputs(f.projectId).length,1);assert.equal(f.engine.outputs(f.projectId)[0].nodeId,f.plan.nodes.find(n=>n.shotId==='shot-1'&&n.kind==='image').id);
 assert.equal((await f.engine.runReady()).dispatched,0);
});
test('soundtrack rejects another project recording and out-of-range gain atomically',t=>{
 const f=fixture(t),head=f.store.getProject(f.projectId).headVersion;
 const other=f.service.createProject('Other');f.store.insert('narration_audio','foreign',other.id,{id:'foreign',projectId:other.id,media:{kind:'audio'}});
 assert.throws(()=>f.edit({kind:'soundtrack',field:'audioId',value:'foreign'}),e=>e.code==='NOT_FOUND');assert.equal(f.store.getProject(f.projectId).headVersion,head);
 f.store.insert('narration_audio','owned',f.projectId,{id:'owned',projectId:f.projectId,media:{kind:'audio'}});
 f.edit({kind:'soundtrack',field:'audioId',value:'owned'});assert.throws(()=>f.edit({kind:'soundtrack',field:'gainMilliDb',value:'1'}));
 assert.equal(f.store.getProject(f.projectId).soundtrack.gainMilliDb,-18000);
 f.edit({kind:'soundtrack',field:'audioId',value:''});assert.equal(f.store.getProject(f.projectId).soundtrack,null);
});

test('no narration detaches just the selected cue and video while retaining frames, other shots and canonical history', t=>{
 const f=fixture(t), p=f.store.getProject(f.projectId), cue={id:'cue',meaning:'Boot',durationFrames:180,placementFrames:0,audio:{artifactId:'a',sha256:'a'.repeat(64),kind:'audio'},accepted:true,measured:true};
 p.shots[0].cueId=cue.id;p.cues=[cue];f.store.saveProject(p,p.headVersion);
 f.store.insert('narration_canonical','canonical',f.projectId,{id:'canonical',projectId:f.projectId,segments:[{cue}]});
 const bindings=f.store.list('node_binding',f.projectId),receipt=f.edit({kind:'narration',id:'shot-0',field:'mode',value:'none'}),next=f.store.getProject(f.projectId);
 assert.equal(next.shots[0].cueId,null);assert.deepEqual(next.cues,[cue]);assert.equal(f.store.get('narration_canonical','canonical').segments.length,1);
 for(const b of bindings){const current=f.store.get('node_binding',b.id);assert.equal(current.candidateId,b.node.shotId==='shot-0'&&b.node.kind==='video'?null:b.candidateId);}
 f.edit({kind:'undo',commandId:receipt.commandId});assert.equal(f.store.getProject(f.projectId).shots[0].cueId,cue.id);
});

test('removing ordinary voiceover preserves its already generated picture and visual revision',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),shot=p.shots[0],cue={id:'overlay-cue',meaning:'Short voiceover',durationFrames:30,placementFrames:0,audio:{artifactId:'voice',sha256:'a'.repeat(64),kind:'audio'},accepted:true,measured:true};
 shot.narrationTimingMode='within_shot';shot.narration={mode:'uploaded',text:'A short line.',voice:'stock'};shot.cueId=cue.id;p.cues=[cue];shot.promptIntent.video=shotIntentDigest(shot,'video',cue);f.store.saveProject(p,p.headVersion);
 await f.engine.runReady();await f.engine.reconcile();const review=f.engine.reviewSnapshot(f.projectId);f.engine.approve(f.projectId,review.id,review.members.map(row=>row.videoNodeId),'fixture-review');await f.engine.runReady();await f.engine.reconcile();
 const before=f.engine.outputs(f.projectId),revision=shot.revisionId,video=f.plan.nodes.find(node=>node.kind==='video'&&node.shotId===shot.id),take=before.find(output=>output.nodeId===video.id);assert.ok(take);
 f.edit({kind:'narration',id:shot.id,field:'mode',value:'none'});const after=f.store.getProject(f.projectId);
 assert.equal(after.shots[0].cueId,null);assert.equal(after.shots[0].revisionId,revision);assert.equal(f.engine.outputs(f.projectId).find(output=>output.nodeId===video.id).artifact.artifactId,take.artifact.artifactId);assert.deepEqual(after.cues,p.cues);
});

test('explicit video prompt writing preserves the exact frame, sibling results, narration and original execution receipts', async t => {
 const f=fixture(t);await f.engine.runReady();await f.engine.reconcile();
 const review=f.engine.reviewSnapshot(f.projectId);f.engine.approve(f.projectId,review.id,review.members.map(row=>row.videoNodeId),'fixture-video-review');
 await f.engine.runReady();await f.engine.reconcile();
 const before=f.store.getProject(f.projectId),prior=f.store.list('node_binding',f.projectId),attempts=f.engine.attempts(f.projectId),
   oldShot=before.shots[0],grants=f.store.list('grant',f.projectId).length;
 const receipt=f.edit({kind:'shot',id:oldShot.id,field:'videoPrompt',value:'Human-authored slow orbit with a locked product position'});
 const next=f.store.getProject(f.projectId).shots[0];
 assert.equal(next.videoPrompt,'Human-authored slow orbit with a locked product position');
 assert.equal(next.imagePrompt,oldShot.imagePrompt);assert.deepEqual(next.promptIntent,oldShot.promptIntent);
 assert.deepEqual(next.narration,oldShot.narration);assert.equal(next.cueId,oldShot.cueId);assert.notEqual(next.revisionId,oldShot.revisionId);
 for(const binding of prior){const current=f.store.get('node_binding',binding.id);
   if(binding.node.shotId===oldShot.id&&binding.node.kind==='video'){assert.equal(current.candidateId,null);assert.deepEqual(current.outputs,{});}
   else {assert.equal(current.candidateId,binding.candidateId);assert.deepEqual(current.outputs,binding.outputs);}}
 assert.deepEqual(f.engine.attempts(f.projectId),attempts);assert.equal(f.store.list('grant',f.projectId).length,grants);
 assert.ok(receipt.commandId);
});

test('explicit image prompt writing invalidates its frame and dependent video without changing video prose or audio writing', async t => {
 const f=fixture(t);await f.engine.runReady();await f.engine.reconcile();
 const before=f.store.getProject(f.projectId),prior=f.store.list('node_binding',f.projectId),shot=before.shots[0];
 // The other prompt's provenance can be stale; editing an image cannot silently authenticate it.
 shot.promptIntent.video='a'.repeat(64);shot.narration={mode:'generated',text:'Saved words',voice:'stock'};
 f.store.saveProject(before,before.headVersion);
 const body={kind:'shot',id:shot.id,field:'imagePrompt',value:'  Human-authored leather macro with side light  ',expectedHeadVersion:before.headVersion+1},key=randomUUID();
 const receipt=f.edit(body,key);assert.deepEqual(f.edit(body,key),receipt);
 const next=f.store.getProject(f.projectId).shots[0];
 assert.equal(next.imagePrompt,'Human-authored leather macro with side light');assert.equal(next.videoPrompt,shot.videoPrompt);
 assert.equal(next.promptIntent.image,shotIntentDigest(next,'image'));assert.equal(next.promptIntent.video,'a'.repeat(64));
 assert.deepEqual(next.narration,shot.narration);assert.equal(next.cueId,shot.cueId);
 for(const binding of prior){const current=f.store.get('node_binding',binding.id);
   if(binding.node.shotId===shot.id){assert.equal(current.candidateId,null);assert.deepEqual(current.outputs,{});}
   else {assert.equal(current.candidateId,binding.candidateId);assert.deepEqual(current.outputs,binding.outputs);}}
 assert.equal(f.engine.attempts(f.projectId).length,2);
});

test('direct shot action editing reauthors current visual prompts and keeps saved independent reference details', t => {
 const f=fixture(t),before=f.store.getProject(f.projectId),shot=before.shots[0];
 f.edit({kind:'shot',id:shot.id,field:'action',value:'Rotate the boot on the display stand'});
 const next=f.store.getProject(f.projectId).shots[0];
 assert.equal(next.action,'Rotate the boot on the display stand');
 assert.match(next.imagePrompt,/Rotate the boot on the display stand/);assert.ok(next.imagePrompt.endsWith(shot.imagePrompt));
 assert.match(next.videoPrompt,/Rotate the boot on the display stand/);assert.ok(next.videoPrompt.endsWith(shot.videoPrompt));
 assert.equal(next.promptIntent.image,shotIntentDigest(next,'image'));assert.equal(next.promptIntent.video,shotIntentDigest(next,'video'));
 assert.deepEqual(next.referenceArtifactIds,shot.referenceArtifactIds);
});

test('prompt writing through HTTP uses exact command identity, rejects stale or blank input and creates no generation authority', async t => {
 const f=fixture(t),p=f.store.getProject(f.projectId),key=randomUUID(),body={kind:'shot',id:'shot-0',field:'imagePrompt',value:'Direct human frame text',expectedHeadVersion:p.headVersion},
   headers={host:'127.0.0.1',authorization:`Bearer ${f.token}`,'idempotency-key':key},url=`/api/projects/${f.projectId}/storyboard`,grants=f.store.list('grant',f.projectId).length;
 const response=await f.app.inject({method:'POST',url,headers,payload:body});assert.equal(response.statusCode,200,response.body);
 assert.deepEqual((await f.app.inject({method:'POST',url,headers,payload:body})).json(),response.json());
 assert.equal((await f.app.inject({method:'POST',url,headers:{...headers,'idempotency-key':randomUUID()},payload:body})).json().error.code,'REVISION_CONFLICT');
 const current=f.store.getProject(f.projectId),cursor=f.store.cursor(f.projectId);
 const blank=await f.app.inject({method:'POST',url,headers:{...headers,'idempotency-key':randomUUID()},payload:{...body,expectedHeadVersion:current.headVersion,value:'   '}});
 assert.equal(blank.json().error.code,'VALIDATION_ERROR');assert.equal(f.store.cursor(f.projectId),cursor);
 assert.equal(f.store.list('grant',f.projectId).length,grants);assert.equal(f.engine.attempts(f.projectId).length,0);
});


test('duration edit holds only its detached shot during commit, keeps a running turn and permits another shot to dispatch', async t => {
 const f=fixture(t), p=f.store.getProject(f.projectId);
 const actor=f.service.beginRequest(f.projectId,'local-user','Work on shot 0',{scopeIds:['shot-0']});
 const epoch=f.service.openEpoch(f.projectId,actor);
 f.store.insert('director_turn','running-turn',f.projectId,{id:'running-turn',requestId:actor.requestId,epochId:epoch.actor.epochId,state:'running'});
 const save=f.store.saveProject.bind(f.store);let captured;
 f.store.saveProject=(project,version)=>{
   captured=f.store.list('hold',f.projectId).filter(h=>h.active && h.ownerId!==actor.requestId);
   assert.deepEqual(captured.map(h=>h.scopeId),['shot-0']);
   return save(project,version);
 };
 const receipt=f.edit({kind:'shot',id:p.shots[0].id,field:'desiredFrames',value:'240'});
 assert.equal(captured[0].ownerId,receipt.requestId);
 assert.equal(f.store.get('hold',captured[0].id).active,false);
 assert.equal(f.store.get('director_turn','running-turn').state,'running');
 assert.equal(f.store.get('epoch',epoch.actor.epochId).state,'active');
 assert.equal(f.store.get('message',actor.requestId).state,'active');
 assert.ok(!f.store.list('hold',f.projectId).some(h=>h.scopeId===f.projectId));
 assert.equal((await f.engine.runReady()).dispatched,1);
 assert.equal(f.engine.attempts(f.projectId)[0].nodeId,f.plan.nodes.find(n=>n.shotId==='shot-1'&&n.kind==='image').id);
});

for(const kind of ['soundtrack','moveShot','addScene','addShot']) test(`${kind} places no hold and leaves Director authority alone`,t=>{
 const f=fixture(t), p=f.store.getProject(f.projectId),actor=f.service.beginRequest(f.projectId,'local-user','Keep working',{editing:false}),epoch=f.service.openEpoch(f.projectId,actor);
 const edits={soundtrack:{field:'audioId',value:''},moveShot:{id:'shot-0',sceneId:'scene-1'},addScene:{value:'New scene'},addShot:{sceneId:'scene-0'}};
 f.edit({kind,...edits[kind]});
 assert.deepEqual(f.store.list('hold',f.projectId),[]);
 assert.equal(f.store.get('epoch',epoch.actor.epochId).state,'read_only');
 assert.equal(f.store.get('message',actor.requestId).state,'active');
});

for(const kind of ['treatment:brief','treatment:story','scene']) test(`${kind} preserves paid shot outputs whose intent did not change and detaches assembly`,async t=>{
 const f=fixture(t);await f.engine.runReady();await f.engine.reconcile();
 const review=f.engine.reviewSnapshot(f.projectId);f.engine.approve(f.projectId,review.id,review.members.map(m=>m.videoNodeId),'test');await f.engine.runReady();await f.engine.reconcile();
 const p=f.store.getProject(f.projectId), bindings=f.store.list('node_binding',f.projectId), outputs=f.engine.outputs(f.projectId);
 // Include assembly bindings without paying for another operation.
 for(const nodeKind of ['timeline','render']) f.store.insert('node_binding',nodeKind,f.projectId,{...bindings[0],id:nodeKind,node:{...bindings[0].node,id:nodeKind,kind:nodeKind,shotId:null}});
 const [command,field]=kind.split(':');
 f.edit({kind:command,...(field?{field}:{}),id:'scene-0',value:'New wording, same picture intent'});
 for(const b of bindings) assert.deepEqual(f.store.get('node_binding',b.id),b);
 assert.deepEqual(f.engine.outputs(f.projectId),outputs);
 for(const nodeKind of ['timeline','render']) {const b=f.store.get('node_binding',nodeKind);assert.equal(b.candidateId,null);assert.deepEqual(b.outputs,{});}
 assert.deepEqual(f.store.getProject(f.projectId).shots,p.shots);
 assert.ok(!f.store.list('hold',f.projectId).some(h=>h.active));
});

test('shot hold and binding detachment roll back when commit fails, and the same identity can retry',t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),records=f.store.list('node_binding',f.projectId),cursor=f.store.cursor(f.projectId),save=f.store.saveProject.bind(f.store),key=randomUUID();
 const body={kind:'shot',id:'shot-0',field:'motion',value:'Pan',expectedHeadVersion:p.headVersion};
 f.store.saveProject=()=>{throw new Error('write failed');};
 assert.throws(()=>f.edit(body,key),/write failed/);
 assert.equal(f.store.cursor(f.projectId),cursor);assert.deepEqual(f.store.list('hold',f.projectId),[]);assert.deepEqual(f.store.list('node_binding',f.projectId),records);
 f.store.saveProject=save;f.edit(body,key);assert.ok(!f.store.list('hold',f.projectId).some(h=>h.active));
});

test('duration below accepted within-shot narration returns 409 with exact frame details and makes no writes',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),cue={id:'accepted-voice',meaning:'Voice',durationFrames:210,placementFrames:0,accepted:true,measured:true};
 p.cues=[cue];p.shots[0].cueId=cue.id;p.shots[0].narrationTimingMode='within_shot';p.shots[0].desiredFrames=240;f.store.saveProject(p,p.headVersion);
 const head=f.store.getProject(f.projectId).headVersion,cursor=f.store.cursor(f.projectId),body={kind:'shot',id:'shot-0',field:'desiredFrames',value:'180',expectedHeadVersion:head};
 const response=await f.app.inject({method:'POST',url:`/api/projects/${f.projectId}/storyboard`,headers:{host:'127.0.0.1',authorization:`Bearer ${f.token}`,'idempotency-key':randomUUID()},payload:body});
 assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'SHOT_SHORTER_THAN_NARRATION');assert.deepEqual(response.json().error.details,{shotId:'shot-0',narrationFrames:210,requestedFrames:180});
 assert.equal(f.store.cursor(f.projectId),cursor);assert.equal(f.store.getProject(f.projectId).headVersion,head);
 f.edit({...body,value:'210'});assert.equal(f.store.getProject(f.projectId).shots[0].desiredFrames,210);
});

test('duration floor ignores unaccepted or other-shot cues',t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId);
 p.cues=[{id:'draft',meaning:'Draft',durationFrames:300,accepted:false},{id:'other',meaning:'Other line',durationFrames:400,accepted:true}];
 p.shots[0].cueId='draft';p.shots[0].narrationTimingMode='within_shot';p.shots[1].cueId='other';f.store.saveProject(p,p.headVersion);
 f.edit({kind:'shot',id:'shot-0',field:'desiredFrames',value:'120'});assert.equal(f.store.getProject(f.projectId).shots[0].desiredFrames,120);
});

test('scene titles preserve every binding and hold; overview and Director context use the title', async t => {
 const f=fixture(t),p=f.store.getProject(f.projectId);
 const sample=f.store.list('node_binding',f.projectId)[0];f.store.insert('node_binding','assembly-title-test',p.id,{...sample,id:'assembly-title-test',node:{...sample.node,id:'assembly-title-test',kind:'timeline',shotId:null,shotRevisionId:null}});
 const bindings=f.store.list('node_binding',f.projectId),holds=f.store.list('hold',f.projectId);
 f.edit({kind:'sceneTitle',id:p.scenes[0].id,value:'Harbour at dawn'});
 assert.deepEqual(f.store.list('node_binding',f.projectId),bindings);assert.deepEqual(f.store.list('hold',f.projectId),holds);
 const { DEFAULT_PROFILES }=await import("@openslate/core");f.store.insert("capability_lock",p.capabilityLockId,p.id,{profiles:DEFAULT_PROFILES});
 const overview=await f.app.inject({url:`/api/projects/${f.projectId}/generation`,headers:{host:'127.0.0.1',authorization:`Bearer ${f.token}`}});
 assert.equal(overview.statusCode,200,overview.body);assert.equal(overview.json().scenes[0].title,'Harbour at dawn');
 const { projectDirectorContext }=await import('../dist/application/context-projection.js');
 const human=f.service.beginRequest(f.projectId,'local-user','Read scenes',{editing:false});
 assert.equal(projectDirectorContext(f.service,f.projectId,human).project.scenes[0].title,'Harbour at dawn');
 assert.equal(projectDirectorContext(f.service,f.projectId,human,{section:'scenes'}).items[0].title,'Harbour at dawn');
});
test('scene deletion requires withShots, refuses unresolved attempts, detaches shots and preserves library takes',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),scene=p.scenes[0];
 assert.throws(()=>f.edit({kind:'deleteScene',id:scene.id}),e=>e.code==='SCENE_HAS_SHOTS');
 await f.engine.runReady();
 assert.throws(()=>f.edit({kind:'deleteScene',id:scene.id,withShots:true}),e=>e.code==='ATTEMPTS_RUNNING');
 await f.engine.reconcile();const artifacts=f.store.list('artifact',f.projectId);
 f.edit({kind:'deleteScene',id:scene.id,withShots:true});
 const next=f.store.getProject(f.projectId);assert.equal(next.scenes.length,1);assert.equal(next.shots.length,1);
 assert.deepEqual(f.store.list('artifact',f.projectId),artifacts);
 const {projectAssets}=await import('../dist/asset-library.js');
 const retained=projectAssets(f.service,next).find(x=>x.shotId===p.shots[0].id);
 assert.ok(retained);assert.equal(retained.sceneId,scene.id);assert.equal(retained.current,false);
 f.edit({kind:'addScene'});const empty=f.store.getProject(f.projectId).scenes.at(-1);
 f.edit({kind:'deleteScene',id:empty.id});assert.equal(f.store.getProject(f.projectId).scenes.length,1);
});
test('scene reorder changes film order and shot-relative audio placement without touching shot media',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),bindings=f.store.list('node_binding',f.projectId);
 f.edit({kind:'moveScene',id:p.scenes[1].id,beforeId:p.scenes[0].id});
 const next=f.store.getProject(f.projectId);assert.deepEqual(next.scenes.map(x=>x.id),[p.scenes[1].id,p.scenes[0].id]);
 assert.deepEqual(next.shots,p.shots);assert.deepEqual(f.store.list('node_binding',f.projectId),bindings);
 assert.throws(()=>f.edit({kind:'moveScene',id:p.scenes[0].id,beforeId:p.scenes[0].id}),e=>e.code==='VALIDATION_ERROR');
 f.edit({kind:'moveScene',id:p.scenes[1].id});assert.deepEqual(f.store.getProject(f.projectId).scenes.map(x=>x.id),p.scenes.map(x=>x.id));
});
test('new scene commands validate HTTP fields and enforce the 64 scene cap atomically',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId);
 const call=payload=>f.app.inject({method:'POST',url:`/api/projects/${f.projectId}/storyboard`,headers:{host:'127.0.0.1',authorization:`Bearer ${f.token}`,'idempotency-key':randomUUID()},payload:{expectedHeadVersion:f.store.getProject(f.projectId).headVersion,...payload}});
 assert.equal((await call({kind:'sceneTitle',id:p.scenes[0].id,value:'Named scene'})).statusCode,200);
 assert.equal((await call({kind:'deleteScene',id:p.scenes[0].id,withShots:'true'})).statusCode,400);
 assert.equal((await call({kind:'sceneTitle',id:p.scenes[0].id,value:'  '})).statusCode,400);
 let next=f.store.getProject(f.projectId);next.scenes=Array.from({length:64},(_,i)=>({id:`cap-${i}`,revisionId:randomUUID(),purpose:'Scene'}));f.store.saveProject(next,next.headVersion);
 const before=f.store.getProject(f.projectId);assert.equal((await call({kind:'addScene'})).statusCode,400);assert.deepEqual(f.store.getProject(f.projectId),before);
});
test('personal narration is refused without a ready owned voice',t=>{
 const f=fixture(t),before=f.store.getProject(f.projectId);
 assert.throws(()=>f.edit({kind:'narration',id:before.shots[0].id,field:'voice',value:'personal'}),e=>e.code==='PERSONAL_VOICE_REQUIRED');
 assert.deepEqual(f.store.getProject(f.projectId),before);
});
for(const kind of ['sceneTitle','moveScene','deleteScene']) test(`${kind} is an alongside hand edit and preserves a running Director's authority and holds`,t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),human=f.service.beginRequest(p.id,'local-user','Keep planning this film'),bridge=f.service.openEpoch(p.id,human),holds=f.store.list('hold',p.id);
 const edits={sceneTitle:{id:p.scenes[0].id,value:'Human title'},moveScene:{id:p.scenes[1].id,beforeId:p.scenes[0].id},deleteScene:{id:p.scenes[0].id,withShots:true}};
 const receipt=f.edit({kind,...edits[kind]});
 assert.equal(f.store.get('message',receipt.requestId).concurrency,'alongside');assert.equal(f.store.get('message',human.requestId).state,'active');assert.equal(f.store.get('epoch',bridge.actor.epochId).state,'active');
 assert.deepEqual(f.store.list('hold',p.id),holds);
 const row=f.store.get('storyboard_edit',receipt.commandId);assert.ok(row.undo);assert.equal(row.input.kind,kind);
});
test('scene deletion and its restoring Undo fence older Director shot fields even when the old values return',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),human=f.service.beginRequest(p.id,'local-user','Keep planning'),bridge=f.service.openEpoch(p.id,human);
 f.store.insert('director_context','before-scene-delete',p.id,{requestId:human.requestId,epochId:bridge.actor.epochId,snapshot:{cursor:f.store.cursor(p.id)}});
 const removed=f.edit({kind:'deleteScene',id:p.scenes[0].id,withShots:true});
 const prepare=()=>f.service.prepare(p.id,bridge.actor,{variant:'project',expectedHeadVersion:f.store.getProject(p.id).headVersion,creative:{updateShots:[{id:p.shots[0].id,motion:'Old Director plan',reauthorPrompts:true}]}});
 await assert.rejects(prepare(),{code:'HUMAN_EDITED_FIELD'});
 f.edit({kind:'undo',commandId:removed.commandId});assert.equal(f.store.getProject(p.id).shots[0].motion,p.shots[0].motion);
 await assert.rejects(prepare(),{code:'HUMAN_EDITED_FIELD'});assert.equal(f.store.get('epoch',bridge.actor.epochId).state,'active');
});
