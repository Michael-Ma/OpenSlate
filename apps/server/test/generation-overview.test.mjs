import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { compilePlan, applyCreativePatch, DEFAULT_PROFILES, digest } from '@openslate/core';
import { fixture } from './helpers/generation-fixture.mjs';
import { GenerationOverviewReader, sceneTitle, shotNarration } from '../dist/generation-overview.js';
import { quote } from '../dist/generation-quotes.js';
import { sourceFor, projectFixture } from './execution-fixture.mjs';
import { narrationSpeechFixture } from './narration-speech-fixture.mjs';

async function ok(response) { assert.equal(response.statusCode, 200, response.body); return response.json(); }
async function make(f, scene = 'scene-0', kind = 'image') { return ok(await f.post(await f.get(scene), kind)); }
async function edit(f, body) { return ok(await f.call('POST', '/storyboard', { expectedHeadVersion: f.store.getProject(f.project.id).headVersion, ...body })); }
function install(f, source, profiles) {
  const p = f.store.getProject(f.project.id), lock = f.store.get('capability_lock', p.capabilityLockId);
  const plan = compilePlan(source(p), { project: p, profiles: profiles ?? lock.profiles, logicalIds: {}, allocateId: randomUUID });
  const grants = Object.fromEntries(plan.nodes.filter(n => ['image','video'].includes(n.kind)).map(n => [n.id, f.engine.createGrant(p.id, n.shotId, n.kind, 'synthetic-human', 'initial_slot').id]));
  const planId = randomUUID();
  f.store.transaction(() => { f.engine.installPlan(p.id, planId, plan, grants); f.store.saveProject({ ...p, activePlanId: planId }, p.headVersion); });
  return plan;
}

test('overview rolls up three scenes, shares exact confirmation digest and command targets, and is read only', async t => {
  const f = fixture(t);
  const p = f.store.getProject(f.project.id), third = projectFixture(p.id, 3);
  f.store.saveProject({ ...p, scenes: third.scenes, shots: third.shots.map(s => ({ ...s, narration: { mode: 'none', text: '', voice: 'stock' } })) }, p.headVersion);
  await make(f, 'scene-1'); await f.finish();
  await make(f, 'scene-2'); await f.finish();
  await make(f, 'scene-2', 'video'); await f.finish();
  const cursor = f.store.cursor(p.id), before = ['message','grant','approval','review_snapshot','hold'].map(k => f.store.list(k,p.id));
  const overview = await f.overview();
  assert.deepEqual(overview.scenes.map(s => s.state), ['not_started','keyframes_back','video_saved']);
  assert.deepEqual(overview.scenes.map(s => s.counts), [
    { shots:1, keyframesReady:0, opened:0, videosReady:0 }, { shots:1, keyframesReady:1, opened:0, videosReady:0 }, { shots:1, keyframesReady:1, opened:0, videosReady:1 },
  ]);
  for (const scene of overview.scenes) {
    const legacy = await f.get(scene.sceneId);
    assert.deepEqual(scene.keyframeTargets, legacy.rows.filter(r => !r.imageComplete).map(r => r.shotId));
    assert.deepEqual(scene.videoTargets, legacy.rows.filter(r => !r.videoComplete).map(r => r.shotId));
    assert.equal(scene.confirmationDigest, legacy.confirmationDigest);
  }
  assert.equal(overview.shots['shot-2'].label, '3.1');
  assert.equal(overview.shots['shot-2'].keyframe.opened, false, 'legacy approval does not imply Opened');
  assert.equal(f.store.cursor(p.id), cursor);
  assert.deepEqual(['message','grant','approval','review_snapshot','hold'].map(k => f.store.list(k,p.id)), before);
});

test('overview caches one snapshot and inspection per cursor and returns isolated copies', async t => {
  const f = fixture(t); install(f, p => sourceFor(p));
  let snapshots = 0, inspections = 0;
  const snapshot = f.service.snapshot.bind(f.service), inspect = f.engine.inspectReview.bind(f.engine);
  f.service.snapshot = (...args) => { snapshots++; return snapshot(...args); };
  f.engine.inspectReview = (...args) => { inspections++; return inspect(...args); };
  const reader = new GenerationOverviewReader(f.service);
  const first = reader.read(f.project.id); first.scenes.length = 0;
  assert.equal(reader.read(f.project.id).scenes.length, 2);
  assert.equal(snapshots, 1); assert.equal(inspections, 1);
  f.store.appendEvent(f.project.id, 'test.unrelated', {});
  reader.read(f.project.id);
  assert.equal(snapshots, 2); assert.equal(inspections, 2);
});

test('multiple active alternatives need a take selection without breaking other scenes', async t => {
  const f = fixture(t);
  install(f, p => `definePlan({baseRevision:${JSON.stringify(p.revisionId)}},p=>{const s=p.shot("shot-0");return [p.image("a",{intent:s,profile:"fake-image-v1",prompt:${JSON.stringify(p.shots[0].imagePrompt)}}),p.image("b",{intent:s,profile:"fake-image-v1",prompt:${JSON.stringify(p.shots[0].imagePrompt)}})];});`);
  const overview = await f.overview();
  assert.equal(overview.shots['shot-0'].keyframe.state, 'choose_take');
  assert.equal(overview.scenes[0].state, 'needs_attention');
  assert.equal(overview.scenes[0].confirmationDigest, null);
  assert.equal(overview.scenes[1].state, 'not_started');
  assert.equal((await f.post({ ...(await f.overview()), sceneId:'scene-0', rows:[], reviewedHoldDigest:'0'.repeat(64), reviewedControlAuthorityId:null })).statusCode,409);
});

test('Opened is durable, independent of editing and authority, resets after regenerate; stale and keyless views fail', async t => {
  const f = fixture(t); await make(f); await f.finish();
  let overview = await f.overview(), frame = overview.shots['shot-0'].keyframe.artifact;
  const body = { artifactId: frame.artifactId, sha256: frame.sha256 }, key = randomUUID();
  const before = ['message','grant','hold','approval'].map(k => f.store.list(k,f.project.id));
  const receipt = await ok(await f.call('POST','/shots/shot-0/frame-views',body,key));
  assert.deepEqual(await ok(await f.call('POST','/shots/shot-0/frame-views',body,key)),receipt);
  assert.deepEqual(await ok(await f.call('POST','/shots/shot-0/frame-views',body)),receipt);
  assert.equal(f.store.list('frame_view',f.project.id).length,1);
  assert.deepEqual(['message','grant','hold','approval'].map(k => f.store.list(k,f.project.id)),before);
  assert.equal(new GenerationOverviewReader(f.service).read(f.project.id).shots['shot-0'].keyframe.opened,true);
  await edit(f,{kind:'shot',id:'shot-1',field:'motion',value:'Move gently'});
  assert.equal((await f.overview()).shots['shot-0'].keyframe.opened,true);
  const noKey = await f.call('POST','/shots/shot-0/frame-views',body,null);
  assert.equal(noKey.statusCode,400); assert.equal(noKey.json().error.code,'IDEMPOTENCY_KEY_REQUIRED');
  await ok(await f.post(await f.get(),'image',randomUUID(),{targetShotIds:['shot-0'],regenerate:true}));
  assert.equal((await f.overview()).shots['shot-0'].keyframe.opened,true, 'the retained current frame remains opened until replacement succeeds');
  await f.finish();
  const stale = await f.call('POST','/shots/shot-0/frame-views',body);
  assert.equal(stale.statusCode,409); assert.equal(stale.json().error.code,'FRAME_STALE');
  assert.equal((await f.overview()).shots['shot-0'].keyframe.opened,false);
  assert.deepEqual(await ok(await f.call('POST','/shots/shot-0/frame-views',body,key)),receipt,'original command replays after regeneration');
});

test('quotes use pinned image, retained video and unmade generated speech units; zero per-call prices stay unknown', () => {
  const profiles = [ ['i','image','40000'], ['v','video','500000'], ['s','speech','30000'] ].map(([id,kind,unitCostMicros]) => ({ id,kind,unitCostMicros,adapter:'fake' }));
  const lock = { profiles }, rows = [
    {imageComplete:false,videoComplete:false,videoProfileLabel:'v',narration:{mode:'generated',ready:false,recordingCurrent:false,profileId:'s'}},
    {imageComplete:true,videoComplete:false,videoProfileLabel:'v',narration:{mode:'generated',ready:false,recordingCurrent:true,profileId:'s'}},
    {imageComplete:true,videoComplete:true,narration:{mode:'generated',ready:true,recordingCurrent:true,profileId:'s'}},
  ];
  assert.deepEqual(quote(lock,rows,'makeKeyframes'),{micros:'70000',units:2,unitMicros:'0',priceUnknown:false});
  assert.equal(quote(lock,rows,'regenerateKeyframe').micros,'70000');
  assert.deepEqual(quote(lock,rows,'confirmVideo'),{micros:'1030000',units:3,unitMicros:'0',priceUnknown:false});
  assert.equal(quote(lock,rows,'voice').micros,'30000');
  assert.equal(quote({profiles:[{...profiles[0],unitCostMicros:'0'}]},rows,'makeKeyframes').priceUnknown,true);
  assert.equal(quote({profiles:[{...profiles[0],adapter:'codex-image'}]},rows,'makeKeyframes').priceUnknown,true);
  assert.equal(quote(lock,[],'confirmVideo').micros,'0');
});

test('B22: Codex keyframe quotes name the subscription, including mixed voice and missing per-call prices', () => {
  const image = { id: 'i', kind: 'image', adapter: 'codex-image', unitCostMicros: '0' };
  const speech = { id: 's', kind: 'speech', adapter: 'openai-speech', unitCostMicros: '30000' };
  const rows = [{ imageComplete: false, videoComplete: false }];
  for (const kind of ['makeKeyframes', 'regenerateKeyframe']) {
    assert.deepEqual(quote({ profiles: [image] }, rows, kind), { micros: '0', unitMicros: '0', units: 1, priceUnknown: false, subscription: 'codex' });
    const voiced = [{ ...rows[0], narration: { mode: 'generated', ready: false, recordingCurrent: false, profileId: 's' } }];
    assert.deepEqual(quote({ profiles: [image, speech] }, voiced, kind), { micros: '30000', unitMicros: '0', units: 2, priceUnknown: false, subscription: 'codex' });
    assert.deepEqual(quote({ profiles: [image] }, voiced, kind), { micros: '0', unitMicros: '0', units: 2, priceUnknown: true, subscription: 'codex' });
  }
  assert.equal(quote({ profiles: [image] }, [], 'makeKeyframes').subscription, undefined, 'no subscription work means no subscription note');
});

test('estimate mismatch rejects image, regeneration and video before grants; matching and omitted estimates remain valid', async t => {
  const f = fixture(t), view = await f.get();
  for (const extra of [{},{targetShotIds:['shot-0'],regenerate:true}]) {
    const response = await f.post(view,'image',randomUUID(),{...extra,expectedEstimateMicros:'999'});
    assert.equal(response.statusCode,409); assert.equal(response.json().error.code,'ESTIMATE_CHANGED');
    assert.equal(f.store.list('grant',f.project.id).length,0);
  }
  await ok(await f.post(view,'image',randomUUID(),{expectedEstimateMicros:(await f.overview()).scenes[0].quotes.makeKeyframes.micros}));
  await f.finish();
  const before = f.store.list('grant',f.project.id).length;
  const response = await f.post(await f.get(),'video',randomUUID(),{expectedEstimateMicros:'999'});
  assert.equal(response.statusCode,409); assert.equal(response.json().error.code,'ESTIMATE_CHANGED');
  assert.equal(f.store.list('grant',f.project.id).length,before);
  await make(f,'scene-0','video');
});

test('empty scene and explicit placeholder refuse generation without grants; authored direction clears placeholder', async t => {
  const f = fixture(t);
  const added = await edit(f,{kind:'addScene',value:'Empty scene'});
  const p = f.store.getProject(f.project.id), scene = p.scenes.at(-1).id;
  let response = await f.post(await f.get(scene));
  assert.equal(response.statusCode,409); assert.equal(response.json().error.code,'SCENE_EMPTY');
  await edit(f,{kind:'addShot',sceneId:scene});
  const shot = f.store.getProject(f.project.id).shots.at(-1);
  assert.equal(shot.promptState,'placeholder');
  assert.equal((await f.overview()).shots[shot.id].keyframe.state,'direction_required');
  response = await f.post(await f.get(scene));
  assert.equal(response.statusCode,409); assert.equal(response.json().error.code,'DIRECTION_REQUIRED');
  assert.deepEqual(response.json().error.details,{shotIds:[shot.id]});
  assert.equal(f.store.list('grant',p.id).length,0);
  await edit(f,{kind:'shot',id:shot.id,field:'imagePrompt',value:'Pending direction'});
  assert.equal(f.store.getProject(p.id).shots.at(-1).promptState,'ready','explicit metadata, not text matching');
  await make(f,scene);
});

test('technical failure exposes retries then charged exhaustion; refusal is uncharged', async t => {
  for (const rejected of [false,true]) {
    const f = fixture(t); await make(f);
    const binding = f.store.list('node_binding',f.project.id).find(b => b.node.kind==='image');
    f.provider.setMode(binding.id,rejected ? 'reject_before_accept' : ['technical_failure','technical_failure','technical_failure','technical_failure']);
    if (rejected) {
      const submit = f.provider.submit.bind(f.provider);
      f.provider.submit = async (...args) => ({ ...await submit(...args), technical:false, retryAllowed:false });
    }
    await f.engine.runReady(); if (!rejected) await f.engine.reconcile();
    let slot = (await f.overview()).shots['shot-0'].keyframe;
    assert.ok(slot.failure.code); assert.equal(slot.failure.charged,!rejected);
    assert.equal(slot.failure.technical,!rejected); assert.ok(slot.failure.at);
    if (rejected) { assert.equal(slot.state,'failed'); assert.equal(slot.failure.autoRetriesLeft,0); continue; }
    const max = f.store.get('capability_lock',f.store.getProject(f.project.id).capabilityLockId).profiles.find(p=>p.kind==='image').maxRetries;
    assert.equal(slot.failure.autoRetriesLeft,max); assert.equal(slot.state,max?'queued':'failed');
    for (let i=0;i<max;i++) { await f.engine.runReady(); await f.engine.reconcile(); }
    slot = (await f.overview()).shots['shot-0'].keyframe;
    assert.equal(slot.state,'failed'); assert.equal(slot.failure.autoRetriesLeft,0); assert.equal(slot.failure.charged,true);
  }
});

test('outdated records preserve previous keyframe and field; motion edits outdate video only', async t => {
  const f = fixture(t); await make(f); await f.finish(); await make(f,'scene-0','video'); await f.finish();
  const ready = (await f.overview()).shots['shot-0'];
  await edit(f,{kind:'shot',id:'shot-0',field:'motion',value:'Pan left'});
  let shot = (await f.overview()).shots['shot-0'];
  assert.equal(shot.keyframe.state,'ready'); assert.equal(shot.video.state,'outdated');
  assert.deepEqual(shot.video.previous,ready.video.artifact); assert.deepEqual(shot.video.outdatedFields,['motion']);
  await edit(f,{kind:'shot',id:'shot-0',field:'imagePrompt',value:'A new picture'});
  shot = (await f.overview()).shots['shot-0'];
  assert.equal(shot.keyframe.state,'outdated'); assert.deepEqual(shot.keyframe.previous,ready.keyframe.artifact); assert.deepEqual(shot.keyframe.outdatedFields,['imagePrompt']);
  assert.deepEqual(shot.video.outdatedFields,['motion','imagePrompt']);
  const current=f.store.getProject(f.project.id), compiled=f.store.get('plan',current.activePlanId).compiled, planId=randomUUID();
  f.store.transaction(()=>{ f.engine.installPlan(current.id,planId,compiled); f.store.saveProject({...current,activePlanId:planId},current.headVersion); });
  assert.deepEqual((await f.overview()).shots['shot-0'].keyframe.outdatedFields,['imagePrompt'], 'republishing a plan preserves outdated reasons');
  await make(f); await f.finish();
  const latest = (await f.overview()).shots['shot-0'].keyframe.artifact;
  await edit(f,{kind:'shot',id:'shot-0',field:'imagePrompt',value:'Another picture'});
  assert.deepEqual((await f.overview()).shots['shot-0'].keyframe.previous, latest, 'the latest take replaces old outdated metadata');
});

test('held and stopped candidates are queued; waits write once, clear on admission, and running exposes phase/time', async t => {
  const f = fixture(t); await make(f);
  const binding = f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='image');
  const hold = f.engine.setHold(f.project.id,{scopeId:'shot-0',ownerId:'synthetic-human'});
  await f.engine.runReady();
  let slot = (await f.overview()).shots['shot-0'].keyframe;
  assert.equal(slot.state,'queued'); assert.equal(slot.waiting.code,'edit_pending');
  assert.equal((await f.get()).rows[0].imagePending,true,'held candidates stay pending in the legacy view');
  const cursor = f.store.cursor(f.project.id), wait = f.store.get('node_wait',binding.id);
  await f.engine.runReady(); assert.equal(f.store.cursor(f.project.id),cursor); assert.deepEqual(f.store.get('node_wait',binding.id),wait);
  f.engine.setPaused(f.project.id,true,'synthetic-human'); await f.engine.runReady();
  slot = (await f.overview()).shots['shot-0'].keyframe; assert.equal(slot.waiting.code,'stopped');
  assert.equal((await f.overview()).controlAuthorityId,'synthetic-human'); assert.ok((await f.overview()).stopped.at);
  f.engine.setPaused(f.project.id,false,'synthetic-human'); f.engine.releaseHold(f.project.id,hold.id,'synthetic-human');
  f.provider.setMode(binding.id,'pending'); await f.engine.runReady();
  assert.equal(f.store.get('node_wait',binding.id),undefined);
  slot = (await f.overview()).shots['shot-0'].keyframe;
  assert.equal(slot.state,'running'); assert.equal(slot.phase,'remote_pending'); assert.ok(slot.startedAt); assert.ok(slot.attemptId);
});

test('capacity waiting counts actual jobs ahead and restart casualties require pre-start no-answer attempts', async t => {
  const f = fixture(t,{sharedScene:true}); await make(f);
  const bindings = f.store.list('node_binding',f.project.id).filter(b=>b.node.kind==='image');
  // Use the lock's actual capacity, with enough alternatives in one scene to queue.
  const lock = f.store.get('capability_lock',f.store.getProject(f.project.id).capabilityLockId);
  assert.equal(lock.profiles.find(p=>p.kind==='image').maxConcurrency,2);
  for (const b of bindings) f.provider.setMode(b.id,'pending');
  await f.engine.runReady();
  // Both active jobs occupy the model; add a third scene's keyframe candidate.
  await make(f,'scene-2');
  const third = f.store.list('node_binding',f.project.id).find(b=>b.node.shotId==='shot-2' && b.node.kind==='image');
  await f.engine.runReady();
  const slot = (await f.overview()).shots['shot-2'].keyframe;
  assert.equal(slot.state,'queued'); assert.equal(slot.waiting.code,'capacity'); assert.equal(slot.waiting.ahead,2);
  const attempt = f.engine.attempts(f.project.id)[0];
  f.store.put('attempt',attempt.id,f.project.id,{...attempt,phase:'submission_unknown',createdAt:'2000-01-01T00:00:00.000Z'});
  f.store.appendEvent(f.project.id,'test.unknown',{});
  const overview = await f.overview();
  assert.equal(overview.shots['shot-0'].keyframe.state,'no_answer');
  assert.deepEqual(overview.restartCasualties,[attempt.id]);
});

test('narration has measured precision, text estimates, fit policies, and title fallback handles CJK', () => {
  const audio = {mode:'generated',text:'Hello 世界',ready:false,recordingCurrent:false,measuredSeconds:null,fit:null};
  assert.deepEqual(shotNarration(audio,180),{state:'text_only',text:'Hello 世界',estimatedSeconds:0.8999999999999999,fits:true});
  assert.equal(shotNarration({...audio,text:'你好世界'},30).fits,false);
  const measured = shotNarration({...audio,ready:true,measuredSeconds:7.4125,fit:'cut_to_shot',timing:{durationFrames:180}},180);
  assert.equal(measured.measuredSeconds,7.4125); assert.equal(measured.fits,true);
  assert.equal(shotNarration({...audio,ready:true,measuredSeconds:7.4125,fit:'cut_to_shot',timing:{durationFrames:223}},180).fits,false); assert.equal(measured.fit,'cut_to_shot');
  assert.equal(shotNarration({...audio,text:''},180).fits,null);
  assert.equal(sceneTitle('First sentence. Then details.'),'First sentence.');
  assert.equal(sceneTitle('第一幕。然后出发。'),'第一幕。');
});

test('Director scopes come from the active question or turn; superseded turns are idle', async t => {
  const f = fixture(t);
  const actor = f.service.beginRequest(f.project.id,'local-user','Work on scene 1',{scopeIds:['scene-0']});
  const epoch = f.service.openEpoch(f.project.id, actor);
  f.store.put('director_turn','turn',f.project.id,{requestId:actor.requestId,epochId:epoch.actor.epochId,runtimeId:'offline-test',state:'running',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),owner:null,leaseExpiresAt:0,dispatched:false,nativeThreadId:null,nativeTurnId:null,errorCode:null});
  f.store.appendEvent(f.project.id,'test.turn',{});
  let overview = await f.overview(); assert.equal(overview.director.state,'working'); assert.deepEqual(overview.director.scopeIds,['scene-0']);
  assert.ok(overview.scenes[0].blockers.some(b=>b.code==='director_working')); assert.ok(!overview.scenes[1].blockers.some(b=>b.code==='director_working'));
  f.store.put('director_question','question',f.project.id,{requestId:actor.requestId,turnId:'turn',state:'pending'}); f.store.appendEvent(f.project.id,'test.question',{});
  assert.equal((await f.overview()).director.state,'waiting_user');
  f.service.beginRequest(f.project.id,'local-user','New direction',{scopeIds:['scene-1']});
  assert.equal((await f.overview()).director.state,'idle');
});

test('Director-authored direction clears explicit placeholder and narration changes clear fit metadata', () => {
  const p = projectFixture(); p.shots[0].promptState='placeholder'; p.shots[0].narrationFit='cut_to_shot';
  const q = applyCreativePatch(p,{updateShots:[{id:'shot-0',reauthorPrompts:true,imagePrompt:'A finished direction'}]}, shot=>shot);
  assert.equal(q.shots[0].promptState,'ready'); assert.equal(p.shots[0].promptState,'placeholder');
  const changed = applyCreativePatch(q,{updateShots:[{id:'shot-0',reauthorPrompts:true,narration:{mode:'generated',text:'A changed line',voice:'stock'}}]}, shot=>shot);
  assert.equal(changed.shots[0].narrationFit,undefined);
});

test('queued review, voice and timing reasons are explicit and stable', async t => {
  const f=fixture(t); install(f,p=>sourceFor(p));
  const video=f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='video');
  await f.engine.runReady(); await f.engine.reconcile(); await f.engine.runReady();
  let row=(await f.overview()).shots['shot-0'];
  assert.equal(row.video.state,'queued'); assert.equal(row.video.waiting.code,'review');
  assert.equal((await f.overview()).scenes[0].state,'keyframes_back');
  assert.equal((await f.get()).rows[0].videoPending,false,'a human confirm is still required');
  const project=f.store.getProject(f.project.id);
  project.shots[0].narration={mode:'generated',text:'This line still needs recording',voice:'stock'}; project.shots[0].narrationPending=true;
  f.store.saveProject(project,project.headVersion);
  f.store.put('node_wait',video.id,project.id,{nodeId:video.id,code:'INPUT_PENDING',since:'2026-10-01T00:00:00Z'});
  f.store.appendEvent(project.id,'test.wait',{});
  assert.equal((await f.overview()).shots['shot-0'].video.waiting.code,'voice');
  f.store.put('node_wait',video.id,project.id,{nodeId:video.id,code:'TIMING_REQUIRED',since:'2026-10-01T00:00:00Z'});
  f.store.appendEvent(project.id,'test.wait',{});
  assert.deepEqual((await f.overview()).shots['shot-0'].video.waiting,{code:'timing',since:'2026-10-01T00:00:00Z'});
});

test('one video runs while another waits behind the exact pinned model capacity', async t => {
  const profiles=structuredClone(DEFAULT_PROFILES); profiles.find(p=>p.kind==='video').maxConcurrency=1;
  const f=fixture(t,{sharedScene:true,profiles}); await make(f); await f.finish(); await make(f,'scene-0','video');
  for (const b of f.store.list('node_binding',f.project.id).filter(b=>b.node.kind==='video')) f.provider.setMode(b.id,'pending');
  await f.engine.runReady();
  const overview=await f.overview(), slots=['shot-0','shot-1'].map(id=>overview.shots[id].video);
  assert.equal(slots.filter(s=>s.state==='running').length,1);
  assert.deepEqual(slots.find(s=>s.state==='queued').waiting.code,'capacity');
  assert.equal(slots.find(s=>s.state==='queued').waiting.ahead,1);
  assert.equal(overview.scenes[0].state,'making_video');
});

test('a fresh process groups no-answer submissions and keeps Opened without submitting anything', async t => {
  const f=fixture(t); await make(f); await f.finish();
  const frame=(await f.overview()).shots['shot-0'].keyframe.artifact;
  await ok(await f.call('POST','/shots/shot-0/frame-views',{artifactId:frame.artifactId,sha256:frame.sha256}));
  await make(f,'scene-1');
  const binding=f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='image' && b.node.shotId==='shot-1'); f.provider.setMode(binding.id,'unknown_after_accept');
  await f.engine.runReady();
  const current=await f.overview(); assert.equal(current.shots['shot-1'].keyframe.state,'no_answer'); assert.deepEqual(current.restartCasualties,[]);
  const program=`
    import { Store } from './apps/server/dist/persistence/store.js';
    import { Engine } from './apps/server/dist/execution/engine.js';
    import { ProductionService } from './apps/server/dist/application/service.js';
    import { GenerationOverviewReader } from './apps/server/dist/generation-overview.js';
    import { FakeProvider } from './packages/providers/dist/index.js';
    const [db,providerPath,artifacts,projectId]=process.argv.slice(1);
    const store=new Store(db), provider=new FakeProvider(providerPath);
    const engine=new Engine(store,provider,{artifactDir:artifacts});
    const overview=new GenerationOverviewReader(new ProductionService(store,engine)).read(projectId);
    console.log(JSON.stringify({casualties:overview.restartCasualties,opened:overview.shots['shot-0'].keyframe.opened}));
    store.close();provider.close();
  `;
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',program,f.store.path,f.provider.path,f.engine.artifactDir,f.project.id],{encoding:'utf8',timeout:15000}));
  assert.deepEqual(result.casualties,[current.shots['shot-1'].keyframe.attemptId]);
  assert.equal(result.opened,true);
  assert.equal(f.provider.acceptedCount(),2,'overview and restart detection never resubmit');
});

test('current voice attempts project making and failed without dispatching', async t => {
  const f=await narrationSpeechFixture(t,{plan:true,realSpeech:true,configuredAdmission:true});
  const segment=f.view().segments[0], project=f.store.getProject(f.project.id);
  project.shots[0].narration={mode:'generated',text:segment.script.text,voice:'stock'}; project.shots[0].narrationPending=true;
  project.revisionId=randomUUID();
  const saved=f.store.saveProject(project,project.headVersion); f.store.insert('project_revision',saved.revisionId,project.id,{project:saved});
  f.store.put('narration_shot_draft',digest({projectId:project.id,shotId:'shot-0'}),project.id,{shotId:'shot-0',segmentId:segment.entry.segmentId});
  const proposal=await f.prepare(), application=await f.review(proposal), attempt=f.admit(application);
  const reader=new GenerationOverviewReader(f.production,f.narration);
  assert.equal(reader.read(project.id).shots['shot-0'].narration.state,'making');
  f.store.put('attempt',attempt.id,project.id,{...attempt,phase:'failed',failure:{id:'TEST_SPEECH_FAILURE',technical:false,source:'offline-test',retryAllowed:false}});
  f.store.appendEvent(project.id,'test.speech_failed',{});
  assert.equal(reader.read(project.id).shots['shot-0'].narration.state,'failed');
  assert.equal(reader.read(project.id).scenes[0].state,'needs_attention');
  f.store.put('attempt',attempt.id,project.id,{...attempt,phase:'submission_unknown'});
  f.store.appendEvent(project.id,'test.speech_unknown',{});
  const unknown=reader.read(project.id);
  assert.equal(unknown.shots['shot-0'].narration.state,'no_answer');
  assert.equal(unknown.scenes[0].state,'needs_attention');
  assert.ok(unknown.scenes[0].blockers.some(b=>b.code==='no_answer_in_scene' && b.shotId==='shot-0'));
  assert.deepEqual(f.calls,{http:0,credentials:0});
});

test('input waits without pending narration never request a human review or claim an unapproved clip is being made', async t => {
  const f=fixture(t); install(f,p=>sourceFor(p));
  await f.engine.runReady(); await f.engine.reconcile(); await f.engine.runReady();
  const video=f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='video');
  f.store.put('node_wait',video.id,f.project.id,{code:'INPUT_PENDING',since:'2026-10-01T00:00:00Z'});
  f.store.appendEvent(f.project.id,'test.input_wait',{});
  const overview=await f.overview();
  assert.deepEqual(overview.shots['shot-0'].video.waiting,{code:'input_pending',since:'2026-10-01T00:00:00Z'});
  assert.equal(overview.scenes[0].state,'keyframes_back');
  assert.equal((await f.get()).rows[0].videoPending,false);
});

test('missing and unrecognized waits stay unknown even when narration is pending', async t => {
  const f=fixture(t); install(f,p=>sourceFor(p));
  const video=f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='video');
  const project=f.store.getProject(f.project.id);
  project.shots[0].narration={mode:'generated',text:'Still waiting for a voice',voice:'stock'};
  f.store.saveProject(project,project.headVersion);
  let overview=await f.overview();
  assert.equal(overview.shots['shot-0'].video.waiting.code,'unknown');
  assert.equal(overview.scenes[0].state,'not_started');
  f.store.put('node_wait',video.id,project.id,{code:'FUTURE_WAIT',since:'2026-10-01T00:00:00Z'});
  f.store.appendEvent(project.id,'test.new_wait',{});
  const cursor=f.store.cursor(project.id), attempts=f.engine.attempts(project.id).length;
  overview=await f.overview();
  assert.deepEqual(overview.shots['shot-0'].video.waiting,{code:'unknown',since:'2026-10-01T00:00:00Z'});
  assert.equal(overview.scenes[0].state,'not_started');
  assert.equal(f.store.cursor(project.id),cursor); assert.equal(f.engine.attempts(project.id).length,attempts);
});

test('only approved automatic waits count as making video; review, timing and unknown waits do not', async t => {
  const f=fixture(t); await make(f); await f.finish(); await make(f,'scene-0','video');
  const video=f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='video');
  assert.equal((await f.get()).rows[0].videoPending,true);
  for (const [code,state] of [['CAPACITY_EXCEEDED','making_video'],['INPUT_PENDING','making_video'],['HUMAN_REVIEW_REQUIRED','keyframes_back'],['TIMING_REQUIRED','keyframes_back'],['FUTURE_WAIT','keyframes_back']]) {
    f.store.put('node_wait',video.id,f.project.id,{code,since:'2026-10-01T00:00:00Z'});
    f.store.appendEvent(f.project.id,'test.wait',{code});
    assert.equal((await f.overview()).scenes[0].state,state,code);
  }
  f.engine.setPaused(f.project.id,true,'synthetic-human');
  const stopped=await f.overview();
  assert.equal(stopped.shots['shot-0'].video.waiting.code,'stopped');
  assert.equal(stopped.scenes[0].state,'keyframes_back');
});

test('retained current takes preserve their replacement waiting reason without pretending it is a review', async t => {
  const f=fixture(t); await make(f); await f.finish();
  const original=(await f.overview()).shots['shot-0'].keyframe.artifact;
  await ok(await f.post(await f.get(),'image',randomUUID(),{targetShotIds:['shot-0'],regenerate:true}));
  let slot=(await f.overview()).shots['shot-0'].keyframe;
  assert.equal(slot.state,'ready'); assert.deepEqual(slot.artifact,original);
  assert.equal(slot.replacement.waiting.code,'unknown');
  f.engine.setHold(f.project.id,{scopeId:'shot-0',ownerId:'synthetic-human'});
  await f.engine.runReady();
  slot=(await f.overview()).shots['shot-0'].keyframe;
  assert.equal(slot.replacement.waiting.code,'edit_pending');
  assert.equal(slot.replacement.state,'queued'); assert.deepEqual(slot.artifact,original);
});

test('an unanswered clip remains named and blocks a fresh scene confirmation without another submission', async t => {
  const f=fixture(t); await make(f); await f.finish();
  const frame=(await f.overview()).shots['shot-0'].keyframe.artifact;
  await ok(await f.call('POST','/shots/shot-0/frame-views',{artifactId:frame.artifactId,sha256:frame.sha256}));
  await make(f,'scene-0','video');
  const video=f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='video');
  f.provider.setMode(video.id,'unknown_after_accept'); await f.engine.runReady();
  const overview=await f.overview(), scene=overview.scenes[0];
  assert.equal(scene.state,'needs_attention');
  assert.equal(overview.shots['shot-0'].keyframe.opened,true,'the old frame remains truly opened');
  assert.ok(scene.blockers.some(b=>b.code==='no_answer_in_scene' && b.shotId==='shot-0'));
  const accepted=f.provider.acceptedCount(), attempts=f.engine.attempts(f.project.id).length;
  const refusal=await f.call('POST','/scenes/scene-0/confirm',{confirmationDigest:scene.confirmationDigest,reviewedFrames:[{shotId:'shot-0',artifactId:frame.artifactId,sha256:frame.sha256}]});
  assert.equal(refusal.statusCode,409);
  assert.equal(f.provider.acceptedCount(),accepted); assert.equal(f.engine.attempts(f.project.id).length,attempts);
});

test('a proven automatic video retry is making video even without a node wait', async t => {
  const f=fixture(t); await make(f); await f.finish(); await make(f,'scene-0','video');
  const video=f.store.list('node_binding',f.project.id).find(b=>b.node.kind==='video');
  f.provider.setMode(video.id,'technical_failure'); await f.engine.runReady(); await f.engine.reconcile();
  const overview=await f.overview(), slot=overview.shots['shot-0'].video;
  assert.equal(slot.state,'queued'); assert.ok(slot.failure.autoRetriesLeft>0); assert.equal(slot.waiting,undefined);
  assert.equal(overview.scenes[0].state,'making_video');
});

test('a retained frame exposes queued, running and unknown replacement identity until release', async t => {
  const f = fixture(t); await make(f); await f.finish();
  const original = (await f.overview()).shots['shot-0'].keyframe.artifact;
  await ok(await f.post(await f.get(), 'image', randomUUID(), { targetShotIds: ['shot-0'], regenerate: true }));
  let slot = (await f.overview()).shots['shot-0'].keyframe;
  assert.equal(slot.state, 'ready'); assert.deepEqual(slot.artifact, original);
  assert.equal(slot.replacement?.state, 'queued');
  const binding = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image' && b.node.shotId === 'shot-0');
  f.provider.setMode(binding.id, 'pending'); await f.engine.runReady();
  const attempt = f.engine.attempts(f.project.id).at(-1);
  slot = (await f.overview()).shots['shot-0'].keyframe;
  assert.deepEqual(slot.artifact, original); assert.equal(slot.replacement.state, 'running');
  assert.equal(slot.replacement.attemptId, attempt.id); assert.equal(slot.replacement.phase, attempt.phase);
  f.store.put('attempt', attempt.id, f.project.id, { ...attempt, phase: 'submission_unknown' });
  f.store.appendEvent(f.project.id, 'test.replacement_unknown', {});
  const unknown = await f.overview(); slot = unknown.shots['shot-0'].keyframe;
  assert.equal(slot.state, 'ready'); assert.equal(slot.replacement.state, 'no_answer');
  assert.equal(slot.replacement.attemptId, attempt.id);
  assert.ok(unknown.scenes[0].blockers.some(b => b.code === 'no_answer_in_scene'));
  await ok(await f.call('POST', `/attempts/${attempt.id}/release`, { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true }));
  slot = (await f.overview()).shots['shot-0'].keyframe;
  assert.deepEqual(slot.artifact, original); assert.equal(slot.replacement, undefined);
  assert.deepEqual(slot.releasedAttemptIds, [attempt.id]);
});

test('a retained frame explains a failed replacement and keeps its paid take available', async t => {
  const f = fixture(t); await make(f); await f.finish();
  const original = (await f.overview()).shots['shot-0'].keyframe.artifact;
  await ok(await f.post(await f.get(), 'image', randomUUID(), { targetShotIds: ['shot-0'], regenerate: true }));
  const binding = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image' && b.node.shotId === 'shot-0');
  const submit = f.provider.submit.bind(f.provider);
  f.provider.submit = async (...args) => ({ ...await submit(...args), technical: false, retryAllowed: false });
  f.provider.setMode(binding.id, 'reject_before_accept'); await f.engine.runReady();
  const slot = (await f.overview()).shots['shot-0'].keyframe;
  assert.equal(slot.state, 'ready'); assert.deepEqual(slot.artifact, original);
  assert.equal(slot.replacement?.state, 'failed');
  assert.equal(slot.replacement.attemptId, f.engine.attempts(f.project.id).at(-1).id);
  assert.ok(slot.replacement.failure.code); assert.equal(slot.replacement.failure.charged, false);
});

test('a Stop-fenced technical failure never advertises queued retries after Continue', async t => {
  const f = fixture(t); await make(f);
  const binding = f.store.list('node_binding', f.project.id).find(b => b.node.kind === 'image');
  f.provider.setMode(binding.id, 'pending'); await f.engine.runReady();
  const attempt = f.engine.attempts(f.project.id)[0];
  const { stopped } = await ok(await f.call('POST', '/controls', { action: 'stop' }));
  f.store.put('attempt', attempt.id, f.project.id, { ...attempt, phase: 'failed',
    failure: { id: 'SYNTHETIC_TECHNICAL_FAILURE', technical: true, source: 'offline-test', retryAllowed: true } });
  f.store.appendEvent(f.project.id, 'test.stopped_failure', {});
  await ok(await f.call('POST', '/controls', { action: 'resume', expectedAuthorityId: stopped.stopId }));
  const slot = (await f.overview()).shots['shot-0'].keyframe;
  assert.equal(slot.state, 'failed'); assert.equal(slot.failure.autoRetriesLeft, 0); assert.equal(slot.failure.retryAllowed, false);
  await f.engine.runReady(); assert.equal(f.engine.attempts(f.project.id).length, 1);
});
