import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './request-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { LEGACY_APP_TEXTS } from '../dist/application/request-source.js';
import { NarrationService, NarrationCanonicalService } from '../dist/narration/index.js';
import { createApp } from '../dist/app.js';

test('source separates user conversation, application actions and Director actions without losing requests',t=>{
 const f=fixture(t),user=f.service.beginRequest(f.project.id,'local-user','Stop the current conversation and new generation.');
 const app=f.service.beginRequest(f.project.id,'local-user','A press',{source:'app',editing:false});
 const director=f.service.beginRequest(f.project.id,'local-user','A suggestion',{source:'director',editing:false});
 const snapshot=f.service.snapshot(f.project.id);assert.deepEqual(snapshot.conversation.map(m=>m.requestId),[user.requestId]);
 assert.equal(snapshot.messages.length,3);
 const context=f.service.readContext(f.project.id,user);
 assert.deepEqual(context.messages.map(m=>m.id),[user.requestId]);
 assert.deepEqual(context.applicationActions.map(m=>m.id),[app.requestId]);
 assert.deepEqual(context.directorActions.map(m=>m.id),[director.requestId]);
});
test('legacy migration classifies all known application copy and keyed imports, preserving unknown text and question answers',t=>{
 const f=fixture(t),id=f.project.id,legacy=(text,key)=>{
  const actor=f.service.beginRequest(id,'local-user',text,{editing:false,...(key?{key}:{})});
  const {source,...old}=f.store.get('message',actor.requestId);f.store.put('message',actor.requestId,id,old);return actor;
 };
 const apps=[...LEGACY_APP_TEXTS,
  'Generate keyframes for this reviewed scene.','Generate keyframes for  this reviewed scene.','Regenerate keyframes for the selected shots in this reviewed scene.',
  'Generate video for  this reviewed scene.',
  'Interpret this supplied document as a proposed film plan. Preserve my material; show optional suggestions separately. Wait for my confirmation before applying anything.\n\nDocument: draft\n\nA ferry',
  'Storyboard edit: shot motion. Preserve unaffected work and replan only what this edit requires.'
 ].map(text=>legacy(text));
 apps.push(legacy('User-supplied narration session text','narration:old-session'));
 const user=legacy('My actual direction'),answer=legacy('resume','question:real-answer');
 const historical=f.store.db.prepare('SELECT * FROM commands ORDER BY rowid').all();
 const service=new ProductionService(f.store,f.engine);
 assert.ok(apps.every(a=>f.store.get('message',a.requestId).source==='app'));
 assert.deepEqual(service.snapshot(id).conversation.map(m=>m.requestId),[user.requestId,answer.requestId]);
 const rows=f.store.db.prepare("SELECT body,version FROM entities WHERE kind='message' ORDER BY rowid").all();
 new ProductionService(f.store,f.engine);
 assert.deepEqual(f.store.db.prepare("SELECT body,version FROM entities WHERE kind='message' ORDER BY rowid").all(),rows);
 assert.deepEqual(f.store.db.prepare('SELECT * FROM commands ORDER BY rowid').all(),historical);
});
test('controls require bounded identity, replay the same receipt and refuse changed bodies',async t=>{
 const f=fixture(t);
 for(const key of [undefined,'','   ']){
  const r=await f.request('POST','/controls',{action:'stop'},key);assert.equal(r.statusCode,400,r.body);assert.equal(r.json().error.code,'IDEMPOTENCY_KEY_REQUIRED');
 }
 assert.equal(f.store.list('message',f.project.id).length,0);
 const key=randomUUID(),first=await f.request('POST','/controls',{action:'stop'},key);
 assert.equal(first.statusCode,200,first.body);assert.deepEqual((await f.request('POST','/controls',{action:'stop'},key)).json(),first.json());
 const conflict=await f.request('POST','/controls',{action:'resume'},key);assert.equal(conflict.statusCode,409);assert.equal(conflict.json().error.code,'IDEMPOTENCY_CONFLICT');
 assert.deepEqual(f.service.snapshot(f.project.id).conversation,[]);assert.equal(f.store.list('message',f.project.id)[0].source,'app');
});
test('a narration session stores app authority without adding a user message',async t=>{
 const f=fixture(t),narration=new NarrationService(f.service),canonical=new NarrationCanonicalService(narration),
  token='offline_narration_session_012345678901234',app=createApp({service:f.service,localToken:token,logger:false,
   narrationRoutes:{production:f.service,narration,canonical,uploadDirectory:'/tmp'}});
 t.after(()=>app.close());
 const r=await app.inject({method:'POST',url:`/api/projects/${f.project.id}/narration/sessions`,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,'idempotency-key':randomUUID()},payload:{}});
 assert.equal(r.statusCode,200,r.body);assert.equal(f.store.list('message',f.project.id)[0].source,'app');
 assert.deepEqual(f.service.snapshot(f.project.id).conversation,[]);
});

test('an old application request key replays after migration without rewriting the command digest',t=>{
 const f=fixture(t),id=f.project.id,text='Review the displayed keyframes',key='review:legacy';
 const actor=f.service.beginRequest(id,'local-user',text,{editing:false,key});
 const {source,...old}=f.store.get('message',actor.requestId);f.store.put('message',actor.requestId,id,old);
 const service=new ProductionService(f.store,f.engine);
 assert.deepEqual(service.beginRequest(id,'local-user',text,{source:'app',editing:false,key}),actor);
 assert.throws(()=>service.beginRequest(id,'local-user',text,{source:'user',editing:false,key}),{code:'IDEMPOTENCY_CONFLICT'});
 assert.throws(()=>service.beginRequest(id,'local-user',text,{editing:false,key}),{code:'IDEMPOTENCY_CONFLICT'});
});
