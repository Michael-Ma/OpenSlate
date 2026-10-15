import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@openslate/core';
import { narrationSpeechFixture, key } from './narration-speech-fixture.mjs';
import { createShotNarrationSession, narrationAuthorScope, narrationScopeTarget, shotDraftId } from '../dist/narration/narration-scope.js';
import { NarrationCanonicalService } from '../dist/narration/canonical.js';
import { resolveNarrationSpeechApplication } from '../dist/narration/narration-speech-authorization.js';
import { installRecoveryQuarantine, InstallationRecoveryGuard, releaseRecovery } from '../dist/application/installation-recovery.js';

async function fixture(t,options={}) {
 const f=await narrationSpeechFixture(t,options),rows=f.narration.workspaceSnapshot(f.project.id).segments;
 const prepared=await f.production.prepare(f.project.id,f.actor,{variant:'project',expectedHeadVersion:f.store.getProject(f.project.id).headVersion,creative:{brief:'Two product shots',story:'Reveal and detail',createScenes:[{key:'scene',purpose:'Product'}],createShots:rows.map((row,i)=>({key:`shot${i}`,sceneId:'scene',purpose:`Shot ${i}`,action:'Boot',framing:'Close',motion:'Slow push',desiredFrames:180,imagePrompt:`Image ${i}`,videoPrompt:`Video ${i}`,referenceArtifactIds:[],cueId:null,narration:{mode:'generated',text:row.script.text,voice:'stock'}}))}});
 f.production.apply(f.project.id,f.actor,prepared.id);f.project=f.store.getProject(f.project.id);
 for(const hold of f.store.list('hold',f.project.id).filter(h=>h.active&&h.ownerId===f.human.requestId))f.engine.releaseHold(f.project.id,hold.id,f.human.requestId);
 for(const[ i,row]of rows.entries())f.store.put('narration_shot_draft',shotDraftId(f.project.id,f.project.shots[i].id),f.project.id,{shotId:f.project.shots[i].id,segmentId:row.entry.segmentId,intentDigest:digest(f.project.shots[i].narration)});
 const session=createShotNarrationSession(f.production,f.project.id,f.project.shots[0].id,key()),actor={kind:'human',principalId:'local-user',requestId:session.requestId};
 const before=()=>canonical(['projects','entities','commands','events'].map(table=>f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
 return{...f,session,scoped:actor,canonical:new NarrationCanonicalService(f.narration),before,segment:rows[0],other:rows[1]};
}
test('dedicated shot session pins exactly one section; cross-section writes, second additions and scope changes roll back',async t=>{
 const f=await fixture(t),view=()=>f.narration.workspaceSnapshot(f.project.id),scope=narrationAuthorScope(f.store,f.project.id,f.scoped.requestId,'local-user');
 assert.equal(scope.shotId,f.project.shots[0].id);assert.equal(narrationScopeTarget(f.store,scope).segmentId,f.segment.entry.segmentId);
 const draft={text:'Unauthorized change',meaning:'Other',textKind:'draft',language:'en',source:{kind:'generated',voice:null,profileRevisionId:null}};
 const actions=[()=>f.narration.reviseSegments(f.project.id,f.scoped,view().state.version,key(),{update:[{segmentId:f.other.entry.segmentId,draft}]}),
  ()=>f.narration.reviseSegments(f.project.id,f.scoped,view().state.version,key(),{add:[draft]}),
  ()=>f.narration.reviseSegments(f.project.id,f.scoped,view().state.version,key(),{order:view().segments.map(s=>s.entry.segmentId)}),
  ()=>f.narration.accept(f.project.id,f.scoped,view().state.version,key(),'script',[f.other.script.id]),
  ()=>f.narration.placeSegments(f.project.id,f.scoped,view().state.version,key(),[{segmentId:f.other.entry.segmentId,atSample:0}]),
  ()=>f.canonical.prepare(f.project.id,f.scoped,{expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedNarrationVersion:view().state.version,segmentIds:[f.segment.entry.segmentId],shotMappings:[{shotId:f.project.shots[1].id,segmentId:f.segment.entry.segmentId}],key:key()}),
 ];
 for(const action of actions){const before=f.before();assert.throws(action);assert.equal(f.before(),before);}
 const loose=f.production.beginRequest(f.project.id,'local-user','An ordinary scoped conversation',{scopeIds:[f.project.shots[0].id]});
 assert.throws(()=>f.narration.reviseSegments(f.project.id,loose,view().state.version,key(),{update:[{segmentId:f.segment.entry.segmentId,draft}]}),{code:'SCOPE_DENIED'});
 assert.deepEqual(f.store.get('narration_shot_scope',scope.id),scope);assert.equal(narrationScopeTarget(f.store,scope).segmentId,f.segment.entry.segmentId);
});
test('scoped speech preparation and exact human review create only the pinned operation; generic plans cannot borrow it',async t=>{
 const f=await fixture(t),input=f.input(),before=f.before();
 await assert.rejects(f.service.prepare(f.project.id,f.scoped,{...input,segmentId:f.other.entry.segmentId,segmentRevisionId:f.other.script.id}),{code:'SCOPE_DENIED'});assert.equal(f.before(),before);
 const proposal=await f.service.prepare(f.project.id,f.scoped,input);assert.equal(f.store.list('grant',f.project.id).length,0);
 const receipt=await f.service.review(f.project.id,f.scoped,{key:key(),proposalId:proposal.id,proposalDigest:digest(proposal)}),chain=resolveNarrationSpeechApplication(f.store,f.project.id,receipt.candidateId);
 assert.equal(chain.proposal.section.segmentId,f.segment.entry.segmentId);assert.equal(f.store.list('grant',f.project.id).length,1);assert.equal(f.store.list('candidate',f.project.id).length,1);
 const project=f.store.getProject(f.project.id),actor=f.production.openEpoch(f.project.id,f.scoped).actor;
 const source=`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{return p.speech("generic-project-speech",{profile:${JSON.stringify(f.profile.id)},text:"Borrowed work",voice:"coral"});});`;
 await assert.rejects(f.production.prepare(f.project.id,actor,{variant:'plan',expectedHeadVersion:project.headVersion,source}),{code:'SCOPE_DENIED'});
 assert.equal(f.store.list('grant',f.project.id).length,1);assert.equal(f.engine.attempts(f.project.id).length,0);assert.equal(f.calls.http,0);
 const continued=createShotNarrationSession(f.production,f.project.id,f.project.shots[0].id,key(),f.session.id);
 const speechNode=f.store.get('node_binding',chain.review.nodeId);
 assert.equal(f.engine.held(f.store.getProject(f.project.id),speechNode.id),true,'a later shot edit holds only its own reviewed speech job');
 assert.ok(f.store.list('hold',f.project.id).filter(h=>h.active).every(h=>h.scopeId===f.project.shots[0].id));assert.equal(continued.shotId,f.project.shots[0].id);
});
test('restored scoped sessions cannot write or regrant old speech; explicit continuation stays scoped and paused',async t=>{
 const f=await fixture(t),proposal=await f.service.prepare(f.project.id,f.scoped,f.input());
 installRecoveryQuarantine(f.store,{restoreId:randomUUID(),backupId:randomUUID(),backupManifestSha256:'a'.repeat(64),sourceDatabaseSha256:'b'.repeat(64),originalDataRoot:f.root,backupCreatedAt:'2026-09-30T00:00:00.000Z',restoredAt:'2026-10-01T00:00:00.000Z'});
 assert.throws(()=>f.narration.accept(f.project.id,f.scoped,f.narration.workspaceSnapshot(f.project.id).state.version,key(),'script',[f.segment.script.id]),{code:'INSTALLATION_QUARANTINED'});
 const recovery=new InstallationRecoveryGuard(f.store).snapshot();releaseRecovery(f.store,{restoreId:recovery.receipt.restoreId,expectedReceiptDigest:recovery.receiptDigest,expectedSummaryDigest:recovery.summaryDigest},{principalId:'local-user',commandId:key()});
 assert.throws(()=>f.narration.accept(f.project.id,f.scoped,f.narration.workspaceSnapshot(f.project.id).state.version,key(),'script',[f.segment.script.id]),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 const fresh=createShotNarrationSession(f.production,f.project.id,f.project.shots[0].id,key(),f.session.id),actor={kind:'human',principalId:'local-user',requestId:fresh.requestId};
 await assert.rejects(f.service.review(f.project.id,actor,{key:key(),proposalId:proposal.id,proposalDigest:digest(proposal)}),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 assert.equal(f.store.get('message',fresh.requestId).scopeIds.length,1);assert.equal(f.store.get('message',fresh.requestId).scopeIds[0],f.project.shots[0].id);assert.equal(f.store.get('execution_control',f.project.id).paused,true);
 assert.equal(f.store.list('grant',f.project.id).length,0);assert.equal(f.engine.attempts(f.project.id).length,0);assert.equal(f.calls.http,0);
});

test('opening a compact edit also holds its legacy project-authored speech while another exact speech job stays eligible',async t=>{
 const f=await fixture(t,{realSpeech:true}),human=f.production.beginRequest(f.project.id,'local-user','Review two legacy sections',{continuationRequestId:f.session.requestId}),input=f.input();
 const first=await f.service.prepare(f.project.id,human,input),one=await f.service.review(f.project.id,human,{key:key(),proposalId:first.id,proposalDigest:digest(first)});
 const otherInput=f.input({segmentId:f.other.entry.segmentId,segmentRevisionId:f.other.script.id}),second=await f.service.prepare(f.project.id,human,otherInput),two=await f.service.review(f.project.id,human,{key:key(),proposalId:second.id,proposalDigest:digest(second)});
 const current=f.store.getProject(f.project.id),firstNode=f.store.get('candidate',one.candidateId).nodeId,secondNode=f.store.get('candidate',two.candidateId).nodeId;
 assert.equal(f.engine.held(current,firstNode),false);assert.equal(f.engine.held(current,secondNode),false);
 createShotNarrationSession(f.production,f.project.id,f.project.shots[0].id,key(),f.session.id);
 assert.equal(f.engine.held(f.store.getProject(f.project.id),firstNode),true);assert.equal(f.engine.held(f.store.getProject(f.project.id),secondNode),false);
 f.issue(two);const attempt=f.admit(two);assert.equal(attempt.nodeId,secondNode);assert.throws(()=>f.admit(one),{code:'EXECUTION_HELD'});assert.equal(f.calls.http,0);assert.equal(f.engine.attempts(f.project.id).length,1);
});
test('explicit narration continuation retires only the old session capability and preserves the Director request',async t=>{
 const f=await fixture(t),human=f.production.beginRequest(f.project.id,'local-user','Discuss without interrupting narration',{editing:false}),bridge=f.production.openEpoch(f.project.id,human);
 const next=createShotNarrationSession(f.production,f.project.id,f.project.shots[0].id,key(),f.session.id);
 assert.equal(f.store.get('epoch',bridge.actor.epochId).state,'read_only');assert.equal(f.store.get('message',human.requestId).state,'active');assert.equal(f.store.get('message',f.session.requestId).state,'active');
 assert.throws(()=>f.narration.accept(f.project.id,f.scoped,f.narration.workspaceSnapshot(f.project.id).state.version,key(),'script',[f.segment.script.id]),{code:'SCOPE_DENIED'});
 const actor={kind:'human',principalId:'local-user',requestId:next.requestId};assert.doesNotThrow(()=>f.narration.accept(f.project.id,actor,f.narration.workspaceSnapshot(f.project.id).state.version,key(),'script',[f.segment.script.id]));
});
