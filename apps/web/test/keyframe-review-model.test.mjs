import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectKeyframe, inspectedApproval, inspectionMatches } from '../src/keyframe-review-model.ts';

function fixture() {
  const shot = { id: 'shot', revisionId:'shot-r', motion: 'Draft movement', desiredFrames: 90, framing:'Side view' };
  const snapshot = { project: { id:'p',headVersion:2,revisionId:'r',activePlanId:'plan',shots:[shot] } };
  const frame = {artifactId:'image',kind:'image',sha256:'a'.repeat(64)};
  const review = {id:'review',projectId:'p',planId:'plan',headVersion:2,revisionId:'r',members:[{shotId:'shot',videoNodeId:'video',keyframe:frame,ready:true,approved:false,approvalDigest:'digest',motionPrompt:'Exact reviewed movement',durationFrames:180,profileLabel:'Video model'}]};
  const inspection=inspectKeyframe(snapshot,review,shot,'blob:owned-frame',false);
  return {shot,snapshot,review,inspection,displayed:{video:frame.sha256}};
}
test('inspection captures compiled motion and duration without rewriting storyboard draft',()=>{
  const f=fixture();assert.equal(f.inspection.shot.motion,'Exact reviewed movement');assert.equal(f.inspection.shot.desiredFrames,180);
  assert.equal(f.shot.motion,'Draft movement');assert.equal(f.shot.desiredFrames,90);
  assert.deepEqual(inspectedApproval(f.inspection,f.snapshot,f.review,f.displayed,true,false),{snapshotId:'review',videoNodeIds:['video']});
});
test('project/revision/review changes retire inspection and cannot approve an old displayed frame',()=>{
  for(const mutate of [f=>{f.snapshot.project.id='other'},f=>{f.snapshot.project.headVersion++},f=>{f.snapshot.project.revisionId='new'},f=>{f.review.members[0].motionPrompt='Different motion'},f=>{f.review.members[0].keyframe.sha256='b'.repeat(64)}]){
    const f=fixture();mutate(f);assert.equal(inspectionMatches(f.inspection,f.snapshot,f.review),false);
    assert.throws(()=>inspectedApproval(f.inspection,f.snapshot,f.review,f.displayed,true,false));
  }
});
test('disconnected, disabled, undisplayed, already approved and stale project reviews fail closed',()=>{
  const f=fixture();assert.throws(()=>inspectedApproval(f.inspection,f.snapshot,f.review,f.displayed,false,false));
  assert.throws(()=>inspectedApproval(f.inspection,f.snapshot,f.review,f.displayed,true,true));
  assert.throws(()=>inspectedApproval(f.inspection,f.snapshot,f.review,{},true,false));
  f.review.headVersion=1;f.inspection=inspectKeyframe(f.snapshot,f.review,f.shot,'blob:owned-frame',false);
  assert.throws(()=>inspectedApproval(f.inspection,f.snapshot,f.review,f.displayed,true,false));
  const g=fixture();g.review.members[0].approved=true;g.inspection=inspectKeyframe(g.snapshot,g.review,g.shot,'blob:owned-frame',false);
  assert.throws(()=>inspectedApproval(g.inspection,g.snapshot,g.review,g.displayed,true,false));
});
test('ordinary owned-image inspection remains read-only without a current video review member',()=>{
  const f=fixture();const inspection=inspectKeyframe(f.snapshot,null,f.shot,'blob:reference',null);
  assert.equal(inspection.reviewNodeId,null);assert.equal(inspection.shot.motion,f.shot.motion);
  assert.throws(()=>inspectedApproval(inspection,f.snapshot,null,f.displayed,true,false));
});
