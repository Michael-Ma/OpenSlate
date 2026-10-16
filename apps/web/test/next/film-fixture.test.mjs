import test from 'node:test';
import assert from 'node:assert/strict';
import { filmRoutes, applyFilmPreset, FILM_FIXTURE_TIMING, FIXTURE_MUSIC } from '../../src/next/fixtures/routes/film.ts';
import { extraRoutes, fixtureRoute } from '../../src/next/fixtures/routes/index.ts';
import { DECLINE } from '../../src/next/fixtures/routes/types.ts';
import { fixtureCommand } from '../../src/next/fixtures/fixture-commands.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { filmTimeline, moveEdit } from '../../src/next/model/film.ts';

/** A fixture world with a manual clock, as in keyframes-fixture.test.mjs. */
function world() {
  const timers = [];
  let now = 0;
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector },
    update(change) { change(w); const cursor = w.overview.cursor + 1; w.overview = { ...w.overview, cursor }; w.snapshot = { ...w.snapshot, cursor }; },
    later(ms, change) { timers.push({ at: now + ms, change }); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > until) break;
        timers.shift();
        now = next.at;
        w.update(next.change);
      }
      now = until;
    },
  };
  return w;
}

/**
 * As the fixture port answers: the views' routes in order (Plan's /storyboard route owns the endpoint and hands the
 * music edits to the Film route; shot order is Plan's), then the Keyframes commands.
 */
function call(w, method, path, body) {
  const answer = fixtureRoute(w, method, path, body);
  return answer === DECLINE ? fixtureCommand(w, method, path, body) : answer;
}
const head = w => w.snapshot.project.headVersion;
const edit = (w, body) => call(w, 'POST', '/storyboard', { ...body, expectedHeadVersion: head(w) });
const refused = code => error => error.code === code;
const labels = w => filmTimeline(w.overview).shots.map(s => s.label + ':' + s.shotId.slice(5));

test('the Film routes are registered for the sample film', () => {
  for (const route of filmRoutes) assert.ok(extraRoutes.includes(route));
});

test('the sample film has low-tide.mp3 from 0:04 at -18 dB, and the library lists only music', () => {
  const w = world();
  const library = call(w, 'GET', '/audio-library?role=music');
  assert.deepEqual(library.recordings.map(r => r.label), ['low-tide.mp3', 'foghorn-theme.wav']);
  assert.deepEqual(w.snapshot.project.soundtrack, { audioId: 'audio-low-tide', gainMilliDb: -18000, startFrame: 120, muted: false });
  assert.equal(FIXTURE_MUSIC.every(r => r.role === 'music'), true);
});

test('the golden state is not ready to export, with per-shot reasons', () => {
  const w = world();
  const view = call(w, 'GET', '/exports');
  assert.equal(view.readiness.ready, false);
  assert.equal(view.current, null);
  assert.deepEqual(view.history, []);
  assert.throws(() => call(w, 'POST', '/exports', { expectedHeadVersion: head(w) }), refused('EXPORT_BLOCKED'));
});

test('moving a shot within its scene renumbers it, keeps its media and can be undone', () => {
  const w = world();
  const before = head(w);
  const { edit: move } = moveEdit(w.overview, shotId('2.2'), -1);
  const receipt = edit(w, move);
  assert.ok(receipt.commandId);
  assert.equal(head(w), before + 1);
  assert.deepEqual(labels(w).slice(3, 6), ['2.1:2-2', '2.2:2-1', '2.3:2-3']);
  assert.deepEqual(w.snapshot.project.shots.map(s => s.id).slice(3, 6), [shotId('2.2'), shotId('2.1'), shotId('2.3')], 'the snapshot follows the storyboard order');
  assert.equal(w.overview.shots[shotId('2.2')].keyframe.artifact.artifactId, 'art-2.2', 'the picture stays with its shot');
  assert.throws(() => call(w, 'POST', '/storyboard', { ...move, expectedHeadVersion: before }), refused('REVISION_CONFLICT'));
  edit(w, { kind: 'undo', commandId: receipt.commandId });
  assert.deepEqual(labels(w).slice(3, 6), ['2.1:2-1', '2.2:2-2', '2.3:2-3']);
  assert.throws(() => edit(w, { kind: 'undo', commandId: receipt.commandId }), refused('UNDO_UNAVAILABLE'), 'one step only');
  // To the end of the scene: no beforeId.
  edit(w, moveEdit(w.overview, shotId('2.1'), 1).edit);
  edit(w, moveEdit(w.overview, shotId('2.1'), 1).edit);
  assert.deepEqual(labels(w).slice(3, 6), ['2.1:2-2', '2.2:2-3', '2.3:2-1']);
});

test('music edits: start, volume, mute, change and remove, each undoable', () => {
  const w = world();
  call(w, 'GET', '/exports');
  const r1 = edit(w, { kind: 'soundtrack', field: 'gainMilliDb', value: '-12000' });
  assert.equal(w.snapshot.project.soundtrack.gainMilliDb, -12000);
  edit(w, { kind: 'undo', commandId: r1.commandId });
  assert.equal(w.snapshot.project.soundtrack.gainMilliDb, -18000);
  edit(w, { kind: 'soundtrack', field: 'muted', value: 'true' });
  edit(w, { kind: 'soundtrack', field: 'startFrame', value: '150' });
  edit(w, { kind: 'soundtrack', field: 'audioId', value: 'audio-foghorn' });
  assert.deepEqual(w.snapshot.project.soundtrack, { audioId: 'audio-foghorn', gainMilliDb: -18000, startFrame: 150, muted: true }, 'a new recording keeps the start, level and mute');
  assert.throws(() => edit(w, { kind: 'soundtrack', field: 'gainMilliDb', value: '6000' }), refused('VALIDATION_ERROR'));
  assert.throws(() => edit(w, { kind: 'soundtrack', field: 'audioId', value: 'voice-take' }), refused('NOT_FOUND'));
  const removed = edit(w, { kind: 'soundtrack', field: 'audioId', value: '' });
  assert.equal(w.snapshot.project.soundtrack, null);
  assert.throws(() => edit(w, { kind: 'soundtrack', field: 'muted', value: 'false' }), refused('VALIDATION_ERROR'), 'choose music first');
  edit(w, { kind: 'undo', commandId: removed.commandId });
  assert.equal(w.snapshot.project.soundtrack.audioId, 'audio-foghorn');
});

test('other storyboard edits go to the Keyframes fixture, and end this view\'s pending Undo', () => {
  const [musicRoute] = filmRoutes.filter((route) => route.match.test('/storyboard'));
  assert.equal(musicRoute.handle(world(), [], { kind: 'moveShot', id: shotId('2.2') }), DECLINE, 'the Film route answers only the music');
  const w = world();
  const music = edit(w, { kind: 'soundtrack', field: 'muted', value: 'true' });
  const length = edit(w, { kind: 'shot', id: shotId('2.1'), field: 'desiredFrames', value: '210' });
  assert.equal(w.overview.shots[shotId('2.1')].durationFrames, 210);
  assert.throws(() => edit(w, { kind: 'undo', commandId: music.commandId }), refused('UNDO_UNAVAILABLE'));
  edit(w, { kind: 'undo', commandId: length.commandId });
  assert.equal(w.overview.shots[shotId('2.1')].durationFrames, 150);
});

test('export: start, render with no percentage, finish, then say what changed since', () => {
  const w = world();
  applyFilmPreset(w, 'ready');
  let view = call(w, 'GET', '/exports');
  assert.equal(view.readiness.ready, true);
  assert.equal(view.readiness.seconds, 50);
  assert.deepEqual(view.current.outdatedBy, ['order', 'music'], 'the preset\'s last export changed since');
  assert.equal(view.history.length, 2);
  const started = call(w, 'POST', '/exports', { expectedHeadVersion: head(w) });
  assert.equal(started.state, 'rendering');
  view = call(w, 'GET', '/exports');
  assert.equal(view.current.exportId, started.exportId);
  assert.deepEqual(call(w, 'GET', '/media').jobs[0], { id: started.exportId, state: 'running', canRecover: false, canRun: false, createdAt: started.startedAt });
  w.advance(FILM_FIXTURE_TIMING.exportMs);
  view = call(w, 'GET', '/exports');
  assert.equal(view.current.state, 'done');
  assert.ok(view.current.artifact);
  assert.deepEqual(view.current.outdatedBy, []);
  edit(w, moveEdit(w.overview, shotId('3.2'), -1).edit);
  edit(w, { kind: 'soundtrack', field: 'gainMilliDb', value: '-20000' });
  assert.deepEqual(call(w, 'GET', '/exports').current.outdatedBy, ['order', 'music']);
  assert.throws(() => call(w, 'POST', '/exports', { expectedHeadVersion: head(w) - 1 }), refused('REVISION_CONFLICT'));
});

test('export: Cancel stops it and nothing is saved', () => {
  const w = world();
  applyFilmPreset(w, 'ready');
  const started = call(w, 'POST', '/exports', { expectedHeadVersion: head(w) });
  assert.equal(call(w, 'POST', `/exports/${started.exportId}/cancel`, {}).state, 'cancelled');
  w.advance(FILM_FIXTURE_TIMING.exportMs);
  const current = call(w, 'GET', '/exports').current;
  assert.equal(current.state, 'cancelled');
  assert.equal(current.artifact, undefined);
});

test('Check again finds an interrupted export and never renders again; a running one is busy', async () => {
  const w = world();
  applyFilmPreset(w, 'interrupted');
  const current = call(w, 'GET', '/exports').current;
  assert.equal(current.state, 'rendering');
  assert.equal(call(w, 'GET', '/media').jobs.find(j => j.id === current.exportId).canRecover, true);
  const found = await call(w, 'POST', `/exports/${current.exportId}/recover`, {});
  assert.equal(found.state, 'done');
  assert.ok(found.artifact);
  assert.equal(call(w, 'GET', '/media').jobs[0].canRecover, false);
  const fresh = world();
  applyFilmPreset(fresh, 'ready');
  const running = call(fresh, 'POST', '/exports', { expectedHeadVersion: head(fresh) });
  assert.throws(() => call(fresh, 'POST', `/exports/${running.exportId}/recover`, {}), refused('MEDIA_RENDER_BUSY'));
});

test('presets: a demo film is stamped Demo; a failed export says so', () => {
  const demo = world();
  applyFilmPreset(demo, 'demo');
  const view = call(demo, 'GET', '/exports');
  assert.deepEqual([view.readiness.ready, view.readiness.demo, view.current], [true, true, null]);
  assert.equal(call(demo, 'POST', '/exports', { expectedHeadVersion: head(demo) }).demo, true);
  const failed = world();
  applyFilmPreset(failed, 'failed');
  assert.deepEqual(call(failed, 'GET', '/exports').current.failure, { code: 'RENDER_FAILED' });
  assert.equal(failed.overview.scenes.every(s => s.state === 'video_saved'), true);
  assert.equal(sceneId(3), failed.overview.scenes[2].sceneId);
});

test('presets: a stopped film still exports (local and free, card B12); a stalled export cannot be recovered', () => {
  const stopped = world();
  applyFilmPreset(stopped, 'stopped');
  assert.ok(stopped.overview.stopped);
  assert.equal(call(stopped, 'GET', '/exports').readiness.ready, true);
  assert.equal(call(stopped, 'POST', '/exports', { expectedHeadVersion: head(stopped) }).state, 'rendering');
  const stalled = world();
  applyFilmPreset(stalled, 'stalled');
  const view = call(stalled, 'GET', '/exports');
  assert.equal(view.current.state, 'rendering');
  const job = call(stalled, 'GET', '/media').jobs.find(j => j.id === view.current.exportId);
  assert.deepEqual([job.state, job.canRun, job.canRecover], ['prepared', true, false]);
  assert.throws(() => call(stalled, 'POST', `/exports/${view.current.exportId}/recover`, {}), refused('MEDIA_RENDER_NOT_STARTED'));
  const again = call(stalled, 'POST', '/exports', { expectedHeadVersion: head(stalled) });
  assert.equal(call(stalled, 'GET', '/exports').current.exportId, again.exportId, 'Export again makes a new current export');
});

test('the music library pages by 40, and music that is gone stops the readiness read', () => {
  const w = world();
  applyFilmPreset(w, 'library');
  const first = call(w, 'GET', '/audio-library?role=music');
  assert.deepEqual([first.recordings.length, first.coverage.total, first.coverage.nextOffset], [40, 45, 40]);
  const second = call(w, 'GET', '/audio-library?role=music&offset=40');
  assert.deepEqual([second.recordings.length, second.coverage.nextOffset], [5, null]);
  assert.equal(second.recordings.at(-1).id, w.snapshot.project.soundtrack.audioId, 'the film\'s music is on the second page');
  assert.throws(() => call(w, 'GET', '/audio-library?role=music&offset=46'), refused('VALIDATION_ERROR'));
  const gone = world();
  applyFilmPreset(gone, 'music-missing');
  assert.throws(() => call(gone, 'GET', '/exports'), refused('MEDIA_ARTIFACT_UNAVAILABLE'));
  edit(gone, { kind: 'soundtrack', field: 'audioId', value: 'audio-low-tide' });
  assert.equal(call(gone, 'GET', '/exports').readiness.ready, false, 'with music chosen again, readiness reads');
});
