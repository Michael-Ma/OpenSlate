import test from 'node:test';
import assert from 'node:assert/strict';
import { translateMsg } from '../../src/next/i18n/translate.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { CODE_FILM_ID } from '../../src/next/fixtures/routes/code-plan.ts';
import { estimateMsg } from '../../src/next/model/settings.ts';
import { resolutionChoices, resolutionImpact, resolutionLabel, resolutionRequest, VIDEO_SETTINGS_PATH } from '../../src/next/model/settings-video.ts';
import { settingsRequest } from '../../src/next/model/settings-ownership.ts';
import { StudioStore } from '../../src/next/store/store.ts';

const en = (m) => translateMsg('en', m);
const zh = (m) => translateMsg('zh-CN', m);

async function studio(t, search) {
  if (search) globalThis.location = { search };
  const port = new FixturePort();
  let n = 0;
  const store = new StudioStore({ client: port, storage: null, newKey: () => `key-${++n}` });
  await store.start();
  t.after(() => { store.stop(); port.close(); delete globalThis.location; });
  return { port, store };
}

const path = (projectId) => settingsRequest(projectId, { path: VIDEO_SETTINGS_PATH, body: null }).path;

test('a code film offers four resolutions, cheapest first, priced by the second; new films start at 1080p', async (t) => {
  const { store } = await studio(t, '?codeplan=waiting');
  const view = await store.read(path(CODE_FILM_ID));
  assert.equal(view.resolution, '1080p');
  assert.equal(view.quality, 'high');
  assert.deepEqual(view.exportSize, { width: 1920, height: 1080 });
  const choices = resolutionChoices(view, 'en-US');
  assert.deepEqual(choices.map((choice) => resolutionLabel(choice.value)), ['480p', '768p', '1080p', '2K']);
  assert.deepEqual(choices.map((choice) => en(choice.estimate)), [
    'about $0.02–$0.03 a second', 'about $0.03–$0.05 a second', 'about $0.05–$0.06 a second', 'about $0.06–$0.07 a second',
  ]);
  assert.equal(zh(choices[3].estimate), '每秒约 $0.06–$0.07');
});

test('switching says what it changes before anything is saved', async (t) => {
  const { store } = await studio(t, '?codeplan=waiting');
  const view = await store.read(path(CODE_FILM_ID));
  assert.deepEqual(resolutionImpact(view, '2k', 'en-US').map(en), [
    'Clips not made yet use it, at about $0.06–$0.07 a second.',
    'Clips already made or running keep their resolution; nothing is made again.',
    'Switching makes nothing and charges nothing.',
  ]);
  assert.deepEqual(resolutionRequest('2k'), { path: VIDEO_SETTINGS_PATH, body: { resolution: '2k' }, method: 'PUT' });
});

test('a saved resolution reprices the film\'s video row; an unknown value and a storyboard film are refused', async (t) => {
  const { store } = await studio(t, '?codeplan=waiting');
  const request = settingsRequest(CODE_FILM_ID, resolutionRequest('2k'));
  const saved = await store.command('settings:video-resolution', request.body, () => request);
  assert.equal(saved.resolution, '2k');
  assert.equal((await store.read(path(CODE_FILM_ID))).resolution, '2k');
  const models = await store.read(settingsRequest(CODE_FILM_ID, { path: '/settings/models', body: null }).path);
  const viggle = models.options.find((option) => option.id === 'viggle-h3');
  assert.equal(en(estimateMsg(viggle, 'en-US', true)), 'about $0.06–$0.07 a second');
  const bad = settingsRequest(CODE_FILM_ID, { ...resolutionRequest('2k'), body: { resolution: '4k' } });
  assert.equal(await store.command('settings:video-resolution', bad.body, () => bad), undefined, 'the refusal is a toast, not a throw');
  assert.equal((await store.read(path(CODE_FILM_ID))).resolution, '2k');
});

test('a storyboard film has no video resolution', async (t) => {
  const { store } = await studio(t);
  assert.equal(store.getState().projectId, 'last-ferry');
  await assert.rejects(store.read(path('last-ferry')), (error) => error.code === 'CODE_PLAN_VIDEO_SETTINGS_UNAVAILABLE' && error.status === 409);
});
