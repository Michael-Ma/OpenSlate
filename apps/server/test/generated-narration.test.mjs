import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {projectFixture} from './execution-fixture.mjs';
import {canonical,digest} from '@openslate/core';
import {assertGeneratedCanonicalNarrationSegment,resolveGeneratedNarrationAudio} from '../dist/narration/generated-audio.js';
import {generatedNarrationFixture,key,draft,rows,bodies,selection,acceptAll} from './generated-narration-fixture.mjs';

const protectedKinds=['grant','candidate','attempt','reservation','external_allowance','external_allowance_consumption','hold','approval','narration_acceptance','narration_canonical','plan'];
const attach=(f,input=selection(f),actor=f.human,options={})=>f.narration.attachGeneratedAudio(f.project.id,actor,input,options);
const gate=()=>{let release,entered;const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r);return{ready,wait,release,entered};};


test('explicit generated selection binds existing identity and only changes the selected section',async t=>{
 const f=await generatedNarrationFixture(t),before=f.view(),protectedRows=bodies(f,protectedKinds),project=canonical(f.store.getProject(f.project.id));
 f.narration.accept(f.project.id,f.human,f.view().state.version,key(),'script',[before.segments[0].script.id]);const accepted=f.view().segments[0].entry.scriptAcceptanceId;
 const acceptedRows=bodies(f,protectedKinds),result=await attach(f);assert.equal(result.segments[0].audio.id,f.artifact.id);assert.equal(result.segments[0].audio.media.artifactId,f.artifact.id);
 assert.deepEqual(result.segments[0].audio.media,f.source.source);assert.equal(result.segments[0].audio.originEvidence,'verified_generated_audio');assert.equal(Object.hasOwn(result.segments[0].audio,'declaredOrigin'),false);assert.equal(Object.hasOwn(result.segments[0].audio,'requestId'),false);
 assert.equal(result.segments[0].entry.scriptAcceptanceId,accepted);assert.equal(result.segments[0].entry.audioAcceptanceId,null);assert.equal(result.segments[0].entry.cueId,null);assert.deepEqual(result.segments[1],before.segments[1]);
 assert.deepEqual(result.segments[0].script.source,{kind:'generated',voice:null,profileRevisionId:null});assert.equal(result.readiness.gaps.some(x=>x.segmentId===before.segments[0].entry.segmentId&&x.category==='missing_voice_or_profile'),false);
 assert.equal(bodies(f,protectedKinds),acceptedRows);assert.notEqual(protectedRows,acceptedRows);assert.equal(canonical(f.store.getProject(f.project.id)),project);assert.deepEqual(f.calls,f.initialCalls);
 const revision=rows(f,'narration_revision').at(-1);assert.equal(revision.requestId,f.human.requestId);assert.equal(rows(f,'narration_audio').length,1);
 assert.equal(f.store.readEvents(f.project.id,0).filter(e=>e.kind==='narration.generated_audio_attached').length,1);
});

test('concurrent same-key verified selections return one committed result and revision',async t=>{
 const f=await generatedNarrationFixture(t),input=selection(f),g=gate(),original=f.narration.verifyGeneratedAudio.bind(f.narration);let count=0;
 f.narration.verifyGeneratedAudio=async(...args)=>{if(++count===2)g.entered();await g.wait;return original(...args);};
 const first=attach(f,input),second=attach(f,input);await g.ready;g.release();const [a,b]=await Promise.all([first,second]);
 assert.deepEqual(a,b);assert.equal(f.view().state.version,input.expectedVersion+1);assert.equal(rows(f,'narration_audio').length,1);assert.equal(f.store.readEvents(f.project.id,0).filter(e=>e.kind==='narration.generated_audio_attached').length,1);
});

test('lost-response replay after another saved edit needs no media and rejects changed command content',async t=>{
 const f=await generatedNarrationFixture(t),input=selection(f),saved=await attach(f,input);
 f.revise({update:[{segmentId:input.segmentId,draft:draft('Changed later.')} ]});const version=f.view().state.version;
 unlinkSync(f.artifact.path);
 f.narration.verifyGeneratedAudio=async()=>{throw Error('Completed command replay must not read media');};
 assert.deepEqual(await attach(f,input),saved);assert.equal(f.view().state.version,version);
 await assert.rejects(attach(f,{...input,artifactDigest:'f'.repeat(64)}),{code:'IDEMPOTENCY_CONFLICT'});
 f.production.beginRequest(f.project.id,'human','Supersede the old completed selection request');await assert.rejects(attach(f,input));
});

test('old binding method cannot bypass generated selection even for a human or director actor',async t=>{
 const f=await generatedNarrationFixture(t);await attach(f);const other=f.view().segments[1];
 assert.throws(()=>f.narration.bindAudio(f.project.id,f.human,f.view().state.version,key(),other.entry.segmentId,f.artifact.id),{code:'NARRATION_GENERATED_ATTACHMENT_REQUIRED'});
 const actor=f.production.openEpoch(f.project.id,f.human).actor;
 assert.throws(()=>f.narration.bindAudio(f.project.id,actor,f.view().state.version,key(),other.entry.segmentId,f.artifact.id),{code:'NARRATION_GENERATED_ATTACHMENT_REQUIRED'});
 await assert.rejects(attach(f,selection(f,1),actor),{code:'ACTOR_DENIED'});
});

test('stale section, wrong source choice and changed frozen identities fail before media verification',async t=>{
 const f=await generatedNarrationFixture(t),input=selection(f);let reads=0;f.narration.verifyGeneratedAudio=async()=>{reads++;throw Error('Must reject before media');};
 for(const patch of [{expectedVersion:input.expectedVersion+1},{segmentRevisionId:key()},{artifactDigest:'f'.repeat(64)},{generationEvidenceDigest:'f'.repeat(64)}])await assert.rejects(attach(f,{...input,...patch,key:key()}));
 f.revise({update:[{segmentId:input.segmentId,draft:{...draft(),source:{kind:'uploaded'}}}]});await assert.rejects(attach(f,selection(f)),{code:'NARRATION_SOURCE_UNDECIDED'});assert.equal(reads,0);assert.equal(rows(f,'narration_audio').length,0);
});

test('version change during verification cannot publish stale generated selection',async t=>{
 const f=await generatedNarrationFixture(t),input=selection(f),g=gate(),original=f.narration.verifyGeneratedAudio.bind(f.narration);
 f.narration.verifyGeneratedAudio=async(...args)=>{g.entered();await g.wait;return original(...args);};const pending=attach(f,input);await g.ready;
 f.revise({update:[{segmentId:input.segmentId,draft:draft('Concurrent writing.')} ]});const current=f.view();g.release();await assert.rejects(pending,{code:'REVISION_CONFLICT'});assert.deepEqual(f.view(),current);assert.equal(rows(f,'narration_audio').length,0);
});

test('superseded human request during verification cannot borrow its replacement authority',async t=>{
 const f=await generatedNarrationFixture(t),input=selection(f),g=gate(),original=f.narration.verifyGeneratedAudio.bind(f.narration);
 f.narration.verifyGeneratedAudio=async(...args)=>{g.entered();await g.wait;return original(...args);};const pending=attach(f,input);await g.ready;
 f.production.beginRequest(f.project.id,'human','A new project edit supersedes selection');g.release();await assert.rejects(pending);assert.equal(rows(f,'narration_audio').length,0);
});

test('captured input and original cancellation survive mutable caller options',async t=>{
 const f=await generatedNarrationFixture(t),input=selection(f),originalInput=structuredClone(input),human=structuredClone(f.human),controller=new AbortController(),options={signal:controller.signal},g=gate(),original=f.narration.verifyGeneratedAudio.bind(f.narration);
 f.narration.verifyGeneratedAudio=async(...args)=>{g.entered();await g.wait;return original(...args);};const pending=attach(f,input,human,options);await g.ready;
 input.segmentId=f.view().segments[1].entry.segmentId;human.requestId=key();options.signal=new AbortController().signal;controller.abort();g.release();await assert.rejects(pending);assert.equal(rows(f,'narration_audio').length,0);assert.equal(f.view().state.version,originalInput.expectedVersion);
});

test('SQL failure rolls back generated recording, binding, revision and selection event',async t=>{
 const f=await generatedNarrationFixture(t),input=selection(f),before=f.view(),events=f.store.readEvents(f.project.id,0),insert=f.store.insert.bind(f.store);
 f.store.insert=(...args)=>{if(args[0]==='narration_revision')throw Error('Injected narration revision failure');return insert(...args);};
 await assert.rejects(attach(f,input),/Injected narration revision failure/);f.store.insert=insert;assert.deepEqual(f.view(),before);assert.equal(rows(f,'narration_audio').length,0);assert.deepEqual(f.store.readEvents(f.project.id,0),events);
 const result=await attach(f,input);assert.equal(result.segments[0].audio.id,f.artifact.id);assert.deepEqual(f.calls,f.initialCalls);
});

test('Store rejects a generated recording whose pinned provenance changes',async t=>{
 const f=await generatedNarrationFixture(t),resolved=resolveGeneratedNarrationAudio(f.store,f.project.id,f.artifact.id);
 assert.throws(()=>f.store.insert('narration_audio',f.artifact.id,f.project.id,{...resolved.audio,declaredOrigin:'generated',requestId:f.human.requestId}));
 await attach(f);assert.throws(()=>f.store.put('narration_audio',f.artifact.id,f.project.id,{...resolved.audio,media:{...resolved.audio.media,sha256:'f'.repeat(64)}}));
});

test('human acceptance and canonical application preserve generated artifact and provenance without relabeling',async t=>{
 const f=await generatedNarrationFixture(t);f.revise({remove:[f.view().segments[1].entry.segmentId]});await attach(f);await acceptAll(f);
 const original=canonical(f.store.get('artifact',f.artifact.id)),calls={...f.calls};const prepared=f.prepare(),receipt=await f.canonical.apply(f.project.id,f.human,prepared.id),saved=f.canonical.workspaceCurrent(f.project.id);
 assert.equal(saved.segments[0].provenance.originEvidence,'verified_generated_audio');assert.deepEqual(saved.segments[0].provenance.generation,f.view().segments[0].audio.generation);assert.equal(Object.hasOwn(saved.segments[0].provenance,'declaredOrigin'),false);
 assert.equal(canonical(f.store.get('artifact',f.artifact.id)),original);assert.equal(rows(f,'artifact').length,1);assert.deepEqual(f.calls,calls);assert.equal(saved.source,'generated');assert.deepEqual(await f.canonical.apply(f.project.id,f.human,prepared.id),receipt);
 const {generation,...plain}=saved.segments[0].provenance;const legacy={...plain,originEvidence:'human_declared_supplied_recording',declaredOrigin:'generated'};
 assert.throws(()=>f.store.insert('narration_canonical',key(),f.project.id,{...saved,id:undefined,segments:[{...saved.segments[0],provenance:legacy}]}));
});

test('canonical prepare and apply revalidate retained generation evidence',async t=>{
 const f=await generatedNarrationFixture(t);f.revise({remove:[f.view().segments[1].entry.segmentId]});await attach(f);await acceptAll(f);const prepared=f.prepare(),before=canonical(f.store.getProject(f.project.id));
 f.store.db.prepare("DELETE FROM entities WHERE kind='speech_execution_dispatch' AND id=?").run(f.attempt.id);
 assert.throws(()=>f.prepare());await assert.rejects(f.canonical.apply(f.project.id,f.human,prepared.id));assert.equal(canonical(f.store.getProject(f.project.id)),before);assert.equal(rows(f,'narration_canonical').length,0);
});

test('generated canonical persistence reconstructs the exact saved cue and revision placement',async t=>{
 const f=await generatedNarrationFixture(t);f.revise({remove:[f.view().segments[1].entry.segmentId]});await attach(f);await acceptAll(f);
 // Choose a non-frame-aligned position so both relative duration and absolute end rounding matter.
 f.narration.placeSegments(f.project.id,f.human,f.view().state.version,key(),[{segmentId:f.view().segments[0].entry.segmentId,atSample:801}]);
 const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);const saved=f.canonical.workspaceCurrent(f.project.id),calls={...f.calls};
 for(const change of [
  c=>c.segments[0].cue.meaning='Different unapproved meaning',
  c=>{c.segments[0].audioPlacement.startSample=1;c.segments[0].audioPlacement.durationSamples-=1;},
  c=>c.segments[0].audioPlacement.atSample+=1600,
  c=>c.segments[0].audioPlacement.gainMilliDb=-1000,
  c=>c.segments[0].frameCoverage.endFrame+=1,
  c=>c.segments[0].cue.durationFrames+=1,
  c=>c.narrationVersion+=1,
  c=>c.narrationRevisionId=key(),
 ]){const copy=structuredClone(saved);copy.id=key();change(copy);assert.throws(()=>f.store.insert('narration_canonical',copy.id,f.project.id,copy),{code:'GENERATED_NARRATION_CONFLICT'});}
 // Later editing and request supersession cannot invalidate an immutable historical selection.
 f.revise({update:[{segmentId:saved.segments[0].segmentId,draft:draft('Later unaccepted wording.')}]});
 f.production.beginRequest(f.project.id,'human','Another human edit after this saved canonical version');
 assertGeneratedCanonicalNarrationSegment(f.store,f.project.id,saved.segments[0],{narrationRevisionId:saved.narrationRevisionId,narrationVersion:saved.narrationVersion});
 assert.equal(rows(f,'narration_canonical').length,1);assert.deepEqual(f.calls,calls);
});

test('generated canonical persistence requires the selected acceptance and its original human request evidence',async t=>{
 const f=await generatedNarrationFixture(t);f.revise({remove:[f.view().segments[1].entry.segmentId]});await attach(f);await acceptAll(f);
 const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);const saved=f.canonical.workspaceCurrent(f.project.id),acceptanceId=saved.segments[0].provenance.audioAcceptanceId;
 const row=f.store.db.prepare("SELECT body FROM entities WHERE kind='narration_acceptance' AND id=?").get(acceptanceId),accepted=JSON.parse(row.body);
 for(const changed of [{...accepted,requestId:'missing-human-acceptance-request'},{...accepted,principalId:'different-human'}]){
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='narration_acceptance' AND id=?").run(canonical(changed),acceptanceId);
  try{const copy={...saved,id:key()};assert.throws(()=>f.store.insert('narration_canonical',copy.id,f.project.id,copy),{code:'GENERATED_NARRATION_CONFLICT'});}
  finally{f.store.db.prepare("UPDATE entities SET body=? WHERE kind='narration_acceptance' AND id=?").run(row.body,acceptanceId);}
 }
 // Even a valid same-subject later acceptance cannot replace the one selected in that revision.
 f.narration.acceptAudio(f.project.id,f.human,f.view().state.version,key(),[{segmentRevisionId:saved.segments[0].segmentRevisionId,audioId:f.artifact.id}]);
 const copy=structuredClone(saved);copy.id=key();copy.segments[0].provenance.audioAcceptanceId=f.view().segments[0].entry.audioAcceptanceId;
 assert.throws(()=>f.store.insert('narration_canonical',copy.id,f.project.id,copy),{code:'GENERATED_NARRATION_CONFLICT'});
 assert.equal(rows(f,'narration_canonical').length,1);assert.deepEqual(f.calls,f.initialCalls);
});


test('missing original generated PCM blocks a first selection even when normalized artifact is intact',async t=>{
 const f=await generatedNarrationFixture(t),input=selection(f),artifact=readFileSync(f.artifact.path);unlinkSync(join(f.root,'media','blobs',`${f.source.source.originalSha256}.source`));
 await assert.rejects(attach(f,input));assert.equal(rows(f,'narration_audio').length,0);assert.deepEqual(readFileSync(f.artifact.path),artifact);assert.deepEqual(f.calls,f.initialCalls);
});

test('generated canonical selection preserves historical supplied bytes/provenance and unrelated shots',async t=>{
 const f=await generatedNarrationFixture(t),current=f.store.getProject(f.project.id),fixture=projectFixture(f.project.id,2);
 const seeded=f.store.saveProject({...current,revisionId:key(),brief:fixture.brief,story:fixture.story,scenes:fixture.scenes,shots:fixture.shots},current.headVersion);
 f.store.insert('project_revision',seeded.revisionId,f.project.id,{project:seeded});
 const raw=join(f.root,'execution-output','blobs',`${f.source.source.originalSha256}.blob`);
 const uploaded=await f.narration.importAudio(f.project.id,f.human,{path:raw,declaredOrigin:'generated',key:key()});
 assert.deepEqual(Object.keys(uploaded).sort(),['id','projectId','media','declaredOrigin','requestId'].sort());
 for(const segment of f.view().segments)f.narration.bindAudio(f.project.id,f.human,f.view().state.version,key(),segment.entry.segmentId,uploaded.id);
 f.narration.placeSegments(f.project.id,f.human,f.view().state.version,key(),[{segmentId:f.view().segments[1].entry.segmentId,atSample:48000}]);await acceptAll(f);
 const legacyPrepared=f.prepare();await f.canonical.apply(f.project.id,f.human,legacyPrepared.id);const legacy=f.canonical.workspaceCurrent(f.project.id),legacyHash=digest(legacy),uploadHash=digest(uploaded),other=structuredClone(f.view().segments[1]),shots=canonical(f.store.getProject(f.project.id).shots);
 for(const segment of legacy.segments){const p=segment.provenance;assert.deepEqual(Object.keys(p).sort(),['audioId','declaredOrigin','originEvidence','scriptAcceptanceId','audioAcceptanceId','timingAcceptanceId','originalSha256','toolchainDigest'].sort());assert.equal(p.originEvidence,'human_declared_supplied_recording');assert.equal(p.declaredOrigin,'generated');}
 await attach(f);const first=f.view().segments[0];f.narration.recordHumanCue(f.project.id,f.human,f.view().state.version,key(),{segmentId:first.entry.segmentId,startSample:0,endSample:48000});
 f.narration.acceptAudio(f.project.id,f.human,f.view().state.version,key(),[{segmentRevisionId:first.script.id,audioId:f.artifact.id}]);f.narration.accept(f.project.id,f.human,f.view().state.version,key(),'timing',[f.view().segments[0].cue.id]);
 const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);const next=f.canonical.workspaceCurrent(f.project.id);
 assert.equal(next.segments[0].provenance.originEvidence,'verified_generated_audio');assert.deepEqual(next.segments[1].provenance,legacy.segments[1].provenance);assert.deepEqual(f.view().segments[1],other);
 assert.equal(digest(f.store.get('narration_audio',uploaded.id)),uploadHash);assert.equal(digest(f.store.get('narration_canonical',legacy.id)),legacyHash);assert.equal(canonical(f.store.getProject(f.project.id).shots),shots);assert.equal(f.store.get('artifact',f.artifact.id).origin,'generated_audio');
});
