import test from 'node:test';
import assert from 'node:assert/strict';
import { motionKind, motionTransform, clock, advance, playingShot } from '../../src/next/model/motion.ts';
import { catalog } from '../../src/next/i18n/messages.ts';

test('the motion preview guesses a camera move from English or Chinese keywords', () => {
  const table = [
    ['Slow push-in', 'push_in'], ['Dolly in on her hands', 'push_in'], ['zoom in slowly', 'push_in'],
    ['Slow pull-back', 'pull_back'], ['pull out to reveal the harbour', 'pull_back'], ['dolly out', 'pull_back'],
    ['Slow pan right', 'pan_right'], ['Pan left across the pier', 'pan_left'], ['truck right', 'pan_right'],
    ['Slow tilt down', 'tilt_down'], ['tilt up to the sky', 'tilt_up'],
    ['Static', 'static'], ['Locked off', 'static'], ['Handheld drift', 'static'],
    ['Static, breath visible', 'breath'], ['Slow push-in, breath visible', 'push_in'],
    ['缓慢推近', 'push_in'], ['镜头拉远', 'pull_back'], ['缓慢左摇', 'pan_left'], ['向右横移', 'pan_right'],
    ['缓慢上摇', 'tilt_up'], ['缓慢下摇', 'tilt_down'], ['静止', 'static'], ['静止，能看到呼吸', 'breath'],
  ];
  for (const [text, kind] of table) assert.equal(motionKind(text), kind, text);
});

test('every suggested motion previews as the move it names, in both languages', () => {
  for (const [id, entry] of Object.entries(catalog)) {
    const match = id.match(/^motion\.suggest\.(\w+)$/);
    if (!match) continue;
    assert.equal(motionKind(entry.en), match[1], `${id} (en)`);
    assert.equal(motionKind(entry.zh), match[1], `${id} (zh)`);
  }
});

test('transforms run from start to end of the shot, and a still picture stays still', () => {
  assert.equal(motionTransform('push_in', 0), 'scale(1)');
  assert.equal(motionTransform('push_in', 1), 'scale(1.12)');
  assert.equal(motionTransform('pull_back', 0), 'scale(1.12)');
  assert.equal(motionTransform('pull_back', 1), 'scale(1)');
  assert.equal(motionTransform('pan_right', 0), 'scale(1.1) translateX(4%)');
  assert.equal(motionTransform('pan_right', 1), 'scale(1.1) translateX(-4%)');
  assert.equal(motionTransform('tilt_down', 1), 'scale(1.1) translateY(-4%)');
  assert.equal(motionTransform('tilt_up', 1), 'scale(1.1) translateY(4%)');
  assert.equal(motionTransform('static', 0.5), 'none');
  assert.match(motionTransform('breath', 0.125), /^scale\(1\.02\d*\)$/);
  assert.equal(motionTransform('push_in', 2), 'scale(1.12)', 'progress is clamped');
});

test('the scrubber clock and the playback queue', () => {
  assert.deepEqual([clock(0), clock(5), clock(7.99), clock(62.4)], ['0:00', '0:05', '0:07', '1:02']);
  const queue = { queue: ['a', 'b', 'c'], index: 0, kind: 'motion' };
  assert.equal(playingShot(queue), 'a');
  assert.equal(playingShot(advance(queue)), 'b');
  assert.equal(advance({ ...queue, index: 2 }), null);
  assert.equal(playingShot(null), null);
});
