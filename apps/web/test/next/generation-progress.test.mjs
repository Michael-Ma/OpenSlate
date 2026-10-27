import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, lastFerryProposals, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { blockView, generationProgress, shotProgress } from '../../src/next/model/generation-progress.ts';
import { attentionItems } from '../../src/next/model/attention.ts';
import { applyDirectorPresets, fixtureMessage, FIXTURE_REPLY_MS } from '../../src/next/fixtures/fixture-director.ts';
import { FIXTURE_TIMING } from '../../src/next/fixtures/fixture-commands.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const quote = { micros: '80000', currency: 'USD', subscription: null };
const effect = (labels, scenes) => ({ kind: 'keyframes', sceneIds: scenes.map(sceneId), shotIds: labels.map(shotId), keyframes: labels.length, voiceLines: 0, quote, at: 'now' });
const withShot = (overview, label, change) => ({ ...overview, shots: { ...overview.shots, [shotId(label)]: change(overview.shots[shotId(label)]) } });
const failure = (extra = {}) => ({ code: 'PROVIDER_REFUSED', technical: false, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: 'now', ...extra });

/** A fixture world with a manual clock, so the scripted Director and its keyframes run on demand. */
function world() {
  const timers = [];
  let now = 0;
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector }, proposals: lastFerryProposals(),
    update(change) { change(w); const cursor = w.overview.cursor + 1; w.overview = { ...w.overview, cursor }; w.snapshot = { ...w.snapshot, cursor }; },
    later(ms, change) { timers.push({ at: now + ms, change }); },
    advance(ms) {
      const until = now + ms;
      for (;;) { timers.sort((a, b) => a.at - b.at); const next = timers[0]; if (!next || next.at > until) break; timers.shift(); now = next.at; w.update(next.change); }
      now = until;
    },
  };
  return w;
}

test('a shot follows its replacement while a new take is made, and a failure with retries left is still being made', () => {
  let overview = withShot(lastFerryOverview(), '2.1', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, replacement: { state: 'running' } } }));
  assert.equal(shotProgress(overview.shots[shotId('2.1')]).state, 'making');
  overview = withShot(overview, '2.2', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'failed', failure: failure({ technical: true, autoRetriesLeft: 2 }) } }));
  assert.equal(shotProgress(overview.shots[shotId('2.2')]).state, 'making');
  overview = withShot(overview, '2.3', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'failed', failure: failure({ charged: true }) } }));
  assert.deepEqual(shotProgress(overview.shots[shotId('2.3')]), { shotId: shotId('2.3'), label: '2.3', state: 'failed', charged: true });
});

test('progress counts the shots back, keeps Stop while any is on its way, and names the failed shot before the waiting one', () => {
  let overview = withShot(lastFerryOverview(), '2.2', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'no_answer', attemptId: 'a-1' } }));
  overview = withShot(overview, '2.3', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'failed', failure: failure() } }));
  const progress = generationProgress(effect(['2.1', '2.2', '2.3'], [2]), overview, 'en');
  assert.equal(progress.done, 1);
  assert.equal(progress.running, false);
  assert.equal(progress.scenes, '2');
  assert.equal(progress.next.shotId, shotId('2.3'));
  assert.equal(translateMsg('en', progress.next.text), '2.3 failed. Open it to see why, then make it again.');
  const running = generationProgress(effect(['2.1', '2.2'], [2]), withShot(overview, '2.2', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'running' } })), 'en');
  assert.equal(running.running, true);
  assert.equal(running.next, null);
  assert.equal(generationProgress({ ...effect(['2.1'], [2]), kind: 'transcription' }, overview, 'en'), null);
});

test('an ATTEMPT_EXISTS block points at the job to give up on, then says the scene can go ahead once it is settled', () => {
  const block = { kind: 'keyframes', sceneId: sceneId(1), code: 'ATTEMPT_EXISTS', shotIds: [shotId('1.2')], at: 'now',
    attempts: [{ attemptId: 'lost', shotId: shotId('1.2'), kind: 'video', phase: 'submission_unknown', action: 'human_release' }] };
  const stuck = withShot(lastFerryOverview(), '1.2', (shot) => ({ ...shot, video: { ...shot.video, state: 'no_answer', attemptId: 'lost' } }));
  const view = blockView(block, stuck);
  assert.equal(view.resolved, false);
  assert.deepEqual(view.open, { shotId: shotId('1.2'), label: '1.2' });
  assert.equal(translateMsg('zh-CN', view.title), '第 1 场在等 1.2 之前的视频任务');
  const settled = blockView(block, lastFerryOverview());
  assert.equal(settled.resolved, true);
  assert.equal(settled.open, null);
});

test('a stale-prompt block offers to ask the Director, as a draft the person sends', () => {
  const view = blockView({ kind: 'keyframes', sceneId: sceneId(2), code: 'STALE_PROMPT_INTENT', shotIds: [shotId('2.3')], at: 'now' }, lastFerryOverview());
  assert.deepEqual(view.ask.shotIds, [shotId('2.3')]);
  assert.equal(translateMsg('en', view.ask.text), 'Update the prompts for 2.3, then make their keyframes.');
  const other = blockView({ kind: 'keyframes', sceneId: sceneId(3), code: 'SCENE_NOT_READY', shotIds: [], at: 'now' }, lastFerryOverview());
  assert.equal(other.open, null);
  assert.equal(translateMsg('en', other.title), 'Scene 3 needs something first');
});

test('Needs attention lists unanswered jobs before failures, leaves out self-retrying ones, and is empty for the golden film', () => {
  assert.deepEqual(attentionItems(lastFerryOverview()), []);
  let overview = withShot(lastFerryOverview(), '3.2', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'failed', failure: failure() } }));
  overview = withShot(overview, '1.2', (shot) => ({ ...shot, video: { ...shot.video, state: 'no_answer', attemptId: 'lost' } }));
  overview = withShot(overview, '2.1', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'failed', failure: failure({ technical: true, autoRetriesLeft: 1 }) } }));
  const items = attentionItems(overview);
  assert.deepEqual(items.map((item) => [item.key, item.group]), [[`${shotId('1.2')}:video`, 'waiting'], [`${shotId('3.2')}:keyframe`, 'failed']]);
  assert.equal(translateMsg('zh-CN', items[1].detail), '未计费。打开看原因，再重新生成。');
});

test('the jobs preset: the scripted Director starts Scene 3, records Scene 1 as blocked by 1.2, and 3.2 comes back refused', () => {
  const w = world();
  applyDirectorPresets(w, ['jobs']);
  assert.equal(attentionItems(w.overview).length, 1);
  fixtureMessage(w, { text: 'Please make the keyframes.' });
  w.advance(FIXTURE_REPLY_MS);
  const turn = w.snapshot.turns.at(-1);
  assert.deepEqual(turn.effects.blocked.map((block) => [block.sceneId, block.code, block.attempts[0].action]), [[sceneId(1), 'ATTEMPT_EXISTS', 'human_release']]);
  const started = turn.effects.generation[0];
  assert.ok(started.sceneIds.includes(sceneId(3)) && !started.sceneIds.includes(sceneId(1)));
  w.advance(FIXTURE_TIMING.keyframeMs);
  const progress = generationProgress(started, w.overview, 'en');
  assert.equal(progress.shots.find((shot) => shot.shotId === shotId('3.2')).state, 'failed');
  assert.equal(progress.next.shotId, shotId('3.2'));
  assert.deepEqual(attentionItems(w.overview).map((item) => item.key), [`${shotId('1.2')}:video`, `${shotId('3.2')}:keyframe`]);
});

test('only the newest line that started a shot stays live; an earlier one keeps its plain summary', async () => {
  const { threadView } = await import('../../src/next/model/director.ts');
  const snapshot = lastFerrySnapshot();
  const reply = (id) => ({ id: `${id}-reply`, role: 'assistant', text: 'Starting the keyframes now.', requestId: id, at: '2026-10-27T10:50:00Z' });
  const turn = (id, labels) => ({ id: `${id}-turn`, requestId: id, state: 'completed', runtime: 'scripted', action: 'conversation',
    effects: { notesCreated: 0, proposalsHeld: 0, changesApplied: 0, generation: [effect(labels, [2])] } });
  const both = { ...snapshot, conversation: [...(snapshot.conversation ?? []), reply('r1'), reply('r2')], turns: [...(snapshot.turns ?? []), turn('r1', ['2.1', '2.2']), turn('r2', ['2.2'])] };
  const lines = threadView(both, lastFerryOverview(), lastFerryDirector, 'en', new Date(), []).entries.flatMap((entry) => entry.generation);
  assert.deepEqual(lines.map((line) => !!line.progress), [false, true]);
  assert.equal(translateMsg('en', lines[0].text), 'Started 2 keyframes in Scene 2 · about $0.08');
});
