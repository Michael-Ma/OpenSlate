import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
import { PersonalVoiceService } from '../dist/narration/personal-voices.js';
import { defaultNarratorVoice } from '../dist/narration/default-voice.js';
const token='project-library-offline-token-12345';
function fixture(t){
 const f=setup(t),service=new ProductionService(f.store,f.engine),app=createApp({service,localToken:token});t.after(()=>app.close());
 const call=(path='',body,key=randomUUID())=>app.inject({method:body===undefined?'GET':'POST',url:`/api/projects${path}`,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,'idempotency-key':key},...(body===undefined?{}:{payload:body})});
 return {...f,service,app,call};
}
test('rename is keyed, version checked and leaves bindings, authority, holds and media unchanged',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),before=['hold','node_binding','message','grant'].map(k=>f.store.list(k,p.id)),body={name:'  Last Ferry  ',expectedHeadVersion:p.headVersion};
 const first=await f.call(`/${p.id}/rename`,body,'rename-once');assert.equal(first.statusCode,200,first.body);assert.equal(first.json().project.name,'Last Ferry');assert.equal(first.json().headVersion,p.headVersion+1);
 assert.deepEqual((await f.call(`/${p.id}/rename`,body,'rename-once')).json(),first.json());
 assert.equal((await f.call(`/${p.id}/rename`,{...body,name:'Other'},'rename-once')).json().error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await f.call(`/${p.id}/rename`,body)).json().error.code,'REVISION_CONFLICT');
 assert.equal((await f.call(`/${p.id}/rename`,{name:' ',expectedHeadVersion:p.headVersion+1})).statusCode,400);
 assert.deepEqual(['hold','node_binding','message','grant'].map(k=>f.store.list(k,p.id)),before);
 const item=(await f.call()).json().projects[0];assert.deepEqual({...item,updatedAt:undefined},{id:p.id,name:'Last Ferry',archived:false,scenes:2,shots:2,seconds:12,videosReady:0,updatedAt:undefined});assert.ok(Date.parse(item.updatedAt)>0);
});
test('archive refuses running and unknown paid jobs, hides archived films and preserves bytes; unarchive resumes eligibility',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId);await f.engine.runReady();
 assert.equal((await f.call(`/${p.id}/archive`,{})).json().error.code,'ATTEMPTS_RUNNING');
 const attempt=f.engine.attempts(p.id)[0];f.store.put('attempt',attempt.id,p.id,{...attempt,phase:'submission_unknown'});
 assert.equal((await f.call(`/${p.id}/archive`,{})).json().error.code,'ATTEMPTS_RUNNING');
 f.store.put('attempt',attempt.id,p.id,attempt);await f.engine.reconcile();const artifacts=f.store.list('artifact',p.id);
 const archived=await f.call(`/${p.id}/archive`,{},'archive-once');assert.equal(archived.statusCode,200,archived.body);
 assert.equal((await f.call()).json().projects.length,0);assert.equal((await f.call('?includeArchived=true')).json().projects[0].archived,true);
 assert.deepEqual((await f.call(`/${p.id}/archive`,{},'archive-once')).json(),archived.json());
 assert.equal((await f.engine.runReady()).dispatched,0);assert.deepEqual(f.store.list('artifact',p.id),artifacts);
 assert.equal((await f.call(`/${p.id}/unarchive`,{})).statusCode,200);assert.equal((await f.call()).json().projects.length,1);
 assert.equal((await f.call('?includeArchived=maybe')).statusCode,400);
});
test('narrator default is keyed and hold free; stock and ready personal IDs apply only to new lines',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),bindings=f.store.list('node_binding',p.id);
 const save=voice=>f.call(`/${p.id}/settings/voice`,{narratorVoice:voice,expectedHeadVersion:f.store.getProject(p.id).headVersion});
 assert.equal((await save('coral')).statusCode,200);let next=f.store.getProject(p.id);assert.equal(defaultNarratorVoice(f.store,next,next.shots[0]),'coral');
 assert.equal((await save('invalid')).statusCode,400);assert.equal((await save('openai-custom:voice_missing')).json().error.code,'PERSONAL_VOICE_NOT_ENROLLED');
 const human=f.service.beginRequest(p.id,'local-user','Register my voice',{editing:false});
 const voices=new PersonalVoiceService(f.service),registered=voices.register(p.id,human,{key:'register',expectedHeadVersion:next.headVersion,label:'Narrator',provider:'openai',providerVoiceId:'voice_test',ownVoice:true,permitSynthesis:true});
 assert.equal((await save(registered.selector)).statusCode,200);next=f.store.getProject(p.id);assert.equal(defaultNarratorVoice(f.store,next,next.shots[0]),registered.selector);
 voices.revoke(p.id,human,{key:'revoke',identityId:registered.id});assert.throws(()=>defaultNarratorVoice(f.store,next,next.shots[0]),e=>e.code==='PERSONAL_VOICE_REVOKED');
 assert.deepEqual(f.store.list('node_binding',p.id),bindings);assert.deepEqual(next.shots,p.shots);
});

test('archive accepts a bodyless command, requires a key, and refuses pending local renders',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId),url=`/api/projects/${p.id}/archive`,headers={host:'127.0.0.1',authorization:`Bearer ${token}`};
 assert.equal((await f.app.inject({method:'POST',url,headers})).json().error.code,'IDEMPOTENCY_KEY_REQUIRED');
 f.store.insert('media_render','offline-render',p.id,{state:'running'});
 assert.equal((await f.app.inject({method:'POST',url,headers:{...headers,'idempotency-key':'archive-render'}})).json().error.code,'ATTEMPTS_RUNNING');
 f.store.put('media_render','offline-render',p.id,{state:'published'});
 const result=await f.app.inject({method:'POST',url,headers:{...headers,'idempotency-key':'archive-render'}});assert.equal(result.statusCode,200,result.body);
 assert.equal((await f.call()).json().projects.length,0);
});
test('project listing counts only current clips and preserves archived job receipts',async t=>{
 const f=fixture(t),p=f.store.getProject(f.projectId);await f.engine.runReady();await f.engine.reconcile();const review=f.engine.reviewSnapshot(p.id);
 f.engine.approve(p.id,review.id,[review.members[0].videoNodeId],'offline-count');await f.engine.runReady();await f.engine.reconcile();
 assert.equal((await f.call()).json().projects[0].videosReady,1);
 const attempts=f.engine.attempts(p.id);assert.equal((await f.call(`/${p.id}/archive`,{})).statusCode,200);assert.deepEqual(f.engine.attempts(p.id),attempts);
});
