import test from "node:test";
import assert from "node:assert/strict";
import { canonical, providerProfileArguments } from "../../core/dist/index.js";
import { ExecutionRegistry, assertExecutionProfile, assertExecutionRequest, executionProfileSnapshot, registerExecutionProvider } from "../dist/index.js";

const provider = () => ({ async submit() {}, async poll() {}, async lookup() {} });
const profile = () => ({ id: "image-model", revision: "2026-09-12", adapter: "openai-image", executionVersion: "1", kind: "image",
  configuration: { model: "gpt-image-2", settings: { quality: "medium", count: 1 } }, maxConcurrency: 1, maxRetries: 0, unitCostMicros: "100" });
const request = p => ({ attemptId: "attempt", nodeId: "node", kind: p.kind, fingerprint: "a".repeat(64), inputs: [], args: providerProfileArguments(p),
  execution: { adapter: p.adapter, version: p.executionVersion }, profile: executionProfileSnapshot(p), externalAllowanceId: "offline-allowance" });

test("registry pins adapter contracts separately from profile revisions and rejects duplicate or missing routes", () => {
  const image = registerExecutionProvider(provider(), { adapter: "openai-image", version: "1" });
  const video = registerExecutionProvider(provider(), { adapter: "minimax-h3", version: "1" });
  const registry = new ExecutionRegistry([image, video]), p = profile();
  assert.doesNotThrow(() => assertExecutionProfile(image, p)); assert.equal(registry.forProfile(p), image);
  assert.equal(registry.forRequest(request(p)), image);
  assert.throws(() => registry.forProfile({ ...p, executionVersion: "2" }), { code: "PROVIDER_NOT_REGISTERED" });
  assert.throws(() => new ExecutionRegistry([image, registerExecutionProvider(provider(), { adapter: "openai-image", version: "1" })]), { code: "PROVIDER_REGISTRATION_CONFLICT" });
  assert.throws(() => registerExecutionProvider(image, { adapter: "minimax-h3", version: "1" }), { code: "PROVIDER_NOT_REGISTERED" });
  assert.throws(() => assertExecutionRequest(video, request(p)), { code: "PROVIDER_NOT_REGISTERED" });
});

test("frozen request profiles bind exact configuration and preserve absent legacy fields", () => {
  const fake = registerExecutionProvider(provider(), { adapter: "fake", version: "1" });
  const image = registerExecutionProvider(provider(), { adapter: "openai-image", version: "1" });
  const registry = new ExecutionRegistry([fake, image]);
  const old = { attemptId: "old", nodeId: "node", kind: "image", fingerprint: "old", args: { adapter: "fake" }, inputs: [] }, before = canonical(old);
  assert.equal(registry.forRequest(old), fake); assert.equal(canonical(old), before); assert.equal(Object.hasOwn(old, "execution"), false);
  const saved = request(profile()); assert.equal(registry.forRequest(saved), image);
  for (const changed of [
    { ...saved, profile: { ...saved.profile, digest: "b".repeat(64) } },
    { ...saved, profile: { ...saved.profile, configuration: { model: "different" } } },
    { ...saved, args: { ...saved.args, profileConfiguration: { model: "different" } } },
    { ...saved, profile: undefined },
  ]) assert.throws(() => registry.forRequest(changed), { code: "PROFILE_INCOMPATIBLE" });
});

test("profile configuration is bounded plain model data and excludes known credential and host fields", () => {
  for (const configuration of [
    { model: "image", apiKey: "secret" }, { model: "image", settings: { api_key: "secret" } },
    { model: "image", settings: { nested: { accessToken: "secret" } } },
    { model: "image", settings: { endpoint: "https://example.test" } },
    { model: "https://example.test" }, { model: "image", settings: { reference: "/private/file" } },
    { model: "image", settings: { value: Number.NaN } }, { model: "image", settings: { value: () => 1 } },
    { model: "image", settings: { values: Array.from({ length: 65 }, () => 0) } },
    { model: "image", settings: { text: "a".repeat(513) } },
  ]) assert.throws(() => providerProfileArguments({ ...profile(), configuration }), { code: "PROFILE_CONFIGURATION_INVALID" });
  assert.throws(() => providerProfileArguments({ ...profile(), executionVersion: undefined }), { code: "PROFILE_INCOMPATIBLE" });
  assert.throws(() => providerProfileArguments({ ...profile(), id: undefined }), { code: "PROFILE_INCOMPATIBLE" });
  const p = profile(), snapshot = executionProfileSnapshot(p); p.configuration.settings.quality = "changed";
  assert.equal(snapshot.configuration.settings.quality, "medium");
});
