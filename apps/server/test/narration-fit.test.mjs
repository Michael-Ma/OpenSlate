import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { narrationFitFrames } from '../dist/narration-fit.js';
import { projectAudioPlacements, storyboardAudioCuts } from '../dist/narration/audio-placement.js';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';

test('fit rounds 7.4 seconds to eight and respects locked model min/max', () => {
  assert.equal(narrationFitFrames(180, 355200, { minFrames: 90, maxFrames: 450 }, 'extend_shot'), 240);
  assert.equal(narrationFitFrames(180, 355200, { minFrames: 90, maxFrames: 450 }, 'cut_to_shot'), 180);
  assert.throws(() => narrationFitFrames(180, 355200, { maxFrames: 180 }, 'extend_shot'), { code: 'PROFILE_INCOMPATIBLE' });
  assert.throws(() => narrationFitFrames(180, 800000, {}, 'extend_shot'), { code: 'PROFILE_INCOMPATIBLE' });
  assert.equal(narrationFitFrames(90, 48000, { minFrames: 180 }, 'extend_shot'), 180);
});
for (const fit of ['extend_shot', 'cut_to_shot']) test(`${fit} accepts exact narration, preserves the frame, re-quotes and undoes as one command`, async t => {
  const f = await confirmationFixture(t, { seconds: 7.4 }); await f.make(); await f.tick(12);
  const project = f.store.getProject(f.project.id), before = await f.overview(), key = randomUUID();
  const payload = { fit, expectedHeadVersion: project.headVersion }, receipt = await f.call('POST', '/shots/shot-0/narration-fit', payload, key).then(f.ok);
  assert.equal(receipt.durationFrames, fit === 'extend_shot' ? 240 : 180);
  const saved = f.store.getProject(project.id), shot = saved.shots[0], cue = saved.cues.find(c => c.id === shot.cueId), view = await f.overview();
  assert.equal(shot.narrationPending, false); assert.equal(shot.narrationFit, fit);
  assert.equal(cue.durationFrames, fit === 'cut_to_shot' ? 180 : 222);
  assert.deepEqual(view.shots['shot-0'].keyframe.artifact, before.shots['shot-0'].keyframe.artifact);
  assert.equal(view.shots['shot-0'].narration.fit, fit); assert.equal(view.shots['shot-0'].narration.fits, true);
  assert.equal(view.shots['shot-0'].narration.measuredSeconds, 7.4);
  assert.ok(!view.scenes[0].blockers.some(b => b.code === 'narration_too_long'));
  assert.equal(view.scenes[0].quotes.confirmVideo.units, 2);
  assert.notEqual(view.scenes[0].confirmationDigest, before.scenes[0].confirmationDigest);
  const segment = f.canonical.workspaceCurrent(project.id).segments[0];
  const placement = projectAudioPlacements(segment, storyboardAudioCuts(saved))[0];
  if (fit === 'cut_to_shot') { assert.equal(placement.durationSamples, 180 * 1600); assert.equal(placement.fadeOutSamples, 3840); }
  else assert.equal(placement.fadeOutSamples, undefined);
  assert.deepEqual(await f.call('POST', '/shots/shot-0/narration-fit', payload, key).then(f.ok), receipt);
  assert.equal(f.calls.speech, 1);
  await f.call('POST', '/storyboard', { kind: 'undo', commandId: receipt.commandId, expectedHeadVersion: saved.headVersion }).then(f.ok);
  const undone = f.store.getProject(project.id).shots[0];
  assert.equal(undone.desiredFrames, 180); assert.equal(undone.narrationFit, undefined); assert.equal(undone.narrationPending, true);
  assert.equal((await f.overview()).shots['shot-0'].narration.fits, false);
  assert.equal(undone.cueId, project.shots[0].cueId);
  assert.deepEqual(f.store.getProject(project.id).cues, project.cues);
  assert.deepEqual(f.canonical.workspaceCurrent(project.id).segments, []);
  assert.deepEqual((await f.overview()).shots['shot-0'].keyframe.artifact, before.shots['shot-0'].keyframe.artifact);
});

test('fit rejects missing voice, stale version, invalid choice and absent command identity without changes', async t => {
  const f = await confirmationFixture(t), before = f.store.cursor(f.project.id);
  for (const [body, key, code] of [
    [{ fit: 'extend_shot', expectedHeadVersion: f.project.headVersion }, undefined, 'NARRATION_RECORDING_REQUIRED'],
    [{ fit: 'cut_to_shot', expectedHeadVersion: 999 }, undefined, 'REVISION_CONFLICT'],
    [{ fit: 'invented', expectedHeadVersion: f.project.headVersion }, undefined, 'VALIDATION_ERROR'],
    [{ fit: 'cut_to_shot', expectedHeadVersion: f.project.headVersion }, null, 'IDEMPOTENCY_KEY_REQUIRED'],
  ]) {
    const r = await f.call('POST', '/shots/shot-0/narration-fit', body, key); assert.equal(r.json().error.code, code, r.body);
    assert.equal(f.store.cursor(f.project.id), before);
  }
});

test('undo a second fit re-commits the previous accepted cue and exact canonical projection', async t => {
  const f = await confirmationFixture(t, { seconds: 7.4 }); await f.make(); await f.tick(12);
  await f.call('POST', '/shots/shot-0/narration-fit', { fit: 'cut_to_shot', expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const before = f.store.getProject(f.project.id), canonical = f.canonical.workspaceCurrent(f.project.id);
  const receipt = await f.call('POST', '/shots/shot-0/narration-fit', { fit: 'extend_shot', expectedHeadVersion: before.headVersion }).then(f.ok);
  assert.equal(f.store.getProject(f.project.id).shots[0].desiredFrames, 240);
  await f.call('POST', '/storyboard', { kind: 'undo', commandId: receipt.commandId, expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
  const after = f.store.getProject(f.project.id), restored = f.canonical.workspaceCurrent(f.project.id);
  assert.equal(after.shots[0].desiredFrames, 180); assert.equal(after.shots[0].cueId, before.shots[0].cueId);
  assert.deepEqual(after.cues, before.cues); assert.deepEqual(restored.segments, canonical.segments);
  assert.deepEqual(restored.shotMappings, canonical.shotMappings); assert.notEqual(restored.id, canonical.id);
  assert.equal(restored.headVersion, after.headVersion); assert.equal(f.calls.speech, 1);
});
test('fit and media-restoring Undo preserve Director authority while fencing the older duration field',async t=>{
 const f=await confirmationFixture(t,{seconds:7.4});await f.make();await f.tick(12);
 const p=f.store.getProject(f.project.id),before=await f.overview(),human=f.production.beginRequest(p.id,'local-user','Keep planning the film'),bridge=f.production.openEpoch(p.id,human);
 f.store.insert('director_context','fit-captured',p.id,{requestId:human.requestId,epochId:bridge.actor.epochId,snapshot:f.production.readContext(p.id,bridge.actor)});
 const holds=f.store.list('hold',p.id).filter(h=>h.active&&h.ownerId===human.requestId);
 const receipt=await f.call('POST','/shots/shot-0/narration-fit',{fit:'extend_shot',expectedHeadVersion:p.headVersion}).then(f.ok);
 assert.equal(f.store.get('epoch',bridge.actor.epochId).state,'active');assert.deepEqual(f.store.list('hold',p.id).filter(h=>h.active&&h.ownerId===human.requestId),holds);
 await assert.rejects(f.production.prepare(p.id,bridge.actor,{variant:'project',expectedHeadVersion:f.store.getProject(p.id).headVersion,creative:{updateShots:[{id:'shot-0',desiredFrames:180,reauthorPrompts:true}]}}),{code:'HUMAN_EDITED_FIELD'});
 const record=f.store.get('storyboard_edit',receipt.commandId);assert.ok(record.undo.bindings.length);assert.equal(f.store.get('message',record.requestId).concurrency,'alongside');
 await f.call('POST','/storyboard',{kind:'undo',commandId:receipt.commandId,expectedHeadVersion:f.store.getProject(p.id).headVersion}).then(f.ok);
 assert.equal(f.store.get('epoch',bridge.actor.epochId).state,'active');assert.deepEqual((await f.overview()).shots['shot-0'].keyframe.artifact,before.shots['shot-0'].keyframe.artifact);assert.equal(f.calls.speech,1);
});
