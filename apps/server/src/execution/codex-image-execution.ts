import { createHash } from 'node:crypto';
import { constants,mkdirSync,realpathSync } from 'node:fs';
import { open,realpath } from 'node:fs/promises';
import { isAbsolute,relative,sep } from 'node:path';
import { canonical,digest,invariant } from '@openslate/core';
import { assertExecutionRequest,describeCodexImageInput,inspectCodexImagePng,registerExecutionProvider } from '@openslate/providers';
import type { CodexImageInput,CodexImageOutcome,CodexImagePrepared,CodexImageTransport,ExecutionCallOptions,ExecutionOutcome,ExecutionProvider,ExecutionRequest } from '@openslate/providers';
import { InstallationRecoveryGuard } from '../application/installation-recovery.js';
import type { Store } from '../persistence/store.js';
import type { Attempt } from './engine.js';
import { ExecutionOutputStore } from './output-store.js';
import { assertCodexImageFirstDispatch,resolveCodexImageAdmission,resolveCodexImageReferences } from './codex-image-authority.js';
import type { CodexImageAdmission } from './codex-image-authority.js';
import { assertCodexImageOperationOptions } from './codex-image-receipts.js';
import type { CodexImageExecutionMapping,CodexImageExecutionDispatch,CodexImageExecutionRun,CodexImageExecutionResult,CodexImageObservation } from './codex-image-receipts.js';
import { assertCodexImageRecords,assertCodexImageSpoolLineage } from './codex-image-lineage.js';
const unknown=():ExecutionOutcome=>({type:'unknown',diagnostic:'Codex image outcome is unresolved; no automatic turn restart'});
const stopped=(signal?:AbortSignal):void=>invariant(!signal?.aborted,'CODEX_IMAGE_CANCELLED','Codex image work was cancelled');
const identity=(attempt:Attempt)=>({id:attempt.id,projectId:attempt.projectId,version:1 as const,attemptId:attempt.id,requestDigest:digest(attempt.request)});

/** Separate ChatGPT-usage adapter. One irreversible turn/start marker, never an Images API fallback. */
export class CodexImageExecution implements ExecutionProvider {
  readonly #store:Store; readonly #outputs:ExecutionOutputStore;readonly #transport:CodexImageTransport;readonly #root:string;readonly #recovery:InstallationRecoveryGuard;
  constructor(options:{store:Store;outputStore:ExecutionOutputStore;artifactRoot:string;transport:CodexImageTransport}) {
    invariant(options.outputStore.store===options.store&&isAbsolute(options.artifactRoot)&&options.artifactRoot!=='/','CODEX_IMAGE_CONFIGURATION','Use one store and an absolute private artifact root');
    this.#store=options.store;this.#outputs=options.outputStore;this.#transport=options.transport;this.#recovery=new InstallationRecoveryGuard(options.store);
    mkdirSync(options.artifactRoot,{recursive:true,mode:0o700});this.#root=realpathSync(options.artifactRoot);registerExecutionProvider(this,{adapter:'codex-image',version:'1'});
  }
  async submit(input:ExecutionRequest,options:ExecutionCallOptions={}):Promise<ExecutionOutcome> {
    const signal=options.signal,lease=options.expectedLease?{...options.expectedLease}:undefined,request=structuredClone(input);
    this.#recovery.assertWritable();assertExecutionRequest(this,request);
    const saved=this.#store.get<CodexImageExecutionMapping>('codex_image_execution_mapping',request.attemptId),admission=resolveCodexImageAdmission(this.#store,request,saved),attempt=admission.attempt;
    if(this.marked(attempt.id))return this.recover(attempt,signal);
    assertCodexImageFirstDispatch(this.#store,admission,lease);
    let prepared:CodexImageInput,mapping:CodexImageExecutionMapping;
    try {
      stopped(signal);assertCodexImageOperationOptions(admission.profile,request.args);
      prepared=await this.prepareInputs(attempt,signal);stopped(signal);
    }catch{return this.notDispatched(admission,lease,signal?.aborted?'LOCAL_CANCELLED':'LOCAL_INPUT_INVALID',signal);}
    let acquired:CodexImagePrepared|undefined;
    const release=async()=>{if(acquired&&!this.#store.get("codex_image_execution_dispatch",attempt.id))try{await this.#transport.release?.(acquired);}catch{/* bounded cleanup does not change authority */}};
    try {
      // Native prepare verifies the pinned runtime and ChatGPT auth and creates only an empty owned thread.
      const native=saved?.native??await this.#transport.prepare(structuredClone(prepared),signal?{signal}:{});acquired=structuredClone(native);stopped(signal);
      const refs=resolveCodexImageReferences(this.#store,attempt),value:CodexImageExecutionMapping={...identity(attempt),profileDigest:request.profile!.digest,
        profileDefinition:admission.profile,profileDefinitionDigest:digest(admission.profile),capabilityLockId:admission.capabilityLock.id,
        capabilityLockDigest:digest(admission.capabilityLock),allowanceId:admission.allowance.id,allowanceDigest:digest(admission.allowance),
        consumptionDigest:digest(admission.consumption),estimatedMicros:'0',transport:describeCodexImageInput(prepared),native:structuredClone(native),
        references:refs.map(ref=>({artifactId:ref.id,artifactDigest:digest(ref)}))};
      mapping=this.#store.transaction(()=>{
        stopped(signal);assertCodexImageFirstDispatch(this.#store,admission,lease);
        const prior=this.#store.get<CodexImageExecutionMapping>('codex_image_execution_mapping',attempt.id);
        if(prior){invariant(canonical(prior)===canonical(value),'CODEX_IMAGE_EXECUTION_CONFLICT','Native preparation changed');return prior;}
        invariant(!this.marked(attempt.id),'CODEX_IMAGE_EXECUTION_CONFLICT','Native turn was already claimed');
        return this.#store.insert('codex_image_execution_mapping',attempt.id,attempt.projectId,value);
      });
    }catch{await release();return this.notDispatched(admission,lease,signal?.aborted?'LOCAL_CANCELLED':'LOCAL_NATIVE_UNAVAILABLE',signal);}
    let claimed:boolean;
    try {claimed=this.#store.transaction(()=>{
      if(this.marked(attempt.id))return false;
      stopped(signal);assertCodexImageFirstDispatch(this.#store,admission,lease);
      assertCodexImageRecords(this.#store,attempt);
      this.#store.insert('codex_image_execution_dispatch',attempt.id,attempt.projectId,{...identity(attempt),mappingDigest:digest(mapping),
        threadId:mapping.native.session.threadId,turnInputDigest:mapping.transport.turnInputDigest,createdAt:new Date().toISOString()});return true;
    });}catch{await release();return unknown();}
    if(!claimed)return this.recover(attempt,signal);
    try {
      const observation=await this.#transport.start(structuredClone(mapping.native),structuredClone(prepared),{...(signal?{signal}:{}),
        observeTurn:async turnId=>{this.observeTurn(attempt,mapping,turnId);}});
      await this.observe(attempt,mapping,observation,signal);
    }catch{return unknown();}
    return this.recover(attempt,signal,false);
  }
  async lookup(attemptId:string,input?:Readonly<ExecutionRequest>,options:ExecutionCallOptions={}):Promise<ExecutionOutcome> {
    const signal=options.signal;this.#recovery.assertWritable();const saved=this.#store.get<Attempt>('attempt',attemptId);
    invariant(saved&&saved.id===attemptId&&(!input||input.attemptId===attemptId),'CODEX_IMAGE_EXECUTION_CONFLICT','Unknown native image attempt');
    const request=structuredClone(input??saved.request);assertExecutionRequest(this,request);
    const mapping=this.#store.get<CodexImageExecutionMapping>('codex_image_execution_mapping',attemptId);
    return this.recover(resolveCodexImageAdmission(this.#store,request,mapping).attempt,signal);
  }
  async poll(_taskId:string,input?:Readonly<ExecutionRequest>,options:ExecutionCallOptions={}):Promise<ExecutionOutcome> {
    this.#recovery.assertWritable();return input?this.lookup(input.attemptId,input,options):unknown();
  }
  private marked(id:string):boolean{return !!(this.#store.get('codex_image_execution_dispatch',id)||this.#store.get('codex_image_execution_result',id));}
  private observeTurn(attempt:Attempt,mapping:CodexImageExecutionMapping,turnId:string):CodexImageExecutionRun {
    return this.#store.transaction(()=>{
      this.#recovery.assertWritable();const dispatch=this.#store.get<CodexImageExecutionDispatch>('codex_image_execution_dispatch',attempt.id);
      invariant(dispatch,'CODEX_IMAGE_EXECUTION_CONFLICT','Native turn has no durable marker');
      return this.#store.put('codex_image_execution_run',attempt.id,attempt.projectId,{...identity(attempt),mappingDigest:digest(mapping),dispatchDigest:digest(dispatch),
        threadId:mapping.native.session.threadId,turnId});
    });
  }
  private saveResult(attempt:Attempt,observation:CodexImageObservation):CodexImageExecutionResult {
    const mapping=this.#store.get<CodexImageExecutionMapping>('codex_image_execution_mapping',attempt.id),dispatch=this.#store.get<CodexImageExecutionDispatch>('codex_image_execution_dispatch',attempt.id),
      run=this.#store.get<CodexImageExecutionRun>('codex_image_execution_run',attempt.id);
    return this.#store.put('codex_image_execution_result',attempt.id,attempt.projectId,{...identity(attempt),mappingDigest:mapping?digest(mapping):null,
      dispatchDigest:dispatch?digest(dispatch):null,runDigest:run?digest(run):null,observation});
  }
  private async observe(attempt:Attempt,mapping:CodexImageExecutionMapping,observation:CodexImageOutcome,signal?:AbortSignal):Promise<void> {
    if(observation.kind==='unknown')return;
    invariant(observation.threadId===mapping.native.session.threadId,'CODEX_IMAGE_EXECUTION_CONFLICT','Result came from another thread');
    this.observeTurn(attempt,mapping,observation.turnId);
    if(observation.kind==='pending')return;
    if(observation.kind==='failed'){this.#store.transaction(()=>this.saveResult(attempt,observation));return;}
    const bytes=Uint8Array.from(observation.bytes),output=inspectCodexImagePng(bytes);
    this.#store.transaction(()=>{
      this.#recovery.assertWritable();
      const receipt=this.#outputs.recordReceipt(attempt.projectId,{attemptId:attempt.id,expectedRequestDigest:digest(attempt.request),port:'image',kind:'image',mimeType:'image/png',
        vendorTaskId:null,diagnosticRequestId:null,source:{kind:'returned_bytes',sha256:output.sha256,byteLength:output.byteLength}});
      this.saveResult(attempt,{kind:'completed',threadId:observation.threadId,turnId:observation.turnId,itemId:observation.itemId,
        revisedPrompt:observation.revisedPrompt,outputReceiptId:receipt.id,output});
    });
    const result=this.#store.get<CodexImageExecutionResult>('codex_image_execution_result',attempt.id)!;
    if(result.observation.kind==='completed')await this.#outputs.spool(attempt.projectId,result.observation.outputReceiptId,async function*(){for(let offset=0;offset<bytes.byteLength;offset+=1024*1024)yield bytes.subarray(offset,offset+1024*1024);},signal?{signal}:{});
  }
  private async notDispatched(admission:CodexImageAdmission,lease:ExecutionCallOptions['expectedLease'],code:Extract<CodexImageObservation,{kind:'not_dispatched'}>['code'],signal?:AbortSignal):Promise<ExecutionOutcome> {
    this.#store.transaction(()=>{
      if(this.marked(admission.attempt.id))return;
      try{assertCodexImageFirstDispatch(this.#store,admission,lease);}catch{return;}
      this.saveResult(admission.attempt,{kind:'not_dispatched',code});
    });
    return this.recover(admission.attempt,signal,false);
  }
  private async recover(attempt:Attempt,signal?:AbortSignal,allowNative=true):Promise<ExecutionOutcome> {
    this.#recovery.assertWritable();let records=assertCodexImageRecords(this.#store,attempt);
    const local=async():Promise<ExecutionOutcome|null>=>{
      const value=records.result?.observation;
      if(value?.kind==='not_dispatched')return {type:'rejected',certainty:'not_accepted',failureId:`codex-image-${digest(records.result).slice(0,32)}`,technical:true,retryAllowed:false};
      // A model turn consumed usage even when the image tool failed. Never reinterpret it as a pre-start rejection.
      if(value?.kind==='failed')return unknown();
      if(value?.kind!=='completed')return null;
      try {
        await this.#outputs.recover(attempt.projectId,value.outputReceiptId,signal?{signal}:{});
        const completion=await this.#outputs.recoverCompletion(attempt.projectId,attempt.id,signal?{signal}:{});
        invariant(completion&&completion.outputs.length===1&&completion.outputs[0].storage.spoolId===value.outputReceiptId,
          'CODEX_IMAGE_EXECUTION_CONFLICT','Native result did not win its exact output slot');
        assertCodexImageSpoolLineage(this.#store,attempt,value.outputReceiptId);stopped(signal);return completion;
      }catch{return null;}
    };
    const prior=await local();if(prior)return prior;
    if(!allowNative||!records.mapping||!records.dispatch||records.result?.observation.kind==='failed'||signal?.aborted)return unknown();
    try {
      const observation=await this.#transport.lookup(structuredClone(records.mapping.native),{...(records.run?{turnId:records.run.turnId}:{}),...(signal?{signal}:{})});
      await this.observe(attempt,records.mapping,observation,signal);records=assertCodexImageRecords(this.#store,attempt);
      return await local()??unknown();
    }catch{return unknown();}
  }
  private async prepareInputs(attempt:Attempt,signal?:AbortSignal):Promise<CodexImageInput> {
    const references=resolveCodexImageReferences(this.#store,attempt),images:CodexImageInput['images']=[];
    for(const reference of references){
      stopped(signal);const path=await realpath(reference.path),child=relative(this.#root,path);
      invariant(path===reference.path&&child.length>0&&child!=='..'&&!child.startsWith(`..${sep}`)&&!isAbsolute(child),'CODEX_IMAGE_INPUT_INVALID','PNG reference is outside the managed root');
      const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
      try{const stat=await file.stat();invariant(stat.isFile()&&stat.size===reference.byteLength,'CODEX_IMAGE_INPUT_INVALID','PNG reference size changed');
        bytes=Buffer.alloc(stat.size+1);let offset=0;while(offset<bytes.length){stopped(signal);const read=await file.read(bytes,offset,bytes.length-offset,null);if(!read.bytesRead)break;offset+=read.bytesRead;}
        invariant(offset===stat.size&&createHash('sha256').update(bytes.subarray(0,offset)).digest('hex')===reference.artifact.sha256,'CODEX_IMAGE_INPUT_INVALID','PNG reference bytes changed');bytes=bytes.subarray(0,offset);
      }finally{await file.close();}
      stopped(signal);inspectCodexImagePng(bytes);images.push({artifactId:reference.id,sha256:reference.artifact.sha256,byteLength:bytes.byteLength,bytes});
    }
    return {attemptId:attempt.id,requestDigest:digest(attempt.request),prompt:attempt.request.args.prompt as string,width:1024,height:1024,runtimeVersion:'0.153.4',model:'gpt-6-astra',images};
  }
}
