import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, canonical } from '@openslate/core';
import { normalizeStepInput, stepKey, videoMode } from '../dist/code-plan/identity.js';
import { codePlanProviderArgs } from '../dist/code-plan/provider-input.js';
import { modelDescriptions, modelPrice } from '../dist/code-plan/models.js';
import { resolveCodePlanProviderAdmission } from '../dist/code-plan/provider-authority.js';
import { assertViggleH3ExecutionMapping } from '../dist/execution/viggle-h3-receipts.js';
import { viggleBackupClosure } from '../dist/persistence/viggle-backup.js';
import { readFile } from 'node:fs/promises';
import { realCodeFixture, videoProfile, miniMaxProfile, imageSource, settleLostSubmission } from './code-plan-providers-fixture.mjs';
import { codexImageProfile } from './codex-image-execution-fixture.mjs';
import { accepted, completed, pngBytes } from './viggle-h3-execution-fixture.mjs';

const frame={artifactId:'image-a',kind:'image',sha256:'a'.repeat(64)},other={...frame,artifactId:'image-b',sha256:'b'.repeat(64)};
const all=['reference','first_frame','first_last_frame','text'];
const modeInput={reference:{references:[frame,other]},first_frame:{firstFrame:frame},first_last_frame:{firstFrame:frame,lastFrame:other},text:{aspectRatio:'9:16'}};
const video=(adapter,model)=>({...videoProfile,id:'selected-profile',adapter,configuration:{model,settings:{resolution:'720p'}},minFrames:120});
const cases=[
 ['fake',undefined,all],['Viggle',videoProfile,all],['MiniMax',miniMaxProfile,['first_frame']],
 ['Seedance 1',video('seedance','seedance-1-0-pro-fast-251015'),['first_frame']],
 ['Seedance 2',video('seedance','dreamina-seedance-2-0-mini-260615'),all],
 ['Seedance 2 Pro',video('seedance','dreamina-seedance-2-0-260128'),all],
 ['Kling',video('fal-video-i2v','fal-ai/kling-video/v3/standard/image-to-video'),['first_frame','first_last_frame']],
 ['Veo',video('fal-video-i2v','fal-ai/veo3.1/fast/image-to-video'),['first_frame']],
 ['Wan',video('fal-video-i2v','alibaba/wan-3.0/image-to-video'),['first_frame','first_last_frame']],
];
for(const [name,profile,modes]of cases)test(`${name} declares and enforces every video mode`,()=>{
 const model={kind:'video',defaults:{durationSeconds:6},...(profile?{profile,profileDefinitionDigest:digest(profile)}:{})},models={selected:model};
 assert.deepEqual(modelDescriptions(models)[0].videoModes,modes);
 for(const mode of all){const input={model:'selected',prompt:'Camera orbits a walking figure',...modeInput[mode]};
  if(modes.includes(mode)){
   const normalized=normalizeStepInput('video',input,models);assert.equal(videoMode(normalized),mode);
   if(profile)codePlanProviderArgs(profile,normalized,{enhance:false});
  }else assert.throws(()=>normalizeStepInput('video',input,models),e=>e.code==='CODE_PLAN_INPUT'&&modes.every(mode=>e.message.includes(mode)));
 }
 for(const patch of [{references:[frame],firstFrame:frame},{references:[frame],lastFrame:frame},{lastFrame:frame},{references:'bad'},{}])
  assert.throws(()=>normalizeStepInput('video',{model:'selected',prompt:'Move',...patch},models),{code:'CODE_PLAN_INPUT'});
});

test('reference count, shape, order, text ratio, first-frame identity and no Studio enhancement option',()=>{
 for(const [profile,max]of [[videoProfile,4],[cases[4][1],9]]){
  const models={selected:{kind:'video',profile,defaults:{durationSeconds:6}}};
  assert.equal(normalizeStepInput('video',{model:'selected',references:Array(max).fill(frame)},models).references.length,max);
  assert.throws(()=>normalizeStepInput('video',{model:'selected',references:Array(max+1).fill(frame)},models),{code:'CODE_PLAN_INPUT'});
 }
 const models={selected:{kind:'video',profile:videoProfile,defaults:{durationSeconds:6}}};
 const old={durationSeconds:6,firstFrame:{kind:'image',sha256:frame.sha256},model:'selected',prompt:'Move'};
 assert.equal(canonical(normalizeStepInput('video',{model:'selected',prompt:'Move',firstFrame:frame},models)),canonical(old));
 assert.equal(stepKey('video',normalizeStepInput('video',{...old,references:[]},models)),stepKey('video',old));
 const refInput={model:'selected',prompt:'Move',references:[frame,other]};
 assert.notEqual(stepKey('video',normalizeStepInput('video',refInput,models)),stepKey('video',normalizeStepInput('video',{...refInput,references:[other,frame]},models)));
 for(const patch of [{references:[{...frame,kind:'audio'}]},{references:[frame],durationSeconds:4},{aspectRatio:'adaptive'},{references:[frame],enhance:true}])
  assert.throws(()=>{const input=normalizeStepInput('video',{model:'selected',prompt:'Move',...patch},models);codePlanProviderArgs(videoProfile,input,{enhance:false});});
});

async function seed(t,changes={}){
 const f=await realCodeFixture(t,{videoSeconds:6,...changes});f.png=pngBytes(360,640);await f.submit(imageSource);await f.finish();
 f.frame=f.plans.steps(f.project.id)[0].result.artifact;
 f.source=fields=>`export default async function(ctx){await ctx.video({model:'${videoProfile.id}',prompt:'Dolly past the subject, pan left',durationSeconds:6,${fields}});}`;
 f.videoStep=()=>f.plans.steps(f.project.id).find(s=>s.kind==='video');return f;
}
for(const mode of all)test(`Viggle ${mode}: exact reservation, wire mode, detail, backup and restart recovery`,async t=>{
 const p={...videoProfile,configuration:{...videoProfile.configuration,settings:{...videoProfile.configuration.settings,resolution:'768p'}}};
 const f=await seed(t,{profiles:[codexImageProfile,p],videoSeconds:6});
 const fields=mode==='reference'?`references:[${JSON.stringify(f.frame)},${JSON.stringify(f.frame)}]`:mode==='text'?`aspectRatio:'9:16'`:
  `firstFrame:${JSON.stringify(f.frame)}${mode==='first_last_frame'?`,lastFrame:${JSON.stringify(f.frame)}`:''}`;
 const bridge=f.mediaRuntime.registry.resolve({adapter:'viggle-h3',version:'1'}),submit=bridge.submit.bind(bridge);
 bridge.submit=async(...args)=>{await submit(...args);throw Error('lost local reply after saved vendor receipt');};
 await f.submit(f.source(fields));await f.tick();await f.execution.awaitIdle();assert.equal(f.calls.video,1);assert.equal(f.store.get('attempt',f.videoStep().attemptId).phase,'submission_unknown');
 const attempt=f.store.get('attempt',f.videoStep().attemptId),mapping=f.store.get('viggle_h3_execution_mapping',attempt.id);
 const price=mode==='reference'||mode==='first_last_frame'?'300000':'180000';
 assert.equal(mapping.transport.mode,mode);assert.equal(mapping.transport.enhance,false);assert.equal(mapping.estimatedMicros,price);
 assertViggleH3ExecutionMapping(attempt,mapping);
 assert.equal(resolveCodePlanProviderAdmission(f.store,attempt.request).reservation.micros,price);
 assert.equal(modelPrice(f.execution.models(f.project.id)[p.id],f.videoStep().input),price);
 assert.equal(f.form.get('enhance'),'false');assert.equal(f.form.get('aspect_ratio'),'9:16');
 if(mode==='reference'){
  assert.equal(f.form.has('first_frame_image'),false);assert.equal(f.form.has('last_frame_image'),false);assert.equal(f.form.getAll('reference_image').length,2);
  for(const file of f.form.getAll('reference_image'))assert.deepEqual(Buffer.from(await file.arrayBuffer()),f.png);
  assert.equal(mapping.firstFrameCrop,undefined);assert.equal(mapping.references.length,2);
 }
 await viggleBackupClosure(f.store,async()=>assert.fail('No output read required'),record=>readFile(record.path)).records(attempt.id);
 await f.restart();await f.finish();assert.equal(f.calls.video,1);assert.equal(f.calls.poll,1);
 const step=f.videoStep();assert.equal(step.state,'succeeded');assert.equal(f.store.get('code_plan_execution',step.attemptId).priceMicros,price);
 assert.equal(f.execution.liability(step.attemptId),'charged');assert.equal(f.plans.view(f.project.id).spentMicros,price);
 const detail=f.plans.stepDetail(f.project.id,step.key);assert.equal(detail.mode,mode);assert.equal(detail.call.settings.mode,mode);assert.equal(detail.call.settings.enhance,false);
 assert.equal(detail.references?.length,mode==='reference'?2:undefined);assert.equal(!!detail.firstFrame,mode.startsWith('first'));assert.equal(!!detail.lastFrame,mode==='first_last_frame');
 const calls={...f.calls};await f.submit(f.source(fields));await f.finish();assert.deepEqual(f.calls,calls);f.noGraph();
});

test('foreign or missing references are refused before admission or POST',async t=>{
 const f=await seed(t);
 for(const ref of [other,{...f.frame,sha256:'f'.repeat(64)}])await assert.rejects(f.submit(f.source(`references:[${JSON.stringify(ref)}]`)),{code:'CODE_PLAN_REJECTED'});
 assert.equal(f.calls.video,0);assert.equal(f.execution.attempts(f.project.id).length,1);
});

for(const status of ['failed','cancelled'])test(`Viggle ${status} task releases exactly its reserved liability`,async t=>{
 const f=await seed(t);f.viggleFetch=async(_url,init)=>init.method==='POST'?accepted():new Response(JSON.stringify({id:'vid_offline_h3',status}),{headers:{'content-type':'application/json'}});
 await f.submit(f.source(`references:[${JSON.stringify(f.frame)}]`));
 for(let i=0;i<12;i++){await f.tick();const step=f.videoStep();if(step?.retryAt!==undefined)f.store.put('code_plan_step',step.id,f.project.id,{...step,retryAt:0});if(f.plans.view(f.project.id).state==='done_with_failures')break;}
 assert.equal(f.videoStep().state,'failed');assert.equal(f.execution.liability(f.videoStep().attemptId),'released');assert.equal(f.plans.view(f.project.id).spentMicros,'0');
});

async function historical(t,lost=false){
 const f=await seed(t);const source=f.source(`firstFrame:${JSON.stringify(f.frame)}`);await f.submit(source);
 const input=normalizeStepInput('video',{model:videoProfile.id,firstFrame:f.frame,prompt:'Dolly past the subject, pan left',durationSeconds:6},f.execution.models(f.project.id));
 const key=stepKey('video',input),attempt=f.execution.prepare(f.project.id,key,'video',input),record=f.store.get('code_plan_execution',attempt.id);
 // Simulate persisted pre-N6 state, including its old admission price and no enhance field.
 delete attempt.request.args.enhance;
 f.store.db.prepare("UPDATE entities SET body=? WHERE kind='attempt' AND id=?").run(JSON.stringify(attempt),attempt.id);
 f.store.db.prepare("UPDATE entities SET body=? WHERE kind='code_plan_execution' AND id=?").run(JSON.stringify({...record,requestDigest:digest(attempt.request),priceMicros:'100000'}),attempt.id);
 const id=digest({projectId:f.project.id,key}),at=new Date().toISOString();
 f.store.put('code_plan_step',id,f.project.id,{id,projectId:f.project.id,key,kind:'video',input,state:'in_flight',attemptId:attempt.id,result:null,priceMicros:'100000',createdAt:at,updatedAt:at});
 const working=f.viggleFetch;if(lost)f.viggleFetch=async()=>{throw Error('lost POST reply');};
 await f.execution.submit(attempt.id);if(lost)await settleLostSubmission(f,t);await f.finish();return Object.assign(f,{oldKey:key,oldAttempt:attempt,oldInput:input,working,oldSource:source});
}

test('saved pre-N6 first-frame plan and digest survive restart without any repayment',async t=>{
 const f=await historical(t),step=f.videoStep(),mapping=f.store.get('viggle_h3_execution_mapping',step.attemptId);
 assert.equal(mapping.transport.enhance,undefined);assert.equal(f.form.has('enhance'),false);assertViggleH3ExecutionMapping(f.oldAttempt,mapping);
 const oldDigest=mapping.transport.requestDigest;assert.equal(f.plans.view(f.project.id).spentMicros,'100000');
 await f.restart();await f.submit(f.oldSource);await f.finish();
 assert.equal(f.calls.video,1);assert.equal(f.videoStep().key,f.oldKey);assert.deepEqual(f.videoStep().input,f.oldInput);assert.equal(f.videoStep().priceMicros,'100000');
 assert.equal(f.store.get('viggle_h3_execution_mapping',step.attemptId).transport.requestDigest,oldDigest);
});

test('a new attempt of a historical first-frame step uses the table and enhance=false, retaining old liability',async t=>{
 const f=await historical(t,true);assert.equal(f.videoStep().state,'failed');f.viggleFetch=f.working;
 f.plans.retryStep(f.project.id,{stepKey:f.oldKey,consent:{by:'person'}});await f.finish();
 assert.equal(f.videoStep().key,f.oldKey);assert.deepEqual(f.videoStep().input,f.oldInput);assert.equal(f.videoStep().priceMicros,'120000');
 const attempts=f.execution.attempts(f.project.id).filter(a=>a.request.kind==='video');assert.equal(attempts.length,2);
 assert.deepEqual(attempts.map(a=>f.store.get('code_plan_execution',a.id).priceMicros),['100000','120000']);
 assert.equal(f.form.get('enhance'),'false');assert.equal(f.plans.view(f.project.id).spentMicros,'220000');
});

test('distinct ordered references select aspect from the first image and cannot swap pins or understate price',async t=>{
 const f=await seed(t),first=f.frame;f.png=pngBytes(640,360);
 await f.submit(imageSource.replace('A window at dawn','A window at dusk'));await f.finish();
 const second=f.plans.steps(f.project.id).filter(step=>step.kind==='image').at(-1).result.artifact;
 const source=refs=>f.source(`references:${JSON.stringify(refs)}`);
 await f.submit(source([first,second]));await f.finish();
 const step=f.videoStep(),attempt=f.store.get('attempt',step.attemptId),mapping=f.store.get('viggle_h3_execution_mapping',attempt.id);
 assert.equal(mapping.transport.aspectRatio,'9:16');assert.deepEqual(mapping.references.map(pin=>pin.artifactId),[first.artifactId,second.artifactId]);
 for(const patch of [{references:[...mapping.references].reverse()},{estimatedMicros:'1'},{transport:{...mapping.transport,enhance:true}},{firstFrame:mapping.references[0]}])
  assert.throws(()=>assertViggleH3ExecutionMapping(attempt,{...mapping,...patch}),{code:'VIGGLE_H3_EXECUTION_CONFLICT'});
 await f.submit(source([second,first]));await f.finish();
 const clips=f.plans.steps(f.project.id).filter(step=>step.kind==='video');assert.equal(clips.length,2);assert.notEqual(clips[0].key,clips[1].key);
 const current=clips.find(row=>row.key!==step.key);
 assert.equal(f.calls.video,2);assert.equal(f.form.get('aspect_ratio'),'16:9');
 assert.deepEqual(f.plans.stepDetail(f.project.id,current.key).references,[second,first]);
});
