import { canonical, digest, invariant, providerProfileArguments } from '@openslate/core';
import type { ProviderProfile } from '@openslate/core';
import { describeCodexImageInput } from '@openslate/providers';
import type { CodexImageDescription, CodexImagePrepared, ExecutionRequest } from '@openslate/providers';
import type { Attempt } from './engine.js';
import { assertOutputReceiptIdentity } from './output-store.js';
import type { OutputReceipt } from './output-store.js';

interface Identity { id:string;projectId:string;version:1;attemptId:string;requestDigest:string }
export interface CodexImageExecutionMapping extends Identity {
  profileDigest:string;profileDefinitionDigest:string;profileDefinition:ProviderProfile;capabilityLockId:string;capabilityLockDigest:string;
  allowanceId:string;allowanceDigest:string;consumptionDigest:string;estimatedMicros:'0';
  transport:CodexImageDescription;native:CodexImagePrepared;references:Array<{artifactId:string;artifactDigest:string}>;
}
export interface CodexImageExecutionDispatch extends Identity { mappingDigest:string;threadId:string;turnInputDigest:string;createdAt:string }
export interface CodexImageExecutionRun extends Identity { mappingDigest:string;dispatchDigest:string;threadId:string;turnId:string }
export type CodexImageObservation = {kind:'not_dispatched';code:'LOCAL_INPUT_INVALID'|'LOCAL_NATIVE_UNAVAILABLE'|'LOCAL_CANCELLED'}
  | {kind:'failed';code:'USAGE_LIMIT'|'TURN_FAILED'|'IMAGE_FAILED';threadId:string;turnId:string}
  | {kind:'completed';threadId:string;turnId:string;itemId:string;revisedPrompt:string|null;outputReceiptId:string;
      output:{sha256:string;byteLength:number;width:number;height:number}};
export interface CodexImageExecutionResult extends Identity { mappingDigest:string|null;dispatchDigest:string|null;runDigest:string|null;observation:CodexImageObservation }
export const codexHash = (value:unknown):value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const codexId = (value:unknown):value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
export function codexFields(value:unknown,fields:string[]):asserts value is Record<string,unknown> {
  invariant(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value))
    && fields.every(key=>Object.hasOwn(value,key)) && Reflect.ownKeys(value).every(key=>typeof key==='string' && fields.includes(key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!,'value')), 'CODEX_IMAGE_EXECUTION_CONFLICT','Invalid exact Codex image record fields');
}
function base(attempt:Attempt,value:Identity,fields:string[]):void {
  codexFields(value,['id','projectId','version','attemptId','requestDigest',...fields]);
  invariant(value.version===1 && value.id===attempt.id && value.attemptId===attempt.id && value.projectId===attempt.projectId
    && value.requestDigest===digest(attempt.request) && attempt.request.execution?.adapter==='codex-image' && attempt.request.execution.version==='1'
    && attempt.request.kind==='image' && attempt.taskId===null && Buffer.byteLength(canonical(value))<=131072,
  'CODEX_IMAGE_EXECUTION_CONFLICT','Codex image record differs from its admitted attempt');
}
export function assertCodexImageOperationOptions(profile:ProviderProfile,args:ExecutionRequest['args']):void {
  const expected=providerProfileArguments(profile);
  codexFields(profile.configuration,['model','settings']); const settings=profile.configuration.settings; codexFields(settings,['runtimeVersion','directorModel','width','height']);
  codexFields(args,[...Object.keys(expected),'prompt','width','height','settings']); codexFields(args.settings,[]);
  invariant(profile.kind==='image' && profile.adapter==='codex-image' && profile.executionVersion==='1'
    && profile.unitCostMicros==='0' && profile.maxRetries===0 && profile.maxConcurrency===1
    && profile.configuration.model==='codex-image-generation' && settings.runtimeVersion==='0.153.4' && settings.directorModel==='gpt-6-astra'
    && settings.width===1024 && settings.height===1024 && args.width===settings.width && args.height===settings.height
    && Object.entries(expected).every(([key,value])=>canonical(args[key])===canonical(value)) && typeof args.prompt==='string',
  'CODEX_IMAGE_PREFLIGHT_INVALID','Codex image options must match the exact pinned usage profile');
  describeCodexImageInput({attemptId:'preflight',requestDigest:'a'.repeat(64),prompt:args.prompt,width:1024,height:1024,runtimeVersion:'0.153.4',model:'gpt-6-astra',images:[]});
}
export function assertCodexImageExecutionProfile(profile:ProviderProfile,attempt:Attempt):void {
  codexFields(profile,['id','revision','kind','adapter','executionVersion','configuration','maxConcurrency','unitCostMicros','maxRetries']);
  const args=providerProfileArguments(profile), saved=attempt.request.profile;
  invariant(saved && saved.id===profile.id && saved.revision===profile.revision && saved.digest===args.profileDigest
    && canonical(saved.configuration)===canonical(profile.configuration) && profile.adapter==='codex-image' && profile.executionVersion==='1'
    && profile.kind==='image' && profile.unitCostMicros==='0' && profile.maxConcurrency===1 && profile.maxRetries===0
    && Object.entries(args).every(([key,value])=>canonical(attempt.request.args[key])===canonical(value)),
  'CODEX_IMAGE_EXECUTION_CONFLICT','Codex image requires the consumed full profile definition');
}
export function assertCodexImageExecutionMapping(attempt:Attempt,mapping:CodexImageExecutionMapping):void {
  base(attempt,mapping,['profileDigest','profileDefinitionDigest','profileDefinition','capabilityLockId','capabilityLockDigest','allowanceId','allowanceDigest','consumptionDigest','estimatedMicros','transport','native','references']);
  assertCodexImageExecutionProfile(mapping.profileDefinition,attempt); assertCodexImageOperationOptions(mapping.profileDefinition,attempt.request.args);
  codexFields(mapping.native,['runtime','session']); codexFields(mapping.native.runtime,['version','runtimeVersion','runtimeDigest','configurationDigest','model','authMode']);
  codexFields(mapping.native.session,['threadId','turnInputDigest']);
  const runtime=mapping.native.runtime, transport=mapping.transport;
  invariant(mapping.profileDigest===attempt.request.profile!.digest && mapping.profileDefinitionDigest===digest(mapping.profileDefinition)
    && codexId(mapping.capabilityLockId) && codexHash(mapping.capabilityLockDigest) && mapping.allowanceId===attempt.request.externalAllowanceId
    && codexHash(mapping.allowanceDigest) && codexHash(mapping.consumptionDigest) && mapping.estimatedMicros==='0'
    && runtime.version===1 && runtime.runtimeVersion==='0.153.4' && runtime.model==='gpt-6-astra' && runtime.authMode==='chatgpt'
    && codexHash(runtime.runtimeDigest) && codexHash(runtime.configurationDigest) && codexId(mapping.native.session.threadId)
    && Array.isArray(transport.images) && canonical(transport)===canonical(describeCodexImageInput({attemptId:attempt.id,requestDigest:digest(attempt.request),
      prompt:attempt.request.args.prompt as string,width:1024,height:1024,runtimeVersion:'0.153.4',model:'gpt-6-astra',images:transport.images}))
    && mapping.native.session.turnInputDigest===transport.turnInputDigest && mapping.references.length===attempt.request.inputs.length
    && transport.images.length===attempt.request.inputs.length && mapping.references.every((ref,index)=>{
      codexFields(ref,['artifactId','artifactDigest']); const input=attempt.request.inputs[index],image=transport.images[index];
      return ref.artifactId===input?.artifactId && codexHash(ref.artifactDigest) && input.kind==='image' && image?.artifactId===input.artifactId && image.sha256===input.sha256;
    }), 'CODEX_IMAGE_EXECUTION_CONFLICT','Codex image mapping lost its exact turn input or native ChatGPT identity');
}
export function assertCodexImageExecutionDispatch(attempt:Attempt,mapping:CodexImageExecutionMapping,dispatch:CodexImageExecutionDispatch):void {
  base(attempt,dispatch,['mappingDigest','threadId','turnInputDigest','createdAt']); assertCodexImageExecutionMapping(attempt,mapping);
  invariant(dispatch.mappingDigest===digest(mapping) && dispatch.threadId===mapping.native.session.threadId && dispatch.turnInputDigest===mapping.transport.turnInputDigest
    && typeof dispatch.createdAt==='string' && dispatch.createdAt.length===24 && Number.isFinite(Date.parse(dispatch.createdAt)) && new Date(dispatch.createdAt).toISOString()===dispatch.createdAt,
  'CODEX_IMAGE_EXECUTION_CONFLICT','Codex start marker differs from its prepared native turn');
}
export function assertCodexImageExecutionRun(attempt:Attempt,mapping:CodexImageExecutionMapping,dispatch:CodexImageExecutionDispatch,run:CodexImageExecutionRun):void {
  base(attempt,run,['mappingDigest','dispatchDigest','threadId','turnId']); assertCodexImageExecutionDispatch(attempt,mapping,dispatch);
  invariant(run.mappingDigest===digest(mapping) && run.dispatchDigest===digest(dispatch) && run.threadId===dispatch.threadId && codexId(run.turnId),
    'CODEX_IMAGE_EXECUTION_CONFLICT','Codex observed turn differs from its irreversible marker');
}
export function assertCodexImageExecutionResult(attempt:Attempt,mapping:CodexImageExecutionMapping|undefined,dispatch:CodexImageExecutionDispatch|undefined,
  run:CodexImageExecutionRun|undefined,result:CodexImageExecutionResult,receipt?:OutputReceipt):void {
  base(attempt,result,['mappingDigest','dispatchDigest','runDigest','observation']);
  if(mapping) assertCodexImageExecutionMapping(attempt,mapping);
  if(dispatch){invariant(mapping,'CODEX_IMAGE_EXECUTION_CONFLICT','Marker requires mapping');assertCodexImageExecutionDispatch(attempt,mapping,dispatch);}
  if(run){invariant(mapping&&dispatch,'CODEX_IMAGE_EXECUTION_CONFLICT','Turn requires marker');assertCodexImageExecutionRun(attempt,mapping,dispatch,run);}
  invariant(result.mappingDigest===(mapping?digest(mapping):null) && result.dispatchDigest===(dispatch?digest(dispatch):null) && result.runDigest===(run?digest(run):null),
    'CODEX_IMAGE_EXECUTION_CONFLICT','Codex result lost its exact history');
  const value=result.observation;
  if(value.kind==='not_dispatched') {codexFields(value,['kind','code']);invariant(!dispatch&&!run&&['LOCAL_INPUT_INVALID','LOCAL_NATIVE_UNAVAILABLE','LOCAL_CANCELLED'].includes(value.code),
    'CODEX_IMAGE_EXECUTION_CONFLICT','Only a pre-marker local failure proves no start');return;}
  invariant(mapping&&dispatch&&run&&value.threadId===run.threadId&&value.turnId===run.turnId,'CODEX_IMAGE_EXECUTION_CONFLICT','Result belongs to another native turn');
  if(value.kind==='failed'){codexFields(value,['kind','code','threadId','turnId']);invariant(['USAGE_LIMIT','TURN_FAILED','IMAGE_FAILED'].includes(value.code),'CODEX_IMAGE_EXECUTION_CONFLICT','Invalid terminal native failure');return;}
  codexFields(value,['kind','threadId','turnId','itemId','revisedPrompt','outputReceiptId','output']);codexFields(value.output,['sha256','byteLength','width','height']);
  invariant(value.kind==='completed'&&codexId(value.itemId)&&(value.revisedPrompt===null||typeof value.revisedPrompt==='string'&&Buffer.byteLength(value.revisedPrompt)<=32768)
    &&codexHash(value.output.sha256)&&Number.isSafeInteger(value.output.byteLength)&&value.output.byteLength>=33&&value.output.byteLength<=32*1024**2
    &&[value.output.width,value.output.height].every(size=>Number.isSafeInteger(size)&&size>0&&size<=4096), 'CODEX_IMAGE_EXECUTION_CONFLICT','Invalid bounded native PNG result');
  invariant(receipt,'CODEX_IMAGE_EXECUTION_CONFLICT','Completed native image requires its output receipt');assertOutputReceiptIdentity(receipt,attempt);
  invariant(receipt.id===value.outputReceiptId&&receipt.vendorTaskId===null&&receipt.diagnosticRequestId===null&&receipt.port==='image'&&receipt.kind==='image'
    &&receipt.mimeType==='image/png'&&receipt.source.kind==='returned_bytes'&&receipt.source.sha256===value.output.sha256&&receipt.source.byteLength===value.output.byteLength,
  'CODEX_IMAGE_EXECUTION_CONFLICT','Native image result differs from its exact byte receipt');
}
