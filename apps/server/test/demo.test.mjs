import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDemo } from "../dist/demo.js";
import { Store } from "../dist/persistence/store.js";
import { FakeProvider } from "@openslate/providers";

test("fake two-shot workflow reviews exact frames, edits one shot and recovers without duplicate accepts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openslate-demo-test-"));
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("The fake demo must not make network calls"); };
  try {
    const summary = await runDemo(directory);
    assert.equal(summary.mode, "fake");
    assert.match(summary.label, /placeholder media/);
    assert.equal(summary.networkCalls, 0);
    assert.equal(summary.plannedDurationSeconds, 12);
    assert.equal(summary.videoFixtureDurationSeconds, 1);
    assert.deepEqual(summary.fakeAcceptances, { initial: 4, afterEditAndRestart: 6, duplicateAttempts: 0 });
    assert.equal(summary.fakeCommittedMicros, "3300");
    assert.equal(summary.artifacts.length, 6);
    assert.ok(summary.artifacts.every(artifact => artifact.fixture && existsSync(artifact.path)));
    assert.ok(existsSync(summary.previousKeyframePath));
    assert.equal(readFileSync(summary.previewPath).subarray(4, 8).toString(), "ftyp");
    assert.deepEqual(JSON.parse(readFileSync(summary.summaryPath, "utf8")), summary);

    const store = new Store(join(directory, "openslate.sqlite"));
    const provider = new FakeProvider(join(directory, "fake-provider.sqlite"));
    try {
      const candidates = store.list("candidate", summary.projectId);
      const attempts = store.list("attempt", summary.projectId);
      const preserved = candidates.find(candidate => candidate.id === summary.preserved.candidateId);
      assert.ok(preserved);
      assert.equal(candidates.filter(candidate => candidate.nodeId === preserved.nodeId).length, 1);
      assert.equal(attempts.filter(attempt => attempt.candidateId === preserved.id).length, 1);
      const recovered = attempts.find(attempt => attempt.id === summary.recoveredAttemptId);
      assert.equal(recovered.phase, "succeeded");
      assert.equal(provider.acceptedCount(recovered.id), 1);
      assert.equal(provider.acceptedCount(), 6);
      const approvals = store.list("approval", summary.projectId);
      assert.equal(approvals.length, 3);
      assert.equal(approvals.filter(approval => approval.videoNodeId === recovered.nodeId).length, 2);
      const messages = store.list("message", summary.projectId);
      for (const approval of approvals) assert.ok(messages.some(message => message.id === approval.authorityId));
      assert.ok(store.readEvents(summary.projectId).some(event => event.kind === "attempt.state_changed" && event.payload.phase === "submission_unknown"));
    } finally { store.close(); provider.close(); }

    await assert.rejects(runDemo(directory), { code: "DEMO_ALREADY_EXISTS" });
    assert.deepEqual(JSON.parse(readFileSync(summary.summaryPath, "utf8")), summary);
  } finally {
    globalThis.fetch = savedFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});
