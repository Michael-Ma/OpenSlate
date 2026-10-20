import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CodexImageWorkerTransport } from "../dist/index.js";
import { ImageRpc } from "../dist/media/image-rpc.js";
import { CODEX_RUNTIME_LIMITS } from "../dist/runtime/policy.js";
const entry=fileURLToPath(new URL("codex-image-fixture.mjs",import.meta.url));
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XsAAAAASUVORK5CYII=","base64");
const input=()=>({attemptId:"attempt-1",requestDigest:"a".repeat(64),prompt:"A small blue boot",width:1024,height:1024,runtimeVersion:"0.153.4",model:"gpt-6-astra",images:[]});
async function fixture(t,scenario="inline",timeoutMs=2000) {
 const root=await realpath(await mkdtemp(join(tmpdir(),"openslate-codex-image-"))),nativeHome=join(root,"home"),codexHome=join(nativeHome,".codex");
 await mkdir(codexHome,{recursive:true});
 const options={command:{file:process.execPath,args:[entry]},nativeHome,codexHome,directory:join(root,"images"),timeoutMs,
  env:{SETUP_FIXTURE_LOG:join(root,"calls.jsonl"),SETUP_FIXTURE_SKILL:join(codexHome,"skills/private/SKILL.md"),SETUP_FIXTURE_MODEL:"gpt-6-astra",IMAGE_FIXTURE_SCENARIO:scenario,IMAGE_FIXTURE_CONTROL:join(root,"control")}};
 const workers=[],make=()=>{const worker=new CodexImageWorkerTransport(options);workers.push(worker);return worker;};
 const worker=make();t.after(async()=>{await Promise.all(workers.map(w=>w.close()));await rm(root,{recursive:true,force:true});});
 const records=async()=>{try{return(await readFile(options.env.SETUP_FIXTURE_LOG,"utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);}catch(e){if(e.code==="ENOENT")return[];throw e;}};
 return{root,options,worker,make,records,set:scenario=>writeFile(options.env.IMAGE_FIXTURE_CONTROL,scenario)};
}
async function run(f,supplied=input(),options={}){const prepared=await f.worker.prepare(supplied);let turns=[];const outcome=await f.worker.start(prepared,supplied,{observeTurn:async id=>turns.push(id),...options});return{prepared,outcome,turns};}
const methods=rows=>rows.filter(x=>x.method).map(x=>x.method);
async function waitFor(read){for(let i=0;i<400;i++){if(await read())return;await new Promise(r=>setTimeout(r,10));}throw Error("Fixture barrier timeout");}

test("construction is lazy; readiness has no threads, turns, credentials or inherited application tools",async t=>{
 const f=await fixture(t);assert.deepEqual(await f.records(),[]);
 f.options.env.OPENAI_API_KEY="must-not-forward";f.options.env.CODEX_API_KEY="must-not-forward-either";f.options.env.OPENAI_BASE_URL="https://invalid.example";
 const strict=f.make();const readiness=await strict.checkReadiness();assert.equal(readiness.status,"ready",readiness.code);
 const calls=await f.records();assert.ok(!methods(calls).some(m=>m.startsWith("thread/")||m.startsWith("turn/")));
 assert.ok(!JSON.stringify(readiness).includes(f.root));assert.ok(!JSON.stringify(readiness).includes("PRIVATE"));
 assert.ok(calls.filter(x=>x.kind==="launch").every(x=>x.parentSecretAbsent&&x.apiEnvironmentAbsent));
});
for(const scenario of ["api-key","capability"])test(`new work blocks ${scenario} without starting any turn`,async t=>{
 const f=await fixture(t,scenario);const ready=await f.worker.checkReadiness();assert.equal(ready.status,"blocked");assert.deepEqual(ready.nativeDiagnostic,{category:scenario==="api-key"?"native_auth_required":"native_protocol"});assert.ok(!methods(await f.records()).includes("turn/start"));
});
test("image startup settings are bounded independently of its turn execution deadline",async t=>{
 const f=await fixture(t);
 for(const startupTimeoutMs of [0,-1,120001,Infinity,1.5])assert.throws(()=>new CodexImageWorkerTransport({...f.options,startupTimeoutMs}),error=>error.code==="CODEX_IMAGE_LIMIT_INVALID");
 for(const startupTimeoutMs of [15000,60000,120000])assert.doesNotThrow(()=>new CodexImageWorkerTransport({...f.options,startupTimeoutMs}));
 assert.deepEqual(await f.records(),[]);
});
test("one exact turn yields a unique structured image and preserves model/canvas preference distinction",async t=>{
 const f=await fixture(t),value=input();value.images=[{artifactId:"ref-1",sha256:createHash("sha256").update(png).digest("hex"),byteLength:png.length,bytes:png}];
 const {prepared,outcome,turns}=await run(f,value);assert.equal(outcome.kind,"completed",outcome.code);assert.deepEqual(Buffer.from(outcome.bytes),png);assert.deepEqual(turns,["turn-1"]);
 assert.equal(prepared.runtime.authMode,"chatgpt");assert.match(prepared.runtime.runtimeDigest,/^[a-f0-9]{64}$/);
 const call=(await f.records()).find(x=>x.method==="turn/start");assert.equal(call.params.input[1].type,"localImage");assert.ok(call.params.input[1].path.startsWith(f.options.directory));
 assert.match(call.params.input[0].text,/dimensions are preferences/);assert.equal(methods(await f.records()).filter(x=>x==="turn/start").length,1);
 assert.equal((await f.worker.start(prepared,value,{observeTurn:async()=>{throw Error("must not observe another turn");}})).kind,"unknown");
});
test("large inline PNG exceeds the director line budget without exceeding the separate image limit",async t=>{
 // This tests the image payload limit, not a two-second CPU budget under parallel FFmpeg load.
 const f=await fixture(t,"large",10000),{outcome}=await run(f);assert.equal(outcome.kind,"completed",outcome.code);assert.ok(outcome.bytes.length>4*1024*1024);
});
test("native default generated_images path is read exactly and survives worker reconstruction without authentication",async t=>{
 const f=await fixture(t,"path"),{prepared,outcome}=await run(f);assert.equal(outcome.kind,"completed",outcome.code);
 await f.set("api-key");const before=await f.records(),recovered=await f.make().lookup(prepared,{turnId:"turn-1"});assert.equal(recovered.kind,"completed",recovered.code);assert.deepEqual(recovered.bytes,outcome.bytes);
 const extra=methods((await f.records()).slice(before.length));assert.deepEqual(extra,["initialize","initialized","thread/read"]);
});
for(const scenario of ["symlink","outside","no-bytes","multiple","conflicting-item","wrong-event"])test(`no image is selected from ${scenario}`,async t=>{
 const f=await fixture(t,scenario),{outcome}=await run(f);assert.equal(outcome.kind,"unknown");assert.equal(methods(await f.records()).filter(x=>x==="turn/start").length,1);
});
for(const [scenario,code]of [["usage","USAGE_LIMIT"],["image-failed","IMAGE_FAILED"],["image-refusal","IMAGE_FAILED"],["turn-failed","TURN_FAILED"],["turn-interrupted","TURN_INTERRUPTED"],["no-image","NO_IMAGE"]])test(`${scenario} remains a typed observed terminal result, without retry`,async t=>{
 const f=await fixture(t,scenario),{prepared,outcome}=await run(f);assert.deepEqual(outcome,{kind:"failed",threadId:prepared.session.threadId,turnId:"turn-1",code});
 assert.deepEqual(await f.make().lookup(prepared,{turnId:"turn-1"}),outcome);
 const calls=methods(await f.records());assert.equal(calls.filter(x=>x==="turn/start").length,1);assert.ok(!calls.includes("thread/resume"));assert.ok(!JSON.stringify(outcome).includes("PRIVATE"));
});
test("worker deadline settles only an interrupt proven terminal in exact native history",async t=>{
 const f=await fixture(t,"deadline-interrupted"),{prepared,outcome}=await run(f);
 assert.deepEqual(outcome,{kind:"failed",threadId:prepared.session.threadId,turnId:"turn-1",code:"TURN_INTERRUPTED"});
 assert.deepEqual(await f.make().lookup(prepared,{turnId:"turn-1"}),outcome);
 const calls=methods(await f.records());assert.equal(calls.filter(x=>x==="turn/start").length,1);assert.equal(calls.filter(x=>x==="turn/interrupt").length,1);assert.equal(calls.filter(x=>x==="thread/read").length,2);
});
for(const scenario of ["deadline-no-evidence","interrupt-lost-reply"])test(`worker deadline with ${scenario} stays unknown without terminal native evidence`,async t=>{
 const f=await fixture(t,scenario),{prepared,outcome}=await run(f);assert.deepEqual(outcome,{kind:"unknown",code:"CODEX_IMAGE_TIMEOUT"});
 assert.equal((await f.make().lookup(prepared,{turnId:"turn-1"})).kind,"pending");
 const calls=methods(await f.records());assert.equal(calls.filter(x=>x==="turn/start").length,1);assert.equal(calls.filter(x=>x==="turn/interrupt").length,1);
});
for(const operation of ["start","lookup"])for(const boundary of ["cleanup-error","late-abort"])test(`${operation} preserves saved native failure through ${boundary}`,async t=>{
 const f=await fixture(t,"usage"),value=input(),controller=new AbortController();
 const prepared=operation==="start"?await f.worker.prepare(value):(await run(f,value)).prepared;
 const close=ImageRpc.prototype.close;
 ImageRpc.prototype.close=async function(){if(boundary==="late-abort")controller.abort();await close.call(this);if(boundary==="cleanup-error")throw Error("PRIVATE_CLEANUP_ERROR");};
 let outcome;try{outcome=operation==="start"?await f.worker.start(prepared,value,{signal:controller.signal,observeTurn:async()=>{}}):await f.make().lookup(prepared,{turnId:"turn-1",signal:controller.signal});}
 finally{ImageRpc.prototype.close=close;}
 assert.deepEqual(outcome,{kind:"failed",threadId:prepared.session.threadId,turnId:"turn-1",code:"USAGE_LIMIT"});assert.equal(methods(await f.records()).filter(x=>x==="turn/start").length,1);
});
test("observed terminal failure stays definite when the observation sink reaches the worker deadline",async t=>{
 const f=await fixture(t,"usage"),{prepared,outcome}=await run(f,input(),{observeTurn:()=>new Promise(()=>{})});
 assert.deepEqual(outcome,{kind:"failed",threadId:prepared.session.threadId,turnId:"turn-1",code:"USAGE_LIMIT"});assert.equal(methods(await f.records()).filter(x=>x==="turn/start").length,1);
});
test("saved terminal history stays definite when cancellation follows the native read",async t=>{
 const f=await fixture(t,"usage"),{prepared}=await run(f),controller=new AbortController(),request=ImageRpc.prototype.request;
 ImageRpc.prototype.request=async function(method,...args){const result=await request.call(this,method,...args);if(method==="thread/read")controller.abort();return result;};
 let outcome;try{outcome=await f.make().lookup(prepared,{turnId:"turn-1",signal:controller.signal});}finally{ImageRpc.prototype.request=request;}
 assert.deepEqual(outcome,{kind:"failed",threadId:prepared.session.threadId,turnId:"turn-1",code:"USAGE_LIMIT"});assert.equal(methods(await f.records()).filter(x=>x==="turn/start").length,1);
});
test("terminal usage failure stays definite when its observation callback cancels the worker",async t=>{
 const f=await fixture(t,"usage"),controller=new AbortController(),setHandler=ImageRpc.prototype.setMessageHandler;let completed;
 const completion=new Promise(resolve=>{completed=resolve;});
 ImageRpc.prototype.setMessageHandler=function(receive){return setHandler.call(this,message=>{receive(message);if(message.method==="turn/completed")completed();});};
 let result;try{result=await run(f,input(),{signal:controller.signal,observeTurn:async()=>{await completion;controller.abort();}});}finally{ImageRpc.prototype.setMessageHandler=setHandler;}
 assert.deepEqual(result.outcome,{kind:"failed",threadId:result.prepared.session.threadId,turnId:"turn-1",code:"USAGE_LIMIT"});
 const calls=methods(await f.records());assert.equal(calls.filter(x=>x==="turn/start").length,1);assert.ok(!calls.includes("turn/interrupt"));
});
test("lost turn acknowledgement recovers exact recorded result via history with no new prepare or turn",async t=>{
 const f=await fixture(t,"lost-ack"),{prepared,outcome,turns}=await run(f);assert.equal(outcome.kind,"unknown");assert.deepEqual(turns,["turn-1"]);
 const recovered=await f.make().lookup(prepared,{turnId:"turn-1"});assert.equal(recovered.kind,"completed",recovered.code);assert.equal(methods(await f.records()).filter(x=>x==="turn/start").length,1);
 assert.ok(!methods(await f.records()).includes("thread/resume"));
});
test("prepared process lost or explicitly released cannot be recreated as a first turn",async t=>{
 const f=await fixture(t),value=input(),prepared=await f.worker.prepare(value);await f.worker.release(prepared);await f.worker.release(prepared);
 const outcome=await f.make().start(prepared,value,{observeTurn:async()=>{}});assert.equal(outcome.kind,"unknown");assert.equal(outcome.code,"CODEX_IMAGE_PREPARED_PROCESS_LOST");assert.ok(!methods(await f.records()).includes("turn/start"));
});
test("exact original signal and observation callback survive caller option mutation",async t=>{
 const f=await fixture(t,"pending"),controller=new AbortController(),value=input(),prepared=await f.worker.prepare(value);let observed=0;
 const options={signal:controller.signal,observeTurn:async()=>{observed++;}};
 const pending=f.worker.start(prepared,value,options);options.signal=new AbortController().signal;options.observeTurn=async()=>{throw Error("replacement callback");};value.prompt="replacement prompt";
 await waitFor(async()=>methods(await f.records()).includes("turn/start"));controller.abort();const outcome=await pending;assert.equal(outcome.kind,"unknown");assert.equal(outcome.code,"CODEX_IMAGE_ABORTED");assert.equal(observed,1);
 const call=(await f.records()).find(x=>x.method==="turn/start");assert.ok(!call.params.input[0].text.includes("replacement prompt"));
});
test("hanging observation sink cannot defeat the native turn deadline",async t=>{
 const f=await fixture(t),start=Date.now(),{outcome}=await run(f,input(),{observeTurn:()=>new Promise(()=>{})});assert.equal(outcome.kind,"unknown");assert.ok(Date.now()-start<10000);
});
test("changed reference bytes fail before the sole turn start",async t=>{
 const f=await fixture(t),value=input();value.images=[{artifactId:"ref-1",sha256:createHash("sha256").update(png).digest("hex"),byteLength:png.length,bytes:png}];
 const prepared=await f.worker.prepare(value),workspace=join(f.options.directory,"workspaces",prepared.session.turnInputDigest),files=await readdir(workspace);
 await writeFile(join(workspace,files.find(x=>x.endsWith(".png"))),Buffer.from("changed"));
 const outcome=await f.worker.start(prepared,value,{observeTurn:async()=>{}});assert.equal(outcome.kind,"unknown");assert.ok(!methods(await f.records()).includes("turn/start"));
});
for(const scenario of ["wrong-history","multiple-turns","history-error"])test(`lookup ${scenario} stays unknown and never resumes`,async t=>{
 const f=await fixture(t),{prepared}=await run(f);await f.set(scenario);const before=(await f.records()).length,outcome=await f.make().lookup(prepared,{turnId:"turn-1"});assert.equal(outcome.kind,"unknown");
 assert.ok(methods((await f.records()).slice(before)).every(x=>["initialize","initialized","thread/read"].includes(x)));
});
test("lookup never borrows a different turn or changed saved launch configuration",async t=>{
 const f=await fixture(t),{prepared}=await run(f);assert.equal((await f.make().lookup(prepared,{turnId:"other-turn"})).kind,"unknown");
 const file=join(f.options.directory,"configurations",prepared.runtime.configurationDigest+".json"),raw=JSON.parse(await readFile(file,"utf8"));raw.config.model="other-model";await writeFile(file,JSON.stringify(raw));
 const before=(await f.records()).length;assert.equal((await f.make().lookup(prepared)).kind,"unknown");assert.equal((await f.records()).length,before);
});
test("image JSONL transport denies resume, arbitrary commands and app tools before sending",async t=>{
 const f=await fixture(t),rpc=new ImageRpc({command:process.execPath,args:[entry],cwd:f.root,env:f.options.env,limits:CODEX_RUNTIME_LIMITS,secrets:[],allowedMethods:["initialize","thread/read"],onMessage:()=>{}});
 try{for(const method of ["turn/start","thread/resume","thread/start","mcpServer/tool/call","command/exec","account/login/start"])assert.throws(()=>rpc.request(method,{}));}finally{await rpc.close();}
 assert.deepEqual(methods(await f.records()),[]);
});

test("close during lazy setup bars every later thread and turn launch",async t=>{
 const f=await fixture(t,"close-setup"),pending=f.worker.prepare(input());
 await waitFor(async()=>(await f.records()).some(x=>x.method==="config/read"));
 try{await f.worker.close();}finally{await writeFile(f.options.env.IMAGE_FIXTURE_CONTROL+".release","release");}
 await assert.rejects(pending,error=>error.code==="CODEX_IMAGE_CLOSED");
 const calls=await f.records();assert.ok(!methods(calls).some(method=>method.startsWith("thread/")||method.startsWith("turn/")));
 for(const row of calls.filter(x=>x.kind==="launch"))assert.throws(()=>process.kill(row.pid,0),error=>error.code==="ESRCH");
});
