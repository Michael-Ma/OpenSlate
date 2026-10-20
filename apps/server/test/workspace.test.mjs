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
import { derivedShotPrompts } from '../dist/application/shot-prompts.js';

function writable(path){chmodSync(path,0o755);for(const item of readdirSync(path,{withFileTypes:true}))if(item.isDirectory())writable(join(path,item.name));}
function fixture(t,{toolContract='5.0.0'}={}){
  const root=mkdtempSync(join(tmpdir(),'openslate-workspace-')),store=new Store(join(root,'app.sqlite')),provider=new FakeProvider(join(root,'provider.sqlite'));
  const engine=new Engine(store,provider,{artifactDir:join(root,'artifacts')}),service=new ProductionService(store,engine);
  const director=new DirectorSupervisor(service,new FakeWorkflowDirector(service),{mode:'fake',prepareInput:createDirectorInput(service,{repositoryRoot:fileURLToPath(new URL('../../../',import.meta.url)),snapshotRoot:join(root,'skills'),endpoint:'http://127.0.0.1:3001',defaultToolContract:toolContract})});
  const token=randomBytes(32).toString('base64url'),app=createApp({service,director,localToken:token});
  const req=(method,url,payload,key='')=>app.inject({method,url,payload,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`,...(key?{'idempotency-key':key}:{})}});
  t.after(async()=>{await director.close();await app.close();store.close();provider.close();writable(root);rmSync(root,{recursive:true,force:true});});
  const drain=async()=>{for(let i=0;i<6;i++){await engine.reconcile();await engine.runReady();}};
  return{root,store,provider,engine,service,director,app,req,drain};
}

test('historical-plan diagnostics and service review preserve a persistent offline demo and scoped replacement',async t=>{
  const f=fixture(t,{toolContract:'4.0.0'});
  const project=(await f.req('POST','/api/projects',{name:'My boots demo'})).json(),path=`/api/projects/${project.id}`;
  assert.equal((await f.req('GET','/api/projects')).json().projects[0].id,project.id);
  assert.deepEqual((await f.req('GET',`${path}/review`)).json().members,[]);
  const first=await f.req('POST',`${path}/demo`,{action:'create'},'first');assert.equal(first.statusCode,200,first.body);
  await f.director.settle();await f.drain();
  assert.equal(f.director.turns(project.id)[0].state,'completed',JSON.stringify(f.director.turns(project.id)));
  assert.equal(f.provider.acceptedCount(),2,'only keyframes before review');
  // This historical proof is pinned to 4.0.0 (card R5): the scripted fake supervisor keeps its lock.
  assert.equal(f.store.list('director_skill_lock',project.id).at(-1).lock.compatibility.toolContract,'4.0.0');
  const review=(await f.req('GET',`${path}/review`)).json();
  assert.ok(review.members.every(member=>member.ready&&!member.approved));
  assert.ok(review.members.every(member=>member.motionPrompt&&member.durationFrames===180));
  assert.equal(review.id,null,'inspection cannot mint an approval identity');
  assert.deepEqual((await f.req('GET',`${path}/review`)).json(),review);
  const frame=review.members[0].keyframe,bytes=await f.req('GET',`${path}/artifacts/${frame.artifactId}/content`);
  assert.equal(bytes.statusCode,200,bytes.body);assert.equal(createHash('sha256').update(bytes.rawPayload).digest('hex'),frame.sha256);
  const snapshot=f.engine.reviewSnapshot(project.id), reviewer=f.service.beginRequest(project.id,'local-user','Review exact historical plan frames',{editing:false});
  f.service.approve(project.id,reviewer,snapshot.id,review.members.map(member=>member.videoNodeId));
  await f.drain();assert.equal(f.provider.acceptedCount(),4);
  const current=f.store.getProject(project.id),before=f.engine.outputs(project.id),secondId=current.shots[1].id;
  const secondNodes=f.store.get('plan',current.activePlanId).compiled.nodes.filter(node=>node.shotId===secondId).map(node=>node.id);
  const preserved=before.filter(output=>secondNodes.includes(output.nodeId));
  const edit=await f.req('POST',`${path}/demo`,{action:'close_up',shotId:current.shots[0].id},'edit');assert.equal(edit.statusCode,200,edit.body);
  await f.director.settle();await f.drain();
  assert.equal(f.director.turns(project.id).at(-1).state,'completed',JSON.stringify(f.director.turns(project.id)));
  assert.equal(f.provider.acceptedCount(),5);
  // Pinned to 4.0.0, the scripted edit keeps its historical descriptive framing (6.0.0 scripts use the short label).
  assert.equal(f.store.getProject(project.id).shots[0].framing,'Extreme close-up of stitching');
  assert.deepEqual(f.engine.outputs(project.id).filter(output=>secondNodes.includes(output.nodeId)),preserved);
  const refreshed=(await f.req('GET',`${path}/review`)).json();
  assert.ok(!refreshed.members.find(member=>member.shotId===current.shots[0].id).approved);
  assert.ok(refreshed.members.find(member=>member.shotId===secondId).approved);
  const staleReviewer=f.service.beginRequest(project.id,'local-user','Review earlier historical plan frames',{editing:false});
  assert.throws(()=>f.service.approve(project.id,staleReviewer,snapshot.id,[review.members[0].videoNodeId]),{code:'REVIEW_SPEC_MISMATCH'});
  const response=(await f.req('GET',path)).json();assert.equal(response.conversation.filter(item=>item.role==='assistant').length,2);
  assert.ok(response.plan.canonicalSource.includes('humanReview'));
  assert.equal(response.previousPreviews.length,1,'old completed render remains available while its logical binding is replaced');
  assert.equal((await f.req('GET',`${path}/artifacts/${response.previousPreviews[0].artifact.artifactId}/content`)).statusCode,200);
  assert.equal(f.store.list('skill_activation',project.id).length,2);
  assert.equal(f.store.list('director_skill_lock',project.id).length,1);
  assert.equal(f.store.list('director_skill_lock',project.id)[0].lock.compatibility.toolContract,'4.0.0','historical plan replacement keeps its exact legacy contract');
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

for(const toolContract of ['5.0.0','6.0.0']) for(const action of ['close_up','wide']) test(`${toolContract} demo ${action} holds a noted proposal with paid-media effects; accepting publishes without generation`,async t=>{
  const f=fixture(t,{toolContract}),project=f.service.createProject('Modern demo'),path=`/api/projects/${project.id}`;
  const created=await f.req('POST',`${path}/demo`,{action:'create'},'create');assert.equal(created.statusCode,200,created.body);
  await f.director.settle();await f.drain();
  const review=f.engine.reviewSnapshot(project.id),reviewer=f.service.beginRequest(project.id,'local-user','Review exact demo frames',{editing:false});
  f.service.approve(project.id,reviewer,review.id,review.members.map(member=>member.videoNodeId));
  await f.drain();
  const before=f.store.getProject(project.id),outputs=f.engine.outputs(project.id),count=f.provider.acceptedCount(),attempts=f.engine.attempts(project.id);
  assert.equal(count,4,'both shots have returned frames and clips before the demo edit');
  const shot=before.shots[0],other=before.shots[1],framing=action==='close_up'?'Extreme close-up':'Wide';
  const prompts=derivedShotPrompts(shot,{framing});
  const edit=await f.req('POST',`${path}/demo`,{action,shotId:shot.id},'edit');assert.equal(edit.statusCode,200,edit.body);
  await f.director.settle();await f.drain();
  const turn=f.director.turns(project.id).at(-1);assert.equal(turn.state,'completed',JSON.stringify(turn));
  assert.deepEqual(f.store.getProject(project.id),before);assert.deepEqual(f.engine.outputs(project.id),outputs);assert.equal(f.provider.acceptedCount(),count);
  assert.deepEqual(f.engine.attempts(project.id),attempts,'proposing never dispatches or charges replacement work');
  const proposals=(await f.req('GET',`${path}/director/proposals`)).json().proposals;assert.equal(proposals.length,1);
  const proposal=proposals[0];assert.equal(proposal.state,'held');assert.equal(proposal.requestId,turn.requestId);
  assert.deepEqual(proposal.preview.effects,[{shotId:shot.id,effect:'keyframe_remade'},{shotId:shot.id,effect:'clip_remade'}]);
  for(const [field,after] of Object.entries(prompts)) {
    assert.deepEqual(proposal.preview.changes.find(row=>row.field===field),{shotId:shot.id,field,before:shot[field],after});
    assert.match(after,/OpenSlate current direction:/);assert.ok(after.includes(framing));assert.ok(after.endsWith(shot[field]),'independent reference details survive');
  }
  assert.deepEqual(proposal.preview.changes.map(row=>row.field).sort(),toolContract==='6.0.0'?['framing','imagePrompt','videoPrompt']:['imagePrompt','videoPrompt']);
  const notes=f.service.snapshot(project.id).notes;assert.equal(notes.length,1);assert.equal(notes[0].kind,'recommendation');assert.equal(notes[0].blocking,true);
  assert.equal(notes[0].noteId,proposal.noteId);assert.deepEqual(notes[0].anchor,{shotIds:[shot.id]});
  assert.deepEqual(notes[0].choices,[{kind:'proposal',proposalId:proposal.proposalId},{kind:'accept',label:'Keep current direction'}]);
  assert.match(f.service.snapshot(project.id).conversation.at(-1).text,/proposal is ready/);
  const tools=f.store.list('tool_invocation',project.id).filter(call=>call.requestId===turn.requestId);
  assert.deepEqual(tools.map(call=>call.tool),['read_context','propose_change','record_notes']);assert.ok(tools.every(call=>call.state==='succeeded'));
  const replay=await f.req('POST',`${path}/demo`,{action,shotId:shot.id},'edit');assert.deepEqual(replay.json(),edit.json());
  await f.director.settle();assert.equal(f.store.list('director_proposal',project.id).length,1);assert.equal(f.service.snapshot(project.id).notes.length,1);
  const accepted=await f.req('POST',`${path}/director/proposals/${proposal.proposalId}/accept`,{previewDigest:proposal.previewDigest},'accept');
  assert.equal(accepted.statusCode,200,accepted.body);assert.equal(accepted.json().proposal.state,'accepted');
  await f.drain();
  const after=f.store.getProject(project.id);assert.equal(after.shots[0].framing,toolContract==='6.0.0'?framing:shot.framing);
  for(const [field,value] of Object.entries(prompts)) assert.equal(after.shots[0][field],value);
  assert.deepEqual(after.shots[1],other);assert.equal(f.service.snapshot(project.id).notes[0].state,'resolved');
  assert.equal(f.provider.acceptedCount(),count);assert.deepEqual(f.engine.attempts(project.id),attempts,'acceptance publishes direction without paid submissions');
  assert.deepEqual((await f.req('POST',`${path}/director/proposals/${proposal.proposalId}/accept`,{previewDigest:proposal.previewDigest},'accept')).json(),accepted.json());
  assert.equal(f.store.getProject(project.id).headVersion,after.headVersion);assert.equal(f.provider.acceptedCount(),count);
  const repeated=await f.req('POST',`${path}/demo`,{action,shotId:shot.id},'already-current');assert.equal(repeated.statusCode,200,repeated.body);
  await f.director.settle();await f.drain();assert.equal(f.director.turns(project.id).at(-1).state,'completed');
  assert.deepEqual(f.store.getProject(project.id),after);assert.equal(f.store.list('director_proposal',project.id).length,1,'a no-op cannot create an empty proposal');
  const noOpNote=f.service.snapshot(project.id).notes.at(-1);assert.equal(noOpNote.kind,'observation');assert.equal(noOpNote.blocking,false);
  assert.deepEqual(noOpNote.choices,[{kind:'accept',label:'Keep current direction'}]);assert.match(f.service.snapshot(project.id).conversation.at(-1).text,/already has/);
  assert.deepEqual(f.engine.attempts(project.id),attempts);assert.equal(f.provider.acceptedCount(),count);
  assert.equal(f.store.list('director_skill_lock',project.id)[0].lock.compatibility.toolContract,toolContract);
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
  const stop=await f.req('POST',path,{action:'stop'},'stop');assert.equal(stop.statusCode,200,stop.body);const cursor=f.store.cursor(first.id);
  const replay=await f.req('POST',path,{action:'stop'},'stop');assert.deepEqual(replay.json(),stop.json());assert.equal(f.store.cursor(first.id),cursor);
  const conflict=await f.req('POST',path,{action:'resume',expectedAuthorityId:stop.json().stopped.stopId},'stop');
  assert.equal(conflict.statusCode,409);assert.equal(conflict.json().error.code,'IDEMPOTENCY_CONFLICT');
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
