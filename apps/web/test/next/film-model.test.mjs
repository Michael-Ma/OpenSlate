import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filmTimeline, shotAt, lineAt, previousTime, nextTime, rulerTicks, tickLabels, separatorShown, wordsCut, filmMusic, musicSpan, musicOn, musicLostAt,
  lengthLimits, lengthEdit, moveEdit, musicStartEdit, musicGainEdit, musicMuteEdit, musicChoiceEdit, editPressId, soundtrackOf, lengthToast, clipStillOut,
} from '../../src/next/model/film.ts';
import { FilmClock } from '../../src/next/model/film-clock.ts';
import { lastFerryOverview, lastFerrySnapshot, shotId, sceneId } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => m && translateMsg('en', m);
const zh = m => m && translateMsg('zh-CN', m);

test('the timeline lays every shot out in storyboard order from the overview', () => {
  const tl = filmTimeline(lastFerryOverview());
  assert.equal(tl.total, 48);
  assert.equal(tl.clipsReady, 3);
  assert.deepEqual(tl.scenes.map(s => [s.ordinal, s.title, s.start, s.seconds]), [[1, 'Closing time', 0, 17], [2, 'Harbour at dawn', 17, 15], [3, 'Departure', 32, 16]]);
  assert.deepEqual(tl.shots.map(s => [s.label, s.start, s.seconds, s.picture, en(s.lack)]), [
    ['1.1', 0, 6, 'clip', null], ['1.2', 6, 5, 'clip', null], ['1.3', 11, 6, 'clip', null],
    ['2.1', 17, 5, 'keyframe', 'no clip'], ['2.2', 22, 4, 'keyframe', 'no clip'], ['2.3', 26, 6, 'keyframe', 'no clip'],
    ['3.1', 32, 8, 'none', 'nothing yet'], ['3.2', 40, 8, 'none', 'nothing yet'],
  ]);
  assert.deepEqual(tl.shots.map(s => `${s.index}/${s.sceneSize}`), ['0/3', '1/3', '2/3', '0/3', '1/3', '2/3', '0/2', '1/2']);
});

test('the narration lane: a settled line is placed, a too-long one is not placed, a line without voice waits', () => {
  const tl = filmTimeline(lastFerryOverview());
  const lines = tl.shots.filter(s => s.line).map(s => s.line);
  assert.deepEqual(lines.map(l => [l.label, l.state, l.start, l.laneSeconds, l.lineSeconds]), [
    ['1.2', 'placed', 6, 2.1, 2.1],
    ['2.3', 'too_long', 26, 7.4, 7.4],
    ['3.2', 'no_voice', 40, 3, 1.6],
  ]);
  // A cut line is placed and heard only up to the shot's end.
  const overview = lastFerryOverview();
  overview.shots[shotId('2.3')].narration = { ...overview.shots[shotId('2.3')].narration, fit: 'cut_to_shot' };
  const cut = filmTimeline(overview).shots.find(s => s.label === '2.3').line;
  assert.deepEqual([cut.state, cut.laneSeconds, cut.cut], ['placed', 6, true]);
});

test('one clock: the shot, its local time and the spoken line at any film time', () => {
  const tl = filmTimeline(lastFerryOverview());
  assert.deepEqual([shotAt(tl, 0).shot.label, shotAt(tl, 0).local], ['1.1', 0]);
  assert.deepEqual([shotAt(tl, 6).shot.label, shotAt(tl, 6).local], ['1.2', 0]);
  assert.equal(shotAt(tl, 47.9).shot.label, '3.2');
  assert.deepEqual([shotAt(tl, 48).shot.label, shotAt(tl, 48).local], ['3.2', 8], 'the end shows the last shot at its end');
  assert.equal(lineAt(tl, 7)?.text, 'One for the morning boat.');
  assert.equal(lineAt(tl, 8.2), null, 'the 2.1 s line has ended');
  assert.equal(lineAt(tl, 27), null, 'a too-long line is not placed, so it is never heard');
  assert.equal(lineAt(tl, 41), null, 'a line with no voice is not heard');
  assert.equal(shotAt(filmTimeline({ ...lastFerryOverview(), scenes: [], shots: {} }), 3), null);
});

test('previous and next jump by shot like a player', () => {
  const tl = filmTimeline(lastFerryOverview());
  assert.equal(nextTime(tl, 0), 6);
  assert.equal(nextTime(tl, 45), 48, 'next on the last shot goes to the end');
  assert.equal(previousTime(tl, 8), 6, 'more than a second in: back to this shot\'s start');
  assert.equal(previousTime(tl, 6.5), 0, 'near the start: to the previous shot');
  assert.equal(previousTime(tl, 0.5), 0);
});

test('ruler marks stay readable on short and long films', () => {
  assert.deepEqual(rulerTicks(48, null), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]);
  assert.equal(rulerTicks(360, null).length, 13);
  assert.deepEqual(rulerTicks(12, 14), [0, 5, 10]);
});

test('the last ruler label is never cut off at the lane\'s end', () => {
  // 36 s on an 880 px lane: 0:35 sits 24 px from the end, too little for its label, so it goes before its mark.
  assert.deepEqual(tickLabels(rulerTicks(36, null), 36, 880, 32), ['after', 'after', 'after', 'after', 'after', 'after', 'after', 'before']);
  // 48 s: 0:45 has 55 px left, enough to sit after its mark.
  assert.ok(tickLabels(rulerTicks(48, null), 48, 880, 32).every(place => place === 'after'));
  // Too crowded to move it back without running into 0:30: it is left out (the mark stays).
  assert.deepEqual(tickLabels([0, 30, 35], 36, 200, 32), ['after', 'after', 'none']);
  assert.deepEqual(tickLabels([0, 5, 10], 12, null), ['after', 'after', 'after'], 'unmeasured: as before');
  // Phone: 14 px a second, the lane is the film's length.
  assert.deepEqual(tickLabels(rulerTicks(12, 14), 12, 12 * 14, 32), ['after', 'after', 'before']);
});

test('a separator in the tool row never ends or starts a line', () => {
  const line1 = { top: 100, bottom: 130 }, line2 = { top: 140, bottom: 170 }, sep = { top: 105, bottom: 125 };
  assert.equal(separatorShown(line1, sep, line1), true);
  assert.equal(separatorShown(line1, sep, line2), false, 'the next item wrapped: it would end line 1');
  assert.equal(separatorShown(line1, { top: 145, bottom: 165 }, line2), false, 'it wrapped itself: it would start line 2');
  assert.equal(separatorShown(null, sep, line1), false);
  assert.equal(separatorShown({ top: 100, bottom: 160 }, sep, line1), true, 'a tall item beside it is on the same line');
});

test('a block\'s state words that do not fit are cut; its mark says the same in one sign', () => {
  assert.equal(wordsCut({ scrollWidth: 30, clientWidth: 30, scrollHeight: 25, clientHeight: 25 }), false);
  assert.equal(wordsCut({ scrollWidth: 30.5, clientWidth: 30, scrollHeight: 25.8, clientHeight: 25 }), false, 'a pixel of rounding is not a cut');
  assert.equal(wordsCut({ scrollWidth: 30, clientWidth: 30, scrollHeight: 38, clientHeight: 25 }), true, 'a third line under the clamp');
  assert.equal(wordsCut({ scrollWidth: 44, clientWidth: 30, scrollHeight: 25, clientHeight: 25 }), true, 'a word wider than the block');
  const overview = lastFerryOverview();
  overview.shots[shotId('1.1')].video = { state: 'failed', takeCount: 1, failure: { code: 'X', technical: true, retryAllowed: true, autoRetriesLeft: 0, charged: true, at: '' } };
  overview.shots[shotId('1.2')].video = { state: 'no_answer', takeCount: 1 };
  overview.shots[shotId('1.3')].video = { state: 'running', takeCount: 1 };
  const tl = filmTimeline(overview);
  assert.deepEqual(tl.shots.map(s => s.mark), ['failed', 'no_answer', 'making', 'none', 'none', 'none', 'none', 'none']);
  assert.deepEqual(tl.shots.map(s => en(s.lack)), ['failed', 'no answer', 'making clip', 'no clip', 'no clip', 'no clip', 'nothing yet', 'nothing yet'], 'the words stay the same');
  // Lines: a placed line has no mark (its number stays); an unplaced one has its state's.
  assert.deepEqual(filmTimeline(lastFerryOverview()).shots.filter(s => s.line).map(s => [s.label, s.line.mark]), [['1.2', null], ['2.3', 'too_long'], ['3.2', 'none']]);
  const voices = lastFerryOverview();
  voices.shots[shotId('3.2')].narration = { ...voices.shots[shotId('3.2')].narration, state: 'failed' };
  assert.equal(filmTimeline(voices).shots.find(s => s.label === '3.2').line.mark, 'failed');
});

test('the music library reads every page without repeats', async () => {
  const { libraryRecordings } = await import('../../src/next/model/film.ts');
  const rec = id => ({ id, label: `${id}.wav`, sha256: 'a'.repeat(64), durationSeconds: 30, role: 'music' });
  const first = { recordings: [rec('a'), rec('b')], coverage: { offset: 0, total: 4, nextOffset: 2 } };
  assert.deepEqual(libraryRecordings(first, [rec('b'), rec('c'), rec('d')]).map(r => r.id), ['a', 'b', 'c', 'd']);
  const shrunk = { recordings: [rec('a')], coverage: { offset: 0, total: 1, nextOffset: null } };
  assert.deepEqual(libraryRecordings(shrunk, [rec('c')]).map(r => r.id), ['a'], 'pages read before a shrink are dropped');
  assert.deepEqual(libraryRecordings({ recordings: [rec('a')] }, []).map(r => r.id), ['a'], 'an older server sends no coverage');
});

test('music: one track from the soundtrack and the music library', () => {
  const library = [{ id: 'a', label: 'low-tide.mp3', sha256: 'x', durationSeconds: 72 }];
  const music = filmMusic({ audioId: 'a', gainMilliDb: -18000, startFrame: 120 }, library, 30);
  assert.deepEqual(music, { audioId: 'a', label: 'low-tide.mp3', sha256: 'x', seconds: 72, start: 4, gainDb: -18, muted: false, missing: false });
  assert.deepEqual(musicSpan(music, 48), { start: 4, seconds: 44 });
  assert.equal(musicOn(music, 3.9, 48), false);
  assert.equal(musicOn(music, 4, 48), true);
  assert.equal(musicOn({ ...music, muted: true }, 10, 48), false);
  assert.deepEqual(musicSpan({ ...music, seconds: 10 }, 48), { start: 4, seconds: 10 });
  assert.equal(filmMusic(null, library, 30), null);
  assert.equal(filmMusic({ audioId: 'gone', gainMilliDb: 0 }, library, 30).label, null, 'unknown recordings are still shown');
  const gone = filmMusic({ audioId: 'gone', gainMilliDb: -18000 }, library, 30, true);
  assert.equal(gone.missing, true);
  assert.equal(musicOn(gone, 10, 48), false, 'unavailable music is never shown as playing');
  assert.deepEqual([musicLostAt(gone, 0, 48), musicLostAt(gone, 47.9, 48), musicLostAt(music, 10, 48)], [true, true, false], 'the player says so instead');
  assert.equal(musicLostAt({ ...gone, muted: true }, 10, 48), false, 'muted music is not heard either way');
  assert.equal(musicLostAt({ ...gone, start: 4 }, 3, 48), false, 'not before its start');
  assert.deepEqual(soundtrackOf({ ...lastFerrySnapshot(), project: { ...lastFerrySnapshot().project, soundtrack: { audioId: 'a', gainMilliDb: 0 } } }), { audioId: 'a', gainMilliDb: 0 });
  assert.equal(soundtrackOf(lastFerrySnapshot()), null);
});

test('length is 3–15 s and never below an accepted voice line (SB-8)', () => {
  const overview = lastFerryOverview();
  assert.deepEqual(lengthLimits(overview.shots[shotId('2.1')], 30), { min: 3, max: 15, voiceFloor: null });
  assert.deepEqual(lengthLimits(overview.shots[shotId('1.2')], 30), { min: 3, max: 15, voiceFloor: null }, 'a 2.1 s line needs no more than 3 s');
  assert.deepEqual(lengthLimits(overview.shots[shotId('2.3')], 30), { min: 3, max: 15, voiceFloor: null }, 'a too-long line is not accepted yet');
  const extended = { ...overview.shots[shotId('2.3')], durationFrames: 240, narration: { ...overview.shots[shotId('2.3')].narration, fits: true, fit: 'extend_shot' } };
  assert.deepEqual(lengthLimits(extended, 30), { min: 8, max: 15, voiceFloor: 8 });
  const cut = { ...overview.shots[shotId('2.3')], narration: { ...overview.shots[shotId('2.3')].narration, fit: 'cut_to_shot' } };
  assert.equal(lengthLimits(cut, 30).min, 6, 'a cut line keeps the length it was cut to');
  assert.equal(lengthEdit(extended, 30, -1), null, 'shorter than the voice line is refused here, not by the server');
  assert.deepEqual(lengthEdit(extended, 30, 1), { edit: { kind: 'shot', id: shotId('2.3'), field: 'desiredFrames', value: '270' }, seconds: 9 });
  assert.equal(lengthEdit({ ...extended, durationFrames: 450 }, 30, 1), null);
  assert.equal(en(lengthToast('2.3', 9, 51, true)), '2.3 is 9 s. The film is 51 s; 2.3\'s clip is out of date.');
  assert.equal(zh(lengthToast('2.3', 9, 51, false)), '2.3 改为 9 秒，影片 51 秒。');
});

test('moves stay within the scene and name the shot\'s new label', () => {
  const overview = lastFerryOverview();
  assert.equal(moveEdit(overview, shotId('2.1'), -1), null, 'first in its scene');
  assert.equal(moveEdit(overview, shotId('2.3'), 1), null, 'last in its scene');
  assert.deepEqual(moveEdit(overview, shotId('2.2'), -1), { edit: { kind: 'moveShot', id: shotId('2.2'), sceneId: sceneId(2), beforeId: shotId('2.1') }, label: '2.1' });
  assert.deepEqual(moveEdit(overview, shotId('2.1'), 1), { edit: { kind: 'moveShot', id: shotId('2.1'), sceneId: sceneId(2), beforeId: shotId('2.3') }, label: '2.2' });
  assert.deepEqual(moveEdit(overview, shotId('2.2'), 1), { edit: { kind: 'moveShot', id: shotId('2.2'), sceneId: sceneId(2) }, label: '2.3' }, 'to the end: no beforeId');
});

test('music edits are soundtrack commands in the server\'s units', () => {
  const music = { audioId: 'a', label: 'x', sha256: null, seconds: 72, start: 4, gainDb: -18, muted: false };
  assert.deepEqual(musicStartEdit(music, 30, 1, 48), { kind: 'soundtrack', field: 'startFrame', value: '150' });
  assert.equal(musicStartEdit({ ...music, start: 0 }, 30, -1, 48), null);
  assert.equal(musicStartEdit({ ...music, start: 47 }, 30, 1, 48), null);
  assert.deepEqual(musicGainEdit(-12.4), { kind: 'soundtrack', field: 'gainMilliDb', value: '-12000' });
  assert.deepEqual(musicGainEdit(5), { kind: 'soundtrack', field: 'gainMilliDb', value: '0' });
  assert.deepEqual(musicMuteEdit(true), { kind: 'soundtrack', field: 'muted', value: 'true' });
  assert.deepEqual(musicChoiceEdit(null), { kind: 'soundtrack', field: 'audioId', value: '' });
  assert.equal(editPressId(musicChoiceEdit('a')), 'edit:soundtrack:audioId');
  assert.equal(editPressId(moveEdit(lastFerryOverview(), shotId('2.2'), 1).edit), `edit:moveShot:${shotId('2.2')}`);
});

test('Director notes put their letter on the shot; app facts do not', () => {
  const note = (letter, shots, state = 'open') => ({ noteId: letter, requestId: 'r', turnId: 't', letter, anchor: { shotIds: shots }, kind: 'observation', blocking: false, text: '', choices: [], state, version: 1, createdAt: '' });
  const tl = filmTimeline(lastFerryOverview(), [note('a', [shotId('2.2')]), note('b', [shotId('2.3')], 'resolved')]);
  assert.deepEqual(tl.shots.filter(s => s.letter).map(s => [s.label, s.letter]), [['2.2', 'a']]);
});

test('the film clock plays, seeks, pauses and stops at the end on a driven frame source', () => {
  let now = 0;
  const queue = [];
  const frames = { now: () => now, request: cb => { queue.push(cb); return queue.length; }, cancel: () => { queue.length = 0; } };
  const tick = ms => { now += ms; const cbs = queue.splice(0); for (const cb of cbs) cb(now); };
  const clock = new FilmClock(frames);
  clock.setTotal(10);
  let changes = 0;
  clock.subscribe(() => changes++);
  clock.play();
  assert.equal(clock.playing, true);
  tick(2500);
  assert.equal(clock.time, 2.5);
  clock.seek(8);
  tick(1000);
  assert.equal(clock.time, 9, 'a seek while playing continues from the new place');
  tick(5000);
  assert.deepEqual([clock.time, clock.playing], [10, false], 'it stops at the end');
  clock.play();
  assert.equal(clock.time, 0, 'play at the end starts again');
  clock.pause();
  assert.equal(clock.playing, false);
  clock.setTotal(4);
  clock.seek(9);
  assert.equal(clock.time, 4, 'seeks stay inside the film');
  assert.ok(changes > 4);
  const state = clock.getState();
  assert.equal(clock.getState(), state, 'the state is stable between changes');
});

test('the Film catalog adds ids without replacing any other area\'s message', async () => {
  const { filmMessages } = await import('../../src/next/i18n/catalog/film.ts');
  const others = await Promise.all(['shell', 'keyframes', 'director', 'notes', 'errors', 'plan', 'assets', 'settings', 'start']
    .map(name => import(`../../src/next/i18n/catalog/${name}.ts`)));
  const taken = new Set(others.flatMap(module => Object.values(module).flatMap(value => (value && typeof value === 'object' ? Object.keys(value) : []))));
  const clashes = Object.keys(filmMessages).filter(id => taken.has(id));
  assert.deepEqual(clashes, []);
});

test('a clip waiting for a person\'s confirm, or stopped, is not "being made"', async () => {
  const { readinessRows } = await import('../../src/next/model/film-export.ts');
  const overview = lastFerryOverview();
  overview.shots[shotId('2.1')].video = { state: 'queued', takeCount: 0, waiting: { code: 'review', since: '' } };
  overview.shots[shotId('2.2')].video = { state: 'queued', takeCount: 0, waiting: { code: 'capacity', ahead: 1, since: '' } };
  overview.shots[shotId('2.3')].video = { state: 'running', takeCount: 0 };
  const tl = filmTimeline(overview);
  assert.deepEqual(tl.shots.slice(3, 6).map(s => en(s.lack)), ['no clip', 'making clip', 'making clip']);
  assert.deepEqual(readinessRows(overview, false).slice(3, 6).map(r => en(r.clip.text)), ['no clip', 'making…', 'making…']);
});

test('Film names input and unknown waits in both locales without claiming that unknown work is being made', async () => {
  const { making } = await import('../../src/next/model/film.ts');
  const { clipCell } = await import('../../src/next/model/film-export.ts');
  const overview = lastFerryOverview(), shot = overview.shots[shotId('2.1')];
  for (const [code, english, chinese, moves] of [
    ['input_pending', 'Waiting for required media', '等待所需素材', false],
    ['unknown', 'Waiting for the studio to report its status', '等待工作室报告状态', false],
    [undefined, 'Waiting for the studio to report its status', '等待工作室报告状态', false],
    ['timing', 'Waiting for narration timing', '等待确定旁白时长', false],
  ]) {
    shot.video = { state: 'queued', takeCount: 0, ...(code ? { waiting: { code, since: '' } } : {}) };
    const block = filmTimeline(overview).shots.find(s => s.shotId === shot.shotId), cell = clipCell(shot, false);
    assert.equal(making(shot.video), moves, String(code));
    assert.deepEqual([en(block.lack), zh(block.lack)], [english, chinese]);
    assert.deepEqual([en(cell.text), zh(cell.text), cell.tone], [english, chinese, 'plain']);
  }
});

test('Film preserves proven automatic retry activity while human and stopped waits remain quiet', async () => {
  const { making } = await import('../../src/next/model/film.ts');
  const shot = lastFerryOverview().shots[shotId('2.1')];
  shot.video = { state: 'queued', takeCount: 0, failure: { autoRetriesLeft: 1 } };
  assert.equal(making(shot.video), true);
  const { lackOf } = await import('../../src/next/model/film.ts');
  assert.equal(en(lackOf(shot)), 'making clip');
  for (const code of ['review', 'stopped', 'unknown', 'timing']) assert.equal(making({ ...shot.video, waiting: { code, since: '' } }), false, code);
});

test('a new length warns when a paid clip for the shot is still out', () => {
  const overview = lastFerryOverview();
  const shot = overview.shots[shotId('2.1')];
  const at = '2026-10-20T10:00:00.000Z';
  assert.equal(clipStillOut({ ...shot, video: { state: 'none', takeCount: 0 } }), false);
  assert.equal(clipStillOut({ ...shot, video: { state: 'running', phase: 'running', startedAt: at, takeCount: 0 } }), true);
  assert.equal(clipStillOut({ ...shot, video: { state: 'no_answer', attemptId: 'a1', takeCount: 0 } }), true);
  assert.equal(clipStillOut({ ...shot, video: { state: 'queued', waiting: { code: 'review', since: at }, takeCount: 0 } }), false, 'a clip waiting for a confirm is not out yet');
  const ready = { state: 'ready', artifact: { artifactId: 'v', sha256: 'a'.repeat(64), kind: 'video' }, takeCount: 1 };
  assert.equal(clipStillOut({ ...shot, video: ready }), false);
  assert.equal(clipStillOut({ ...shot, video: { ...ready, replacement: { state: 'running', attemptId: 'a2' } } }), true);
  assert.equal(clipStillOut({ ...shot, video: { ...ready, replacement: { state: 'failed' } } }), false);
  assert.equal(en(lengthToast('2.1', 7, 50, false, true)), '2.1 is 7 s. The film is 50 s; the clip being made for 2.1 will be out of date.');
  assert.equal(zh(lengthToast('2.1', 7, 50, false, true)), '2.1 改为 7 秒，影片 50 秒；2.1 正在生成的视频回来后会过期。');
});
