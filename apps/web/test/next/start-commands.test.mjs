import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { openDemo, showDemoFilm, readFilms, renameFilm, runCreation, setArchived, setUpDirector, shownRefusal, projectPath, DIRECTOR_SETUP_TIMEOUT_MS } from '../../src/next/model/start-commands.ts';
import { codexSource, demoRetryable, filmsView, livePendingDemo, parsePendingDemo } from '../../src/next/model/start.ts';
import { afterFailure, codexFrom, createBody, createdOutcome, creationSteps, modelPlan } from '../../src/next/model/start-new.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

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
const en = m => translateMsg('en', m);
const UNKNOWN = { state: 'unknown' };
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
  assert.deepEqual(await setArchived(store, { id: 'night-bus', name: 'Night bus' }, true, true), { ok: true });
  assert.equal(byId(await readFilms(store), 'night-bus').archived, true);
  assert.equal(toastId(store), 'start.archive.done');
  assert.deepEqual(await setArchived(store, { id: 'lighthouse-test', name: 'Lighthouse test' }, false), { ok: true });
  assert.equal(byId(await readFilms(store), 'lighthouse-test').archived, false);
  assert.equal(toastId(store), 'start.archived.restored');
});

test('archive is refused while a job runs in the film; the dialog gets the words and no toast is left behind its backdrop', async t => {
  const { port, store } = await studio(t);
  port.world.update(w => {
    const shots = { ...w.overview.shots };
    shots['shot-3-1'] = { ...shots['shot-3-1'], keyframe: { state: 'running', takeCount: 0, opened: false } };
    w.overview = { ...w.overview, shots };
  });
  const quiet = await setArchived(store, { id: 'last-ferry', name: 'The Last Ferry' }, true, true);
  assert.equal(quiet.ok, false);
  assert.equal(quiet.code, 'ATTEMPTS_RUNNING');
  assert.match(en(quiet.message), /^Jobs are still running here\. Wait for them to finish/);
  assert.equal(store.getState().toast, null);
  assert.equal(byId(await readFilms(store), 'last-ferry').archived, false);
  // Outside a dialog (Restore) the toast says it, as for every other command.
  assert.equal((await setArchived(store, { id: 'last-ferry', name: 'The Last Ferry' }, true)).ok, false);
  assert.equal(toastId(store), 'error.ATTEMPTS_RUNNING');
});

test('in the refusals sample, archiving another film with a running job is refused with ATTEMPTS_RUNNING', async t => {
  const { store } = await studio(t, 'refusals');
  const done = await setArchived(store, { id: 'night-bus', name: 'Night bus' }, true, true);
  assert.deepEqual([done.ok, done.code], [false, 'ATTEMPTS_RUNNING']);
  assert.equal(store.getState().toast, null);
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
  const result = await runCreation(store, { body: createBody('Night bus II', plan, 'Untitled film'), steps, plan: { fileName: 'night-bus-ii.txt', text: 'Scene 1: the last stop.' }, codex },
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
  const codex = codexFrom(await store.read('/director/setup'));
  const steps = creationSteps('plan', codex, 'x');
  const input = { body: { name: 'Retry film' }, steps, plan: { fileName: 'bad.pdf', text: 'x' }, codex };
  const made = [];
  const first = await runCreation(store, input, { onStep() {}, onMade: f => made.push(f) });
  assert.equal(first.failedAt, 'import');
  assert.equal(first.code, 'VALIDATION_ERROR');
  assert.equal(afterFailure(first.code), 'retry');
  // The sheet says it; no toast is left behind its backdrop.
  assert.equal(first.message.id, 'error.VALIDATION_ERROR');
  assert.equal(store.getState().toast, null);
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

test('without Codex the Director step stops with CODEX_NOT_FOUND, final and without a toast; the empty outline never asks', async t => {
  const { store } = await studio(t, 'no-keys');
  const codex = codexFrom(await store.read('/director/setup'));
  assert.equal(codex.state, 'not_found');
  const plan = modelPlan(await store.read('/api/providers'), codex, 'en');
  assert.equal(plan.selection, null);
  const forced = await runCreation(store, { body: { name: 'Needs Codex' }, steps: ['create', 'director'], plan: null, codex: UNKNOWN }, track());
  assert.deepEqual([forced.failedAt, forced.code], ['director', 'CODEX_NOT_FOUND']);
  assert.equal(store.getState().toast, null, 'the Director step words nothing itself');
  assert.equal(afterFailure(forced.code), 'final');
  assert.deepEqual(creationSteps('empty', codex, ''), ['create']);
});

test('a real first run cannot read Codex before a film exists; the new film’s Director step finds out', async t => {
  const { store } = await studio(t, 'first-run');
  await assert.rejects(store.read('/director/setup'));
  const codex = UNKNOWN;
  assert.deepEqual(creationSteps('director', codex, ''), ['create', 'director']);
  const made = [];
  const result = await runCreation(store, { body: { name: 'Harbour' }, steps: creationSteps('director', codex, ''), plan: null, codex }, { onStep() {}, onMade: f => made.push(f) });
  assert.deepEqual([result.failedAt, result.code], ['director', 'CODEX_NOT_FOUND']);
  assert.equal(afterFailure(result.code), 'final');
  // The film exists and is listed, so closing the sheet never hides it.
  assert.deepEqual(made, [result.film]);
  assert.equal(byId(await readFilms(store), result.film.id).name, 'Harbour');
  assert.equal(filmsView(await readFilms(store), null, new Date(), 'en').firstRun, false);
});

test('a busy Codex check offers Try again, which sets up the same film', async t => {
  const { store } = await studio(t, 'setup-busy');
  const codex = codexFrom(await store.read('/director/setup'));
  assert.equal(codex.state, 'found');
  const input = { body: { name: 'Crossing' }, steps: creationSteps('director', codex, ''), plan: null, codex };
  const first = await runCreation(store, input, track());
  assert.deepEqual([first.failedAt, first.code], ['director', 'DIRECTOR_SETUP_BUSY']);
  assert.equal(store.getState().toast, null);
  assert.equal(afterFailure(first.code), 'retry');
  assert.equal(createdOutcome('director', '', first), 'setup_pending');
  const before = (await readFilms(store)).length;
  const again = await runCreation(store, input, track(), { film: first.film, from: 'director' });
  assert.deepEqual([again.failedAt, again.film.id], [null, first.film.id]);
  assert.equal((await store.read(projectPath(first.film.id, '/director/setup'))).selection.mode, 'native');
  assert.equal((await readFilms(store)).length, before);
});

test('an empty outline is made without the Codex check; its Director is set up after, quietly, with the setup the sheet showed', async t => {
  const { store } = await studio(t, 'setup-busy');
  const codex = codexFrom(await store.read('/director/setup'));
  const seen = [];
  const outline = await runCreation(store, { body: { name: 'Outline' }, steps: creationSteps('empty', codex, ''), plan: null, codex }, { onStep: s => seen.push(s) });
  assert.deepEqual([outline.failedAt, seen], [null, ['create']]);
  assert.equal((await store.read(projectPath(outline.film.id, '/director/setup'))).selection.mode, 'fake');
  // The first check answers busy here: nothing is shown, and the film is not called set up. The film's
  // "Created" toast, still showing, is not wiped by the quiet refusal.
  store.dispatch({ type: 'toast', message: { id: 'start.created.empty', values: { name: 'Outline' } }, tone: 'info' });
  const later = await setUpDirector(store, outline.film, codex);
  assert.deepEqual([later.ok, later.code], [false, 'DIRECTOR_SETUP_BUSY']);
  assert.deepEqual([store.getState().toast.message.id, store.getState().toast.tone], ['start.created.empty', 'info']);
  store.dismissToast();
  assert.deepEqual(await setUpDirector(store, outline.film, codex), { ok: true });
  assert.equal((await store.read(projectPath(outline.film.id, '/director/setup'))).selection.mode, 'native');
});

test('the Codex setup gets a long timeout; a lost reply asks the film before calling it a failure', async () => {
  const film = { id: 'f1', name: 'F' };
  const codex = { state: 'found', model: 'm', setup: { mode: 'native', binaryPath: '/c', model: 'm' } };
  const fake = (after) => {
    let toast = null;
    const reads = [];
    const commands = [];
    return {
      reads, commands,
      getState: () => ({ toast }),
      dispatch(action) { if (action.type === 'toast') toast = { id: 1, message: action.message, tone: action.tone }; if (action.type === 'toastDismiss') toast = null; },
      async read(path) { reads.push(path); return reads.length === 1 ? { selection: { mode: 'fake' }, defaults: { binaryPath: '', model: 'm' } } : after; },
      async command(pressId, logical, build, _toast, options) {
        commands.push({ pressId, body: (await build()).body, options });
        toast = { id: 1, message: { id: 'error.NETWORK_ERROR' }, tone: 'error' };
        return undefined;
      },
    };
  };
  // The server finished while the reply was lost: done.
  const finished = fake({ selection: { mode: 'native', binaryPath: '/c' }, defaults: { binaryPath: '', model: 'm' } });
  assert.deepEqual(await setUpDirector(finished, film, codex), { ok: true });
  assert.equal(finished.commands[0].options.timeoutMs, DIRECTOR_SETUP_TIMEOUT_MS);
  assert.ok(DIRECTOR_SETUP_TIMEOUT_MS >= 90_000);
  // What the sheet showed is what is sent, even though this film's own defaults found no Codex.
  assert.deepEqual(finished.commands[0].body, codex.setup);
  assert.equal(finished.getState().toast, null);
  // Still checking: said as busy, not as a failed setup.
  const checking = await setUpDirector(fake({ selection: { mode: 'fake' }, defaults: { binaryPath: '', model: 'm' }, busy: true }), film, codex);
  assert.deepEqual([checking.ok, checking.code], [false, 'DIRECTOR_SETUP_BUSY']);
  // Neither: the network failure stands.
  const lost = await setUpDirector(fake({ selection: { mode: 'fake' }, defaults: { binaryPath: '', model: 'm' }, busy: false }), film, codex);
  assert.deepEqual([lost.ok, lost.code], [false, 'NETWORK_ERROR']);
});

test('Start words the refusals whose general text would mislead: the demo without a stand-in Director, models that changed', async t => {
  const { store } = await studio(t);
  const stale = await runCreation(store, { body: { name: 'Stale', expectedCatalogDigest: 'f'.repeat(64), profileIds: ['openai-gpt-image-2'] }, steps: ['create'], plan: null, codex: UNKNOWN }, track());
  assert.deepEqual([stale.film, stale.failedAt, stale.code], [null, 'create', 'PROVIDER_CATALOG_CHANGED']);
  assert.equal(stale.message.id, 'start.new.models_changed');
  assert.equal(store.getState().toast, null);
  // A film whose Director is Codex cannot take the demo: the fill is refused with ACTOR_DENIED.
  const codex = codexFrom(await store.read('/director/setup'));
  const made = await runCreation(store, { body: { name: 'Codex film' }, steps: ['create', 'director'], plan: null, codex }, track());
  assert.equal(made.failedAt, null);
  const demo = await openDemo(store, 'Demo film', made.film);
  assert.deepEqual([demo.filled, demo.code], [false, 'ACTOR_DENIED']);
  assert.equal(toastId(store), 'start.demo.unavailable');
});

test('in the refusals sample the models change once under the sheet: Create is refused, the next one with the new list works', async t => {
  const { store } = await studio(t, 'refusals');
  const first = modelPlan(await store.read('/api/providers'), UNKNOWN, 'en');
  const refused = await runCreation(store, { body: createBody('Ferry two', first, 'U'), steps: ['create'], plan: null, codex: UNKNOWN }, track());
  assert.deepEqual([refused.film, refused.code], [null, 'PROVIDER_CATALOG_CHANGED']);
  const second = modelPlan(await store.read('/api/providers'), UNKNOWN, 'en');
  assert.notEqual(second.selection.expectedCatalogDigest, first.selection.expectedCatalogDigest);
  const made = await runCreation(store, { body: createBody('Ferry two', second, 'U'), steps: ['create'], plan: null, codex: UNKNOWN }, track());
  assert.equal(made.failedAt, null);
});

test('the refusal code is read from the toast the press showed, compared by object (toast ids restart after a dismiss)', () => {
  const at = toast => ({ getState: () => ({ toast }) });
  const old = { id: 1, tone: 'error', message: { id: 'error.VALIDATION_ERROR' } };
  assert.equal(shownRefusal(at({ id: 2, tone: 'error', message: { id: 'error.DIRECTOR_SETUP_BUSY' } }), old), 'DIRECTOR_SETUP_BUSY');
  assert.equal(shownRefusal(at({ id: 2, tone: 'error', message: { id: 'error.unknown', values: { code: 'NEW_CODE' } } }), null), 'NEW_CODE');
  assert.equal(shownRefusal(at(old), old), null, 'the same toast as before the press');
  // The earlier toast timed out and the refusal got its id again: still a new refusal.
  assert.equal(shownRefusal(at({ id: 1, tone: 'error', message: { id: 'error.PROVIDER_CATALOG_CHANGED' } }), old), 'PROVIDER_CATALOG_CHANGED');
  assert.equal(shownRefusal(at({ id: 3, tone: 'info', message: { id: 'start.rename.done' } }), old), null);
  assert.equal(shownRefusal(at(null), old), null);
});

test('a refusal is recognised after the previous toast timed out and ids started again at 1', async t => {
  const { store } = await studio(t);
  store.dispatch({ type: 'toast', message: { id: 'start.rename.done', values: { name: 'x' } }, tone: 'info' });
  assert.equal(store.getState().toast.id, 1);
  // The info toast times out while Create is on its way; the refusal toast is id 1 again.
  const slow = { ...store, getState: store.getState, dispatch: store.dispatch, read: store.read.bind(store),
    command: async (...args) => { store.dismissToast(); return store.command(...args); } };
  const stale = await runCreation(slow, { body: { name: 'Stale', expectedCatalogDigest: 'f'.repeat(64), profileIds: ['x'] }, steps: ['create'], plan: null, codex: UNKNOWN }, track());
  assert.equal(stale.code, 'PROVIDER_CATALOG_CHANGED');
  assert.equal(stale.message.id, 'start.new.models_changed');
});

test('a press the store did not send is said, never silent', async () => {
  let toast = null;
  const store = {
    getState: () => ({ toast }),
    dispatch(action) { if (action.type === 'toast') toast = { id: 1, message: action.message, tone: action.tone }; },
    read: async () => ({}),
    command: async () => undefined,
  };
  const result = await runCreation(store, { body: { name: 'X' }, steps: ['create'], plan: null, codex: UNKNOWN }, track());
  assert.deepEqual([result.film, result.code], [null, null]);
  assert.equal(en(result.message), 'The studio did not send it. Reload the page and try again.');
  const demo = await openDemo(store, 'Demo film', null);
  assert.deepEqual([demo.film, demo.code], [null, null]);
  assert.equal(toast.message.id, 'start.not_sent');
});

// With no film open the store keeps library-level presses (Create, the demo) in their own namespace.
// This runs them the way a real first run does: the studio opens with no film selected.
test('a real first run with no film open can create a film and open the demo', async t => {
  const port = new FixturePort();
  const store = new StudioStore({ client: port, storage: null, newKey: () => crypto.randomUUID() });
  t.after(() => { store.stop(); port.close(); });
  assert.equal(store.getState().projectId, null);
  const made = await runCreation(store, { body: { name: 'First' }, steps: ['create'], plan: null, codex: UNKNOWN }, track());
  assert.equal(made.failedAt, null);
  const demo = await openDemo(store, 'Demo film', null);
  assert.equal(demo.filled, true);
});

test('a demo whose fill did not finish is remembered while it is an empty film in the list; only a lost fill is pressed again', () => {
  assert.equal(parsePendingDemo(null), null);
  assert.equal(parsePendingDemo('{bad'), null);
  assert.equal(parsePendingDemo('{"id":""}'), null);
  const saved = parsePendingDemo('{"id":"film-1","name":"Demo film","off":true}');
  assert.deepEqual(saved, { id: 'film-1', name: 'Demo film', off: true });
  const item = (over) => ({ id: 'film-1', name: 'Demo film', archived: false, scenes: 0, shots: 0, seconds: 0, videosReady: 0, updatedAt: '', ...over });
  assert.deepEqual(livePendingDemo(saved, null), saved, 'trusted until the list is read');
  assert.deepEqual(livePendingDemo(saved, [item({})]), saved);
  assert.equal(livePendingDemo(saved, [item({ shots: 2 })]), null, 'filled since');
  assert.equal(livePendingDemo(saved, [item({ archived: true })]), null);
  assert.equal(livePendingDemo(saved, []), null);
  assert.equal(demoRetryable('NETWORK_ERROR'), true);
  assert.equal(demoRetryable(null), true);
  assert.equal(demoRetryable('ACTOR_DENIED'), false);
  assert.equal(demoRetryable('DEMO_REQUIRES_EMPTY_PROJECT'), false);
});

test('with no film open, Codex is read from any listed film, archived ones included', () => {
  assert.equal(codexSource('open', [{ id: 'a' }]), 'open');
  assert.equal(codexSource(null, [{ id: 'archived-1', archived: true }]), 'archived-1');
  assert.equal(codexSource(null, []), null);
  assert.equal(codexSource(null, null), null);
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


test('B17 browser follow-up: first-run demo completion remains visible after its destination film opens', async t => {
  const { store } = await studio(t, 'first-run');
  assert.equal(store.getState().projectId, null);
  const { film, filled } = await openDemo(store, 'Demo film', null);
  assert.equal(filled, true);
  await showDemoFilm(store, film);
  assert.equal(store.getState().projectId, film.id);
  assert.equal(store.getState().view, 'keyframes');
  assert.equal(en(store.getState().toast.message), 'Made Demo film. The stand-in Director is filling it in; nothing is charged.');
  assert.equal(store.getState().overview.scenes[0].counts.keyframesReady, 3);
});

test('B17 browser follow-up: opening a demo from another film keeps only its destination completion', async t => {
  const { store } = await studio(t);
  store.dispatch({ type: 'toast', message: { id: 'toast.saved' }, tone: 'info', undoCommandId: 'old-film-edit' });
  const { film } = await openDemo(store, 'Demo film', null);
  await showDemoFilm(store, film);
  assert.equal(toastId(store), 'start.demo.opened');
  assert.equal(store.getState().toast.undoCommandId, undefined);
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('B17 browser follow-up: a superseded demo open cannot move the new selection or publish its toast', async () => {
  const read = deferred(); const actions = [];
  let state = { projectId: null, projectEpoch: 0 };
  const store = {
    getState: () => state,
    selectProject(id) { state = { projectId: id, projectEpoch: state.projectEpoch + 1 }; return read.promise; },
    setView(view) { actions.push({ type: 'view', view }); },
    dispatch(action) { actions.push(action); },
  };
  const opening = showDemoFilm(store, { id: 'demo', name: 'Demo film' });
  state = { projectId: 'other-film', projectEpoch: 2 };
  const before = actions.length;
  read.resolve(); await opening;
  assert.deepEqual(actions.slice(before), [], 'late completion leaves another film and its view alone');
});


test('B17 browser follow-up: an old Start completion cannot take navigation from a newer film', async () => {
  const store = {
    getState: () => ({ projectId: 'other-film', projectEpoch: 3 }),
    selectProject() { assert.fail('superseded Start completion must not select its demo'); },
    setView() { assert.fail('superseded Start completion must not change the view'); },
    dispatch() { assert.fail('superseded Start completion must not replace the new toast'); },
  };
  await showDemoFilm(store, { id: 'demo', name: 'Demo film' }, { projectId: null, projectEpoch: 0 });
});

test('B17 browser follow-up: a reselected demo has its own epoch and cannot inherit an older completion', async () => {
  const read = deferred();const actions=[];let state = { projectId: null, projectEpoch: 0 };
  const store = {
    getState: () => state,
    selectProject(id) { state = { projectId: id, projectEpoch: 1 };return read.promise; },
    setView(view) { actions.push({ type:'view',view }); },
    dispatch(action) { actions.push(action); },
  };
  const opening = showDemoFilm(store, { id:'demo',name:'Demo film' });
  state = { projectId:'demo',projectEpoch:3 };
  const before=actions.length;read.resolve();await opening;
  assert.deepEqual(actions.slice(before),[]);
});
