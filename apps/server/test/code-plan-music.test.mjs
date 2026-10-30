import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { digest } from '@openslate/core';
import { normalizeStepInput, stepKey } from '../dist/code-plan/identity.js';
import { captureCodePlanRender } from '../dist/media/timeline-capture.js';
import { createLocalTimelineDocument } from '../dist/media/local-timeline.js';
import { readMediaExecutionConfiguration } from '../dist/application/media-execution-config.js';
import { profilePolicy } from '../dist/application/provider-catalog.js';
import { realCodeFixture, videoProfile } from './code-plan-providers-fixture.mjs';
import { codexImageProfile } from './codex-image-execution-fixture.mjs';
import { tool } from './viggle-h3-execution-fixture.mjs';
import { mp3, musicWave, musicProfile, musicReply } from './gemini-music-fixture.mjs';
const source = `export default async function(ctx){const music=await ctx.music({prompt:'Gentle hopeful piano, slow tempo',durationSeconds:6});if(music.ok)await ctx.log(JSON.stringify({lead:music.leadInSamples,samples:music.durationSamples}));}`;
async function fixture(t, {bytes=musicWave(),mime='audio/wav',status=200,body,destroy=false,...changes}={}) {
 const calls=[];
 const server=createServer(async(req,res)=>{
  let data='';for await(const chunk of req)data+=chunk;
  calls.push(JSON.parse(data));
  assert.equal(req.headers['x-goog-api-key'],'offline-fixture-key');
  if(destroy){req.socket.destroy();return;}
  res.statusCode=typeof status==='function'?status(calls.length):status;res.setHeader('content-type','application/json');res.end(JSON.stringify(body??musicReply(bytes,mime)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const f=await realCodeFixture(t,{profiles:[codexImageProfile,videoProfile,musicProfile],configuration:{music:true},transport:{musicFetch:(url,init)=>{
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(f.store.list('lyria_dispatch',f.project.id).length,calls.length+1);
  return fetch(`http://127.0.0.1:${server.address().port}/interactions`,init);
 }},...changes});
 return Object.assign(f,{musicCalls:calls});
}
for(const [mime,bytes,seconds] of [['audio/mpeg',mp3,1],['audio/wav',musicWave(),8]])
 test(`code-plan ${mime} loopback response becomes owned measured 48 kHz audio, with lead-in and durable replay`,async t=>{
  const f=await fixture(t,{bytes,mime});await f.submit(source);await f.finish();
  assert.equal(f.musicCalls.length,1);const step=f.plans.steps(f.project.id)[0],result=step.result;
  const artifact=f.store.get('artifact',result.artifact.artifactId),owned=f.store.get('media_source',artifact.id);
  assert.equal(step.kind,'music');assert.equal(step.priceMicros,'80000');assert.equal(f.plans.view(f.project.id).spentMicros,'80000');
  assert.equal(artifact.mimeType,'audio/wav');assert.equal(artifact.fixture,false);assert.equal(owned.source.probe.audio.sampleRate,48000);assert.equal(owned.source.probe.audio.channels,2);
  assert.ok(Math.abs(result.durationSamples/48000-seconds)<.05);assert.ok(Math.abs(result.leadInSamples/48000-.25)<.05);
  assert.equal(artifact.leadInSamples,result.leadInSamples);assert.equal(f.store.list('execution_output_receipt',f.project.id)[0].mimeType,mime);
  assert.match(f.plans.availableModels(f.project.id).find(m=>m.id===musicProfile.id).note,/length is approximate; trim and fade/);
  await f.restart();await f.tick();assert.equal(f.musicCalls.length,1);assert.deepEqual(f.plans.steps(f.project.id)[0].result,result);f.noGraph();
 });
for(const [status,body,code,retry] of [
 [400,{error:{message:'blocked by safety'}},'LYRIA_SAFETY_REFUSAL','none'],
 [403,{error:{message:'billing required'}},'LYRIA_KEY_BILLING_REQUIRED','none'],
 [429,{error:{message:'busy'}},'LYRIA_BUSY','safe'],
 [200,{steps:[{type:'model_output',content:[{type:'text',text:'no audio'}]}]},'LYRIA_AUDIO_MISSING','consent']])
 test(`code-plan Lyria ${code} retains honest retry and price evidence`,async t=>{
  const f=await fixture(t,{status,body});await f.submit(source);await f.tick();await f.tick();
  const step=f.plans.steps(f.project.id)[0];assert.equal(step.state,'failed');assert.equal(step.result.error.code,code);assert.equal(step.result.error.retry,retry);
  assert.equal(step.result.error.mayHaveCharged,retry==='consent');
  assert.equal(f.plans.view(f.project.id).spentMicros,retry==='consent'?'80000':'0');
  if(code==='LYRIA_KEY_BILLING_REQUIRED')assert.match(step.result.error.message,/Google project.*billing/);
  if(code==='LYRIA_AUDIO_MISSING')assert.match(step.result.error.message,/no audio block/);
  assert.equal(f.musicCalls.length,1);f.noGraph();
 });
test('post-send Lyria loss is unknown and charged on reconciliation; restart never repeats POST',async t=>{
 const f=await fixture(t,{destroy:true});await f.submit(source);await f.tick();
 let step=f.plans.steps(f.project.id)[0];assert.equal(f.store.get('attempt',step.attemptId).phase,'submission_unknown');assert.equal(f.execution.liability(step.attemptId),'reserved');
 await f.restart();await f.tick();step=f.plans.steps(f.project.id)[0];
 assert.equal(step.result.error.code,'SUBMISSION_RESPONSE_LOST');assert.equal(step.result.error.retry,'consent');assert.equal(step.result.error.mayHaveCharged,true);
 assert.equal(f.plans.getRun(f.project.id).state,'done_with_failures');assert.equal(f.plans.view(f.project.id).spentMicros,'80000');
 for(let n=0;n<3;n++)await f.tick();assert.equal(f.musicCalls.length,1);f.noGraph();
});
test('completed music survives loss of adapter publication and local ingestion interruption without resubmission',async t=>{
 const f=await fixture(t),bridge=f.mediaRuntime.registry.resolve({adapter:'gemini-lyria',version:'1'}),submit=bridge.submit.bind(bridge);
 bridge.submit=async(...args)=>{await submit(...args);throw Error('lost bridge result');};
 await f.submit(source);await f.tick();assert.equal(f.musicCalls.length,1);assert.equal(f.execution.attempts(f.project.id)[0].phase,'submission_unknown');
 await f.restart();const ingest=f.mediaRuntime.outputIngestor.ingest.bind(f.mediaRuntime.outputIngestor);let once=true;
 f.mediaRuntime.outputIngestor.ingest=async input=>{const result=await ingest(input);if(once){once=false;throw Error('lost ingestion publication');}return result;};
 await f.tick();assert.equal(f.store.list('music_ingestion_receipt',f.project.id).length,1);
 await f.restart();await f.finish();assert.equal(f.musicCalls.length,1);assert.equal(f.store.list('artifact',f.project.id).length,1);f.noGraph();
});
test('music ceiling counts $0.08 before dispatch, and holds and Stop fence new music',async t=>{
 const f=await fixture(t);await f.submit(source);f.plans.setCeiling(f.project.id,{by:'person',ceilingMicros:'79999'});
 await f.tick();assert.equal(f.plans.getRun(f.project.id).state,'paused_budget');assert.equal(f.musicCalls.length,0);assert.equal(f.execution.attempts(f.project.id).length,0);
 f.plans.setCeiling(f.project.id,{by:'person',ceilingMicros:'80000'});f.plans.hold(f.project.id,'person-turn');await f.tick();assert.equal(f.musicCalls.length,0);
 f.plans.release(f.project.id,'person-turn');f.store.put('execution_control',f.project.id,f.project.id,{paused:true});await f.tick();assert.equal(f.musicCalls.length,0);
 f.store.put('execution_control',f.project.id,f.project.id,{paused:false});await f.plans.replay(f.project.id);await f.finish();assert.equal(f.musicCalls.length,1);assert.equal(f.plans.view(f.project.id).spentMicros,'80000');
});
test('a pre-marker music intent is recovered as not submitted after restart',async t=>{
 const f=await fixture(t);await f.submit('export default async function(){}');
 const input=normalizeStepInput('music',{prompt:'Piano',durationSeconds:6},f.execution.models(f.project.id));
 const attempt=f.execution.prepare(f.project.id,stepKey('music',input),'music',input,{priceMicros:'80000'});
 await f.restart();await f.execution.advance(f.project.id);
 assert.equal(f.store.get('attempt',attempt.id).phase,'failed');assert.equal(f.execution.liability(attempt.id),'released');assert.equal(f.musicCalls.length,0);
});
test('music profiles require exact pricing, explicit installation and the shared Gemini key',()=>{
 assert.equal(readMediaExecutionConfiguration({OPENSLATE_GEMINI_API_KEY:'synthetic-key'}).music,true);
 assert.equal(readMediaExecutionConfiguration({OPENSLATE_GEMINI_API_KEY:'synthetic-key',OPENSLATE_ENABLE_MUSIC_GENERATION:'0'}).music,false);
 assert.deepEqual(profilePolicy(musicProfile),{credential:'gemini-music',media:'audio',fixture:false});
 for(const patch of [{unitCostMicros:'0'},{kind:'speech'},{configuration:{model:'other',settings:{}}},{maxRetries:1}])assert.throws(()=>profilePolicy({...musicProfile,...patch}));
 const models={lyria:{kind:'music',defaults:{instrumental:true},priceMicros:'80000'}};
 const one=normalizeStepInput('music',{prompt:'Piano',durationSeconds:6},models);
 assert.equal(stepKey('music',one),stepKey('music',normalizeStepInput('music',{prompt:'Piano',durationSeconds:6,instrumental:true},models)));
 assert.notEqual(stepKey('music',one),stepKey('music',normalizeStepInput('music',{prompt:'Piano',durationSeconds:6,variant:'take-2'},models)));
});
test('a real render skips measured leading silence, trims to picture and fades over the final two seconds',async t=>{
 const f=await fixture(t);
 const film=`export default async function(ctx){
 const image=await ctx.image({prompt:'Window'});if(!image.ok)return;
 const clip=await ctx.video({firstFrame:image.artifact,prompt:'Slow',durationSeconds:3});if(!clip.ok)return;
 const music=await ctx.music({prompt:'Calm piano, slow',durationSeconds:3});if(!music.ok)return;
 await ctx.render({timeline:[clip.artifact],audio:[{artifact:music.artifact,startSample:music.leadInSamples,atSample:0,durationSamples:144000,gainMilliDb:-6000,fadeOutSamples:96000}],width:160,height:90});}`;
 await f.submit(film);await f.finish();
 const renderStep=f.plans.steps(f.project.id).find(s=>s.kind==='render'),intent=f.store.get('code_plan_render_intent',renderStep.attemptId);
 assert.equal(intent.timeline.totalFrames,90);assert.equal(intent.timeline.audio[0].fadeOutSamples,96000);assert.equal(intent.recipe.audio[0].durationSamples,144000);
 assert.ok(intent.recipe.audio[0].startSample>11000);assert.equal(intent.recipe.audio[0].atSample,0);
 const path=f.store.get('artifact',renderStep.result.artifact.artifactId).path;
 const {stdout}=await promisify(execFile)(tool('ffmpeg'),['-nostdin','-v','error','-i',path,'-map','0:a:0','-ac','1','-f','s16le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
 const rms=(start,end)=>{let total=0;for(let i=Math.floor(start*48000);i<Math.floor(end*48000);i++)total+=stdout.readInt16LE(i*2)**2;return Math.sqrt(total/((end-start)*48000));};
 assert.ok(rms(.1,.3)>300,'music begins on its first note');assert.ok(rms(2.8,2.95)<rms(.1,.3)*.2,'the last two seconds actually fade');
 const clips=f.plans.steps(f.project.id).find(s=>s.kind==='video').result.artifact;
 const music=f.plans.steps(f.project.id).find(s=>s.kind==='music').result.artifact;
 const args={timeline:[clips,clips],audio:[{artifact:music,durationSamples:288000,fadeOutSamples:240000}]};
 const captured=captureCodePlanRender(f.store,f.project.id,args), timelineInput={projectId:captured.projectId,clips:captured.clips,audio:captured.audio};assert.equal(createLocalTimelineDocument(timelineInput).audio[0].fadeOutSamples,240000);
 assert.throws(()=>createLocalTimelineDocument({...timelineInput,audio:[{...captured.audio[0],fadeOutSamples:240001}]}));
 await assert.rejects(f.mediaRuntime.localMedia.freezeManifest({...captured,audio:[{...captured.audio[0],fadeOutSamples:240001}]}));f.noGraph();
});

test('identical music inputs reuse one paid song, while a deliberate variant creates exactly one new call',async t=>{
 const f=await fixture(t);await f.submit(source);await f.finish();
 const old=f.plans.steps(f.project.id)[0];await f.submit(source);await f.finish();assert.equal(f.musicCalls.length,1);
 await f.submit(source.replace('durationSeconds:6','durationSeconds:6,variant:"another-score"'));await f.finish();
 assert.equal(f.musicCalls.length,2);assert.equal(f.plans.view(f.project.id).spentMicros,'160000');
 assert.equal(f.execution.liability(old.attemptId),'charged');f.noGraph();
});
for(const mode of ['disabled','missing key'])test(`a ${mode} music route fails before any intent or POST`,async t=>{
 const f=await fixture(t,mode==='disabled'?{configuration:{music:false}}:{});
 if(mode==='missing key')f.controls.credential=undefined;
 await f.submit(source);await f.tick();assert.equal(f.plans.getRun(f.project.id).state,'error');assert.equal(f.musicCalls.length,0);assert.equal(f.execution.attempts(f.project.id).length,0);f.noGraph();
});
test('invalid music parameters fail the dry run, before spending or creating state',async t=>{
 const f=await fixture(t);
 for(const args of [{prompt:'',durationSeconds:2},{prompt:'piano',durationSeconds:0},{prompt:'piano',durationSeconds:361},{prompt:'piano',durationSeconds:3,instrumental:'yes'},{prompt:'piano',durationSeconds:3,seed:1}]){
  await assert.rejects(f.submit(`export default async function(ctx){await ctx.music(${JSON.stringify(args)});}`),{code:'CODE_PLAN_REJECTED'});
 }
 assert.equal(f.musicCalls.length,0);assert.equal(f.execution.attempts(f.project.id).length,0);assert.equal(f.plans.getRun(f.project.id),undefined);
});
test('music receipts, raw intent and artifact source cannot be rewritten after publication',async t=>{
 const f=await fixture(t);await f.submit(source);await f.finish();
 for(const kind of ['lyria_dispatch','lyria_result','music_ingestion_intent','music_ingestion_receipt']){
  const row=f.store.list(kind,f.project.id)[0];assert.throws(()=>f.store.put(kind,row.id,f.project.id,{...row,changed:true}),{code:'IMMUTABLE_RECORD'});
 }
 const owned=f.store.list('media_source',f.project.id)[0];assert.throws(()=>f.store.put('media_source',owned.id,f.project.id,{...owned,requestId:'borrowed-human-authority'}));
 assert.equal(f.musicCalls.length,1);f.noGraph();
});
test('Lyria busy safely retries at most twice with no retained charge, then reports the failure',async t=>{
 const f=await fixture(t,{status:429});let now=Date.now();t.mock.method(Date,'now',()=>now);
 await f.submit(source);
 for(let n=0;n<10;n++){await f.tick();now+=1000;}
 assert.equal(f.musicCalls.length,3);assert.equal(f.execution.attempts(f.project.id).length,3);
 assert.equal(f.plans.getRun(f.project.id).state,'done_with_failures');assert.equal(f.plans.view(f.project.id).spentMicros,'0');
 for(const attempt of f.execution.attempts(f.project.id))assert.equal(f.execution.liability(attempt.id),'released');
});
test('explicit retry after unknown Lyria loss keeps the first liability and admits only one new $0.08 attempt',async t=>{
 const f=await fixture(t,{destroy:true});await f.submit(source);await f.tick();await f.tick();
 const first=f.plans.steps(f.project.id)[0];assert.equal(first.result.error.retry,'consent');
 f.plans.retryStep(f.project.id,{stepKey:first.key,consent:{by:'person'}});
 await f.tick();await f.tick();await f.tick();
 assert.equal(f.musicCalls.length,2);assert.equal(f.plans.view(f.project.id).spentMicros,'160000');assert.equal(f.execution.liability(first.attemptId),'charged');
 assert.equal(f.execution.attempts(f.project.id).length,2);f.noGraph();
});
test('installation backup preserves owned music and rejects missing music provenance',async t=>{
 const {createInstallationBackup,inspectInstallationBackup}=await import('../dist/persistence/installation-backup.js');
 const {join}=await import('node:path');const {rmSync}=await import('node:fs');
 const f=await fixture(t);await f.submit(source);await f.finish();
 const destination=`${f.root}-backup`;t.after(()=>rmSync(destination,{recursive:true,force:true}));
 await f.store.db.backup(join(f.root,'openslate.sqlite'));await f.fake.db.backup(join(f.root,'fake-provider.sqlite'));
 const saved=await createInstallationBackup({sourceRoot:f.root,destination});await inspectInstallationBackup({directory:saved.directory});
 assert.ok(saved.manifest.files.some(file=>file.path.startsWith('media/sources/')));
 assert.equal(f.musicCalls.length,1);
 f.store.db.prepare("DELETE FROM entities WHERE kind='music_ingestion_receipt'").run();
 await f.store.db.backup(join(f.root,'openslate.sqlite'));rmSync(destination,{recursive:true,force:true});
 await assert.rejects(createInstallationBackup({sourceRoot:f.root,destination}));assert.equal(f.musicCalls.length,1);
});
