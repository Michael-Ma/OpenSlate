import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,compilePlan,digest} from '@openslate/core';
import {FakeProvider,OPENAI_SPEECH_MODEL} from '@openslate/providers';
import {Store} from '../dist/persistence/store.js';
import {Engine} from '../dist/execution/engine.js';
import {ExecutionOutputStore} from '../dist/execution/output-store.js';
import {OpenAISpeechExecution} from '../dist/execution/openai-speech-execution.js';
import {SpoolAudioIngestor} from '../dist/execution/spool-audio-ingester.js';
import {ConfiguredExternalAdmission} from '../dist/execution/configured-external-admission.js';
import {ProductionService} from '../dist/application/service.js';
import {EnvironmentMediaCredentials} from '../dist/application/provider-credentials.js';
import {LocalMediaService} from '../dist/media/local-media.js';
import {NarrationService,NarrationCanonicalService} from '../dist/narration/index.js';
import {resolveGeneratedNarrationAudio} from '../dist/narration/generated-audio.js';
import {projectFixture} from './execution-fixture.mjs';
import {createShotNarrationSession} from '../dist/narration/narration-scope.js';
import {createShotAudioWorkspace} from '../dist/narration/shot-audio-routes.js';
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
  f.bridge=new OpenAISpeechExecution({store:f.store,outputStore:f.outputs,credentials:new EnvironmentMediaCredentials(()=>{f.calls.credentials++;assert.equal(recovery,false);return 'synthetic-generated-narration-key';}),fetch:async()=>{f.calls.http++;assert.equal(recovery,false);const bytes=wave(options.samples??24000);if(options.streamingWav){bytes.writeUInt32LE(0xffffffff,4);bytes.writeUInt32LE(0xffffffff,40);}return new Response(bytes,{headers:{'content-type':'audio/wav'}});}});
  f.engine=new Engine(f.store,f.bridge,{artifactDir:join(root,'artifacts'),profiles,outputStore:f.outputs,outputIngestor:new SpoolAudioIngestor(f.outputs,f.media,{rootDir:join(root,'audio-derivations')}),externalAdmission:new ConfiguredExternalAdmission(f.store,()=>{assert.equal(recovery,false);})});
  f.production=new ProductionService(f.store,f.engine,profiles);f.narration=new NarrationService(f.production,f.media);f.canonical=new NarrationCanonicalService(f.narration);
  f.workspace=createShotAudioWorkspace({production:f.production,narration:f.narration,canonical:f.canonical,actorFor:(pid,id)=>{const session=f.store.get('narration_session',id);assert.equal(session.projectId,pid);return{kind:'human',principalId:session.principalId,requestId:session.requestId};}});
 };
 t.after(()=>{for(const store of stores)if(store.db.open)store.close();rmSync(parent,{recursive:true,force:true});});
 f.open();const created=f.production.createProject('Generated narration fixture'),shape=projectFixture(created.id,2);
 f.project=f.store.saveProject({...created,revisionId:shape.revisionId,brief:shape.brief,story:shape.story,scenes:shape.scenes,shots:shape.shots},created.headVersion);
 f.store.insert('project_revision',f.project.revisionId,f.project.id,{project:f.project});
 const source=`definePlan({baseRevision:${JSON.stringify(f.project.revisionId)}},p=>{return p.speech("voice",{profile:"offline-speech",text:"Leather boots.",voice:"coral",instructions:"Warm and clear."});});`;
 const plan=compilePlan(source,{project:f.project,profiles:[f.profile],logicalIds:{},allocateId:randomUUID}),node=plan.nodes[0],grant=f.engine.createGrant(f.project.id,f.project.id,'speech','synthetic-human','initial_slot'),planId=randomUUID();
 f.store.transaction(()=>{f.engine.installPlan(f.project.id,planId,plan,{[node.id]:grant.id});f.store.saveProject({...f.project,activePlanId:planId},f.project.headVersion);});
 await f.engine.runReady();
 f.attempt=rows(f,'attempt')[0];assert.equal(f.attempt.phase,'succeeded');f.artifact=f.store.get('artifact',f.attempt.outputs.audio.artifactId);f.source=f.store.get('media_source',f.artifact.id);f.initialCalls={...f.calls};
 f.view=()=>f.narration.workspaceSnapshot(f.project.id);
 f.selectShot=index=>{f.shotId=f.project.shots[index].id;const old=f.store.get('narration_shot_session_head',digest({projectId:f.project.id,shotId:f.shotId}));f.session=createShotNarrationSession(f.production,f.project.id,f.shotId,key(),old?.sessionId);f.human={kind:'human',principalId:'local-user',requestId:f.session.requestId};return f.session;};
 for(const index of [0,1]){f.selectShot(index);f.workspace.saveWriting(f.project.id,f.shotId,{sessionId:f.session.id,expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedVersion:f.view().state.version,text:index?'Keep this other section unchanged.':'Leather boots.',language:'en',mode:'generated',voice:'coral',profileRevisionId:f.profile.revision},key());}
 f.revise=patch=>f.narration.reviseSegments(f.project.id,f.human,f.view().state.version,key(),patch);
 f.selectShot(0);
 f.prepare=()=>{const segment=f.workspace.detail(f.project.id,f.shotId).segment;return f.canonical.prepare(f.project.id,f.human,{expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedNarrationVersion:f.view().state.version,segmentIds:[segment.entry.segmentId],shotRelativeSegmentIds:[segment.entry.segmentId],shotDurationMode:'preserve',shotMappings:[{shotId:f.shotId,segmentId:segment.entry.segmentId}],key:key()});};
 f.accept=async(extra={})=>{const segment=f.workspace.detail(f.project.id,f.shotId).segment;return f.workspace.accept(f.project.id,f.shotId,{sessionId:f.session.id,expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedVersion:f.view().state.version,segmentId:segment.entry.segmentId,segmentRevisionId:segment.script.id,audioId:segment.audio.id,sha256:segment.audio.media.sha256,startSample:0,endSample:segment.audio.media.probe.audio.samples,...extra},key());};
 return f;
}

export const selection=(f,index=0)=>{const view=f.view(),resolved=resolveGeneratedNarrationAudio(f.store,f.project.id,f.artifact.id),segment=view.segments[index];return{expectedVersion:view.state.version,segmentId:segment.entry.segmentId,segmentRevisionId:segment.script.id,artifactId:f.artifact.id,artifactDigest:resolved.artifactDigest,generationEvidenceDigest:resolved.generationEvidenceDigest,key:key()};};
export async function acceptSelected(f){const segment=f.workspace.detail(f.project.id,f.shotId).segment;f.narration.recordHumanCue(f.project.id,f.human,f.view().state.version,key(),{segmentId:segment.entry.segmentId,startSample:0,endSample:48000});f.narration.accept(f.project.id,f.human,f.view().state.version,key(),'script',[segment.script.id]);f.narration.acceptAudio(f.project.id,f.human,f.view().state.version,key(),[{segmentRevisionId:segment.script.id,audioId:segment.audio.id}]);f.narration.accept(f.project.id,f.human,f.view().state.version,key(),'timing',[f.workspace.detail(f.project.id,f.shotId).segment.cue.id]);}
