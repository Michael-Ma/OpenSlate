import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAudioPlacements, storyboardAudioCuts } from '../dist/narration/audio-placement.js';
const segment = { cue: { id: 'cue', durationFrames: 181 }, placementMode: 'shot', audioPlacement: { source: { artifactId: 'voice' }, startSample: 123, durationSamples: 288001, atSample: 960000, gainMilliDb: -1000 } };
test('browser and export project the same shot-relative audio range without rewriting accepted source history', () => {
  const cuts = [{ shotId: 'silent', cueId: null, startFrame: 0, durationFrames: 90 }, { shotId: 'voiced', cueId: 'cue', startFrame: 90, durationFrames: 181 }];
  const placed = projectAudioPlacements(segment, cuts); assert.equal(placed.length, 1); assert.deepEqual(placed[0], { ...segment.audioPlacement, atSample: 144000 });
  assert.equal(segment.audioPlacement.atSample, 960000); assert.equal(placed[0].durationSamples, 288001); assert.equal(placed[0].startSample, 123);
  assert.deepEqual(projectAudioPlacements({ ...segment, placementMode: undefined }, cuts), [segment.audioPlacement], 'legacy DSL timelines preserve their explicit absolute anchor');
  assert.deepEqual(projectAudioPlacements(segment, [{ ...cuts[1], cueId: null }]), [], 'detached shot contributes no narration');
  assert.throws(() => projectAudioPlacements(segment, [{ ...cuts[1], durationFrames: 180 }]), { code: 'MEDIA_NARRATION_REQUIRED' });
});
test('legacy absolute audio retains its source range only at the mapped cut start and disappears after reorder or lengthening', () => {
  const absolute = { ...segment, placementMode: undefined, audioPlacement: { ...segment.audioPlacement, atSample: 144000 } };
  const cut = { shotId: 'voiced', cueId: 'cue', startFrame: 90, durationFrames: 181 };
  const current = cuts => projectAudioPlacements(absolute, cuts, { requireAbsoluteCutStart: true });
  assert.deepEqual(current([cut]), [absolute.audioPlacement]);
  assert.deepEqual(current([{ ...cut, startFrame: 0 }]), [], 'reorder cannot silently leave voice under another shot');
  assert.deepEqual(current([{ ...cut, startFrame: 120 }]), [], 'lengthening an earlier cut invalidates the old anchor');
  assert.deepEqual(current([{ ...cut, cueId: null }]), [], 'an unrelated cut at the accepted sample cannot make the voice current');
  assert.deepEqual(current([cut, { ...cut, shotId: 'other', startFrame: 271 }]), [absolute.audioPlacement], 'a shared absolute cue is projected once at its aligned cut');
  assert.deepEqual(projectAudioPlacements(absolute, [{ ...cut, cueId: null }]), [absolute.audioPlacement], 'unmapped legacy DSL asset takes still mix accepted absolute narration');
  assert.equal(absolute.audioPlacement.atSample, 144000); assert.equal(absolute.audioPlacement.startSample, 123); assert.equal(absolute.audioPlacement.durationSamples, 288001);
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
