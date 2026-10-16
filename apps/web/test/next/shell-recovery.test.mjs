import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backupLine, decisionPhase, finishedAwayToast, isQuarantined, nothingInFlight, NO_RECOVERY, parseRecoveryStatus, parseSavedRelease, RECOVERY_LOCK,
  RECOVERY_POLL_MS, recoveryChange, recoveryLock, recoveryReadOnly, recoveryRows, releaseBody, releaseOutcome, reviewMode, stoppedByRestore,
  unconfirmedStillApplies,
} from '../../src/next/model/recovery.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const counts = { projects: 2, knownJobs: 2, unknownJobs: 1, nativeRequests: 1, unusedAllowances: 0, preparingJobs: 1 };
const receipt = { restoreId: 'restore-1', backupId: 'b1', backupCreatedAt: '2026-10-14T18:20:00.000Z', restoredAt: '2026-10-15T08:05:00.000Z', generation: 1, projectIds: ['p1', 'p2'] };
/** The server's snapshot (installation-recovery.ts), as it comes over the wire. */
const wire = (extra = {}) => ({ state: 'quarantined', receipt, receiptDigest: A, summaryDigest: B, counts, ...extra });
const status = (extra = {}) => parseRecoveryStatus(wire(extra));

// ---- reading -----------------------------------------------------------------------------

test('the server snapshot is read as it is; an ordinary studio has no receipt', () => {
  assert.deepEqual(status(), {
    state: 'quarantined', receipt: { restoreId: 'restore-1', backupCreatedAt: '2026-10-14T18:20:00.000Z', restoredAt: '2026-10-15T08:05:00.000Z' },
    receiptDigest: A, summaryDigest: B, counts,
  });
  const ordinary = parseRecoveryStatus({ state: 'ordinary', receipt: null, receiptDigest: null, summaryDigest: null, counts: { projects: 0, knownJobs: 0, unknownJobs: 0, nativeRequests: 0, unusedAllowances: 0, preparingJobs: 0 } });
  assert.equal(ordinary.state, 'ordinary');
  assert.equal(isQuarantined(ordinary), false);
  for (const value of [null, undefined, 'quarantined', 42, {}, { state: 'paused' }]) assert.equal(parseRecoveryStatus(value), null, JSON.stringify(value));
});

test('a damaged quarantine stays a quarantine (writes stay off) but cannot be released as read', () => {
  const damaged = status({ receipt: { restoreId: 'restore-1' }, receiptDigest: 'not-a-digest', counts: { projects: -1, knownJobs: 1.5 } });
  assert.equal(isQuarantined(damaged), true);
  assert.equal(damaged.receipt, null);
  assert.equal(damaged.receiptDigest, null);
  assert.deepEqual(damaged.counts, { projects: 0, knownJobs: 0, unknownJobs: 0, nativeRequests: 0, unusedAllowances: 0, preparingJobs: 0 });
  assert.equal(releaseBody(damaged), null);
  assert.equal(decisionPhase({ ...NO_RECOVERY, status: damaged }, false), 'unavailable');
  // An older server without preparingJobs reads as none.
  const { preparingJobs: _gone, ...older } = counts;
  assert.equal(status({ counts: older }).counts.preparingJobs, 0);
});

// ---- the read-only flag ----------------------------------------------------------------------

test('the studio is read-only exactly while the installation is quarantined, with one stable reason', () => {
  assert.equal(recoveryReadOnly({ recovery: { ...NO_RECOVERY, status: status() } }), true);
  assert.equal(recoveryLock({ recovery: { ...NO_RECOVERY, status: status() } }), RECOVERY_LOCK);
  assert.equal(recoveryLock({ recovery: { ...NO_RECOVERY, status: status() } }), recoveryLock({ recovery: { ...NO_RECOVERY, status: status() } }), 'a stable value for selectors');
  for (const state of ['ordinary', 'released']) assert.equal(recoveryReadOnly({ recovery: { ...NO_RECOVERY, status: status({ state }) } }), false, state);
  // Not read yet, or a server without the route: the server's own refusal still protects writes.
  assert.equal(recoveryReadOnly({ recovery: NO_RECOVERY }), false);
  assert.equal(recoveryLock({ recovery: NO_RECOVERY }), null);
  assert.equal(en(RECOVERY_LOCK), 'This studio was restored from a backup. Finish the recovery review to make changes.');
});

// ---- the release ---------------------------------------------------------------------------

test('the release is bound to exactly the receipt and summary that were read', () => {
  assert.deepEqual(releaseBody(status()), { restoreId: 'restore-1', expectedReceiptDigest: A, expectedSummaryDigest: B });
  assert.deepEqual(releaseBody(status({ summaryDigest: C })), { restoreId: 'restore-1', expectedReceiptDigest: A, expectedSummaryDigest: C });
  assert.equal(releaseBody(status({ state: 'released' })), null);
  assert.equal(releaseBody(status({ summaryDigest: null })), null);
  assert.equal(releaseBody(null), null);
});

test('an unconfirmed release stays on offer only while the same restore is still in review', () => {
  const saved = { key: 'k-1', body: releaseBody(status()) };
  assert.equal(unconfirmedStillApplies(saved, status()), true);
  // A changed summary keeps it: resending it is how the person finds out (the server refuses a stale summary).
  assert.equal(unconfirmedStillApplies(saved, status({ summaryDigest: C })), true);
  assert.equal(unconfirmedStillApplies(saved, status({ state: 'released' })), false, 'released: nothing left to settle');
  assert.equal(unconfirmedStillApplies(saved, status({ receipt: { ...receipt, restoreId: 'restore-2' } })), false, 'a newer restore');
  assert.equal(unconfirmedStillApplies(saved, null), true, 'not read yet');
  assert.equal(unconfirmedStillApplies(null, status()), false);
});

test('a saved release survives a reload only when it is one', () => {
  const saved = { key: '3f2a-uuid', body: { restoreId: 'restore-1', expectedReceiptDigest: A, expectedSummaryDigest: B } };
  assert.deepEqual(parseSavedRelease(JSON.stringify(saved)), saved);
  for (const raw of [null, '', '{', '[]', JSON.stringify({ key: '', body: saved.body }), JSON.stringify({ key: 'k', body: { ...saved.body, expectedSummaryDigest: 'x' } }),
    JSON.stringify({ key: '-starts-badly', body: saved.body }), JSON.stringify({ key: 'k' })])
    assert.equal(parseSavedRelease(raw), null, String(raw));
});

test('what the answer to a release means: definite answers settle it, no answer keeps the same decision', () => {
  assert.equal(releaseOutcome(null), 'released');
  assert.equal(releaseOutcome({ code: 'NETWORK_ERROR', status: 0 }), 'unconfirmed');
  assert.equal(releaseOutcome({ code: 'INTERNAL_ERROR', status: 500 }), 'unconfirmed');
  assert.equal(releaseOutcome({ code: 'SERVICE_UNAVAILABLE', status: 503 }), 'unconfirmed');
  assert.equal(releaseOutcome({ code: 'RECOVERY_CONFLICT', status: 409 }), 'stale');
  assert.equal(releaseOutcome({ code: 'RECOVERY_ALREADY_RELEASED', status: 409 }), 'already');
  assert.equal(releaseOutcome({ code: 'VALIDATION_ERROR', status: 400 }), 'refused');
});

test('a summary that changed under an open review is flagged; a review finished elsewhere says what happens next', () => {
  assert.deepEqual(recoveryChange(status(), status({ summaryDigest: C })), { stale: true });
  assert.deepEqual(recoveryChange(status(), status()), {});
  assert.deepEqual(recoveryChange(null, status()), {}, 'the first read flags nothing');
  assert.deepEqual(recoveryChange(status(), status({ receipt: { ...receipt, restoreId: 'restore-2' }, summaryDigest: C })), {}, 'a newer restore is a new review');
  assert.deepEqual(recoveryChange(status(), status({ state: 'released' })), { stale: false, released: true });
  assert.deepEqual(recoveryChange(null, status({ state: 'released' })), { stale: false }, 'released before this page: nothing to explain here');
  // After a reload, this page's own saved decision turned out applied: it finishes the review here too.
  const saved = { key: 'k', body: releaseBody(status()) };
  assert.deepEqual(recoveryChange(null, status({ state: 'released' }), saved), { stale: false, released: true });
  assert.deepEqual(recoveryChange(null, status({ state: 'released', receipt: { ...receipt, restoreId: 'restore-2' } }), saved), { stale: false }, 'another restore');
});

// ---- the review ----------------------------------------------------------------------------

test('the review shows while quarantined, and what happens next once this window finished it', () => {
  assert.equal(reviewMode({ ...NO_RECOVERY, status: status() }), 'review');
  assert.equal(reviewMode({ ...NO_RECOVERY, status: status({ state: 'released' }), released: true }), 'released');
  assert.equal(reviewMode({ ...NO_RECOVERY, status: status({ state: 'released' }) }), 'none');
  assert.equal(reviewMode(NO_RECOVERY), 'none');
});

test('the decision: Finish, sending, or only Retry after a lost reply', () => {
  const recovery = { ...NO_RECOVERY, status: status() };
  assert.equal(decisionPhase(recovery, false), 'ready');
  assert.equal(decisionPhase(recovery, true), 'sending');
  const lost = { ...recovery, unconfirmed: { key: 'k', body: releaseBody(status()) } };
  assert.equal(decisionPhase(lost, false), 'unconfirmed');
  assert.equal(decisionPhase(lost, true), 'sending', 'a Retry on its way is busy like a Finish');
  // A decision saved for another restore does not hold this one back.
  assert.equal(decisionPhase({ ...lost, status: status({ receipt: { ...receipt, restoreId: 'restore-2' } }) }, false), 'ready');
  // A quarantine read without its digests cannot be finished as read: Check again.
  assert.equal(decisionPhase({ ...recovery, status: status({ summaryDigest: 'nope' }) }, false), 'unavailable');
});

test('a review finished while it was put away is said in a toast; on screen the review says it itself', () => {
  const review = { mode: 'review', held: false };
  assert.equal(en(finishedAwayToast(review, 'released', false)), 'The recovery review was finished in another window. Changes work again; every film stays stopped until you continue it.');
  assert.equal(zh(finishedAwayToast(review, 'released', false)), '恢复检查已在另一个窗口完成。现在可以修改了；每部影片仍保持停止，直到你继续。');
  assert.equal(en(finishedAwayToast({ mode: 'review', held: true }, 'released', false)), 'Your decision to finish the recovery review went through. Changes work again; every film stays stopped until you continue it.');
  assert.equal(finishedAwayToast(review, 'released', true), null, 'the review is on screen');
  assert.equal(finishedAwayToast(review, 'review', false), null, 'still in review');
  assert.equal(finishedAwayToast({ mode: 'released', held: false }, 'none', false), null, 'put away after it was finished');
  assert.equal(finishedAwayToast({ mode: 'none', held: false }, 'released', false), null);
  assert.ok(RECOVERY_POLL_MS >= 15_000, 'Start asks now and then, not all the time');
});

test('the counts list every kind, each with what happens to it when there are some', () => {
  const rows = recoveryRows(counts);
  assert.deepEqual(rows.map((row) => [row.key, row.count]), [['films', 2], ['known', 2], ['uncertain', 1], ['preparing', 1], ['requests', 1]]);
  assert.deepEqual(rows.map((row) => en({ id: row.label })), ['Films', 'Known pending jobs', 'Uncertain jobs', 'Local preparations, not submitted', 'Saved Director requests']);
  assert.deepEqual(rows.map((row) => zh({ id: row.label })), ['影片', '已知的待完成任务', '结果不确定的任务', '本机准备中、未提交', '已保存的导演请求']);
  assert.equal(en(rows[1].note), 'Sent before the backup. Their results can still come back after the review; they are never sent again.');
  assert.equal(en(rows[2].note), 'It isn’t known whether it reached the service. It stays unresolved: a result may still arrive and be charged, and nothing is resent by itself.');
  assert.equal(zh(rows[2].note), '不确定是否已到达服务。会保持未解决：结果仍可能返回并计费，不会自动重发。');
  assert.equal(en(rows[3].note), 'It never reached the service and stays stopped after the review. Continue the film, then make it again from its scene.');
  assert.equal(en(rows[4].note), 'It won’t run again. Send the Director a new message when you continue.');
  assert.equal(rows[0].note, null, 'films need no note');
  const quiet = { ...counts, knownJobs: 0, unknownJobs: 0, preparingJobs: 0, nativeRequests: 0 };
  assert.deepEqual(recoveryRows(quiet).map((row) => [row.key, row.count, row.note]), [['films', 2, null], ['known', 0, null], ['uncertain', 0, null], ['preparing', 0, null], ['requests', 0, null]], 'a zero says plainly that none were found');
  assert.equal(nothingInFlight(quiet), true);
  assert.equal(nothingInFlight(counts), false);
});

test('when the backup was made, in both languages, and when it is not known', () => {
  assert.equal(en(backupLine(status(), 'en', 'UTC')), 'Backup made 14 Oct 2026, 18:20. Anything done after that may be missing.');
  assert.equal(zh(backupLine(status(), 'zh-CN', 'UTC')), '备份时间：2026年10月14日 18:20。之后做的工作可能没有恢复。');
  assert.equal(en(backupLine(status({ receipt: null }), 'en')), 'When the backup was made isn’t known. Recent work may be missing.');
  assert.equal(en(backupLine(status({ receipt: { ...receipt, backupCreatedAt: 'yesterday' } }), 'en')), 'When the backup was made isn’t known. Recent work may be missing.');
});

test('a film stopped by the restore is told apart from an ordinary stop', () => {
  const stop = { stopId: 'restore-1', at: 'now', sentJobs: 0, detachedJobs: 0 };
  assert.equal(stoppedByRestore({ stopped: stop, controlAuthorityId: 'restore-1' }, status({ state: 'released' })), true);
  assert.equal(stoppedByRestore({ stopped: { ...stop, stopId: 'x' }, controlAuthorityId: 'restore-1' }, status()), true);
  assert.equal(stoppedByRestore({ stopped: { ...stop, stopId: 'stop-9' }, controlAuthorityId: 'authority-9' }, status()), false, 'stopped by a person');
  assert.equal(stoppedByRestore({ stopped: null, controlAuthorityId: null }, status()), false, 'continued');
  assert.equal(stoppedByRestore({ stopped: stop, controlAuthorityId: 'restore-1' }, null), false);
});
