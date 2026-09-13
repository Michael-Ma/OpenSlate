import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, compilePlan, DEFAULT_PROFILES, newId, RECIPE_DIGEST, STAGE_CONTRACTS_DIGEST, TOOL_NAMES } from "@openslate/core";
import { FakeProvider, OPENAI_IMAGE_MODEL } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { InstalledProviderCatalog } from "../dist/application/provider-catalog.js";
import { createApp } from "../dist/app.js";
import { localPlanContext, localPlanSource } from "../../../packages/core/test/local-execution-fixture.mjs";

const identity = () => ({ adapter: "local-media", version: "1" });
function fixture(t, options) {
  const dir = mkdtempSync(join(tmpdir(), "openslate-project-local-")), dbPath = join(dir, "state.sqlite"), providerPath = join(dir, "fake.sqlite"), artifactDir = join(dir, "artifacts");
  const store = new Store(dbPath), provider = new FakeProvider(providerPath), engine = new Engine(store, provider, { artifactDir });
  const service = new ProductionService(store, engine, DEFAULT_PROFILES, options);
  t.after(() => { if (store.db.open) store.close(); if (provider.db.open) provider.close(); rmSync(dir, { recursive: true, force: true }); });
  const seed = (production = service) => {
    const initial = production.createProject("Pinned assembly fixture"), context = localPlanContext();
    const project = store.saveProject({ ...context.project, id: initial.id, headVersion: initial.headVersion, capabilityLockId: initial.capabilityLockId }, initial.headVersion);
    const logicalIds = Object.fromEntries(Object.entries(context.logicalIds).map(([key, value]) => [key, `${project.id}:${value}`]));
    store.insert("logical_ids", project.id, project.id, { aliases: logicalIds });
    const human = production.beginRequest(project.id, "local-human", "Plan the fixture");
    production.authorize(project.id, human, [{ scopeId: "shot-1", kind: "image" }, { scopeId: "shot-1", kind: "video" }], newId(), "initial_slot");
    return { project, human, logicalIds };
  };
  const prepare = (saved, production = service, source = localPlanSource) => production.prepare(saved.project.id, saved.human,
    { variant: "plan", expectedHeadVersion: saved.project.headVersion, source });
  return { dir, dbPath, providerPath, artifactDir, store, provider, engine, service, seed, prepare };
}
const lock = (f, project) => f.store.get("capability_lock", project.capabilityLockId);
const localNodes = plan => plan.nodes.filter(node => node.kind === "timeline" || node.kind === "render");
const rebase = (source, revision) => source.replace(/((?:"baseRevision"|baseRevision)\s*:\s*)"[^"\\]*"/, (_match, prefix) => `${prefix}${JSON.stringify(revision)}`);

test("omitted and undefined host options preserve the exact legacy lock body and compiled plan", async t => {
  const f = fixture(t);
  for (const service of [f.service, new ProductionService(f.store, f.engine, DEFAULT_PROFILES, { newProjectLocalExecution: undefined })]) {
    const saved = f.seed(service), pinned = lock(f, saved.project);
    const expected = { profiles: DEFAULT_PROFILES, recipeDigest: RECIPE_DIGEST, stageContractsDigest: STAGE_CONTRACTS_DIGEST, tools: TOOL_NAMES,
      id: saved.project.capabilityLockId, projectId: saved.project.id };
    assert.equal(f.store.db.prepare("SELECT body FROM entities WHERE kind='capability_lock' AND id=?").get(pinned.id).body, canonical(expected));
    const prepared = await f.prepare(saved, service), direct = compilePlan(localPlanSource, { project: saved.project, profiles: DEFAULT_PROFILES,
      logicalIds: saved.logicalIds, allocateId: () => { throw Error("Aliases already assigned"); } });
    assert.equal(JSON.stringify(prepared.compiled), JSON.stringify(direct)); assert.ok(localNodes(prepared.compiled).every(node => !Object.hasOwn(node.args, "localExecution")));
  }
  assert.equal(f.provider.acceptedCount(), 0);
});

test("new projects snapshot the exact trusted local identity while generated nodes and review keep their identities", async t => {
  const selected = identity(), options = { newProjectLocalExecution: selected }, f = fixture(t, options);
  selected.adapter = "changed-after-construction"; options.newProjectLocalExecution = null;
  const saved = f.seed(), pinned = lock(f, saved.project); assert.deepEqual(pinned.localExecution, identity());
  pinned.localExecution.version = "mutated-return-value"; assert.deepEqual(lock(f, saved.project).localExecution, identity());
  const prepared = await f.prepare(saved), legacy = compilePlan(localPlanSource, { project: saved.project, profiles: DEFAULT_PROFILES,
    logicalIds: saved.logicalIds, allocateId: () => { throw Error("No new alias"); } });
  for (const node of localNodes(prepared.compiled)) { assert.deepEqual(node.args.localExecution, identity()); assert.ok(Object.isFrozen(node.args.localExecution)); }
  assert.deepEqual(prepared.compiled.nodes.filter(node => !["timeline", "render"].includes(node.kind)), legacy.nodes.filter(node => !["timeline", "render"].includes(node.kind)));
  assert.deepEqual(prepared.compiled.gates, legacy.gates); assert.notEqual(prepared.compiled.graphDigest, legacy.graphDigest);
  assert.equal(f.store.list("attempt", saved.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test("host opt-in applies only to new projects and never upgrades an existing legacy lock during edits", async t => {
  const f = fixture(t), legacy = f.seed(), raw = f.store.db.prepare("SELECT body FROM entities WHERE kind='capability_lock' AND id=?").get(legacy.project.capabilityLockId).body;
  const optedIn = new ProductionService(f.store, f.engine, DEFAULT_PROFILES, { newProjectLocalExecution: identity() });
  const oldPlan = await f.prepare(legacy, optedIn); assert.ok(localNodes(oldPlan.compiled).every(node => !Object.hasOwn(node.args, "localExecution")));
  const fresh = f.seed(optedIn), newPlan = await f.prepare(fresh, f.service);
  assert.ok(localNodes(newPlan.compiled).every(node => canonical(node.args.localExecution) === canonical(identity())));
  assert.equal(f.store.db.prepare("SELECT body FROM entities WHERE kind='capability_lock' AND id=?").get(legacy.project.capabilityLockId).body, raw);
});

test("saved local identity survives apply, restart, creative edits and canonical source recompilation", async t => {
  const f = fixture(t, { newProjectLocalExecution: identity() }), saved = f.seed(), prepared = await f.prepare(saved);
  f.service.apply(saved.project.id, saved.human, prepared.id); const lockBytes = f.store.db.prepare("SELECT body FROM entities WHERE kind='capability_lock' AND id=?").get(saved.project.capabilityLockId).body;
  f.store.close(); f.provider.close();
  const store = new Store(f.dbPath), provider = new FakeProvider(f.providerPath), engine = new Engine(store, provider, { artifactDir: f.artifactDir });
  const service = new ProductionService(store, engine);
  try {
    const before = store.getProject(saved.project.id), human = service.beginRequest(before.id, "local-human", "Change only the brief");
    const patch = await service.prepare(before.id, human, { variant: "project", expectedHeadVersion: before.headVersion, creative: { brief: "New wording, same assembly" } });
    service.apply(before.id, human, patch.id); const current = store.getProject(before.id);
    const next = await service.prepare(current.id, human, { variant: "plan", expectedHeadVersion: current.headVersion,
      source: rebase(prepared.compiled.canonicalSource, current.revisionId) });
    assert.deepEqual(next.compiled.nodes, prepared.compiled.nodes); assert.deepEqual(next.compiled.gates, prepared.compiled.gates);
    assert.ok(next.impact.every(item => item.kind === "reuse")); service.apply(current.id, human, next.id);
    assert.equal(store.db.prepare("SELECT body FROM entities WHERE kind='capability_lock' AND id=?").get(current.capabilityLockId).body, lockBytes);
    assert.equal(store.list("candidate", current.id).length, 2); assert.equal(store.list("attempt", current.id).length, 0); assert.equal(provider.acceptedCount(), 0);
  } finally { store.close(); provider.close(); }
});

test("invalid host identities and accessor-based values are rejected without evaluating identity accessors", t => {
  const f = fixture(t); let accessed = 0;
  const accessor = { version: "1", get adapter() { accessed++; return "local-media"; } };
  for (const value of [null, false, "local-media", {}, { adapter: "fake", version: "1" }, { adapter: "local-media", version: "2" },
    { ...identity(), executable: "/some/program" }, accessor])
    assert.throws(() => new ProductionService(f.store, f.engine, DEFAULT_PROFILES, { newProjectLocalExecution: value }), { code: "LOCAL_EXECUTION_UNSUPPORTED" });
  assert.equal(accessed, 0); assert.equal(f.store.listProjects().length, 0);
});

test("present malformed saved identities fail closed instead of inheriting host defaults or legacy behavior", async t => {
  const f = fixture(t, { newProjectLocalExecution: identity() });
  for (const invalid of [null, false, {}, { adapter: "local-media", version: "2" }, { ...identity(), executable: "unexpected" }]) {
    const saved = f.seed(), prior = lock(f, saved.project), lockId = newId();
    f.store.insert("capability_lock", lockId, saved.project.id, { ...prior, id: lockId, localExecution: invalid });
    saved.project = f.store.saveProject({ ...saved.project, capabilityLockId: lockId }, saved.project.headVersion);
    await assert.rejects(f.prepare(saved), { code: "LOCAL_EXECUTION_UNSUPPORTED" }); assert.equal(f.store.list("prepared", saved.project.id).length, 0);
  }
  const saved = f.seed(), get = f.store.get.bind(f.store);
  f.store.get = (kind, id) => { const result = get(kind, id); return kind === "capability_lock" && id === saved.project.capabilityLockId ? { ...result, localExecution: undefined } : result; };
  try { await assert.rejects(f.prepare(saved), { code: "LOCAL_EXECUTION_UNSUPPORTED" }); } finally { f.store.get = get; }
  assert.equal(f.provider.acceptedCount(), 0);
});

test("human or model proposals cannot select or replace a project's local execution identity", async t => {
  const f = fixture(t, { newProjectLocalExecution: identity() }), saved = f.seed(), before = lock(f, saved.project);
  for (const proposal of [
    { variant: "plan", source: localPlanSource, localExecution: identity() },
    { variant: "plan", source: localPlanSource, newProjectLocalExecutionFor: "all" },
    { variant: "project", creative: { localExecution: identity() } },
    { variant: "project", creative: { newProjectLocalExecutionFor: "all" } },
    { variant: "project", creative: { capabilityLockId: "another-lock" } },
    { variant: "plan", source: localPlanSource.replace('takes:[video]', 'takes:[video],localExecution:{adapter:"local-media",version:"1"}') },
    { variant: "plan", source: localPlanSource.replace('takes:[video]', 'takes:[video],newProjectLocalExecutionFor:"all"') },
  ]) await assert.rejects(f.service.prepare(saved.project.id, saved.human, { ...proposal, expectedHeadVersion: saved.project.headVersion }));
  assert.deepEqual(lock(f, saved.project), before); assert.equal(f.store.list("prepared", saved.project.id).length, 0);
  const { localExecution: _localExecution, ...withoutIdentity } = before;
  assert.throws(() => f.store.put("capability_lock", before.id, saved.project.id, withoutIdentity), { code: "IMMUTABLE_RECORD" });
});

test("project HTTP creation does not expose host identity selection even when the service has opted in", async t => {
  const f = fixture(t, { newProjectLocalExecution: identity() }), token = "offline_project_local_identity_1234567890", app = createApp({ service: f.service, localToken: token });
  try {
    const headers = { host: "127.0.0.1", authorization: `Bearer ${token}` };
    for (const extra of [{ localExecution: identity() }, { newProjectLocalExecution: identity() }, { newProjectLocalExecutionFor: "all" }])
      assert.equal((await app.inject({ method: "POST", url: "/api/projects", headers, payload: { name: "Not selectable by client", ...extra } })).statusCode, 400);
    assert.equal(f.store.listProjects().length, 0);
    const response = await app.inject({ method: "POST", url: "/api/projects", headers, payload: { name: "Host-pinned project" } });
    assert.equal(response.statusCode, 200, response.body); assert.deepEqual(lock(f, response.json()).localExecution, identity());
    assert.equal(f.provider.acceptedCount(), 0);
  } finally { await app.close(); }
});

test("trusted local assembly pin composes with independent saved provider selection without creating authority", t => {
  const f = fixture(t, { newProjectLocalExecution: identity() }), catalog = new InstalledProviderCatalog();
  const selection = catalog.select(catalog.digest, ["fake-image-v1"]), project = f.service.createProject("Independent selections", selection), saved = lock(f, project);
  assert.deepEqual(saved.localExecution, identity()); assert.deepEqual(saved.profiles, DEFAULT_PROFILES);
  assert.deepEqual(saved.providerSelection, { catalogDigest: catalog.digest, profileIds: DEFAULT_PROFILES.map(profile => profile.id) });
  for (const kind of ["message", "hold", "epoch", "grant", "candidate", "attempt", "reservation", "approval", "external_allowance"])
    assert.equal(f.store.list(kind, project.id).length, 0);
  assert.equal(f.provider.acceptedCount(), 0);
});

function externalCatalog() {
  return new InstalledProviderCatalog({ configuration: { version: 1, profiles: [
    { label: "External image", profile: { id: "external-image", revision: "configured-image-1", kind: "image", adapter: "openai-image", executionVersion: "1",
      configuration: { model: OPENAI_IMAGE_MODEL, settings: { width: 1024, height: 1024, quality: "medium" } }, maxConcurrency: 1, unitCostMicros: "100000", maxRetries: 0 } },
    { label: "External video", profile: { id: "external-video", revision: "configured-video-1", kind: "video", adapter: "minimax-h3", executionVersion: "1",
      configuration: { model: "MiniMax-H3", settings: { resolution: "768P" } }, maxConcurrency: 1, unitCostMicros: "200000", maxRetries: 0, minFrames: 120, maxFrames: 450 } },
  ] } });
}

test("external-video host scope preserves default demo lock bytes and compilation", async t => {
  const f = fixture(t, { newProjectLocalExecution: identity(), newProjectLocalExecutionFor: "external-video" }), saved = f.seed();
  const expected = { profiles: DEFAULT_PROFILES, recipeDigest: RECIPE_DIGEST, stageContractsDigest: STAGE_CONTRACTS_DIGEST, tools: TOOL_NAMES,
    id: saved.project.capabilityLockId, projectId: saved.project.id };
  assert.equal(f.store.db.prepare("SELECT body FROM entities WHERE kind='capability_lock' AND id=?").get(saved.project.capabilityLockId).body, canonical(expected));
  const prepared = await f.prepare(saved), direct = compilePlan(localPlanSource, { project: saved.project, profiles: DEFAULT_PROFILES,
    logicalIds: saved.logicalIds, allocateId: () => { throw Error("Aliases already assigned"); } });
  assert.equal(JSON.stringify(prepared.compiled), JSON.stringify(direct));
  assert.ok(localNodes(prepared.compiled).every(node => !Object.hasOwn(node.args, "localExecution")));
});

test("external-video scope pins only selected external video; external image with fake video remains legacy", t => {
  const f = fixture(t, { newProjectLocalExecution: identity(), newProjectLocalExecutionFor: "external-video" }), catalog = externalCatalog();
  for (const [profileIds, pinned] of [[["fake-video-v1"], false], [["external-image"], false], [["external-video"], true], [["external-image", "external-video"], true]]) {
    const selection = catalog.select(catalog.digest, profileIds), project = f.service.createProject("Selected media", selection), saved = lock(f, project);
    assert.equal(Object.hasOwn(saved, "localExecution"), pinned);
    if (pinned) assert.deepEqual(saved.localExecution, identity());
    assert.deepEqual(saved.providerSelection, { catalogDigest: catalog.digest, profileIds: saved.profiles.map(profile => profile.id) });
    assert.equal(saved.profiles.find(profile => profile.kind === "video").adapter !== "fake", pinned);
    for (const kind of ["message", "hold", "epoch", "grant", "candidate", "attempt", "reservation", "approval", "external_allowance"])
      assert.equal(f.store.list(kind, project.id).length, 0);
  }
  assert.throws(() => f.service.createProject("Forged selection", { catalogDigest: catalog.digest, profileIds: ["external-video"] }), { code: "PROVIDER_SELECTION_INVALID" });
  assert.equal(f.provider.acceptedCount(), 0);
});

test("host scope and identity are captured before caller mutation, and all retains the existing opt-in behavior", t => {
  const options = { newProjectLocalExecution: identity(), newProjectLocalExecutionFor: "external-video" }, f = fixture(t, options), catalog = externalCatalog();
  options.newProjectLocalExecutionFor = "all"; options.newProjectLocalExecution.adapter = "mutated";
  const demo = f.service.createProject("Still a legacy demo"), real = f.service.createProject("Still exact local assembly", catalog.select(catalog.digest, ["external-video"]));
  assert.equal(Object.hasOwn(lock(f, demo), "localExecution"), false); assert.deepEqual(lock(f, real).localExecution, identity());
  for (const scope of [undefined, "all"]) {
    const service = new ProductionService(f.store, f.engine, DEFAULT_PROFILES, { newProjectLocalExecution: identity(), newProjectLocalExecutionFor: scope });
    assert.deepEqual(lock(f, service.createProject("Explicit or default all")).localExecution, identity());
  }
  const explicitAllWithoutIdentity = new ProductionService(f.store, f.engine, DEFAULT_PROFILES, { newProjectLocalExecutionFor: "all" });
  assert.equal(Object.hasOwn(lock(f, explicitAllWithoutIdentity.createProject("No identity supplied")), "localExecution"), false);
  assert.equal(f.provider.acceptedCount(), 0);
});

test("unsupported scopes and conditional selection without an exact identity fail before creating state", t => {
  const f = fixture(t);
  for (const scope of [null, false, 1, "external", "EXTERNAL-VIDEO", [], {}, ""]) {
    assert.throws(() => new ProductionService(f.store, f.engine, DEFAULT_PROFILES, { newProjectLocalExecution: identity(), newProjectLocalExecutionFor: scope }), { code: "LOCAL_EXECUTION_UNSUPPORTED" });
  }
  for (const selected of [undefined, null, { adapter: "local-media", version: "2" }])
    assert.throws(() => new ProductionService(f.store, f.engine, DEFAULT_PROFILES, { newProjectLocalExecution: selected, newProjectLocalExecutionFor: "external-video" }), { code: "LOCAL_EXECUTION_UNSUPPORTED" });
  assert.equal(f.store.listProjects().length, 0);
});
