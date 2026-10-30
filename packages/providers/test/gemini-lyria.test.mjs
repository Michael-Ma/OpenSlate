import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { GeminiLyriaAdapter, lyriaBody, parseLyriaResponse, LYRIA_LIMITS, GEMINI_API_ORIGIN } from '../dist/index.js';
const request = { prompt: 'Warm piano, calm mood, slow tempo', durationSeconds: 20 };
const reply = (mime = 'audio/mpeg') => ({ steps: [{ type:'model_output', content:[{type:'text',text:'[[A0]]'}] },
 { type:'model_output', content:[{type:'audio',mime_type:mime,data:Buffer.from('synthetic offline audio').toString('base64')}] }] });
async function loopback(t, handler) {
 const server = createServer(handler); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve);}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 return (url,init) => { assert.equal(url,`${GEMINI_API_ORIGIN}/v1beta/interactions`);return fetch(`${origin}/interactions`,init); };
}
for(const mime of ['audio/mpeg','audio/wav']) test(`Lyria loopback ${mime} ignores preceding text and uses the bounded Gemini JSON client`,async t=>{
 let calls=0;
 const transport = await loopback(t,async(req,res)=>{
  calls++;assert.equal(req.method,'POST');assert.equal(req.url,'/interactions');assert.equal(req.headers['x-goog-api-key'],'synthetic-key');
  let body='';for await(const chunk of req)body+=chunk;
  const sent=JSON.parse(body);assert.equal(sent.model,'lyria-3.5');assert.deepEqual(sent.response_format,{type:'audio'});
  assert.match(sent.input,/20 seconds long, ending with a clean final chord/);assert.match(sent.input,/Instrumental, no vocals/);
  res.setHeader('content-type','application/json');res.end(JSON.stringify(reply(mime)));
 });
 const adapter=new GeminiLyriaAdapter({apiKey:'synthetic-key',fetch:transport});
 const result=await adapter.generate(request);assert.equal(result.kind,'completed');assert.equal(result.mimeType,mime);assert.equal(calls,1);
 assert.equal(Buffer.from(result.bytes).toString(),'synthetic offline audio');assert.ok(LYRIA_LIMITS.responseBytes>4*1024*1024);assert.ok(LYRIA_LIMITS.timeoutMs>=240000);
});
test('music prompt options validate before dispatch, never introduce seeds, and false permits vocals',()=>{
 assert.doesNotMatch(JSON.parse(lyriaBody({...request,instrumental:false})).input,/no vocals/);
 for(const patch of [{prompt:''},{durationSeconds:0},{durationSeconds:361},{durationSeconds:NaN},{instrumental:'yes'},{seed:1}])
  assert.throws(()=>lyriaBody({...request,...patch}));
});
test('no audio, duplicate blocks and invalid base64 fail clearly without inventing media',()=>{
 assert.deepEqual(parseLyriaResponse(200,{steps:[{type:'model_output',content:[{type:'text',text:'only lyrics'}]}]}),{kind:'unknown',code:'LYRIA_AUDIO_MISSING'});
 const multiple=reply();multiple.steps.push(multiple.steps[1]);assert.equal(parseLyriaResponse(200,multiple).code,'LYRIA_AUDIO_MISSING');
 const bad=reply();bad.steps[1].content[0].data='*';assert.equal(parseLyriaResponse(200,bad).code,'LYRIA_AUDIO_INVALID');
});
for(const [status,body,code,retry] of [
 [400,{error:{message:'Blocked by safety filters'}},'LYRIA_SAFETY_REFUSAL','none'],
 [200,{steps:[{type:'model_output',content:[{type:'refusal',text:'blocked'}]}]},'LYRIA_SAFETY_REFUSAL','none'],
 [429,{error:{message:'busy'}},'LYRIA_BUSY','safe'],
 [403,{error:{message:'billing required'}},'LYRIA_KEY_BILLING_REQUIRED','none'],
 [401,{},'LYRIA_KEY_BILLING_REQUIRED','none'],
 [400,{error:{message:'Free tier is not available'}},'LYRIA_KEY_BILLING_REQUIRED','none']])
 test(`Lyria loopback ${status} ${code} refuses without a paid retry`,async t=>{
  const transport=await loopback(t,(_req,res)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(body));});
  const result=await new GeminiLyriaAdapter({apiKey:'synthetic-key',fetch:transport}).generate(request);
  assert.deepEqual(result,{kind:'rejected',code,retry});assert.ok(!JSON.stringify(result).includes('synthetic-key'));
 });
test('proven connect failures are not submitted, but post-send transport loss is unknown and never retried',async t=>{
 let calls=0;
 const transport=await loopback(t,async(req)=>{for await(const _ of req){}calls++;req.socket.destroy();});
 assert.deepEqual(await new GeminiLyriaAdapter({apiKey:'synthetic-key',fetch:transport}).generate(request),{kind:'unknown',code:'LYRIA_TRANSPORT_LOSS'});
 assert.equal(calls,1);
 const connect=new GeminiLyriaAdapter({apiKey:'synthetic-key',fetch:async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error(),{code:'ECONNREFUSED'})});}});
 assert.deepEqual(await connect.generate(request),{kind:'rejected',code:'LYRIA_NOT_SUBMITTED',retry:'safe'});
});
test('bounded responses reject oversized content and redirects without following them',async()=>{
 for(const response of [new Response('{}',{headers:{'content-type':'application/json','content-length':String(LYRIA_LIMITS.responseBytes+1)}}),new Response(null,{status:302,headers:{location:'https://forbidden.test'}})]){
  let calls=0;const adapter=new GeminiLyriaAdapter({apiKey:'synthetic-key',fetch:async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return response;}});
  assert.equal((await adapter.generate(request)).kind,'unknown');assert.equal(calls,1);
 }
});
test('a song larger than the analysis client limit is read completely, while generic failures retain liability',async()=>{
 const audio=Buffer.alloc(4*1024*1024+1,17),body=reply();body.steps[1].content[0].data=audio.toString('base64');
 const result=await new GeminiLyriaAdapter({apiKey:'synthetic-key',fetch:async()=>Response.json(body)}).generate(request);
 assert.equal(result.kind,'completed');assert.equal(result.bytes.byteLength,audio.length);
 assert.deepEqual(parseLyriaResponse(200,{status:'failed',error:{message:'internal worker error'}}),{kind:'unknown',code:'LYRIA_RESPONSE_INVALID'});
});
