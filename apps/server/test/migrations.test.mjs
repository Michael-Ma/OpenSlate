import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../dist/persistence/store.js";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "../dist/persistence/schema.js";

const legacySql = readFileSync(new URL("schema-v1.sql.fixture", import.meta.url), "utf8");
const hashFile = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const contents = db => Object.fromEntries(["projects", "entities", "commands", "events"].map(table => [table, db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()]));
const version = db => db.pragma("user_version", { simple: true });
const schema = db => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all();
function directory(t) {
  const root = mkdtempSync(join(tmpdir(), "openslate-migrations-"));
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}
function legacy(t, { wal = false, missing = [] } = {}) {
  const root = directory(t), path = join(root, "project.sqlite"), db = new Database(path);
  db.pragma(`journal_mode=${wal ? "WAL" : "DELETE"}`); db.pragma("wal_autocheckpoint=0"); db.exec(legacySql);
  for (const name of missing) db.exec(`DROP INDEX ${name}`);
  db.prepare("INSERT INTO projects(rowid,id,head_version,body,event_sequence) VALUES(?,?,?,?,?)")
    .run(7, "legacy-project", 2, '{ "id": "legacy-project", "headVersion": 2, "revisionId":"saved", "brief":"原始 text" }', 3);
  db.prepare("INSERT INTO entities(rowid,kind,id,project_id,body,version) VALUES(?,?,?,?,?,?)")
    .run(11, "execution_evidence", "receipt", "legacy-project", '{ "id":"receipt", "attemptId":"saved-attempt", "outcome": { "type":"unknown", "diagnostic":"saved receipt" } }', 4);
  db.prepare("INSERT INTO commands(rowid,actor_scope,key,digest,result) VALUES(?,?,?,?,?)")
    .run(13, "human:legacy", "once", "saved-digest", '{ "receiptId" : "receipt", "accepted":true }');
  db.prepare("INSERT INTO events(rowid,project_id,sequence,id,body) VALUES(?,?,?,?,?)")
    .run(19, "legacy-project", 3, "saved-event", '{ "eventId":"saved-event", "sequence":3, "kind":"saved" }');
  t.after(() => { if (db.open) db.close(); });
  const backups = () => {
    const folder = `${path}.migration-backups`;
    return existsSync(folder) && statSync(folder).isDirectory() ? readdirSync(folder).map(name => join(folder, name)) : [];
  };
  return { root, path, db, backups };
}

test("fresh and in-memory databases apply all checked migrations; reopen leaves ledger and data unchanged", t => {
  const root = directory(t), path = join(root, "fresh.sqlite"), store = new Store(path);
  assert.equal(version(store.db), CURRENT_SCHEMA_VERSION);
  const rows = store.db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
  assert.deepEqual(rows.map(row => [row.version, row.name, row.checksum, row.mode]), MIGRATIONS.map(m => [m.version, m.name, m.checksum, "applied"]));
  assert.equal(rows.length, MIGRATIONS.length); assert.equal(store.db.pragma("journal_mode", { simple: true }), "wal");
  store.close(); const reopened = new Store(path);
  try { assert.deepEqual(reopened.db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(), rows); }
  finally { reopened.close(); }
  assert.equal(existsSync(`${path}.migration-backups`), false);
  const memory = new Store(":memory:"); try { assert.equal(version(memory.db), CURRENT_SCHEMA_VERSION); } finally { memory.close(); }
});

test("legacy WAL state upgrades with one verified private backup and preserves every historical JSON byte", t => {
  const f = legacy(t, { wal: true, missing: ["director_request_once", "director_running_once"] }), before = contents(f.db);
  assert.ok(existsSync(`${f.path}-wal`)); const store = new Store(f.path);
  try {
    assert.equal(version(store.db), CURRENT_SCHEMA_VERSION); assert.deepEqual(contents(store.db), before);
    assert.deepEqual(store.db.prepare("SELECT version,mode FROM schema_migrations ORDER BY version").all(), MIGRATIONS.map(m => ({ version: m.version, mode: m.version === 1 ? "adopted" : "applied" })));
    assert.ok(schema(store.db).some(row => row.name === "director_request_once"));
    assert.ok(schema(store.db).some(row => row.name === "execution_evidence_attempt"));
    assert.equal(f.backups().length, 1); const backup = f.backups()[0]; Store.checkDatabase(backup);
    assert.equal(statSync(backup).mode & 0o777, 0o600);
    const saved = new Database(backup, { readonly: true });
    try { assert.equal(version(saved), 1); assert.deepEqual(contents(saved), before); assert.equal(schema(saved).some(row => row.name === "schema_migrations"), false); }
    finally { saved.close(); }
  } finally { store.close(); }
  const reopened = new Store(f.path); reopened.close(); assert.equal(f.backups().length, 1);
});

test("real legacy uniqueness conflicts roll back repaired indexes and retain backup; failed Store closes its handle", t => {
  const f = legacy(t, { missing: ["entity_project", "director_request_once", "director_running_once"] });
  for (const id of ["old-one", "old-two"]) f.db.prepare("INSERT INTO entities(kind,id,project_id,body) VALUES('director_turn',?,'legacy-project',?)")
    .run(id, JSON.stringify({ id, requestId: "duplicate-old-request", state: "queued" }));
  const before = contents(f.db), priorSchema = schema(f.db), original = Database.prototype.exec; let failed;
  Database.prototype.exec = function (sql) { if (sql === "BEGIN IMMEDIATE") failed = this; return original.call(this, sql); };
  try { assert.throws(() => new Store(f.path), error => error.code === "SQLITE_CONSTRAINT_UNIQUE"); }
  finally { Database.prototype.exec = original; }
  assert.equal(failed.open, false); assert.equal(version(f.db), 1); assert.deepEqual(contents(f.db), before); assert.deepEqual(schema(f.db), priorSchema);
  assert.equal(f.backups().length, 1); Store.checkDatabase(f.backups()[0]);
  const saved = new Database(f.backups()[0], { readonly: true }); try { assert.deepEqual(contents(saved), before); } finally { saved.close(); }
});

test("failed first installation rolls all schema work back and closes the database for a clean retry", t => {
  const root = directory(t), path = join(root, "fresh.sqlite"), original = Database.prototype.exec; let failed;
  Database.prototype.exec = function (sql) { const result = original.call(this, sql); if (sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) { failed = this; throw Error("synthetic migration interruption"); } return result; };
  try { assert.throws(() => new Store(path), /synthetic migration interruption/); }
  finally { Database.prototype.exec = original; }
  assert.equal(failed.open, false); const raw = new Database(path);
  try { assert.equal(version(raw), 0); assert.deepEqual(schema(raw), []); } finally { raw.close(); }
  const retry = new Store(path); retry.close(); assert.equal(existsSync(`${path}.migration-backups`), false);
});

test("newer versions, unknown schemas, and altered migration history are rejected without persistent mutation", t => {
  for (const scenario of ["newer", "unknown-table", "similar-internal-name", "wrong-definition", "missing-table", "checksum", "missing-ledger-row"]) {
    const f = legacy(t); f.db.close();
    if (["checksum", "missing-ledger-row"].includes(scenario)) { const current = new Store(f.path); current.close(); }
    const raw = new Database(f.path); raw.pragma("journal_mode=DELETE");
    if (scenario === "newer") raw.pragma("user_version=99");
    if (scenario === "unknown-table") raw.exec("CREATE TABLE unrelated(id TEXT)");
    if (scenario === "similar-internal-name") raw.exec("CREATE TABLE sqliteXextension(id TEXT)");
    if (scenario === "wrong-definition") raw.exec("DROP INDEX entity_project; CREATE INDEX entity_project ON entities(kind)");
    if (scenario === "missing-table") raw.exec("DROP TABLE commands");
    if (scenario === "checksum") raw.prepare("UPDATE schema_migrations SET checksum=? WHERE version=1").run("0".repeat(64));
    if (scenario === "missing-ledger-row") raw.exec("DELETE FROM schema_migrations WHERE version=1");
    raw.close(); const before = hashFile(f.path), backups = f.backups();
    const code = scenario === "newer" ? "DATABASE_VERSION_UNSUPPORTED" : ["checksum", "missing-ledger-row"].includes(scenario) ? "DATABASE_MIGRATION_MISMATCH" : "DATABASE_SCHEMA_MISMATCH";
    assert.throws(() => new Store(f.path), { code }); assert.equal(hashFile(f.path), before); assert.deepEqual(f.backups(), backups);
    assert.equal(existsSync(`${f.path}-wal`), false); assert.throws(() => Store.checkDatabase(f.path), { code });
    const destination = join(f.root, "rejected-restore.sqlite"); assert.throws(() => Store.restore(f.path, destination), { code }); assert.equal(existsSync(destination), false);
  }
});

test("backup failure prevents every upgrade mutation", t => {
  const f = legacy(t, { missing: ["director_request_once"] }), before = contents(f.db), previousSchema = schema(f.db);
  writeFileSync(`${f.path}.migration-backups`, "keep existing file");
  assert.throws(() => new Store(f.path), error => ["EEXIST", "ENOTDIR"].includes(error.code));
  assert.equal(version(f.db), 1); assert.deepEqual(contents(f.db), before); assert.deepEqual(schema(f.db), previousSchema);
  assert.equal(readFileSync(`${f.path}.migration-backups`, "utf8"), "keep existing file");
});

test("restore snapshots active WAL consistently and preserves V1 until ordinary Store startup migrates it", t => {
  const f = legacy(t, { wal: true }), committed = contents(f.db), destination = join(f.root, "restored.sqlite");
  f.db.exec("BEGIN IMMEDIATE"); f.db.prepare("UPDATE projects SET body=? WHERE id='legacy-project'").run('{"uncommitted":true}');
  try { Store.restore(f.path, destination); } finally { f.db.exec("ROLLBACK"); }
  const restored = new Database(destination, { readonly: true });
  try { assert.equal(version(restored), 1); assert.deepEqual(contents(restored), committed); } finally { restored.close(); }
  assert.equal(version(f.db), 1); const opened = new Store(destination);
  try { assert.equal(version(opened.db), CURRENT_SCHEMA_VERSION); assert.deepEqual(contents(opened.db), committed); } finally { opened.close(); }
  assert.equal(readdirSync(`${destination}.migration-backups`).length, 1);
});

test("backup and restore never overwrite existing files, source aliases or dangling destinations", async t => {
  const root = directory(t), path = join(root, "current.sqlite"), store = new Store(path), backup = join(root, "backup.sqlite");
  try {
    await store.backup(backup); Store.checkDatabase(backup); assert.equal(statSync(backup).mode & 0o777, 0o600);
    const before = hashFile(backup); await assert.rejects(store.backup(backup), { code: "BACKUP_EXISTS" });
    assert.throws(() => Store.restore(path, backup), { code: "RESTORE_DESTINATION_EXISTS" }); assert.equal(hashFile(backup), before);
    const alias = join(root, "source-alias.sqlite"); symlinkSync(path, alias);
    assert.throws(() => Store.restore(path, alias), { code: "RESTORE_DESTINATION_EXISTS" });
    const dangling = join(root, "dangling.sqlite"), target = join(root, "do-not-create.sqlite"); symlinkSync(target, dangling);
    assert.throws(() => Store.restore(path, dangling), error => error.code === "EEXIST"); assert.equal(existsSync(target), false);
    await assert.rejects(store.backup(dangling), error => error.code === "EEXIST"); assert.equal(existsSync(target), false);
  } finally { store.close(); }
});

test("two independent Store processes serialize V1 migration and produce one pre-upgrade backup", { timeout: 20000 }, async t => {
  const f = legacy(t, { wal: true }); f.db.close();
  const url = new URL("../dist/persistence/store.js", import.meta.url).href;
  const code = `import { Store } from ${JSON.stringify(url)}; const store=new Store(process.argv[1]); process.stdout.write(String(store.db.pragma('user_version',{simple:true}))); store.close();`;
  const results = await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath, ["--input-type=module", "-e", code, f.path], { timeout: 15000, maxBuffer: 65536 })));
  assert.deepEqual(results.map(result => result.stdout), [String(CURRENT_SCHEMA_VERSION), String(CURRENT_SCHEMA_VERSION)]); assert.equal(f.backups().length, 1); Store.checkDatabase(f.path);
});

test("V2 to V3 preserves original JSON and ledger bytes, backs up V2, and rolls back interrupted recovery schema creation", t => {
  for (const interrupted of [false, true]) {
    const f = legacy(t);
    // Construct the shipped V2 schema without invoking current Store initialization.
    f.db.exec(MIGRATIONS[1].sql);
    for (const migration of MIGRATIONS.slice(0, 2)) f.db.prepare("INSERT INTO schema_migrations VALUES(?,?,?,?,?)")
      .run(migration.version, migration.name, migration.checksum, "2026-09-01T00:00:00.000Z", migration.version === 1 ? "adopted" : "applied");
    f.db.pragma("user_version=2");
    const before = contents(f.db), ledger = f.db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(), originalSchema = schema(f.db);
    const original = Database.prototype.exec;
    if (interrupted) Database.prototype.exec = function (sql) {
      const result = original.call(this, sql); if (sql.includes("CREATE TABLE IF NOT EXISTS installation_recoveries")) throw Error("V3 interrupted"); return result;
    };
    try {
      if (interrupted) assert.throws(() => new Store(f.path), /V3 interrupted/);
      else { const store = new Store(f.path); store.close(); }
    } finally { Database.prototype.exec = original; }
    assert.deepEqual(contents(f.db), before);
    assert.deepEqual(f.db.prepare("SELECT * FROM schema_migrations WHERE version<=2 ORDER BY version").all(), ledger);
    assert.equal(version(f.db), interrupted ? 2 : 3);
    if (interrupted) assert.deepEqual(schema(f.db), originalSchema);
    else assert.equal(f.db.prepare("SELECT count(*) AS n FROM installation_recoveries").get().n, 0);
    assert.equal(f.backups().length, 1); Store.checkDatabase(f.backups()[0]);
    const saved = new Database(f.backups()[0], { readonly: true });
    try { assert.equal(version(saved), 2); assert.deepEqual(contents(saved), before); assert.deepEqual(schema(saved), originalSchema); }
    finally { saved.close(); }
  }
});
