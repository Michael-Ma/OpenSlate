import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { openDemo, readFilms, renameFilm, runCreation, setArchived, projectPath } from '../../src/next/model/start-commands.ts';
import { filmsView } from '../../src/next/model/start.ts';
import { codexFrom, createBody, creationSteps, modelPlan } from '../../src/next/model/start-new.ts';

/** The fixture studio with The Last Ferry open, like ?ui=next&fixture=last-ferry. `start` sets ?start=. */
async function studio(t, start) {
  if (start) globalThis.location = { search: `?start=${start}` };
  const port = new FixturePort();
  const store = new StudioStore({ client: port, storage: null, newKey: () => crypto.randomUUID() });
  await store.start();
  t.after(() => { store.stop(); port.close(); delete globalThis.location; });
  return { port, store };
}

const toastId = store => store.getState().toast?.message.id;
const byId = (films, id) => films.find(f => f.id === id);

test('the films list has the sample films, one archived', async t => {
  const { store } = await studio(t);
  const films = await readFilms(store);
  const view = filmsView(films, store.getState().projectId, new Date(), 'en');
  assert.deepEqual(view.live.map(r => r.name), ['The Last Ferry', 'Demo: The Last Ferry', 'Night bus']);
  assert.deepEqual(view.archived.map(r => r.name), ['Lighthouse test']);
  const ferry = byId(films, 'last-ferry');
  assert.deepEqual([ferry.scenes, ferry.shots, ferry.seconds, ferry.videosReady], [3, 8, 48, 3]);
  assert.equal(view.live[0].current, true);
});

test('rename reads the head version, renames, and the open film’s title follows', async t => {
  const { store } = await studio(t);
  assert.equal(await renameFilm(store, 'night-bus', 'Night bus, take two'), true);
  assert.equal(byId(await readFilms(store), 'night-bus').name, 'Night bus, take two');
  assert.equal(toastId(store), 'start.rename.done');
  assert.equal(await renameFilm(store, 'last-ferry', 'The Last Ferry (cut 2)'), true);
  await store.refresh();
  assert.equal(store.getState().snapshot.project.name, 'The Last Ferry (cut 2)');
  assert.equal(byId(await readFilms(store), 'last-ferry').name, 'The Last Ferry (cut 2)');
});

test('archive and restore move a film between the list and Archived', async t => {
  const { store } = await studio(t);
  assert.equal(await setArchived(store, { id: 'night-bus', name: 'Night bus' }, true), true);
  assert.equal(byId(await readFilms(store), 'night-bus').archived, true);
  assert.equal(toastId(store), 'start.archive.done');
  assert.equal(await setArchived(store, { id: 'lighthouse-test', name: 'Lighthouse test' }, false), true);
  assert.equal(byId(await readFilms(store), 'lighthouse-test').archived, false);
  assert.equal(toastId(store), 'start.archived.restored');
});

test('archive is refused while a job runs in the film', async t => {
  const { port, store } = await studio(t);
  port.world.update(w => {
    const shots = { ...w.overview.shots };
    shots['shot-3-1'] = { ...shots['shot-3-1'], keyframe: { state: 'running', takeCount: 0, opened: false } };
    w.overview = { ...w.overview, shots };
  });
  assert.equal(await setArchived(store, { id: 'last-ferry', name: 'The Last Ferry' }, true), false);
  assert.equal(toastId(store), 'error.ATTEMPTS_RUNNING');
  assert.equal(byId(await readFilms(store), 'last-ferry').archived, false);
});

test('a new film from a written plan: created, Codex Director set up, plan sent; it opens in the studio', async t => {
  const { store } = await studio(t);
  const providers = await store.read('/api/providers');
  const codex = codexFrom(await store.read('/director/setup'));
  assert.equal(codex.state, 'found');
  const plan = modelPlan(providers, codex, 'en');
  assert.equal(plan.ready, 4);
  const steps = creationSteps('plan', codex, 'Scene 1: the last stop.');
  const seen = [];
  const result = await runCreation(store, { body: createBody('Night bus II', plan, 'Untitled film'), steps, requireDirector: true, plan: { fileName: 'night-bus-ii.txt', text: 'Scene 1: the last stop.' } }, s => seen.push(s));
  assert.equal(result.failedAt, null);
  assert.deepEqual(seen, ['create', 'director', 'import']);
  assert.equal(result.film.name, 'Night bus II');
  const setup = await store.read(projectPath(result.film.id, '/director/setup'));
  assert.equal(setup.selection.mode, 'native');
  const { pending } = await store.read(projectPath(result.film.id, '/plan-imports'));
  assert.equal(pending.name, 'night-bus-ii.txt');
  await store.selectProject(result.film.id);
  assert.equal(store.getState().snapshot.project.name, 'Night bus II');
  assert.equal(store.getState().overview.scenes.length, 0);
  assert.equal(byId(await readFilms(store), result.film.id).shots, 0);
});

test('Try again after a failed step finishes the same film instead of making a second one', async t => {
  const { store } = await studio(t);
  const codex = { state: 'found', model: 'gpt-6-astra' };
  const steps = creationSteps('plan', codex, 'x');
  const input = { body: { name: 'Retry film' }, steps, requireDirector: true, plan: { fileName: 'bad.pdf', text: 'x' } };
  const first = await runCreation(store, input, () => {});
  assert.equal(first.failedAt, 'import');
  assert.equal(toastId(store), 'error.VALIDATION_ERROR');
  const before = (await readFilms(store)).length;
  const second = await runCreation(store, { ...input, plan: { fileName: 'good.md', text: 'x' } }, () => {}, { film: first.film, from: 'import' });
  assert.equal(second.failedAt, null);
  assert.equal(second.film.id, first.film.id);
  assert.equal((await readFilms(store)).length, before);
  // Clearing the plan before Try again finishes without sending it, and still makes no second film.
  const third = await runCreation(store, { ...input, steps: creationSteps('plan', codex, '') }, () => {}, { film: first.film, from: 'import' });
  assert.equal(third.failedAt, null);
  assert.equal((await readFilms(store)).length, before);
});

test('without Codex the Director steps stop with a reason; an empty outline skips the setup', async t => {
  const { store } = await studio(t, 'no-keys');
  const codex = codexFrom(await store.read('/director/setup'));
  assert.equal(codex.state, 'not_found');
  const plan = modelPlan(await store.read('/api/providers'), codex, 'en');
  assert.equal(plan.selection, null);
  const forced = await runCreation(store, { body: { name: 'Needs Codex' }, steps: ['create', 'director'], requireDirector: true, plan: null }, () => {});
  assert.equal(forced.failedAt, 'director');
  assert.equal(toastId(store), 'error.CODEX_NOT_FOUND');
  const empty = await runCreation(store, { body: { name: 'Outline' }, steps: ['create', 'director'], requireDirector: false, plan: null }, () => {});
  assert.equal(empty.failedAt, null);
  assert.deepEqual(creationSteps('empty', codex, ''), ['create']);
});

test('the first run has no live films and the demo fills its own new film', async t => {
  const { store } = await studio(t, 'first-run');
  assert.equal(filmsView(await readFilms(store), null, new Date(), 'en').firstRun, true);
  const { film, filled } = await openDemo(store, 'Demo film', null);
  assert.equal(filled, true);
  const item = byId(await readFilms(store), film.id);
  assert.deepEqual([item.name, item.shots, item.videosReady], ['Demo film', 3, 3]);
  // Filling a film that already has shots is refused; the person sees why.
  const again = await openDemo(store, 'Demo film', film);
  assert.equal(again.filled, false);
  assert.equal(toastId(store), 'error.DEMO_REQUIRES_EMPTY_PROJECT');
});

test('a simulated film answers the Director composer with a scripted reply', async t => {
  const { store } = await studio(t);
  await store.selectProject('night-bus');
  store.setComposerText('A short film about the last bus home.');
  assert.equal(await store.sendMessage(), true);
  await store.refresh();
  assert.equal(store.getState().snapshot.conversation.at(-1).role, 'user');
});
