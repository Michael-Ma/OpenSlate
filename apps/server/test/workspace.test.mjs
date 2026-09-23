import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { DirectorSupervisor } from '../dist/application/director-supervisor.js';
import { FakeWorkflowDirector } from '../dist/application/fake-director.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { createApp } from '../dist/app.js';

function writable(path){chmodSync(path,0o755);for(const item of readdirSync(path,{withFileTypes:true}))if(item.isDirectory())writable(join(path,item.name));}
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'openslate-workspace-')),store=new Store(join(root,'app.sqlite')),provider=new FakeProvider(join(root,'provider.sqlite'));
  const engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),service=new ProductionService(store,engine);
  const director=new DirectorSupervisor(service,new FakeWorkflowDirector(service),{mode:'fake',prepareInput:createDirectorInput(service,{repositoryRoot:fileURLToPath(new URL('../../../',import.meta.url)),snapshotRoot:join(root,'skills'),endpoint:'http://127.0.0.1:3001'})});
  const token=randomBytes(32).toString('base64url'),app=createApp({service,director,localToken:token});
  const req=(method,url,payload,key='')=>app.inject({method,url,payload,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,...(key?{'idempotency-key':key}:{})}});
  t.after(async()=>{await director.close();await app.close();store.close();provider.close();writable(root);rmSync(root,{recursive:true,force:true});});
  const drain=async()=>{for(let i=0;i<6;i++){await engine.reconcile();await engine.runReady();}};
  return{root,store,provider,engine,service,director,app,req,drain};
}

test('browser API drives a persistent offline demo, exact review, and a scoped replacement',async t=>{
  const f=fixture(t);
  const project=(await f.req('POST','/api/projects',{name:'My boots demo'})).json(),path=`/api/projects/${project.id}`;
  assert.equal((await f.req('GET','/api/projects')).json().projects[0].id,project.id);
  assert.deepEqual((await f.req('GET',`${path}/review`)).json().members,[]);
  const first=await f.req('POST',`${path}/demo`,{action:'create'},'first');assert.equal(first.statusCode,200,first.body);
  await f.director.settle();await f.drain();
  assert.equal(f.director.turns(project.id)[0].state,'completed',JSON.stringify(f.director.turns(project.id)));
  assert.equal(f.provider.acceptedCount(),2,'only keyframes before review');
  const review=(await f.req('GET',`${path}/review`)).json();
  assert.ok(review.members.every(member=>member.ready&&!member.approved));
  assert.ok(review.members.every(member=>member.motionPrompt&&member.durationFrames===180));
  assert.equal((await f.req('GET',`${path}/review`)).json().id,review.id,'unchanged review is cached');
  const frame=review.members[0].keyframe,bytes=await f.req('GET',`${path}/artifacts/${frame.artifactId}/content`);
  assert.equal(bytes.statusCode,200,bytes.body);assert.equal(createHash('sha256').update(bytes.rawPayload).digest('hex'),frame.sha256);
  const approval=await f.req('POST',`${path}/approvals`,{snapshotId:review.id,videoNodeIds:review.members.map(member=>member.videoNodeId)},'review');assert.equal(approval.statusCode,200,approval.body);
  await f.drain();assert.equal(f.provider.acceptedCount(),4);
  const current=f.store.getProject(project.id),before=f.engine.outputs(project.id),secondId=current.shots[1].id;
  const secondNodes=f.store.get('plan',current.activePlanId).compiled.nodes.filter(node=>node.shotId===secondId).map(node=>node.id);
  const preserved=before.filter(output=>secondNodes.includes(output.nodeId));
  const edit=await f.req('POST',`${path}/demo`,{action:'close_up',shotId:current.shots[0].id},'edit');assert.equal(edit.statusCode,200,edit.body);
  await f.director.settle();await f.drain();
  assert.equal(f.director.turns(project.id).at(-1).state,'completed',JSON.stringify(f.director.turns(project.id)));
  assert.equal(f.provider.acceptedCount(),5);
  assert.deepEqual(f.engine.outputs(project.id).filter(output=>secondNodes.includes(output.nodeId)),preserved);
  const refreshed=(await f.req('GET',`${path}/review`)).json();
  assert.ok(!refreshed.members.find(member=>member.shotId===current.shots[0].id).approved);
  assert.ok(refreshed.members.find(member=>member.shotId===secondId).approved);
  const stale=await f.req('POST',`${path}/approvals`,{snapshotId:review.id,videoNodeIds:[review.members[0].videoNodeId]},'stale');assert.equal(stale.statusCode,409);
  const response=(await f.req('GET',path)).json();assert.equal(response.conversation.filter(item=>item.role==='assistant').length,2);
  assert.ok(response.plan.canonicalSource.includes('humanReview'));
  assert.equal(response.previousPreviews.length,1,'old completed render remains available while its logical binding is replaced');
  assert.equal((await f.req('GET',`${path}/artifacts/${response.previousPreviews[0].artifact.artifactId}/content`)).statusCode,200);
  assert.equal(f.store.list('skill_activation',project.id).length,2);
  assert.equal(f.store.list('director_skill_lock',project.id).length,1);
  const reads=f.store.list('skill_read',project.id);
  for(const {activation} of f.store.list('skill_activation',project.id)) {
    const expected=activation.skills.flatMap(skill=>{
      const root=dirname(skill.entryPath),manifest=JSON.parse(readFileSync(join(root,'openslate.skill.json'),'utf8'));
      return manifest.files.map(path=>({skillId:skill.id,path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}));
    });
    const actual=reads.filter(read=>read.evidence.activationId===activation.activationId).map(({evidence:{skillId,path,sha256}})=>({skillId,path,sha256}));
    const sort=rows=>rows.sort((a,b)=>`${a.skillId}:${a.path}`.localeCompare(`${b.skillId}:${b.path}`));
    assert.deepEqual(sort(actual),sort(expected),'each turn receives every declared immutable reference exactly once');
  }
});

test('demo retries preserve one turn and one set of generation grants',async t=>{
  const f=fixture(t),project=f.service.createProject('Retry'),path=`/api/projects/${project.id}/demo`;
  const first=await f.req('POST',path,{action:'create'},'same');const second=await f.req('POST',path,{action:'create'},'same');
  assert.deepEqual(second.json(),first.json());await f.director.settle();
  assert.equal(f.director.turns(project.id).length,1);assert.equal(f.store.list('grant',project.id).length,4);
  assert.equal((await f.req('POST',path,{action:'wide',shotId:f.store.getProject(project.id).shots[0].id},'same')).statusCode,409);
});

test('lost create/control responses can be replayed without duplicate projects or events',async t=>{
  const f=fixture(t);
  const first=(await f.req('POST','/api/projects',{name:'One project'},'create-project')).json();
  const second=(await f.req('POST','/api/projects',{name:'One project'},'create-project')).json();
  assert.equal(first.id,second.id);assert.equal(f.store.listProjects().length,1);
  assert.equal((await f.req('POST','/api/projects',{name:'Different'},'create-project')).statusCode,409);
  const path=`/api/projects/${first.id}/controls`;
  await f.req('POST',path,{action:'pause'},'pause');const cursor=f.store.cursor(first.id);
  await f.req('POST',path,{action:'pause'},'pause');assert.equal(f.store.cursor(first.id),cursor);
  assert.equal((await f.req('POST',path,{action:'resume'},'pause')).statusCode,409);
});

test('ordinary conversation never silently grants media or overwrites a nonempty project',async t=>{
  const f=fixture(t),project=f.service.createProject('Chat'),path=`/api/projects/${project.id}`;
  const response=await f.req('POST',`${path}/messages`,{text:'Create a cinematic film'},'message');assert.equal(response.json().status,'queued');await f.director.settle();
  assert.equal(f.store.list('grant',project.id).length,0);assert.equal(f.store.list('candidate',project.id).length,0);
  assert.match(f.service.snapshot(project.id).conversation.at(-1).text,/scripted demonstration/);
  const current=f.store.getProject(project.id);f.store.saveProject({...current,brief:'My creative intent'},current.headVersion);
  const rejected=await f.req('POST',`${path}/demo`,{action:'create'},'overwrite');assert.equal(rejected.statusCode,409);
  assert.equal(f.store.getProject(project.id).brief,'My creative intent');
});

test('a fresh project accepts read-only chat with application-selected skills and no edit hold',async t=>{
  const f=fixture(t),project=f.service.createProject('Read only');
  const response=await f.req('POST',`/api/projects/${project.id}/messages`,{text:'How does review work?',editing:false},'read-only');
  assert.equal(response.statusCode,200,response.body);await f.director.settle();
  assert.equal(f.director.turns(project.id)[0].state,'completed');
  assert.equal(f.store.list('hold',project.id).length,0);assert.equal(f.store.list('director_skill_lock',project.id).length,1);
  assert.equal(f.store.list('grant',project.id).length,0);assert.equal(f.store.getProject(project.id).headVersion,0);
});

test('artifact preview cannot cross projects and rejects changed bytes',async t=>{
  const f=fixture(t),project=f.service.createProject('Artifacts'),other=f.service.createProject('Other');
  await f.req('POST',`/api/projects/${project.id}/demo`,{action:'create'},'create');await f.director.settle();await f.drain();
  const ref=f.engine.outputs(project.id)[0].artifact;
  assert.equal((await f.req('GET',`/api/projects/${other.id}/artifacts/${ref.artifactId}/content`)).statusCode,404);
  const artifact=f.store.get('artifact',ref.artifactId);writeFileSync(artifact.path,'tampered');
  assert.equal((await f.req('GET',`/api/projects/${project.id}/artifacts/${ref.artifactId}/content`)).json().error.code,'ARTIFACT_CORRUPT');
});
