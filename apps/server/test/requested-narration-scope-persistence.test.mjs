import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { canonical,digest } from '@openslate/core';
import { narrationSpeechFixture } from './narration-speech-fixture.mjs';
import { requestedNarrationShot } from '../dist/narration/narration-scope.js';
import { createInstallationBackup,inspectInstallationBackup } from '../dist/persistence/installation-backup.js';

async function fixture(t){
  const f=await narrationSpeechFixture(t),before=f.store.getProject(f.project.id),prepared=await f.production.prepare(f.project.id,f.actor,{variant:'project',expectedHeadVersion:before.headVersion,
    creative:{brief:'Boot details',story:'A short product film',createScenes:[{key:'scene',purpose:'Craft'}],createShots:[{key:'shot',sceneId:'scene',purpose:'Boot craftsmanship',action:'A boot on a bench',framing:'Close-up',motion:'Slow push',desiredFrames:180,imagePrompt:'A boot on a bench',videoPrompt:'Slow push toward a boot',referenceArtifactIds:[],cueId:null,narration:{mode:'generated',text:'Made with care.',voice:'stock'}}]}});
  f.production.apply(f.project.id,f.actor,prepared.id);const project=f.store.getProject(f.project.id),shot=project.shots[0];
  const result=f.narration.materializeRequestedShot(project.id,f.actor,{key:'saved-shot-request',expectedHeadVersion:project.headVersion,shotId:shot.id,intentDigest:digest({shotId:shot.id,narration:shot.narration}),voice:'coral',profileRevisionId:f.profile.revision});
  const scope=f.store.list('narration_requested_shot_scope',project.id)[0];assert.equal(scope.segmentId,result.segmentId);
  const close=()=>{for(const store of f.stores)if(store.db.open)store.close();if(f.provider.db.open)f.provider.close();};
  return{...f,scope,shot,close,backup:()=>createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,'scope-backup')})};
}
test('requested shot scope is immutable and validates its original request and saved project',async t=>{
  const f=await fixture(t),s=f.scope;assert.equal(requestedNarrationShot(f.store,f.project.id,s.requestId,s.principalId,s.segmentId),f.shot.id);
  assert.deepEqual(f.store.put('narration_requested_shot_scope',s.id,f.project.id,s),s);
  assert.throws(()=>f.store.put('narration_requested_shot_scope',s.id,f.project.id,{...s,projectDigest:'a'.repeat(64)}));
  assert.throws(()=>f.store.put('narration_requested_shot_scope',s.id,f.project.id,{...s,extra:true}));assert.deepEqual(f.store.get('narration_requested_shot_scope',s.id),s);
  assert.deepEqual(f.calls,{http:0,credentials:0});
});
for(const damage of ['missing-revision','foreign-principal','row-identity','out-of-scope-request'])test(`backup rejects requested scope ${damage}`,async t=>{
  const f=await fixture(t),s=f.scope;
  if(damage==='missing-revision')f.store.db.prepare("DELETE FROM entities WHERE kind='project_revision' AND id=?").run(s.projectRevisionId);
  else if(damage==='row-identity')f.store.db.prepare("UPDATE entities SET id='wrong-key' WHERE kind='narration_requested_shot_scope' AND id=?").run(s.id);
  else if(damage==='foreign-principal')f.store.db.prepare("UPDATE entities SET body=? WHERE kind='narration_requested_shot_scope' AND id=?").run(canonical({...s,principalId:'other-human'}),s.id);
  else {const request=f.store.get('message',s.requestId);f.store.db.prepare("UPDATE entities SET body=? WHERE kind='message' AND id=?").run(canonical({...request,scopeIds:[]}),s.requestId);}
  f.close();await assert.rejects(f.backup());assert.deepEqual(f.calls,{http:0,credentials:0});
});
test('superseded request and later shot edits do not invalidate retained scope backup',async t=>{
  const f=await fixture(t),s=f.scope,request=f.production.beginRequest(f.project.id,'human','Update the shot writing'),project=f.store.getProject(f.project.id);
  const change=await f.production.prepare(project.id,request,{variant:'project',expectedHeadVersion:project.headVersion,creative:{updateShots:[{id:f.shot.id,purpose:'Updated purpose',reauthorPrompts:true}]}});f.production.apply(project.id,request,change.id);
  assert.equal(requestedNarrationShot(f.store,f.project.id,s.requestId,s.principalId,s.segmentId),f.shot.id);f.close();const backup=await f.backup();await inspectInstallationBackup({directory:backup.directory});assert.deepEqual(f.calls,{http:0,credentials:0});
});

test('host materialization for a keyframe press uses the project narrator default when no voice is supplied',async t=>{
 const f=await fixture(t),before=f.store.getProject(f.project.id),{newId}=await import('@openslate/core');
 const project=f.store.saveProject({...before,revisionId:newId(),narratorVoice:'sage'},before.headVersion);f.store.insert('project_revision',project.revisionId,project.id,{project});
 const input={key:'keyframe-voice-default',expectedHeadVersion:project.headVersion,shotId:f.shot.id,intentDigest:digest({shotId:f.shot.id,narration:f.shot.narration}),profileRevisionId:f.profile.revision};
 const result=f.narration.materializeRequestedShot(project.id,f.actor,input);assert.equal(f.store.get('narration_segment',result.segmentRevisionId).source.voice,'sage');
 assert.deepEqual(f.narration.materializeRequestedShot(project.id,f.actor,input),result);assert.deepEqual(f.calls,{http:0,credentials:0});
});
