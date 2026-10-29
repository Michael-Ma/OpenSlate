import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { FIXTURE_PICTURE_ROUTE, fixtureAssetPicture, isFixtureImport, stageFixturePreview } from '../../src/next/fixtures/routes/assets.ts';
import { PROJECT_ID, shotId, sceneId } from '../../src/next/fixtures/last-ferry.ts';
import { ALL_ASSETS, assetLibrary, readAllAssets } from '../../src/next/model/assets.ts';
import { uploadPath } from '../../src/next/model/assets-import.ts';
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

test('named PNG, JPEG and video imports keep their names in Assets and message attachments', async t => {
  const port = new FixturePort();
  t.after(() => port.close());
  const imports = [];
  for (const [kind, name, type] of [['image', 'Pier & tide.png', 'image/png'], ['image', '码头.jpg', 'image/jpeg'], ['video', 'Gangway clip.mp4', 'video/mp4']]) {
    const receipt = await post(port, uploadPath(kind, port.world.snapshot.project.headVersion, 'upload', name), { name, type, size: 5000, key: name, ...(kind === 'video' ? { durationSeconds: 4 } : {}) });
    imports.push({ artifact: receipt.artifact, name });
  }
  const { items } = await all(port);
  const view = assetLibrary(items, port.world.overview, ALL_ASSETS);
  for (const { artifact, name } of imports) {
    const item = items.find(item => item.artifact.artifactId === artifact.artifactId);
    assert.equal(item.label, name);
    const tile = view.film.tiles.find(tile => tile.item.artifact.artifactId === artifact.artifactId);
    assert.equal(en(tile.title), name);
  }
  await post(port, '/messages', { text: 'Look at these files', attachments: imports.map(({ artifact }) => ({ artifactId: artifact.artifactId, sha256: artifact.sha256 })) });
  assert.deepEqual(port.world.snapshot.conversation.at(-1).attachments.map(({ name, artifact }) => [name, artifact.kind]), imports.map(({ name, artifact }) => [name, artifact.kind]));
});

test('unnamed picture and video imports retain their library and message fallback labels', async t => {
  const port = new FixturePort();
  t.after(() => port.close());
  const imports = [];
  for (const route of ['images', 'media']) {
    const receipt = await post(port, `/${route}/uploads?expectedHeadVersion=${port.world.snapshot.project.headVersion}`, { name: route === 'images' ? 'not-a-query-name.png' : 'not-a-query-name.mp4', type: route === 'images' ? 'image/png' : 'video/mp4', size: 5000, key: route });
    imports.push(receipt.artifact);
  }
  const { items } = await all(port);
  for (const artifact of imports) assert.equal(items.find(item => item.artifact.artifactId === artifact.artifactId).label, `${port.world.snapshot.project.name} · upload`);
  const titles = assetLibrary(items, port.world.overview, ALL_ASSETS).film.tiles.map(tile => en(tile.title));
  assert.ok(titles.includes('Imported image 3'));
  assert.ok(titles.includes('Imported video'));
  await post(port, '/messages', { text: 'Look at these files', attachments: imports.map(({ artifactId, sha256 }) => ({ artifactId, sha256 })) });
  assert.deepEqual(port.world.snapshot.conversation.at(-1).attachments.map(({ name }) => name), imports.map(() => `${port.world.snapshot.project.name} · upload`));
});

test('picture and video names reject empty, oversized, control and slash values without importing', async t => {
  const port = new FixturePort();
  t.after(() => port.close());
  await all(port);
  const head = port.world.snapshot.project.headVersion;
  const cursor = port.world.overview.cursor;
  const invalid = ['', 'x'.repeat(121), 'pier/a.png', 'pier\\a.png', 'a\u0000.png', 'a\n.png', 'a\u001f.png', 'a\u007f.png'];
  for (const route of ['images', 'media']) {
    for (const name of invalid) {
      const path = `/${route}/uploads?${new URLSearchParams({ expectedHeadVersion: String(head), name })}`;
      const body = { name: 'fixture-file', type: route === 'images' ? 'image/png' : 'video/mp4', size: 5000, key: `${route}:${name}` };
      await assert.rejects(post(port, path, body), error => error.code === 'VALIDATION_ERROR' && error.status === 400);
      assert.deepEqual(await post(port, path, { ...body, refusalInBody: true }), { refused: { code: 'VALIDATION_ERROR' } });
    }
  }
  assert.equal((await all(port)).items.length, 16);
  assert.equal(port.world.snapshot.project.headVersion, head);
  assert.equal(port.world.overview.cursor, cursor);
});

test('picture and video names preserve exact valid names at the length boundary', async t => {
  const port = new FixturePort();
  t.after(() => port.close());
  for (const [route, name] of [['images', 'a'.repeat(120)], ['media', '  clip · preview.mp4  ']]) {
    const receipt = await post(port, `/${route}/uploads?${new URLSearchParams({ expectedHeadVersion: String(port.world.snapshot.project.headVersion), name })}`, { name: 'fixture-file', type: route === 'images' ? 'image/png' : 'video/mp4', size: 5000, key: route });
    assert.equal((await all(port)).items.find(item => item.artifact.artifactId === receipt.artifact.artifactId).label, name);
  }
});

test('named picture and video replays are exact and reject another name, missing name or changed file', async t => {
  const port = new FixturePort();
  t.after(() => port.close());
  for (const route of ['images', 'media']) {
    const query = new URLSearchParams({ expectedHeadVersion: String(port.world.snapshot.project.headVersion), name: route === 'images' ? 'pier.png' : 'pier.mp4' });
    const path = `/${route}/uploads?${query}`;
    const body = { name: 'fixture-file', type: route === 'images' ? 'image/png' : 'video/mp4', size: 5000, key: route };
    const first = await post(port, path, body);
    assert.deepEqual(await post(port, path, body), first, 'the original head still replays after the film moved');
    const head = port.world.snapshot.project.headVersion;
    query.set('name', route === 'images' ? 'another.png' : 'another.mp4');
    await assert.rejects(post(port, `/${route}/uploads?${query}`, body), error => error.code === 'IDEMPOTENCY_CONFLICT');
    query.delete('name');
    assert.deepEqual(await post(port, `/${route}/uploads?${query}`, { ...body, refusalInBody: true }), { refused: { code: 'IDEMPOTENCY_CONFLICT' } });
    await assert.rejects(post(port, path, { ...body, size: 5001 }), error => error.code === 'IDEMPOTENCY_CONFLICT');
    assert.equal(port.world.snapshot.project.headVersion, head);
  }
  assert.equal((await all(port)).items.length, 18, 'only the two original imports were saved');
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
