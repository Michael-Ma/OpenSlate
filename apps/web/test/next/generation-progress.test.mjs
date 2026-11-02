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
  const { shotId: id, label, state, charged, part } = shotProgress(overview.shots[shotId('2.3')]);
  assert.deepEqual({ id, label, state, charged, part }, { id: shotId('2.3'), label: '2.3', state: 'failed', charged: true, part: 'keyframe' });
});

test('progress also follows the voice lines the turn started; a voice-only turn is counted in voice lines', () => {
  const voiced = (overview, label, narration) => withShot(overview, label, (shot) => ({ ...shot, narration: { ...shot.narration, ...narration } }));
  // Scene 2: 2.2's keyframe is made with its voice line, 2.3 only needs its voice line (its keyframe is back).
  let overview = withShot(lastFerryOverview(), '2.2', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'running' } }));
  overview = voiced(overview, '2.2', { state: 'making', attemptId: 'v-2' });
  overview = voiced(overview, '2.3', { state: 'making', attemptId: 'v-3' });
  const mixed = { ...effect(['2.2', '2.3'], [2]), keyframes: 1, voiceLines: 2 };
  let progress = generationProgress(mixed, overview, 'en');
  assert.deepEqual([progress.media, progress.done, progress.total, progress.running], ['keyframes', 0, 1, true]);
  assert.deepEqual(progress.shots.map((s) => [s.label, s.state, s.part]), [['2.2', 'making', 'keyframe'], ['2.3', 'making', 'voice']]);
  // The keyframe is back and 2.3's voice line failed: 1/1 keyframes, and the voice line is the next step.
  overview = withShot(overview, '2.2', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'ready' } }));
  overview = voiced(overview, '2.2', { state: 'ready', attemptId: undefined });
  overview = voiced(overview, '2.3', { state: 'failed', attemptId: undefined, failure: failure() });
  progress = generationProgress(mixed, overview, 'en');
  assert.deepEqual([progress.done, progress.total, progress.allDone, progress.running], [1, 1, false, false]);
  assert.equal(progress.next.shotId, shotId('2.3'));
  assert.equal(translateMsg('en', progress.next.text), "2.3's voice line failed. Open the shot to see why.");
  assert.equal(translateMsg('zh-CN', progress.next.text), '2.3 的配音失败了，打开这个镜头看原因。');
  // A voice line still being made keeps Stop next to a failed keyframe of the same shot.
  const both = voiced(withShot(overview, '2.2', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'failed', failure: failure() } })), '2.2', { state: 'making' });
  assert.equal(generationProgress(mixed, both, 'en').running, true);
  // Voice lines only: the turn still gets progress, counted in voice lines; an unanswered one can be given up.
  const voiceOnly = { ...effect(['2.3'], [2]), keyframes: 0, voiceLines: 1 };
  const waiting = generationProgress(voiceOnly, voiced(lastFerryOverview(), '2.3', { state: 'no_answer', attemptId: 'v-9' }), 'en');
  assert.deepEqual([waiting.media, waiting.done, waiting.total, waiting.shots[0].state, waiting.shots[0].keyframe], ['voices', 0, 1, 'no_answer', null]);
  assert.match(translateMsg('en', waiting.next.text), /^2\.3's voice line is waiting for the service's answer\. Open the shot to give up on it/);
  const back = generationProgress(voiceOnly, voiced(lastFerryOverview(), '2.3', { state: 'ready' }), 'en');
  assert.deepEqual([back.done, back.allDone, back.running, back.next], [1, true, false, null]);
});

test('a queue that will not run is waiting, not queued, so Stop goes away; a keyframe given up says so', () => {
  const queued = (code) => withShot(lastFerryOverview(), '2.2', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'queued', waiting: { code, since: 'now' } } }));
  const one = (overview) => generationProgress(effect(['2.2'], [2]), overview, 'en');
  assert.deepEqual([one(queued('capacity')).shots[0].state, one(queued('capacity')).running], ['queued', true]);
  for (const code of ['review', 'unknown', 'timing', 'input_pending'])
    assert.deepEqual([one(queued(code)).shots[0].state, one(queued(code)).running], ['waiting', false], code);
  assert.equal(one(queued('stopped')).shots[0].state, 'stopped');
  const off = (takenOff) => one(withShot(lastFerryOverview(), '2.2', (shot) => ({ ...shot, keyframe: { ...shot.keyframe, state: 'none', takenOff } }))).shots[0].state;
  assert.deepEqual([off('released'), off('stopped')], ['given_up', 'stopped']);
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
  assert.equal(blockView({ kind: 'keyframes', sceneId: sceneId(1), code: 'ALREADY_COMPLETE', shotIds: [], at: 'now' }, lastFerryOverview()), null);
  const direction = blockView({ kind: 'keyframes', sceneId: sceneId(2), code: 'DIRECTION_REQUIRED', shotIds: [shotId('2.2')], at: 'now' }, lastFerryOverview());
  assert.equal(translateMsg('zh-CN', direction.title), '2.2 还没有画面描述');
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

test('a voice line whose reply was lost says it may be charged, in its row, its state and Needs attention', async () => {
  const { slotNote, narrationRow, voiceFailureKind } = await import('../../src/next/model/narration.ts');
  const lost = failure({ code: 'SUBMISSION_RESPONSE_LOST', technical: true, charged: true });
  const overview = withShot(lastFerryOverview(), '2.3', (shot) => ({ ...shot, narration: { ...shot.narration, state: 'failed', failure: lost } }));
  const shot = overview.shots[shotId('2.3')];
  assert.equal(voiceFailureKind(shot.narration), 'lost');
  assert.match(translateMsg('zh-CN', slotNote(shot, 'voice').message), /可能已经扣费/);
  assert.ok(narrationRow(shot, 24, 'voice').notes.some((note) => translateMsg('en', note.message) === 'The voice line got no reply · may be charged'));
  const [item] = attentionItems(overview);
  assert.equal(item.key, `${shotId('2.3')}:voice`);
  assert.match(translateMsg('en', item.detail), /^The service never replied, so it may be charged/);
  // Not charged, and an older server that sends no failure, keep their own words.
  const free = withShot(lastFerryOverview(), '2.3', (s) => ({ ...s, narration: { ...s.narration, state: 'failed', failure: failure() } }));
  assert.equal(translateMsg('en', attentionItems(free)[0].detail), "Not charged. It is made again with the scene's next keyframes or video.");
  const bare = withShot(lastFerryOverview(), '2.3', (s) => ({ ...s, narration: { ...s.narration, state: 'failed' } }));
  assert.equal(voiceFailureKind(bare.shots[shotId('2.3')].narration), null);
  // A voice line waiting for an answer offers Give up only when it can be let go.
  const waiting = withShot(lastFerryOverview(), '2.3', (s) => ({ ...s, narration: { ...s.narration, state: 'no_answer' } }));
  assert.equal(translateMsg('en', attentionItems(waiting)[0].detail), 'It may still arrive.');
});

test('a transcription line follows its live outcome, and an older server keeps "Started…"', async () => {
  const { generationLines } = await import('../../src/next/model/director.ts');
  const base = { kind: 'transcription', sceneIds: [], shotIds: [], keyframes: 0, voiceLines: 0, quote: { micros: '6000', units: 1, unitMicros: '6000', priceUnknown: false }, at: 'now' };
  const say = (transcription) => { const [line] = generationLines([{ ...base, ...(transcription ? { transcription } : {}) }], lastFerryOverview(), 'en'); return [translateMsg('en', line.text), line.running, line.outcome]; };
  assert.deepEqual(say(undefined).slice(1), [false, null]);
  assert.match(say(undefined)[0], /^Started transcribing the recording you sent/);
  assert.deepEqual(say({ state: 'running' }).slice(1), [true, null]);
  assert.match(say({ state: 'ready' })[0], /^Transcribed the recording you sent/);
  const lost = say({ state: 'failed', failure: failure({ code: 'SUBMISSION_RESPONSE_LOST', technical: true, charged: true }) });
  assert.deepEqual(lost.slice(1), [false, 'failed']);
  assert.match(lost[0], /may already have been charged/);
  assert.match(say({ state: 'failed', failure: failure() })[0], /was not charged/);
  assert.deepEqual(say({ state: 'no_answer', attemptId: 'a' }).slice(1), [false, 'no_answer']);
});

test('a refused scene stays blocked while the server still lists a job for its shots, even one no slot shows', () => {
  const block = { kind: 'keyframes', sceneId: sceneId(1), code: 'ATTEMPT_EXISTS', shotIds: [shotId('1.2')], at: 'now',
    attempts: [{ attemptId: 'lost', shotId: shotId('1.2'), kind: 'video', phase: 'submission_unknown', action: 'human_release' }] };
  const withBlockers = (blockedBy, truncated = false) => ({ ...lastFerryOverview(), scenes: lastFerryOverview().scenes.map((scene) => scene.sceneId === sceneId(1)
    ? { ...scene, blockedBy, blockedByTotal: blockedBy.length, blockedByTruncated: truncated } : scene) });
  // The slot shows nothing, but an older detached job of 1.2 still blocks: the line names it.
  const hidden = blockView(block, withBlockers([{ attemptId: 'older', shotId: shotId('1.2'), kind: 'image', phase: 'submission_unknown', action: 'human_release' }]));
  assert.equal(hidden.resolved, false);
  assert.equal(translateMsg('en', hidden.title), "Scene 1 waits for 1.2's earlier keyframe job");
  assert.equal(blockView(block, withBlockers([])).resolved, true);
  // A cut-off list that does not reach 1.2 keeps the recorded job.
  assert.equal(blockView(block, withBlockers([], true)).resolved, false);
});
