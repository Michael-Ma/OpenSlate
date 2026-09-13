import test from 'node:test';
import assert from 'node:assert/strict';
import {unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,digest} from '@openslate/core';
import {transcriptSelectionFixture,generatedTranscriptSelectionFixture,selection,key,rows,bodies,payload,response,acceptSelected} from './transcript-selection-fixture.mjs';

const words=(f,input=selection(f),actor=f.human,options={})=>f.narration.useTranscriptWords(f.project.id,actor,input,options);
const timing=(f,input=selection(f),actor=f.human,options={})=>f.narration.useTranscriptTiming(f.project.id,actor,input,options);
const protectedKinds=['transcript_candidate','attempt','reservation','grant','candidate','external_allowance','external_allowance_consumption','hold','approval','plan','artifact','narration_canonical'];
const gate=()=>{let entered,release;const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r);return{ready,wait,entered,release};};
const draft=section=>({text:section.script.text,textKind:section.script.textKind,language:section.script.language,meaning:section.script.meaning,source:section.script.source});

test('human recognized-word selection creates one linked draft and invalidates only its changed subjects',async t=>{
 const f=await transcriptSelectionFixture(t);f.revise({add:[{...draft(f.view().segments[0]),text:'Keep the other section.',meaning:'Unrelated section.'}]});
 const other=f.view().segments[1];f.narration.bindAudio(f.project.id,f.human,f.view().state.version,key(),other.entry.segmentId,f.audio.id);f.narration.recordHumanCue(f.project.id,f.human,f.view().state.version,key(),{segmentId:other.entry.segmentId,startSample:0,endSample:48000});acceptSelected(f,1);
 const before=f.view(),saved=before.segments[0],protectedRows=bodies(f,protectedKinds),project=canonical(f.store.getProject(f.project.id));
 const result=await words(f,selection(f,{startWordIndex:1})),after=result.segments[0];
 assert.equal(result.state.version,before.state.version+1);assert.equal(after.script.text,'boots.');assert.equal(after.script.textKind,'draft');assert.equal(after.script.meaning,saved.script.meaning);assert.equal(after.script.language,saved.script.language);assert.deepEqual(after.script.source,saved.script.source);
 assert.equal(after.entry.audioId,saved.entry.audioId);assert.equal(after.entry.atSample,saved.entry.atSample);assert.equal(after.entry.cueId,null);for(const field of ['scriptAcceptanceId','audioAcceptanceId','timingAcceptanceId'])assert.equal(after.entry[field],null);
 assert.ok(after.script.transcriptSelectionId);assert.equal(rows(f,'narration_transcript_selection').length,1);assert.equal(rows(f,'narration_transcript_selection')[0].id,after.script.transcriptSelectionId);
 assert.deepEqual(result.segments[1],before.segments[1]);
 assert.equal(bodies(f,protectedKinds),protectedRows);assert.equal(canonical(f.store.getProject(f.project.id)),project);assert.deepEqual(f.calls,f.initialCalls);
});

test('human transcript timing changes only its cue and timing acceptance; repeated exact timing is a no-op',async t=>{
 const f=await transcriptSelectionFixture(t),before=f.view().segments[0],protectedRows=bodies(f,protectedKinds),result=await timing(f),after=result.segments[0];
 assert.equal(after.cue.method,'transcript_selection');assert.equal(after.cue.startSample,4800);assert.equal(after.cue.endSample,43200);assert.ok(after.cue.transcriptSelectionId);
 assert.deepEqual(after.script,before.script);assert.equal(after.entry.scriptAcceptanceId,before.entry.scriptAcceptanceId);assert.equal(after.entry.audioAcceptanceId,before.entry.audioAcceptanceId);assert.equal(after.entry.timingAcceptanceId,null);assert.equal(after.entry.atSample,before.entry.atSample);
 f.narration.accept(f.project.id,f.human,f.view().state.version,key(),'timing',[after.cue.id]);const accepted=f.view(),history=bodies(f,['narration_revision','narration_segment','narration_cue','narration_acceptance','narration_transcript_selection']);
 assert.deepEqual(await timing(f),accepted);assert.equal(bodies(f,['narration_revision','narration_segment','narration_cue','narration_acceptance','narration_transcript_selection']),history);assert.equal(bodies(f,protectedKinds),protectedRows);assert.deepEqual(f.calls,f.initialCalls);
});

test('identical complete wording is a true no-op while notes becoming a draft remains a revision',async t=>{
 const f=await transcriptSelectionFixture(t),before=f.view(),history=bodies(f,['narration_revision','narration_segment','narration_cue','narration_acceptance']);
 assert.deepEqual(await words(f),before);assert.equal(rows(f,'narration_transcript_selection').length,0);assert.equal(bodies(f,['narration_revision','narration_segment','narration_cue','narration_acceptance']),history);
 f.revise({update:[{segmentId:before.segments[0].entry.segmentId,draft:{...draft(before.segments[0]),textKind:'notes'}}]});const version=f.view().state.version;
 const changed=await words(f);assert.equal(changed.state.version,version+1);assert.equal(changed.segments[0].script.textKind,'draft');assert.equal(rows(f,'narration_transcript_selection').length,1);
});

test('identical recognized wording from a different range cannot invent provenance or invalidate approvals',async t=>{
 const f=await transcriptSelectionFixture(t,{fetch:async()=>response(Buffer.from(JSON.stringify(payload({text:'Leather boots. Leather boots.',words:[{word:'Leather',start:0.05,end:0.2},{word:'boots.',start:0.25,end:0.4},{word:'Leather',start:0.55,end:0.7},{word:'boots.',start:0.75,end:0.9}]}))))});
 const before=f.view();assert.deepEqual(await words(f,selection(f,{endWordIndex:2})),before);assert.deepEqual(await words(f,selection(f,{startWordIndex:2})),before);assert.equal(rows(f,'narration_transcript_selection').length,0);
 assert.deepEqual(f.calls,f.initialCalls);
});

test('suggested endpoints equal to a manual cue preserve its manual provenance and accepted work',async t=>{
 const f=await transcriptSelectionFixture(t,{fetch:async()=>response(Buffer.from(JSON.stringify(payload({words:[{word:'Leather',start:0,end:0.4},{word:'boots.',start:0.5,end:1}]}))))});
 const before=f.view(),history=bodies(f,['narration_revision','narration_segment','narration_cue','narration_acceptance']);assert.equal(before.segments[0].cue.method,'human');
 assert.deepEqual(await timing(f),before);assert.equal(rows(f,'narration_transcript_selection').length,0);assert.equal(bodies(f,['narration_revision','narration_segment','narration_cue','narration_acceptance']),history);
});

test('wrong candidate, take, digest, version and director authority fail without media or editorial changes',async t=>{
 const f=await transcriptSelectionFixture(t),input=selection(f),before=f.view();let reads=0;f.narration.verifyTranscript=async()=>{reads++;assert.fail('invalid selection reached media');};
 for(const patch of [{candidateId:key()},{candidateDigest:'f'.repeat(64)},{audioId:key()},{segmentRevisionId:key()},{expectedVersion:input.expectedVersion+1},{selectedTextDigest:'f'.repeat(64)},{startWordIndex:2,endWordIndex:3}])await assert.rejects(words(f,{...input,...patch,key:key()}));
 const director=f.production.openEpoch(f.project.id,f.human).actor;await assert.rejects(words(f,input,director),{code:'ACTOR_DENIED'});assert.equal(reads,0);assert.deepEqual(f.view(),before);assert.equal(rows(f,'narration_transcript_selection').length,0);
});

test('out-of-source timing stays unusable after rounding but recognized wording can be used',async t=>{
 const f=await transcriptSelectionFixture(t,{fetch:async()=>response(Buffer.from(JSON.stringify(payload({words:[{word:'Leather',start:0.1,end:0.45},{word:'boots.',start:0.5,end:1.000001}]}))))});
 const before=f.view();await assert.rejects(timing(f,selection(f,{startWordIndex:1})));assert.deepEqual(f.view(),before);
 const selected=await words(f,selection(f,{startWordIndex:1}));assert.equal(selected.segments[0].script.text,'boots.');assert.equal(selected.segments[0].entry.cueId,null);assert.equal(f.candidate.status,'unreviewed');assert.deepEqual(f.calls,f.initialCalls);
});

test('oversized recognized text is rejected without truncation and does not prevent valid timing use',async t=>{
 const rawWords=Array.from({length:34},(_,i)=>({word:'x'.repeat(500),start:0.05+i*0.025,end:0.07+i*0.025}));
 const f=await transcriptSelectionFixture(t,{fetch:async()=>response(Buffer.from(JSON.stringify(payload({text:rawWords.map(w=>w.word).join(' '),words:rawWords}))))});
 const before=f.view();await assert.rejects(words(f));assert.deepEqual(f.view(),before);assert.equal(rows(f,'narration_transcript_selection').length,0);
 const result=await timing(f);assert.equal(result.segments[0].cue.method,'transcript_selection');assert.equal(result.segments[0].script.text,before.segments[0].script.text);assert.deepEqual(f.calls,f.initialCalls);
});

test('concurrent same-key transcript selections produce one immutable selection and output',async t=>{
 const f=await transcriptSelectionFixture(t),input=selection(f,{startWordIndex:1}),g=gate(),original=f.narration.verifyTranscript.bind(f.narration);let count=0;
 f.narration.verifyTranscript=async(...args)=>{if(++count===2)g.entered();await g.wait;return original(...args);};
 const a=words(f,input),b=words(f,input);await g.ready;g.release();const [first,second]=await Promise.all([a,b]);assert.deepEqual(first,second);assert.equal(first.state.version,input.expectedVersion+1);assert.equal(rows(f,'narration_transcript_selection').length,1);
});

test('successful transcript replay precedes later edits and file reads but never a superseded actor',async t=>{
 const f=await transcriptSelectionFixture(t),input=selection(f,{startWordIndex:1}),saved=await words(f,input),section=f.view().segments[0];
 f.revise({update:[{segmentId:section.entry.segmentId,draft:{...draft(section),text:'Edited after adoption.'}}]});const version=f.view().state.version;unlinkSync(f.rawArtifact.path);f.narration.verifyTranscript=async()=>assert.fail('successful replay read media');
 assert.deepEqual(await words(f,input),saved);assert.equal(f.view().state.version,version);await assert.rejects(words(f,{...input,selectedTextDigest:'f'.repeat(64)}),{code:'IDEMPOTENCY_CONFLICT'});
 f.production.beginRequest(f.project.id,'offline-human','A newer editorial request');await assert.rejects(words(f,input),{code:'ACTOR_DENIED'});
});

test('original input and cancellation are retained across awaited verification',async t=>{
 const f=await transcriptSelectionFixture(t),input=selection(f,{startWordIndex:1}),before=f.view(),g=gate(),original=f.narration.verifyTranscript.bind(f.narration),abort=new AbortController(),options={signal:abort.signal},human=structuredClone(f.human);
 f.narration.verifyTranscript=async(...args)=>{g.entered();await g.wait;return original(...args);};const pending=words(f,input,human,options);await g.ready;
 input.candidateId=key();human.requestId=key();options.signal=new AbortController().signal;abort.abort();g.release();await assert.rejects(pending);assert.deepEqual(f.view(),before);assert.equal(rows(f,'narration_transcript_selection').length,0);
});

test('a newer version or human request during verification cannot authorize the unfinished selection',async t=>{
 for(const mode of ['version','request']){
  const f=await transcriptSelectionFixture(t),input=selection(f,{startWordIndex:1}),g=gate(),original=f.narration.verifyTranscript.bind(f.narration);
  f.narration.verifyTranscript=async(...args)=>{g.entered();await g.wait;return original(...args);};const pending=words(f,input);await g.ready;
  if(mode==='version'){const section=f.view().segments[0];f.revise({update:[{segmentId:section.entry.segmentId,draft:{...draft(section),meaning:'A newer editorial choice'}}]});}
  else f.production.beginRequest(f.project.id,'offline-human','Supersede unfinished transcript selection');
  g.release();await assert.rejects(pending);assert.equal(rows(f,'narration_transcript_selection').length,0);
 }
});

test('selection, output and narration revision roll back together after a publication failure',async t=>{
 const f=await transcriptSelectionFixture(t),input=selection(f,{startWordIndex:1}),before=f.view(),history=bodies(f,['narration_revision','narration_segment','narration_cue','narration_transcript_selection']),insert=f.store.insert.bind(f.store);
 f.store.insert=(...args)=>{if(args[0]==='narration_revision')throw Error('INJECTED_TRANSCRIPT_REVISION_FAILURE');return insert(...args);};
 await assert.rejects(words(f,input),/INJECTED_TRANSCRIPT_REVISION_FAILURE/);f.store.insert=insert;assert.deepEqual(f.view(),before);assert.equal(bodies(f,['narration_revision','narration_segment','narration_cue','narration_transcript_selection']),history);
 const result=await words(f,input);assert.equal(result.segments[0].script.text,'boots.');assert.equal(rows(f,'narration_transcript_selection').length,1);assert.deepEqual(f.calls,f.initialCalls);
});

test('canonical narration retains transcript writing from an earlier recording while timing uses the current take',async t=>{
 const f=await transcriptSelectionFixture(t);await words(f,selection(f,{startWordIndex:1}));const script=f.view().segments[0].script,oldAudio=f.audio;
 const replacement=await f.narration.importAudio(f.project.id,f.human,{path:join(f.root,'media','blobs',`${oldAudio.media.originalSha256}.source`),declaredOrigin:'uploaded',key:key()});
 assert.notEqual(replacement.id,oldAudio.id);f.narration.bindAudio(f.project.id,f.human,f.view().state.version,key(),script.segmentId,replacement.id);
 await assert.rejects(timing(f));assert.deepEqual(f.view().segments[0].script,script);
 f.narration.recordHumanCue(f.project.id,f.human,f.view().state.version,key(),{segmentId:script.segmentId,startSample:0,endSample:48000});acceptSelected(f);
 const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);const saved=f.canonical.workspaceCurrent(f.project.id),segment=saved.segments[0];
 assert.equal(segment.provenance.audioId,replacement.id);assert.equal(segment.transcriptProvenance.writing.selectionId,script.transcriptSelectionId);assert.equal(segment.transcriptProvenance.timing,undefined);
 assert.equal(rows(f,'narration_transcript_selection')[0].input.audioId,oldAudio.id);
 f.revise({update:[{segmentId:script.segmentId,draft:{...draft(f.view().segments[0]),text:'Manually revised later.'}}]});assert.equal(Object.hasOwn(f.view().segments[0].script,'transcriptSelectionId'),false);assert.ok(f.store.get('narration_segment',script.id).transcriptSelectionId);
});

test('actual generated speech and transcription preserve audio provenance through separate writing/timing adoption and canonical commit',async t=>{
 const f=await generatedTranscriptSelectionFixture(t),original=canonical(f.store.get('artifact',f.audio.id)),candidate=digest(f.candidate);
 await words(f,selection(f,{startWordIndex:1}));await timing(f,selection(f,{startWordIndex:1}));acceptSelected(f);const prepared=f.prepare();await f.canonical.apply(f.project.id,f.human,prepared.id);
 const saved=f.canonical.workspaceCurrent(f.project.id).segments[0];assert.equal(saved.provenance.originEvidence,'verified_generated_audio');assert.ok(saved.transcriptProvenance.writing);assert.ok(saved.transcriptProvenance.timing);assert.equal(saved.audioPlacement.source.artifactId,f.audio.id);
 assert.equal(canonical(f.store.get('artifact',f.audio.id)),original);assert.equal(digest(f.store.get('transcript_candidate',f.candidate.id)),candidate);assert.deepEqual(f.calls,f.initialCalls);
});
