import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, shotId, sceneId, artifactFor } from '../../src/next/fixtures/last-ferry.ts';
import {
  ALL_ASSETS, assetDetail, assetKey, assetLibrary, compareAssets, downloadName, durationMsg, madeMsg, placement,
  importNumber, readAllAssets, roleCounts, SlotQueue, stillFor, titleMsg, useMsg, validFilters, waveHeights,
} from '../../src/next/model/assets.ts';
import { translate } from '../../src/next/i18n/translate.ts';

const overview = lastFerryOverview();
const en = (m) => translate('en', m.id, m.values);
const zh = (m) => translate('zh-CN', m.id, m.values);
const at = (h, m) => `2026-10-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
const now = new Date(2026, 9, 15, 12, 0);

const kf = (label, take = 1, extra = {}) => ({ artifact: { ...artifactFor(label), sha256: `${'a'.repeat(63)}${take}` }, role: 'keyframe', shotId: shotId(label), sceneId: sceneId(Number(label[0])), takeIndex: take, current: true, source: 'generated', label: 'x', createdAt: at(10, 8), ...extra });
const clip = (label, take = 1, extra = {}) => ({ artifact: { artifactId: `art-${label}-clip`, sha256: 'c'.repeat(64), kind: 'video' }, role: 'clip', shotId: shotId(label), sceneId: sceneId(Number(label[0])), takeIndex: take, current: true, source: 'generated', label: 'x', createdAt: at(10, 31), durationSeconds: 6, ...extra });
const voice = (label, extra = {}) => ({ artifact: { artifactId: `voice-${label}-${extra.createdAt ?? ''}`, sha256: 'd'.repeat(64), kind: 'audio' }, role: 'voice', shotId: shotId(label), sceneId: sceneId(Number(label[0])), current: true, source: 'generated', label: 'Voice line', createdAt: at(10, 24), durationSeconds: 2.1, ...extra });
const music = (name, extra = {}) => ({ artifact: { artifactId: `music-${name}`, sha256: 'e'.repeat(64), kind: 'audio' }, role: 'music', current: false, source: 'imported', label: name, createdAt: at(10, 2), durationSeconds: 72, ...extra });
const upload = (kind, extra = {}) => ({ artifact: { artifactId: `up-${kind}-${extra.createdAt ?? ''}`, sha256: 'f'.repeat(64), kind }, role: 'upload', current: false, source: 'imported', label: 'The Last Ferry · upload', createdAt: at(9, 58), ...extra });

const library = () => [
  music('low-tide.mp3', { current: true }), music('foghorn-theme.wav', { createdAt: at(10, 3), durationSeconds: 58 }),
  upload('image'), upload('image', { createdAt: at(9, 59) }),
  kf('1.1'), clip('1.1'), kf('1.2'), clip('1.2', 1, { createdAt: at(10, 32), durationSeconds: 5 }),
  voice('1.2', { current: false, createdAt: at(10, 20), durationSeconds: 2.6 }), voice('1.2'),
  kf('1.3', 1, { createdAt: at(10, 9) }), clip('1.3', 1, { createdAt: at(10, 33) }),
  kf('2.1', 1, { createdAt: at(10, 44) }), kf('2.2', 1, { createdAt: at(10, 44) }), kf('2.3', 1, { createdAt: at(10, 44) }), voice('2.3', { createdAt: at(10, 44), durationSeconds: 7.4 }),
];

test('the library groups the whole film first, then each scene and shot in film order', () => {
  const view = assetLibrary(library(), overview, ALL_ASSETS);
  assert.equal(view.total, 16);
  assert.equal(view.shown, 16);
  assert.deepEqual(view.counts, { all: 16, keyframe: 6, clip: 3, voice: 3, music: 2, upload: 2, document: 0, export: 0 });
  assert.ok(view.film);
  // Imported pictures keep no file name in the library, so the two are numbered, oldest first.
  assert.deepEqual(view.film.tiles.map((t) => en(t.title)), ['low-tide.mp3', 'foghorn-theme.wav', 'Imported image 1', 'Imported image 2']);
  assert.equal(view.film.noExports, true, 'no exports yet points to Film');
  assert.deepEqual(view.scenes.map((s) => [s.ordinal, s.title, s.sets.map((set) => set.label)]), [
    [1, 'Closing time', ['1.1', '1.2', '1.3']], [2, 'Harbour at dawn', ['2.1', '2.2', '2.3']], [3, 'Departure', ['3.1', '3.2']],
  ]);
  const s12 = view.scenes[0].sets[1];
  assert.deepEqual(s12.tiles.map((t) => en(t.title)), ['Keyframe 1.2 · take 1', 'Clip 1.2 · take 1', 'Voice line 1.2', 'Voice line 1.2']);
  assert.deepEqual(s12.tiles.map((t) => en(t.use.label)), ['Current', 'Current', 'Earlier', 'Current']);
  assert.deepEqual(view.scenes[2].sets.map((set) => set.tiles.length), [0, 0], 'Scene 3 shots say nothing made yet');
  assert.equal(view.nothingMatches, false);
});

test('role and scene filters narrow the groups; nothing matching says so', () => {
  const items = library();
  const clips = assetLibrary(items, overview, { role: 'clip', scene: 'all' });
  assert.equal(clips.shown, 3);
  assert.equal(clips.film, null, 'the whole-film group hides when it has nothing to show');
  assert.deepEqual(clips.scenes.map((s) => s.sets.map((set) => set.label)), [['1.1', '1.2', '1.3']]);

  const exports = assetLibrary(items, overview, { role: 'export', scene: 'all' });
  assert.deepEqual(exports.film, { tiles: [], noExports: true });
  assert.equal(exports.nothingMatches, false);

  const filmOnly = assetLibrary(items, overview, { role: 'all', scene: 'film' });
  assert.equal(filmOnly.scenes.length, 0);
  assert.equal(filmOnly.shown, 4);

  const scene2 = assetLibrary(items, overview, { role: 'all', scene: sceneId(2) });
  assert.equal(scene2.film, null);
  assert.deepEqual(scene2.scenes.map((s) => s.sceneId), [sceneId(2)]);
  assert.equal(scene2.shown, 4);

  const none = assetLibrary(items, overview, { role: 'keyframe', scene: 'film' });
  assert.equal(none.nothingMatches, true);
  assert.equal(none.shown, 0);
});

test('assets of deleted shots stay listed as no longer in the film, and the scene filter falls back', () => {
  const gone = kf('2.2', 1, { shotId: 'shot-gone', sceneId: sceneId(2) });
  assert.deepEqual(placement(gone, overview), { kind: 'former' });
  const view = assetLibrary([gone], overview, ALL_ASSETS);
  assert.equal(view.former.length, 1);
  assert.equal(en(view.former[0].title), 'Keyframe · take 1');
  assert.deepEqual(validFilters({ role: 'all', scene: 'scene-9' }, overview), { role: 'all', scene: 'all' });
  assert.deepEqual(validFilters({ role: 'clip', scene: sceneId(1) }, overview), { role: 'clip', scene: sceneId(1) });
  const detail = assetDetail(gone, [gone], overview, now, 'en');
  assert.deepEqual(detail.point, { target: { kind: 'scene', id: sceneId(2) }, name: { id: 'assets.target.scene', values: { n: 2 } } }, 'points at the scene it was in');
  assert.equal(detail.open, null);
});

test('titles, use and lengths read in both languages', () => {
  assert.equal(zh(titleMsg(kf('2.2', 2), overview)), '关键帧 2.2 · 版本 2');
  assert.equal(en(titleMsg(clip('1.1'), overview)), 'Clip 1.1 · take 1');
  assert.equal(en(titleMsg(upload('video'), overview)), 'Imported video');
  assert.equal(en(titleMsg(music('Uploaded recording'), overview)), 'Imported audio', 'a server fallback name is said in the interface language');
  assert.equal(en(titleMsg({ ...upload('video'), role: 'export', source: 'demo' }, overview)), 'Demo export');
  assert.equal(en(useMsg(music('a', { current: true })).label), 'In use');
  assert.equal(useMsg(music('a', { current: true })).on, true);
  assert.equal(en(useMsg(upload('image')).label), 'Not in use');
  assert.equal(en(durationMsg(2.14)), '2.1 s');
  assert.equal(zh(durationMsg(6)), '6 秒');
  assert.equal(en(durationMsg(72)), '1:12');
  assert.equal(durationMsg(undefined), null);
});

test('an imported picture is named by its file name when the library has one, else numbered among the nameless ones of its kind', () => {
  const first = upload('image', { createdAt: at(9, 58) });
  const second = upload('image', { createdAt: at(10, 5) });
  const third = upload('image', { createdAt: at(11, 0) });
  const film = upload('video', { createdAt: at(9, 0) });
  // The library lists newest first; numbers follow the order they were made in.
  const items = [third, second, film, first];
  assert.deepEqual([first, second, third].map((item) => en(titleMsg(item, overview, items))), ['Imported image 1', 'Imported image 2', 'Imported image 3']);
  assert.equal(zh(titleMsg(second, overview, items)), '导入的图片 2');
  assert.equal(importNumber(film, items), 0, 'videos are numbered among videos');
  assert.equal(en(titleMsg(film, overview, items)), 'Imported video', 'the only one of its kind is not numbered');
  assert.equal(en(titleMsg(first, overview, [first])), 'Imported image');
  // Two made in the same second: the one listed later (older) comes first.
  const twin = upload('image', { createdAt: at(11, 0), artifact: { artifactId: 'up-twin', sha256: 'f'.repeat(64), kind: 'image' } });
  assert.deepEqual([twin, third].map((item) => importNumber(item, [twin, third])), [2, 1]);
  // A file name the library keeps is the title, and that picture leaves the numbering.
  const named = upload('image', { label: 'pier.png', createdAt: at(12, 0), artifact: { artifactId: 'up-pier', sha256: 'f'.repeat(64), kind: 'image' } });
  assert.equal(en(titleMsg(named, overview, [named, ...items])), 'pier.png');
  assert.equal(en(titleMsg(third, overview, [named, ...items])), 'Imported image 3');
  // The detail panel and the download name use the same title.
  assert.equal(en(assetDetail(second, items, overview, now, 'en').title), 'Imported image 2');
  assert.equal(downloadName(en(titleMsg(second, overview, items)), 'image'), 'Imported image 2.png');
});

test('a clip tile shows the keyframe it was made from', () => {
  const first = kf('2.2', 1, { createdAt: at(10, 0), current: false });
  const second = kf('2.2', 2, { createdAt: at(11, 0) });
  const early = clip('2.2', 1, { createdAt: at(10, 30) });
  const late = clip('2.2', 2, { createdAt: at(11, 30) });
  assert.equal(stillFor(early, [first, second, early, late], overview), first.artifact);
  assert.equal(stillFor(late, [first, second, early, late], overview), second.artifact);
  assert.deepEqual(stillFor(clip('1.1'), [], overview), overview.shots[shotId('1.1')].keyframe.artifact, 'falls back to the current keyframe');
});

test('ordering: role, then in use first for whole-film assets, then oldest first', () => {
  const items = [music('b', { createdAt: at(9, 0) }), music('a', { current: true, createdAt: at(11, 0) }), upload('image', { createdAt: at(8, 0) })];
  assert.deepEqual(items.sort(compareAssets).map((i) => i.label), ['a', 'b', 'The Last Ferry · upload']);
  assert.equal(roleCounts([]).all, 0);
});

test('the detail lists only AssetItem facts and points the Director at the shot', () => {
  const item = voice('1.2', { current: false, createdAt: at(10, 20), durationSeconds: 2.6 });
  const detail = assetDetail(item, [item], overview, now, 'en');
  assert.deepEqual(detail.rows.map((r) => [en(r.label), en(r.value), r.sub ? en(r.sub) : null]), [
    ['Kind', 'Voice line', null], ['Shot', '1.2 Medium', 'Closing time'], ['In use', 'No, an earlier take', null],
    ['Source', 'Generated', null], ['Made', 'Today 10:20', null], ['Length', '2.6 s', null],
  ]);
  assert.deepEqual(detail.point.target, { kind: 'shot', id: shotId('1.2') });
  assert.equal(en(detail.open.label), 'Open 1.2 in Film');
  assert.equal(detail.open.view, 'film');
  assert.equal(detail.playable, true);

  const key = assetDetail(kf('2.1', 1), [], overview, now, 'en');
  assert.equal(en(key.open.label), 'Open 2.1 in Keyframes');
  assert.equal(key.rows.find((r) => r.label.id === 'assets.row.take').value.values.text, '1');
  assert.equal(key.playable, false);

  const song = assetDetail(music('low-tide.mp3', { current: true }), [], overview, now, 'en');
  assert.equal(song.point, null, 'whole-film assets cannot be pointed at: messages name scenes and shots only');
  assert.equal(en(song.open.label), 'Open the music lane in Film');
  assert.equal(en(song.rows[1].value), 'Not on a shot');
  assert.equal(en(song.rows.find((r) => r.label.id === 'assets.row.in_use').value), 'Yes, the film’s music');
});

test('made times read as today, or as a date', () => {
  assert.equal(en(madeMsg(at(9, 5), now, 'en')), 'Today 09:05');
  assert.equal(en(madeMsg('2026-10-14T18:30:00', now, 'en')), '14 Oct 18:30');
  assert.equal(zh(madeMsg('2026-10-14T18:30:00', now, 'zh-CN')), '10月14日 18:30');
  assert.match(en(madeMsg('2025-01-02T08:00:00', now, 'en')), /2025 08:00$/);
  assert.equal(en(madeMsg('not a date', now, 'en')), 'not a date');
});

test('every page is read, each file once, up to the limit', async () => {
  const items = Array.from({ length: 95 }, (_, i) => upload('image', { createdAt: at(8, i % 60), artifact: { artifactId: `a${i}`, sha256: 'f'.repeat(64), kind: 'image' } }));
  const offsets = [];
  const read = async (offset) => { offsets.push(offset); const assets = items.slice(offset, offset + 40); return { assets, total: items.length, offset, nextOffset: offset + assets.length < items.length ? offset + assets.length : null }; };
  const all = await readAllAssets(read);
  assert.deepEqual(offsets, [0, 40, 80]);
  assert.equal(all.items.length, 95);
  assert.equal(all.truncated, false);
  const capped = await readAllAssets(read, 50);
  assert.equal(capped.items.length, 50);
  assert.equal(capped.truncated, true);
  // A page that shifted (something new arrived) does not list a file twice.
  const shifted = await readAllAssets(async (offset) => ({ assets: offset === 0 ? items.slice(0, 2) : items.slice(1, 3), total: 3, offset, nextOffset: offset === 0 ? 2 : null }));
  assert.deepEqual(shifted.items.map(assetKey), items.slice(0, 3).map(assetKey));
  // A server that never advances cannot loop forever.
  const stuck = await readAllAssets(async () => ({ assets: [], total: 5, offset: 0, nextOffset: 0 }));
  assert.equal(stuck.items.length, 0);
});

test('waveforms are stable per asset and download names are safe', () => {
  assert.deepEqual(waveHeights('abc', 5), waveHeights('abc', 5));
  assert.notDeepEqual(waveHeights('abc', 5), waveHeights('abd', 5));
  assert.ok(waveHeights('x', 40).every((h) => h >= 18 && h < 88));
  assert.equal(downloadName('Keyframe 2.2 · take 1', 'image'), 'Keyframe 2.2 - take 1.png');
  assert.equal(downloadName('low-tide.mp3', 'audio'), 'low-tide.wav');
  assert.equal(downloadName('a/b:c', 'video'), 'a b c.mp4');
  assert.equal(downloadName('   ', 'video'), 'openslate-asset.mp4');
});

test('download names keep shot numbers from 10 up and only drop real file extensions', () => {
  assert.equal(downloadName('Voice line 2.10', 'audio'), 'Voice line 2.10.wav');
  assert.equal(downloadName('Keyframe 3.11', 'image'), 'Keyframe 3.11.png');
  assert.equal(downloadName('Clip 12.104 · take 2', 'video'), 'Clip 12.104 - take 2.mp4');
  assert.equal(downloadName('harbour.final.MOV', 'video'), 'harbour.final.mp4');
  assert.equal(downloadName('pier.jpeg', 'image'), 'pier.png');
  assert.equal(downloadName('notes.v2', 'audio'), 'notes.v2.wav');
});

test('the load queue hands out a few slots at a time, first come first served', () => {
  const queue = new SlotQueue(2);
  const granted = [];
  const a = queue.take(() => granted.push('a'));
  const b = queue.take(() => granted.push('b'));
  const c = queue.take(() => granted.push('c'));
  const d = queue.take(() => granted.push('d'));
  assert.deepEqual(granted, ['a', 'b']);
  assert.equal(queue.waiting, 2);
  d(); // d leaves the queue before its turn
  assert.equal(queue.waiting, 1);
  a();
  assert.deepEqual(granted, ['a', 'b', 'c']);
  a(); // releasing twice does nothing
  b(); c();
  const e = queue.take(() => granted.push('e'));
  const f = queue.take(() => granted.push('f'));
  assert.deepEqual(granted, ['a', 'b', 'c', 'e', 'f'], 'both slots are free again');
  e(); f();
});

test("a clip longer than its shot says how much of it the film uses (from the first real run: 6.6 s for a 6 s shot)", () => {
  const overview = lastFerryOverview();
  const shot = overview.shots[shotId('1.1')];
  const seconds = Math.round((shot.durationFrames / overview.fps) * 10) / 10;
  const long = clip('1.1', 1, { durationSeconds: seconds + 0.6 });
  const length = assetDetail(long, [long], overview, now, 'en').rows.find((row) => en(row.label) === 'Length');
  assert.equal(en(length.sub), `The film uses ${seconds} s of it, the shot's length.`);
  const exact = clip('1.1', 1, { durationSeconds: seconds });
  assert.equal(assetDetail(exact, [exact], overview, now, 'en').rows.find((row) => en(row.label) === 'Length').sub, undefined);
});
