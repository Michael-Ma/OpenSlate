import test from "node:test";
import assert from "node:assert/strict";
import { recoveryReleaseCommand, recoveryReviewCurrent } from "../src/recovery-model.ts";
import { makeQuestionReply } from "../src/model.ts";
import { pendingCommandsFor } from "../src/pending-command.ts";
const state = () => ({ state: "quarantined", receipt: { restoreId: "restore-1", backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z", generation: 1 },
  receiptDigest: "a".repeat(64), summaryDigest: "b".repeat(64), counts: { projects: 2, knownJobs: 1, unknownJobs: 1, nativeRequests: 3, unusedAllowances: 2 } });
test("recovery review captures exact receipt and liabilities, never body-provided authority", () => {
  const source = state(), command = recoveryReleaseCommand(source, "review-once");
  assert.equal(recoveryReviewCurrent(command, source), true);
  assert.deepEqual(Object.keys(command.body).sort(), ["expectedReceiptDigest", "expectedSummaryDigest", "restoreId"]);
  for (const changed of [{ state: "released" }, { receiptDigest: "c".repeat(64) }, { summaryDigest: "c".repeat(64) }, { receipt: { ...source.receipt, restoreId: "new-restore" } }])
    assert.equal(recoveryReviewCurrent(command, { ...source, ...changed }), false);
  source.summaryDigest = "d".repeat(64); assert.equal(command.body.expectedSummaryDigest, "b".repeat(64));
  for (const changed of [{ state: "ordinary" }, { state: "released" }, { receipt: null }, { summaryDigest: null }]) assert.throws(() => recoveryReleaseCommand({ ...state(), ...changed }, "invalid"));
});
test("uncertain release survives panel/project remount without automatic dispatch and retries only the exact decision", async () => {
  const api = {}, registry = pendingCommandsFor(api, "installation-recovery"), command = recoveryReleaseCommand(state(), "one-decision");
  let calls = 0; const sent = [];
  await registry.run("installation", command, async saved => { calls++; sent.push(structuredClone(saved)); throw Error("response lost after release"); }, () => true);
  const same = pendingCommandsFor(api, "installation-recovery"), retained = same.snapshot("installation").command;
  const unsubscribe = same.subscribe("installation", () => {}); unsubscribe(); assert.equal(calls, 1);
  assert.equal(await same.run("installation", recoveryReleaseCommand(state(), "different"), async () => { calls++; }, () => true), false);
  await same.run("installation", retained, async saved => { calls++; sent.push(structuredClone(saved)); return { state: "released" }; }, () => true);
  assert.equal(calls, 2); assert.deepEqual(sent[0], sent[1]); assert.equal(same.snapshot("installation").command, null);
  assert.equal(pendingCommandsFor({}, "installation-recovery").snapshot("installation").command, null);
});

test("restored question projection cannot create an answer command; ordinary pending questions remain usable", () => {
  const question = { id: "saved-question", requestId: "old", state: "pending", questions: [] };
  assert.equal(makeQuestionReply("project", question, "Warm", "ordinary").body.replyToQuestionId, question.id);
  assert.throws(() => makeQuestionReply("project", { ...question, canAnswer: false }, "Warm", "restored"), /fresh conversation/);
});

test("local preparation disclosure is summary evidence and adds no release or submission authority", () => {
  const legacy = state(), source = { ...state(), counts: { ...state().counts, unknownJobs: 0, preparingJobs: 1 } };
  const command = recoveryReleaseCommand(source, 'review-local-preparation');
  assert.deepEqual(command.body, recoveryReleaseCommand(legacy, 'legacy').body);
  assert.equal(Object.hasOwn(legacy.counts, 'preparingJobs'), false);
  assert.equal(recoveryReviewCurrent(command, { ...source, summaryDigest: 'c'.repeat(64), counts: { ...legacy.counts } }), false);
});
