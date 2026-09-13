import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, digest, newId } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { projectDirectorContext } from "../dist/application/context-projection.js";
import { projectFixture } from "./execution-fixture.mjs";

function setup(t, shots = 0) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-context-work-"));
  const store = new Store(join(directory, "state.sqlite")), provider = new FakeProvider(join(directory, "fake.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(directory, "artifacts") }), service = new ProductionService(store, engine);
  const empty = service.createProject("Output provenance"), planId = newId();
  // Projection fixtures have no execution: seed the same saved plan/binding shapes the reader consumes.
  store.insert("plan", planId, empty.id, { id: planId, projectId: empty.id,
    compiled: { source: "saved fixture source", canonicalSource: "saved fixture source", graphDigest: digest({ fixture: true }), nodes: [], gates: [] } });
  const project = store.saveProject({ ...projectFixture(empty.id, shots), capabilityLockId: empty.capabilityLockId, activePlanId: planId }, empty.headVersion);
  const human = service.beginRequest(project.id, "local-human", "Inspect current work."), actor = service.openEpoch(project.id, human).actor;
  t.after(() => { store.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, store, provider, engine, service, project, planId, read: input => projectDirectorContext(service, project.id, actor, input) };
}
function artifact(f, fixture, patch = {}, projectId = f.project.id) {
  const id = newId(), ref = { artifactId: id, sha256: digest({ id }), kind: "audio" };
  f.store.insert("artifact", id, projectId, { id, projectId, artifact: ref, fixture, attemptId: null,
    path: "/not-opened/private-artifact.wav", mimeType: "audio/wav", ...patch });
  return ref;
}
function binding(f, outputs, patch = {}, projectId = f.project.id) {
  const id = newId();
  f.store.put("node_binding", id, projectId, { id, projectId, planId: f.planId, state: "active", candidateId: null, outputs,
    node: { id, alias: id, kind: "transcription", shotId: null, shotRevisionId: null, profileId: "irrelevant-profile",
      args: {}, inputs: [], requires: [], intentDigest: digest({}), specDigest: digest({ id }) }, ...patch });
  return id;
}
function summary(f, expected, fixtureOnly, input) {
  const work = f.read(input).work;
  assert.deepEqual(work.currentOutputProvenance, expected); assert.equal(work.fixtureOnly, fixtureOnly);
  assert.equal(work.currentOutputCount, expected.fixture + expected.nonfixture + expected.unknown);
  assert.equal(work.planId, f.planId); return work;
}
function rows(f) { return ["projects", "entities", "commands", "events"].map(table => canonical(f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())); }

test("no outputs are unknown rather than a fixture-only claim, including a project without a plan", t => {
  const f = setup(t); summary(f, { fixture: 0, nonfixture: 0, unknown: 0 }, null);
  const current = f.store.getProject(f.project.id); f.store.saveProject({ ...current, activePlanId: null }, current.headVersion);
  const work = f.read().work;
  assert.equal(work.planId, null); assert.equal(work.fixtureOnly, null); assert.equal(work.currentOutputCount, 0);
  assert.deepEqual(work.currentOutputProvenance, { fixture: 0, nonfixture: 0, unknown: 0 });
});

test("exact fixture artifacts are fixture-only regardless of profile or attempt claims", t => {
  const f = setup(t), ref = artifact(f, true, { attemptId: "not-a-real-attempt" });
  binding(f, { first: ref, second: ref });
  const work = summary(f, { fixture: 2, nonfixture: 0, unknown: 0 }, true);
  assert.deepEqual(work.attemptPhaseCounts, []); assert.deepEqual(work.nodeCounts, [{ kind: "transcription", count: 1 }]);
});

test("a nonfixture output is reported from the artifact record without needing a provider attempt", t => {
  const f = setup(t); binding(f, { audio: artifact(f, false) });
  summary(f, { fixture: 0, nonfixture: 1, unknown: 0 }, false);
});

test("mixed known outputs remain nonfixture and unknown evidence cannot hide a proven nonfixture output", t => {
  const f = setup(t); binding(f, { fixture: artifact(f, true), real: artifact(f, false), absent: { artifactId: "missing", kind: "audio", sha256: "a".repeat(64) } });
  summary(f, { fixture: 1, nonfixture: 1, unknown: 1 }, false);
});

test("fixture outputs plus missing or mismatched same-project artifacts produce an unknown aggregate", t => {
  const f = setup(t), changedHash = artifact(f, true), changedKind = artifact(f, true), changedId = artifact(f, true);
  f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.artifact.artifactId',?) WHERE kind='artifact' AND id=?").run(newId(), changedId.artifactId);
  binding(f, { fixture: artifact(f, true), missing: { artifactId: "missing", kind: "audio", sha256: "a".repeat(64) },
    changedHash: { ...changedHash, sha256: "b".repeat(64) }, changedKind: { ...changedKind, kind: "video" }, changedId });
  summary(f, { fixture: 1, nonfixture: 0, unknown: 4 }, null);
});

test("malformed output reference values, types, fields, hashes and unsupported kinds stay unknown", t => {
  const f = setup(t), good = artifact(f, false);
  const invalid = [null, "not JSON", 7, true, [], {}, { ...good, artifactId: 1 }, { ...good, sha256: false },
    { ...good, sha256: "g".repeat(64) }, { ...good, sha256: "a".repeat(63) }, { ...good, kind: "timeline" },
    { ...good, kind: 1 }, { ...good, extra: "hidden" }];
  binding(f, Object.fromEntries(invalid.map((value, index) => [`port${index}`, value])));
  summary(f, { fixture: 0, nonfixture: 0, unknown: invalid.length }, null);
});

test("nonboolean fixture flags are unknown even when every artifact identity matches", t => {
  const f = setup(t), flags = [null, 0, 1, "true", "false", {}, []];
  const refs = flags.map(value => artifact(f, value));
  const missing = artifact(f, true); f.store.db.prepare("UPDATE entities SET body=json_remove(body,'$.fixture') WHERE kind='artifact' AND id=?").run(missing.artifactId);
  binding(f, Object.fromEntries([...refs, missing].map((value, index) => [`port${index}`, value])));
  summary(f, { fixture: 0, nonfixture: 0, unknown: flags.length + 1 }, null);
});

test("foreign artifact rows and mismatched record identities never contribute fixture evidence", t => {
  const f = setup(t), foreign = f.service.createProject("Foreign"), foreignRef = artifact(f, true, {}, foreign.id);
  const wrongProject = artifact(f, true), wrongId = artifact(f, true), malformed = artifact(f, true);
  f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.projectId',?) WHERE kind='artifact' AND id=?").run(foreign.id, wrongProject.artifactId);
  f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.id',?) WHERE kind='artifact' AND id=?").run(newId(), wrongId.artifactId);
  f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.artifact',?) WHERE kind='artifact' AND id=?").run("not JSON", malformed.artifactId);
  binding(f, { foreignRef, wrongProject, wrongId, malformed }); summary(f, { fixture: 0, nonfixture: 0, unknown: 4 }, null);
});

test("retired, previous-plan and foreign bindings cannot change current output provenance", t => {
  const f = setup(t), foreign = f.service.createProject("Foreign"), oldPlanId = newId();
  const fixture = artifact(f, true), real = artifact(f, false);
  binding(f, { audio: fixture }); binding(f, { audio: real }, { state: "retired" }); binding(f, { audio: real }, { planId: oldPlanId });
  binding(f, { audio: real }, {}, foreign.id);
  const malformed = binding(f, { audio: real });
  f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.projectId',?) WHERE kind='node_binding' AND id=?").run(foreign.id, malformed);
  summary(f, { fixture: 1, nonfixture: 0, unknown: 0 }, true);
});

test("counts cover the full current plan on every overview page without hydrating work or artifact bodies", t => {
  const f = setup(t, 61), fixture = artifact(f, true, { unusedPayload: "x".repeat(1024 * 1024) }), real = artifact(f, false);
  for (let index = 0; index < 60; index++) binding(f, { audio: fixture }); binding(f, { audio: real });
  const get = f.store.get.bind(f.store), list = f.store.list.bind(f.store);
  t.mock.method(f.store, "get", (kind, ...args) => { assert.ok(!["node_binding", "attempt", "artifact"].includes(kind), `unexpected full ${kind} read`); return get(kind, ...args); });
  t.mock.method(f.store, "list", (kind, ...args) => { assert.ok(!["node_binding", "attempt", "artifact"].includes(kind), `unexpected full ${kind} list`); return list(kind, ...args); });
  for (const offset of [0, 20, 40, 60, 100]) summary(f, { fixture: 60, nonfixture: 1, unknown: 0 }, false, { section: "overview", offset });
});

test("work provenance reads leave all project, entity, command and event rows unchanged", t => {
  const f = setup(t); binding(f, { audio: artifact(f, false) });
  const before = rows(f), changes = f.store.db.prepare("SELECT total_changes() AS count").get().count;
  summary(f, { fixture: 0, nonfixture: 1, unknown: 0 }, false); summary(f, { fixture: 0, nonfixture: 1, unknown: 0 }, false);
  assert.deepEqual(rows(f), before); assert.equal(f.store.db.prepare("SELECT total_changes() AS count").get().count, changes);
  assert.equal(f.provider.acceptedCount(), 0);
});
