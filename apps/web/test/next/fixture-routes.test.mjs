import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { extraRoutes } from '../../src/next/fixtures/routes/index.ts';
import { assetsRoutes } from '../../src/next/fixtures/routes/assets.ts';
import { computerRoutes } from '../../src/next/fixtures/routes/computer.ts';
import { filmRoutes } from '../../src/next/fixtures/routes/film.ts';
import { narrationRoutes } from '../../src/next/fixtures/routes/narration.ts';
import { planRoutes } from '../../src/next/fixtures/routes/plan.ts';
import { settingsRoutes } from '../../src/next/fixtures/routes/settings.ts';
import { startRoutes } from '../../src/next/fixtures/routes/start.ts';
import { DECLINE } from '../../src/next/fixtures/routes/types.ts';
import { shotId } from '../../src/next/fixtures/last-ferry.ts';

const OWNERS = { plan: planRoutes, narration: narrationRoutes, film: filmRoutes, assets: assetsRoutes, settings: settingsRoutes, start: startRoutes, computer: computerRoutes };
const ownerOf = (route) => Object.entries(OWNERS).find(([, routes]) => routes.includes(route))?.[0];
const matching = (method, path) => extraRoutes.filter((route) => route.method === method && route.match.test(path));

test('every endpoint more than one view reads has exactly one owner', () => {
  const expected = [
    ['GET', '/api/providers', 'computer'],
    ['GET', '/api/projects', 'start'],
    ['GET', '/api/projects?includeArchived=true', 'start'],
    ['GET', '/director/setup', 'settings'],
    ['POST', '/director/setup', 'settings'],
    ['GET', '/director/models', 'settings'],
    ['POST', '/director/change', 'settings'],
    ['GET', '/api/projects/night-bus/director/setup', 'start'],
    ['POST', '/api/projects/night-bus/director/setup', 'start'],
    ['GET', '/audio-library?role=music', 'film'],
    ['POST', '/audio-library/uploads?role=music&name=a.wav', 'assets'],
    ['GET', '/assets?role=export', 'assets'],
    ['GET', '/images', 'assets'],
    ['GET', '/exports', 'film'],
    ['GET', '/media', 'film'],
    ['GET', '/plan-imports', 'plan'],
    ['POST', '/rename', 'start'],
    ['GET', '/api/narration/voices?projectId=last-ferry', 'narration'],
    ['GET', '/narration/shots/shot-2-3', 'narration'],
    ['POST', '/shots/shot-2-3/narration/recording?expectedHeadVersion=12', 'narration'],
  ];
  for (const [method, path, owner] of expected) {
    const routes = matching(method, path);
    assert.deepEqual(routes.map(ownerOf), [owner], `${method} ${path}`);
  }
});

test('POST /storyboard is Plan\'s: it declines the music, a shot\'s narration voice and the Undo of commands it never answered, then Narration and Film decline the rest', async () => {
  assert.deepEqual(matching('POST', '/storyboard').map(ownerOf), ['plan', 'narration', 'film']);
  const port = new FixturePort();
  try {
    const head = () => port.world.snapshot.project.headVersion;
    const post = (body) => port.request('/api/projects/last-ferry/storyboard', { method: 'POST', body: { ...body, expectedHeadVersion: head() } });
    const music = await post({ kind: 'soundtrack', field: 'muted', value: 'true' });
    assert.equal(port.world.snapshot.project.soundtrack.muted, true);
    // A later edit anywhere ends the music edit's Undo: one step, the latest command only.
    const moved = await post({ kind: 'moveShot', id: shotId('2.2'), sceneId: port.world.overview.shots[shotId('2.2')].sceneId, beforeId: shotId('2.1') });
    await assert.rejects(post({ kind: 'undo', commandId: music.commandId }), (error) => error.code === 'UNDO_UNAVAILABLE');
    await post({ kind: 'undo', commandId: moved.commandId });
    assert.equal(port.world.overview.shots[shotId('2.2')].label, '2.2');
    // The Keyframes commands answer what no view's route takes.
    const [, narration, film] = matching('POST', '/storyboard');
    assert.equal(narration.handle(port.world, [], { kind: 'shot', id: shotId('2.1'), field: 'motion', value: 'Static' }), DECLINE);
    assert.equal(film.handle(port.world, [], { kind: 'shot', id: shotId('2.1'), field: 'motion', value: 'Static' }), DECLINE);
  } finally {
    port.close();
  }
});

test('music imported in Assets joins the music the Film view can choose', async () => {
  const port = new FixturePort();
  try {
    const before = await port.request('/api/projects/last-ferry/audio-library?role=music');
    assert.equal(before.capabilities.import, true, 'the sample studio imports audio');
    const { recording } = await port.request('/api/projects/last-ferry/audio-library/uploads?role=music&name=harbour.wav', { method: 'POST', body: { name: 'harbour.wav', size: 4000, durationSeconds: 95 } });
    const after = await port.request('/api/projects/last-ferry/audio-library?role=music');
    assert.deepEqual(after.recordings.map((r) => r.label), ['harbour.wav', ...before.recordings.map((r) => r.label)]);
    const head = port.world.snapshot.project.headVersion;
    await port.request('/api/projects/last-ferry/storyboard', { method: 'POST', body: { kind: 'soundtrack', field: 'audioId', value: recording.id, expectedHeadVersion: head } });
    assert.equal(port.world.snapshot.project.soundtrack.audioId, recording.id);
  } finally {
    port.close();
  }
});

test('the Film view\'s finished exports are in the asset library, the latest one current', async () => {
  const { applyFilmPreset } = await import('../../src/next/fixtures/routes/film.ts');
  const port = new FixturePort();
  try {
    applyFilmPreset(port.world, 'ready');
    const view = await port.request('/api/projects/last-ferry/exports');
    const { assets } = await port.request('/api/projects/last-ferry/assets?role=export');
    assert.deepEqual(assets.map((a) => a.artifact.artifactId), [view.current, ...view.history].map((r) => r.artifact.artifactId));
    assert.deepEqual(assets.map((a) => a.current), [true, false, false]);
  } finally {
    port.close();
  }
});
