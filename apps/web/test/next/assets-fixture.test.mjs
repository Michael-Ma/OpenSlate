import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { FIXTURE_PICTURE_ROUTE, fixtureAssetPicture, isFixtureImport, stageFixturePreview } from '../../src/next/fixtures/routes/assets.ts';
import { PROJECT_ID, shotId, sceneId } from '../../src/next/fixtures/last-ferry.ts';
import { ALL_ASSETS, assetLibrary, readAllAssets } from '../../src/next/model/assets.ts';
import { translate } from '../../src/next/i18n/translate.ts';

const base = `/api/projects/${PROJECT_ID}`;
const en = (m) => translate('en', m.id, m.values);
const get = (port, path) => port.request(`${base}${path}`);
const post = (port, path, body) => port.request(`${base}${path}`, { method: 'POST', body, key: 'k' });
const all = (port) => readAllAssets((offset) => get(port, `/assets?offset=${offset}`));

test('the sample library is the design study’s: 16 items, grouped by scene and shot', async () => {
  const port = new FixturePort();
  const { items } = await all(port);
  assert.equal(items.length, 16);
  const view = assetLibrary(items, port.world.overview, ALL_ASSETS);
  assert.deepEqual(view.counts, { all: 16, keyframe: 6, clip: 3, voice: 3, music: 2, upload: 2, document: 0, export: 0 });
  assert.deepEqual(view.film.tiles.map((t) => en(t.title)), ['low-tide.mp3', 'foghorn-theme.wav', 'Imported image 1', 'Imported image 2']);
  assert.deepEqual(view.scenes[0].sets[1].tiles.map((t) => [en(t.title), en(t.use.label)]), [
    ['Keyframe 1.2 · take 1', 'Current'], ['Clip 1.2 · take 1', 'Current'], ['Voice line 1.2', 'Earlier'], ['Voice line 1.2', 'Current'],
  ]);
  assert.equal(view.scenes[0].sets[1].tiles[1].item.durationSeconds, 5);
  port.close();
});

test('the route pages by 40 and filters like the studio', async () => {
  const port = new FixturePort();
  const page = await get(port, '/assets?offset=0&role=keyframe');
  assert.equal(page.total, 6);
  assert.equal(page.nextOffset, null);
  assert.ok(page.assets.every((a) => a.role === 'keyframe'));
  const scene2 = await get(port, `/assets?sceneId=${sceneId(2)}`);
  assert.equal(scene2.total, 4);
  const shot = await get(port, `/assets?shotId=${shotId('1.2')}`);
  assert.equal(shot.total, 4);
  const newestFirst = (await get(port, '/assets')).assets.map((a) => Date.parse(a.createdAt));
  assert.deepEqual(newestFirst, [...newestFirst].sort((a, b) => b - a));
  port.close();
});

test('the sample library was made in the past, so anything imported now is the newest', async () => {
  const port = new FixturePort();
  const before = Date.now();
  const { items } = await all(port);
  assert.ok(items.every((item) => Date.parse(item.createdAt) <= before - 2 * 60 * 60 * 1000 + 60_000), 'every sample item is at least two hours old');
  const voice = items.find((item) => item.role === 'voice' && !item.current);
  const latest = Math.max(...items.map((item) => Date.parse(item.createdAt)));
  assert.equal(Math.round((latest - Date.parse(voice.createdAt)) / 60_000), 24, 'the study’s spacing is kept (10:20 to 10:44)');
  const image = await post(port, `/images/uploads?expectedHeadVersion=${port.world.snapshot.project.headVersion}`, { name: 'pier.png', size: 5000, type: 'image/png', key: 'n' });
  const first = (await get(port, '/assets')).assets[0];
  assert.equal(first.artifact.artifactId, image.artifact.artifactId, 'the import is listed first');
  port.close();
});

test('a remade keyframe becomes take 2 and the first stays as an earlier take', async () => {
  const port = new FixturePort();
  await all(port);
  const id = shotId('2.2');
  port.world.update((w) => {
    const shot = w.overview.shots[id];
    w.overview = { ...w.overview, shots: { ...w.overview.shots, [id]: { ...shot, keyframe: { state: 'ready', artifact: { artifactId: 'art-2.2-red', sha256: 'b'.repeat(64), kind: 'image' }, takeCount: 2, opened: false } } } };
  });
  const { items } = await all(port);
  const takes = items.filter((a) => a.shotId === id && a.role === 'keyframe').sort((a, b) => a.takeIndex - b.takeIndex);
  assert.deepEqual(takes.map((a) => [a.takeIndex, a.current]), [[1, false], [2, true]]);
  port.close();
});

test('imports add to the library through the simulated upload routes, and refuse like the studio', async () => {
  const port = new FixturePort();
  const head = port.world.snapshot.project.headVersion;
  const cursor = port.world.overview.cursor;

  const image = await post(port, `/images/uploads?expectedHeadVersion=${head}`, { name: 'pier.png', size: 5000, type: 'image/png' });
  assert.match(image.artifact.artifactId, /^art-import-/);
  assert.equal(port.world.snapshot.project.headVersion, head + 1, 'an image import is a new film version, as in the studio');
  assert.ok(port.world.overview.cursor > cursor, 'the library is told to read again');

  await assert.rejects(post(port, `/images/uploads?expectedHeadVersion=${head}`, { name: 'pier.png', size: 5000, type: 'image/png' }), (e) => e.code === 'REVISION_CONFLICT');
  await assert.rejects(post(port, `/images/uploads?expectedHeadVersion=${head + 1}`, { name: 'tiny.png', size: 10, type: 'image/png' }), (e) => e.code === 'IMAGE_INPUT_INVALID');
  await assert.rejects(post(port, `/media/uploads?expectedHeadVersion=${head + 1}`, { name: 'huge.mp4', size: 200 * 1024 * 1024 }), (e) => e.code === 'UPLOAD_TOO_LARGE');
  await assert.rejects(post(port, '/audio-library/uploads?role=music&name=long.wav', { name: 'long.wav', size: 10, durationSeconds: 400 }), (e) => e.code === 'MEDIA_DURATION_LIMIT');
  await assert.rejects(post(port, `/media/uploads?expectedHeadVersion=${head + 1}`, { name: 'long.mp4', size: 10, durationSeconds: 361 }), (e) => e.code === 'MEDIA_DURATION_LIMIT');

  const audio = await post(port, '/audio-library/uploads?role=music&name=harbour.wav', { name: 'harbour.wav', size: 4000, durationSeconds: 95 });
  assert.equal(audio.recording.role, 'music');
  const video = await post(port, `/media/uploads?expectedHeadVersion=${port.world.snapshot.project.headVersion}`, { name: 'gangway.mp4', size: 9000, durationSeconds: 4 });

  const { items } = await all(port);
  assert.equal(items.length, 19);
  const added = items.filter((a) => [image.artifact.artifactId, audio.recording.id, video.artifact.artifactId].includes(a.artifact.artifactId));
  assert.deepEqual(added.map((a) => [a.role, a.artifact.kind, a.source]).sort(), [['music', 'audio', 'imported'], ['upload', 'image', 'imported'], ['upload', 'video', 'imported']]);
  assert.equal(added.find((a) => a.role === 'music').label, 'harbour.wav');
  assert.ok(added.every((a) => !a.shotId), 'imports are not put on a shot');

  const caps = await get(port, '/images');
  assert.equal(caps.capabilities.import, true);
  const audioCaps = await get(port, '/audio-library?role=music');
  assert.equal(audioCaps.capabilities.maxSeconds, 360);
  port.close();
});

test('a request sent again with the same key replays its receipt instead of importing twice', async () => {
  const port = new FixturePort();
  const head = port.world.snapshot.project.headVersion;
  const path = `/images/uploads?expectedHeadVersion=${head}`;
  const first = await post(port, path, { name: 'pier.png', size: 5000, type: 'image/png', key: 'same' });
  // The film moved on (this import made a new version), but the same request is found again.
  const again = await post(port, path, { name: 'pier.png', size: 5000, type: 'image/png', key: 'same' });
  assert.deepEqual(again, first);
  const audio = await post(port, '/audio-library/uploads?role=music&name=a.wav', { name: 'a.wav', size: 100, key: 'a1' });
  assert.deepEqual(await post(port, '/audio-library/uploads?role=music&name=a.wav', { name: 'a.wav', size: 100, key: 'a1' }), audio);
  const { items } = await all(port);
  assert.equal(items.length, 18, 'one image and one recording, not two of each');
  port.close();
});

test('the sample uploader can ask for refusals in the reply, and each sample film keeps its own imported pictures', async () => {
  const port = new FixturePort();
  const head = port.world.snapshot.project.headVersion;
  const refused = await post(port, `/images/uploads?expectedHeadVersion=${head}`, { name: 'x.png', size: 10, type: 'image/png', key: 'r', refusalInBody: true });
  assert.deepEqual(refused, { refused: { code: 'IMAGE_INPUT_INVALID' } });
  const preview = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
  stageFixturePreview('p', preview);
  const image = await post(port, `/images/uploads?expectedHeadVersion=${head}`, { name: 'pier.png', size: 5000, type: 'image/png', key: 'p' });
  const id = image.artifact.artifactId;
  assert.ok(isFixtureImport(id));
  const picture = (port, artifactId) => get(port, `${FIXTURE_PICTURE_ROUTE}/${encodeURIComponent(artifactId)}`);
  assert.ok((await picture(port, id)).svg.includes(preview), 'the imported picture is shown');
  assert.match(fixtureAssetPicture('art-ref'), /^<svg xmlns=/, 'the sample uploads have their pictures');
  assert.equal(fixtureAssetPicture('art-1.1'), null, 'shot pictures come from the shared fixture pictures');
  assert.equal(isFixtureImport('art-1.1'), false);
  // Another sample film (a new port) has its own ids and never sees this one's pictures.
  const other = new FixturePort();
  stageFixturePreview('q', preview);
  const theirs = await post(other, `/images/uploads?expectedHeadVersion=${other.world.snapshot.project.headVersion}`, { name: 'b.png', size: 5000, type: 'image/png', key: 'q' });
  assert.notEqual(theirs.artifact.artifactId, id, 'another sample film never shares an imported picture id');
  await assert.rejects(picture(other, id), (e) => e.code === 'NOT_FOUND');
  assert.ok((await picture(other, theirs.artifact.artifactId)).svg.includes(preview));
  port.close();
  other.close();
});
