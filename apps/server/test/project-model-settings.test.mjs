import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,renameSync,mkdirSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical,digest,DEFAULT_PROFILES } from '@openslate/core';
import { FakeProvider,OPENAI_IMAGE_MODEL } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { ProjectModelSettings } from '../dist/application/project-model-settings.js';
import { InstalledProviderCatalog } from '../dist/application/provider-catalog.js';
import { createApp } from '../dist/app.js';
import { createInstallationBackup,inspectInstallationBackup } from '../dist/persistence/installation-backup.js';
import { restoreInstallationBackup } from '../dist/persistence/installation-restore.js';
import { releaseRecovery } from '../dist/application/installation-recovery.js';
import { narrationSpeechFixture } from './narration-speech-fixture.mjs';
import { codexImageFixture,codexApiProfile } from './codex-image-execution-fixture.mjs';

const image={id:'configured-image',revision:'configured-1',kind:'image',adapter:'openai-image',executionVersion:'1',configuration:{model:OPENAI_IMAGE_MODEL,settings:{width:1024,height:1024,quality:'medium'}},maxConcurrency:1,unitCostMicros:'40000',maxRetries:0};
const video={id:'configured-video',revision:'configured-1',kind:'video',adapter:'viggle-h3',executionVersion:'1',configuration:{model:'MiniMax-H3',settings:{quality:'low',resolution:'480p',aspectRatio:'16:9'}},minFrames:90,maxFrames:450,maxConcurrency:1,unitCostMicros:'60000',maxRetries:0};
const token='project_settings_offline_token_123456';
const kinds=['grant','candidate','attempt','reservation','external_allowance','external_allowance_consumption','approval','message'];
const rows=(f,kind)=>f.store.list(kind,f.project.id);
const authority=f=>Object.fromEntries(kinds.map(kind=>[kind,rows(f,kind)]));
const code=expected=>error=>error.code===expected;
async function fixture(t,{shots=2,plan=true,local=true}={}){
  const parent=realpathSync(mkdtempSync(join(tmpdir(),'openslate-model-settings-'))),root=join(parent,'installation');mkdirSync(root);
  const store=new Store(join(root,'openslate.sqlite')),provider=new FakeProvider(join(root,'fake-provider.sqlite'));
  const engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),service=new ProductionService(store,engine,DEFAULT_PROFILES,local?{newProjectLocalExecution:{adapter:'local-media',version:'1'}}:{});
  const catalog=new InstalledProviderCatalog({configuration:{version:1,profiles:[{label:'Configured image',profile:image},{label:'Configured video',profile:video}]},registry:engine.registry});
  const settings=new ProjectModelSettings(service,catalog);let project=service.createProject('Editable models');
  const human=service.beginRequest(project.id,'human','Make two shots'),actor=service.openEpoch(project.id,human).actor;
  const draft=await service.prepare(project.id,actor,{variant:'project',expectedHeadVersion:0,creative:{brief:'Boots',story:'Making boots',createScenes:[{key:'scene',purpose:'Craft'}],
    createShots:Array.from({length:shots},(_,i)=>({key:`shot-${i}`,sceneId:'scene',purpose:`Detail ${i}`,action:'Boot on bench',framing:'Close up',motion:'Slow push',desiredFrames:180,imagePrompt:`Boot ${i}`,videoPrompt:`Move ${i}`,referenceArtifactIds:[],cueId:null}))}});
  service.apply(project.id,actor,draft.id);project=store.getProject(project.id);
  if(plan){
    service.authorize(project.id,human,project.shots.flatMap(shot=>[{scopeId:shot.id,kind:'image'},{scopeId:shot.id,kind:'video'}]),'initial','initial_slot');
    const q=JSON.stringify,body=project.shots.map((shot,i)=>`const s${i}=p.shot(${q(shot.id)});const i${i}=p.image("image-${i}",{intent:s${i},profile:"fake-image-v1",references:[],prompt:${q(shot.imagePrompt)}});const r${i}=p.humanReview("review-${i}",{shots:[{intent:s${i},keyframe:i${i},videoProfile:"fake-video-v1",motionPrompt:${q(shot.videoPrompt)},seconds:6}]});const v${i}=p.video("video-${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(i${i},r${i}),prompt:${q(shot.videoPrompt)},seconds:6});`).join('');
    const source=`definePlan({baseRevision:${q(project.revisionId)}},p=>{${body}const edit=p.timeline("edit",{takes:[${project.shots.map((_,i)=>`v${i}`).join(',')}],transition:"cut"});return p.render("preview",{timeline:edit,format:"mp4"});});`;
    const prepared=await service.prepare(project.id,actor,{variant:'plan',expectedHeadVersion:project.headVersion,source});service.apply(project.id,actor,prepared.id);project=store.getProject(project.id);
  }
  const app=createApp({service,providerCatalog:catalog,localToken:token});
  const close=()=>{if(store.db.open)store.close();if(provider.db.open)provider.close();};
  t.after(async()=>{await app.close();close();rmSync(parent,{recursive:true,force:true});});
  const f={parent,root,store,provider,engine,service,settings,catalog,project,human,actor,app,close};
  f.input=(patch={})=>{const status=settings.status(project.id);return {expectedHeadVersion:status.headVersion,expectedSelectionDigest:status.selectionDigest,expectedCatalogDigest:status.catalogDigest,profileIds:[image.id],scope:{kind:'unfinished'},...patch};};
  f.preview=patch=>settings.preview(project.id,f.input(patch));
  f.apply=preview=>settings.apply(project.id,{previewId:preview.id,previewDigest:preview.previewDigest,key:randomUUID()});
  f.binding=alias=>rows(f,'node_binding').find(row=>row.node.alias===alias);
  f.req=(method,path,payload,key=randomUUID())=>app.inject({method,url:`/api/projects/${project.id}/settings/models${path}`,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,'idempotency-key':key},...(payload?{payload}:{})});
  return f;
}

test('status is detached and read-only; defaults change without a plan or generation authority',async t=>{
  const f=await fixture(t,{plan:false}),before=authority(f),oldLock=f.store.get('capability_lock',f.project.capabilityLockId),status=f.settings.status(f.project.id);
  status.selected.image='forged';status.options[0].profile.revision='forged';assert.equal(f.settings.status(f.project.id).selected.image,'fake-image-v1');assert.deepEqual(authority(f),before);
  const preview=await f.preview(),result=await f.apply(preview);assert.equal(preview.changes.length,0);assert.equal(result.status.selected.image,image.id);assert.equal(result.receipt.activePlanId,null);
  const lock=f.store.get('capability_lock',result.receipt.capabilityLockId);assert.deepEqual(lock.profiles.find(p=>p.id==='fake-image-v1'),oldLock.profiles.find(p=>p.id==='fake-image-v1'));assert.deepEqual(f.store.get('capability_lock',oldLock.id),oldLock);
  assert.deepEqual(authority(f),before);assert.equal(f.provider.acceptedCount(),0);
});
test('preview discloses downstream assembly resets and apply leaves fresh permission required',async t=>{
  const f=await fixture(t,{shots:1}),before=authority(f),oldPlan=f.store.get('plan',f.project.activePlanId),preview=await f.preview();
  assert.deepEqual(preview.changes.map(row=>row.kind),['image','video','timeline','render']);assert.equal(preview.counts.changed,4);assert.equal(preview.generationApprovalRequired,true);
  const result=await f.apply(preview);assert.equal(result.receipt.changedNodeIds.length,4);assert.deepEqual(authority(f),before);
  for(const row of rows(f,'node_binding')){assert.equal(row.candidateId,null);assert.deepEqual(row.outputs,{});}
  assert.deepEqual(f.store.get('plan',oldPlan.id),oldPlan);assert.equal(f.binding('image-0').node.args.profileIdentity,image.id);assert.equal(f.binding('video-0').node.args.profileIdentity,'fake-video-v1');
  await f.engine.runReady();assert.equal(f.provider.acceptedCount(),0);assert.equal(rows(f,'attempt').length,0);
});
test('explicit shot scope leaves unrelated candidates and exact node definitions untouched',async t=>{
  const f=await fixture(t),before=f.binding('image-1'),videoBefore=f.binding('video-1'),preview=await f.preview({scope:{kind:'shots',shotIds:[f.project.shots[0].id]}});
  assert.equal(preview.preserved.find(row=>row.nodeId===before.id).reason,'outside_scope');await f.apply(preview);
  for(const old of [before,videoBefore]){const saved=f.store.get('node_binding',old.id);assert.deepEqual(saved.node,old.node);assert.equal(saved.candidateId,old.candidateId);assert.deepEqual(saved.outputs,old.outputs);}
});
test('video model replacement rebinds only its exact review recipe while preserving frame and prompts',async t=>{
  const f=await fixture(t,{shots:1}),frame=f.binding('image-0'),old=f.store.get('plan',f.project.activePlanId),preview=await f.preview({profileIds:[video.id]});await f.apply(preview);
  assert.deepEqual(f.binding('image-0').node,frame.node);assert.equal(f.binding('image-0').candidateId,frame.candidateId);
  const current=f.store.get('plan',f.store.getProject(f.project.id).activePlanId);assert.equal(current.compiled.gates[0].id,old.compiled.gates[0].id);assert.notEqual(current.compiled.gates[0].members[0].recipeDigest,old.compiled.gates[0].members[0].recipeDigest);
  assert.equal(f.binding('video-0').node.args.prompt,'Move 0');assert.equal(f.binding('video-0').node.args.profileIdentity,video.id);
});
test('legacy assembly prevents incompatible pending H3 rewrite but still permits H3 defaults on an empty plan',async t=>{
  const f=await fixture(t,{local:false});await assert.rejects(f.preview({profileIds:[video.id]}),code('LOCAL_EXECUTION_UPGRADE_REQUIRED'));
  const empty=await fixture(t,{local:false,plan:false});const result=await empty.apply(await empty.preview({profileIds:[video.id]}));assert.equal(result.status.selected.video,video.id);
});
for(const mode of ['pending','unknown_after_accept'])test(`preserved ${mode} attempt recovers after another node changes without resubmission`,async t=>{
  const f=await fixture(t);f.provider.setMode(f.binding('image-0').id,mode);f.provider.setMode(f.binding('image-1').id,'reject_before_accept');await f.engine.runReady();
  const original=rows(f,'attempt').find(row=>row.nodeId===f.binding('image-0').id),count=f.provider.acceptedCount(),request=structuredClone(original.request),old=f.binding('image-0');
  const preview=await f.preview();assert.equal(preview.preserved.find(row=>row.nodeId===old.id).reason,'in_flight');await f.apply(preview);
  assert.equal(f.binding('image-0').candidateId,old.candidateId);assert.notEqual(f.binding('image-0').planId,old.planId);
  assert.deepEqual(f.store.get('attempt',original.id).request,request);if(mode==='pending')f.provider.complete(original.taskId);
  await f.engine.reconcile();assert.equal(f.store.get('attempt',original.id).phase,'succeeded');assert.equal(f.provider.acceptedCount(),count);
  assert.equal(f.store.get('reservation',original.reservationId).state,'charged');assert.equal(f.binding('image-0').outputs.image.artifactId,f.store.get('attempt',original.id).outputs.image.artifactId);
});
test('completed downstream video protects its unfinished dependency ancestor',async t=>{
  const f=await fixture(t),imageBinding=f.binding('image-0'),videoBinding=f.binding('video-0');
  // Deliberately retain a completion while its old upstream cache is absent. Settings must not infer permission to regenerate the ancestor.
  f.store.put('node_binding',videoBinding.id,f.project.id,{...videoBinding,outputs:{video:{artifactId:'historical-output',kind:'video',sha256:'a'.repeat(64)}}});
  const preview=await f.preview();assert.equal(preview.preserved.find(row=>row.nodeId===videoBinding.id).reason,'completed');assert.equal(preview.preserved.find(row=>row.nodeId===imageBinding.id).reason,'protected_dependency');
  await f.apply(preview);assert.deepEqual(f.binding('image-0').node,imageBinding.node);assert.equal(f.binding('image-0').candidateId,imageBinding.candidateId);assert.deepEqual(f.binding('video-0').outputs.video,{artifactId:'historical-output',kind:'video',sha256:'a'.repeat(64)});
});
test('completed image bytes and approvals remain historical after pending model changes',async t=>{
  const f=await fixture(t);f.provider.setMode(f.binding('image-1').id,'reject_before_accept');await f.engine.runReady();await f.engine.reconcile();
  const old=f.binding('image-0'),artifacts=rows(f,'artifact');assert.ok(old.outputs.image);const preview=await f.preview();await f.apply(preview);
  assert.deepEqual(f.binding('image-0').outputs,old.outputs);assert.deepEqual(rows(f,'artifact'),artifacts);
});
test('fresh ordinary director review can authorize the newly selected pending plan',async t=>{
  const f=await fixture(t,{shots:1});await f.apply(await f.preview());const current=f.store.getProject(f.project.id),oldCandidates=rows(f,'candidate').length;
  const human=f.service.beginRequest(f.project.id,'human','Generate the unfinished shot with the selected models'),actor=f.service.openEpoch(f.project.id,human).actor;
  const source=f.store.get('plan',current.activePlanId).compiled.canonicalSource.replace(/"baseRevision": "[^"]+"/,`"baseRevision": "${current.revisionId}"`);
  await assert.rejects(f.service.prepare(f.project.id,actor,{variant:'plan',expectedHeadVersion:current.headVersion,source}),code('ORIGIN_NOT_AUTHORIZED'));
  f.service.authorize(f.project.id,human,[{scopeId:f.project.shots[0].id,kind:'image'},{scopeId:f.project.shots[0].id,kind:'video'}],'fresh','user_change');
  const prepared=await f.service.prepare(f.project.id,actor,{variant:'plan',expectedHeadVersion:current.headVersion,source});f.service.apply(f.project.id,actor,prepared.id);
  assert.equal(rows(f,'candidate').length,oldCandidates+2);assert.ok(f.binding('image-0').candidateId);assert.equal(f.provider.acceptedCount(),0);
  assert.equal(f.service.readContext(f.project.id,actor).preferredProfileIds.image,image.id);
});
test('stale head, catalog, scope, work and cancellation fail before settings publication',async t=>{
  const f=await fixture(t);await assert.rejects(f.settings.preview(f.project.id,f.input({expectedHeadVersion:0})),code('MODEL_SETTINGS_STALE'));
  await assert.rejects(f.settings.preview(f.project.id,f.input({expectedCatalogDigest:'0'.repeat(64)})),code('MODEL_SETTINGS_STALE'));
  await assert.rejects(f.preview({scope:{kind:'shots',shotIds:['foreign']}}),code('MODEL_SETTINGS_STALE'));
  const before=f.store.getProject(f.project.id),preview=await f.preview(),binding=f.binding('image-0');f.store.put('node_binding',binding.id,f.project.id,{...binding,outputs:{image:{artifactId:'arrived',kind:'image',sha256:'a'.repeat(64)}}});
  await assert.rejects(f.apply(preview),code('MODEL_SETTINGS_STALE'));assert.deepEqual(f.store.getProject(f.project.id),before);
  const controller=new AbortController();controller.abort();await assert.rejects(f.settings.preview(f.project.id,f.input(),{signal:controller.signal}),code('MODEL_SETTINGS_CANCELLED'));
});
test('snapshotting preserves original inputs and signal, including cancellation during worker work',async t=>{
  const f=await fixture(t),input=f.input(),controller=new AbortController(),options={signal:controller.signal},pending=f.settings.preview(f.project.id,input,options);
  input.profileIds[0]='fake-image-v1';options.signal=new AbortController().signal;controller.abort();await assert.rejects(pending,code('MODEL_SETTINGS_CANCELLED'));assert.equal(rows(f,'project_model_preview').length,0);
});
test('exact command replay survives later settings and preview is immutable',async t=>{
  const f=await fixture(t,{plan:false}),preview=await f.preview(),input={previewId:preview.id,previewDigest:preview.previewDigest,key:'saved-command'},first=await f.settings.apply(f.project.id,input);
  await f.apply(await f.preview({profileIds:['fake-image-v1']}));const head=f.store.getProject(f.project.id).headVersion;
  assert.deepEqual((await f.settings.apply(f.project.id,input)).receipt,first.receipt);assert.equal(f.store.getProject(f.project.id).headVersion,head);
  await assert.rejects(f.settings.apply(f.project.id,{...input,previewDigest:'f'.repeat(64)}),code('IDEMPOTENCY_CONFLICT'));
  const saved=f.store.get('project_model_preview',preview.id);assert.throws(()=>f.store.put('project_model_preview',preview.id,f.project.id,{...saved,version:2}),code('IMMUTABLE_RECORD'));
});
test('same selected defaults and unchanged nodes are a true no-op with a replayable receipt',async t=>{
  const f=await fixture(t),before=f.store.getProject(f.project.id),authorityBefore=authority(f),result=await f.apply(await f.preview({profileIds:['fake-image-v1']}));
  assert.deepEqual(f.store.getProject(f.project.id),before);assert.deepEqual(result.receipt.changedNodeIds,[]);assert.deepEqual(authority(f),authorityBefore);
});
test('SQL publication rollback retains old lock, plan, bindings and authority',async t=>{
  const f=await fixture(t),preview=await f.preview(),project=f.store.getProject(f.project.id),bindings=rows(f,'node_binding'),locks=rows(f,'capability_lock'),before=authority(f),put=f.store.put.bind(f.store);
  f.store.put=(kind,...args)=>{if(kind==='stage')throw Error('INJECTED_STAGE_FAILURE');return put(kind,...args);};await assert.rejects(f.apply(preview),/INJECTED_STAGE_FAILURE/);f.store.put=put;
  assert.deepEqual(f.store.getProject(f.project.id),project);assert.deepEqual(rows(f,'node_binding'),bindings);assert.deepEqual(rows(f,'capability_lock'),locks);assert.deepEqual(authority(f),before);
});
test('authenticated HTTP preview/apply contracts perform no generation and reject foreign or malformed input',async t=>{
  const f=await fixture(t,{plan:false});assert.equal((await f.app.inject({method:'GET',url:`/api/projects/${f.project.id}/settings/models`})).statusCode,403);
  const status=await f.req('GET','');assert.equal(status.statusCode,200,status.body);
  const preview=await f.req('POST','/preview',f.input());assert.equal(preview.statusCode,200,preview.body);
  const saved=preview.json(),response=await f.req('POST','/apply',{previewId:saved.id,previewDigest:saved.previewDigest},'http-apply');assert.equal(response.statusCode,200,response.body);assert.equal(response.json().status.selected.image,image.id);
  assert.equal((await f.req('POST','/apply',{previewId:saved.id,previewDigest:saved.previewDigest,grant:true})).statusCode,400);assert.equal(f.provider.acceptedCount(),0);
});
test('backup and actual same-root restore retain model history and permanently fence imported previews',async t=>{
  const f=await fixture(t,{plan:false}),applied=await f.preview();await f.apply(applied);const pending=await f.preview({profileIds:['fake-image-v1']}),oldLocks=rows(f,'capability_lock'),before=f.store.getProject(f.project.id);
  await f.app.close();f.close();const destination=join(f.parent,'backup');await createInstallationBackup({sourceRoot:f.root,destination});await inspectInstallationBackup({directory:destination});
  renameSync(f.root,join(f.parent,'archive'));await restoreInstallationBackup({directory:destination,destination:f.root});
  const store=new Store(join(f.root,'openslate.sqlite')),provider=new FakeProvider(join(f.root,'fake-provider.sqlite'));t.after(()=>{provider.close();store.close();});
  const engine=new Engine(store,provider,{artifactDir:join(f.root,'artifacts')}),service=new ProductionService(store,engine),settings=new ProjectModelSettings(service,f.catalog);
  assert.deepEqual(store.list('capability_lock',f.project.id),oldLocks);assert.deepEqual(store.getProject(f.project.id),before);assert.equal(settings.status(f.project.id).selected.image,image.id);
  await assert.rejects(settings.apply(f.project.id,{previewId:pending.id,previewDigest:pending.previewDigest,key:'restored'}));
  const snapshot=engine.recovery.snapshot();releaseRecovery(store,{restoreId:snapshot.receipt.restoreId,expectedReceiptDigest:snapshot.receiptDigest,expectedSummaryDigest:snapshot.summaryDigest},{principalId:'human',commandId:'review-release'});
  await assert.rejects(settings.apply(f.project.id,{previewId:pending.id,previewDigest:pending.previewDigest,key:'released'}),code('RESTORED_AUTHORITY_REQUIRES_NEW'));
  assert.equal(engine.recovery.isImported(f.project.id,'project_model_preview',pending.id),true);assert.equal(provider.acceptedCount(),0);
});
test('purpose-reviewed pending narration stays exact while defaults change',async t=>{
  const f=await narrationSpeechFixture(t),proposal=await f.prepare();await f.review(proposal);const before=f.store.list('node_binding',f.project.id),catalog=new InstalledProviderCatalog({configuration:{version:1,profiles:[{label:'Configured image',profile:image},{label:'Narration',profile:f.profile}]}}),settings=new ProjectModelSettings(f.production,catalog),status=settings.status(f.project.id);
  const preview=await settings.preview(f.project.id,{expectedHeadVersion:status.headVersion,expectedSelectionDigest:status.selectionDigest,expectedCatalogDigest:status.catalogDigest,profileIds:[image.id],scope:{kind:'unfinished'}});
  assert.equal(preview.preserved.find(row=>row.kind==='speech').reason,'reviewed_audio');await settings.apply(f.project.id,{previewId:preview.id,previewDigest:preview.previewDigest,key:'keep-reviewed'});assert.deepEqual(f.store.list('node_binding',f.project.id),before);assert.equal(f.calls.http,0);
});
test('actual consumed finite allowance and unknown native image retain their original profile after defaults change',async t=>{
  const f=codexImageFixture(t);f.build();t.after(()=>f.runtime.close());const selected=await f.seed();f.issue(selected);await f.runtime.engine.runReady();
  const attempt=f.store.list('attempt',selected.projectId)[0],families=['attempt','external_allowance','external_allowance_consumption','reservation','grant','candidate'],before=Object.fromEntries(families.map(kind=>[kind,f.store.list(kind,selected.projectId)]));assert.equal(attempt.phase,'submission_unknown');assert.equal(f.calls.start,1);
  const settings=new ProjectModelSettings(f.production,f.runtime.providerCatalog),status=settings.status(selected.projectId),preview=await settings.preview(selected.projectId,{expectedHeadVersion:status.headVersion,expectedSelectionDigest:status.selectionDigest,expectedCatalogDigest:status.catalogDigest,profileIds:[codexApiProfile.id],scope:{kind:'unfinished'}});
  assert.equal(preview.changes.length,0);await settings.apply(selected.projectId,{previewId:preview.id,previewDigest:preview.previewDigest,key:'native-history'});assert.deepEqual(Object.fromEntries(families.map(kind=>[kind,f.store.list(kind,selected.projectId)])),before);
  await f.runtime.engine.reconcile();assert.equal(f.calls.start,1);assert.equal(f.calls.api,0);assert.equal(f.store.list('external_allowance_consumption',selected.projectId).length,1);assert.deepEqual(f.store.get('attempt',attempt.id).request,attempt.request);
});
