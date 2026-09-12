import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../../core/dist/index.js";
import { normalizeExecutionOutcome, executionTaskId, EXECUTION_SPOOL_LIMITS } from "../dist/index.js";

const receiptId = "a".repeat(64), sha256 = "b".repeat(64);
function completed(kind = "image", byteLength = 123) {
  return { type: "completed", version: 2, receiptId, vendorTaskId: null, outputs: [{ port: kind, kind,
    mimeType: kind === "image" ? "image/png" : "video/mp4", extension: kind === "image" ? "png" : "mp4",
    sha256, byteLength, fixture: false, storage: { type: "spool", spoolId: receiptId } }] };
}
test("historical outcomes keep their exact fields and digests", () => {
  for (const old of [{ type: "completed", taskId: "legacy-task", outputs: [{ port: "image", kind: "image", mimeType: "image/svg+xml",
    extension: "svg", bytesBase64: "Zml4dHVyZQ==", sha256, fixture: true }] },
    { type: "failed", taskId: "legacy-task", failureId: "legacy-failure", technical: true },
    { type: "unknown", diagnostic: "old lost response" }]) {
    const normalized = normalizeExecutionOutcome(old); assert.deepEqual(normalized, old); assert.equal(digest(normalized), digest(old));
    assert.equal(Object.hasOwn(normalized, "version"), false); assert.equal(Object.hasOwn(normalized, "retryAllowed"), false);
  }
});
test("synchronous spool completion preserves a null remote task and snapshots its descriptor", () => {
  const input = completed(), normalized = normalizeExecutionOutcome(input, { kind: "image" });
  assert.deepEqual(normalized, input); assert.equal(executionTaskId(normalized), null);
  input.outputs[0].storage.spoolId = "changed"; assert.equal(normalized.outputs[0].storage.spoolId, receiptId);
  const async = { ...completed("video"), vendorTaskId: "remote-video" };
  assert.equal(executionTaskId(normalizeExecutionOutcome(async, { kind: "video" })), "remote-video");
});
test("spool sizes are per media kind and do not raise the legacy inline limit", () => {
  assert.equal(normalizeExecutionOutcome(completed("video", 65 * 1024 * 1024)).type, "completed");
  assert.equal(normalizeExecutionOutcome(completed("video", EXECUTION_SPOOL_LIMITS.video)).type, "completed");
  for (const value of [completed("image", EXECUTION_SPOOL_LIMITS.image + 1), completed("video", EXECUTION_SPOOL_LIMITS.video + 1), completed("image", 0)])
    assert.equal(normalizeExecutionOutcome(value).type, "unknown");
});
test("mixed envelopes, raw paths/bytes and ambiguous task identities are not admitted", () => {
  for (const change of [value => { value.taskId = "invented"; }, value => { value.version = 3; },
    value => { value.requestId = "diagnostic-is-not-task"; }, value => { value.outputs.push(value.outputs[0]); },
    value => { value.outputs[0].fixture = true; }, value => { value.outputs[0].bytesBase64 = "payload"; },
    value => { value.outputs[0].storage.path = "/untrusted/path"; }, value => { value.outputs[0].storage.spoolId = sha256; },
    value => { value.outputs[0].port = "video"; }, value => { value.outputs[0].mimeType = "image/jpeg"; }]) {
    const value = completed(); change(value); const result = normalizeExecutionOutcome(value);
    assert.equal(result.type, "unknown"); assert.equal(Object.hasOwn(result, "taskId"), false);
  }
  assert.equal(normalizeExecutionOutcome(completed(), { kind: "video" }).type, "unknown");
  assert.deepEqual(normalizeExecutionOutcome({ ...completed(), vendorTaskId: "known-video", outputs: [] }),
    { type: "unknown", diagnostic: "Invalid execution provider observation", taskId: "known-video" });
});
