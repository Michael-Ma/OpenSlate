import test from 'node:test';
import assert from 'node:assert/strict';
import { directorForm, directorFormConflict, directorFormRequest } from '../../src/next/model/settings-director.ts';
import { createProjectDrafts, resourceFor, resourceIdentity, settingsRequest } from '../../src/next/model/settings-ownership.ts';

const setup = (patch = {}) => ({
  selection: { mode: 'native', binaryPath: '/usr/local/bin/codex', model: 'original-model' }, selectionDigest: 'original-digest',
  busy: false, changeAvailable: true, changeAppliesTo: 'next_turn', defaults: { binaryPath: '/usr/local/bin/codex', model: 'original-model' },
  locked: true, modelCalls: 3, modelChoices: [], modelCatalogStatus: 'ready', modelCatalogCheckedAt: null, ...patch,
});

test('B17 #5: a Director form keeps its opening digest and shows a changed selection as a conflict', () => {
  const original = setup();
  const form = directorForm(original);
  form.value.model = 'my-unsaved-model';
  const newer = setup({ selectionDigest: 'new-digest', selection: { ...original.selection, model: 'other-tab-model' } });
  assert.equal(directorFormConflict(form, newer), true);
  assert.equal(directorFormRequest(form).body.expectedSelectionDigest, 'original-digest');
  assert.equal(directorFormRequest(form).body.selection.model, 'my-unsaved-model');
  assert.equal(form.value.model, 'my-unsaved-model');
  assert.equal(directorFormConflict(form, setup({ busy: true, modelChoices: [{ id: 'new-catalog-model', label: 'New model' }] })), false);
});

test('B17 #5: opening setup cannot silently become a change form after the first conversation', () => {
  const form = directorForm(setup({ locked: false }));
  assert.equal(directorFormConflict(form, setup({ locked: true })), true);
  assert.equal(directorFormRequest(form).path, '/director/setup');
});

test('B17 #6: per-film settings drafts survive navigation and late A completion cannot erase B or newer A text', () => {
  const drafts = createProjectDrafts();
  const a = directorForm(setup());
  const b = directorForm(setup({ selectionDigest: 'b-digest' }));
  drafts.set('a', 'director', a);
  assert.equal(drafts.get('b', 'director'), null);
  drafts.set('b', 'director', b);
  assert.equal(drafts.get('a', 'director'), a);
  const newerA = { ...a, value: { ...a.value, model: 'words-typed-during-save' } };
  drafts.set('a', 'director', newerA);
  drafts.set('a', 'director', (current) => current === a ? null : current);
  assert.equal(drafts.get('a', 'director'), newerA);
  assert.equal(drafts.get('b', 'director'), b);
  drafts.set('a', 'director', null);
  assert.equal(drafts.get('a', 'director'), null);
  assert.equal(drafts.get('b', 'director'), b);
});

test('B17 #6: resources hide film A immediately when B loads, fails, or no film is selected', () => {
  const a = resourceIdentity('a', '/director/setup');
  const b = resourceIdentity('b', '/director/setup');
  const answered = { identity: a, data: { selectionDigest: 'a-digest' }, error: null, status: null, loading: false };
  assert.equal(resourceFor(answered, a).data.selectionDigest, 'a-digest');
  assert.deepEqual(resourceFor(answered, b), { identity: b, data: null, error: null, status: null, loading: true });
  const failedB = { ...resourceFor(answered, b), error: 'NETWORK_ERROR', loading: false };
  assert.equal(resourceFor(failedB, b).data, null);
  assert.equal(resourceFor(answered, null).data, null);
  assert.equal(resourceFor(answered, null).loading, false);
  // Installation resources do not belong to whichever film happens to be open.
  assert.equal(resourceIdentity('a', '/api/providers', false), resourceIdentity('b', '/api/providers', false));
  assert.notEqual(resourceIdentity('a', '/settings/voice'), resourceIdentity('a', '/settings/models'));
});


test('B17 #6: settings continuations retain their original film path', () => {
  const prepared = settingsRequest('film-a', { path: '/settings/models/preview', body: { expectedHeadVersion: 12 } });
  const drafts = createProjectDrafts();
  drafts.set('film-b', 'models', { value: 'b-model' });
  assert.equal(prepared.path, '/api/projects/film-a/settings/models/preview');
  assert.equal(prepared.body.expectedHeadVersion, 12);
  assert.equal(settingsRequest('film-b', prepared).path, prepared.path);
});

test('B17 #6 resource identity changes when the same film is reselected',()=>{
  assert.notEqual(resourceIdentity('a','/settings/director',true,1),resourceIdentity('a','/settings/director',true,3));
});

test('B17 #5/#6 Director save completion preserves reopened forms with an identical digest', async () => {
  const { afterDirectorSave } = await import('../../src/next/model/settings-director.ts');
  const sent = directorForm(setup());
  const saved = setup({ selectionDigest: 'saved-digest' });
  assert.equal(afterDirectorSave(sent, sent, saved), null);
  const typed = { ...sent, value: { ...sent.value, model: 'typed-during-save' } };
  const retained = afterDirectorSave(typed, sent, saved);
  assert.equal(retained.value.model, 'typed-during-save');
  assert.equal(retained.baseline, saved);
  const reopened = directorForm(setup());
  assert.equal(afterDirectorSave(reopened, sent, saved), reopened);
  const explicitlyRebased = { ...typed, baseline: structuredClone(sent.baseline) };
  assert.equal(afterDirectorSave(explicitlyRebased, sent, saved), explicitlyRebased);
  assert.equal(afterDirectorSave(null, sent, saved), null);
});
