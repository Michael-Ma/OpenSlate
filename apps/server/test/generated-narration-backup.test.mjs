import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {canonical} from '@openslate/core';
import {createInstallationBackup,inspectInstallationBackup} from '../dist/persistence/installation-backup.js';
import {restoreInstallationBackup} from '../dist/persistence/installation-restore.js';
import {InstallationRecoveryGuard,releaseRecovery} from '../dist/application/installation-recovery.js';
import {generatedNarrationFixture,selection,acceptAll,key,rows,bodies} from './generated-narration-fixture.mjs';

const attach=(f,index=0)=>f.narration.attachGeneratedAudio(f.project.id,f.human,selection(f,index));
const backup=f=>createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,'backup')});

test('actual backup restore keeps verified generated narration selectable only through a fresh human request',async t=>{
 const f=await generatedNarrationFixture(t);await attach(f);const original=rows(f,'narration_audio')[0],project=canonical(f.store.getProject(f.project.id)),oldHuman=f.human,input=selection(f,1),calls={...f.calls};
 f.store.close();const copied=await backup(f);assert.deepEqual(await inspectInstallationBackup({directory:copied.directory}),copied);
 assert.ok(copied.manifest.files.some(file=>file.path===`media/blobs/${original.media.sha256}.wav`));assert.ok(copied.manifest.files.some(file=>file.path===`execution-output/manifests/${original.generation.outputReceiptId}.json`));
 renameSync(f.root,join(f.parent,'original-installation'));const restored=await restoreInstallationBackup({directory:copied.directory,destination:f.root});assert.equal(restored.status,'restored');f.open(true);
 await assert.rejects(f.narration.attachGeneratedAudio(f.project.id,oldHuman,input),{code:'INSTALLATION_QUARANTINED'});
 const guard=new InstallationRecoveryGuard(f.store),review=guard.snapshot();releaseRecovery(f.store,{restoreId:review.receipt.restoreId,expectedReceiptDigest:review.receiptDigest,expectedSummaryDigest:review.summaryDigest},{principalId:'human',commandId:key()});
 await assert.rejects(f.narration.attachGeneratedAudio(f.project.id,oldHuman,input),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 f.human=f.production.beginRequest(f.project.id,'human','Choose this restored generated recording with fresh authority');const result=await attach(f,1);
 assert.equal(result.segments[1].audio.id,original.id);assert.deepEqual(rows(f,'narration_audio'),[original]);assert.equal(f.store.get('execution_control',f.project.id).paused,true);assert.throws(()=>guard.assertFirstSubmit(f.project.id,f.attempt.id),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 assert.equal(canonical(f.store.getProject(f.project.id)),project);assert.deepEqual(f.calls,calls);assert.equal(rows(f,'narration_acceptance').length,0);assert.equal(rows(f,'narration_canonical').length,0);
});

test('canonical generated provenance and every managed source survive export and independent inspection',async t=>{
 const f=await generatedNarrationFixture(t);f.revise({remove:[f.view().segments[1].entry.segmentId]});await attach(f);await acceptAll(f);const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);
 const before=bodies(f,['narration_audio','narration_canonical','narration_prepared','narration_acceptance','artifact']),copied=await backup(f);assert.deepEqual(await inspectInstallationBackup({directory:copied.directory}),copied);assert.equal(bodies(f,['narration_audio','narration_canonical','narration_prepared','narration_acceptance','artifact']),before);
 const original=f.view().segments[0].audio;assert.deepEqual(readFileSync(join(copied.directory,'media','blobs',`${original.media.sha256}.wav`)),readFileSync(join(f.root,'media','blobs',`${original.media.sha256}.wav`)));
 assert.deepEqual(f.calls,f.initialCalls);
});

test('backup independently rejects a forged generated narration variant despite valid media bytes',async t=>{
 const f=await generatedNarrationFixture(t);await attach(f);const audio=rows(f,'narration_audio')[0];
 f.store.db.prepare("UPDATE entities SET body=? WHERE kind='narration_audio' AND id=?").run(canonical({...audio,generation:{...audio.generation,dispatchDigest:'f'.repeat(64)}}),audio.id);
 await assert.rejects(backup(f));
});

test('backup requires original generated PCM, exact accepted geometry and human request linkage',async t=>{
 for(const damage of ['raw','canonical','laundered','geometry','acceptance_request']){
  const f=await generatedNarrationFixture(t);f.revise({remove:[f.view().segments[1].entry.segmentId]});await attach(f);await acceptAll(f);const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);
  if(damage==='raw')unlinkSync(join(f.root,'media','blobs',`${f.source.source.originalSha256}.source`));
  else{const saved=f.canonical.workspaceCurrent(f.project.id);
   if(damage==='acceptance_request'){const id=saved.segments[0].provenance.audioAcceptanceId,accepted=f.store.get('narration_acceptance',id);f.store.db.prepare("UPDATE entities SET body=? WHERE kind='narration_acceptance' AND id=?").run(canonical({...accepted,requestId:'missing-human-acceptance-request'}),id);}
   else{
    if(damage==='laundered'){delete saved.segments[0].provenance.generation;saved.segments[0].provenance.originEvidence='human_declared_supplied_recording';saved.segments[0].provenance.declaredOrigin='generated';}
    else if(damage==='geometry'){saved.segments[0].cue.meaning='Unaccepted replacement';saved.segments[0].audioPlacement.startSample=1;saved.segments[0].audioPlacement.durationSamples-=1;}
    else saved.segments[0].provenance.audioAcceptanceId=saved.segments[0].provenance.scriptAcceptanceId;
    f.store.db.prepare("UPDATE entities SET body=? WHERE kind='narration_canonical' AND id=?").run(canonical(saved),saved.id);
   }
  }
  await assert.rejects(backup(f));
 }
});
