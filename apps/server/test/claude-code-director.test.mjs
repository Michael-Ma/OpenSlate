import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeDirectorRuntime } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { FakeProvider } from '@openslate/providers';
import { createApp } from '../dist/app.js';
import { fakeClaude } from '../../../packages/director/test/claude-code-helpers.mjs';
import { CODE_PLAN_GUIDANCE_DIGEST } from '../dist/application/director-capabilities.js';
const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url));
function writable(path){chmodSync(path,0o700);for(const item of readdirSync(path,{withFileTypes:true}))if(item.isDirectory())writable(join(path,item.name));}
function codePort(){return {held:[],released:[],view(projectId){return{projectId,planVersion:null,state:'empty',held:false,ceilingMicros:'4000000',spentMicros:'0',reservedMicros:'0',declarations:{scenes:[],shots:[]},steps:[],choices:[],versions:[],logs:[],reviews:[],lastPassAt:null};},hold(id,request){this.held.push(request);},release(id,request){this.released.push(request);},failure(){return null;}};}
async function fixture(t,options={}){
  const cli=fakeClaude(t,options.cli),root=realpathSync(mkdtempSync(join(tmpdir(),'openslate-claude-controller-'))),store=new Store(join(root,'app.sqlite')),provider=new FakeProvider(join(root,'fake.sqlite'));
  const service=new ProductionService(store,new Engine(store,provider,{artifactDir:join(root,'artifacts')})),plans=codePort(),setups=[],nativeInputs=[];
  const config={repositoryRoot,dataDirectory:root,endpoint:'http://127.0.0.1:3199',codePlans:plans,runTimeoutMs:15000,
    defaults:{binaryPath:process.execPath,model:'fixture-codex'},
    setupClaude:async input=>{setups.push(input);return{status:'ready',binaryPath:cli.binaryPath,version:'2.1.312',...options.readiness};},
    makeClaudeRuntime:opts=>new ClaudeCodeDirectorRuntime({...opts,env:cli.env}),
    setup:async()=>({readiness:{status:'ready'},runtimeOptions:{}}),
    makeRuntime:()=>({id:'codex-app-server',start:async(input,options)=>{nativeInputs.push(input);await options.onEvent?.({...input,kind:'runtime_started',nativeThreadId:'codex-fixture'});return{...input,status:'completed',text:'Back on Codex',dispatched:true};}})};
  const director=new LocalDirectorController(service,config),token=randomBytes(32).toString('base64url'),app=createApp({service,director,runtimeSettings:director,localToken:token});
  await app.listen({port:0,host:'127.0.0.1'});config.endpoint=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await director.close();await app.close();provider.close();store.close();writable(root);rmSync(root,{recursive:true,force:true});});
  const project=service.createProject('Claude film');if(options.graph!==true)store.saveProject({...project,planMode:'code'},project.headVersion);
  const req=(method,suffix,payload,key='fixture')=>app.inject({method,url:`/api/projects/${project.id}/director/${suffix}`,payload,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,'idempotency-key':key}});
  const run=async text=>{const actor=service.beginRequest(project.id,'human',text),turn=director.enqueue(project.id,actor);director.tick();await director.settle();return store.get('director_turn',turn.id);};
  return{cli,root,store,provider,service,plans,director,project,req,run,setups,nativeInputs,config,app};
}

test('code film saves Claude with default Opus and exposes the Settings contract without spending a turn',async t=>{
  const f=await fixture(t);const initial=(await f.req('GET','setup')).json();
  assert.equal(initial.claude.available,true);assert.equal(initial.claude.status,'unchecked');assert.deepEqual(initial.claude.models,[{id:'claude-opus-5-5',label:'Opus 5.5'},{id:'claude-sonnet-5-5',label:'Sonnet 5.5'}]);
  const configured=await f.req('POST','setup',{mode:'claude'},'save');assert.equal(configured.statusCode,200,configured.body);
  const setup=configured.json();assert.deepEqual(setup.selection,{mode:'claude',model:'claude-opus-5-5'});assert.equal(setup.claude.status,'ready');assert.equal(setup.claude.version,'2.1.312');assert.equal(setup.claude.reason,null);assert.equal(setup.changeAppliesTo,'next_turn');
  assert.equal(f.store.list('director_turn',f.project.id).length,0);assert.equal(f.cli.records().length,0);assert.equal(f.setups.length,1);
  const replay=await f.req('POST','setup',{mode:'claude'},'save');assert.equal(replay.statusCode,200);assert.equal(f.setups.length,1);
  assert.equal((await f.req('POST','setup',{mode:'claude',model:'wrong'},'wrong')).statusCode,400);
});

test('storyboard films refuse Claude on both selection routes before setup',async t=>{
  const f=await fixture(t,{graph:true});const initial=(await f.req('GET','setup')).json();assert.equal(initial.claude.available,false);
  for(const [route,body] of [['setup',{mode:'claude'}],['change',{expectedSelectionDigest:initial.selectionDigest,selection:{mode:'claude'}}]]){
    const response=await f.req('POST',route,body,route);assert.notEqual(response.statusCode,200);assert.equal(response.json().error.code,'DIRECTOR_RUNTIME_UNSUPPORTED');assert.match(response.json().error.message,/code-plan films only/);
  }
  assert.equal(f.setups.length,0);assert.equal(f.director.mode(f.project.id),'fake');
});

test('Claude supervisor saves final text, native ids, runtime binding, holds and live thread classification',async t=>{
  const f=await fixture(t);await f.director.configure(f.project.id,{mode:'claude',binaryPath:f.cli.binaryPath,model:'claude-sonnet-5-5'},'save');
  const turn=await f.run('Please direct my code film');assert.equal(turn.state,'completed',JSON.stringify(turn));assert.equal(turn.runtimeId,'claude-code');assert.equal(turn.dispatched,true);assert.equal(turn.nativeThreadId,'fixture-session');assert.equal(turn.nativeTurnId,'fixture-session');
  const output=f.store.list('director_output',f.project.id).filter(row=>row.turnId===turn.id);assert.equal(output.at(-1).phase,'final');assert.equal(output.at(-1).text,'The film is ready for your next direction.');
  assert.equal(f.store.list('native_model_start',f.project.id).length,1);assert.deepEqual(f.plans.held,f.plans.released);
  const lock=f.store.list('director_skill_lock',f.project.id).at(-1).lock;assert.equal(lock.bindings.find(row=>row.kind==='runtime').id,'claude-code');assert.equal(lock.skills[0].packageDigest,CODE_PLAN_GUIDANCE_DIGEST);assert.equal(lock.compatibility.toolContract,'0.3.0');
  const sent=f.cli.records().find(row=>row.input).input;assert.equal(sent.message.content[0].text,'Please direct my code film');
  const args=f.cli.records().find(row=>row.argv?.includes('-p')).argv;assert.equal(args[args.indexOf('--model')+1],'claude-sonnet-5-5');
  const thread=f.service.snapshot(f.project.id);assert.equal(thread.turns.find(row=>row.id===turn.id)?.runtime,'live');
  assert.equal(f.provider.acceptedCount(),0);
});

test('Claude fake traverses the real stdio/HTTP bridge and records a normal tool_invocation',async t=>{
  const f=await fixture(t,{cli:{realBridge:true}});await f.director.configure(f.project.id,{mode:'claude'},'save');
  const turn=await f.run('Read the film');assert.equal(turn.state,'completed',JSON.stringify(turn));
  const tools=f.store.list('tool_invocation',f.project.id);assert.equal(tools.length,1);assert.equal(tools[0].toolName??tools[0].tool,'read_film');
  assert.equal(tools[0].state,'succeeded');assert.equal(tools[0].epochId,turn.epochId);assert.equal(f.cli.records().find(row=>row.called).called.result.isError,false);
  assert.equal(f.provider.acceptedCount(),0);
});

test('a rejected Claude init never reaches application tool_invocations, even racing the real bridge',async t=>{
  const f=await fixture(t,{cli:{realBridge:true,init:{apiKeySource:'apiKeyHelper'}}});await f.director.configure(f.project.id,{mode:'claude'},'save');
  const turn=await f.run('Read the film');assert.equal(turn.state,'failed',JSON.stringify(turn));assert.equal(turn.errorCode,'CLAUDE_CODE_NOT_ON_PLAN');assert.equal(turn.dispatched,true);
  assert.equal(f.store.list('tool_invocation',f.project.id).length,0);assert.equal(f.store.list('native_model_start',f.project.id).length,0);assert.deepEqual(f.plans.held,f.plans.released);
});

test('changing Claude back to Codex applies to the next turn without changing prior turns or guidance digests',async t=>{
  const f=await fixture(t);await f.director.configure(f.project.id,{mode:'claude'},'save');const first=await f.run('Start on Claude');assert.equal(first.state,'completed');
  const before=f.director.settings(f.project.id);await assert.rejects(f.director.configure(f.project.id,{mode:'native',binaryPath:process.execPath,model:'fixture-codex'},'locked'),{code:'DIRECTOR_SELECTION_LOCKED'});
  const changed=await f.req('POST','change',{expectedSelectionDigest:before.selectionDigest,selection:{mode:'native',binaryPath:process.execPath,model:'fixture-codex'}},'switch');assert.equal(changed.statusCode,200,changed.body);
  const second=await f.run('Continue on Codex');assert.equal(second.runtimeId,'codex-app-server');assert.equal(second.state,'completed',JSON.stringify(second));assert.equal(f.nativeInputs.length,1);
  assert.equal(f.store.get('director_turn',first.id).runtimeId,'claude-code');
  const lock=f.store.list('director_skill_lock',f.project.id).at(-1).lock;assert.equal(lock.bindings.find(row=>row.kind==='runtime').id,'codex-app-server');assert.equal(lock.skills[0].packageDigest,CODE_PLAN_GUIDANCE_DIGEST);
  const third=await f.req('POST','change',{expectedSelectionDigest:f.director.settings(f.project.id).selectionDigest,selection:{mode:'claude'}},'back');assert.equal(third.statusCode,200,third.body);assert.equal((await f.run('Back on Claude')).runtimeId,'claude-code');
});

test('Claude setup failure is readable and cannot save a selection or start a model',async t=>{
  const f=await fixture(t,{readiness:{status:'blocked',reason:'Sign in to Claude Code first'}});
  const response=await f.req('POST','setup',{mode:'claude'},'blocked');assert.notEqual(response.statusCode,200);assert.equal(response.json().error.code,'DIRECTOR_SETUP_REQUIRED');assert.match(response.json().error.message,/Sign in to Claude Code first/);assert.equal(f.director.mode(f.project.id),'fake');assert.equal(f.cli.records().length,0);
});


test('Claude limit failures remain plain in Director status, and no completed turn is retried',async t=>{
  const f=await fixture(t,{cli:{scenario:'usage'}});await f.director.configure(f.project.id,{mode:'claude'},'save');
  const turn=await f.run('Read the film');assert.equal(turn.state,'failed');assert.equal(turn.errorCode,'CLAUDE_CODE_USAGE_LIMIT');assert.match(f.director.status(f.project.id).message,/usage limit/);
  f.director.tick();await f.director.settle();assert.equal(f.cli.records().filter(row=>row.argv?.includes('-p')).length,1);assert.deepEqual(f.plans.held,f.plans.released);
});

test('Claude changes respect stale selection digests and busy turns',async t=>{
  const f=await fixture(t);const before=f.director.settings(f.project.id);
  await assert.rejects(f.director.changeSelection(f.project.id,{expectedSelectionDigest:'a'.repeat(64),selection:{mode:'claude'}},'stale'),{code:'DIRECTOR_SELECTION_STALE'});assert.equal(f.setups.length,0);
  await f.director.configure(f.project.id,{mode:'claude'},'save');
  f.director.enqueue(f.project.id,f.service.beginRequest(f.project.id,'human','Continue'));
  await assert.rejects(f.director.changeSelection(f.project.id,{expectedSelectionDigest:f.director.settings(f.project.id).selectionDigest,selection:{mode:'fake'}},'busy'),{code:'DIRECTOR_SETUP_BUSY'});
});
