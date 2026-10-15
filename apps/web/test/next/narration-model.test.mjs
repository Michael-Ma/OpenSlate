import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choiceLabel, modeEdit, modeOf, NARRATION_CHOICES, narrationChoiceOf, narrationRow, noneImpact, planRecordingImpact, planRecordingNote,
  RECORDING_WITHOUT_WORDS, slotNote, takeView, voiceImpact, voiceOptions, voiceUnit, wordsOf,
} from '../../src/next/model/narration.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { draftEdits, draftOf, shotImpact } from '../../src/next/model/plan-edit.ts';
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
  const recorded = narrationRow({ ...s23, narration: { state: 'ready', text: RECORDING_WITHOUT_WORDS, measuredSeconds: 4.2, fits: true } }, 30, 'uploaded');
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
  assert.match(impact.parts.map(en).join(' '), /1\.2 will use your recording instead of its voice line, which stays in Assets; add it in Keyframes\./);
  const silent = draftOf(shot('2.1'), 'none', 30);
  const add = shotImpact(shot('2.1'), silent, { ...silent, narration: 'recording' }, { keyframe: null, clip: null, voice: null }, 'en-US');
  assert.equal(add.tone, 'none');
  assert.match(add.parts.map(en).join(' '), /2\.1 will use your recording; add it in Keyframes\./);
  assert.equal(en(planRecordingNote(shot('2.1'), 'uploaded')), 'Add the recording on 2.1 in Keyframes.');
  assert.equal(en(planRecordingNote({ ...s12, narration: { ...s12.narration, measuredSeconds: 4.2 } }, 'uploaded')), 'Your recording, 4.2 s. Replace it in Keyframes.');
  assert.equal(planRecordingImpact(shot('2.1')).replaces, false);
});
