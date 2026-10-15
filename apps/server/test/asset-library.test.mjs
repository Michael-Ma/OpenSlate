import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, projectFixture } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { createApp } from '../dist/app.js';
const token='asset-library-test-token-123456789';
test('asset library includes saved takes, filters before paging, and exposes no internal paths or other projects', async t => {
 const f=setup(t), service=new ProductionService(f.store,f.engine), app=createApp({service,localToken:token,logger:false});t.after(()=>app.close());
 for(let n=0;n<45;n++) {
  const id=`asset-${String(n).padStart(3,'0')}`;
  f.store.insert('artifact',id,f.projectId,{id,projectId:f.projectId,artifact:{artifactId:id,kind:n===0?'audio':n%2?'image':'video',sha256:'a'.repeat(64)},path:'/private/secret/file',mimeType:'image/png',fixture:false,attemptId:null,physicalDurationSeconds:null,origin:n%2?'supplied_image':'generated_video',providerReceipt:'must-not-leak'});
 }
 f.store.createProject(projectFixture('different-project'));
 f.store.insert('artifact','foreign','different-project',{id:'foreign',artifact:{artifactId:'foreign',kind:'image',sha256:'b'.repeat(64)}});
 const get=(q='',authenticated=true)=>app.inject({url:`/api/projects/${f.projectId}/assets${q}`,headers:{host:'127.0.0.1',...(authenticated?{authorization:`Bearer ${token}`}:{})}});
 const first=await get();assert.equal(first.statusCode,200,first.body);assert.equal(first.json().total,45);assert.equal(first.json().assets.length,40);assert.equal(first.json().nextOffset,40);
 assert.doesNotMatch(first.body,/private|providerReceipt|must-not-leak|foreign/);
 const second=(await get('?offset=40')).json();assert.equal(second.assets.length,5);assert.equal(second.nextOffset,null);
 const filtered=(await get('?kind=image&source=uploaded')).json();assert.equal(filtered.total,22);assert.ok(filtered.assets.every(a=>a.source==='imported'&&a.artifact.kind==='image'));
 assert.equal((await get('?search=asset-044')).json().total,1);
 assert.notEqual((await get('',false)).statusCode,200);assert.notEqual((await get('?offset=-1')).statusCode,200);assert.equal((await get('?kind=audio')).json().total,1);
 assert.equal(f.engine.attempts(f.projectId).length,0);
});

test('one film lists keyframe takes, clip, voice, music, upload and export with scoped identity and stable paging filters',async t=>{
 const f=setup(t),service=new ProductionService(f.store,f.engine),app=createApp({service,localToken:token});t.after(()=>app.close());
 await f.engine.runReady();await f.engine.reconcile();const review=f.engine.reviewSnapshot(f.projectId);
 f.engine.approve(f.projectId,review.id,[review.members[0].videoNodeId],'offline-library-review');await f.engine.runReady();await f.engine.reconcile();
 const p=f.store.getProject(f.projectId),frame=f.store.list('artifact',p.id).find(x=>x.artifact.kind==='image'),shotId=f.store.get('node_binding',f.store.get('attempt',frame.attemptId).nodeId).node.shotId;
 f.store.insert('artifact','older-saved-take',p.id,{...frame,id:'older-saved-take',artifact:{...frame.artifact,artifactId:'older-saved-take'}});
 const media=id=>({kind:'audio',sha256:'a'.repeat(64),byteLength:192044,probe:{audio:{samples:48000,sampleRate:48000,channels:2}}});
 for(const [id,role] of [['voice-line','voice'],['music','music'],['upload','upload']]){
  f.store.insert('narration_audio',id,p.id,{media:media(id),declaredOrigin:'uploaded',requestId:'offline',role});
  f.store.insert('audio_library_label',id,p.id,{label:`Library ${role}`,role});
 }
 const cue={id:'cue-library',audio:{artifactId:'voice-line',sha256:'a'.repeat(64),kind:'audio'},accepted:true,durationFrames:30,measured:true};
 p.shots.find(s=>s.id===shotId).cueId=cue.id;p.cues=[cue];p.soundtrack={audioId:'music',gainMilliDb:-18000};f.store.saveProject(p,p.headVersion);
 f.store.insert('narration_canonical','canonical-library',p.id,{shotMappings:[{shotId,segmentId:'segment'}],segments:[{segmentId:'segment',cue,provenance:{audioId:'voice-line',originEvidence:'human_declared_supplied_recording'}}]});
 f.store.put('narration_canonical_head',p.id,p.id,{canonicalId:'canonical-library'});
 f.store.insert('artifact','export-library',p.id,{artifact:{artifactId:'export-library',kind:'video',sha256:'e'.repeat(64)},origin:'local_render',fixture:false,attemptId:null,physicalDurationSeconds:12});
 f.store.put('media_preview',p.id,p.id,{artifact:{artifactId:'export-library'}});
 const get=async q=>{const response=await app.inject({url:`/api/projects/${p.id}/assets${q??''}`,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`}});assert.equal(response.statusCode,200,response.body);return response.json();};
 const all=(await get()).assets,frames=all.filter(x=>x.role==='keyframe'&&x.shotId===shotId);
 assert.deepEqual(frames.map(x=>x.takeIndex),[2,1]);assert.deepEqual(frames.map(x=>x.current),[false,true]);assert.ok(frames.every(x=>x.sceneId===p.shots.find(s=>s.id===shotId).sceneId&&x.source==='demo'));
 const clip=all.find(x=>x.role==='clip');assert.equal(clip.shotId,shotId);assert.equal(clip.takeIndex,1);assert.equal(clip.current,true);
 const voice=all.find(x=>x.role==='voice');assert.equal(voice.shotId,shotId);assert.equal(voice.current,true);assert.equal(voice.source,'imported');assert.equal(voice.durationSeconds,1);
 assert.equal(all.find(x=>x.role==='music').current,true);assert.equal(all.find(x=>x.role==='upload').current,false);assert.equal(all.find(x=>x.role==='export').current,true);
 assert.ok(all.every(x=>Date.parse(x.createdAt)>0&&x.label));assert.equal((await get('?role=voice')).total,1);
 assert.equal((await get(`?shotId=${shotId}`)).total,4);assert.equal((await get(`?sceneId=${voice.sceneId}&kind=audio`)).total,1);
 assert.equal((await get('?role=music&shotId=foreign')).total,0);assert.equal(f.provider.acceptedCount(),3);
});
