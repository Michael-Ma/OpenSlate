import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_PROFILES,newId,digest} from '@openslate/core';
import {FakeProvider,describeCodexImageInput,OPENAI_IMAGE_MODEL} from '@openslate/providers';
import {Store} from '../dist/persistence/store.js';
import {createMediaExecutionRuntime} from '../dist/application/media-execution-runtime.js';
import {EnvironmentMediaCredentials} from '../dist/application/provider-credentials.js';
import {ProductionService} from '../dist/application/service.js';
import {allowanceIssueContextDigest} from '../dist/application/external-allowances.js';
import {projectFixture} from './execution-fixture.mjs';
const ffmpegPath=process.env.OPENSLATE_FFMPEG_PATH??(existsSync('/opt/homebrew/bin/ffmpeg')?'/opt/homebrew/bin/ffmpeg':'/usr/bin/ffmpeg');
const ffprobePath=process.env.OPENSLATE_FFPROBE_PATH??(existsSync('/opt/homebrew/bin/ffprobe')?'/opt/homebrew/bin/ffprobe':'/usr/bin/ffprobe');
export const codexImageProfile={id:'codex-image-v1',revision:'v1',kind:'image',adapter:'codex-image',executionVersion:'1',maxConcurrency:1,unitCostMicros:'0',maxRetries:0,
  configuration:{model:'codex-image-generation',settings:{runtimeVersion:'0.153.4',directorModel:'gpt-6-astra',width:1024,height:1024}}};
export const codexApiProfile={...codexImageProfile,id:'api-image',adapter:'openai-image',unitCostMicros:'1000',configuration:{model:OPENAI_IMAGE_MODEL,settings:{width:1024,height:1024,quality:'medium'}}};
const codex=codexImageProfile,api=codexApiProfile;
export const codexRuntimeConfiguration=()=>({image:false,codexImage:true,h3:false,h3DownloadHosts:[]});
export function codexImageFixture(t,changes={}) {
  const directory=mkdtempSync(join(tmpdir(),'openslate-codex-runtime-')),store=new Store(join(directory,'openslate.sqlite')),fakeProvider=new FakeProvider(join(directory,'fake-provider.sqlite'));
  t.after(()=>{if(store.db.open)store.close();if(fakeProvider.db.open)fakeProvider.close();rmSync(directory,{recursive:true,force:true});});
  const calls={prepare:0,start:0,lookup:0,api:0,credentials:0},transport={
    async prepare(input){calls.prepare++;return {runtime:{version:1,runtimeVersion:'0.153.4',runtimeDigest:'a'.repeat(64),configurationDigest:'b'.repeat(64),model:'gpt-6-astra',authMode:'chatgpt'},
      session:{threadId:'thread-injected',turnInputDigest:describeCodexImageInput(input).turnInputDigest}};},
    async start(){calls.start++;return {kind:'unknown',code:'INJECTED_UNKNOWN'};},
    async lookup(){calls.lookup++;return {kind:'unknown',code:'INJECTED_UNKNOWN'};},
  };
  const options={store,fakeProvider,dataDirectory:directory,ffmpegPath,ffprobePath,configuration:codexRuntimeConfiguration(),
    credentials:new EnvironmentMediaCredentials(()=>{calls.credentials++;return undefined;}),
    providerConfiguration:{version:1,profiles:[{label:'Codex image',profile:codex},{label:'Direct image API',profile:api}]},
    transport:{codexImage:transport,imageFetch:async()=>{calls.api++;throw Error('Unexpected API fallback');}},...changes};
  const f={directory,store,fakeProvider,calls,transport,options};
  f.build=()=>{f.runtime=createMediaExecutionRuntime(options);f.production=new ProductionService(store,f.runtime.engine,DEFAULT_PROFILES,f.runtime.productionOptions);return f.runtime;};
  f.seed=async(settings={}, {unscoped=false}={})=>{
    const selection=f.runtime.providerCatalog.select(f.runtime.providerCatalog.digest,[codex.id]),created=f.production.createProject('Codex runtime test',selection);
    const project=store.saveProject({...projectFixture(created.id,1),capabilityLockId:created.capabilityLockId},created.headVersion);
    const human=f.production.beginRequest(project.id,'local-user','Create the exact requested keyframe');
    f.production.authorize(project.id,human,[{scopeId:unscoped?project.id:project.shots[0].id,kind:'image'}],newId(),'initial_slot');
    const source=`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{return p.image("frame",{${unscoped?'':`intent:p.shot(${JSON.stringify(project.shots[0].id)}),`}profile:${JSON.stringify(codex.id)},prompt:${JSON.stringify(project.shots[0].imagePrompt)}${Object.entries(settings).map(([key,value])=>`,${key}:${JSON.stringify(value)}`).join('')}});});`;
    const prepared=await f.production.prepare(project.id,human,{variant:'plan',expectedHeadVersion:project.headVersion,source});f.production.apply(project.id,human,prepared.id);
    const binding=store.list('node_binding',project.id).find(row=>row.node.kind==='image');return {projectId:project.id,binding,human,profile:codex};
  };
  f.issue=selected=>{
    const candidate=store.get('candidate',selected.binding.candidateId),input={profileDigest:selected.binding.node.args.profileDigest,profileDefinitionDigest:digest(codex),
      selections:[{candidateId:candidate.id,nodeId:selected.binding.id,specDigest:selected.binding.node.specDigest}],maxAttempts:1,maxEstimatedMicros:'0',expiresAt:new Date(Date.now()+3600000).toISOString()};
    const human=f.production.beginRequest(selected.projectId,'local-user','Approve one Codex start',{editing:false,contextDigest:allowanceIssueContextDigest(selected.projectId,input)});
    return f.runtime.allowances.issue(selected.projectId,human,input);
  };
  return f;
}
export const codexRowCounts=f=>Object.fromEntries(['entities','commands','events'].map(table=>[table,f.store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n]));

