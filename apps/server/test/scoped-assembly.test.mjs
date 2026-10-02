import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductionService } from '../dist/application/service.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { FakeProvider } from '@openslate/providers';

async function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'openslate-scoped-assembly-')),store=new Store(join(root,'db.sqlite')),provider=new FakeProvider(join(root,'fake.sqlite')),engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),service=new ProductionService(store,engine),project=service.createProject('Scoped cut timing');
 t.after(()=>{store.close();provider.close();rmSync(root,{recursive:true,force:true});});
 const human=service.beginRequest(project.id,'human','Create two silent shots'),actor=service.openEpoch(project.id,human).actor;
 const draft=await service.prepare(project.id,actor,{variant:'project',expectedHeadVersion:0,creative:{brief:'A boots film',story:'Reveal then detail',createScenes:[{key:'scene',purpose:'Product'}],createShots:[0,1].map(i=>({key:`shot-${i}`,sceneId:'scene',purpose:`Shot ${i}`,action:'Boot',framing:'Close',motion:'Push',desiredFrames:180,imagePrompt:`Image ${i}`,videoPrompt:`Video ${i}`,referenceArtifactIds:[],cueId:null,narration:{mode:'none',text:'',voice:'stock'}}))}});service.apply(project.id,actor,draft.id);
 const saved=store.getProject(project.id);service.authorize(project.id,human,saved.shots.flatMap(shot=>[{scopeId:shot.id,kind:'image'},{scopeId:shot.id,kind:'video'}]),'slots');
 const prepared=await service.prepare(project.id,actor,{variant:'plan',expectedHeadVersion:saved.headVersion,source:source(saved)});service.apply(project.id,actor,prepared.id);
 await engine.runReady();await engine.reconcile();const review=engine.reviewSnapshot(project.id);service.approve(project.id,human,review.id,review.members.map(m=>m.videoNodeId));
 for(let i=0;i<3;i++){await engine.runReady();await engine.reconcile();}
 return{root,store,provider,engine,service,project:store.getProject(project.id)};
}
function source(project,options={}){
 let text=`definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{`;
 for(const[i,shot]of project.shots.entries()){const seconds=Math.ceil(shot.desiredFrames/30);text+=`const s${i}=p.shot(${JSON.stringify(shot.id)});const i${i}=p.image("image${i}",{intent:s${i},profile:"fake-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});const r${i}=p.humanReview("review${i}",{shots:[{intent:s${i},keyframe:i${i},videoProfile:"fake-video-v1",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:${seconds}}]});const v${i}=p.video("video${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(i${i},r${i}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:${seconds}});`;}
 return text+`const timeline=p.timeline("timeline",{takes:[${options.reverse?'v1,v0':'v0,v1'}]});return p.render("render",{timeline,width:${options.width??1280},height:720});});`;
}
test('a scoped silent shot duration rebuilds its derived cut total while preserving the other take and both frames',async t=>{
 const f=await fixture(t),beforeOutputs=f.engine.outputs(f.project.id),shot=f.project.shots[0],human=f.service.beginRequest(f.project.id,'human','Shorten only the first shot to four seconds',{scopeIds:[shot.id]}),actor=f.service.openEpoch(f.project.id,human).actor;
 const changed=await f.service.prepare(f.project.id,actor,{variant:'project',expectedHeadVersion:f.project.headVersion,creative:{updateShots:[{id:shot.id,desiredFrames:120,reauthorPrompts:true}]}});f.service.apply(f.project.id,actor,changed.id);
 let project=f.store.getProject(f.project.id);f.service.authorize(f.project.id,human,[{scopeId:shot.id,kind:'video'}],'replacement');
 const plan=await f.service.prepare(f.project.id,actor,{variant:'plan',expectedHeadVersion:project.headVersion,source:source(project)});f.service.apply(f.project.id,actor,plan.id);
 project=f.store.getProject(f.project.id);const saved=f.store.get('plan',project.activePlanId),timeline=saved.compiled.nodes.find(n=>n.kind==='timeline');assert.equal(timeline.args.durationFrames,300);
 for(const output of beforeOutputs.filter(o=>o.port==='image'||o.nodeId===saved.compiled.nodes.find(n=>n.alias==='video1').id))assert.equal(f.engine.outputs(f.project.id).find(o=>o.nodeId===output.nodeId).artifact.artifactId,output.artifact.artifactId);
 assert.equal(f.store.list('grant',f.project.id).filter(g=>g.authorityId===human.requestId).length,1);assert.equal(f.store.list('hold',f.project.id).filter(h=>h.active&&h.ownerId===human.requestId).length,0);
});
test('the duration exception cannot reorder cuts or change export geometry through a shot request',async t=>{
 const f=await fixture(t),shot=f.project.shots[0],human=f.service.beginRequest(f.project.id,'human','Keep only this shot scope',{scopeIds:[shot.id]}),actor=f.service.openEpoch(f.project.id,human).actor;
 for(const options of[{reverse:true},{width:1920}])await assert.rejects(f.service.prepare(f.project.id,actor,{variant:'plan',expectedHeadVersion:f.project.headVersion,source:source(f.project,options)}),{code:'SCOPE_DENIED'});
 assert.equal(f.store.getProject(f.project.id).headVersion,f.project.headVersion);
});
