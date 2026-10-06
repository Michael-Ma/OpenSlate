import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "@openslate/core";
import { providerAdmissionRequest, configuredProfileMatches, allowanceMappingMatches } from "../dist/execution/provider-use.js";

test("removing historical allowance fields cannot turn a saved attempt into configured-provider work", () => {
  const historical = { externalAllowanceId: "saved-allowance" };
  assert.equal(providerAdmissionRequest(historical), true);
  assert.equal(providerAdmissionRequest({}), false);
  assert.equal(allowanceMappingMatches(historical, { allowanceId: null, allowanceDigest: null, consumptionDigest: null }), false);
  const proof = { kind: "configured", capabilityLockId: "original-lock", capabilityLockDigest: "a".repeat(64), profileDefinitionDigest: "b".repeat(64) };
  assert.equal(providerAdmissionRequest({ providerUse: proof }), true);
  assert.equal(providerAdmissionRequest({ ...historical, providerUse: proof }), false);
  assert.equal(providerAdmissionRequest({ providerUse: { ...proof, profileDefinitionDigest: "invalid" } }), false);
  assert.equal(providerAdmissionRequest({ providerUse: { ...proof, extra: true } }), false);
});

test("configured mappings pin original full lock and profile and carry no pretend allowance evidence", () => {
  const profile = { id: "pinned-provider", revision: "one" }, lockDigest = "a".repeat(64);
  const request = { providerUse: { kind: "configured", capabilityLockId: "original-lock", capabilityLockDigest: lockDigest, profileDefinitionDigest: digest(profile) } };
  assert.equal(configuredProfileMatches(request, profile, "original-lock", lockDigest), true);
  for (const [currentProfile, currentLock, currentDigest] of [[{ ...profile, revision: "two" }, "original-lock", lockDigest], [profile, "new-lock", lockDigest], [profile, "original-lock", "b".repeat(64)]])
    assert.equal(configuredProfileMatches(request, currentProfile, currentLock, currentDigest), false);
  assert.equal(allowanceMappingMatches(request, { allowanceId: null, allowanceDigest: null, consumptionDigest: null }), true);
  assert.equal(allowanceMappingMatches(request, { allowanceId: "pretend", allowanceDigest: lockDigest, consumptionDigest: lockDigest }), false);
});
