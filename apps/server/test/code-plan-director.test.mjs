import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_PLAN_TOOL_CONTRACT, DomainError, SUPPORTED_TOOL_CONTRACTS, digest, newId, parseToolArguments, toolCatalog, toolContractAtLeast, toolHandlerId } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { skillPackageDigest, readSkillPackageFiles } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { DirectorSupervisor } from '../dist/application/director-supervisor.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { DirectorToolSettings } from '../dist/application/director-tools-upgrade.js';
import { CODE_PLAN_GUIDANCE_DIGEST } from '../dist/application/director-capabilities.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { holdCodePlanRequest, releaseCodePlanRequest, wireCodePlans, triggerCodePlanRepairs } from '../dist/code-plan/director.js';
import { runSandbox } from '../dist/code-plan/sandbox.js';
import { createApp } from '../dist/app.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const example = readFileSync(join(repositoryRoot, 'skills/code-plan/references/example-plan.ts'), 'utf8');
const diff = () => ({ reusedSteps: 0, newSteps: [], cancelledSteps: 0, certainMicros: '0', dependsOnPending: true, findings: [] });
const identity = input => Object.fromEntries(['projectId','requestId','epochId','turnId'].map(key => [key,input[key]]));
const completed = input => ({ ...identity(input), status: 'completed', text: 'Done', dispatched: true });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function writable(root) { chmodSync(root, 0o700); for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) writable(join(root, entry.name)); }

// Fake implements the lead-owned port, including durable invocation replay. No P2b implementation is imported.
class FakeCodePlans {
  calls = []; held = []; released = []; fail = null; lose = false;
  constructor(store) { this.store = store; }
  view(projectId) {
    const versions = this.store.list('test_code_version', projectId).reverse();
    return { projectId, planVersion: versions[0]?.version ?? null, state: versions.length ? 'waiting' : 'empty', held: this.held.length > this.released.length,
      ceilingMicros: '1000000', spentMicros: '0', reservedMicros: '0', declarations: { scenes: [], shots: [] }, steps: [], choices: [],
      versions: versions.map(({source, ...row}) => row), logs: [], lastPassAt: null };
  }
  source(projectId, version) { const row = this.store.list('test_code_version', projectId).find(row => row.version === version); assert.ok(row); return row; }
  async dryRun() { return diff(); }
  async submit(projectId, input) {
    this.calls.push(structuredClone(input));
    const saved = this.store.get('test_code_submit', input.invocationId);
    if (saved) { assert.equal(saved.digest, digest(input)); return saved.result; }
    if (input.basedOnVersion !== this.view(projectId).planVersion) throw new DomainError('REVISION_CONFLICT', 'Plan changed');
    if (input.source === 'reject') throw new DomainError('CODE_PLAN_REJECTED', 'Bad source', { diff: { ...diff(), findings: [{ code: 'SOURCE_SYNTAX' }] } });
    const result = { version: (input.basedOnVersion ?? 0) + 1, diff: diff() };
    this.store.insert('test_code_version', newId(), projectId, { ...result, author: input.author, source: input.source, sha256: createHash('sha256').update(input.source).digest('hex'), createdAt: new Date().toISOString() });
    this.store.insert('test_code_submit', input.invocationId, projectId, { digest: digest(input), result });
    if (this.lose) { this.lose = false; throw new Error('Lost response after commit'); }
    return result;
  }
  hold(projectId, id) { this.held.push(id); }
  release(projectId, id) { this.released.push(id); }
  failure() { return this.fail; }
}
function fixture(t, { mode = 'code' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-code-director-'));
  const store = new Store(join(root, 'app.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  let project = service.createProject('Code film');
  project = store.saveProject({ ...project, ...(mode === 'code' ? { planMode: 'code' } : {}) }, project.headVersion);
  const port = new FakeCodePlans(store); wireCodePlans(service, port);
  const config = { repositoryRoot, snapshotRoot: join(root, 'skills'), endpoint: 'http://127.0.0.1:3107' };
  const f = { root, store, provider, service, project, port, config, controllers: [] };
  f.prepare = createDirectorInput(service, config);
  f.turn = (text = 'Make a film', options = {}) => {
    const human = service.beginRequest(project.id, 'local-user', text, options), bridge = service.openEpoch(project.id, human);
    const turn = { id: newId(), projectId: project.id, requestId: human.requestId };
    const input = f.prepare(turn, human, bridge); return { human, bridge, turn, input };
  };
  f.supervisor = (start = async input => completed(input), options = {}) => {
    const supervisor = new DirectorSupervisor(service, { id: 'test-runtime', start }, { mode: 'fake', prepareInput: f.prepare, ...options });
    f.controllers.push(supervisor); return supervisor;
  };
  f.local = () => { const controller = new LocalDirectorController(service, { ...config, dataDirectory: root, codePlans: port }); f.controllers.push(controller); return controller; };
  t.after(async () => { for (const controller of f.controllers) await controller.close(); provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  return f;
}

test('code catalog is isolated from every graph comparison and enforces source bytes, version and summary', () => {
  assert.deepEqual(toolCatalog(CODE_PLAN_TOOL_CONTRACT).names, ['read_film','submit_plan','set_spend_limit','retry_step']);
  assert.ok(!SUPPORTED_TOOL_CONTRACTS.includes(CODE_PLAN_TOOL_CONTRACT));
  for (const version of SUPPORTED_TOOL_CONTRACTS) {
    assert.equal(toolContractAtLeast(CODE_PLAN_TOOL_CONTRACT, version), false);
    assert.equal(toolContractAtLeast(version, CODE_PLAN_TOOL_CONTRACT), false);
    assert.notEqual(toolHandlerId(version), toolHandlerId(CODE_PLAN_TOOL_CONTRACT));
    assert.ok(!toolCatalog(version).names.includes('submit_plan'));
  }
  const args = { source: 'x'.repeat(256*1024), basedOnVersion: null, summary: 'x'.repeat(500) };
  assert.ok(parseToolArguments('submit_plan', args, CODE_PLAN_TOOL_CONTRACT));
  for (const patch of [{source: 'x'.repeat(256*1024+1)}, {source: '中'.repeat(90000)}, {summary:'x'.repeat(501)}, {basedOnVersion:0}, {basedOnVersion:1.5}, {extra:1}])
    assert.throws(() => parseToolArguments('submit_plan', {...args,...patch}, CODE_PLAN_TOOL_CONTRACT), {code:'VALIDATION_ERROR'});
  assert.throws(() => parseToolArguments('read_context', {}, CODE_PLAN_TOOL_CONTRACT), {code:'NOT_FOUND'});
});

test('code turn pins only code-plan instructions and source, skips fresh graph upgrade, retains the epoch lock', async t => {
  const f = fixture(t);
  const options = { ...f.config, freshTurnGuidance: { currentForFreshTurn() { assert.fail('Graph upgrade called'); } } };
  f.prepare = createDirectorInput(f.service, options);
  const a = f.turn(), context = JSON.parse(a.input.context);
  assert.deepEqual(a.input.skills.map(skill => skill.name), ['code-plan']);
  assert.equal(a.input.bridge.toolContractVersion, CODE_PLAN_TOOL_CONTRACT);
  assert.equal(context.film.source, null); assert.equal(context.snapshot, undefined);
  assert.deepEqual(context.references.map(row=>row.path), ['SKILL.md','references/studio.d.ts','references/example-plan.ts']);
  assert.match(context.instructions, /read-only/); assert.doesNotMatch(a.input.context, /Confirm in this chat|prepare_change|filmPlanning/);
  const lock = f.store.list('director_skill_lock', f.project.id)[0].lock;
  assert.equal(f.store.list('skill_read', f.project.id).length, 3);
  assert.equal(f.store.list('director_context', f.project.id).length, 1);
  assert.equal(lock.schemaVersion, 1); assert.equal(lock.skills[0].packageDigest, CODE_PLAN_GUIDANCE_DIGEST);
  assert.equal(skillPackageDigest(readSkillPackageFiles(join(repositoryRoot, 'skills/code-plan'))), CODE_PLAN_GUIDANCE_DIGEST);
  assert.equal(f.prepare(a.turn, a.human, a.bridge).bridge.toolContractVersion, CODE_PLAN_TOOL_CONTRACT);
  assert.equal(f.store.list('director_skill_lock', f.project.id).length, 1);
  const settings = new DirectorToolSettings(f.service, () => f.config);
  assert.equal(settings.currentForFreshTurn(f.project.id, a.bridge.actor, a.turn.id).id, lock.id);
  assert.equal(settings.status(f.project.id).upgradeAvailable, false);
  assert.throws(() => settings.upgrade(f.project.id, {}, 'upgrade'), {code:'CODE_PLAN_MODE'});
  const result = await new ToolInvocationService(f.service).invoke(f.project.id, a.bridge.actor, 'save', 'submit_plan', {source:example,basedOnVersion:null,summary:'Example'});
  assert.equal(result.version, 1);
  const b = f.turn('Read it');
  assert.equal(JSON.parse(b.input.context).film.source, example);
});

test('graph instructions, lock pins and catalog remain on the shipped identity', t => {
  const f = fixture(t, {mode:'graph'}), {input} = f.turn();
  const context = JSON.parse(input.context), lock = f.store.list('director_skill_lock', f.project.id)[0].lock;
  assert.equal(input.bridge.toolContractVersion, '7.1.0'); assert.equal(lock.schemaVersion, 2);
  assert.equal(toolCatalog('7.1.0').digest, 'b9b0e85b36087a948dfa987ea5095e16e919fb9d3de6d3be91605c189e531f5f');
  assert.ok(context.snapshot); assert.ok(context.filmPlanning); assert.equal(context.film, undefined);
  assert.match(context.instructions, /Confirm in this chat/);
  assert.ok(!input.skills.some(skill => skill.name === 'code-plan'));
});

test('submit returns version/diff, author and exact invocation identity; replay adds no version', async t => {
  const f = fixture(t), {bridge} = f.turn(), calls = new ToolInvocationService(f.service);
  const args = {source:example,basedOnVersion:null,summary:'Two shots'};
  const first = await calls.invoke(f.project.id, bridge.actor, 'save', 'submit_plan', args);
  assert.deepEqual(first, {version:1,diff:diff()});
  assert.deepEqual(await calls.invoke(f.project.id, bridge.actor, 'save', 'submit_plan', args), first);
  assert.equal(f.port.calls.length, 1); assert.equal(f.port.calls[0].author, 'director');
  assert.equal(f.port.calls[0].invocationId, digest({projectId:f.project.id,epochId:bridge.actor.epochId,callId:'save'}));
  await assert.rejects(calls.invoke(f.project.id, bridge.actor, 'save', 'submit_plan', {...args,summary:'Other'}), {code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(calls.invoke(f.project.id, bridge.actor, 'stale', 'submit_plan', args), {code:'REVISION_CONFLICT'});
  assert.equal(f.port.view(f.project.id).versions.length, 1);
  const film = await calls.invoke(f.project.id, bridge.actor, 'read', 'read_film', {});
  assert.equal(film.source, example); assert.equal(film.planVersion, 1);
});

test('rejection preserves its diff for exact replay and over the tool HTTP route', async t => {
  const f = fixture(t), {bridge} = f.turn(), calls = new ToolInvocationService(f.service);
  const args = {source:'reject',basedOnVersion:null,summary:'Invalid'};
  for (let i=0;i<2;i++) await assert.rejects(calls.invoke(f.project.id, bridge.actor, 'reject', 'submit_plan', args), error => {
    assert.equal(error.code,'CODE_PLAN_REJECTED'); assert.equal(error.details.diff.findings[0].code,'SOURCE_SYNTAX'); return true;
  });
  assert.equal(f.port.calls.length,1);
  const app = createApp({service:f.service,codePlans:f.port,musicListener:null}); t.after(()=>app.close());
  const response = await app.inject({method:'POST',url:`/internal/projects/${f.project.id}/tools/submit_plan`,headers:{authorization:`Bearer ${bridge.token}`,'x-openslate-tool-call-id':'reject-http'},payload:args});
  assert.equal(response.statusCode,400, response.body);
  assert.equal(response.json().error.details.diff.findings[0].code,'SOURCE_SYNTAX');
});

test('lost submit result reconciles with the same invocation ID after epoch revocation, without another version', async t => {
  const f = fixture(t), {bridge} = f.turn(), calls = new ToolInvocationService(f.service);
  f.port.lose = true;
  await assert.rejects(calls.invoke(f.project.id,bridge.actor,'lost','submit_plan',{source:example,basedOnVersion:null,summary:'Save'}),{code:'TOOL_CALL_UNRESOLVED'});
  const epoch = f.store.get('epoch',bridge.actor.epochId); f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'revoked'});
  const restarted = new ToolInvocationService(f.service); restarted.reconcileEpoch(f.project.id,epoch.id); restarted.reconcileEpoch(f.project.id,epoch.id);
  await restarted.settleReconciliation();
  assert.equal(f.port.calls.length,2); assert.equal(f.port.calls[0].invocationId,f.port.calls[1].invocationId);
  assert.equal(f.port.view(f.project.id).versions.length,1);
  assert.equal(f.store.list('tool_invocation',f.project.id)[0].state,'unresolved');
  assert.deepEqual(f.store.list('tool_reconciliation',f.project.id)[0].receipt,{version:1,diff:diff()});
  assert.equal(f.store.list('tool_reconciliation',f.project.id)[0].state,'effect_confirmed');
  restarted.reconcileEpoch(f.project.id,epoch.id); await restarted.settleReconciliation(); assert.equal(f.port.calls.length,2);
});

for (const status of ['completed','failed','unknown','waiting_user']) test(`code holds release exactly once on ${status}`, async t => {
  const f=fixture(t), supervisor=f.supervisor(async (input,{onEvent})=>{
    if(status==='waiting_user') await onEvent({...identity(input),kind:'pending_input',nativeRequestId:'q',questions:[]});
    return {...completed(input),status:status==='waiting_user'?'completed':status,...(status==='unknown'?{error:{code:'RUNTIME_RUN_TIMEOUT',message:'Timeout'}}:{})};
  });
  const human=f.service.beginRequest(f.project.id,'local-user','Make film'), turn=supervisor.enqueue(f.project.id,human);
  assert.deepEqual(f.port.held,[human.requestId]);
  supervisor.enqueue(f.project.id,human); assert.equal(f.port.held.length,1);
  supervisor.tick();await supervisor.settle();supervisor.tick();await supervisor.settle();
  assert.equal(f.store.get('director_turn',turn.id).state,status); assert.deepEqual(f.port.released,[human.requestId]);
});

test('Stop interrupts the running code turn and retires queued holds exactly once', async t => {
  const f=fixture(t), started=deferred(), supervisor=f.supervisor(async(input,options)=>{
    started.resolve(); await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true})); return completed(input);
  });
  const first=f.service.beginRequest(f.project.id,'local-user','Make film');supervisor.enqueue(f.project.id,first);supervisor.tick();await started.promise;
  const queued=f.service.beginRequest(f.project.id,'local-user','Discuss',{editing:false});supervisor.enqueue(f.project.id,queued);
  const stop=f.service.beginRequest(f.project.id,'local-user','Stop',{editing:false});f.service.control(f.project.id,stop,'stop');
  supervisor.tick();await supervisor.settle();supervisor.tick();await supervisor.settle();
  assert.deepEqual(new Set(f.port.released),new Set([first.requestId,queued.requestId])); assert.equal(f.port.released.length,2);
});

test('restart reconciles expired and saved terminal holds without redispatching the Director', async t => {
  const f=fixture(t), supervisor=f.supervisor(()=>assert.fail('Native turn replayed'),{now:()=>10000});
  const human=f.service.beginRequest(f.project.id,'local-user','Make film'), turn=supervisor.enqueue(f.project.id,human), bridge=f.service.openEpoch(f.project.id,human);
  f.store.put('director_turn',turn.id,f.project.id,{...turn,state:'running',owner:'dead',leaseExpiresAt:0,dispatched:true,epochId:bridge.actor.epochId});
  supervisor.tick();await supervisor.settle();supervisor.tick();await supervisor.settle();
  assert.equal(f.store.get('director_turn',turn.id).state,'unknown'); assert.deepEqual(f.port.released,[human.requestId]);
  // Simulate a crash after terminal persistence but before hold release.
  const row=f.store.list('code_plan_director_hold',f.project.id)[0]; f.store.put('code_plan_director_hold',row.id,f.project.id,{...row,state:'open'});
  const fresh=new FakeCodePlans(f.store);wireCodePlans(f.service,fresh);
  supervisor.tick();await supervisor.settle();supervisor.tick(); assert.deepEqual(fresh.released,[human.requestId]);
});

test('HTTP message queue opens one hold and fake Director submits the pinned example as version 1', async t => {
  const f=fixture(t), local=f.local(), token='test-local-token-code-director';
  const app=createApp({service:f.service,director:local,codePlans:f.port,localToken:token,musicListener:null});t.after(()=>app.close());
  const response=await app.inject({method:'POST',url:`/api/projects/${f.project.id}/messages`,headers:{authorization:`Bearer ${token}`,'idempotency-key':'message'},payload:{text:'Make a film'}});
  assert.equal(response.statusCode,200,response.body);await local.settle();
  assert.equal(f.port.view(f.project.id).planVersion,1);assert.equal(f.port.source(f.project.id,1).source,example);
  assert.equal(f.port.held.length,1);assert.deepEqual(f.port.released,f.port.held);
  assert.deepEqual(f.store.list('tool_invocation',f.project.id).map(call=>call.tool),['read_film','submit_plan']);
});

test('Director failures queue two application repair turns per version, then ask the person exactly once', async t => {
  const f=fixture(t), local=f.local();
  await f.port.submit(f.project.id,{source:example,basedOnVersion:null,author:'director',invocationId:'seed'});
  f.port.fail={version:1,message:'Missing value',stack:'film:12'};
  // Leave the failed version unchanged, simulating unsuccessful repair replies.
  local.fake.runtime.start=async input=>{ const ctx=JSON.parse(input.context);assert.deepEqual(ctx.repair,f.port.fail);return completed(input); };
  local.tick();local.tick();assert.equal(f.store.list('code_plan_repair_request',f.project.id).length,1);await local.settle();
  local.tick();await local.settle();assert.equal(f.store.list('code_plan_repair_request',f.project.id).length,2);
  local.tick();local.tick();await local.settle();
  assert.equal(f.store.list('code_plan_repair_request',f.project.id).length,2);
  const asks=f.store.list('director_output',f.project.id).filter(row=>row.text.includes('after two automatic repair attempts'));
  assert.equal(asks.length,1);
  assert.ok(f.store.list('code_plan_repair_request',f.project.id).every(row=>f.store.get('message',row.requestId).source==='app'));
});

test('user-authored errors and stopped projects do not queue automatic repairs', async t => {
  const f=fixture(t), queued=[];
  await f.port.submit(f.project.id,{source:example,basedOnVersion:null,author:'user',invocationId:'seed'});f.port.fail={version:1,message:'Error',stack:''};
  triggerCodePlanRepairs(f.service,(...args)=>queued.push(args));assert.equal(queued.length,0);
  const version=f.store.list('test_code_version',f.project.id)[0];f.store.put('test_code_version',f.store.db.prepare("SELECT id FROM entities WHERE kind='test_code_version'").get().id,f.project.id,{...version,author:'director'});
  f.service.engine.setPaused(f.project.id,true,'local-user');triggerCodePlanRepairs(f.service,(...args)=>queued.push(args));assert.equal(queued.length,0);
});

test('pinned example executes every ctx call through JSON, stable choices, variants, fallback and final render', async () => {
  const calls=[], artifact=kind=>({artifactId:newId(),kind,sha256:'a'.repeat(64)});
  const result=await runSandbox({source:example,now:1,seed:1,call:(method,args)=>{
    calls.push({method,args});
    if(method==='scene'||method==='shot')return args[0];if(method==='log')return null;if(method==='choose')return args[1].options[0];
    if(method==='video'&&!args[0].variant)return{ok:false,error:{code:'FAILED',message:'Fixture fallback',retry:'consent',mayHaveCharged:true}};
    const item=artifact(method==='image'?'image':'video');return{ok:true,artifact:item,artifacts:[item]};
  }});
  assert.equal(result.state,'done',JSON.stringify(result));
  assert.equal(calls.filter(c=>c.method==='image').length,6);
  assert.deepEqual(calls.filter(c=>c.method==='choose').map(c=>c.args[0]),['shot-1-keyframe','shot-2-keyframe','shot-1-retry','shot-2-retry']);
  assert.equal(calls.filter(c=>c.method==='video').length,4);assert.equal(calls.filter(c=>c.method==='render').length,1);
  assert.deepEqual(calls.find(c=>c.method==='render').args[0].map(row=>row.motion),
    ['Slow gentle push in', 'Locked camera, subtle steam']);
});

test('code project changes fake/native selection with code locks and never runs a graph release upgrade', async t => {
  const f=fixture(t), inputs=[];
  const local=new LocalDirectorController(f.service,{...f.config,dataDirectory:f.root,codePlans:f.port,
    defaults:{binaryPath:process.execPath,model:'test-model'},
    setup:async()=>({readiness:{status:'ready'},runtimeOptions:{}}),
    makeRuntime:()=>({id:'codex-app-server',start:async(input,{onEvent})=>{
      inputs.push(input);await onEvent({...identity(input),kind:'runtime_started',nativeThreadId:'fixture-code'});return completed(input);
    }})});f.controllers.push(local);
  local.enqueue(f.project.id,f.service.beginRequest(f.project.id,'local-user','Example'));local.tick();await local.settle();
  const old=f.store.list('director_skill_lock',f.project.id)[0].lock;
  await local.changeSelection(f.project.id,{expectedSelectionDigest:local.settings(f.project.id).selectionDigest,
    selection:{mode:'native',binaryPath:process.execPath,model:'test-model'}},'native');
  local.enqueue(f.project.id,f.service.beginRequest(f.project.id,'local-user','Keep it'));local.tick();await local.settle();
  assert.equal(inputs.length,1);assert.equal(inputs[0].bridge.toolContractVersion,CODE_PLAN_TOOL_CONTRACT);
  assert.equal(JSON.parse(inputs[0].context).film.source,example);
  const locks=f.store.list('director_skill_lock',f.project.id).map(row=>row.lock);
  assert.equal(locks.length,2);assert.equal(locks[1].skills[0].packageDigest,old.skills[0].packageDigest);
  assert.ok(locks[1].bindings.some(binding=>binding.kind==='runtime'&&binding.id==='codex-app-server'));
  assert.equal(local.tools(f.project.id).upgradeAvailable,false);
  assert.ok(!f.store.readEvents(f.project.id).some(event=>event.payload?.source==='application_compatible_upgrade'));
});

test('damaged code recovery input never replays a submission, and a healthy started call settles', async t => {
  const f=fixture(t), {bridge}=f.turn();
  const args={source:example,basedOnVersion:null,summary:'Save'}, callId='started', id=digest({projectId:f.project.id,epochId:bridge.actor.epochId,callId});
  const lock=f.store.list('director_skill_lock',f.project.id)[0].lock;
  const call={id,projectId:f.project.id,requestId:bridge.actor.requestId,epochId:bridge.actor.epochId,callId,tool:'submit_plan',
    toolContractVersion:CODE_PLAN_TOOL_CONTRACT,catalogDigest:toolCatalog(CODE_PLAN_TOOL_CONTRACT).digest,skillLockId:lock.id,
    argumentsDigest:digest(args),state:'started',result:null,resultDigest:null,error:null,recovery:{codePlan:{...args,summary:'Changed'}}};
  f.store.insert('tool_invocation',id,f.project.id,call);
  const epoch=f.store.get('epoch',bridge.actor.epochId);f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'revoked'});
  const calls=new ToolInvocationService(f.service);calls.reconcileEpoch(f.project.id,epoch.id);await calls.settleReconciliation();
  assert.equal(f.port.calls.length,0);assert.equal(f.store.list('tool_reconciliation',f.project.id).length,0);
  const healthyId=digest({projectId:f.project.id,epochId:bridge.actor.epochId,callId:'healthy'});
  f.store.insert('tool_invocation',healthyId,f.project.id,{...call,id:healthyId,callId:'healthy',recovery:{codePlan:args}});
  calls.reconcileEpoch(f.project.id,epoch.id);await calls.settleReconciliation();
  assert.equal(f.port.calls.length,1);assert.equal(f.store.get('tool_invocation',healthyId).state,'succeeded');
});

test('an unavailable code port fails before dispatch and has no graph fallback', async t => {
  const f=fixture(t), isolated=new ProductionService(f.store,new Engine(f.store,f.provider,{artifactDir:join(f.root,'isolated')}));
  const human=isolated.beginRequest(f.project.id,'local-user','Code'), bridge=isolated.openEpoch(f.project.id,human);
  assert.throws(()=>createDirectorInput(isolated,f.config)({id:newId(),projectId:f.project.id,requestId:human.requestId},human,bridge),{code:'TOOL_CAPABILITY_UNAVAILABLE'});
});

test('spend and retry tools require quoted human consent, persist thread receipts and reconcile lost replies without reapplying',async t=>{
 const f=fixture(t),calls=new ToolInvocationService(f.service),key='a'.repeat(64);let limits=0,retries=0;
 f.port.setCeiling=(projectId,input)=>{limits++;assert.equal(input.by,'director');assert.equal(input.quote,'set the limit to $300');return {...f.port.view(projectId),ceilingMicros:input.ceilingMicros};};
 f.port.retryStep=(projectId,input)=>{retries++;assert.deepEqual(input.consent.by,'director');return {...f.port.view(projectId),steps:[{key,kind:'video',label:'tofu-05',state:'failed'}]};};
 const a=f.turn('Please set the limit to $300\n and retry the tofu clip.');
 f.store.insert('director_turn',a.turn.id,f.project.id,{...a.turn,epochId:a.bridge.actor.epochId,state:'running'});
 const result=await calls.invoke(f.project.id,a.bridge.actor,'limit','set_spend_limit',{ceilingMicros:'300000000',quote:'set the limit to $300'});
 assert.equal(result.view.ceilingMicros,'300000000');assert.match(result.receipt,/\$300.00/);assert.equal(limits,1,'no chat cap');
 assert.deepEqual(await calls.invoke(f.project.id,a.bridge.actor,'limit','set_spend_limit',{ceilingMicros:'300000000',quote:'set the limit to $300'}),result);assert.equal(limits,1);
 await assert.rejects(calls.invoke(f.project.id,a.bridge.actor,'wrong','retry_step',{stepKey:key,quote:'retry everything'}),{code:'CODE_PLAN_CONSENT_QUOTE'});
 await assert.rejects(calls.invoke(f.project.id,a.bridge.actor,'empty','set_spend_limit',{ceilingMicros:'1',quote:'   '}),{code:'CODE_PLAN_CONSENT_QUOTE'});
 const retry=await calls.invoke(f.project.id,a.bridge.actor,'retry','retry_step',{stepKey:key,quote:'and   retry the tofu clip.'});
 assert.match(retry.receipt,/tofu-05/);assert.equal(retries,1);
 assert.equal(f.store.list('code_plan_director_change',f.project.id).length,2);
 assert.deepEqual(f.store.list('director_output',f.project.id).map(o=>o.text),[result.receipt,retry.receipt]);
 // Model the crash window between the domain command and saving the tool result.
 const pendingId=digest({projectId:f.project.id,epochId:a.bridge.actor.epochId,callId:'lost-limit'});
 const originalFinish=calls.finish.bind(calls);let lose=true;
 calls.finish=(...args)=>{if(args[0]===pendingId&&lose){lose=false;throw Error('lost completion');}return originalFinish(...args);};
 await assert.rejects(calls.invoke(f.project.id,a.bridge.actor,'lost-limit','set_spend_limit',{ceilingMicros:'300000000',quote:'set the limit to $300'}),{code:'TOOL_CALL_UNRESOLVED'});
 assert.equal(limits,2);
 const epoch=f.store.get('epoch',a.bridge.actor.epochId);f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'revoked'});
 calls.reconcileEpoch(f.project.id,epoch.id);await calls.settleReconciliation();
 assert.equal(limits,2);assert.equal(f.store.get('tool_reconciliation',pendingId).state,'effect_confirmed');
 // Application turns can repeat human words, but cannot borrow that authority.
 const b=f.turn('set the limit to $300',{source:'app'});
 await assert.rejects(calls.invoke(f.project.id,b.bridge.actor,'app-limit','set_spend_limit',{ceilingMicros:'300000000',quote:'set the limit to $300'}),{code:'CODE_PLAN_PERSON_CONSENT_REQUIRED'});
 assert.equal(limits,2);
});

test('paid media failures queue exactly one Director notification per attempt, including retry meaning and price',async t=>{
 const f=fixture(t),local=f.local();await f.port.submit(f.project.id,{source:example,basedOnVersion:null,author:'user',invocationId:'seed'});
 const original=f.port.view.bind(f.port),step={key:'b'.repeat(64),kind:'video',model:'fake-video',state:'failed',label:'tofu-05',priceMicros:'100000',reached:true,updatedAt:'2026-10-30',attempts:1,error:{code:'SUBMISSION_RESPONSE_LOST',retry:'consent',mayHaveCharged:true}};
 f.port.view=projectId=>({...original(projectId),steps:[step]});let turns=0;
 local.fake.runtime.start=async input=>{turns++;const context=JSON.parse(input.context);assert.equal(context.mediaFailure.stepKey,step.key);assert.equal(context.mediaFailure.shotLabel,'tofu-05');assert.equal(context.mediaFailure.retry,'consent');assert.equal(context.mediaFailure.mayHaveCharged,true);assert.equal(context.mediaFailure.priceMicros,'100000');return completed(input);};
 local.tick();local.tick();await local.settle();local.tick();await local.settle();assert.equal(turns,1);
 assert.equal(f.store.list('code_plan_failure_request',f.project.id).length,1);
 // The marker survives a new controller and changed plan version.
 await local.close();const next=f.local();next.fake.runtime.start=local.fake.runtime.start;
 next.tick();await next.settle();assert.equal(turns,1);
 step.attempts=2;next.tick();await next.settle();next.tick();await next.settle();assert.equal(turns,2);
 step.reached=false;step.attempts=3;next.tick();await next.settle();assert.equal(turns,2);
});

test('safe failures scheduled for automatic retry do not notify the Director early',async t=>{
 const f=fixture(t),key='c'.repeat(64),original=f.port.view.bind(f.port),queue=[];
 f.port.view=p=>({...original(p),steps:[{key,kind:'video',state:'failed',priceMicros:'100000',reached:true,attempts:1,label:'clip',error:{code:'CONNECT_ECONNREFUSED',retry:'safe',mayHaveCharged:false}}]});
 const id=digest({projectId:f.project.id,key});f.store.put('code_plan_step',id,f.project.id,{id,key,projectId:f.project.id,retryAt:Date.now()+250});
 triggerCodePlanRepairs(f.service,(...args)=>queue.push(args));assert.equal(queue.length,0);
 const row=f.store.get('code_plan_step',id);delete row.retryAt;f.store.put('code_plan_step',id,f.project.id,row);
 triggerCodePlanRepairs(f.service,(...args)=>queue.push(args));triggerCodePlanRepairs(f.service,(...args)=>queue.push(args));assert.equal(queue.length,1);
});

test('0.1.0 films retain the exact old catalog, guidance, submit recovery and runtime-selection pin',async t=>{
 const {createDirectorSkillLock,CODE_PLAN_V1_GUIDANCE_DIGEST}=await import('../dist/application/director-capabilities.js');
 const f=fixture(t),old=createDirectorSkillLock(f.config,'0.1.0').lock;
 f.store.insert('director_skill_lock',old.id,f.project.id,{id:old.id,projectId:f.project.id,lock:old});
 assert.deepEqual(toolCatalog('0.1.0').names,['read_film','submit_plan']);assert.equal(toolHandlerId('0.1.0'),'code-plan-tools@1');
 assert.throws(()=>parseToolArguments('retry_step',{stepKey:'a'.repeat(64),quote:'yes'},'0.1.0'),{code:'NOT_FOUND'});
 const {bridge,input}=f.turn('Keep my old film');assert.equal(input.bridge.toolContractVersion,'0.1.0');
 const context=JSON.parse(input.context);assert.equal(context.references.find(r=>r.path==='references/example-plan.ts').content,readFileSync(join(repositoryRoot,'skills/code-plan-v1/references/example-plan.ts'),'utf8'));
 assert.equal(old.skills[0].packageDigest,CODE_PLAN_V1_GUIDANCE_DIGEST);assert.equal(new DirectorToolSettings(f.service,()=>f.config).status(f.project.id).currentVersion,'0.1.0');
 const calls=new ToolInvocationService(f.service);f.port.lose=true;
 await assert.rejects(calls.invoke(f.project.id,bridge.actor,'old-submit','submit_plan',{source:example,basedOnVersion:null,summary:'old catalog still works'}),{code:'TOOL_CALL_UNRESOLVED'});
 const epoch=f.store.get('epoch',bridge.actor.epochId);f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'revoked'});
 calls.reconcileEpoch(f.project.id,epoch.id);await calls.settleReconciliation();assert.equal(f.port.view(f.project.id).versions.length,1);assert.equal(f.store.list('tool_reconciliation',f.project.id)[0].state,'effect_confirmed');
});

test('quoted consent cannot override a read-only or superseded Director epoch',async t=>{
 const f=fixture(t),a=f.turn('Set the limit to $3 and retry the clip'),calls=new ToolInvocationService(f.service);
 f.port.setCeiling=()=>assert.fail('read-only epoch changed limit');f.port.retryStep=()=>assert.fail('read-only epoch opened retry');
 const epoch=f.store.get('epoch',a.bridge.actor.epochId);f.store.put('epoch',epoch.id,f.project.id,{...epoch,state:'read_only'});
 await assert.rejects(calls.invoke(f.project.id,a.bridge.actor,'limit-read-only','set_spend_limit',{ceilingMicros:'3000000',quote:'Set the limit to $3'}),{code:'ACTOR_DENIED'});
 await assert.rejects(calls.invoke(f.project.id,a.bridge.actor,'retry-read-only','retry_step',{stepKey:'a'.repeat(64),quote:'retry the clip'}),{code:'ACTOR_DENIED'});
 f.service.beginRequest(f.project.id,'local-user','Use a different direction');
 await assert.rejects(calls.invoke(f.project.id,a.bridge.actor,'stale','set_spend_limit',{ceilingMicros:'3000000',quote:'Set the limit to $3'}),{code:'EPOCH_REVOKED'});
 assert.equal(f.store.list('code_plan_director_change',f.project.id).length,0);
});
