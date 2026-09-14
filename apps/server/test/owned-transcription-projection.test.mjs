import test from 'node:test';
import assert from 'node:assert/strict';
import {renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,digest,DomainError,providerProfileArguments} from '@openslate/core';
import {OPENAI_TRANSCRIPTION_MODEL,registerExecutionProvider,validateOpenAITranscriptionOptions} from '@openslate/providers';
import {Engine} from '../dist/execution/engine.js';
import {DurableExternalAdmission} from '../dist/execution/durable-external-admission.js';
import {ExecutionOutputStore} from '../dist/execution/output-store.js';
import {OpenAITranscriptionExecution} from '../dist/execution/openai-transcription-execution.js';
import {TranscriptionAudioService} from '../dist/execution/transcription-audio-service.js';
import {TranscriptionAudioStore} from '../dist/media/transcription-audio-store.js';
import {SpoolTranscriptIngestor} from '../dist/execution/spool-transcript-ingestor.js';
import {ExecutionIngestionRouter} from '../dist/execution/ingestion-router.js';
import {EnvironmentMediaCredentials} from '../dist/application/provider-credentials.js';
import {ExternalAllowanceService,allowanceIssueContextDigest} from '../dist/application/external-allowances.js';
import {Store} from '../dist/persistence/store.js';
import {createInstallationBackup} from '../dist/persistence/installation-backup.js';
import {restoreInstallationBackup} from '../dist/persistence/installation-restore.js';
import {InstallationRecoveryGuard,releaseRecovery} from '../dist/application/installation-recovery.js';
import {ownedTranscriptionAudioSummary,projectOwnedTranscriptionOptions,summarizeOwnedTranscriptionProposal,
 projectOwnedTranscriptionProposal,projectOwnedTranscriptionProposals,OWNED_TRANSCRIPTION_PROJECTION_LIMITS as limits} from '../dist/narration/owned-transcription-projection.js';
import {ownedTranscriptionFixture,key,draft,rows} from './owned-transcription-fixture.mjs';
import {generatedNarrationFixture,selection} from './generated-narration-fixture.mjs';

const sqlSnapshot=f=>canonical(Object.fromEntries(['projects','entities','events','commands','installation_recoveries'].map(table=>[table,f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
const update=(f,kind,id,body)=>f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical(body),kind,id);
async function prepared(t,options={}){const f=await ownedTranscriptionFixture(t,options);f.proposal=await f.prepare();return f;}
async function apply(f){const actor=f.production.beginRequest(f.project.id,'human','Apply this exact saved recording proposal.',{continuationRequestId:f.proposal.requestId});
 return f.service.review(f.project.id,actor,{key:key(),proposalId:f.proposal.id,proposalDigest:digest(f.proposal)});}
async function admit(f,applied){
 const review=f.store.get('owned_transcription_review',applied.reviewId),input={profileDigest:String(providerProfileArguments(f.profile).profileDigest),profileDefinitionDigest:digest(f.profile),
  selections:[{candidateId:applied.candidateId,nodeId:review.nodeId,specDigest:review.specDigest}],maxAttempts:1,maxEstimatedMicros:'100',expiresAt:new Date(Date.now()+3600000).toISOString()};
 const actor=f.production.beginRequest(f.project.id,'spender','Approve one exact synthetic test attempt.',{editing:false,scopeIds:[f.project.id],contextDigest:allowanceIssueContextDigest(f.project.id,input)});
 new ExternalAllowanceService(f.store).issue(f.project.id,actor,input);let submits=0;
 const provider=registerExecutionProvider({async submit(){submits++;return{type:'unknown',diagnostic:'private synthetic diagnostic never exposed'};},async lookup(){assert.fail('read view must never query provider');},async poll(){assert.fail('read view must never poll provider');}},{adapter:'openai-transcription',version:'1'});
 const engine=new Engine(f.store,provider,{artifactDir:f.artifactDir,profiles:f.profiles,externalAdmission:new DurableExternalAdmission(f.store,()=>{})});
 await engine.runReady(f.project.id);assert.equal(submits,1);return rows(f,'attempt').find(attempt=>attempt.candidateId===applied.candidateId);
}
function observeBodies(f,t){const original=f.store.db.prepare.bind(f.store.db),reads=[];
 t.mock.method(f.store.db,'prepare',sql=>{const statement=original(sql);if(sql!=='SELECT body FROM entities WHERE kind=? AND id=?')return statement;
 const get=statement.get.bind(statement);statement.get=(kind,id)=>{reads.push({kind,id});return get(kind,id);};return statement;});return reads;}
function pad(f,kind,id,bytes){const row=f.store.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind,id);
 assert.ok(Buffer.byteLength(row.body)<bytes);f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(row.body+' '.repeat(bytes-Buffer.byteLength(row.body)),kind,id);}

test('options use the historical project lock, expose only supported profile estimates, and derive language choices from provider policy',async t=>{
 const f=await prepared(t),before=sqlSnapshot(f),options=projectOwnedTranscriptionOptions(f.production,f.project.id);
 assert.deepEqual(options.profiles,[{id:f.profile.id,revision:f.profile.revision,provider:'OpenAI',model:'whisper-1',estimatedMicros:'100',currency:'USD'}]);
 assert.equal(options.timing,'word');assert.equal(options.languages[0],'auto');assert.ok(options.languages.includes('en'));assert.ok(options.languages.includes('zh'));assert.equal(options.languages.includes('zz'),false);
 for(const language of options.languages)assert.doesNotThrow(()=>validateOpenAITranscriptionOptions({model:OPENAI_TRANSCRIPTION_MODEL,language:language==='auto'?null:language,timing:'word'}));
 f.production.profiles.length=0;assert.deepEqual(projectOwnedTranscriptionOptions(f.production,f.project.id),options);
 assert.deepEqual(sqlSnapshot(f),before);assert.ok(Object.isFrozen(options.profiles[0]));
 const encoded=JSON.stringify(options);for(const privateKey of ['configuration','settings','apiKey','endpoint','maxRetries','profileDigest'])assert.equal(encoded.includes(privateKey),false);
});

test('legacy projects without a supported audio profile return an empty choice list without inventing a model or estimate',async t=>{
 const f=await ownedTranscriptionFixture(t),lock=f.store.get('capability_lock',f.project.capabilityLockId);
 update(f,'capability_lock',f.project.capabilityLockId,{...lock,profiles:lock.profiles.filter(profile=>profile.kind!=='transcription')});
 assert.deepEqual(projectOwnedTranscriptionOptions(f.production,f.project.id).profiles,[]);
 const bad={...f.profile,configuration:{model:'unknown',settings:{secret:'DO-NOT-LEAK'}}};
 update(f,'capability_lock',f.project.capabilityLockId,{...lock,profiles:[bad]});const view=projectOwnedTranscriptionOptions(f.production,f.project.id);
 assert.deepEqual(view.profiles,[]);assert.equal(JSON.stringify(view).includes('DO-NOT-LEAK'),false);
});

test('summary preserves exact source, section, configured estimate and all old operation counts without exposing plan source or authority',async t=>{
 const f=await prepared(t,{plan:true,section:true}),before=sqlSnapshot(f),view=summarizeOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);
 const source=f.store.get('owned_transcription_source',f.proposal.sourceBinding.id);
 assert.equal(view.id,f.proposal.id);assert.equal(view.proposalDigest,digest(f.proposal));assert.deepEqual(view.target,source.target);
 assert.deepEqual(view.audio,{id:f.audio.id,sha256:f.source.sha256,durationSeconds:f.source.probe.audio.samples/48000,origin:'uploaded',originEvidence:'human_declared'});
 assert.deepEqual(view.plan,{preservedOperations:6,addedOperations:1});assert.deepEqual(view.baseProject,{headVersion:f.proposal.baseProject.headVersion,revisionId:f.proposal.baseProject.revisionId});
 assert.equal(view.language,'auto');assert.equal(view.estimatedMicros,'100');assert.ok(Object.isFrozen(view));assert.ok(Object.isFrozen(view.target));
 assert.throws(()=>{view.audio.origin='generated';});for(const key of ['compiled','logicalIds','stages','grantId','requestId','path','configuration','sourceRecord'])assert.equal(Object.hasOwn(view,key),false);
 assert.equal(JSON.stringify(view).includes(f.root),false);assert.equal(sqlSnapshot(f),before);
});

test('audio shape summary pins exact source record digest and distinguishes human declarations from verified generated evidence',async t=>{
 const f=await ownedTranscriptionFixture(t);assert.equal(ownedTranscriptionAudioSummary(f.audio).sourceRecordDigest,digest(f.audio));
 const declared={...f.audio,declaredOrigin:'generated'},view=ownedTranscriptionAudioSummary(declared);
 assert.equal(view.origin,'generated');assert.equal(view.originEvidence,'human_declared');assert.equal(view.sourceRecordDigest,digest(declared));
 let getters=0;assert.throws(()=>ownedTranscriptionAudioSummary({...f.audio,get media(){getters++;return f.audio.media;}}));assert.equal(getters,0);
 const generated=await generatedNarrationFixture(t);await generated.narration.attachGeneratedAudio(generated.project.id,generated.human,selection(generated));
 const audio=generated.store.get('narration_audio',generated.artifact.id),calls={...generated.calls},result=ownedTranscriptionAudioSummary(audio);
 assert.equal(result.origin,'generated');assert.equal(result.originEvidence,'verified_generated_audio');assert.equal(result.sourceRecordDigest,digest(audio));assert.deepEqual(generated.calls,calls);
});

test('current eligibility reacts to the selected section only and preserves the immutable summary after edits',async t=>{
 const f=await prepared(t,{section:true}),initial=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);
 assert.deepEqual(initial.eligibility,{current:true,code:null});assert.equal(initial.application,null);assert.equal(initial.execution.state,'not_applied');
 const other=f.view().segments[1];f.revise({update:[{segmentId:other.entry.segmentId,draft:draft('Changed only unrelated writing.')}]});
 assert.deepEqual(projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id).eligibility,{current:true,code:null});
 const selected=f.view().segments[0];f.revise({update:[{segmentId:selected.entry.segmentId,draft:draft('New selected writing.')}]});
 const stale=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);assert.deepEqual(stale.proposal,initial.proposal);
 assert.deepEqual(stale.eligibility,{current:false,code:'OWNED_TRANSCRIPTION_STALE'});
});

test('current head and capability/stage changes report safe eligibility codes without raw failure strings',async t=>{
 for(const mode of ['head','lock','stage']){const f=await prepared(t),before=summarizeOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);
  if(mode==='head'){const project=f.store.getProject(f.project.id);f.store.saveProject({...project,brief:'Later project'},project.headVersion);}
  else if(mode==='lock'){const project=f.store.getProject(f.project.id);f.store.db.prepare('UPDATE projects SET body=? WHERE id=?').run(canonical({...project,capabilityLockId:'missing-current-lock'}),project.id);}
  else {const [stageId]=Object.keys(f.proposal.stageVersions),stage=f.store.get('stage',stageId);if(stage)update(f,'stage',stageId,{...stage,bindingVersion:stage.bindingVersion+1});else f.store.db.prepare('INSERT INTO entities(kind,id,project_id,body) VALUES(?,?,?,?)').run('stage',stageId,f.project.id,canonical({bindingVersion:1}));}
  const view=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);assert.deepEqual(view.proposal,before);assert.equal(view.eligibility.current,false);
  assert.equal(view.eligibility.code,mode==='stage'?'STAGE_BINDING_CONFLICT':'REVISION_CONFLICT');
 }
});

test('applied history remains visible after project and narration changes with an exact candidate-specific job state',async t=>{
 const f=await prepared(t,{section:true}),applied=await apply(f),ready=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);
 assert.deepEqual(ready.application,applied);assert.deepEqual(ready.eligibility,{current:false,code:'APPLIED'});assert.equal(ready.execution.state,'ready');
 const attempt=await admit(f,applied),view=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);
 assert.deepEqual(view.execution,{state:'submission_unknown',generationCandidateId:applied.candidateId,attemptId:attempt.id,code:null});
 const actor=f.production.beginRequest(f.project.id,'human','Change section after submission.');const state=f.narration.snapshot(f.project.id,actor);
 f.narration.reviseSegments(f.project.id,actor,state.state.version,key(),{update:[{segmentId:state.segments[0].entry.segmentId,draft:draft('Later text.')}]});
 const project=f.store.getProject(f.project.id);f.store.saveProject({...project,brief:'Later independent head'},project.headVersion);
 const before=sqlSnapshot(f),later=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);assert.deepEqual(later,view);assert.equal(sqlSnapshot(f),before);
 assert.equal(JSON.stringify(later).includes('private synthetic diagnostic'),false);
});

test('a newer proposal and job for the same recording cannot replace another proposal exact application status',async t=>{
 const f=await prepared(t),first=await apply(f),firstView=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id),oldId=f.proposal.id;
 const actor=f.production.beginRequest(f.project.id,'human','Prepare another explicit transcription.');
 const second=await f.service.prepare(f.project.id,actor,f.input({language:'en'}));f.proposal=second;
 const fresh=await apply(f),attempt=await admit(f,fresh);const newer=projectOwnedTranscriptionProposal(f.store,f.project.id,second.id);
 assert.equal(newer.execution.attemptId,attempt.id);assert.equal(newer.execution.generationCandidateId,fresh.candidateId);
 assert.deepEqual(projectOwnedTranscriptionProposal(f.store,f.project.id,oldId),firstView);assert.equal(firstView.execution.generationCandidateId,first.candidateId);
});

test('corrupt application or attempt metadata becomes explicitly unavailable without losing a verified application receipt',async t=>{
 const f=await prepared(t),applied=await apply(f),attempt=await admit(f,applied),bad={...attempt};delete bad.applicationInput;
 update(f,'attempt',attempt.id,bad);const view=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);
 assert.deepEqual(view.application,applied);assert.equal(view.execution.state,'unavailable');assert.equal(view.eligibility.current,false);
 const application=f.store.get('owned_transcription_application',applied.applicationId);update(f,'owned_transcription_application',application.id,{...application,receipt:{...application.receipt,cursor:0}});
 const missing=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);assert.equal(missing.application,null);assert.equal(missing.execution.state,'unavailable');
});

test('pagination is stable, bounded, immutable and consumes explicit malformed rows instead of hiding them',async t=>{
 const f=await prepared(t);for(let i=0;i<23;i++){const proposal={...f.proposal,id:key()};f.store.insert('owned_transcription_proposal',proposal.id,f.project.id,proposal);}
 const badId=key();f.store.db.prepare('INSERT INTO entities(kind,id,project_id,body) VALUES(?,?,?,?)').run('owned_transcription_proposal',badId,f.project.id,'{}');
 const before=sqlSnapshot(f),page=projectOwnedTranscriptionProposals(f.store,f.project.id);assert.equal(page.coverage.total,25);assert.equal(page.coverage.scanned,20);assert.equal(page.coverage.nextOffset,20);
 assert.deepEqual(page.proposals[0],{id:badId,proposal:null,unavailableCode:'PROPOSAL_UNAVAILABLE'});assert.ok(Object.isFrozen(page.proposals));
 const rest=projectOwnedTranscriptionProposals(f.store,f.project.id,20,page.coverage.dataDigest);assert.equal(rest.coverage.scanned,5);assert.equal(rest.coverage.nextOffset,null);
 assert.equal(new Set([...page.proposals,...rest.proposals].map(row=>row.id)).size,25);assert.equal(sqlSnapshot(f),before);
 const newProposal={...f.proposal,id:key()};f.store.insert('owned_transcription_proposal',newProposal.id,f.project.id,newProposal);
 assert.throws(()=>projectOwnedTranscriptionProposals(f.store,f.project.id,20,page.coverage.dataDigest),{code:'REVISION_CONFLICT'});
 for(const offset of [-1,0.5,1000001,100])assert.throws(()=>projectOwnedTranscriptionProposals(f.store,f.project.id,offset),{code:'VALIDATION_ERROR'});
});

test('oversized proposal body is reported before retrieval or JSON parsing and later rows remain reachable',async t=>{
 const f=await prepared(t),large={...f.proposal,id:key()};f.store.insert('owned_transcription_proposal',large.id,f.project.id,large);pad(f,'owned_transcription_proposal',large.id,limits.recordBytes+1);
 const reads=observeBodies(f,t),page=projectOwnedTranscriptionProposals(f.store,f.project.id);
 assert.deepEqual(page.proposals[0],{id:large.id,proposal:null,unavailableCode:'PROPOSAL_TOO_LARGE'});assert.equal(page.proposals[1].proposal.id,f.proposal.id);
 assert.equal(reads.some(read=>read.id===large.id),false);assert.throws(()=>summarizeOwnedTranscriptionProposal(f.store,f.project.id,large.id),{code:'PROPOSAL_TOO_LARGE'});
 assert.equal(reads.some(read=>read.id===large.id),false);
});

test('one request budget covers referenced source and authority rows before hydration, with explicit progress for an individually excessive closure',async t=>{
 const f=await prepared(t),source=f.store.get('owned_transcription_source',f.proposal.sourceBinding.id);
 for(const [kind,id]of [['owned_transcription_proposal',f.proposal.id],['owned_transcription_source',source.id],['message',source.requestId]])pad(f,kind,id,12*1024**2);
 const reads=observeBodies(f,t),page=projectOwnedTranscriptionProposals(f.store,f.project.id);
 assert.equal(page.proposals[0].unavailableCode,'PROPOSAL_TOO_LARGE');assert.equal(page.coverage.scanned,1);assert.equal(page.coverage.nextOffset,null);assert.ok(page.coverage.readBytes<=limits.readBytes);
 const largeReads=reads.filter(row=>[f.proposal.id,source.id,source.requestId].includes(row.id));assert.equal(largeReads.length,2);
});

test('cumulative proposal budget stops before an unhydrated row and the next page can read it',async t=>{
 const f=await prepared(t),proposals=[f.proposal];for(let i=0;i<2;i++){const row={...f.proposal,id:key()};f.store.insert('owned_transcription_proposal',row.id,f.project.id,row);proposals.push(row);}
 for(const row of proposals)pad(f,'owned_transcription_proposal',row.id,12*1024**2);
 const reads=observeBodies(f,t),page=projectOwnedTranscriptionProposals(f.store,f.project.id);assert.equal(page.coverage.scanned,2);assert.equal(page.coverage.nextOffset,2);assert.ok(page.coverage.readBytes<=limits.readBytes);
 assert.equal(reads.some(row=>row.id===proposals[0].id),false);const next=projectOwnedTranscriptionProposals(f.store,f.project.id,2,page.coverage.dataDigest);
 assert.equal(next.proposals[0].proposal.id,proposals[0].id);assert.equal(next.coverage.nextOffset,null);
});

test('foreign or missing proposal evidence fails closed and unrelated project history is not hydrated',async t=>{
 const f=await prepared(t),other=f.production.createProject('Unrelated project'),reads=observeBodies(f,t);
 assert.throws(()=>summarizeOwnedTranscriptionProposal(f.store,other.id,f.proposal.id));assert.equal(projectOwnedTranscriptionProposals(f.store,other.id).coverage.total,0);
 for(let i=0;i<200;i++)f.store.db.prepare('INSERT INTO entities(kind,id,project_id,body) VALUES(?,?,?,?)').run('narration_audio',key(),f.project.id,'{}');
 projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);assert.equal(reads.filter(row=>row.kind==='narration_audio').length,1);
 update(f,'owned_transcription_source',f.proposal.sourceBinding.id,{});const page=projectOwnedTranscriptionProposals(f.store,f.project.id);
 assert.equal(page.proposals[0].unavailableCode,'PROPOSAL_UNAVAILABLE');
});

test('views do not read media files or repair any SQL and remain available with original/normalized files absent',async t=>{
 const f=await prepared(t),artifact=f.store.get('artifact',f.audio.id);unlinkSync(artifact.path);unlinkSync(join(f.root,'media','blobs',`${f.source.originalSha256}.source`));
 f.media.verifiedSource=()=>assert.fail('Projection must not read files');f.media.describeTranscriptionAudio=()=>assert.fail('Projection must not use tools');
 const before=sqlSnapshot(f);projectOwnedTranscriptionOptions(f.production,f.project.id);projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);projectOwnedTranscriptionProposals(f.store,f.project.id);
 assert.equal(sqlSnapshot(f),before);assert.equal(rows(f,'attempt').length,0);assert.equal(rows(f,'external_allowance').length,0);
});

test('actual same-root restoration retains applied display while quarantine and permanent imported proposal fences deny new approval',async t=>{
 const f=await prepared(t),applied=await apply(f),original=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id),page=projectOwnedTranscriptionProposals(f.store,f.project.id);
 f.store.close();f.provider.close();const backup=await createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,'backup')});
 renameSync(f.root,join(f.parent,'original'));await restoreInstallationBackup({directory:backup.directory,destination:f.root});
 const store=new Store(join(f.root,'openslate.sqlite'));t.after(()=>store.close());const restored={...f,store};const before=sqlSnapshot(restored);
 const quarantine=projectOwnedTranscriptionProposal(store,f.project.id,f.proposal.id);assert.deepEqual(quarantine.application,applied);assert.deepEqual(quarantine.proposal,original.proposal);
 assert.deepEqual(quarantine.eligibility,{current:false,code:'INSTALLATION_QUARANTINED'});assert.equal(projectOwnedTranscriptionProposals(store,f.project.id).coverage.dataDigest,page.coverage.dataDigest);assert.equal(sqlSnapshot(restored),before);
 const guard=new InstallationRecoveryGuard(store),view=guard.snapshot();releaseRecovery(store,{restoreId:view.receipt.restoreId,expectedReceiptDigest:view.receiptDigest,expectedSummaryDigest:view.summaryDigest},{principalId:'human',commandId:key()});
 const releasedBefore=sqlSnapshot(restored),released=projectOwnedTranscriptionProposal(store,f.project.id,f.proposal.id);
 assert.deepEqual(released.application,applied);assert.deepEqual(released.eligibility,{current:false,code:'RESTORED_AUTHORITY_REQUIRES_NEW'});
 assert.equal(sqlSnapshot(restored),releasedBefore);assert.equal(store.list('attempt',f.project.id).length,0);assert.equal(store.list('external_allowance',f.project.id).length,0);
});

test('applied pre-submit execution explains pause and project holds without treating unrelated shot holds as blockers',async t=>{
 const f=await prepared(t,{plan:true}),applied=await apply(f),get=()=>projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);
 assert.equal(get().execution.state,'ready');assert.equal(get().execution.code,null);
 f.engine.setPaused(f.project.id,true,'human');assert.equal(get().execution.code,'EXECUTION_PAUSED');assert.equal(get().execution.state,'ready');
 f.engine.setPaused(f.project.id,false,'human');const hold=f.engine.setHold(f.project.id,{scopeId:f.project.id,ownerId:'test-owner'});
 assert.equal(get().execution.code,'EXECUTION_HELD');f.engine.releaseHold(f.project.id,hold.id,'test-owner');
 f.engine.setHold(f.project.id,{scopeId:f.store.getProject(f.project.id).shots[0].id,ownerId:'shot-owner'});
 assert.equal(get().execution.code,null);assert.deepEqual(get().application,applied);
});

test('applied pre-submit execution reports a retired candidate or changed selected section as obsolete',async t=>{
 for(const mode of ['retired','section']){const f=await prepared(t,{section:true}),applied=await apply(f);
  if(mode==='retired'){const review=f.store.get('owned_transcription_review',applied.reviewId),binding=f.store.get('node_binding',review.nodeId);update(f,'node_binding',binding.id,{...binding,state:'retired'});}
  else {const actor=f.production.beginRequest(f.project.id,'human','Change selected section before any submission.'),state=f.narration.snapshot(f.project.id,actor);
   f.narration.reviseSegments(f.project.id,actor,state.state.version,key(),{update:[{segmentId:state.segments[0].entry.segmentId,draft:draft('Changed selection.')}]});}
  const before=sqlSnapshot(f),view=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);
  assert.deepEqual(view.application,applied);assert.equal(view.execution.state,'unavailable');assert.equal(view.execution.code,'SUBMISSION_PREPARATION_OBSOLETE');assert.equal(sqlSnapshot(f),before);
 }
});

test('post-submission unknown observations retain historical status despite pause, holds or retired current bindings',async t=>{
 const f=await prepared(t),applied=await apply(f),attempt=await admit(f,applied),review=f.store.get('owned_transcription_review',applied.reviewId),binding=f.store.get('node_binding',review.nodeId);
 update(f,'node_binding',binding.id,{...binding,state:'retired'});f.engine.setPaused(f.project.id,true,'human');f.engine.setHold(f.project.id,{scopeId:f.project.id,ownerId:'late-owner'});
 const before=sqlSnapshot(f),view=projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);
 assert.deepEqual(view.execution,{state:'submission_unknown',generationCandidateId:applied.candidateId,attemptId:attempt.id,code:null});assert.equal(sqlSnapshot(f),before);
});

test('actual waiting proof and completed transcript project truthfully before and after current selection changes',async t=>{
 const f=await prepared(t,{section:true}),applied=await apply(f),review=f.store.get('owned_transcription_review',applied.reviewId),calls={http:0};
 const outputs=new ExecutionOutputStore(f.store,{rootDir:join(f.root,'execution-output')}),files=new TranscriptionAudioStore({rootDir:join(f.root,'audio-derivatives')});
 const preparation=new TranscriptionAudioService(f.store,f.media,files),prepare=preparation.prepare.bind(preparation);let busy=true;
 preparation.prepare=async(...args)=>{if(busy)throw new DomainError('MEDIA_BUSY','Synthetic contention');return prepare(...args);};
 const bridge=new OpenAITranscriptionExecution({store:f.store,outputStore:outputs,preparation,credentials:new EnvironmentMediaCredentials(()=> 'synthetic-projection-test-key'),
  fetch:async()=>{calls.http++;return new Response(JSON.stringify({text:'Hello.',language:'english',duration:0.1,words:[{word:'Hello.',start:0,end:0.08}]}),{headers:{'content-type':'application/json'}});}});
 const engine=new Engine(f.store,bridge,{artifactDir:f.artifactDir,profiles:f.profiles,outputStore:outputs,submissionPreparation:bridge,
  outputIngestor:new ExecutionIngestionRouter({transcription:new SpoolTranscriptIngestor(outputs,f.media,files,{artifactDir:f.artifactDir})}),externalAdmission:new DurableExternalAdmission(f.store,()=>{})});
 const input={profileDigest:String(providerProfileArguments(f.profile).profileDigest),profileDefinitionDigest:digest(f.profile),
  selections:[{candidateId:applied.candidateId,nodeId:review.nodeId,specDigest:review.specDigest}],maxAttempts:1,maxEstimatedMicros:'100',expiresAt:new Date(Date.now()+3600000).toISOString()};
 const actor=f.production.beginRequest(f.project.id,'spender','Approve the exact synthetic projection fixture.',{editing:false,scopeIds:[f.project.id],contextDigest:allowanceIssueContextDigest(f.project.id,input)});
 new ExternalAllowanceService(f.store).issue(f.project.id,actor,input);await engine.runReady(f.project.id);
 const waiting=rows(f,'attempt')[0];assert.equal(waiting.phase,'preparing');assert.equal(calls.http,0);
 const project=()=>projectOwnedTranscriptionProposal(f.store,f.project.id,f.proposal.id);assert.equal(project().execution.state,'preparing');assert.equal(project().execution.code,null);
 engine.setPaused(f.project.id,true,'human');assert.equal(project().execution.state,'preparing');assert.equal(project().execution.code,'EXECUTION_PAUSED');engine.setPaused(f.project.id,false,'human');
 busy=false;f.store.put('attempt',waiting.id,f.project.id,{...waiting,leaseExpiresAt:0,preparation:{...waiting.preparation,nextEligibleAt:0}});await engine.reconcile(f.project.id);
 assert.equal(calls.http,1);assert.equal(rows(f,'attempt')[0].phase,'succeeded');assert.equal(rows(f,'transcript_candidate').length,1);
 const done=project();assert.equal(done.execution.state,'succeeded');assert.equal(done.execution.code,null);
 const editor=f.production.beginRequest(f.project.id,'human','Change section after the completed transcript.');const state=f.narration.snapshot(f.project.id,editor);
 f.narration.reviseSegments(f.project.id,editor,state.state.version,key(),{update:[{segmentId:state.segments[0].entry.segmentId,draft:draft('Different later wording.')}]});
 engine.setPaused(f.project.id,true,'human');const before=sqlSnapshot(f);assert.deepEqual(project(),done);assert.equal(sqlSnapshot(f),before);assert.equal(calls.http,1);
});

test('oversized stored identifiers stay bounded and unavailable before identity or body hydration',async t=>{
 const f=await prepared(t),oversized='invalid-identity-'.repeat(20000);
 f.store.db.prepare('INSERT INTO entities(kind,id,project_id,body) VALUES(?,?,?,?)').run('owned_transcription_proposal',oversized,f.project.id,'{}');
 const reads=observeBodies(f,t),page=projectOwnedTranscriptionProposals(f.store,f.project.id),row=page.proposals[0];
 assert.match(row.id,/^unavailable-row-\d+$/);assert.equal(row.proposal,null);assert.equal(row.unavailableCode,'PROPOSAL_UNAVAILABLE');
 assert.ok(Buffer.byteLength(JSON.stringify(page))<limits.responseBytes);assert.equal(reads.some(read=>read.id===oversized),false);
 assert.equal(page.proposals[1].proposal.id,f.proposal.id);
});
