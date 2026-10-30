import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "@openslate/core";
import { providerAdmissionRequest, configuredProfileMatches, assertConfiguredProviderPin } from "../dist/execution/provider-use.js";

test("configured mappings retain the exact original lock and full profile proof", () => {
  const profile = { id: "pinned-provider", revision: "one" }, lockDigest = "a".repeat(64);
  const request = { providerUse: { kind: "configured", capabilityLockId: "original-lock", capabilityLockDigest: lockDigest, profileDefinitionDigest: digest(profile) } };
  assert.equal(configuredProfileMatches(request, profile, "original-lock", lockDigest), true);
  for (const [currentProfile, currentLock, currentDigest] of [[{ ...profile, revision: "two" }, "original-lock", lockDigest], [profile, "new-lock", lockDigest], [profile, "original-lock", "b".repeat(64)]])
    assert.equal(configuredProfileMatches(request, currentProfile, currentLock, currentDigest), false);
});

for (const adapter of ["openai-image", "codex-image", "minimax-h3", "viggle-h3", "openai-speech", "openai-transcription", "fal-h3-lipsync"])
  test(`${adapter} v1 requires providerUse before looking up admission evidence`, () => {
    const store = { get: () => { assert.fail("Missing providerUse must be rejected before any evidence lookup"); } };
    for (const proof of [{}, { externalAllowanceId: "retired-allowance" }, { providerUse: undefined }]) {
      const request = { execution: { adapter, version: "1" }, ...proof };
      assert.equal(providerAdmissionRequest(request), false);
      assert.throws(() => assertConfiguredProviderPin(store, { request }), { code: "CONFIGURED_PROVIDER_ADMISSION_CONFLICT" });
    }
  });
