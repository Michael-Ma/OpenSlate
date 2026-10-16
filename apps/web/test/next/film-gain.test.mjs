import test from 'node:test';
import assert from 'node:assert/strict';
import { gainConflict, gainRequest, musicGainSession } from '../../src/next/model/film-gain.ts';

const live = (patch = {}) => ({ projectId: 'film-a', headVersion: 12, audioId: 'music-a', gainDb: -12, ...patch });

test('B17 #4 delayed music volume retains its authored baseline across a newer server gain', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const draft = session.getSnapshot().draft;
  const newer = live({ headVersion: 13, gainDb: -6 });
  assert.equal(draft.baseline.headVersion, 12);
  assert.equal(draft.value, -30);
  assert.equal(gainConflict(draft, newer), true);
  assert.equal(gainRequest(draft, newer), null, 'debounce cannot buy authority from a new callback/head');
  assert.equal(gainRequest(draft, live({ projectId: 'film-b' })), null);
  assert.deepEqual(gainRequest(draft, live()), {
    path: '/api/projects/film-a/storyboard',
    body: { kind: 'soundtrack', field: 'gainMilliDb', value: '-30000', expectedHeadVersion: 12 },
  });
});

test('B17 #4 volume conflicts retain the level until Keep volume or Use saved is chosen explicitly', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const newer = live({ headVersion: 13, gainDb: -6 });
  session.resolve(newer, true);
  assert.equal(gainConflict(session.getSnapshot().draft, newer), false);
  assert.equal(session.getSnapshot().draft.value, -30);
  assert.equal(gainRequest(session.getSnapshot().draft, newer).body.expectedHeadVersion, 13);
  session.resolve(newer, false);
  assert.equal(session.getSnapshot().draft, null);
});

test('B17 #4 pending volume survives view/film mounts and a late A completion cannot erase B', () => {
  const owner = {};
  const a = musicGainSession(owner, 'film-a');
  const b = musicGainSession(owner, 'film-b');
  a.edit(live(), -30);
  const submitted = a.begin(live());
  b.edit(live({ projectId: 'film-b' }), -20);
  assert.equal(musicGainSession(owner, 'film-a').getSnapshot().draft.value, -30);
  assert.equal(a.getSnapshot().saving, true, 'remount cannot duplicate an in-flight command');
  a.complete(submitted, { headVersion: 13 });
  assert.equal(a.getSnapshot().draft, null);
  assert.equal(b.getSnapshot().draft.value, -20);
  assert.equal(musicGainSession({}, 'film-a').getSnapshot().draft, null);
});

test('B17 #4 a volume typed back to its opening value during Save stays against the submitted value', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const submitted = session.begin(live());
  session.edit(live(), -12);
  session.complete(submitted, { headVersion: 13 });
  const state = session.getSnapshot();
  assert.equal(state.draft.value, -12);
  assert.deepEqual(state.draft.baseline, live({ headVersion: 13, gainDb: -30 }));
  assert.equal(state.saving, false);
});

test('B17 #4 a failed volume save keeps the draft and requires a human retry', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const submitted = session.begin(live());
  session.complete(submitted, null);
  assert.equal(session.getSnapshot().draft.value, -30);
  assert.equal(session.getSnapshot().failed, true);
  assert.deepEqual(session.begin(live()).baseline, submitted.baseline, 'a deliberate retry retains the original body/head');
});

test('B17 #4 an absent or changed soundtrack baseline cannot silently receive an old volume', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  assert.equal(session.begin(null), null);
  assert.equal(session.begin(live({ audioId: 'replacement-music' })), null);
  assert.equal(session.getSnapshot().draft.value, -30);
});

test('B17 #4 dragging keeps a draft without scheduling until release, and conflict resolution is explicit', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  assert.equal(session.getSnapshot().ready, false);
  session.release();
  assert.equal(session.getSnapshot().ready, true);
  session.edit(live(), -31);
  assert.equal(session.getSnapshot().ready, false);
  session.resolve(live({ headVersion: 13 }), true);
  assert.equal(session.getSnapshot().ready, true, 'Keep volume is an explicit continuation');
});

test('B17 #4 choosing the opening volume during a conflict keeps that authored value', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const newer = live({ headVersion: 13, gainDb: -6 });
  session.edit(newer, -12);
  assert.equal(session.getSnapshot().draft.value, -12);
  assert.equal(gainConflict(session.getSnapshot().draft, newer), true);
});
