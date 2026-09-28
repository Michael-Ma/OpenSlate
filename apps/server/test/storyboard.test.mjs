import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
import { editStoryboard } from '../dist/storyboard.js';
function fixture(t) {
 const f=setup(t), service=new ProductionService(f.store,f.engine),token=randomBytes(32).toString('base64url');
 const app=createApp({service,localToken:token});t.after(()=>app.close());
 const edit=(body,key=randomUUID())=>editStoryboard(service,f.projectId,{expectedHeadVersion:f.store.getProject(f.projectId).headVersion,...body},key);
 return {...f,service,app,edit,token};
}
test('direct edit is durable, idempotent, revokes old epochs and never mints grants', async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),actor=f.service.beginRequest(f.projectId,'local-user','old direction',{editing:true}),epoch=f.service.openEpoch(f.projectId,actor), grants=f.store.list('grant',f.projectId).length;
 const body={kind:'shot',id:p.shots[0].id,field:'framing',value:'Close detail',expectedHeadVersion:p.headVersion},key=randomUUID();
 const receipt=f.edit(body,key);assert.equal(f.store.getProject(f.projectId).shots[0].framing,'Close detail');assert.deepEqual(f.edit(body,key),receipt);
 assert.equal(f.store.get('epoch',epoch.actor.epochId).state,'revoked');assert.equal(f.store.list('grant',f.projectId).length,grants);assert.equal(f.engine.attempts(f.projectId).length,0);
 assert.throws(()=>f.edit({...body,value:'stale'}),e=>e.code==='REVISION_CONFLICT');
});
test('reorder and delete/undo retain stable identities and narration, protect newer changes',t=>{
 const f=fixture(t),a=f.store.getProject(f.projectId).shots[0],b=f.store.getProject(f.projectId).shots[1];
 f.edit({kind:'narration',id:a.id,field:'mode',value:'generated'});f.edit({kind:'narration',id:a.id,field:'text',value:'Morning light.'});
 f.edit({kind:'moveShot',id:a.id,sceneId:b.sceneId});let p=f.store.getProject(f.projectId);assert.deepEqual(p.shots.map(x=>x.id),[b.id,a.id]);assert.equal(p.shots[1].narration.text,'Morning light.');
 const removed=f.edit({kind:'deleteShot',id:a.id});assert.equal(f.store.getProject(f.projectId).shots.length,1);f.edit({kind:'undo',commandId:removed.commandId});assert.equal(f.store.getProject(f.projectId).shots[1].id,a.id);
 assert.throws(()=>f.edit({kind:'undo',commandId:removed.commandId}),e=>e.code==='REVISION_CONFLICT');
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
 assert.ok(holds.some(x=>x.ownerId===unrelated.requestId));assert.ok(holds.some(x=>x.ownerId===second.requestId));assert.ok(!holds.some(x=>x.ownerId===first.requestId));
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
