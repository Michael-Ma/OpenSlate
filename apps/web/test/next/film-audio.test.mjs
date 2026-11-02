import test from 'node:test';
import assert from 'node:assert/strict';
import { audioAt, syncMedia, currentPlacements, clipTarget, SAMPLE_RATE } from '../../src/next/model/film-audio.ts';

const line = { id: 'cue@288000', audioId: 'a1', sha256: 'x', startSample: 0, durationSamples: 2.1 * SAMPLE_RATE, atSample: 6 * SAMPLE_RATE, gainMilliDb: 0, shotIds: ['s12'] };

test('a placement sounds only inside its span, from its own source position', () => {
  assert.deepEqual(audioAt(line, 5.9), { active: false, sourceSeconds: 0, volume: 1 });
  assert.deepEqual(audioAt(line, 7), { active: true, sourceSeconds: 1, volume: 1 });
  assert.equal(audioAt(line, 8.2).active, false, 'the 2.1 s line has ended');
  assert.equal(audioAt({ ...line, startSample: SAMPLE_RATE }, 7).sourceSeconds, 2, 'a trimmed recording starts later in its source');
  assert.ok(Math.abs(audioAt({ ...line, gainMilliDb: -18000 }, 7).volume - 0.126) < 0.001, '-18 dB');
  const faded = audioAt({ ...line, fadeOutSamples: SAMPLE_RATE / 2 }, 8.0);
  assert.ok(faded.volume > 0 && faded.volume < 0.25, 'a cut line fades out at the shot end');
});

test('media follows the clock: seek on drift, play and pause with the film', () => {
  const calls = [];
  const media = { currentTime: 0, paused: true, volume: 1, pause() { calls.push('pause'); this.paused = true; }, play() { calls.push('play'); this.paused = false; } };
  syncMedia(media, audioAt(line, 7), true);
  assert.deepEqual([media.currentTime, media.paused, calls], [1, false, ['play']]);
  media.currentTime = 1.05;
  syncMedia(media, audioAt(line, 7.1), true);
  assert.equal(media.currentTime, 1.05, 'small drift is left alone');
  syncMedia(media, audioAt(line, 9), true);
  assert.deepEqual([media.paused, calls.at(-1)], [true, 'pause'], 'past its end it stops');
  syncMedia(media, audioAt(line, 7.5), false);
  assert.equal(media.currentTime, 1.5, 'paused: it still seeks, so play starts in the right place');
  const rejecting = { currentTime: 0, paused: true, volume: 1, pause() {}, play() { return Promise.reject(new Error('autoplay')); } };
  assert.doesNotThrow(() => syncMedia(rejecting, audioAt(line, 7), true));
  assert.deepEqual(clipTarget(2, true), { active: true, sourceSeconds: 2, volume: 0 }, 'clip audio is always muted');
});

test('only placements for the film as it is now are played', () => {
  const view = { projectId: 'p', headVersion: 7, revisionId: 'r', placements: [line], soundtrack: { ...line, id: 'soundtrack', audioId: 'm' } };
  assert.deepEqual(currentPlacements(view, 7).map(p => p.id), ['cue@288000', 'soundtrack']);
  assert.deepEqual(currentPlacements(view, 8), [], 'an older read waits for the next one');
  assert.deepEqual(currentPlacements(null, 7), []);
  assert.deepEqual(currentPlacements({ ...view, soundtrack: null }, 7).map(p => p.id), ['cue@288000']);
});
