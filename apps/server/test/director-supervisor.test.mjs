import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProvider } from '@openslate/providers';
import { digest } from '@openslate/core';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { DirectorSupervisor } from '../dist/application/director-supervisor.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';

const identity = input => Object.fromEntries(['projectId','requestId','epochId','turnId'].map(key => [key,input[key]]));
const completed = (input, text = 'Saved response') => ({...identity(input), status:'completed',text,dispatched:true});
function deferred() { let resolve; const promise = new Promise(r => resolve=r); return {promise,resolve}; }
function fixture(t, start = async input => completed(input)) {
  const root = mkdtempSync(join(tmpdir(),'openslate-supervisor-'));
  const store = new Store(join(root,'app.sqlite')), provider = new FakeProvider(join(root,'provider.sqlite'));
  const service = new ProductionService(store,new Engine(store,provider,{artifactDir:join(root,'artifacts')}));
  const runtime = {id:'test-runtime',start};
  const supervisors = [];
  const make = (options = {}) => { const supervisor = new DirectorSupervisor(service,runtime,{mode:'fake',...options}); supervisors.push(supervisor); return supervisor; };
  const supervisor = make();
  const project = service.createProject('Director test');
  const enqueue = (text='Make an ad', options={}) => { const actor = service.beginRequest(project.id,'human',text,options); return supervisor.enqueue(project.id,actor); };
  t.after(async () => { for (const supervisor of supervisors) await supervisor.close(); store.close();provider.close();rmSync(root,{recursive:true,force:true}); });
  return {root,store,provider,service,runtime,supervisor,project,enqueue,make};
}

test('messages queue exactly once and persist a final response without persisting credentials', async t => {
  let input;
  const f=fixture(t,async value => {input=value;return completed(value)});
  const turn=f.enqueue('Make an ad',{key:'retry'});
  assert.equal(f.enqueue('Make an ad',{key:'retry'}).id,turn.id);
  f.supervisor.tick();f.supervisor.tick();await f.supervisor.settle();
  assert.equal(f.supervisor.turns(f.project.id).length,1);
  assert.equal(f.supervisor.status(f.project.id).status,'idle');
  assert.equal(f.store.get('director_turn',turn.id).state,'completed');
  assert.equal(f.service.snapshot(f.project.id).conversation.at(-1).text,'Saved response');
  assert.equal(f.store.get('epoch',input.epochId).state,'revoked');
  const bodies=f.store.db.prepare('SELECT body FROM entities').all().map(row=>row.body).join('\n');
  assert.ok(!bodies.includes(input.bridge.credential));
});

test('one active turn per project while separate projects may progress concurrently',async t=>{
  const barrier=deferred(), started=[];
  const f=fixture(t,async input=>{started.push(input);await barrier.promise;return completed(input)});
  const first=f.enqueue();
  const secondProject=f.service.createProject('Second');
  f.supervisor.enqueue(secondProject.id,f.service.beginRequest(secondProject.id,'human','Second'));
  f.supervisor.tick();await new Promise(resolve=>setImmediate(resolve));
  f.supervisor.tick();assert.equal(started.length,2);
  assert.equal(f.store.get('director_turn',first.id).state,'running');
  barrier.resolve();await f.supervisor.settle();
});

test('a newer edit fences the old epoch before the replacement turn starts',async t=>{
  const firstStarted=deferred(), calls=[];
  const f=fixture(t,async(input,options)=>{
    calls.push(input);
    if(calls.length===1){ firstStarted.resolve();await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true})); }
    return completed(input,calls.length===1?'stale response':'new response');
  });
  const first=f.enqueue();f.supervisor.tick();await firstStarted.promise;
  const second=f.enqueue('Use a workshop');
  assert.equal(f.store.get('epoch',calls[0].epochId).state,'revoked');
  f.supervisor.tick();await f.supervisor.settle();
  assert.equal(calls.length,1);
  f.supervisor.tick();await f.supervisor.settle();
  assert.equal(calls.length,2);
  assert.equal(f.store.get('director_turn',first.id).state,'interrupted');
  assert.equal(f.store.get('director_turn',second.id).state,'completed');
  assert.ok(!f.service.snapshot(f.project.id).conversation.some(item=>item.text==='stale response'));
});

test('a request superseded before dispatch never starts the model',async t=>{
  let calls=0;const f=fixture(t,async input=>{calls++;return completed(input)});
  const first=f.enqueue();f.enqueue('Actually, change the story');
  f.supervisor.tick();await f.supervisor.settle();
  assert.equal(calls,1);assert.equal(f.store.get('director_turn',first.id).state,'interrupted');
});

test('an unacknowledged abort remains unknown rather than claiming confirmed interruption',async t=>{
  const ready=deferred();let calls=0;
  const f=fixture(t,async(input,{signal})=>{calls++;ready.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {...completed(input),status:'unknown'};});
  const turn=f.enqueue();f.supervisor.tick();await ready.promise;
  f.service.engine.setPaused(f.project.id,true,'human');f.supervisor.tick();await f.supervisor.settle();
  assert.equal(f.store.get('director_turn',turn.id).state,'unknown');
  f.supervisor.tick();assert.equal(calls,1);
});

test('pause aborts active reasoning and queued requests wait for explicit resume',async t=>{
  const ready=deferred();let calls=0;
  const f=fixture(t,async(input,options)=>{calls++;ready.resolve();await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));return completed(input)});
  const first=f.enqueue();f.supervisor.tick();await ready.promise;
  f.service.engine.setPaused(f.project.id,true,'human');f.supervisor.tick();await f.supervisor.settle();
  assert.equal(f.store.get('director_turn',first.id).state,'interrupted');
  const second=f.enqueue('Continue');f.supervisor.tick();assert.equal(calls,1);assert.equal(f.store.get('director_turn',second.id).state,'queued');
  f.runtime.start=async input=>{calls++;return completed(input)};
  f.service.engine.setPaused(f.project.id,false,'human');f.supervisor.tick();await f.supervisor.settle();assert.equal(calls,2);
});

test('foreign lease blocks another supervisor until expiry; lost owner becomes unknown without replay',async t=>{
  let now=1000,calls=0;
  const f=fixture(t,async input=>{calls++;return completed(input)}), first=f.enqueue();
  const request=f.store.get('message',first.requestId), human={kind:'human',principalId:'human',requestId:request.id};
  const bridge=f.service.openEpoch(f.project.id,human);
  f.store.put('director_turn',first.id,f.project.id,{...first,state:'running',owner:'crashed-process',epochId:bridge.actor.epochId,leaseExpiresAt:2000,dispatched:true});
  const restarted=f.make({now:()=>now});restarted.tick();assert.equal(calls,0);assert.equal(f.store.get('director_turn',first.id).state,'running');
  now=2001;restarted.tick();await restarted.settle();
  assert.equal(calls,0);assert.equal(f.store.get('director_turn',first.id).state,'unknown');
  assert.equal(f.store.get('epoch',bridge.actor.epochId).state,'revoked');
  restarted.tick();assert.equal(calls,0);
});

test('a second database connection cannot claim a running project',async t=>{
  const ready=deferred(),barrier=deferred();let calls=0;
  const f=fixture(t,async input=>{calls++;ready.resolve();await barrier.promise;return completed(input)});
  f.enqueue();f.supervisor.tick();await ready.promise;
  const other=new Store(f.store.path);t.after(()=>other.close());
  const service=new ProductionService(other,new Engine(other,f.provider,{artifactDir:join(f.root,'artifacts')}));
  const supervisor=new DirectorSupervisor(service,f.runtime,{mode:'fake'});
  supervisor.tick();assert.equal(calls,1);await supervisor.close();barrier.resolve();await f.supervisor.settle();
});

test('unknown completion retains committed effects and is not automatically retried',async t=>{
  let calls=0;
  const f=fixture(t,async input=>{
    calls++;const actor=f.service.actorForBridge(input.projectId,input.bridge.credential);
    const prepared=await f.service.prepare(input.projectId,actor,{variant:'project',expectedHeadVersion:0,creative:{brief:'A saved brief'}});
    f.service.apply(input.projectId,actor,prepared.id);
    throw new Error('Lost runtime connection');
  });
  const turn=f.enqueue();f.supervisor.tick();await f.supervisor.settle();f.supervisor.tick();
  assert.equal(calls,1);assert.equal(f.store.getProject(f.project.id).brief,'A saved brief');
  assert.equal(f.store.get('director_turn',turn.id).state,'unknown');
});

test('runtime events cannot borrow another turn identity',async t=>{
  const f=fixture(t,async(input,{onEvent})=>{
    await onEvent({...identity(input),requestId:'other-request',kind:'assistant_message',text:'wrong',phase:'final'});
    return completed(input);
  });
  const turn=f.enqueue();f.supervisor.tick();await f.supervisor.settle();
  assert.equal(f.store.get('director_turn',turn.id).errorCode,'RUNTIME_IDENTITY_MISMATCH');
  assert.equal(f.store.list('director_output',f.project.id).length,0);
});

test('pending questions survive turn completion as application records',async t=>{
  const f=fixture(t,async(input,{onEvent})=>{
    await onEvent({...identity(input),kind:'pending_input',nativeRequestId:'q1',questions:[{id:'tone',header:'Tone',question:'Which tone?',options:[]}]});
    return completed(input,'Which tone would you like?');
  });
  f.enqueue();f.supervisor.tick();await f.supervisor.settle();
  assert.equal(f.supervisor.status(f.project.id).status,'waiting_user');
  assert.equal(f.service.snapshot(f.project.id).questions[0].questions[0].id,'tone');
  const question=f.service.snapshot(f.project.id).questions[0],original=f.supervisor.turns(f.project.id)[0];
  const answer=f.supervisor.answerQuestion(f.project.id,'human',question.id,'Warm and confident','answer-1');
  assert.equal(f.supervisor.answerQuestion(f.project.id,'human',question.id,'Warm and confident','answer-1').requestId,answer.requestId);
  assert.equal(f.store.get('director_question',question.id).state,'answered');
  assert.equal(f.store.list('request_continuation',f.project.id)[0].fromRequestId,original.requestId);
  assert.throws(()=>f.supervisor.answerQuestion(f.project.id,'human',question.id,'Different','answer-2'),{code:'QUESTION_STALE'});
});

test('old pending questions cannot transfer authority after a newer edit',async t=>{
  const f=fixture(t,async(input,{onEvent})=>{await onEvent({...identity(input),kind:'pending_input',nativeRequestId:'q1',questions:[]});return completed(input);});
  f.enqueue();f.supervisor.tick();await f.supervisor.settle();
  const question=f.service.snapshot(f.project.id).questions[0];f.enqueue('A different project direction');
  assert.throws(()=>f.supervisor.answerQuestion(f.project.id,'human',question.id,'Answer','stale'),{code:'QUESTION_STALE'});
  assert.equal(f.store.list('request_continuation',f.project.id).length,0);
});

test('known bridge credentials are redacted at the application output boundary',async t=>{
  const f=fixture(t,async(input,{onEvent})=>{
    await onEvent({...identity(input),kind:'assistant_message',text:`Token ${input.bridge.credential}`,phase:'final'});
    return completed(input,`Token ${input.bridge.credential}`);
  });
  f.enqueue();f.supervisor.tick();await f.supervisor.settle();
  assert.equal(f.service.snapshot(f.project.id).conversation.at(-1).text,'Token [redacted]');
  assert.equal(f.store.list('director_output',f.project.id).length,1);
});

test('multiple native final items do not duplicate the aggregate answer',async t=>{
  const f=fixture(t,async(input,{onEvent})=>{
    for(const text of ['Choose a narration direction.','Share notes or upload a finished script.'])
      await onEvent({...identity(input),kind:'assistant_message',text,phase:'final'});
    return completed(input,'Choose a narration direction.\nShare notes or upload a finished script.');
  });
  f.enqueue();f.supervisor.tick();await f.supervisor.settle();
  const answers=f.service.snapshot(f.project.id).conversation.filter(message=>message.role==='assistant');
  assert.deepEqual(answers.map(message=>message.text),['Choose a narration direction.','Share notes or upload a finished script.']);
  assert.equal(f.store.list('director_output',f.project.id).length,2);
});

test('lost tool completion is reconciled from the domain receipt without invoking apply again',async t=>{
  const f=fixture(t),turn=f.enqueue(),human={kind:'human',principalId:'human',requestId:turn.requestId};
  const bridge=f.service.openEpoch(f.project.id,human), actor=bridge.actor;
  const prepared=await f.service.prepare(f.project.id,actor,{variant:'project',expectedHeadVersion:0,creative:{brief:'Receipt proof'}});
  const args={preparedId:prepared.id},callId='lost-apply',id=digest({projectId:f.project.id,epochId:actor.epochId,callId});
  f.store.insert('tool_invocation',id,f.project.id,{id,projectId:f.project.id,requestId:turn.requestId,epochId:actor.epochId,callId,tool:'apply_change',argumentsDigest:digest(args),state:'started',result:null,resultDigest:null,error:null,recovery:args});
  const receipt=f.service.apply(f.project.id,actor,prepared.id),epoch=f.store.get('epoch',actor.epochId);
  f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'revoked'});
  const tools=new ToolInvocationService(f.service);tools.reconcileEpoch(f.project.id,actor.epochId);tools.reconcileEpoch(f.project.id,actor.epochId);
  assert.equal(f.store.get('tool_invocation',id).state,'unresolved');
  assert.deepEqual(f.store.get('tool_reconciliation',id).receipt,receipt);
  assert.equal(f.store.getProject(f.project.id).headVersion,1);
  assert.equal(f.store.list('tool_reconciliation',f.project.id).length,1);
});
