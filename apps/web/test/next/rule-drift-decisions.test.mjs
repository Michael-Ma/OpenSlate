import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCommand } from '../../src/next/fixtures/fixture-commands.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, lastFerryProposals, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { applyDirectorPresets } from '../../src/next/fixtures/fixture-director.ts';
import { inspectorView, DETACH_AFTER_MS } from '../../src/next/model/inspector.ts';
import { filmAttentionItems } from '../../src/next/model/attention.ts';
import { nativeDiagnosticMsg, translateMsg, errorMsg } from '../../src/next/i18n/translate.ts';

// Rule-drift review section 3, decisions R1-R4, in the sample film and the web model.

function world() {
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector }, proposals: lastFerryProposals(),
    update(change) { change(w); const cursor = w.overview.cursor + 1; w.overview = { ...w.overview, cursor }; w.snapshot = { ...w.snapshot, cursor }; },
    later() {},
  };
  applyDirectorPresets(w, ['stuck']);
  return w;
}
const post = (w, path, body) => fixtureCommand(w, 'POST', path, body);
const shot = (w, label) => w.overview.shots[shotId(label)];
const both = message => [translateMsg('en', message), translateMsg('zh-CN', message)];
const refused = code => error => error.code === code;

test('R1: an unanswered Codex job says the allowlisted reason in both languages; no reason keeps the old words', () => {
  const [en, zh] = both(nativeDiagnosticMsg({ category: 'native_unknown', reason: 'process_exit', message: 'PRIVATE' }, 'images', true));
  assert.match(en, /Codex process stopped/); assert.match(en, /Nothing was charged/); assert.match(zh, /Codex 进程意外退出/);
  assert.doesNotMatch(en + zh, /PRIVATE/);
  assert.equal(translateMsg('en', nativeDiagnosticMsg({ category: 'native_unknown' }, 'images')), translateMsg('en', { id: 'error.CODEX_IMAGES_native_unknown', values: { notDispatched: 0 } }));
  assert.equal(translateMsg('en', nativeDiagnosticMsg({ category: 'native_unknown', reason: 'not-a-reason' }, 'images')), translateMsg('en', { id: 'error.CODEX_IMAGES_native_unknown', values: { notDispatched: 0 } }));
  const w = world(), view = inspectorView(w.overview, shot(w, '3.1'), 'en');
  assert.equal(view.noAnswer.attemptId, 'fixture-attempt-stuck-3-1');
  const [reasonEn, reasonZh] = both(view.noAnswer.reason);
  assert.match(reasonEn, /Codex process stopped/); assert.match(reasonZh, /进程/);
});

test('R2: a finished clip whose download expired offers a confirmed discard, and the sample film frees the shot', () => {
  const w = world(), view = inspectorView(w.overview, shot(w, '2.1'), 'en');
  assert.deepEqual(view.discard, { slot: 'video', attemptId: 'fixture-attempt-stuck-2-1' });
  assert.equal(view.noAnswer, null, 'a finished job is never offered Give up');
  assert.throws(() => post(w, '/attempts/fixture-attempt-stuck-2-1/discard', { expectedPhase: 'ingesting' }), refused('DISCARD_NOT_ACKNOWLEDGED'));
  assert.throws(() => post(w, '/attempts/fixture-attempt-stuck-2-1/release', { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true }), refused('ATTEMPT_NOT_RELEASABLE'));
  const receipt = post(w, '/attempts/fixture-attempt-stuck-2-1/discard', { expectedPhase: 'ingesting', acknowledgeDiscard: true });
  assert.equal(receipt.attemptId, 'fixture-attempt-stuck-2-1'); assert.equal(receipt.shotId, shotId('2.1'));
  const slot = shot(w, '2.1').video;
  assert.equal(slot.state, 'none'); assert.equal(slot.ingestionIssue, undefined); assert.equal(slot.takenOff, 'released');
  assert.equal(inspectorView(w.overview, shot(w, '2.1'), 'en').discard, null);
  assert.throws(() => post(w, '/attempts/fixture-attempt-stuck-2-1/discard', { expectedPhase: 'ingesting', acknowledgeDiscard: true }), refused('ATTEMPT_NOT_DISCARDABLE'));
});

test('R3: a job that keeps running is offered Stop waiting only after a while, and detaching keeps it billed', () => {
  const w = world(), running = shot(w, '2.2');
  assert.equal(running.video.phase, 'remote_pending');
  const started = Date.parse(running.video.startedAt);
  assert.equal(inspectorView(w.overview, running, 'en', undefined, null, null, started + DETACH_AFTER_MS - 1).detach, null);
  assert.deepEqual(inspectorView(w.overview, running, 'en', undefined, null, null, started + DETACH_AFTER_MS).detach, { slot: 'video', attemptId: 'fixture-attempt-stuck-2-2' });
  assert.throws(() => post(w, '/attempts/fixture-attempt-stuck-2-2/release', { expectedPhase: 'submission_unknown', acknowledgeDoubleCharge: true }), refused('ATTEMPT_NOT_RELEASABLE'));
  post(w, '/attempts/fixture-attempt-stuck-2-2/release', { expectedPhase: 'remote_pending', acknowledgeDoubleCharge: true });
  const slot = shot(w, '2.2').video;
  assert.equal(slot.state, 'none'); assert.equal(slot.takenOff, 'released'); assert.deepEqual(slot.releasedAttemptIds, ['fixture-attempt-stuck-2-2']);
});

test('R4: an interrupted local render is in Needs attention and Render again takes a fresh retry once', () => {
  const w = world(), items = filmAttentionItems(w.overview);
  assert.deepEqual(items.map(item => item.attemptId), ['fixture-attempt-render']);
  const [en, zh] = both(items[0].title);
  assert.match(en, /render was interrupted/); assert.match(zh, /渲染/);
  assert.throws(() => post(w, '/attempts/fixture-attempt-render/retry-local', { expectedFailure: 'LOCAL_EXECUTION_INTERRUPTED' }), refused('RERENDER_NOT_ACKNOWLEDGED'));
  const receipt = post(w, '/attempts/fixture-attempt-render/retry-local', { expectedFailure: 'LOCAL_EXECUTION_INTERRUPTED', acknowledgeRerender: true });
  assert.equal(receipt.attemptId, 'fixture-attempt-render');
  assert.deepEqual(filmAttentionItems(w.overview), []);
  assert.throws(() => post(w, '/attempts/fixture-attempt-render/retry-local', { expectedFailure: 'LOCAL_EXECUTION_INTERRUPTED', acknowledgeRerender: true }), refused('ATTEMPT_NOT_RETRYABLE'));
});

test('the new refusal codes have words in both languages', () => {
  for (const code of ['ATTEMPT_NOT_DISCARDABLE', 'DISCARD_NOT_ACKNOWLEDGED', 'ATTEMPT_NOT_RETRYABLE', 'RERENDER_NOT_ACKNOWLEDGED', 'LOCAL_EXECUTION_RECOVERABLE']) {
    const message = errorMsg(code);
    assert.equal(message.id, `error.${code}`, code);
    const [en, zh] = both(message); assert.ok(en.length > 10 && zh.length > 4 && en !== zh, code);
  }
});
