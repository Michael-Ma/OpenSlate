import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readdirSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Store} from '../dist/persistence/store.js';
import {Engine} from '../dist/execution/engine.js';
import {ProductionService} from '../dist/application/service.js';
import {LocalDirectorController} from '../dist/application/local-director.js';
import {FakeProvider} from '../../../packages/providers/dist/index.js';
import {createApp} from '../dist/app.js';

const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url));
const done=(input,status='completed')=>({projectId:input.projectId,requestId:input.requestId,epochId:input.epochId,turnId:input.turnId,status,text:'Native fixture response',dispatched:true,nativeThreadId:`thread-${input.turnId}`});
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function writable(path){chmodSync(path,0o755);for(const item of readdirSync(path,{withFileTypes:true}))if(item.isDirectory())writable(join(path,item.name));}
function fixture(t,overrides={}){
  const root=mkdtempSync(join(tmpdir(),'openslate-local-controller-')),store=new Store(join(root,'app.sqlite')),provider=new FakeProvider(join(root,'fake.sqlite'));
  const engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),service=new ProductionService(store,engine),calls=[],setups=[];
  const config={repositoryRoot,dataDirectory:root,endpoint:'http://127.0.0.1:3001',defaults:{binaryPath:process.execPath,model:'test-model'},
    setup:async input=>{setups.push(input);return{readiness:{status:'ready',model:input.model},runtimeOptions:{}};},
    makeRuntime:()=>({id:'codex-app-server',start:async(input,options)=>{calls.push(input);await options.onEvent({...input,kind:'runtime_started',nativeThreadId:`thread-${input.turnId}`});return done(input);}}),...overrides};
  const director=new LocalDirectorController(service,config),token=randomBytes(32).toString('base64url'),app=createApp({service,director,runtimeSettings:director,localToken:token});
  t.after(async()=>{await director.close();await app.close();provider.close();store.close();writable(root);rmSync(root,{recursive:true,force:true});});
  const req=(method,url,payload,key='request')=>app.inject({method,url,payload,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,'idempotency-key':key}});
  const native={mode:'native',binaryPath:process.execPath,model:'test-model'};
  return{root,store,provider,service,director,calls,setups,req,native,config,app};
}
test('authenticated project setup persists choices without starting a model',async t=>{
  const f=fixture(t),project=f.service.createProject('Live project'),path=`/api/projects/${project.id}/director/setup`;
  assert.equal((await f.app.inject({method:'GET',url:path,headers:{host:'127.0.0.1'}})).statusCode,403);
  const initial=(await f.req('GET',path)).json();assert.equal(initial.selection.mode,'fake');assert.equal(initial.locked,false);
  const configured=await f.req('POST',path,f.native,'configure');assert.equal(configured.statusCode,200,configured.body);
  assert.equal(configured.json().selection.mode,'native');assert.equal(f.calls.length,0);assert.equal(f.store.list('native_model_start',project.id).length,0);
  assert.equal((await f.req('POST',path,f.native,'configure')).statusCode,200);assert.equal(f.setups.length,1);
  assert.equal(f.setups[0].directories.projection.startsWith(f.root),true);
  assert.deepEqual(Object.keys(f.setups[0].env).sort(),['CI','NO_COLOR','PATH','SHELL']);
  assert.equal((await f.req('POST',path,{mode:'fake'},'configure')).statusCode,409,'a reused identity cannot choose a different director');
  assert.equal(f.director.mode(project.id),'native');
});
test('fake and native controllers only claim their own projects and preserve separate locks',async t=>{
  const f=fixture(t),native=f.service.createProject('Native'),fake=f.service.createProject('Fake');
  await f.director.configure(native.id,f.native,'setup');
  await f.req('POST',`/api/projects/${fake.id}/messages`,{text:'Tell me about this project'},'fake-request');
  await f.req('POST',`/api/projects/${native.id}/messages`,{text:'Ask for my film brief'},'native-request');
  await f.director.settle();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].projectId,native.id);
  assert.equal(f.store.list('director_turn',native.id)[0].state,'completed');assert.equal(f.store.list('director_turn',fake.id)[0].runtimeId,'fake-workflow-v1');
  assert.equal(f.store.list('native_model_start',native.id).length,1);assert.equal(f.store.list('native_model_start',fake.id).length,0);
  assert.equal(f.store.list('grant',native.id).length,0);assert.equal(f.provider.acceptedCount(),0);
  assert.equal((await f.req('POST',`/api/projects/${native.id}/demo`,{action:'create'},'demo-denied')).statusCode,403);
  assert.equal(f.director.settings(native.id).locked,true);
  await assert.rejects(f.director.configure(native.id,{...f.native,model:'different'},'change'),e=>e.code==='DIRECTOR_SELECTION_LOCKED');
});
test('a conversation racing setup retains the original project director',async t=>{
  const wait=gate(),entered=gate();const f=fixture(t,{setup:async()=>{entered.resolve();await wait.promise;return{readiness:{status:'ready'},runtimeOptions:{}};}});
  const project=f.service.createProject('Race'),configure=f.director.configure(project.id,f.native,'config');await entered.promise;
  f.director.enqueue(project.id,f.service.beginRequest(project.id,'human','Start demo conversation'));f.director.tick();await f.director.settle();wait.resolve();
  await assert.rejects(configure,e=>e.code==='DIRECTOR_SELECTION_LOCKED');assert.equal(f.director.mode(project.id),'fake');assert.equal(f.calls.length,0);
});
test('replacing the local controller reconstructs native context from the same project',async t=>{
  const f=fixture(t),project=f.service.createProject('Restart');await f.director.configure(project.id,f.native,'config');
  f.director.enqueue(project.id,f.service.beginRequest(project.id,'human','First question'));f.director.tick();await f.director.settle();
  const lock=f.store.list('director_skill_lock',project.id)[0].lock;await f.director.close();
  const restarted=new LocalDirectorController(f.service,f.config);t.after(()=>restarted.close());
  restarted.enqueue(project.id,f.service.beginRequest(project.id,'human','Follow up'));restarted.tick();await restarted.settle();
  assert.equal(f.calls.length,2);assert.equal(restarted.mode(project.id),'native');assert.equal(f.store.list('native_model_start',project.id).length,2);
  assert.notEqual(f.calls[0].epochId,f.calls[1].epochId);assert.notEqual(f.calls[0].bridge.credential,f.calls[1].bridge.credential);
  assert.deepEqual(f.store.list('director_skill_lock',project.id)[0].lock,lock);assert.match(f.calls[1].context,/Native fixture response/);
});
test('unknown native completion remains recorded and never automatically replays',async t=>{
  let starts=0;const f=fixture(t,{makeRuntime:()=>({id:'codex-app-server',start:async(input,options)=>{starts++;await options.onEvent({...input,kind:'runtime_started',nativeThreadId:'unknown-thread'});return done(input,'unknown');}})});
  const project=f.service.createProject('Unknown');await f.director.configure(project.id,f.native,'config');
  f.director.enqueue(project.id,f.service.beginRequest(project.id,'human','Try once'));f.director.tick();await f.director.settle();
  f.director.tick();await f.director.settle();assert.equal(starts,1);assert.equal(f.store.list('director_turn',project.id)[0].state,'unknown');assert.equal(f.store.list('native_model_start',project.id).length,1);
});
test('conflicting configuration identity is rejected before any setup or binary invocation',async t=>{
  const f=fixture(t),project=f.service.createProject('Identity');
  await f.director.configure(project.id,f.native,'command');
  await assert.rejects(f.director.configure(project.id,{...f.native,model:'conflicting-model'},'command'),e=>e.code==='IDEMPOTENCY_CONFLICT');
  assert.equal(f.setups.length,1);assert.equal(f.calls.length,0);
  assert.equal(f.store.list('director_selection_command',project.id)[0].state,'completed');
});
test('failed setup reserves its exact payload and the same command can succeed after restart',async t=>{
  let checks=0;const f=fixture(t,{setup:async input=>{checks++;return checks===1?{readiness:{status:'blocked'}}:{readiness:{status:'ready',model:input.model},runtimeOptions:{}};}});
  const project=f.service.createProject('Retry');
  await assert.rejects(f.director.configure(project.id,f.native,'retryable-command'),e=>e.code==='DIRECTOR_SETUP_REQUIRED');
  assert.equal(f.director.mode(project.id),'fake');assert.equal(f.store.list('director_selection_command',project.id)[0].state,'pending');
  await f.director.close();const restarted=new LocalDirectorController(f.service,f.config);t.after(()=>restarted.close());
  await assert.rejects(restarted.configure(project.id,{...f.native,model:'different'},'retryable-command'),e=>e.code==='IDEMPOTENCY_CONFLICT');
  assert.equal(checks,1);
  const response=await restarted.configure(project.id,f.native,'retryable-command');assert.equal(response.readiness.status,'ready');assert.equal(checks,2);
  assert.equal(response.selectionMatchesCommand,true);assert.equal(f.store.list('director_selection_command',project.id)[0].state,'completed');
  await restarted.configure(project.id,f.native,'retryable-command');assert.equal(checks,2);assert.equal(f.calls.length,0);
});
test('replaying an older successful choice returns current matching readiness without reapplying it',async t=>{
  const f=fixture(t),project=f.service.createProject('Replay');
  await f.director.configure(project.id,{...f.native,model:'model-A'},'command-A');
  const chosen=await f.director.configure(project.id,{...f.native,model:'model-B'},'command-B');
  const replay=await f.director.configure(project.id,{...f.native,model:'model-A'},'command-A');
  assert.equal(replay.selection.model,'model-B');assert.equal(replay.readiness.model,'model-B');
  assert.equal(replay.selectionMatchesCommand,false);assert.equal(replay.readinessSelectionDigest,chosen.readinessSelectionDigest);
  assert.equal(f.setups.length,2);assert.equal(f.store.readEvents(project.id,0).filter(event=>event.kind==='director.configured').length,2);
});
test('concurrent setup reserves pending command identity before rejecting a conflicting payload',async t=>{
  const entered=gate(),release=gate();let checks=0;
  const f=fixture(t,{setup:async input=>{checks++;entered.resolve();await release.promise;return{readiness:{status:'ready',model:input.model},runtimeOptions:{}};}});
  const project=f.service.createProject('Concurrent'),first=f.director.configure(project.id,f.native,'pending');await entered.promise;
  await assert.rejects(f.director.configure(project.id,{...f.native,model:'different'},'pending'),e=>e.code==='IDEMPOTENCY_CONFLICT');
  await assert.rejects(f.director.configure(project.id,f.native,'pending'),e=>e.code==='DIRECTOR_SETUP_BUSY');
  assert.equal(checks,1);release.resolve();await first;
  const replay=await f.director.configure(project.id,f.native,'pending');assert.equal(replay.readiness.status,'ready');assert.equal(checks,1);
});
test('legacy completed setup receipts return the current selection and its own readiness',async t=>{
  const f=fixture(t),project=f.service.createProject('Legacy');
  const {digest}=await import('../../../packages/core/dist/index.js');
  const old={...f.native,model:'old-model'};
  f.store.command(`local-user:${project.id}:director-selection`,'legacy',digest(old),()=>({selectionDigest:digest(old)}));
  await f.director.configure(project.id,f.native,'current');
  const replay=await f.director.configure(project.id,old,'legacy');
  assert.equal(replay.selection.model,f.native.model);assert.equal(replay.readiness.model,f.native.model);
  assert.equal(replay.selectionMatchesCommand,false);assert.equal(f.setups.length,1);
});
test('binary suggestions preserve explicit overrides and prefer installed app binaries over PATH launchers',async t=>{
  const f=fixture(t),binaryDirectory=join(f.root,'bin');mkdirSync(binaryDirectory);symlinkSync(process.execPath,join(binaryDirectory,'codex'));
  const priorPath=process.env.PATH,priorOverride=process.env.OPENSLATE_CODEX_BINARY;
  t.after(()=>{if(priorPath===undefined)delete process.env.PATH;else process.env.PATH=priorPath;
    if(priorOverride===undefined)delete process.env.OPENSLATE_CODEX_BINARY;else process.env.OPENSLATE_CODEX_BINARY=priorOverride;});
  process.env.PATH=binaryDirectory;process.env.OPENSLATE_CODEX_BINARY=process.execPath;
  const explicit=new LocalDirectorController(f.service,{...f.config,defaults:undefined});t.after(()=>explicit.close());
  assert.equal(explicit.defaults.binaryPath,realpathSync(process.execPath));
  delete process.env.OPENSLATE_CODEX_BINARY;
  const suggested=new LocalDirectorController(f.service,{...f.config,defaults:undefined});t.after(()=>suggested.close());
  const installed=['/Applications/ChatGPT.app/Contents/Resources/codex','/Applications/Codex.app/Contents/Resources/codex'].find(existsSync);
  assert.equal(suggested.defaults.binaryPath,realpathSync(installed??process.execPath));assert.equal(f.setups.length,0);
});
