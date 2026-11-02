import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { runNoteRegeneration, runNoteVideoConfirm, runNoteChoice, openNoteEditor, noteCommandOwner, noteCommandCurrent, pendingNoteEdit } from '../../src/next/model/note-command.ts';
import { noteBanner, noteCallout, regeneratePrice } from '../../src/next/model/note-banner.ts';
import { noteViews } from '../../src/next/model/notes.ts';
import { lastFerryNotes } from '../../src/next/fixtures/last-ferry.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const regenerate = { kind: 'regenerate', noteId: 'note-a', choiceIndex: 1, shotIds: [shotId('2.2')] };

function fixture() {
  const overview = lastFerryOverview(), reply = deferred(), resolved = [], edits = [], opened = [], toasts = [];
  const state = { projectId: overview.projectId, projectEpoch: 1, overview, edit: null, snapshot: { notes: lastFerryNotes() } };
  const store = {
    getState: () => state,
    // The studio's own read after a press: `settleOnRefresh` makes it report the note settled by that press.
    refresh: async () => { if (store.settleOnRefresh) state.snapshot = { notes: state.snapshot.notes.map(n => n.noteId === store.settleOnRefresh ? { ...n, state: 'resolved' } : n) }; },
    confirmVideo: async () => reply.promise,
    acceptProposal: async proposal => ({ proposal }),
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

test('a press the studio already settled the note with is not resolved a second time (first wins)', async () => {
  const f = fixture();
  f.store.settleOnRefresh = 'note-a';
  const result = runNoteRegeneration(f.store, f.overview, regenerate);
  f.reply.resolve({ requestId: 'paid-a' });
  assert.equal(await result, true);
  assert.deepEqual(f.resolved, [], 'the note was settled by the press itself');
  const v = fixture(), confirm = { kind: 'confirm_video', noteId: 'note-a', choiceIndex: 0, sceneId: 'scene-2' };
  const pressed = runNoteVideoConfirm(v.store, v.overview, confirm);
  v.reply.resolve({ confirmationId: 'confirmation-1' });
  assert.equal(await pressed, true);
  assert.deepEqual(v.resolved, [{ projectId: v.overview.projectId, args: ['note-a', 0, 'confirmation-1'] }], 'otherwise the note names the confirm');
  const refused = fixture(), lost = runNoteVideoConfirm(refused.store, refused.overview, confirm);
  refused.reply.resolve(undefined);
  assert.equal(await lost, false, 'a refused confirm settles nothing');
  assert.deepEqual(refused.resolved, []);
});

test('an edit chosen in the chat waits for its field to be saved in Keyframes', async () => {
  const f = fixture();
  const outcome = await runNoteChoice(f.store, f.overview, { noteId: 'note-b', sceneId: 'scene-2', shotIds: [shotId('2.3')] },
    { kind: 'edit', noteId: 'note-b', choiceIndex: 1, shotId: shotId('2.3'), field: 'narration' }, null, f.open);
  assert.deepEqual(outcome, { kind: 'editing' });
  assert.deepEqual([f.opened, pendingNoteEdit(f.store)?.noteId], [[shotId('2.3')], 'note-b']);
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

test('a video confirm choice follows the scene’s own confirm: off with its reason until ready, then priced', () => {
  const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
  const ask = { ...lastFerryNotes()[0], noteId: 'note-v', letter: 'c', anchor: { sceneId: 'scene-2' }, kind: 'recommendation', seenKeyframe: undefined,
    choices: [{ kind: 'confirm_video', sceneId: 'scene-2' }, { kind: 'reply' }] };
  const overview = lastFerryOverview();
  const [view] = noteViews([ask], overview);
  assert.deepEqual([en(view.choices[0].label), zh(view.choices[0].label), view.choices[0].paid], ['Confirm frames & generate Scene 2 video', '确认画面并生成第 2 场视频', true]);
  const off = noteBanner(view, overview, [], 'en').actions[0];
  assert.deepEqual([off.enabled, off.price, en(off.reason)], [false, null, 'Open 2.2 and 2.3 and settle 2.3 first']);
  const ready = structuredClone(overview);
  for (const id of ready.scenes[1].videoTargets) ready.shots[id].keyframe.opened = true;
  ready.scenes[1].blockers = [];
  const on = noteBanner(noteViews([ask], ready)[0], ready, [], 'en').actions[0];
  assert.equal(on.enabled, true);
  assert.equal(on.reason, null);
  assert.match(en(on.price), /\$/);
  const settled = noteViews([{ ...ask, state: 'resolved', version: 2, resolution: { choiceIndex: 0, at: 'x', resultRef: 'confirmation-1', elsewhere: true } }], ready)[0];
  assert.equal(en(settled.settled), 'Settled: Scene 2 video confirmed');
  assert.equal(noteBanner(settled, ready, [], 'en').actions.length, 0, 'a settled note offers nothing to press again');
});
