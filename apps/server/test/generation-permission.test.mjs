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
