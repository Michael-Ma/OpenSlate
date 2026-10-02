import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAudioPlacements, storyboardAudioCuts } from '../dist/narration/audio-placement.js';
const segment = { cue: { id: 'cue', durationFrames: 181 }, placementMode: 'shot', audioPlacement: { source: { artifactId: 'voice' }, startSample: 123, durationSamples: 288001, atSample: 960000, gainMilliDb: -1000 } };
test('browser and export project the same shot-relative audio range without rewriting accepted source history', () => {
  const cuts = [{ shotId: 'silent', cueId: null, startFrame: 0, durationFrames: 90 }, { shotId: 'voiced', cueId: 'cue', startFrame: 90, durationFrames: 181 }];
  const placed = projectAudioPlacements(segment, cuts); assert.equal(placed.length, 1); assert.deepEqual(placed[0], { ...segment.audioPlacement, atSample: 144000 });
  assert.equal(segment.audioPlacement.atSample, 960000); assert.equal(placed[0].durationSamples, 288001); assert.equal(placed[0].startSample, 123);
  assert.deepEqual(projectAudioPlacements({ ...segment, placementMode: undefined }, cuts), [segment.audioPlacement], 'legacy audio keeps its explicit absolute anchor');
  assert.deepEqual(projectAudioPlacements(segment, [{ ...cuts[1], cueId: null }]), [], 'detached shot contributes no narration');
  assert.throws(() => projectAudioPlacements(segment, [{ ...cuts[1], durationFrames: 180 }]), { code: 'MEDIA_NARRATION_REQUIRED' });
});
test('scene and shot order produce bounded chronological cuts independent of array storage grouping', () => {
  const project = { scenes: [{ id: 's2' }, { id: 's1' }], shots: [{ id: 'a', sceneId: 's1', desiredFrames: 181, cueId: 'cue' }, { id: 'b', sceneId: 's2', desiredFrames: 90, cueId: null }] };
  assert.deepEqual(storyboardAudioCuts(project), [{ shotId: 'b', cueId: null, startFrame: 0, durationFrames: 90 }, { shotId: 'a', cueId: 'cue', startFrame: 90, durationFrames: 181 }]);
});


test('within-shot voice retains its actual one-second range over a six-second picture and preserves legacy exact timing', () => {
  const short = { ...segment, cue: { id: 'cue', durationFrames: 30 }, timingMode: 'within_shot', audioPlacement: { ...segment.audioPlacement, durationSamples: 48000 } };
  const cut = { shotId: 'shot', cueId: 'cue', startFrame: 180, durationFrames: 180, timingMode: 'within_shot' };
  assert.deepEqual(projectAudioPlacements(short, [cut]), [{ ...short.audioPlacement, atSample: 288000 }]);
  assert.throws(() => projectAudioPlacements({ ...short, timingMode: undefined }, [cut]), { code: 'MEDIA_NARRATION_REQUIRED' });
  assert.throws(() => projectAudioPlacements({ ...short, audioPlacement: { ...short.audioPlacement, durationSamples: 288001 } }, [cut]), { code: 'MEDIA_NARRATION_REQUIRED' });
});
