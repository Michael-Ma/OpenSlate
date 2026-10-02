import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
function fixture(t){const f=setup(t),service=new ProductionService(f.store,f.engine),token=randomBytes(32).toString('base64url'),enqueued=[];
 const app=createApp({service,localToken:token,logger:false,director:{enqueue:(p,a)=>enqueued.push(a),tick(){},status(){return{mode:'native',status:'idle'};}}});t.after(()=>app.close());
 const post=(payload,key=randomUUID())=>app.inject({method:'POST',url:`/api/projects/${f.projectId}/messages`,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,'idempotency-key':key},payload});
 return{...f,service,post,enqueued};}
test('fresh covering chat continues several reviewed edit owners once without generating permissions or jobs',async t=>{
 const f=fixture(t),a=f.service.beginRequest(f.projectId,'local-user','First edit',{scopeIds:['shot-0']}),b=f.service.beginRequest(f.projectId,'local-user','Second edit',{scopeIds:['shot-0']}),continueEdits=f.service.pendingEditContinuation(f.projectId,'local-user',['shot-0']);
 const body={text:'Continue these edits with a slower push.',scopeIds:['shot-0'],editing:true,continueEdits},key=randomUUID(),grants=f.store.list('grant',f.projectId).length;
 const response=await f.post(body,key);assert.equal(response.statusCode,200,response.body);const result=response.json();assert.equal(f.enqueued.length,1);
 assert.deepEqual(new Set(f.store.list('request_continuation',f.projectId).map(x=>x.fromRequestId)),new Set([a.requestId,b.requestId]));assert.ok(f.store.list('hold',f.projectId).filter(h=>h.active).every(h=>h.ownerId===result.requestId));
 const replay=await f.post(body,key);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().requestId,result.requestId);assert.equal(f.store.list('request_continuation',f.projectId).length,2);
 assert.equal(f.store.list('grant',f.projectId).length,grants);assert.equal(f.engine.attempts(f.projectId).length,0);
});
test('question, review and stop replies cannot smuggle a multi-edit ownership transfer',async t=>{
 const f=fixture(t),a=f.service.beginRequest(f.projectId,'local-user','Pending',{scopeIds:['shot-0']}),continueEdits=f.service.pendingEditContinuation(f.projectId,'local-user',['shot-0']),before=f.store.cursor(f.projectId);
 for(const extra of[{replyToReviewId:'review'},{replyToQuestionId:'question'},{resumeFromStopId:a.requestId}])assert.notEqual((await f.post({text:'Reply',continueEdits,...extra})).statusCode,200);
 assert.equal(f.store.cursor(f.projectId),before);assert.equal(f.store.list('request_continuation',f.projectId).length,0);assert.equal(f.enqueued.length,0);
});
