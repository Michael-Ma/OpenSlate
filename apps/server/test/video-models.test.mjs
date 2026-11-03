import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '@openslate/core';
import { seedancePriceMicros, falVideoPriceMicros } from '@openslate/providers';
import { realCodeFixture, videoProfile, miniMaxProfile } from './code-plan-providers-fixture.mjs';
import { projectModels } from '../dist/code-plan/models.js';
import { codexImageProfile } from './codex-image-execution-fixture.mjs';
import { pngBytes, tool } from './viggle-h3-execution-fixture.mjs';
import { modelPrice, modelDescriptions, codePlanPriceFrame } from '../dist/code-plan/models.js';
import { resolveCodePlanProviderAdmission } from '../dist/code-plan/provider-authority.js';
import { videoI2vFailure } from '../dist/execution/video-i2v-execution.js';
import { quote, unitQuote } from '../dist/generation-quotes.js';
import { readMediaExecutionConfiguration } from '../dist/application/media-execution-config.js';
import { InstalledProviderCatalog } from '../dist/application/provider-catalog.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';

const seedanceModel='dreamina-seedance-2-0-mini-260615';
const kling='fal-ai/kling-video/v3/standard/image-to-video',veo='fal-ai/veo3.1/fast/image-to-video',wan='alibaba/wan-3.0/image-to-video';
function profile(adapter='seedance',model=seedanceModel) { return {id:'n2-video',revision:'n2-1',kind:'video',adapter,executionVersion:'1',
 configuration:{model,settings:{resolution:'720p'}},minFrames:adapter==='seedance'?120:model===veo?120:90,maxFrames:model===veo?240:450,maxConcurrency:2,unitCostMicros:'1',maxRetries:0}; }
async function fixture(t,{adapter='seedance',model=seedanceModel,mode='complete',lastFrame=false}={}) {
 const state={creates:0,polls:0,downloads:0,bodies:[],mode,lastFrame};let f;
 const server=createServer(async(req,res)=>{
  const url=req.url;
  if(url.startsWith('/clip')||url.startsWith('/frame')) {
   state.downloads++;assert.equal(req.headers.authorization,undefined);
   if(state.downloadFail){res.destroy();return;}
   const bytes=url.startsWith('/frame')?f.jpeg:f.video;
   res.writeHead(200,{'content-type':url.startsWith('/frame')?'image/jpeg':'video/mp4','content-length':bytes.length});res.end(bytes);return;
  }
  assert.equal(req.headers.authorization,adapter==='seedance'?'Bearer offline-fixture-key':'Key offline-fixture-key');
  res.setHeader('content-type','application/json');
  if(req.method==='POST') {
   state.creates++;const parts=[];for await(const part of req)parts.push(part);state.bodies.push(JSON.parse(Buffer.concat(parts)));
   assert.equal(f.store.list('video_i2v_dispatch',f.project.id).length,state.creates);
   if(state.mode==='lost'){res.destroy();return;}
   if(state.mode==='refuse'){res.statusCode=422;res.end(JSON.stringify({error:{code:'InvalidParameter.RealPersonFace'},detail:[{type:'content_policy_violation'}]}));return;}
   res.end(JSON.stringify(adapter==='seedance'?{id:'task-seedance'}:{request_id:'task-fal001'}));return;
  }
  state.polls++;
  if(adapter==='seedance') res.end(JSON.stringify({id:'task-seedance',status:state.mode==='moderation'||state.mode==='transient'?'failed':state.mode==='pending'?'running':'succeeded',
   content:{video_url:'https://media.example.test/clip.mp4',...(state.lastFrame?{last_frame_url:'https://media.example.test/frame.jpg'}:{})},
   usage:{completion_tokens:108000},error:{code:state.mode==='transient'?'InternalServiceError':'InvalidParameter.RealPersonFace'}}));
  else if(url.endsWith('/status'))res.end(JSON.stringify({request_id:'task-fal001',status:state.mode==='pending'?'IN_QUEUE':'COMPLETED',...(state.mode==='moderation'?{error:'blocked',error_type:'content_policy_violation'}:{})}));
  else res.end(JSON.stringify({video:{url:'https://media.example.test/clip.mp4'},duration:5}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const port=server.address().port;
 const apiFetch=(url,init)=>{ const u=new URL(url);assert.equal(u.hostname,adapter==='seedance'?'ark.ap-southeast.bytepluses.com':'queue.fal.run');return fetch(`http://127.0.0.1:${port}${u.pathname}`,init); };
 const download={lookup:async()=>[{address:'8.8.8.8',family:4}],request:(options,callback)=>httpRequest({hostname:'127.0.0.1',port,path:options.path,method:'GET',headers:options.headers,signal:options.signal},callback)};
 const p=profile(adapter,model);
 f=await realCodeFixture(t,{profiles:[codexImageProfile,p],videoSeconds:model===veo?6:5,configuration:{viggleH3:false,seedance:adapter==='seedance',seedanceDownloadHosts:['media.example.test'],falVideo:adapter!=='seedance',falVideoDownloadHosts:['media.example.test']},
  transport:{seedanceFetch:apiFetch,falFetch:apiFetch,seedanceDownload:download,falDownload:download}});
 f.png=pngBytes(360,640);
 if(lastFrame){const path=join(f.root,'last-frame.jpg');await promisify(execFile)(tool('ffmpeg'),['-nostdin','-v','error','-f','lavfi','-i','color=s=360x640','-frames:v','1','-threads','1',path]);f.jpeg=readFileSync(path);}
 const due=f.due;f.due=()=>{due();for(const row of f.store.list('video_i2v_poll',f.project.id))f.store.put('video_i2v_poll',row.id,f.project.id,{...row,nextPollAt:0});};
 f.source=`export default async function(ctx){const image=await ctx.image({model:'${codexImageProfile.id}',prompt:'A stylized vertical landscape'});if(!image.ok)return;await ctx.video({model:'${p.id}',firstFrame:image.artifact,prompt:'Slow dolly',durationSeconds:${model===veo?6:5}});}`;
 return Object.assign(f,{state,profile:p,apiFetch});
}
const videoAttempt=f=>f.execution.attempts(f.project.id).find(a=>a.request.kind==='video');
async function submitted(f){await f.submit(f.source);for(let i=0;i<8&&!videoAttempt(f);i++)await f.tick();assert.ok(videoAttempt(f));}

test('Seedance loopback create → poll → download → normalize/ingest, owned last frame and reported cost',async t=>{
 const f=await fixture(t,{lastFrame:true});await f.submit(f.source);await f.finish();f.noGraph();
 assert.equal(f.state.creates,1);assert.equal(f.state.downloads,2);
 const attempt=videoAttempt(f);assert.equal(attempt.phase,'succeeded');assert.equal(f.plans.steps(f.project.id).find(s=>s.kind==='video').result.artifact.kind,'video');assert.equal(f.execution.liability(attempt.id),'charged');
 assert.equal(attempt.request.args.settings.ratio,'adaptive');assert.equal(f.state.bodies[0].ratio,'adaptive');
 assert.equal(f.store.get('code_plan_execution',attempt.id).priceMicros,'378000');
 const admission=resolveCodePlanProviderAdmission(f.store,attempt.request);assert.equal(admission.reservation.micros,'378000');
 const model=f.execution.models(f.project.id)[f.profile.id],record=f.store.get('code_plan_execution',attempt.id);
 assert.equal(modelPrice(model,record.normalizedInput,codePlanPriceFrame(f.store,f.project.id,record.normalizedInput)),'378000');
 assert.equal(seedancePriceMicros(seedanceModel,{resolution:'720p'},{seconds:5,firstFrame:{width:360,height:640}}),'378000');
 const terminal=f.store.get('video_i2v_terminal',attempt.id);assert.equal(terminal.result.completionTokens,108000);assert.equal(terminal.result.actualCostMicros,'378000');
 const clip=f.store.get('media_source',attempt.outputs.video.artifactId);assert.equal(clip.source.probe.video.frameRate,'24/1');assert.equal(clip.source.probe.video.frames,120);
 const frame=f.store.get('artifact',attempt.outputs.lastFrame.artifactId);assert.equal(frame.mimeType,'image/png');assert.equal(frame.width,360);assert.equal(frame.height,640);assert.equal(frame.fixture,false);
 const descriptions=modelDescriptions(f.execution.models(f.project.id));const row=descriptions.find(m=>m.id===f.profile.id);assert.equal(row.priceUnit,'input');assert.equal(row.priceUnknown,false);assert.equal(row.modelId,seedanceModel);
 await f.restart();await f.tick();assert.equal(f.state.creates,1);assert.equal(f.state.downloads,2);
});

for(const [name,model,expected] of [['Kling',kling,'420000'],['Veo',veo,'600000'],['Wan',wan,'500000']]) {
 test(`fal ${name} loopback queue → result → download → ingest with exact authority price`,async t=>{
  const f=await fixture(t,{adapter:'fal-video-i2v',model});await f.submit(f.source);await f.finish();f.noGraph();
  const attempt=videoAttempt(f);assert.equal(attempt.phase,'succeeded');assert.equal(f.state.creates,1);assert.equal(f.state.downloads,1);
  const row=f.store.get('code_plan_execution',attempt.id);assert.equal(row.priceMicros,expected);assert.equal(resolveCodePlanProviderAdmission(f.store,attempt.request).reservation.micros,expected);
  assert.equal(falVideoPriceMicros(model,{resolution:'720p'},model===veo?6:5),expected);
  const body=f.state.bodies[0];assert.equal(body.generate_audio ?? body.audio,false);assert.ok(body[model===veo?'image_url':'start_image_url'].startsWith('data:image/png;base64,'));
  assert.equal(body.duration,model===kling?'5':model===veo?'6s':5);
 });
}

for(const adapter of ['seedance','fal-video-i2v']) {
 test(`${adapter} lost create remains unknown across restart and lookup, retains liability and never resubmits`,async t=>{
  const f=await fixture(t,{adapter,model:adapter==='seedance'?seedanceModel:kling,mode:'lost'});await submitted(f);
  const id=videoAttempt(f).id;assert.equal(videoAttempt(f).phase,'submission_unknown');assert.equal(f.execution.liability(id),'reserved');
  await f.restart();for(let i=0;i<4;i++)await f.tick();assert.equal(videoAttempt(f).phase,'submission_unknown');assert.equal(f.state.creates,1);assert.equal(f.state.polls,0);assert.equal(f.execution.liability(id),'reserved');
  await f.execution.submit(id);assert.equal(f.state.creates,1);
 });
 test(`${adapter} real connect refusal is not submitted and releases liability`,async t=>{
  const f=await fixture(t,{adapter,model:adapter==='seedance'?seedanceModel:kling});
  const dead=createServer();dead.listen(0,'127.0.0.1');await once(dead,'listening');const port=dead.address().port;await new Promise(r=>dead.close(r));
  // Use the real runtime with a trusted fetch whose only destination is a refused loopback socket.
  // Restart rebuilds the registered bridge from this fixture's transport configuration.
  const { VideoI2vExecution }=await import('../dist/execution/video-i2v-execution.js');
  const { ExecutionRegistry }=await import('@openslate/providers');
  const { CodePlanExecution }=await import('../dist/code-plan/execution.js');
  const replacement=new VideoI2vExecution(adapter,{store:f.store,outputStore:f.mediaRuntime.outputStore,artifactRoot:join(f.root,'artifacts'),credentials:new EnvironmentMediaCredentials(()=> 'offline-fixture-key'),
   downloader:{},images:f.mediaRuntime.imageStore,fetch:()=>fetch(`http://127.0.0.1:${port}`)});
  const original=f.mediaRuntime.registry.forProfile(codexImageProfile);
  const execution=new CodePlanExecution(f.store,{provider:f.fake,registry:new ExecutionRegistry([f.fake,original,replacement]),catalog:f.mediaRuntime.providerCatalog,
   outputStore:f.mediaRuntime.outputStore,outputIngestor:f.mediaRuntime.outputIngestor,artifactDir:join(f.root,'artifacts')});
  // Exercise an independently composed runtime with the exact same catalog/authority.
  const { CodePlanRuntime }=await import('../dist/code-plan/index.js');const plans=new CodePlanRuntime(f.store,{execution});t.after(()=>plans.close());
  await plans.submit(f.project.id,{source:f.source,author:'user',basedOnVersion:null,invocationId:crypto.randomUUID()});
  for(let i=0;i<8;i++)await plans.tick();
  const attempt=execution.attempts(f.project.id).find(a=>a.request.kind==='video');assert.equal(attempt.phase,'failed');assert.equal(execution.liability(attempt.id),'released');assert.equal(f.state.creates,0);
  assert.match(attempt.failure.id,/CONNECT_NOT_SUBMITTED/);assert.equal(f.store.get('code_plan_execution',attempt.id).outcome.type,'rejected');
 });
}

test('Seedance face moderation has a plain no-retry error and releases accepted-task liability',async t=>{
 const f=await fixture(t,{mode:'moderation'});await f.submit(f.source);await f.finish();const attempt=videoAttempt(f);
 assert.equal(attempt.phase,'failed');assert.equal(attempt.failure.id,'SEEDANCE_FACE_REJECTED');assert.equal(attempt.failure.retryAllowed,false);assert.equal(f.execution.liability(attempt.id),'released');
 const failure=videoI2vFailure(f.store,attempt);assert.equal(failure.retry,'none');assert.match(failure.message,/realistic human face/);
 assert.match(f.plans.steps(f.project.id).find(s=>s.kind==='video').result.error.message,/stylized/);assert.equal(f.state.creates,1);assert.equal(f.state.downloads,0);
 await f.restart();await f.tick();assert.equal(f.execution.liability(attempt.id),'released');assert.equal(f.state.creates,1);
});

test('completed Seedance download failure recovers retained locators without another POST or poll',async t=>{
 const f=await fixture(t);f.state.downloadFail=true;await submitted(f);await f.tick();const id=videoAttempt(f).id;
 assert.ok(f.store.get('video_i2v_terminal',id));const polls=f.state.polls;await f.restart();f.state.downloadFail=false;await f.finish();
 assert.equal(videoAttempt(f).phase,'succeeded');assert.equal(f.state.creates,1);assert.equal(f.state.polls,polls);
});

test('input-dependent ceiling blocks dispatch before submit',async t=>{
 const f=await fixture(t);f.plans.setCeiling(f.project.id,{ceilingMicros:'1000000',by:'person'});
 await f.submit(f.source.replace('durationSeconds:5','durationSeconds:15'));for(let i=0;i<8;i++)await f.tick();
 assert.equal(f.plans.getRun(f.project.id).state,'paused_budget');assert.equal(f.state.creates,0);
 assert.equal(f.plans.steps(f.project.id).find(s=>s.kind==='video').priceMicros,'1134000');
});

test('profiles install with existing credentials; unknown models and unsupported settings fail closed; graph quotes ignore N2',()=>{
 const p=profile(),fal=profile('fal-video-i2v',kling);fal.id='fal-n2';
 const catalog=new InstalledProviderCatalog({configuration:{version:1,profiles:[p,fal].map(profile=>({label:profile.id,profile}))}});
 assert.ok(catalog.view().profiles.some(row=>row.id===p.id));
 for(const candidate of [{...fal,configuration:{model:'invented/model',settings:{resolution:'720p'}}},{...p,configuration:{model:seedanceModel,settings:{resolution:'1080p'}}}])
  assert.throws(()=>new InstalledProviderCatalog({configuration:{version:1,profiles:[{label:'invalid',profile:candidate}]}}),e=>e.code==='PROVIDER_CATALOG_INVALID');
 const config=readMediaExecutionConfiguration({OPENSLATE_MODELARK_API_KEY:'fixture',OPENSLATE_FAL_API_KEY:'fixture'});assert.equal(config.seedance,true);assert.equal(config.falVideo,true);
 assert.ok(config.seedanceDownloadHosts.includes('ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com'));
 assert.equal(new EnvironmentMediaCredentials(name=>name==='OPENSLATE_MODELARK_API_KEY'?'fixture':undefined).resolve('modelark-video'),'fixture');
 for(const video of [p,fal]){const lock={profiles:[video]};assert.equal(unitQuote(lock,'video'),undefined);assert.equal(quote(lock,[{imageComplete:true,videoComplete:false}],'confirmVideo'),undefined);}
 assert.equal(quote({profiles:[{...p,adapter:'minimax-h3',unitCostMicros:'1234'}]},[{imageComplete:true,videoComplete:false}],'confirmVideo').micros,'1234');
});

test('a later plan fences Seedance preparation before the create marker',async t=>{
 const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();
 const bridge=f.mediaRuntime.registry.forProfile(f.profile),frame=bridge.frame.bind(bridge);
 bridge.frame=async(...args)=>{const result=await frame(...args);entered.resolve();await release.promise;return result;};
 await f.submit(f.source);const running=(async()=>{for(let i=0;i<4;i++)await f.tick();})();await entered.promise;
 f.plans.submitPlan(f.project.id,'export default async function(ctx){await ctx.log("new plan");}');release.resolve();await running;await f.finish();
 const attempt=videoAttempt(f);assert.equal(f.state.creates,0);assert.equal(attempt.phase,'failed');assert.equal(f.execution.liability(attempt.id),'released');
});

test('reservation authority recomputes the price from owned dimensions and refuses a changed saved amount',async t=>{
 const f=await fixture(t,{mode:'pending'});await submitted(f);const attempt=videoAttempt(f),record=f.store.get('code_plan_execution',attempt.id);
 assert.equal(resolveCodePlanProviderAdmission(f.store,attempt.request).reservation.micros,'378000');
 f.store.db.prepare("UPDATE entities SET body=? WHERE kind='code_plan_execution' AND id=?").run(JSON.stringify({...record,priceMicros:'1'}),attempt.id);
 assert.throws(()=>resolveCodePlanProviderAdmission(f.store,attempt.request),e=>e.code==='CODE_PLAN_PROVIDER_AUTHORITY');
 f.store.db.prepare("UPDATE entities SET body=? WHERE kind='code_plan_execution' AND id=?").run(JSON.stringify(record),attempt.id);
});

test('fal moderation is a terminal no-retry failure with conservative charged liability',async t=>{
 const f=await fixture(t,{adapter:'fal-video-i2v',model:kling,mode:'moderation'});await f.submit(f.source);await f.finish();const attempt=videoAttempt(f);
 assert.equal(attempt.phase,'failed');assert.equal(attempt.failure.id,'FAL_VIDEO_MODERATION_REJECTED');assert.equal(videoI2vFailure(f.store,attempt).retry,'none');
 assert.equal(f.execution.liability(attempt.id),'charged');assert.equal(f.state.creates,1);assert.equal(f.state.downloads,0);
});

test('graph projects can snapshot installed N2 profiles without quotes or provider effects',async t=>{
 const f=await fixture(t);const catalog=f.mediaRuntime.providerCatalog;
 const project=f.service.createProject('Graph remains available',catalog.select(catalog.digest,[codexImageProfile.id,f.profile.id]));
 const { GenerationOverviewReader }=await import('../dist/generation-overview.js');
 assert.equal(f.service.snapshot(project.id).project.planMode,undefined);assert.deepEqual(new GenerationOverviewReader(f.service).read(project.id).scenes,[]);
 const lock=f.store.get('capability_lock',project.capabilityLockId);assert.equal(unitQuote(lock,'video'),undefined);assert.equal(f.state.creates,0);
});

test('a free Seedance task failure that is not a content refusal retries safely, and only twice on its own',async t=>{
 const f=await fixture(t,{mode:'transient'});await f.submit(f.source);
 for(let i=0;i<40&&f.state.creates<3;i++){await f.tick();await new Promise(resolve=>setTimeout(resolve,50));}
 await f.finish();
 assert.equal(f.state.creates,3,'the first try and two automatic retries');
 const step=f.plans.view(f.project.id).steps.find(row=>row.kind==='video');
 assert.deepEqual([step.state,step.error.retry,step.error.mayHaveCharged],['failed','safe',false]);
 assert.equal(f.plans.view(f.project.id).spentMicros,'0','free failures hold no liability');
});

test('a new code film can use every ready video model, the selected one first; a graph film keeps one',async t=>{
 const f=await realCodeFixture(t,{newFilm:true,profiles:[codexImageProfile,videoProfile,miniMaxProfile],selected:[codexImageProfile.id,videoProfile.id],
  configuration:{h3:true,h3DownloadHosts:['media.example.test']}});
 const lock=f.store.get('capability_lock',f.store.getProject(f.project.id).capabilityLockId);
 assert.deepEqual(lock.profiles.filter(row=>row.kind==='video').map(row=>row.id),['viggle-h3',miniMaxProfile.id]);
 const models=projectModels(f.store,f.project.id,f.mediaRuntime.providerCatalog);
 assert.ok(models['viggle-h3']&&models[miniMaxProfile.id]);assert.equal(models[videoProfile.id],undefined);
 const catalog=f.mediaRuntime.providerCatalog;
 const graph=f.service.createProject('Graph keeps one',catalog.select(catalog.digest,[codexImageProfile.id,videoProfile.id]));
 const graphLock=f.store.get('capability_lock',graph.capabilityLockId);
 assert.deepEqual(graphLock.profiles.filter(row=>row.kind==='video').map(row=>row.id),[videoProfile.id]);
});

for(const mode of ['reference','text','first_last_frame'])test(`Seedance ${mode} persists its exact input, price and mode and recovers after restart`,async t=>{
 const f=await fixture(t,{mode:'pending'});
 const source=f.source.replace('firstFrame:image.artifact',mode==='reference'?'references:[image.artifact,image.artifact]':mode==='text'?"aspectRatio:'9:16'":'firstFrame:image.artifact,lastFrame:image.artifact');
 await f.submit(source);for(let i=0;i<8&&!videoAttempt(f);i++)await f.tick();
 const attempt=videoAttempt(f);assert.ok(attempt);assert.equal(f.state.creates,1);
 const body=f.state.bodies[0];assert.deepEqual(body.content.map(item=>item.role??item.type),mode==='reference'?['text','reference_image','reference_image']:mode==='text'?['text']:['text','first_frame','last_frame']);
 const mapping=f.store.get('video_i2v_mapping',attempt.id);assert.equal(mapping.mode,mode);assert.equal(!!mapping.firstFrame,mode==='first_last_frame');
 if(mode==='reference')assert.deepEqual(mapping.references.map(image=>[image.width,image.height]),[[360,640],[360,640]]);
 assert.equal(resolveCodePlanProviderAdmission(f.store,attempt.request).reservation.micros,'378000');
 await f.restart();f.state.mode='complete';await f.finish();
 assert.equal(f.state.creates,1);assert.equal(f.execution.liability(attempt.id),'charged');assert.equal(f.plans.view(f.project.id).spentMicros,'378000');
 const detail=f.plans.stepDetail(f.project.id,f.plans.steps(f.project.id).find(step=>step.kind==='video').key);
 assert.equal(detail.mode,mode);assert.equal(detail.call.settings.mode,mode);assert.equal(detail.references?.length,mode==='reference'?2:undefined);
});
