import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { digest } from '@openslate/core';
import { realCodeFixture, imageSource, videoProfile, speechProfile, miniMaxProfile } from './code-plan-providers-fixture.mjs';
import { codexImageProfile, codexApiProfile } from './codex-image-execution-fixture.mjs';
import { response as speechResponse, wave } from './speech-execution-fixture.mjs';
import { tool, pngBytes } from './viggle-h3-execution-fixture.mjs';
import { normalizeStepInput } from '../dist/code-plan/identity.js';
import { modelPrice } from '../dist/code-plan/models.js';
import { wireCodePlans, readCodeFilm } from '../dist/code-plan/director.js';

const twoShots = `export default async function(ctx) {
 const clips=[];
 for (const prompt of ['Dawn through a window','Tea beside the window']) {
  const frame=await ctx.image({model:'${codexImageProfile.id}',prompt}); if (!frame.ok) throw Error(frame.error.code);
  const clip=await ctx.video({model:'${videoProfile.id}',firstFrame:frame.artifact,prompt:'Gentle push in: '+prompt,durationSeconds:3});
  if (!clip.ok) throw Error(clip.error.code); clips.push(clip.artifact);
 }
 const result=await ctx.render({timeline:clips,width:160,height:90}); if (!result.ok) throw Error(result.error.code);
}`;

test('installed locked models and their prices reach read_film; real projects have no fake fallback', async t => {
 const f=await realCodeFixture(t); wireCodePlans(f.service,f.plans);
 const models=readCodeFilm(f.service,f.project.id).models;
 assert.deepEqual(models.map(row=>row.id),['local-render',codexImageProfile.id,videoProfile.id]);
 assert.equal(models.find(row=>row.id===videoProfile.id).priceUnit,'call');
 assert.equal(models.find(row=>row.id===codexImageProfile.id).subscription,'codex');
 const model=f.execution.models(f.project.id)[videoProfile.id];
 assert.equal(modelPrice(model),'100000');
 assert.equal(modelPrice({...model,priceMicros:'0'}),'0');
 assert.throws(()=>normalizeStepInput('image',{model:'fake-image',prompt:'x'},f.execution.models(f.project.id)),{code:'CODE_PLAN_MODEL'});
 const graph=f.service.createProject('graph'); assert.equal(graph.planMode,undefined); assert.ok(f.execution.models(graph.id)['fake-image']);
 f.noGraph();
});

test('Codex and Viggle steps retain intent → submit → lookup/poll → spool → ingest; two clips render a probed MP4', async t => {
 const f=await realCodeFixture(t); await f.submit(twoShots); await f.finish();
 assert.deepEqual(f.calls,{prepare:2,start:2,lookup:2,video:2,poll:2,download:2,render:1});
 const steps=f.plans.steps(f.project.id); assert.equal(steps.length,5); assert.ok(steps.every(step=>step.state==='succeeded'));
 for(const step of steps.filter(step=>step.kind!=='render')) {
  const attempt=f.store.get('attempt',step.attemptId),record=f.store.get('code_plan_execution',attempt.id);
  assert.equal(record.requestDigest,digest(attempt.request)); assert.equal(record.liability,'charged');
  assert.equal(f.store.list('execution_output_slot',f.project.id).filter(row=>row.attemptId===attempt.id).length,1);
  const artifact=f.store.get('artifact',step.result.artifact.artifactId); assert.equal(artifact.fixture,false); assert.ok(artifact.outputSpoolId);
 }
 const crop=f.store.list('viggle_h3_execution_mapping',f.project.id)[0];
 assert.equal(crop.firstFrameCrop,undefined); assert.equal(crop.transport.aspectRatio,'1:1'); assert.equal(f.firstFrame.readUInt32BE(16),320); assert.equal(f.firstFrame.readUInt32BE(20),320);
 assert.ok(crop.firstFrame.codePlanAttemptId); assert.equal(crop.firstFrame.approvalId,undefined);
 assert.equal(f.plans.view(f.project.id).spentMicros,'200000');
 const rendered=f.store.get('artifact',steps.find(step=>step.kind==='render').result.artifact.artifactId);
 assert.equal(rendered.fixture,false); assert.equal(rendered.origin,'local_render');
 const probe=JSON.parse((await promisify(execFile)(tool('ffprobe'),['-v','error','-show_streams','-show_format','-of','json',rendered.path])).stdout);
 assert.equal(probe.streams[0].codec_name,'h264'); assert.equal(probe.streams[0].r_frame_rate,'30/1'); assert.equal(probe.streams[0].nb_frames,'180');
 assert.equal(Number(probe.format.duration),6); assert.ok(readFileSync(rendered.path).length>1000);
 f.noGraph(); const before={...f.calls}; await f.tick(); assert.deepEqual(f.calls,before);
});

test('lost native response is reconciled after restart without another start or API fallback', async t => {
 const f=await realCodeFixture(t); f.controls.lostStart=true; f.controls.pending=true;
 await f.submit(imageSource); await f.tick();
 assert.equal(f.calls.start,1); assert.equal(f.execution.attempts(f.project.id)[0].phase,'submission_unknown');
 await f.restart(); f.controls.pending=false; await f.finish();
 assert.equal(f.calls.start,1); assert.equal(f.calls.prepare,1); assert.equal(f.calls.lookup,1);
 assert.equal(f.plans.steps(f.project.id)[0].state,'succeeded'); f.noGraph();
});

test('unknown native lookups retain the original reservation and never resubmit', async t => {
 const f=await realCodeFixture(t); f.controls.lostStart=true; f.controls.pending=true;
 await f.submit(imageSource); await f.tick(); await f.restart();
 for(let i=0;i<3;i++) await f.tick();
 assert.equal(f.calls.start,1); assert.equal(f.calls.lookup,3);
 const step=f.plans.steps(f.project.id)[0]; assert.equal(step.state,'unknown'); assert.equal(f.execution.liability(step.attemptId),'reserved');
 f.noGraph();
});

test('the ceiling and dry run use the real profile cost before any video submission', async t => {
 // Clips are priced per call (generation-quotes basis); one $1.50 clip alone crosses the $1 ceiling.
 const f=await realCodeFixture(t,{profiles:[codexImageProfile,{...videoProfile,unitCostMicros:'1500000'}]}); await f.submit(imageSource); await f.finish();
 const image=f.plans.steps(f.project.id)[0].result.artifact;
 const source=`export default async function(ctx) {await ctx.video({model:'${videoProfile.id}',firstFrame:${JSON.stringify(image)},prompt:'Push in',durationSeconds:15});}`;
 const receipt=await f.submit(source); assert.equal(receipt.diff.certainMicros,'1500000'); assert.ok(receipt.diff.findings.some(row=>row.code==='CEILING'));
 await f.tick(); assert.equal(f.plans.getRun(f.project.id).state,'paused_budget'); assert.equal(f.calls.video,0);
 assert.equal(f.plans.steps(f.project.id).find(step=>step.kind==='video').attemptId,null); f.noGraph();
});

test('missing credentials refuse before admission or submit, and do not fall back to fake', async t => {
 const f=await realCodeFixture(t); await f.submit(imageSource); await f.finish(); f.controls.credential=undefined;
 const image=f.plans.steps(f.project.id)[0].result.artifact;
 await f.submit(`export default async function(ctx) {await ctx.video({model:'${videoProfile.id}',firstFrame:${JSON.stringify(image)},prompt:'Push in',durationSeconds:3});}`);
 await f.tick(); assert.equal(f.plans.getRun(f.project.id).state,'error');
 assert.match(f.plans.getRun(f.project.id).error.message,/Configure/); assert.equal(f.calls.video,0);
 assert.equal(f.execution.attempts(f.project.id).length,1); assert.equal(f.fake.acceptedCount(),0); f.noGraph();
});

for (const mode of ['removed','changed']) test(`a ${mode} installed profile refuses real dispatch`,async t=>{
 const f=await realCodeFixture(t);
 const lock=f.store.get('capability_lock',f.project.capabilityLockId);
 f.store.db.prepare("UPDATE entities SET body=? WHERE kind='capability_lock' AND id=?").run(JSON.stringify({...lock,profiles:lock.profiles.map(p=>p.id===codexImageProfile.id?{...p,...(mode==='changed'?{unitCostMicros:'1'}:{id:'missing-profile'})}:p)}),lock.id);
 await assert.rejects(f.submit(imageSource),{code:'CODE_PLAN_REJECTED'}); assert.equal(f.calls.start,0); f.noGraph();
});

test('disabled host configuration refuses before any native preparation',async t=>{
 const f=await realCodeFixture(t,{configuration:{codexImage:false}});
 await f.submit(imageSource); await f.tick();
 assert.equal(f.plans.getRun(f.project.id).state,'error'); assert.equal(f.calls.prepare,0); assert.equal(f.calls.start,0); f.noGraph();
});

test('profile concurrency serializes parallel Codex steps without consuming extra attempts',async t=>{
 const f=await realCodeFixture(t); f.controls.pending=true;
 await f.submit(`export default async function(ctx){await Promise.all(['front','side','back'].map(prompt=>ctx.image({prompt})));}`);
 await f.tick(); assert.equal(f.calls.start,1); assert.equal(f.execution.attempts(f.project.id).length,1);
 assert.equal(f.plans.steps(f.project.id).filter(step=>step.state==='absent').length,2);
 f.controls.pending=false; await f.finish(); assert.equal(f.calls.start,3); assert.equal(f.execution.attempts(f.project.id).length,3); f.noGraph();
});

test('an edit during native prepare fences the original version before turn start',async t=>{
 const f=await realCodeFixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();
 const prepare=f.transport.prepare; f.transport.prepare=async input=>{const value=await prepare(input);entered.resolve();await release.promise;return value;};
 // Composition captured the transport methods; rebuild with the barrier before creating the attempt.
 await f.restart(); await f.submit(imageSource); const running=f.tick(); await entered.promise;
 f.plans.submitPlan(f.project.id,'export default async function(ctx){await ctx.log("new direction");}');
 release.resolve(); await running; await f.finish();
 assert.equal(f.calls.start,0); assert.equal(f.calls.prepare,1); assert.equal(f.execution.liability(f.execution.attempts(f.project.id)[0].id),'released'); f.noGraph();
});

test('local render restart reuses a durable probed completion after the SQL reply is lost',async t=>{
 const f=await realCodeFixture(t); const worker=f.mediaRuntime.localExecutor,execute=worker.executeCodePlan.bind(worker);
 let lost=true; worker.executeCodePlan=async(...args)=>{const result=await execute(...args);if(lost){lost=false;throw Error('lost local publication');}return result;};
 await f.submit(twoShots);
 for(let i=0;i<12 && f.calls.render===0;i++) await f.tick();
 assert.equal(f.calls.render,1); assert.equal(f.execution.attempts(f.project.id).find(row=>row.request.kind==='render').phase,'ingesting');
 await f.restart(); await f.finish(); assert.equal(f.calls.render,1); assert.equal(f.calls.video,2); f.noGraph();
});

test('OpenAI Images reuses its existing exact profile, byte receipt and PNG ingester',async t=>{
 let f,posts=0;
 f=await realCodeFixture(t,{profiles:[codexApiProfile,videoProfile],configuration:{image:true},transport:{imageFetch:async(url,init)=>{
  posts++; assert.equal(url,'https://api.openai.com/v1/images/generations'); assert.equal(init.method,'POST');
  assert.equal(f.store.list('image_execution_dispatch',f.project.id).length,1);
  return new Response(JSON.stringify({created:1789200000,data:[{b64_json:f.png.toString('base64')}]}),{headers:{'content-type':'application/json','x-request-id':'req-p4a'}});
 }}});
 f.png=pngBytes(1024,1024);
 await f.submit(`export default async function(ctx){await ctx.image({model:'${codexApiProfile.id}',prompt:'Dawn'});}`); await f.finish();
 assert.equal(posts,1); const step=f.plans.steps(f.project.id)[0];
 assert.equal(step.priceMicros,codexApiProfile.unitCostMicros); assert.equal(f.store.get('artifact',step.result.artifact.artifactId).fixture,false);
 await f.restart(); await f.tick(); assert.equal(posts,1); f.noGraph();
});

test('OpenAI speech normalizes through the existing WAV derivation and publishes a reusable owned audio source',async t=>{
 let f,posts=0;
 f=await realCodeFixture(t,{profiles:[codexImageProfile,videoProfile,speechProfile],configuration:{speech:true},transport:{speechFetch:async(url,init)=>{
  posts++; assert.equal(url,'https://api.openai.com/v1/audio/speech'); assert.equal(init.method,'POST');
  assert.equal(f.store.list('speech_execution_dispatch',f.project.id).length,1); return speechResponse(wave());
 }}});
 await f.submit(`export default async function(ctx){await ctx.speech({model:'${speechProfile.id}',text:'Dawn is here.'});}`); await f.finish();
 assert.equal(posts,1); const step=f.plans.steps(f.project.id)[0],artifact=f.store.get('artifact',step.result.artifact.artifactId);
 assert.equal(step.priceMicros,'10000'); assert.equal(artifact.fixture,false); assert.equal(artifact.origin,'generated_audio');
 assert.equal(f.store.get('media_source',artifact.id).source.probe.audio.sampleRate,48000);
 assert.equal(f.store.list('audio_derivation_receipt',f.project.id).length,1);
 await f.restart(); await f.tick(); assert.equal(posts,1); f.noGraph();
});

test('MiniMax H3 uses the registered adapter, retained task and existing video derivation without a graph review',async t=>{
 let f,posts=0,polls=0;
 const json=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 f=await realCodeFixture(t,{profiles:[codexImageProfile,miniMaxProfile],videoSeconds:6,configuration:{h3:true,h3DownloadHosts:['media.example.test']},transport:{h3Fetch:async(url,init)=>{
  if(init.method==='POST'){posts++;assert.equal(f.store.list('h3_execution_dispatch',f.project.id).length,1);return json({task_id:'task_code_h3'});}
  polls++; return json({task:{id:'task_code_h3',model:'MiniMax-H3',status:'succeeded',duration:6,resolution:'768P',usage:{total_seconds:6},content:{url:'https://media.example.test/output.mp4'}}});
 }}});
 await f.submit(`export default async function(ctx){const image=await ctx.image({prompt:'Tea'});if(image.ok)await ctx.video({model:'${miniMaxProfile.id}',firstFrame:image.artifact,prompt:'Slow camera',durationSeconds:6});}`);
 await f.finish(); assert.equal(posts,1); assert.equal(polls,1); assert.equal(f.plans.view(f.project.id).spentMicros,'100000');
 assert.equal(f.store.list('video_derivation_receipt',f.project.id).length,1); f.noGraph();
});

test('a terminal lost Viggle POST retains charged liability and never permits resubmission',async t=>{
 const f=await realCodeFixture(t); let posts=0;f.viggleFetch=async(_url,init)=>{assert.equal(init.method,'POST');posts++;throw Error('lost HTTP reply');};
 await f.submit(`export default async function(ctx){const image=await ctx.image({prompt:'Tea'});if(image.ok)await ctx.video({firstFrame:image.artifact,prompt:'Slow camera',durationSeconds:3});}`);
 await f.tick(); await f.tick(); const video=f.execution.attempts(f.project.id).find(row=>row.request.kind==='video');
 assert.equal(video.phase,'failed'); assert.equal(video.failure.id,'SUBMISSION_RESPONSE_LOST'); assert.equal(video.failure.retryAllowed,false); assert.equal(f.execution.liability(video.id),'charged');
 await f.restart();for(let i=0;i<3;i++)await f.tick();
 assert.equal(posts,1);assert.equal(f.plans.view(f.project.id).spentMicros,'100000');assert.equal(f.fake.acceptedCount(),0);f.noGraph();
});

test('completed video ingestion can restart without another submit, poll or download',async t=>{
 const f=await realCodeFixture(t),ingester=f.mediaRuntime.outputIngestor,ingest=ingester.ingest.bind(ingester);let interrupted=true;
 ingester.ingest=input=>{if(input.output.kind==='video'&&interrupted){interrupted=false;throw Error('local ingestion interrupted');}return ingest(input);};
 await f.submit(`export default async function(ctx){const image=await ctx.image({prompt:'Tea'});if(image.ok)await ctx.video({firstFrame:image.artifact,prompt:'Slow camera',durationSeconds:3});}`);
 for(let i=0;i<5&&!f.execution.attempts(f.project.id).some(row=>row.phase==='ingesting');i++)await f.tick();
 const before={...f.calls};assert.equal(f.execution.attempts(f.project.id).find(row=>row.request.kind==='video').phase,'ingesting');
 await f.restart();await f.finish();assert.deepEqual(f.calls,before);f.noGraph();
});

test('a lost accepted Viggle adapter reply recovers by lookup after restart and never repeats POST',async t=>{
 const f=await realCodeFixture(t),bridge=f.mediaRuntime.registry.resolve({adapter:'viggle-h3',version:'1'}),submit=bridge.submit.bind(bridge);
 bridge.submit=async(...args)=>{await submit(...args);throw Error('lost bridge reply after saving the vendor receipt');};
 await f.submit(`export default async function(ctx){const image=await ctx.image({prompt:'Tea'});if(image.ok)await ctx.video({firstFrame:image.artifact,prompt:'Slow camera',durationSeconds:3});}`);
 await f.tick();await f.tick();const video=f.execution.attempts(f.project.id).find(row=>row.request.kind==='video');
 assert.equal(video.phase,'submission_unknown');assert.equal(video.taskId,null);assert.equal(f.calls.video,1);
 await f.restart();const recovered=f.mediaRuntime.registry.resolve({adapter:'viggle-h3',version:'1'}),lookup=recovered.lookup.bind(recovered);let lookups=0;
 recovered.lookup=async(...args)=>{lookups++;return lookup(...args);};
 await f.finish();assert.equal(lookups,1);assert.equal(f.calls.video,1);assert.equal(f.calls.poll,1);assert.equal(f.calls.download,1);f.noGraph();
});

test('real rendering mixes an owned speech placement at 48 kHz and enforces timeline bounds',async t=>{
 const f=await realCodeFixture(t,{profiles:[codexImageProfile,videoProfile,speechProfile],configuration:{speech:true},transport:{speechFetch:async()=>speechResponse(wave())}});
 const source=twoShots.replace('const clips=[];',`const voice=await ctx.speech({model:'${speechProfile.id}',text:'A quiet morning.'}); if(!voice.ok)throw Error(voice.error.code); const clips=[];`)
  .replace('timeline:clips,width:160','timeline:clips,audio:[{artifact:voice.artifact,atSample:0,durationSamples:48000}],width:160');
 await f.submit(source);await f.finish();
 const rendered=f.store.get('artifact',f.plans.steps(f.project.id).find(row=>row.kind==='render').result.artifact.artifactId);
 const probe=JSON.parse((await promisify(execFile)(tool('ffprobe'),['-v','error','-show_streams','-of','json',rendered.path])).stdout);
 const audio=probe.streams.find(row=>row.codec_type==='audio');assert.equal(audio.codec_name,'aac');assert.equal(audio.sample_rate,'48000');assert.equal(audio.channels,2);
 assert.equal(f.plans.view(f.project.id).spentMicros,'210000');
 const {captureCodePlanRender}=await import('../dist/media/timeline-capture.js');
 const clip=f.plans.steps(f.project.id).find(row=>row.kind==='video').result.artifact;
 for(const args of [{timeline:Array(65).fill(clip)}, {timeline:[clip],audio:Array(66).fill({})}, {timeline:[clip],path:'/tmp/forbidden'},
  {timeline:[{...clip,sha256:'f'.repeat(64)}]}, {timeline:[{artifact:clip,durationFrames:10801}]}])
   assert.throws(()=>captureCodePlanRender(f.store,f.project.id,args));
 f.noGraph();
});

test('unpriced real profiles stay explicitly unknown and duration defaults fit their saved bounds',async t=>{
 const unpriced={...videoProfile,unitCostMicros:'0',minFrames:90,maxFrames:90};
 const f=await realCodeFixture(t,{profiles:[codexImageProfile,unpriced]});
 const model=f.plans.availableModels(f.project.id).find(row=>row.id===videoProfile.id);
 assert.equal(model.unitCostMicros,'0');assert.equal(model.priceUnknown,true);assert.equal(model.defaults.durationSeconds,3);
 await f.submit(`export default async function(ctx){const frame=await ctx.image({prompt:'Tea'});if(frame.ok)await ctx.video({firstFrame:frame.artifact,prompt:'Slow camera'});}`);
 await f.finish();assert.equal(f.plans.view(f.project.id).spentMicros,'0');assert.equal(f.execution.attempts(f.project.id).length,2);assert.equal(f.calls.video,1);f.noGraph();
});

test('accepted task evidence repairs a lost adapter receipt before polling the exact job',async t=>{
 const f=await realCodeFixture(t),insert=f.store.insert.bind(f.store);let fail=true;
 f.store.insert=(kind,...args)=>{if(kind==='viggle_h3_execution_submit'&&fail){fail=false;throw Error('lost receipt write after HTTP acceptance');}return insert(kind,...args);};
 await f.submit(`export default async function(ctx){const frame=await ctx.image({prompt:'Tea'});if(frame.ok)await ctx.video({firstFrame:frame.artifact,prompt:'Slow camera',durationSeconds:3});}`);
 await f.finish();assert.equal(f.calls.video,1);assert.equal(f.calls.poll,1);assert.equal(f.calls.download,1);
 assert.ok(f.store.list('execution_evidence',f.project.id).some(row=>row.outcome.type==='accepted'&&row.outcome.taskId==='vid_offline_h3'));f.noGraph();
});

for (const adapter of ['openai-image','viggle-h3','minimax-h3']) test(`${adapter} recovers an interrupted pre-marker intent as not dispatched`,async t=>{
 const profiles=adapter==='openai-image'?[codexApiProfile,videoProfile]:adapter==='minimax-h3'?[codexImageProfile,miniMaxProfile]:[codexImageProfile,videoProfile];
 const f=await realCodeFixture(t,{profiles,configuration:{image:adapter==='openai-image',h3:adapter==='minimax-h3',h3DownloadHosts:adapter==='minimax-h3'?['media.example.test']:[]}});
 if(adapter!=='openai-image'){await f.submit(imageSource);await f.finish();}
 const input=normalizeStepInput(adapter==='openai-image'?'image':'video',adapter==='openai-image'?{model:codexApiProfile.id,prompt:'Dawn'}:
  {model:profiles[1].id,firstFrame:f.plans.steps(f.project.id)[0].result.artifact,prompt:'Slow',durationSeconds:adapter==='minimax-h3'?6:3},f.execution.models(f.project.id));
 if(!f.plans.getRun(f.project.id))f.plans.submitPlan(f.project.id,'export default async function(){}');
 const kind=adapter==='openai-image'?'image':'video',attempt=f.execution.prepare(f.project.id,digest({kind,input}),kind,input);
 await f.restart();await f.execution.advance(f.project.id);
 assert.equal(f.execution.attempts(f.project.id).find(row=>row.id===attempt.id).phase,'failed');assert.equal(f.execution.liability(attempt.id),'released');
 assert.equal(f.calls.video,0);assert.equal(f.calls.poll,0);f.noGraph();
});

test('saved provider intent fields and creative inputs cannot be rewritten after admission',async t=>{
 const f=await realCodeFixture(t);await f.submit(imageSource);await f.finish();
 const attempt=f.execution.attempts(f.project.id)[0],receipt=f.store.get('code_plan_execution',attempt.id);
 for(const patch of [{priceMicros:'123'},{planVersion:2},{normalizedInput:{...receipt.normalizedInput,prompt:'new'}}])
  assert.throws(()=>f.store.put('code_plan_execution',attempt.id,f.project.id,{...receipt,...patch}),{code:'IMMUTABLE_RECORD'});
 assert.throws(()=>f.store.put('attempt',attempt.id,f.project.id,{...attempt,request:{...attempt.request,args:{...attempt.request.args,prompt:'rewritten'}}}),{code:'CODE_PLAN_PROVIDER_AUTHORITY'});
 assert.equal(f.calls.start,1);f.noGraph();
});

test('a real profile cannot overwrite the reserved local-render operation',async t=>{
 const f=await realCodeFixture(t,{profiles:[{...codexImageProfile,id:'local-render'},videoProfile]});
 assert.throws(()=>f.plans.availableModels(f.project.id),{code:'CODE_PLAN_MODEL'});assert.equal(f.calls.start,0);f.noGraph();
});


test('a persistent local render failure remains visible on replay and an unrelated new version can finish',async t=>{
 const f=await realCodeFixture(t);await f.submit(twoShots);await f.finish();
 const clips=f.plans.steps(f.project.id).filter(row=>row.kind==='video').map(row=>row.result.artifact);
 const source=`export default async function(ctx){await ctx.render({timeline:${JSON.stringify(clips)},width:320,height:180});}`;
 f.mediaRuntime.localExecutor.executeCodePlan=async()=>{throw Error('fixture renderer unavailable');};
 await f.submit(source);await f.tick();assert.equal(f.plans.getRun(f.project.id).state,'error');
 await f.plans.replay(f.project.id);await f.tick();assert.equal(f.plans.getRun(f.project.id).state,'error');
 assert.match(f.plans.getRun(f.project.id).error.message,/fixture renderer unavailable/);
 await f.submit('export default async function(ctx){await ctx.log("keep saved footage");}');await f.tick();
 assert.equal(f.plans.getRun(f.project.id).state,'done');assert.equal(f.calls.video,2);f.noGraph();
});

test('normalized speech retains the shared output bound when stereo conversion exceeds the raw spool cap',async t=>{
 const f=await realCodeFixture(t,{profiles:[codexImageProfile,videoProfile,speechProfile],configuration:{speech:true},transport:{speechFetch:async()=>speechResponse(wave(200*24000))}});
 await f.submit(`export default async function(ctx){await ctx.speech({model:'${speechProfile.id}',text:'A synthetic long PCM fixture.'});}`);await f.finish();
 const step=f.plans.steps(f.project.id)[0],artifact=f.store.get('artifact',step.result.artifact.artifactId);
 assert.ok(artifact.byteLength>32*1024*1024);assert.equal(artifact.physicalDurationSeconds,200);
 assert.equal(f.store.get('media_source',artifact.id).source.probe.audio.sampleRate,48000);assert.equal(f.plans.view(f.project.id).spentMicros,'10000');f.noGraph();
});
