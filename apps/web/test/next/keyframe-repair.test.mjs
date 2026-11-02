import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, lastFerryNotes, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { noteBanner, noteCallout } from '../../src/next/model/note-banner.ts';
import { noteViews } from '../../src/next/model/notes.ts';
import { canStop } from '../../src/next/model/director.ts';
import { isWorking } from '../../src/next/model/keyframes.ts';

const waiting = code => ({ state: 'queued', takeCount: 0, waiting: { code, since: 'x' } });
const failure = { code: 'FAILED', technical: true, retryAllowed: true, autoRetriesLeft: 0, charged: false, at: 'x' };
const actions = (overview, shot) => {
  const note = noteViews(lastFerryNotes(), overview).find(note => note.letter === 'a');
  return [inspectorView(overview, shot, 'en-US').regenerate,
    noteBanner(note, overview, [], 'en-US').actions.find(action => action.action.kind === 'regenerate'),
    noteCallout(note, shot.shotId, overview, 'en-US').regenerate];
};

test('B21 passive clip input waits allow priced repair of missing and failed keyframes in inspector and notes', () => {
  for (const state of ['none', 'failed']) for (const replacement of [false, true]) {
    const overview = lastFerryOverview(), shot = overview.shots[shotId('2.2')];
    shot.keyframe = { state, takeCount: 0, opened: false, ...(state === 'failed' ? { failure } : {}) };
    shot.video = replacement ? { state: 'ready', takeCount: 1, replacement: waiting('input_pending') } : waiting('input_pending');
    assert.equal(isWorking(shot.video), false, 'waiting for an unavailable keyframe is passive');
    for (const action of actions(overview, shot)) {
      assert.equal(action.enabled, true, `${state} / replacement ${replacement}`);
      assert.ok(action.cost ?? action.price, 'repair retains its usual price');
    }
    assert.equal(canStop(overview, null), false, 'an idle input wait supplies no Stop');
    shot.keyframe = { state: 'running', takeCount: 0, opened: false };
    assert.equal(canStop(overview, null), true, 'Stop returns while the required keyframe is being made');
    for (const action of actions(overview, shot)) assert.equal(action.enabled, false);
  }
});

test('B21 passive input waits do not hide active, unknown, or automatically retrying clip replacements', () => {
  for (const protectedWork of [{ state: 'running' }, { state: 'no_answer', attemptId: 'unknown' }, waiting('unknown'),
    { ...waiting('capacity') }, { state: 'queued', failure: { ...failure, autoRetriesLeft: 1 } }]) {
    const overview = lastFerryOverview(), shot = overview.shots[shotId('2.2')];
    shot.keyframe = { state: 'failed', takeCount: 0, opened: false, failure };
    shot.video = { ...waiting('input_pending'), replacement: protectedWork };
    for (const action of actions(overview, shot)) assert.equal(action.enabled, false, JSON.stringify(protectedWork));
  }
});

test('B21 input waits stay passive with remaining retry metadata on a clip or retained replacement', () => {
  for (const replacement of [false, true]) {
    const overview = lastFerryOverview(), shot = overview.shots[shotId('2.2')];
    shot.keyframe = { state: 'failed', takeCount: 0, opened: false, failure };
    const wait = { ...waiting('input_pending'), failure: { ...failure, autoRetriesLeft: 2 } };
    shot.video = replacement ? { state: 'ready', takeCount: 1, replacement: wait } : wait;
    assert.equal(isWorking(shot.video), false, 'retry metadata does not make a missing input executable');
    assert.equal(canStop(overview, null), false);
    for (const action of actions(overview, shot)) assert.equal(action.enabled, true);
  }
});

test('B21 every keyframe purchase entry preserves failed automatic retries, including retained replacements', () => {
  for (const replacement of [false, true]) {
    const overview = lastFerryOverview(), shot = overview.shots[shotId('2.2')];
    const pending = { state: 'failed', failure: { ...failure, technical: true, autoRetriesLeft: 2 } };
    if (replacement) shot.keyframe.replacement = pending;
    else shot.keyframe = { ...pending, takeCount: 0, opened: false };
    shot.video = waiting('input_pending');
    for (const action of actions(overview, shot)) assert.equal(action.enabled, false, `retained replacement ${replacement}`);
    (replacement ? shot.keyframe.replacement : shot.keyframe).failure.autoRetriesLeft = 0;
    for (const action of actions(overview, shot)) assert.equal(action.enabled, true, 'an exhausted technical retry permits fresh human generation');
  }
});
