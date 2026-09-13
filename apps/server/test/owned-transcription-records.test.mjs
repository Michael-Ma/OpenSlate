import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '@openslate/core';
import {assertOwnedTranscriptionSource,assertOwnedTranscriptionProposal,ownedTranscriptionCatalog,snapshotOwnedTranscriptionData} from '../dist/narration/owned-transcription-records.js';
import {ownedTranscriptionFixture,key,draft,rows,bodies} from './owned-transcription-fixture.mjs';
import {generatedNarrationFixture,selection as generatedSelection} from './generated-narration-fixture.mjs';

const binding=(f,p)=>f.store.get('owned_transcription_source',p.sourceBinding.id);
const checked=(f,p)=>assertOwnedTranscriptionProposal(f.store,f.project.id,p);
const sourceChecked=(f,s)=>assertOwnedTranscriptionSource(f.store,f.project.id,s);
const protectedKinds=['grant','candidate','attempt','external_allowance','external_allowance_consumption','logical_ids','stage','narration_state','narration_acceptance','narration_canonical'];

test('source and ungranted full-plan proposal retain exact historical closure without authority or current-plan changes',async t=>{
 const f=await ownedTranscriptionFixture(t,{plan:true,section:true}),before={project:canonical(f.store.getProject(f.project.id)),protected:bodies(f,protectedKinds)};
 const p=await f.prepare(),s=binding(f,p),base=f.store.get('plan',p.basePlan.id).compiled;
 sourceChecked(f,s);checked(f,p);
 assert.deepEqual(p.compiled.nodes.filter(n=>n.alias!==p.operation.alias),base.nodes);assert.deepEqual(p.compiled.gates,base.gates);
 assert.deepEqual(ownedTranscriptionCatalog(f.store,f.project.id,p.compiled),[{id:s.id,digest:digest(s),consumerAlias:s.consumerAlias,artifact:s.artifact}]);
 assert.equal(canonical(f.store.getProject(f.project.id)),before.project);assert.equal(bodies(f,protectedKinds),before.protected);
 assert.equal(p.state,'ungranted');assert.equal(s.sourceStartSample,0);assert.equal(s.sourceEndSample,f.audio.media.probe.audio.samples);
 assert.equal(s.artifactRecordDigest,digest(f.store.get('artifact',s.artifact.artifactId)));
});

test('immutable records reject overwrites and insertion failure rolls back both source and proposal',async t=>{
 const f=await ownedTranscriptionFixture(t),p=await f.prepare(),s=binding(f,p);
 assert.deepEqual(f.store.put('owned_transcription_source',s.id,f.project.id,s),s);
 assert.throws(()=>f.store.put('owned_transcription_source',s.id,f.project.id,{...s,consumerAlias:'different-consumer'}),{code:'IMMUTABLE_RECORD'});
 assert.throws(()=>f.store.put('owned_transcription_proposal',p.id,f.project.id,{...p,inputDigest:'f'.repeat(64)}),{code:'IMMUTABLE_RECORD'});
 const newId=key(),before=bodies(f,['owned_transcription_source','owned_transcription_proposal']);
 assert.throws(()=>f.store.transaction(()=>{f.store.insert('owned_transcription_source',newId,f.project.id,{...s,id:newId});
  f.store.insert('owned_transcription_proposal',key(),f.project.id,{...p,id:undefined,state:'granted'});}));
 assert.equal(bodies(f,['owned_transcription_source','owned_transcription_proposal']),before);
});

test('source rejects foreign records, changed descriptors, clipped range, forged artifacts and implicit section choice',async t=>{
 const f=await ownedTranscriptionFixture(t,{section:true}),p=await f.prepare(),s=binding(f,p);
 const changes=[x=>x.sourceRecord.kind='media_source',x=>x.sourceRecord.digest='0'.repeat(64),x=>x.sourceEndSample--,
  x=>x.sourceStartSample=1,x=>x.artifact.sha256='0'.repeat(64),x=>x.artifactRecordDigest='0'.repeat(64),
  x=>x.source.originalSha256='0'.repeat(64),x=>x.target.segmentId=f.view().segments[1].entry.segmentId,
  x=>x.target.narrationRevisionId='missing-revision',x=>x.epochId='missing-epoch',x=>x.principalId='foreign-principal',
  x=>x.unexpectedAuthority=true];
 for(const change of changes){const bad=structuredClone(s);change(bad);assert.throws(()=>sourceChecked(f,bad));}
 const other=f.production.createProject('Foreign');assert.throws(()=>assertOwnedTranscriptionSource(f.store,other.id,{...s,projectId:other.id}));
});

test('historical section/source/proposal survive later edits and request supersession without live authority',async t=>{
 const f=await ownedTranscriptionFixture(t,{section:true}),p=await f.prepare(),s=binding(f,p),segment=f.view().segments[0];
 f.revise({update:[{segmentId:segment.entry.segmentId,draft:draft('A different later draft.')}]});
 f.production.beginRequest(f.project.id,'human','A fresh unrelated request');
 sourceChecked(f,s);checked(f,p);
 assert.notEqual(f.store.get('narration_state',f.project.id).revisionId,s.target.narrationRevisionId);
 assert.equal(f.store.get('message',p.requestId).state,'superseded');
 assert.equal(rows(f,'owned_transcription_proposal').length,1);
});

test('proposal independently rejects changed base, profile, operation, graph, logical IDs, stages and added permission fields',async t=>{
 const f=await ownedTranscriptionFixture(t,{plan:true}),p=await f.prepare();
 const changes=[x=>x.baseProject.digest='0'.repeat(64),x=>x.baseProject.headVersion++,x=>x.basePlan.digest='0'.repeat(64),
  x=>x.capabilityLock.digest='0'.repeat(64),x=>x.profile.unitCostMicros='999',x=>x.sourceBinding.digest='0'.repeat(64),
  x=>x.operation.language='fr',x=>x.operation.inputBindingId='foreign',x=>x.compiled.nodes[0].args.prompt='Changed old frame',
  x=>x.compiled.gates[0].members[0].recipeDigest='0'.repeat(64),x=>x.compiled.graphDigest='0'.repeat(64),
  x=>x.logicalIds[x.operation.alias]='wrong-node',x=>x.impact=[],x=>x.stages=[],x=>x.stageVersions={},
  x=>x.stageVersions[Object.keys(x.stageVersions)[0]]=-1,x=>x.state='approved',x=>x.grantBindings={}];
 for(const change of changes){const bad=structuredClone(p);change(bad);assert.throws(()=>checked(f,bad));}
});

test('compact catalog resolves exact keyed consumers without scanning unrelated malformed history',async t=>{
 const f=await ownedTranscriptionFixture(t),p=await f.prepare(),s=binding(f,p);
 f.store.db.prepare("INSERT INTO entities(kind,id,project_id,body) VALUES('narration_audio',?,?,?)").run(key(),f.project.id,canonical({unrelated:'not a valid narration record',padding:'x'.repeat(1000000)}));
 const list=f.store.list;f.store.list=()=>assert.fail('No history scan is permitted');
 try{sourceChecked(f,s);checked(f,p);assert.equal(ownedTranscriptionCatalog(f.store,f.project.id,p.compiled).length,1);
  const bad=structuredClone(p.compiled);bad.nodes[0].applicationInput.digest='0'.repeat(64);assert.throws(()=>ownedTranscriptionCatalog(f.store,f.project.id,bad));
  bad.nodes[0].applicationInput.digest=digest(s);bad.nodes[0].alias='escaped';assert.throws(()=>ownedTranscriptionCatalog(f.store,f.project.id,bad));
  assert.deepEqual(ownedTranscriptionCatalog(f.store,f.project.id,null),[]);
 }finally{f.store.list=list;}
});

test('bounded capture rejects getters/proxies/sparse and cyclic data without invoking caller code',()=>{
 let calls=0;const getter={};Object.defineProperty(getter,'payload',{enumerable:true,get(){calls++;return 'secret';}});
 const proxy=new Proxy({}, {ownKeys(){calls++;return [];},getPrototypeOf(){calls++;return Object.prototype;}});
 const cycle={};cycle.self=cycle;
 for(const input of [getter,proxy,cycle,new Array(3),{value:Infinity},{value:undefined},new Date(),{value:'x'.repeat(129)}])
  assert.throws(()=>snapshotOwnedTranscriptionData(input,128));
 assert.equal(calls,0);const input={nested:[{value:'kept'}]},copy=snapshotOwnedTranscriptionData(input);input.nested[0].value='changed';assert.equal(copy.nested[0].value,'kept');
});

test('proposal retains bounded long historical alias snapshots and noncurrent stage versions',async t=>{
 const f=await ownedTranscriptionFixture(t),p=await f.prepare(),historical=structuredClone(p);
 historical.logicalIds['a'.repeat(2048)]='i'.repeat(256);historical.stageVersions[Object.keys(historical.stageVersions)[0]]=42;
 checked(f,historical);assert.equal(historical.logicalIds['a'.repeat(2048)].length,256);
});

test('source pins actual verified generated narration and preserves original generated artifact metadata',async t=>{
 const f=await generatedNarrationFixture(t);await f.narration.attachGeneratedAudio(f.project.id,f.human,generatedSelection(f));
 const audio=f.view().segments[0].audio,artifact=f.store.get('artifact',audio.id),calls={...f.calls};
 const s={id:key(),version:1,projectId:f.project.id,requestId:f.human.requestId,principalId:f.human.principalId,epochId:null,
  consumerAlias:'owned-generated-recording',sourceRecord:{kind:'narration_audio',id:audio.id,digest:digest(audio)},source:audio.media,
  sourceStartSample:0,sourceEndSample:audio.media.probe.audio.samples,artifact:artifact.artifact,artifactRecordDigest:digest(artifact),target:{kind:'recording'}};
 f.store.insert('owned_transcription_source',s.id,f.project.id,s);sourceChecked(f,s);
 assert.deepEqual(f.store.get('artifact',audio.id),artifact);assert.equal(artifact.origin,'generated_audio');assert.deepEqual(f.calls,calls);
 const raw=f.store.get('speech_execution_result',audio.generation.attemptId);
 assert.ok(raw);f.store.db.prepare("UPDATE entities SET body=? WHERE kind='speech_execution_result' AND id=?").run(canonical({...raw,dispatchDigest:'0'.repeat(64)}),raw.id);
 assert.throws(()=>sourceChecked(f,s));
});
