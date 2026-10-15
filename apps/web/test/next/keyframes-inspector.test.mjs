import test from 'node:test';
import assert from 'node:assert/strict';
import { outdatedBy, editImpact, parseSeconds, durationIssue, inspectorView, clipUnit } from '../../src/next/model/inspector.ts';
import { lastFerryOverview, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m);
const view = (overview, label) => inspectorView(overview, overview.shots[shotId(label)], 'en-US');

test('each edited field outdates exactly the media the server detaches (SB-10)', () => {
  assert.deepEqual(outdatedBy('imagePrompt'), { keyframe: true, video: true });
  assert.deepEqual(outdatedBy('motion'), { keyframe: false, video: true });
  assert.deepEqual(outdatedBy('desiredFrames'), { keyframe: false, video: true });
  assert.deepEqual(outdatedBy('narration'), { keyframe: false, video: false });
});

test('before saving, the form says what this shot would lose', () => {
  const overview = lastFerryOverview();
  const s22 = overview.shots[shotId('2.2')], s11 = overview.shots[shotId('1.1')], s23 = overview.shots[shotId('2.3')], s31 = overview.shots[shotId('3.1')];
  assert.equal(en(editImpact(s22, ['imagePrompt'])), 'Saving outdates this keyframe; it will need regenerating.');
  assert.equal(en(editImpact(s11, ['imagePrompt'])), 'Saving outdates this keyframe and its clip.');
  assert.equal(en(editImpact(s11, ['motion', 'desiredFrames'])), "Saving outdates this shot's clip; the keyframe stays.");
  assert.equal(en(editImpact(s22, ['motion', 'desiredFrames'])), 'The keyframe stays. No clip exists yet, so nothing needs redoing.');
  assert.equal(en(editImpact(s23, ['narration'])), 'Nothing visual changes. The voice line will be made again.');
  assert.equal(en(editImpact(s22, ['narration'])), 'Nothing visual changes.');
  assert.equal(en(editImpact(s31, ['imagePrompt'])), 'No media needs redoing.');
  const running = { ...s22, keyframe: { ...s22.keyframe, state: 'running' } };
  assert.match(en(editImpact(running, ['imagePrompt'])), /still be charged/);
});

test('durations are whole seconds from 3 to 15, with a warning below a measured line', () => {
  assert.deepEqual(['2', '3', '15', '16', '7.5', '', 'x'].map(parseSeconds), [null, 3, 15, null, null, null, null]);
  const overview = lastFerryOverview();
  const s23 = overview.shots[shotId('2.3')];
  assert.equal(durationIssue('16', s23).kind, 'refusal');
  assert.equal(en(durationIssue('16', s23).message), 'Use whole seconds from 3 to 15.');
  assert.equal(durationIssue('8', s23), null);
  assert.equal(durationIssue('6', s23).kind, 'warning');
  assert.equal(durationIssue('4', overview.shots[shotId('2.2')]), null);
});

test('the inspector rows: motion, duration, narration measured or estimated, and takes', () => {
  const overview = lastFerryOverview();
  const rows = r => r.rows.map(row => [row.key, typeof row.value === 'string' ? row.value : en(row.value), row.notes.map(n => en(n.message))]);
  assert.deepEqual(rows(view(overview, '2.3')), [
    ['motion', 'Slow tilt down', []],
    ['duration', '6 s', []],
    ['narration', 'It was the last boat of the season, and I nearly missed it.', ['7.4 s voiced', 'longer than the shot']],
  ]);
  assert.deepEqual(rows(view(overview, '3.2'))[2], ['narration', 'I didn’t look back.', ['about 1.6 s (estimate, not voiced yet)']]);
  assert.deepEqual(rows(view(overview, '2.1'))[2], ['narration', 'None', []]);
  overview.shots[shotId('2.2')].keyframe.takeCount = 2;
  assert.deepEqual(rows(view(overview, '2.2'))[3], ['takes', '2', ['take 2 shown, earlier kept']]);
  assert.equal(en(view(overview, '2.3').title), 'Shot 2.3');
});

test('Regenerate keyframe shows its price, and what a finished clip would cost to redo', () => {
  const overview = lastFerryOverview();
  const r21 = view(overview, '2.1').regenerate;
  assert.deepEqual([en(r21.label), en(r21.cost), r21.primary, r21.enabled, r21.clipNote], ['Regenerate keyframe', 'A new take costs about $0.04.', false, true, null]);
  // Scene 1 has clips; one clip costs what Scene 2's confirm quotes per clip.
  assert.deepEqual(clipUnit(overview, overview.scenes[0]), { unitMicros: '500000', unknown: false });
  assert.equal(en(view(overview, '1.1').regenerate.clipNote), 'Its clip will need redoing, about $0.50.');
  const r31 = view(overview, '3.1').regenerate;
  assert.deepEqual([en(r31.label), en(r31.cost), r31.primary, r31.kind], ['Make keyframe', 'About $0.04.', true, 'make']);
});

test("the shot's own regenerate quote wins, since it includes a voice line still to make", () => {
  const overview = lastFerryOverview();
  overview.shots[shotId('3.2')].quotes = { regenerateKeyframe: { micros: '55000', units: 2, unitMicros: '0', priceUnknown: false } };
  assert.equal(en(view(overview, '3.2').regenerate.cost), 'About $0.06.');
  overview.shots[shotId('2.1')].quotes = { regenerateKeyframe: { micros: '0', units: 1, unitMicros: '0', priceUnknown: true } };
  assert.equal(en(view(overview, '2.1').regenerate.cost), 'no price set');
});

test('while making, out of date, failed, or waiting on a clip', () => {
  const overview = lastFerryOverview();
  const s22 = overview.shots[shotId('2.2')];
  const at = patch => { overview.shots[shotId('2.2')] = { ...s22, ...patch }; return view(overview, '2.2'); };
  const making = at({ keyframe: { ...s22.keyframe, state: 'running' } }).regenerate;
  assert.deepEqual([en(making.label), making.enabled, making.working], ['Making keyframe…', false, true]);
  const outdated = at({ keyframe: { state: 'outdated', previous: s22.keyframe.artifact, takeCount: 1, opened: false } }).regenerate;
  assert.deepEqual([en(outdated.label), outdated.primary, en(outdated.reason)], ['Regenerate keyframe', true, 'The prompt changed; the earlier keyframe is shown.']);
  const failed = at({ keyframe: { state: 'failed', takeCount: 0, opened: false, failure: { code: 'X', technical: true, retryAllowed: true, autoRetriesLeft: 0, charged: true, at: 'x' } } });
  assert.equal(en(failed.failure.message), 'Keyframe failed · counted as spent');
  assert.deepEqual([en(failed.regenerate.label), failed.regenerate.enabled], ['Make again', true]);
  const retrying = at({ keyframe: { state: 'failed', takeCount: 0, opened: false, failure: { code: 'X', technical: true, retryAllowed: true, autoRetriesLeft: 2, charged: false, at: 'x' } } });
  assert.equal(en(retrying.failure.message), 'Failed; it will retry by itself (2 left).');
  assert.equal(retrying.regenerate.enabled, false);
  const refused = at({ keyframe: { state: 'failed', takeCount: 0, opened: false, failure: { code: 'X', technical: false, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: 'x' } } });
  assert.match(en(refused.failure.message), /did not charge/);
  const clip = at({ video: { state: 'running', takeCount: 0 } }).regenerate;
  assert.deepEqual([clip.enabled, en(clip.reason)], [false, "Wait for this shot's clip to finish."]);
});

test('a job with no answer offers the give-up flow for its attempt', () => {
  const overview = lastFerryOverview();
  const s22 = overview.shots[shotId('2.2')];
  overview.shots[shotId('2.2')] = { ...s22, keyframe: { state: 'no_answer', attemptId: 'attempt-9', takeCount: 1, opened: false } };
  const v = view(overview, '2.2');
  assert.deepEqual(v.noAnswer, { slot: 'keyframe', attemptId: 'attempt-9' });
  assert.equal(v.regenerate.enabled, false);
  assert.equal(en(v.status), 'No answer from the service');
});

test('a failed clip offers to make it again only when the scene can be confirmed', () => {
  const overview = lastFerryOverview();
  const s21 = overview.shots[shotId('2.1')];
  overview.shots[shotId('2.1')] = { ...s21, video: { state: 'failed', takeCount: 0, failure: { code: 'X', technical: true, retryAllowed: true, autoRetriesLeft: 0, charged: false, at: 'x' } } };
  const blocked = view(overview, '2.1').failure;
  assert.deepEqual([blocked.slot, en(blocked.message), blocked.retryVideo.enabled, en(blocked.retryVideo.price)], ['video', 'Video failed · not charged', false, 'about $0.50']);
  overview.scenes[1].blockers = [];
  assert.equal(view(overview, '2.1').failure.retryVideo.enabled, true);
});
