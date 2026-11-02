import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview } from '../../src/next/fixtures/last-ferry.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const lost = { code: 'SUBMISSION_RESPONSE_LOST', technical: true, retryAllowed: false, autoRetriesLeft: 0, charged: true, at: '2026-10-27T00:00:00.000Z' };
function shot() {
  const overview = lastFerryOverview(), first = overview.shots[overview.scenes[0].shotIds[0]];
  return { overview, first };
}

test('a lost video reply says it may be charged and offers the paid regenerate press', () => {
  const { overview, first } = shot();
  first.video = { ...first.video, state: 'failed', attemptId: 'lost-video', failure: lost };
  const view = inspectorView(overview, first, 'en-US');
  assert.equal(view.failure.slot, 'video'); assert.equal(view.failure.message.id, 'inspector.failed.response_lost');
  assert.ok(view.failure.retryVideo, 'a new human press is offered, never an automatic retry');
  assert.match(translateMsg('en', view.failure.message), /may already have been charged.*costs again/);
  assert.match(translateMsg('zh-CN', view.failure.message), /可能已经扣费.*再付一次费用/);
});

test('a lost keyframe replacement is shown while the current keyframe stays', () => {
  const { overview, first } = shot();
  assert.equal(first.keyframe.state, 'ready');
  first.keyframe.replacement = { state: 'failed', attemptId: 'lost-take', failure: lost };
  const view = inspectorView(overview, first, 'en-US');
  assert.equal(view.failure?.slot, 'keyframe'); assert.equal(view.failure.message.id, 'inspector.failed.response_lost');
  assert.equal(first.keyframe.state, 'ready');
});
