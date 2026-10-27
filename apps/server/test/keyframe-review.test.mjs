import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { createApp } from '../dist/app.js';
import { projectFixture } from './execution-fixture.mjs';
import { keyframeBatchTerminal, reviewEligible } from '../dist/application/keyframe-review.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { GenerationOverviewReader } from '../dist/generation-overview.js';
import { directorProposals, proposalCommand } from '../dist/application/director-proposals.js';
import { seedLastFerry, lastFerryRows } from '../../../scripts/fixtures/last-ferry.mjs';
import { NarrationService } from '../dist/narration/service.js';
import { LocalMediaService } from '../dist/media/index.js';
import { ToolBridge } from '@openslate/director';
function writable(path) { chmodSync(path,0o700);for(const e of readdirSync(path,{withFileTypes:true}))if(e.isDirectory())writable(join(path,e.name)); }
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'openslate-frame-review-')), store=new Store(join(root,'state.sqlite')), provider=new FakeProvider(join(root,'fake.sqlite'));
 const engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),service=new ProductionService(store,engine);
 let project=service.createProject('Review');const shape=projectFixture(project.id,3);
 project=store.saveProject({...project,...shape,capabilityLockId:project.capabilityLockId,scenes:[shape.scenes[0]],shots:shape.shots.map(s=>({...s,sceneId:'scene-0',narration:{mode:'none',text:'',voice:'stock'}}))},0);
 store.insert('project_revision',project.revisionId,project.id,{project});
 const config={repositoryRoot:fileURLToPath(new URL('../../../',import.meta.url)),dataDirectory:root,endpoint:'http://127.0.0.1:3190'};
 const director=new LocalDirectorController(service,config), token='fixture-keyframe-review-auth-token';
 const app=createApp({service,director,runtimeSettings:director,localToken:token});
 const http=(method,path='',payload,key=randomUUID())=>app.inject({method,url:`/api/projects/${project.id}${path}`,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,...(key?{'idempotency-key':key}:{})},...(payload?{payload}:{})});
 const press=async(kind='image',extra={})=>{const view=(await http('GET','/scenes/scene-0/generation')).json();return http('POST','/scenes/scene-0/generate',{kind,headVersion:view.headVersion,revisionId:view.revisionId,reviewedHoldDigest:view.reviewedHoldDigest,reviewedControlAuthorityId:view.reviewedControlAuthorityId,reviewedFrames:kind==='video'?view.rows.filter(r=>!r.videoComplete).map(r=>({shotId:r.shotId,artifactId:r.image.artifactId,sha256:r.image.sha256})):[],...extra});};
 const finish=async()=>{for(let i=0;i<6;i++){await engine.runReady();await engine.reconcile();}};
 t.after(async()=>{await director.close();await app.close();store.close();provider.close();writable(root);rmSync(root,{recursive:true,force:true});});
 return {root,store,provider,engine,service,project,director,config,app,http,press,finish};
}
test('terminal batch decision waits on unknown, queued and automatic retries; settings and busy suppress it',()=>{
 const batch={imageNodes:[{nodeId:'i',candidateId:'c'}]},binding={id:'i',state:'active',candidateId:'c',outputs:{}};
 assert.equal(keyframeBatchTerminal(batch,[binding],[],()=>1),false);
 for(const phase of ['submission_unknown','preparing','remote_pending','ingesting','submitting'])assert.equal(keyframeBatchTerminal(batch,[binding],[{nodeId:'i',candidateId:'c',phase}],()=>1),false);
 const failed={nodeId:'i',candidateId:'c',phase:'failed',ordinal:1,failure:{technical:true,retryAllowed:true}};
 assert.equal(keyframeBatchTerminal(batch,[binding],[failed],()=>1),false);
 assert.equal(keyframeBatchTerminal(batch,[binding],[{...failed,ordinal:2}],()=>1),true);
 assert.equal(keyframeBatchTerminal(batch,[{...binding,outputs:{image:{}}}],[],()=>1),true);
 const input={enabled:true,paused:false,busy:false,terminal:true,reviewed:false};assert.equal(reviewEligible(input),true);
 for(const change of [{enabled:false},{paused:true},{busy:true},{terminal:false},{reviewed:true}])assert.equal(reviewEligible({...input,...change}),false);
});
test('terminal fake press queues one read-only app review, writes two honest notes and a held proposal, and survives restart',async t=>{
 const f=fixture(t), press=await f.press();assert.equal(press.statusCode,200,press.body);
 const action=f.store.get('scene_generation_action',press.json().requestId);assert.equal(action.imageNodes.length,3);
 f.director.tick();assert.equal(f.store.list('director_turn',f.project.id).length,0);
 await f.finish();f.director.tick();await f.director.settle();
 const snapshot=f.service.snapshot(f.project.id);assert.equal(snapshot.turns.length,1);assert.equal(snapshot.turns[0].state,'completed');
 assert.deepEqual(snapshot.turns[0].effects,{notesCreated:2,proposalsHeld:1,changesApplied:0,generation:[]});
 const turn=f.store.list('director_turn',f.project.id)[0], request=f.store.get('message',turn.requestId);
 assert.equal(request.source,'app');assert.equal(request.editing,false);assert.deepEqual(request.scopeIds,f.project.shots.map(s=>s.id));
 assert.equal(f.store.get('epoch',turn.epochId).state,'revoked');assert.equal(f.store.list('hold',f.project.id).filter(h=>h.ownerId===request.id).length,0);
 assert.equal(snapshot.conversation.filter(e=>e.role==='user').length,0);assert.equal(snapshot.conversation[0].runtime,'scripted');assert.match(snapshot.conversation[0].text,/two notes are saved.*Open the notes to choose your next step/);assert.doesNotMatch(snapshot.conversation[0].text,/No picture|not visually|cannot|can\'t/);
 assert.deepEqual(snapshot.notes.map(n=>n.letter),['a','b']);assert.equal(directorProposals(f.service,f.project.id).proposals.length,1);
 const count=f.provider.acceptedCount();assert.equal(count,3);f.director.tick();await f.director.settle();assert.equal(f.store.list('director_turn',f.project.id).length,1);
 const restarted=new LocalDirectorController(f.service,f.config);restarted.tick();await restarted.settle();await restarted.close();assert.equal(f.store.list('director_turn',f.project.id).length,1);assert.equal(f.provider.acceptedCount(),count);
 const proposal=directorProposals(f.service,f.project.id).proposals[0];proposalCommand(f.service,f.project.id,proposal.proposalId,'accept','accept',proposal.previewDigest);
 assert.equal(f.store.getProject(f.project.id).shots.at(-1).desiredFrames,240);
});
test('settings route defaults on, is keyed and versioned, and preserves Director epochs and holds',async t=>{
 const f=fixture(t);assert.deepEqual((await f.http('GET','/settings/director-review')).json(),{enabled:true});
 const actor=f.service.beginRequest(f.project.id,'local-user','Discuss',{editing:false}),bridge=f.service.openEpoch(f.project.id,actor),holds=f.store.list('hold',f.project.id);
 const input={enabled:false,expectedHeadVersion:f.store.getProject(f.project.id).headVersion};
 assert.equal((await f.http('POST','/settings/director-review',input,null)).json().error.code,'IDEMPOTENCY_KEY_REQUIRED');
 assert.equal((await f.http('POST','/settings/director-review',{...input,expectedHeadVersion:999})).json().error.code,'REVISION_CONFLICT');
 assert.deepEqual((await f.http('POST','/settings/director-review',input,'setting')).json(),{enabled:false});
 assert.deepEqual((await f.http('POST','/settings/director-review',input,'setting')).json(),{enabled:false});
 assert.equal((await f.http('POST','/settings/director-review',{...input,enabled:true},'setting')).json().error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal(f.store.get('epoch',bridge.actor.epochId).state,'read_only');assert.deepEqual(f.store.list('hold',f.project.id),holds);
 assert.equal(f.service.snapshot(f.project.id).conversation.length,1);
 const press=await f.press();assert.equal(press.statusCode,200,press.body);await f.finish();f.director.tick();await f.director.settle();assert.equal(f.store.list('keyframe_review_batch',f.project.id).length,0);
 assert.equal((await f.http('POST','/settings/director-review',{enabled:true,expectedHeadVersion:f.store.getProject(f.project.id).headVersion})).statusCode,200);
 f.director.tick();await f.director.settle();assert.equal(f.store.list('keyframe_review_batch',f.project.id).length,1);
});
test('a queued user turn delays automatic review until idle',async t=>{
 const f=fixture(t);assert.equal((await f.press()).statusCode,200);await f.finish();
 const actor=f.service.beginRequest(f.project.id,'local-user','Discuss the film',{editing:false});f.director.enqueue(f.project.id,actor);
 f.director.tick();await f.director.settle();assert.equal(f.store.list('keyframe_review_batch',f.project.id).length,0);
 f.director.tick();await f.director.settle();assert.equal(f.store.list('keyframe_review_batch',f.project.id).length,1);
});
test('active review is ignored by generation busy checks, cannot mutate or buy media, and yields to a user message',async t=>{
 const f=fixture(t);assert.equal((await f.press()).statusCode,200);await f.finish();
 let input,release,started;const ready=new Promise(r=>started=r),barrier=new Promise(r=>release=r);
 f.director.fake.runtime.start=async value=>{input=value;started();await barrier;return {...value,status:'completed',text:'',dispatched:true};};
 f.director.tick();await ready;
 const actor=f.service.actorForBridge(f.project.id,input.bridge.credential),tools=new ToolInvocationService(f.service),before=f.store.getProject(f.project.id);
 for(const [tool,args] of [['prepare_change',{variant:'project',expectedHeadVersion:before.headVersion,creative:{brief:'No'}}],['pause',{}],['prepare_narration_speech',{}]])await assert.rejects(tools.invoke(f.project.id,actor,randomUUID(),tool,args),{code:'ACTOR_DENIED'});
 const view=(await f.http('GET','/scenes/scene-0/generation')).json();assert.equal(view.busy,false);
 assert.ok(!(new GenerationOverviewReader(f.service).read(f.project.id).scenes[0].blockers.some(b=>b.code==='director_working')));
 const video=await f.press('video');assert.equal(video.statusCode,200,video.body);
 const next=f.service.beginRequest(f.project.id,'local-user','A new discuss-only message',{editing:false});assert.equal(f.store.get('message',input.requestId).state,'superseded');assert.equal(f.store.get('epoch',actor.epochId).state,'revoked');
 release();await f.director.settle();assert.equal(f.store.list('director_turn',f.project.id)[0].state,'interrupted');assert.equal(f.store.list('tool_invocation',f.project.id).length,0);
});
test('Last Ferry seed matches eight shots, saved Scene 1, unopened Scene 2 frames and measured long narration, untouched Scene 3',async t=>{
 const f=fixture(t);mkdirSync(join(f.root,'uploads'),{recursive:true});
 const media=new LocalMediaService({rootDir:join(f.root,'media'),allowedInputRoots:[join(f.root,'uploads')],ffmpegPath:process.env.OPENSLATE_FFMPEG_PATH,ffprobePath:process.env.OPENSLATE_FFPROBE_PATH}),narration=new NarrationService(f.service,media);
 const project=await seedLastFerry(f.service,narration,f.director,f.root),overview=new GenerationOverviewReader(f.service,narration).read(project.id),snapshot=f.service.snapshot(project.id);
 assert.equal(project.shots.length,8);assert.equal(project.scenes.length,3);assert.equal(project.shots.reduce((n,s)=>n+s.desiredFrames,0)/30,48);
 assert.deepEqual(overview.scenes.map(s=>s.state),['video_saved','keyframes_back','not_started']);
 for(const row of lastFerryRows){const shot=overview.shots[`shot-${row.id.replace('.','-')}`];assert.equal(shot.imagePrompt,row.prompt);assert.equal(shot.durationFrames,row.seconds*30);assert.equal(shot.keyframe.opened,row.opened);}
 assert.equal(overview.shots['shot-2-3'].narration.measuredSeconds,7.4);assert.equal(overview.shots['shot-2-3'].narration.fits,false);assert.equal(overview.shots['shot-1-2'].narration.measuredSeconds,2.1);
 assert.deepEqual(snapshot.notes.map(n=>n.letter),['a','b']);assert.ok(snapshot.notes.every(n=>!n.seenKeyframe));assert.match(snapshot.notes[0].text,/Scripted demo note: compare this frame with the saved brief/);assert.doesNotMatch(snapshot.notes[0].text,/has not seen|not visually|cannot|can\'t/);
 assert.equal(directorProposals(f.service,project.id).proposals[0].preview.filmSecondsAfter,50);
 assert.equal(snapshot.conversation.filter(e=>e.role==='user').length,0);
});

test('HTTP structured answers may omit free text and preserve option identity in next Director context',async t=>{
 const f=fixture(t);let calls=0,input;
 f.director.fake.runtime.start=async(value,{onEvent})=>{input=value;if(++calls===1)await onEvent({...value,kind:'pending_input',nativeRequestId:'tone',questions:[{id:'tone',header:'Tone',question:'Choose tone',options:[{label:'Cool',description:'Blue morning'}]}]});return {...value,status:'completed',text:'',dispatched:true};};
 assert.equal((await f.http('POST','/messages',{text:'Discuss the film',editing:false})).statusCode,200);await f.director.settle();
 const question=f.store.list('director_question',f.project.id)[0];
 const answer=await f.http('POST','/messages',{replyToQuestionId:question.id,answers:[{questionId:'tone',optionIndex:0}]});assert.equal(answer.statusCode,200,answer.body);await f.director.settle();
 assert.match(input.context,/"optionIndex":0/);assert.equal(f.store.get('director_question',question.id).answers[0].optionLabel,'Cool');
 assert.equal((await f.http('POST','/messages',{answers:[{questionId:'tone',optionIndex:0}]})).statusCode,400);
});

test('scene confirmation proceeds during a read-only frame review after exact frames were opened',async t=>{
 const f=fixture(t);assert.equal((await f.press()).statusCode,200);await f.finish();
 let release,started;const ready=new Promise(r=>started=r),barrier=new Promise(r=>release=r);
 f.director.fake.runtime.start=async input=>{started();await barrier;return {...input,status:'completed',text:'',dispatched:true};};
 f.director.tick();await ready;
 const view=(await f.http('GET','/scenes/scene-0/generation')).json(),frames=view.rows.map(r=>({shotId:r.shotId,artifactId:r.image.artifactId,sha256:r.image.sha256}));
 for(const {shotId,...frame} of frames)assert.equal((await f.http('POST',`/shots/${shotId}/frame-views`,frame)).statusCode,200);
 const overview=(await f.http('GET','/generation')).json();
 const confirm=await f.http('POST','/scenes/scene-0/confirm',{confirmationDigest:overview.scenes[0].confirmationDigest,reviewedFrames:frames});
 release();await f.director.settle();assert.equal(confirm.statusCode,200,confirm.body);assert.equal(confirm.json().state,'running');
});

test('historical presses without candidate pins do not trigger a retrospective review',async t=>{
 const f=fixture(t);
 f.store.insert('scene_generation_action','historical',f.project.id,{requestId:'historical',sceneId:'scene-0',kind:'image',shotIds:['shot-0']});
 f.director.tick();await f.director.settle();assert.equal(f.store.list('director_turn',f.project.id).length,0);
 assert.equal((await f.press()).statusCode,200);await f.finish();f.director.tick();await f.director.settle();assert.equal(f.store.list('keyframe_review_batch',f.project.id).length,1);
});

// LIVE-3 sent two notes with singular anchor.shotId. Text and media identities are synthetic.
const reviewNotes = () => ({ notes: [0, 1].map(i => ({ anchor: { shotId: `shot-${i}` }, kind: 'observation', blocking: false,
 text: '[redacted observation]', choices: [{ kind: 'accept', label: 'Keep' }, { kind: 'reply' }] })) });
test('LIVE-3 refused notes have a precise durable app warning independent of Director prose',async t=>{
 const f=fixture(t);assert.equal((await f.press()).statusCode,200);await f.finish();
 f.director.fake.runtime.start=async input=>{
  const actor=f.service.actorForBridge(f.project.id,input.bridge.credential),tools=new ToolInvocationService(f.service);
  await assert.rejects(tools.invoke(f.project.id,actor,'live-shape','record_notes',reviewNotes()),error=>
   error.code==='VALIDATION_ERROR'&&/\/notes\/0\/anchor.*sceneId or shotIds/.test(error.message));
  return {...input,status:'completed',text:'The review is finished.',dispatched:true};
 };
 f.director.tick();await f.director.settle();const snapshot=f.service.snapshot(f.project.id);
 assert.equal(snapshot.turns[0].state,'completed');assert.equal(snapshot.notes.length,0);
 assert.deepEqual(snapshot.turns[0].notesSaveFailure,{code:'VALIDATION_ERROR',reason:'invalid_anchor'});
 assert.equal(snapshot.toolCalls.filter(c=>c.tool==='record_notes'&&c.state==='failed').length,1);
 assert.doesNotMatch(JSON.stringify(snapshot.turns),/redacted observation|shotId|Keep/);
 const restarted=new LocalDirectorController(f.service,f.config);restarted.tick();await restarted.settle();await restarted.close();
 assert.deepEqual(f.service.snapshot(f.project.id).turns[0].notesSaveFailure,snapshot.turns[0].notesSaveFailure);
 assert.equal(f.provider.acceptedCount(),3,'the review cannot start more media');
});
test('fake review corrects LIVE-3 anchors within the same read-only turn and clears its warning',async t=>{
 const f=fixture(t);assert.equal((await f.press()).statusCode,200);await f.finish();
 const endpoint=await f.app.listen({port:0,host:'127.0.0.1'});
 f.director.fake.runtime.start=async input=>{
  const guide=JSON.parse(input.context).filmPlanning.notes;
  assert.deepEqual(guide.example.notes[0].anchor,{shotIds:['shot-0']});
  assert.match(guide.validation,/new call|new.*identity/i);
  const actor=f.service.actorForBridge(f.project.id,input.bridge.credential),tools=new ToolInvocationService(f.service);
  assert.equal(f.store.get('epoch',actor.epochId).state,'read_only');
  const bridge=new ToolBridge({endpoint,projectId:f.project.id,credential:input.bridge.credential,toolContractVersion:'5.0.0'});
  const wrong=reviewNotes(),refused=await bridge.call('record_notes',wrong);
  assert.equal(refused.isError,true);assert.equal(refused.value.error.code,'VALIDATION_ERROR');
  assert.match(refused.value.error.message,/\/notes\/0\/anchor.*sceneId or shotIds/);
  assert.deepEqual(f.service.snapshot(f.project.id).turns[0].notesSaveFailure,{code:'VALIDATION_ERROR',reason:'invalid_anchor'});
  const fixed={notes:wrong.notes.map(n=>({...n,anchor:{shotIds:[n.anchor.shotId]}}))};
  await assert.rejects(tools.invoke(f.project.id,actor,refused.callId,'record_notes',fixed),{code:'IDEMPOTENCY_CONFLICT'});
  const corrected=await bridge.call('record_notes',fixed);assert.equal(corrected.isError,false);
  assert.notEqual(corrected.callId,refused.callId);const saved=corrected.value;
  assert.deepEqual(saved.notes.map(n=>n.letter),['a','b']);
  assert.deepEqual(await tools.invoke(f.project.id,actor,corrected.callId,'record_notes',fixed),saved);
  // An old refused-call replay must not replace the newer successful outcome.
  await assert.rejects(tools.invoke(f.project.id,actor,refused.callId,'record_notes',wrong),{code:'VALIDATION_ERROR'});
  return {...input,status:'completed',text:'Saved two review notes.',dispatched:true};
 };
 const before=f.store.getProject(f.project.id);f.director.tick();await f.director.settle();const snapshot=f.service.snapshot(f.project.id);
 assert.equal(snapshot.turns[0].state,'completed');assert.equal(snapshot.notes.length,2);
 assert.equal(snapshot.turns[0].notesSaveFailure,null);assert.deepEqual(f.store.getProject(f.project.id),before);
 assert.equal(f.provider.acceptedCount(),3);assert.equal(f.store.list('director_proposal',f.project.id).length,0);
});
