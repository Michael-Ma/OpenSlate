import test from 'node:test';
import assert from 'node:assert/strict';
import { topBarMode } from '../../src/next/model/shell.ts';

test('with no film open the top bar names the films on this computer, in Settings too', () => {
  assert.equal(topBarMode('settings', false), 'films');
  assert.equal(topBarMode('settings', true), 'film');
  assert.equal(topBarMode('start', true), 'films');
  for (const view of ['plan', 'keyframes', 'assets', 'film']) assert.equal(topBarMode(view, true), 'film', view);
});
