import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { ApiError } from '../../src/next/api/client.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { editConflict } from '../../src/next/model/edit-conflict.ts';
import { displayedHead } from '../../src/next/model/displayed-baseline.ts';

async function studio(t, intercept = () => undefined) {
  const port = new FixturePort(), errors = [], posts = [];
  const client = { get closed() { return port.closed; }, events: port.events.bind(port), request(path, options) {
    if (options?.method === 'POST') posts.push({ path, ...options });
    return intercept(path, options, port) ?? port.request(path, options);
  } };
  const store = new StudioStore({ client, storage: null, newKey: () => crypto.randomUUID(), onError: error => errors.push(error) });
  await store.start(); t.after(() => { store.stop(); port.close(); });
  const shot = store.getState().overview.shots['shot-2-3'];
  store.setEdit({ shotId: shot.shotId, field: 'narration', value: shot.narration.text });
  return { store, port, errors, posts, original: shot.narration.text };
}
const comparison = store => { const state = store.getState(); return editConflict(state.edit, state.overview, displayedHead(state.projectId, state.snapshot, state.overview)); };

test('B21 refused recording subtitle pre-save returns its server reason without a toast, upload, or retry', async t => {
  const { saveRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store, errors, posts } = await studio(t, (_path, options) => options?.method === 'POST'
    ? Promise.reject(new ApiError('VALIDATION_ERROR', 400)) : undefined);
  const before = store.getState().toast, refusals = [];
  let uploaded = false;
  const words = 'x'.repeat(16001);
  const saved = await saveRecordingWords(store, store.getState().edit, words, refusal => refusals.push(refusal));
  if (saved) uploaded = true;
  assert.equal(saved, null);
  assert.deepEqual(refusals, [{ id: 'error.VALIDATION_ERROR' }], 'the recording panel needs the actual subtitle refusal');
  assert.equal(uploaded, false);
  assert.equal(posts.length, 1, 'one explicit attempt, no automatic retry');
  assert.equal(store.getState().toast, before, 'the recording panel owns refusal feedback');
  assert.equal(store.getState().edit.saving, false);
  assert.equal(errors[0].code, 'VALIDATION_ERROR');
  assert.equal(await saveRecordingWords(store, store.getState().edit, words, refusal => refusals.push(refusal)), null);
  assert.equal(posts.length, 2, 'only the next human press retries a definite refusal');
  assert.notEqual(posts[1].key, posts[0].key);
  assert.deepEqual(refusals, [{ id: 'error.VALIDATION_ERROR' }, { id: 'error.VALIDATION_ERROR' }]);
  assert.equal(store.getState().toast, before);
});

test('B21 recording subtitle refusal is ignored after its editor owner is superseded', async t => {
  const { saveRecordingWords } = await import('../../src/next/model/recording-words.ts');
  let refuse, entered;
  const began = new Promise(resolve => { entered = resolve; });
  const rejected = new Promise((_resolve, reject) => { refuse = reject; });
  const { store } = await studio(t, (_path, options) => options?.method === 'POST' ? (entered(), rejected) : undefined);
  const refusals = [];
  const saving = saveRecordingWords(store, store.getState().edit, 'New subtitle', refusal => refusals.push(refusal));
  await began;
  store.setEdit(null);
  store.setEdit({ shotId: 'shot-2-3', field: 'narration', value: 'New owner' });
  refuse(new ApiError('VALIDATION_ERROR', 400));
  assert.equal(await saving, null);
  assert.deepEqual(refusals, []);
  assert.equal(store.getState().edit.value, 'New owner');
});

test('B21 a recording subtitle baseline refusal reaches its panel without sending a request', async t => {
  const { saveRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store, posts } = await studio(t);
  await store.edit({ kind: 'narration', id: 'shot-2-3', field: 'text', value: 'A different saved line' });
  await store.refresh();
  const before = store.getState().toast, count = posts.length, refusals = [];
  assert.equal(await saveRecordingWords(store, store.getState().edit, 'My recording subtitle', refusal => refusals.push(refusal)), null);
  assert.deepEqual(refusals, [{ id: 'error.EDIT_BASELINE_CHANGED' }]);
  assert.equal(posts.length, count);
  assert.equal(store.getState().toast, before);
});

test('B21 recording subtitle preparation reports no refusal on success and never retains its feedback callback', async t => {
  const { saveRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store, posts } = await studio(t);
  const refusals = [], before = store.getState().toast;
  assert.ok(await saveRecordingWords(store, store.getState().edit, 'A successful subtitle', refusal => refusals.push(refusal)));
  assert.deepEqual(refusals, []);
  assert.equal(store.getState().toast, before);
  assert.deepEqual(store.getState().edit.saveFeedback, { message: { id: 'toast.saved' }, quiet: true });
  assert.deepEqual(Object.keys(posts[0].body).sort(), ['expectedHeadVersion', 'field', 'id', 'kind', 'value']);
});

test('B18 recording subtitle Save updates its own retained narration baseline without a self-conflict', async t => {
  const { saveRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store } = await studio(t);
  const draft = store.getState().edit;
  const saved = await saveRecordingWords(store, draft, 'New recording subtitle');
  assert.ok(saved?.commandId);
  await store.refresh();
  assert.equal(store.getState().edit.revision, draft.revision);
  assert.equal(store.getState().edit.value, 'New recording subtitle');
  assert.equal(store.getState().edit.baselineValue, 'New recording subtitle');
  assert.equal(comparison(store).kind, 'none', 'own subtitle save does not block the following recording upload');
});

test('B18 an exact recording-subtitle Undo restores its baseline and keeps local words for another human retry', async t => {
  const { saveRecordingWords, rollbackRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store, original } = await studio(t);
  const saved = await saveRecordingWords(store, store.getState().edit, 'New recording subtitle');
  await store.refresh();
  assert.equal(await rollbackRecordingWords(store, saved), true);
  const state = store.getState();
  assert.equal(state.overview.shots['shot-2-3'].narration.text, original);
  assert.equal(state.edit.value, 'New recording subtitle', 'the person can retry with their own words');
  assert.equal(state.edit.baselineValue, original);
  assert.equal(comparison(store).kind, 'none');
});

test('B18 recording rollback cannot undo after a newer draft revision or A to B to A', async t => {
  const { saveRecordingWords, rollbackRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store } = await studio(t);
  const saved = await saveRecordingWords(store, store.getState().edit, 'New recording subtitle');
  await store.refresh();
  store.setEdit({ ...store.getState().edit, value: 'Newer typing' });
  const current = store.getState().edit;
  assert.equal(await rollbackRecordingWords(store, saved), false);
  assert.equal(store.getState().edit, current);
  store.dispatch({ type: 'project', projectId: 'film-b' });
  store.dispatch({ type: 'project', projectId: 'last-ferry' });
  assert.equal(await rollbackRecordingWords(store, saved), false);
});

test('B18 recording rollback preserves a newer saved line rather than borrowing its head', async t => {
  const { saveRecordingWords, rollbackRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store, port } = await studio(t);
  const saved = await saveRecordingWords(store, store.getState().edit, 'New recording subtitle');
  await store.refresh();
  await store.edit({ kind: 'narration', id: 'shot-2-3', field: 'text', value: 'Another saved line' });
  await store.refresh();
  assert.equal(await rollbackRecordingWords(store, saved), false);
  assert.equal(store.getState().overview.shots['shot-2-3'].narration.text, 'Another saved line');
  assert.equal(store.getState().edit.value, 'New recording subtitle');
});

test('B18 feedback: recording subtitle pre-save and rollback dispatch no toast or independent Undo', async t => {
  const { saveRecordingWords, rollbackRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store, original } = await studio(t);
  store.dispatch({ type: 'toast', message: { id: 'toast.saved' }, tone: 'info', undoCommandId: 'unrelated-command' });
  const before = store.getState().toast, feedback = [], dispatch = store.dispatch;
  store.dispatch = action => { if (action.type === 'toast' || action.type === 'toastDismiss') feedback.push(action); dispatch(action); };
  const saved = await saveRecordingWords(store, store.getState().edit, 'Quiet recording subtitle');
  assert.ok(saved?.commandId); await store.refresh();
  assert.deepEqual(feedback, [], 'internal subtitle save must not publish Saved or its own Undo');
  assert.equal(store.getState().toast, before);
  assert.equal(await rollbackRecordingWords(store, saved), true);
  assert.deepEqual(feedback, [], 'internal rollback must not publish or dismiss any toast');
  assert.equal(store.getState().toast, before);
  assert.equal(store.getState().edit.baselineValue, original);
  assert.equal(comparison(store).kind, 'none');
});


test('B18 feedback: refused internal rollback stays silent without hiding its error from observation', async t => {
  const { saveRecordingWords, rollbackRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store, errors, posts } = await studio(t, (_path, options) => options?.method === 'POST' && options.body?.kind === 'undo'
    ? Promise.reject(new ApiError('UNDO_UNAVAILABLE', 409)) : undefined);
  store.dispatch({ type: 'toast', message: { id: 'toast.saved' }, tone: 'info', undoCommandId: 'unrelated-command' });
  const before = store.getState().toast, feedback = [], dispatch = store.dispatch;
  store.dispatch = action => { if (action.type === 'toast' || action.type === 'toastDismiss') feedback.push(action); dispatch(action); };
  const saved = await saveRecordingWords(store, store.getState().edit, 'New recording subtitle');
  assert.equal(await rollbackRecordingWords(store, saved), false);
  assert.deepEqual(feedback, []); assert.equal(store.getState().toast, before);
  assert.equal(errors.length, 1); assert.equal(errors[0].code, 'UNDO_UNAVAILABLE');
  assert.equal(posts.length, 2, 'a failed rollback has no automatic retry');
});

test('B18 feedback: a silent subtitle pre-save remains silent during exact reconciliation and normal Save still toasts', async t => {
  const { saveRecordingWords } = await import('../../src/next/model/recording-words.ts');
  let lost = false, remembered;
  const { store, posts } = await studio(t, (path, options, port) => {
    if (options?.method !== 'POST' || options.body?.kind !== 'narration' || options.body?.field !== 'text') return;
    if (!lost) {
      lost = true;
      return port.request(path, options).then(receipt => { remembered = receipt; throw new TypeError('lost reply'); });
    }
    if (options.body.value === 'Quiet subtitle words') return Promise.resolve(remembered);
  });
  store.dispatch({ type: 'toast', message: { id: 'toast.saved' }, tone: 'info', undoCommandId: 'unrelated-command' });
  const before = store.getState().toast, feedback = [], dispatch = store.dispatch;
  store.dispatch = action => { if (action.type === 'toast' || action.type === 'toastDismiss') feedback.push(action); dispatch(action); };
  assert.equal(await saveRecordingWords(store, store.getState().edit, 'Quiet subtitle words'), null);
  await store.refresh();
  await store.edit({ kind: 'shot', id: 'shot-2-1', field: 'motion', value: 'An unrelated motion change' });
  await store.refresh();
  assert.ok(await store.reconcileEdit());
  const textPosts = posts.filter(p => p.body.kind === 'narration');
  assert.equal(textPosts.length, 2); assert.equal(textPosts[1].key, textPosts[0].key); assert.deepEqual(textPosts[1].body, textPosts[0].body);
  assert.deepEqual(feedback, []); assert.equal(store.getState().toast, before);
  assert.ok(store.getState().edit); assert.equal(comparison(store).kind, 'none');
  store.setEdit({ ...store.getState().edit, value: 'A later ordinary human edit' });
  assert.ok(await store.saveEdit(store.getState().edit));
  assert.equal(feedback.length, 1); assert.equal(feedback[0].message.id, 'toast.saved'); assert.ok(feedback[0].undoCommandId);
});

test('B18 feedback: reopening an editor cannot change a pending subtitle request into a visible Saved action', async t => {
  const { saveRecordingWords } = await import('../../src/next/model/recording-words.ts');
  let remembered;
  const { store, posts } = await studio(t, (path, options, port) => {
    if (options?.method !== 'POST' || options.body?.kind !== 'narration' || options.body?.field !== 'text') return;
    if (remembered) return Promise.resolve(remembered);
    return port.request(path, options).then(receipt => { remembered = receipt; throw new TypeError('lost reply'); });
  });
  store.dispatch({ type: 'toast', message: { id: 'toast.saved' }, tone: 'info', undoCommandId: 'unrelated-command' });
  const before = store.getState().toast, feedback = [], dispatch = store.dispatch;
  store.dispatch = action => { if (action.type === 'toast' || action.type === 'toastDismiss') feedback.push(action); dispatch(action); };
  await saveRecordingWords(store, store.getState().edit, 'Quiet subtitle words'); await store.refresh();
  store.setEdit(null);
  store.setEdit({ shotId: 'shot-2-3', field: 'narration', value: store.getState().overview.shots['shot-2-3'].narration.text });
  assert.equal(store.getState().edit.saveFeedback, undefined, 'the reopened draft has fresh UI state');
  assert.ok(await store.reconcileEdit());
  assert.deepEqual(feedback, []); assert.equal(store.getState().toast, before); assert.ok(store.getState().edit);
  assert.equal(posts.length, 2); assert.equal(posts[1].key, posts[0].key); assert.deepEqual(posts[1].body, posts[0].body);
});
