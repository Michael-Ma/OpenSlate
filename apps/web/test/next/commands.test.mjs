import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmBody, CommandRefused } from '../../src/next/model/commands.ts';
import { lastFerryOverview, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';

test('the server confirm binds exactly the opened current frames, the digest and the shown price', () => {
  const overview = lastFerryOverview();
  const scene = overview.scenes.find(s => s.sceneId === sceneId(2));
  assert.throws(() => confirmBody(overview, scene), (e) => e instanceof CommandRefused && e.code === 'FRAME_NOT_OPENED');
  for (const id of scene.videoTargets) overview.shots[id].keyframe.opened = true;
  const body = confirmBody(overview, scene);
  assert.equal(body.confirmationDigest, scene.confirmationDigest);
  assert.deepEqual(body.reviewedFrames.map(f => f.shotId), [shotId('2.1'), shotId('2.2'), shotId('2.3')]);
  assert.equal(body.reviewedFrames[1].sha256, overview.shots[shotId('2.2')].keyframe.artifact.sha256);
  assert.equal(body.expectedEstimateMicros, '1500000');
});

test('confirm refuses without a digest, with a replaced keyframe, or with nothing to make', () => {
  const overview = lastFerryOverview();
  const scene = overview.scenes.find(s => s.sceneId === sceneId(2));
  for (const id of scene.videoTargets) overview.shots[id].keyframe.opened = true;
  assert.throws(() => confirmBody(overview, { ...scene, confirmationDigest: null }), { code: 'SCENE_REVIEW_STALE' });
  const running = structuredClone(overview); running.shots[shotId('2.2')].keyframe.state = 'running';
  assert.throws(() => confirmBody(running, scene), { code: 'SCENE_REVIEW_STALE' });
  assert.throws(() => confirmBody(overview, { ...scene, videoTargets: [] }), { code: 'ALREADY_COMPLETE' });
  const unpriced = confirmBody(overview, { ...scene, quotes: { confirmVideo: { micros: '0', units: 3, unitMicros: '0', priceUnknown: true } } });
  assert.equal('expectedEstimateMicros' in unpriced, false);
});
