import test from 'node:test';
import assert from 'node:assert/strict';
import { clampDirectorWidth, directorWidthForKey, DEFAULT_DIRECTOR_WIDTH } from '../src/legacy/workspace-layout-model.ts';
import { visibleProjectConnection } from '../src/legacy/project-view-model.ts';
test('Director sizing keeps a usable workspace on smaller desktops and rejects invalid stored widths', () => {
  assert.equal(clampDirectorWidth(600, 820), 455);
  assert.equal(clampDirectorWidth(-1, 1440), 260); assert.equal(clampDirectorWidth(Infinity, 1440), DEFAULT_DIRECTOR_WIDTH);
  assert.equal(clampDirectorWidth(900, 1440), 640);
});
test('keyboard resizing exposes bounded endpoints and preserves ordinary text keys', () => {
  assert.equal(directorWidthForKey(300, 'ArrowRight', 1280), 316);
  assert.equal(directorWidthForKey(300, 'ArrowLeft', 1280, true), 260);
  assert.equal(directorWidthForKey(300, 'End', 820), 455); assert.equal(directorWidthForKey(300, 'Home', 1280), 260);
  assert.equal(directorWidthForKey(300, 'Enter', 1280), null);
});
test('background refresh retains connection and planning while a project switch or real failure does not', () => {
  assert.equal(visibleProjectConnection('film', 'film', 'connected'), 'connected');
  assert.equal(visibleProjectConnection('other', 'film', 'connected'), 'connecting');
  assert.equal(visibleProjectConnection('film', 'film', 'reconnecting'), 'reconnecting');
  assert.equal(visibleProjectConnection('', 'film', 'connected'), 'connecting');
});
