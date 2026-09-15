import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical,compilePlan,composeModelProfilesIsolated,DEFAULT_PROFILES,shotIntentDigest } from '../dist/index.js';
const structure=nodes=>nodes.map(({specDigest,...node})=>node);
const gatesWithoutRecipes=gates=>gates.map(gate=>({...gate,members:gate.members.map(({recipeDigest,...member})=>member)}));
function fixture(count=2){
  const context={project:{id:'project',revisionId:'old-revision',headVersion:1,name:'Boots',brief:'',story:'',scenes:[],narration:{script:'',source:'undecided'},maxFrames:10800,capabilityLockId:'lock',shots:[],cues:[],artifacts:[],activePlanId:null},
    profiles:[...structuredClone(DEFAULT_PROFILES),{...structuredClone(DEFAULT_PROFILES[0]),id:'image-replacement',revision:'new-image'},{...structuredClone(DEFAULT_PROFILES.find(p=>p.kind==='video')),id:'video-replacement',revision:'new-video'}],logicalIds:{},allocateId:randomUUID};
  const body=[];for(let i=0;i<count;i++){const shot={id:`shot-${i}`,revisionId:`revision-${i}`,sceneId:'scene',purpose:'Boot',action:'On bench',framing:'Close-up',motion:'Push',desiredFrames:180,imagePrompt:`Image ${i}`,videoPrompt:`Video ${i}`,referenceArtifactIds:[],cueId:null,promptIntent:{image:'',video:''}};
    shot.promptIntent.image=shotIntentDigest(shot,'image');shot.promptIntent.video=shotIntentDigest(shot,'video');context.project.shots.push(shot);
    body.push(`const s${i}=p.shot("shot-${i}");const i${i}=p.image("image-${i}",{intent:s${i},profile:"fake-image-v1",prompt:"Image ${i}"});const r${i}=p.humanReview("review-${i}",{shots:[{intent:s${i},keyframe:i${i},videoProfile:"fake-video-v1",motionPrompt:"Video ${i}",seconds:6}]});const v${i}=p.video("video-${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(i${i},r${i}),prompt:"Video ${i}",seconds:6});`);}
  const source=`definePlan({baseRevision:"old-revision"},p=>{${body.join('')}const edit=p.timeline("edit",{takes:[${Array.from({length:count},(_,i)=>`v${i}`).join(',')}],transition:"cut"});return p.render("preview",{timeline:edit,format:"mp4"});});`,base=compilePlan(source,context);context.project.revisionId='current-revision';return{base,context};
}
test('isolated profile substitution preserves graph IDs, prompts, return and unrelated nodes',async()=>{
  const {base,context}=fixture(),selected=base.nodes.find(n=>n.alias==='image-0'),ids=canonical(context.logicalIds),before=canonical(base),result=await composeModelProfilesIsolated(base,[{nodeId:selected.id,profileId:'image-replacement'}],context);
  assert.equal(result.nodes.find(n=>n.id===selected.id).args.profileIdentity,'image-replacement');assert.equal(result.nodes.find(n=>n.id===selected.id).args.prompt,selected.args.prompt);
  assert.deepEqual(structure(result.nodes.filter(n=>n.id!==selected.id)),structure(base.nodes.filter(n=>n.id!==selected.id)));assert.deepEqual(gatesWithoutRecipes(result.gates),gatesWithoutRecipes(base.gates));assert.equal(canonical(context.logicalIds),ids);assert.equal(canonical(base),before);
  assert.equal(result.canonicalSource.split('\n').find(s=>s.trim().startsWith('return')),base.canonicalSource.split('\n').find(s=>s.trim().startsWith('return')));
});
test('video replacement updates the exact paired review member and no other gate',async()=>{
  const {base,context}=fixture(),selected=base.nodes.find(n=>n.alias==='video-0'),result=await composeModelProfilesIsolated(base,[{nodeId:selected.id,profileId:'video-replacement'}],context);
  assert.notEqual(result.gates[0].members[0].recipeDigest,base.gates[0].members[0].recipeDigest);assert.deepEqual(result.gates[1],base.gates[1]);assert.deepEqual(structure(result.nodes.filter(n=>n.id!==selected.id)),structure(base.nodes.filter(n=>n.id!==selected.id)));
});
test('unsupported original syntax is rejected before printer laundering',async()=>{
  for(const mutate of [s=>s.replace('p.image(', 'p["image"]('),s=>s.replace('p.image(', 'p?.image('),s=>s.replace('const s0=', 'let s0=')]){const {base,context}=fixture();base.source=mutate(base.source);await assert.rejects(composeModelProfilesIsolated(base,[{nodeId:base.nodes[0].id,profileId:'image-replacement'}],context));}
});
test('tampered graph, stale intents, duplicate replacements and absent profiles fail without ID mutation',async()=>{
  for(const mutate of [(f)=>{f.base.graphDigest='a'.repeat(64);},f=>{f.context.project.shots[0].imagePrompt='changed';},f=>{f.changes.push({...f.changes[0]});},f=>{f.changes[0].profileId='missing';}]){const f=fixture();f.changes=[{nodeId:f.base.nodes[0].id,profileId:'image-replacement'}];mutate(f);const ids=canonical(f.context.logicalIds);await assert.rejects(composeModelProfilesIsolated(f.base,f.changes,f.context));assert.equal(canonical(f.context.logicalIds),ids);}
});
test('original caller signal and logical-map compare-and-swap remain authoritative',async()=>{
  const {base,context}=fixture(),controller=new AbortController(),options={signal:controller.signal},pending=composeModelProfilesIsolated(base,[{nodeId:base.nodes[0].id,profileId:'image-replacement'}],context,options);options.signal=new AbortController().signal;controller.abort();await assert.rejects(pending,{code:'MODEL_SETTINGS_CANCELLED'});
  const f=fixture(),run=composeModelProfilesIsolated(f.base,[{nodeId:f.base.nodes[0].id,profileId:'image-replacement'}],f.context);f.context.logicalIds={...f.context.logicalIds};await assert.rejects(run,{code:'MODEL_PLAN_INVALID'});
});
test('context and saved data getters are rejected without execution',async()=>{
  const f=fixture();let hits=0;Object.defineProperty(f.context,'project',{enumerable:true,get(){hits++;return{};}});await assert.rejects(composeModelProfilesIsolated(f.base,[],f.context));assert.equal(hits,0);
  const g=fixture();Object.defineProperty(g.base,'source',{enumerable:true,get(){hits++;return'';}});await assert.rejects(composeModelProfilesIsolated(g.base,[],g.context));assert.equal(hits,0);
});
test('sixty-shot model change preserves the six-minute graph within its bounded worker', {timeout:15000},async t=>{
  const {base,context}=fixture(60),changes=base.nodes.filter(n=>n.kind==='image').map(n=>({nodeId:n.id,profileId:'image-replacement'})),start=performance.now(),result=await composeModelProfilesIsolated(base,changes,context);
  assert.equal(result.nodes.length,122);assert.equal(result.gates.length,60);assert.deepEqual(structure(result.nodes.filter(n=>n.kind!=='image')),structure(base.nodes.filter(n=>n.kind!=='image')));t.diagnostic(`60 images in 122-operation six-minute plan: ${(performance.now()-start).toFixed(1)} ms`);
});
