import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformWithOxc } from '../../node_modules/vite/dist/node/index.js';
import { fixtureCommand, recompute, FIXTURE_PRICES } from '../../src/next/fixtures/fixture-commands.ts';
import { fixtureRoute } from '../../src/next/fixtures/routes/index.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, lastFerryProposals, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { checkActions, checkBody, checkTimeline, checkTitle, narrationChecks, settledTimeline } from '../../src/next/model/checks.ts';
import { clipUnit, editImpact, inspectorView } from '../../src/next/model/inspector.ts';
import { draftOf, shotImpact, unitPrices } from '../../src/next/model/plan-edit.ts';
import { filmMeta, seconds } from '../../src/next/model/keyframes.ts';
import { clock } from '../../src/next/model/motion.ts';
import { voiceImpact, voiceUnit } from '../../src/next/model/narration.ts';
import { keyframesBody } from '../../src/next/model/commands.ts';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';

const en = (message) => translateMsg('en', message);
const zh = (message) => translateMsg('zh-CN', message);
const quote = (unitMicros, priceUnknown = false) => ({ micros: String(unitMicros), units: 1, unitMicros: String(unitMicros), priceUnknown });
const checkFor = (overview, id) => narrationChecks(Object.values(overview.shots), overview.fps).find((check) => check.shotId === id);
const world = () => {
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector }, proposals: lastFerryProposals(),
    update(change) { change(w); },
    later() { throw new Error('Fit never starts generation'); },
  };
  return w;
};
const fit = (w, id, choice = 'extend_shot') => fixtureCommand(w, 'POST', `/shots/${id}/narration-fit`, { fit: choice, expectedHeadVersion: w.snapshot.project.headVersion });
const timedWorld = () => {
  const w = world(), timers = [];
  let now = 0;
  w.later = (ms, change) => timers.push({ at: now + ms, change });
  w.advance = (ms) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers[0] || timers[0].at > until) break;
      const next = timers.shift();
      now = next.at;
      w.update(next.change);
    }
    now = until;
  };
  return w;
};
const make = (w, scene) => fixtureCommand(w, 'POST', `/scenes/${scene.sceneId}/generate`, {
  ...keyframesBody(fixtureCommand(w, 'GET', `/scenes/${scene.sceneId}/generation`)),
  expectedEstimateMicros: scene.quotes.makeKeyframes?.micros,
});

test('W1 fixture voice-only Make retains the reviewed frame and clip, then measures the new words', () => {
  const w = timedWorld(), id = shotId('1.2'), before = structuredClone(w.overview.shots[id]);
  fixtureCommand(w, 'POST', '/storyboard', { kind: 'narration', id, field: 'text', value: 'A ticket, please.', expectedHeadVersion: w.snapshot.project.headVersion });
  const scene = w.overview.scenes[0];
  assert.deepEqual(scene.keyframeTargets, [id]);
  assert.deepEqual(scene.quotes.makeKeyframes, quote(FIXTURE_PRICES.voice));
  assert.deepEqual(make(w, scene).targetShotIds, [id]);
  assert.equal(w.overview.scenes[0].keyframesRun.currentStep, 'speech');
  assert.ok(w.overview.scenes[0].blockers.some((blocker) => blocker.code === 'confirmation_running'));
  assert.equal(w.overview.scenes[0].state, 'video_saved', 'making voices does not pretend clips are being made');
  assert.deepEqual(w.overview.shots[id].keyframe, before.keyframe);
  assert.deepEqual(w.overview.shots[id].video, before.video);
  assert.throws(() => make(w, w.overview.scenes[0]), (error) => error.code === 'CONFIRMATION_RUNNING');
  w.advance(2700);
  assert.equal(w.overview.scenes[0].keyframesRun.state, 'done');
  assert.equal(w.overview.shots[id].narration.state, 'ready');
  assert.ok(w.overview.shots[id].narration.measuredSeconds > 0);
  assert.deepEqual(w.overview.shots[id].keyframe, before.keyframe);
  assert.deepEqual(w.overview.shots[id].video, before.video);
  assert.deepEqual(w.overview.scenes[0].keyframeTargets, []);
  assert.throws(() => make(w, w.overview.scenes[0]), (error) => error.code === 'ALREADY_COMPLETE');
});

test('W1 fixture never generates speech for uploaded, undecided or disabled narration modes', () => {
  for (const mode of ['uploaded', 'undecided', 'none']) {
    const w = timedWorld(), id = shotId('1.2');
    w.snapshot.project.shots.find((row) => row.id === id).narration.mode = mode;
    w.overview.shots[id].narration = { state: 'text_only', text: 'Words without a speech choice', estimatedSeconds: 3, fits: true };
    w.overview = recompute(w.overview, w.snapshot.notes, w.snapshot.project.shots);
    assert.deepEqual(w.overview.scenes[0].keyframeTargets, []);
    assert.throws(() => make(w, w.overview.scenes[0]), (error) => error.code === 'ALREADY_COMPLETE');
    assert.equal(w.overview.scenes[0].keyframesRun, undefined);
  }
});

test('W1 keyframes voice run preserves its original text, mode and voice through async steps', () => {
  for (const changed of ['text', 'voice', 'mode']) {
    const w = timedWorld(), id = shotId('3.2');
    make(w, w.overview.scenes[2]);
    if (changed === 'text') {
      w.advance(900);
      fixtureCommand(w, 'POST', '/storyboard', { kind: 'narration', id, field: 'text', value: 'New words belong to the newer edit.', expectedHeadVersion: w.snapshot.project.headVersion });
    } else {
      fixtureRoute(w, 'POST', '/storyboard', { kind: 'narration', id, field: changed, value: changed === 'voice' ? 'ash' : 'uploaded', expectedHeadVersion: w.snapshot.project.headVersion });
    }
    w.advance(3000);
    assert.equal(w.overview.scenes[2].keyframesRun.state, 'blocked', changed);
    assert.equal(w.overview.scenes[2].keyframesRun.blocker.code, 'SCENE_REVIEW_STALE');
    assert.equal(w.overview.shots[id].narration.measuredSeconds, undefined, 'an earlier run cannot measure or attach newer intent');
    assert.notEqual(w.overview.shots[id].narration.state, 'making', 'the old-owned making marker is cleared on refusal');
    assert.equal(w.overview.scenes[2].confirmation, undefined, 'the voice decision cannot make clips');
    assert.deepEqual(w.overview.scenes[2].shotIds.map((id) => w.overview.shots[id].video.state), ['none', 'none']);
  }
});

test('W1 a cancelled old speech callback cannot clear a newer run making marker', () => {
  const w = timedWorld(), id = shotId('1.2');
  fixtureCommand(w, 'POST', '/storyboard', { kind: 'narration', id, field: 'text', value: 'A ticket, please.', expectedHeadVersion: w.snapshot.project.headVersion });
  make(w, w.overview.scenes[0]);
  const oldId = w.overview.scenes[0].keyframesRun.confirmationId;
  w.advance(100);
  // A refreshed replacement run supersedes the previous run while its old callback remains scheduled.
  w.overview.scenes[0].keyframesRun.state = 'cancelled';
  w.overview.shots[id].narration.state = 'text_only';
  w.overview = recompute(w.overview, w.snapshot.notes, w.snapshot.project.shots);
  make(w, w.overview.scenes[0]);
  const currentId = w.overview.scenes[0].keyframesRun.confirmationId;
  assert.notEqual(currentId, oldId);
  w.advance(800);
  assert.equal(w.overview.shots[id].narration.state, 'making');
  assert.equal(w.overview.scenes[0].keyframesRun.currentStep, 'speech');
  w.advance(100);
  assert.equal(w.overview.scenes[0].keyframesRun.currentStep, 'attach');
});

test('W1 Stop cancels the keyframes voice run and no later tick begins clips or another speech step', () => {
  const w = timedWorld();
  make(w, w.overview.scenes[2]);
  fixtureCommand(w, 'POST', '/controls', { action: 'stop' });
  assert.equal(w.overview.scenes[2].keyframesRun.state, 'cancelled');
  w.advance(6000);
  assert.equal(w.overview.scenes[2].keyframesRun.state, 'cancelled');
  assert.equal(w.overview.shots[shotId('3.2')].narration.measuredSeconds, undefined);
  assert.equal(w.overview.scenes[2].confirmation, undefined);
  assert.deepEqual(w.overview.scenes[2].shotIds.map((id) => w.overview.shots[id].video.state), ['none', 'none']);
});

test('W1 fully made scene retains real zero-unit confirmation shape and independent remake prices', () => {
  const overview = lastFerryOverview(), scene = overview.scenes[0], shot = overview.shots[shotId('1.2')];
  assert.deepEqual(scene.quotes.confirmVideo, { micros: '0', units: 0, unitMicros: '0', priceUnknown: false });
  assert.deepEqual(scene.quotes.oneClip, quote(FIXTURE_PRICES.clip));
  assert.deepEqual(scene.quotes.oneVoice, quote(FIXTURE_PRICES.voice));
  assert.deepEqual(clipUnit(overview, scene), { unitMicros: '500000', unknown: false });
  assert.deepEqual(unitPrices(overview, scene.sceneId), { keyframe: 40000, clip: 500000, voice: 10000 });
  const base = draftOf(shot, 'generated', overview.fps);
  assert.match(shotImpact(shot, base, { ...base, motion: 'Slow pan left' }, unitPrices(overview, scene.sceneId), 'en').parts.map(en).join(' '), /remaking it costs \*\*about \$0\.50\*\*/);
  assert.match(shotImpact(shot, base, { ...base, line: 'One ticket.' }, unitPrices(overview, scene.sceneId), 'en').parts.map(en).join(' '), /voice line needs making again \(\*\*about \$0\.01\*\*\)/);
  assert.match(en(voiceImpact(shot, voiceUnit(overview, scene.sceneId), 'en')), /about \$0\.01/);
  assert.match(en(inspectorView(overview, shot, 'en').regenerate.clipNote), /about \$0\.50/);
});

test('W1 remake quotes use the selected scene before another scene and ignore aggregate quotes', () => {
  const overview = lastFerryOverview(), scene = overview.scenes[1];
  scene.quotes.oneClip = quote(750000);
  scene.quotes.oneVoice = quote(30000);
  scene.quotes.confirmVideo = { micros: '1520000', units: 4, unitMicros: '0', priceUnknown: false };
  scene.quotes.voice = { micros: '0', units: 0, unitMicros: '0', priceUnknown: false };
  assert.deepEqual(clipUnit(overview, scene), { unitMicros: '750000', unknown: false });
  assert.equal(voiceUnit(overview, scene.sceneId), 30000);
  assert.deepEqual(unitPrices(overview, scene.sceneId), { keyframe: 40000, clip: 750000, voice: 30000 });
  delete scene.quotes.oneClip;
  delete scene.quotes.oneVoice;
  assert.deepEqual(clipUnit(overview, scene), { unitMicros: '500000', unknown: false });
  assert.equal(voiceUnit(overview, scene.sceneId), 10000);
  assert.deepEqual(unitPrices(overview, scene.sceneId), { keyframe: 40000, clip: 500000, voice: 10000 });
});

test('W1 an explicit unknown scene unit price stays unknown instead of borrowing a priced scene', () => {
  const overview = lastFerryOverview(), scene = overview.scenes[1];
  for (const priceUnknown of [true, false]) {
    scene.quotes.oneClip = quote(priceUnknown ? 100 : 0, priceUnknown);
    scene.quotes.oneVoice = quote(priceUnknown ? 100 : 0, priceUnknown);
    assert.equal(unitPrices(overview, scene.sceneId).clip, null);
    assert.equal(unitPrices(overview, scene.sceneId).voice, null);
    assert.equal(voiceUnit(overview, scene.sceneId), null);
  }
  for (const scene of overview.scenes) { delete scene.quotes.oneClip; delete scene.quotes.oneVoice; }
  assert.equal(clipUnit(overview, scene), null);
  assert.equal(voiceUnit(overview, scene.sceneId), null);
});

test('W1 recomputed fixtures preserve remake units after a saved scene has no pending clips', () => {
  const before = lastFerryOverview();
  const overview = recompute(before, lastFerrySnapshot().notes);
  assert.deepEqual(overview.scenes[0].quotes.confirmVideo, before.scenes[0].quotes.confirmVideo);
  assert.deepEqual(overview.scenes[0].quotes.oneVoice, quote(FIXTURE_PRICES.voice));
  assert.deepEqual(unitPrices(overview, overview.scenes[0].sceneId), { keyframe: 40000, clip: 500000, voice: 10000 });
});

test('W1 extension target comes from the server rather than a padded text or voice calculation', () => {
  const overview = lastFerryOverview(), id = shotId('2.1');
  for (const [measuredSeconds, duration, fitSeconds] of [[5.8, 5, 6], [6.9, 6, 7], [4.8, 4, 5], [5.8, 5, 9]]) {
    overview.shots[id] = { ...overview.shots[id], durationFrames: duration * 30, narration: { state: 'ready', text: 'Measured voice', measuredSeconds, fits: false, fitSeconds } };
    const check = checkFor(overview, id), actions = checkActions(check, 30);
    assert.equal(check.fitSeconds, fitSeconds);
    assert.deepEqual([actions.extend.seconds, actions.extend.frames], [fitSeconds, fitSeconds * 30]);
    assert.match(en(actions.extend.label), new RegExp(`${fitSeconds} s$`));
    assert.equal(checkTimeline(check, overview).after.find((segment) => segment.hot).seconds, fitSeconds);
  }
});

test('W1 measured narration without a server extension target offers Keep and Edit only', () => {
  const overview = lastFerryOverview(), shot = overview.shots[shotId('2.3')];
  delete shot.narration.fitSeconds;
  const check = checkFor(overview, shot.shotId), actions = checkActions(check, overview.fps);
  assert.equal(actions.extend, null);
  assert.ok(actions.keep);
  assert.equal(actions.edit.label.id, 'check.narration.edit');
  assert.deepEqual(checkTimeline(check, overview).after, []);
});

test('W1 estimated narration offers only Edit and explains measurement in both languages', () => {
  const overview = lastFerryOverview(), shot = overview.shots[shotId('2.3')];
  shot.narration = { state: 'text_only', text: 'Unmeasured line', estimatedSeconds: 7.4, fits: false };
  const check = checkFor(overview, shot.shotId), actions = checkActions(check, overview.fps);
  assert.equal(check.estimated, true);
  assert.equal(check.fitSeconds, undefined);
  assert.equal(actions.extend, null);
  assert.equal(actions.keep, null);
  assert.equal(en(actions.edit.label), 'Edit narration');
  assert.equal(en(checkBody(check)), "2.3's line looks longer than the shot. Make its voice line to measure it, or shorten the words.");
  assert.equal(zh(checkBody(check)), '2.3 的旁白估计比镜头长。先生成配音来测量长度，或缩短台词。');
  assert.equal(checkActions({ ...check, fitSeconds: 8 }, overview.fps).extend, null, 'an old target cannot enable a fit for an estimate');
});

test('W1 fixture narration fit uses measured sample duration without padding, preserving the keyframe', () => {
  for (const [measuredSeconds, duration, target] of [[5.8, 5, 6], [6.9, 6, 7], [4.8, 4, 5], [15, 6, 15]]) {
    const w = world(), id = shotId('2.3'), shot = w.overview.shots[id];
    shot.durationFrames = duration * 30;
    shot.narration = { state: 'ready', text: 'Measured line', measuredSeconds, fits: false };
    const before = shot.keyframe;
    w.overview = recompute(w.overview, w.snapshot.notes);
    assert.equal(w.overview.shots[id].narration.fitSeconds, target);
    const receipt = fit(w, id);
    assert.equal(receipt.durationFrames, target * 30);
    assert.equal(w.overview.shots[id].narration.fits, true);
    assert.equal(w.overview.shots[id].narration.fitSeconds, undefined);
    assert.deepEqual(w.overview.shots[id].keyframe, before);
  }
});

test('W1 fixture refuses both estimated fit choices without changing the film', () => {
  for (const choice of ['extend_shot', 'cut_to_shot']) {
    const w = world(), id = shotId('2.3');
    w.overview.shots[id].narration = { state: 'text_only', text: 'Estimate only', estimatedSeconds: 7.4, fits: false, fitSeconds: 8 };
    w.overview = recompute(w.overview, w.snapshot.notes);
    assert.equal(w.overview.shots[id].narration.fitSeconds, undefined, 'no stale measured target survives');
    const before = structuredClone({ overview: w.overview, snapshot: w.snapshot });
    assert.throws(() => fit(w, id, choice), (error) => error.code === 'NARRATION_RECORDING_REQUIRED');
    assert.deepEqual({ overview: w.overview, snapshot: w.snapshot }, before);
  }
});

test('W1 fixture refuses an extension beyond its video model while retaining the cut option', () => {
  const w = world(), id = shotId('2.3');
  w.overview.shots[id].narration = { state: 'ready', text: 'Long measured line', measuredSeconds: 15.1, fits: false };
  w.overview = recompute(w.overview, w.snapshot.notes);
  assert.equal(w.overview.shots[id].narration.fitSeconds, undefined);
  const before = structuredClone({ overview: w.overview, snapshot: w.snapshot });
  assert.throws(() => fit(w, id), (error) => error.code === 'PROFILE_INCOMPATIBLE');
  assert.deepEqual({ overview: w.overview, snapshot: w.snapshot }, before);
  assert.equal(fit(w, id, 'cut_to_shot').durationFrames, 180);
});

test('W1 duration and motion edits disclose charged running clips and retained replacements', () => {
  const overview = lastFerryOverview(), shot = overview.shots[shotId('1.1')];
  for (const video of [
    { state: 'running', takeCount: 0 },
    { ...shot.video, replacement: { state: 'running', attemptId: 'replacement' } },
    { ...shot.video, replacement: { state: 'queued', waiting: { code: 'capacity', since: '' } } },
    { state: 'no_answer', takeCount: 0, attemptId: 'unknown' },
  ]) {
    for (const field of ['motion', 'desiredFrames']) {
      const impact = editImpact({ ...shot, video }, [field]);
      assert.equal(en(impact), 'The clip being made will still be charged and come back out of date.');
      assert.equal(zh(impact), '正在生成的视频仍会计费，回来后会是过期的。');
    }
    assert.notEqual(editImpact({ ...shot, video }, ['narration']).id, 'inspector.outdates.running_clip');
  }
  assert.equal(editImpact(shot, ['desiredFrames']).id, 'inspector.outdates.video');
});

test('W1 inspector regeneration is disabled while the scene confirmation owns the shot', () => {
  const overview = lastFerryOverview(), scene = overview.scenes[1], shot = overview.shots[shotId('2.2')];
  scene.blockers.push({ code: 'confirmation_running' });
  const regenerate = inspectorView(overview, shot, 'en').regenerate;
  assert.equal(regenerate.enabled, false);
  assert.equal(regenerate.reason.id, 'error.CONFIRMATION_RUNNING');
  assert.equal(en(regenerate.reason), translate('en', 'error.CONFIRMATION_RUNNING'));
  assert.equal(zh(regenerate.reason), translate('zh-CN', 'error.CONFIRMATION_RUNNING'));
  scene.blockers = scene.blockers.filter((blocker) => blocker.code !== 'confirmation_running');
  assert.equal(inspectorView(overview, shot, 'en').regenerate.enabled, true);
});

test('W1 inspector never offers Give up or Retry for an output download ingestion issue', () => {
  const overview = lastFerryOverview(), shot = overview.shots[shotId('2.2')];
  for (const state of ['running', 'no_answer', 'failed', 'ready']) {
    shot.video = { state, takeCount: 1, attemptId: 'download', ingestionIssue: { code: 'OUTPUT_DOWNLOAD_EXPIRED', at: 'now' }, replacement: { state: 'no_answer', attemptId: 'stale-replacement' } };
    const view = inspectorView(overview, shot, 'en');
    assert.equal(view.noAnswer, null, state);
    assert.equal(view.failure, null, state);
  }
});

// Render the actual banner's element tree through inert hooks; no browser or provider is involved.
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
const source = readFileSync(new URL('../../src/next/keyframes/CheckBanner.tsx', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const { code } = await transformWithOxc(source, 'CheckBanner.tsx', { jsx: { runtime: 'classic' } });
const loadBanner = () => runInNewContext(`${code}\n;CheckBanner;`, {
  React: { createElement: jsx, Fragment: 'fragment' }, BannerFrame: () => {},
  useI18n: () => ({ t: (id, values) => translate('en', id, values), tm: en }),
  useGuarded: () => ({ disabled: false }), checkActions, checkBody, checkTimeline, checkTitle, settledTimeline, filmMeta, seconds, clock,
});
const collect = (node, act) => {
  if (!node || typeof node !== 'object') return [];
  const children = Array.isArray(node) ? node : node.props?.children ?? [];
  return [...(node.props?.['data-act'] === act ? [node] : []), ...children.flatMap((child) => collect(child, act))];
};

test('W1 actual estimated check banner renders Edit without Make or Keep controls', () => {
  const overview = lastFerryOverview(), shot = overview.shots[shotId('2.3')];
  const render = () => loadBanner()({ overview, sceneId: shot.sceneId, checks: [{ letter: '!', check: checkFor(overview, shot.shotId) }], settled: null, busy: false });
  let tree = render();
  assert.equal(collect(tree.props.actions, 'make-fit').length, 1);
  assert.equal(collect(tree.props.actions, 'keep-fit').length, 1);
  shot.narration = { state: 'text_only', text: 'Estimate only', estimatedSeconds: 7.4, fits: false };
  tree = render();
  assert.equal(collect(tree.props.actions, 'make-fit').length, 0);
  assert.equal(collect(tree.props.actions, 'keep-fit').length, 0);
  assert.equal(collect(tree.props.actions, 'edit-narration').length, 1);
  assert.match(tree.props.sub, /Make its voice line to measure it/);
});
