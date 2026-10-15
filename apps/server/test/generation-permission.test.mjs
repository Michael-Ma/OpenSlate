import { digest } from '@openslate/core';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
function fixture(t) {
 const f=setup(t), service=new ProductionService(f.store,f.engine), token=randomBytes(32).toString('base64url');
 const enqueued=[]; const app=createApp({service,localToken:token,logger:false,director:{enqueue:(p,a)=>enqueued.push(a),tick(){},status(){return {mode:'native',status:'idle'};}}});
 t.after(()=>app.close());
 const snapshot=service.snapshot(f.projectId);
 const body={headVersion:snapshot.project.headVersion,revisionId:snapshot.project.revisionId,cursor:snapshot.cursor,shotIds:['shot-0'],kinds:['image','video']};
 const post=(payload=body,key=randomUUID(),auth=token)=>app.inject({method:'POST',url:`/api/projects/${f.projectId}/generation-permission`,headers:{host:'127.0.0.1',authorization:`Bearer ${auth}`,'idempotency-key':key},payload});
 return {...f,service,app,post,body,enqueued};
}
test('human permission is shot-bounded, one-use, separate from spending, and exact replay does not enqueue again',async t=>{
 const f=fixture(t), key=randomUUID(), before=f.store.list('grant',f.projectId).length;
 const response=await f.post(f.body,key);assert.equal(response.statusCode,200,response.body);
 assert.equal(f.enqueued.length,1);const result=response.json();assert.equal(result.grantIds.length,2);
 for(const id of result.grantIds){const g=f.store.get('grant',id);assert.equal(g.scopeId,'shot-0');assert.equal(g.authorityId,result.requestId);assert.equal(g.origin,'user_change');}
 assert.equal(f.store.list('grant',f.projectId).length,before+2);assert.equal(f.store.list('spending_allowance',f.projectId).length,0);assert.equal(f.engine.attempts(f.projectId).length,0);
 assert.deepEqual((await f.post(f.body,key)).json(),result);assert.equal(f.enqueued.length,1);
 assert.notEqual((await f.post(f.body)).statusCode,200);
});
test('stale, foreign, duplicate and stopped reviews cannot create authority or supersede current work',async t=>{
 const f=fixture(t), before=f.store.list('message',f.projectId).length;
 for(const body of [{...f.body,headVersion:999},{...f.body,shotIds:['foreign']},{...f.body,shotIds:['shot-0','shot-0']},{...f.body,kinds:['speech']}])assert.notEqual((await f.post(body)).statusCode,200);
 assert.equal(f.store.list('message',f.projectId).length,before);
 f.engine.setPaused(f.projectId,true,'test-stop');
 const snap=f.service.snapshot(f.projectId);assert.notEqual((await f.post({...f.body,cursor:snap.cursor})).statusCode,200);
 assert.equal(f.store.list('message',f.projectId).length,before);
});
test('explicit continuation transfers the selected earlier edit, while a director credential cannot authorize',async t=>{
 const f=fixture(t), human=f.service.beginRequest(f.projectId,'local-user','Edit shots',{scopeIds:[f.projectId],editing:true});
 const epoch=f.service.openEpoch(f.projectId,human), snap=f.service.snapshot(f.projectId);
 const body={...f.body,cursor:snap.cursor,continuationRequestId:human.requestId};
 assert.notEqual((await f.post(body,randomUUID(),epoch.token)).statusCode,200);
 const response=await f.post(body);assert.equal(response.statusCode,200,response.body);
 assert.equal(f.store.list('hold',f.projectId).some(h=>h.ownerId===human.requestId&&h.active),false);
 assert.equal(f.store.list('hold',f.projectId).some(h=>h.ownerId===response.json().requestId&&h.active),true);
 assert.throws(()=>f.service.actorForBridge(f.projectId,epoch.token));
});

test('reviewed plural continuation transfers all covering edits with grants limited to the selected shots', async t => {
 const f=fixture(t), a=f.service.beginRequest(f.projectId,'local-user','First pending edit',{scopeIds:[f.projectId]}), b=f.service.beginRequest(f.projectId,'local-user','Second pending edit',{scopeIds:['shot-0'],concurrency:'alongside'});
 assert.equal(f.store.get('message',a.requestId).state,'active');assert.equal(f.store.get('message',b.requestId).state,'active');
 const snapshot=f.service.snapshot(f.projectId), continueEdits=f.service.pendingEditContinuation(f.projectId,'local-user',[f.projectId]);
 const body={...f.body,cursor:snapshot.cursor,continueEdits,continuationScope:'project'};
 const response=await f.post(body);assert.equal(response.statusCode,200,response.body); const result=response.json();
 assert.ok(f.store.list('hold',f.projectId).filter(h=>h.active).every(h=>h.ownerId===result.requestId));
 assert.deepEqual(new Set(f.store.list('request_continuation',f.projectId).map(x=>x.fromRequestId)),new Set([a.requestId,b.requestId]));
 assert.ok(result.grantIds.every(id=>f.store.get('grant',id).scopeId==='shot-0'));assert.equal(f.store.list('external_allowance',f.projectId).length,0);assert.equal(f.engine.attempts(f.projectId).length,0);
});

test('shot-only plural permission cannot silently take project holds, stale review does not fence new work', async t=>{
 const f=fixture(t), old=f.service.beginRequest(f.projectId,'local-user','Whole film pending',{scopeIds:[f.projectId]}), epoch=f.service.openEpoch(f.projectId,old);
 const snap=f.service.snapshot(f.projectId), continueEdits=f.service.pendingEditContinuation(f.projectId,'local-user',[f.projectId]);
 const response=await f.post({...f.body,cursor:snap.cursor,continueEdits});assert.notEqual(response.statusCode,200);assert.equal(f.store.get('epoch',epoch.actor.epochId).state,'active');
 const forged=await f.post({...f.body,cursor:snap.cursor,continuationScope:'project'});assert.notEqual(forged.statusCode,200);assert.equal(f.store.get('epoch',epoch.actor.epochId).state,'active');
});

test('unrelated progress does not stale reviewed creative permission, while stop authority changes do',async t=>{
 const f=fixture(t),snap=f.service.snapshot(f.projectId),body={...f.body,reviewedControlAuthorityId:snap.control.authorityId??null,reviewedHoldDigest:digest([])};
 f.store.appendEvent(f.projectId,'test.unrelated_progress',{nodeId:'other'});
 const r=await f.post(body);assert.equal(r.statusCode,200,r.body);
 const g=fixture(t),before=g.service.snapshot(g.projectId),old={...g.body,reviewedControlAuthorityId:before.control.authorityId??null,reviewedHoldDigest:digest([])};
 g.engine.setPaused(g.projectId,true,'new-stop');g.engine.setPaused(g.projectId,false,'new-resume');
 assert.equal((await g.post(old)).statusCode,409);
});

test('a new held edit invalidates the selected permission even when the project head and control stay unchanged',async t=>{
 const f=fixture(t),snap=f.service.snapshot(f.projectId),body={...f.body,reviewedControlAuthorityId:snap.control.authorityId??null,reviewedHoldDigest:digest([])};
 f.service.beginRequest(f.projectId,'local-user','New edit',{scopeIds:['shot-0']});
 const before=f.store.list('grant',f.projectId).length;assert.equal((await f.post(body)).statusCode,409);assert.equal(f.store.list('grant',f.projectId).length,before);
});
