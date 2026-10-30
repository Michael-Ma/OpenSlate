import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DomainError } from "@openslate/core";
import { createApp } from "../dist/app.js";
import { normalizeStepInput, stepKey } from "../dist/code-plan/identity.js";
import { codePlanShotLinks } from "../dist/code-plan/projection.js";
import { wireCodePlans, readCodeFilm } from "../dist/code-plan/director.js";
import { codePlanFixture } from "./code-plan-e2e-fixture.mjs";
import { realCodeFixture, videoProfile } from "./code-plan-providers-fixture.mjs";
import { codexImageProfile } from "./codex-image-execution-fixture.mjs";
import { tool } from "./viggle-h3-execution-fixture.mjs";

const film = body => `export default async function(ctx) { ${body} }`;
const source = shot => film(`
  await ctx.shot({id:"opening",sceneId:"scene"});
  const image = await ctx.image({prompt:"Dawn",${shot}});
  if (!image.ok) return;
  await Promise.all([
    ctx.video({firstFrame:image.artifact,prompt:"Slow push",${shot}}),
    ctx.speech({text:"A new day",${shot}})
  ]);
`);
const save = (f, id, source, key = randomUUID()) => f.ok("POST", `/api/projects/${id}/code-plan/source`,
  { source, basedOnVersion: f.runtime.view(id).planVersion }, key);
const done = (f, id) => f.until(id, view => view.state === "done", "finished film");

for (const kind of ["image", "video", "speech"]) test(`${kind}: shot is bounded metadata excluded from identity`, () => {
  const plain = normalizeStepInput(kind, { prompt: "x" });
  for (const shot of ["opening", "another", "x".repeat(120)]) {
    const annotated = normalizeStepInput(kind, { prompt: "x", shot });
    assert.deepEqual(annotated, plain);
    assert.equal(stepKey(kind, annotated), stepKey(kind, plain));
  }
  for (const shot of ["", "x".repeat(121), null, 12, {}, []]) assert.throws(() => normalizeStepInput(kind, { shot }), { code: "CODE_PLAN_INPUT" });
});

test("adding, changing and removing shot on a saved plan buys nothing and read_film follows the latest reached pass", async t => {
  const f = await codePlanFixture(); t.after(() => f.close());
  const p = await f.create(); await save(f, p.id, source("")); await done(f, p.id);
  const calls = structuredClone(f.calls), attempts = f.store.list("attempt", p.id), first = await f.view(p.id);
  const receipts = f.store.list("code_plan_execution", p.id);
  for (const shot of ['shot:"opening"', 'shot:"renamed"', '']) {
    const preview = await f.runtime.dryRun(p.id, source(shot));
    assert.equal(preview.reusedSteps, 3); assert.deepEqual(preview.newSteps, []); assert.equal(preview.certainMicros, "0");
    assert.deepEqual(f.store.list("code_plan_step", p.id).map(s => s.shotId), first.steps.map(s => s.shotId));
    await save(f, p.id, source(shot)); await done(f, p.id);
    const current = await f.view(p.id);
    assert.equal(current.steps.length, 3); assert.equal(current.spentMicros, first.spentMicros);
    assert.deepEqual(current.steps.map(s => s.key), first.steps.map(s => s.key));
    assert.ok(current.steps.every(s => s.shotId === (shot ? shot.includes("renamed") ? "renamed" : "opening" : undefined)));
    assert.ok(readCodeFilm(f.service, p.id).steps.every(s => s.shotId === current.steps[0].shotId));
    assert.deepEqual(f.calls, calls); assert.deepEqual(f.store.list("attempt", p.id), attempts);
    assert.deepEqual(f.store.list("code_plan_execution", p.id), receipts);
    first.steps = current.steps;
  }
  assert.ok(attempts.every(a => !Object.hasOwn(a.request.args, "shot")));
});

test("unannotated keyframe choices link both the returned image and its first-frame clip", async t => {
  const f = await codePlanFixture(); t.after(() => f.close()); const p = await f.create();
  await save(f, p.id, film(`const frame=await ctx.image({prompt:"Choice frame"}); if (!frame.ok) return;
    const firstFrame=await ctx.choose("opening-keyframe",{question:"Pick",options:[frame.artifact]});
    await ctx.video({firstFrame,prompt:"Drift"});`));
  const waiting = await f.until(p.id, view => view.choices.length === 1, "frame choice");
  const choice = waiting.choices[0];
  await f.ok("POST", `/api/projects/${p.id}/code-plan/choices`, { choiceId:choice.choiceId,optionsDigest:choice.optionsDigest,answer:choice.options[0] });
  const view = await done(f, p.id); assert.equal(view.steps.length, 2);
  assert.ok(view.steps.every(step => step.shotId === "opening"));
  await f.restart(); assert.ok((await f.view(p.id)).steps.every(step => step.shotId === "opening"));
});

test("shot fallback respects explicit metadata and refuses ambiguous shared-frame guesses", () => {
  const ref={kind:"image",artifactId:"frame",sha256:"a".repeat(64)};
  const steps=[{key:"image",kind:"image",input:{},result:{ok:true,artifact:ref}},
    {key:"video",kind:"video",input:{firstFrame:ref}}, {key:"explicit",kind:"video",input:{firstFrame:ref},shotId:"declared"}];
  const choices=[{choiceId:"one-keyframe",options:[{artifact:ref}]}];
  assert.deepEqual([...codePlanShotLinks(steps,choices)],[['image','one'],['video','one'],['explicit','declared']]);
  assert.deepEqual([...codePlanShotLinks(steps,[...choices,{choiceId:"two-keyframe",options:[ref]}])],[['explicit','declared']]);
  const legacyShot='s'.repeat(190);
  assert.equal(codePlanShotLinks(steps,[{choiceId:`${legacyShot}-keyframe`,options:[ref]}]).get('video'),legacyShot);
});

const realSource = film(`const frame=await ctx.image({model:"${codexImageProfile.id}",prompt:"Dawn",shot:"opening"}); if (!frame.ok) return;
  const clip=await ctx.video({model:"${videoProfile.id}",firstFrame:frame.artifact,prompt:"Drift",durationSeconds:3,shot:"opening"});
  if (clip.ok) await ctx.render({timeline:[clip.artifact],width:160,height:90});`);

test("ingested clip and render get owned, probed first-frame posters at their exact dimensions, without extra steps or cost", async t => {
  const f=await realCodeFixture(t); wireCodePlans(f.service,f.plans);
  await f.submit(realSource); await f.finish();
  const token='n4-offline-poster-content-token',app=createApp({service:f.service,codePlans:f.plans,localToken:token});t.after(()=>app.close());
  const view=f.plans.view(f.project.id); assert.equal(view.steps.length,3); assert.equal(view.spentMicros,"100000");
  assert.equal(f.execution.attempts(f.project.id).length,3);
  const movies=view.steps.filter(s=>s.kind==='video'||s.kind==='render'); assert.equal(movies.length,2);
  for(const step of movies) {
    assert.ok(step.poster, JSON.stringify(f.store.list('code_plan_poster',f.project.id)));
    const poster=f.store.get('artifact',step.poster.artifactId),clip=f.store.get('artifact',step.artifact.artifactId);
    assert.equal(poster.projectId,f.project.id);assert.equal(poster.artifact.kind,'image');assert.equal(poster.mimeType,'image/png');
    assert.equal(poster.attemptId,null);assert.ok(poster.validationDigest);assert.ok(poster.path.startsWith(realpathSync(f.execution.artifactDir)+'/'));
    assert.equal(createHash('sha256').update(readFileSync(poster.path)).digest('hex'),poster.artifact.sha256);
    const probe=async path=>JSON.parse((await promisify(execFile)(tool('ffprobe'),['-v','error','-show_streams','-of','json',path])).stdout).streams[0];
    const [image,video]=await Promise.all([probe(poster.path),probe(clip.path)]);
    assert.equal(image.codec_name,'png'); assert.equal(image.width,video.width);assert.equal(image.height,video.height);
    assert.equal(poster.width,video.width);assert.equal(poster.height,video.height);
    const first=Buffer.from((await promisify(execFile)(tool('ffmpeg'),['-nostdin','-v','error','-i',clip.path,'-frames:v','1','-threads','1','-f','image2pipe','-c:v','png','-'],{encoding:'buffer'})).stdout);
    assert.deepEqual(readFileSync(poster.path),first);
    const url=`/api/projects/${f.project.id}/artifacts/${poster.id}/content`,headers={host:'127.0.0.1',authorization:`Bearer ${token}`};
    const response=await app.inject({method:'GET',url,headers});assert.equal(response.statusCode,200,response.body);
    assert.equal(response.headers['content-type'],'image/png');assert.deepEqual(response.rawPayload,first);
    assert.equal((await app.inject({method:'GET',url,headers:{host:'127.0.0.1'}})).statusCode,403);
    assert.equal((await app.inject({method:'GET',url:url.replace(f.project.id,'another-film'),headers})).statusCode,404);
  }
  const before={...f.calls};await f.restart();await f.tick();assert.deepEqual(f.calls,before);
  assert.ok(f.plans.view(f.project.id).steps.filter(s=>s.artifact?.kind==='video').every(s=>s.poster));f.noGraph();
});

test("a poster tool failure leaves both clip and render succeeded and is not retried every tick", async t => {
  const f=await realCodeFixture(t);let calls=0;
  f.mediaRuntime.localMedia.poster=async()=>{calls++;throw new DomainError('MEDIA_TOOL_FAILED','Synthetic poster failure');};
  await f.submit(realSource);await f.finish();const view=f.plans.view(f.project.id);
  assert.equal(view.state,'done');assert.ok(view.steps.every(s=>s.state==='succeeded'));assert.ok(view.steps.every(s=>!s.poster));
  assert.equal(calls,2);await f.tick();assert.equal(calls,2);assert.equal(view.spentMicros,'100000');
});

test("historical poster backfill attempts at most one clip per tick across films, and skips durable failures", async t => {
  const f=await realCodeFixture(t);await f.submit(realSource);await f.finish();
  const other=f.service.createProject('Another historical film',undefined,'code');
  f.plans.submitPlan(other.id,film('await ctx.log("Historical result");'));
  await f.tick();
  for(const row of f.store.list('code_plan_poster',f.project.id)) f.store.db.prepare("DELETE FROM entities WHERE kind='code_plan_poster' AND id=?").run(row.id);
  const old=f.plans.steps(f.project.id).find(step=>step.kind==='video'),id=randomUUID();
  const artifact={...f.store.get('artifact',old.result.artifact.artifactId),id,projectId:other.id,attemptId:null,
    artifact:{...old.result.artifact,artifactId:id}};
  f.store.put('artifact',id,other.id,artifact);
  f.store.put('code_plan_step',id,other.id,{...old,id,projectId:other.id,key:id,attemptId:null,
    result:{ok:true,artifact:artifact.artifact,artifacts:[artifact.artifact]}});
  const before={...f.calls};let calls=0;const poster=f.mediaRuntime.localMedia.poster.bind(f.mediaRuntime.localMedia);
  f.mediaRuntime.localMedia.poster=async(...args)=>{calls++;if(calls===1)throw Error('Unusable historical clip');return poster(...args);};
  const rows=()=>[...f.store.list('code_plan_poster',f.project.id),...f.store.list('code_plan_poster',other.id)];
  await f.tick();assert.equal(calls,1);assert.equal(rows().length,1);
  await f.tick();assert.equal(calls,2);assert.equal(rows().length,2);
  await f.tick();assert.equal(calls,3);assert.equal(rows().length,3);assert.equal(rows().filter(row=>row.failed).length,1);
  await f.tick();assert.equal(calls,3);assert.deepEqual(f.calls,before);
});

test("poster refuses escaped clip paths without changing successful media", async t => {
  const f=await realCodeFixture(t);await f.submit(realSource);await f.finish();
  const clip=f.plans.steps(f.project.id).find(s=>s.kind==='video').result.artifact;
  const row=f.store.get('artifact',clip.artifactId);
  await assert.rejects(f.mediaRuntime.localMedia.poster({path:row.path,sha256:'0'.repeat(64),artifactDir:f.execution.artifactDir}),{code:'MEDIA_INTEGRITY_ERROR'});
  f.store.db.prepare("DELETE FROM entities WHERE kind='code_plan_poster' AND id=?").run(clip.artifactId);
  // Inject corrupt persisted metadata directly; normal application writes correctly refuse this mutation.
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?").run(JSON.stringify({...row,path:f.root+'/raw.mp4'}),row.id);
  await f.tick();assert.equal(f.store.get('code_plan_poster',clip.artifactId).failed,true);
  assert.equal(f.plans.steps(f.project.id).find(s=>s.kind==='video').state,'succeeded');
});

test("poster worker contention is deferred to a later tick and does not fail the clip", async t => {
  const f=await realCodeFixture(t),media=f.mediaRuntime.localMedia,poster=media.poster.bind(media);
  media.poster=async()=>{throw new DomainError('MEDIA_BUSY','Synthetic worker contention');};
  await f.submit(realSource);await f.finish();assert.equal(f.store.list('code_plan_poster',f.project.id).length,0);
  assert.ok(f.plans.view(f.project.id).steps.every(step=>step.state==='succeeded'));
  media.poster=poster;await f.tick();assert.equal(f.store.list('code_plan_poster',f.project.id).length,1);
  await f.tick();assert.equal(f.store.list('code_plan_poster',f.project.id).length,2);
});

test("creation limit is durable, idempotent and governs the first preview and run", async t => {
  const f=await codePlanFixture();t.after(()=>f.close());
  const body={name:'Custom limit',planMode:'code',ceilingMicros:'0'},p=await f.ok('POST','/api/projects',body,'create-limit');
  assert.deepEqual(await f.ok('POST','/api/projects',body,'create-limit'),p);
  let view=await f.view(p.id);assert.equal(view.planVersion,null);assert.equal(view.ceilingMicros,'0');assert.equal(view.state,'empty');
  const submitted=await save(f,p.id,film('await ctx.image({prompt:"Paid frame"});'));
  assert.ok(submitted.diff.findings.some(finding=>finding.code==='CEILING'));
  await f.runtime.tick();assert.equal((await f.view(p.id)).state,'paused_budget');assert.equal(f.calls.submit.length,0);
  await f.restart();assert.equal((await f.view(p.id)).ceilingMicros,'0');
  assert.equal((await f.http('POST','/api/projects',{...body,ceilingMicros:'1'},'create-limit')).json().error.code,'IDEMPOTENCY_CONFLICT');
});

test("creation refuses graph limits and malformed micros atomically", async t => {
  const f=await codePlanFixture();t.after(()=>f.close());const count=f.store.listProjects().length;
  for(const planMode of [undefined,'graph']) {
    const response=await f.http('POST','/api/projects',{name:'Graph',...(planMode?{planMode}:{}),ceilingMicros:'1000000'});
    assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'CODE_PLAN_MODE');
  }
  for(const ceilingMicros of [0,null,'-1','01','1.1','9223372036854775808']) {
    const response=await f.http('POST','/api/projects',{name:'Invalid',planMode:'code',ceilingMicros});assert.equal(response.statusCode,400,response.body);
  }
  assert.equal(f.store.listProjects().length,count);
  assert.throws(()=>f.service.createProject('Graph',undefined,'graph','0'),{code:'CODE_PLAN_MODE'});
});

test("setCeiling before the first plan survives restart, keeps an empty view and is used by the first run", async t => {
  const f=await codePlanFixture();t.after(()=>f.close());const p=await f.create(),path=`/api/projects/${p.id}/code-plan/ceiling`;
  const first=await f.ok('POST',path,{ceilingMicros:'3000000'},'limit-before-plan');
  assert.equal(first.view.ceilingMicros,'3000000');assert.equal(first.view.planVersion,null);assert.equal(first.view.state,'empty');
  assert.equal(f.store.get('code_plan_run',p.id),undefined);assert.equal(f.calls.submit.length,0);
  await f.restart();assert.deepEqual(await f.ok('POST',path,{ceilingMicros:'3000000'},'limit-before-plan'),first);
  assert.equal((await f.view(p.id)).ceilingMicros,'3000000');
  await f.ok('POST',path,{ceilingMicros:'0'},'lower-empty');await save(f,p.id,film('await ctx.image({prompt:"Frame"});'));
  await f.runtime.tick();assert.equal((await f.view(p.id)).state,'paused_budget');assert.equal(f.calls.submit.length,0);
  await f.ok('POST',path,{ceilingMicros:'3000000'},'raise-running');const final=await done(f,p.id);
  assert.equal(final.ceilingMicros,'3000000');assert.equal(f.calls.submit.length,1);
});

test("film list counts only reached failures and terminal unknowns using run/step rows, without replay or attempt reads", async t => {
  const f=await codePlanFixture();t.after(()=>f.close());const p=await f.create(),empty=await f.create(),graph=await f.create('graph');
  await save(f,p.id,film('await ctx.log("No media");'));await done(f,p.id);
  const states=[['failed',true,null],['unknown',true,{ok:false,error:{code:'NO_ANSWER'}}],['unknown',true,null],
    ['succeeded',true,null],['failed',false,null],['unknown',false,{ok:false,error:{code:'NO_ANSWER'}}],['cancelled',true,null]];
  const reached=[];
  for(const [state,isReached,result] of states) {
    const key=randomUUID();if(isReached)reached.push(key);
    f.store.put('code_plan_step',key,p.id,{id:key,projectId:p.id,key,state,result});
  }
  f.store.put('code_plan_run',p.id,p.id,{...f.store.get('code_plan_run',p.id),reachedStepKeys:reached});
  const get=f.store.get.bind(f.store),list=f.store.list.bind(f.store);
  f.store.get=(kind,...args)=>{assert.ok(!['attempt','code_plan_execution'].includes(kind),`Unexpected ${kind}`);return get(kind,...args);};
  f.store.list=(kind,...args)=>{assert.ok(!['attempt','code_plan_execution'].includes(kind),`Unexpected ${kind}`);return list(kind,...args);};
  f.runtime.replay=()=>assert.fail('Film listing must not replay');
  const projects=(await f.ok('GET','/api/projects')).projects;
  assert.equal(projects.find(row=>row.id===p.id).needsAttention,2);assert.equal(projects.find(row=>row.id===p.id).planMode,'code');
  assert.equal(projects.find(row=>row.id===empty.id).needsAttention,0);
  assert.equal(Object.hasOwn(projects.find(row=>row.id===graph.id),'needsAttention'),false);
  assert.equal(Object.hasOwn(projects.find(row=>row.id===graph.id),'planMode'),false);
});
