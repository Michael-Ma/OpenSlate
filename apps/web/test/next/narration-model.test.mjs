import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceLabel, lineFromRecordingImpact, modeEdit, modeOf, NARRATION_CHOICES, narrationChoiceOf, narrationRow, noneImpact, planLeaveRecordingImpact,
  planRecordingImpact, planRecordingNote, planRowRecording, RECORDING_WITHOUT_WORDS, recordingInUse, slotNote, takeOrigin, takeView, voiceImpact,
  voiceOptions, voiceUnit, wordsOf,
} from '../../src/next/model/narration.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { draftEdits, draftEffects, draftOf, shotImpact } from '../../src/next/model/plan-edit.ts';
import { narrationView } from '../../src/next/model/plan.ts';
import { lastFerryOverview, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = (m) => translateMsg('en', m);
const zh = (m) => translateMsg('zh-CN', m);
const shot = (label) => lastFerryOverview().shots[shotId(label)];
const voices = { defaultNarratorVoice: 'cedar', voices: ['alloy', 'ash', 'cedar'].map((id) => ({ id, default: id === 'cedar' })) };

test('the three choices, and the choice a shot is in now', () => {
  assert.deepEqual(NARRATION_CHOICES, ['none', 'line', 'recording']);
  assert.deepEqual(NARRATION_CHOICES.map((c) => en(choiceLabel(c))), ['None', 'A line', 'My recording']);
  assert.deepEqual(NARRATION_CHOICES.map((c) => zh(choiceLabel(c))), ['无', '一句旁白', '我的录音']);
  assert.equal(narrationChoiceOf('generated', shot('2.3').narration), 'line');
  assert.equal(narrationChoiceOf('uploaded', shot('2.3').narration), 'recording');
  assert.equal(narrationChoiceOf('uploaded', shot('2.1').narration), 'recording', 'a recording not added yet is still the choice');
  assert.equal(narrationChoiceOf(undefined, shot('2.1').narration), 'none');
  assert.equal(narrationChoiceOf('undecided', shot('2.1').narration), 'undecided');
});

test('a choice stores its mode, and only a change sends a mode edit', () => {
  assert.deepEqual(NARRATION_CHOICES.map(modeOf), ['none', 'generated', 'uploaded']);
  assert.equal(modeEdit('line', 'generated'), null);
  assert.equal(modeEdit('line', 'uploaded'), 'generated');
  assert.equal(modeEdit('line', undefined), 'generated');
  assert.equal(modeEdit('recording', 'generated'), 'uploaded');
  assert.equal(modeEdit('none', 'undecided'), 'none');
  assert.equal(modeEdit('none', 'none'), null);
});

test('stock voices: following the film first, the film default marked, a pinned or personal voice kept', () => {
  const options = voiceOptions(voices, 'stock');
  assert.deepEqual(options.map((o) => [o.value, en(o.label)]), [['stock', 'Same as the film (Cedar)'], ['alloy', 'Alloy'], ['ash', 'Ash'], ['cedar', 'Cedar · film default']]);
  assert.equal(zh(options[3].label), 'Cedar · 影片默认');
  assert.deepEqual(voiceOptions(voices, 'personal').map((o) => o.value).at(-1), 'personal');
  assert.equal(en(voiceOptions(voices, 'personal').at(-1).label), 'Your personal voice');
  assert.deepEqual(voiceOptions(voices, 'verse').map((o) => o.value), ['stock', 'alloy', 'ash', 'cedar', 'verse'], 'a saved voice the list lacks stays');
  assert.equal(en(voiceOptions({ ...voices, defaultNarratorVoice: 'openai-custom:voice_x' }, 'stock')[0].label), 'Same as the film (your personal voice)');
  assert.deepEqual(voiceOptions(null, 'stock').map((o) => [o.value, en(o.label)]), [['stock', 'Same as the film']], 'before the voices are read');
});

test('a new voice remakes a voiced line at the voice-line price, never $0.00', () => {
  const overview = lastFerryOverview();
  assert.equal(voiceUnit(overview, 'scene-2'), null, 'no voice price set');
  assert.equal(en(voiceImpact(shot('2.3'), null, 'en-US')), "The voice line will be made again in this voice, with the scene's next keyframes or video.");
  assert.equal(en(voiceImpact(shot('2.3'), 10000, 'en-US')), "The voice line will be made again in this voice, about $0.01, with the scene's next keyframes or video.");
  assert.equal(en(voiceImpact(shot('3.2'), 10000, 'en-US')), 'The voice line of 3.2 will be made in this voice.');
  overview.scenes[0].quotes.voice = { micros: '0', units: 1, unitMicros: '0', priceUnknown: false };
  overview.scenes[1].quotes.voice = { micros: '12000', units: 1, unitMicros: '12000', priceUnknown: false };
  assert.equal(voiceUnit(overview, 'scene-1'), 12000, "a scene without a price uses another scene's");
  assert.equal(en(noneImpact(shot('2.3'))), '2.3 will have no narration. Its voice line stays in Assets.');
  assert.equal(en(noneImpact(shot('3.2'))), '3.2 will have no narration.');
});

test('the take: a voice line or a recording with its measured length, only while the line is voiced', () => {
  const s23 = shot('2.3');
  const voiced = { shotId: s23.shotId, headVersion: 12, segment: { audio: { id: 'a1', media: { sha256: 'f'.repeat(64), probe: { audio: { samples: 355200 } } }, originEvidence: 'verified_generated_audio', generation: { voice: 'cedar' } } } };
  const take = takeView(s23, voiced);
  assert.deepEqual(take.audio, { artifactId: 'a1', sha256: 'f'.repeat(64), kind: 'audio' });
  assert.equal(take.origin, 'voice');
  assert.equal(en(take.label), 'Voice line · 7.4 s · Cedar');
  assert.equal(en(take.name), 'Voice line of 2.3, 7.4 s');
  const personal = { ...voiced, segment: { audio: { ...voiced.segment.audio, generation: { voice: 'openai-custom:voice_x' } } } };
  assert.equal(en(takeView(s23, personal).label), 'Voice line · 7.4 s · your personal voice');
  const uploaded = { ...voiced, segment: { audio: { id: 'r1', declaredOrigin: 'uploaded', media: { sha256: 'e'.repeat(64), probe: { audio: { samples: 201600 } } } } } };
  const recording = takeView({ ...s23, narration: { ...s23.narration, measuredSeconds: 4.2 } }, uploaded);
  assert.equal(recording.origin, 'recording');
  assert.equal(en(recording.label), 'Your recording · 4.2 s');
  assert.equal(zh(recording.label), '你的录音 · 4.2 秒');
  // A read from before the overview moved (the voice line a recording just replaced) is not offered as the take.
  assert.equal(takeView({ ...s23, narration: { ...s23.narration, measuredSeconds: 3 } }, voiced), null);
  // Not voiced (an edited line), another shot's read, or nothing read: no take.
  assert.equal(takeView(shot('3.2'), { ...voiced, shotId: shotId('3.2') }), null);
  assert.equal(takeView(s23, { ...voiced, shotId: shotId('2.2') }), null);
  assert.equal(takeView(s23, null), null);
});

test("the voice line's state from the overview's narration slot", () => {
  const s = shot('2.3');
  const with_ = (state) => ({ ...s, narration: { ...s.narration, state } });
  assert.equal(en(slotNote(with_('making'), 'generated').message), 'The voice line is being made…');
  assert.deepEqual([slotNote(with_('failed'), 'generated').tone, en(slotNote(with_('failed'), 'generated').message)], ['warn', "The voice line failed. It is made again with the scene's next keyframes or video."]);
  assert.equal(en(slotNote(with_('no_answer'), 'generated').message), 'The voice service has not answered. The line may still arrive.');
  assert.equal(en(slotNote(with_('text_only'), 'generated').message), "Not voiced yet. It is made with the scene's next keyframes or video.");
  assert.equal(en(slotNote(with_('text_only'), 'uploaded').message), 'No recording yet. Choose one below.');
  assert.equal(slotNote(with_('ready'), 'generated'), null);
  assert.equal(slotNote(shot('2.1'), undefined), null);
  assert.equal(en(slotNote(shot('2.1'), 'uploaded').message), 'No recording yet. Choose one below.');
});

test('the inspector row: no answer, a recording, and an undecided shot', () => {
  const overview = lastFerryOverview();
  const notes = (row) => row.notes.map((n) => en(n.message));
  const s23 = overview.shots[shotId('2.3')];
  const noAnswer = narrationRow({ ...s23, narration: { ...s23.narration, state: 'no_answer', measuredSeconds: undefined, estimatedSeconds: 7.4 } }, 30, 'generated');
  assert.deepEqual(notes(noAnswer), ['about 7.4 s (estimate, not voiced yet)', 'no answer from the voice service', 'longer than the shot']);
  assert.equal(noAnswer.notes[1].tone, 'warn');
  const recorded = narrationRow({ ...s23, narration: { state: 'ready', text: RECORDING_WITHOUT_WORDS, measuredSeconds: 4.2, fits: true } }, 30, 'uploaded', 'recording');
  assert.deepEqual([en(recorded.value), recorded.quoted, notes(recorded)], ['Your recording', false, ['4.2 s']]);
  const missing = narrationRow(overview.shots[shotId('2.1')], 30, 'uploaded');
  assert.deepEqual([en(missing.value), notes(missing)], ['Your recording', ['not added yet']]);
  assert.equal(en(narrationRow(overview.shots[shotId('2.1')], 30, 'undecided').value), 'Not decided');
  // inspectorView passes the stored mode through; without it the row reads as before.
  assert.equal(en(inspectorView(overview, overview.shots[shotId('2.1')], 'en-US', 'uploaded').rows[2].value), 'Your recording');
  assert.equal(en(inspectorView(overview, overview.shots[shotId('2.1')], 'en-US').rows[2].value), 'None');
});

test("the studio's stand-in text for a recording without words reads as no words", () => {
  assert.equal(wordsOf(RECORDING_WITHOUT_WORDS), '');
  assert.equal(wordsOf('It was the last boat.'), 'It was the last boat.');
});

test('Plan: "My recording" stores mode uploaded after the line, says where to add it, and what it replaces', () => {
  const s12 = shot('1.2');
  const base = draftOf(s12, 'generated', 30);
  assert.equal(draftOf(s12, 'uploaded', 30).narration, 'recording');
  assert.deepEqual(draftEdits(base, { ...base, narration: 'recording' }, 30, 'generated').map(({ field, edit }) => [field, edit.field, edit.value]), [['narration', 'mode', 'uploaded']]);
  // Back from a recording to a line voices it again.
  const recorded = draftOf(s12, 'uploaded', 30);
  assert.deepEqual(draftEdits(recorded, { ...recorded, narration: 'line' }, 30, 'uploaded').map(({ edit }) => [edit.field, edit.value]), [['mode', 'generated']]);
  const impact = shotImpact(s12, base, { ...base, narration: 'recording' }, { keyframe: null, clip: null, voice: null }, 'en-US');
  assert.equal(impact.tone, 'cost');
  assert.match(impact.parts.map(en).join(' '), /1\.2 will use your recording instead of its voice line once you add it in Keyframes \(until then the voice line plays; it stays in Assets\)\./);
  const silent = draftOf(shot('2.1'), 'none', 30);
  const add = shotImpact(shot('2.1'), silent, { ...silent, narration: 'recording' }, { keyframe: null, clip: null, voice: null }, 'en-US');
  assert.equal(add.tone, 'none');
  assert.match(add.parts.map(en).join(' '), /2\.1 will use your recording; add it in Keyframes\./);
  assert.equal(en(planRecordingNote(shot('2.1'), 'uploaded')), 'Add the recording on 2.1 in Keyframes.');
  assert.equal(en(planRecordingNote({ ...s12, narration: { ...s12.narration, measuredSeconds: 4.2 } }, 'uploaded', 'recording')), 'Your recording, 4.2 s. Replace it in Keyframes.');
  assert.equal(planRecordingImpact(shot('2.1')).replaces, false);
});

// ---- a shot set to "My recording" whose take is still a voice line (review finding 3) ----------------------------

const voicedRead = (s) => ({ shotId: s.shotId, headVersion: 1, segment: { audio: { id: 'v', media: { sha256: 'a'.repeat(64), probe: { audio: { samples: Math.round(s.narration.measuredSeconds * 48000) } } }, originEvidence: 'verified_generated_audio', generation: { voice: 'cedar' } } } });
const recordedRead = (s) => ({ shotId: s.shotId, headVersion: 1, segment: { audio: { id: 'r', declaredOrigin: 'uploaded', media: { sha256: 'b'.repeat(64), probe: { audio: { samples: Math.round(s.narration.measuredSeconds * 48000) } } } } } });

test("the take's origin: a recording, a voice line, or not known; only a known voice line is not the person's recording", () => {
  const s12 = shot('1.2');
  assert.equal(takeOrigin(s12, voicedRead(s12)), 'voice');
  assert.equal(takeOrigin(s12, recordedRead(s12)), 'recording');
  assert.equal(takeOrigin(s12, null), null);
  assert.equal(recordingInUse(s12, 'uploaded', 'recording'), true);
  assert.equal(recordingInUse(s12, 'uploaded', null), true, 'an unknown take counts as the recording, so leaving it is never free');
  assert.equal(recordingInUse(s12, 'uploaded', 'voice'), false);
  assert.equal(recordingInUse(s12, 'generated', 'recording'), false);
  assert.equal(recordingInUse(shot('2.1'), 'uploaded', null), false, 'no take yet');
});

test('"My recording" on a voiced shot: the row, the panel and Plan name the voice line still in use', () => {
  const s12 = shot('1.2');
  const notes = (row) => row.notes.map((n) => en(n.message));
  assert.deepEqual(notes(narrationRow(s12, 30, 'uploaded', 'voice')), ['not added yet · the voice line plays (2.1 s)']);
  assert.deepEqual(notes(narrationRow(s12, 30, 'uploaded', 'recording')), ['2.1 s']);
  assert.deepEqual(notes(narrationRow(s12, 30, 'uploaded')), ['2.1 s take'], 'not read yet: its length, never "your recording"');
  assert.deepEqual(narrationRow(s12, 30, 'uploaded', 'voice').notes.map((n) => zh(n.message)), ['还没有添加 · 目前播放配音（2.1 秒）']);
  const overview = lastFerryOverview();
  assert.deepEqual(notes(inspectorView(overview, overview.shots[shotId('1.2')], 'en-US', 'uploaded', 'voice').rows[2]), ['not added yet · the voice line plays (2.1 s)']);
  assert.equal(en(slotNote(s12, 'uploaded', 'voice').message), 'No recording yet. Until you add one, the voice line below plays.');
  assert.equal(slotNote(s12, 'uploaded', 'recording'), null);
  assert.equal(slotNote(s12, 'generated', 'voice'), null);
  assert.equal(en(planRecordingNote(s12, 'uploaded', 'voice')), 'Still the voice line (2.1 s): add your recording on 1.2 in Keyframes.');
  assert.equal(en(planRecordingNote(s12, 'uploaded', 'recording')), 'Your recording, 2.1 s. Replace it in Keyframes.');
  assert.equal(en(planRecordingNote(s12, 'uploaded', null)), 'A 2.1 s take is in use. Add or replace the recording on 1.2 in Keyframes.');
});

// ---- leaving "My recording" (review finding 2) -------------------------------------------------------------------

test('Keyframes: leaving the recording says it stops being used, and a line prices the voice line (never $0.00)', () => {
  const s12 = shot('1.2');
  assert.equal(en(noneImpact(s12, 'uploaded', 'recording')), '1.2 will have no narration. Your recording stops being used; it stays in Assets.');
  assert.equal(en(noneImpact(s12, 'uploaded', 'voice')), '1.2 will have no narration. Its voice line stays in Assets.');
  assert.equal(en(noneImpact(s12, 'generated')), '1.2 will have no narration. Its voice line stays in Assets.');
  assert.equal(en(lineFromRecordingImpact(20000, 'en-US')), "Your recording stops being used (it stays in Assets). A voice line will be made, about $0.02, with the scene's next keyframes or video.");
  assert.equal(en(lineFromRecordingImpact(null, 'en-US')), "Your recording stops being used (it stays in Assets). A voice line will be made with the scene's next keyframes or video; no price is set for it.");
  assert.doesNotMatch(en(lineFromRecordingImpact(null, 'en-US')), /\$0\.00/);
  assert.match(zh(lineFromRecordingImpact(20000, 'zh-CN')), /你的录音将不再使用/);
});

test('Plan: leaving a recording in use is a cost, with the voice-line price for a line; a voice line still in use is not a recording', () => {
  const s12 = shot('1.2');
  const recorded = draftOf(s12, 'uploaded', 30);
  const prices = { keyframe: null, clip: null, voice: 20000 };
  const toLine = shotImpact(s12, recorded, { ...recorded, narration: 'line' }, prices, 'en-US', 'recording');
  assert.equal(toLine.tone, 'cost');
  assert.equal(toLine.parts.map(en).join(' '), '1.2 **stops using your recording** (it stays in Assets); a voice line will be made, **about $0.02**.');
  // A changed line is priced once, with the recording it replaces.
  const rewritten = shotImpact(s12, recorded, { ...recorded, narration: 'line', line: 'Another line.' }, prices, 'en-US', 'recording');
  assert.equal(rewritten.parts.filter((part) => /\$0\.02/.test(en(part))).length, 1);
  const toNone = shotImpact(s12, recorded, { ...recorded, narration: 'none' }, prices, 'en-US', null);
  assert.equal(toNone.tone, 'cost');
  assert.equal(toNone.parts.map(en).join(' '), '1.2 will have no narration: **your recording stops being used** (it stays in Assets).');
  assert.equal(en(planLeaveRecordingImpact('line', s12, null, 'en-US')), '1.2 **stops using your recording** (it stays in Assets); a voice line will be made (no price set).');
  // The take is still the voice line: going back to a line changes nothing; None drops that voice line.
  const backToLine = shotImpact(s12, recorded, { ...recorded, narration: 'line' }, prices, 'en-US', 'voice');
  assert.equal(backToLine.tone, 'none');
  assert.equal(draftEffects(s12, recorded, { ...recorded, narration: 'none' }, 'voice').voiceDropped, true);
  assert.equal(shotImpact(s12, recorded, { ...recorded, narration: 'none' }, prices, 'en-US', 'voice').parts.map(en).join(' '), '1.2 will have no narration. Its voice line stays in Assets.');
  // No recording added yet: nothing is dropped.
  const empty = draftOf(shot('2.1'), 'uploaded', 30);
  assert.equal(draftEffects(shot('2.1'), empty, { ...empty, narration: 'none' }).recordingDropped, false);
});

// ---- Plan rows (review finding 6) --------------------------------------------------------------------------------

test("Plan rows: a shot set to \"My recording\" shows its words (never the studio's stand-in) and its take, in both languages", () => {
  const s23 = shot('2.3');
  const recorded = { ...s23, narration: { state: 'ready', text: RECORDING_WITHOUT_WORDS, measuredSeconds: 3, fits: true } };
  const row = narrationView(recorded, 'uploaded', 30);
  assert.equal(row.kind, 'line');
  assert.equal(row.text, '');
  assert.equal(en(row.detail), 'My recording chosen · 3 s take');
  assert.equal(zh(row.detail), '已选“我的录音” · 3 秒音频');
  assert.equal(narrationView({ ...recorded, narration: { ...recorded.narration, text: 'Last boat.' } }, 'uploaded', 30).text, 'Last boat.');
  const missing = narrationView(shot('2.1'), 'uploaded', 30);
  assert.deepEqual([missing.kind, en(missing.detail)], ['line', 'My recording chosen · not added yet']);
  assert.deepEqual(planRowRecording(shot('2.1')).text, '');
  // Other modes read as before.
  assert.equal(en(narrationView(s23, 'generated', 30).detail), '7.4 s voice line');
});
