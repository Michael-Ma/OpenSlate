import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readinessOf, readinessRows, whyNotReady, panelState, lastExport, failureMsg, changeMsg, whenMsg, elapsedSeconds,
  filmFingerprint, changedSince, EXPORT_SIZE,
} from '../../src/next/model/film-export.ts';
import { lastFerryOverview, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => m && translateMsg('en', m);
const zh = m => m && translateMsg('zh-CN', m);

/** Every clip made, 2.3 lengthened for its line and 3.2 voiced: ready to export. */
function finished() {
  const overview = lastFerryOverview();
  for (const shot of Object.values(overview.shots)) {
    shot.video = { state: 'ready', artifact: { artifactId: `c-${shot.label}`, sha256: 'f'.repeat(64), kind: 'video' }, takeCount: 1 };
  }
  overview.shots[shotId('2.3')].narration = { ...overview.shots[shotId('2.3')].narration, fits: true, fit: 'extend_shot' };
  overview.shots[shotId('2.3')].durationFrames = 240;
  overview.shots[shotId('3.2')].narration = { state: 'ready', text: 'I didn’t look back.', measuredSeconds: 1.6, fits: true };
  return overview;
}

test('readiness follows the server rule: a current clip and a settled voice for every shot', () => {
  const now = readinessOf(lastFerryOverview(), false);
  assert.equal(now.ready, false);
  assert.equal(now.seconds, 48);
  assert.deepEqual(now.blockers.map(b => `${b.code}:${b.shotId?.slice(5)}`), [
    'no_clip:2-1', 'no_clip:2-2', 'no_clip:2-3', 'voice_unsettled:2-3', 'no_clip:3-1', 'no_clip:3-2', 'voice_unsettled:3-2',
  ]);
  const done = readinessOf(finished(), false);
  assert.deepEqual([done.ready, done.demo, done.seconds, done.blockers], [true, false, 50, []]);
  assert.equal(readinessOf(finished(), true).demo, true);
  const outdated = finished();
  outdated.shots[shotId('1.1')].video = { state: 'outdated', previous: outdated.shots[shotId('1.1')].video.artifact, takeCount: 1 };
  assert.deepEqual(readinessOf(outdated, false).blockers, [{ code: 'clip_outdated', shotId: shotId('1.1') }]);
  assert.deepEqual(readinessOf({ ...lastFerryOverview(), scenes: [], shots: {} }, false).blockers, [{ code: 'empty_film' }]);
  const long = finished();
  for (const shot of Object.values(long.shots)) shot.durationFrames = 15 * 30 * 4;
  assert.ok(readinessOf(long, false).blockers.some(b => b.code === 'too_long'));
});

test('the panel says why Export is off in words, both languages', () => {
  const overview = lastFerryOverview();
  const why = whyNotReady(readinessOf(overview, false), overview, 'en');
  assert.deepEqual(why.map(en), ['5 shots need a clip and settle the voice in 2.3 and 3.2']);
  assert.deepEqual(whyNotReady(readinessOf(overview, false), overview, 'zh-CN').map(zh), ['5 个镜头需要视频，并处理 2.3和3.2 的配音']);
  const voiceOnly = finished();
  voiceOnly.shots[shotId('3.2')].narration = { state: 'text_only', text: 'x', estimatedSeconds: 1, fits: true };
  assert.deepEqual(whyNotReady(readinessOf(voiceOnly, false), voiceOnly, 'en').map(en), ['Settle the voice in 3.2']);
  const one = finished();
  one.shots[shotId('2.2')].video = { state: 'none', takeCount: 0 };
  assert.deepEqual(whyNotReady(readinessOf(one, false), one, 'en').map(en), ['1 shot needs a clip']);
  assert.deepEqual(whyNotReady({ ready: false, demo: false, seconds: 400, blockers: [{ code: 'too_long' }, { code: 'mixed_demo_media', shotId: shotId('1.1') }] }, one, 'en').map(en),
    ['Demo clips and made clips can\'t share one export', 'The film is longer than 6:00']);
});

test('per-shot rows: Clip and Voice columns, green only when done', () => {
  const rows = readinessRows(lastFerryOverview(), false);
  assert.deepEqual(rows.map(r => [r.label, en(r.clip.text), r.clip.tone, en(r.voice.text), r.voice.tone]), [
    ['1.1', 'clip', 'ok', 'no line', 'plain'],
    ['1.2', 'clip', 'ok', '2.1 s', 'ok'],
    ['1.3', 'clip', 'ok', 'no line', 'plain'],
    ['2.1', 'no clip', 'plain', 'no line', 'plain'],
    ['2.2', 'no clip', 'plain', 'no line', 'plain'],
    ['2.3', 'no clip', 'plain', '7.4 s, too long', 'plain'],
    ['3.1', 'no clip', 'plain', 'no line', 'plain'],
    ['3.2', 'no clip', 'plain', 'no voice yet', 'plain'],
  ]);
  assert.equal(en(readinessRows(finished(), true)[0].clip.text), 'demo clip');
  const cut = lastFerryOverview();
  cut.shots[shotId('2.3')].narration.fit = 'cut_to_shot';
  assert.equal(en(readinessRows(cut, false)[5].voice.text), '7.4 s, cut');
  const failing = lastFerryOverview();
  failing.shots[shotId('2.1')].video = { state: 'failed', takeCount: 1, failure: { code: 'X', technical: true, retryAllowed: true, autoRetriesLeft: 0, charged: true, at: '' } };
  assert.equal(en(readinessRows(failing, false)[3].clip.text), 'failed');
});

const record = (over = {}) => ({ exportId: 'e1', state: 'done', headVersion: 3, demo: false, startedAt: '2026-10-15T14:00:00', finishedAt: '2026-10-15T14:02:00', artifact: { artifactId: 'mp4', sha256: 'a'.repeat(64), kind: 'video' }, outdatedBy: [], ...over });

test('panel state: rendering, interrupted by a restart, failed, cancelled', () => {
  assert.deepEqual(panelState(null, null), { kind: 'idle', failed: null, cancelled: false });
  const rendering = record({ state: 'rendering', finishedAt: undefined, artifact: undefined });
  const view = { readiness: readinessOf(finished(), false), current: rendering, history: [] };
  assert.equal(panelState(view, { jobs: [{ id: 'e1', state: 'running', canRecover: false }], lastExport: null }).kind, 'rendering');
  assert.equal(panelState(view, { jobs: [{ id: 'e1', state: 'running', canRecover: true }], lastExport: null }).kind, 'interrupted', 'a render nobody owns after a restart');
  assert.equal(panelState(view, null).kind, 'rendering', 'without the media read it is shown as rendering');
  const failed = panelState({ ...view, current: record({ state: 'failed', failure: { code: 'RENDER_FAILED' } }) }, null);
  assert.equal(en(failed.failed), 'The last export stopped (RENDER_FAILED). Exports render on this computer and cost nothing; you can export again.');
  assert.equal(en(failureMsg('MEDIA_NO_COMPLETION')), 'Check again found no finished file. Export again to render the film.');
  assert.equal(panelState({ ...view, current: record({ state: 'cancelled' }) }, null).cancelled, true);
});

test('the last export stays downloadable and says what changed since', () => {
  const latest = record({ outdatedBy: ['order', 'music'] });
  const view = { readiness: readinessOf(finished(), false), current: record({ exportId: 'e3', state: 'rendering', artifact: undefined, finishedAt: undefined }), history: [latest, record({ exportId: 'e0' }), record({ exportId: 'e-1', state: 'failed', artifact: undefined })] };
  const last = lastExport(view, null);
  assert.equal(last.record.exportId, 'e1', 'a render in progress does not hide the last finished export');
  assert.equal(last.earlier, 1);
  assert.deepEqual(last.outdatedBy.map(k => en(changeMsg(k))), ['shot order', 'music']);
  assert.deepEqual(last.outdatedBy.map(k => zh(changeMsg(k))), ['镜头顺序', '音乐']);
  assert.equal(lastExport({ ...view, current: null, history: [] }, null), null);
  const legacy = lastExport(null, { jobs: [], lastExport: { artifact: latest.artifact, outdated: true, outdatedBy: ['shots'] } });
  assert.deepEqual([legacy.record, legacy.outdatedBy], [null, ['shots']], 'an older plan render still counts');
});

test('times read as today or a date, and elapsed time never goes negative', () => {
  const now = new Date(2026, 9, 15, 15, 0);
  assert.equal(en(whenMsg(new Date(2026, 9, 15, 14, 2).toISOString(), now, 'en-US')), 'Today 14:02');
  assert.equal(zh(whenMsg(new Date(2026, 9, 15, 14, 2).toISOString(), now, 'zh-CN')), '今天 14:02');
  assert.match(en(whenMsg(new Date(2026, 9, 13, 9, 5).toISOString(), now, 'en-US')), /^Oct 13 09:05$/);
  assert.equal(whenMsg(null, now, 'en-US'), null);
  assert.equal(elapsedSeconds('2026-10-15T14:00:00Z', Date.parse('2026-10-15T14:01:05Z')), 65);
  assert.equal(elapsedSeconds('2026-10-15T14:00:00Z', Date.parse('2026-10-15T13:59:00Z')), 0);
  assert.deepEqual(EXPORT_SIZE, { width: 1280, height: 720 });
});

test('fingerprints tell which of shots, order, music and narration changed', () => {
  const before = filmFingerprint(finished(), { audioId: 'a', gainMilliDb: -18000 });
  assert.deepEqual(changedSince(before, filmFingerprint(finished(), { audioId: 'a', gainMilliDb: -18000 })), []);
  assert.deepEqual(changedSince(before, filmFingerprint(finished(), { audioId: 'a', gainMilliDb: -12000 })), ['music']);
  const moved = finished();
  moved.scenes[1].shotIds = [shotId('2.2'), shotId('2.1'), shotId('2.3')];
  assert.deepEqual(changedSince(before, filmFingerprint(moved, { audioId: 'a', gainMilliDb: -18000 })), ['order']);
  const longer = finished();
  longer.shots[shotId('2.1')].durationFrames = 180;
  assert.deepEqual(changedSince(before, filmFingerprint(longer, { audioId: 'a', gainMilliDb: -18000 })), ['shots']);
  const line = finished();
  line.shots[shotId('1.2')].narration = { ...line.shots[shotId('1.2')].narration, text: 'Two for the morning boat.' };
  assert.deepEqual(changedSince(before, filmFingerprint(line, { audioId: 'a', gainMilliDb: -18000 })), ['narration']);
});
