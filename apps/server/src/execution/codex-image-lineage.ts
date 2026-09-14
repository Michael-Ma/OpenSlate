import { canonical,digest,invariant } from '@openslate/core';
import type { ArtifactRecord,Attempt } from './engine.js';
import type { OutputSpool } from './output-store.js';
import { resolveCodexImageAdmission,assertCodexImageMappingAdmission } from './codex-image-authority.js';
import type { CodexImageAuthorityStore } from './codex-image-authority.js';
import { assertCodexImageExecutionDispatch,assertCodexImageExecutionRun,assertCodexImageExecutionResult } from './codex-image-receipts.js';
import type { CodexImageExecutionMapping,CodexImageExecutionDispatch,CodexImageExecutionRun,CodexImageExecutionResult } from './codex-image-receipts.js';
export const CODEX_IMAGE_RECORD_KINDS=['codex_image_execution_mapping','codex_image_execution_dispatch','codex_image_execution_run','codex_image_execution_result'] as const;
/** Bounded keyed, historical closure; no current lease/authentication, native RPC, or filesystem reads. */
export function assertCodexImageRecords(reader:CodexImageAuthorityStore,attempt:Readonly<Attempt>) {
  invariant(attempt.request.execution?.adapter==='codex-image'&&attempt.request.execution.version==='1','CODEX_IMAGE_EXECUTION_CONFLICT','Unsupported Codex image identity');
  const read=<T>(kind:string):T|undefined=>{
    const meta=reader.db.prepare('SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind=? AND id=?').get(kind,attempt.id) as {project_id:string;bytes:number}|undefined;
    if(!meta)return undefined;
    invariant(meta.project_id===attempt.projectId&&meta.bytes>0&&meta.bytes<=131072,'CODEX_IMAGE_EXECUTION_CONFLICT','Native receipt row is foreign or oversized');
    return reader.get<T>(kind,attempt.id);
  };
  const mapping=read<CodexImageExecutionMapping>(CODEX_IMAGE_RECORD_KINDS[0]),dispatch=read<CodexImageExecutionDispatch>(CODEX_IMAGE_RECORD_KINDS[1]);
  const run=read<CodexImageExecutionRun>(CODEX_IMAGE_RECORD_KINDS[2]),result=read<CodexImageExecutionResult>(CODEX_IMAGE_RECORD_KINDS[3]);
  const admission=resolveCodexImageAdmission(reader,attempt.request,mapping);
  invariant(admission.attempt.id===attempt.id&&admission.attempt.projectId===attempt.projectId,'CODEX_IMAGE_EXECUTION_CONFLICT','Foreign native attempt');
  if(mapping)assertCodexImageMappingAdmission(admission,mapping);
  if(dispatch){invariant(mapping,'CODEX_IMAGE_EXECUTION_CONFLICT','Native marker lost mapping');assertCodexImageExecutionDispatch(attempt,mapping,dispatch);}
  if(run){invariant(mapping&&dispatch,'CODEX_IMAGE_EXECUTION_CONFLICT','Native turn lost marker');assertCodexImageExecutionRun(attempt,mapping,dispatch,run);}
  if(result)assertCodexImageExecutionResult(attempt,mapping,dispatch,run,result,result.observation.kind==='completed'?reader.get('execution_output_receipt',result.observation.outputReceiptId):undefined);
  return {mapping,dispatch,run,result,admission};
}
export function assertCodexImageSpoolLineage(reader:CodexImageAuthorityStore,attempt:Readonly<Attempt>,spoolId:string):void {
  if(attempt.request.execution?.adapter!=='codex-image')return;
  const {result}=assertCodexImageRecords(reader,attempt);
  invariant(result?.observation.kind==='completed','CODEX_IMAGE_EXECUTION_CONFLICT','Native PNG requires its exact completed image item');
  const value=result.observation,raw=value.output,spool=reader.get<OutputSpool>('execution_output_spool',spoolId);
  invariant(spool&&spoolId===value.outputReceiptId&&typeof spool.storageId==='string'&&spool.storageId.length<=160
    &&canonical(spool)===canonical({id:spoolId,projectId:attempt.projectId,version:1,storageId:spool.storageId,receiptId:spoolId,attemptId:attempt.id,
      requestDigest:digest(attempt.request),port:'image',sha256:raw.sha256,byteLength:raw.byteLength,blobKey:`${raw.sha256}.blob`}),
  'CODEX_IMAGE_EXECUTION_CONFLICT','Native PNG cannot substitute an equal-byte alternate receipt');
  const id=digest({projectId:attempt.projectId,attemptId:attempt.id,port:'image'}),slot=reader.get('execution_output_slot',id);
  invariant(canonical(slot)===canonical({id,projectId:attempt.projectId,version:1,storageId:spool.storageId,attemptId:attempt.id,port:'image',spoolId,
    sha256:raw.sha256,byteLength:raw.byteLength}), 'CODEX_IMAGE_EXECUTION_CONFLICT','Native image receipt did not win the exact output slot');
}
export function assertCodexImageArtifact(reader:CodexImageAuthorityStore,attempt:Readonly<Attempt>,artifact:ArtifactRecord):void {
  if(attempt.request.execution?.adapter!=='codex-image')return;
  invariant(typeof artifact.outputSpoolId==='string','CODEX_IMAGE_EXECUTION_CONFLICT','Native image publication requires its exact spool');
  assertCodexImageSpoolLineage(reader,attempt,artifact.outputSpoolId);
  const result=reader.get<CodexImageExecutionResult>('codex_image_execution_result',attempt.id)!;
  invariant(result.observation.kind==='completed','CODEX_IMAGE_EXECUTION_CONFLICT','Missing native completion');
  const output=result.observation.output,id=digest({version:1,projectId:attempt.projectId,attemptId:attempt.id,port:'image',spoolId:artifact.outputSpoolId});
  invariant(artifact.id===id&&artifact.projectId===attempt.projectId&&artifact.attemptId===attempt.id&&artifact.outputReceiptId===result.observation.outputReceiptId
    &&canonical(artifact.artifact)===canonical({artifactId:id,kind:'image',sha256:output.sha256})&&artifact.byteLength===output.byteLength
    &&artifact.width===output.width&&artifact.height===output.height&&artifact.fixture===false&&artifact.mimeType==='image/png'
    &&typeof artifact.validationDigest==='string'&&/^[a-f0-9]{64}$/.test(artifact.validationDigest)&&artifact.physicalDurationSeconds===null,
  'CODEX_IMAGE_EXECUTION_CONFLICT','Published PNG lost its native image item identity');
}
