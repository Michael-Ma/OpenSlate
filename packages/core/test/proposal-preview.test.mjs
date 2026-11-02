import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, previewCreativePatch, proposalPreviewDigest, shotIntentDigest, parseToolArguments } from '../dist/index.js';
const shot = (id, sceneId) => ({ id, sceneId, revisionId:id, purpose:'Arrival', action:'Board ferry', framing:'Wide', motion:'Slow push', desiredFrames:180, imagePrompt:'Ferry', videoPrompt:'Move forward', referenceArtifactIds:[], cueId:null, promptIntent:{image:'',video:''} });
function fixture() {
 const project={id:'film',scenes:[{id:'scene',purpose:'Departure'}],shots:[shot('a','scene'),shot('b','scene')],cues:[]};
 const a=project.shots[0], binding=kind=>({node:{kind,intentDigest:shotIntentDigest(a,kind),args:{prompt:kind==='image'?a.imagePrompt:a.videoPrompt}},outputs:{main:{artifactId:kind}}});
 return {project,bindings:{a:[binding('image'),binding('video')]}};
}
test('duration preview is pure, reports timeline/film delta, preserves keyframe and remakes clip',()=>{
 const {project,bindings}=fixture(),before=structuredClone(project),patch={updateShots:[{id:'a',desiredFrames:240}]};
 const preview=previewCreativePatch(project,patch,bindings);
 assert.deepEqual(project,before);assert.deepEqual(previewCreativePatch(project,patch,bindings),preview);
 assert.deepEqual(preview.changes,[{shotId:'a',field:'desiredFrames',before:'180',after:'240'}]);
 assert.deepEqual(preview.timeline.map(s=>[s.label,s.nowSeconds,s.afterSeconds,s.changed]),[['1.1',6,8,true],['1.2',6,6,false]]);
 assert.equal(preview.filmSecondsNow,12);assert.equal(preview.filmSecondsAfter,14);
 assert.deepEqual(preview.effects,[{shotId:'a',effect:'keeps_keyframe'},{shotId:'a',effect:'clip_remade'}]);
 assert.equal(proposalPreviewDigest(preview),proposalPreviewDigest(previewCreativePatch(project,patch,bindings)));
});
for (const [field,value,effects] of [['motion','Pan left',['keeps_keyframe','clip_remade']],['imagePrompt','Blue ferry',['keyframe_remade','clip_remade']],['videoPrompt','Pan the ferry',['keeps_keyframe','clip_remade']]]) test(`${field} preview describes the media actually bound`,()=>{
 const {project,bindings}=fixture();assert.deepEqual(previewCreativePatch(project,{updateShots:[{id:'a',[field]:value}]},bindings).effects.map(e=>e.effect),effects);
});
test('no-op, absent media, scene purpose and narration effects',()=>{
 const {project,bindings}=fixture();assert.deepEqual(previewCreativePatch(project,{updateShots:[{id:'a',desiredFrames:180}]},bindings).effects,[]);
 assert.deepEqual(previewCreativePatch(project,{updateShots:[{id:'b',desiredFrames:240}]}).effects,[{shotId:'b',effect:'no_media_yet'}]);
 const scene=previewCreativePatch(project,{updateScenes:[{id:'scene',purpose:'Arrival'}]},bindings);assert.equal(scene.changes[0].sceneId,'scene');assert.deepEqual(scene.effects,[]);
 project.shots[0].cueId='voice';assert.ok(previewCreativePatch(project,{updateShots:[{id:'a',narration:{mode:'generated',text:'Welcome',voice:'stock'}}]},bindings).effects.some(e=>e.effect==='voice_remade'));
});
test('propose_change accepts only the shipped bounded creative updates in V5',()=>{
 const valid={patch:{updateShots:[{id:'a',desiredFrames:240}]}};assert.deepEqual(parseToolArguments('propose_change',valid,'5.0.0').arguments,valid);
 for(const input of [{patch:{}},{patch:{updateShots:[]}},{patch:{updateShots:[{id:'a'}]}},{...valid,source:'code'}, {patch:{updateShots:[{id:'a',reauthorPrompts:true}]}},{patch:{updateShots:[{id:'a',desiredFrames:0}]}},{patch:{createShots:[]}}, {patch:{updateScenes:[{id:'s',purpose:'ok',paid:true}]}}]) assert.throws(()=>parseToolArguments('propose_change',input,'5.0.0'),{code:'VALIDATION_ERROR'});
 assert.throws(()=>parseToolArguments('propose_change',valid,'4.0.0'),{code:'NOT_FOUND'});
});
for (const [field, value] of [['purpose', 'Reveal the passenger'], ['action', 'Passenger turns'], ['framing', 'Close-up']]) test(`V6 ${field} preview includes exact Now/After and media effects`, () => {
 const {project,bindings}=fixture(), before=structuredClone(project), preview=previewCreativePatch(project,{updateShots:[{id:'a',[field]:value}]},bindings);
 assert.deepEqual(preview.changes,[{shotId:'a',field,before:project.shots[0][field],after:value}]);
 assert.deepEqual(preview.effects.map(effect=>effect.effect),['keyframe_remade','clip_remade']);
 assert.deepEqual(project,before);
});
test('V6 scene-title and purpose previews remain independent and describe exact title removal',()=>{
 const {project}=fixture();project.scenes[0].title='Harbor';
 assert.deepEqual(previewCreativePatch(project,{updateScenes:[{id:'scene',title:'Last Ferry'}]}).changes,[{sceneId:'scene',field:'title',before:'Harbor',after:'Last Ferry'}]);
 assert.deepEqual(previewCreativePatch(project,{updateScenes:[{id:'scene',title:'Last Ferry',purpose:'Leaving port'}]}).changes,[{sceneId:'scene',field:'title',before:'Harbor',after:'Last Ferry'},{sceneId:'scene',field:'purpose',before:'Departure',after:'Leaving port'}]);
 assert.deepEqual(previewCreativePatch(project,{updateScenes:[{id:'scene',title:null}]}).changes,[{sceneId:'scene',field:'title',before:'Harbor',after:'null'}]);
});
test('multi-field proposal preview identity survives canonical persistence and input field reordering',()=>{
 const {project,bindings}=fixture(), patch={updateShots:[{id:'a',purpose:'Reveal passenger',action:'Passenger turns',framing:'Close-up',desiredFrames:240}],updateScenes:[{id:'scene',title:'Last Ferry',purpose:'Leave port'}]};
 const preview=previewCreativePatch(project,patch,bindings),reloaded=previewCreativePatch(project,JSON.parse(canonical(patch)),bindings);
 assert.deepEqual(reloaded,preview);assert.equal(proposalPreviewDigest(reloaded),proposalPreviewDigest(preview));
});
test('removing legacy audio-led narration previews the same cue removal as publication',()=>{
 const {project,bindings}=fixture(),shot=project.shots[0];shot.cueId='cue';project.cues=[{id:'cue',meaning:'Old line',durationFrames:180}];
 bindings.a[1].node.intentDigest=shotIntentDigest(shot,'video',project.cues[0]);
 const result=previewCreativePatch(project,{updateShots:[{id:'a',narration:{mode:'none',text:'',voice:'stock'}}]},bindings);
 assert.deepEqual(result.effects.map(e=>e.effect),['keeps_keyframe','clip_remade','voice_remade']);
});

for (const kind of ['image', 'video', 'speech']) test(`running ${kind} without returned output warns when its result would be outdated`, () => {
 const {project,bindings}=fixture(),shot=project.shots[0];
 const running={node:{kind,intentDigest:kind==='speech'?'':shotIntentDigest(shot,kind),args:{prompt:kind==='image'?shot.imagePrompt:shot.videoPrompt}},outputs:{},running:true};
 const row=kind==='image'?{imagePrompt:'New frame'}:kind==='video'?{desiredFrames:240}:{narration:{mode:'generated',text:'New line',voice:'stock'}};
 const preview=previewCreativePatch(project,{updateShots:[{id:shot.id,...row}]},{a:[...bindings.a,running]});
 assert.equal(preview.effects.filter(e=>e.effect==='discards_running').length,1);
 assert.ok(!previewCreativePatch(project,{updateShots:[{id:shot.id,...row}]},bindings).effects.some(e=>e.effect==='discards_running'));
});
test('running replacement warns once, while unrelated running work and non-media changes do not',()=>{
 const {project,bindings}=fixture();
 const image={...bindings.a[0],running:true},video={...bindings.a[1],running:true};
 assert.equal(previewCreativePatch(project,{updateShots:[{id:'a',imagePrompt:'New frame'}]},{a:[image,video]}).effects.filter(e=>e.effect==='discards_running').length,1);
 assert.ok(!previewCreativePatch(project,{updateShots:[{id:'a',desiredFrames:240}]},{a:[image]}).effects.some(e=>e.effect==='discards_running'));
 assert.ok(!previewCreativePatch(project,{updateShots:[{id:'b',motion:'Pan'}]},{a:[video]}).effects.some(e=>e.effect==='discards_running'));
 assert.ok(!previewCreativePatch(project,{updateScenes:[{id:'scene',purpose:'New scene text'}]},{a:[video]}).effects.some(e=>e.effect==='discards_running'));
});
