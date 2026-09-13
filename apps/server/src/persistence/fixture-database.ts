import Database from "better-sqlite3";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import { invariant } from "@openslate/core";
import { flushSnapshot, prepareSnapshotDirectory } from "./database-snapshot.js";

/** FakeProvider's shipped schema has no SQLite user_version; this tag is external. */
export const FIXTURE_SCHEMA = Object.freeze({ tag: 1 as const, userVersion: 0 as const });
const DEFINITIONS: Record<string, string> = {
  fake_jobs: "CREATE TABLE fake_jobs (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, node_id TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL, outputs TEXT NOT NULL, failure_id TEXT, accepted_at TEXT NOT NULL)",
  fake_attempt_lookup: "CREATE INDEX fake_attempt_lookup ON fake_jobs(attempt_id)",
  fake_modes: "CREATE TABLE fake_modes(node_id TEXT PRIMARY KEY, modes TEXT NOT NULL)",
};
const identity = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\b/gi, "").replace(/\s+/g, " ").replace(/\s*([(),;])\s*/g, "$1").replace(/;$/, "").trim();

export function verifyFixtureSchema(db: Database.Database): typeof FIXTURE_SCHEMA {
  invariant(db.pragma("user_version", { simple: true }) === 0, "FIXTURE_DATABASE_VERSION_UNSUPPORTED", "Unsupported fixture database version");
  const rows = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all() as { type: string; name: string; sql: string }[];
  invariant(rows.length === Object.keys(DEFINITIONS).length && rows.every(row => DEFINITIONS[row.name]
    && row.type === (row.name === "fake_attempt_lookup" ? "index" : "table") && identity(row.sql) === identity(DEFINITIONS[row.name]!)),
  "FIXTURE_DATABASE_SCHEMA_MISMATCH", "Unrecognized fixture database structure");
  invariant(db.pragma("integrity_check", { simple: true }) === "ok", "DATABASE_CORRUPT", "Fixture database integrity check failed");
  invariant(!db.prepare("SELECT 1 FROM fake_jobs WHERE NOT json_valid(request) OR NOT json_valid(outputs) LIMIT 1").get()
    && !db.prepare("SELECT 1 FROM fake_modes WHERE NOT json_valid(modes) LIMIT 1").get(), "DATABASE_CORRUPT", "Fixture database contains invalid records");
  return FIXTURE_SCHEMA;
}

export function verifyFixtureDatabase(path: string): typeof FIXTURE_SCHEMA {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try { return verifyFixtureSchema(db); } finally { db.close(); }
}

/** Committed WAL pages are included; never instantiate the mutating FakeProvider. */
export function snapshotFixtureDatabase(source: Database.Database, destination: string): void {
  invariant(!source.inTransaction, "TRANSACTION_ACTIVE", "Snapshot reader must not have an open transaction");
  invariant(!existsSync(destination) && !existsSync(`${destination}-wal`) && !existsSync(`${destination}-shm`), "BACKUP_EXISTS", "Use a new snapshot destination");
  verifyFixtureSchema(source); prepareSnapshotDirectory(destination);
  const fd = openSync(destination, "wx", 0o600); closeSync(fd);
  try { source.prepare("VACUUM INTO ?").run(destination); verifyFixtureDatabase(destination); flushSnapshot(destination); }
  catch (error) { try { unlinkSync(destination); } catch { /* Only this operation's file. */ } throw error; }
}
