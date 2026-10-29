import test from 'node:test';
import assert from 'node:assert/strict';
import { change, conflicts, hold, shown } from '../../src/next/model/plan-conflict.ts';
import { directorForm, directorFormConflict, directorRequest } from '../../src/next/model/settings-director.ts';
import { displayedHead } from '../../src/next/model/displayed-baseline.ts';
import { lastFerrySnapshot, lastFerryOverview } from '../../src/next/fixtures/last-ferry.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import * as voice from '../../src/next/model/settings-voice.ts';
import { ApiError } from '../../src/next/api/client.ts';

const value = { label: 'My voice', provider: 'openai', voiceId: 'voice_mine', ownVoice: true, permitSynthesis: true };

test('B18 audit: new voice registration rebases to the current displayed head without a false field conflict', () => {
  const opened = { value, submittedHeadVersion: 12 };
  const prepared = voice.prepareVoiceRegistration(opened, 13, () => false);
  assert.equal(prepared.request.body.expectedHeadVersion, 13);
  assert.equal(prepared.submitted.submittedHeadVersion, 13);
  assert.equal(prepared.submitted.value, opened.value, 'all words, provider identity and both consents remain');
  assert.deepEqual(prepared.request.body, { expectedHeadVersion: 13, label: 'My voice', provider: 'openai', providerVoiceId: 'voice_mine', ownVoice: true, permitSynthesis: true });
});

test('B18 audit: registration waits quietly for agreeing projections and never invents a first head', () => {
  const opened = { value };
  assert.equal(voice.prepareVoiceRegistration(opened, null, () => assert.fail('waiting must not prepare a write')), null);
  assert.equal(opened.submittedHeadVersion, undefined);
  const prepared = voice.prepareVoiceRegistration(opened, 13, () => assert.fail('first submission cannot be a replay'));
  assert.equal(prepared.submitted.submittedHeadVersion, 13);
});

test('B18 audit: an unknown registration retries its actual submitted head only for the exact same logical body', () => {
  const submitted = { value, submittedHeadVersion: 13 };
  const sent = voice.registerRequest(value, 13).body;
  const same = body => JSON.stringify(body) === JSON.stringify(sent);
  assert.equal(voice.prepareVoiceRegistration(submitted, 14, same).request.body.expectedHeadVersion, 13);
  const newer = { ...submitted, value: { ...value, label: 'New words after the send' } };
  assert.equal(voice.prepareVoiceRegistration(newer, 14, same).request.body.expectedHeadVersion, 14);
  assert.equal(newer.value.label, 'New words after the send');
  assert.equal(voice.prepareVoiceRegistration(submitted, null, same), null, 'mismatched projections keep the draft and await the next human press');
});

test('B18 audit: a definite stale-head refusal lets the next registration press use the fresh head', () => {
  const opened = { value };
  const first = voice.prepareVoiceRegistration(opened, 12, () => false);
  // A definite server refusal settles the command identity; the form keeps its actual first submission.
  const next = voice.prepareVoiceRegistration(first.submitted, 13, () => false);
  assert.equal(first.submitted.submittedHeadVersion, 12);
  assert.equal(next.request.body.expectedHeadVersion, 13);
  assert.equal(next.submitted.value, value);
});

test('B18 audit: Plan compares only edited values and follows unrelated saved fields', () => {
  const original = { prompt: 'Original prompt', motion: 'Static', seconds: 6 };
  const draft = change(hold(original), original, 'prompt', 'My typed prompt');
  const unrelated = { ...original, motion: 'Slow pan', seconds: 8 };
  assert.deepEqual(conflicts(draft, unrelated), []);
  assert.deepEqual(shown(draft, unrelated), { ...unrelated, prompt: 'My typed prompt' });
  assert.deepEqual(conflicts(draft, { ...unrelated, prompt: 'Another saved prompt' }), ['prompt']);
  assert.deepEqual(conflicts(draft, { ...unrelated, prompt: 'My typed prompt' }), [], 'already matching saved words need no conflict choice');
});

test('B18 audit: Director selection digest survives unrelated storyboard heads and conflicts only after selection changes', async t => {
  const port = new FixturePort();
  const store = new StudioStore({ client: port, storage: null, newKey: () => crypto.randomUUID() });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  const head = store.getState().snapshot.project.headVersion;
  const setup = await store.read('/director/setup');
  const form = directorForm(setup);
  await store.edit({ kind: 'shot', id: 'shot-2-1', field: 'motion', value: 'Pan toward the boat' });
  await store.refresh();
  const updated = await store.read('/director/setup');
  assert.ok(store.getState().snapshot.project.headVersion > head);
  assert.equal(updated.selectionDigest, setup.selectionDigest);
  assert.equal(directorFormConflict(form, updated), false);
  const request = directorRequest(updated, updated.selection.mode === 'fake' ? { mode: 'native', binaryPath: '/usr/local/bin/codex', model: 'test-model' } : { mode: 'fake' });
  await store.command('b18-audit-director', request.body, () => request);
  assert.equal(directorFormConflict(form, await store.read('/director/setup')), true);
});

test('B18 audit: Film instant controls wait only while displayed projections actually disagree', () => {
  const snapshot = lastFerrySnapshot(), overview = lastFerryOverview(), id = overview.projectId;
  assert.equal(displayedHead(id, snapshot, overview), 12);
  assert.equal(displayedHead(id, { ...snapshot, cursor: snapshot.cursor + 1 }, overview), 12, 'ordinary refresh activity is not a draft conflict');
  const laterSnapshot = { ...snapshot, project: { ...snapshot.project, headVersion: 13 } };
  assert.equal(displayedHead(id, laterSnapshot, overview), null);
  assert.equal(displayedHead(id, laterSnapshot, { ...overview, headVersion: 13 }), 13);
});


test('B18 audit: a landed registration with a lost reply replays its exact key/body after unrelated generation advances the head', async t => {
  const port = new FixturePort(), sent = [], receipts = new Map();
  let lose = true;
  const client = {
    get closed() { return port.closed; },
    events: port.events.bind(port),
    async request(path, options) {
      if (options?.method === 'POST' && path.endsWith('/narration/personal-voices')) {
        sent.push({ key: options.key, body: options.body });
        // FixturePort's settings routes do not implement server idempotency, so this fake transport
        // explicitly models the production route's receipt replay before checking the current head.
        const prior = receipts.get(options.key);
        if (prior) { assert.deepEqual(options.body, prior.body); return prior.receipt; }
        const receipt = await port.request(path, options);
        receipts.set(options.key, { body: structuredClone(options.body), receipt });
        if (lose) { lose = false; throw new ApiError('NETWORK_ERROR'); }
        return receipt;
      }
      return port.request(path, options);
    },
  };
  const store = new StudioStore({ client, storage: null, newKey: () => crypto.randomUUID() });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  const head = () => { const s = store.getState(); return displayedHead(s.projectId, s.snapshot, s.overview); };
  const prepare = form => voice.prepareVoiceRegistration(form, head(), logical => store.wouldResend('settings:voice-register', logical));
  const first = prepare({ value });
  assert.equal(await store.command('settings:voice-register', first.request.body, () => first.request), undefined);
  await store.edit({ kind: 'shot', id: 'shot-2-1', field: 'motion', value: 'Another shot finished moving' });
  await store.refresh();
  assert.equal(head(), 13);
  const retry = prepare(first.submitted);
  assert.equal(retry.request.body.expectedHeadVersion, 12);
  assert.ok(await store.command('settings:voice-register', retry.request.body, () => retry.request));
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], 'human retry reconciles the same idempotent command even at a newer head');
  const registered = await store.read('/narration/personal-voices');
  assert.equal(registered.voices.filter(v => v.id === 'openai-custom:voice_mine').length, 1);
});


test('B18 audit: narrator Undo quietly waits for read coherence and reoffers the same human callback', async () => {
  const origin = { projectId: 'film-a', projectEpoch: 1 }, offers = [], commands = [], messages = [];
  let waiting = true, reloads = 0, saved = 0;
  const store = {
    getState: () => origin,
    read: async path => path.endsWith('/settings/voice') ? { narratorVoice: 'marin', headVersion: 14 } : { voices: [], headVersion: waiting ? 13 : 14 },
    command: async (...args) => { commands.push(args); return {}; },
    dispatch: action => messages.push(action),
    toastUndo: (message, run) => offers.push({ message, run }),
  };
  const message = { id: 'set.toast.narrator', values: { name: 'Marin' } };
  voice.offerNarratorUndo(store, origin, { previous: 'cedar', set: 'marin' }, message, { reload: () => reloads++, saved: () => saved++ });
  assert.equal(offers.length, 1);
  await offers[0].run();
  assert.equal(commands.length, 0);
  assert.deepEqual(messages, [], 'waiting is not a refusal toast');
  assert.equal(reloads, 1);
  assert.equal(offers.length, 2);
  assert.equal(offers[1].run, offers[0].run, 'Undo is reoffered after the store dismisses its previous callback');
  assert.equal(offers[1].message, message);
  waiting = false;
  await offers[1].run();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0][1], { narratorVoice: 'cedar', expectedHeadVersion: 14 });
  assert.equal(saved, 1);
  assert.equal(offers.length, 2, 'one fresh human press makes one write without an automatic loop');
});

test('B18 audit: a narrator Undo whose reads finish in a new epoch cannot reoffer or write', async () => {
  const origin = { projectId: 'film-a', projectEpoch: 1 }, offers = [];
  let state = origin, resolve;
  const pending = new Promise(done => { resolve = done; });
  const store = {
    getState: () => state,
    read: async path => path.endsWith('/settings/voice') ? pending : { voices: [], headVersion: 13 },
    command: async () => assert.fail('superseded Undo must not write'),
    dispatch: () => assert.fail('superseded Undo must not replace the toast'),
    toastUndo: (message, run) => offers.push({ message, run }),
  };
  voice.offerNarratorUndo(store, origin, { previous: 'cedar', set: 'marin' }, { id: 'set.toast.narrator' }, { reload: () => assert.fail('superseded Undo must not reload current resources'), saved: () => assert.fail('superseded Undo must not move focus') });
  const undoing = offers[0].run();
  state = { projectId: 'film-a', projectEpoch: 3 };
  resolve({ narratorVoice: 'marin', headVersion: 14 });
  await undoing;
  assert.equal(offers.length, 1);
});
