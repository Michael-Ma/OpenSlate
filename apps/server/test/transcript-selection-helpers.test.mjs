import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readFileSync, writeFileSync, renameSync, symlinkSync, unlinkSync,chmodSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {canonical,digest} from '@openslate/core';
import {transcriptSelectionFixture,key} from './transcript-selection-fixture.mjs';
import {resolvePublishedTranscriptCandidate,previewTranscriptRange,createTranscriptSelection,assertTranscriptSelection,
 assertTranscriptSelectionOutput,assertTranscriptCanonicalSegment,snapshotTranscriptSelectionData,TRANSCRIPT_SELECTION_POLICY} from '../dist/narration/transcript-selection.js';
import {verifyTranscriptSelectionEvidence} from '../dist/narration/transcript-selection-media.js';

let f;const cleanup=[];
before(async()=>{f=await transcriptSelectionFixture({after:fn=>cleanup.push(fn)});});
after(async()=>{for(const fn of cleanup.reverse())await fn();});
const published=()=>resolvePublishedTranscriptCandidate(f.store,f.project.id,f.candidate.id);
const copy=value=>structuredClone(value);
const evidence=()=>({source:published(),audio:copy(f.audio)});
const verify=(input=evidence(),options={})=>verifyTranscriptSelectionEvidence(f.store,f.media,{artifactDir:f.artifactRoot},input.source,input.audio,options);
function input(action='writing',range={startWordIndex:1,endWordIndex:2}){
 const state=f.view().state,view=f.view().segments[0],id=key(),p=published();
 return{id,outputId:id,projectId:f.project.id,requestId:f.human.requestId,principalId:f.human.principalId,action,state,
 entry:view.entry,script:view.script,audio:view.audio,cue:view.cue,published:p,range,selectedTextDigest:previewTranscriptRange(p.candidate,range).selectedTextDigest};
}
const transaction=fn=>{f.store.db.exec('BEGIN');try{return fn();}finally{f.store.db.exec('ROLLBACK');}};
function tamper(kind,id,patch){const body=f.store.get(kind,id);f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(canonical(patch(copy(body))),kind,id);}

test('preview preserves exact trim/join wording and warnings while timing retains source gaps',()=>{
 const candidate=copy(f.candidate);candidate.projection.words[0].word=' \tLeather\n';candidate.projection.words[1].word=' boots. ';
 candidate.projection.parserIssues.push({code:'text_word_mismatch',wordIndex:null});
 const preview=previewTranscriptRange(candidate,{startWordIndex:0,endWordIndex:2});
 assert.equal(preview.policy,'trim-join-ascii-space-v1');assert.equal(preview.text,'Leather boots.');
 assert.equal(preview.selectedTextDigest,digest({policy:TRANSCRIPT_SELECTION_POLICY,text:'Leather boots.'}));
 assert.equal(preview.timing.allowed,true);assert.equal(preview.timing.startSample,4800);assert.equal(preview.timing.endSample,43200);
 assert.deepEqual(preview.warnings,[{source:'parser',code:'text_word_mismatch',wordIndex:null}]);
});

test('indexed timing issues outside selection are ignored, selected and global issues block timing only',()=>{
 const candidate=copy(f.candidate),range={startWordIndex:1,endWordIndex:2};
 candidate.projection.parserIssues=[{code:'word_overlap',wordIndex:0}];candidate.projection.sampleIssues=[{code:'unsafe_sample_coordinate',wordIndex:0}];
 assert.equal(previewTranscriptRange(candidate,range).timing.allowed,true);
 for(const issue of [{source:'parser',code:'word_overlap',wordIndex:1},{source:'parser',code:'reported_duration_outside_source',wordIndex:null},
  {source:'sample',code:'source_range_exceeded',wordIndex:1},{source:'sample',code:'empty_sample_interval',wordIndex:1}]){
  const c=copy(candidate);c.projection[issue.source==='parser'?'parserIssues':'sampleIssues'].push({code:issue.code,wordIndex:issue.wordIndex});
  const result=previewTranscriptRange(c,range);assert.equal(result.writing.allowed,true);assert.equal(result.timing.allowed,false);assert.equal(result.timing.startSample,null);
 }
});

test('range validation never clamps unsafe coordinates or accepts overlapping selected intervals',()=>{
 for(const patch of [words=>words[1].startSample=null,words=>words[1].endSample=Number.MAX_SAFE_INTEGER+1,
  words=>words[1].startSample=words[0].endSample-1,words=>words[1].endSample=words[1].startSample]){
  const c=copy(f.candidate);patch(c.projection.words);assert.equal(previewTranscriptRange(c,{startWordIndex:0,endWordIndex:2}).timing.allowed,false);
 }
 for(const range of [{startWordIndex:0,endWordIndex:0},{startWordIndex:-1,endWordIndex:1},{startWordIndex:1,endWordIndex:3},{startWordIndex:0.5,endWordIndex:1}])assert.throws(()=>previewTranscriptRange(f.candidate,range),{code:'TRANSCRIPT_SELECTION_CONFLICT'});
 for(const alter of [c=>delete c.source,c=>c.projection.parserIssues.push({code:'word_overlap',wordIndex:null}),c=>c.projection.sampleIssues.push({code:'unsafe_sample_coordinate',wordIndex:100})]){
  const malformed=copy(f.candidate);alter(malformed);assert.throws(()=>previewTranscriptRange(malformed,{startWordIndex:0,endWordIndex:2}),{code:'TRANSCRIPT_SELECTION_CONFLICT'});
 }
});

test('oversized selected text retains its exact digest and usable timing without returning a truncated draft',()=>{
 const c=copy(f.candidate);c.projection.words=Array.from({length:17},(_,i)=>({word:'x'.repeat(1000),startSeconds:i/20,endSeconds:(i+0.5)/20,startSample:i*2400,endSample:i*2400+1200}));
 c.projection.parserIssues=[];c.projection.sampleIssues=[];
 const result=previewTranscriptRange(c,{startWordIndex:0,endWordIndex:17});assert.equal(result.text,null);assert.deepEqual(result.writing,{allowed:false,code:'TEXT_TOO_LONG'});
 assert.equal(result.timing.allowed,true);assert.equal(result.selectedTextDigest,digest({policy:TRANSCRIPT_SELECTION_POLICY,text:c.projection.words.map(w=>w.word).join(' ')}));
});

test('factory retains draft preferences and source identity, allocates shared output ID and detects real no-ops',()=>{
 const original=input(),created=createTranscriptSelection(original);assert.equal(created.changed,true);assert.equal(created.output.record.text,'boots.');
 assert.equal(created.selection.id,created.output.record.id);assert.equal(created.selection.output.digest,digest(created.output.record));
 assert.deepEqual(created.output.record.source,original.script.source);assert.equal(created.output.record.meaning,original.script.meaning);assert.equal(created.output.record.language,original.script.language);
 assert.equal(Object.hasOwn(created.selection,'words'),false);assert.ok(Buffer.byteLength(canonical(created.selection))<16384);
 const whole=input('writing',{startWordIndex:0,endWordIndex:2});assert.equal(createTranscriptSelection(whole).changed,false);
 whole.script.textKind='notes';assert.equal(createTranscriptSelection(whole).changed,true);
 assert.throws(()=>createTranscriptSelection({...original,outputId:key()}),{code:'TRANSCRIPT_SELECTION_CONFLICT'});
 assert.throws(()=>createTranscriptSelection({...original,selectedTextDigest:'f'.repeat(64)}),{code:'TRANSCRIPT_SELECTION_CONFLICT'});
});

test('public snapshots reject accessors and forged plain-data shapes without evaluating user code',async()=>{
 let ran=false;const value=input();Object.defineProperty(value,'published',{enumerable:true,get(){ran=true;return published();}});
 assert.throws(()=>createTranscriptSelection(value),{code:'TRANSCRIPT_SELECTION_CONFLICT'});assert.equal(ran,false);
 const c=copy(f.candidate);Object.defineProperty(c.projection.words[0],'word',{enumerable:true,get(){ran=true;return 'x';}});
 assert.throws(()=>previewTranscriptRange(c,{startWordIndex:0,endWordIndex:1}),{code:'TRANSCRIPT_SELECTION_CONFLICT'});assert.equal(ran,false);
 const source={candidateDigest:f.candidate.id};Object.defineProperty(source,'candidate',{enumerable:true,get(){ran=true;return f.candidate;}});
 await assert.rejects(verify({source,audio:f.audio}),{code:'TRANSCRIPT_SELECTION_CONFLICT'});assert.equal(ran,false);
 for(const bad of [new Date(),Object.create({hidden:true}),{x:undefined},Object.assign([], {x:1})])assert.throws(()=>snapshotTranscriptSelectionData(bad),{code:'TRANSCRIPT_SELECTION_CONFLICT'});
});

test('selection recomputation rejects forged digests and stripped reciprocal output markers',()=>transaction(()=>{
 const result=createTranscriptSelection(input());assertTranscriptSelection(f.store,f.project.id,result.selection);
 for(const patch of [v=>v.output.digest='f'.repeat(64),v=>v.source.endSample--,v=>v.reservationDigest='f'.repeat(64),v=>v.input.scriptDigest='f'.repeat(64)]){
  const wrong=copy(result.selection);patch(wrong);assert.throws(()=>assertTranscriptSelection(f.store,f.project.id,wrong));
 }
 f.store.insert('narration_transcript_selection',result.selection.id,f.project.id,result.selection);
 assertTranscriptSelectionOutput(f.store,f.project.id,result.output.kind,result.output.record);
 const stripped=copy(result.output.record);delete stripped.transcriptSelectionId;
 assert.throws(()=>assertTranscriptSelectionOutput(f.store,f.project.id,result.output.kind,stripped),{code:'TRANSCRIPT_SELECTION_CONFLICT'});
 const cue=createTranscriptSelection(input('timing'));f.store.insert('narration_transcript_selection',cue.selection.id,f.project.id,cue.selection);
 const fakeHuman={...cue.output.record,method:'human'};delete fakeHuman.transcriptSelectionId;
 assert.throws(()=>assertTranscriptSelectionOutput(f.store,f.project.id,'narration_cue',fakeHuman),{code:'TRANSCRIPT_SELECTION_CONFLICT'});
}));

test('published resolver requires settled exact output and rejects candidate/raw identity changes',()=>transaction(()=>{
 const initial=published();assert.equal(initial.candidate.id,f.candidate.id);
 for(const patch of [a=>{a.phase='ingesting';return a;},a=>{a.outputs.cues.artifactId=key();return a;}]){
  const old=canonical(f.store.get('attempt',f.attempt.id));tamper('attempt',f.attempt.id,patch);assert.throws(published);
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='attempt' AND id=?").run(old,f.attempt.id);
 }
 tamper('reservation',f.attempt.reservationId,r=>({...r,state:'reserved'}));assert.throws(published,{code:'TRANSCRIPT_SELECTION_CONFLICT'});
}));

test('canonical validator leaves old unlinked history alone but refuses invented new provenance',()=>{
 assert.doesNotThrow(()=>assertTranscriptCanonicalSegment(f.store,f.project.id,{segmentId:'historical',segmentRevisionId:'not-retained',cue:{id:'old-cue'}},{narrationRevisionId:null,narrationVersion:0}));
 assert.throws(()=>assertTranscriptCanonicalSegment(f.store,f.project.id,{segmentId:'historical',segmentRevisionId:'not-retained',cue:{id:'old-cue'},transcriptProvenance:{}},{narrationRevisionId:null,narrationVersion:0}));
});

test('physical verification reopens with unavailable tools and needs no derivative-file reread or paid call',async()=>{
 const preparation=f.store.get('transcription_audio_intent',f.candidate.preparation.intentId);assert.ok(preparation);
 f.open();
 const saved=f.files.rootDir,archived=`${saved}-held`;renameSync(saved,archived);
 try{const result=await verify();assert.equal(result.candidateDigest,digest(f.candidate));assert.deepEqual(f.calls,f.initialCalls);}
 finally{renameSync(archived,saved);}
});

test('complete raw, normalized blob and installed playback corruption are rejected',async()=>{
 for(const path of [f.rawArtifact.path,join(f.media.rootDir,'blobs',`${f.audio.media.sha256}.wav`),f.store.get('artifact',f.audio.id).path]){
  const bytes=readFileSync(path),mode=statSync(path).mode&0o777,bad=Buffer.from(bytes);bad[bad.length-1]^=1;chmodSync(path,0o600);writeFileSync(path,bad);
  try{await assert.rejects(verify());}finally{writeFileSync(path,bytes);chmodSync(path,mode);}
  assert.equal((await verify()).candidateDigest,digest(f.candidate));
 }
});

test('raw evidence final symlink and changed source descriptor are refused without repairs',async()=>{
 const path=f.rawArtifact.path,held=`${path}.held`;renameSync(path,held);symlinkSync(held,path);
 try{await assert.rejects(verify());}finally{unlinkSync(path);renameSync(held,path);}
 const source=join(f.media.rootDir,'sources',`${f.audio.media.id}.json`),bytes=readFileSync(source),mode=statSync(source).mode&0o777;chmodSync(source,0o600);writeFileSync(source,JSON.stringify({...f.audio.media,artifactId:key()}));
 try{await assert.rejects(verify(),{code:'TRANSCRIPT_SELECTION_CONFLICT'});}finally{writeFileSync(source,bytes);chmodSync(source,mode);}
 assert.equal((await verify()).candidateDigest,digest(f.candidate));
});

test('physical helper snapshots mutable inputs and preserves the original signal through final file close',async t=>{
 const originalOpen=fs.open,selected=evidence(),abort=new AbortController(),options={signal:abort.signal};let once=false;
 t.mock.method(fs,'open',async(path,...args)=>{const handle=await originalOpen(path,...args);
  if(path===f.rawArtifact.path&&!once){once=true;selected.source.candidateDigest='f'.repeat(64);selected.audio.id=key();const close=handle.close.bind(handle);
   handle.close=async()=>{await close();options.signal=new AbortController().signal;abort.abort();};}return handle;});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 await assert.rejects(verify(selected,options),{code:'TRANSCRIPT_SELECTION_CANCELLED'});assert.equal(once,true);assert.deepEqual(f.calls,f.initialCalls);
});

test('mutating caller evidence after verification starts does not substitute its captured selection',async t=>{
 const originalOpen=fs.open,selected=evidence();let observed=false;
 t.mock.method(fs,'open',async(path,...args)=>{const handle=await originalOpen(path,...args);if(path===f.rawArtifact.path){observed=true;selected.source.candidate.id=key();selected.source.candidateDigest='f'.repeat(64);selected.audio.media.sha256='e'.repeat(64);}return handle;});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.equal((await verify(selected)).candidateDigest,digest(f.candidate));assert.equal(observed,true);
});

test('a SQL lineage change during final raw read fails before evidence can be returned',async t=>{
 const originalOpen=fs.open;let changed=false;f.store.db.exec('BEGIN');
 t.mock.method(fs,'open',async(path,...args)=>{const handle=await originalOpen(path,...args);
  if(path===f.rawArtifact.path){const close=handle.close.bind(handle);handle.close=async()=>{await close();changed=true;tamper('attempt',f.attempt.id,a=>({...a,phase:'ingesting'}));};}return handle;});
 syncBuiltinESMExports();
 try{await assert.rejects(verify(),{code:'TRANSCRIPT_SELECTION_CONFLICT'});assert.equal(changed,true);}
 finally{t.mock.restoreAll();syncBuiltinESMExports();f.store.db.exec('ROLLBACK');}
});
