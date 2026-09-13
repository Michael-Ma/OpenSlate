import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,digest} from '@openslate/core';
import {createInstallationBackup,inspectInstallationBackup} from '../dist/persistence/installation-backup.js';
import {restoreInstallationBackup} from '../dist/persistence/installation-restore.js';
import {InstallationRecoveryGuard,releaseRecovery} from '../dist/application/installation-recovery.js';
import {transcriptSelectionFixture,selection,key,rows,bodies,acceptSelected} from './transcript-selection-fixture.mjs';

const backup=f=>createInstallationBackup({sourceRoot:f.root,destination:f.backupDirectory});
async function adopted(t){
 const f=await transcriptSelectionFixture(t);await f.narration.useTranscriptWords(f.project.id,f.human,selection(f,{startWordIndex:1}));await f.narration.useTranscriptTiming(f.project.id,f.human,selection(f,{startWordIndex:1}));acceptSelected(f);
 const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);return f;
}

test('actual same-root restore retains transcript selection closure without granting imported editorial or submission authority',async t=>{
 const f=await adopted(t),input=selection(f,{startWordIndex:1}),before=f.view(),saved=f.canonical.workspaceCurrent(f.project.id),candidate=digest(f.candidate),oldHuman=f.human,calls={...f.calls};
 const protectedRows=bodies(f,['narration_transcript_selection','narration_segment','narration_cue','narration_acceptance','narration_canonical','transcript_candidate','artifact']);
 f.store.close();const copied=await backup(f);assert.deepEqual(await inspectInstallationBackup({directory:copied.directory}),copied);
 const rawPath=`artifacts/${f.project.id}/${f.candidate.raw.sha256}.json`;assert.deepEqual(readFileSync(join(copied.directory,rawPath)),readFileSync(f.rawArtifact.path));
 renameSync(f.root,f.archiveDirectory);const restored=await restoreInstallationBackup({directory:copied.directory,destination:f.root});assert.equal(restored.status,'restored');f.open();
 await assert.rejects(f.narration.useTranscriptTiming(f.project.id,oldHuman,input),{code:'INSTALLATION_QUARANTINED'});
 const guard=new InstallationRecoveryGuard(f.store),review=guard.snapshot();releaseRecovery(f.store,{restoreId:review.receipt.restoreId,expectedReceiptDigest:review.receiptDigest,expectedSummaryDigest:review.summaryDigest},{principalId:'offline-human',commandId:key()});
 await assert.rejects(f.narration.useTranscriptTiming(f.project.id,oldHuman,input),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 f.human=f.production.beginRequest(f.project.id,'offline-human','Use this restored transcript through a fresh human request');const result=await f.narration.useTranscriptTiming(f.project.id,f.human,selection(f,{startWordIndex:1}));
 assert.deepEqual(result,before);assert.deepEqual(f.canonical.workspaceCurrent(f.project.id),saved);assert.equal(bodies(f,['narration_transcript_selection','narration_segment','narration_cue','narration_acceptance','narration_canonical','transcript_candidate','artifact']),protectedRows);
 assert.equal(f.store.get('execution_control',f.project.id).paused,true);assert.throws(()=>guard.assertFirstSubmit(f.project.id,f.attempt.id),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});assert.equal(digest(f.store.get('transcript_candidate',f.candidate.id)),candidate);assert.deepEqual(f.calls,calls);
});

test('Store rejects stripped output and canonical transcript provenance or altered accepted geometry',async t=>{
 const f=await adopted(t),saved=f.canonical.workspaceCurrent(f.project.id),script=f.view().segments[0].script,cue=f.view().segments[0].cue;
 const withoutWriting={...script};delete withoutWriting.transcriptSelectionId;assert.throws(()=>f.store.put('narration_segment',script.id,f.project.id,withoutWriting));
 const withoutTiming={...cue,method:'human'};delete withoutTiming.transcriptSelectionId;assert.throws(()=>f.store.put('narration_cue',cue.id,f.project.id,withoutTiming));
 for(const alter of [value=>delete value.segments[0].transcriptProvenance,value=>value.segments[0].audioPlacement.startSample++,value=>value.segments[0].cue.meaning='Unaccepted meaning',value=>value.segments[0].transcriptProvenance.timing.selectionDigest='f'.repeat(64),
  value=>value.segments[0].provenance.audioId=key(),value=>value.segments[0].provenance.declaredOrigin='generated',value=>value.segments[0].provenance.originalSha256='f'.repeat(64),value=>value.segments[0].provenance.toolchainDigest='f'.repeat(64)]){
  const copy=structuredClone(saved);copy.id=key();alter(copy);assert.throws(()=>f.store.insert('narration_canonical',copy.id,f.project.id,copy));
 }
 const selectionRow=rows(f,'narration_transcript_selection')[0];assert.throws(()=>f.store.put('narration_transcript_selection',selectionRow.id,f.project.id,{...selectionRow,selectedTextDigest:'f'.repeat(64)}));
 assert.deepEqual(f.canonical.workspaceCurrent(f.project.id),saved);assert.deepEqual(f.calls,f.initialCalls);
});

test('backup independently rejects raw SQL marker removal, altered selection, missing output and missing response bytes',async t=>{
 for(const damage of ['script_marker','cue_marker','canonical_marker','selection','output_missing','raw_missing','acceptance_request','supplied_provenance']){
  const f=await adopted(t),view=f.view().segments[0],canonicalValue=f.canonical.workspaceCurrent(f.project.id);
  let kind,id,value;
  if(damage==='raw_missing')unlinkSync(f.rawArtifact.path);
  else if(damage==='output_missing')f.store.db.prepare("DELETE FROM entities WHERE kind='narration_cue' AND id=?").run(view.cue.id);
  else{
   if(damage==='script_marker'){kind='narration_segment';id=view.script.id;value={...view.script};delete value.transcriptSelectionId;}
   else if(damage==='cue_marker'){kind='narration_cue';id=view.cue.id;value={...view.cue,method:'human'};delete value.transcriptSelectionId;}
   else if(damage==='canonical_marker'){kind='narration_canonical';id=canonicalValue.id;value=canonicalValue;delete value.segments[0].transcriptProvenance;}
   else if(damage==='supplied_provenance'){kind='narration_canonical';id=canonicalValue.id;value=canonicalValue;value.segments[0].provenance.declaredOrigin='generated';}
   else if(damage==='selection'){kind='narration_transcript_selection';id=view.cue.transcriptSelectionId;value={...f.store.get(kind,id),selectedTextDigest:'f'.repeat(64)};}
   else{kind='narration_acceptance';id=view.entry.timingAcceptanceId;value={...f.store.get(kind,id),requestId:'missing-human-request'};}
   f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical(value),kind,id);
  }
  await assert.rejects(backup(f));assert.deepEqual(f.calls,f.initialCalls);
 }
});

test('placement-only edits keep source timing provenance and validate against the later narration revision',async t=>{
 const f=await adopted(t),before=f.view().segments[0],prior=f.canonical.workspaceCurrent(f.project.id),selectionBefore=bodies(f,['narration_transcript_selection']);
 f.narration.placeSegments(f.project.id,f.human,f.view().state.version,key(),[{segmentId:before.entry.segmentId,atSample:24001}]);const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);
 const saved=f.canonical.workspaceCurrent(f.project.id);assert.deepEqual(saved.segments[0].transcriptProvenance,prior.segments[0].transcriptProvenance);assert.equal(saved.segments[0].audioPlacement.atSample,24001);assert.deepEqual(f.view().segments[0].cue,before.cue);assert.equal(bodies(f,['narration_transcript_selection']),selectionBefore);
 const copied=await backup(f);assert.deepEqual(await inspectInstallationBackup({directory:copied.directory}),copied);assert.deepEqual(f.calls,f.initialCalls);
});
