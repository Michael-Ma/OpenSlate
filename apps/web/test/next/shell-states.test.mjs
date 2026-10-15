import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carryFrom, carryReady, carryToApply, continuedToast, filmStrip, reconnectedToast, restartCasualties, restartTitle,
  showStop, stopLines, stopPreview, stoppedLines, OFFLINE_GRACE_MS,
} from '../../src/next/model/shell-states.ts';
import { lastFerryOverview } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const join = labels => new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels);

/** The sample film with some slots changed: { 'shot-2-1': { video: {...} } }. */
function film(changes = {}, extra = {}) {
  const overview = lastFerryOverview();
  for (const [id, slots] of Object.entries(changes)) overview.shots[id] = { ...overview.shots[id], ...slots };
  return { ...overview, ...extra };
}
const running = (attemptId) => ({ state: 'running', phase: 'running', attemptId, startedAt: '2026-10-15T14:00:00Z', takeCount: 0 });
const queued = (ahead) => ({ state: 'queued', takeCount: 0, waiting: { code: 'capacity', ahead, since: '2026-10-15T14:00:00Z' } });
const noAnswer = (attemptId, extra = {}) => ({ state: 'no_answer', phase: 'submission_unknown', attemptId, takeCount: 0, ...extra });

// ---- the strip -----------------------------------------------------------------------

test('a quiet film has no strip', () => {
  assert.equal(filmStrip({ view: 'keyframes', offline: false, overview: lastFerryOverview(), dismissedRestart: null }), null);
  assert.equal(filmStrip({ view: 'keyframes', offline: false, overview: null, dismissedRestart: null }), null);
});

test('offline comes first, in every view including Start', () => {
  const stopped = film({}, { stopped: { stopId: 's', at: 'now', sentJobs: 1, detachedJobs: 2 } });
  for (const view of ['plan', 'keyframes', 'assets', 'film', 'settings', 'start'])
    assert.deepEqual(filmStrip({ view, offline: true, overview: stopped, dismissedRestart: null }), { kind: 'offline' }, view);
  assert.equal(OFFLINE_GRACE_MS, 2000);
});

test('stopped says what finishes and is charged and what was taken off; Start has no film open', () => {
  const overview = film({}, { stopped: { stopId: 's', at: 'now', sentJobs: 1, detachedJobs: 2 } });
  const strip = filmStrip({ view: 'settings', offline: false, overview, dismissedRestart: null });
  assert.deepEqual(strip, { kind: 'stopped', sent: 1, detached: 2 });
  assert.deepEqual(stoppedLines(strip).map(en), ['1 job already sent will finish and be charged.', '2 queued jobs were taken off and will need a new confirm.']);
  assert.deepEqual(stoppedLines(strip).map(zh), ['已发送的 1 个任务会完成并计费。', '2 个排队中的任务已撤下，需要重新确认。']);
  assert.deepEqual(stoppedLines({ sent: 0, detached: 0 }), [], 'nothing to add when nothing was in flight');
  assert.equal(filmStrip({ view: 'start', offline: false, overview, dismissedRestart: null }), null);
});

test('Continue says taken-off jobs need a new confirm only when there were some', () => {
  assert.equal(en(continuedToast(2)), 'Continued. Jobs that were taken off need a new confirm.');
  assert.equal(en(continuedToast(0)), 'Continued.');
});

// ---- restart casualties --------------------------------------------------------------

test('restart casualties name their shots in film order and the kind of job', () => {
  const overview = film({ 'shot-2-2': { video: noAnswer('a2') }, 'shot-2-1': { video: noAnswer('a1') } }, { restartCasualties: ['a2', 'a1'] });
  const restart = restartCasualties(overview);
  assert.deepEqual(restart, { key: 'a1,a2', count: 2, kind: 'clip', labels: ['2.1', '2.2'], first: { shotId: 'shot-2-1', label: '2.1' } });
  assert.equal(en(restartTitle(restart, join)), 'OpenSlate restarted while 2 clips were being sent (2.1 and 2.2).');
  assert.equal(zh(restartTitle(restart, l => l.join('、'))), 'OpenSlate 重启时有 2 段视频正在发送（2.1、2.2）。');
  assert.deepEqual(filmStrip({ view: 'plan', offline: false, overview, dismissedRestart: null }), { kind: 'restart', restart });
});

test('one keyframe casualty reads in the singular', () => {
  const overview = film({ 'shot-3-1': { keyframe: { ...noAnswer('k1'), opened: false } } }, { restartCasualties: ['k1'] });
  const restart = restartCasualties(overview);
  assert.equal(restart.kind, 'keyframe');
  assert.equal(en(restartTitle(restart, join)), 'OpenSlate restarted while 1 keyframe was being sent (3.1).');
  assert.equal(en({ id: 'strip.restart.body', values: { count: 1 } }), 'The service never confirmed it. It may still arrive and be charged; nothing is resent by itself.');
  assert.equal(zh({ id: 'strip.restart.body', values: { count: 1 } }), '服务没有确认它，它可能稍后仍会返回并计费；不会自动重发。');
});

test('mixed casualties are jobs, and a casualty not found on a shot drops the list rather than guess', () => {
  const mixed = film({ 'shot-3-1': { keyframe: { ...noAnswer('k1'), opened: false } }, 'shot-2-1': { video: noAnswer('v1') } }, { restartCasualties: ['k1', 'v1'] });
  const restart = restartCasualties(mixed);
  assert.equal(restart.kind, 'job');
  assert.equal(en(restartTitle(restart, join)), 'OpenSlate restarted while 2 jobs were being sent (2.1 and 3.1).');
  // A voice line has no attempt id in the overview: count it, name nothing.
  const voice = film({ 'shot-2-1': { video: noAnswer('v1') } }, { restartCasualties: ['v1', 'speech-9'] });
  const unknown = restartCasualties(voice);
  assert.deepEqual([unknown.kind, unknown.labels, unknown.count], ['job', [], 2]);
  assert.equal(en(restartTitle(unknown, join)), 'OpenSlate restarted while 2 jobs were being sent.');
  assert.deepEqual(unknown.first, { shotId: 'shot-2-1', label: '2.1' }, 'a shot that is known can still be shown');
});

test('a casualty the person gave up on no longer counts; dismissing hides only the same set', () => {
  const overview = film({ 'shot-2-1': { video: { state: 'none', takeCount: 0, releasedAttemptIds: ['a1'] } }, 'shot-2-2': { video: noAnswer('a2') } }, { restartCasualties: ['a1', 'a2'] });
  const restart = restartCasualties(overview);
  assert.deepEqual([restart.count, restart.labels, restart.key], [1, ['2.2'], 'a2']);
  assert.equal(filmStrip({ view: 'keyframes', offline: false, overview, dismissedRestart: 'a2' }), null);
  assert.equal(filmStrip({ view: 'keyframes', offline: false, overview, dismissedRestart: 'a1,a2' }).kind, 'restart', 'a different set shows again');
  const allReleased = film({ 'shot-2-1': { video: { state: 'none', takeCount: 0, releasedAttemptIds: ['a1'] } } }, { restartCasualties: ['a1'] });
  assert.equal(restartCasualties(allReleased), null);
});

test('stopped outranks restart casualties', () => {
  const overview = film({ 'shot-2-1': { video: noAnswer('a1') } }, { restartCasualties: ['a1'], stopped: { stopId: 's', at: 'now', sentJobs: 1, detachedJobs: 0 } });
  assert.equal(filmStrip({ view: 'keyframes', offline: false, overview, dismissedRestart: null }).kind, 'stopped');
});

// ---- Stop ----------------------------------------------------------------------------

test('Stop shows only while something runs, the studio is reachable and a film is open', () => {
  const busy = film({ 'shot-2-1': { video: running('a1') } });
  assert.equal(showStop(busy, null, true, 'keyframes'), true);
  assert.equal(showStop(busy, null, true, 'settings'), true);
  assert.equal(showStop(busy, null, false, 'keyframes'), false, 'not while offline or expired');
  assert.equal(showStop(busy, null, true, 'start'), false, 'no film open on Start');
  assert.equal(showStop(lastFerryOverview(), null, true, 'keyframes'), false, 'idle: unmade shots are not running work');
  assert.equal(showStop({ ...busy, stopped: { stopId: 's', at: 'now', sentJobs: 1, detachedJobs: 0 } }, null, true, 'keyframes'), false, 'already stopped');
  assert.equal(showStop(lastFerryOverview(), { mode: 'native', status: 'running' }, true, 'plan'), true, 'the Director works');
});

test('the Stop confirm counts sent jobs, queued jobs and the Director the way the server will', () => {
  const overview = film({ 'shot-2-1': { video: running('a1') }, 'shot-2-2': { video: queued(0) }, 'shot-2-3': { video: queued(1) } });
  const preview = stopPreview(overview, { mode: 'native', status: 'idle' });
  assert.deepEqual(preview, { sent: 1, queued: 2, director: false });
  assert.deepEqual(stopLines(preview).map(en), ['1 job already sent will finish and be charged.', '2 queued jobs will be taken off; they need a new confirm later.']);
  assert.deepEqual(stopLines(preview).map(zh), ['已发送的 1 个任务会完成并计费。', '2 个排队中的任务会被撤下，之后需要重新确认。']);
  const thinking = stopPreview({ ...lastFerryOverview(), director: { state: 'working', scopeIds: [] } }, null);
  assert.deepEqual(stopLines(thinking).map(en), ['The Director stops working.']);
  // A sent job with no answer yet still finishes or not on the provider's side; Stop cannot take it back.
  const unsure = stopPreview(film({ 'shot-2-1': { video: noAnswer('a1') }, 'shot-1-2': { narration: { state: 'making', text: 'x', fits: true } } }), null);
  assert.equal(unsure.sent, 2);
});

// ---- after the session expired --------------------------------------------------------

const state = {
  projectId: 'last-ferry', view: 'plan', sceneId: 'scene-2', shotId: 'shot-2-3',
  composer: { text: 'Keep the fog', targets: [{ kind: 'shot', id: 'shot-2-3' }, { kind: 'scene', id: 'scene-9' }], sending: false },
};

test('a reconnect carries the unsent message, its chips and the place, once the same film is read', () => {
  const carry = carryFrom(state);
  assert.deepEqual(carry, { projectId: 'last-ferry', view: 'plan', sceneId: 'scene-2', shotId: 'shot-2-3', text: 'Keep the fog', targets: state.composer.targets });
  assert.notEqual(carry.targets, state.composer.targets, 'a copy, not the old store state');
  assert.equal(carryFrom({ ...state, projectId: null }), null);
  assert.equal(carryReady(carry, { projectId: null, overview: null }), 'wait');
  assert.equal(carryReady(carry, { projectId: 'last-ferry', overview: null }), 'wait');
  assert.equal(carryReady(carry, { projectId: 'other', overview: lastFerryOverview() }), 'drop');
  assert.equal(carryReady(carry, { projectId: 'last-ferry', overview: lastFerryOverview() }), 'apply');
});

test('what no longer exists in the film is left out of the carry', () => {
  const kept = carryToApply(carryFrom(state), lastFerryOverview());
  assert.deepEqual(kept.targets, [{ kind: 'shot', id: 'shot-2-3' }], 'the removed scene chip is dropped');
  assert.equal(kept.sceneId, 'scene-2');
  const gone = carryToApply({ ...carryFrom(state), sceneId: 'scene-9', shotId: 'shot-9-9' }, lastFerryOverview());
  assert.deepEqual([gone.sceneId, gone.shotId], [null, null]);
});

test('the reconnect toast mentions the draft only when there was one', () => {
  assert.equal(en(reconnectedToast(carryFrom(state))), 'Connected again. Your unsent message is still in the composer.');
  assert.equal(en(reconnectedToast({ ...carryFrom(state), text: ' ', targets: [] })), 'Connected again.');
  assert.equal(en(reconnectedToast(null)), 'Connected again.');
});
