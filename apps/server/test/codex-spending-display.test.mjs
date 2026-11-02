import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { RECIPE_DIGEST,compilePlan,digest,providerProfileArguments} from '../../../packages/core/dist/index.js';
import {registerExecutionProvider,OPENAI_IMAGE_MODEL} from '../../../packages/providers/dist/index.js';
import {Store} from '../dist/persistence/store.js';
import {Engine} from '../dist/execution/engine.js';
import {ProductionService} from '../dist/application/service.js';
import {ConfiguredExternalAdmission} from '../dist/execution/configured-external-admission.js';
import {projectFixture} from './execution-fixture.mjs';
const profile=()=>({id:'codex-image-v1',revision:'v1',kind:'image',adapter:'codex-image',executionVersion:'1',
  configuration:{model:'codex-image-generation',settings:{runtimeVersion:'0.153.4',directorModel:'gpt-6-astra',width:1024,height:1024}},
  maxConcurrency:1,unitCostMicros:'0',maxRetries:0});
const usage=()=>({kind:'codex_subscription',unit:'native_turn',quotaEstimateAvailable:false});
test('a zero-dollar Codex job starts once and retains its reservation for an unknown outcome',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'openslate-codex-reservation-')),store=new Store(join(directory,'store.sqlite'));
  t.after(()=>{if(store.db.open)store.close();rmSync(directory,{recursive:true,force:true});});
  const saved=profile(),profiles=[saved],calls=[];
  // An injected unknown transport proves admission only; this test starts no native process or model.
  const port=registerExecutionProvider({async submit(request){calls.push(request);return {type:'unknown',diagnostic:'injected unknown'};},
    async poll(){return {type:'unknown'};},async lookup(){return {type:'unknown'};}},{adapter:'codex-image',version:'1'});
  const admission=new ConfiguredExternalAdmission(store,()=>{}),engine=new Engine(store,port,{artifactDir:join(directory,'artifacts'),profiles,externalAdmission:admission});
  const service=new ProductionService(store,engine,profiles),project=projectFixture(randomUUID(),1);
  store.createProject(project);store.insert('capability_lock',project.capabilityLockId,project.id,{recipeDigest:RECIPE_DIGEST,profiles});
  const grantActor=service.beginRequest(project.id,'local-user','Create the two exact keyframes',{editing:false});
  const compiled=compilePlan(`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{${project.shots.map((shot,i)=>`const image${i}=p.image("frame-${i}",{intent:p.shot(${JSON.stringify(shot.id)}),profile:"codex-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});`).join('')}return [image0];});`,
    {project,profiles,logicalIds:{},allocateId:randomUUID});
  const grants=Object.fromEntries(compiled.nodes.map(node=>[node.id,engine.createGrant(project.id,node.shotId,node.kind,grantActor.requestId).id]));
  const planId=randomUUID();engine.installPlan(project.id,planId,compiled,grants);store.saveProject({...store.getProject(project.id),activePlanId:planId},0);
  const selections=store.list('node_binding',project.id).map(binding=>({candidateId:binding.candidateId,nodeId:binding.id,specDigest:binding.node.specDigest}));
  const first=await engine.runReady();assert.equal(first.dispatched,1);assert.equal(calls.length,1);
  const attempt=engine.attempts(project.id)[0];assert.equal(attempt.phase,'submission_unknown');
  assert.equal(store.get('reservation',attempt.reservationId).state,'reserved');
  await engine.reconcile();await engine.runReady();assert.equal(calls.length,1);
  assert.equal(store.list('reservation',project.id).length,1);assert.equal(store.get('reservation',attempt.reservationId).state,'reserved');
});
