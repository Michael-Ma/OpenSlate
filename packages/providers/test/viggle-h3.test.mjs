import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { ViggleH3Provider, ViggleH3ValidationError, describeViggleH3Request, viggleH3MetadataDigest, VIGGLE_H3_LIMITS, validateViggleH3Settings } from '../dist/viggle-h3.js';
const key = 'test_viggle_private_credential', sha = x => createHash('sha256').update(x).digest('hex');
const base = () => ({ prompt:'A paper airplane glides through a sunlit room.',quality:'low',durationSeconds:3,resolution:'480p',aspectRatio:'16:9',watermark:false });
const json = (body,status=200,headers={}) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','x-request-id':'req_trace',...headers}});
const accepted = () => json({id:'vid_123abc',status:'queued',progress:null,created_at:'2026-09-13T10:00:00Z'});
function crc(bytes) { let n=0xffffffff; for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0; }
function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;}
function image(r=180) { const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,r,0,0]))),chunk('IEND',Buffer.alloc(0))]);
  return {bytes,sha256:sha(bytes),byteLength:bytes.length,width:1,height:1,mediaType:'image/png'}; }
function latch(){let release;const promise=new Promise(r=>release=r);return {promise,release};}
const unknown = result => assert.equal(result.kind,'unknown',JSON.stringify(result));
const error = (code='INVALID_REQUEST',extra={}) => ({error:{code,message:'redacted prompt and secret detail',retryable:false,request_id:'req_error',details:{sensitive:true},remediation:{action:'correct_request',retry_after_ms:null}},...extra});
function checkLocal(result,code){assert.equal(result.kind,'rejected');assert.equal(result.source,'local');assert.equal(result.certainty,'not_accepted');if(code)assert.equal(result.error.code,code);}

test('credential-free description separates metadata from deterministic multipart identity',async()=>{
 const request={...base(),firstFrame:image(),lastFrame:image(90),seed:0},description=describeViggleH3Request(request);
 const {requestDigest,bodySha256,bodyByteLength,...metadata}=description;
 assert.equal(viggleH3MetadataDigest(request.prompt,metadata),requestDigest);assert.equal(description.mode,'first_last_frame');
 assert.equal(Object.isFrozen(description),true);assert.equal(Object.isFrozen(description.firstFrame),true);assert.equal(Object.isFrozen(description.lastFrame),true);
 assert.equal(description.firstFrame.sha256,request.firstFrame.sha256);assert.equal(JSON.stringify(description).includes(request.prompt),false);
 let calls=0;const provider=new ViggleH3Provider({apiKey:key,fetch:async(url,init)=>{calls++;assert.equal(url,'https://apis.viggle.ai/v1/videos');assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,`Bearer ${key}`);
   assert.equal(sha(init.body),bodySha256);assert.equal(init.body.length,bodyByteLength);
   const wire=new Request(url,{method:'POST',headers:init.headers,body:init.body});const form=await wire.formData();
   assert.deepEqual([...form.keys()],['prompt','quality','duration_s','resolution','aspect_ratio','seed','watermark','first_frame_image','last_frame_image']);
   assert.equal(form.get('prompt'),request.prompt);assert.equal(form.get('duration_s'),'3');assert.equal(form.get('seed'),'0');assert.equal(form.get('watermark'),'false');
   for(const [field,slot] of [['first_frame_image','firstFrame'],['last_frame_image','lastFrame']]){assert.equal(form.get(field).type,'image/png');assert.equal(sha(new Uint8Array(await form.get(field).arrayBuffer())),request[slot].sha256);}
   return accepted();}});
 const result=await provider.submit(request,{expectedRequestDigest:requestDigest,expectedBodySha256:bodySha256});assert.equal(result.kind,'accepted');assert.equal(result.taskId,'vid_123abc');assert.deepEqual(result.receipt,{requestId:'req_trace',httpStatus:200});assert.equal(calls,1);
});

test('text and first-frame modes omit every other mode-selecting field',async()=>{
 for(const request of [base(),{...base(),firstFrame:image()}]){const description=describeViggleH3Request(request);let calls=0;
  const p=new ViggleH3Provider({apiKey:key,fetch:async(url,init)=>{calls++;const form=await new Request(url,{method:'POST',headers:init.headers,body:init.body}).formData();
   assert.deepEqual([...form.keys()],['prompt','quality','duration_s','resolution','aspect_ratio','watermark',...(request.firstFrame?['first_frame_image']:[])]);return accepted();}});
  assert.equal(description.mode,request.firstFrame?'first_frame':'text');assert.equal((await p.submit(request)).kind,'accepted');assert.equal(calls,1);}
});

test('golden semantic and multipart hashes remain stable across property insertion order',()=>{
 const request=base(),d=describeViggleH3Request(request);assert.deepEqual(describeViggleH3Request(Object.fromEntries(Object.entries(request).reverse())),d);
 assert.equal(d.requestDigest,'2808c7eadc434c5f536d5e87704b2cc0fe0cb2f8a4e6191afb3124d15794f379');assert.equal(d.bodySha256,'8ff4a4d47237d37e76ff0ec67e16184ed2a6dda71a5360534a22c4a9f4cba212');assert.equal(d.bodyByteLength,1005);
});

test('all explicit quality, resolution, ratio and boundary durations preserve requested values',()=>{
 for(const quality of ['low','high'])for(const resolution of ['480p','768p','1080p'])for(const aspectRatio of ['16:9','9:16','1:1','4:3','3:4','21:9'])for(const durationSeconds of [3,3.5,15]){
  const d=describeViggleH3Request({...base(),quality,resolution,aspectRatio,durationSeconds});assert.equal(d.quality,quality);assert.equal(d.resolution,resolution);assert.equal(d.aspectRatio,aspectRatio);assert.equal(d.durationSeconds,durationSeconds);}
});

test('unsupported extra modes and invalid settings are definite local failures with zero HTTP',async()=>{
 let calls=0;const p=new ViggleH3Provider({apiKey:key,fetch:async()=>{calls++;return accepted();}});
 const inputs=[null,[],{...base(),model:'MiniMax-H3'},{...base(),first_frame_image_url:'https://example.com/a.png'},
 {...base(),reference_image:[]},{...base(),quality:'fast'},{...base(),durationSeconds:2.99},{...base(),durationSeconds:15.1},
 {...base(),durationSeconds:Infinity},{...base(),resolution:'2K'},{...base(),aspectRatio:'adaptive'},{...base(),watermark:true},
 {...base(),seed:-1},{...base(),seed:Number.MAX_SAFE_INTEGER+1},{...base(),lastFrame:image()},{...base(),firstFrame:null},
 {...base(),prompt:''},{...base(),prompt:'é'.repeat(VIGGLE_H3_LIMITS.promptBytes)},{...base(),prompt:'broken\ud800'}];
 for(const input of inputs){assert.throws(()=>describeViggleH3Request(input),ViggleH3ValidationError);checkLocal(await p.submit(input));}assert.equal(calls,0);
});

test('own plain request, image, constructor, call and metadata data never invokes getters or coercion',async()=>{
 let touched=0;const getter=()=>{touched++;throw Error('secret');};let calls=0;const p=new ViggleH3Provider({apiKey:key,fetch:async()=>{calls++;return accepted();}});
 const badRequest=Object.defineProperty(base(),'prompt',{get:getter});checkLocal(await p.submit(badRequest));
 const badImage=Object.defineProperty(image(),'sha256',{get:getter});checkLocal(await p.submit({...base(),firstFrame:badImage}));
 checkLocal(await p.submit({...base(),quality:{toString:getter}}));checkLocal(await p.submit(base(),Object.defineProperty({},'signal',{get:getter})));
 assert.throws(()=>new ViggleH3Provider(Object.defineProperty({},'apiKey',{get:getter})),ViggleH3ValidationError);
 const {requestDigest:_a,bodySha256:_b,bodyByteLength:_c,...d}=describeViggleH3Request(base());assert.throws(()=>viggleH3MetadataDigest(base().prompt,Object.defineProperty(d,'mode',{get:getter})),ViggleH3ValidationError);
 for(const input of [Object.assign(Object.create({prompt:'inherited'}),base()),{...base(),[Symbol('x')]:1}])checkLocal(await p.submit(input));assert.equal(touched,0);assert.equal(calls,0);
});

test('PNG complete bytes, hash, geometry and real non-shared typed array are required',async()=>{
 let calls=0;const p=new ViggleH3Provider({apiKey:key,fetch:async()=>{calls++;return accepted();}}),good=image();
 const detached=new Uint8Array(good.bytes);structuredClone(detached.buffer,{transfer:[detached.buffer]});
 const bad=[{...good,sha256:'a'.repeat(64)},{...good,width:2},{...good,byteLength:good.byteLength+1},{...good,mediaType:'image/jpeg'},
 {...good,bytes:detached},{...good,bytes:Object.create(Uint8Array.prototype)},{...good,bytes:new Uint8Array(new SharedArrayBuffer(good.byteLength))}];
 for(const bytes of [good.bytes.subarray(0,33),Buffer.concat([good.bytes,Buffer.from('tail')]),Buffer.alloc(good.byteLength)])bad.push({...good,bytes,byteLength:bytes.length,sha256:sha(bytes)});
 for(const firstFrame of bad)checkLocal(await p.submit({...base(),firstFrame}),'VIGGLE_H3_IMAGE_INVALID');assert.equal(calls,0);
});

test('PNG chunk tags reject high-bit ASCII aliases before any HTTP',async()=>{
 let calls=0;const provider=new ViggleH3Provider({apiKey:key,fetch:async()=>{calls++;return accepted();}});
 for(const selected of [['IHDR'],['IDAT'],['IEND'],['IHDR','IDAT','IEND']]){
  const firstFrame=image();
  for(let offset=8;offset<firstFrame.bytes.length;){
   const length=firstFrame.bytes.readUInt32BE(offset),type=firstFrame.bytes.toString('latin1',offset+4,offset+8);
   if(selected.includes(type)){
    for(let i=offset+4;i<offset+8;i++)firstFrame.bytes[i]|=0x80;
    firstFrame.bytes.writeUInt32BE(crc(firstFrame.bytes.subarray(offset+4,offset+8+length)),offset+8+length);
   }
   offset+=length+12;
  }
  firstFrame.sha256=sha(firstFrame.bytes);
  assert.throws(()=>describeViggleH3Request({...base(),firstFrame}),{code:'VIGGLE_H3_IMAGE_INVALID'});
  checkLocal(await provider.submit({...base(),firstFrame}),'VIGGLE_H3_IMAGE_INVALID');
 }
 assert.equal(calls,0);
});

test('original constructor, request byte storage and options are isolated before first await',async()=>{
 const entered=latch(),release=latch();const request={...base(),firstFrame:image()},description=describeViggleH3Request(request),original=new AbortController(),replacement=new AbortController();
 const config={apiKey:key,fetch:async(_url,init)=>{entered.release(init);await release.promise;return accepted();}};
 const p=new ViggleH3Provider(config),options={signal:original.signal,expectedBodySha256:description.bodySha256,expectedRequestDigest:description.requestDigest};
 const pending=p.submit(request,options),init=await entered.promise;config.apiKey='changed';config.fetch=()=>{throw Error('wrong fetch');};options.signal=replacement.signal;options.expectedBodySha256='x';request.prompt='changed';request.firstFrame.bytes.fill(0);
 assert.equal(sha(init.body),description.bodySha256);replacement.abort();release.release();assert.equal((await pending).kind,'accepted');
});

test('original abort wins even after caller replaces options signal',async()=>{
 const entered=latch();let calls=0;const original=new AbortController(),options={signal:original.signal};
 const p=new ViggleH3Provider({apiKey:key,timeoutMs:1000,fetch:async()=>{calls++;entered.release();return new Promise(()=>{});}});
 const pending=p.submit(base(),options);await entered.promise;options.signal=new AbortController().signal;original.abort();const result=await pending;
 unknown(result);assert.equal(result.error.code,'VIGGLE_H3_CALL_ABORTED');assert.equal(calls,1);
});

test('wrong expected digests and initial cancellation never dispatch',async()=>{
 let calls=0;const p=new ViggleH3Provider({apiKey:key,fetch:async()=>{calls++;return accepted();}}),abort=new AbortController();abort.abort();
 checkLocal(await p.submit(base(),{expectedRequestDigest:'a'.repeat(64)}),'VIGGLE_H3_REQUEST_DIGEST_MISMATCH');
 checkLocal(await p.submit(base(),{expectedBodySha256:'b'.repeat(64)}),'VIGGLE_H3_BODY_DIGEST_MISMATCH');checkLocal(await p.submit(base(),{signal:abort.signal}),'VIGGLE_H3_ABORTED_BEFORE_DISPATCH');assert.equal(calls,0);
});

test('only an intact known pre-acceptance rejection envelope is definite',async()=>{
 for(const [status,code]of [[400,'INVALID_REQUEST'],[401,'INVALID_CREDENTIAL'],[402,'INSUFFICIENT_CREDITS'],[403,'FORBIDDEN'],[422,'CONTENT_POLICY_VIOLATION'],[429,'RATE_LIMITED']]){
  let calls=0;const p=new ViggleH3Provider({apiKey:key,fetch:async()=>{calls++;return json(error(code),status,{'retry-after':'3'});}});const r=await p.submit(base());
  assert.equal(r.kind,'rejected');assert.equal(r.source,'provider');assert.equal(r.error.code,code);assert.equal(r.error.retryAfterMs,3000);assert.equal(JSON.stringify(r).includes('secret'),false);assert.equal(calls,1);}
});

test('5xx, missing error shape, false success and contradictory responses remain unknown once',async()=>{
 const responses=[()=>json(error('INTERNAL_ERROR'),500),()=>json(error('SERVICE_BUSY'),503),()=>json(error('INVALID_REQUEST',{id:'vid_accepted'}),400),
 ()=>json({error:{code:'INVALID_REQUEST'}},400),()=>json(error('NEW_CODE'),400),()=>json({id:'vid_123abc',status:'ready',video_url:'https://example.com/x.mp4'}),
 ()=>json({id:'anim_123abc',status:'queued'}),()=>json({id:'vid_123abc',status:'queued',error:{code:'INTERNAL_ERROR'}}),()=>json({id:'vid_123abc',status:'queued',video_url:'https://example.com/x.mp4'}),
 ()=>new Response('bad html',{status:502}),()=>json([]),()=>json({id:'vid_123abc',status:'processing'})];
 for(const response of responses){let calls=0;const p=new ViggleH3Provider({apiKey:key,fetch:async()=>{calls++;return response();}});unknown(await p.submit(base()));assert.equal(calls,1);}
});

test('poll maps exact H3 lifecycle with no resubmission or invented model measurements',async()=>{
 for(const status of ['queued','processing','ready','failed','cancelled']){let calls=0;const p=new ViggleH3Provider({apiKey:key,fetch:async(url,init)=>{
   calls++;assert.equal(url,'https://apis.viggle.ai/v1/videos/vid_123abc');assert.equal(init.method,'GET');assert.equal(init.body,undefined);
   return json({id:'vid_123abc',status,stage:null,alpha_url:null,video_url:status==='ready'?'https://media.example/v.mp4?sig=protected':null,
    error:status==='failed'?error('TASK_FAILED').error:null,seed:4271960385017522688});}});
  const result=await p.poll('vid_123abc');assert.equal(result.kind,{queued:'pending',processing:'pending',ready:'completed',failed:'failed',cancelled:'cancelled'}[status]);
  if(status==='ready'){assert.equal(result.reportedModel,null);assert.deepEqual(result.reported,{seed:null});assert.equal(result.output.expiresAt,null);}assert.equal(calls,1);}
});

test('poll rejects wrong IDs, incomplete or conflicting terminal output and unsafe URLs',async()=>{
 const body={id:'vid_123abc',status:'ready',video_url:'https://media.example/x.mp4',error:null,stage:null,alpha_url:null};
 const bad=[{...body,id:'vid_foreign'},{...body,status:'succeeded'},{...body,error:{code:'TASK_FAILED'}},{...body,stage:'rendering'},{...body,alpha_url:'https://x.invalid/mask'},
 ...['http://media.example/x','https://user:pass@media.example/x','https://media.example/x#frag','https://media.example/x?q='+key,'https://media.example/x\n'].map(video_url=>({...body,video_url})),
 {...body,status:'queued'},{...body,status:'failed'}];
 for(const value of bad){const p=new ViggleH3Provider({apiKey:key,fetch:async()=>json(value)});unknown(await p.poll('vid_123abc'));}
 let calls=0;const p=new ViggleH3Provider({apiKey:key,fetch:async()=>{calls++;return json(body);}});
 for(const id of ['anim_123','render_123','vid_x/../v','',{},'vid_'+key])unknown(await p.poll(id));unknown(await p.reconcile({}));assert.equal(calls,0);
 const completed=await p.reconcile({taskId:'vid_123abc'});assert.equal(completed.kind,'completed');assert.equal(calls,1);
});

test('safe trace IDs survive while keys/content in headers and failures never escape',async()=>{
 const p=new ViggleH3Provider({apiKey:key,fetch:async()=>json(error('INVALID_REQUEST'),400,{'x-request-id':key})});const result=await p.submit(base());
 assert.equal(result.receipt.requestId,'req_error');assert.equal(JSON.stringify(result).includes(key),false);assert.equal(JSON.stringify(result).includes('redacted prompt'),false);
 const malformed=new ViggleH3Provider({apiKey:key,fetch:async()=>{throw Error('api key '+key+' prompt content');}});unknown(await malformed.submit(base()));assert.equal(JSON.stringify(await malformed.submit(base())).includes(key),false);
});

test('bounded responses reject declared and observed oversized data, invalid UTF8 and redirects',async()=>{
 let cancelled=0;const sources=[()=>json({id:'vid_123abc',status:'queued'},200,{'content-length':'999999999'}),
 ()=>new Response(new Uint8Array(1025),{headers:{'content-type':'application/json'}}),()=>new Response(Uint8Array.of(255),{headers:{'content-type':'application/json'}}),
 ()=>new Response('{}',{status:302,headers:{location:'https://foreign.example','content-type':'application/json'}}),()=>json({},200,{'content-length':'invalid'})];
 for(const source of sources){const p=new ViggleH3Provider({apiKey:key,maxResponseBytes:1024,fetch:async()=>source()});unknown(await p.submit(base()));}
 const p=new ViggleH3Provider({apiKey:key,maxResponseBytes:5,fetch:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(6));},cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}})});unknown(await p.submit(base()));assert.ok(cancelled>=1);
});

test('byte-at-a-time responses preserve body and cannot starve the deadline',async()=>{
 const bytes=Buffer.from(JSON.stringify({id:'vid_123abc',status:'queued'}));let i=0;
 const p=new ViggleH3Provider({apiKey:key,fetch:async()=>new Response(new ReadableStream({pull(c){if(i<bytes.length)c.enqueue(bytes.subarray(i,++i));else c.close();}}),{headers:{'content-type':'application/json'}})});
 assert.equal((await p.submit(base())).kind,'accepted');let canceled=0;
 const endless=new ViggleH3Provider({apiKey:key,timeoutMs:5,fetch:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(0));},cancel(){canceled++;}}),{headers:{'content-type':'application/json'}})});
 const result=await endless.submit(base());unknown(result);assert.equal(result.error.code,'VIGGLE_H3_CALL_TIMEOUT');assert.equal(canceled,1);
});

test('ignored late fetch is canceled without mutating the returned unknown receipt',async()=>{
 const gate=latch();let canceled=0,calls=0;const p=new ViggleH3Provider({apiKey:key,timeoutMs:5,fetch:async()=>{calls++;await gate.promise;return new Response(new ReadableStream({cancel(){canceled++;return new Promise(()=>{});}}),{headers:{'content-type':'application/json','x-request-id':'req_late'}});}});
 const result=await p.submit(base());unknown(result);assert.equal(result.error.code,'VIGGLE_H3_CALL_TIMEOUT');const saved=JSON.stringify(result);gate.release();await delay(15);assert.equal(canceled,1);assert.equal(JSON.stringify(result),saved);assert.equal(calls,1);
});

test('complete parsed acceptance survives original cancellation and deadline during never-settling cleanup',async()=>{
 for(const originalAbort of [false,true]){let canceled=0;const controller=new AbortController(),started=latch();let read=false;
  const response={status:200,redirected:false,headers:new Headers({'content-type':'application/json'}),body:{getReader(){return {async read(){if(!read){read=true;return {done:false,value:Buffer.from('{"id":"vid_123abc","status":"queued"}')};}return {done:true};},cancel(){canceled++;started.release();return new Promise(()=>{});},releaseLock(){}};}}};
  const p=new ViggleH3Provider({apiKey:key,timeoutMs:20,fetch:async()=>response}),pending=p.submit(base(),{signal:controller.signal});await started.promise;if(originalAbort)controller.abort();const result=await pending;
  assert.equal(result.kind,'accepted');assert.equal(result.taskId,'vid_123abc');assert.equal(canceled,1);}
});

test('late ignored reader completion after abort cannot produce acceptance or change receipt',async()=>{
 const gate=latch(),started=latch(),controller=new AbortController();let cancel=0;
 const response={status:200,redirected:false,headers:new Headers({'content-type':'application/json','x-request-id':'req_before_abort'}),body:{getReader(){return {async read(){started.release();await gate.promise;return {done:false,value:Buffer.from('{"id":"vid_123abc","status":"queued"}')};},async cancel(){cancel++;},releaseLock(){}};}}};
 const p=new ViggleH3Provider({apiKey:key,fetch:async()=>response}),pending=p.submit(base(),{signal:controller.signal});await started.promise;controller.abort();const result=await pending;unknown(result);const saved=JSON.stringify(result);gate.release();await delay(10);assert.equal(JSON.stringify(result),saved);assert.equal(cancel,1);
});

test('construction and invalid options never call HTTP or leak credentials',()=>{
 let touched=0;const fetch=()=>{touched++;throw Error('no');};
 for(const options of [{apiKey:''},{apiKey:'has space'},{apiKey:key,timeoutMs:0},{apiKey:key,maxResponseBytes:VIGGLE_H3_LIMITS.responseBytes+1},{apiKey:key,fetch:3},{apiKey:key,baseUrl:'https://other.example'}])assert.throws(()=>new ViggleH3Provider(options),ViggleH3ValidationError);
 new ViggleH3Provider({apiKey:key,fetch});assert.equal(touched,0);
});


test('complete poll evidence survives an abort queued during final reader cleanup',async()=>{
 const controller=new AbortController();let read=false;
 const response={status:200,redirected:false,headers:new Headers({'content-type':'application/json'}),body:{getReader(){return {async read(){if(!read){read=true;return {done:false,value:Buffer.from('{"id":"vid_123abc","status":"ready","video_url":"https://media.example/x.mp4","error":null}')};}return {done:true};},async cancel(){queueMicrotask(()=>controller.abort());},releaseLock(){}};}}};
 const p=new ViggleH3Provider({apiKey:key,fetch:async()=>response});const result=await p.poll('vid_123abc',{signal:controller.signal});assert.equal(controller.signal.aborted,true);assert.equal(result.kind,'completed');assert.equal(result.taskId,'vid_123abc');
});

test('pure profile settings validator rejects unsupported keys without request fabrication or accessors',()=>{
 validateViggleH3Settings({quality:'low',resolution:'480p',aspectRatio:'16:9'});let touched=0;
 for(const input of [{quality:'low',resolution:'480p',aspectRatio:'16:9',seed:0},{quality:'other',resolution:'480p',aspectRatio:'16:9'},null,
 Object.defineProperty({resolution:'480p',aspectRatio:'16:9'},'quality',{get(){touched++;return 'low';}})])assert.throws(()=>validateViggleH3Settings(input),ViggleH3ValidationError);
 assert.equal(touched,0);
});


test('already-aborted known-job polling is local-only, while a safe reported seed remains exact',async()=>{
 let calls=0;const p=new ViggleH3Provider({apiKey:key,fetch:async()=>{calls++;return json({id:'vid_123abc',status:'ready',video_url:'https://media.example/x.mp4',seed:Number.MAX_SAFE_INTEGER});}});
 const controller=new AbortController();controller.abort();const stopped=await p.poll('vid_123abc',{signal:controller.signal});unknown(stopped);assert.equal(stopped.error.code,'VIGGLE_H3_CALL_ABORTED');assert.equal(calls,0);
 const result=await p.poll('vid_123abc');assert.equal(result.kind,'completed');assert.equal(result.reported.seed,Number.MAX_SAFE_INTEGER);assert.equal(calls,1);
});
