import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { runNoteRegeneration, openNoteEditor, noteCommandOwner, noteCommandCurrent } from '../../src/next/model/note-command.ts';
import { noteBanner, noteCallout, regeneratePrice } from '../../src/next/model/note-banner.ts';
import { noteViews } from '../../src/next/model/notes.ts';
import { lastFerryNotes } from '../../src/next/fixtures/last-ferry.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const regenerate = { kind: 'regenerate', noteId: 'note-a', choiceIndex: 1, shotIds: [shotId('2.2')] };

function fixture() {
  const overview = lastFerryOverview(), reply = deferred(), resolved = [], edits = [], opened = [], toasts = [];
  const state = { projectId: overview.projectId, projectEpoch: 1, overview, edit: null };
  const store = {
    getState: () => state,
    regenerateKeyframe: async () => reply.promise,
    makeKeyframes: async () => reply.promise,
    resolveNote: async (...args) => { resolved.push({ projectId: state.projectId, args }); return true; },
    setEdit: draft => { state.edit = draft; edits.push(draft); },
    dispatch: action => toasts.push(action),
  };
  return { overview, reply, resolved, edits, opened, state, store, toasts, open: id => opened.push(id) };
}

test('B17 #12: a note regeneration resolves only in its originating film and selection epoch', async () => {
  for (const returnToOrigin of [false, true]) {
    const f = fixture(), result = runNoteRegeneration(f.store, f.overview, regenerate);
    f.state.projectId = 'other-film'; f.state.projectEpoch++;
    if (returnToOrigin) { f.state.projectId = f.overview.projectId; f.state.projectEpoch++; }
    f.reply.resolve({ requestId: 'paid-a' });
    assert.equal(await result, false);
    assert.deepEqual(f.resolved, [], 'a delayed receipt cannot authorize a resolve on another selection');
  }
  const f = fixture(), result = runNoteRegeneration(f.store, f.overview, regenerate);
  f.reply.resolve({ requestId: 'paid-a' });
  assert.equal(await result, true);
  assert.deepEqual(f.resolved, [{ projectId: f.overview.projectId, args: ['note-a', 1, 'paid-a'] }]);
});

test('B17 #8: choosing a note edit keeps an existing inspector draft and explains its hold', () => {
  const f = fixture();
  f.state.edit = { shotId: shotId('2.1'), field: 'motion', value: 'Keep these unsaved words' };
  const draft = f.state.edit;
  assert.equal(openNoteEditor(f.store, f.overview, { kind: 'edit', noteId: 'note-a', choiceIndex: 0, shotId: shotId('2.2'), field: 'imagePrompt' }, f.open), false);
  assert.equal(f.state.edit, draft);
  assert.deepEqual(f.opened, []);
  assert.equal(f.toasts.at(-1).message.id, 'kf.edit_held');
});

test('B17 #3/#8: note editors bind to their displayed baseline and open normally when it is current', () => {
  const f = fixture(), action = { kind: 'edit', noteId: 'note-a', choiceIndex: 0, shotId: shotId('2.2'), field: 'imagePrompt' };
  f.state.overview = { ...f.overview, headVersion: f.overview.headVersion + 1 };
  assert.equal(openNoteEditor(f.store, f.overview, action, f.open), false);
  assert.deepEqual(f.edits, []);
  assert.equal(f.toasts.at(-1).message.id, 'error.EDIT_BASELINE_CHANGED');
  f.state.overview = f.overview;
  assert.equal(openNoteEditor(f.store, f.overview, action, f.open), true);
  assert.deepEqual(f.opened, [shotId('2.2')]);
  assert.equal(f.state.edit.value, f.overview.shots[shotId('2.2')].imagePrompt);
  const owner = noteCommandOwner(f.store, f.overview);
  f.state.projectEpoch++;
  assert.equal(noteCommandCurrent(f.store, owner), false, 'old callbacks cannot settle a reopened film');
});

test('B17 #1/#11: missing quotes cannot produce an unpriced enabled purchase', () => {
  const overview = lastFerryOverview(), shot = overview.shots[shotId('2.2')];
  delete shot.quotes;
  delete overview.scenes[1].quotes.regenerateKeyframe;
  const note = noteViews(lastFerryNotes(), overview, []).find(n => n.letter === 'a');
  assert.equal(translateMsg('en', regeneratePrice([shot.shotId], overview, 'en-US')), 'no price set');
  assert.equal(noteBanner(note, overview, [], 'en-US').actions[1].enabled, false);
  assert.equal(noteCallout(note, shot.shotId, overview, 'en-US').regenerate.enabled, false);
  assert.equal(inspectorView(overview, shot, 'en-US').regenerate.enabled, false, 'the inspector uses the same exact quote requirement');
});
