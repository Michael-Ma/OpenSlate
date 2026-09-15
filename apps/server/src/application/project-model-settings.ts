import { canonical,composeModelProfilesIsolated,digest,invariant,newId,requiredStages,stageInputDigest,STAGE_CONTRACTS,STAGE_CONTRACTS_DIGEST,RECIPE_DIGEST } from '@openslate/core';
import type { CompiledPlan,OperationKind,ProviderProfile,ProjectRecord,StageRequirement } from '@openslate/core';
import type { Attempt,NodeBinding,PlanRecord } from '../execution/engine.js';
import type { ProductionService } from './service.js';
import { InstalledProviderCatalog,selectedProviderProfiles } from './provider-catalog.js';
import { ownedTranscriptionCatalog,snapshotOwnedTranscriptionData } from '../narration/owned-transcription-records.js';
const kinds=['image','video','speech','transcription'] as const;
type MediaKind=typeof kinds[number];
type Selection=Record<MediaKind,string|null>;
export type ProjectModelScope={kind:'unfinished'}|{kind:'shots';shotIds:string[]};
export interface ProjectModelPreviewInput {expectedHeadVersion:number;expectedSelectionDigest:string;expectedCatalogDigest:string;profileIds:string[];scope:ProjectModelScope}
export interface ProjectModelApplyInput {previewId:string;previewDigest:string;key:string}
interface Lock {id:string;projectId:string;profiles:ProviderProfile[];recipeDigest:string;stageContractsDigest:string;preferredProfileIds?:Selection;[key:string]:unknown}
interface Work {nodeId:string;alias:string;kind:OperationKind;shotId:string|null}
export interface ProjectModelPreview {version:1;id:string;previewDigest:string;projectId:string;base:{headVersion:number;revisionId:string;capabilityLockId:string;selectionDigest:string;catalogDigest:string};
  selected:Selection;scope:ProjectModelScope;changes:Array<Work&{fromProfileId:string;toProfileId:string}>;
  preserved:Array<Work&{reason:'completed'|'in_flight'|'reviewed_audio'|'protected_dependency'|'outside_scope'|'unchanged'}>;
  counts:{changed:number;preserved:number};generationApprovalRequired:boolean;allowanceRequired:boolean;notice:string}
export interface ProjectModelReceipt {previewId:string;previewDigest:string;projectId:string;headVersion:number;revisionId:string;capabilityLockId:string;activePlanId:string|null;changedNodeIds:string[];requestId:null}
interface SavedPreview {id:string;projectId:string;version:1;input:ProjectModelPreviewInput;projectDigest:string;lockDigest:string;workDigest:string;logicalIds:Record<string,string>;
  profiles:ProviderProfile[];selected:Selection;compiled:CompiledPlan|null;resetNodeIds:string[];view:Omit<ProjectModelPreview,'previewDigest'>}
const stop=(signal?:AbortSignal):void=>invariant(!signal?.aborted,'MODEL_SETTINGS_CANCELLED','Model settings were cancelled');
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const empty=(value:object):boolean=>Object.keys(value).length===0;
const fail=(value:unknown,message:string):void=>invariant(value,'MODEL_SETTINGS_STALE',message);

/** Authenticated local settings only. This service issues no generation grants, allowance or model calls. */
export class ProjectModelSettings {
  constructor(readonly service:ProductionService,readonly catalog:InstalledProviderCatalog){}
  private lock(projectId:string):{project:ProjectRecord;lock:Lock}{const project=this.service.store.getProject(projectId),lock=this.service.store.get<Lock>('capability_lock',project.capabilityLockId);
    fail(lock&&lock.projectId===projectId&&lock.id===project.capabilityLockId&&Array.isArray(lock.profiles)&&lock.profiles.length<=64,'Project model lock is missing');return {project,lock:lock!};}
  private selected(lock:Lock):Selection{return Object.fromEntries(kinds.map(kind=>[kind,lock.preferredProfileIds?.[kind]??lock.profiles.find(profile=>profile.kind===kind)?.id??null])) as Selection;}
  status(projectId:string){const {project,lock}=this.lock(projectId),selected=this.selected(lock);return {version:1 as const,projectId,headVersion:project.headVersion,revisionId:project.revisionId,
    capabilityLockId:project.capabilityLockId,selectionDigest:digest({lockId:lock.id,selected}),catalogDigest:this.catalog.digest,selected,options:this.catalog.view().profiles};}
  private capture(projectId:string,input:ProjectModelPreviewInput){
    const data=snapshotOwnedTranscriptionData(input,32768);invariant(data&&Object.keys(data).length===5&&Number.isSafeInteger(data.expectedHeadVersion)&&data.expectedHeadVersion>=0
      &&hash(data.expectedSelectionDigest)&&hash(data.expectedCatalogDigest)&&Array.isArray(data.profileIds)&&data.profileIds.length>=1&&data.profileIds.length<=4&&data.profileIds.every(id)
      &&data.scope&&['unfinished','shots'].includes(data.scope.kind),'VALIDATION_ERROR','Choose the displayed model settings and scope');
    if(data.scope.kind==='unfinished')invariant(Object.keys(data.scope).length===1,'VALIDATION_ERROR','Unsupported model scope');
    else invariant(Object.keys(data.scope).length===2&&Array.isArray(data.scope.shotIds)&&data.scope.shotIds.length>0&&data.scope.shotIds.length<=400
      &&data.scope.shotIds.every(id)&&new Set(data.scope.shotIds).size===data.scope.shotIds.length,'VALIDATION_ERROR','Select distinct project shots');
    const status=this.status(projectId);fail(status.headVersion===data.expectedHeadVersion&&status.selectionDigest===data.expectedSelectionDigest&&status.catalogDigest===data.expectedCatalogDigest,'Model selection or project changed; refresh the preview');return data;
  }
  private work(projectId:string){
    const store=this.service.store,project=store.getProject(projectId);
    const inventory=store.db.prepare("SELECT id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='node_binding' AND project_id=? AND json_extract(body,'$.state')='active' AND json_extract(body,'$.planId')=? ORDER BY rowid LIMIT 1601").all(projectId,project.activePlanId) as {id:string;bytes:number}[];
    invariant(inventory.length<=1600&&inventory.every(row=>row.bytes<=65536)&&inventory.reduce((total,row)=>total+row.bytes,0)<=16*1024**2,'MODEL_SETTINGS_LIMIT','Project plan exceeds the settings bound');
    const bindings=inventory.map(row=>store.get<NodeBinding>('node_binding',row.id)!);
    // Aggregate attempts before loading only current bindings; large provider history is never copied into the preview.
    const active=store.db.prepare("SELECT DISTINCT json_extract(body,'$.nodeId') nodeId FROM entities WHERE kind='attempt' AND project_id=? AND json_extract(body,'$.phase') NOT IN ('succeeded','failed') LIMIT 1601").all(projectId) as {nodeId:string}[];
    invariant(active.length<=1600,'MODEL_SETTINGS_LIMIT','Active work exceeds its bound');const activeIds=new Set(active.map(row=>row.nodeId));
    const reviewed=new Set(bindings.filter(binding=>{const candidate=binding.candidateId?store.get<{grantId:string}>('candidate',binding.candidateId):undefined;
      return candidate&&(store.get('narration_speech_review',candidate.grantId)||store.get('owned_transcription_review',candidate.grantId));}).map(binding=>binding.id));
    return {bindings,activeIds,reviewed,digest:digest({bindings,activeIds:[...activeIds].sort(),reviewed:[...reviewed].sort()})};
  }
  private async assess(projectId:string,input:ProjectModelPreviewInput,signal?:AbortSignal):Promise<Omit<SavedPreview,'id'|'view'>&{view:Omit<ProjectModelPreview,'previewDigest'|'id'>}>{
    stop(signal);const data=this.capture(projectId,input),{project,lock}=this.lock(projectId),work=this.work(projectId);
    fail(lock.recipeDigest===RECIPE_DIGEST&&lock.stageContractsDigest===STAGE_CONTRACTS_DIGEST,'Project workflow lock needs a supported version');
    if(data.scope.kind==='shots')fail(data.scope.shotIds.every(id=>project.shots.some(shot=>shot.id===id)),'Selected shot is not in this project');
    const chosen=selectedProviderProfiles(this.catalog.select(data.expectedCatalogDigest,data.profileIds)),selected=Object.fromEntries(kinds.map(kind=>[kind,chosen.profiles.find(profile=>profile.kind===kind)?.id??null])) as Selection;
    const profiles=[...chosen.profiles];for(const old of lock.profiles){const present=profiles.find(profile=>profile.id===old.id);fail(!present||canonical(present)===canonical(old),'A saved profile ID was redefined; install the new definition under a distinct profile ID');if(!present)profiles.push(old);}
    invariant(profiles.length<=64&&Buffer.byteLength(canonical(profiles))<=65536,'MODEL_SETTINGS_LIMIT','Retained model definitions exceed the project limit');
    const protectedReasons=new Map<string,ProjectModelPreview['preserved'][number]['reason']>();
    for(const binding of work.bindings){if(!empty(binding.outputs))protectedReasons.set(binding.id,'completed');else if(work.activeIds.has(binding.id))protectedReasons.set(binding.id,'in_flight');else if(work.reviewed.has(binding.id))protectedReasons.set(binding.id,'reviewed_audio');}
    const byId=new Map(work.bindings.map(binding=>[binding.id,binding]));
    const protect=(nodeId:string):void=>{const binding=byId.get(nodeId);if(!binding)return;for(const input of binding.node.inputs)if(input.source.kind==='output'&&!protectedReasons.has(input.source.nodeId)){protectedReasons.set(input.source.nodeId,'protected_dependency');protect(input.source.nodeId);}};
    for(const nodeId of [...protectedReasons.keys()])protect(nodeId);
    const replacements:Array<{nodeId:string;profileId:string}>=[],preserved:ProjectModelPreview['preserved']=[];
    for(const binding of work.bindings){const node=binding.node;const brief={nodeId:node.id,alias:node.alias,kind:node.kind,shotId:node.shotId};
      if(!kinds.includes(node.kind as MediaKind)){preserved.push({...brief,reason:protectedReasons.get(node.id)??'unchanged'});continue;}
      const outside=data.scope.kind==='shots'&&(!node.shotId||!data.scope.shotIds.includes(node.shotId));const preferred=selected[node.kind as MediaKind];
      const reason=protectedReasons.get(node.id)??(outside?'outside_scope':preferred===node.args.profileIdentity?'unchanged':null);
      if(reason||!preferred)preserved.push({...brief,reason:reason??'unchanged'});else replacements.push({nodeId:node.id,profileId:preferred});
    }
    const plan=project.activePlanId?this.service.store.get<PlanRecord>('plan',project.activePlanId):undefined;
    invariant(lock.localExecution||!replacements.some(change=>['minimax-h3','viggle-h3'].includes(profiles.find(profile=>profile.id===change.profileId)!.adapter)),
      'LOCAL_EXECUTION_UPGRADE_REQUIRED','Preserve this project’s current video work and ask the director to prepare a compatible plan before selecting H3 for pending videos. Image and audio defaults can still be changed.');
    fail(!project.activePlanId||plan?.projectId===projectId,'Current plan is missing');
    const logicalIds={...(this.service.store.get<{aliases:Record<string,string>}>('logical_ids',projectId)?.aliases??{})};
    const old=plan?.compiled??null,transcriptionInputs=ownedTranscriptionCatalog(this.service.store,projectId,old);
    const compiled=old&&replacements.length?await composeModelProfilesIsolated(old,replacements,{project,profiles,logicalIds,allocateId:newId,
      ...(transcriptionInputs.length?{transcriptionInputs}:{}),...(lock.localExecution?{localExecution:lock.localExecution as never}:{})},signal?{signal}:{}):old;
    stop(signal);const reset=new Set(replacements.map(value=>value.nodeId));
    if(compiled)for(let i=0;i<compiled.nodes.length;i++)for(const node of compiled.nodes)if(!reset.has(node.id)&&node.inputs.some(input=>input.source.kind==='output'&&reset.has(input.source.nodeId)))reset.add(node.id);
    fail([...reset].every(nodeId=>!protectedReasons.has(nodeId)),'Model change would replace completed, reviewed or in-flight work');
    const changes:ProjectModelPreview['changes']=compiled?compiled.nodes.filter(node=>reset.has(node.id)).map(node=>({nodeId:node.id,alias:node.alias,kind:node.kind,shotId:node.shotId,
      fromProfileId:String(byId.get(node.id)!.node.args.profileIdentity??'local-assembly'),toProfileId:String(node.args.profileIdentity??'local-assembly')})):[];
    const changedIds=new Set(changes.map(change=>change.nodeId)),kept=preserved.filter(row=>!changedIds.has(row.nodeId));
    const status=this.status(projectId);fail(status.headVersion===data.expectedHeadVersion&&this.work(projectId).digest===work.digest,'Work changed while preview was being prepared');
    return {version:1,projectId,input:data,projectDigest:digest(project),lockDigest:digest(lock),workDigest:work.digest,logicalIds,profiles,selected,compiled,resetNodeIds:[...reset],
      view:{version:1,projectId,base:{headVersion:project.headVersion,revisionId:project.revisionId,capabilityLockId:project.capabilityLockId,selectionDigest:status.selectionDigest,catalogDigest:this.catalog.digest},selected,scope:data.scope,
        changes,preserved:kept,counts:{changed:changes.length,preserved:kept.length},generationApprovalRequired:changes.some(row=>kinds.includes(row.kind as MediaKind)),allowanceRequired:changes.some(row=>kinds.includes(row.kind as MediaKind)),
        notice:'Completed and in-flight work stays on its original model. Changed pending work needs fresh generation review and its own allowance. Model settings do not start generation.'}};
  }
  async preview(projectId:string,input:ProjectModelPreviewInput,options:{signal?:AbortSignal}={}):Promise<ProjectModelPreview>{
    const signal=options.signal;this.service.recovery.assertWritable(projectId);const value=await this.assess(projectId,input,signal);stop(signal);
    return this.service.store.transaction(()=>{this.service.recovery.assertWritable(projectId);this.capture(projectId,value.input);fail(this.work(projectId).digest===value.workDigest,'Work changed before preview storage');
      const id=newId(),saved:SavedPreview={...value,id,view:{...value.view,id}};this.service.store.insert('project_model_preview',id,projectId,saved);return {...saved.view,previewDigest:digest(saved)};});
  }
  async apply(projectId:string,input:ProjectModelApplyInput,options:{signal?:AbortSignal}={}):Promise<{receipt:ProjectModelReceipt;status:ReturnType<ProjectModelSettings['status']>}>{
    const signal=options.signal,data=snapshotOwnedTranscriptionData(input,32768);stop(signal);invariant(data&&Object.keys(data).length===3&&id(data.previewId)&&hash(data.previewDigest)&&id(data.key),'VALIDATION_ERROR','Apply the exact model preview');
    this.service.recovery.assertWritable(projectId);this.service.recovery.assertFreshAuthority(projectId,'project_model_preview',data.previewId);
    const scope=`local-user:${projectId}:model-settings`,requestDigest=digest(data),previous=this.service.store.commandReplay<ProjectModelReceipt>(scope,data.key,requestDigest);
    if(previous)return {receipt:previous.result,status:this.status(projectId)};
    const saved=this.service.store.get<SavedPreview>('project_model_preview',data.previewId);fail(saved&&saved.projectId===projectId&&digest(saved)===data.previewDigest,'Model preview is missing or changed');
    const fresh=await this.assess(projectId,saved!.input,signal);fail(canonical({...fresh,id:saved!.id,view:{...fresh.view,id:saved!.id}})===canonical(saved),'Model preview no longer matches its exact inputs');stop(signal);
    const receipt=this.service.store.transaction(()=>{
      this.service.recovery.assertWritable(projectId);this.service.recovery.assertFreshAuthority(projectId,'project_model_preview',data.previewId);
      return this.service.store.command(scope,data.key,requestDigest,()=>{
        stop(signal);const {project,lock}=this.lock(projectId);fail(digest(project)===saved!.projectDigest&&digest(lock)===saved!.lockDigest&&this.work(projectId).digest===saved!.workDigest,'Project or pending work changed before applying model settings');
        this.capture(projectId,saved!.input);
        if(canonical(this.selected(lock))===canonical(saved!.selected)&&saved!.resetNodeIds.length===0)return {previewId:saved!.id,previewDigest:data.previewDigest,projectId,headVersion:project.headVersion,
          revisionId:project.revisionId,capabilityLockId:project.capabilityLockId,activePlanId:project.activePlanId,changedNodeIds:[],requestId:null};
        const lockId=newId(),newLock={...lock,id:lockId,profiles:saved!.profiles,preferredProfileIds:saved!.selected,providerSelection:{catalogDigest:this.catalog.digest,profileIds:kinds.map(kind=>saved!.selected[kind]).filter(Boolean)}};
        this.service.store.insert('capability_lock',lockId,projectId,newLock);
        const planId=saved!.resetNodeIds.length?newId():project.activePlanId;
        if(saved!.resetNodeIds.length)this.service.engine.installModelSettingsPlan(projectId,planId!,saved!.compiled!,saved!.resetNodeIds);
        const next=this.service.store.saveProject({...project,capabilityLockId:lockId,activePlanId:planId,revisionId:newId()},project.headVersion);
        this.service.store.insert('project_revision',next.revisionId,projectId,{project:next});
        if(saved!.resetNodeIds.length)this.refreshStages(project,next,saved!.compiled!);
        for(const epoch of this.service.store.list<{id:string;state:string}>('epoch',projectId))if(epoch.state!=='revoked')this.service.store.put('epoch',epoch.id,projectId,{...epoch,state:'revoked'});
        this.service.store.appendEvent(projectId,'project.models_changed',{previewId:saved!.id,previousLockId:lock.id,lockId,planId,changedNodeIds:saved!.resetNodeIds,principalId:'local-user'});
        return {previewId:saved!.id,previewDigest:data.previewDigest,projectId,headVersion:next.headVersion,revisionId:next.revisionId,capabilityLockId:lockId,activePlanId:planId,changedNodeIds:saved!.resetNodeIds,requestId:null};
      });
    });return {receipt,status:this.status(projectId)};
  }
  private refreshStages(before:ProjectRecord,next:ProjectRecord,compiled:CompiledPlan):void{
    for(const stage of requiredStages(before,next,compiled)){const id=digest({projectId:next.id,stageId:stage.stageId,scopeId:stage.scopeId}),old=this.service.store.get<StageRequirement&{bindingVersion:number;progressVersion:number;inputDigest:string;outputDigest:string}>('stage',id);
      const inputDigest=stageInputDigest(next,stage),outputDigest=digest(compiled.nodes.filter(n=>stage.scopeId===next.id||n.shotId===stage.scopeId||next.shots.some(s=>s.id===n.shotId&&s.sceneId===stage.scopeId)).map(n=>n.specDigest));
      const binding={...stage,id,projectId:next.id,inputDigest,outputDigest,bindingVersion:(old?.bindingVersion??0)+(old?.inputDigest===inputDigest&&old?.outputDigest===outputDigest?0:1),progressVersion:old?.progressVersion??0,contractDigest:digest(STAGE_CONTRACTS[stage.stageId])};
      this.service.store.put('stage',id,next.id,binding);if(!old||binding.bindingVersion!==old.bindingVersion)this.service.store.insert('stage_revision',newId(),next.id,{binding,source:'project_model_settings'});
    }
  }
}
