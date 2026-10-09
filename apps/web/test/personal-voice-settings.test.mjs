import test from "node:test";
import assert from "node:assert/strict";
import { pendingCommandsFor } from "../src/pending-command.ts";

test("dismissed voice settings preserve exact unresolved registration and never resubmit on reopening", async () => {
  const api = {},
    registry = pendingCommandsFor(api, "personal-voices");
  const body = {
    expectedHeadVersion: 4,
    label: "My voice",
    provider: "openai",
    providerVoiceId: "voice_fixture",
    ownVoice: true,
    permitSynthesis: true,
  };
  const command = {
    path: "/api/projects/project/narration/personal-voices",
    key: "voice-once",
    body,
    metadata: { personalVoice: "register" },
  };
  let calls = 0,
    notifications = 0;
  const unsubscribe = registry.subscribe("project", () => notifications++);
  await registry.run(
    "project",
    command,
    async () => {
      calls++;
      throw Object.assign(new Error("Reply lost"), { code: "NETWORK_ERROR" });
    },
    (cause) => cause.code === "NETWORK_ERROR",
  );
  const saved = registry.snapshot("project").command;
  assert.equal(registry.snapshot("project").running, false);
  unsubscribe();
  const before = notifications;
  body.providerVoiceId = "voice_another";
  body.permitSynthesis = false;
  const reopened = pendingCommandsFor(api, "personal-voices");
  reopened.subscribe("project", () => {});
  assert.equal(calls, 1, "closing or reopening is inspection only");
  assert.equal(reopened.snapshot("project").command, saved);
  assert.equal(saved.body.providerVoiceId, "voice_fixture");
  assert.equal(saved.body.permitSynthesis, true);
  assert.equal(
    await reopened.run(
      "project",
      { ...command, key: "replacement" },
      async () => calls++,
      () => false,
    ),
    false,
    "an uncertain registration cannot be replaced with a new voice or consent",
  );
  await reopened.run(
    "project",
    saved,
    async (exact) => {
      calls++;
      assert.equal(exact, saved);
      return { id: "registered-voice" };
    },
    () => false,
  );
  assert.equal(calls, 2);
  assert.equal(notifications, before);
  assert.equal(reopened.snapshot("project").command, null);
});
