import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../dist/persistence/store.js";
import { CURRENT_SCHEMA_VERSION, SCHEMA, verifySchema } from "../dist/persistence/schema.js";
import { snapshotDatabase, verifyDatabase } from "../dist/persistence/database-snapshot.js";

const hashFile = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const contents = db => Object.fromEntries(["projects", "entities", "commands", "events", "installation_recoveries"].map(table => [table, db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()]));
const version = db => db.pragma("user_version", { simple: true });
const schema = db => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all();
const expectedObjects = [
  ["index", "attempt_ordinal_once"], ["index", "candidate_grant_once"], ["table", "commands"],
  ["index", "director_request_once"], ["index", "director_running_once"], ["table", "entities"],
  ["index", "entity_project"], ["table", "events"], ["index", "execution_evidence_attempt"],
  ["table", "installation_recoveries"], ["index", "installation_recovery_fence_lookup"],
  ["index", "local_work_once"], ["table", "projects"], ["index", "reservation_attempt_once"],
];
function directory(t) {
  const root = mkdtempSync(join(tmpdir(), "openslate-schema-"));
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}
function savedRows(db) {
  db.prepare("INSERT INTO projects(rowid,id,head_version,body,event_sequence) VALUES(?,?,?,?,?)")
    .run(7, "saved-project", 2, '{ "id": "saved-project", "headVersion": 2, "revisionId":"saved", "brief":"原始 text" }', 3);
  db.prepare("INSERT INTO entities(rowid,kind,id,project_id,body,version) VALUES(?,?,?,?,?,?)")
    .run(11, "execution_evidence", "receipt", "saved-project", '{ "id":"receipt", "attemptId":"saved-attempt", "outcome": { "type":"unknown", "diagnostic":"saved receipt" } }', 4);
  db.prepare("INSERT INTO commands(rowid,actor_scope,key,digest,result) VALUES(?,?,?,?,?)")
    .run(13, "human:saved", "once", "saved-digest", '{ "receiptId" : "receipt", "accepted":true }');
  db.prepare("INSERT INTO events(rowid,project_id,sequence,id,body) VALUES(?,?,?,?,?)")
    .run(19, "saved-project", 3, "saved-event", '{ "eventId":"saved-event", "sequence":3, "kind":"saved" }');
}
function rawCurrent(db) { for (const object of SCHEMA) db.exec(object.sql); db.pragma(`user_version=${CURRENT_SCHEMA_VERSION}`); }

test("fresh and in-memory databases have exactly schema 4; reopen preserves schema and JSON bytes", t => {
  const root = directory(t), path = join(root, "fresh.sqlite"), store = new Store(path);
  try {
    assert.equal(CURRENT_SCHEMA_VERSION, 4); assert.equal(version(store.db), 4);
    assert.ok(Object.isFrozen(SCHEMA)); assert.ok(SCHEMA.every(Object.isFrozen));
    assert.deepEqual(schema(store.db).map(row => [row.type, row.name]), expectedObjects);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='schema_migrations'").get().n, 0);
    assert.equal(store.db.pragma("journal_mode", { simple: true }), "wal");
    savedRows(store.db); const before = contents(store.db), definitions = schema(store.db); store.close();
    const reopened = new Store(path);
    try { assert.equal(version(reopened.db), 4); assert.deepEqual(schema(reopened.db), definitions); assert.deepEqual(contents(reopened.db), before); }
    finally { reopened.close(); }
  } finally { if (store.db.open) store.close(); }
  assert.equal(existsSync(`${path}.migration-backups`), false);
  const memory = new Store(":memory:");
  try { assert.equal(version(memory.db), 4); assert.deepEqual(schema(memory.db).map(row => [row.type, row.name]), expectedObjects); }
  finally { memory.close(); }
});

test("failed first installation rolls all schema and version work back and closes its handle for retry", t => {
  for (const failure of ["schema", "integrity"]) {
    const root = directory(t), path = join(root, "fresh.sqlite"), originalExec = Database.prototype.exec, originalPragma = Database.prototype.pragma; let failed;
    Database.prototype.exec = function (sql) {
      const result = originalExec.call(this, sql);
      if (failure === "schema" && sql.includes("CREATE TABLE IF NOT EXISTS installation_recoveries")) { failed = this; throw Error("synthetic schema interruption"); }
      return result;
    };
    Database.prototype.pragma = function (sql, ...args) {
      if (failure === "integrity" && sql === "integrity_check") { failed = this; return "synthetic integrity failure"; }
      return originalPragma.call(this, sql, ...args);
    };
    try { assert.throws(() => new Store(path), failure === "schema" ? /synthetic schema interruption/ : { code: "DATABASE_CORRUPT" }); }
    finally { Database.prototype.exec = originalExec; Database.prototype.pragma = originalPragma; }
    assert.equal(failed.open, false); const raw = new Database(path);
    try { assert.equal(version(raw), 0); assert.deepEqual(schema(raw), []); } finally { raw.close(); }
    const retry = new Store(path); retry.close(); assert.equal(existsSync(`${path}.migration-backups`), false);
  }
});

test("older and unknown schema versions are rejected through a reader without any file mutation", t => {
  for (const unsupported of [1, 2, 3, 99]) {
    const root = directory(t), path = join(root, "unsupported.sqlite"), raw = new Database(path);
    raw.exec("CREATE TABLE saved(body TEXT); INSERT INTO saved VALUES('preserve original bytes')"); raw.pragma(`user_version=${unsupported}`); raw.close();
    const before = hashFile(path), files = readdirSync(root), original = Database.prototype.pragma; let reads = 0;
    Database.prototype.pragma = function (...args) { assert.equal(this.readonly, true, "unsupported files must never open a writer"); reads++; return original.apply(this, args); };
    try { assert.throws(() => new Store(path), error => error.code === "DATABASE_VERSION_UNSUPPORTED" && /earlier OpenSlate prototype/.test(error.message) && /new OPENSLATE_DATA_DIR/.test(error.message)); }
    finally { Database.prototype.pragma = original; }
    assert.ok(reads > 0); assert.equal(hashFile(path), before); assert.deepEqual(readdirSync(root), files);
  }
});

test("unknown, missing and altered current schema objects are rejected without persistent mutation", t => {
  const scenarios = ["unknown-table", "unknown-index", "similar-internal-name", "wrong-definition", "missing-table", "missing-index", "wrong-type"];
  for (const scenario of scenarios) {
    const root = directory(t), path = join(root, "current.sqlite"), raw = new Database(path); rawCurrent(raw); savedRows(raw);
    if (scenario === "unknown-table") raw.exec("CREATE TABLE unrelated(id TEXT)");
    if (scenario === "unknown-index") raw.exec("CREATE INDEX unrelated ON projects(head_version)");
    if (scenario === "similar-internal-name") raw.exec("CREATE TABLE sqliteXextension(id TEXT)");
    if (scenario === "wrong-definition") raw.exec("DROP INDEX entity_project; CREATE INDEX entity_project ON entities(kind)");
    if (scenario === "missing-table") raw.exec("DROP TABLE commands");
    if (scenario === "missing-index") raw.exec("DROP INDEX director_request_once");
    if (scenario === "wrong-type") raw.exec("DROP INDEX entity_project; CREATE VIEW entity_project AS SELECT id FROM projects");
    raw.close(); const before = hashFile(path), files = readdirSync(root);
    assert.throws(() => new Store(path), { code: "DATABASE_SCHEMA_MISMATCH" });
    assert.equal(hashFile(path), before); assert.deepEqual(readdirSync(root), files);
  }
});

test("only a truly empty unversioned database may initialize", t => {
  const root = directory(t), path = join(root, "empty.sqlite"), empty = new Database(path);
  assert.equal(verifySchema(empty, { allowEmpty: true }), 0);
  assert.throws(() => verifySchema(empty), { code: "DATABASE_SCHEMA_MISMATCH" }); empty.close();
  const store = new Store(path); try { assert.equal(version(store.db), 4); } finally { store.close(); }
  for (const state of ["nonempty-unversioned", "complete-unversioned", "empty-current"]) {
    const invalid = join(root, `${state}.sqlite`), raw = new Database(invalid);
    if (state === "nonempty-unversioned") raw.exec("CREATE TABLE unrelated(id TEXT)");
    if (state === "complete-unversioned") for (const object of SCHEMA) raw.exec(object.sql);
    if (state === "empty-current") raw.pragma("user_version=4");
    assert.throws(() => verifySchema(raw, { allowEmpty: true }), { code: "DATABASE_SCHEMA_MISMATCH" }); raw.close();
    const before = hashFile(invalid); assert.throws(() => new Store(invalid), { code: "DATABASE_SCHEMA_MISMATCH" }); assert.equal(hashFile(invalid), before);
  }
});

test("current schema integrity checks reject invalid constraints and foreign references", () => {
  for (const kind of ["constraint", "foreign-key"]) {
    const db = new Database(":memory:");
    try {
      rawCurrent(db);
      if (kind === "constraint") { db.pragma("ignore_check_constraints=ON"); db.exec("INSERT INTO projects(id,head_version,body) VALUES('invalid',-1,'{}')"); db.pragma("ignore_check_constraints=OFF"); }
      else { db.pragma("foreign_keys=OFF"); db.exec("INSERT INTO entities(kind,id,project_id,body) VALUES('saved','receipt','missing-project','{}')"); }
      assert.equal(verifySchema(db), 4); assert.throws(() => verifySchema(db, { integrity: true }), { code: "DATABASE_CORRUPT" });
    } finally { db.close(); }
  }
});

test("current snapshots include committed WAL, exclude uncommitted writes and preserve JSON bytes", t => {
  const root = directory(t), path = join(root, "current.sqlite"), destination = join(root, "snapshot.sqlite"), store = new Store(path);
  const reader = new Database(path, { readonly: true });
  try {
    store.db.pragma("wal_autocheckpoint=0"); savedRows(store.db); assert.ok(existsSync(`${path}-wal`)); const committed = contents(store.db);
    store.db.exec("BEGIN IMMEDIATE"); store.db.prepare("UPDATE projects SET body=? WHERE id='saved-project'").run('{"uncommitted":true}');
    try { snapshotDatabase(reader, destination); } finally { store.db.exec("ROLLBACK"); }
    assert.equal(verifyDatabase(destination), 4); assert.equal(statSync(destination).mode & 0o777, 0o600);
    const saved = new Database(destination, { readonly: true });
    try { assert.deepEqual(contents(saved), committed); } finally { saved.close(); }
    const reopened = new Store(destination); try { assert.deepEqual(contents(reopened.db), committed); } finally { reopened.close(); }
  } finally { reader.close(); store.close(); }
});

test("current snapshots never overwrite existing files, source aliases or dangling destinations", t => {
  const root = directory(t), path = join(root, "current.sqlite"), store = new Store(path), backup = join(root, "backup.sqlite");
  try {
    snapshotDatabase(store.db, backup); const before = hashFile(backup), sourceBefore = contents(store.db);
    assert.throws(() => snapshotDatabase(store.db, backup), { code: "BACKUP_EXISTS" }); assert.equal(hashFile(backup), before);
    const alias = join(root, "source-alias.sqlite"); symlinkSync(path, alias);
    assert.throws(() => snapshotDatabase(store.db, alias), { code: "BACKUP_EXISTS" }); assert.deepEqual(contents(store.db), sourceBefore);
    const dangling = join(root, "dangling.sqlite"), target = join(root, "do-not-create.sqlite"); symlinkSync(target, dangling);
    assert.throws(() => snapshotDatabase(store.db, dangling), { code: "EEXIST" }); assert.equal(existsSync(target), false);
  } finally { store.close(); }
});

test("two independent Store processes safely recheck concurrent fresh creation after waiting for a writer", { timeout: 20000 }, async t => {
  const root = directory(t), path = join(root, "fresh.sqlite"), blocker = new Database(path);
  blocker.exec("BEGIN IMMEDIATE");
  const url = new URL("../dist/persistence/store.js", import.meta.url).href;
  const databaseUrl = import.meta.resolve("better-sqlite3");
  const code = `import Database from ${JSON.stringify(databaseUrl)}; import { Store } from ${JSON.stringify(url)};
    const original=Database.prototype.exec; Database.prototype.exec=function(sql){if(sql==='BEGIN IMMEDIATE')process.stdout.write('ready\\n');return original.call(this,sql);};
    const store=new Store(process.argv[1]);process.stdout.write(String(store.db.pragma('user_version',{simple:true})));store.close();`;
  const results = [1, 2].map(() => promisify(execFile)(process.execPath, ["--input-type=module", "-e", code, path], { timeout: 15000, maxBuffer: 65536 }));
  try {
    await Promise.all(results.map(result => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Store did not reach writer reservation")), 5000); let output = "";
      result.child.stdout.on("data", bytes => { output += bytes.toString(); if (output.includes("ready\n")) { clearTimeout(timer); resolve(); } });
      result.catch(error => { clearTimeout(timer); reject(error); });
    })));
    blocker.exec("ROLLBACK");
    const completed = await Promise.all(results); assert.deepEqual(completed.map(result => result.stdout), ["ready\n4", "ready\n4"]);
    assert.equal(verifyDatabase(path), 4); assert.equal(existsSync(`${path}.migration-backups`), false);
  } finally { if (blocker.inTransaction) blocker.exec("ROLLBACK"); blocker.close(); for (const result of results) result.child.kill(); await Promise.allSettled(results); }
});

test("schema inspection keeps version and object reads in one snapshot during concurrent creation", t => {
  const root = directory(t), path = join(root, "fresh.sqlite"), raw = new Database(path);
  raw.pragma("journal_mode=WAL"); raw.close();
  const original = Database.prototype.pragma; let interleaved = false, store;
  Database.prototype.pragma = function (sql, ...args) {
    const result = original.call(this, sql, ...args);
    if (!interleaved && this.readonly && sql === "user_version" && result === 0) {
      interleaved = true; const second = new Store(path); second.close();
    }
    return result;
  };
  try {
    store = new Store(path); assert.equal(interleaved, true); assert.equal(version(store.db), 4);
    assert.deepEqual(schema(store.db).map(row => [row.type, row.name]), expectedObjects);
  } finally { Database.prototype.pragma = original; if (store?.db.open) store.close(); }
});
