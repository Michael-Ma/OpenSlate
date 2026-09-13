import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,readFileSync,renameSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {canonical,digest} from '@openslate/core';
import {generatedNarrationFixture} from './generated-narration-fixture.mjs';
import {assertGeneratedNarrationAudio,assertGeneratedNarrationProvenance,assertGeneratedNarrationSummary,
 createGeneratedNarrationProvenance,isVerifiedGeneratedNarrationAudio,narrationAudioOrigin,resolveGeneratedNarrationAudio,
 summarizeGeneratedNarrationAudio,verifyGeneratedNarrationAudio} from '../dist/narration/generated-audio.js';

const resolve=f=>resolveGeneratedNarrationAudio(f.store,f.project.id,f.artifact.id);
const verify=(f,resolved=resolve(f),options={})=>verifyGeneratedNarrationAudio(f.store,f.media,{artifactDir:f.engine.artifactDir},resolved,options);
const isDomain=error=>typeof error?.code==='string';
function changeRecord(f,kind,id,change,check){
 const row=f.store.db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind,id);assert.ok(row);
 try{const value=JSON.parse(row.body);change(value);f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(JSON.stringify(value),kind,id);check();}
 finally{f.store.db.prepare('UPDATE entities SET body=? WHERE kind=? AND id=?').run(row.body,kind,id);}
}
async function changeFile(path,change,check){
 const original=readFileSync(path);chmodSync(path,0o600);try{writeFileSync(path,change(Buffer.from(original)));await check();}
 finally{writeFileSync(path,original);chmodSync(path,0o444);}
}

test('generated narration pins charged completed lineage and verifies exact existing audio without tools or generation',async t=>{
 const f=await generatedNarrationFixture(t),before=canonical(f.store.db.prepare('SELECT * FROM entities ORDER BY kind,id').all()),selected=resolve(f);
 assert.equal(selected.audio.id,f.artifact.id);assert.deepEqual(selected.audio.media,f.source.source);assert.equal(selected.audio.originEvidence,'verified_generated_audio');
 assert.equal('declaredOrigin' in selected.audio,false);assert.equal('requestId' in selected.audio,false);
 assert.equal(selected.artifactDigest,digest(f.artifact.artifact));assert.equal(selected.generationEvidenceDigest,digest(selected.audio.generation));
 assert.equal(selected.reservation.state,'charged');assert.equal(selected.audio.generation.artifactRecordDigest,digest(f.artifact));
 f.media.verifiedSource=async()=>{throw new Error('helper must independently verify existing source bytes');};
 f.media.importMedia=async()=>{throw new Error('no conversion');};f.media.describeAudioNormalization=async()=>{throw new Error('no binaries');};
 assertGeneratedNarrationAudio(f.store,f.project.id,selected.audio);const verified=await verify(f,selected);
 assert.equal(verified.generationEvidenceDigest,selected.generationEvidenceDigest);
 assert.equal(canonical(f.store.db.prepare('SELECT * FROM entities ORDER BY kind,id').all()),before);assert.deepEqual(f.calls,f.initialCalls);
});

test('historical node bindings and mutable lease fields do not change verified-generation evidence',async t=>{
 const f=await generatedNarrationFixture(t),initial=resolve(f);
 changeRecord(f,'attempt',f.attempt.id,value=>{value.leaseOwner='historical-reader';value.leaseEpoch+=4;value.leaseExpiresAt=0;},()=>{
  assert.equal(resolve(f).generationEvidenceDigest,initial.generationEvidenceDigest);
 });
 changeRecord(f,'node_binding',f.attempt.nodeId,value=>{value.outputs={};value.state='retired';},()=>assert.equal(resolve(f).generationEvidenceDigest,initial.generationEvidenceDigest));
 await verify(f);assert.deepEqual(f.calls,f.initialCalls);
});

test('missing or forged succeeded output, charged reservation, mapping, derivation or winning receipt cannot be attached',async t=>{
 const f=await generatedNarrationFixture(t),initial=resolve(f),cases=[
  ['attempt',f.attempt.id,value=>{value.phase='ingesting';}],
  ['attempt',f.attempt.id,value=>{value.outputs.audio.sha256='a'.repeat(64);}],
  ['attempt',f.attempt.id,value=>{value.request.execution.adapter='fake';}],
  ['reservation',f.attempt.reservationId,value=>{value.state='released';}],
  ['speech_execution_mapping',f.attempt.id,value=>{value.profileDefinition.unitCostMicros='101';}],
  ['speech_execution_result',f.attempt.id,value=>{value.observation.outputReceiptId='b'.repeat(64);}],
  ['execution_output_slot',initial.derivationIntent.slotId,value=>{value.spoolId='c'.repeat(64);}],
  ['audio_derivation_receipt',initial.derivationReceipt.id,value=>{value.normalizedSamples+=1;}],
  ['media_source',f.artifact.id,value=>{value.source.artifactId='other-artifact';}],
 ];
 for(const [kind,id,change]of cases)changeRecord(f,kind,id,change,()=>assert.throws(()=>resolve(f),isDomain,kind));
 const saved=f.store.db.prepare("SELECT * FROM entities WHERE kind='speech_execution_dispatch' AND id=?").get(f.attempt.id);
 f.store.db.exec('BEGIN');try{f.store.db.prepare("DELETE FROM entities WHERE kind='speech_execution_dispatch' AND id=?").run(saved.id);assert.throws(()=>resolve(f),isDomain);}finally{f.store.db.exec('ROLLBACK');}
 assert.equal(resolve(f).generationEvidenceDigest,initial.generationEvidenceDigest);
 assert.throws(()=>resolveGeneratedNarrationAudio(f.store,f.production.createProject('Foreign').id,f.artifact.id),isDomain);
});

test('pure variant and provenance validators reject forged evidence, extra fields and accessors without invoking them',async t=>{
 const f=await generatedNarrationFixture(t),selected=resolve(f),audio=selected.audio;
 for(const mutate of[value=>{value.generation.mappingDigest='f'.repeat(64);},value=>{value.declaredOrigin='generated';},value=>{value.generation.normalizedSamples++;}]){
  const forged=structuredClone(audio);mutate(forged);assert.throws(()=>assertGeneratedNarrationAudio(f.store,f.project.id,forged),isDomain);
 }
 let invoked=false;const forged=structuredClone(audio);Object.defineProperty(forged.generation,'mappingDigest',{enumerable:true,get(){invoked=true;return 'f'.repeat(64);}});
 assert.throws(()=>assertGeneratedNarrationAudio(f.store,f.project.id,forged),isDomain);assert.equal(invoked,false);
 const tagged={};Object.defineProperty(tagged,'originEvidence',{get(){invoked=true;return 'verified_generated_audio';}});assert.equal(isVerifiedGeneratedNarrationAudio(tagged),false);assert.equal(invoked,false);
 const acceptances={scriptAcceptanceId:'script-acceptance',audioAcceptanceId:'audio-acceptance',timingAcceptanceId:'timing-acceptance'};
 const provenance=createGeneratedNarrationProvenance(audio,acceptances);assertGeneratedNarrationProvenance(f.store,f.project.id,provenance);
 assert.equal('declaredOrigin' in provenance,false);assert.deepEqual(provenance.generation,audio.generation);
 assert.throws(()=>assertGeneratedNarrationProvenance(f.store,f.project.id,{...provenance,toolchainDigest:'f'.repeat(64)}),isDomain);
 assert.throws(()=>createGeneratedNarrationProvenance(audio,{...acceptances,audioAcceptanceId:''}),isDomain);
 assert.throws(()=>assertGeneratedNarrationAudio(f.store,f.project.id,null),isDomain);
});

test('safe summaries preserve legacy declared-origin meaning and do not expose speech text, instructions or host paths',async t=>{
 const f=await generatedNarrationFixture(t),selected=resolve(f),summary=summarizeGeneratedNarrationAudio(selected);
 assert.deepEqual(summary,summarizeGeneratedNarrationAudio(selected.audio));assertGeneratedNarrationSummary(selected.audio,summary);
 assert.equal(summary.generation.model,f.profile.configuration.model);assert.equal(summary.generation.voice,'coral');
 assert.equal(narrationAudioOrigin(selected.audio),'generated');assert.equal(isVerifiedGeneratedNarrationAudio(selected.audio),true);
 const text=canonical(summary);for(const hidden of['Leather boots.','Warm and clear.',f.root,'requestDigest','bodySha256'])assert.equal(text.includes(hidden),false);
 for(const declaredOrigin of['uploaded','generated']){
  const legacy={id:'external-recording',projectId:f.project.id,media:{...f.source.source,artifactId:'external-recording'},declaredOrigin,requestId:'human-import'},old=canonical(legacy);
  assert.equal(narrationAudioOrigin(legacy),declaredOrigin);assert.equal(isVerifiedGeneratedNarrationAudio(legacy),false);assert.equal(canonical(legacy),old);
 }
 assert.throws(()=>assertGeneratedNarrationSummary(selected.audio,{...summary,generation:{...summary.generation,voice:'alloy'}}),isDomain);
});

test('physical verification rejects changed raw, normalized, installed or descriptor bytes while retaining all evidence',async t=>{
 const f=await generatedNarrationFixture(t),selected=resolve(f),source=selected.audio.media;
 const flip=bytes=>{bytes[bytes.length-1]^=1;return bytes;};
 for(const path of[join(f.media.rootDir,'blobs',`${source.originalSha256}.source`),join(f.media.rootDir,'blobs',`${source.sha256}.wav`),f.artifact.path]){
  await changeFile(path,flip,async()=>assert.rejects(verify(f,selected),isDomain));
 }
 await changeFile(join(f.media.rootDir,'sources',`${source.id}.json`),bytes=>Buffer.from(bytes.toString().replace(source.sha256,'f'.repeat(64))),async()=>assert.rejects(verify(f,selected),isDomain));
 assert.equal((await verify(f)).generationEvidenceDigest,selected.generationEvidenceDigest);assert.deepEqual(f.calls,f.initialCalls);
});

test('physical verification rejects parent symlinks and artifact paths outside exact managed location',async t=>{
 const f=await generatedNarrationFixture(t),blobs=join(f.media.rootDir,'blobs'),moved=join(f.media.rootDir,'original-blobs');
 renameSync(blobs,moved);symlinkSync(moved,blobs);
 try{await assert.rejects(verify(f),isDomain);}finally{unlinkSync(blobs);renameSync(moved,blobs);}
 const row=f.store.db.prepare("SELECT body FROM entities WHERE kind='artifact' AND id=?").get(f.artifact.id);
 try{const value=JSON.parse(row.body);value.path=join(f.root,'wrong.wav');f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?").run(JSON.stringify(value),f.artifact.id);
  await assert.rejects(verify(f),isDomain);
 }finally{f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?").run(row.body,f.artifact.id);}
 await verify(f);
});

test('physical verification snapshots original signal and selected evidence before asynchronous IO',async t=>{
 const f=await generatedNarrationFixture(t),selected=resolve(f),original=new AbortController(),replacement=new AbortController(),options={signal:original.signal};
 const pending=verify(f,selected,options);options.signal=replacement.signal;original.abort();
 await assert.rejects(pending,error=>error.code==='MEDIA_CANCELLED');
 const snapshot=resolve(f),expected=snapshot.generationEvidenceDigest,promise=verify(f,snapshot);snapshot.audio.generation.mappingDigest='d'.repeat(64);snapshot.audio.media.sha256='e'.repeat(64);
 assert.equal((await promise).generationEvidenceDigest,expected);assert.deepEqual(f.calls,f.initialCalls);
});

test('saved generated recordings verify after reopening with unavailable media binaries and provider methods',async t=>{
 const f=await generatedNarrationFixture(t),expected=resolve(f).generationEvidenceDigest;f.store.close();f.open(true);
 assert.equal((await verify(f)).generationEvidenceDigest,expected);assert.deepEqual(f.calls,f.initialCalls);
});

test('original cancellation during final installed-file cleanup rejects and retains complete immutable bytes',async t=>{
 const f=await generatedNarrationFixture(t),controller=new AbortController(),options={signal:controller.signal},before=readFileSync(f.artifact.path),originalOpen=fs.open;
 let reached=false;
 t.mock.method(fs,'open',async(path,...args)=>{const handle=await originalOpen(path,...args);if(path===f.artifact.path){const close=handle.close.bind(handle);
  handle.close=async()=>{await close();reached=true;options.signal=new AbortController().signal;controller.abort();};}return handle;});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 await assert.rejects(verify(f,resolve(f),options),error=>error.code==='MEDIA_CANCELLED');assert.equal(reached,true);assert.deepEqual(readFileSync(f.artifact.path),before);assert.deepEqual(f.calls,f.initialCalls);
});

test('evidence is resolved again after physical verification before returning a selectable recording',async t=>{
 const f=await generatedNarrationFixture(t),originalOpen=fs.open,row=f.store.db.prepare("SELECT body FROM entities WHERE kind='reservation' AND id=?").get(f.attempt.reservationId);
 let reached=false;
 t.mock.method(fs,'open',async(path,...args)=>{const handle=await originalOpen(path,...args);if(path===f.artifact.path){const close=handle.close.bind(handle);
  handle.close=async()=>{await close();reached=true;const value=JSON.parse(row.body);value.state='released';f.store.db.prepare("UPDATE entities SET body=? WHERE kind='reservation' AND id=?").run(JSON.stringify(value),f.attempt.reservationId);};}return handle;});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 try{await assert.rejects(verify(f),isDomain);assert.equal(reached,true);}
 finally{f.store.db.prepare("UPDATE entities SET body=? WHERE kind='reservation' AND id=?").run(row.body,f.attempt.reservationId);}
 assert.deepEqual(f.calls,f.initialCalls);
});
