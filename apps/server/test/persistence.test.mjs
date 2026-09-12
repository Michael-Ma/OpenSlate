import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../dist/persistence/index.js";
import { projectFixture } from "./execution-fixture.mjs";

function database(t) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-store-")); const path = join(directory, "project.sqlite");
  const store = new Store(path); const project = projectFixture(); store.createProject(project);
  t.after(() => { if (store.db.open) store.close(); rmSync(directory, { force: true, recursive: true }); });
  return { directory, path, store, project };
}
test("SQLite durability configuration and optimistic heads are real across connections", t => {
  const { path, store, project } = database(t); const second = new Store(path); t.after(() => second.close());
  assert.equal(store.db.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(store.db.pragma("foreign_keys", { simple: true }), 1);
  assert.equal(store.db.pragma("synchronous", { simple: true }), 2);
  store.saveProject({ ...project, brief: "First" }, 0);
  assert.throws(() => second.saveProject({ ...project, brief: "Stale" }, 0), { code: "REVISION_CONFLICT" });
  assert.equal(second.getProject(project.id).brief, "First");
});
test("state, event counters and command receipts roll back and replay together", t => {
  const { store, project } = database(t);
  assert.throws(() => store.command("human:one", "command", "payload", () => {
    store.put("draft", "draft", project.id, { value: 1 }); store.appendEvent(project.id, "draft.changed", {}); throw Error("crash");
  }));
  assert.equal(store.get("draft", "draft"), undefined); assert.equal(store.cursor(project.id), 0);
  let calls = 0;
  const run = () => store.command("human:one", "command", "payload", () => { calls++; store.appendEvent(project.id, "draft.changed", {}); return { ok: true }; });
  assert.deepEqual(run(), run()); assert.equal(calls, 1); assert.equal(store.cursor(project.id), 1);
  assert.throws(() => store.command("human:one", "command", "other", () => null), { code: "IDEMPOTENCY_CONFLICT" });
  assert.equal(store.readEvents(project.id)[0].sequence, 1);
});
test("async callbacks are rejected before entering user code", t => {
  const { store } = database(t); let entered = false;
  assert.throws(() => store.transaction(async () => { entered = true; }), { code: "ASYNC_TRANSACTION" }); assert.equal(entered, false);
  assert.throws(() => store.transaction(() => Promise.resolve(1)), { code: "ASYNC_TRANSACTION" });
  assert.throws(() => store.command("actor", "command", "digest", async () => { entered = true; }), { code: "ASYNC_TRANSACTION" }); assert.equal(entered, false);
});
test("project ownership, immutable candidate origin, grant reuse and attempt ordinals are enforced", t => {
  const { store, project } = database(t); const other = projectFixture(); store.createProject(other);
  store.insert("grant", "grant", project.id, { scopeId: project.id, authorityId: "human", kind: "image", origin: "initial_slot" });
  assert.throws(() => store.insert("candidate", "foreign", other.id, { nodeId: "node", grantId: "grant", origin: "initial_slot" }), { code: "SCOPE_DENIED" });
  store.insert("candidate", "candidate", project.id, { nodeId: "node", grantId: "grant", origin: "initial_slot" });
  assert.throws(() => store.insert("candidate", "recreated", project.id, { nodeId: "renamed-node", grantId: "grant", origin: "initial_slot" }), { code: "UNIQUENESS_CONFLICT" });
  assert.throws(() => store.put("candidate", "candidate", project.id, { nodeId: "node", grantId: "grant", origin: "user_change" }), { code: "ORIGIN_NOT_AUTHORIZED" });
  store.insert("attempt", "attempt", project.id, { candidateId: "candidate", ordinal: 1 });
  assert.throws(() => store.insert("attempt", "again", project.id, { candidateId: "candidate", ordinal: 1 }), { code: "UNIQUENESS_CONFLICT" });
  assert.throws(() => store.put("attempt", "attempt", other.id, { candidateId: "candidate", ordinal: 1 }), { code: "SCOPE_DENIED" });
});
test("online backup restores a verified consistent database to a new path", async t => {
  const { directory, store, project } = database(t); store.appendEvent(project.id, "project.created", {});
  const backup = join(directory, "backup.sqlite"); const restored = join(directory, "restored.sqlite");
  await store.backup(backup); Store.restore(backup, restored); const recovered = new Store(restored);
  try { assert.deepEqual(recovered.getProject(project.id), store.getProject(project.id)); assert.equal(recovered.cursor(project.id), 1); }
  finally { recovered.close(); }
  assert.throws(() => Store.restore(backup, restored), { code: "RESTORE_DESTINATION_EXISTS" });
});
