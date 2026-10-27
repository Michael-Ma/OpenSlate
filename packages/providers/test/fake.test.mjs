import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProvider } from "../dist/fake.js";

test("fake lost replies cannot discover jobs by attempt id, while known task ids still complete", async t => {
  const directory = mkdtempSync(join(tmpdir(), "openslate-provider-")); const path = join(directory, "backend.sqlite");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  let provider = new FakeProvider(path); const request = { attemptId: "attempt", nodeId: "node", kind: "image", fingerprint: "a".repeat(64), args: {}, inputs: [] };
  provider.setMode("node", "unknown_after_accept"); assert.equal((await provider.submit(request)).type, "unknown"); provider.close();
  provider = new FakeProvider(path);
  try {
    const lost = { type: "failed", taskId: null, failureId: "SUBMISSION_RESPONSE_LOST", technical: true, retryAllowed: false };
    assert.deepEqual(await provider.lookup("attempt"), lost); assert.equal(provider.acceptedCount(), 1);
    const firstTask = provider.jobs()[0].id;
    const result = await provider.poll(firstTask); assert.equal(result.type, "completed"); assert.equal(result.outputs[0].fixture, true);
    const accepted = await provider.submit(request); assert.equal(provider.acceptedCount(), 2);
    assert.deepEqual(await provider.lookup("attempt"), lost); assert.deepEqual(await provider.lookup("not-a-vendor-key"), lost);
    assert.equal((await provider.poll(accepted.taskId)).type, "completed");
  } finally { provider.close(); }
});
