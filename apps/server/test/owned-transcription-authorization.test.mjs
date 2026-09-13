import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,digest,providerProfileArguments} from '@openslate/core';
import {registerExecutionProvider} from '@openslate/providers';
import {Engine} from '../dist/execution/engine.js';
import {DurableExternalAdmission} from '../dist/execution/durable-external-admission.js';
import {ExternalAllowanceService,allowanceIssueContextDigest} from '../dist/application/external-allowances.js';
import {Store} from '../dist/persistence/store.js';
import {createInstallationBackup,inspectInstallationBackup} from '../dist/persistence/installation-backup.js';
import {restoreInstallationBackup} from '../dist/persistence/installation-restore.js';
import {InstallationRecoveryGuard,releaseRecovery} from '../dist/application/installation-recovery.js';
import {assertOwnedTranscriptionReview,assertOwnedTranscriptionApplication,assertOwnedTranscriptionAttemptInput,resolveOwnedTranscriptionApplication} from '../dist/narration/owned-transcription-authorization.js';
import {ownedTranscriptionFixture,key,draft,rows,bodies} from './owned-transcription-fixture.mjs';

async function applied(t,options={}){
 const f=await ownedTranscriptionFixture(t,options);f.proposal=await f.prepare();
 f.reviewer=f.production.beginRequest(f.project.id,'human','Apply exactly this recording transcription proposal.',{continuationRequestId:f.proposal.requestId});
 f.result=await f.service.review(f.project.id,f.reviewer,{key:key(),proposalId:f.proposal.id,proposalDigest:digest(f.proposal)});
 f.resolved=resolveOwnedTranscriptionApplication(f.store,f.project.id,f.result.candidateId);
 return f;
}
async function admitted(f){
 const {review}=f.resolved,input={profileDigest:String(providerProfileArguments(f.profile).profileDigest),profileDefinitionDigest:digest(f.profile),
  selections:[{candidateId:f.result.candidateId,nodeId:review.nodeId,specDigest:review.specDigest}],maxAttempts:1,maxEstimatedMicros:'100',
  expiresAt:new Date(Date.now()+3600000).toISOString()};
 const actor=f.production.beginRequest(f.project.id,'spender','Approve this exact synthetic attempt.',{editing:false,scopeIds:[f.project.id],contextDigest:allowanceIssueContextDigest(f.project.id,input)});
 new ExternalAllowanceService(f.store).issue(f.project.id,actor,input);
 const calls={submit:0,lookup:0,poll:0},provider=registerExecutionProvider({async submit(){calls.submit++;return{type:'unknown',diagnostic:'controlled offline admission'};},
  async lookup(){calls.lookup++;return{type:'unknown',diagnostic:'controlled offline lookup'};},async poll(){calls.poll++;return{type:'unknown',diagnostic:'controlled offline poll'};}},{adapter:'openai-transcription',version:'1'});
 const engine=new Engine(f.store,provider,{artifactDir:f.artifactDir,profiles:f.profiles,externalAdmission:new DurableExternalAdmission(f.store,()=>{})});
 await engine.runReady(f.project.id);const attempt=rows(f,'attempt')[0];assert.ok(attempt);assert.equal(calls.submit,1);
 assert.equal(rows(f,'external_allowance_consumption').length,1);return{attempt,engine,calls};
}
const saved=(f,kind,id)=>f.store.get(kind,id);
const tamper=(f,kind,id,value)=>f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical(value),kind,id);

test('exact fresh-human review and application close to one grant/candidate, complete plan, fresh Prepared and event receipt',async t=>{
 const f=await applied(t,{plan:true,section:true}),{application,review,proposal,source}=f.resolved;
 assert.notEqual(review.requestId,proposal.requestId);assert.equal(review.requestId,f.reviewer.requestId);
 assert.equal(review.id,f.result.grantId);assert.equal(application.id,f.result.candidateId);
 assert.deepEqual(application.receipt,f.result.applied);assert.equal(application.plan.digest,digest(saved(f,'plan',application.plan.id)));
 assert.equal(application.projectRevision.digest,digest(saved(f,'project_revision',application.projectRevision.id)));
 const prepared=saved(f,'prepared',application.prepared.id);assert.equal(prepared.epochId,null);assert.equal(prepared.requestId,review.requestId);
 assert.deepEqual(prepared.grantBindings,{[review.nodeId]:review.id});assert.equal(source.id,proposal.sourceBinding.id);
 const body=bodies(f,['owned_transcription_review','owned_transcription_application','grant','candidate','attempt']);
 assertOwnedTranscriptionReview(f.store,f.project.id,review);assertOwnedTranscriptionApplication(f.store,f.project.id,application);
 assert.equal(bodies(f,['owned_transcription_review','owned_transcription_application','grant','candidate','attempt']),body);
 assert.equal(rows(f,'attempt').length,0);assert.equal(rows(f,'external_allowance').length,0);
});

test('review rejects altered human, grant, source, proposal, node/spec and compiled identities',async t=>{
 const f=await applied(t),{review}=f.resolved;
 const changes=[x=>x.principalId='different-human',x=>x.requestId=f.proposal.requestId,x=>x.grantDigest='0'.repeat(64),
  x=>x.proposal.digest='0'.repeat(64),x=>x.sourceBinding.digest='0'.repeat(64),x=>x.nodeId='unreviewed-node',
  x=>x.specDigest='0'.repeat(64),x=>x.compiledDigest='0'.repeat(64),x=>x.epochId='director'];
 for(const change of changes){const bad=structuredClone(review);change(bad);assert.throws(()=>assertOwnedTranscriptionReview(f.store,f.project.id,bad));}
 const request=saved(f,'message',review.requestId);tamper(f,'message',request.id,{...request,editing:false});
 assert.throws(()=>assertOwnedTranscriptionReview(f.store,f.project.id,review));tamper(f,'message',request.id,request);
 tamper(f,'message',request.id,{...request,scopeIds:[]});assert.throws(()=>assertOwnedTranscriptionReview(f.store,f.project.id,review));
});

test('application rejects detached candidate/Prepared/plan/revision and forged receipt cursor',async t=>{
 const f=await applied(t),{application}=f.resolved;
 const changes=[x=>x.candidateDigest='0'.repeat(64),x=>x.review.digest='0'.repeat(64),x=>x.prepared.digest='0'.repeat(64),
  x=>x.plan.digest=digest(saved(f,'plan',x.plan.id).compiled),x=>x.projectRevision.digest=digest(saved(f,'project_revision',x.projectRevision.id).project),
  x=>x.receipt.preparedId='old-prepared',x=>x.receipt.cursor++,x=>x.receipt.headVersion++,x=>x.receipt.activePlanId='unpublished-plan'];
 for(const change of changes){const bad=structuredClone(application);change(bad);assert.throws(()=>assertOwnedTranscriptionApplication(f.store,f.project.id,bad));}
 const old=saved(f,'prepared',application.prepared.id),bad={...old,grantBindings:{}};tamper(f,'prepared',old.id,bad);
 assert.throws(()=>assertOwnedTranscriptionApplication(f.store,f.project.id,{...application,prepared:{id:old.id,digest:digest(bad)}}));
});

test('historical resolver ignores later request supersession and selected section changes',async t=>{
 const f=await applied(t,{section:true}),before=canonical(f.resolved);
 const actor=f.production.beginRequest(f.project.id,'human','Change the later section.');
 const state=f.narration.snapshot(f.project.id,actor);f.narration.reviseSegments(f.project.id,actor,state.state.version,key(),{
  update:[{segmentId:state.segments[0].entry.segmentId,draft:draft('Later edited words.')} ]});
 assert.equal(saved(f,'message',f.resolved.review.requestId).state,'superseded');
 assert.equal(canonical(resolveOwnedTranscriptionApplication(f.store,f.project.id,f.result.candidateId)),before);
});

test('Store keeps review/application immutable and forbids a retroactive review of a previously consumed grant',async t=>{
 const f=await applied(t),{review,application}=f.resolved;
 assert.deepEqual(f.store.put('owned_transcription_review',review.id,f.project.id,review),review);
 assert.deepEqual(f.store.put('owned_transcription_application',application.id,f.project.id,application),application);
 assert.throws(()=>f.store.put('owned_transcription_review',review.id,f.project.id,{...review,compiledDigest:'0'.repeat(64)}));
 assert.throws(()=>f.store.put('owned_transcription_application',application.id,f.project.id,{...application,receipt:{...application.receipt,cursor:1}}));
 f.store.db.prepare("DELETE FROM entities WHERE kind='owned_transcription_review' AND id=?").run(review.id);
 assert.throws(()=>f.store.insert('owned_transcription_review',review.id,f.project.id,review),{code:'OWNED_TRANSCRIPTION_AUTHORIZATION_INVALID'});
});

test('actual Engine admission stores immutable application metadata, ordered source and unchanged external request fields',async t=>{
 const f=await applied(t),{attempt,calls}=await admitted(f),resolved=assertOwnedTranscriptionAttemptInput(f.store,attempt);
 assert.deepEqual(attempt.applicationInput,{version:1,binding:{kind:'owned_transcription',id:resolved.source.id,digest:digest(resolved.source)},
  application:{id:resolved.application.id,digest:digest(resolved.application)}});
 assert.equal(Object.hasOwn(attempt.request,'applicationInput'),false);assert.equal(Object.hasOwn(attempt.request.args,'applicationInput'),false);
 assert.deepEqual(attempt.request.inputs,[resolved.source.artifact]);assert.equal(calls.submit,1);
 const omitted={...attempt};delete omitted.applicationInput;
 for(const bad of [omitted,{...attempt,applicationInput:null},{...attempt,applicationInput:{...attempt.applicationInput,version:2}},
  {...attempt,request:{...attempt.request,inputs:[{...resolved.source.artifact,artifactId:'same-bytes-foreign-recording'}]}},
  {...attempt,request:{...attempt.request,args:{...attempt.request.args,language:'fr'}}},
  {...attempt,fingerprint:'0'.repeat(64),request:{...attempt.request,fingerprint:'0'.repeat(64)}}]){
  assert.throws(()=>assertOwnedTranscriptionAttemptInput(f.store,bad));assert.throws(()=>f.store.put('attempt',attempt.id,f.project.id,bad));
 }
 const updated=f.store.put('attempt',attempt.id,f.project.id,{...attempt,leaseEpoch:attempt.leaseEpoch+1});
 assert.deepEqual(updated.applicationInput,attempt.applicationInput);
});

test('metadata-free legacy attempts remain unchanged while missing reviewed metadata is detected from candidate linkage',async t=>{
 const f=await applied(t),{attempt}=await admitted(f),before=canonical(attempt);
 assert.equal(assertOwnedTranscriptionAttemptInput(f.store,{candidateId:null,projectId:f.project.id}),null);
 assert.equal(canonical(attempt),before);
 const bad=structuredClone(attempt);delete bad.applicationInput;
 assert.throws(()=>assertOwnedTranscriptionAttemptInput(f.store,bad));
 const original=f.store.get;f.store.get=function(kind,id){if(kind==='owned_transcription_review')return undefined;return original.call(this,kind,id);};
 try{assert.throws(()=>assertOwnedTranscriptionAttemptInput(f.store,bad));}finally{f.store.get=original;}
});

test('authorization resolver uses keyed records and rejects foreign project closure',async t=>{
 const f=await applied(t),before=canonical(f.resolved),list=f.store.list;
 f.store.list=()=>assert.fail('Historical authorization must not scan project records');
 try{assert.equal(canonical(resolveOwnedTranscriptionApplication(f.store,f.project.id,f.result.candidateId)),before);}finally{f.store.list=list;}
 const other=f.production.createProject('Foreign');
 assert.throws(()=>resolveOwnedTranscriptionApplication(f.store,other.id,f.result.candidateId));
});

test('actual same-root restore retains reviewed application and admitted input while permanently fencing all imported authority',async t=>{
 const f=await applied(t),{attempt,calls}=await admitted(f),source=f.resolved.source;
 const kinds=['owned_transcription_source','owned_transcription_proposal','owned_transcription_review','owned_transcription_application',
  'prepared','plan','project_revision','grant','candidate','attempt','external_allowance','external_allowance_consumption','reservation','narration_state','narration_canonical'];
 const before=bodies(f,kinds),project=f.store.getProject(f.project.id),observed={...calls};
 const paths=[`media/sources/${source.source.id}.json`,`media/blobs/${source.source.originalSha256}.source`,
  `media/blobs/${source.source.sha256}.wav`,`artifacts/${f.project.id}/${source.source.sha256}.wav`];
 const bytes=new Map(paths.map(path=>[path,readFileSync(join(f.root,path))]));f.store.close();f.provider.close();
 const backup=await createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,'backup')});
 assert.deepEqual(await inspectInstallationBackup({directory:backup.directory}),backup);
 renameSync(f.root,join(f.parent,'original-installation'));await restoreInstallationBackup({directory:backup.directory,destination:f.root});
 const store=new Store(join(f.root,'openslate.sqlite'));t.after(()=>store.close());const restored={...f,store};
 assert.equal(bodies(restored,kinds),before);assert.deepEqual(store.getProject(f.project.id),project);
 assert.deepEqual(assertOwnedTranscriptionAttemptInput(store,store.get('attempt',attempt.id)),f.resolved);
 const guard=new InstallationRecoveryGuard(store),view=guard.snapshot();assert.equal(view.state,'quarantined');
 assert.throws(()=>guard.assertFirstSubmit(f.project.id,attempt.id),{code:'INSTALLATION_QUARANTINED'});
 releaseRecovery(store,{restoreId:view.receipt.restoreId,expectedReceiptDigest:view.receiptDigest,expectedSummaryDigest:view.summaryDigest},{principalId:'human',commandId:key()});
 for(const [kind,id]of [['owned_transcription_proposal',f.proposal.id],['owned_transcription_review',f.result.reviewId],
  ['owned_transcription_application',f.result.applicationId],['grant',f.result.grantId],['candidate',f.result.candidateId]])
  assert.throws(()=>guard.assertFreshAuthority(f.project.id,kind,id),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 assert.throws(()=>guard.assertFirstSubmit(f.project.id,attempt.id),{code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 assert.equal(store.get('execution_control',f.project.id).paused,true);assert.equal(bodies(restored,kinds),before);
 assert.deepEqual(resolveOwnedTranscriptionApplication(store,f.project.id,f.result.candidateId),f.resolved);assert.deepEqual(calls,observed);
 for(const [path,body]of bytes)assert.deepEqual(readFileSync(join(f.root,path)),body);
});

test('backup independently rejects missing application, stripped admission metadata and forged exact application receipt',async t=>{
 for(const mode of ['application','metadata','receipt','fingerprint']){
  const f=await applied(t),{attempt}=await admitted(f);
  if(mode==='application')f.store.db.prepare("DELETE FROM entities WHERE kind='owned_transcription_application' AND id=?").run(f.result.applicationId);
  else if(mode==='metadata'){const bad=structuredClone(attempt);delete bad.applicationInput;tamper(f,'attempt',bad.id,bad);}
  else if(mode==='receipt'){const app=structuredClone(f.resolved.application);app.receipt.cursor++;tamper(f,'owned_transcription_application',app.id,app);}
  else tamper(f,'attempt',attempt.id,{...attempt,fingerprint:'0'.repeat(64),request:{...attempt.request,fingerprint:'0'.repeat(64)}});
  await assert.rejects(createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,'backup')}));
 }
});

test('historical SQL authorization does not need files but backup retains required original, normalized and installed recording bytes',async t=>{
 const f=await applied(t),source=f.resolved.source;
 unlinkSync(join(f.root,'media','blobs',`${source.source.originalSha256}.source`));
 assert.deepEqual(resolveOwnedTranscriptionApplication(f.store,f.project.id,f.result.candidateId),f.resolved);
 await assert.rejects(createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,'backup')}));
});
