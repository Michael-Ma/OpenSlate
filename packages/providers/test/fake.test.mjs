import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeProvider } from "../dist/fake.js";

test("fake provider durably records a lost response and intentionally detects duplicate submissions", async t => {
  const directory = mkdtempSync(join(tmpdir(), "openslate-provider-")); const path = join(directory, "backend.sqlite");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  let provider = new FakeProvider(path); const request = { attemptId: "attempt", nodeId: "node", kind: "image", fingerprint: "a".repeat(64), args: {}, inputs: [] };
  provider.setMode("node", "unknown_after_accept"); assert.equal((await provider.submit(request)).type, "unknown"); provider.close();
  provider = new FakeProvider(path);
  try {
    const result = await provider.lookup("attempt"); assert.equal(result.type, "completed"); assert.equal(result.outputs[0].fixture, true); assert.equal(provider.acceptedCount(), 1);
    await provider.submit(request); assert.equal(provider.acceptedCount(), 2); assert.equal((await provider.lookup("attempt")).type, "unknown");
  } finally { provider.close(); }
});
