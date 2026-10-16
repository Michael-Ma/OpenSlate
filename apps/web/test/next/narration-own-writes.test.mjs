import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { displayedHead } from '../../src/next/model/displayed-baseline.ts';
import { editConflict } from '../../src/next/model/edit-conflict.ts';
import { runNarrationEdits } from '../../src/next/model/narration-edits.ts';
import * as recording from '../../src/next/model/narration-recording.ts';
import { StudioStore } from '../../src/next/store/store.ts';

async function studio(t, shotId = 'shot-2-2') {
  const port = new FixturePort();
  const store = new StudioStore({ client: port, storage: null, newKey: () => crypto.randomUUID() });
  await store.start();
  t.after(() => { store.stop(); port.close(); });
  const shot = store.getState().overview.shots[shotId];
  store.setEdit({ shotId, field: 'narration', value: shot.narration.text });
  return { store, port, draft: store.getState().edit, epoch: store.getState().projectEpoch };
}
const comparison = store => {
  const state = store.getState();
  return editConflict(state.edit, state.overview, displayedHead(state.projectId, state.snapshot, state.overview));
};
async function add(store, seconds = 3) {
  const { snapshot, edit } = store.getState();
  const owner = recording.beginRecordingWrite(store, edit);
  assert.ok(owner);
  const receipt = await store.command(`recording-test:${edit.shotId}`, { shotId: edit.shotId }, () => ({
    path: recording.recordingPath(edit.shotId, snapshot.project.headVersion),
    body: { name: 'my-recording.wav', type: 'audio/wav', size: 1000, durationSeconds: seconds, key: crypto.randomUUID() },
  }));
  return { owner, receipt };
}
const acknowledge = (store, owner, receipt) => recording.acknowledgeRecording(store, owner, receipt);

test('B20 a recording without words rebases its retained draft to its own saved stand-in', async t => {
  const { store, draft } = await studio(t);
  const { owner, receipt } = await add(store);
  await store.refresh();
  assert.equal(comparison(store).kind, 'changed', 'reproduces the upload bypassing the ordinary Save baseline');
  assert.equal(acknowledge(store, owner, receipt), true);
  assert.equal(store.getState().edit.baselineValue, 'Uploaded narration recording');
  assert.equal(store.getState().edit.value, draft.value, 'the local line stays as the person left it');
  assert.equal(store.getState().edit.expectedHeadVersion, receipt.headVersion);
  assert.equal(store.getState().edit.revision, draft.revision);
  assert.equal(comparison(store).kind, 'none');
});

test('B20 a recording with newly saved words and an overlong recording keep their exact own baseline', async t => {
  const { saveRecordingWords } = await import('../../src/next/model/recording-words.ts');
  const { store } = await studio(t, 'shot-2-3');
  assert.ok(await saveRecordingWords(store, store.getState().edit, '  New recording words.  '));
  await store.refresh();
  const draft = store.getState().edit;
  const { owner, receipt } = await add(store, 12);
  assert.equal(receipt.fits, false);
  assert.equal(acknowledge(store, owner, receipt), true);
  await store.refresh();
  assert.equal(store.getState().edit.baselineValue, 'New recording words.');
  assert.equal(store.getState().edit.value, 'New recording words.');
  assert.equal(comparison(store).kind, 'none');
});

test('B20 an old upload receipt preserves a later saved line as a real conflict', async t => {
  const { store, draft } = await studio(t);
  const { owner, receipt } = await add(store);
  await store.refresh();
  await store.edit({ kind: 'narration', id: draft.shotId, field: 'text', value: 'Saved later in another window.' });
  await store.refresh();
  assert.equal(acknowledge(store, owner, receipt), true);
  assert.equal(store.getState().edit.baselineValue, 'Uploaded narration recording', 'use the receipt, never borrow the refreshed saved text');
  assert.equal(comparison(store).kind, 'changed');
  assert.equal(comparison(store).saved.value, 'Saved later in another window.');
});

test('B20 recording acknowledgement preserves newer typing but cannot rebase a reopened editor or another field', async t => {
  const { store, draft } = await studio(t);
  const { owner, receipt } = await add(store);
  await store.refresh();
  store.setEdit({ ...store.getState().edit, value: 'Newer unsaved line.' });
  const typed = store.getState().edit;
  assert.equal(acknowledge(store, owner, receipt), true);
  assert.equal(store.getState().edit.value, typed.value);
  assert.equal(store.getState().edit.baselineValue, 'Uploaded narration recording');
  assert.equal(store.getState().edit.saving, false);
  assert.equal(comparison(store).kind, 'none');
  store.setEdit(null);
  store.setEdit({ shotId: draft.shotId, field: 'narration', value: 'A fresh editor.' });
  const reopened = store.getState().edit;
  assert.equal(acknowledge(store, owner, receipt), false);
  assert.equal(store.getState().edit, reopened);
  store.setEdit(null);
  store.setEdit({ shotId: draft.shotId, field: 'imagePrompt', value: 'A picture edit.' });
  assert.equal(acknowledge(store, owner, receipt), false);
  assert.equal(store.getState().edit.field, 'imagePrompt');
});

test('B20 recording acknowledgement is fenced across film selection including A to B to A', async t => {
  const { store, draft } = await studio(t);
  const { owner, receipt } = await add(store);
  await store.refresh();
  store.dispatch({ type: 'project', projectId: 'another-film' });
  assert.equal(acknowledge(store, owner, receipt), false);
  store.dispatch({ type: 'project', projectId: draft.projectId });
  const restored = store.getState().edit;
  assert.equal(acknowledge(store, owner, receipt), false);
  assert.equal(store.getState().edit, restored);
});

test('B20 incomplete or foreign recording receipts cannot invent a new narration baseline', async t => {
  const { store, draft } = await studio(t);
  const { owner, receipt } = await add(store);
  const before = store.getState().edit;
  for (const wrong of [
    { ...receipt, shotId: 'shot-1-1' },
    { ...receipt, headVersion: Number.NaN },
    { ...receipt, shot: { ...receipt.shot, shotId: 'shot-1-1' } },
    { ...receipt, shot: { ...receipt.shot, headVersion: receipt.headVersion + 1 } },
    { ...receipt, shot: undefined },
    { ...receipt, shot: { ...receipt.shot, segment: null } },
  ]) assert.equal(acknowledge(store, owner, wrong), false);
  assert.equal(store.getState().edit, before);
});

test('B20 an own voice or mode setting retains the narration text baseline', async t => {
  const { store } = await studio(t, 'shot-2-3');
  for (const [field, value] of [['voice', 'cedar'], ['mode', 'uploaded'], ['mode', 'generated'], ['mode', 'none']]) {
    const draft = store.getState().edit;
    assert.equal(await runNarrationEdits(store, draft, [{ edit: { kind: 'narration', id: draft.shotId, field, value }, toast: { id: 'toast.saved' } }]), true);
    await store.refresh();
    assert.equal(store.getState().edit.baselineValue, draft.baselineValue);
    assert.equal(comparison(store).kind, 'none', `${field}=${value} does not rewrite the line`);
  }
});

for (const fit of ['extend_shot', 'cut_to_shot']) test(`B20 the own ${fit} choice changes timing without conflicting with an open narration draft`, async t => {
  const { store, draft } = await studio(t, 'shot-2-3');
  assert.equal(await store.narrationFit(draft.shotId, fit), true);
  await store.refresh();
  assert.equal(store.getState().edit.baselineValue, draft.baselineValue);
  assert.equal(comparison(store).kind, 'none');
});

test('B20 a failed recording releases only its own local saving state and keeps its baseline', async t => {
  const { store, draft } = await studio(t);
  const owner = recording.beginRecordingWrite(store, draft);
  assert.ok(owner);
  assert.equal(store.getState().edit.saving, true);
  assert.equal(recording.beginRecordingWrite(store, store.getState().edit), null, 'no competing upload shares the owner');
  recording.endRecordingWrite(store, owner);
  assert.equal(store.getState().edit.saving, false);
  assert.equal(store.getState().edit.recordingRevision, undefined);
  assert.equal(store.getState().edit.baselineValue, draft.baselineValue);
  assert.equal(comparison(store).kind, 'none');
  assert.ok(recording.beginRecordingWrite(store, store.getState().edit), 'another human attempt can start');
});

test('B20 an older recording cannot clear a later editor upload or its saving flag', async t => {
  const { store, draft } = await studio(t);
  const { owner, receipt } = await add(store);
  await store.refresh();
  store.setEdit(null);
  store.setEdit({ shotId: draft.shotId, field: 'narration', value: 'Another editor.' });
  const newer = recording.beginRecordingWrite(store, store.getState().edit);
  assert.ok(newer);
  const current = store.getState().edit;
  assert.equal(acknowledge(store, owner, receipt), false);
  recording.endRecordingWrite(store, owner);
  assert.equal(store.getState().edit, current);
  assert.equal(store.getState().edit.saving, true);
  recording.endRecordingWrite(store, newer);
  assert.equal(store.getState().edit.saving, false);
});

test('B20 a film round trip releases the old upload owner and lets a new human upload start', async t => {
  const { store, draft } = await studio(t);
  const owner = recording.beginRecordingWrite(store, draft);
  assert.ok(owner);
  store.dispatch({ type: 'project', projectId: 'another-film' });
  store.dispatch({ type: 'project', projectId: draft.projectId });
  await store.refresh();
  const newer = recording.beginRecordingWrite(store, store.getState().edit);
  assert.ok(newer);
  const current = store.getState().edit;
  recording.endRecordingWrite(store, owner);
  assert.equal(store.getState().edit, current, 'the old epoch does not clear the new upload');
  recording.endRecordingWrite(store, newer);
});

test('B20 an applied recording with a lost reply checks the exact original request despite its own text conflict', async t => {
  const { ImportKeys } = await import('../../src/next/model/assets-import.ts');
  const { store, port, draft } = await studio(t);
  const keys = new ImportKeys(draft.projectId, null, () => 'original-upload-key');
  const file = { name: 'my-recording.wav', size: 1000, lastModified: 1 };
  const identity = recording.recordingIdentity(draft.shotId, file);
  const first = keys.begin(identity, recording.recordingPath(draft.shotId, store.getState().snapshot.project.headVersion));
  const owner = recording.beginRecordingWrite(store, draft);
  const body = { ...file, type: 'audio/wav', durationSeconds: 3, key: first.key };
  const receipt = await port.request(`/api/projects/${draft.projectId}${first.path}`, { method: 'POST', body, key: first.key });
  recording.endRecordingWrite(store, owner); // The reply was lost; nothing may assume it succeeded.
  await store.refresh();
  assert.equal(comparison(store).kind, 'changed');
  assert.equal(recording.beginRecordingWrite(store, store.getState().edit), null, 'a fresh write still needs the field conflict resolved');
  const checking = recording.beginRecordingWrite(store, store.getState().edit, keys.saved(identity));
  assert.ok(checking, 'the saved upload can be checked without authority for new text or a fresh request');
  const again = keys.begin(identity, recording.recordingPath(draft.shotId, store.getState().snapshot.project.headVersion));
  assert.equal(again.resent, true);
  assert.equal(again.path, first.path);
  assert.equal(again.key, first.key);
  const replay = await port.request(`/api/projects/${draft.projectId}${again.path}`, { method: 'POST', body, key: again.key });
  assert.deepEqual(replay, receipt);
  assert.equal(acknowledge(store, checking, replay), true);
  assert.equal(comparison(store).kind, 'none');
});

test('B20 conflict bypass for recording reconciliation rejects foreign or malformed saved paths', async t => {
  const { store, draft } = await studio(t);
  const { owner, receipt } = await add(store);
  recording.endRecordingWrite(store, owner);
  await store.refresh();
  assert.equal(comparison(store).kind, 'changed');
  for (const path of [recording.recordingPath('shot-1-1', receipt.headVersion), '/storyboard', `${recording.recordingPath(draft.shotId, receipt.headVersion)}&fresh=yes`]) {
    assert.equal(recording.beginRecordingWrite(store, store.getState().edit, { key: 'old-key', path, at: Date.now() }), null);
  }
});

test('B20 checking a retained recording bypasses only field or projection comparisons', () => {
  for (const id of ['error.EDIT_BASELINE_CHANGED', 'error.PROJECTION_CHANGED']) {
    const reason = { id };
    assert.equal(recording.recordingSaveBlocked(reason, false), reason);
    assert.equal(recording.recordingSaveBlocked(reason, true), null);
  }
  const pendingText = { id: 'plan.unconfirmed.retry' };
  assert.equal(recording.recordingSaveBlocked(pendingText, true), pendingText, 'an unknown subtitle save still needs its own exact check');
});

test('B20 a definitely stale recording replay cannot turn a later saved line into fresh upload authority', async t => {
  const { store, draft } = await studio(t, 'shot-2-3');
  const owner = recording.beginRecordingWrite(store, draft);
  assert.ok(owner);
  await store.edit({ kind: 'shot', id: 'shot-1-1', field: 'motion', value: 'Unrelated film advance.' });
  await store.refresh();
  assert.equal(recording.recordingCanRetryFresh(store, owner), true, 'the saved line is still the original upload input');
  await store.edit({ kind: 'narration', id: draft.shotId, field: 'text', value: 'A later saved line.' });
  await store.refresh();
  assert.equal(recording.recordingCanRetryFresh(store, owner), false, 'a changed saved field requires the explicit Keep/Use choice');
  store.setEdit(null);
  store.setEdit({ shotId: draft.shotId, field: 'narration', value: 'A reopened editor.' });
  assert.equal(recording.recordingCanRetryFresh(store, owner), false);
});

test('B20 a captured recording replay never expires into fresh request authority while the person presses Add', async t => {
  const { ImportKeys, IMPORT_KEY_MAX_AGE_MS } = await import('../../src/next/model/assets-import.ts');
  let now = 1000, serial = 0;
  const keys = new ImportKeys('film', null, () => `upload-${++serial}`, () => now);
  const identity = 'same-recording';
  const original = keys.begin(identity, recording.recordingPath('shot-2-2', 12));
  const captured = keys.saved(identity);
  now += IMPORT_KEY_MAX_AGE_MS + 1;
  assert.equal(keys.saved(identity), undefined, 'the key expires after render but before the press sends');
  const checking = recording.recordingRequest(keys, identity, recording.recordingPath('shot-2-2', 25), captured);
  assert.deepEqual(checking, { key: original.key, path: original.path, resent: true });
  assert.equal(serial, 1, 'checking an outcome never mints a new request');
});

test('B20 a stale recording replay cannot automatically upload before unsaved local words are prepared', async t => {
  const { store, draft } = await studio(t, 'shot-2-3');
  const owner = recording.beginRecordingWrite(store, draft);
  assert.ok(owner);
  assert.equal(recording.recordingCanRetryFresh(store, owner, draft.baselineValue), true);
  assert.equal(recording.recordingCanRetryFresh(store, owner, 'New words still unsaved after rollback.'), false);
});
