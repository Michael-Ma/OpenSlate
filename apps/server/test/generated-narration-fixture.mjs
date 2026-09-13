import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,compilePlan,digest,providerProfileArguments} from '@openslate/core';
import {FakeProvider,OPENAI_SPEECH_MODEL} from '@openslate/providers';
import {Store} from '../dist/persistence/store.js';
import {Engine} from '../dist/execution/engine.js';
import {ExecutionOutputStore} from '../dist/execution/output-store.js';
import {OpenAISpeechExecution} from '../dist/execution/openai-speech-execution.js';
import {SpoolAudioIngestor} from '../dist/execution/spool-audio-ingester.js';
import {DurableExternalAdmission} from '../dist/execution/durable-external-admission.js';
import {ProductionService} from '../dist/application/service.js';
import {EnvironmentMediaCredentials} from '../dist/application/provider-credentials.js';
import {ExternalAllowanceService,allowanceIssueContextDigest} from '../dist/application/external-allowances.js';
import {LocalMediaService} from '../dist/media/local-media.js';
import {NarrationService,NarrationCanonicalService} from '../dist/narration/index.js';
import {resolveGeneratedNarrationAudio} from '../dist/narration/generated-audio.js';
import {wave} from './speech-execution-fixture.mjs';
const ffmpegPath=process.env.OPENSLATE_FFMPEG_PATH??(existsSync('/opt/homebrew/bin/ffmpeg')?'/opt/homebrew/bin/ffmpeg':'/usr/bin/ffmpeg');
const ffprobePath=process.env.OPENSLATE_FFPROBE_PATH??(existsSync('/opt/homebrew/bin/ffprobe')?'/opt/homebrew/bin/ffprobe':'/usr/bin/ffprobe');
export const draft=(text='Leather boots.')=>({text,meaning:text,textKind:'draft',language:'en',source:{kind:'generated',voice:null,profileRevisionId:null}});
export const key=()=>randomUUID(),rows=(f,kind)=>f.store.list(kind,f.project.id),bodies=(f,kinds)=>canonical(Object.fromEntries(kinds.map(kind=>[kind,rows(f,kind)])));
/** Actual admitted/completed speech and real local normalization. HTTP and costs are synthetic. */
export async function generatedNarrationFixture(t,options={}){
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'openslate-generated-narration-'))),root=join(parent,'installation');mkdirSync(root);
 const stores=[],f={parent,root,calls:{http:0,credentials:0,normalization:0},stores};
 f.profile={id:'offline-speech',revision:'fixture-estimate-1',kind:'speech',adapter:'openai-speech',executionVersion:'1',configuration:{model:OPENAI_SPEECH_MODEL,settings:{}},maxConcurrency:1,unitCostMicros:'100',maxRetries:0};
 const profiles=[f.profile,...(options.extraProfiles??[])];
 f.open=(recovery=false)=>{
  f.store=new Store(join(root,'openslate.sqlite'));stores.push(f.store);const fake=new FakeProvider(join(root,'fake-provider.sqlite'));fake.close();
  f.outputs=new ExecutionOutputStore(f.store,{rootDir:join(root,'execution-output')});
  f.media=new LocalMediaService({rootDir:join(root,'media'),allowedInputRoots:[f.outputs.rootDir],ffmpegPath:recovery?'/unavailable/ffmpeg':ffmpegPath,ffprobePath:recovery?'/unavailable/ffprobe':ffprobePath});
  const original=f.media.importMedia.bind(f.media);f.media.importMedia=async(...args)=>{f.calls.normalization++;assert.equal(recovery,false);return original(...args);};
  f.bridge=new OpenAISpeechExecution({store:f.store,outputStore:f.outputs,credentials:new EnvironmentMediaCredentials(()=>{f.calls.credentials++;assert.equal(recovery,false);return 'synthetic-generated-narration-key';}),fetch:async()=>{f.calls.http++;assert.equal(recovery,false);return new Response(wave(options.samples??24000),{headers:{'content-type':'audio/wav'}});}});
  f.engine=new Engine(f.store,f.bridge,{artifactDir:join(root,'artifacts'),profiles,outputStore:f.outputs,outputIngestor:new SpoolAudioIngestor(f.outputs,f.media,{rootDir:join(root,'audio-derivations')}),externalAdmission:new DurableExternalAdmission(f.store,()=>{assert.equal(recovery,false);})});
  f.production=new ProductionService(f.store,f.engine,profiles);f.narration=new NarrationService(f.production,f.media);f.canonical=new NarrationCanonicalService(f.narration);
 };
 t.after(()=>{for(const store of stores)if(store.db.open)store.close();rmSync(parent,{recursive:true,force:true});});
 f.open();f.project=f.production.createProject('Generated narration fixture');
 const source=`definePlan({baseRevision:${JSON.stringify(f.project.revisionId)}},p=>{return p.speech("voice",{profile:"offline-speech",text:"Leather boots.",voice:"coral",instructions:"Warm and clear."});});`;
 const plan=compilePlan(source,{project:f.project,profiles:[f.profile],logicalIds:{},allocateId:randomUUID}),node=plan.nodes[0],grant=f.engine.createGrant(f.project.id,f.project.id,'speech','synthetic-human','initial_slot'),planId=randomUUID();
 f.store.transaction(()=>{f.engine.installPlan(f.project.id,planId,plan,{[node.id]:grant.id});f.store.saveProject({...f.project,activePlanId:planId},f.project.headVersion);});
 const binding=f.store.get('node_binding',node.id),input={profileDigest:String(providerProfileArguments(f.profile).profileDigest),profileDefinitionDigest:digest(f.profile),selections:[{candidateId:binding.candidateId,nodeId:node.id,specDigest:node.specDigest}],maxAttempts:1,maxEstimatedMicros:'100',expiresAt:new Date(Date.now()+3600000).toISOString()};
 const spender=f.production.beginRequest(f.project.id,'human','Approve exact synthetic speech',{editing:false,scopeIds:[f.project.id],contextDigest:allowanceIssueContextDigest(f.project.id,input)});
 new ExternalAllowanceService(f.store).issue(f.project.id,spender,input);await f.engine.runReady();
 f.attempt=rows(f,'attempt')[0];assert.equal(f.attempt.phase,'succeeded');f.artifact=f.store.get('artifact',f.attempt.outputs.audio.artifactId);f.source=f.store.get('media_source',f.artifact.id);f.initialCalls={...f.calls};
 f.human=f.production.beginRequest(f.project.id,'human','Choose this saved generated recording for narration');
 f.view=()=>f.narration.snapshot(f.project.id,f.human);f.revise=patch=>f.narration.reviseSegments(f.project.id,f.human,f.view().state.version,key(),patch);
 f.revise({add:[draft(),draft('Keep this other section unchanged.')]});
 f.prepare=()=>f.canonical.prepare(f.project.id,f.human,{expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedNarrationVersion:f.view().state.version,shotMappings:[],key:key()});
 return f;
}

export const selection=(f,index=0)=>{const view=f.view(),resolved=resolveGeneratedNarrationAudio(f.store,f.project.id,f.artifact.id),segment=view.segments[index];return{expectedVersion:view.state.version,segmentId:segment.entry.segmentId,segmentRevisionId:segment.script.id,artifactId:f.artifact.id,artifactDigest:resolved.artifactDigest,generationEvidenceDigest:resolved.generationEvidenceDigest,key:key()};};
export async function acceptAll(f){for(const segment of f.view().segments){const id=segment.entry.segmentId;f.narration.recordHumanCue(f.project.id,f.human,f.view().state.version,key(),{segmentId:id,startSample:0,endSample:48000});f.narration.accept(f.project.id,f.human,f.view().state.version,key(),'script',[segment.script.id]);f.narration.acceptAudio(f.project.id,f.human,f.view().state.version,key(),[{segmentRevisionId:segment.script.id,audioId:f.view().segments.find(s=>s.entry.segmentId===id).audio.id}]);const cue=f.view().segments.find(s=>s.entry.segmentId===id).cue;f.narration.accept(f.project.id,f.human,f.view().state.version,key(),'timing',[cue.id]);}}
