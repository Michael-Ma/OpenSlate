import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compilePlan,digest,providerProfileArguments} from '../../../packages/core/dist/index.js';
import {registerExecutionProvider,OPENAI_IMAGE_MODEL} from '../../../packages/providers/dist/index.js';
import {spendingProviderDisplay,spendingHistoryDisplay} from '../dist/application/spending-display.js';
import {Store} from '../dist/persistence/store.js';
import {Engine} from '../dist/execution/engine.js';
import {ProductionService} from '../dist/application/service.js';
import {ExternalAllowanceService,allowanceIssueContextDigest} from '../dist/application/external-allowances.js';
import {DurableExternalAdmission} from '../dist/execution/durable-external-admission.js';
import {projectFixture} from './execution-fixture.mjs';
const profile=()=>({id:'codex-image-v1',revision:'v1',kind:'image',adapter:'codex-image',executionVersion:'1',
  configuration:{model:'codex-image-generation',settings:{runtimeVersion:'0.153.4',directorModel:'gpt-6-astra',width:1024,height:1024}},
  maxConcurrency:1,unitCostMicros:'0',maxRetries:0});
const usage=()=>({kind:'codex_subscription',unit:'native_turn',quotaEstimateAvailable:false});
test('Codex display pins the full profile and adds usage only to the native route',()=>{
  const saved=profile(),result=spendingProviderDisplay(saved,digest(saved));
  assert.deepEqual(result,{id:saved.id,revision:saved.revision,definitionDigest:digest(saved),adapter:'codex-image',model:'codex-image-generation',
    settings:saved.configuration.settings,usage:usage()});
  result.settings.directorModel='changed';assert.equal(saved.configuration.settings.directorModel,'gpt-6-astra');
  const api={...saved,id:'api-image',adapter:'openai-image',unitCostMicros:'100',configuration:{model:OPENAI_IMAGE_MODEL,settings:{width:1024,height:1024,quality:'medium'}}};
  assert.deepEqual(spendingProviderDisplay(api,digest(api)),{id:api.id,revision:api.revision,definitionDigest:digest(api),adapter:'openai-image',model:OPENAI_IMAGE_MODEL,settings:api.configuration.settings});
  assert.equal(Object.hasOwn(spendingProviderDisplay(api,digest(api)),'usage'),false);
});
test('unsupported or changed native profile settings cannot acquire a Codex spending display',()=>{
  const saved=profile();
  for(const patch of [{unitCostMicros:'1'},{maxConcurrency:2},{maxRetries:1},{executionVersion:'2'},
    {configuration:{...saved.configuration,settings:{...saved.configuration.settings,key:'not-for-display'}}}]) {
    const changed={...saved,...patch};assert.equal(spendingProviderDisplay(changed,digest(changed)),null);
  }
  assert.equal(spendingProviderDisplay({...saved,revision:'v2'},digest(saved)),null);
});
test('Codex allowance history uses retained same-project full definitions without current-provider guesses',()=>{
  const saved=profile(),selection={candidateId:'candidate',nodeId:'node',specDigest:'a'.repeat(64)},semantic=providerProfileArguments(saved).profileDigest;
  const allowance={projectId:'project',profileDefinitionDigest:digest(saved),profileDigest:semantic,selections:[selection]};
  const plan={projectId:'project',compiled:{nodes:[{id:'node',specDigest:selection.specDigest,alias:'Original frame',shotId:null,kind:'image',args:{...providerProfileArguments(saved),prompt:'not copied'}}]}};
  const resolve=spendingHistoryDisplay('project',[{projectId:'project',profiles:[saved]}],[plan]);
  const before=JSON.stringify({saved,plan,allowance}),result=resolve(allowance,[]);
  assert.deepEqual(result.providerDisplay.usage,usage());assert.equal(result.work[0].current,false);assert.equal(result.work[0].alias,'Original frame');
  assert.equal(JSON.stringify({saved,plan,allowance}),before);assert.equal(JSON.stringify(result).includes('not copied'),false);
  assert.equal(spendingHistoryDisplay('project',[{projectId:'foreign',profiles:[saved]}],[plan])(allowance,[]).providerDisplay,null);
  assert.equal(resolve({...allowance,profileDefinitionDigest:'f'.repeat(64)},[]).providerDisplay,null);
});
test('one zero-dollar Codex allowance still exhausts its finite start permission and retains unknown liability',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'openslate-codex-allowance-')),store=new Store(join(directory,'store.sqlite'));
  t.after(()=>{if(store.db.open)store.close();rmSync(directory,{recursive:true,force:true});});
  const saved=profile(),profiles=[saved],calls=[];
  // An injected unknown transport proves admission only; this test starts no native process or model.
  const port=registerExecutionProvider({async submit(request){calls.push(request);return {type:'unknown',diagnostic:'injected unknown'};},
    async poll(){return {type:'unknown'};},async lookup(){return {type:'unknown'};}},{adapter:'codex-image',version:'1'});
  const admission=new DurableExternalAdmission(store,()=>{}),engine=new Engine(store,port,{artifactDir:join(directory,'artifacts'),profiles,externalAdmission:admission,budgetMicros:'0'});
  const service=new ProductionService(store,engine,profiles),allowances=new ExternalAllowanceService(store),project=projectFixture(randomUUID(),2);
  store.createProject(project);store.insert('capability_lock',project.capabilityLockId,project.id,{profiles});
  const grantActor=service.beginRequest(project.id,'local-user','Create the two exact keyframes',{editing:false});
  const compiled=compilePlan(`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{${project.shots.map((shot,i)=>`const image${i}=p.image("frame-${i}",{intent:p.shot(${JSON.stringify(shot.id)}),profile:"codex-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});`).join('')}return [image0,image1];});`,
    {project,profiles,logicalIds:{},allocateId:randomUUID});
  const grants=Object.fromEntries(compiled.nodes.map(node=>[node.id,engine.createGrant(project.id,node.shotId,node.kind,grantActor.requestId).id]));
  const planId=randomUUID();engine.installPlan(project.id,planId,compiled,grants);store.saveProject({...store.getProject(project.id),activePlanId:planId},0);
  const selections=store.list('node_binding',project.id).map(binding=>({candidateId:binding.candidateId,nodeId:binding.id,specDigest:binding.node.specDigest}));
  const input={profileDigest:providerProfileArguments(saved).profileDigest,profileDefinitionDigest:digest(saved),selections,maxAttempts:1,maxEstimatedMicros:'0',expiresAt:new Date(Date.now()+3600000).toISOString()};
  const human=service.beginRequest(project.id,'local-user','Approve one Codex start',{editing:false,contextDigest:allowanceIssueContextDigest(project.id,input)});
  const issued=allowances.issue(project.id,human,input),first=await engine.runReady();assert.equal(first.dispatched,1);assert.equal(calls.length,1);
  const consumed=store.list('external_allowance_consumption',project.id);assert.equal(consumed.length,1);assert.equal(consumed[0].estimatedMicros,'0');assert.equal(consumed[0].allowanceId,issued.id);
  const attempt=store.get('attempt',consumed[0].attemptId);assert.equal(attempt.phase,'submission_unknown');
  assert.equal(store.get('reservation',attempt.reservationId).state,'reserved');
  const next=selections.find(item=>item.candidateId!==attempt.candidateId);
  assert.throws(()=>store.transaction(()=>admission.authorize({attemptId:randomUUID(),projectId:project.id,nodeId:next.nodeId,candidateId:next.candidateId,profile:saved,estimatedMicros:'0'})),{code:'EXTERNAL_ALLOWANCE_UNAVAILABLE'});
  await engine.reconcile();await engine.runReady();assert.equal(calls.length,1);assert.deepEqual(store.list('external_allowance_consumption',project.id),consumed);
  const status=allowances.list(project.id,human)[0];assert.equal(status.usedAttempts,1);assert.equal(status.remainingAttempts,0);assert.equal(status.usedEstimatedMicros,'0');
});
