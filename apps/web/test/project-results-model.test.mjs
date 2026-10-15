import test from 'node:test';
import assert from 'node:assert/strict';
import { frameExposureIdentity, projectResults } from '../src/legacy/project-results-model.ts';

const artifact = (id, kind = 'image', sha = 'a') => ({ artifactId: id, kind, sha256: sha.repeat(64) });
function snapshot() {
  const shot = { id: 'shot', sceneId: 'scene', revisionId: 'shot-r', purpose: 'Reveal the product', action: 'Reveal', framing: 'Low view', motion: 'Slow push',
    desiredFrames: 180, imagePrompt: 'Studio image', videoPrompt: 'Slow push through studio', cueId: null,
    narration: { mode: 'none', text: '', voice: 'stock' }, promptIntent: { image: 'image-intent', video: 'video-intent' } };
  return { project: { id: 'project', name: 'Film', headVersion: 2, revisionId: 'revision', activePlanId: 'plan', brief: '', story: '', narration: { script: '', source: 'undecided' }, cues: [],
    scenes: [{ id: 'scene', purpose: 'Reveal', revisionId: 'scene-r' }, { id: 'empty-scene', purpose: 'Detail', revisionId: 'scene-r2' }], shots: [shot] },
    plan: { id: 'plan', nodes: [
      { id: 'image-node', alias: 'image', kind: 'image', shotId: 'shot', intentDigest: 'image-intent', args: { prompt: shot.imagePrompt } },
      { id: 'video-node', alias: 'video', kind: 'video', shotId: 'shot', intentDigest: 'video-intent', args: { prompt: shot.videoPrompt, durationFrames: 180 }, inputs: [{ destinationPort: 'firstFrame', source: { kind: 'output', nodeId: 'image-node', port: 'image' } }] },
    ] }, currentAttemptIds: [], attempts: [], outputs: [], messages: [], holds: [], cursor: 1 };
}
const shotResult = value => projectResults(value).scenes[0].shots[0];
const saved = value => { value.outputs = [{ nodeId: 'image-node', port: 'image', candidateId: 'image-candidate', artifact: artifact('frame'), fixture: true },
  { nodeId: 'video-node', port: 'video', candidateId: 'video-candidate', artifact: artifact('clip', 'video'), fixture: false }]; return value; };

test('project hierarchy retains pending and empty scenes as media progresses', () => {
  const value = snapshot(), before = projectResults(value);
  assert.deepEqual(before.scenes.map(scene => scene.id), ['scene', 'empty-scene']); assert.equal(before.scenes[1].shots.length, 0);
  assert.equal(before.scenes[0].shots[0].keyframe.label, 'Not generated'); assert.equal(before.scenes[0].shots[0].video.label, 'Waiting for keyframe');
  saved(value); const after = projectResults(value);
  assert.deepEqual(after.scenes.map(scene => scene.id), before.scenes.map(scene => scene.id));
  assert.equal(after.scenes[0].shots[0].keyframe.artifact.artifactId, 'frame'); assert.equal(after.scenes[0].shots[0].video.artifact.artifactId, 'clip');
  assert.equal(after.keyframes, 1); assert.equal(after.videos, 1); assert.equal(after.scenes[0].shots[0].keyframe.fixture, true); assert.equal(after.scenes[0].shots[0].video.fixture, false);
});

test('the actual current video conditioning input wins over another shot image declaration', () => {
  const value = saved(snapshot());
  value.plan.nodes.push({ id: 'conditioning', kind: 'image', alias: 'conditioning', shotId: null, args: { prompt: 'Saved reference', profileConfiguration: { model: 'Known image model' } } });
  value.outputs.push({ nodeId: 'conditioning', port: 'image', artifact: artifact('exact-conditioning', 'image', 'b'), fixture: false });
  value.plan.nodes[1].inputs[0].source.nodeId = 'conditioning';
  const result = shotResult(value); assert.equal(result.keyframe.artifact.artifactId, 'exact-conditioning'); assert.equal(result.keyframe.current, true);
  assert.equal(result.keyframe.model, 'Known image model'); assert.equal(result.keyframe.fixture, false);
  value.plan.nodes[1].inputs[0].source = { kind: 'artifact', artifact: artifact('owned-upload', 'image', 'c') };
  const uploaded = shotResult(value); assert.equal(uploaded.keyframe.artifact.artifactId, 'owned-upload'); assert.equal(uploaded.keyframe.current, true); assert.equal(uploaded.keyframe.fixture, null);
});

test('changed prompt provenance keeps an older result visible without counting it current', () => {
  const value = saved(snapshot()); value.project.shots[0].imagePrompt = 'Changed composition'; value.project.shots[0].promptIntent.image = 'new-image-intent';
  const result = shotResult(value); assert.equal(result.keyframe.artifact.artifactId, 'frame'); assert.equal(result.keyframe.current, false); assert.equal(result.keyframe.state, 'previous');
  assert.equal(result.video.current, false, 'A stale conditioning image cannot make the video current'); assert.equal(projectResults(value).keyframes, 0);
});

test('earlier succeeded outputs never drive current proof, fixture claims or job state', () => {
  const value = snapshot(); value.attempts = [{ id: 'old-success', nodeId: 'image-node', phase: 'succeeded', request: { kind: 'image' }, outputs: { image: artifact('old-frame') } },
    { id: 'old-unknown', nodeId: 'video-node', phase: 'submission_unknown', request: { kind: 'video' }, outputs: { video: artifact('unconfirmed-clip', 'video') } }];
  const result = shotResult(value); assert.equal(result.keyframe.artifact.artifactId, 'old-frame'); assert.equal(result.keyframe.current, false); assert.equal(result.keyframe.fixture, null);
  assert.equal(result.keyframe.label, 'Earlier keyframe'); assert.equal(result.video.artifact, null); assert.doesNotMatch(result.latest, /unconfirmed/);
  value.currentAttemptIds = ['old-success']; assert.equal(shotResult(value).keyframe.artifact, null, 'A current attempt result without a published binding is not a historical fallback');
  delete value.currentAttemptIds; assert.equal(shotResult(value).keyframe.artifact, null, 'Missing current-selection evidence cannot classify arbitrary outputs as previous takes');
});

test('current job evidence is independent for image and video slots and takes precedence over old jobs', () => {
  const value = snapshot(); value.attempts = [{ id: 'old', nodeId: 'video-node', phase: 'submission_unknown' }, { id: 'current', nodeId: 'image-node', phase: 'remote_pending' }];
  value.currentAttemptIds = ['current']; const working = shotResult(value);
  assert.equal(working.keyframe.label, 'Generating keyframe'); assert.equal(working.video.label, 'Waiting for keyframe'); assert.equal(working.latest, 'Media work in progress');
  value.currentAttemptIds = ['old']; assert.equal(shotResult(value).latest, 'Outcome unconfirmed');
});

test('a stale plan or wrong media kind cannot become a saved current result', () => {
  const value = saved(snapshot()); value.project.activePlanId = 'other-plan';
  assert.equal(shotResult(value).keyframe.artifact, null); assert.equal(shotResult(value).video.artifact, null);
  value.project.activePlanId = 'plan'; value.outputs[0].artifact.kind = 'video';
  assert.equal(shotResult(value).keyframe.artifact, null); assert.equal(projectResults(value).keyframes, 0);
});

test('narration reports writing preference and accepted timing without treating text as audio', () => {
  const value = snapshot(), shot = value.project.shots[0]; shot.narration = { mode: 'generated', text: 'A considered line.', voice: 'personal' }; shot.narrationPending = true;
  let result = shotResult(value); assert.equal(result.narration.text, 'A considered line.'); assert.equal(result.narration.voice, 'Recorded voice preference'); assert.equal(result.narration.acceptedFrames, null);
  shot.cueId = 'cue'; shot.narrationPending = false; value.project.cues = [{ id: 'cue', accepted: true, measured: true, meaning: 'Line', durationFrames: 60 }];
  result = shotResult(value); assert.equal(result.narration.acceptedFrames, 60); assert.equal(result.narration.timing, 'Recording and timing accepted');
});

test('frame proof identity fences project, revision, shot, artifact and hash independently', () => {
  const exposure = { projectId: 'project', projectRevisionId: 'revision', shotId: 'shot', artifactId: 'frame', sha256: 'a'.repeat(64) };
  const first = frameExposureIdentity(exposure);
  for (const key of Object.keys(exposure)) assert.notEqual(frameExposureIdentity({ ...exposure, [key]: 'changed' }), first);
  assert.equal(frameExposureIdentity({ ...exposure }), first);
});

test('unassigned saved shots remain visible rather than silently disappearing from the hierarchy', () => {
  const value = snapshot(); value.project.shots[0].sceneId = 'missing-scene';
  const result = projectResults(value); assert.equal(result.scenes[0].shots.length, 0); assert.equal(result.scenes[2].unassigned, true); assert.equal(result.scenes[2].shots[0].shot.id, 'shot');
});
