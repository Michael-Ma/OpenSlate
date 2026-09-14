import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,digest} from '@openslate/core';
import {describeCodexImageInput,inspectCodexImagePng} from '@openslate/providers';
import {codexImageFixture} from './codex-image-execution-fixture.mjs';
import {pngBytes} from './viggle-h3-execution-fixture.mjs';
import {CodexImageExecution} from '../dist/execution/codex-image-execution.js';
import {ExecutionOutputStore} from '../dist/execution/output-store.js';
import {Store} from '../dist/persistence/store.js';
import {assertCodexImageSpoolLineage,assertCodexImageRecords} from '../dist/execution/codex-image-lineage.js';
import {assertCodexImageOperationOptions} from '../dist/execution/codex-image-receipts.js';
import {InstallationRecoveryGuard,installRecoveryQuarantine,releaseRecovery} from '../dist/application/installation-recovery.js';
import {createInstallationBackup,inspectInstallationBackup} from '../dist/persistence/installation-backup.js';
import {restoreInstallationBackup} from '../dist/persistence/installation-restore.js';
const bytes=pngBytes(),rows=(f,kind)=>f.store.list(kind,f.selected.projectId),complete=(prepared)=>({kind:'completed',threadId:prepared.session.threadId,turnId:'turn-exact',itemId:'image-exact',bytes,revisedPrompt:'Native revised prompt'});
async function fixture(t,options={}){
  const f=codexImageFixture(t),prepare=f.transport.prepare;
  f.transport.prepare=async input=>options.prepare?options.prepare(input,f):prepare(input);
  f.transport.start=async(prepared,input,context)=>{f.calls.start++;assert.equal(rows(f,'codex_image_execution_dispatch').length,1);return options.start?options.start(prepared,input,context,f):complete(prepared);};
  f.transport.lookup=async(prepared,context)=>{f.calls.lookup++;return options.lookup?options.lookup(prepared,context,f):{kind:'unknown',code:'UNAVAILABLE'};};
  f.build();f.selected=await f.seed();f.allowance=f.issue(f.selected);f.engine=f.runtime.engine;f.outputs=f.runtime.outputStore;
  f.bridge=f.engine.registry.resolve({adapter:'codex-image',version:'1'});
  f.attempt=f.engine.admit(f.selected.projectId,f.selected.binding.id,f.engine.resolveInputs(f.selected.projectId,f.selected.binding.node).fingerprint);
  f.request=f.attempt.request;f.context={expectedLease:{owner:f.attempt.leaseOwner,epoch:f.attempt.leaseEpoch}};
  f.expire=()=>{const a=f.store.get('attempt',f.attempt.id);f.store.put('attempt',a.id,a.projectId,{...a,leaseExpiresAt:0});};return f;
}
function quarantine(f){installRecoveryQuarantine(f.store,{restoreId:randomUUID(),backupId:randomUUID(),backupManifestSha256:'a'.repeat(64),sourceDatabaseSha256:'b'.repeat(64),originalDataRoot:f.directory,backupCreatedAt:'2026-09-11T00:00:00.000Z',restoredAt:'2026-09-12T00:00:00.000Z'});}
function release(store){const snapshot=new InstallationRecoveryGuard(store).snapshot();releaseRecovery(store,{restoreId:snapshot.receipt.restoreId,expectedReceiptDigest:snapshot.receiptDigest,expectedSummaryDigest:snapshot.summaryDigest},{principalId:'offline-human',commandId:randomUUID()});}
function restarted(t,f){const store=new Store(join(f.directory,'openslate.sqlite'));t.after(()=>{if(store.db.open)store.close();});const outputs=new ExecutionOutputStore(store,{rootDir:join(f.directory,'execution-output')});
  const forbidden=async()=>{throw Error('native unavailable');};return {store,outputs,bridge:new CodexImageExecution({store,outputStore:outputs,artifactRoot:join(f.directory,'artifacts'),transport:{prepare:forbidden,start:forbidden,lookup:forbidden}})};}

test('exact native marker, result and finite zero-dollar consumption precede real PNG publication',async t=>{
  const f=await fixture(t,{start:async(prepared,input,context)=>{assert.equal(prepared.session.turnInputDigest,describeCodexImageInput(input).turnInputDigest);await context.observeTurn('turn-exact');return complete(prepared);}});
  const result=await f.bridge.submit(f.request,f.context);assert.equal(result.type,'completed');assert.equal(result.vendorTaskId,null);
  assert.equal(rows(f,'external_allowance_consumption').length,1);assert.equal(rows(f,'external_allowance_consumption')[0].estimatedMicros,'0');
  const saved=rows(f,'codex_image_execution_result')[0];assert.equal(saved.observation.outputReceiptId,result.outputs[0].storage.spoolId);
  assert.equal(saved.observation.output.width,inspectCodexImagePng(bytes).width);assert.notEqual(saved.observation.output.width,1024,'native size is a bounded observed value, not a claimed knob');
  f.expire();await f.engine.reconcile();const a=f.store.get('attempt',f.attempt.id);assert.equal(a.phase,'succeeded');assert.equal(f.store.get('reservation',a.reservationId).state,'charged');
  const artifact=f.store.get('artifact',a.outputs.image.artifactId);assert.deepEqual(readFileSync(artifact.path),bytes);
  assert.deepEqual(await f.bridge.lookup(a.id),result);assert.equal(f.calls.start,1);assert.equal(f.calls.lookup,0);assert.equal(f.calls.api,0);assert.equal(f.calls.credentials,0);
});

test('ChatGPT auth failure closes only owned premarker preparation and never starts native/API work',async t=>{
  const f=await fixture(t,{prepare:async()=>{throw Error('API key auth is not ChatGPT');}});
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'rejected');assert.equal(rows(f,'codex_image_execution_dispatch').length,0);assert.equal(f.calls.start,0);
  assert.equal(rows(f,'codex_image_execution_result')[0].observation.code,'LOCAL_NATIVE_UNAVAILABLE');assert.equal(f.calls.api,0);
});

test('forged API-auth prepared identity cannot receive a native marker',async t=>{
  const f=await fixture(t,{prepare:async input=>({runtime:{version:1,runtimeVersion:'0.153.4',runtimeDigest:'a'.repeat(64),configurationDigest:'b'.repeat(64),model:'gpt-6-astra',authMode:'api'},session:{threadId:'wrong-auth',turnInputDigest:describeCodexImageInput(input).turnInputDigest}})});
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'rejected');assert.equal(f.calls.start,0);assert.equal(rows(f,'codex_image_execution_mapping').length,0);
});

for(const mode of ['lease','pause','hold','shot'])test(`original ${mode} fence is rechecked after native preparation`,async t=>{
  const f=await fixture(t,{prepare:async(input,f)=>{
    if(mode==='lease')f.store.put('attempt',f.attempt.id,f.selected.projectId,{...f.attempt,leaseEpoch:f.attempt.leaseEpoch+1});
    if(mode==='pause'){const row=f.store.get('execution_control',f.selected.projectId);f.store.put('execution_control',f.selected.projectId,f.selected.projectId,{...row,paused:true});}
    if(mode==='hold')f.store.insert('hold',randomUUID(),f.selected.projectId,{scopeId:f.selected.projectId,active:true,requestId:f.selected.human.requestId});
    if(mode==='shot'){const p=f.store.getProject(f.selected.projectId);f.store.saveProject({...p,shots:p.shots.map(shot=>({...shot,imagePrompt:'changed'}))},p.headVersion);}
    return {runtime:{version:1,runtimeVersion:'0.153.4',runtimeDigest:'a'.repeat(64),configurationDigest:'b'.repeat(64),model:'gpt-6-astra',authMode:'chatgpt'},session:{threadId:'prepared-before-race',turnInputDigest:describeCodexImageInput(input).turnInputDigest}};
  }});
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'unknown');assert.equal(f.calls.start,0);assert.equal(rows(f,'codex_image_execution_dispatch').length,0);assert.equal(rows(f,'codex_image_execution_result').length,0);
});

test('caller request and original cancellation are captured before any awaited native work',async t=>{
  const controller=new AbortController();const f=await fixture(t,{prepare:async input=>{controller.abort();return {runtime:{version:1,runtimeVersion:'0.153.4',runtimeDigest:'a'.repeat(64),configurationDigest:'b'.repeat(64),model:'gpt-6-astra',authMode:'chatgpt'},session:{threadId:'cancelled',turnInputDigest:describeCodexImageInput(input).turnInputDigest}};}});
  const request=structuredClone(f.request),running=f.bridge.submit(request,{...f.context,signal:controller.signal});request.args.prompt='mutated';await running;
  assert.equal(f.calls.start,0);assert.equal(rows(f,'codex_image_execution_result')[0].observation.code,'LOCAL_CANCELLED');
});

test('lost turn-start acknowledgement is recovered only by read-only lookup, with no second start',async t=>{
  const f=await fixture(t,{start:async()=>{throw Error('lost acknowledgement');},lookup:async prepared=>complete(prepared)});
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'unknown');assert.equal(rows(f,'codex_image_execution_run').length,0);
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'completed');assert.equal(f.calls.start,1);assert.equal(f.calls.lookup,1);assert.equal(rows(f,'codex_image_execution_run')[0].turnId,'turn-exact');
});

test('unknown native observations never create terminal evidence or retry the turn after repeated reconciliation',async t=>{
  const f=await fixture(t,{start:async()=>({kind:'unknown',code:'LOST'})});await f.bridge.submit(f.request,f.context);
  for(let i=0;i<3;i++)await f.bridge.lookup(f.attempt.id);
  assert.equal(f.calls.start,1);assert.equal(rows(f,'codex_image_execution_result').length,0);assert.equal(f.store.get('reservation',f.attempt.reservationId).state,'reserved');
});

test('native terminal usage failure remains observed evidence without releasing consumed usage as no-start',async t=>{
  const f=await fixture(t,{start:async prepared=>({kind:'failed',threadId:prepared.session.threadId,turnId:'turn-failed',code:'USAGE_LIMIT'})});
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'unknown');assert.equal(rows(f,'codex_image_execution_result')[0].observation.code,'USAGE_LIMIT');
  await f.bridge.lookup(f.attempt.id);assert.equal(f.calls.lookup,0);assert.equal(f.calls.start,1);assert.equal(f.store.get('reservation',f.attempt.reservationId).state,'reserved');
});

for(const field of ['threadId','turnId'])test(`another native ${field} cannot replace the observed turn`,async t=>{
  const f=await fixture(t,{start:async(prepared,_input,context)=>{await context.observeTurn('turn-exact');return {...complete(prepared),[field]:'foreign'};}});
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'unknown');assert.equal(rows(f,'codex_image_execution_result').length,0);assert.equal(rows(f,'execution_output_receipt').length,0);
});

test('native receipt transaction failure recovers actual saved turn bytes without another start',async t=>{
  const f=await fixture(t,{lookup:async prepared=>complete(prepared)}),insert=f.store.insert.bind(f.store);
  f.store.insert=(...args)=>{if(args[0]==='codex_image_execution_result')throw Error('interrupt result');return insert(...args);};
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'unknown');f.store.insert=insert;
  assert.equal(rows(f,'execution_output_receipt').length,0);assert.equal((await f.bridge.lookup(f.attempt.id)).type,'completed');assert.equal(f.calls.start,1);
});

test('filesystem-only spool recovers after DB reopen with native transport unavailable',async t=>{
  const f=await fixture(t),put=f.store.put.bind(f.store);f.store.put=(...args)=>{if(args[0]==='execution_output_spool')throw Error('interrupt SQL spool');return put(...args);};
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'unknown');f.store.put=put;assert.equal(rows(f,'execution_output_spool').length,0);f.store.close();
  const r=restarted(t,f),result=await r.bridge.lookup(f.attempt.id);assert.equal(result.type,'completed');assert.equal(f.calls.start,1);assert.equal(f.calls.lookup,0);
});

test('exact receipt lineage rejects an equal-byte alternate winning slot',async t=>{
  const f=await fixture(t),receipt=f.outputs.recordReceipt(f.selected.projectId,{attemptId:f.attempt.id,expectedRequestDigest:digest(f.request),port:'image',kind:'image',mimeType:'image/png',vendorTaskId:null,diagnosticRequestId:'alternate',source:{kind:'returned_bytes',...(({sha256,byteLength})=>({sha256,byteLength}))(inspectCodexImagePng(bytes))}});
  await f.outputs.spool(f.selected.projectId,receipt.id,async function*(){yield bytes;});assert.equal((await f.bridge.submit(f.request,f.context)).type,'unknown');
  assert.throws(()=>assertCodexImageSpoolLineage(f.store,f.attempt,receipt.id),{code:'CODEX_IMAGE_EXECUTION_CONFLICT'});
  f.expire();await assert.rejects(f.engine.reconcile(),{code:'CODEX_IMAGE_EXECUTION_CONFLICT'});assert.equal(rows(f,'artifact').length,0);
});

test('saved native spool cannot bypass a removed completed image observation',async t=>{
  const f=await fixture(t);await f.bridge.submit(f.request,f.context);f.store.db.prepare("DELETE FROM entities WHERE kind='codex_image_execution_result'").run();
  f.expire();await assert.rejects(f.engine.reconcile(),{code:'CODEX_IMAGE_EXECUTION_CONFLICT'});assert.equal(rows(f,'artifact').length,0);
});

test('original late completion is preserved after lease loss and can recover historically',async t=>{
  const f=await fixture(t,{start:async(prepared,_input,_context,f)=>{const a=f.store.get('attempt',f.attempt.id);f.store.put('attempt',a.id,a.projectId,{...a,leaseEpoch:a.leaseEpoch+1});return complete(prepared);}});
  assert.equal((await f.bridge.submit(f.request,f.context)).type,'completed');const project=f.store.getProject(f.selected.projectId);f.store.saveProject({...project,shots:project.shots.map(shot=>({...shot,imagePrompt:'later edit'}))},project.headVersion);
  assert.equal((await f.bridge.lookup(f.attempt.id)).type,'completed');assert.equal(f.calls.start,1);
});

test('quarantine blocks native work; release permits only exact saved results and permanently fences imported first turn',async t=>{
  const f=await fixture(t);quarantine(f);await assert.rejects(f.bridge.submit(f.request,f.context),{code:'INSTALLATION_QUARANTINED'});release(f.store);
  await assert.rejects(f.bridge.submit(f.request,f.context),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});assert.equal((await f.bridge.lookup(f.attempt.id)).type,'unknown');assert.equal(f.calls.start,0);assert.equal(f.calls.lookup,0);
});

test('new PNG header validation rejects high-bit IHDR tag aliases and oversized output',()=>{
  const altered=Buffer.from(bytes);altered[12]|=128;assert.throws(()=>inspectCodexImagePng(altered),{code:'CODEX_IMAGE_OUTPUT_INVALID'});
  const large=Buffer.from(bytes);large.writeUInt32BE(4097,16);assert.throws(()=>inspectCodexImagePng(large),{code:'CODEX_IMAGE_OUTPUT_INVALID'});
});

test('valid PNG larger than one MiB is chunked and fully decoded without native regeneration',async t=>{
  const {deflateSync}=await import('node:zlib');
  const chunk=(type,payload)=>{const size=Buffer.alloc(4);size.writeUInt32BE(payload.length);const body=Buffer.concat([Buffer.from(type),payload]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const tail=Buffer.alloc(4);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,body,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(1024);header.writeUInt32BE(1024,4);header[8]=8;header[9]=2;
  const raw=Buffer.alloc(3073*1024);let state=13;for(let y=0;y<1024;y++)for(let x=1;x<3073;x++){state=(Math.imul(state,1664525)+1013904223)>>>0;raw[y*3073+x]=state>>>24;}
  const large=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);assert.ok(large.length>1024**2);
  const f=await fixture(t,{start:async prepared=>({...complete(prepared),bytes:large})});assert.equal((await f.bridge.submit(f.request,f.context)).type,'completed');f.expire();await f.engine.reconcile();
  const a=f.store.get('attempt',f.attempt.id);assert.equal(a.phase,'succeeded');assert.deepEqual(readFileSync(f.store.get('artifact',a.outputs.image.artifactId).path),large);assert.equal(f.calls.start,1);
});

test('filesystem-only native PNG backup restores at the same root and publishes with native access unavailable',async t=>{
  const f=await fixture(t),put=f.store.put.bind(f.store);f.store.put=(...args)=>{if(args[0]==='execution_output_spool')throw Error('interrupt SQL spool');return put(...args);};
  await f.bridge.submit(f.request,f.context);f.store.put=put;assert.equal(rows(f,'execution_output_spool').length,0);
  const destination=f.directory+'-backup',archived=f.directory+'-original';t.after(()=>{rmSync(destination,{recursive:true,force:true});rmSync(archived,{recursive:true,force:true});});
  f.store.close();f.fakeProvider.close();const exported=await createInstallationBackup({sourceRoot:f.directory,destination});await inspectInstallationBackup({directory:exported.directory});
  renameSync(f.directory,archived);await restoreInstallationBackup({directory:exported.directory,destination:exported.manifest.originalDataRoot});const r=restarted(t,f);
  await assert.rejects(r.bridge.lookup(f.attempt.id),{code:'INSTALLATION_QUARANTINED'});release(r.store);assert.equal(r.store.get('execution_control',f.selected.projectId).paused,true);
  assert.equal((await r.bridge.lookup(f.attempt.id)).type,'completed');const {Engine}=await import('../dist/execution/engine.js'),{SpoolImageIngestor}=await import('../dist/execution/spool-image-ingester.js');
  const {LocalImageStore}=await import('../dist/media/local-images.js');const images=new LocalImageStore({rootDir:join(f.directory,'artifacts/images'),ffmpegPath:f.options.ffmpegPath,ffprobePath:f.options.ffprobePath});
  const engine=new Engine(r.store,r.bridge,{artifactDir:join(f.directory,'artifacts'),profiles:[f.selected.profile],outputStore:r.outputs,outputIngestor:new SpoolImageIngestor(r.outputs,images)});
  const a=r.store.get('attempt',f.attempt.id);r.store.put('attempt',a.id,a.projectId,{...a,leaseExpiresAt:0});await engine.reconcile();assert.equal(r.store.get('attempt',a.id).phase,'succeeded');
  assert.equal(r.store.get('reservation',a.reservationId).state,'charged');assert.equal(f.calls.start,1);assert.equal(f.calls.lookup,0);
});

test('backup fails closed for missing native completion or miskeyed native evidence',async t=>{
  for(const damage of [f=>f.store.db.prepare("DELETE FROM entities WHERE kind='codex_image_execution_result'").run(),f=>f.store.db.prepare("UPDATE entities SET id='wrong-native-key' WHERE kind='codex_image_execution_dispatch'").run()]){
    const f=await fixture(t);await f.bridge.submit(f.request,f.context);damage(f);const destination=f.directory+'-rejected';t.after(()=>rmSync(destination,{recursive:true,force:true}));
    await assert.rejects(createInstallationBackup({sourceRoot:f.directory,destination}));
  }
});
