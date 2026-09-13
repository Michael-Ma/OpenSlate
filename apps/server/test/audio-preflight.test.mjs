import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest,providerProfileArguments} from '@openslate/core';
import {OPENAI_SPEECH_MODEL,OPENAI_SPEECH_VOICES,OPENAI_SPEECH_BUDGET,executionProfileSnapshot,describeOpenAISpeechWireRequest} from '@openslate/providers';
import {preflightAudioProfile,assertAudioOperationOptions,prepareSpeechOperationOptions,transcriptionOperationOptions} from '../dist/execution/audio-preflight.js';
import {prepareSpeechExecutionRequest} from '../dist/execution/audio-execution-receipts.js';
import {transcriptionExecutionOptions} from '../dist/execution/transcription-execution-receipts.js';

const profile=(kind='speech',patch={})=>({id:`offline-${kind}`,revision:'fixture-estimate-1',kind,adapter:`openai-${kind}`,executionVersion:'1',
 configuration:{model:kind==='speech'?OPENAI_SPEECH_MODEL:'whisper-1',settings:{}},maxConcurrency:2,unitCostMicros:'100',maxRetries:0,...patch});
const args=(p=profile(),patch={})=>({...providerProfileArguments(p),...(p.kind==='speech'?{text:'Leather boots.\n手工缝制 👞',voice:'coral',instructions:'Warm, measured delivery.'}:{language:'auto',timing:'word'}),settings:{},...patch});
const request=(p=profile(),a=args(p))=>({attemptId:'attempt-1',nodeId:'node-1',kind:p.kind,fingerprint:'a'.repeat(64),args:a,
 inputs:p.kind==='speech'?[]:[{artifactId:'owned-audio',sha256:'b'.repeat(64),kind:'audio'}],execution:{adapter:p.adapter,version:p.executionVersion},profile:executionProfileSnapshot(p),externalAllowanceId:'human-allowance-1'});
const invalid=fn=>assert.throws(fn,{code:'AUDIO_PREFLIGHT_INVALID'});

test('pure profile preflight exposes exact definition and configured estimate without host capability claims',()=>{
 for(const kind of ['speech','transcription']){const p=profile(kind),result=preflightAudioProfile(p);
  assert.deepEqual(result,{id:p.id,revision:p.revision,kind,adapter:p.adapter,executionVersion:'1',model:p.configuration.model,profileDigest:providerProfileArguments(p).profileDigest,definitionDigest:digest(p),estimatedMicros:'100'});
  assert.deepEqual(Object.keys(result).sort(),['id','revision','kind','adapter','executionVersion','model','profileDigest','definitionDigest','estimatedMicros'].sort());
 }
});

test('profile definition digest includes limits and estimate while historical semantic profile bytes stay exact',()=>{
 const p=profile(),before=canonical(p),initial=preflightAudioProfile(p),changed=preflightAudioProfile({...p,maxConcurrency:3,maxRetries:1,unitCostMicros:'200'});
 assert.equal(changed.profileDigest,initial.profileDigest);assert.notEqual(changed.definitionDigest,initial.definitionDigest);assert.equal(changed.estimatedMicros,'200');assert.equal(canonical(p),before);
 for(const model of [OPENAI_SPEECH_MODEL,'gpt-4o-mini-tts'])assert.equal(preflightAudioProfile(profile('speech',{configuration:{model,settings:{}}})).model,model);
});

test('unsupported model, adapter, kind, frame fields, settings and missing required profile fields fail closed',()=>{
 for(const patch of [{kind:'video'},{adapter:'fake'},{executionVersion:'2'},{minFrames:30},{maxFrames:180},{configuration:{model:'tts-1',settings:{}}},
  {configuration:{model:OPENAI_SPEECH_MODEL,settings:{voice:'coral'}}},{configuration:{model:OPENAI_SPEECH_MODEL}},{url:'https://host.invalid'}])invalid(()=>preflightAudioProfile(profile('speech',patch)));
 invalid(()=>preflightAudioProfile(profile('transcription',{configuration:{model:'gpt-4o-transcribe',settings:{}}})));
 for(const field of ['maxConcurrency','maxRetries','unitCostMicros','revision']){const p=profile();delete p[field];invalid(()=>preflightAudioProfile(p));}
});

test('profile limits remain explicit bounded integers and canonical configured money',()=>{
 for(const patch of [{maxConcurrency:0},{maxConcurrency:65},{maxRetries:-1},{maxRetries:4},{unitCostMicros:'-1'},{unitCostMicros:'0100'},
  {unitCostMicros:'9223372036854775808'},{unitCostMicros:100}])invalid(()=>preflightAudioProfile(profile('speech',patch)));
 assert.equal(preflightAudioProfile(profile('speech',{maxConcurrency:64,maxRetries:3,unitCostMicros:'0'})).estimatedMicros,'0');
});

test('profile and operation own-data accessors are rejected without invocation or rejected-value disclosure',()=>{
 let invoked=0;const secret='private-rejected-value-not-for-display';
 const p=profile();Object.defineProperty(p,'configuration',{enumerable:true,get(){invoked++;return{model:secret,settings:{}};}});invalid(()=>preflightAudioProfile(p));
 const operation=args();Object.defineProperty(operation,'voice',{enumerable:true,get(){invoked++;return secret;}});invalid(()=>assertAudioOperationOptions(profile(),operation));
 const malicious={toString(){invoked++;return secret;}};invalid(()=>assertAudioOperationOptions(profile(),args(profile(),{voice:malicious})));
 assert.equal(invoked,0);
 try{preflightAudioProfile(profile('speech',{configuration:{model:secret,settings:{}}}));assert.fail('accepted secret-valued model');}catch(error){assert.equal(error.code,'AUDIO_PREFLIGHT_INVALID');assert.equal(JSON.stringify(error).includes(secret),false);assert.equal(error.message.includes(secret),false);}
});

test('hidden fields, symbols, nonplain settings, arrays and oversized structures are rejected',()=>{
 const hidden=profile();Object.defineProperty(hidden,'extra',{value:1});invalid(()=>preflightAudioProfile(hidden));
 const symbol=profile();symbol[Symbol('extra')]='value';invalid(()=>preflightAudioProfile(symbol));
 for(const settings of [[],new Date(),Object.create({inherited:true})])invalid(()=>preflightAudioProfile(profile('speech',{configuration:{model:OPENAI_SPEECH_MODEL,settings}})));
 invalid(()=>assertAudioOperationOptions(profile(),args(profile(),{instructions:'z'.repeat(20000)})));
 const circular=args();circular.settings=circular;invalid(()=>assertAudioOperationOptions(profile(),circular));
});

test('speech review summary has exact transport hashes but omits full text/instructions and wire body',()=>{
 const p=profile(),a=args(p),saved=canonical(a),result=assertAudioOperationOptions(p,a),wire=describeOpenAISpeechWireRequest({model:p.configuration.model,text:a.text,voice:a.voice,instructions:a.instructions});
 assert.deepEqual(result,{kind:'speech',profile:preflightAudioProfile(p),voice:'coral',textSha256:wire.description.textSha256,instructionSha256:wire.description.instructionSha256,
  textBytes:32,instructionBytes:24,totalTextBytes:87,budgetPolicy:'utf8-cap-v1',responseFormat:'wav',speed:1});
 assert.equal(JSON.stringify(result).includes(a.text),false);assert.equal(JSON.stringify(result).includes(a.instructions),false);assert.equal(canonical(a),saved);
 result.profile.model='mutated';assert.equal(assertAudioOperationOptions(p,a).profile.model,p.configuration.model);
});

test('all transport-exported voices work and unknown voices fail with unchanged input',()=>{
 const p=profile();for(const voice of OPENAI_SPEECH_VOICES)assert.equal(assertAudioOperationOptions(p,args(p,{voice})).voice,voice);
 for(const voice of ['custom-voice','Coral','',null])invalid(()=>assertAudioOperationOptions(p,args(p,{voice})));
});

test('speech uses exact utf8-cap-v1 budget including model, voice and instructions',()=>{
 const p=profile(),voice='coral',instructions='x'.repeat(OPENAI_SPEECH_BUDGET.maxInstructionBytes),remaining=OPENAI_SPEECH_BUDGET.maxTotalBytes-Buffer.byteLength(p.configuration.model)-Buffer.byteLength(voice)-Buffer.byteLength(instructions);
 assert.equal(assertAudioOperationOptions(p,args(p,{voice,instructions,text:'a'.repeat(remaining)})).totalTextBytes,1792);
 invalid(()=>assertAudioOperationOptions(p,args(p,{voice,instructions,text:'a'.repeat(remaining+1)})));
 invalid(()=>assertAudioOperationOptions(p,args(p,{instructions:'x'.repeat(257)})));
 invalid(()=>assertAudioOperationOptions(p,args(p,{text:'界'.repeat(600)})));
 for(const text of ['','  ','\ud800','x'.repeat(4097)])invalid(()=>assertAudioOperationOptions(p,args(p,{text})));
});

test('speech and transcription require exact pinned compiled profile arguments and no operation overrides',()=>{
 for(const kind of ['speech','transcription']){const p=profile(kind),a=args(p);
  for(const field of ['profileIdentity','profileRevision','adapter','executionVersion','profileConfiguration','profileDigest']){const bad=structuredClone(a);bad[field]=field==='profileConfiguration'?{model:p.configuration.model,settings:{bad:1}}:'wrong';invalid(()=>assertAudioOperationOptions(p,bad));}
  for(const patch of [{settings:{speed:2}},{inputPath:'/private/not-owned.wav'},{bytes:'abc'},{language:kind==='speech'?'en':undefined}])invalid(()=>assertAudioOperationOptions(p,{...a,...patch}));
 }
});

test('transcription explicit auto remains null while pinned word and ISO language options stay exact',()=>{
 const p=profile('transcription');assert.deepEqual(assertAudioOperationOptions(p,args(p)),{kind:'transcription',profile:preflightAudioProfile(p),language:null,timing:'word',responseFormat:'verbose_json'});
 for(const language of ['en','zh','es'])assert.equal(assertAudioOperationOptions(p,args(p,{language})).language,language);
 for(const patch of [{timing:'segment'},{timing:'sentence'},{language:null},{language:'english'},{language:'EN'},{settings:{prompt:'rewrite words'}}])invalid(()=>assertAudioOperationOptions(p,args(p,patch)));
});

test('speech bridge delegation retains golden request semantics, wire hash and request bytes',()=>{
 const p=profile(),a=args(p),r=request(p,a),saved=canonical(r),prepared=prepareSpeechExecutionRequest(r),kernel=prepareSpeechOperationOptions(p.configuration,a);
 assert.deepEqual(prepared,kernel);assert.equal(prepared.description.requestDigest,'bd627837084ad156dd3d66eba3b31da1ee2289157e2b03cf5d0281c64729ed9b');
 assert.equal(prepared.description.bodySha256,'442aa7220548fe706ddb82e016e195aa00f4fe5a6a6deacd5380c15d7b580d60');
 assert.deepEqual(prepared, {request:{model:p.configuration.model,text:a.text,voice:a.voice,instructions:a.instructions},...describeOpenAISpeechWireRequest({model:p.configuration.model,text:a.text,voice:a.voice,instructions:a.instructions})});
 assert.equal(canonical(r),saved);
 assert.throws(()=>prepareSpeechExecutionRequest({...r,inputs:[{artifactId:'audio',sha256:'b'.repeat(64),kind:'audio'}]}),{code:'SPEECH_EXECUTION_CONFLICT'});
 assert.throws(()=>prepareSpeechExecutionRequest({...r,args:{...a,voice:'unsupported'}}),{code:'UNSUPPORTED_VOICE'});
 assert.throws(()=>prepareSpeechExecutionRequest({...r,args:{...a,settings:{speed:2}}}),{code:'SPEECH_EXECUTION_CONFLICT'});
});

test('transcription bridge delegation preserves options and its separate exact-one-audio requirement',()=>{
 const p=profile('transcription'),a=args(p),r=request(p,a),saved=canonical(r);
 assert.deepEqual(transcriptionExecutionOptions(r),{model:'whisper-1',language:null,timing:'word'});assert.deepEqual(transcriptionExecutionOptions(r),transcriptionOperationOptions(p.configuration,a));assert.equal(canonical(r),saved);
 assert.throws(()=>transcriptionExecutionOptions({...r,inputs:[]}),{code:'TRANSCRIPTION_EXECUTION_CONFLICT'});
 assert.throws(()=>transcriptionExecutionOptions({...r,inputs:[{...r.inputs[0],kind:'image'}]}),{code:'TRANSCRIPTION_EXECUTION_CONFLICT'});
 assert.throws(()=>transcriptionExecutionOptions({...r,args:{...a,timing:'segment'}}),{code:'UNSUPPORTED_TIMING'});
 assert.throws(()=>transcriptionExecutionOptions({...r,args:{...a,settings:{prompt:'override'}}}),{code:'TRANSCRIPTION_EXECUTION_CONFLICT'});
});
