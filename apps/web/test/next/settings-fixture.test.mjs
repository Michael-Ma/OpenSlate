import test from 'node:test';
import assert from 'node:assert/strict';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { PROJECT_ID } from '../../src/next/fixtures/last-ferry.ts';
import { applyRequest, impactOf, modelRows, previewCurrent, previewRequest } from '../../src/next/model/settings.ts';
import { directorRequest, reviewRequest, selectionFor } from '../../src/next/model/settings-director.ts';
import { narratorRequest, registerRequest, revokeRequest } from '../../src/next/model/settings-voice.ts';
import { StudioStore } from '../../src/next/store/store.ts';

const en = (m) => translateMsg('en', m);

async function studio() {
  const port = new FixturePort();
  let n = 0;
  const store = new StudioStore({ client: port, storage: null, newKey: () => `key-${++n}` });
  await store.start();
  return { port, store, close: () => { store.stop(); port.close(); } };
}

test('the sample film reads every settings route the view needs', async () => {
  const { store, close } = await studio();
  try {
    const status = await store.read('/settings/models');
    assert.equal(status.projectId, PROJECT_ID);
    const rows = modelRows(status, 'en');
    assert.deepEqual(rows.map((r) => en(rows.find((x) => x.kind === r.kind).choices.find((c) => c.value === r.selected).name)), ['OpenAI gpt-image-2', 'MiniMax H3', 'OpenAI gpt-4o-mini-tts', 'OpenAI whisper-1']);
    assert.equal((await store.read('/api/providers')).profiles.length, 10);
    assert.equal((await store.read('/director/setup')).selection.mode, 'native');
    assert.deepEqual(await store.read('/settings/director-review'), { enabled: true });
    assert.equal((await store.read('/settings/voice')).narratorVoice, 'cedar');
    assert.equal((await store.read('/narration/personal-voices')).voices[0].label, 'Michael (my voice)');
  } finally { close(); }
});

test('switching video to the demo shows its impact first, then applies (design state "switch")', async () => {
  const { store, port, close } = await studio();
  try {
    const status = await store.read('/settings/models');
    const request = previewRequest(status, 'video', 'fake-video-v1');
    const preview = await store.command('p', request.body, () => request);
    const labels = Object.fromEntries(Object.values(port.world.overview.shots).map((s) => [s.shotId, s.label]));
    const impact = impactOf(preview, 'video', labels, 'en');
    assert.equal(translate('en', impact.titleId, { model: 'Demo video' }), 'Use Demo video for video?');
    assert.equal(en(impact.lines[0]), '5 clips not made yet (2.1, 2.2, 2.3, 3.1, 3.2) would use it.');
    assert.equal(en(impact.lines[1]), 'The 3 clips already made stay as they are.');
    // Nothing changed yet.
    assert.equal((await store.read('/settings/models')).selected.video, 'minimax-h3');
    const cursor = port.world.overview.cursor;
    const apply = applyRequest(preview);
    const result = await store.command('a', apply.body, () => apply);
    assert.equal(result.status.selected.video, 'fake-video-v1');
    assert.ok(port.world.overview.cursor > cursor, 'applying moves the event cursor so views re-read');
    assert.equal(previewCurrent(preview, result.status), false, 'an applied preview is no longer current');
    // Applying the same preview again is refused as stale.
    await store.command('a2', { again: true }, () => apply);
    assert.equal(store.getState().toast?.message.id, 'error.MODEL_SETTINGS_STALE');
  } finally { close(); }
});

test('a switch checked before a job started or finished is refused as stale, like the server', async () => {
  const { store, port, close } = await studio();
  try {
    const status = await store.read('/settings/models');
    const request = previewRequest(status, 'image', 'codex-image');
    const preview = await store.command('p', request.body, () => request);
    const cursor = port.world.overview.cursor;
    // Shot 3.1's keyframe starts: the settings are unchanged, the pending work is not.
    const shot = Object.values(port.world.overview.shots).find((s) => s.label === '3.1');
    port.world.update((w) => { w.overview = { ...w.overview, shots: { ...w.overview.shots, [shot.shotId]: { ...shot, keyframe: { ...shot.keyframe, state: 'running', phase: 'running', startedAt: '2026-10-15T10:00:00.000Z', attemptId: 'attempt-x' } } } }; });
    assert.ok(port.world.overview.cursor > cursor, 'the change is an event');
    const after = await store.read('/settings/models');
    assert.equal(previewCurrent(preview, after), true, 'the settings are unchanged, so the row keeps Switch; the server judges the work on apply');
    const apply = applyRequest(preview);
    assert.equal(await store.command('a', apply.body, () => apply), undefined);
    assert.equal(store.getState().toast?.message.id, 'error.MODEL_SETTINGS_STALE');
    // A fresh check applies.
    const again = previewRequest(after, 'image', 'codex-image');
    const fresh = await store.command('p2', again.body, () => again);
    const applyFresh = applyRequest(fresh);
    assert.equal((await store.command('a2', applyFresh.body, () => applyFresh)).status.selected.image, 'codex-image');
  } finally { close(); }
});

test('keyframe and narration impacts match the design', async () => {
  const { store, port, close } = await studio();
  try {
    const status = await store.read('/settings/models');
    const labels = Object.fromEntries(Object.values(port.world.overview.shots).map((s) => [s.shotId, s.label]));
    const lines = async (kind, id) => {
      const request = previewRequest(status, kind, id);
      return impactOf(await store.command(`p-${kind}`, request.body, () => request), kind, labels, 'en').lines.map(en);
    };
    assert.deepEqual((await lines('image', 'codex-image')).slice(0, 2), ['2 keyframes not made yet (3.1, 3.2) would use it.', 'The 6 keyframes already made stay as they are.']);
    assert.deepEqual((await lines('speech', 'fake-speech-v1')).slice(0, 2), ['1 line with no voice yet (3.2) would use it.', 'The 2 voice lines already made stay.']);
    assert.equal((await lines('transcription', 'fake-transcription-v1'))[0], 'Nothing is waiting to be made for this job, so only new work will use it.');
  } finally { close(); }
});

test('the Director switches for its next turn; the review setting stays and can be changed with any Director, like the server', async () => {
  const { store, close } = await studio();
  try {
    const setup = await store.read('/director/setup');
    const request = directorRequest(setup, selectionFor(setup, 'fake'));
    assert.equal(request.path, '/director/change');
    const after = await store.command('d', request.body, () => request);
    assert.equal(after.selection.mode, 'fake');
    assert.deepEqual(await store.read('/settings/director-review'), { enabled: true });
    const head = store.getState().snapshot.project.headVersion;
    const disable = reviewRequest(false, head);
    assert.deepEqual(await store.command('r', disable.body, () => disable), { enabled: false });
    assert.equal(store.getState().snapshot.project.headVersion, head, 'the setting does not move the head version');
    const enable = reviewRequest(true, head);
    assert.deepEqual(await store.command('r2', enable.body, () => enable), { enabled: true });
    const old = reviewRequest(false, head - 1);
    assert.equal(await store.command('r3', old.body, () => old), undefined);
    assert.equal(store.getState().toast?.message.id, 'error.REVISION_CONFLICT');
    const stale = directorRequest(setup, selectionFor(setup, 'native:gpt-6-astra'));
    assert.equal(await store.command('d2', stale.body, () => stale), undefined, 'a change bound to an old selection is refused');
    assert.equal(store.getState().toast?.message.id, 'error.DIRECTOR_SELECTION_STALE');
  } finally { close(); }
});

test('narrator voice, personal voice registration with both consents, and revoke', async () => {
  const { store, close } = await studio();
  try {
    const head = () => store.getState().snapshot.project.headVersion;
    const set = narratorRequest('marin', head());
    await store.command('n', set.body, () => set);
    assert.equal((await store.read('/settings/voice')).narratorVoice, 'marin');
    await store.refresh();
    const register = registerRequest({ label: 'Second take', provider: 'openai', voiceId: 'voice_take2', ownVoice: true, permitSynthesis: true }, head());
    const { voice } = await store.command('v', register.body, () => register);
    assert.equal(voice.state, 'registered');
    const narrate = narratorRequest(voice.id, head());
    await store.command('n2', narrate.body, () => narrate);
    assert.equal((await store.read('/settings/voice')).narratorVoice, 'openai-custom:voice_take2');
    const revoke = revokeRequest(voice.identityId);
    await store.command('x', revoke.body, () => revoke);
    const voices = (await store.read('/narration/personal-voices')).voices;
    assert.equal(voices.find((v) => v.identityId === voice.identityId).state, 'revoked');
    await store.refresh();
    const again = narratorRequest(voice.id, head());
    assert.equal(await store.command('n3', again.body, () => again), undefined);
    assert.equal(store.getState().toast?.message.id, 'error.PERSONAL_VOICE_REVOKED');
  } finally { close(); }
});
