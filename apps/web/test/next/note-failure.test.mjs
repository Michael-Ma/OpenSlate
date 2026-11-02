import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, lastFerryNotes, lastFerrySnapshot, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { noteViews, sceneOpenNotes, regenerationSummary } from '../../src/next/model/notes.ts';
import { noteBanner, noteCallout } from '../../src/next/model/note-banner.ts';
import { runNoteRegeneration } from '../../src/next/model/note-command.ts';
import { keyframesView } from '../../src/next/model/keyframes.ts';
import { threadView } from '../../src/next/model/director.ts';
import { planOutline } from '../../src/next/model/plan.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = value => translateMsg('en', value), zh = value => translateMsg('zh-CN', value);
const failure = { code: 'GENERATION_FAILED', technical: true, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: 'now' };
const idle = { mode: 'fake', status: 'idle', activeRequestId: null };
function failedNote(replacement = false) {
  const overview = lastFerryOverview(), shot = overview.shots[shotId('2.2')];
  if (replacement) shot.keyframe.replacement = { state: 'failed', failure };
  else shot.keyframe = { state: 'failed', previous: shot.keyframe.artifact, takeCount: 1, opened: false, failure };
  const note = lastFerryNotes().find(note => note.letter === 'a');
  Object.assign(note, { state: 'resolved', resolution: { choiceIndex: 1, at: 'now', resultRef: 'failed-request' } });
  return { overview, shot, note, view: noteViews([note], overview)[0] };
}

for (const replacement of [false, true]) test(`B21 #1 failed ${replacement ? 'replacement over a retained frame' : 'regeneration'} is neutral and keeps a priced retry`, () => {
  const { overview, shot, note, view } = failedNote(replacement);
  assert.equal(en(view.settled), 'Regeneration failed for 2.2.');
  assert.equal(zh(view.settled), '2.2 重新生成失败。');
  assert.equal(view.regeneration, 'failed');
  assert.equal(view.making, false);
  assert.deepEqual(sceneOpenNotes([view], sceneId(2)), [view], 'a failed request remains reachable after Next or reopening the film');
  const snapshot = lastFerrySnapshot(); snapshot.notes = [note];
  const threadNote = threadView(snapshot, overview, idle, 'en', new Date('2026-10-14T12:00:00')).entries[1].notes[0];
  assert.equal(threadNote.tone, 'failed', 'the thread must not render a green completed check');
  const banner = noteBanner(view, overview, [], 'en-US');
  assert.equal(banner.state, 'open');
  assert.equal(en(banner.eyebrow), "Director's note");
  assert.equal(en(banner.sub[0]), 'Regeneration failed for 2.2.');
  assert.deepEqual(banner.actions.map(action => [action.action.kind, action.enabled]), [['accept', false], ['regenerate', true]], 'the existing resolution cannot be accepted again, but a new paid request is possible');
  assert.equal(en(banner.actions[1].price), 'about $0.04');
  const callout = noteCallout(view, shot.shotId, overview, 'en-US');
  assert.equal(callout.done, false);
  assert.equal(callout.doneLabel, null);
  assert.equal(callout.regenerate.enabled, true);
  assert.equal(en(callout.regenerate.price), 'about $0.04');
  assert.equal(noteBanner(view, overview, [], 'en-US', 1).state, 'open', 'a just-chosen local banner also recovers after failure');
});

test('B21 #1 failures name their affected targets before other regeneration progress', () => {
  const { overview, shot } = failedNote(true);
  overview.shots[shotId('2.1')].keyframe.state = 'running';
  const summary = regenerationSummary(overview, [shotId('2.1'), shot.shotId]);
  assert.equal(en(summary), 'Regeneration failed for 2.2.');
});

test('B21 #1 Plan chips also reserve their completed check for a returned regeneration', () => {
  const { overview, note } = failedNote(true);
  const snapshot = lastFerrySnapshot(); snapshot.notes = [note];
  const chip = planOutline(snapshot, overview).scenes[1].shots[1].notes[0];
  assert.equal(chip.done, false);
});

test('B21 #1 a resolved-note retry creates one new request without attempting a refused second resolution', async () => {
  const { overview, shot, note, view } = failedNote(true);
  const calls = [], state = { projectId: overview.projectId, projectEpoch: 1, snapshot: { notes: [note] }, overview };
  const store = {
    getState: () => state,
    regenerateKeyframe: async id => { calls.push(['regenerate', id]); return { requestId: 'new-request' }; },
    makeKeyframes: async () => { throw new Error('single-shot retry uses its exact quote'); },
    resolveNote: async () => { calls.push(['resolve']); throw new Error('a resolved note cannot be resolved again'); },
  };
  assert.equal(await runNoteRegeneration(store, overview, view.choices[1].action), true);
  assert.deepEqual(calls, [['regenerate', shot.shotId]]);
  assert.equal(note.resolution.resultRef, 'failed-request', 'the original result remains historical evidence');
});

test('B21 #1 failed-note retry still guards unknown outcomes, real work and missing prices', () => {
  for (const block of ['unknown', 'working', 'price']) {
    const { overview, shot, view } = failedNote(true);
    if (block === 'unknown') shot.video = { state: 'no_answer', attemptId: 'unknown', takeCount: 0 };
    if (block === 'working') shot.video = { state: 'running', attemptId: 'working', takeCount: 0 };
    if (block === 'price') { delete shot.quotes; delete overview.scenes[1].quotes.regenerateKeyframe; }
    assert.equal(noteBanner(view, overview, [], 'en-US').actions[1].enabled, false, block);
    assert.equal(noteCallout(view, shot.shotId, overview, 'en-US').regenerate.enabled, false, block);
  }
});

test('B21 #1 a failed technical candidate with automatic retries keeps note purchases disabled', () => {
  for (const replacement of [false, true]) {
    const { overview, shot, note } = failedNote(replacement);
    const pending = replacement ? shot.keyframe.replacement : shot.keyframe;
    pending.failure = { ...failure, technical: true, autoRetriesLeft: 2 };
    const [view] = noteViews([note], overview);
    const action = noteBanner(view, overview, [], 'en-US').actions[1];
    assert.equal(action.enabled, false, `automatic retry guard, retained replacement ${replacement}`);
    assert.equal(en(action.price), 'about $0.04', 'the future human purchase keeps its price');
    const callout = noteCallout(view, shot.shotId, overview, 'en-US');
    assert.equal(callout.done, false);
    assert.equal(callout.regenerate.enabled, false);
    assert.equal(callout.regenerate.wait.id, 'inspector.failed.retrying');
    assert.equal(en(view.settled), 'Regeneration failed for 2.2.');
  }
});

test('B21 #1 completed wording and checks require a returned keyframe', () => {
  const { overview, shot, note } = failedNote(true);
  for (const state of ['none', 'outdated']) {
    shot.keyframe = { state, takeCount: 1, opened: false };
    const [view] = noteViews([note], overview);
    assert.doesNotMatch(en(view.settled), /regenerated/);
    assert.equal(noteCallout(view, shot.shotId, overview, 'en-US').done, false);
  }
  shot.keyframe = lastFerryOverview().shots[shot.shotId].keyframe;
  const [view] = noteViews([note], overview);
  assert.equal(en(view.settled), 'Settled: 2.2 regenerated');
  assert.equal(noteCallout(view, shot.shotId, overview, 'en-US').done, true);
});

test('B21 #2 a short failed narration names its shot in the scene check row', () => {
  const overview = lastFerryOverview(), scene = overview.scenes[0];
  overview.shots[shotId('1.2')].narration = { state: 'failed', text: 'One ticket.', estimatedSeconds: 0.6, fits: true };
  scene.state = 'needs_attention';
  const view = keyframesView(overview, scene.sceneId, null, 'en-US');
  assert.deepEqual(view.checks, [], 'a short failed line has no length check to hide the erroneous all-clear');
  assert.equal(en(view.attention), 'The voice line failed for 1.2.');
  assert.equal(zh(view.attention), '1.2 的配音失败。');
});

test('B21 #2 scene narration attention stays local, lists failures and preserves unknown-outcome priority', () => {
  const overview = lastFerryOverview(), scene = overview.scenes[0];
  for (const label of ['1.1', '1.2', '2.2']) overview.shots[shotId(label)].narration.state = 'failed';
  assert.equal(en(keyframesView(overview, scene.sceneId, null, 'en-US').attention), 'The voice line failed for 1.1 and 1.2.');
  assert.equal(zh(keyframesView(overview, scene.sceneId, null, 'zh-CN').attention), '1.1 和 1.2 的配音失败。');
  overview.shots[shotId('1.3')].video = { state: 'no_answer', attemptId: 'uncertain', takeCount: 0 };
  assert.match(en(keyframesView(overview, scene.sceneId, null, 'en-US').attention), /No answer.*1\.3.*may still arrive and be charged/);
  overview.shots[shotId('1.3')].video = { state: 'none', takeCount: 0 };
  overview.shots[shotId('1.1')].narration.state = 'none'; overview.shots[shotId('1.2')].narration.state = 'ready';
  assert.equal(keyframesView(overview, scene.sceneId, null, 'en-US').attention, null);
});
