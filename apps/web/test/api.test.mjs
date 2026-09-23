import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
// Node runs the same browser transport source; Vite normally resolves this TS module.
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(['./model', './event-stream'].includes(specifier) && context.parentURL?.endsWith('/src/api.ts') ? specifier + '.ts' : specifier, context);
} });
const { StudioApi, ApiError } = await import('../src/api.ts'); hooks.deregister();
const nativeFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = nativeFetch; });

test('browser exchanges a launch code once and restores sessions without sending a bearer credential', async () => {
  const calls = [], csrf = 'c'.repeat(43), code = 'a'.repeat(43);
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return Response.json({ csrf }); };
  const paired = await StudioApi.connect(code), restored = await StudioApi.connect();
  assert.equal(calls[0].path, '/api/session'); assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, JSON.stringify({ code }));
  assert.equal(calls[0].options.headers['x-openslate-client'], 'studio');
  assert.equal(calls[1].options.method, 'GET'); assert.equal(calls[1].options.body, undefined);
  await paired.request('/api/projects', { method: 'POST', body: { name: 'Local project' } });
  assert.equal(calls[2].options.headers['x-openslate-csrf'], csrf);
  assert.ok(calls.every(call => call.options.credentials === 'same-origin' && call.options.headers.authorization === undefined && !call.path.includes(code)));
  paired.close(); restored.close();
});

test('logout uses the current CSRF and rejected sessions notify the workspace', async () => {
  const api = new StudioApi('c'.repeat(43)); let notified = 0;
  api.onSessionExpired = () => notified++;
  globalThis.fetch = async (_path, options) => {
    assert.equal(options.headers['x-openslate-csrf'], 'c'.repeat(43));
    return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 403 });
  };
  await assert.rejects(api.request('/api/session/logout', { method: 'POST' }), error => error.code === 'AUTH_REQUIRED');
  assert.equal(notified, 1); api.close();
});

test('authenticated requests keep token out of URLs and replay the exact command key and body', async () => {
  const requests = []; globalThis.fetch = async (path, options) => { requests.push({ path, options }); return Response.json({ ok: true }); };
  const api = new StudioApi('synthetic-token'); const command = { method: 'POST', body: { text: 'Keep shot 2' }, key: 'same-request' };
  await api.request('/api/projects/project/messages', command); await api.request('/api/projects/project/messages', command);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].options.headers['x-openslate-csrf'], 'synthetic-token'); assert.equal(requests[0].options.headers['idempotency-key'], 'same-request');
  assert.equal(requests[0].options.credentials, 'same-origin'); assert.equal(requests[0].options.redirect, 'error');
  assert.ok(!requests[0].path.includes('synthetic-token')); api.close();
});

test('binary uploads retain the same bytes and idempotency key without exposing local filenames',async()=>{
  const sent=[];globalThis.fetch=async(path,options)=>{sent.push({path,options});return Response.json({id:'audio'});};
  const api=new StudioApi('fixture'),blob=new Blob([new Uint8Array([1,2,3])],{type:'audio/wav'});
  await api.upload('/api/projects/project/narration/audio?sessionId=s&declaredOrigin=uploaded',blob,'upload-key');
  assert.equal(sent[0].options.body,blob);assert.equal(sent[0].options.headers['content-type'],'application/octet-stream');
  assert.equal(sent[0].options.headers['idempotency-key'],'upload-key');
  await assert.rejects(api.upload('/api/projects/project/narration/audio',new Blob([]),'empty'),e=>e.code==='UPLOAD_TOO_LARGE');api.close();
});
test('artifact loading verifies SHA256 before exposing any object URL', async () => {
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  globalThis.fetch = async () => new Response(bytes, { headers: { 'content-type': 'image/svg+xml' } });
  const api = new StudioApi('fixture'); const sha256 = createHash('sha256').update(bytes).digest('hex');
  const url = await api.artifact('project', { artifactId: 'frame', sha256, kind: 'image' }, new AbortController().signal);
  assert.match(url, /^blob:/); URL.revokeObjectURL(url);
  await assert.rejects(api.artifact('project', { artifactId: 'frame', sha256: '0'.repeat(64), kind: 'image' }, new AbortController().signal), error => error instanceof ApiError && error.code === 'ARTIFACT_CHANGED'); api.close();
});
test('artifact preview has an explicit bounded byte limit', async () => {
  globalThis.fetch = async () => new Response('small-body', { headers: { 'content-length': String(257 * 1024 * 1024) } });
  const api = new StudioApi('fixture');
  await assert.rejects(api.artifact('project', { artifactId: 'large', sha256: '', kind: 'video' }, new AbortController().signal), error => error.code === 'ARTIFACT_TOO_LARGE'); api.close();
});
test('an existing generated WAV uses the authenticated artifact path before narration attachment and verifies its exact hash', async () => {
  const bytes = new TextEncoder().encode('offline synthetic WAV bytes'), calls = [];
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return new Response(bytes, { headers: { 'content-type': 'audio/wav' } }); };
  const api = new StudioApi('fixture'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const url = await api.artifact('project', { artifactId: 'existing-take', sha256, kind: 'audio' }, new AbortController().signal);
  assert.equal(calls[0].path, '/api/projects/project/artifacts/existing-take/content'); assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers['x-openslate-csrf'], 'fixture'); assert.equal(calls[0].options.body, undefined);
  assert.match(url, /^blob:/); URL.revokeObjectURL(url);
  await assert.rejects(api.artifact('project', { artifactId: 'existing-take', sha256: 'f'.repeat(64), kind: 'audio' }, new AbortController().signal), error => error.code === 'ARTIFACT_CHANGED'); api.close();
});
test('transport exposes safe failure codes without reflecting server text or tokens', async () => {
  globalThis.fetch = async () => Response.json({ error: { code: 'QUESTION_STALE', message: 'do not show raw server secret' } }, { status: 409 });
  const api = new StudioApi('fixture');
  await assert.rejects(api.request('/api/projects/project/messages'), error => error.code === 'QUESTION_STALE' && !error.message.includes('secret'));
  await assert.rejects(api.request('https://example.com/'), error => error.code === 'INVALID_PATH'); api.close();
});

test('event streams authenticate only through headers and deliver bounded frames without a request timeout',async()=>{
 const calls=[],frames=[],abort=new AbortController();let source;
 globalThis.fetch=async(path,options)=>{calls.push({path,options});return new Response(new ReadableStream({start(controller){source=controller;}}),{headers:{'content-type':'text/event-stream'}});};
 const api=new StudioApi('private-synthetic-token'),promise=api.events('project',{after:8,signal:abort.signal,onOpen(){},onEvent:event=>frames.push(event)});
 await new Promise(resolve=>setImmediate(resolve));source.enqueue(new TextEncoder().encode('id: 9\nevent: changed\ndata: {"projectId":"project","sequence":9}\n\n'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(frames.length,1);assert.equal(calls[0].options.headers['last-event-id'],'8');assert.equal(calls[0].options.headers['x-openslate-csrf'],'private-synthetic-token');
 assert.equal(calls[0].path,'/api/projects/project/events');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.redirect,'error');
 abort.abort();await promise.catch(error=>assert.equal(error.name,'AbortError'));assert.equal(calls[0].options.signal.aborted,true);api.close();
});
test('event stream rejects JSON/error pages, oversized frames and expired sessions; closing API aborts readers',async()=>{
 const api=new StudioApi('fixture'),options={signal:new AbortController().signal,onOpen(){},onEvent(){}};
 globalThis.fetch=async()=>Response.json({ok:true});await assert.rejects(api.events('project',options),error=>error.code==='EVENT_STREAM_UNAVAILABLE');
 globalThis.fetch=async()=>new Response('data: '+'x'.repeat(70000),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(api.events('project',options),error=>error.code==='EVENT_STREAM_UNAVAILABLE');
 let cancelled=false;globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
 const running=api.events('project',options);await new Promise(resolve=>setImmediate(resolve));api.close();await running.catch(error=>assert.equal(error.name,'AbortError'));assert.equal(cancelled,true);
 await assert.rejects(api.events('project',options),error=>error.code==='SESSION_CLOSED');
});

test('a streaming error response is cancelled without waiting for or retaining its body',async()=>{
 let cancelled=false;globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:400});
 const api=new StudioApi('fixture');await assert.rejects(api.events('project',{signal:new AbortController().signal,onOpen(){},onEvent(){}}),error=>error.code==='VALIDATION_ERROR');assert.equal(cancelled,true);api.close();
});
