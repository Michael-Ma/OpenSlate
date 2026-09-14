import test from 'node:test';
import assert from 'node:assert/strict';
import {renameSync} from 'node:fs';
import {join} from 'node:path';
import {canonical} from '@openslate/core';
import {Store} from '../dist/persistence/store.js';
import {createInstallationBackup,inspectInstallationBackup} from '../dist/persistence/installation-backup.js';
import {restoreInstallationBackup} from '../dist/persistence/installation-restore.js';
import {InstallationRecoveryGuard,releaseRecovery} from '../dist/application/installation-recovery.js';
import {assertNarrationSpeechProposal} from '../dist/narration/narration-speech-records.js';
import {narrationSpeechFixture,key,bodies} from './narration-speech-fixture.mjs';
const backup=f=>createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,'backup')});
for(const reviewed of [false,true])test(`speech same-root backup preserves ${reviewed?'reviewed':'ungranted'} records and permanently fences imported authority`,async t=>{
 const f=await narrationSpeechFixture(t,{plan:true}),p=await f.prepare();if(reviewed)await f.review(p);
 const kinds=['narration_speech_proposal','narration_speech_review','narration_speech_application','grant','candidate','attempt','narration_state','narration_segment'];const before=bodies(f,kinds);
 f.store.close();f.provider.close();const saved=await backup(f);assert.deepEqual(await inspectInstallationBackup({directory:saved.directory}),saved);
 renameSync(f.root,join(f.parent,'original'));await restoreInstallationBackup({directory:saved.directory,destination:f.root});
 const store=new Store(join(f.root,'openslate.sqlite'));t.after(()=>store.close());assert.equal(bodies({...f,store},kinds),before);assertNarrationSpeechProposal(store,f.project.id,p);
 const guard=new InstallationRecoveryGuard(store),view=guard.snapshot();assert.equal(view.state,'quarantined');
 releaseRecovery(store,{restoreId:view.receipt.restoreId,expectedReceiptDigest:view.receiptDigest,expectedSummaryDigest:view.summaryDigest},{principalId:'human',commandId:key()});
 assert.throws(()=>guard.assertFreshAuthority(f.project.id,'narration_speech_proposal',p.id),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 assert.equal(store.get('execution_control',f.project.id).paused,true);
});
test('speech backup recomposes source and rejects modified source despite unchanged compiled graph',async t=>{
 const f=await narrationSpeechFixture(t,{plan:true}),p=await f.prepare(),bad=structuredClone(p);
 bad.compiled.source=bad.compiled.source.replace('p.speech(', 'p["speech"](');assert.notEqual(bad.compiled.source,p.compiled.source);
 f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical(bad),'narration_speech_proposal',p.id);
 await assert.rejects(backup(f));
});

for(const family of ['attempt','candidate'])for(const field of ['id','project_id'])test(`speech backup rejects ${family} SQL ${field} drift from retained body identity`,async t=>{
 const f=await narrationSpeechFixture(t,{realSpeech:true}),p=await f.prepare(),applied=await f.review(p);f.issue(applied);const attempt=f.admit(applied);
 const identity=family==='attempt'?attempt.id:applied.candidateId;
 const replacement=field==='project_id'?f.production.createProject('Other installation project').id:key();
 f.store.db.prepare(`UPDATE entities SET ${field}=? WHERE kind=? AND id=?`).run(replacement,family,identity);
 f.store.close();f.provider.close();await assert.rejects(backup(f));
});
test('speech backup retains a valid admitted pre-marker attempt and its exact purpose metadata',async t=>{
 const f=await narrationSpeechFixture(t,{realSpeech:true}),p=await f.prepare(),applied=await f.review(p);f.issue(applied);const attempt=f.admit(applied);
 assert.equal(attempt.phase,'submitting');assert.equal(f.calls.http,0);assert.ok(attempt.narrationSpeech);
 f.store.close();f.provider.close();const saved=await backup(f);assert.deepEqual(await inspectInstallationBackup({directory:saved.directory}),saved);
});
