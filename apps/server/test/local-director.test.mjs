import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readdirSync,realpathSync,rmSync} from 'node:fs';
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
test('authenticated model listing retains only diagnostic evidence without configuring a demo project or writing domain state',async t=>{
  const f=fixture(t,{setup:async input=>({readiness:{status:'ready',model:input.model,checkedAt:'2026-10-03T12:00:00.000Z',modelChoices:[{id:'test-model',label:'Fixture model'}]},runtimeOptions:{}})}),project=f.service.createProject('Models'),path=`/api/projects/${project.id}/director/models`;
  const before=()=>JSON.stringify(['projects','entities','events','commands'].map(table=>f.store.db.prepare(`SELECT * FROM ${table}${table==='entities'?" WHERE kind!='director_local_check'":''} ORDER BY rowid`).all())),saved=before();
  assert.equal((await f.app.inject({method:'GET',url:path,headers:{host:'127.0.0.1'}})).statusCode,403);
  const response=await f.req('GET',path);assert.equal(response.statusCode,200,response.body);
  assert.deepEqual(response.json().modelChoices,[{id:'test-model',label:'Fixture model'}]);assert.equal(response.json().modelCatalogStatus,'ready');assert.equal(response.json().selection.mode,'fake');
  assert.equal(response.json().modelCatalogCheckedAt,'2026-10-03T12:00:00.000Z');assert.equal(before(),saved);assert.equal(f.calls.length,0);
  assert.equal(f.store.list('director_local_check',project.id).length,1);
  assert.deepEqual(f.director.settings(project.id).modelChoices,response.json().modelChoices);assert.equal(f.provider.acceptedCount(),0);
  const detached=f.director.settings(project.id);detached.modelChoices[0].id='caller-supplied';assert.equal(f.director.settings(project.id).modelChoices[0].id,'test-model');
});

test('successful local check survives controller restart with exact program, pinned version and original time, without a model turn',async t=>{
  let checks=0;const checkedAt='2026-10-16T12:34:56.000Z';
  const f=fixture(t,{setup:async input=>{checks++;return{readiness:{status:'ready',model:input.model,checkedAt,modelChoices:[{id:input.model,label:'Fixture'}]},runtimeOptions:{}};}}),project=f.service.createProject('Restarted check');
  const initial=f.director.settings(project.id);assert.equal(initial.modelCatalogStatus,'unchecked');assert.equal(initial.lastSuccessfulCheck,null);
  await f.director.configure(project.id,f.native,'setup');
  await f.director.close();const restarted=new LocalDirectorController(f.service,f.config);t.after(()=>restarted.close());
  const restored=restarted.settings(project.id);
  assert.equal(restored.modelCatalogStatus,'ready');assert.equal(restored.modelCatalogCheckedAt,checkedAt);
  assert.deepEqual(restored.lastSuccessfulCheck,{binaryPath:f.native.binaryPath,version:'0.153.4',checkedAt});
  assert.deepEqual(restored.modelChoices,[{id:f.native.model,label:'Fixture'}]);
  restored.lastSuccessfulCheck.binaryPath='caller-supplied';assert.equal(restarted.settings(project.id).lastSuccessfulCheck.binaryPath,f.native.binaryPath);
  assert.equal(checks,1);assert.equal(f.calls.length,0);assert.equal(f.store.list('native_model_start',project.id).length,0);
  const rows=f.store.list('director_local_check',project.id);assert.equal(rows.length,1);
  assert.deepEqual(Object.keys(rows[0]).sort(),['checkedAt','diagnostic','id','lastSuccessfulCheck','modelChoices','projectId','status']);
  const reopenedStore=new Store(join(f.root,'app.sqlite')),reopenedService=new ProductionService(reopenedStore,new Engine(reopenedStore,f.provider,{artifactDir:join(f.root,'artifacts')}));
  const reopened=new LocalDirectorController(reopenedService,f.config);
  try { assert.deepEqual(reopened.settings(project.id).lastSuccessfulCheck,{binaryPath:f.native.binaryPath,version:'0.153.4',checkedAt}); }
  finally { await reopened.close();reopenedStore.close(); }
});

test('restored successful evidence never bypasses the full setup check before another native turn',async t=>{
  const f=fixture(t),project=f.service.createProject('Preflight after restart');await f.director.configure(project.id,f.native,'setup');
  await f.director.close();const restarted=new LocalDirectorController(f.service,f.config);t.after(()=>restarted.close());
  assert.ok(restarted.settings(project.id).lastSuccessfulCheck);assert.equal(f.setups.length,1);
  restarted.enqueue(project.id,f.service.beginRequest(project.id,'human','Continue the film'));restarted.tick();await restarted.settle();
  assert.equal(f.setups.length,2);assert.equal(f.calls.length,1);
});

test('a failed latest local check survives restart and never turns older successful evidence into readiness',async t=>{
  let failure=false;const checkedAt='2026-10-16T12:34:56.000Z';
  const f=fixture(t,{setup:async input=>({readiness:failure?{status:'blocked',checkedAt:'2026-10-16T13:00:00.000Z',issues:[{code:'SETUP_AUTH_REQUIRED',message:'fixture account unavailable'}]}:
    {status:'ready',model:input.model,checkedAt,modelChoices:[{id:input.model,label:'Fixture'}]},...(failure?{}:{runtimeOptions:{}})})}),project=f.service.createProject('Failed refresh');
  await f.director.configure(project.id,f.native,'setup');failure=true;await f.director.models(project.id);
  const replay=await f.director.configure(project.id,f.native,'setup');assert.equal(replay.modelCatalogStatus,'blocked');
  assert.equal(replay.lastSuccessfulCheck.checkedAt,checkedAt,'older command replay must not publish a new successful check');
  await f.director.close();
  const restarted=new LocalDirectorController(f.service,f.config);t.after(()=>restarted.close());const settings=restarted.settings(project.id);
  assert.equal(settings.modelCatalogStatus,'blocked');assert.equal(settings.modelCatalogCheckedAt,'2026-10-16T13:00:00.000Z');
  assert.deepEqual(settings.lastSuccessfulCheck,{binaryPath:f.native.binaryPath,version:'0.153.4',checkedAt});assert.equal(f.calls.length,0);
});

test('failed first check remains blocked after restart and has no fabricated successful check',async t=>{
  const f=fixture(t,{setup:async()=>({readiness:{status:'blocked',checkedAt:'2026-10-16T13:00:00.000Z'}})}),project=f.service.createProject('Never passed');
  await f.director.models(project.id);await f.director.close();const restarted=new LocalDirectorController(f.service,f.config);t.after(()=>restarted.close());
  const settings=restarted.settings(project.id);assert.equal(settings.modelCatalogStatus,'blocked');assert.equal(settings.lastSuccessfulCheck,null);assert.equal(f.calls.length,0);
});

test('historical checks do not transfer to another program, model, native home or runtime setup configuration',async t=>{
  const f=fixture(t),project=f.service.createProject('Exact check identity');await f.director.models(project.id);
  for(const changes of [{defaults:{...f.config.defaults,binaryPath:'/some/other/codex'}},{defaults:{...f.config.defaults,model:'other-model'}},
    {defaults:{...f.config.defaults,codexHome:join(f.root,'other-native-home')}},{runTimeoutMs:360000}]){
    const restarted=new LocalDirectorController(f.service,{...f.config,...changes});t.after(()=>restarted.close());
    const settings=restarted.settings(project.id);assert.equal(settings.modelCatalogStatus,'unchecked');assert.equal(settings.lastSuccessfulCheck,null);
  }
  assert.equal(f.setups.length,1);assert.equal(f.calls.length,0);
});
test('model choices from setup are cached only for the exact native selection and active conversations do not launch model checks',async t=>{
  let checks=0;const f=fixture(t,{setup:async input=>{checks++;return{readiness:{status:'ready',model:input.model,checkedAt:'2026-10-03T12:00:00.000Z',modelChoices:[{id:input.model,label:input.model}]},runtimeOptions:{}};}}),project=f.service.createProject('Cached choices');
  await f.director.configure(project.id,f.native,'setup');assert.equal(checks,1);assert.equal(f.director.settings(project.id).modelCatalogStatus,'ready');
  f.director.enqueue(project.id,f.service.beginRequest(project.id,'human','A queued conversation'));
  const response=await f.director.models(project.id);assert.equal(response.busy,true);assert.equal(checks,1);assert.deepEqual(response.modelChoices,[{id:'test-model',label:'test-model'}]);assert.equal(f.calls.length,0);
  f.director.tick();await f.director.settle();await f.director.changeSelection(project.id,{expectedSelectionDigest:f.director.settings(project.id).selectionDigest,selection:{...f.native,model:'different-model'}},'change');
  assert.deepEqual(f.director.settings(project.id).modelChoices,[{id:'different-model',label:'different-model'}]);assert.equal(checks,2);
});
test('model refresh replaces cached legacy readiness without requiring selection writes or model turns',async t=>{
  let checks=0;const f=fixture(t,{setup:async input=>({readiness:{status:'ready',model:input.model,...(++checks>1?{checkedAt:'2026-10-03T12:00:00.000Z',modelChoices:[{id:input.model,label:input.model}]}:{})},runtimeOptions:{}})}),project=f.service.createProject('Legacy readiness');
  await f.director.configure(project.id,f.native,'setup');assert.equal(f.director.settings(project.id).modelCatalogStatus,'unchecked');
  const before=JSON.stringify(f.store.list('project_director_selection',project.id)),cursor=f.store.cursor(project.id),response=await f.director.models(project.id);
  assert.equal(response.modelCatalogStatus,'ready');assert.equal(checks,2);assert.equal(f.calls.length,0);assert.equal(f.store.cursor(project.id),cursor);assert.equal(JSON.stringify(f.store.list('project_director_selection',project.id)),before);
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
test('host shutdown closes the active native runtime concurrently with its supervisor abort', {timeout:4000}, async t=>{
  const entered=gate(),release=gate();let closed=0;
  const f=fixture(t,{makeRuntime:()=>({id:'codex-app-server',start:async(input,options)=>{
    await options.onEvent({...input,kind:'runtime_started',nativeThreadId:'closing-thread'});entered.resolve();await release.promise;return done(input,'unknown');
  },close:async()=>{closed++;release.resolve();}})}),project=f.service.createProject('Shutdown');
  await f.director.configure(project.id,f.native,'setup');f.director.enqueue(project.id,f.service.beginRequest(project.id,'human','Write once'));f.director.tick();
  await entered.promise;await f.director.close();assert.equal(closed,1);assert.equal(f.store.list('director_turn',project.id)[0].state,'unknown');
  assert.equal(f.provider.acceptedCount(),0);assert.equal(f.store.list('native_model_start',project.id).length,1);
});
test('host shutdown cancels a local setup check without replacing the last successful diagnostic', {timeout:4000}, async t=>{
  const entered=gate(),cleanup=gate();let wait=false,aborted=false;
  const f=fixture(t,{setup:async(input,options)=>{
    if(!wait)return{readiness:{status:'ready',model:input.model,checkedAt:'2026-10-16T12:34:56.000Z'},runtimeOptions:{}};
    entered.resolve();await new Promise(resolve=>options.signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));await cleanup.promise;
    return{readiness:{status:'blocked',checkedAt:'2026-10-16T13:00:00.000Z'}};
  }}),project=f.service.createProject('Cancelled check');
  await f.director.configure(project.id,f.native,'setup');const before=f.store.list('director_local_check',project.id);wait=true;
  const checking=f.director.models(project.id),refused=assert.rejects(checking,{code:'DIRECTOR_SHUTTING_DOWN'});
  await entered.promise;let closed=false;const closing=f.director.close().then(()=>{closed=true;});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(aborted,true);assert.equal(closed,false,'shutdown waits for setup native cleanup even when no supervisor turn is active');
  cleanup.resolve();await closing;await refused;
  assert.equal(aborted,true);assert.deepEqual(f.store.list('director_local_check',project.id),before);assert.equal(f.calls.length,0);
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
test('default binary suggestions honor the image worker configuration without probing any account',async t=>{
  const f=fixture(t),priorOverride=process.env.OPENSLATE_CODEX_BINARY,priorImage=process.env.OPENSLATE_CODEX_IMAGE_BINARY;
  t.after(()=>{for(const [name,value] of [['OPENSLATE_CODEX_BINARY',priorOverride],['OPENSLATE_CODEX_IMAGE_BINARY',priorImage]])
    if(value===undefined)delete process.env[name];else process.env[name]=value;});
  delete process.env.OPENSLATE_CODEX_BINARY;process.env.OPENSLATE_CODEX_IMAGE_BINARY=process.execPath;
  const suggested=new LocalDirectorController(f.service,{...f.config,defaults:undefined});t.after(()=>suggested.close());
  assert.equal(suggested.defaults.binaryPath,realpathSync(process.execPath));assert.equal(f.setups.length,0);assert.equal(f.calls.length,0);
});
test('version mismatch errors and Settings name expected, found, selected path and supported install without saving the failed choice',async t=>{
  let matches=false;
  const f=fixture(t,{setup:async input=>matches?{readiness:{status:'ready',model:input.model},runtimeOptions:{}}:
    {readiness:{status:'blocked',binaryVersion:{expectedVersion:'0.153.4',foundVersion:'0.162.0-alpha.4'},issues:[{code:'SETUP_VERSION_MISMATCH',message:'local issue'}]}}});
  const project=f.service.createProject('Pinned runtime'),path=`/api/projects/${project.id}/director/setup`;
  const response=await f.req('POST',path,f.native,'version-setup');assert.equal(response.statusCode,409,response.body);
  const details=response.json().error.details;
  assert.deepEqual({code:response.json().error.code,expectedVersion:details.expectedVersion,foundVersion:details.foundVersion,binaryPath:details.binaryPath},
    {code:'DIRECTOR_CODEX_VERSION_MISMATCH',expectedVersion:'0.153.4',foundVersion:'0.162.0-alpha.4',binaryPath:f.native.binaryPath});
  assert.ok(details.installPath.endsWith('/.local/share/openslate-codex/node_modules/.bin/codex'));
  for(const value of [details.expectedVersion,details.foundVersion,details.binaryPath,details.installPath])assert.ok(response.json().error.message.includes(value));
  assert.deepEqual((await f.req('GET',path)).json().codexDiagnostic,details);assert.equal(f.director.mode(project.id),'fake');assert.equal(f.calls.length,0);
  assert.equal(f.store.list('director_selection_command',project.id)[0].state,'pending');
  matches=true;const retried=await f.req('POST',path,f.native,'version-setup');assert.equal(retried.statusCode,200,retried.body);
  assert.equal(retried.json().codexDiagnostic,null);assert.equal(retried.json().selection.mode,'native');assert.equal(f.calls.length,0);
});
test('read-only model checks expose the same version diagnosis without configuring or starting a turn',async t=>{
  const f=fixture(t,{setup:async()=>({readiness:{status:'blocked',issues:[{code:'SETUP_VERSION_MISMATCH',message:'local issue'}],
    binaryVersion:{expectedVersion:'0.153.4',foundVersion:'0.162.0-alpha.4'}}})}),project=f.service.createProject('Models blocked');
  const result=await f.director.models(project.id);assert.equal(result.modelCatalogStatus,'blocked');
  assert.equal(result.codexDiagnostic.foundVersion,'0.162.0-alpha.4');assert.equal(result.codexDiagnostic.binaryPath,f.native.binaryPath);
  assert.equal(result.selection.mode,'fake');assert.equal(f.calls.length,0);assert.equal(f.store.list('project_director_selection',project.id).length,0);
});

test('an older version inspection cannot replace the successful setup diagnosis for the same program',async t=>{
  const entered=gate(),release=gate();let checks=0;
  const f=fixture(t,{setup:async input=>{if(++checks===1){entered.resolve();await release.promise;return{readiness:{status:'blocked',issues:[{code:'SETUP_VERSION_MISMATCH',message:'local issue'}],
    binaryVersion:{expectedVersion:'0.153.4',foundVersion:'0.162.0-alpha.4'}}};}
    return{readiness:{status:'ready',model:input.model,modelChoices:[{id:input.model,label:input.model}]},runtimeOptions:{}};}});
  const project=f.service.createProject('Racing version check'),older=f.director.models(project.id);await entered.promise;
  await f.director.configure(project.id,f.native,'newer-check');release.resolve();const current=await older;
  assert.equal(current.modelCatalogStatus,'ready');assert.equal(current.codexDiagnostic,null);assert.equal(current.selection.mode,'native');assert.equal(f.calls.length,0);
});

test('a host-configured Director turn limit reaches local Codex setup without changing model selection',async t=>{
  const f=fixture(t,{runTimeoutMs:360000}),project=f.service.createProject('Configured turn limit');
  await f.director.configure(project.id,f.native,'configured-timeout');
  assert.equal(f.setups.length,1);assert.equal(f.setups[0].limits.runTimeoutMs,360000);assert.equal(f.calls.length,0);
});
