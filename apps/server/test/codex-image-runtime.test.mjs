import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexImageWorkerTransport} from '@openslate/director';
import {codexImageFixture as fixture,codexImageProfile as codex,codexRuntimeConfiguration as config,codexRowCounts as rowCounts} from './codex-image-execution-fixture.mjs';
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
test('actual reviewed image cannot consume Codex quota before a separate exact finite usage approval',async t=>{
  const f=fixture(t);f.build();const selected=await f.seed(),result=await f.runtime.engine.runReady();
  assert.equal(result.dispatched,0);assert.ok(result.blocked.some(row=>row.code==='EXTERNAL_ALLOWANCE_UNAVAILABLE'));
  for(const family of ['attempt','reservation','external_allowance_consumption'])assert.equal(f.store.list(family,selected.projectId).length,0);
  assert.equal(f.calls.prepare,0);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
});
test('Codex admission uses zero USD and captured native transport without consulting an API key or falling back',async t=>{
  const f=fixture(t,{configuration:{...config(),image:true}});f.build();const selected=await f.seed(),allowance=f.issue(selected),keyReads=f.calls.credentials;
  f.options.configuration.codexImage=false;f.options.transport.codexImage={prepare(){throw Error('mutated');}};f.transport.start=()=>{throw Error('replaced method');};
  const result=await f.runtime.engine.runReady();assert.equal(result.dispatched,1);assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,1);assert.equal(f.calls.api,0);assert.equal(f.calls.credentials,keyReads);
  const attempt=f.store.list('attempt',selected.projectId)[0],consumption=f.store.list('external_allowance_consumption',selected.projectId)[0];
  assert.equal(attempt.phase,'submission_unknown');assert.equal(attempt.taskId,null);assert.equal(consumption.allowanceId,allowance.id);assert.equal(consumption.estimatedMicros,'0');
  assert.ok(f.store.get('codex_image_execution_dispatch',attempt.id));
  await f.runtime.engine.reconcile();await f.runtime.engine.runReady();assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,1);assert.equal(f.calls.api,0);assert.equal(f.calls.credentials,keyReads);
  assert.equal(f.store.list('external_allowance_consumption',selected.projectId).length,1);
});
test('unsupported native operation options fail preflight before preparation or durable consumption',async t=>{
  for(const options of [{width:768},{settings:{quality:'medium'}}]) {
    const f=fixture(t);f.build();const selected=await f.seed(options);f.issue(selected);
    const result=await f.runtime.engine.runReady();assert.equal(result.dispatched,0);assert.ok(result.blocked.some(row=>['CODEX_IMAGE_PREFLIGHT_INVALID','CODEX_IMAGE_EXECUTION_CONFLICT'].includes(row.code)));
    for(const family of ['attempt','reservation','external_allowance_consumption'])assert.equal(f.store.list(family,selected.projectId).length,0);
    assert.equal(f.store.list('external_allowance',selected.projectId).length,1);assert.equal(f.calls.prepare,0);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
  }
});
test('native preparation failure retains its consumption and never substitutes the enabled direct API route',async t=>{
  const f=fixture(t,{configuration:{...config(),image:true}});f.transport.prepare=async()=>{f.calls.prepare++;throw Error('Synthetic native authentication unavailable');};
  f.build();const selected=await f.seed();f.issue(selected);await f.runtime.engine.runReady();
  const attempt=f.store.list('attempt',selected.projectId)[0];assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,0);assert.equal(f.calls.api,0);
  assert.equal(f.store.get('codex_image_execution_dispatch',attempt.id),undefined);assert.equal(f.store.list('external_allowance_consumption',selected.projectId).length,1);
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
