import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,compilePlan,digest,providerProfileArguments} from '@openslate/core';
import {FakeProvider} from '@openslate/providers';
import {Store} from '../dist/persistence/store.js';
import {Engine} from '../dist/execution/engine.js';
import {ExecutionOutputStore} from '../dist/execution/output-store.js';
import {SpoolTranscriptIngestor} from '../dist/execution/spool-transcript-ingestor.js';
import {OpenAITranscriptionExecution} from '../dist/execution/openai-transcription-execution.js';
import {DurableExternalAdmission} from '../dist/execution/durable-external-admission.js';
import {ExternalAllowanceService,allowanceIssueContextDigest} from '../dist/application/external-allowances.js';
import {EnvironmentMediaCredentials} from '../dist/application/provider-credentials.js';
import {ProductionService} from '../dist/application/service.js';
import {LocalMediaService} from '../dist/media/local-media.js';
import {TranscriptionAudioStore} from '../dist/media/transcription-audio-store.js';
import {TranscriptionAudioService} from '../dist/execution/transcription-audio-service.js';
import {NarrationService,NarrationCanonicalService} from '../dist/narration/index.js';
import {transcriptionFixture,response,payload} from './transcription-execution-fixture.mjs';
import {generatedNarrationFixture,selection as generatedSelection,acceptAll} from './generated-narration-fixture.mjs';

export const key=()=>randomUUID(),rows=(f,kind)=>f.store.list(kind,f.project.id),bodies=(f,kinds)=>canonical(Object.fromEntries(kinds.map(kind=>[kind,rows(f,kind)])));
export {payload,response};
/** Actual human allowance, Engine admission and succeeded candidate; synthetic HTTP and real fixed media conversions. */
export async function transcriptSelectionFixture(t,options={}){
 const f=await transcriptionFixture(t,{...options,deferAdmission:true});f.root=f.directory;
 const fake=new FakeProvider(join(f.root,'fake-provider.sqlite'));fake.close();
 f.engine=new Engine(f.store,f.bridge,{artifactDir:f.artifactRoot,profiles:[f.profile],outputStore:f.outputs,
  outputIngestor:new SpoolTranscriptIngestor(f.outputs,f.media,f.files,{artifactDir:f.artifactRoot}),externalAdmission:new DurableExternalAdmission(f.store,()=>{})});
 await f.engine.runReady();f.attempt=rows(f,'attempt')[0];assert.equal(f.attempt.phase,'succeeded');
 f.candidate=rows(f,'transcript_candidate')[0];assert.ok(f.candidate);f.rawArtifact=f.store.get('artifact',f.candidate.artifactId);
 assert.deepEqual(f.attempt.outputs.cues,f.rawArtifact.artifact);assert.equal(f.store.get('reservation',f.attempt.reservationId).state,'charged');
 unlinkSync(f.sourcePath); // Staging input is not part of the managed installation/backup namespace.
 f.initialCalls={...f.calls};
 f.services=()=>{f.production=new ProductionService(f.store,f.engine,[f.profile]);f.narration=new NarrationService(f.production,f.media);f.canonical=new NarrationCanonicalService(f.narration);};
 f.services();f.human=f.production.beginRequest(f.project.id,'offline-human','Review this saved transcript and make an explicit narration choice');
 f.view=()=>f.narration.snapshot(f.project.id,f.human);
 f.revise=patch=>f.narration.reviseSegments(f.project.id,f.human,f.view().state.version,key(),patch);
 f.prepare=()=>f.canonical.prepare(f.project.id,f.human,{expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedNarrationVersion:f.view().state.version,shotMappings:[],key:key()});
 f.open=()=>{
  if(f.store.db.open)f.store.close();f.store=new Store(f.path);f.stores.push(f.store);
  const forbidden=()=>assert.fail('Transcript selection recovery must not call a provider, prepare audio or discover media tools');
  f.outputs=new ExecutionOutputStore(f.store,{rootDir:join(f.root,'execution-output')});
  f.media=new LocalMediaService({rootDir:join(f.root,'media'),allowedInputRoots:[f.root],ffmpegPath:'/unavailable/ffmpeg',ffprobePath:'/unavailable/ffprobe'});
  for(const method of ['importMedia','describeAudioNormalization','describeTranscriptionAudio','deriveTranscriptionAudio'])f.media[method]=forbidden;
  f.files=new TranscriptionAudioStore({rootDir:join(f.root,'audio-derivatives')});
  f.bridge=new OpenAITranscriptionExecution({store:f.store,outputStore:f.outputs,preparation:{store:f.store,prepare:forbidden,files:{readUpload:forbidden}},credentials:new EnvironmentMediaCredentials(forbidden),fetch:forbidden});
  f.engine=new Engine(f.store,f.bridge,{artifactDir:f.artifactRoot,profiles:[f.profile],outputStore:f.outputs,
   outputIngestor:new SpoolTranscriptIngestor(f.outputs,f.media,f.files,{artifactDir:f.artifactRoot})});f.services();
 };
 f.backupDirectory=`${f.root}-backup`;f.archiveDirectory=`${f.root}-original`;
 t.after(()=>{rmSync(f.backupDirectory,{recursive:true,force:true});rmSync(f.archiveDirectory,{recursive:true,force:true});});
 return f;
}

export function selection(f,options={}){
 const {index=0,startWordIndex=0,endWordIndex=f.candidate.projection.words.length,...overrides}=options,view=f.view(),segment=view.segments[index];
 const text=f.candidate.projection.words.slice(startWordIndex,endWordIndex).map(word=>word.word.trim()).join(' ');
 return{expectedVersion:view.state.version,segmentId:segment.entry.segmentId,segmentRevisionId:segment.script.id,audioId:segment.audio.id,
  candidateId:f.candidate.id,candidateDigest:digest(f.candidate),startWordIndex,endWordIndex,
  selectedTextDigest:digest({policy:'trim-join-ascii-space-v1',text}),key:key(),...overrides};
}
export function acceptSelected(f,index=0){
 let section=f.view().segments[index];f.narration.accept(f.project.id,f.human,f.view().state.version,key(),'script',[section.script.id]);
 section=f.view().segments[index];f.narration.acceptAudio(f.project.id,f.human,f.view().state.version,key(),[{segmentRevisionId:section.script.id,audioId:section.audio.id}]);
 section=f.view().segments[index];assert.ok(section.cue);f.narration.accept(f.project.id,f.human,f.view().state.version,key(),'timing',[section.cue.id]);
}

/** Both adapters are pinned at initial project creation. No lock or admission is fabricated afterward. */
export async function generatedTranscriptSelectionFixture(t){
 const profile={id:'offline-transcription',revision:'fixture-estimate-1',kind:'transcription',adapter:'openai-transcription',executionVersion:'1',configuration:{model:'whisper-1',settings:{}},maxConcurrency:1,unitCostMicros:'100',maxRetries:0};
 const f=await generatedNarrationFixture(t,{extraProfiles:[profile]});f.revise({remove:[f.view().segments[1].entry.segmentId]});
 await f.narration.attachGeneratedAudio(f.project.id,f.human,generatedSelection(f));await acceptAll(f);const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);
 f.audio=f.view().segments[0].audio;f.artifactRoot=join(f.root,'artifacts');f.files=new TranscriptionAudioStore({rootDir:join(f.root,'audio-derivatives')});f.preparation=new TranscriptionAudioService(f.store,f.media,f.files);
 f.calls.transcriptionHttp=0;f.calls.transcriptionCredentials=0;
 const bridge=new OpenAITranscriptionExecution({store:f.store,outputStore:f.outputs,preparation:f.preparation,credentials:new EnvironmentMediaCredentials(()=>{f.calls.transcriptionCredentials++;return 'synthetic-transcript-selection-key';}),fetch:async()=>{f.calls.transcriptionHttp++;return response();}});
 const profiles=[f.profile,profile],engine=new Engine(f.store,bridge,{artifactDir:f.artifactRoot,profiles,outputStore:f.outputs,outputIngestor:new SpoolTranscriptIngestor(f.outputs,f.media,f.files,{artifactDir:f.artifactRoot}),externalAdmission:new DurableExternalAdmission(f.store,()=>{})});
 const current=f.store.getProject(f.project.id),source=`definePlan({baseRevision:${JSON.stringify(current.revisionId)}},p=>{return p.transcription("transcript",{profile:${JSON.stringify(profile.id)},audio:p.asset(${JSON.stringify(f.audio.id)}),language:"auto",timing:"word",settings:{}});});`;
 const plan=compilePlan(source,{project:current,profiles,logicalIds:{},allocateId:key}),node=plan.nodes[0],grant=f.production.authorize(f.project.id,f.human,[{scopeId:f.project.id,kind:'transcription'}],key(),'initial_slot')[0],planId=key();
 engine.installPlan(f.project.id,planId,plan,{[node.id]:grant.id});f.store.saveProject({...current,activePlanId:planId},current.headVersion);
 for(const hold of rows(f,'hold'))if(hold.active&&hold.ownerId===f.human.requestId)engine.releaseHold(f.project.id,hold.id,f.human.requestId);
 const binding=f.store.get('node_binding',node.id),input={profileDigest:String(providerProfileArguments(profile).profileDigest),profileDefinitionDigest:digest(profile),selections:[{candidateId:binding.candidateId,nodeId:node.id,specDigest:node.specDigest}],maxAttempts:1,maxEstimatedMicros:'100',expiresAt:new Date(Date.now()+3600000).toISOString()};
 const spender=f.production.beginRequest(f.project.id,'human','Approve this exact synthetic transcript',{editing:false,scopeIds:[f.project.id],contextDigest:allowanceIssueContextDigest(f.project.id,input)});new ExternalAllowanceService(f.store).issue(f.project.id,spender,input);
 await engine.runReady();f.candidate=rows(f,'transcript_candidate')[0];assert.ok(f.candidate);f.transcriptionAttempt=f.store.get('attempt',f.candidate.attemptId);assert.equal(f.transcriptionAttempt.phase,'succeeded');assert.equal(f.store.get('reservation',f.transcriptionAttempt.reservationId).state,'charged');
 f.rawArtifact=f.store.get('artifact',f.candidate.artifactId);f.initialCalls={...f.calls};f.engine=engine;f.production=new ProductionService(f.store,engine,profiles);f.narration=new NarrationService(f.production,f.media);f.canonical=new NarrationCanonicalService(f.narration);
 f.human=f.production.beginRequest(f.project.id,'human','Review this generated recording transcript');return f;
}
