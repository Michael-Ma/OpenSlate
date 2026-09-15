import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,chmodSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { FakeProvider } from '@openslate/providers';
import { createApp } from '../dist/app.js';
const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url)),token='model_switch_local_token_123456789';
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function writable(path){chmodSync(path,0o755);for(const item of readdirSync(path,{withFileTypes:true}))if(item.isDirectory())writable(join(path,item.name));}
function fixture(t,options={}){
  const root=mkdtempSync(join(tmpdir(),'openslate-director-change-')),store=new Store(join(root,'openslate.sqlite')),provider=new FakeProvider(join(root,'fake-provider.sqlite'));
  const engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),service=new ProductionService(store,engine),calls=[],setups=[];
  const config={repositoryRoot,dataDirectory:root,endpoint:'http://127.0.0.1:3001',setup:async input=>{setups.push(input);await options.setup?.(input);return{readiness:{status:'ready',model:input.model},runtimeOptions:{}};},
    makeRuntime:ready=>({id:'codex-app-server',start:async(input,settings)=>{calls.push({input,model:ready.readiness.model});await options.start?.(input);await settings.onEvent({...input,kind:'runtime_started',nativeThreadId:`native-${input.turnId}`});return{...input,status:'completed',text:'Retained response',dispatched:true,nativeThreadId:`native-${input.turnId}`};}})};
  const director=new LocalDirectorController(service,config),app=createApp({service,director,runtimeSettings:director,localToken:token}),project=service.createProject('Model choices');
  t.after(async()=>{await director.close();await app.close();provider.close();store.close();writable(root);rmSync(root,{recursive:true,force:true});});
  const selection={mode:'native',binaryPath:process.execPath,model:'model-a'};
  const change=(value=selection,key='change')=>director.changeSelection(project.id,{expectedSelectionDigest:director.settings(project.id).selectionDigest,selection:value},key);
  const enqueue=text=>director.enqueue(project.id,service.beginRequest(project.id,'human',text));
  const req=(method,path,payload,key='http-change')=>app.inject({method,url:`/api/projects/${project.id}/director${path}`,payload,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,'idempotency-key':key}});
  return{root,store,provider,engine,service,project,director,config,calls,setups,selection,change,enqueue,app,req};
}
test('director changes are idle next-turn configuration and never start a model themselves',async t=>{
  const f=fixture(t),before=f.store.getProject(f.project.id),response=await f.change();assert.equal(response.selection.mode,'native');assert.equal(response.changeAppliesTo,'next_turn');assert.equal(response.busy,false);assert.equal(response.readiness.status,'ready');
  assert.equal(f.calls.length,0);assert.equal(f.provider.acceptedCount(),0);assert.deepEqual(f.store.getProject(f.project.id),before);
  for(const kind of ['message','grant','candidate','attempt','native_model_start'])assert.equal(f.store.list(kind,f.project.id).length,0);
});
test('changing an existing native model preserves history and captures a fresh next-turn epoch',async t=>{
  const f=fixture(t);await f.change();f.enqueue('First project question');f.director.tick();await f.director.settle();const first=f.calls[0],lock=f.store.list('director_skill_lock',f.project.id)[0];
  await f.change({...f.selection,model:'model-b'},'second-model');assert.equal(f.calls.length,1);f.enqueue('Continue with the same film');f.director.tick();await f.director.settle();
  assert.equal(f.calls[1].model,'model-b');assert.notEqual(f.calls[1].input.epochId,first.input.epochId);assert.notEqual(f.calls[1].input.bridge.credential,first.input.bridge.credential);assert.match(f.calls[1].input.context,/Retained response/);
  assert.deepEqual(f.store.list('director_skill_lock',f.project.id)[0],lock);assert.equal(f.store.get('epoch',first.input.epochId).state,'revoked');assert.equal(f.store.list('director_turn',f.project.id).length,2);
});
test('fake/native transitions preserve tool version with a new runtime lock and old context intact',async t=>{
  const f=fixture(t);f.enqueue('What is next?');f.director.tick();await f.director.settle();const initial=f.store.list('director_skill_lock',f.project.id)[0],context=f.store.list('director_context',f.project.id)[0];
  await f.change();f.enqueue('Continue using Codex');f.director.tick();await f.director.settle();assert.equal(f.calls.length,1);
  const locks=f.store.list('director_skill_lock',f.project.id);assert.equal(locks.length,2);assert.equal(locks[1].lock.compatibility.toolContract,initial.lock.compatibility.toolContract);assert.notEqual(locks[1].id,initial.id);
  assert.deepEqual(f.store.get('director_context',context.id),context);await f.change({mode:'fake'},'back-to-demo');f.enqueue('What remains?');f.director.tick();await f.director.settle();assert.equal(f.calls.length,1);assert.equal(f.store.list('director_skill_lock',f.project.id).length,3);
});
test('queued and running turns block changing models without being cancelled',async t=>{
  const entered=gate(),release=gate(),f=fixture(t,{start:async()=>{entered.resolve();await release.promise;}});await f.change();
  f.enqueue('A long question');assert.equal(f.director.settings(f.project.id).busy,true);await assert.rejects(f.change({...f.selection,model:'model-b'},'queued'),{code:'DIRECTOR_SETUP_BUSY'});
  f.director.tick();await entered.promise;await assert.rejects(f.change({mode:'fake'},'running'),{code:'DIRECTOR_SETUP_BUSY'});assert.equal(f.director.mode(f.project.id),'native');release.resolve();await f.director.settle();assert.equal(f.store.list('director_turn',f.project.id)[0].state,'completed');
});
test('a completed conversation racing setup still rejects the stale switch',async t=>{
  const entered=gate(),release=gate(),f=fixture(t,{setup:async()=>{entered.resolve();await release.promise;}}),pending=f.change();await entered.promise;
  f.enqueue('Question during setup');f.director.tick();await f.director.settle();release.resolve();await assert.rejects(pending,{code:'DIRECTOR_SETUP_BUSY'});assert.equal(f.director.mode(f.project.id),'fake');assert.equal(f.calls.length,0);
});
test('command replay never reapplies an older model and changed payload is rejected before setup',async t=>{
  const f=fixture(t),input={expectedSelectionDigest:f.director.settings(f.project.id).selectionDigest,selection:f.selection};await f.director.changeSelection(f.project.id,input,'first');await f.change({...f.selection,model:'model-b'},'second');
  const count=f.setups.length,response=await f.director.changeSelection(f.project.id,input,'first');assert.equal(response.selection.model,'model-b');assert.equal(response.selectionMatchesCommand,false);assert.equal(response.readiness,null);assert.equal(f.setups.length,count);
  await assert.rejects(f.director.changeSelection(f.project.id,{...input,selection:{mode:'fake'}},'first'),{code:'IDEMPOTENCY_CONFLICT'});assert.equal(f.setups.length,count);
});
test('stale selection and caller data mutation cannot redirect a switch',async t=>{
  const entered=gate(),release=gate(),f=fixture(t,{setup:async()=>{entered.resolve();await release.promise;}}),input={expectedSelectionDigest:f.director.settings(f.project.id).selectionDigest,selection:{...f.selection}},pending=f.director.changeSelection(f.project.id,input,'snapshot');
  await entered.promise;input.selection.model='changed';release.resolve();await pending;assert.equal(f.director.settings(f.project.id).selection.model,'model-a');
  await assert.rejects(f.director.changeSelection(f.project.id,{expectedSelectionDigest:'0'.repeat(64),selection:{mode:'fake'}},'stale'),{code:'DIRECTOR_SELECTION_STALE'});
});
test('authenticated change route validates shape and reports current next-turn settings',async t=>{
  const f=fixture(t),initial=(await f.req('GET','/setup')).json(),reply=await f.req('POST','/change',{expectedSelectionDigest:initial.selectionDigest,selection:f.selection});assert.equal(reply.statusCode,200,reply.body);assert.equal(reply.json().changeAppliesTo,'next_turn');assert.equal(reply.json().selection.model,'model-a');
  const invalid=await f.req('POST','/change',{expectedSelectionDigest:initial.selectionDigest,selection:f.selection,force:true},'extra');assert.equal(invalid.statusCode,400);assert.equal(f.calls.length,0);
});
