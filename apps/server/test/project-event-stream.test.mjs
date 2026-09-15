import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { registerProjectEventStream } from '../dist/application/project-event-stream.js';
import { setup as executionFixture } from './execution-fixture.mjs';
const token='synthetic-event-stream-token';
async function fixture(t){
 const f=executionFixture(t),app=Fastify(),state={mode:'fake',status:'idle'};let statusReads=0;
 app.addHook('onRequest',async(request,reply)=>{if(request.headers.authorization!==`Bearer ${token}`)return reply.code(403).send({error:{code:'AUTH_REQUIRED'}});});
 app.setErrorHandler((error,request,reply)=>reply.code(error.code==='VALIDATION_ERROR'?400:500).send({error:{code:error.code}}));
 registerProjectEventStream(app,{store:f.store,directorStatus:()=>{statusReads++;return state;},intervalMs:20,heartbeatMs:40});
 const address=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 return{...f,app,state,address,statusReads:()=>statusReads,path:`${address}/api/projects/${f.projectId}/events`};
}
async function stream(t,url,after){
 const abort=new AbortController(),response=await fetch(url,{headers:{authorization:`Bearer ${token}`,...(after===undefined?{}:{'last-event-id':String(after)})},signal:abort.signal});
 assert.equal(response.status,200);const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
 t.after(async()=>{abort.abort();await reader.cancel().catch(()=>{});});
 return{response,abort,async next(label='project event'){const timer=setTimeout(()=>abort.abort(new Error(`Timed out waiting for ${label}`)),3000);try{for(;;){const index=buffer.indexOf('\n\n');if(index>=0){const frame=buffer.slice(0,index);buffer=buffer.slice(index+2);if(frame.startsWith(':'))continue;const lines=frame.split('\n'),get=key=>lines.find(x=>x.startsWith(key+': '))?.slice(key.length+2);return{id:get('id'),event:get('event'),data:JSON.parse(get('data'))};}const row=await reader.read();assert.equal(row.done,false);buffer+=decoder.decode(row.value,{stream:true});}}finally{clearTimeout(timer);}},async end(){abort.abort();await reader.cancel().catch(()=>{});}};
}
test('event route preserves authenticated replay and header cursor precedence without writes',async t=>{
 const f=await fixture(t),cursor=f.store.cursor(f.projectId);f.store.appendEvent(f.projectId,'fixture.first',{value:'first'});f.store.appendEvent(f.projectId,'fixture.second',{value:'second'});
 const before=f.store.db.prepare('SELECT total_changes() n').get().n;
 assert.equal((await fetch(f.path)).status,403);assert.equal((await fetch(f.path+'?after=999999',{headers:{authorization:`Bearer ${token}`}})).status,400);
 const connection=await stream(t,f.path+'?after=0',cursor),first=await connection.next(),second=await connection.next();
 assert.equal(first.event,'fixture.first');assert.equal(Number(first.id),cursor+1);assert.equal(second.data.payload.value,'second');assert.equal(Number(second.id),cursor+2);
 assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);await connection.end();
 const reconnect=await stream(t,f.path+'?after=0',cursor+2);f.store.appendEvent(f.projectId,'fixture.third',{});assert.equal((await reconnect.next()).event,'fixture.third');
});
test('silent same-connection writes, another SQLite connection and in-memory status all invalidate',async t=>{
 const f=await fixture(t),cursor=f.store.cursor(f.projectId),connection=await stream(t,f.path,cursor);
 f.store.db.prepare("UPDATE projects SET body=json_set(body,'$.name','Locally saved name') WHERE id=?").run(f.projectId);
 const same=await connection.next('same-connection invalidation');assert.equal(same.event,'project.invalidate');assert.equal(same.id,undefined);assert.equal(same.data.cursor,cursor);
 const db=new Database(f.dbPath);try{db.prepare("UPDATE projects SET body=json_set(body,'$.name','External saved name') WHERE id=?").run(f.projectId);}finally{db.close();}
 assert.equal((await connection.next('external-connection invalidation')).event,'project.invalidate');f.state.status='running';assert.equal((await connection.next('volatile-status invalidation')).event,'project.invalidate');
 assert.equal(f.store.cursor(f.projectId),cursor);
});
test('large/backlogged event histories become explicit bounded snapshot resync',async t=>{
 const f=await fixture(t),cursor=f.store.cursor(f.projectId);for(let i=0;i<40;i++)f.store.appendEvent(f.projectId,'fixture.many',{index:i});
 const connection=await stream(t,f.path,cursor),resync=await connection.next();assert.equal(resync.event,'project.resync');assert.equal(Number(resync.id),f.store.cursor(f.projectId));await connection.end();
 const latest=f.store.cursor(f.projectId);f.store.appendEvent(f.projectId,'fixture.large',{text:'x'.repeat(70000)});
 const large=await stream(t,f.path,latest),event=await large.next();assert.equal(event.event,'project.resync');assert.ok(JSON.stringify(event).length<500);
});
test('app shutdown ends active streams and their watcher without waiting for client disconnect',async t=>{
 const f=await fixture(t),connection=await stream(t,f.path,f.store.cursor(f.projectId)),start=Date.now();await f.app.close();assert.ok(Date.now()-start<1000);await connection.end();
});

test('idle streams send only heartbeats without database writes and shutdown stops the shared watcher',async t=>{
 const f=await fixture(t),cursor=f.store.cursor(f.projectId),before=f.store.db.prepare('SELECT total_changes() n').get().n;
 const abort=new AbortController(),response=await fetch(f.path,{headers:{authorization:`Bearer ${token}`,'last-event-id':String(cursor)},signal:abort.signal});
 assert.equal(response.status,200);const reader=response.body.getReader(),decoder=new TextDecoder();let received='';
 t.after(async()=>{abort.abort();await reader.cancel().catch(()=>{});});
 const deadline=setTimeout(()=>abort.abort(),3000);
 try{while((received.match(/: heartbeat/g)??[]).length<3){const part=await reader.read();assert.equal(part.done,false);received+=decoder.decode(part.value,{stream:true});}}
 finally{clearTimeout(deadline);}
 assert.equal(received.includes('data:'),false);assert.equal(received.includes('event:'),false);
 assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.store.cursor(f.projectId),cursor);
 await f.app.close();const reads=f.statusReads();await new Promise(resolve=>setTimeout(resolve,80));assert.equal(f.statusReads(),reads);
});
