import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readinessOf, readinessRows, whyNotReady, panelState, lastExport, failureMsg, changeMsg, whenMsg, elapsedSeconds,
  filmFingerprint, changedSince, unavailableMsg, musicMissing, rowsBelow, coverHeight, alignedEndPadding, blockersFirst, filmSeconds, EXPORT_SIZE, STALLED_AFTER_SECONDS,
} from '../../src/next/model/film-export.ts';
import { lastFerryOverview, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => m && translateMsg('en', m);
const zh = m => m && translateMsg('zh-CN', m);
/** A failure as the panel says it: its words, with the code's reason put in. */
const said = (failure, locale = 'en') => failure.reason
  ? translate(locale, failure.text.id, { ...failure.text.values, reason: translateMsg(locale, failure.reason) })
  : translateMsg(locale, failure.text);

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
  assert.equal(filmSeconds(lastFerryOverview()), 48, 'the length without a readiness read');
  const long = finished();
  for (const shot of Object.values(long.shots)) shot.durationFrames = 15 * 30 * 4;
  assert.ok(readinessOf(long, false).blockers.some(b => b.code === 'too_long'));
});

test('the panel says why Export is off in words, both languages', () => {
  const overview = lastFerryOverview();
  const why = whyNotReady(readinessOf(overview, false), overview, 'en');
  assert.deepEqual(why.map(en), ['5 shots need a clip; settle the voice in 2.3 and 3.2']);
  assert.deepEqual(whyNotReady(readinessOf(overview, false), overview, 'zh-CN').map(zh), ['5 个镜头需要视频；另需处理 2.3 和 3.2 的配音']);
  const voiceOnly = finished();
  voiceOnly.shots[shotId('3.2')].narration = { state: 'text_only', text: 'x', estimatedSeconds: 1, fits: true };
  assert.deepEqual(whyNotReady(readinessOf(voiceOnly, false), voiceOnly, 'en').map(en), ['Settle the voice in 3.2']);
  const one = finished();
  one.shots[shotId('2.2')].video = { state: 'none', takeCount: 0 };
  assert.deepEqual(whyNotReady(readinessOf(one, false), one, 'en').map(en), ['1 shot needs a clip']);
  assert.deepEqual(whyNotReady({ ready: false, demo: false, seconds: 400, blockers: [{ code: 'too_long' }, { code: 'mixed_demo_media', shotId: shotId('1.1') }] }, one, 'en').map(en),
    ['Demo clips and made clips can\'t share one export', 'The film is longer than 6:00']);
});

test('a table cut short says how many rows are still below', () => {
  const bottoms = [20, 39, 58, 77, 96, 115];
  assert.equal(rowsBelow(bottoms, 120), 0, 'every row in view');
  assert.equal(rowsBelow(bottoms, 77), 2);
  assert.equal(rowsBelow(bottoms, 70), 3, 'a row cut in half is still to come');
  assert.equal(rowsBelow(bottoms, 80, 20), 3, 'so is a row under the fade and the count');
  assert.equal(rowsBelow(bottoms, 119, 20, true), 0, 'scrolled to the end, nothing is below');
  assert.equal(rowsBelow([], 50), 0);
  // 1280 x 720: the second row's box runs 1 px under the count, but its words end above it, so it is read.
  assert.equal(rowsBelow([259.5, 278.5, 297.5, 316.5], 301.8, 22), 2, 'a row whose words are all above the count is not counted');
});

test('the count over a cut table hides the first row it counts whole, never half of it', () => {
  // Rows 19 px apart: tops 24, 43, 62, 81; their words end 2.25 px above each box bottom.
  const tops = [24, 43, 62, 81];
  const bottoms = tops.map(top => top + 16.75);
  assert.equal(coverHeight(tops, bottoms, 84, 22), 22, 'the next row starts right at the count: the least cover');
  assert.equal(coverHeight(tops, bottoms, 92, 22), 30, 'a row cut in half above the count: the count reaches up to its top');
  assert.equal(coverHeight(tops, bottoms, 92, 22, true), 0, 'scrolled to the end, no count');
  assert.equal(coverHeight(tops, bottoms, 200, 22), 0, 'every row in view');
});

test('a scrolling table\'s last scroll position lands on a row edge', () => {
  // 20 rows 19 px apart under a 25 px header, in a table 170 px tall: 145 px of rows show, 7 whole rows and 12 px.
  assert.equal(alignedEndPadding(145, 19, 20), 12);
  const pad = alignedEndPadding(145, 19, 20);
  const lastScroll = 25 + 20 * 19 + pad - 170;
  assert.equal(lastScroll % 19, 0, 'the end is a whole number of rows down');
  assert.equal(alignedEndPadding(145, 19, 7), null, 'every row fits: nothing scrolls');
  assert.equal(alignedEndPadding(152, 19, 9), 0, 'the rows already end on an edge');
  assert.equal(alignedEndPadding(100, 0, 9), null);
});

test('the shots that stop the export are listed first, each group in storyboard order', () => {
  const rows = readinessRows(lastFerryOverview(), false);
  assert.deepEqual(rows.map(r => `${r.label}${r.blocks ? '!' : ''}`), ['1.1', '1.2', '1.3', '2.1!', '2.2!', '2.3!', '3.1!', '3.2!']);
  assert.deepEqual(blockersFirst(rows).map(r => r.label), ['2.1', '2.2', '2.3', '3.1', '3.2', '1.1', '1.2', '1.3']);
  // The flag follows the server's rule: a clip made and a voice settled (or no line) does not block.
  const voiceOnly = finished();
  voiceOnly.shots[shotId('1.2')].narration = { state: 'text_only', text: 'x', estimatedSeconds: 1, fits: true };
  assert.deepEqual(blockersFirst(readinessRows(voiceOnly, false)).map(r => r.label).slice(0, 2), ['1.2', '1.1']);
  assert.deepEqual(readinessRows(finished(), false).filter(r => r.blocks), [], 'a ready film has nothing that blocks');
  const blocked = new Set(readinessOf(lastFerryOverview(), false).blockers.map(b => b.shotId));
  assert.deepEqual(rows.filter(r => r.blocks).map(r => r.shotId), rows.map(r => r.shotId).filter(id => blocked.has(id)), 'the same shots as the server\'s blockers');
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
  failing.shots[shotId('2.2')].video = { state: 'no_answer', takeCount: 1 };
  assert.deepEqual(readinessRows(failing, false).slice(3, 5).map(r => en(r.clip.text)), ['no clip', 'no clip'], 'a failed or unanswered clip counts as no clip in readiness');
});

const record = (over = {}) => ({ exportId: 'e1', state: 'done', headVersion: 3, demo: false, startedAt: '2026-10-15T14:00:00', finishedAt: '2026-10-15T14:02:00', artifact: { artifactId: 'mp4', sha256: 'a'.repeat(64), kind: 'video' }, outdatedBy: [], ...over });

test('panel state: rendering, interrupted by a restart, failed, cancelled', () => {
  assert.deepEqual(panelState(null, null), { kind: 'idle', failed: null, cancelled: false });
  const rendering = record({ state: 'rendering', finishedAt: undefined, artifact: undefined });
  const view = { readiness: readinessOf(finished(), false), current: rendering, history: [] };
  assert.equal(panelState(view, { jobs: [{ id: 'e1', state: 'running', canRecover: false }], lastExport: null }).kind, 'rendering');
  assert.equal(panelState(view, { jobs: [{ id: 'e1', state: 'running', canRecover: true }], lastExport: null }).kind, 'interrupted', 'a render nobody owns after a restart');
  assert.equal(panelState(view, null).kind, 'rendering', 'without the media read it is shown as rendering');
  const failed = panelState({ ...view, current: record({ state: 'failed', failure: { code: 'MEDIA_TOOL_FAILED' } }) }, null);
  assert.equal(said(failed.failed), 'The last export stopped. FFmpeg ended with an error. You can export again.');
  assert.equal(said(failed.failed, 'zh-CN'), '上次导出中断了。FFmpeg 运行出错。可以重新导出。');
  assert.equal(failed.failed.code, 'MEDIA_TOOL_FAILED', 'the code stays as a detail');
  assert.ok(!said(failed.failed).includes('MEDIA_'), 'the reason is words, not the code');
  assert.equal(said(failureMsg('MEDIA_TIMEOUT')), 'The last export stopped. FFmpeg took longer than its time limit. You can export again.');
  // A code without words of its own gets the general reason, still in words.
  assert.equal(said(failureMsg('RENDER_FAILED')), 'The last export stopped. FFmpeg could not finish rendering the film. You can export again.');
  assert.equal(said(failureMsg(undefined)), 'The last export stopped. FFmpeg could not finish rendering the film. You can export again.');
  assert.equal(said(failureMsg('MEDIA_NO_COMPLETION')), 'Check again found no finished file. Export again to render the film.');
  assert.equal(panelState({ ...view, current: record({ state: 'cancelled' }) }, null).cancelled, true);
  assert.equal(said(failureMsg('MEDIA_PAUSED')), 'The film was stopped before this export began. Continue, then export again.');
});

test('an export prepared and never started (a restart came first) offers Export again once it is clearly stuck', () => {
  const started = Date.parse('2026-10-15T14:00:00Z');
  const view = { readiness: readinessOf(finished(), false), current: record({ state: 'rendering', startedAt: '2026-10-15T14:00:00Z', finishedAt: undefined, artifact: undefined }), history: [] };
  const media = { jobs: [{ id: 'e1', state: 'prepared', canRecover: false, canRun: true, createdAt: '2026-10-15T14:00:00Z' }], lastExport: null };
  assert.equal(panelState(view, media, started + 2000).kind, 'rendering', 'just prepared: it is about to start');
  const stuck = panelState(view, media, started + STALLED_AFTER_SECONDS * 1000);
  assert.equal(stuck.kind, 'idle');
  assert.equal(said(stuck.failed), 'The last export never started: OpenSlate restarted first. Nothing was rendered; you can export again.');
  assert.equal(said(stuck.failed, 'zh-CN'), '上次导出还没开始 OpenSlate 就重启了，没有渲染任何内容，可以重新导出。');
  const running = { jobs: [{ id: 'e1', state: 'running', canRecover: false, canRun: false, createdAt: '2026-10-15T14:00:00Z' }], lastExport: null };
  assert.equal(panelState(view, running, started + 600_000).kind, 'rendering', 'a long render that is running is not stuck');
});

test('a readiness read that fails on the film\'s music says so and offers Change music', () => {
  for (const code of ['MEDIA_ARTIFACT_UNAVAILABLE', 'MEDIA_SOURCE_UNAVAILABLE']) {
    const value = unavailableMsg(code);
    assert.equal(value.music, true);
    assert.equal(en(value.text), 'The film\'s music is unavailable, so the film can\'t be checked for export. Change music.');
  }
  const older = unavailableMsg('NOT_FOUND');
  assert.deepEqual([older.music, en(older.text)], [false, 'This studio can\'t export from the storyboard yet (NOT_FOUND).']);
  assert.deepEqual(['MEDIA_ARTIFACT_UNAVAILABLE', 'MEDIA_SOURCE_UNAVAILABLE', 'NOT_FOUND', null].map(musicMissing), [true, true, false, false], 'the music lane and player follow the same read');
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

test('an export half an hour earlier shows its actual date across local midnight, in both languages', () => {
  const now = new Date(2026, 9, 16, 0, 15);
  const earlier = new Date(now.getTime() - 30 * 60_000).toISOString();
  assert.equal(en(whenMsg(earlier, now, 'en-US')), 'Oct 15 23:45');
  assert.equal(zh(whenMsg(earlier, now, 'zh-CN')), '10月15日 23:45');
  const noon = new Date(2026, 9, 16, 12);
  const recent = new Date(noon.getTime() - 30 * 60_000).toISOString();
  assert.equal(en(whenMsg(recent, noon, 'en-US')), 'Today 11:30');
  assert.equal(zh(whenMsg(recent, noon, 'zh-CN')), '今天 11:30');
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
