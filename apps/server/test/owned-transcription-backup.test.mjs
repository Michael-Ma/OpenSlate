import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,digest} from '@openslate/core';
import {Store} from '../dist/persistence/store.js';
import {createInstallationBackup,inspectInstallationBackup} from '../dist/persistence/installation-backup.js';
import {restoreInstallationBackup} from '../dist/persistence/installation-restore.js';
import {InstallationRecoveryGuard,releaseRecovery} from '../dist/application/installation-recovery.js';
import {assertOwnedTranscriptionProposal,assertOwnedTranscriptionSource} from '../dist/narration/owned-transcription-records.js';
import {ownedTranscriptionFixture,key,rows,bodies} from './owned-transcription-fixture.mjs';

const backup=(f,name='backup')=>createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,name)});
const sqlTamper=(f,kind,id,value)=>f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical(value),kind,id);

test('actual same-root restore keeps ungranted proposal/source and permanent imported proposal fence without new authority',async t=>{
 const f=await ownedTranscriptionFixture(t,{plan:true,section:true}),p=await f.prepare(),s=f.store.get('owned_transcription_source',p.sourceBinding.id);
 const before={project:f.store.getProject(f.project.id),records:bodies(f,['owned_transcription_source','owned_transcription_proposal','grant','candidate','attempt','external_allowance','narration_state','narration_acceptance','narration_canonical','logical_ids'])};
 const paths=[`media/sources/${s.source.id}.json`,`media/blobs/${s.source.originalSha256}.source`,`media/blobs/${s.source.sha256}.wav`,`artifacts/${f.project.id}/${s.source.sha256}.wav`];
 const bytes=new Map(paths.map(path=>[path,readFileSync(join(f.root,path))]));f.store.close();f.provider.close();
 const saved=await backup(f);assert.deepEqual(await inspectInstallationBackup({directory:saved.directory}),saved);
 for(const [path,body]of bytes)assert.deepEqual(readFileSync(join(saved.directory,path)),body);
 renameSync(f.root,join(f.parent,'original-installation'));await restoreInstallationBackup({directory:saved.directory,destination:f.root});
 const store=new Store(join(f.root,'openslate.sqlite'));t.after(()=>store.close());
 assert.deepEqual(store.getProject(f.project.id),before.project);
 assert.equal(bodies({...f,store},['owned_transcription_source','owned_transcription_proposal','grant','candidate','attempt','external_allowance','narration_state','narration_acceptance','narration_canonical','logical_ids']),before.records);
 assertOwnedTranscriptionSource(store,f.project.id,store.get('owned_transcription_source',s.id));assertOwnedTranscriptionProposal(store,f.project.id,store.get('owned_transcription_proposal',p.id));
 const guard=new InstallationRecoveryGuard(store),view=guard.snapshot();assert.equal(view.state,'quarantined');
 assert.throws(()=>guard.assertWritable(f.project.id,p.requestId),{code:'INSTALLATION_QUARANTINED'});
 releaseRecovery(store,{restoreId:view.receipt.restoreId,expectedReceiptDigest:view.receiptDigest,expectedSummaryDigest:view.summaryDigest},{principalId:'human',commandId:key()});
 assert.equal(store.get('execution_control',f.project.id).paused,true);
 assert.throws(()=>guard.assertFreshAuthority(f.project.id,'owned_transcription_proposal',p.id),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 assertOwnedTranscriptionProposal(store,f.project.id,p);assert.equal(rows({...f,store},'attempt').length,0);
 for(const [path,body]of bytes)assert.deepEqual(readFileSync(join(f.root,path)),body);
});

test('backup recomposes actual source and rejects structurally valid graph with laundered source text',async t=>{
 const f=await ownedTranscriptionFixture(t,{plan:true}),p=await f.prepare();
 const bad=structuredClone(p);bad.compiled.source=bad.compiled.source.replace('p.transcription(', 'p["transcription"](');
 assert.notEqual(bad.compiled.source,p.compiled.source);assertOwnedTranscriptionProposal(f.store,f.project.id,bad);
 sqlTamper(f,'owned_transcription_proposal',p.id,bad);await assert.rejects(backup(f));
});

test('backup rejects forged source closure and missing original bytes independently of SQL insertion checks',async t=>{
 for(const mode of ['descriptor','original','artifact']){
  const f=await ownedTranscriptionFixture(t),p=await f.prepare(),s=f.store.get('owned_transcription_source',p.sourceBinding.id);
  if(mode==='original')unlinkSync(join(f.root,'media','blobs',`${s.source.originalSha256}.source`));
  else if(mode==='artifact')unlinkSync(join(f.root,'artifacts',f.project.id,`${s.source.sha256}.wav`));
  else sqlTamper(f,'owned_transcription_source',s.id,{...s,sourceEndSample:s.sourceEndSample-1});
  await assert.rejects(backup(f));
 }
});
