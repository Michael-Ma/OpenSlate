import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { seedanceBody, seedancePriceMicros, seedanceOutputSize, SeedanceProvider, falVideoBody, falVideoPriceMicros, FalVideoProvider, isConnectPhaseFailure } from '../dist/index.js';
const seedance = 'dreamina-seedance-2-0-260128';
const mini = 'dreamina-seedance-2-0-mini-260615';
const fast = 'seedance-1-0-pro-fast-251015';
const kling = 'fal-ai/kling-video/v3/standard/image-to-video';
const veo = 'fal-ai/veo3.1/fast/image-to-video';
const wan = 'alibaba/wan-3.0/image-to-video';
const image = {width:360,height:640,bytes:Buffer.alloc(33)};
Buffer.from([137,80,78,71,13,10,26,10]).copy(image.bytes);image.bytes.writeUInt32BE(360,16);image.bytes.writeUInt32BE(640,20);
const settings = {resolution:'720p'};
const common = {prompt:'A slow camera move',seconds:5,settings,imageUrl:'data:image/png;base64,AAAA'};

test('Seedance adaptive 9:16 uses the published pixel grid and integer rational prices', () => {
 assert.deepEqual(seedanceOutputSize(seedance,settings,image),{width:720,height:1280});
 assert.equal(seedancePriceMicros(seedance,settings,{seconds:5,firstFrame:image}),'756000');
 assert.equal(seedancePriceMicros(mini,settings,{seconds:5,firstFrame:image}),'378000');
 assert.equal(seedancePriceMicros(fast,settings,{seconds:5,firstFrame:image}),'102960');
 assert.equal(seedancePriceMicros(seedance,{resolution:'1080p'},{seconds:5,firstFrame:image}),'1871100');
 assert.equal(seedancePriceMicros(seedance,settings,{completionTokens:108001}),'756007');
 assert.equal(seedancePriceMicros(mini,settings,{completionTokens:1}),'4');
 const body = JSON.parse(seedanceBody({model:seedance,prompt:'Move',seconds:5,settings,firstFrame:image,seed:12,lastFrame:image}));
 assert.equal(body.ratio,'adaptive');assert.equal(body.generate_audio,false);assert.equal(body.watermark,false);assert.equal(body.return_last_frame,true);
 assert.deepEqual(body.content.map(row => row.role ?? row.type),['text','first_frame','last_frame']);
});

test('Seedance refuses model, image, duration, mini resolution and fast last-frame/audio violations before submit', () => {
 for(const input of [{model:'invented'}, {seconds:3}, {settings:{resolution:'4k'}}, {firstFrame:{...image,width:299}}, {firstFrame:{...image,bytes:Buffer.alloc(30_000_000)}}])
  assert.throws(() => seedanceBody({model:seedance,prompt:'Move',seconds:5,settings,firstFrame:image,...input}));
 assert.throws(() => seedanceBody({model:fast,prompt:'Move',seconds:5,settings,firstFrame:image,lastFrame:image}));
 assert.throws(() => seedanceBody({model:fast,prompt:'Move',seconds:5,settings:{...settings,generateAudio:true},firstFrame:image}));
 assert.throws(() => seedancePriceMicros(mini,{resolution:'1080p'},{seconds:5,firstFrame:image}));
});

test('fal maps each model fields, legal durations and resolution/audio prices independently', () => {
 const k = JSON.parse(falVideoBody({...common,model:kling}));
 assert.equal(k.start_image_url,common.imageUrl);assert.equal(k.duration,'5');assert.equal(k.generate_audio,false);assert.equal(k.image_url,undefined);assert.equal(k.resolution,undefined);
 const v = JSON.parse(falVideoBody({...common,model:veo,seconds:6,settings:{resolution:'1080p',aspectRatio:'9:16',generateAudio:true}}));
 assert.equal(v.image_url,common.imageUrl);assert.equal(v.duration,'6s');assert.equal(v.aspect_ratio,'9:16');assert.equal(v.generate_audio,true);
 const w = JSON.parse(falVideoBody({...common,model:wan,settings:{resolution:'480p',aspectRatio:'9:16',generateAudio:true}}));
 assert.equal(w.start_image_url,common.imageUrl);assert.equal(w.duration,5);assert.equal(w.audio,true);assert.equal(w.generate_audio,undefined);
 assert.equal(falVideoPriceMicros(kling,settings,5),'420000');
 assert.equal(falVideoPriceMicros(veo,{resolution:'1080p',generateAudio:true},6),'900000');
 assert.equal(falVideoPriceMicros(veo,{resolution:'4k'},4),'1200000');
 assert.equal(falVideoPriceMicros(wan,{resolution:'1080p'},5),'1000000');
 assert.throws(() => falVideoBody({...common,model:'fal-ai/unknown'}));
 assert.throws(() => new FalVideoProvider({apiKey:'fixture',model:'fal-ai/unknown'}));
 assert.throws(() => falVideoPriceMicros(veo,settings,5));
 assert.throws(() => falVideoPriceMicros(kling,{...settings,generateAudio:true},5));
});

async function fake(t,handler) {
 const server = createServer(handler); server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve);}));
 const root = `http://127.0.0.1:${server.address().port}`;
 return {server,fetch:(url,init) => fetch(root+new URL(url).pathname,init)};
}
test('both transports distinguish a lost create reply from connect refusal and never retry', async t => {
 let creates=0;
 const f = await fake(t,(req,res) => {creates++;req.resume();req.on('end',()=>res.destroy());});
 const s = new SeedanceProvider({apiKey:'fixture',fetch:f.fetch});
 const fal = new FalVideoProvider({apiKey:'fixture',fetch:f.fetch,model:kling});
 assert.equal((await s.submit('{}')).kind,'unknown');
 const { createHash } = await import('node:crypto');
 assert.equal((await fal.submit('{}',createHash('sha256').update('{}').digest('hex'))).kind,'unknown');
 assert.equal(creates,2);
 const dead = createServer();dead.listen(0,'127.0.0.1');await once(dead,'listening');const port=dead.address().port;await new Promise(r=>dead.close(r));
 const refused = () => fetch(`http://127.0.0.1:${port}`);
 assert.equal((await new SeedanceProvider({apiKey:'fixture',fetch:refused}).submit('{}')).kind,'rejected');
 assert.equal((await new FalVideoProvider({apiKey:'fixture',fetch:refused,model:kling}).submit('{}',createHash('sha256').update('{}').digest('hex'))).kind,'rejected');
 const fetchFailed = cause => new TypeError('fetch failed',{cause});
 assert.equal(isConnectPhaseFailure(fetchFailed(Object.assign(new Error(),{code:'ECONNRESET',syscall:'read'}))),false);
 assert.equal(isConnectPhaseFailure(fetchFailed(Object.assign(new Error(),{code:'ETIMEDOUT',syscall:'connect'}))),true);
 assert.equal(isConnectPhaseFailure(fetchFailed(Object.assign(new Error(),{code:'ETIMEDOUT',syscall:'read'}))),false,'a read timeout may follow a delivered request');
 assert.equal(isConnectPhaseFailure(Object.assign(new Error(),{code:'ETIMEDOUT',syscall:'read'})),false);
});

test('Seedance polls queued/running/success/failed, reports token usage, cancels only by known id', async t => {
 let status='queued',cancel=0;
 const f = await fake(t,(req,res) => {
  res.setHeader('content-type','application/json');
  if(req.method==='DELETE'){cancel++;res.statusCode=204;res.end();return;}
  res.end(JSON.stringify({id:'task-1',status,content:{video_url:'https://example.test/clip.mp4',last_frame_url:'https://example.test/frame.jpg'},usage:{completion_tokens:108000},error:{code:'InvalidParameter.RealPersonFace'}}));
 });
 const s=new SeedanceProvider({apiKey:'fixture',fetch:f.fetch});
 for(const state of ['queued','running']){status=state;assert.equal((await s.poll('task-1')).kind,'pending');}
 status='succeeded';const done=await s.poll('task-1');assert.equal(done.kind,'completed');assert.equal(done.completionTokens,108000);
 status='failed';const failed=await s.poll('task-1');assert.equal(failed.code,'SEEDANCE_FACE_REJECTED');assert.equal(failed.retry,'none');assert.equal(failed.free,true);
 assert.equal(await s.cancelQueued('task-1'),true);assert.equal(cancel,1);await assert.rejects(s.cancelQueued('../task'));
});

test('Seedance 2.x reference and text bodies select exclusive modes and price from the first reference shape',()=>{
 for(const model of [seedance,mini]){
  const body=JSON.parse(seedanceBody({model,prompt:'Orbit around a stylized city',seconds:6,settings,references:[image,image]}));
  assert.deepEqual(body.content.map(row=>row.role??row.type),['text','reference_image','reference_image']);
  assert.equal(seedancePriceMicros(model,settings,{seconds:6,firstFrame:image}),seedancePriceMicros(model,{...settings,ratio:'9:16'},{seconds:6}));
  const text=JSON.parse(seedanceBody({model,prompt:'A crane shot of a city',seconds:6,settings:{...settings,ratio:'16:9'}}));
  assert.deepEqual(text.content,[{type:'text',text:'A crane shot of a city'}]);
  for(const patch of [{references:[]},{references:Array(10).fill(image)},{references:[image],firstFrame:image},{lastFrame:image},{references:[image],lastFrame:image}])
   assert.throws(()=>seedanceBody({model,prompt:'Orbit',seconds:6,settings,...patch}));
  assert.throws(()=>seedanceBody({model,prompt:'Orbit',seconds:6,settings}));
 }
 for(const input of [{references:[image]},{}])assert.throws(()=>seedanceBody({model:fast,prompt:'Orbit',seconds:6,settings:{...settings,ratio:'16:9'},...input}));
});
