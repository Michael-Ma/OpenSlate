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

test('B18 music ignores unrelated head advances and saves with the current consistent displayed head', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const newer = live({ headVersion: 13 });
  assert.equal(gainConflict(session.getSnapshot().draft, newer), false);
  const submitted = session.begin(newer);
  assert.ok(submitted);
  assert.equal(gainRequest(submitted, newer).body.expectedHeadVersion, 13);
  assert.equal(submitted.value, -30);
  session.complete(submitted, { headVersion: 14 });
  assert.equal(session.getSnapshot().draft, null);
});

test('B18 music comparisons distinguish waiting projections from changed values', async () => {
  const { gainComparison } = await import('../../src/next/model/film-gain.ts');
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const draft = session.getSnapshot().draft;
  assert.deepEqual(gainComparison(draft, null), { kind: 'waiting' });
  assert.equal(gainConflict(draft, null), false, 'a temporarily missing baseline is not a conflict');
  assert.equal(session.begin(null), null);
  assert.equal(session.getSnapshot().failed, false);
  assert.deepEqual(gainComparison(draft, live({ headVersion: 13 })), { kind: 'none' });
  assert.deepEqual(gainComparison(draft, live({ gainDb: -6 })), { kind: 'changed', saved: live({ gainDb: -6 }) });
  assert.equal(gainComparison(draft, live({ audioId: 'other-track' })).kind, 'changed');
  assert.equal(gainComparison(draft, live({ projectId: 'film-b' })).kind, 'waiting');
});

test('B18 a refused stale music head keeps the draft without a field conflict and the next human press rebases', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const first = session.begin(live());
  session.complete(first, null, 'refused');
  const newer = live({ headVersion: 13 });
  assert.equal(session.getSnapshot().failed, true, 'a refusal cannot restart a debounce loop');
  assert.equal(gainConflict(session.getSnapshot().draft, newer), false);
  const next = session.begin(newer);
  assert.equal(gainRequest(next, newer).body.expectedHeadVersion, 13);
});

test('B18 an unknown music save retains its exact original request even after an unrelated head advance', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const first = session.begin(live());
  session.complete(first, null, 'unconfirmed');
  session.edit(live({ headVersion: 13 }), -24);
  assert.equal(session.getSnapshot().failed, true, 'typing after a lost reply cannot cause an automatic new request');
  assert.equal(session.getSnapshot().unconfirmed, true);
  const next = session.begin(live({ headVersion: 13 }));
  assert.equal(next, first, 'human reconciliation retries the original submitted level');
  assert.equal(gainRequest(next, live({ headVersion: 13 }), true).body.expectedHeadVersion, 12);
  assert.equal(gainRequest(next, live({ headVersion: 13 }), true).body.value, '-30000');
  session.complete(next, { headVersion: 13 });
  assert.equal(session.getSnapshot().draft.value, -24);
  assert.equal(session.getSnapshot().unconfirmed, false);
  assert.equal(session.getSnapshot().draft.baseline.gainDb, -30);
});

const gainPort = async (headVersion = 13, gainDb = -12) => {
  const { FixturePort } = await import('../../src/next/fixtures/fixture-port.ts');
  const { snapshot, overview } = new FixturePort().world;
  snapshot.project = { ...snapshot.project, id: 'film-a', headVersion, soundtrack: { audioId: 'music-a', gainMilliDb: gainDb * 1000 } };
  overview.projectId = 'film-a'; overview.headVersion = headVersion;
  const port = { state: { projectId: 'film-a', projectEpoch: 1, snapshot, overview }, posts: [], actions: [], answer: { commandId: 'gain-save', headVersion: headVersion + 1 }, unknown: false };
  port.getState = () => port.state;
  port.command = async (pressId, logical, build) => { port.posts.push({ pressId, logical, ...await build() }); return port.answer; };
  port.dispatch = (action) => { port.actions.push(action); };
  port.unconfirmed = () => port.unknown;
  return port;
};

test('B18 music dispatch sends current equal-field head and saves without a false conflict', async () => {
  const { submitGain } = await import('../../src/next/model/film-gain.ts');
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const submitted = session.begin(live());
  const port = await gainPort(13);
  const result = await submitGain(port, submitted, session);
  assert.equal(result.kind, 'saved');
  assert.equal(port.posts[0].body.expectedHeadVersion, 13);
  assert.equal(port.actions.at(-1).message.id, 'film.toast.music_volume');
  session.complete(submitted, result.receipt);
  assert.equal(session.getSnapshot().draft, null);
});

test('B18 waiting or changed music projections never post or publish a refusal toast', async () => {
  const { submitGain } = await import('../../src/next/model/film-gain.ts');
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const draft = session.getSnapshot().draft;
  const port = await gainPort(13);
  port.state.snapshot.project.headVersion = 14;
  assert.equal((await submitGain(port, draft, session)).kind, 'waiting');
  port.state.overview.headVersion = 14;
  port.state.snapshot.project.soundtrack.gainMilliDb = -6000;
  assert.equal((await submitGain(port, draft, session)).kind, 'changed');
  assert.equal(port.posts.length, 0);
  assert.equal(port.actions.length, 0);
});

test('B18 unknown music dispatch retains the exact head actually sent after a last-moment silent rebase', async () => {
  const { submitGain } = await import('../../src/next/model/film-gain.ts');
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const submitted = session.begin(live());
  const port = await gainPort(13);
  port.answer = undefined; port.unknown = true;
  const result = await submitGain(port, submitted, session);
  assert.equal(result.kind, 'unconfirmed');
  session.complete(submitted, null, result.kind);
  const retry = session.begin(live({ headVersion: 14 }));
  assert.equal(retry.baseline.headVersion, 13, 'remember the head of the actual POST, not the older render');
  assert.equal(gainRequest(retry, live({ headVersion: 14 }), true).body.expectedHeadVersion, port.posts[0].body.expectedHeadVersion);
});

test('B18 a real music refusal waits for the next human press and then uses the new equal-field head', async () => {
  const { submitGain } = await import('../../src/next/model/film-gain.ts');
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const port = await gainPort(12);
  port.answer = undefined;
  const first = session.begin(live());
  const refusal = await submitGain(port, first, session);
  assert.equal(refusal.kind, 'refused');
  session.complete(first, null, refusal.kind);
  assert.equal(port.posts.length, 1);
  assert.equal(session.getSnapshot().failed, true);
  port.state.snapshot.project.headVersion = 13; port.state.overview.headVersion = 13;
  assert.equal(gainConflict(session.getSnapshot().draft, live({ headVersion: 13 })), false);
  const next = session.begin(live({ headVersion: 13 }));
  port.answer = { commandId: 'next-human-save', headVersion: 14 };
  const result = await submitGain(port, next, session);
  assert.equal(result.kind, 'saved');
  assert.deepEqual(port.posts.map((post) => post.body.expectedHeadVersion), [12, 13]);
});

test('B18 a late music response from a superseded selection cannot publish a toast or inspect new film keys', async () => {
  const { submitGain } = await import('../../src/next/model/film-gain.ts');
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const port = await gainPort(12);
  let answer;
  port.command = async () => new Promise((resolve) => { answer = resolve; });
  port.unconfirmed = () => assert.fail('superseded response must not inspect the current selection keys');
  const submitted = session.begin(live());
  const result = submitGain(port, submitted, session);
  port.state.projectEpoch += 2; // A -> B -> A is still a superseded selection.
  answer({ commandId: 'late', headVersion: 13 });
  assert.equal((await result).kind, 'unconfirmed');
  assert.equal(port.actions.length, 0);
});

test('B18 music whose unknown save already landed remains reachable for exact keyed reconciliation', async t => {
  const { FixturePort } = await import('../../src/next/fixtures/fixture-port.ts');
  const { StudioStore } = await import('../../src/next/store/store.ts');
  const { displayedGain, gainComparison, submitGain } = await import('../../src/next/model/film-gain.ts');
  const fixture = new FixturePort();
  const projectId = fixture.world.snapshot.project.id;
  await fixture.request(`/api/projects/${projectId}/audio-library?role=music`);
  const posts = [], replies = new Map();
  let first = true, serial = 0;
  const client = {
    get closed() { return fixture.closed; }, events: fixture.events.bind(fixture),
    async request(path, options) {
      if (options?.method !== 'POST' || options.body?.field !== 'gainMilliDb') return fixture.request(path, options);
      posts.push({ path, key: options.key, body: options.body });
      // The disposable fixture has no keyed Film ledger; this fake server records exact receipts by request key.
      if (replies.has(options.key)) return replies.get(options.key);
      const receipt = await fixture.request(path, options);
      replies.set(options.key, receipt);
      if (first) { first = false; throw new TypeError('the saved level landed but its reply was lost'); }
      return receipt;
    },
  };
  const store = new StudioStore({ client, storage: null, newKey: () => `gain-landed-${++serial}` });
  t.after(() => { store.stop(); fixture.close(); });
  await store.start();
  const session = musicGainSession(store, projectId);
  const baseline = displayedGain(projectId, store.getState().snapshot, store.getState().overview);
  session.edit(baseline, -30);
  const submitted = session.begin(baseline);
  const lost = await submitGain(store, submitted, session);
  assert.equal(lost.kind, 'unconfirmed');
  session.complete(submitted, null, lost.kind);
  await store.refresh();
  const landed = displayedGain(projectId, store.getState().snapshot, store.getState().overview);
  assert.equal(landed.gainDb, -30);
  assert.equal(gainComparison(session.getSnapshot().draft, landed).kind, 'changed');
  assert.equal(session.getSnapshot().unconfirmed, true, 'Tools shows the retry instead of a field-conflict decision');
  assert.equal(session.getSnapshot().failed, true, 'no automatic repeat');
  const retry = session.begin(landed);
  assert.ok(retry, 'the held request remains reachable even though it changed the saved gain itself');
  const found = await submitGain(store, retry, session);
  assert.equal(found.kind, 'saved');
  assert.equal(posts.length, 2);
  assert.equal(posts[1].key, posts[0].key);
  assert.deepEqual(posts[1].body, posts[0].body);
  assert.equal(fixture.world.snapshot.project.headVersion, landed.headVersion, 'receipt replay makes no second change');
  session.complete(retry, found.receipt);
  assert.equal(session.getSnapshot().draft, null);
});

test('B18 checking an old music receipt preserves volume against a newer saved music value', async () => {
  const { submitGain } = await import('../../src/next/model/film-gain.ts');
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const port = await gainPort(12);
  port.answer = undefined; port.unknown = true;
  const submitted = session.begin(live());
  const lost = await submitGain(port, submitted, session);
  session.complete(submitted, null, lost.kind);
  // The original save landed at 13, then another writer chose -6 dB at 14 before its receipt was checked.
  port.state.snapshot.project.headVersion = port.state.overview.headVersion = 14;
  port.state.snapshot.project.soundtrack.gainMilliDb = -6000;
  port.answer = { commandId: 'original-receipt', headVersion: 13 }; port.unknown = false;
  const newer = live({ headVersion: 14, gainDb: -6 });
  const retry = session.begin(newer);
  const found = await submitGain(port, retry, session);
  assert.equal(found.kind, 'saved');
  session.complete(retry, found.receipt, 'refused', found.live);
  const draft = session.getSnapshot().draft;
  assert.ok(draft, 'checking the old receipt must not discard the desired volume against a newer different gain');
  assert.equal(draft.value, -30);
  assert.deepEqual(draft.baseline, live({ headVersion: 13, gainDb: -30 }));
  assert.equal(gainConflict(draft, newer), true);
  assert.equal(session.getSnapshot().unconfirmed, false);
  assert.deepEqual(port.posts[1].body, port.posts[0].body, 'checking the receipt never writes at the newer head');
});

test('B18 an old checked music receipt closes normally when newer heads preserve its saved level', () => {
  const session = musicGainSession({}, 'film-a');
  session.edit(live(), -30);
  const submitted = session.begin(live());
  session.complete(submitted, null, 'unconfirmed');
  const newer = live({ headVersion: 14, gainDb: -30 });
  const retry = session.begin(newer);
  session.complete(retry, { headVersion: 13 }, 'refused', newer);
  assert.equal(session.getSnapshot().draft, null, 'an unrelated head advance is still not a conflict');
});
