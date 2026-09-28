import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
import { Store } from '../dist/persistence/store.js';
import { filmPlanningGuidance } from '../dist/application/film-planning-guidance.js';
import { installRecoveryQuarantine, releaseRecovery } from '../dist/application/installation-recovery.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
function fixture(t) {
  const f=setup(t), service=new ProductionService(f.store,f.engine), project=service.createProject('Imported film'), token=randomBytes(32).toString('base64url'), actors=[];
  const app=createApp({service,localToken:token,director:{status(){return {mode:'native',status:'idle'};},enqueue(_,actor){actors.push(actor);},tick(){}}});
  t.after(()=>app.close());
  const base=`/api/projects/${project.id}/plan-imports`;
  const call=(suffix='',body, key=randomUUID(),auth=token)=>app.inject({method:body===undefined?'GET':'POST',url:base+suffix,headers:{host:'127.0.0.1',authorization:`Bearer ${auth}`,'idempotency-key':key},...(body===undefined?{}:{payload:body})});
  const input={name:'boots.md',text:'# Brief\nA 90-second boots film.\n## Scene 1\nReveal the boot.\n## Scene 2\nShow the leather.',expectedHeadVersion:0};
  async function draft() {
    const response=await call('',input);assert.equal(response.statusCode,200,response.body);
    const actor=actors.at(-1), bridge=service.openEpoch(project.id,actor);
    const proposal={variant:'workflow',expectedHeadVersion:0,creative:{brief:'A 90-second boots film.',createScenes:[{key:'reveal',purpose:'Reveal the boot'},{key:'detail',purpose:'Show the leather'}]}};
    const prepared=await service.prepare(project.id,bridge.actor,proposal);
    return {actor,bridge,prepared};
  }
  return {...f,service,project,app,call,input,actors,draft,base,token};
}
test('source import is bounded, authenticated, durable and idempotent without changing creative state',async t=>{
  const f=fixture(t),key=randomUUID();const r=await f.call('',f.input,key);assert.equal(r.statusCode,200,r.body);
  assert.deepEqual((await f.call('',f.input,key)).json(),r.json());assert.equal(f.actors.length,1);
  assert.equal(f.store.getProject(f.project.id).headVersion,0);assert.equal(f.store.list('grant',f.project.id).length,0);assert.equal(f.engine.attempts(f.project.id).length,0);
  assert.equal((await f.call('',undefined,randomUUID(),'wrong')).statusCode,403);
  const view=(await f.call()).json().pending;assert.equal(view.text,f.input.text);assert.equal(view.draft,null);
  assert.notEqual((await f.call('',f.input)).statusCode,200);
});
test('native interpretation produces a reviewable draft; director cannot publish or prepare generation',async t=>{
  const f=fixture(t),{bridge,prepared}=await f.draft();
  assert.equal(f.store.getProject(f.project.id).scenes.length,0);
  const view=(await f.call()).json().pending;assert.equal(view.draft.project.scenes.length,2);
  assert.throws(()=>f.service.apply(f.project.id,bridge.actor,prepared.id),e=>e.code==='IMPORT_REVIEW_REQUIRED');
  await assert.rejects(f.service.prepare(f.project.id,bridge.actor,{variant:'plan',expectedHeadVersion:0,source:'definePlan({},p=>{})'}),e=>e.code==='IMPORT_REVIEW_REQUIRED');
  await assert.rejects(new ToolInvocationService(f.service).invoke(f.project.id,bridge.actor,'cannot-apply','apply_change',{preparedId:prepared.id}),e=>e.code==='IMPORT_REVIEW_REQUIRED');
  const guide=filmPlanningGuidance(f.service,f.project.id,bridge.actor.requestId);assert.equal(guide.suppliedMaterial.reviewRequired,true);assert.match(guide.suppliedMaterial.protocol,/Do not call apply_change/);
});
test('human confirmation commits exactly the displayed scene IDs and cannot start media; retry reuses receipt',async t=>{
  const f=fixture(t),{actor,prepared}=await f.draft(),body={preparedId:prepared.id,proposalDigest:prepared.proposalDigest},key=randomUUID();
  const response=await f.call(`/${actor.requestId}/confirm`,body,key);assert.equal(response.statusCode,200,response.body);
  assert.deepEqual(f.store.getProject(f.project.id).scenes,prepared.next.scenes);
  assert.deepEqual((await f.call(`/${actor.requestId}/confirm`,body,key)).json(),response.json());
  assert.equal(f.store.getProject(f.project.id).headVersion,1);assert.equal(f.engine.attempts(f.project.id).length,0);
  assert.equal(f.store.list('grant',f.project.id).length,0);assert.equal(f.store.list('spending_allowance',f.project.id).length,0);
  assert.equal((await f.call()).json().pending,null);
});
test('new human direction, Stop and wrong digest reject old import acceptance',async t=>{
  const f=fixture(t),{actor,prepared}=await f.draft(),body={preparedId:prepared.id,proposalDigest:prepared.proposalDigest};
  assert.notEqual((await f.call(`/${actor.requestId}/confirm`,{...body,proposalDigest:'0'.repeat(64)})).statusCode,200);
  f.service.beginRequest(f.project.id,'local-user','Different direction',{editing:true,key:randomUUID()});
  assert.equal((await f.call()).json().pending.stale,true);
  assert.notEqual((await f.call(`/${actor.requestId}/confirm`,body)).statusCode,200);
  assert.equal(f.store.getProject(f.project.id).headVersion,0);
});
test('older proposal, changed head, and running interpretation cannot be confirmed',async t=>{
  const f=fixture(t),{actor,bridge,prepared}=await f.draft();
  const latest=await f.service.prepare(f.project.id,bridge.actor,{variant:'workflow',expectedHeadVersion:0,creative:{brief:'A revised interpretation'}});
  assert.notEqual((await f.call(`/${actor.requestId}/confirm`,{preparedId:prepared.id,proposalDigest:prepared.proposalDigest})).statusCode,200);
  f.store.insert('director_turn','running-import',f.project.id,{requestId:actor.requestId,epochId:bridge.actor.epochId,runtimeId:'test',createdAt:'2026-09-27T00:00:00Z',state:'running'});
  assert.notEqual((await f.call(`/${actor.requestId}/confirm`,{preparedId:latest.id,proposalDigest:latest.proposalDigest})).statusCode,200);
  f.store.put('director_turn','running-import',f.project.id,{requestId:actor.requestId,epochId:bridge.actor.epochId,runtimeId:'test',createdAt:'2026-09-27T00:00:00Z',state:'completed'});
  const project=f.store.getProject(f.project.id);f.store.saveProject({...project,brief:'A concurrent change'},0);
  assert.notEqual((await f.call(`/${actor.requestId}/confirm`,{preparedId:latest.id,proposalDigest:latest.proposalDigest})).statusCode,200);
});
test('discard fences the import epoch and releases only that imports holds',async t=>{
  const f=fixture(t);const prior=f.service.beginRequest(f.project.id,'local-user','Prior edit',{editing:true});
  const {actor,bridge}=await f.draft();const r=await f.call(`/${actor.requestId}/discard`,{});assert.equal(r.statusCode,200,r.body);
  assert.equal(f.store.get('epoch',bridge.actor.epochId).state,'revoked');
  assert.equal(f.store.list('hold',f.project.id).filter(h=>h.active&&h.ownerId===actor.requestId).length,0);
  assert.ok(f.store.list('hold',f.project.id).some(h=>h.active&&h.ownerId===prior.requestId));
  assert.equal(f.store.getProject(f.project.id).headVersion,0);assert.equal((await f.call()).json().pending,null);
});
test('pending source and exact proposed structure survive database reopen',async t=>{
  const f=fixture(t),{prepared}=await f.draft();
  const reopened=new Store(f.dbPath);t.after(()=>reopened.close());
  const service=new ProductionService(reopened,f.engine),app=createApp({service,localToken:f.token});t.after(()=>app.close());
  const response=await app.inject({method:'GET',url:f.base,headers:{host:'127.0.0.1',authorization:`Bearer ${f.token}`}});
  assert.equal(response.statusCode,200,response.body);assert.equal(response.json().pending.text,f.input.text);assert.deepEqual(response.json().pending.draft.project.scenes,prepared.next.scenes);
});
test('unsupported documents, blank input, wrong version and stopped imports are rejected',async t=>{
  const f=fixture(t);
  for(const patch of [{name:'brief.pdf'},{text:' '},{text:'x'.repeat(12001)},{text:'a\0b'},{expectedHeadVersion:1}]) assert.notEqual((await f.call('',{...f.input,...patch})).statusCode,200);
  const stop=f.service.beginRequest(f.project.id,'local-user','Stop',{editing:false});f.service.control(f.project.id,stop,'stop');
  assert.notEqual((await f.call('',f.input)).statusCode,200);assert.equal(f.actors.length,0);
});

test('restored import is stale, cannot publish, and can be discarded only after installation release',async t=>{
  const f=fixture(t),{actor,prepared}=await f.draft();
  installRecoveryQuarantine(f.store,{restoreId:randomUUID(),backupId:randomUUID(),backupManifestSha256:'a'.repeat(64),sourceDatabaseSha256:'b'.repeat(64),originalDataRoot:f.directory,backupCreatedAt:'2026-09-26T00:00:00.000Z',restoredAt:'2026-09-27T00:00:00.000Z'});
  const inspected=await f.call();assert.equal(inspected.statusCode,200,inspected.body);assert.equal(inspected.json().pending.stale,true);
  assert.notEqual((await f.call(`/${actor.requestId}/discard`,{})).statusCode,200);
  const state=f.service.recovery.snapshot();
  releaseRecovery(f.store,{restoreId:state.receipt.restoreId,expectedReceiptDigest:state.receiptDigest,expectedSummaryDigest:state.summaryDigest},{principalId:'local-user',commandId:randomUUID()});
  assert.notEqual((await f.call(`/${actor.requestId}/confirm`,{preparedId:prepared.id,proposalDigest:prepared.proposalDigest})).statusCode,200);
  const discarded=await f.call(`/${actor.requestId}/discard`,{});assert.equal(discarded.statusCode,200,discarded.body);
  assert.equal((await f.call()).json().pending,null);assert.equal(f.store.getProject(f.project.id).headVersion,0);
});
test('Stop after preparation prevents confirmation',async t=>{
  const f=fixture(t),{actor,prepared}=await f.draft();
  const stop=f.service.beginRequest(f.project.id,'local-user','Stop',{editing:false});f.service.control(f.project.id,stop,'stop');
  assert.equal((await f.call()).json().pending.stale,true);
  assert.notEqual((await f.call(`/${actor.requestId}/confirm`,{preparedId:prepared.id,proposalDigest:prepared.proposalDigest})).statusCode,200);
  assert.equal(f.store.getProject(f.project.id).headVersion,0);
});
