import { canonical,digest,invariant } from '@openslate/core';
import { inspectCodexImagePng } from '@openslate/providers';
import type { ArtifactRecord,Attempt } from '../execution/engine.js';
import type { CodexImageAuthorityStore } from '../execution/codex-image-authority.js';
import { assertCodexImageRecords,assertCodexImageSpoolLineage,assertCodexImageArtifact } from '../execution/codex-image-lineage.js';
import type { OutputSpool } from '../execution/output-store.js';
type Row=Record<string,any>;
/** Portable application evidence only. Native homes/auth/session files are not prerequisites for a saved PNG. */
export function codexImageBackupClosure(reader:CodexImageAuthorityStore,readJson:(path:string)=>Promise<Row>,readArtifact:(artifact:ArtifactRecord)=>Promise<Buffer>) {
  const checked=new Set<string>();
  const applicable=(attempt:Attempt):boolean=>attempt.request.execution?.adapter==='codex-image';
  const records=async(attemptId:string):Promise<void>=>{
    if(checked.has(attemptId))return;
    const attempt=reader.get<Attempt>('attempt',attemptId);
    invariant(attempt&&attempt.id===attemptId,'BACKUP_REFERENCE_INVALID','Native image attempt is missing or miskeyed');
    const row=reader.db.prepare("SELECT project_id FROM entities WHERE kind='attempt' AND id=?").get(attemptId) as {project_id:string}|undefined;
    invariant(row?.project_id===attempt.projectId,'BACKUP_REFERENCE_INVALID','Native image attempt project differs');
    const {mapping}=assertCodexImageRecords(reader,attempt);
    if(mapping)for(const reference of mapping.references){
      const artifact=reader.get<ArtifactRecord>('artifact',reference.artifactId)!;
      const actual=inspectCodexImagePng(await readArtifact(artifact)),expected=mapping.transport.images.find(item=>item.artifactId===reference.artifactId)!;
      invariant(actual.sha256===expected.sha256&&actual.byteLength===expected.byteLength&&actual.width===artifact.width&&actual.height===artifact.height,
        'BACKUP_REFERENCE_INVALID','Native image reference bytes or dimensions differ');
    }
    checked.add(attemptId);
  };
  const overlayFor=async(attempt:Attempt,spoolId:string):Promise<CodexImageAuthorityStore>=>{
    const spool=await readJson(`execution-output/manifests/${spoolId}.json`) as OutputSpool,id=digest({projectId:attempt.projectId,attemptId:attempt.id,port:'image'}),slot=await readJson(`execution-output/slots/${id}.json`);
    for(const [kind,key,value] of [['execution_output_spool',spoolId,spool],['execution_output_slot',id,slot]] as const){
      const prior=reader.get(kind,key);invariant(!prior||canonical(prior)===canonical(value),'BACKUP_REFERENCE_INVALID','Native SQL and filesystem output disagree');
    }
    return {db:reader.db,getProject:id=>reader.getProject(id),get<T>(kind:string,key:string):T|undefined{
      if(kind==='execution_output_spool'&&key===spoolId)return spool as T;
      if(kind==='execution_output_slot'&&key===id)return slot as T;
      return reader.get<T>(kind,key);
    }};
  };
  const winning=async(attempt:Attempt,spoolId:string):Promise<void>=>{await records(attempt.id);assertCodexImageSpoolLineage(await overlayFor(attempt,spoolId),attempt,spoolId);};
  const artifact=async(value:ArtifactRecord):Promise<void>=>{
    const attempt=value.attemptId?reader.get<Attempt>('attempt',value.attemptId):undefined;if(!attempt||!applicable(attempt))return;
    await records(attempt.id);invariant(value.outputSpoolId,'BACKUP_REFERENCE_INVALID','Native artifact lost spool');
    assertCodexImageArtifact(await overlayFor(attempt,value.outputSpoolId),attempt,value);
    const actual=inspectCodexImagePng(await readArtifact(value));
    invariant(actual.sha256===value.artifact.sha256&&actual.byteLength===value.byteLength&&actual.width===value.width&&actual.height===value.height,
      'BACKUP_REFERENCE_INVALID','Published native PNG bytes differ');
  };
  return {applicable,records,winning,artifact};
}
