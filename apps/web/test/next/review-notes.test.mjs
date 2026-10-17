import test from 'node:test';
import assert from 'node:assert/strict';
import { threadView } from '../../src/next/model/director.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const NOW = new Date('2026-10-16T12:00:00');
const en = message => translateMsg('en', message);
const zh = message => translateMsg('zh-CN', message);
const failure = (reason = 'invalid_anchor') => ({ code: 'VALIDATION_ERROR', reason });
const review = (notesSaveFailure = failure(), extra = {}) => ({
  id: 'review-turn', requestId: 'review-request', action: 'keyframe_review', state: 'completed',
  notesSaveFailure, ...extra,
});
const reply = (id = 'review-reply', text = 'Keep both keyframes.') => ({ id, requestId: 'review-request', role: 'assistant', text });
const viewOf = (turns, conversation = [reply()]) => threadView(
  { ...lastFerrySnapshot(NOW), conversation, turns }, lastFerryOverview(), lastFerryDirector, 'en', NOW,
);

test('a refused automatic review has an application line with its reason in English and Chinese', () => {
  const reasons = [
    ['invalid_anchor', 'a note must point at a scene or shot.', '备注必须指向某一场或某个镜头。'],
    ['invalid_arguments', 'the note details did not match the expected format.', '备注内容不符合所需格式。'],
    ['outside_scope', 'a note points outside the reviewed shots.', '备注指向了本次审阅范围之外的镜头。'],
    ['unseen_keyframe', 'a note refers to a keyframe the Director was not shown.', '备注引用了导演没有看到的关键帧。'],
    ['missing_keep_choice', 'a blocking note needs a Keep choice.', '阻止视频生成的备注需要提供“保留”选项。'],
    ['unavailable', 'note saving was unavailable.', '当时无法保存备注。'],
  ];
  for (const [reason, english, chinese] of reasons) {
    const entry = viewOf([review(failure(reason))]).entries[0];
    assert.ok(entry.reviewNotesFailure, reason);
    assert.equal(en(entry.reviewNotesFailure), `Some review notes were not saved: ${english}`);
    assert.equal(zh(entry.reviewNotesFailure), `部分审阅备注未保存：${chinese}`);
    assert.equal(entry.attention, null, 'a refused note does not imply the Director turn failed');
  }
});

test('an uncertain review note save says its outcome is unknown in both languages without claiming a refusal', () => {
  const entry = viewOf([review({ code: 'TOOL_CALL_UNRESOLVED', reason: 'unknown' })]).entries[0];
  assert.equal(en(entry.reviewNotesFailure), "The application could not confirm whether the review's notes were saved (TOOL_CALL_UNRESOLVED).");
  assert.equal(zh(entry.reviewNotesFailure), '应用无法确认审阅备注是否已保存（TOOL_CALL_UNRESOLVED）。');
  assert.doesNotMatch(en(entry.reviewNotesFailure), /were not saved/);
  assert.doesNotMatch(zh(entry.reviewNotesFailure), /未保存/);
});

test('the app line belongs to the last review reply and survives later Director turns', () => {
  const later = { id: 'later-turn', requestId: 'later-request', action: 'conversation', state: 'completed' };
  const conversation = [reply('review-first', 'Checking the frames.'), reply(), { id: 'later-reply', requestId: 'later-request', role: 'assistant', text: 'The film is unchanged.' }];
  const view = viewOf([review(), later], conversation);
  assert.equal(view.entries[0].reviewNotesFailure, null);
  assert.ok(view.entries[1].reviewNotesFailure);
  assert.equal(view.entries[2].reviewNotesFailure, null);
  assert.deepEqual(view.reviewNotesFailures, [], 'a placed failure is not repeated below the thread');
});

test('a review without a reply still shows its app line, even when no conversation is present', () => {
  for (const conversation of [[], [{ id: 'other-reply', requestId: 'other-request', role: 'assistant', text: 'Earlier reply.' }]]) {
    const view = viewOf([review()], conversation);
    assert.equal(view.reviewNotesFailures.length, 1);
    assert.equal(view.reviewNotesFailures[0].id, 'review-turn');
    assert.match(en(view.reviewNotesFailures[0].message), /notes were not saved.*scene or shot/);
    assert.match(zh(view.reviewNotesFailures[0].message), /审阅备注未保存.*场.*镜头/);
    assert.ok(view.entries.every(entry => entry.reviewNotesFailure === null));
  }
});

test('a corrected note save clears the app line; ordinary turns and still-running corrections do not claim a failed review', () => {
  const olderServer = review();
  delete olderServer.notesSaveFailure;
  for (const turn of [
    review(null), olderServer, review(failure(), { action: 'conversation' }),
    review(failure(), { state: 'running' }), review(failure(), { state: 'queued' }),
  ]) {
    const view = viewOf([turn]);
    assert.equal(view.entries[0].reviewNotesFailure, null);
    assert.deepEqual(view.reviewNotesFailures, []);
  }
  // A later completed turn of the same request is authoritative, including its successful correction.
  assert.equal(viewOf([review(), review(null, { id: 'retry-turn' })]).entries[0].reviewNotesFailure, null);
});

test('the app never infers a note-save refusal from Director prose or an empty notes count', () => {
  const prose = reply('prose', 'Notes could not be saved because the application rejected the note payload.');
  const view = viewOf([{ ...review(null), effects: { notesCreated: 0, proposalsHeld: 0, changesApplied: 0 } }], [prose]);
  assert.deepEqual(view.entries[0].paragraphs, [prose.text]);
  assert.equal(view.entries[0].reviewNotesFailure, null);
  assert.deepEqual(view.reviewNotesFailures, []);
});
