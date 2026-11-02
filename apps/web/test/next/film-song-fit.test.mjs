import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureRoute } from '../../src/next/fixtures/routes/index.ts';
import { DECLINE } from '../../src/next/fixtures/routes/types.ts';
import { fixtureCommand } from '../../src/next/fixtures/fixture-commands.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector } from '../../src/next/fixtures/last-ferry.ts';
import { editPressId, filmMusic, filmTimeline, songFitEdit, songLength, soundtrackOf } from '../../src/next/model/film.ts';
import { importDoneMsg, importedAsFilmMusic } from '../../src/next/model/assets-import.ts';
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
const music = (seconds, start = 0, extra = {}) => ({ audioId: 'a', label: 'Song', sha256: null, seconds, start, gainDb: 0, muted: false, missing: false, ...extra });

test('the song length line shows when the song and the film differ by half a second or more', () => {
  assert.deepEqual(songLength(music(60), 48), { song: 60, film: 48, differs: true });
  assert.deepEqual(songLength(music(44, 4), 48), { song: 48, film: 48, differs: false });
  assert.equal(songLength(music(60, 0, { muted: true }), 48), null);
  assert.equal(songLength(music(null), 48), null);
  assert.equal(songLength(null, 48), null);
  assert.equal(editPressId({ kind: 'shotTiming', timings: [] }), 'edit:shotTiming');
});

test('Fit to song sends only the lengths that change, and nothing for a stale fit', () => {
  const overview = lastFerryOverview();
  const [first, second] = overview.scenes[0].shotIds;
  const view = (headVersion, timings) => ({ headVersion, fit: { timings } });
  const same = overview.shots[first].durationFrames;
  assert.deepEqual(songFitEdit(view(overview.headVersion, [{ id: first, desiredFrames: same }, { id: second, desiredFrames: 300 }]), overview),
    { kind: 'shotTiming', timings: [{ id: second, desiredFrames: 300 }] });
  assert.equal(songFitEdit(view(overview.headVersion + 1, [{ id: second, desiredFrames: 300 }]), overview), null);
  assert.equal(songFitEdit(view(overview.headVersion, [{ id: first, desiredFrames: same }]), overview), null);
  assert.equal(songFitEdit(null, overview), null);
});

test('in the sample film, fitting the shots to the song makes the film as long as the song in one undoable command', () => {
  const w = world();
  const library = call(w, 'GET', '/audio-library?role=music');
  const soundtrack = soundtrackOf(w.snapshot);
  const song = library.recordings.find(r => r.id === soundtrack.audioId);
  const timing = call(w, 'GET', `/audio-library/${encodeURIComponent(song.id)}/timing`);
  const fps = w.overview.fps, target = Math.round(song.durationSeconds * fps) + (soundtrack.startFrame ?? 0);
  assert.equal(timing.fit.targetFrames, target);
  assert.ok(timing.fit.timings.every(row => row.desiredFrames >= 90 && row.desiredFrames <= 450));
  const edit = songFitEdit(timing, w.overview);
  const before = filmTimeline(w.overview).total;
  const receipt = call(w, 'POST', '/storyboard', { ...edit, expectedHeadVersion: w.snapshot.project.headVersion });
  const after = filmTimeline(w.overview).total;
  assert.equal(after * fps, timing.fit.totalFrames);
  assert.ok(Math.abs(songLength(filmMusic(soundtrackOf(w.snapshot), library.recordings, fps), after).song - after) < 0.5 || timing.fit.shortfallFrames + timing.fit.overflowFrames > 0);
  call(w, 'POST', '/storyboard', { kind: 'undo', commandId: receipt.commandId, expectedHeadVersion: w.snapshot.project.headVersion });
  assert.equal(filmTimeline(w.overview).total, before);
  assert.throws(() => call(w, 'POST', '/storyboard', { kind: 'shotTiming', timings: [{ id: 'nope', desiredFrames: 120 }], expectedHeadVersion: w.snapshot.project.headVersion }), e => e.code === 'NOT_FOUND');
});

test('an import that became the film’s music says so', () => {
  assert.equal(importedAsFilmMusic('audio', { recording: { id: 'x', selectedAsMusic: true } }), true);
  assert.equal(importedAsFilmMusic('audio', { recording: { id: 'x' } }), false);
  assert.equal(importedAsFilmMusic('image', { recording: { selectedAsMusic: true } }), false);
  assert.equal(translateMsg('en', importDoneMsg('audio', 'music', 'Song.mp3', true)), "Imported Song.mp3. It is now the film's music.");
  assert.equal(translateMsg('zh-CN', importDoneMsg('audio', 'music', 'Song.mp3', true)), '已导入 Song.mp3，已设为影片音乐。');
  assert.equal(translateMsg('en', importDoneMsg('audio', 'music', 'Song.mp3')), 'Imported Song.mp3 as music.');
});

test('in the sample film, imported music becomes the film’s music only when none was ever chosen', () => {
  const w = world();
  call(w, 'GET', '/audio-library?role=music');
  const kept = call(w, 'POST', '/audio-library/uploads?role=music&name=b.wav', { name: 'b.wav', size: 100, durationSeconds: 30, key: 'b1' });
  assert.equal(kept.recording.selectedAsMusic, false); assert.notEqual(soundtrackOf(w.snapshot).audioId, kept.recording.id);
  call(w, 'POST', '/storyboard', { kind: 'soundtrack', field: 'audioId', value: '', expectedHeadVersion: w.snapshot.project.headVersion });
  const removed = call(w, 'POST', '/audio-library/uploads?role=music&name=c.wav', { name: 'c.wav', size: 100, durationSeconds: 30, key: 'c1' });
  assert.equal(removed.recording.selectedAsMusic, false); assert.equal(soundtrackOf(w.snapshot), null);
  const fresh = world();
  fresh.snapshot = { ...fresh.snapshot, project: { ...fresh.snapshot.project } };
  call(fresh, 'GET', '/audio-library?role=music');
  delete fresh.snapshot.project.soundtrack;
  const head = fresh.snapshot.project.headVersion;
  const adopted = call(fresh, 'POST', '/audio-library/uploads?role=music&name=d.wav', { name: 'd.wav', size: 100, durationSeconds: 30, key: 'd1' });
  assert.equal(adopted.recording.selectedAsMusic, true);
  assert.equal(soundtrackOf(fresh.snapshot).audioId, adopted.recording.id); assert.equal(fresh.snapshot.project.headVersion, head + 1);
});
