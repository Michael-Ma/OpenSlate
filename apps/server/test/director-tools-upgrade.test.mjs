import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { digest, newId } from "../../../packages/core/dist/index.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { LocalDirectorController } from "../dist/application/local-director.js";
import { DirectorToolSettings } from "../dist/application/director-tools-upgrade.js";
import { createDirectorSkillLock } from "../dist/application/director-capabilities.js";
import { createDirectorInput } from "../dist/application/director-input.js";
import { DirectorContextService } from "../dist/application/director-context.js";
import { createApp } from "../dist/app.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
function writable(path) { chmodSync(path, 0o700); for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name)); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "openslate-tool-upgrade-")), store = new Store(join(root, "app.sqlite")), provider = new FakeProvider(join(root, "fake.sqlite"));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, "artifacts") }));
  const config = { repositoryRoot, dataDirectory: root, endpoint: "http://127.0.0.1:3001" };
  const director = new LocalDirectorController(service, config), token = "local_upgrade_token_01234567890123456789";
  const app = createApp({ service, director, runtimeSettings: director, localToken: token });
  t.after(async () => { await director.close(); await app.close(); provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  const req = (method, projectId, body, key = newId(), suffix = "") => app.inject({ method, url: `/api/projects/${projectId}/director/tools${suffix}`,
    payload: body, headers: { host: "127.0.0.1", authorization: `Bearer ${token}`, "idempotency-key": key } });
  const configuration = { repositoryRoot, snapshotRoot: join(root, "skill-snapshots"), runtimeId: "fake-workflow-v1" };
  function legacy(projectId) {
    const value = createDirectorSkillLock(configuration, "1.0.0");
    new DirectorContextService(service, value.environment).bootstrapLock(projectId, value.lock);
    return { ...value, input: { expectedLockId: value.lock.id, expectedLockDigest: value.lock.lockDigest, targetVersion: "2.0.0" } };
  }
  return { root, store, provider, service, director, app, req, legacy, configuration };
}

test("tool status is read-only and new projects use the current contract without an upgrade", async t => {
  const f = fixture(t), project = f.service.createProject("New project"), cursor = f.store.cursor(project.id);
  const response = await f.req("GET", project.id); assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { currentVersion: "2.0.0", lockId: null, lockDigest: null, availableVersion: "2.0.0", upgradeAvailable: false, busy: false });
  assert.equal(f.store.cursor(project.id), cursor); assert.equal(f.store.list("director_skill_lock", project.id).length, 0);
});
test("explicit upgrade installs one successor while preserving old locks, canonical state and edit authority", async t => {
  const f = fixture(t), project = f.service.createProject("Legacy project"), prior = f.legacy(project.id);
  const human = f.service.beginRequest(project.id, "local-user", "Retained edit"), bridge = f.service.openEpoch(project.id, human);
  const context = new DirectorContextService(f.service, prior.environment);
  context.capture(project.id, bridge.actor, { lockId: prior.lock.id, selectedSkillIds: ["production", "plan-authoring"] });
  f.store.put("epoch", bridge.actor.epochId, project.id, { ...f.store.get("epoch", bridge.actor.epochId), state: "revoked" });
  const before = digest(f.store.getProject(project.id)), messages = f.store.list("message", project.id), holds = f.store.list("hold", project.id);
  const response = await f.req("POST", project.id, prior.input, "upgrade", "/upgrade"); assert.equal(response.statusCode, 200, response.body);
  const result = response.json(); assert.equal(result.currentVersion, "2.0.0"); assert.equal(result.upgradeAvailable, false); assert.notEqual(result.lockId, prior.lock.id);
  assert.deepEqual(f.store.get("director_skill_lock", prior.lock.id).lock, prior.lock);
  assert.equal(f.store.get("director_epoch_lock", bridge.actor.epochId).lockId, prior.lock.id);
  assert.equal(digest(f.store.getProject(project.id)), before); assert.deepEqual(f.store.list("message", project.id), messages); assert.deepEqual(f.store.list("hold", project.id), holds);
  for (const kind of ["director_turn", "native_model_start", "grant", "candidate", "attempt", "approval", "narration_acceptance"]) assert.equal(f.store.list(kind, project.id).length, 0, kind);
  assert.equal(f.provider.acceptedCount(), 0);
});
test("an exact lost-response replay returns its receipt without installing another lock", async t => {
  const f = fixture(t), project = f.service.createProject("Replay"), prior = f.legacy(project.id);
  const first = f.director.upgradeTools(project.id, prior.input, "same-command"), cursor = f.store.cursor(project.id);
  assert.deepEqual(f.director.upgradeTools(project.id, prior.input, "same-command"), first);
  assert.equal(f.store.cursor(project.id), cursor); assert.equal(f.store.list("director_skill_lock", project.id).length, 2);
  assert.throws(() => f.director.upgradeTools(project.id, { ...prior.input, expectedLockDigest: "0".repeat(64) }, "same-command"), { code: "IDEMPOTENCY_CONFLICT" });
  assert.throws(() => f.director.upgradeTools(project.id, prior.input, "new-command"), { code: "DIRECTOR_TOOLS_STALE" });
});
test("queued turns and active read-only or editing epochs block upgrades", async t => {
  const f = fixture(t), project = f.service.createProject("Busy"), prior = f.legacy(project.id);
  const human = f.service.beginRequest(project.id, "local-user", "Read this", { editing: false }), bridge = f.service.openEpoch(project.id, human);
  assert.throws(() => f.director.upgradeTools(project.id, prior.input, "read-only"), { code: "DIRECTOR_TOOLS_BUSY" });
  f.store.put("epoch", bridge.actor.epochId, project.id, { ...f.store.get("epoch", bridge.actor.epochId), state: "revoked" });
  f.director.enqueue(project.id, human);
  assert.throws(() => f.director.upgradeTools(project.id, prior.input, "queued"), { code: "DIRECTOR_TOOLS_BUSY" });
  assert.equal(f.store.list("director_skill_lock", project.id).length, 1);
});
test("setup, wrong-project predecessors and stale predecessor digests cannot install guidance", t => {
  const f = fixture(t), project = f.service.createProject("Owner"), other = f.service.createProject("Other"), prior = f.legacy(project.id);
  const setting = new DirectorToolSettings(f.service, () => f.configuration, () => true);
  assert.throws(() => setting.upgrade(project.id, prior.input, "setup"), { code: "DIRECTOR_TOOLS_BUSY" });
  assert.throws(() => f.director.upgradeTools(other.id, prior.input, "other"), { code: "DIRECTOR_TOOLS_STALE" });
  assert.throws(() => f.director.upgradeTools(project.id, { ...prior.input, expectedLockDigest: "0".repeat(64) }, "wrong-digest"), { code: "DIRECTOR_TOOLS_STALE" });
});
test("the upgrade endpoint requires local authentication and rejects model-supplied actor or package fields", async t => {
  const f = fixture(t), project = f.service.createProject("Route"), prior = f.legacy(project.id), url = `/api/projects/${project.id}/director/tools/upgrade`;
  assert.equal((await f.app.inject({ method: "POST", url, payload: prior.input, headers: { host: "127.0.0.1" } })).statusCode, 403);
  for (const extra of [{ actor: "human" }, { snapshotRoot: "/tmp/arbitrary" }, { targetVersion: "3.0.0" }]) {
    const response = await f.req("POST", project.id, { ...prior.input, ...extra }, newId(), "/upgrade"); assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(f.store.list("director_skill_lock", project.id).length, 1);
});
test("fresh requests after upgrade bind the new tool catalog while legacy epoch bindings stay unchanged", t => {
  const f = fixture(t), project = f.service.createProject("Next request"), prior = f.legacy(project.id);
  const beforeHuman = f.service.beginRequest(project.id, "local-user", "Before upgrade", { editing: false }), beforeBridge = f.service.openEpoch(project.id, beforeHuman);
  const prepare = createDirectorInput(f.service, { ...f.configuration, endpoint: "http://127.0.0.1:3001" });
  const before = prepare({ id: newId(), projectId: project.id, requestId: beforeHuman.requestId }, beforeHuman, beforeBridge);
  assert.equal(before.bridge.toolContractVersion, "1.0.0");
  f.store.put("epoch", beforeBridge.actor.epochId, project.id, { ...f.store.get("epoch", beforeBridge.actor.epochId), state: "revoked" });
  const upgraded = f.director.upgradeTools(project.id, prior.input, "upgrade");
  const human = f.service.beginRequest(project.id, "local-user", "Draft a short opening"), bridge = f.service.openEpoch(project.id, human);
  const after = prepare({ id: newId(), projectId: project.id, requestId: human.requestId }, human, bridge);
  assert.equal(after.bridge.toolContractVersion, "2.0.0");
  assert.equal(f.store.get("director_epoch_lock", bridge.actor.epochId).lockId, upgraded.lockId);
  assert.equal(f.store.get("director_epoch_lock", beforeBridge.actor.epochId).lockId, prior.lock.id);
  assert.match(after.context, /revise_narration_draft/);
});
