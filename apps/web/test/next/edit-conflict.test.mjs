import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../src/next/api/client.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { displayedHead } from '../../src/next/model/displayed-baseline.ts';
import { StudioStore } from '../../src/next/store/store.ts';

async function studio(t, intercept = () => undefined) {
  const port = new FixturePort(), posts = [];
  let key = 0;
  const client = { get closed() { return port.closed; }, events: port.events.bind(port), request(path, options) {
    if (options?.method === 'POST') posts.push({ path, ...options });
    return intercept(path, options, port) ?? port.request(path, options);
  } };
  const store = new StudioStore({ client, storage: null, newKey: () => `b18-${++key}` });
  await store.start();
  t.after(() => { store.stop(); port.close(); });
  return { store, port, posts };
}
function edit(store, field = 'imagePrompt') {
  const shot = store.getState().overview.shots['shot-2-3'];
  const value = field === 'narration' ? shot.narration.text : field === 'desiredFrames' ? String(shot.durationFrames) : shot[field];
  store.setEdit({ shotId: shot.shotId, field, value });
  store.setEdit({ ...store.getState().edit, value: field === 'motion' ? 'Push in' : 'My unsaved words' });
  return store.getState().edit;
}
function advance(port, change = () => {}) {
  const snapshot = structuredClone(port.world.snapshot), overview = structuredClone(port.world.overview);
  const head = snapshot.project.headVersion + 1;
  snapshot.project.headVersion = overview.headVersion = head;
  snapshot.project.revisionId = overview.revisionId = `b18-rev-${head}`;
  snapshot.cursor++; overview.cursor++;
  change(snapshot, overview);
  port.world.snapshot = snapshot; port.world.overview = overview;
  return { snapshot, overview };
}
const install = (store, { snapshot, overview }) => { store.dispatch({ type: 'snapshot', snapshot }); store.dispatch({ type: 'overview', overview }); };
const compare = async store => {
  const { editConflict } = await import('../../src/next/model/edit-conflict.ts');
  const state = store.getState();
  return editConflict(state.edit, state.overview, displayedHead(state.projectId, state.snapshot, state.overview));
};

test('B18 unrelated keyframe completion rebases prompt Save to the current displayed head', async t => {
  const { store, port, posts } = await studio(t); edit(store);
  install(store, advance(port, (_snapshot, overview) => { overview.shots['shot-2-1'].keyframe.takeCount++; }));
  assert.ok(await store.saveEdit(store.getState().edit));
  assert.equal(posts.length, 1); assert.equal(posts[0].body.expectedHeadVersion, 13);
  assert.equal(store.getState().edit, null); assert.equal(store.getState().toast.message.id, 'toast.saved');
});

test('B18 changed prompt shows saved text and requires an explicit choice before Save', async t => {
  const { store, port, posts } = await studio(t); edit(store);
  install(store, advance(port, (snapshot, overview) => {
    snapshot.project.shots.find(s => s.id === 'shot-2-3').imagePrompt = 'Saved by someone else';
    overview.shots['shot-2-3'].imagePrompt = 'Saved by someone else';
  }));
  assert.equal(await store.saveEdit(store.getState().edit), null); assert.equal(posts.length, 0);
  const conflict = await compare(store);
  assert.equal(conflict.kind, 'changed'); assert.equal(conflict.saved.value, 'Saved by someone else');
  store.resolveEditConflict(true); assert.equal(posts.length, 0); assert.equal(store.getState().edit.value, 'My unsaved words');
  assert.equal((await compare(store)).kind, 'none');
  assert.ok(await store.saveEdit(store.getState().edit)); assert.equal(posts[0].body.expectedHeadVersion, 13);
});

test('B18 motion form compares motion and duration, ignoring narration and other shot fields', async t => {
  const { store, port, posts } = await studio(t); edit(store, 'motion');
  install(store, advance(port, (_snapshot, overview) => { overview.shots['shot-2-3'].narration.text = 'A new line elsewhere'; }));
  assert.ok(await store.saveEdit(store.getState().edit, 8)); assert.equal(posts[0].body.expectedHeadVersion, 13);
});

test('B18 changed duration conflicts with an open motion form', async t => {
  const { store, port, posts } = await studio(t); edit(store, 'motion');
  install(store, advance(port, (snapshot, overview) => {
    snapshot.project.shots.find(s => s.id === 'shot-2-3').desiredFrames += 30;
    overview.shots['shot-2-3'].durationFrames += 30;
  }));
  assert.equal(await store.saveEdit(store.getState().edit, 8), null); assert.equal(posts.length, 0);
  assert.equal((await compare(store)).kind, 'changed');
});

test('B18 mismatched projections wait quietly and Save works once they agree', async t => {
  const { store, port, posts } = await studio(t); edit(store);
  const next = advance(port); store.dispatch({ type: 'snapshot', snapshot: next.snapshot });
  assert.equal(await store.saveEdit(store.getState().edit), null); assert.equal(posts.length, 0);
  assert.equal(store.getState().toast, null); assert.equal((await compare(store)).kind, 'waiting');
  store.resolveEditConflict(true); assert.equal(store.getState().toast, null, 'waiting is not a conflict decision');
  store.dispatch({ type: 'overview', overview: next.overview });
  assert.equal((await compare(store)).kind, 'none');
  assert.ok(await store.saveEdit(store.getState().edit)); assert.equal(posts[0].body.expectedHeadVersion, 13);
});

test('B18 stale server refusal retains text, refreshes, and the next human press rebases without a conflict', async t => {
  let refuse = true;
  const { store, port, posts } = await studio(t, (path, options, port) => {
    if (options?.method === 'POST' && path.endsWith('/storyboard') && refuse) {
      refuse = false; advance(port); return Promise.reject(new ApiError('REVISION_CONFLICT', 409));
    }
  });
  edit(store); assert.equal(await store.saveEdit(store.getState().edit), null); await store.refresh();
  assert.equal(posts.length, 1, 'no automatic write retry'); assert.equal(store.getState().edit.value, 'My unsaved words');
  assert.equal((await compare(store)).kind, 'none');
  assert.ok(await store.saveEdit(store.getState().edit)); assert.equal(posts.length, 2);
  assert.equal(posts[1].body.expectedHeadVersion, 13); assert.notEqual(posts[1].key, posts[0].key);
});

test('B18 narration compares only its original text as the head advances', async t => {
  const { store, port } = await studio(t); edit(store, 'narration');
  install(store, advance(port, (_snapshot, overview) => { overview.shots['shot-2-3'].durationFrames += 30; }));
  assert.equal((await compare(store)).kind, 'none');
  install(store, advance(port, (_snapshot, overview) => { overview.shots['shot-2-3'].narration.text = 'New saved narration'; }));
  const result = await compare(store); assert.equal(result.kind, 'changed'); assert.equal(result.saved.value, 'New saved narration');
});

test('B18 an unknown Save outcome replays the exact request across an unrelated head advance', async t => {
  const { store, port, posts } = await studio(t, (path, options) => options?.method === 'POST' && path.endsWith('/storyboard') ? Promise.reject(new TypeError('lost')) : undefined);
  edit(store); await store.saveEdit(store.getState().edit);
  install(store, advance(port)); await store.saveEdit(store.getState().edit);
  assert.equal(posts.length, 2); assert.equal(posts[1].key, posts[0].key); assert.deepEqual(posts[1].body, posts[0].body);
});

test('B18 multi-field narration saves text through the same comparison before voice changes', async t => {
  const { runNarrationEdits } = await import('../../src/next/model/narration-edits.ts');
  const { store, port, posts } = await studio(t); edit(store, 'narration');
  install(store, advance(port)); const draft = store.getState().edit;
  assert.ok(await runNarrationEdits(store, draft, [
    { edit: { kind: 'narration', id: draft.shotId, field: 'text', value: draft.value }, toast: { id: 'toast.saved' } },
    { edit: { kind: 'narration', id: draft.shotId, field: 'voice', value: 'cedar' }, toast: { id: 'toast.saved' } },
  ]));
  assert.equal(posts.length, 2); assert.equal(posts[0].body.expectedHeadVersion, 13); assert.equal(posts[1].body.expectedHeadVersion, 14);
  assert.equal(store.getState().edit.baselineValue, draft.value);
});

test('B18 narration with another setting cannot bypass a changed text baseline', async t => {
  const { runNarrationEdits } = await import('../../src/next/model/narration-edits.ts');
  const { store, port, posts } = await studio(t); edit(store, 'narration');
  install(store, advance(port, (_snapshot, overview) => { overview.shots['shot-2-3'].narration.text = 'New saved line'; }));
  const draft = store.getState().edit;
  assert.equal(await runNarrationEdits(store, draft, [
    { edit: { kind: 'narration', id: draft.shotId, field: 'text', value: draft.value }, toast: { id: 'toast.saved' } },
    { edit: { kind: 'narration', id: draft.shotId, field: 'voice', value: 'cedar' }, toast: { id: 'toast.saved' } },
  ]), null);
  assert.equal(posts.length, 0); assert.equal(store.getState().edit.value, draft.value);
});

test('B18 a stale refusal that reveals a changed prompt requires review on the next press', async t => {
  let refuse = true;
  const { store, posts } = await studio(t, (path, options, port) => {
    if (options?.method === 'POST' && path.endsWith('/storyboard') && refuse) {
      refuse = false;
      advance(port, (snapshot, overview) => { snapshot.project.shots.find(s => s.id === 'shot-2-3').imagePrompt = overview.shots['shot-2-3'].imagePrompt = 'New saved prompt'; });
      return Promise.reject(new ApiError('REVISION_CONFLICT', 409));
    }
  });
  edit(store); await store.saveEdit(store.getState().edit); await store.refresh();
  assert.equal((await compare(store)).kind, 'changed');
  assert.equal(await store.saveEdit(store.getState().edit), null); assert.equal(posts.length, 1);
  store.resolveEditConflict(true); assert.ok(await store.saveEdit(store.getState().edit)); assert.equal(posts.length, 2);
});

test('B18 newer typing rebases against its own completed save and remains saveable', async t => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { store, posts } = await studio(t, (path, options, port) => options?.method === 'POST' && path.endsWith('/storyboard') && options.body.value === 'Submitted'
    ? waiting.then(() => port.request(path, options)) : undefined);
  edit(store); store.setEdit({ ...store.getState().edit, value: 'Submitted' });
  const saving = store.saveEdit(store.getState().edit);
  store.setEdit({ ...store.getState().edit, value: 'Newer words' });
  release(); await saving; await store.refresh();
  assert.equal(store.getState().edit.value, 'Newer words'); assert.equal((await compare(store)).kind, 'none');
  assert.ok(await store.saveEdit(store.getState().edit)); assert.equal(posts.length, 2); assert.equal(posts[1].body.expectedHeadVersion, 13);
});

test('B18 new typing during a composite narration save stops its old continuation without closing the draft', async t => {
  const { runNarrationEdits } = await import('../../src/next/model/narration-edits.ts');
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const { store, posts } = await studio(t, (path, options, port) => options?.method === 'POST' && path.endsWith('/storyboard')
    ? waiting.then(() => port.request(path, options)) : undefined);
  edit(store, 'narration'); const draft = store.getState().edit;
  const saving = runNarrationEdits(store, draft, [
    { edit: { kind: 'narration', id: draft.shotId, field: 'text', value: draft.value }, toast: { id: 'toast.saved' } },
    { edit: { kind: 'narration', id: draft.shotId, field: 'voice', value: 'cedar' }, toast: { id: 'toast.saved' } },
  ]);
  store.setEdit({ ...store.getState().edit, value: 'New typing while saving' }); release();
  assert.equal(await saving, null); assert.equal(posts.length, 1);
  assert.equal(store.getState().edit.value, 'New typing while saving');
});

test('B18 an applied Save with a lost reply remains explicitly reconcilable with the same key/body', async t => {
  let drop = true, remembered;
  const { store, posts } = await studio(t, (path, options, port) => {
    if (options?.method !== 'POST' || !path.endsWith('/storyboard')) return;
    if (drop) { drop = false; return port.request(path, options).then(receipt => { remembered = receipt; throw new TypeError('reply lost'); }); }
    return Promise.resolve(remembered);
  });
  edit(store); await store.saveEdit(store.getState().edit); await store.refresh();
  assert.equal((await compare(store)).kind, 'changed');
  assert.equal(store.canReconcileEdit(store.getState().edit), true);
  assert.ok(await store.reconcileEdit()); assert.equal(posts.length, 2);
  assert.equal(posts[1].key, posts[0].key); assert.deepEqual(posts[1].body, posts[0].body); assert.equal(store.getState().edit, null);
});

test('B18 checking an older Save outcome preserves newer unsaved typing', async t => {
  let drop = true, remembered;
  const { store, posts } = await studio(t, (path, options, port) => {
    if (options?.method !== 'POST' || !path.endsWith('/storyboard')) return;
    if (drop) { drop = false; return port.request(path, options).then(receipt => { remembered = receipt; throw new TypeError('reply lost'); }); }
    return Promise.resolve(remembered);
  });
  edit(store); await store.saveEdit(store.getState().edit); await store.refresh();
  store.setEdit({ ...store.getState().edit, value: 'Still unsaved newer words' });
  assert.ok(await store.reconcileEdit()); assert.equal(posts.length, 2); assert.equal(posts[1].body.value, 'My unsaved words');
  assert.equal(store.getState().edit.value, 'Still unsaved newer words'); assert.equal((await compare(store)).kind, 'none');
});

test('B18 reconciling a completed save preserves a later saved field change for explicit review', async t => {
  let drop = true, remembered;
  const { store, port, posts } = await studio(t, (path, options, port) => {
    if (options?.method !== 'POST' || !path.endsWith('/storyboard')) return;
    if (drop) { drop = false; return port.request(path, options).then(receipt => { remembered = receipt; throw new TypeError('reply lost'); }); }
    return Promise.resolve(remembered);
  });
  edit(store); await store.saveEdit(store.getState().edit); await store.refresh();
  install(store, advance(port, (snapshot, overview) => { snapshot.project.shots.find(s => s.id === 'shot-2-3').imagePrompt = overview.shots['shot-2-3'].imagePrompt = 'Later saved words'; }));
  await store.reconcileEdit();
  assert.equal(posts.length, 2); assert.equal(store.getState().edit.value, 'My unsaved words');
  const conflict = await compare(store); assert.equal(conflict.kind, 'changed'); assert.equal(conflict.saved.value, 'Later saved words');
  assert.equal(store.canReconcileEdit(store.getState().edit), false);
});

test('B18 a newer draft cannot replace an unanswered request before its explicit reconciliation', async t => {
  const { store, posts } = await studio(t, (path, options) => options?.method === 'POST' && path.endsWith('/storyboard') ? Promise.reject(new TypeError('lost')) : undefined);
  edit(store); await store.saveEdit(store.getState().edit);
  store.setEdit({ ...store.getState().edit, value: 'Newer still unsaved words' });
  assert.equal(await store.saveEdit(store.getState().edit), null); assert.equal(posts.length, 1);
  assert.equal(store.canReconcileEdit(store.getState().edit), true);
});

test('B18 reconciliation retains a narration pre-save editor for a later human continuation', async t => {
  let drop = true, remembered;
  const { store, posts } = await studio(t, (path, options, port) => {
    if (options?.method !== 'POST' || !path.endsWith('/storyboard')) return;
    if (drop) { drop = false; return port.request(path, options).then(receipt => { remembered = receipt; throw new TypeError('reply lost'); }); }
    return Promise.resolve(remembered);
  });
  edit(store, 'narration'); await store.saveEdit(store.getState().edit, undefined, true); await store.refresh();
  await store.reconcileEdit();
  assert.equal(posts.length, 2); assert.equal(posts[1].key, posts[0].key);
  assert.equal(store.getState().edit?.value, 'My unsaved words'); assert.equal((await compare(store)).kind, 'none');
});
