import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '@openslate/core';
import { projectFixture } from './execution-fixture.mjs';
import { narrationSpeechFixture, rows, key } from './narration-speech-fixture.mjs';
import { ownedTranscriptionFixture } from './owned-transcription-fixture.mjs';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { NarrationService } from '../dist/narration/service.js';
import { OwnedTranscriptionService } from '../dist/narration/owned-transcription-service.js';
import { OpenAITranscriptionExecution } from '../dist/execution/openai-transcription-execution.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { TranscriptionAudioService } from '../dist/execution/transcription-audio-service.js';
import { TranscriptionAudioStore } from '../dist/media/transcription-audio-store.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { earlierRequestHoldIds } from '../dist/narration/request-holds.js';
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
function writable(path) { chmodSync(path,0o700); for (const item of readdirSync(path,{withFileTypes:true})) if(item.isDirectory()) writable(join(path,item.name)); }
function bind(t,f,version) {
 const root=mkdtempSync(join(tmpdir(),'openslate-audio-request-skills-'));t.after(()=>{writable(root);rmSync(root,{recursive:true,force:true});});
 const config=createDirectorSkillLock({repositoryRoot,snapshotRoot:root},'4.0.0',version.split('.')[0]), context=new DirectorContextService(f.production,config.environment);
 context.bootstrapLock(f.project.id,config.lock);context.capture(f.project.id,f.actor,{lockId:config.lock.id,selectedSkillIds:['production','plan-authoring']});return config.lock;
}
function virtualShots(f) {
 const before=f.store.getProject(f.project.id),next=projectFixture(f.project.id,3);next.capabilityLockId=before.capabilityLockId;next.revisionId=key();next.cues=[];
 for(const [index,shot] of next.shots.entries()){shot.cueId=null;shot.narration={mode:'generated',text:`Saved voice ${index+1}.`,voice:'stock'};shot.narrationPending=true;}
 const saved=f.store.saveProject(next,before.headVersion);f.store.insert('project_revision',saved.revisionId,saved.id,{id:saved.revisionId,projectId:saved.id,project:saved});
 const state=f.narration.workspaceSnapshot(saved.id);f.narration.reviseSegments(saved.id,f.human,state.state.version,key(),{remove:state.segments.map(row=>row.entry.segmentId)});
 return saved;
}
test('one speech request publishes exact saved writing once without accepting audio or writing an allowance',async t=>{
 const f=await narrationSpeechFixture(t),input=f.input(),before=f.view().segments[1];
 const result=await f.service.request(f.project.id,f.human,input);assert.equal(result.receipt.proposalId,result.proposal.id);
 assert.deepEqual(await f.service.request(f.project.id,f.human,input),result);assert.equal(rows(f,'narration_speech_application').length,1);
 assert.equal(rows(f,'external_allowance').length,0);assert.equal(rows(f,'narration_acceptance').length,0);assert.deepEqual(f.view().segments[1],before);
 assert.deepEqual(f.calls,{http:0,credentials:0});
});
test('one transcription request retains exact owned source and publishes once without adopting returned words',async t=>{
 const f=await ownedTranscriptionFixture(t),input=f.input(),before=f.narration.workspaceSnapshot(f.project.id);
 const result=await f.service.request(f.project.id,f.human,input);assert.equal(result.receipt.proposalId,result.proposal.id);
 assert.deepEqual(await f.service.request(f.project.id,f.human,input),result);
 assert.equal(f.store.list('owned_transcription_application',f.project.id).length,1);assert.equal(f.store.list('external_allowance',f.project.id).length,0);
 assert.deepEqual(f.narration.workspaceSnapshot(f.project.id),before);assert.equal(f.provider.acceptedCount(),0);
});
for (const version of ['4.0.0', '5.0.0']) for (const kind of ['speech', 'transcription']) test(`${version} ${kind} tool saves a pending suggestion and a human request alone publishes`, async t => {
 const f = kind === 'speech' ? await narrationSpeechFixture(t) : await ownedTranscriptionFixture(t);
 bind(t, f, version);
 const tools = new ToolInvocationService(f.production, kind === 'speech' ? { narrationSpeech: f.service } : { ownedTranscription: f.service });
 const { key: _key, ...input } = f.input(), name = kind === 'speech' ? 'prepare_narration_speech' : 'prepare_recording_transcription';
 const before = Object.fromEntries(['attempt','grant','reservation','candidate'].map(k => [k, rows(f,k)]));
 const result = await tools.invoke(f.project.id, f.actor, 'suggest', name, input);
 assert.equal(result.state, 'ungranted'); assert.ok(result.pendingRequestId);
 assert.deepEqual(await tools.invoke(f.project.id, f.actor, 'suggest', name, input), result);
 assert.equal(rows(f,'director_audio_request').length, 1);
 assert.deepEqual(Object.fromEntries(Object.keys(before).map(k => [k, rows(f,k)])), before);
 await assert.rejects(f.service.request(f.project.id, f.actor, f.input()), { code: 'ACTOR_DENIED' });
 const commit=kind==='speech' ? f.production.commitNarrationSpeechReview.bind(f.production) : f.production.commitOwnedTranscriptionReview.bind(f.production);
 assert.throws(()=>commit(f.project.id,f.actor,{key:key(),proposalId:result.proposalId,proposalDigest:result.proposalDigest},{requested:true,requestedAtCursor:f.store.cursor(f.project.id)}),{code:'ACTOR_DENIED'});
 const request = await f.service.request(f.project.id, f.human, f.input()); assert.ok(request.receipt.candidateId);
 assert.equal(rows(f,kind === 'speech' ? 'narration_speech_application' : 'owned_transcription_application').length, 1);
});
test('lost suggestion response reconciles the saved proposal and never publishes paid work', async t => {
 const f = await narrationSpeechFixture(t); bind(t,f,'5.0.0');
 const prepare = f.service.prepareRequest.bind(f.service); let calls = 0;
 f.service.prepareRequest = async (...args) => { calls++; await prepare(...args); throw Error('lost preparation response'); };
 const tools = new ToolInvocationService(f.production,{narrationSpeech:f.service}), {key:_key,...input}=f.input();
 await assert.rejects(tools.invoke(f.project.id,f.actor,'lost-suggestion','prepare_narration_speech',input),{code:'TOOL_CALL_UNRESOLVED'});
 f.production.beginRequest(f.project.id,f.human.principalId,'Continue from saved suggestions');
 tools.reconcileEpoch(f.project.id,f.actor.epochId);
 const reconciled=rows(f,'tool_reconciliation')[0];assert.equal(reconciled.state,'effect_confirmed');
 assert.equal(reconciled.receipt.state,'ungranted'); assert.ok(reconciled.receipt.pendingRequestId);
 assert.equal(rows(f,'narration_speech_application').length,0);assert.equal(rows(f,'attempt').length,0);assert.equal(calls,1);
});
test('v5 saved shot script suggestions materialize sections without publishing execution', async t => {
 const f=await narrationSpeechFixture(t),saved=virtualShots(f);bind(t,f,'5.0.0');const tools=new ToolInvocationService(f.production,{narrationSpeech:f.service});
 for (const [index,shot] of saved.shots.entries()) {
  const result=await tools.invoke(saved.id,f.actor,`shot-${index}`,'prepare_narration_speech',{
   expectedHeadVersion:f.store.getProject(saved.id).headVersion,segmentId:shot.id,
   segmentRevisionId:digest({shotId:shot.id,narration:shot.narration}),profileId:f.profile.id,voice:'cedar',instructions:''});
  assert.equal(result.state,'ungranted');assert.ok(result.pendingRequestId);
 }
 assert.equal(f.narration.workspaceSnapshot(saved.id).segments.length,3);
 for(const kind of ['attempt','grant','candidate','reservation','narration_speech_application']) assert.equal(rows(f,kind).length,0,kind);
 assert.equal(rows(f,'director_audio_request').length,3);
});
for(const scope of ['shot','scene','multiple_shots'])test(`human virtual materialization respects ${scope} scope and never grants unrelated narration writes`,async t=>{
 const f=await narrationSpeechFixture(t),saved=virtualShots(f),allowed=saved.shots[0];
 const scopeIds=scope==='shot'?[allowed.id]:scope==='scene'?[allowed.sceneId]:[allowed.id,saved.shots[2].id];
 const actor=f.production.beginRequest(saved.id,'human','Generate only this requested voice',{scopeIds});
 const input={key:key(),expectedHeadVersion:saved.headVersion,segmentId:allowed.id,segmentRevisionId:digest({shotId:allowed.id,narration:allowed.narration}),profileId:f.profile.id,voice:'cedar',instructions:''};
 const result=await f.service.request(saved.id,actor,input);assert.ok(result.receipt.candidateId);
 const foreign=saved.shots[1],before=f.narration.workspaceSnapshot(saved.id);
 await assert.rejects(f.service.request(saved.id,actor,{...input,key:key(),expectedHeadVersion:f.store.getProject(saved.id).headVersion,segmentId:foreign.id,segmentRevisionId:digest({shotId:foreign.id,narration:foreign.narration})}),{code:'SCOPE_DENIED'});
 assert.deepEqual(f.narration.workspaceSnapshot(saved.id),before);
});
for(const kind of ['speech','transcription'])test(`${kind} request captures original actor/key/signal across asynchronous preparation`,async t=>{
 const f=kind==='speech'?await narrationSpeechFixture(t):await ownedTranscriptionFixture(t),actor=structuredClone(f.human),input=f.input(),originalInput=structuredClone(input);
 const controller=new AbortController(),replacement=new AbortController(),options={signal:controller.signal},prepare=f.service.prepare.bind(f.service);let enter,release;
 const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
 f.service.prepare=async(...args)=>{enter();await gate;return prepare(...args);};
 const pending=f.service.request(f.project.id,actor,input,options);await entered;input.key='changed-key';actor.requestId='changed-request';options.signal=replacement.signal;replacement.abort();release();
 const result=await pending;assert.ok(result.receipt.candidateId);assert.deepEqual(await f.service.request(f.project.id,f.human,originalInput,{signal:controller.signal}),result);
});
for(const kind of ['speech','transcription'])test(`${kind} original cancellation cannot be replaced between preparation and publication`,async t=>{
 const f=kind==='speech'?await narrationSpeechFixture(t):await ownedTranscriptionFixture(t),controller=new AbortController(),options={signal:controller.signal},prepare=f.service.prepare.bind(f.service);let enter,release;
 const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
 f.service.prepare=async(...args)=>{const proposal=await prepare(...args);enter();await gate;return proposal;};
 const pending=f.service.request(f.project.id,f.human,f.input(),options);await entered;options.signal=new AbortController().signal;controller.abort();release();
 await assert.rejects(pending,error=>error.code.endsWith('CANCELLED'));assert.equal(f.store.list(kind==='speech'?'narration_speech_application':'owned_transcription_application',f.project.id).length,0);
});
for(const scope of ['project','scene','shot'])test(`requested ${scope} narration dispatches alongside its exact scope without releasing an earlier picture hold or resubmitting unknown work`,async t=>{
 const f=await narrationSpeechFixture(t,{realSpeech:true,configuredAdmission:true,fetch:async()=>{throw Error('injected unconfirmed speech response');}}),saved=virtualShots(f),shot=saved.shots[0];
 const previous=rows(f,'hold').find(hold=>hold.active&&hold.ownerId===f.human.requestId);
 const human=f.production.beginRequest(saved.id,'human','Generate this saved shot narration',{concurrency:'alongside',scopeIds:[scope==='project'?saved.id:scope==='scene'?shot.sceneId:shot.id]}),actor=human;
 const result=await f.service.request(saved.id,actor,{key:key(),expectedHeadVersion:saved.headVersion,segmentId:shot.id,
  segmentRevisionId:digest({shotId:shot.id,narration:shot.narration}),profileId:f.profile.id,voice:'cedar',instructions:''});
 const ready=await f.engine.runReady();assert.equal(ready.dispatched,1);assert.equal(f.calls.http,1);
 const attempt=rows(f,'attempt').find(attempt=>attempt.candidateId===result.receipt.candidateId);assert.equal(attempt.phase,'submission_unknown');assert.equal(attempt.request.providerUse.kind,'configured');
 assert.equal(attempt.request.externalAllowanceId,undefined);assert.equal(rows(f,'external_allowance').length,0);assert.deepEqual(f.store.get('hold',previous.id),previous);assert.equal(f.store.get('message',f.human.requestId).state,'active');
 await f.engine.reconcile();assert.equal(f.calls.http,1);assert.equal(rows(f,'attempt').filter(attempt=>attempt.candidateId===result.receipt.candidateId).length,1);
});
for(const change of ['new_pause','global_stop','text','voice','mode'])test(`requested speech cannot bypass ${change} after its input was captured`,async t=>{
 const f=await narrationSpeechFixture(t,{realSpeech:true,configuredAdmission:true,fetch:async()=>{throw Error('unexpected injected POST');}}),saved=virtualShots(f),shot=saved.shots[0];
 const result=await f.service.request(saved.id,f.human,{key:key(),expectedHeadVersion:saved.headVersion,segmentId:shot.id,segmentRevisionId:digest({shotId:shot.id,narration:shot.narration}),profileId:f.profile.id,voice:'cedar',instructions:''});
 if(change==='new_pause')f.production.holdRequest(saved.id,f.actor,true);
 else if(change==='global_stop')f.engine.setPaused(saved.id,true,f.human.requestId);
 else {const current=f.store.getProject(saved.id);current.shots[0].narration[change]=change==='text'?'New words.':change==='voice'?'personal':'none';current.revisionId=key();f.store.saveProject(current,current.headVersion);}
 const ready=await f.engine.runReady();assert.equal(ready.dispatched,0);assert.equal(f.calls.http,0);assert.equal(rows(f,'attempt').filter(attempt=>attempt.candidateId===result.receipt.candidateId).length,0);
});
test('hold whitelist excludes a later false event and any reactivation rather than trusting an old activation',async t=>{
 const f=await narrationSpeechFixture(t),hold=rows(f,'hold').find(hold=>hold.active),cutoff=f.store.cursor(f.project.id);
 assert.ok(earlierRequestHoldIds(f.store,f.project.id,cutoff).includes(hold.id));f.engine.releaseHold(f.project.id,hold.id,hold.ownerId);
 f.store.put('hold',hold.id,f.project.id,{...hold,active:true});assert.ok(!earlierRequestHoldIds(f.store,f.project.id,cutoff).includes(hold.id));
 f.engine.setHold(f.project.id,{id:hold.id,scopeId:hold.scopeId,ownerId:hold.ownerId});assert.ok(!earlierRequestHoldIds(f.store,f.project.id,cutoff).includes(hold.id));
});
for(const change of ['earlier_hold','new_pause','global_stop'])test(`configured requested ASR respects ${change} and retains exact owned recording and job identity`,async t=>{
 const f=await ownedTranscriptionFixture(t),outputs=new ExecutionOutputStore(f.store,{rootDir:join(f.root,'requested-asr-output')}),files=new TranscriptionAudioStore({rootDir:join(f.root,'requested-asr-input')});
 const preparation=new TranscriptionAudioService(f.store,f.media,files),calls={http:0},credentials=new EnvironmentMediaCredentials(()=> 'injected-asr-key');
 const bridge=new OpenAITranscriptionExecution({store:f.store,outputStore:outputs,preparation,credentials,fetch:async()=>{calls.http++;throw Error('injected unknown ASR outcome');}});
 const engine=new Engine(f.store,bridge,{artifactDir:f.artifactDir,profiles:f.profiles,outputStore:outputs,externalAdmission:{authorize:()=>({})},submissionPreparation:bridge});
 const production=new ProductionService(f.store,engine,f.profiles),narration=new NarrationService(production,f.media),service=new OwnedTranscriptionService(narration,f.artifactDir);
 const earlier=rows(f,'hold').find(hold=>hold.active&&hold.ownerId===f.human.requestId),human=production.beginRequest(f.project.id,'human','Transcribe this owned recording',{concurrency:'alongside'});
 const result=await service.request(f.project.id,human,f.input());
 if(change==='new_pause')production.holdRequest(f.project.id,human,true);if(change==='global_stop')engine.setPaused(f.project.id,true,human.requestId);
 const ready=await engine.runReady();
 if(change!=='earlier_hold'){assert.equal(ready.dispatched,0);assert.equal(calls.http,0);assert.deepEqual(f.store.get('hold',earlier.id),earlier);assert.equal(f.store.get('message',f.human.requestId).state,'active');return;}
 assert.equal(ready.dispatched,1);assert.equal(calls.http,1);
 assert.deepEqual(f.store.get('hold',earlier.id),earlier);assert.equal(f.store.get('message',f.human.requestId).state,'active');assert.equal(rows(f,'external_allowance').length,0);
 const attempt=rows(f,'attempt').find(attempt=>attempt.candidateId===result.receipt.candidateId);assert.equal(attempt.phase,'submission_unknown');assert.equal(attempt.request.providerUse.kind,'configured');
 await engine.reconcile();assert.equal(calls.http,1);assert.equal(rows(f,'attempt').filter(attempt=>attempt.candidateId===result.receipt.candidateId).length,1);
});

test('current narration contexts group acceptance into one scene confirmation across legacy and current skill locks',async t=>{
 for(const version of ['4.0.0','5.0.0']) {
  const f=await narrationSpeechFixture(t),lock=bind(t,f,version),before=canonicalState();
  function canonicalState(){return JSON.stringify({project:f.store.getProject(f.project.id),lock:f.store.get('director_skill_lock',lock?.id),narration:f.narration.workspaceSnapshot(f.project.id),grants:rows(f,'grant'),acceptances:rows(f,'narration_acceptance')});}
  const changes=f.store.db.prepare('SELECT total_changes() n').get().n;
  const overview=f.production.readContext(f.project.id,f.actor,{}),narration=f.production.readContext(f.project.id,f.actor,{section:'narration'}),audio=f.production.readContext(f.project.id,f.actor,{section:'audio_operations'}).items[0];
  if(version==='5.0.0'){
   for(const authority of [overview.narrationDraft.authority,narration.narrationDraft.authority,audio.authority]){
    assert.match(authority,/one (?:studio )?scene confirmation/i);assert.match(authority,/no separate narration|do not ask for a separate narration/);assert.match(authority,/pending/);
   }
   assert.match(narration.narrationDraft.authority,/read-context tool cannot synthesize, transcribe, attach recordings or accept/);
   assert.match(audio.authority,/Transcript adoption remains an explicit human editorial choice/);
   assert.ok(audio.sections.every(section=>section.generationNeedsReview===false));
  }else{
   assert.match(overview.narrationDraft.authority,/required in narration review/);assert.match(narration.narrationDraft.authority,/canonical application remain separate/);
   assert.match(audio.authority,/human presses the existing audio request action/i);assert.ok(audio.sections.every(section=>section.generationNeedsReview===true));
   for(const authority of [overview.narrationDraft.authority,narration.narrationDraft.authority,audio.authority])assert.doesNotMatch(authority,/one (?:studio )?scene confirmation/i);
  }
  assert.equal(canonicalState(),before);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,changes);assert.deepEqual(f.calls,{http:0,credentials:0});
  assert.ok(f.narration.workspaceSnapshot(f.project.id).segments.every(row=>!row.accepted.script&&!row.accepted.audio&&!row.accepted.timing));
 }
});

test('a Director plan cannot mint a paid speech grant while the human publication path remains available',async t=>{
 const f=await narrationSpeechFixture(t);bind(t,f,'5.0.0');
 const saved=f.store.getProject(f.project.id),before=Object.fromEntries(['grant','candidate','attempt','reservation','prepared'].map(k=>[k,rows(f,k)]));
 const proposal={variant:'plan',expectedHeadVersion:saved.headVersion,source:`definePlan({baseRevision:${JSON.stringify(saved.revisionId)}},p=>{return p.speech("director-paid-voice",{profile:${JSON.stringify(f.profile.id)},text:"Suggested words",voice:"cedar",instructions:"Warm and clear."});});`};
 await assert.rejects(f.production.prepare(saved.id,f.actor,proposal),{code:'ORIGIN_NOT_AUTHORIZED'});
 assert.deepEqual(Object.fromEntries(Object.keys(before).map(k=>[k,rows(f,k)])),before);
});

test('current application audio guidance overrides frozen spending instructions for legacy and current epochs',async t=>{
 for (const version of ['4.0.0','5.0.0']) {
  const f=await narrationSpeechFixture(t);bind(t,f,version);
  const context=f.production.readContext(f.project.id,f.actor,{section:'audio_operations'});
  assert.match(context.items[0].authority,/Only an explicit human press|human presses the existing audio request/);
  assert.doesNotMatch(JSON.stringify(context.applicationCapabilities),/then separately approves finite spending|finite spending approval/);
 }
});
