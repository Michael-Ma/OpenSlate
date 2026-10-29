import test from 'node:test';
import assert from 'node:assert/strict';
import { remakeClipsBody, CommandRefused } from '../../src/next/model/commands.ts';
import { pressFromId, remakePress, PAID_PRESS } from '../../src/next/model/keyframes-press.ts';
import { lastFerryOverview } from '../../src/next/fixtures/last-ferry.ts';

const savedScene = (overview) => overview.scenes.find(s => s.state === 'video_saved');

test('a new-clip press sends only the named shots’ opened frames, the scene token and the summed remake quote', () => {
  const overview = lastFerryOverview(), scene = savedScene(overview);
  const [a, b] = scene.shotIds;
  for (const id of [a, b]) {
    overview.shots[id].keyframe.opened = true;
    overview.shots[id].quotes = { ...overview.shots[id].quotes, remakeClip: { micros: '66000', priceUnknown: false, units: 1, unitMicros: '66000' } };
  }
  scene.confirmationDigest = 'd'.repeat(64);
  const body = remakeClipsBody(overview, scene, [a, b]);
  assert.deepEqual(body.targetShotIds, [a, b]);
  assert.deepEqual(body.reviewedFrames.map(f => f.shotId), [a, b]);
  assert.equal(body.expectedEstimateMicros, '132000');
  assert.equal(body.confirmationDigest, 'd'.repeat(64));

  overview.shots[b].keyframe.opened = false;
  assert.throws(() => remakeClipsBody(overview, scene, [a, b]), e => e instanceof CommandRefused && e.code === 'FRAME_NOT_OPENED');
});

test('a new-clip press is a paid press whose saved id maps back to the same identity', () => {
  const overview = lastFerryOverview(), scene = savedScene(overview);
  const press = remakePress(overview, scene, [scene.shotIds[0]]);
  assert.ok(PAID_PRESS.test(press.pressId));
  assert.deepEqual(pressFromId(overview, press.pressId), press);
});
