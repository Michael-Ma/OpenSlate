import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectorSettingsReadGate } from '../src/director-settings-read.ts';
import { directorChangeCommand, restoredDirectorDraft } from '../src/project-settings-model.ts';
import { pendingCommandsFor } from '../src/pending-command.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
function status(model, { busy = false, changeAvailable = true } = {}) {
  return { selection: { mode: 'native', binaryPath: '/fixture/codex', model }, defaults: { binaryPath: '/fixture/codex', model },
    locked: false, modelCalls: 0, selectionDigest: (model === 'old-model' ? 'a' : 'b').repeat(64), busy, changeAvailable,
    changeAppliesTo: 'next_turn', modelChoices: [{ id: model, label: model }], modelCatalogStatus: 'ready', modelCatalogCheckedAt: null };
}
function readHarness({ draft = null, dirty = false } = {}) {
  const gate = new DirectorSettingsReadGate();
  const state = { status: null, draft, dirty, checking: false, modelChecking: false, errors: [], calls: [] };
  function read(source, response, signal = new AbortController().signal) {
    return gate.run(() => response.promise, signal, {
      start: () => { state.checking = source === 'setup'; state.modelChecking = source === 'models'; state.calls.push(`${source}:start`); },
      success: value => { state.status = value; if (!state.dirty) state.draft = value.selection; state.calls.push(`${source}:success`); },
      failure: error => { state.errors.push(error); state.calls.push(`${source}:failure`); },
      finish: () => { state.checking = false; state.modelChecking = false; state.calls.push(`${source}:finish`); },
    });
  }
  return { state, read };
}

test('an older model-list response cannot replace newer setup selection or re-enable a busy director', async () => {
  const { state, read } = readHarness(), models = deferred(), setup = deferred();
  const oldRead = read('models', models), newerRead = read('setup', setup);
  setup.resolve(status('new-model', { busy: true, changeAvailable: false }));
  assert.equal(await newerRead, true);
  models.resolve(status('old-model'));
  assert.equal(await oldRead, false);
  assert.equal(state.status.selection.model, 'new-model');
  assert.equal(state.status.busy, true); assert.equal(state.status.changeAvailable, false);
  assert.equal(state.draft.model, 'new-model');
  assert.throws(() => directorChangeCommand('project', state.status, state.draft, 'save-once'), /Wait/);
  assert.deepEqual(state.calls, ['models:start', 'setup:start', 'setup:success', 'setup:finish']);
  assert.equal(state.checking, false); assert.equal(state.modelChecking, false);
});

test('superseded rejection and finalizer cannot publish an error or clear the newer loading state', async () => {
  const { state, read } = readHarness(), setup = deferred(), models = deferred();
  const oldRead = read('setup', setup), newerRead = read('models', models);
  setup.reject(new Error('older setup failed'));
  assert.equal(await oldRead, false);
  assert.deepEqual(state.errors, []);
  assert.equal(state.checking, false); assert.equal(state.modelChecking, true);
  models.resolve(status('new-model'));
  assert.equal(await newerRead, true);
  assert.equal(state.status.selection.model, 'new-model');
  assert.equal(state.modelChecking, false);
  assert.deepEqual(state.calls, ['setup:start', 'models:start', 'models:success', 'models:finish']);
});

test('a superseded successful read cannot finalize newer setup, and abort fences the current result', async () => {
  const { state, read } = readHarness(), models = deferred(), setup = deferred(), controller = new AbortController();
  const oldRead = read('models', models), newerRead = read('setup', setup, controller.signal);
  models.resolve(status('old-model'));
  assert.equal(await oldRead, false);
  assert.equal(state.checking, true); assert.equal(state.modelChecking, false);
  controller.abort(); setup.resolve(status('new-model'));
  assert.equal(await newerRead, false);
  assert.equal(state.status, null);
  assert.deepEqual(state.calls, ['models:start', 'setup:start']);
});

test('ordered status reads preserve the dirty draft and exact unresolved director-save identity', async () => {
  const api = {}, registry = pendingCommandsFor(api, 'project-director-settings'), initial = status('old-model');
  const draft = { ...initial.selection, model: 'human-selected-model' };
  await registry.run('project', directorChangeCommand('project', initial, draft, 'director-save-once'), async () => { throw Error('save reply lost'); }, () => true);
  const held = registry.snapshot('project').command;
  const { state, read } = readHarness({ draft: restoredDirectorDraft(registry.snapshot('project')), dirty: true });
  const models = deferred(), setup = deferred();
  const oldRead = read('models', models), newerRead = read('setup', setup);
  setup.resolve(status('new-model', { busy: true })); await newerRead;
  models.resolve(status('old-model')); await oldRead;
  assert.equal(state.status.selection.model, 'new-model');
  assert.deepEqual(state.draft, draft);
  assert.equal(registry.snapshot('project').command, held);
  assert.equal(held.key, 'director-save-once');
  assert.deepEqual(held.body.selection, draft);
});
