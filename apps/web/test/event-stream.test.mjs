import test from 'node:test';
import assert from 'node:assert/strict';
import { EventStreamParser } from '../src/event-stream.ts';
import { ProjectSubscription, projectSubscription } from '../src/project-subscription.ts';
const bytes=value=>new TextEncoder().encode(value);
test('SSE decoding preserves split UTF-8, CRLF, multiline data and discards unfinished frames',()=>{
 const events=[],parser=new EventStreamParser(event=>events.push(event)),source=bytes('\ufeff: heartbeat\r\nid: 4\r\nevent: message.recorded\r\ndata: {"text":"鞋"}\r\ndata: second\r\n\r\nid: 5\ndata: unfinished');
 for(const byte of source)parser.push(Uint8Array.of(byte));parser.finish();
 assert.deepEqual(events,[{id:'4',event:'message.recorded',data:'{"text":"鞋"}\nsecond'}]);
});
test('SSE decoding bounds unfinished lines and cumulative multiline frames and rejects broken UTF-8',()=>{
 for(const source of ['x'.repeat(65537),('data: '+ 'x'.repeat(100)+'\n').repeat(650)])assert.throws(()=>new EventStreamParser(()=>{}).push(bytes(source)),/LIMIT/);
 assert.throws(()=>new EventStreamParser(()=>{}).push(new Uint8Array(256*1024+1)),/LIMIT/);
 assert.throws(()=>new EventStreamParser(()=>{}).push(Uint8Array.of(255)));
});
function fixture(){
 let now=100000,next=1;const timers=new Map(),listeners=new Map(),visibility={hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
 const environment={visibility,focus:visibility,now:()=>now,setTimer:(fn,delay)=>{const id=next++;timers.set(id,{at:now+delay,fn});return id;},clearTimer:id=>timers.delete(id)};
 const calls=[],api={closed:false,events(projectId,options){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});calls.push({projectId,options,resolve,reject});options.signal.addEventListener('abort',()=>resolve(),{once:true});return promise;}};
 const subscription=new ProjectSubscription(api,'project',environment);
 const tick=async duration=>{const target=now+duration;for(;;){await Promise.resolve();const entries=[...timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at);if(!entries.length)break;const[id,event]=entries[0];now=event.at;timers.delete(id);event.fn();}now=target;await Promise.resolve();await Promise.resolve();};
 const send=(call,id,event='message.recorded',body={projectId:'project',sequence:id})=>call.options.onEvent({event,id:id===null?null:String(id),data:JSON.stringify(body)});
 return{api,calls,subscription,timers,tick,send,listeners,visibility};
}
test('one API/project subscription is shared; multiple subscribers keep one stream until the last cleanup',async()=>{
 const f=fixture();assert.equal(projectSubscription(f.api,'one'),projectSubscription(f.api,'one'));assert.notEqual(projectSubscription(f.api,'one'),projectSubscription(f.api,'two'));
 const a=f.subscription.subscribe(()=>{}),b=f.subscription.subscribe(()=>{});assert.equal(f.calls.length,1);
 a();assert.equal(f.calls[0].options.signal.aborted,false);b();assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
});
test('bursts coalesce, repeated event IDs do not refresh, and reconnect sends the exact last cursor with resync',async()=>{
 const f=fixture(),off=f.subscription.subscribe(()=>{}),first=f.calls[0];first.options.onOpen();
 for(let i=1;i<=20;i++)f.send(first,i);await f.tick(150);assert.equal(f.subscription.getSnapshot().revision,1);
 f.send(first,20);await f.tick(200);assert.equal(f.subscription.getSnapshot().revision,1);
 first.reject(Error('lost'));await f.tick(1000);assert.equal(f.calls.length,2);assert.equal(f.calls[1].options.after,20);
 f.calls[1].options.onOpen();await f.tick(150);assert.equal(f.subscription.getSnapshot().revision,3);off();
});
test('silent-state invalidation refreshes without advancing cursor and explicit resync can reset history',async()=>{
 const f=fixture(),off=f.subscription.subscribe(()=>{}),call=f.calls[0];call.options.onOpen();f.send(call,7);await f.tick(150);
 f.send(call,null,'project.invalidate',{version:1,projectId:'project',cursor:7});await f.tick(150);assert.equal(f.subscription.getSnapshot().revision,2);
 f.send(call,3,'project.resync',{version:1,projectId:'project',cursor:3});await f.tick(150);call.reject(Error());await f.tick(1000);assert.equal(f.calls[1].options.after,3);off();
});
test('cursor rejection clears only its replay position; unavailable stream uses slow fallback independently of retries',async()=>{
 const f=fixture(),off=f.subscription.subscribe(()=>{});f.calls[0].options.onOpen();f.send(f.calls[0],10);await f.tick(150);
 f.calls[0].reject({code:'VALIDATION_ERROR'});await f.tick(1000);assert.equal(f.calls[1].options.after,undefined);assert.equal(f.subscription.getSnapshot().connection,'fallback');
 f.calls[1].reject(Error());await f.tick(29000);await f.tick(150);assert.ok(f.subscription.getSnapshot().revision>=2);
 off();assert.equal(f.timers.size,0);
});
test('healthy streams have no refresh polling; hidden tabs disconnect and visible/focus resync without stale callbacks',async()=>{
 const f=fixture(),off=f.subscription.subscribe(()=>{}),old=f.calls[0];old.options.onOpen();await f.tick(150);const revision=f.subscription.getSnapshot().revision;
 await f.tick(120000);assert.equal(f.subscription.getSnapshot().revision,revision);assert.equal(f.calls.length,1);
 f.visibility.hidden=true;f.listeners.get('visibilitychange')();assert.equal(old.options.signal.aborted,true);await f.tick(120000);assert.equal(f.calls.length,1);
 old.options.onOpen();f.send(old,8);assert.equal(f.subscription.getSnapshot().connection,'reconnecting');
 f.visibility.hidden=false;f.listeners.get('visibilitychange')();assert.equal(f.calls.length,2);f.calls[1].options.onOpen();await f.tick(150);assert.equal(f.subscription.getSnapshot().revision,revision+1);
 f.listeners.get('focus')();await f.tick(150);assert.equal(f.subscription.getSnapshot().revision,revision+2);off();
});
test('cross-project and malformed event identities cannot enter the cursor',()=>{
 const f=fixture(),off=f.subscription.subscribe(()=>{}),call=f.calls[0];
 assert.throws(()=>f.send(call,1,'message.recorded',{projectId:'other',sequence:1}),/PROJECT/);
 assert.throws(()=>f.send(call,2,'message.recorded',{projectId:'project',sequence:3}),/CURSOR/);
 assert.throws(()=>f.send(call,null,'message.recorded',{projectId:'project',sequence:2}),/CURSOR/);off();
});
test('projectless subscription performs no stream or periodic work but permits focus refresh for installation state',async()=>{
 const f=fixture(),sub=new ProjectSubscription(f.api,'',{visibility:f.visibility,focus:f.visibility,now:()=>0,setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:id=>clearTimeout(id)}),off=sub.subscribe(()=>{});
 assert.equal(f.calls.length,0);off();assert.equal(f.listeners.size,0);
});
