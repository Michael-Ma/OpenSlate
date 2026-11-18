import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cutListFindings, zoomSoftFindings } from '../dist/code-plan/cut-findings.js';
import { normalizeStepInput, stepKey } from '../dist/code-plan/identity.js';
import { codePlanFitWarning } from '../dist/code-plan/fit-warning.js';
import { readClipFrames, renderCutPairs } from '../dist/code-plan/clip-frames.js';
import { codePlanFixture } from './code-plan-e2e-fixture.mjs';
import { readCodeFilm, wireCodePlans } from '../dist/code-plan/director.js';
import { parseToolArguments, toolCatalog } from '@openslate/core';

const image = { kind: 'image', sha256: 'a'.repeat(64) }, video = { kind: 'video', sha256: 'b'.repeat(64) };
const cut = (clip = 'a', seconds = 1) => ({ sees: 'A chair', seconds, clip });
for (const [name, scenes, shots, lengths, codes] of [
  ['absent', [{}], [{id:'a'}], [9], []],
  ['clean', [{cuts:[cut()]}], [{id:'a'}], [1], []],
  ['unused', [{cuts:[cut()]}], [{id:'a'}, ...['b','c','d','e','f','g'].map(id=>({id}))], [], ['CUTS_UNUSED_SHOT']],
  ['unknown', [{cuts:[cut('x')]}], [], [], ['CUTS_UNKNOWN_CLIP']],
  ['a held picture of no shot', [{cuts:[cut(), cut('still')]}], [{id:'a'}], [2], []],
  ['length', [{cuts:[cut()]}], [{id:'a'}], [2.01], ['CUTS_LENGTH']],
  ['one second tolerance', [{cuts:[cut()]}], [{id:'a'}], [2], []],
  ['not array', [{cuts:{}}], [], [], ['CUTS_SHAPE']],
  ['bad object', [{cuts:[{sees:9,seconds:0,clip:2}]}], [], [], ['CUTS_SHAPE']],
  ['64 bound', [{cuts:Array(64).fill(cut())}], [{id:'a'}], [64], []],
  ['65 bounded', [{cuts:[...Array(64).fill(cut()), cut('hidden')]}], [{id:'a'}], [], ['CUTS_SHAPE']],
  ['bound across scenes', [{cuts:Array(64).fill(cut())},{cuts:[cut('hidden')]}], [{id:'a'}], [], ['CUTS_SHAPE']],
]) test(`cut-list advice: ${name}`, () => {
  const findings = cutListFindings(scenes, shots, lengths); assert.deepEqual(findings.map(f => f.code), codes);
  if (name === 'unused') { assert.match(findings[0].detail, /b, c, d, e, f/); assert.doesNotMatch(findings[0].detail, /, g/); }
});
for (const value of [null, [1], [{sees:'x',seconds:-1,clip:'a'}], [{sees:'x',seconds:Infinity,clip:'a'}]])
  test(`malformed cuts stay advisory: ${JSON.stringify(value)}`, () => assert.equal(cutListFindings([{cuts:value}],[])[0].code,'CUTS_SHAPE'));

test('zoom up to 2, still bounds and each forbidden field are validated plainly', () => {
  const row = {artifact:image,durationFrames:30,fit:'cover',zoom:{scale:2,x:0,y:1}};
  assert.equal(normalizeStepInput('render',{timeline:[row]}).timeline[0].zoom.scale,2);
  assert.throws(()=>normalizeStepInput('render',{timeline:[{...row,zoom:{scale:2.01}}]}), /at most 2/);
  for (const durationFrames of [0,301,1.5]) assert.throws(()=>normalizeStepInput('render',{timeline:[{...row,durationFrames}]}), /1–300/);
  for (const field of ['startFrame','speed','holdFrames']) assert.throws(()=>normalizeStepInput('render',{timeline:[{...row,[field]:1}]}), error=>error.code==='CODE_PLAN_RENDER_INPUT' && /still row takes/.test(error.message));
  assert.throws(()=>normalizeStepInput('render',{timeline:[image]}), /durationFrames/);
  assert.throws(()=>normalizeStepInput('render',{timeline:Array(65).fill(row)}), /1–64/);
  assert.throws(()=>normalizeStepInput('render',{timeline:Array(37).fill({...row,durationFrames:300})}), /360 seconds/);
});

test('soft advice uses source pixels after contain/cover and zoom; unknown sizes skip; still fit warning is safe', () => {
  const sizes = new Map([['image:'+image.sha256,{width:100,height:100}]]);
  const render = (fit, scale) => ({timeline:[{artifact:image,fit,zoom:{scale}}],width:100,height:200});
  assert.equal(zoomSoftFindings(render('contain',1.5),sizes).length,0);
  assert.match(zoomSoftFindings(render('contain',1.51),sizes)[0].detail,/Row 1 enlarges the picture 1.5×/);
  assert.equal(zoomSoftFindings(render('cover',1.2),sizes)[0].code,'ZOOM_SOFT');
  assert.equal(zoomSoftFindings(render('cover',2),new Map()).length,0);
  assert.deepEqual(codePlanFitWarning(render('cover',2),sizes),{clips:1,keptPercent:50});
  assert.equal(codePlanFitWarning(render('cover',2),new Map()),undefined);
});

async function fixture(t) { const f=await codePlanFixture();t.after(()=>f.close());f.id=(await f.create()).id;
  f.submit=source=>f.runtime.submit(f.id,{source,basedOnVersion:f.runtime.getRun(f.id)?.planVersion??null,author:'user',invocationId:randomUUID()});
  f.until=async predicate=>{for(let i=0;i<35;i++){await f.runtime.tick();const v=f.runtime.view(f.id);assert.notEqual(v.state,'error',JSON.stringify(v.error));if(predicate(v))return v;}assert.fail(JSON.stringify(f.runtime.view(f.id)));};return f; }
const film = body => `export default async function(ctx){${body}}`;
const waiting = v=>v.choices.some(c=>!c.stale && c.answer===undefined);
const done = v=>v.state==='done';

test('suggestion-only edits preserve step, card, digest, price, answer and provider input across restart', async t=>{
  const f=await fixture(t), source=suggest=>film(`await ctx.shot({id:'a'});const k=await ctx.keyframe('a',{prompt:'Saved room',video:{durationSeconds:6}${suggest ? ',suggest:'+JSON.stringify(suggest):''}});if(k.ok)await ctx.video({...k.input,shot:'a',prompt:'A curtain moves',durationSeconds:6});`);
  await f.submit(source());let view=await f.until(waiting),card=view.choices[0];
  f.runtime.answer(f.id,{choiceId:card.choiceId,optionsDigest:card.optionsDigest,answer:card.options.find(o=>o.keyframeInput==='first_frame')});
  view=await f.until(done);const steps=f.runtime.steps(f.id),calls=structuredClone(f.calls.submit),answer=view.choices[0].answer;
  const imageKey=stepKey('image',normalizeStepInput('image',{prompt:'Saved room'}));assert.equal(steps.find(s=>s.kind==='image').key,imageKey);
  await f.restart();
  for (const suggest of [{input:'first_frame',why:'Keep the match'},{input:'keyframe_and_references',why:'More freedom'},undefined]) {
    await f.submit(source(suggest));view=await f.until(done);
    assert.equal(view.choices.length,1);assert.equal(view.choices[0].optionsDigest,card.optionsDigest);assert.deepEqual(view.choices[0].answer,answer);
    assert.equal(view.choices[0].askedAt,card.askedAt);assert.deepEqual(view.choices[0].suggest,suggest);
    assert.deepEqual(f.runtime.steps(f.id).map(s=>[s.key,s.priceMicros,s.input]),steps.map(s=>[s.key,s.priceMicros,s.input]));assert.deepEqual(f.calls.submit,calls);
    wireCodePlans(f.service,f.runtime);assert.deepEqual(readCodeFilm(f.service,f.id).choices[0].suggest,suggest);
  }
});

test('offered suggestion projects on unanswered card; unavailable suggestion is advisory on dry run', async t=>{
  const f=await fixture(t), source=input=>film(`await ctx.shot({id:'a'});await ctx.keyframe('a',{prompt:'Choice',video:{durationSeconds:6},suggest:{input:${JSON.stringify(input)},why:'The cut match'}});`);
  await f.submit(source('first_frame'));let v=await f.until(waiting);assert.equal(v.choices[0].suggest.input,'first_frame');
  const result=await f.submit(source('references_only'));v=await f.until(waiting);
  assert.equal(v.choices[0].suggest,undefined);assert.ok(result.diff.findings.some(f=>f.code==='SUGGEST_UNAVAILABLE'&&f.detail.includes('a')));
  assert.equal(f.calls.submit.length,1);
});
for (const suggest of [{input:'wrong',why:'Why'}, {input:['first_frame'],why:'Why'}, {input:'first_frame',why:''}, {input:'first_frame',why:'x'.repeat(161)}, 'first_frame', {input:'first_frame',why:'Yes',extra:1}])
  test(`invalid suggestion fails before image dispatch: ${JSON.stringify(suggest).slice(0,60)}`,async t=>{const f=await fixture(t);await assert.rejects(f.submit(film(`await ctx.shot({id:'a'});await ctx.keyframe('a',{prompt:'Room',video:{durationSeconds:6},suggest:${JSON.stringify(suggest)}});`)),{code:'CODE_PLAN_REJECTED'});assert.equal(f.calls.submit.length,0);});

test('demo fixture accepts still-only rows and foreign pictures are refused in the dry run',async t=>{
  const f=await fixture(t);await f.submit(film(`const p=await ctx.image({prompt:'A clock'});if(p.ok)await ctx.render([{artifact:p.artifact,durationFrames:30}]);`));
  const v=await f.until(done);assert.equal(v.steps.length,2);assert.equal(v.steps.find(s=>s.kind==='render').priceMicros,'0');
  await assert.rejects(f.submit(film(`await ctx.render([{artifact:${JSON.stringify(image)},durationFrames:30}]);`)),error=>error.code==='CODE_PLAN_REJECTED'&& /owned picture/.test(JSON.stringify(error.details)));
});

test('cut-pair schema accepts paging and advertises pairs without changing contract version',()=>{
  const args={artifactId:'render',cuts:true,fromCut:19};assert.deepEqual(parseToolArguments('read_clip_frames',args,'0.3.0').arguments,args);
  assert.match(toolCatalog('0.3.0').descriptors.find(d=>d.name==='read_clip_frames').description,/18 cuts/);
});

test('saved plan fixture replays identical media keys, prices, choices and answers',async t=>{
  const f=await fixture(t), saved=JSON.parse(readFileSync(new URL('./fixtures/h2-saved-plan.json',import.meta.url),'utf8'));
  await f.submit(saved.source);let v=await f.until(waiting),c=v.choices[0];
  f.runtime.answer(f.id,{choiceId:c.choiceId,optionsDigest:c.optionsDigest,answer:c.options.find(o=>o.keyframeInput==='first_frame')});await f.until(done);
  assert.deepEqual(f.runtime.steps(f.id).map(({kind,key,priceMicros,input})=>({kind,key,priceMicros,input})),saved.steps);
  const before=f.runtime.view(f.id),calls=structuredClone(f.calls.submit);await f.restart();await f.submit(saved.source);v=await f.until(done);
  assert.deepEqual(v.steps.map(s=>[s.key,s.priceMicros]),before.steps.map(s=>[s.key,s.priceMicros]));assert.deepEqual(v.choices,before.choices);assert.deepEqual(f.calls.submit,calls);
});


test('reached render reports cut length and source softness in the submitted diff without refusal',async t=>{
  const f=await fixture(t);await f.submit(film(`await ctx.image({prompt:'Room'});`));await f.until(done);
  const step=f.runtime.steps(f.id)[0],picture=step.result.artifact,record=f.store.get('artifact',picture.artifactId);
  const measuredId=randomUUID();f.store.insert('artifact',measuredId,f.id,{...record,id:measuredId,artifact:{...picture,artifactId:measuredId},width:320,height:180});
  const result=await f.submit(film(`await ctx.scene({id:'scene',cuts:[{sees:'Room',seconds:3,clip:'a'}]});await ctx.shot({id:'a'});await ctx.shot({id:'unused'});await ctx.render({timeline:[{artifact:${JSON.stringify(picture)},durationFrames:30,zoom:{scale:2}}],width:320,height:180});`));
  assert.ok(result.diff.findings.some(f=>f.code==='CUTS_UNUSED_SHOT'));assert.ok(result.diff.findings.some(f=>f.code==='CUTS_LENGTH'));assert.ok(result.diff.findings.some(f=>f.code==='ZOOM_SOFT'));await f.until(done);
});
