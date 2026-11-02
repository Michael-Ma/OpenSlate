import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureRoute } from '../../src/next/fixtures/routes/index.ts';
import { DECLINE } from '../../src/next/fixtures/routes/types.ts';
import { fixtureCommand } from '../../src/next/fixtures/fixture-commands.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector } from '../../src/next/fixtures/last-ferry.ts';
import { keyframesView, lipSyncLine } from '../../src/next/model/keyframes.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

function world() {
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector },
    update(change) { change(w); const cursor = w.overview.cursor + 1; w.overview = { ...w.overview, cursor }; w.snapshot = { ...w.snapshot, cursor }; },
    later() {}, advance() {},
  };
  return w;
}
function call(w, method, path, body) {
  const answer = fixtureRoute(w, method, path, body);
  return answer === DECLINE ? fixtureCommand(w, method, path, body) : answer;
}

test('a singing shot says whether its clip is lip-synced, planned, failed, or why it cannot be', () => {
  const shot = (video, lipSync) => ({ video: { state: video, takeCount: 0 }, lipSync });
  const planned = { state: 'planned', profileId: 'fal' };
  assert.equal(lipSyncLine(shot('ready', undefined)), undefined);
  assert.equal(translateMsg('en', lipSyncLine(shot('ready', planned)).label), 'Lip-synced');
  assert.equal(translateMsg('zh-CN', lipSyncLine(shot('ready', planned)).label), '已对口型');
  assert.equal(lipSyncLine(shot('running', planned)).state, 'planned');
  assert.equal(lipSyncLine(shot('failed', planned)).state, 'failed');
  assert.equal(translateMsg('en', lipSyncLine(shot('none', { state: 'unavailable', reason: 'no_song' })).label), 'No song under this shot: made as a normal clip');
  assert.equal(translateMsg('en', lipSyncLine(shot('none', { state: 'unavailable', reason: 'no_profile' })).label), 'No lip sync model: made as a normal clip');
});

test('in the sample film, marking a shot as singing keeps its clip and shows the lip-sync line on its card; none removes it', () => {
  const w = world(), scene = w.overview.scenes[0], shotId = scene.shotIds[0];
  const video = w.overview.shots[shotId].video;
  const receipt = call(w, 'POST', '/storyboard', { kind: 'shotPerformance', id: shotId, value: 'singing', expectedHeadVersion: w.snapshot.project.headVersion });
  assert.ok(receipt.commandId);
  assert.deepEqual(w.overview.shots[shotId].video, video, 'the current clip stays until a lip-synced one succeeds');
  assert.equal(w.snapshot.project.shots.find(s => s.id === shotId).performance, 'singing');
  const card = keyframesView(w.overview, scene.sceneId, shotId, 'en').cards.find(c => c.shotId === shotId);
  assert.ok(card.lipSync && ['synced', 'planned', 'failed'].includes(card.lipSync.state));
  call(w, 'POST', '/storyboard', { kind: 'shotPerformance', id: shotId, value: 'none', expectedHeadVersion: w.snapshot.project.headVersion });
  assert.equal(w.overview.shots[shotId].lipSync, undefined); assert.equal('performance' in w.snapshot.project.shots.find(s => s.id === shotId), false);
  assert.equal(keyframesView(w.overview, scene.sceneId, shotId, 'en').cards.find(c => c.shotId === shotId).lipSync, undefined);
  assert.throws(() => call(w, 'POST', '/storyboard', { kind: 'shotPerformance', id: shotId, value: 'rap', expectedHeadVersion: w.snapshot.project.headVersion }), e => e.code === 'VALIDATION_ERROR');
});
