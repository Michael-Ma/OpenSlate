import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePlan, DEFAULT_PROFILES, digest, providerProfileArguments } from "../../../packages/core/dist/index.js";
import { FakeProvider, OPENAI_IMAGE_MODEL } from "../../../packages/providers/dist/index.js";
import { spendingHistoryDisplay, spendingProviderDisplay } from "../dist/application/spending-display.js";
import { projectSpendingProjection } from "../dist/application/allowance-projection.js";
import { ExternalAllowanceService, allowanceIssueContextDigest } from "../dist/application/external-allowances.js";
import { ProductionService } from "../dist/application/service.js";
import { Engine } from "../dist/execution/engine.js";
import { Store } from "../dist/persistence/store.js";
import { projectFixture } from "./execution-fixture.mjs";

const image = () => ({ id: "reviewed-image", revision: "settings-1", kind: "image", adapter: "openai-image", executionVersion: "1",
  configuration: { model: OPENAI_IMAGE_MODEL, settings: { width: 1024, height: 1024, quality: "medium" } },
  maxConcurrency: 2, unitCostMicros: "123456", maxRetries: 0 });
const video = () => ({ id: "reviewed-video", revision: "settings-2", kind: "video", adapter: "minimax-h3", executionVersion: "1",
  configuration: { model: "MiniMax-H3-Max", settings: { resolution: "480P" } }, maxConcurrency: 1, unitCostMicros: "654321",
  maxRetries: 0, minFrames: 150, maxFrames: 450 });
const selection = () => ({ candidateId: "candidate-original", nodeId: "node-original", specDigest: "a".repeat(64) });
const allowance = (profile = image()) => ({ projectId: "project", profileDefinitionDigest: digest(profile),
  profileDigest: providerProfileArguments(profile).profileDigest, selections: [selection()] });
const node = (profile = image(), extra = {}) => ({ id: selection().nodeId, specDigest: selection().specDigest,
  alias: "original-frame", shotId: "original-shot", kind: "image", profileId: profile.id,
  args: { ...providerProfileArguments(profile), prompt: "Historical creative text is not copied into the display" }, ...extra });
const lock = (profile = image(), projectId = "project") => ({ projectId, profiles: [profile] });
const plan = (nodes = [node()], projectId = "project") => ({ projectId, compiled: { nodes } });

test("safe displays copy only supported image/H3 model settings and exact whole-profile identity", () => {
  for (const profile of [image(), video()]) {
    const display = spendingProviderDisplay(profile, digest(profile));
    assert.deepEqual(display, { id: profile.id, revision: profile.revision, adapter: profile.adapter,
      model: profile.configuration.model, settings: profile.configuration.settings, definitionDigest: digest(profile) });
    assert.notEqual(display.settings, profile.configuration.settings);
    assert.equal(Object.hasOwn(display, "unitCostMicros"), false); assert.equal(Object.hasOwn(display, "maxRetries"), false);
    const original = structuredClone(profile);
    display.settings.extra = "not a mutation of saved settings"; assert.deepEqual(profile, original);
    const reordered = Object.fromEntries(Object.entries(profile).reverse());
    assert.deepEqual(spendingProviderDisplay(reordered, digest(profile)), spendingProviderDisplay(profile, digest(profile)));
  }
});

test("mismatched definitions, arbitrary settings/locations, unsupported profiles and malformed values have no display", () => {
  const profile = image(), expected = digest(profile);
  for (const changed of [{ ...profile, unitCostMicros: "999999" }, { ...profile, maxRetries: 1 }]) {
    assert.equal(spendingProviderDisplay(changed, expected), null);
    assert.notEqual(spendingProviderDisplay(changed, digest(changed)), null);
  }
  for (const value of [null, undefined, {}, DEFAULT_PROFILES[0], { ...profile, adapter: "custom-offline" },
    { ...profile, privatePath: "/private/credential" },
    { ...profile, configuration: { ...profile.configuration, token: "must-not-appear" } },
    { ...profile, configuration: { model: "https://private.example/model", settings: profile.configuration.settings } },
    { ...profile, configuration: { ...profile.configuration, settings: { ...profile.configuration.settings, credential: "must-not-appear" } } }]) {
    assert.equal(spendingProviderDisplay(value, expected), null);
    if (value !== undefined) assert.equal(spendingProviderDisplay(value, digest(value)), null);
  }
  assert.equal(spendingProviderDisplay(profile, null), null);
  assert.equal(spendingProviderDisplay(profile, "not-a-digest"), null);
});

test("history uses retained exact node/spec and profile definition rather than a replacement with the same IDs", () => {
  const saved = image(), replacement = { ...saved, unitCostMicros: "999999", configuration: { ...saved.configuration,
    settings: { ...saved.configuration.settings, quality: "high" } } };
  const history = spendingHistoryDisplay("project", [lock(saved), lock(structuredClone(saved)), lock(replacement)],
    [plan(), plan([node(replacement, { specDigest: "b".repeat(64), alias: "replacement-frame", shotId: "replacement-shot" })])]);
  const result = history(allowance(saved), []);
  assert.deepEqual(result.providerDisplay, spendingProviderDisplay(saved, digest(saved)));
  assert.deepEqual(result.work, [{ ...selection(), alias: "original-frame", shotId: "original-shot", operation: "image", current: false, historyAvailable: true }]);
  result.providerDisplay.settings.quality = "changed outside index";
  assert.equal(history(allowance(saved), [selection()]).providerDisplay.settings.quality, "medium");
  assert.equal(history(allowance(saved), [selection()]).work[0].current, true);
  assert.equal(history(allowance(saved), [{ ...selection(), candidateId: "different-take" }]).work[0].current, false);
});

test("foreign, missing, unsafe or conflicting historical evidence is explicit and never substituted", () => {
  const original = allowance(), missing = { ...selection(), alias: null, shotId: null, operation: null, current: false, historyAvailable: false };
  const foreign = spendingHistoryDisplay("project", [lock(image(), "foreign")], [plan([node()], "foreign")]);
  assert.deepEqual(foreign(original, []), { providerDisplay: null, work: [missing] });
  const other = spendingHistoryDisplay("project", [lock()], [plan([node(image(), { specDigest: "b".repeat(64) })])]);
  assert.deepEqual(other(original, []).work, [missing]);
  for (const changed of [node(image(), { alias: "different-label" }), node(image(), { alias: "/private/path" }),
    node(image(), { shotId: "https://private.example" }), node(image(), { kind: "render" })]) {
    const conflicted = spendingHistoryDisplay("project", [lock()], [plan(), plan([changed]), plan()]);
    assert.deepEqual(conflicted(original, []).work, [missing]);
  }
  const exact = spendingHistoryDisplay("project", [lock()], [plan(), plan()]);
  assert.deepEqual(exact({ ...original, projectId: "foreign" }, [selection()]), { providerDisplay: null, work: [missing] });
  const wrongExecution = exact({ ...original, profileDigest: "c".repeat(64) }, []);
  assert.deepEqual(wrongExecution, { providerDisplay: null, work: [missing] });
});

test("real projection retains display and work after lock/plan changes and database reopen, without writes", t => {
  const directory = mkdtempSync(join(tmpdir(), "openslate-spending-display-")), path = join(directory, "store.sqlite");
  let store = new Store(path);
  const provider = new FakeProvider(join(directory, "fake.sqlite")), profile = image();
  let engine = new Engine(store, provider, { artifactDir: join(directory, "artifacts"), profiles: [profile] });
  let service = new ProductionService(store, engine, [profile]);
  t.after(() => { if (store.db.open) store.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); });
  const project = projectFixture(randomUUID(), 1); store.createProject(project);
  store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: [profile] });
  const source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{const s=p.shot("shot-0");const image=p.image("opening-frame",{intent:s,profile:"reviewed-image",prompt:${JSON.stringify(project.shots[0].imagePrompt)}});return [image];});`;
  const compiled = compilePlan(source, { project, profiles: [profile], logicalIds: {}, allocateId: randomUUID });
  const grants = Object.fromEntries(compiled.nodes.map(node => [node.id, engine.createGrant(project.id, node.shotId, node.kind, "human").id]));
  const planId = randomUUID(); engine.installPlan(project.id, planId, compiled, grants); store.saveProject({ ...project, activePlanId: planId }, 0);
  const candidate = projectSpendingProjection(service, project.id).candidates[0];
  assert.deepEqual(candidate.providerDisplay, spendingProviderDisplay(profile, digest(profile)));
  const input = { profileDigest: candidate.profileDigest, profileDefinitionDigest: candidate.profileDefinitionDigest,
    selections: [{ candidateId: candidate.candidateId, nodeId: candidate.nodeId, specDigest: candidate.specDigest }],
    maxAttempts: 1, maxEstimatedMicros: profile.unitCostMicros, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const human = service.beginRequest(project.id, "local-user", "Review exact work", { editing: false, contextDigest: allowanceIssueContextDigest(project.id, input) });
  new ExternalAllowanceService(store).issue(project.id, human, input);
  assert.equal(projectSpendingProjection(service, project.id).allowances[0].work[0].current, true);
  const current = store.getProject(project.id), replacementLock = randomUUID();
  store.insert("capability_lock", replacementLock, project.id, { profiles: [{ ...profile, unitCostMicros: "987654" }] });
  store.saveProject({ ...current, capabilityLockId: replacementLock, activePlanId: null,
    shots: current.shots.map(shot => ({ ...shot, purpose: "Changed current purpose must not describe old work" })) }, current.headVersion);
  const count = () => Object.fromEntries(["entities", "commands", "events"].map(table => [table, store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n]));
  const before = count(), result = projectSpendingProjection(service, project.id);
  assert.deepEqual(count(), before); assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.allowances[0].providerDisplay, spendingProviderDisplay(profile, digest(profile)));
  assert.deepEqual(result.allowances[0].work, [{ ...input.selections[0], alias: "opening-frame", shotId: "shot-0", operation: "image", current: false, historyAvailable: true }]);
  assert.equal(JSON.stringify(result).includes("Changed current purpose"), false);
  store.close(); store = new Store(path); engine = new Engine(store, provider, { artifactDir: join(directory, "artifacts") });
  service = new ProductionService(store, engine);
  assert.deepEqual(projectSpendingProjection(service, project.id).allowances[0].providerDisplay, result.allowances[0].providerDisplay);
  assert.deepEqual(projectSpendingProjection(service, project.id).allowances[0].work, result.allowances[0].work);
  assert.equal(provider.acceptedCount(), 0); assert.equal(store.list("attempt", project.id).length, 0);
});
