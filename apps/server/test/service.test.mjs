import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductionService } from '../dist/application/service.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { FakeProvider } from '@openslate/providers';
import { DEFAULT_PROFILES, workflowReadiness, newId } from '@openslate/core';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'openslate-service-'));
  const store = new Store(join(dir, 'state.sqlite'));
  const provider = new FakeProvider(join(dir, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(dir, 'artifacts') });
  const service = new ProductionService(store, engine);
  const project = service.createProject('Boots fixture');
  const human = service.beginRequest(project.id, 'human', 'Make a boots commercial');
  const actor = service.openEpoch(project.id, human).actor;
  t.after(() => { store.close(); provider.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, provider, engine, service, project, human, actor };
}
async function withShot(t) {
  const f = setup(t);
  const prepared = await f.service.prepare(f.project.id, f.actor, { variant: 'project', expectedHeadVersion: 0,
    creative: { brief: 'Leather boots', story: 'Craftsmanship', createScenes: [{ key: 'scene', purpose: 'Show stitching' }], createShots: [{ key: 'shot', sceneId: 'scene', purpose: 'Show leather', action: 'Boot on bench', framing: 'Close up', motion: 'Push in', desiredFrames: 180, imagePrompt: 'Boot close up', videoPrompt: 'Slow push', referenceArtifactIds: [], cueId: null }] } });
  f.service.apply(f.project.id, f.actor, prepared.id);
  f.project = f.store.getProject(f.project.id); f.shot = f.project.shots[0];
  return f;
}
function source(project, video = false, imageAlias = 'frame') {
  const shot = project.shots[0], q = JSON.stringify;
  return `definePlan({baseRevision:${q(project.revisionId)}},p=>{
    const shot=p.shot(${q(shot.id)});
    const frame=p.image(${q(imageAlias)},{intent:shot,profile:"fake-image-v1",references:[],prompt:${q(shot.imagePrompt)}});
    ${video ? `const review=p.humanReview("review",{shots:[{intent:shot,keyframe:frame,videoProfile:"fake-video-v1",motionPrompt:${q(shot.videoPrompt)},seconds:6}]});
    return p.video("take",{intent:shot,profile:"fake-video-v1",firstFrame:p.approvedImage(frame,review),prompt:${q(shot.videoPrompt)},seconds:6});` : 'return frame;'}
  });`;
}
async function install(f, video = false) {
  f.service.authorize(f.project.id, f.human, [{ scopeId: f.shot.id, kind: 'image' }, ...(video ? [{ scopeId: f.shot.id, kind: 'video' }] : [])], 'initial', 'initial_slot');
  const prepared = await f.service.prepare(f.project.id, f.actor, { variant: 'plan', expectedHeadVersion: f.project.headVersion, source: source(f.project, video) });
  const receipt = f.service.apply(f.project.id, f.actor, prepared.id);
  f.project = f.store.getProject(f.project.id);
  return { prepared, receipt };
}
const code = expected => error => error.code === expected;

test('project, requests and revisions are durable; duplicate message keys cannot change content', async t => {
  const f = await withShot(t);
  assert.equal(f.project.maxFrames, 10800);
  assert.equal(f.store.list('project_revision', f.project.id).length, 2);
  const one = f.service.beginRequest(f.project.id, 'human', 'Question', { editing: false, key: 'same' });
  assert.deepEqual(f.service.beginRequest(f.project.id, 'human', 'Question', { editing: false, key: 'same' }), one);
  assert.throws(() => f.service.beginRequest(f.project.id, 'human', 'Changed', { key: 'same' }), code('IDEMPOTENCY_CONFLICT'));
});

test('strict workflow schema rejects forged authority and stale prompt edits', async t => {
  const f = await withShot(t);
  await assert.rejects(f.service.prepare(f.project.id, f.actor, { variant: 'project', expectedHeadVersion: f.project.headVersion, creative: { brief: 'hi' }, actor: 'human' }), code('VALIDATION_ERROR'));
  await assert.rejects(f.service.prepare(f.project.id, f.actor, { variant: 'workflow', expectedHeadVersion: f.project.headVersion, stages: [{stageId: 'intake', scopeId: f.project.id, reason: 'pretend intake'}], creative: { updateShots: [{ id: f.shot.id, framing: 'Wide' }] } }), code('STALE_PROMPT_INTENT'));
});

test('missing human slots fail without candidates, attempts, or provider calls', async t => {
  const f = await withShot(t);
  await assert.rejects(f.service.prepare(f.project.id, f.actor, { variant: 'plan', expectedHeadVersion: f.project.headVersion, source: source(f.project) }), code('ORIGIN_NOT_AUTHORIZED'));
  assert.equal(f.store.list('candidate', f.project.id).length, 0);
  assert.equal(f.provider.acceptedCount(), 0);
});

test('concurrent preparation and apply replay preserve service identities and exactly one candidate', async t => {
  const f = await withShot(t);
  f.service.authorize(f.project.id, f.human, [{ scopeId: f.shot.id, kind: 'image' }], 'slot');
  const proposal = { variant: 'plan', expectedHeadVersion: f.project.headVersion, source: source(f.project) };
  const [a,b] = await Promise.all([f.service.prepare(f.project.id, f.actor, proposal), f.service.prepare(f.project.id, f.actor, proposal)]);
  assert.equal(a.id, b.id); assert.deepEqual(a.logicalIds, b.logicalIds);
  const receipt = f.service.apply(f.project.id, f.actor, a.id);
  assert.deepEqual(f.service.apply(f.project.id, f.actor, a.id), receipt);
  assert.equal(f.store.list('candidate', f.project.id).length, 1);
});

test('new human edit fences old actor before prepare, commit and replay', async t => {
  const f = await withShot(t);
  const { prepared } = await install(f);
  f.service.beginRequest(f.project.id, 'human', 'Change direction');
  assert.throws(() => f.service.apply(f.project.id, f.actor, prepared.id), code('EPOCH_REVOKED'));
  await assert.rejects(f.service.prepare(f.project.id, f.actor, { variant: 'project', expectedHeadVersion: f.project.headVersion, creative: { brief: 'late' } }), code('EPOCH_REVOKED'));
});

test('revocation while bounded compiler worker runs is rechecked before saving preparation', async t => {
  const f = await withShot(t);
  f.service.authorize(f.project.id, f.human, [{ scopeId: f.shot.id, kind: 'image' }], 'slot');
  const pending = f.service.prepare(f.project.id, f.actor, { variant: 'plan', expectedHeadVersion: f.project.headVersion, source: source(f.project) });
  f.service.beginRequest(f.project.id, 'human', 'Stop this request');
  await assert.rejects(pending, code('EPOCH_REVOKED'));
  assert.equal(f.store.list('candidate', f.project.id).length, 0);
});

test('read-only bridge can inspect but cannot acquire mutation authority or approve', async t => {
  const f = await withShot(t);
  const human = f.service.beginRequest(f.project.id, 'human', 'What is ready?', { editing: false });
  const bridge = f.service.openEpoch(f.project.id, human);
  assert.equal(f.service.readContext(f.project.id, bridge.actor).project.id, f.project.id);
  await assert.rejects(f.service.prepare(f.project.id, bridge.actor, { variant: 'project', expectedHeadVersion: f.project.headVersion, creative: { brief: 'modify' } }), code('ACTOR_DENIED'));
  assert.throws(() => f.service.approve(f.project.id, bridge.actor, 'snapshot', []), code('ACTOR_DENIED'));
  assert.throws(() => f.service.authorize(f.project.id, bridge.actor, [{scopeId:f.project.id,kind:'image'}], 'forged'), code('ACTOR_DENIED'));
});

test('workflow-only assessment persists gaps and keeps edit hold; repeated no-progress proposals stop', async t => {
  const f = await withShot(t);
  for (let i = 0; i < 3; i++) {
    const prepared = await f.service.prepare(f.project.id, f.actor, { variant: 'workflow', expectedHeadVersion: f.project.headVersion, stages: [{stageId:'narration',scopeId:f.project.id,reason:`Need audio ${i}`,gaps:[{key:'audio',message:'Choose narration'}]}] });
    f.service.apply(f.project.id, f.actor, prepared.id);
  }
  assert.equal(f.store.list('stage_assessment', f.project.id).length, 3);
  assert.ok(f.store.list('hold', f.project.id).some(h => h.active));
  await assert.rejects(f.service.prepare(f.project.id, f.actor, { variant:'workflow',expectedHeadVersion:f.project.headVersion,stages:[{stageId:'narration',scopeId:f.project.id,reason:'Again'}] }), code('WAITING_USER'));
});

test('project-only semantic changes keep old execution held until that request supplies a plan', async t => {
  const f = await withShot(t);
  await install(f);
  const human = f.service.beginRequest(f.project.id, 'human', 'Change the brief', {scopeIds:[f.project.id]});
  const actor = f.service.openEpoch(f.project.id, human).actor;
  const patch = await f.service.prepare(f.project.id, actor, {variant:'project',expectedHeadVersion:f.project.headVersion,creative:{brief:'New brief'}});
  f.service.apply(f.project.id, actor, patch.id);
  await f.engine.runReady(); assert.equal(f.provider.acceptedCount(), 0);
  assert.ok(f.store.list('hold', f.project.id).some(h=>h.active && h.ownerId===human.requestId));
  const project = f.store.getProject(f.project.id);
  const plan = await f.service.prepare(f.project.id, actor, {variant:'plan',expectedHeadVersion:project.headVersion,source:source(project)});
  f.service.apply(f.project.id, actor, plan.id);
  await f.engine.runReady(); assert.equal(f.provider.acceptedCount(), 1);
});

test('a later request cannot release a previous hold without explicit human continuation', async t => {
  const f = await withShot(t);
  const newer = f.service.beginRequest(f.project.id,'human','A separate edit');
  f.service.authorize(f.project.id,newer,[{scopeId:f.shot.id,kind:'image'}],'newslot');
  const actor = f.service.openEpoch(f.project.id,newer).actor;
  const prep = await f.service.prepare(f.project.id,actor,{variant:'plan',expectedHeadVersion:f.project.headVersion,source:source(f.project)});
  f.service.apply(f.project.id,actor,prep.id);
  assert.ok(f.store.list('hold',f.project.id).some(h=>h.active&&h.ownerId===f.human.requestId));
  await f.engine.runReady(); assert.equal(f.provider.acceptedCount(),0);
  const continuation = f.service.beginRequest(f.project.id,'human','Continue original edit',{continuationRequestId:f.human.requestId});
  const follow = f.service.openEpoch(f.project.id,continuation).actor;
  const current=f.store.getProject(f.project.id);
  const resolved=await f.service.prepare(f.project.id,follow,{variant:'plan',expectedHeadVersion:current.headVersion,source:source(current)});
  f.service.apply(f.project.id,follow,resolved.id);
  await f.engine.runReady(); assert.equal(f.provider.acceptedCount(),1);
});

test('compatible stage completion does not conflict with prepared binding or creative head', async t => {
  const f = await withShot(t);
  const patch=await f.service.prepare(f.project.id,f.actor,{variant:'project',expectedHeadVersion:f.project.headVersion,creative:{brief:'An updated commercial'}});
  const stage=f.store.list('stage',f.project.id)[0];
  const oldHead=f.project.headVersion;
  f.service.recordProgress(f.project.id,stage,'fixture-evidence');
  assert.equal(f.store.getProject(f.project.id).headVersion,oldHead);
  const receipt=f.service.apply(f.project.id,f.actor,patch.id);
  assert.equal(receipt.headVersion,oldHead+1);
  assert.equal(f.store.get('stage',stage.id).progressVersion,1);
});

test('shot-scoped request cannot modify global brief by proposing intake', async t => {
  const f=await withShot(t);
  const human=f.service.beginRequest(f.project.id,'human','Only this shot',{scopeIds:[f.shot.id]});
  const actor=f.service.openEpoch(f.project.id,human).actor;
  await assert.rejects(f.service.prepare(f.project.id,actor,{variant:'workflow',expectedHeadVersion:f.project.headVersion,stages:[{stageId:'intake',scopeId:f.shot.id,reason:'mislabel'}],creative:{brief:'Global rewrite'}}),code('SCOPE_DENIED'));
});

test('unused grants from another human request cannot authorize new work', async t => {
  const f=await withShot(t);
  f.service.authorize(f.project.id,f.human,[{scopeId:f.shot.id,kind:'image'}],'unrelated');
  const human=f.service.beginRequest(f.project.id,'human','Different edit');
  const actor=f.service.openEpoch(f.project.id,human).actor;
  await assert.rejects(f.service.prepare(f.project.id,actor,{variant:'plan',expectedHeadVersion:f.project.headVersion,source:source(f.project)}),code('ORIGIN_NOT_AUTHORIZED'));
});

test('same-input extra take requires a new user-change grant and renews only the requested candidate', async t => {
  const f=await withShot(t);
  await install(f,true);
  const take=f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='video');
  const frame=f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='image');
  f.service.authorize(f.project.id,f.human,[{scopeId:f.shot.id,kind:'video'}],'wrongorigin','initial_slot');
  const proposal={variant:'plan',expectedHeadVersion:f.project.headVersion,source:source(f.project,true),requestNewTakes:[take.id]};
  await assert.rejects(f.service.prepare(f.project.id,f.actor,proposal),code('ORIGIN_NOT_AUTHORIZED'));
  f.service.authorize(f.project.id,f.human,[{scopeId:f.shot.id,kind:'video'}],'newtake','user_change');
  const prep=await f.service.prepare(f.project.id,f.actor,proposal);
  f.service.apply(f.project.id,f.actor,prep.id);
  assert.notEqual(f.store.get('node_binding',take.id).candidateId,take.candidateId);
  assert.equal(f.store.get('node_binding',frame.id).candidateId,frame.candidateId);
});

test('restart constructor changes cannot change the project compilation capability lock', async t => {
  const f=await withShot(t);
  const changed=new ProductionService(f.store,f.engine,DEFAULT_PROFILES.map(p=>({...p,revision:'999',maxFrames:120})));
  f.service.authorize(f.project.id,f.human,[{scopeId:f.shot.id,kind:'image'},{scopeId:f.shot.id,kind:'video'}],'slots');
  const prep=await changed.prepare(f.project.id,f.actor,{variant:'plan',expectedHeadVersion:f.project.headVersion,source:source(f.project,true)});
  assert.equal(prep.compiled.nodes.find(n=>n.kind==='video').args.profileRevision,'1');
});

test('readiness distinguishes notes, script, and accepted audio without model stage claims', t=>{
  const f=setup(t), p=f.project;
  assert.equal(workflowReadiness(p).narration.inputState,'missing');
  p.brief='Notes'; assert.equal(workflowReadiness(p).narration.inputState,'notes_only');
  p.narration.script='A finished script'; assert.equal(workflowReadiness(p).narration.inputState,'script_without_accepted_audio');
  p.cues=[{id:newId(),meaning:'hello',durationFrames:180,placementFrames:0,audio:{artifactId:newId(),sha256:'a'.repeat(64),kind:'audio'},accepted:true,measured:true}];
  assert.equal(workflowReadiness(p).narration.inputState,'accepted_audio');
});

test('negative, conditional, quoted and unscoped review replies cannot approve', async t => {
  const f=await withShot(t); await install(f,true);
  await f.engine.runReady(); await f.engine.reconcile();
  const snapshot=f.engine.reviewSnapshot(f.project.id);
  const human=f.service.beginRequest(f.project.id,'human','Review response',{editing:false});
  for (const text of ['do not approve','approve if it looks good','"approve"','maybe','yes, except shot 1','approve then change it'])
    assert.equal(f.service.replyToReview(f.project.id,human,snapshot.id,text).status,'needs_clarification');
  assert.equal(f.store.list('approval',f.project.id).length,0);
  assert.throws(()=>f.service.replyToReview(f.project.id,human,'missing','approve'),code('NOT_FOUND'));
  const first=f.service.replyToReview(f.project.id,human,snapshot.id,'approve');
  assert.equal(first.status,'approved');
  assert.deepEqual(f.service.replyToReview(f.project.id,human,snapshot.id,'approve'),first);
  assert.equal(f.store.list('approval',f.project.id).length,1);
});

test('a superseded human request cannot mint a fresh director bridge', async t => {
  const f=await withShot(t);
  f.service.beginRequest(f.project.id,'human','Replace old request');
  assert.throws(()=>f.service.openEpoch(f.project.id,f.human),code('ACTOR_DENIED'));
});
