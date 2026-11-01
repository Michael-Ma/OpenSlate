import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import net from 'node:net';
import { once } from 'node:events';
import { digest } from '@openslate/core';
import { realCodeFixture, videoProfile, miniMaxProfile, imageSource } from './code-plan-providers-fixture.mjs';
import { codexImageProfile } from './codex-image-execution-fixture.mjs';
import { pngBytes } from './viggle-h3-execution-fixture.mjs';
import { wireCodePlans, readCodeFilm } from '../dist/code-plan/director.js';

async function seed(t, changes={}) {
 const f=await realCodeFixture(t,changes);await f.submit(imageSource);await f.finish();
 f.frame=f.plans.steps(f.project.id)[0].result.artifact;
 f.source=`export default async function(ctx){await ctx.shot({id:'tofu-05',title:'The final tofu shot'}); const clip=await ctx.video({model:'${videoProfile.id}',firstFrame:${JSON.stringify(f.frame)},prompt:'Tofu rising',durationSeconds:3});if(!clip.ok) await ctx.log('This clip needs attention');}`;
 f.videoStep=()=>f.plans.steps(f.project.id).find(step=>step.kind==='video');
 f.makeDue=()=>{const s=f.videoStep();if(s?.retryAt!==undefined)f.store.put('code_plan_step',s.id,f.project.id,{...s,retryAt:0});};
 return f;
}
async function failed(f){for(let i=0;i<12;i++){await f.tick();if(f.plans.view(f.project.id).state==='done_with_failures')return;}assert.fail(JSON.stringify(f.plans.view(f.project.id)));}
for(const mode of ['refused','dns'])test(`code-mode ${mode} connections release liability, back off and retry at most twice`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=await seed(t), before=dns.lookup;let target;
 if(mode==='dns'){
  t.after(()=>{dns.lookup=before;});target='http://n1-runtime-dns.invalid';
  dns.lookup=(host,options,callback)=>{assert.equal(host,'n1-runtime-dns.invalid');callback(Object.assign(new Error('offline DNS'),{code:'ENOTFOUND'}));};
 }else{const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');target=`http://127.0.0.1:${s.address().port}`;await new Promise(r=>s.close(r));}
 const working=f.viggleFetch;let submits=0;
 f.viggleFetch=async(_url,init)=>{assert.equal(init.method,'POST');submits++;return fetch(target,init);};
 await f.submit(f.source);await f.tick();await f.tick();
 assert.equal(submits,1);assert.ok(f.videoStep().retryAt>Date.now());assert.equal(f.plans.view(f.project.id).spentMicros,'0');
 assert.equal(f.plans.view(f.project.id).steps.find(s=>s.kind==='video').error.retry,'safe');
 await f.tick();assert.equal(submits,1,'backoff does not redispatch immediately');
 f.makeDue();await f.tick();await f.tick();assert.equal(submits,2);
 await f.restart();f.makeDue();await failed(f);assert.equal(submits,3);
 for(let i=0;i<3;i++)await f.tick();assert.equal(submits,3);
 const step=f.plans.view(f.project.id).steps.find(s=>s.kind==='video');
 assert.equal(step.attempts,3);assert.equal(step.error.mayHaveCharged,false);assert.equal(step.error.retry,'safe');
 assert.equal(f.execution.attempts(f.project.id).filter(a=>a.fingerprint===step.key).length,3);
 assert.ok(f.execution.attempts(f.project.id).filter(a=>a.fingerprint===step.key).every(a=>f.execution.liability(a.id)==='released'));
 // Explicit consent can retry once more, reusing the image and step key.
 f.viggleFetch=working;f.plans.retryStep(f.project.id,{stepKey:step.key,consent:{by:'person'}});await f.finish();
 assert.equal(f.videoStep().key,step.key);assert.equal(f.plans.view(f.project.id).steps.find(s=>s.kind==='video').attempts,4);
 assert.equal(f.calls.start,1);assert.equal(f.plans.view(f.project.id).spentMicros,'60000');
});

test('safe automatic retry can succeed on its second intent without a new step or consent',async t=>{
 const f=await seed(t),working=f.viggleFetch;let posts=0;
 f.viggleFetch=async(...args)=>{if(args[1].method==='POST'&&++posts===1)throw new TypeError('fetch failed',{cause:Object.assign(new Error(),{code:'ECONNREFUSED'})});return working(...args);};
 await f.submit(f.source);await f.tick();await f.tick();f.makeDue();await f.finish();
 assert.equal(posts,2);assert.equal(f.plans.view(f.project.id).steps.find(s=>s.kind==='video').attempts,2);
 assert.equal(f.plans.view(f.project.id).spentMicros,'60000');
});

test('terminal lost-submit needs consent, keeps earlier liability, fences new dispatch with Stop/hold/ceiling and reuses other media',async t=>{
 const f=await seed(t),working=f.viggleFetch;
 f.viggleFetch=async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error(),{code:'ECONNRESET'})});};
 await f.submit(f.source);await failed(f);const key=f.videoStep().key, old=f.videoStep().attemptId;
 wireCodePlans(f.service,f.plans);const step=readCodeFilm(f.service,f.project.id).steps.find(s=>s.key===key);
 assert.deepEqual(step.error,{code:'SUBMISSION_RESPONSE_LOST',retry:'consent',mayHaveCharged:true});assert.equal(step.attempts,1);
 assert.equal(f.plans.view(f.project.id).spentMicros,'60000');
 await f.restart();for(let i=0;i<3;i++)await f.tick();assert.equal(f.execution.attempts(f.project.id).length,2);
 f.plans.setCeiling(f.project.id,{ceilingMicros:'60000',by:'person'});
 const consent={by:'director',quote:'retry the tofu clip',invocationId:'retry-once'};
 const receipt=f.plans.retryStep(f.project.id,{stepKey:key,consent});
 f.viggleFetch=working;await f.tick();assert.equal(f.plans.view(f.project.id).state,'paused_budget');
 f.plans.setCeiling(f.project.id,{ceilingMicros:'120000',by:'person'});
 f.service.engine.setPaused(f.project.id,true,'local-user');await f.tick();assert.equal(f.videoStep().attemptId,old);
 f.service.engine.setPaused(f.project.id,false,'local-user');f.plans.hold(f.project.id,'request');await f.tick();assert.equal(f.videoStep().attemptId,old);
 f.plans.release(f.project.id,'request');await f.finish();
 assert.notEqual(f.videoStep().attemptId,old);assert.equal(f.videoStep().key,key);assert.equal(f.calls.start,1);
 assert.equal(f.plans.view(f.project.id).spentMicros,'120000');assert.equal(f.execution.liability(old),'charged');
 assert.deepEqual(f.plans.retryStep(f.project.id,{stepKey:key,consent}),receipt,'lost mutation reply returns original receipt after success');
 assert.throws(()=>f.plans.retryStep(f.project.id,{stepKey:key,consent:{by:'person'}}),{code:'CODE_PLAN_RETRY'});
 assert.throws(()=>f.plans.setCeiling(f.project.id,{ceilingMicros:'119999',by:'person'}),e=>{
  assert.equal(e.code,'CODE_PLAN_CEILING');assert.deepEqual(e.details,{ceilingMicros:'119999',chargedMicros:'60000',unknownMicros:'60000',inFlightMicros:'0',liabilityMicros:'120000'});return true;
 });
});

test('refused content is not retryable and an obsolete failure cannot be retried',async t=>{
 const f=await seed(t);
 f.viggleFetch=async()=>new Response(JSON.stringify({error:{code:'CONTENT_POLICY_VIOLATION',message:'refused',retryable:false,request_id:null,details:{},remediation:{action:'edit'}}}),{status:422,headers:{'content-type':'application/json'}});
 await f.submit(f.source);await failed(f);let step=f.plans.view(f.project.id).steps.find(s=>s.kind==='video');
 assert.equal(step.error.retry,'none');assert.equal(step.error.mayHaveCharged,false);assert.equal(step.attempts,1);
 assert.throws(()=>f.plans.retryStep(f.project.id,{stepKey:step.key,consent:{by:'person'}}),{code:'CODE_PLAN_RETRY'});
 await f.submit('export default async function(ctx){await ctx.log("skip");}');await f.finish();
 assert.equal(f.plans.view(f.project.id).steps.find(s=>s.key===step.key).reached,false);
 assert.throws(()=>f.plans.retryStep(f.project.id,{stepKey:step.key,consent:{by:'person'}}),{code:'CODE_PLAN_RETRY'});
});

for(const explicit of [false,true])test(`941×1672 code first frame uses a 9:16 Viggle request and retains 95% (${explicit?'explicit':'inferred'})`,async t=>{
 const f=await realCodeFixture(t);f.png=pngBytes(941,1672);await f.submit(imageSource);await f.finish();
 const frame=f.plans.steps(f.project.id)[0].result.artifact,working=f.viggleFetch;
 f.viggleFetch=async(url,init)=>{if(init.method==='POST'){
  const form=await new Request(url,{method:'POST',headers:init.headers,body:init.body}).formData();assert.equal(form.get('aspect_ratio'),'9:16');
 }return working(url,init);};
 const source=ratio=>`export default async function(ctx){await ctx.video({model:'${videoProfile.id}',firstFrame:${JSON.stringify(frame)},prompt:'Vertical motion',durationSeconds:3${ratio?`,aspectRatio:'${ratio}'`:''}});}`;
 await f.submit(source(explicit?'9:16':null));await f.finish();
 const mapping=f.store.list('viggle_h3_execution_mapping',f.project.id)[0],w=f.firstFrame.readUInt32BE(16),h=f.firstFrame.readUInt32BE(20);
 assert.equal(mapping.transport.aspectRatio,'9:16');assert.ok(w*h/(941*1672)>=.95);assert.equal(w/h,9/16);
 const key=f.plans.steps(f.project.id).find(s=>s.kind==='video').key;
 assert.equal(f.plans.steps(f.project.id).find(s=>s.key===key).input.aspectRatio,'9:16');
 await f.submit(source('9:16'));await f.finish();assert.equal(f.calls.video,1,'explicit and inferred matching ratios reuse');
 const diff=await f.plans.dryRun(f.project.id,source('16:9'));assert.equal(diff.newSteps.length,1,'ratio changes step identity');
});

test('a submitted replacement fences retry eligibility before its first pass',async t=>{
 const f=await seed(t);f.viggleFetch=async()=>{throw Error('lost reply');};await f.submit(f.source);await failed(f);
 const key=f.videoStep().key;await f.submit('export default async function(ctx){await ctx.log("skip the clip");}');
 assert.throws(()=>f.plans.retryStep(f.project.id,{stepKey:key,consent:{by:'person'}}),{code:'CODE_PLAN_RETRY'});await f.finish();
});

test('MiniMax connect rejection is safe in the shared code-plan bridge and an explicit portrait ratio follows its first frame',async t=>{
 let mode='connect',posts=0;
 const f=await realCodeFixture(t,{profiles:[codexImageProfile,miniMaxProfile],configuration:{h3:true,h3DownloadHosts:['media.example.test']},transport:{h3Fetch:async(url,init)=>{
  if(init.method==='POST'){posts++;if(mode==='connect')throw new TypeError('fetch failed',{cause:Object.assign(new Error(),{code:'ECONNREFUSED'})});
   const body=JSON.parse(init.body);assert.equal(body.ratio,'adaptive');return new Response(JSON.stringify({task_id:'123456'}),{headers:{'content-type':'application/json'}});
  }
  return new Response(JSON.stringify({task:{id:'123456',model:'MiniMax-H3',status:'succeeded',task_type:'generation',modality:'video',file_url:'https://media.example.test/minimax.mp4'}}),{headers:{'content-type':'application/json'}});
 }}});
 f.png=pngBytes(941,1672);await f.submit(imageSource);await f.finish();const frame=f.plans.steps(f.project.id)[0].result.artifact;
 const source=ratio=>`export default async function(ctx){await ctx.video({model:'${miniMaxProfile.id}',firstFrame:${JSON.stringify(frame)},prompt:'Portrait',durationSeconds:6,aspectRatio:'${ratio}'});}`;
 await f.submit(source('9:16'));await f.tick();await f.tick();let step=f.plans.steps(f.project.id).find(s=>s.kind==='video');
 assert.ok(step.result);assert.equal(step.result.error.retry,'safe');assert.equal(f.execution.liability(step.attemptId),'released');
 assert.equal(f.store.list('h3_execution_submit',f.project.id).length,1);assert.equal(posts,1);
 assert.ok((await f.plans.dryRun(f.project.id,source('16:9'))).findings.some(x=>x.code==='RUNTIME_ERROR'));
 mode='success';f.store.put('code_plan_step',step.id,f.project.id,{...step,retryAt:0});
 // Submission itself is enough here: real MiniMax normalization/recovery is covered by the existing provider suite.
 await f.tick();assert.equal(posts,2);step=f.plans.steps(f.project.id).find(s=>s.kind==='video');assert.notEqual(step.attemptId,null);
 assert.equal(f.plans.view(f.project.id).steps.find(s=>s.kind==='video').attempts,2);
});

test('historical default-ratio journals remain reused; an explicit ratio deliberately creates corrected work',async t=>{
 const {normalizeStepInput,stepKey}=await import('../dist/code-plan/identity.js');
 const f=await seed(t);await f.submit(f.source);
 const input=normalizeStepInput('video',{model:videoProfile.id,firstFrame:f.frame,prompt:'Tofu rising',durationSeconds:3},f.execution.models(f.project.id));
 const key=stepKey('video',input),id=digest({projectId:f.project.id,key}),at=new Date().toISOString();
 const attempt=f.execution.prepare(f.project.id,key,'video',input);
 f.store.put('code_plan_step',id,f.project.id,{id,projectId:f.project.id,key,kind:'video',input,state:'in_flight',attemptId:attempt.id,result:null,priceMicros:'60000',createdAt:at,updatedAt:at});
 await f.execution.submit(attempt.id);await f.finish();assert.equal(f.calls.video,1);
 await f.restart();await f.finish();assert.equal(f.calls.video,1);assert.equal(f.videoStep().key,key);
 await f.submit(f.source.replace("durationSeconds:3","durationSeconds:3,aspectRatio:'1:1'"));await f.finish();
 assert.equal(f.calls.video,2);assert.equal(f.plans.view(f.project.id).spentMicros,'120000');
});

test('pre-N1 saved failures project retry meaning before replay and can be retried after upgrading',async t=>{
 const f=await seed(t),working=f.viggleFetch;f.viggleFetch=async()=>{throw Error('lost submit');};await f.submit(f.source);await failed(f);
 const step=f.videoStep();f.store.put('code_plan_step',step.id,f.project.id,{...step,result:{ok:false,error:{code:'SUBMISSION_RESPONSE_LOST',message:'old failure'}}});
 assert.deepEqual(f.plans.view(f.project.id).steps.find(s=>s.key===step.key).error,{code:'SUBMISSION_RESPONSE_LOST',retry:'consent',mayHaveCharged:true});
 await f.restart();await f.tick();assert.equal(f.videoStep().result.error.retry,'consent');
 f.viggleFetch=working;f.plans.retryStep(f.project.id,{stepKey:step.key,consent:{by:'person'}});await f.finish();assert.equal(f.calls.start,1);
});
