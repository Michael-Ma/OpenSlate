import test from 'node:test';
import assert from 'node:assert/strict';
import { toastSpot, topBarMode } from '../../src/next/model/shell.ts';

test('with no film open the top bar names the films on this computer, in Settings too', () => {
  assert.equal(topBarMode('settings', false), 'films');
  assert.equal(topBarMode('settings', true), 'film');
  assert.equal(topBarMode('start', true), 'films');
  for (const view of ['plan', 'keyframes', 'assets', 'film']) assert.equal(topBarMode(view, true), 'film', view);
});

test('the toast sits over the top of the picture, under its pills, else at the top of the workspace', () => {
  const workspace = { top: 52, bottom: 900, left: 392, width: 1048 };
  // Keyframes at 1440 × 900: the preview under the banner, its badge and buttons in a 28 px row 12 px down.
  const picture = { top: 334, bottom: 670, left: 414, width: 738 };
  const pictureHead = { top: 346, bottom: 374, left: 426, width: 714 };
  const place = { workspace, picture, pictureHead, titled: false, viewportHeight: 900, toastHeight: 40 };
  assert.deepEqual(toastSpot(place), { top: 380, centre: 783, maxWidth: 640 });
  // A picture with no pills: just inside its top edge.
  assert.deepEqual(toastSpot({ ...place, pictureHead: null }), { top: 346, centre: 783, maxWidth: 640 });
  // A narrow picture caps the toast's width inside it.
  assert.equal(toastSpot({ ...place, picture: { ...picture, width: 500 } }).maxWidth, 476);
  // Plan, Assets, Settings, Start: no picture, so the top of the workspace (over the title row), centred in it.
  const titled = { ...place, picture: null, pictureHead: null, titled: true };
  assert.deepEqual(toastSpot(titled), { top: 64, centre: 916, maxWidth: 640 });
  // Below a film-wide strip, the workspace starts lower.
  assert.equal(toastSpot({ ...titled, workspace: { ...workspace, top: 110 } }).top, 122);
  // The picture scrolled up under the top bar, or down past the window: the top of the workspace instead.
  assert.equal(toastSpot({ ...place, picture: { ...picture, top: -200, bottom: 136 }, pictureHead: { ...pictureHead, top: -188, bottom: -160 } }).top, 64);
  assert.equal(toastSpot({ ...place, picture: { ...picture, top: 880, bottom: 1216 }, pictureHead: { ...pictureHead, top: 892, bottom: 920 } }).top, 64);
  // Too short to hold the toast under its pills.
  assert.equal(toastSpot({ ...place, picture: { ...picture, bottom: 400 } }).top, 64);
  // Neither a picture nor a title row (the recovery review, one card at the top): the foot of the workspace.
  assert.deepEqual(toastSpot({ ...titled, titled: false }), { top: 838, centre: 916, maxWidth: 640 });
});
