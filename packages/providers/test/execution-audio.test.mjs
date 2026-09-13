import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "../../core/dist/index.js";
import { EXECUTION_SPOOL_LIMITS, executionSpoolRole, executionTaskId, normalizeExecutionOutcome } from "../dist/index.js";

const receiptId = "a".repeat(64), sha256 = "b".repeat(64);
const roles = {
  speech: { port: "audio", kind: "audio", mimeType: "audio/wav", extension: "wav" },
  transcription: { port: "cues", kind: "data", mimeType: "application/json", extension: "json" },
};
function completion(kind, byteLength = 123) {
  return { type: "completed", version: 2, receiptId, vendorTaskId: null,
    outputs: [{ ...roles[kind], sha256, byteLength, fixture: false, storage: { type: "spool", spoolId: receiptId } }] };
}

test("raw role mapping is exact, immutable and excludes local assembly", () => {
  assert.deepEqual(executionSpoolRole("speech"), roles.speech);
  assert.deepEqual(executionSpoolRole("transcription"), roles.transcription);
  assert.deepEqual(executionSpoolRole("image"), { port: "image", kind: "image", mimeType: "image/png", extension: "png" });
  assert.deepEqual(executionSpoolRole("video"), { port: "video", kind: "video", mimeType: "video/mp4", extension: "mp4" });
  for (const kind of ["render", "timeline", "audio", "data", "toString", "unknown"]) assert.equal(executionSpoolRole(kind), null);
  assert.throws(() => { executionSpoolRole("speech").port = "cues"; }, TypeError);
});

for (const kind of Object.keys(roles)) {
  test(`${kind} V2 preserves raw descriptor bytes and null task identity`, () => {
    const value = completion(kind), observed = normalizeExecutionOutcome(value, { kind });
    assert.deepEqual(observed, value); assert.equal(digest(observed), digest(value));
    assert.equal(executionTaskId(observed), null);
    value.outputs[0].storage.spoolId = "mutated"; value.outputs[0].sha256 = "mutated";
    assert.equal(observed.outputs[0].storage.spoolId, receiptId); assert.equal(observed.outputs[0].sha256, sha256);
  });

  test(`${kind} rejects foreign roles, locators, invented tasks and excess bytes`, () => {
    const expected = roles[kind];
    assert.equal(normalizeExecutionOutcome(completion(kind, EXECUTION_SPOOL_LIMITS[expected.kind]), { kind }).type, "completed");
    for (const change of [
      value => { value.outputs[0].port = kind; },
      value => { value.outputs[0].kind = kind; },
      value => { value.outputs[0].mimeType = "audio/mpeg"; },
      value => { value.outputs[0].extension = "mp3"; },
      value => { value.outputs[0].byteLength = EXECUTION_SPOOL_LIMITS[expected.kind] + 1; },
      value => { value.outputs[0].storage.locator = "https://untrusted.example/output"; },
      value => { value.outputs[0].bytesBase64 = "raw"; },
      value => { value.vendorTaskId = "request-header-is-not-task"; },
      value => { value.outputs[0].fixture = true; },
    ]) {
      const value = completion(kind); change(value);
      assert.equal(normalizeExecutionOutcome(value, { kind }).type, "unknown");
    }
    for (const foreign of ["image", "video", "render", "timeline", kind === "speech" ? "transcription" : "speech"])
      assert.equal(normalizeExecutionOutcome(completion(kind), { kind: foreign }).type, "unknown");
    const withHeaderAsTask = { ...completion(kind), vendorTaskId: "request-header-is-not-task" };
    assert.equal(executionTaskId(normalizeExecutionOutcome(withHeaderAsTask, { kind })), null);
    assert.equal(executionTaskId(normalizeExecutionOutcome(withHeaderAsTask)), null);
  });
}

test("legacy inline fake audio/data keep their exact outcomes and no V2 fields", () => {
  for (const kind of Object.keys(roles)) {
    const output = { ...roles[kind], bytesBase64: "Zml4dHVyZQ==", sha256, fixture: true };
    const legacy = { type: "completed", taskId: `legacy-${kind}`, outputs: [output] };
    assert.deepEqual(normalizeExecutionOutcome(legacy, { kind }), legacy);
    assert.equal(digest(normalizeExecutionOutcome(legacy, { kind })), digest(legacy));
  }
});
