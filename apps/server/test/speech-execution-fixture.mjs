import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePlan, digest, providerProfileArguments } from "../../../packages/core/dist/index.js";
import { OPENAI_SPEECH_MODEL } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { OpenAISpeechExecution } from "../dist/execution/openai-speech-execution.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { DurableExternalAdmission } from "../dist/execution/durable-external-admission.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { ProductionService } from "../dist/application/service.js";
import { ExternalAllowanceService, allowanceIssueContextDigest, allowanceRevokeContextDigest } from "../dist/application/external-allowances.js";
import { InstallationRecoveryGuard, installRecoveryQuarantine, releaseRecovery } from "../dist/application/installation-recovery.js";
import { projectFixture } from "./execution-fixture.mjs";

export const key = "offline-speech-bridge-fixture", hash = value => createHash("sha256").update(value).digest("hex");
export function wave(samples = 24000) {
  const bytes = Buffer.alloc(44 + samples * 2); bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 2400; i < samples - 2400; i++) bytes.writeInt16LE(Math.round(7000 * Math.sin(i * Math.PI * 2 * 440 / 24000)), 44 + i * 2);
  return bytes;
}
export const bytes = wave();
export const response = (value = bytes) => new Response(value, { headers: { "content-type": "audio/wav", "x-request-id": "req-speech-diagnostic" } });
export const rows = (f, kind) => f.store.list(kind, f.project.id);
export const context = f => ({ expectedLease: { owner: f.attempt.leaseOwner, epoch: f.attempt.leaseEpoch } });

/** All spending is a synthetic test estimate, but admission uses the real human allowance and consumption services. */
export function speechFixture(t, options = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "openslate-speech-execution-"))), path = join(directory, "openslate.sqlite");
  const store = new Store(path), stores = [store], project = projectFixture(randomUUID(), 1), artifactRoot = join(directory, "artifacts"); mkdirSync(artifactRoot);
  store.createProject(project);
  const profile = { id: "offline-speech", revision: "fixture-estimate-1", kind: "speech", adapter: "openai-speech", executionVersion: "1",
    configuration: { model: options.model ?? OPENAI_SPEECH_MODEL, settings: options.profileSettings ?? {} }, maxConcurrency: 2, unitCostMicros: "100", maxRetries: 0 };
  store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: [profile] });
  const outputs = new ExecutionOutputStore(store, { rootDir: join(directory, "execution-output") });
  const calls = { http: 0, credentials: 0 }, credentials = new EnvironmentMediaCredentials(name => {
    calls.credentials++; assert.equal(name, "OPENSLATE_OPENAI_API_KEY"); return options.credential ? options.credential() : key;
  });
  const fetch = async (...args) => { calls.http++; return (options.fetch ?? (async () => response()))(...args); };
  const bridge = new OpenAISpeechExecution({ store, outputStore: outputs, credentials, fetch, timeoutMs: options.timeoutMs ?? 1000 });
  const policy = new DurableExternalAdmission(store, () => {});
  const engine = new Engine(store, bridge, { artifactDir: artifactRoot, profiles: [profile], outputStore: outputs, externalAdmission: policy });
  const production = new ProductionService(store, engine, [profile]), allowances = new ExternalAllowanceService(store);
  const q = JSON.stringify, text = options.text ?? " Leather boots.\n手工缝制 👞 ", voice = options.voice ?? "coral", instructions = options.instructions ?? "Warm, measured delivery.";
  const source = `definePlan({baseRevision:${q(project.revisionId)}},p=>{return p.speech("narration",{profile:${q(profile.id)},text:${q(text)},voice:${q(voice)},instructions:${q(instructions)},settings:${q(options.settings ?? {})}});});`;
  const plan = compilePlan(source, { project, profiles: [profile], logicalIds: {}, allocateId: randomUUID });
  const node = plan.nodes[0], grant = engine.createGrant(project.id, project.id, "speech", "offline-original-human", "initial_slot"), planId = randomUUID();
  engine.installPlan(project.id, planId, plan, { [node.id]: grant.id }); store.saveProject({ ...project, activePlanId: planId }, 0);
  const binding = store.get("node_binding", node.id);
  const allowanceInput = { profileDigest: String(providerProfileArguments(profile).profileDigest), profileDefinitionDigest: digest(profile),
    selections: [{ candidateId: binding.candidateId, nodeId: node.id, specDigest: node.specDigest }], maxAttempts: 1,
    maxEstimatedMicros: "100", expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const actor = production.beginRequest(project.id, "offline-human", "Approve this exact speech", { editing: false,
    scopeIds: [project.id], contextDigest: allowanceIssueContextDigest(project.id, allowanceInput) });
  const allowance = allowances.issue(project.id, actor, allowanceInput);
  const admit = () => engine.admit(project.id, node.id, engine.resolveInputs(project.id, node).fingerprint);
  const attempt = options.deferAdmission ? undefined : admit();
  t.after(() => { for (const saved of stores) if (saved.db.open) saved.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, path, store, stores, project, profile, outputs, bridge, credentials, fetch, calls, engine, production, allowances, allowance,
    artifactRoot, node, grant, attempt, request: attempt?.request, admit, text, voice, instructions };
}
export function restart(f) {
  f.store.close(); const store = new Store(f.path); f.stores.push(store);
  const outputs = new ExecutionOutputStore(store, { rootDir: join(f.directory, "execution-output") });
  const bridge = new OpenAISpeechExecution({ store, outputStore: outputs, credentials: new EnvironmentMediaCredentials(() => { throw Error("recovery must not resolve credentials"); }),
    fetch: async () => { throw Error("recovery must not POST"); } });
  return { store, outputs, bridge };
}
export function restoreSpeechFixture(f) {
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64), sourceDatabaseSha256: "b".repeat(64),
    originalDataRoot: f.directory, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
  return () => { const snapshot = new InstallationRecoveryGuard(f.store).snapshot(); return releaseRecovery(f.store, { restoreId: snapshot.receipt.restoreId,
    expectedReceiptDigest: snapshot.receiptDigest, expectedSummaryDigest: snapshot.summaryDigest }, { principalId: "offline-human", commandId: randomUUID() }); };
}
export function revoke(f) {
  const input = { allowanceId: f.allowance.id }, actor = f.production.beginRequest(f.project.id, "offline-human", "Revoke unconsumed work", { editing: false,
    scopeIds: [f.project.id], contextDigest: allowanceRevokeContextDigest(f.project.id, input) });
  return f.allowances.revoke(f.project.id, actor, input);
}
