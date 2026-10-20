import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexImageWorkerTransport} from '@openslate/director';
import {codexImageFixture as fixture,codexImageProfile as codex,codexRuntimeConfiguration as config,codexRowCounts as rowCounts} from './codex-image-execution-fixture.mjs';
import { GenerationOverviewReader } from '../dist/generation-overview.js';
test('disabled Codex remains unregistered despite trusted access and preserves legacy factory defaults',t=>{
  const f=fixture(t,{configuration:{image:false,h3:false,h3DownloadHosts:[]}}),before=rowCounts(f),runtime=f.build();
  assert.throws(()=>runtime.engine.registry.resolve({adapter:'codex-image',version:'1'}),{code:'PROVIDER_NOT_REGISTERED'});
  assert.deepEqual(runtime.productionOptions,{});assert.deepEqual(rowCounts(f),before);assert.equal(f.calls.prepare,0);assert.equal(f.calls.start,0);
  const native=runtime.providerCatalog.view().profiles.find(row=>row.id===codex.id);
  assert.equal(native.readiness.realExecutionEnabled,false);assert.equal(native.readiness.credential.required,false);
});
test('automatic native construction checks executable configuration but does not start a native process',t=>{
  const f=fixture(t,{configuration:{...config(),codexImageBinary:process.execPath},transport:{}}),before=rowCounts(f),runtime=f.build();
  assert.ok(runtime.engine.registry.resolve({adapter:'codex-image',version:'1'}));assert.deepEqual(rowCounts(f),before);
  const native=runtime.providerCatalog.view().profiles.find(row=>row.id===codex.id);
  assert.deepEqual(native.usage,{kind:'codex_subscription',unit:'native_turn',quotaEstimateAvailable:false});
  assert.deepEqual(native.readiness.nativeAccess,{configured:true,authentication:'checked_before_dispatch',quota:'unverified'});
  assert.equal(native.readiness.realExecutionEnabled,true);assert.equal(native.readiness.credential.required,false);
  assert.equal(f.calls.prepare,0);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
});
test('enabled native route fails closed for missing binary, tools, invalid paths or incomplete injection',t=>{
  for(const changes of [
    {transport:{},configuration:config()},
    {transport:{},configuration:{...config(),codexImageBinary:'/does-not-exist/codex'}},
    {transport:{},configuration:{...config(),codexImageBinary:'relative'}},
    {configuration:{...config(),codexImageHome:'relative'}},
    {configuration:{...config(),codexImage:null}},
    {ffmpegPath:null,ffprobePath:null},
    {transport:{codexImage:{prepare:async()=>{}}}},
  ]) {
    const f=fixture(t,changes),before=rowCounts(f);assert.throws(()=>f.build(),error=>['MEDIA_EXECUTION_CONFIGURATION','MEDIA_EXECUTION_TOOLS_REQUIRED','MEDIA_EXECUTION_CODEX_REQUIRED'].includes(error.code));
    assert.deepEqual(rowCounts(f),before);assert.equal(f.calls.prepare,0);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
  }
});
test('an actual reviewed image uses configured Codex without a separate usage allowance',async t=>{
  const f=fixture(t);f.build();const selected=await f.seed(),result=await f.runtime.engine.runReady();
  assert.equal(result.dispatched,1);
  const attempt=f.store.list('attempt',selected.projectId)[0];assert.equal(attempt.request.externalAllowanceId,undefined);
  for(const family of ['external_allowance','external_allowance_consumption'])assert.equal(f.store.list(family,selected.projectId).length,0);
  assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,1);assert.equal(f.calls.api,0);
});
test('Codex admission uses zero USD and captured native transport without consulting an API key or falling back',async t=>{
  const f=fixture(t,{configuration:{...config(),image:true}});f.build();const selected=await f.seed(),keyReads=f.calls.credentials;
  f.options.configuration.codexImage=false;f.options.transport.codexImage={prepare(){throw Error('mutated');}};f.transport.start=()=>{throw Error('replaced method');};
  const result=await f.runtime.engine.runReady();assert.equal(result.dispatched,1);assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,1);assert.equal(f.calls.api,0);assert.equal(f.calls.credentials,keyReads);
  const attempt=f.store.list('attempt',selected.projectId)[0];
  assert.equal(attempt.phase,'submission_unknown');assert.equal(attempt.taskId,null);assert.equal(attempt.request.externalAllowanceId,undefined);
  assert.ok(f.store.get('codex_image_execution_dispatch',attempt.id));
  await f.runtime.engine.reconcile();await f.runtime.engine.runReady();assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,1);assert.equal(f.calls.api,0);assert.equal(f.calls.credentials,keyReads);
  assert.equal(f.store.list('external_allowance_consumption',selected.projectId).length,0);
});
test('unsupported native operation options fail preflight before preparation or durable consumption',async t=>{
  for(const options of [{width:768},{settings:{quality:'medium'}}]) {
    const f=fixture(t);f.build();const selected=await f.seed(options);f.issue(selected);
    const result=await f.runtime.engine.runReady();assert.equal(result.dispatched,0);assert.ok(result.blocked.some(row=>['CODEX_IMAGE_PREFLIGHT_INVALID','CODEX_IMAGE_EXECUTION_CONFLICT'].includes(row.code)));
    for(const family of ['attempt','reservation','external_allowance_consumption'])assert.equal(f.store.list(family,selected.projectId).length,0);
    assert.equal(f.store.list('external_allowance',selected.projectId).length,1);assert.equal(f.calls.prepare,0);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
  }
});
test('native preparation failure retains its attempt and never substitutes the enabled direct API route',async t=>{
  const f=fixture(t,{configuration:{...config(),image:true}});f.transport.prepare=async()=>{f.calls.prepare++;throw Error('Synthetic native authentication unavailable');};
  f.build();const selected=await f.seed();f.issue(selected);await f.runtime.engine.runReady();
  const attempt=f.store.list('attempt',selected.projectId)[0];assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
  assert.equal(f.store.get('codex_image_execution_dispatch',attempt.id),undefined);assert.equal(f.store.list('external_allowance_consumption',selected.projectId).length,0);
  await f.runtime.engine.reconcile();await f.runtime.engine.runReady();assert.equal(f.calls.prepare,1);assert.equal(f.calls.api,0);
});

test('runtime close retires its constructed worker once without a native start',async t=>{
  const original=CodexImageWorkerTransport.prototype.close;let closed=0;
  CodexImageWorkerTransport.prototype.close=async function(){closed++;return original.call(this);};
  t.after(()=>{CodexImageWorkerTransport.prototype.close=original;});
  const f=fixture(t,{configuration:{...config(),codexImageBinary:process.execPath},transport:{}}),runtime=f.build(),before=rowCounts(f);
  const first=runtime.close(),second=runtime.close();assert.equal(first,second);await first;
  assert.equal(closed,1);assert.deepEqual(rowCounts(f),before);assert.equal(f.calls.prepare,0);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
});

test('first Codex route rejects project-scoped images before consuming their usage permission',async t=>{
  const f=fixture(t);f.build();const selected=await f.seed({}, {unscoped:true});assert.equal(selected.binding.node.shotId,null);f.issue(selected);
  const result=await f.runtime.engine.runReady();assert.equal(result.dispatched,0);assert.ok(result.blocked.some(row=>row.code==='CODEX_IMAGE_PREFLIGHT_INVALID'));
  for(const family of ['attempt','reservation','external_allowance_consumption'])assert.equal(f.store.list(family,selected.projectId).length,0);
  assert.equal(f.store.list('external_allowance',selected.projectId).length,1);assert.equal(f.calls.prepare,0);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
});

test('an inconsistent native image record leaves the overview readable, without its diagnostic (lead review)',async t=>{
  const f=fixture(t);
  f.transport.prepare=async()=>{f.calls.prepare++;throw Object.assign(Error('slow start'),{code:'RUNTIME_RPC_TIMEOUT'});};
  f.build();const selected=await f.seed();await f.runtime.engine.runReady();
  const attempt=f.store.list('attempt',selected.projectId)[0];
  // An older or damaged receipt: the strict lineage check refuses it. The read must still answer.
  f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.observation.kind','completed') WHERE kind='codex_image_execution_result' AND id=?").run(attempt.id);
  const view=new GenerationOverviewReader(f.production).read(selected.projectId),failure=view.shots['shot-0'].keyframe.failure;
  assert.equal(view.shots['shot-0'].keyframe.state,'failed');assert.equal(failure.nativeDiagnostic,undefined);assert.equal(failure.notDispatched,undefined);
});

for(const [code,category] of [['RUNTIME_RPC_TIMEOUT','native_timeout'],['ENOENT','native_spawn_failed'],['SETUP_AUTH_REQUIRED','native_auth_required'],
  ['RUNTIME_PROTOCOL_INVALID','native_protocol'],[429,'native_rate_limited'],['UNRECOGNIZED','native_unknown']])
test(`native preparation ${category} is retained and publicly projected without raw data or a retry`,async t=>{
  const f=fixture(t),raw='PRIVATE_NATIVE_MESSAGE /private/account/token secret-value',logs=[],nativeDiagnostic={category,...(category==='native_timeout'?{limitMs:60000}:{})};
  t.mock.method(console,'warn',(...args)=>logs.push(args));
  f.transport.prepare=async()=>{f.calls.prepare++;throw Object.assign(Error(raw),{code,...(category==='native_timeout'?{nativeDiagnostic:{...nativeDiagnostic,message:raw}}:{})});};
  f.build();const selected=await f.seed();await f.runtime.engine.runReady();
  const attempt=f.store.list('attempt',selected.projectId)[0];
  assert.equal(attempt.phase,'failed');assert.equal(f.store.get('reservation',attempt.reservationId).state,'released');
  assert.deepEqual(f.store.get('codex_image_execution_result',attempt.id).observation,{kind:'not_dispatched',code:'LOCAL_NATIVE_UNAVAILABLE',nativeDiagnostic});
  const view=new GenerationOverviewReader(f.production).read(selected.projectId),failure=view.shots['shot-0'].keyframe.failure;
  assert.deepEqual(failure.nativeDiagnostic,nativeDiagnostic);assert.equal(failure.notDispatched,true);assert.equal(failure.charged,false);
  assert.equal(failure.retryAllowed,false);assert.equal(failure.autoRetriesLeft,0);
  const publicData={view,snapshot:f.production.snapshot(selected.projectId),logs};
  assert.equal(JSON.stringify(publicData).includes(raw),false);assert.equal(JSON.stringify(publicData).includes('secret-value'),false);
  await f.runtime.engine.reconcile();await f.runtime.engine.runReady();
  assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
  assert.equal(f.store.get('codex_image_execution_dispatch',attempt.id),undefined);assert.equal(logs.length,1);
});

test('media runtime rejects an invalid startup setting before writing state or starting native work',t=>{
  for(const startupTimeoutMs of [14999,120001,NaN,Infinity]){
    const f=fixture(t,{startupTimeoutMs}),before=rowCounts(f);
    assert.throws(()=>f.build(),{code:'CONFIGURATION_ERROR'});assert.deepEqual(rowCounts(f),before);assert.equal(f.calls.prepare,0);
  }
});
