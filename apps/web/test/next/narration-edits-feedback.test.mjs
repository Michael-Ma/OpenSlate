import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../src/next/api/client.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { runNarrationEdits } from '../../src/next/model/narration-edits.ts';
import { StudioStore } from '../../src/next/store/store.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function studio(t, intercept = () => undefined) {
  const port = new FixturePort();
  const posts = [], receipts = [], feedback = [];
  let serial = 0;
  const client = {
    get closed() { return port.closed; }, events: port.events.bind(port),
    async request(path, options) {
      if (options?.method === 'POST') posts.push({ path, ...options });
      const replacement = intercept(path, options, port);
      const receipt = await (replacement === undefined ? port.request(path, options) : replacement);
      if (options?.method === 'POST') receipts.push(receipt);
      return receipt;
    },
  };
  const store = new StudioStore({ client, storage: null, newKey: () => `narr-feedback-${++serial}` });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  let lastToast = null;
  const stop = store.subscribe(() => {
    const toast = store.getState().toast;
    if (toast && toast !== lastToast) feedback.push(toast);
    lastToast = toast;
  });
  t.after(stop);
  const shot = store.getState().overview.shots['shot-2-3'];
  store.setEdit({ shotId: shot.shotId, field: 'narration', value: shot.narration.text });
  store.setEdit({ ...store.getState().edit, value: 'The last ferry waits in the dawn fog.' });
  const draft = store.getState().edit;
  return { store, port, posts, receipts, feedback, draft };
}
const success = (feedback) => feedback.filter((toast) => toast.tone === 'info');
const steps = (draft) => [
  { edit: { kind: 'narration', id: draft.shotId, field: 'text', value: draft.value }, toast: { id: 'toast.saved' } },
  { edit: { kind: 'narration', id: draft.shotId, field: 'voice', value: 'cedar' }, toast: { id: 'narr.toast.voice_more', values: { shot: '2.3' } } },
];
const heldVoice = () => {
  const entered = deferred(), response = deferred();
  return { entered, response, intercept(path, options, port) {
    if (options?.method !== 'POST' || options.body?.field !== 'voice') return undefined;
    entered.resolve();
    return response.promise.then(() => port.request(path, options));
  } };
};

test('composite narration has no intermediate success toast while its final setting waits', async t => {
  const held = heldVoice();
  const { store, feedback, receipts, draft } = await studio(t, held.intercept);
  const changes = steps(draft);
  const saving = runNarrationEdits(store, draft, changes);
  await held.entered.promise;
  assert.deepEqual(success(feedback), [], 'the text is an internal pre-save, not a finished user action');
  held.response.resolve();
  assert.equal(await saving, true);
  const shown = success(feedback);
  assert.equal(feedback.length, 1, "the entire composite publishes one user-visible result");
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].message, changes.at(-1).toast);
  assert.equal(shown[0].undoCommandId, receipts.at(-1).commandId, 'Undo names the final completed setting');
  assert.notEqual(shown[0].undoCommandId, receipts[0].commandId);
});

test('a failed final narration setting never leaves a success toast for its partial text save', async t => {
  const { store, posts, feedback, draft } = await studio(t, (_path, options) =>
    options?.method === 'POST' && options.body?.field === 'voice' ? Promise.reject(new ApiError('REVISION_CONFLICT', 409)) : undefined);
  assert.equal(await runNarrationEdits(store, draft, steps(draft)), false);
  assert.deepEqual(success(feedback), []);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].tone, "error");
  assert.equal(posts.length, 2, 'no automatic retry after partial completion');
  assert.equal(store.getState().edit.value, draft.value, 'the retained editor can continue after the refusal');
});

test('newer typing during the final narration step prevents composite success feedback', async t => {
  const held = heldVoice();
  const { store, feedback, draft } = await studio(t, held.intercept);
  const saving = runNarrationEdits(store, draft, steps(draft));
  await held.entered.promise;
  store.setEdit({ ...store.getState().edit, value: 'Newer unsaved narration while voice was saving.' });
  held.response.resolve();
  assert.equal(await saving, false);
  assert.deepEqual(success(feedback), []);
  assert.equal(store.getState().edit.value, 'Newer unsaved narration while voice was saving.');
});

test('a superseded film selection cannot receive composite narration success feedback', async t => {
  const held = heldVoice();
  const { store, feedback, draft } = await studio(t, held.intercept);
  const saving = runNarrationEdits(store, draft, steps(draft));
  await held.entered.promise;
  store.dispatch({ type: 'project', projectId: 'another-film' });
  held.response.resolve();
  assert.equal(await saving, false);
  assert.deepEqual(success(feedback), []);
  assert.equal(store.getState().projectId, 'another-film');
});

test('a cancelled and reopened narration form cannot inherit an older composite success toast', async t => {
  const held = heldVoice();
  const { store, feedback, draft } = await studio(t, held.intercept);
  const saving = runNarrationEdits(store, draft, steps(draft));
  await held.entered.promise;
  store.setEdit(null);
  store.setEdit({ shotId: draft.shotId, field: 'narration', value: 'A new editor has its own text.' });
  held.response.resolve();
  assert.equal(await saving, false);
  assert.deepEqual(success(feedback), []);
  assert.equal(store.getState().edit.value, 'A new editor has its own text.');
});

test('a final text command publishes exactly its supplied success message and Undo', async t => {
  const { store, feedback, receipts, draft } = await studio(t);
  const final = { edit: { kind: 'narration', id: draft.shotId, field: 'text', value: draft.value }, toast: { id: 'narr.toast.line', values: { shot: '2.3' } } };
  assert.equal(await runNarrationEdits(store, draft, [final]), true);
  assert.equal(feedback.length, 1);
  assert.equal(success(feedback).length, 1);
  assert.deepEqual(success(feedback)[0].message, final.toast);
  assert.equal(success(feedback)[0].undoCommandId, receipts[0].commandId);
});


test('a refused text pre-save reports one overall error and never posts later narration settings', async t => {
  const { store, posts, feedback, draft } = await studio(t, (_path, options) =>
    options?.method === 'POST' && options.body?.field === 'text' ? Promise.reject(new ApiError('REVISION_CONFLICT', 409)) : undefined);
  assert.equal(await runNarrationEdits(store, draft, steps(draft)), false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.field, 'text');
  assert.equal(feedback.length, 1, '{toast:null} suppresses intermediate success while preserving the action refusal');
  assert.equal(feedback[0].tone, 'error');
  assert.equal(feedback[0].message.id, 'error.REVISION_CONFLICT');
  assert.equal(store.getState().edit.value, draft.value);
  assert.equal(store.getState().edit.saving, false);
});
