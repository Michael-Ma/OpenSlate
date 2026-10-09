import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical,digest,DomainError} from '@openslate/core';
import {readFileSync} from 'node:fs';
import {generatedNarrationFixture} from './generated-narration-fixture.mjs';
import {NarrationSpeechService} from '../dist/narration/narration-speech-service.js';
import {projectNarrationSpeechProposal} from '../dist/narration/narration-speech-projection.js';
async function request(f){const current=f.store.getProject(f.project.id),saved=f.store.saveProject({...current,revisionId:randomUUID()},current.headVersion);f.store.insert('project_revision',saved.revisionId,f.project.id,{project:saved});const plan=f.store.get('plan',saved.activePlanId).compiled;f.store.put('logical_ids',f.project.id,f.project.id,{aliases:Object.fromEntries([...plan.nodes,...plan.gates].map(node=>[node.alias,node.id]))});const row=f.view().segments[0];return new NarrationSpeechService(f.narration).request(f.project.id,f.human,{key:randomUUID(),expectedHeadVersion:f.store.getProject(f.project.id).headVersion,segmentId:row.entry.segmentId,segmentRevisionId:row.script.id,profileId:f.profile.id,voice:'coral',instructions:''});}
test('speech detail projects only its exact completed generated recording and read has no execution side effects',async t=>{
  const f=await generatedNarrationFixture(t,{configuredAdmission:true}),operation=await request(f),pending=projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id);
  assert.equal(pending.recording,null);assert.equal(pending.execution.state,'ready');
  await f.engine.runReady();const attempt=f.engine.attempts(f.project.id).find(attempt=>attempt.candidateId===operation.receipt.candidateId);
  assert.equal(attempt.phase,'succeeded');const counts={...f.calls},before=canonical(f.store.db.prepare('SELECT * FROM entities ORDER BY kind,id').all());
  const {resolveGeneratedNarrationAudio}=await import('../dist/narration/generated-audio.js');resolveGeneratedNarrationAudio(f.store,f.project.id,attempt.outputs.audio.artifactId);
  const detail=projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id);
  assert.ok(detail.recording,JSON.stringify({execution:detail.execution,readId:attempt.outputs.audio.artifactId}));
  assert.equal(detail.recording.id,attempt.outputs.audio.artifactId);assert.equal(detail.recording.originEvidence,'verified_generated_audio');
  assert.equal(detail.execution.attemptId,attempt.id);assert.equal(detail.execution.candidateId,operation.receipt.candidateId);
  assert.ok(detail.recording.selection.artifactDigest);assert.ok(detail.recording.selection.generationEvidenceDigest);
  assert.equal(canonical(f.store.db.prepare('SELECT * FROM entities ORDER BY kind,id').all()),before);assert.deepEqual(f.calls,counts);
});
test('speech detail never selects a prior recording while this candidate is pending or unknown',async t=>{
  const f=await generatedNarrationFixture(t,{configuredAdmission:true}),operation=await request(f),pending=projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id);
  assert.equal(pending.recording,null);assert.equal(f.store.list('artifact',f.project.id).length,1,'the unrelated earlier recording exists');
  const counts={...f.calls};f.bridge.submit=async()=>({type:'unknown',diagnostic:'synthetic unknown'});await f.engine.runReady();
  const detail=projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id);assert.equal(detail.execution.state,'submission_unknown');assert.equal(detail.recording,null);assert.deepEqual(f.calls,counts);
});
test('speech detail refuses a successful operation whose stored output points to another valid recording',async t=>{
  const f=await generatedNarrationFixture(t,{configuredAdmission:true}),operation=await request(f);await f.engine.runReady();
  const attempt=f.engine.attempts(f.project.id).find(attempt=>attempt.candidateId===operation.receipt.candidateId),row=f.store.db.prepare("SELECT body FROM entities WHERE kind='attempt' AND id=?").get(attempt.id),forged=JSON.parse(row.body);
  forged.outputs.audio=f.artifact.artifact;f.store.db.prepare("UPDATE entities SET body=? WHERE kind='attempt' AND id=?").run(JSON.stringify(forged),attempt.id);
  try{const detail=projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id);assert.equal(detail.recording,null);assert.equal(detail.execution.state,'unavailable');}
  finally{f.store.db.prepare("UPDATE entities SET body=? WHERE kind='attempt' AND id=?").run(row.body,attempt.id);}
});

test('owned local ingestion attention is sanitized, deduplicated, visible after reopen and resolves without another provider call',async t=>{
  const f=await generatedNarrationFixture(t,{configuredAdmission:true}),operation=await request(f);
  f.engine.outputIngestor.ingest=async()=>{throw new DomainError('AUDIO_PCM_INVALID','private path /secret/location and token synthetic-secret-key');};
  await assert.rejects(f.engine.runReady(),{code:'AUDIO_PCM_INVALID'});
  let attempt=f.engine.attempts(f.project.id).find(attempt=>attempt.candidateId===operation.receipt.candidateId);
  assert.equal(attempt.phase,'ingesting');assert.equal(attempt.failure,null);assert.deepEqual(attempt.outputs,{});
  const issue=f.store.get('attempt_ingestion_issue',attempt.id);assert.equal(issue.requestDigest,digest(attempt.request));assert.equal(issue.code,'AUDIO_PCM_INVALID');assert.equal(issue.active,true);
  assert.equal(JSON.stringify(issue).includes('/secret/'),false);assert.equal(JSON.stringify(issue).includes('synthetic-secret-key'),false);
  const evidence=f.store.list('execution_evidence',f.project.id).find(row=>row.attemptId===attempt.id&&row.outcome.type==='completed');
  const owned=await f.outputs.resolveOutput(f.project.id,attempt.id,evidence.outcome.outputs[0]),raw=readFileSync(owned.path),calls={...f.calls};
  const protectedCounts=Object.fromEntries(['grant','candidate','attempt'].map(kind=>[kind,f.store.list(kind,f.project.id).length]));
  assert.equal(f.store.get('reservation',attempt.reservationId).state,'reserved');
  let detail=projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id);assert.equal(detail.execution.state,'ingesting');assert.equal(detail.execution.code,'AUDIO_PCM_INVALID');assert.equal(detail.recording,null);
  f.store.put('attempt',attempt.id,f.project.id,{...attempt,leaseExpiresAt:0});await assert.rejects(f.engine.reconcile(),{code:'AUDIO_PCM_INVALID'});
  assert.deepEqual(f.store.get('attempt_ingestion_issue',attempt.id),issue);assert.equal(f.store.readEvents(f.project.id).filter(event=>event.kind==='attempt.ingestion_attention'&&event.payload.attemptId===attempt.id).length,1);assert.deepEqual(f.calls,calls);assert.deepEqual(readFileSync(owned.path),raw);
  f.store.close();f.open(true);detail=projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id);assert.equal(detail.execution.code,'AUDIO_PCM_INVALID');assert.deepEqual(f.calls,calls);
  f.store.close();f.open(false);attempt=f.store.get('attempt',attempt.id);f.store.put('attempt',attempt.id,f.project.id,{...attempt,leaseExpiresAt:0});
  f.bridge.poll=f.bridge.lookup=async()=>{throw Error('Retained local ingestion must never revisit the provider');};
  await f.engine.reconcile();const finished=f.store.get('attempt',attempt.id);assert.equal(finished.phase,'succeeded');assert.equal(finished.failure,null);assert.equal(finished.ordinal,1);
  assert.equal(f.store.get('reservation',attempt.reservationId).state,'charged');assert.equal(f.store.get('attempt_ingestion_issue',attempt.id).active,false);
  for(const[kind,count]of Object.entries(protectedCounts))assert.equal(f.store.list(kind,f.project.id).length,count);
  assert.equal(f.calls.http,calls.http);assert.equal(f.calls.credentials,calls.credentials);assert.deepEqual(readFileSync(owned.path),raw);
  detail=projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id);assert.equal(detail.execution.code,null);assert.ok(detail.recording);
  assert.equal(f.store.readEvents(f.project.id).filter(event=>event.kind==='attempt.ingestion_issue_resolved'&&event.payload.attemptId===attempt.id).length,1);
});

test('a late local ingestion error cannot write attention after losing its exact worker lease',async t=>{
  const f=await generatedNarrationFixture(t,{configuredAdmission:true}),operation=await request(f);let replacement;
  f.engine.outputIngestor.ingest=async({attempt})=>{const current=f.store.get('attempt',attempt.id);replacement={...current,leaseOwner:'replacement-worker',leaseEpoch:current.leaseEpoch+1,leaseExpiresAt:Date.now()+60000};f.store.put('attempt',current.id,current.projectId,replacement);throw new DomainError('AUDIO_PCM_INVALID','late owned output failure');};
  await assert.rejects(f.engine.runReady(),{code:'AUDIO_PCM_INVALID'});
  assert.deepEqual(f.store.get('attempt',replacement.id),replacement);assert.equal(f.store.get('attempt_ingestion_issue',replacement.id),undefined);
  assert.equal(projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id).execution.code,null);assert.equal(f.calls.http,f.initialCalls.http+1);
});

for(const code of['MEDIA_BUSY','MEDIA_CANCELLED','LOCAL_EXECUTION_LEASE_LOST','RESTORED_AUTHORITY_REQUIRES_NEW'])test(`local ${code} does not become a retained ingestion attention issue`,async t=>{
  const f=await generatedNarrationFixture(t,{configuredAdmission:true}),operation=await request(f);f.engine.outputIngestor.ingest=async()=>{throw new DomainError(code,'synthetic expected wait or obsolete scope');};
  if(code==='MEDIA_BUSY')await f.engine.runReady();else await assert.rejects(f.engine.runReady(),{code});
  const attempt=f.engine.attempts(f.project.id).find(attempt=>attempt.candidateId===operation.receipt.candidateId);
  assert.equal(attempt.phase,'ingesting');assert.equal(attempt.failure,null);assert.equal(f.store.get('attempt_ingestion_issue',attempt.id),undefined);
  assert.equal(projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id).execution.code,null);
});

test('speech attention display rejects mismatched observation identity and unsafe diagnostic codes',async t=>{
  const f=await generatedNarrationFixture(t,{configuredAdmission:true}),operation=await request(f);f.engine.outputIngestor.ingest=async()=>{throw new DomainError('UNRECOGNIZED_SECRET_LABEL','private path /secret/location and private message');};
  await assert.rejects(f.engine.runReady());const attempt=f.engine.attempts(f.project.id).find(attempt=>attempt.candidateId===operation.receipt.candidateId),issue=f.store.get('attempt_ingestion_issue',attempt.id);
  assert.equal(issue.code,'OUTPUT_INGESTION_FAILED');assert.equal(JSON.stringify(issue).includes('UNRECOGNIZED_SECRET_LABEL'),false);assert.equal(JSON.stringify(issue).includes('/secret/'),false);
  assert.equal(projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id).execution.code,'OUTPUT_INGESTION_FAILED');
  for(const field of ['attemptId','requestDigest','nodeId','candidateId']){f.store.put('attempt_ingestion_issue',attempt.id,f.project.id,{...issue,[field]:'unrelated'});assert.equal(projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id).execution.code,null);}
  f.store.put('attempt_ingestion_issue',attempt.id,f.project.id,issue);assert.equal(projectNarrationSpeechProposal(f.store,f.project.id,operation.proposal.id).execution.code,issue.code);
});
