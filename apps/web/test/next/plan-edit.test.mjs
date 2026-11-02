import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { catalog } from '../../src/next/i18n/messages.ts';
import { translate } from '../../src/next/i18n/translate.ts';
import {
  canStep, changedFields, draftEdits, draftOf, draftProblem, editChange, FIELD_LABEL, FRAMINGS, lengthFloor, lengthHint, lineNote, MOTIONS, savedMessage, shotImpact, stepLength, storedShot, unitPrices,
} from '../../src/next/model/plan-edit.ts';

const overview = lastFerryOverview();
const shot = (label) => overview.shots[shotId(label)];
const prices = (label) => unitPrices(overview, shot(label).sceneId);
const impact = (label, change, extra = {}) => {
  const base = draftOf(shot(label), 'generated', 30);
  const draft = { ...base, ...change };
  return shotImpact(shot(label), base, draft, { ...prices(label), ...extra }, 'en');
};
const text = (result) => result.parts.map((part) => translate('en', part.id, part.values)).join(' ');

test("the editor starts from the shot as it is now, with its action and video prompt from the stored shot", () => {
  assert.deepEqual(draftOf(shot('1.2'), 'generated', 30, { action: 'She slides three coins across.', videoPrompt: 'Mara at the counter. Static.' }), {
    purpose: 'Mara at the counter, sliding coins across.', action: 'She slides three coins across.', framing: 'Medium', prompt: 'Mara at the counter, sliding coins across.', videoPrompt: 'Mara at the counter. Static.',
    motion: 'Static', seconds: 5, narration: 'line', line: 'One for the morning boat.',
  });
  assert.equal(draftOf(shot('2.1'), undefined, 30).narration, 'none');
  assert.equal(draftOf(shot('2.1'), 'undecided', 30).narration, 'undecided');
  // The server's placeholders for a new shot are not written words.
  const added = draftOf(shot('2.1'), 'none', 30, { action: 'Describe the action', videoPrompt: 'Pending direction' });
  assert.deepEqual([added.action, added.videoPrompt], ['', '']);
});

test('prices come from the overview unit quotes, even for a fully made scene', () => {
  assert.deepEqual(prices('1.2'), { keyframe: 40000, clip: 500000, voice: 10000 });
});

test('purpose, action or framing outdates the keyframe and the clip, and says they are written into both prompts', () => {
  const result = impact('1.2', { purpose: 'Mara buys the last ticket of the season.' });
  assert.equal(result.tone, 'cost');
  assert.equal(text(result), "Purpose, action and framing are written into both prompts. Saving outdates **1.2's keyframe and clip**; remaking both costs **about $0.54**. The current ones stay in Assets as earlier takes.");
  assert.equal(impact('1.2', { action: 'She pays.' }).parts[0].id, 'plan.impact.rewrites');
  const base = draftOf(shot('1.2'), 'generated', 30);
  assert.deepEqual(savedMessage(shot('1.2'), base, { ...base, framing: 'Low-angle medium over shoulder' }), { id: 'plan.toast.saved_kf_clip', values: { shot: '1.2' } });
});

test('the video prompt drives only the clip: the keyframe stays', () => {
  assert.equal(text(impact('1.1', { videoPrompt: 'The shutters come down slowly.' })), "Saving outdates **1.1's clip** (remaking it costs **about $0.50**). The keyframe stays. The current ones stay in Assets as earlier takes.");
  assert.equal(text(impact('2.1', { videoPrompt: 'Fog rolls in.' })), 'Nothing made goes out of date: 2.1 has no clip yet and the keyframe stays.');
});

test('a prompt change on a shot without a clip outdates only the keyframe', () => {
  const result = impact('2.1', { prompt: 'The empty harbour at first light.' });
  assert.equal(text(result), "Saving outdates **2.1's keyframe** (remaking it costs **about $0.04**). The current ones stay in Assets as earlier takes.");
});

test('B22: Plan keyframe impact keeps subscription usage distinct from an unset per-call price in both languages', () => {
  const overview = lastFerryOverview(), shot = overview.shots[shotId('2.1')], scene = overview.scenes.find(scene => scene.sceneId === shot.sceneId);
  scene.quotes.regenerateKeyframe = { micros: '0', unitMicros: '0', units: 1, priceUnknown: false, subscription: 'codex' };
  const prices = unitPrices(overview, shot.sceneId);
  assert.deepEqual(prices, { keyframe: null, clip: 500000, voice: 10000, keyframeSubscription: 'codex' });
  const base = draftOf(shot, 'none', 30), result = shotImpact(shot, base, { ...base, prompt: 'The harbour at dawn.' }, prices, 'en-US');
  assert.match(text(result), /remaking it uses your Codex plan/);
  assert.doesNotMatch(text(result), /no price set|\$0\.00/);
  assert.match(result.parts.map(part => translate('zh-CN', part.id, part.values)).join(' '), /重做使用你的 Codex 订阅/);
});

test('B22: Plan impact states Codex subscription and only the clip price, retaining an unset clip price', () => {
  const overview = lastFerryOverview(), shot = overview.shots[shotId('1.1')], scene = overview.scenes.find(scene => scene.sceneId === shot.sceneId);
  scene.quotes.regenerateKeyframe = { micros: '0', unitMicros: '0', units: 1, priceUnknown: false, subscription: 'codex' };
  const base = draftOf(shot, 'none', 30), draft = { ...base, prompt: 'The counter at dawn.' };
  const prices = unitPrices(overview, shot.sceneId);
  const priced = shotImpact(shot, base, draft, prices, 'en-US');
  assert.match(text(priced), /keyframe uses your Codex plan, and the clip costs \*\*about \$0\.50\*\*/);
  assert.doesNotMatch(text(priced), /no price set|\$0\.00|\$0\.54/);
  assert.match(priced.parts.map(part => translate('zh-CN', part.id, part.values)).join(' '), /关键帧使用你的 Codex 订阅，视频\*\*约 \$0\.50\*\*/);
  const unpriced = shotImpact(shot, base, draft, { ...prices, clip: null }, 'en-US');
  assert.match(text(unpriced), /keyframe uses your Codex plan, and no price is set for the clip/);
  assert.match(unpriced.parts.map(part => translate('zh-CN', part.id, part.values)).join(' '), /关键帧使用你的 Codex 订阅，视频未设置价格/);
});

test('motion or length outdates only the clip; with no clip yet nothing goes out of date', () => {
  assert.equal(text(impact('1.1', { motion: 'Slow pan left' })), "Saving outdates **1.1's clip** (remaking it costs **about $0.50**). The keyframe stays. The current ones stay in Assets as earlier takes.");
  const none = impact('2.1', { motion: 'Slow pan left' });
  assert.equal(none.tone, 'none');
  assert.equal(text(none), 'Nothing made goes out of date: 2.1 has no clip yet and the keyframe stays.');
  assert.equal(text(impact('3.1', { seconds: 9 })), 'Nothing has been made for 3.1 yet, so nothing goes out of date.');
  assert.equal(text(impact('2.1', {})), 'No changes yet.');
});

test('a new line outdates the voice line; the price shows only when one is set (never $0.00)', () => {
  assert.equal(text(impact('1.2', { line: 'One ticket, please.' }, { voice: null })), 'The voice line needs making again; until then its length is an estimate.');
  assert.equal(text(impact('1.2', { line: 'One ticket, please.' }, { voice: 10000 })), 'The voice line needs making again (**about $0.01**); until then its length is an estimate.');
  assert.equal(text(impact('1.2', { narration: 'none' })), '1.2 will have no narration. Its voice line stays in Assets.');
  const unpriced = impact('1.2', { prompt: 'Coins on the counter.' }, { keyframe: null });
  assert.doesNotMatch(text(unpriced), /\$0\.00/);
  assert.match(text(unpriced), /no price set/);
});

test("the shot's fields save as one shotFields command; narration around it, in an order the server accepts", () => {
  const base = draftOf(shot('1.2'), 'generated', 30);
  const draft = { ...base, purpose: 'Buying the ticket.', framing: 'Low-angle medium over shoulder', motion: 'Slow pan left', seconds: 6, line: 'One, please.' };
  assert.deepEqual(draftEdits(base, draft, 30, 'generated', storedShot(shot('1.2'), undefined)).map(({ fields, edit }) => [fields, edit]), [
    [['purpose', 'framing', 'motion', 'length'], { kind: 'shotFields', fields: { purpose: 'Buying the ticket.', framing: 'Low-angle medium over shoulder', motion: 'Slow pan left', desiredFrames: 180 } }],
    [['line'], { kind: 'narration', field: 'text', value: 'One, please.' }],
  ]);
  // Dropping the line comes first, so a shorter shot is no longer held by its voice.
  assert.deepEqual(draftEdits(base, { ...base, narration: 'none', seconds: 3 }, 30, 'generated').map(({ edit }) => edit), [
    { kind: 'narration', field: 'mode', value: 'none' }, { kind: 'shotFields', fields: { desiredFrames: 90 } },
  ]);
  // A first line: the words, then the choice to narrate.
  const silent = draftOf(shot('2.1'), 'none', 30);
  assert.deepEqual(draftEdits(silent, { ...silent, narration: 'line', line: 'Fog.' }, 30, 'none').map(({ edit }) => [edit.field, edit.value]), [['text', 'Fog.'], ['mode', 'generated']]);
  assert.deepEqual(draftEdits(base, base, 30, 'generated'), []);
  assert.deepEqual(changedFields(base, { ...base, purpose: `${base.purpose}  ` }), [], 'surrounding spaces are not a change');
  // An action and a video prompt are fields like the others.
  const [both] = draftEdits(base, { ...base, action: 'She pays.', videoPrompt: 'Coins slide; she smiles.' }, 30, 'generated', storedShot(shot('1.2'), { action: '', videoPrompt: 'Mara at the counter. Static.' }));
  assert.deepEqual(both.fields, ['action', 'videoPrompt']);
  assert.equal(both.edit.fields.action, 'She pays.');
});

test('a prompt-only save keeps the direction header the server wrote; a save that also changes the direction writes it anew', () => {
  const header = 'OpenSlate current direction:\nMara buys the last ticket. Medium\nReference details (retain only where consistent):\n';
  const edited = { ...shot('1.2'), imagePrompt: `${header}Mara at the counter, sliding coins across.` };
  const base = draftOf(edited, 'generated', 30);
  assert.equal(base.prompt, 'Mara at the counter, sliding coins across.', 'the editor shows only the words');
  const [prompt] = draftEdits(base, { ...base, prompt: 'Coins on the counter.' }, 30, 'generated', storedShot(edited, undefined));
  assert.deepEqual(prompt.edit, { kind: 'shotFields', fields: { imagePrompt: `${header}Coins on the counter.` } });
  // Without a header the words are the whole prompt.
  const plain = draftOf(shot('1.2'), 'generated', 30);
  assert.equal(draftEdits(plain, { ...plain, prompt: 'Coins.' }, 30, 'generated', storedShot(shot('1.2'), undefined))[0].edit.fields.imagePrompt, 'Coins.');
  // Purpose and prompt together: the server takes a prompt as written, so it is sent with the new direction in front,
  // joined exactly as storyboard.ts editedPrompt joins it.
  const [both] = draftEdits(base, { ...base, purpose: 'The last ticket', prompt: 'Coins.' }, 30, 'generated', storedShot(edited, { action: 'She pays', videoPrompt: '' }));
  assert.equal(both.edit.fields.imagePrompt, 'OpenSlate current direction:\nThe last ticket. She pays. Medium\nReference details (retain only where consistent):\nCoins.');
  // The video prompt's header also names the camera movement.
  const [video] = draftEdits(base, { ...base, motion: 'Slow push-in', videoPrompt: 'Coins slide.' }, 30, 'generated', storedShot(edited, { action: '', videoPrompt: 'Old.' }));
  assert.equal(video.edit.fields.videoPrompt, 'OpenSlate current direction:\nMara at the counter, sliding coins across. Medium. Camera movement: Slow push-in\nReference details (retain only where consistent):\nCoins slide.');
});

test('a cleared field or an empty line cannot be saved', () => {
  const base = draftOf(shot('1.2'), 'generated', 30);
  assert.deepEqual(draftProblem(base, { ...base, purpose: ' ' }), { id: 'plan.edit.required_purpose' });
  assert.deepEqual(draftProblem(base, { ...base, framing: '' }), { id: 'plan.edit.required_framing' });
  assert.equal(draftProblem(base, { ...base, videoPrompt: ' ' }), null, 'an empty prompt that was empty is no change');
  assert.deepEqual(draftProblem({ ...base, videoPrompt: 'x' }, { ...base, videoPrompt: ' ' }), { id: 'plan.edit.required_video_prompt' });
  assert.deepEqual(draftProblem(base, { ...base, line: '' }), { id: 'plan.line.empty' });
  assert.equal(draftProblem(base, { ...base, purpose: 'New' }), null);
});

test('the length has a floor at an accepted voice line, in whole seconds (SB-8)', () => {
  // 1.2's 2.1 s line fits: the floor is the 3 s minimum.
  const floor12 = lengthFloor(shot('1.2'), 30, 'line');
  assert.deepEqual(floor12, { min: 3, reason: 'voice', lineSeconds: 2.1 });
  assert.deepEqual(lengthHint(shot('1.2'), floor12), { id: 'plan.len.range', values: { min: 3, max: 15 } });
  // 2.3's line is longer than the shot and not settled: no floor, and the hint says so.
  const floor23 = lengthFloor(shot('2.3'), 30, 'line');
  assert.equal(floor23.reason, null);
  assert.deepEqual(lengthHint(shot('2.3'), floor23), { id: 'plan.len.line_long', values: { line: 7.4 } });
  // Once 2.3 was lengthened to fit (Make 8 s), it cannot go below the whole second that holds its 7.4 s line.
  const extended = { ...shot('2.3'), durationFrames: 240, narration: { ...shot('2.3').narration, fits: true, fit: 'extend_shot' } };
  const floor = lengthFloor(extended, 30, 'line');
  assert.deepEqual(floor, { min: 8, reason: 'voice', lineSeconds: 7.4 });
  assert.deepEqual(lengthHint(extended, floor), { id: 'plan.len.floor_voice', values: { min: 8, line: 7.4 } });
  assert.equal(canStep(8, -1, floor), false);
  assert.equal(stepLength(9, -1, floor), 8);
  assert.equal(stepLength(8, 1, floor), 9);
  assert.equal(stepLength(14.5, 1, floor), 15);
  assert.equal(canStep(15, 1, floor), false);
  // A length between whole seconds (written elsewhere) snaps onto the grid on its first step.
  const free = { min: 3, reason: null, lineSeconds: null };
  assert.equal(stepLength(7.4, 1, free), 8);
  assert.equal(stepLength(7.4, -1, free), 7);
  assert.equal(stepLength(3.5, -1, free), 3);
  assert.equal(stepLength(7.4, -1, floor), 7.4, 'below the floor it does not go further down');
  assert.equal(lengthFloor({ ...extended, narration: { ...extended.narration, measuredSeconds: 7 } }, 30, 'line').min, 7, 'a whole-second line needs no more');
  // Choosing no narration lifts the floor; a line cut at the shot's end holds the current length.
  assert.equal(lengthFloor(extended, 30, 'none').min, 3);
  const cut = { ...shot('2.3'), narration: { ...shot('2.3').narration, fit: 'cut_to_shot' } };
  assert.deepEqual(lengthFloor(cut, 30, 'line'), { min: 6, reason: 'cut', lineSeconds: 7.4 });
});

test('the line shows its measured length until the words change, then a labelled estimate', () => {
  const base = draftOf(shot('1.2'), 'generated', 30);
  assert.deepEqual(lineNote(shot('1.2'), base), { id: 'plan.line.measured_fits', values: { seconds: 2.1, shot: 5 } });
  assert.deepEqual(lineNote(shot('1.2'), { ...base, line: 'It was the last boat of the season, and I nearly missed it, again and again and again.' }), { id: 'plan.line.estimate_long', values: { seconds: 5.4, shot: 5 } });
  assert.deepEqual(lineNote(shot('1.2'), { ...base, line: 'The last boat.' }), { id: 'plan.line.estimate_fits', values: { seconds: 0.9, shot: 5 } });
  assert.deepEqual(lineNote(shot('3.2'), draftOf(shot('3.2'), 'generated', 30)), { id: 'plan.line.estimate_fits', values: { seconds: 1.6, shot: 8 } });
  assert.equal(lineNote(shot('1.2'), { ...base, narration: 'none' }), null);
});

test('Undo names the whole edit when the shot fields are one command, or what its last command saved', () => {
  assert.deepEqual(editChange('1.2', [['purpose', 'motion', 'length']]), { id: 'plan.change.edit_shot', values: { shot: '1.2' } });
  assert.deepEqual(editChange('1.2', [['purpose', 'prompt'], ['line']]), { id: 'plan.change.field.line', values: { shot: '1.2' } });
  assert.deepEqual(editChange('1.2', [['narration'], ['length', 'purpose']]), { id: 'plan.change.shot_fields', values: { shot: '1.2' } });
  assert.deepEqual(editChange('1.2', [['narration'], ['length']]), { id: 'plan.change.field.length', values: { shot: '1.2' } });
  for (const field of ['purpose', 'action', 'framing', 'prompt', 'video_prompt', 'motion', 'length', 'narration', 'line']) assert.ok(Object.hasOwn(catalog, `plan.change.field.${field}`));
  for (const field of ['purpose', 'action', 'framing', 'prompt', 'video_prompt', 'motion']) assert.ok(Object.hasOwn(catalog, `plan.edit.required_${field}`));
  for (const id of Object.values(FIELD_LABEL)) assert.ok(Object.hasOwn(catalog, id), id);
  // Before saving, the hint says Undo will revert only the last command; after, the toast says the same.
  assert.equal(translate('en', 'plan.edit.multi', { count: 2, change: '1.2 line' }), 'Saves as 2 changes; Undo reverts only the last one (1.2 line).');
  assert.equal(translate('en', 'plan.toast.saved_undo_last', { saved: 'Saved 1.2.', change: '1.2 line' }), 'Saved 1.2. Undo reverts only the last change: 1.2 line.');
});

test('framings and motions are suggestions in the film\'s words, not translated; framing is free text', () => {
  assert.deepEqual(FRAMINGS, ['Wide', 'Medium', 'Close-up', 'Extreme close-up']);
  assert.ok(MOTIONS.includes('Static'));
  assert.ok(!Object.keys(catalog).some((id) => id.startsWith('plan.motion.') || id.startsWith('plan.framing.')));
});

test('the Chinese impact line reads with the price in place', () => {
  const result = impact('1.2', { purpose: 'Mara buys the last ticket of the season.' });
  const zh = result.parts.map((part) => translate('zh-CN', part.id, part.values)).join('');
  assert.equal(zh, '目的、动作和景别会写进画面和视频描述。保存后，**1.2 的关键帧和视频**会过期，重做两者**约 $0.54**。现有的会作为旧版本保留在素材里。');
  assert.equal(sceneId(1), 'scene-1');
});

test('a keyframe being made is named; a queued job is not "running"', () => {
  const making = { ...shot('2.1'), keyframe: { state: 'running', takeCount: 1, opened: false, previous: shot('2.1').keyframe.artifact } };
  const base = draftOf(making, 'none', 30);
  assert.equal(text(shotImpact(making, base, { ...base, prompt: 'Fog.' }, prices('2.1'), 'en')), 'Work for 2.1 is still running; what it makes will be out of date.');
  const queued = { ...shot('1.1'), video: { state: 'queued', takeCount: 0, waiting: { code: 'review', since: '' } } };
  const queuedBase = draftOf(queued, 'none', 30);
  assert.equal(text(shotImpact(queued, queuedBase, { ...queuedBase, motion: 'Slow pan left' }, prices('1.1'), 'en')), 'Nothing made goes out of date: 1.1 has no clip yet and the keyframe stays.');
});
