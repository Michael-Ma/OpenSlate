import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '@openslate/core';
import {narrationSpeechFixture,key,draft,rows} from './narration-speech-fixture.mjs';
import {ownedTranscriptionFixture} from './owned-transcription-fixture.mjs';
import {projectNarrationSpeechProposal,projectNarrationSpeechProposals,projectNarrationSpeechOptions} from '../dist/narration/narration-speech-projection.js';
import {projectAudioOperations} from '../dist/application/audio-operation-context.js';
import {projectDirectorContext,DIRECTOR_PROJECTION_LIMITS} from '../dist/application/context-projection.js';
import {registerNarrationSpeechRoutes} from '../dist/narration/narration-speech-routes.js';
import {NarrationService} from '../dist/narration/service.js';
import {NarrationSpeechService} from '../dist/narration/narration-speech-service.js';
import {InstallationRecoveryGuard,installRecoveryQuarantine,releaseRecovery} from '../dist/application/installation-recovery.js';

const data=f=>canonical(['projects','entities','commands','events','installation_recoveries'].map(table=>f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
const update=(f,kind,id,value)=>f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical(value),kind,id);
const read=f=>projectNarrationSpeechProposal(f.store,f.project.id,f.proposal.id);
const edit=(f,index=0)=>f.revise({update:[{segmentId:f.view().segments[index].entry.segmentId,draft:draft('Changed saved section')}]});
async function ready(t,options={}) {const f=await narrationSpeechFixture(t,{realSpeech:true,...options});f.proposal=await f.prepare();f.applied=await f.review(f.proposal);return f;}
function restore(f) {return installRecoveryQuarantine(f.store,{restoreId:key(),backupId:key(),backupManifestSha256:'a'.repeat(64),sourceDatabaseSha256:'b'.repeat(64),originalDataRoot:f.root,backupCreatedAt:'2026-09-11T00:00:00.000Z',restoredAt:'2026-09-12T00:00:00.000Z'});}
function release(f) {const view=new InstallationRecoveryGuard(f.store).snapshot();return releaseRecovery(f.store,{restoreId:view.receipt.restoreId,expectedReceiptDigest:view.receiptDigest,expectedSummaryDigest:view.summaryDigest},{principalId:'local-user',commandId:key()});}
function pad(f,kind,id,bytes) {const {body}=f.store.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind,id);assert.ok(Buffer.byteLength(body)<bytes);f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(body+' '.repeat(bytes-Buffer.byteLength(body)),kind,id);}

// Real service-created proposals/applications; reads do not need provider credentials or media tools.
test('speech options and exact ungranted summary stay read-only and saved-section specific',async t=>{
 const f=await narrationSpeechFixture(t);f.proposal=await f.prepare();const before=data(f),view=read(f),options=projectNarrationSpeechOptions(f.production,f.project.id);
 assert.equal(view.proposal.proposalDigest,digest(f.proposal));assert.equal(view.proposal.segment.text,f.proposal.operation.text);
 assert.equal(view.eligibility.current,true);assert.equal(view.application,null);assert.equal(view.execution.state,'not_applied');
 assert.equal(options.profiles[0].model,f.profile.configuration.model);assert.ok(Object.isFrozen(view.proposal));assert.equal(data(f),before);assert.deepEqual(f.calls,{http:0,credentials:0});
 edit(f,1);assert.equal(read(f).eligibility.current,true);edit(f);assert.equal(read(f).eligibility.code,'NARRATION_SPEECH_STALE');
});

test('applied speech before admission reflects the current selected section without changing history',async t=>{
 const f=await ready(t),initial=read(f);assert.deepEqual(initial.application,f.applied);assert.equal(initial.execution.state,'ready');
 edit(f,1);assert.equal(read(f).execution.code,null);edit(f);const before=data(f),view=read(f);
 assert.equal(view.execution.state,'unavailable');assert.equal(view.execution.code,'NARRATION_SPEECH_STALE');assert.deepEqual(view.application,initial.application);assert.deepEqual(view.proposal,initial.proposal);assert.equal(data(f),before);
});

test('admitted pre-marker speech displays pause, hold and obsolete section blockers without any POST',async t=>{
 const f=await ready(t);f.issue(f.applied);const attempt=f.admit(f.applied);
 assert.equal(read(f).execution.attemptId,attempt.id);assert.equal(read(f).execution.code,null);
 f.store.put('execution_control',f.project.id,f.project.id,{id:f.project.id,projectId:f.project.id,paused:true});assert.equal(read(f).execution.code,'EXECUTION_PAUSED');
 f.store.put('execution_control',f.project.id,f.project.id,{id:f.project.id,projectId:f.project.id,paused:false});
 const hold={id:key(),projectId:f.project.id,ownerId:f.human.requestId,scopeId:f.project.id,active:true};f.store.insert('hold',hold.id,f.project.id,hold);assert.equal(read(f).execution.code,'EXECUTION_HELD');
 f.store.put('hold',hold.id,f.project.id,{...hold,active:false});edit(f);assert.equal(read(f).execution.code,'NARRATION_SPEECH_STALE');assert.deepEqual(f.calls,{http:0,credentials:0});
});

for (const admitted of [false,true]) test(`restoration retains its first-generation fence ${admitted?'with a pre-marker attempt':'before admission'} despite pause and later release`,async t=>{
 const f=await ready(t);if(admitted){f.issue(f.applied);f.admit(f.applied);}restore(f);
 let before=data(f),view=read(f);assert.equal(view.execution.code,'INSTALLATION_QUARANTINED');assert.equal(view.eligibility.code,'INSTALLATION_QUARANTINED');assert.equal(data(f),before);
 release(f);before=data(f);view=read(f);assert.equal(view.execution.code,'RESTORED_AUTHORITY_REQUIRES_NEW');assert.equal(view.eligibility.code,'RESTORED_AUTHORITY_REQUIRES_NEW');assert.equal(data(f),before);assert.deepEqual(f.calls,{http:0,credentials:0});
});

test('actual post-marker unknown history survives selected-section edits and restoration without a fresh currentness claim',async t=>{
 const f=await ready(t,{realSpeech:true,fetch:async()=>{throw Error('offline ambiguous reply');}});f.issue(f.applied);const attempt=f.admit(f.applied);
 const result=await f.bridge.submit(attempt.request,{expectedLease:{owner:attempt.leaseOwner,epoch:attempt.leaseEpoch}});assert.equal(result.type,'unknown');
 f.store.put('attempt',attempt.id,f.project.id,{...f.store.get('attempt',attempt.id),phase:'submission_unknown'});edit(f);restore(f);const before=data(f),view=read(f);
 assert.equal(view.execution.state,'submission_unknown');assert.equal(view.execution.code,null);assert.equal(view.eligibility.code,'INSTALLATION_QUARANTINED');assert.equal(data(f),before);assert.equal(f.calls.http,1);
});

test('mismatched attempt metadata, body identity, fingerprint and phase never become trusted execution status',async t=>{
 const f=await ready(t);f.issue(f.applied);const attempt=f.admit(f.applied);
 for(const change of [value=>{delete value.narrationSpeech;},value=>{value.id='another';},value=>{value.request.args.voice='onyx';},value=>{value.phase='private-untrusted-status';}]) {
  const corrupted=structuredClone(attempt);change(corrupted);update(f,'attempt',attempt.id,corrupted);const before=data(f),view=read(f);
  assert.equal(view.execution.state,'unavailable');assert.equal(view.execution.code,'PROPOSAL_UNAVAILABLE');assert.equal(view.execution.attemptId,null);assert.deepEqual(view.application,f.applied);assert.equal(data(f),before);
 }
 update(f,'attempt',attempt.id,attempt);assert.equal(read(f).execution.state,'submitting');
});

for(const kind of ['narration_speech_review','candidate','attempt']) test(`oversized ${kind} SQL IDs stay unavailable before keyed body hydration`,async t=>{
 const f=await ready(t);let id=kind==='narration_speech_review'?f.applied.reviewId:f.applied.candidateId;if(kind==='attempt'){f.issue(f.applied);id=f.admit(f.applied).id;}
 const huge='x'.repeat(1024*1024);f.store.db.prepare('UPDATE entities SET id=? WHERE kind=? AND id=?').run(huge,kind,id);
 const view=read(f);assert.equal(view.execution.state,'unavailable');assert.equal(view.execution.code,'PROPOSAL_UNAVAILABLE');assert.equal(JSON.stringify(view).includes(huge),false);
});

test('speech history restarts its hydration budget without skipping valid later proposals',async t=>{
 const f=await narrationSpeechFixture(t),proposals=[];for(let i=0;i<3;i++)proposals.push(await f.prepare());
 for(const proposal of proposals)pad(f,'narration_speech_proposal',proposal.id,13*1024**2);
 const expected=proposals.map(value=>value.id).reverse(),seen=[];let offset=0,first;
 do{const page=projectNarrationSpeechProposals(f.store,f.project.id,offset);first??=page;assert.ok(page.coverage.readBytes<=32*1024**2);
  assert.ok(page.proposals.every(row=>row.proposal&&row.unavailableCode===null));seen.push(...page.proposals.map(row=>row.id));offset=page.coverage.nextOffset;}while(offset!==null);
 assert.equal(first.coverage.scanned,2);assert.equal(first.coverage.nextOffset,2);assert.deepEqual(seen,expected);
});

test('individually oversized and malformed speech rows have stable unavailable identities and finite progress',async t=>{
 const f=await narrationSpeechFixture(t),old=await f.prepare(),large=await f.prepare(),bad=await f.prepare();pad(f,'narration_speech_proposal',large.id,16*1024**2+1);
 f.store.db.prepare('UPDATE entities SET id=? WHERE kind=? AND id=?').run('q'.repeat(1024*1024),'narration_speech_proposal',bad.id);
 const seen=[];let offset=0;do{const page=projectNarrationSpeechProposals(f.store,f.project.id,offset);assert.ok(page.coverage.scanned>0);seen.push(...page.proposals);offset=page.coverage.nextOffset;}while(offset!==null);
 assert.equal(seen.length,3);assert.match(seen[0].id,/^unavailable-row-/);assert.equal(seen[1].unavailableCode,'PROPOSAL_TOO_LARGE');assert.equal(seen[2].proposal.id,old.id);
});

test('audio operations consume the actual shortened speech window across every collection',async t=>{
 const f=await narrationSpeechFixture(t),proposals=[];for(let i=0;i<3;i++)proposals.push(await f.prepare());for(const proposal of proposals)pad(f,'narration_speech_proposal',proposal.id,13*1024**2);
 const first=projectAudioOperations(f.production,f.project.id,0);assert.equal(first.coverage.returned,2);assert.equal(first.coverage.nextOffset,2);
 const second=projectAudioOperations(f.production,f.project.id,first.coverage.nextOffset);assert.equal(second.coverage.returned,1);assert.equal(second.coverage.nextOffset,null);
 assert.deepEqual([...first.speechProposals,...second.speechProposals].map(row=>row.id),proposals.map(value=>value.id).reverse());
 assert.deepEqual([...first.sections,...second.sections].map(row=>row.segmentId),f.view().segments.map(row=>row.entry.segmentId));
});

test('audio operations also honor the existing transcription projection shortened window',async t=>{
 const f=await ownedTranscriptionFixture(t),proposals=[];for(let i=0;i<3;i++)proposals.push(await f.prepare());for(const proposal of proposals)pad(f,'owned_transcription_proposal',proposal.id,13*1024**2);
 const seen=[];let offset=0;do{const view=projectAudioOperations(f.production,f.project.id,offset);assert.ok(view.coverage.returned>0);seen.push(...view.transcriptionProposals.map(row=>row.id));offset=view.coverage.nextOffset;}while(offset!==null);
 assert.deepEqual(seen,proposals.map(value=>value.id).reverse());
});

test('complete audio sections adapt to byte limits and exact outer-envelope callbacks without skipping',async t=>{
 const f=await narrationSpeechFixture(t);f.revise({add:Array.from({length:18},(_,i)=>({...draft(`${i}:`+'w'.repeat(8000)),meaning:'A bounded section summary'}))});const expected=f.view().segments.map(row=>row.entry.segmentId),seen=[];
 const before=data(f);let offset=0,first;do{const view=projectAudioOperations(f.production,f.project.id,offset);first??=view;assert.ok(Buffer.byteLength(JSON.stringify(view))<=128*1024);seen.push(...view.sections.map(row=>row.segmentId));offset=view.coverage.nextOffset;}while(offset!==null);
 assert.ok(first.coverage.returned<20);assert.deepEqual(seen,expected);assert.equal(data(f),before);
 const single=projectAudioOperations(f.production,f.project.id,0,value=>value.coverage.returned<=1);assert.equal(single.coverage.returned,1);assert.equal(single.coverage.nextOffset,1);
 assert.throws(()=>projectAudioOperations(f.production,f.project.id,0,()=>false),{code:'CONTEXT_ITEM_TOO_LARGE'});
});

test('V3 advertises the audio section while an unbound V1 director cannot request it',async t=>{
 const f=await narrationSpeechFixture(t),before=data(f),view=projectDirectorContext(f.production,f.project.id,f.human,{section:'audio_operations'});
 assert.ok(view.coverage.sections.includes('audio_operations'));assert.ok(Buffer.byteLength(canonical(view))<=DIRECTOR_PROJECTION_LIMITS.bytes);
 assert.throws(()=>projectDirectorContext(f.production,f.project.id,f.actor,{section:'audio_operations'}),{code:'CAPABILITY_MISMATCH'});
 const legacy=projectDirectorContext(f.production,f.project.id,f.actor,{});assert.equal(legacy.coverage.sections.includes('audio_operations'),false);assert.equal(data(f),before);
});

test('speech route registration rejects mismatched narration instances before installing any route',async t=>{
 const f=await narrationSpeechFixture(t),other=new NarrationService(f.production),app={get(){assert.fail('must reject before route registration');},post(){assert.fail('must reject before route registration');}};
 assert.throws(()=>registerNarrationSpeechRoutes(app,{production:f.production,narration:f.narration,narrationSpeech:new NarrationSpeechService(other),actorFor(){assert.fail();}}),{code:'NARRATION_SPEECH_CONFIGURATION_INVALID'});
});
