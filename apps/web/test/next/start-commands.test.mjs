import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { openDemo, readFilms, renameFilm, runCreation, setArchived, shownRefusal, projectPath } from '../../src/next/model/start-commands.ts';
import { filmsView } from '../../src/next/model/start.ts';
import { afterFailure, codexFrom, createBody, creationSteps, modelPlan } from '../../src/next/model/start-new.ts';

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
const track = (seen = []) => ({ onStep: s => seen.push(s) });
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
  const made = [];
  const result = await runCreation(store, { body: createBody('Night bus II', plan, 'Untitled film'), steps, plan: { fileName: 'night-bus-ii.txt', text: 'Scene 1: the last stop.' } },
    { onStep: s => seen.push(s), onMade: f => made.push(f) });
  assert.equal(result.failedAt, null);
  assert.equal(result.code, null);
  assert.deepEqual(made, [result.film]);
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
  const input = { body: { name: 'Retry film' }, steps, plan: { fileName: 'bad.pdf', text: 'x' } };
  const made = [];
  const first = await runCreation(store, input, { onStep() {}, onMade: f => made.push(f) });
  assert.equal(first.failedAt, 'import');
  assert.equal(first.code, 'VALIDATION_ERROR');
  assert.equal(afterFailure('plan', first.failedAt, first.code), 'retry');
  assert.equal(toastId(store), 'error.VALIDATION_ERROR');
  // The film was reported made before the plan send failed, so the list can show it at once.
  assert.deepEqual(made, [first.film]);
  const before = (await readFilms(store)).length;
  const second = await runCreation(store, { ...input, plan: { fileName: 'good.md', text: 'x' } }, { onStep() {}, onMade: f => made.push(f) }, { film: first.film, from: 'import' });
  assert.equal(second.failedAt, null);
  assert.equal(second.film.id, first.film.id);
  assert.equal((await readFilms(store)).length, before);
  // Clearing the plan before Try again finishes without sending it, and still makes no second film.
  const third = await runCreation(store, { ...input, steps: creationSteps('plan', codex, '') }, track(), { film: first.film, from: 'import' });
  assert.equal(third.failedAt, null);
  assert.equal((await readFilms(store)).length, before);
  assert.equal(made.length, 1, 'a resumed run reports no new film');
});

test('without Codex the Director step stops with CODEX_NOT_FOUND: final for the Director, the empty outline opens anyway', async t => {
  const { store } = await studio(t, 'no-keys');
  const codex = codexFrom(await store.read('/director/setup'));
  assert.equal(codex.state, 'not_found');
  const plan = modelPlan(await store.read('/api/providers'), codex, 'en');
  assert.equal(plan.selection, null);
  const forced = await runCreation(store, { body: { name: 'Needs Codex' }, steps: ['create', 'director'], plan: null }, track());
  assert.deepEqual([forced.failedAt, forced.code], ['director', 'CODEX_NOT_FOUND']);
  assert.equal(toastId(store), 'error.CODEX_NOT_FOUND');
  assert.equal(afterFailure('director', forced.failedAt, forced.code), 'final');
  assert.equal(afterFailure('empty', forced.failedAt, forced.code), 'open');
  assert.deepEqual(creationSteps('empty', codex, ''), ['create']);
});

test('a real first run cannot read Codex before a film exists; the new film’s Director step finds out', async t => {
  const { store } = await studio(t, 'first-run');
  await assert.rejects(store.read('/director/setup'));
  const codex = { state: 'unknown' };
  assert.deepEqual(creationSteps('director', codex, ''), ['create', 'director']);
  const made = [];
  const result = await runCreation(store, { body: { name: 'Harbour' }, steps: creationSteps('director', codex, ''), plan: null }, { onStep() {}, onMade: f => made.push(f) });
  assert.deepEqual([result.failedAt, result.code], ['director', 'CODEX_NOT_FOUND']);
  assert.equal(afterFailure('director', result.failedAt, result.code), 'final');
  // The film exists and is listed, so closing the sheet never hides it.
  assert.deepEqual(made, [result.film]);
  assert.equal(byId(await readFilms(store), result.film.id).name, 'Harbour');
  assert.equal(filmsView(await readFilms(store), null, new Date(), 'en').firstRun, false);
});

test('a busy Codex check offers Try again, which sets up the same film; for an empty outline it is only a fallback', async t => {
  const { store } = await studio(t, 'setup-busy');
  const codex = codexFrom(await store.read('/director/setup'));
  assert.equal(codex.state, 'found');
  const input = { body: { name: 'Crossing' }, steps: creationSteps('director', codex, ''), plan: null };
  const first = await runCreation(store, input, track());
  assert.deepEqual([first.failedAt, first.code], ['director', 'DIRECTOR_SETUP_BUSY']);
  assert.equal(toastId(store), 'error.DIRECTOR_SETUP_BUSY');
  assert.equal(afterFailure('director', first.failedAt, first.code), 'retry');
  const before = (await readFilms(store)).length;
  const again = await runCreation(store, input, track(), { film: first.film, from: 'director' });
  assert.deepEqual([again.failedAt, again.film.id], [null, first.film.id]);
  assert.equal((await store.read(projectPath(first.film.id, '/director/setup'))).selection.mode, 'native');
  assert.equal((await readFilms(store)).length, before);
  const outline = await runCreation(store, { ...input, body: { name: 'Outline' }, steps: creationSteps('empty', codex, '') }, track());
  assert.equal(afterFailure('empty', outline.failedAt, outline.code), 'open');
});

test('Start words the refusals whose general text would mislead: the demo without a stand-in Director, models that changed', async t => {
  const { store } = await studio(t);
  const stale = await runCreation(store, { body: { name: 'Stale', expectedCatalogDigest: 'f'.repeat(64), profileIds: ['openai-gpt-image-2'] }, steps: ['create'], plan: null }, track());
  assert.deepEqual([stale.film, stale.failedAt, stale.code], [null, 'create', 'PROVIDER_CATALOG_CHANGED']);
  assert.equal(toastId(store), 'start.new.models_changed');
  // A film whose Director is Codex cannot take the demo: the fill is refused with ACTOR_DENIED.
  const made = await runCreation(store, { body: { name: 'Codex film' }, steps: ['create', 'director'], plan: null }, track());
  assert.equal(made.failedAt, null);
  const demo = await openDemo(store, 'Demo film', made.film);
  assert.equal(demo.filled, false);
  assert.equal(toastId(store), 'start.demo.unavailable');
});

test('the refusal code is read from the toast the press showed, including codes without their own message', () => {
  const at = toast => ({ getState: () => ({ toast }) });
  assert.equal(shownRefusal(at({ id: 2, tone: 'error', message: { id: 'error.DIRECTOR_SETUP_BUSY' } }), 1), 'DIRECTOR_SETUP_BUSY');
  assert.equal(shownRefusal(at({ id: 2, tone: 'error', message: { id: 'error.unknown', values: { code: 'NEW_CODE' } } }), undefined), 'NEW_CODE');
  assert.equal(shownRefusal(at({ id: 2, tone: 'error', message: { id: 'error.VALIDATION_ERROR' } }), 2), null, 'the same toast as before the press');
  assert.equal(shownRefusal(at({ id: 3, tone: 'info', message: { id: 'start.rename.done' } }), 2), null);
  assert.equal(shownRefusal(at(null), 2), null);
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
