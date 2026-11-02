import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, lastFerrySnapshot } from '../../src/next/fixtures/last-ferry.ts';
import { change, conflicts, hold, shown } from '../../src/next/model/plan-conflict.ts';
import { planSession, projectionBaseline } from '../../src/next/model/plan-session.ts';
import { storyboardOutcome } from '../../src/next/views/plan/commands.ts';

const projections = () => ({ snapshot: lastFerrySnapshot(), overview: lastFerryOverview() });

test('B17.4 Plan refuses independently refreshed projections until film, head and revision agree', async () => {
  const { snapshot, overview } = projections();
  assert.deepEqual(projectionBaseline(snapshot, overview), { projectId: snapshot.project.id, headVersion: 12 });
  assert.equal(projectionBaseline({ ...snapshot, project: { ...snapshot.project, headVersion: 13 } }, overview), null);
  assert.equal(projectionBaseline(snapshot, { ...overview, projectId: 'other-film' }), null);
  assert.equal(projectionBaseline(snapshot, { ...overview, revisionId: 'new-revision' }), null);
  const calls = [];
  const store = {
    getState: () => ({ projectId: snapshot.project.id, snapshot: { ...snapshot, project: { ...snapshot.project, headVersion: 13 } }, overview }),
    command: (...args) => { calls.push(args); return Promise.resolve({ commandId: 'bad' }); },
    dispatch: () => {},
  };
  assert.equal((await storyboardOutcome(store, 'stale-row', { kind: 'shotFields', id: 'shot-1-1', fields: { desiredFrames: 180 } })).kind, 'refused');
  assert.equal(calls.length, 0, 'no stale displayed value borrows the newer snapshot head');
});

test('B17.4 a Plan press retains the displayed head and originating film on retry', async () => {
  const { snapshot, overview } = projections();
  const baseline = projectionBaseline(snapshot, overview);
  let state = { projectId: snapshot.project.id, snapshot, overview };
  const calls = [];
  let lost = true;
  const store = {
    getState: () => state,
    command: async (_id, _logical, build) => { calls.push(await build()); return lost ? undefined : { commandId: 'saved', headVersion: 13 }; },
    unconfirmed: () => lost,
    dismissToast: () => {},
    dispatch: () => {},
  };
  const out = await storyboardOutcome(store, 'shot', { kind: 'shotFields', id: 'shot-1-1', fields: { desiredFrames: 180 } }, baseline);
  assert.equal(out.kind, 'lost');
  state = { ...state, snapshot: { ...snapshot, project: { ...snapshot.project, headVersion: 13 } } };
  lost = false;
  assert.equal((await out.resend()).kind, 'done');
  assert.equal(calls[0].path, `/api/projects/${snapshot.project.id}/storyboard`);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(calls[0].body.expectedHeadVersion, 12);
});

test('B17.7 Brief and shot drafts survive Plan tab, recovery and project remounts without crossing films', () => {
  const owner = {};
  const a = planSession(owner, 'film-a');
  const typed = change(hold({ text: 'Original' }), { text: 'Original' }, 'text', 'My brief');
  a.set('editing', { kind: 'brief' });
  a.set('drafts', { brief: typed, 'shot:s1': change(hold({ purpose: 'Original shot' }), { purpose: 'Original shot' }, 'purpose', 'My shot') });
  a.set('importDraft', { name: 'mine.md', text: 'My written plan' });
  // Neither view unmount nor review has authority to remove the per-film session.
  const b = planSession(owner, 'film-b');
  assert.deepEqual(b.getSnapshot().drafts, {});
  b.set('importDraft', { name: 'b.md', text: 'B only' });
  const restored = planSession(owner, 'film-a').getSnapshot();
  assert.deepEqual(restored.editing, { kind: 'brief' });
  assert.equal(restored.drafts.brief.draft.text, 'My brief');
  assert.equal(restored.drafts['shot:s1'].draft.purpose, 'My shot');
  assert.deepEqual(restored.importDraft, { name: 'mine.md', text: 'My written plan' });
  assert.deepEqual(conflicts(restored.drafts.brief, { text: 'New server brief' }), ['text']);
  assert.equal(shown(restored.drafts.brief, { text: 'New server brief' }).text, 'My brief');
  assert.deepEqual(planSession({}, 'film-a').getSnapshot().drafts, {}, 'a new studio owner cannot expose another session drafts');
});

test('B17.7 a hidden film completion updates only its retained drafts and not the current film', () => {
  const owner = {};
  const a = planSession(owner, 'a');
  const b = planSession(owner, 'b');
  const notifications = [];
  a.subscribe(() => notifications.push('a'));
  b.subscribe(() => notifications.push('b'));
  a.set('drafts', { brief: hold({ text: 'A saved' }) });
  b.set('drafts', { brief: hold({ text: 'B unsent' }) });
  a.set('drafts', {});
  assert.equal(b.getSnapshot().drafts.brief.draft.text, 'B unsent');
  assert.deepEqual(notifications, ['a', 'b', 'a']);
});

test('B17.4 a superseded Plan reply never reads another film request or clears its toast', async () => {
  const { snapshot, overview } = projections();
  let state = { projectId: snapshot.project.id, projectEpoch: 1, snapshot, overview };
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const store = {
    getState: () => state,
    command: async () => { await waiting; return undefined; },
    unconfirmed: () => { assert.fail('must not read the newly selected film request registry'); },
    dismissToast: () => { assert.fail('must not clear the newly selected film toast'); },
    dispatch: () => {},
  };
  const result = storyboardOutcome(store, 'brief', { kind: 'treatment', field: 'brief', value: 'A text' });
  state = { ...state, projectEpoch: 3 }; // A -> B -> A is still a superseded selection.
  release();
  assert.equal((await result).kind, 'superseded');
});

test('B17.4 a multi-command save advances only with its own answered receipt head', async () => {
  const { receiptBaseline } = await import('../../src/next/model/plan-session.ts');
  const original = { projectId: 'film-a', headVersion: 12 };
  assert.deepEqual(receiptBaseline(original, { headVersion: 13 }), { projectId: 'film-a', headVersion: 13 });
  assert.equal(receiptBaseline(original, {}), null, 'a missing head cannot borrow a later refresh head');
});

test('B17.4 matching old Plan reads do not authorize the newly selected film', async () => {
  const { snapshot, overview } = projections();
  const store = {
    getState: () => ({ projectId: 'other-film', snapshot, overview }),
    command: () => { assert.fail('old projections must not be sent for the new selection'); },
    dispatch: () => {},
  };
  assert.equal((await storyboardOutcome(store, 'old-film', { kind: 'addScene' })).kind, 'refused');
});
