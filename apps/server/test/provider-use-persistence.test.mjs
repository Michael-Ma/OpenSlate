import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,realpathSync,rmSync,renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest,canonical } from '@openslate/core';
import { FakeProvider,registerExecutionProvider,OPENAI_IMAGE_MODEL } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ConfiguredExternalAdmission } from '../dist/execution/durable-external-admission.js';
import { assertConfiguredProviderAdmission } from '../dist/execution/provider-use.js';
import { ProductionService } from '../dist/application/service.js';
import { createInstallationBackup,inspectInstallationBackup } from '../dist/persistence/installation-backup.js';
import { restoreInstallationBackup } from '../dist/persistence/installation-restore.js';
import { releaseRecovery } from '../dist/application/installation-recovery.js';

const profile={id:'configured-image-proof',revision:'proof-1',kind:'image',adapter:'openai-image',executionVersion:'1',configuration:{model:OPENAI_IMAGE_MODEL,settings:{width:1024,height:1024,quality:'medium'}},maxConcurrency:1,unitCostMicros:'123',maxRetries:0};
const conflict={code:'CONFIGURED_PROVIDER_ADMISSION_CONFLICT'};
async function fixture(t){
  const parent=realpathSync(mkdtempSync(join(tmpdir(),'openslate-provider-pin-'))),root=join(parent,'installation');mkdirSync(root);
  const path=join(root,'openslate.sqlite'),store=new Store(path),fake=new FakeProvider(join(root,'fake-provider.sqlite')),stores=[store],calls=[];
  const port=registerExecutionProvider({submit:async()=>{calls.push('submit');throw Error('Unexpected provider call');},poll:async()=>{calls.push('poll');throw Error('Unexpected provider call');},lookup:async()=>{calls.push('lookup');return{type:'unknown',diagnostic:'Offline unknown'};}},{adapter:'openai-image',version:'1'});
  const engine=new Engine(store,port,{artifactDir:join(root,'artifacts'),profiles:[profile],externalAdmission:new ConfiguredExternalAdmission(store,()=>{})}),production=new ProductionService(store,engine,[profile]);
  let project=production.createProject('Configured provider proof');const human=production.beginRequest(project.id,'local-user','Generate one image from this exact direction');
  const draft=await production.prepare(project.id,human,{variant:'project',expectedHeadVersion:project.headVersion,creative:{brief:'Boots',story:'Product detail',createScenes:[{key:'scene',purpose:'Boot detail'}],createShots:[{key:'shot',sceneId:'scene',purpose:'Boot detail',action:'Boot on a bench',framing:'Close-up',motion:'Slow push',desiredFrames:180,imagePrompt:'One boot on a bench',videoPrompt:'Slow push toward the boot',referenceArtifactIds:[],cueId:null}]}});production.apply(project.id,human,draft.id);project=store.getProject(project.id);
  production.authorize(project.id,human,[{scopeId:project.shots[0].id,kind:'image'}],randomUUID(),'user_change');
  const prepared=await production.prepare(project.id,human,{variant:'plan',expectedHeadVersion:project.headVersion,source:`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{return p.image("image",{intent:p.shot(${JSON.stringify(project.shots[0].id)}),profile:${JSON.stringify(profile.id)},prompt:"One boot on a bench"});});`});production.apply(project.id,human,prepared.id);
  const binding=store.list('node_binding',project.id)[0],admit=()=>engine.admit(project.id,binding.id,engine.resolveInputs(project.id,binding.node).fingerprint);
  const close=()=>{for(const value of stores)if(value.db.open)value.close();if(fake.db.open)fake.close();};t.after(()=>{close();rmSync(parent,{recursive:true,force:true});});
  return{parent,root,path,store,stores,fake,engine,production,project,human,binding,admit,close,calls};
}
const rewrite=(f,kind,id,mutate)=>{const body=f.store.get(kind,id);mutate(body);f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical(body),kind,id);};
const exportFixture=f=>createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,'backup')});

test('configured admission inserts its exact pin before the reservation and then closes the same transaction',async t=>{
  const f=await fixture(t),insert=f.store.insert.bind(f.store);let checked=false;
  f.store.insert=(kind,id,projectId,body)=>{if(kind==='attempt'){assert.equal(f.store.get('reservation',body.reservationId),undefined);assert.equal(body.request.providerUse.kind,'configured');checked=true;}return insert(kind,id,projectId,body);};
  const attempt=f.admit();assert.equal(checked,true);assertConfiguredProviderAdmission(f.store,attempt);assert.equal(f.store.get('reservation',attempt.reservationId).micros,'123');assert.deepEqual(f.calls,[]);
});

for(const name of ['missing-proof','mixed-allowance','extra-proof-field','missing-lock','wrong-lock-digest','wrong-profile-digest','different-request-node'])test(`Store rejects ${name} before configured admission commits`,async t=>{
  const f=await fixture(t),insert=f.store.insert.bind(f.store);
  f.store.insert=(kind,id,projectId,input)=>{const body=structuredClone(input);if(kind==='attempt'){
    if(name==='missing-proof')delete body.request.providerUse;
    else if(name==='mixed-allowance')body.request.externalAllowanceId='invented-allowance';
    else if(name==='extra-proof-field')body.request.providerUse.extra=true;
    else if(name==='missing-lock')body.request.providerUse.capabilityLockId='missing';
    else if(name==='wrong-lock-digest')body.request.providerUse.capabilityLockDigest='a'.repeat(64);
    else if(name==='wrong-profile-digest')body.request.providerUse.profileDefinitionDigest='b'.repeat(64);
    else body.request.nodeId='different';
  }return insert(kind,id,projectId,body);};
  assert.throws(f.admit,conflict);assert.equal(f.store.list('attempt',f.project.id).length,0);assert.equal(f.store.list('reservation',f.project.id).length,0);assert.deepEqual(f.calls,[]);
});

test('configured reservation updates and later attempt writes cannot bypass the original estimate',async t=>{
  const f=await fixture(t),attempt=f.admit(),reservation=f.store.get('reservation',attempt.reservationId);
  assert.throws(()=>f.store.put('reservation',reservation.id,f.project.id,{...reservation,micros:'0'}),conflict);assert.deepEqual(f.store.get('reservation',reservation.id),reservation);
  rewrite(f,'reservation',reservation.id,row=>{row.micros='0';});
  assert.throws(()=>f.store.put('attempt',attempt.id,f.project.id,{...attempt,phase:'submission_unknown',leaseExpiresAt:0}),conflict);
  assert.equal(f.store.get('attempt',attempt.id).phase,'submitting');assert.deepEqual(f.calls,[]);
});

test('image receipt insertion checks the configured admission even before a mapping exists',async t=>{
  const f=await fixture(t),attempt=f.admit();rewrite(f,'reservation',attempt.reservationId,row=>{row.micros='0';});
  const result={id:attempt.id,projectId:f.project.id,version:1,attemptId:attempt.id,requestDigest:digest(attempt.request),mappingDigest:null,dispatchDigest:null,observedAt:new Date().toISOString(),observation:{kind:'not_dispatched',code:'LOCAL_CANCELLED'}};
  assert.throws(()=>f.store.insert('image_execution_result',attempt.id,f.project.id,result),conflict);assert.equal(f.store.get('image_execution_result',attempt.id),undefined);
});

for(const name of ['missing-proof','missing-lock','wrong-lock-digest','changed-reservation','missing-reservation','changed-grant','mixed-consumption','row-identity','foreign-lock-row','foreign-reservation-row'])test(`backup rejects configured ${name} before any bridge mapping exists`,async t=>{
  const f=await fixture(t),attempt=f.admit();
  if(name==='missing-proof')rewrite(f,'attempt',attempt.id,row=>{delete row.request.providerUse;});
  else if(name==='missing-lock')f.store.db.prepare("DELETE FROM entities WHERE kind='capability_lock' AND id=?").run(attempt.request.providerUse.capabilityLockId);
  else if(name==='wrong-lock-digest')rewrite(f,'attempt',attempt.id,row=>{row.request.providerUse.capabilityLockDigest='f'.repeat(64);});
  else if(name==='changed-reservation')rewrite(f,'reservation',attempt.reservationId,row=>{row.micros='0';});
  else if(name==='missing-reservation')f.store.db.prepare("DELETE FROM entities WHERE kind='reservation' AND id=?").run(attempt.reservationId);
  else if(name==='changed-grant')rewrite(f,'grant',f.store.get('candidate',attempt.candidateId).grantId,row=>{row.kind='video';});
  else if(name==='mixed-consumption')f.store.db.prepare('INSERT INTO entities(kind,id,project_id,body) VALUES(?,?,?,?)').run('external_allowance_consumption',attempt.id,f.project.id,canonical({id:attempt.id,projectId:f.project.id}));
  else if(name==='row-identity')f.store.db.prepare("UPDATE entities SET id=? WHERE kind='attempt' AND id=?").run('different-row',attempt.id);
  else {const foreign=f.production.createProject('Foreign proof row'),kind=name==='foreign-lock-row'?'capability_lock':'reservation',id=kind==='capability_lock'?attempt.request.providerUse.capabilityLockId:attempt.reservationId;
    f.store.db.prepare('UPDATE entities SET project_id=? WHERE kind=? AND id=?').run(foreign.id,kind,id);}
  f.close();await assert.rejects(exportFixture(f));assert.deepEqual(f.calls,[]);
});

test('retained configured pins survive changed defaults, retired binding, Stop, backup and same-root restore',async t=>{
  const f=await fixture(t),attempt=f.admit(),oldLock=f.store.get('capability_lock',attempt.request.providerUse.capabilityLockId),changedProfile={...profile,revision:'new-default',unitCostMicros:'456'},lockId=randomUUID();
  f.store.insert('capability_lock',lockId,f.project.id,{...oldLock,id:lockId,profiles:[changedProfile]});const project=f.store.getProject(f.project.id);f.store.saveProject({...project,capabilityLockId:lockId},project.headVersion);
  f.store.put('node_binding',f.binding.id,f.project.id,{...f.binding,state:'retired'});f.engine.setPaused(f.project.id,true,'human-stop');assertConfiguredProviderAdmission(f.store,attempt);
  f.store.put('attempt',attempt.id,f.project.id,{...attempt,phase:'submission_unknown',leaseExpiresAt:0});f.close();const backup=await exportFixture(f);await inspectInstallationBackup({directory:backup.directory});
  renameSync(f.root,join(f.parent,'original'));await restoreInstallationBackup({directory:backup.directory,destination:f.root});
  const store=new Store(f.path);f.stores.push(store);const engine=new Engine(store,f.fake,{artifactDir:join(f.root,'artifacts')});
  const snapshot=engine.recovery.snapshot();releaseRecovery(store,{restoreId:snapshot.receipt.restoreId,expectedReceiptDigest:snapshot.receiptDigest,expectedSummaryDigest:snapshot.summaryDigest},{principalId:'human',commandId:'review-import'});
  const restored=store.get('attempt',attempt.id);assertConfiguredProviderAdmission(store,restored);assert.deepEqual(restored.request,attempt.request);assert.deepEqual(store.get('capability_lock',oldLock.id),oldLock);
  assert.throws(()=>engine.recovery.assertFirstSubmit(f.project.id,attempt.id),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});assert.deepEqual(f.calls,[]);
});

test('old allowance-shaped and unknown legacy attempt JSON remains unchanged',async t=>{
  const f=await fixture(t),attempt=f.admit(),historical={...attempt,id:'old-attempt',ordinal:2,reservationId:'old-reservation',request:{...attempt.request,attemptId:'old-attempt',externalAllowanceId:'old-allowance'}};delete historical.request.providerUse;
  const saved=f.store.insert('attempt',historical.id,f.project.id,historical);assert.deepEqual(saved,historical);
  assertConfiguredProviderAdmission(f.store,saved);assert.deepEqual(f.store.get('attempt',saved.id),historical);
  const legacy={candidateId:null,workKey:'old-local',ordinal:1,request:{execution:{adapter:'old-custom',version:'1'}},phase:'submission_unknown'};
  const old=f.store.insert('attempt','legacy-attempt',f.project.id,legacy);assert.deepEqual(old,{...legacy,id:'legacy-attempt',projectId:f.project.id});
});
