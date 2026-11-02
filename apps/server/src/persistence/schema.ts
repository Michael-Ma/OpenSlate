import type Database from "better-sqlite3";
import { invariant } from "@openslate/core";

interface SchemaObject { type: "table" | "index"; name: string; sql: string }
const table = (name: string, columns: string): SchemaObject => ({ type: "table", name, sql: `CREATE TABLE IF NOT EXISTS ${name} (${columns});` });
const index = (name: string, definition: string, unique = false): SchemaObject => ({ type: "index", name, sql: `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${name} ${definition};` });

/** Current schema, created once in an empty database. */
export const SCHEMA: readonly Readonly<SchemaObject>[] = Object.freeze([
  table("projects", `id TEXT PRIMARY KEY, head_version INTEGER NOT NULL CHECK(head_version >= 0),
    body TEXT NOT NULL CHECK(json_valid(body)), event_sequence INTEGER NOT NULL DEFAULT 0`),
  table("entities", `kind TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
    body TEXT NOT NULL CHECK(json_valid(body)), version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(kind,id)`),
  index("entity_project", "ON entities(project_id,kind)"),
  index("candidate_grant_once", "ON entities(json_extract(body,'$.grantId')) WHERE kind='candidate'", true),
  index("attempt_ordinal_once", "ON entities(json_extract(body,'$.candidateId'), json_extract(body,'$.ordinal')) WHERE kind='attempt'", true),
  index("local_work_once", "ON entities(json_extract(body,'$.workKey')) WHERE kind='attempt' AND json_extract(body,'$.candidateId') IS NULL", true),
  index("reservation_attempt_once", "ON entities(json_extract(body,'$.attemptId')) WHERE kind='reservation'", true),
  index("director_request_once", "ON entities(project_id,json_extract(body,'$.requestId')) WHERE kind='director_turn'", true),
  index("director_running_once", "ON entities(project_id) WHERE kind='director_turn' AND json_extract(body,'$.state')='running'", true),
  table("commands", `actor_scope TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
    result TEXT NOT NULL CHECK(json_valid(result)), PRIMARY KEY(actor_scope,key)`),
  table("events", `project_id TEXT NOT NULL REFERENCES projects(id), sequence INTEGER NOT NULL,
    id TEXT NOT NULL UNIQUE, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(project_id,sequence)`),
  index("execution_evidence_attempt", "ON entities(project_id,json_extract(body,'$.attemptId')) WHERE kind='execution_evidence'"),
  table("installation_recoveries", `generation INTEGER PRIMARY KEY CHECK(generation > 0), restore_id TEXT NOT NULL UNIQUE,
    receipt TEXT NOT NULL CHECK(json_valid(receipt)), release_receipt TEXT CHECK(release_receipt IS NULL OR json_valid(release_receipt))`),
  index("installation_recovery_fence_lookup", "ON entities(project_id,json_extract(body,'$.kind'),json_extract(body,'$.recordId')) WHERE kind='installation_recovery_fence'"),
].map(value => Object.freeze(value)));
export const CURRENT_SCHEMA_VERSION = 4;
const sqlIdentity = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\b/gi, "").replace(/\s+/g, " ").replace(/\s*([(),;])\s*/g, "$1").replace(/;$/, "").trim();

/** Read-only schema validation; safe before setting persistent PRAGMAs. */
export function verifySchema(db: Database.Database, options: { allowEmpty?: boolean; integrity?: boolean } = {}): number {
  const verify = () => verifySchemaSnapshot(db, options);
  // Version and objects must describe the same snapshot during concurrent creation.
  return db.inTransaction ? verify() : db.transaction(verify)();
}
function verifySchemaSnapshot(db: Database.Database, options: { allowEmpty?: boolean; integrity?: boolean }): number {
  const version = db.pragma("user_version", { simple: true }) as number;
  invariant(version === 0 || version === CURRENT_SCHEMA_VERSION,
    "DATABASE_VERSION_UNSUPPORTED", "This database was created by an earlier OpenSlate prototype and cannot be opened. Start with a new OPENSLATE_DATA_DIR.");
  const objects = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all() as SchemaObject[];
  if (version === 0) {
    invariant(options.allowEmpty && objects.length === 0, "DATABASE_SCHEMA_MISMATCH", "Only an empty database can initialize without a schema version");
    return 0;
  }
  const expected = new Map(SCHEMA.map(object => [object.name, object]));
  for (const object of objects) {
    const known = expected.get(object.name);
    invariant(known && known.type === object.type && typeof object.sql === "string" && sqlIdentity(known.sql) === sqlIdentity(object.sql),
      "DATABASE_SCHEMA_MISMATCH", "Database contains an unrecognized schema definition");
    expected.delete(object.name);
  }
  invariant(expected.size === 0,
    "DATABASE_SCHEMA_MISMATCH", "Database is missing a required schema definition");
  if (options.integrity) {
    invariant(db.pragma("integrity_check", { simple: true }) === "ok", "DATABASE_CORRUPT", "SQLite integrity check failed");
    invariant((db.pragma("foreign_key_check") as unknown[]).length === 0, "DATABASE_CORRUPT", "SQLite reference check failed");
  }
  return version;
}

export function initializeDatabase(db: Database.Database): void {
  invariant(!db.inTransaction, "TRANSACTION_ACTIVE", "Database initialization requires a new connection");
  if (verifySchema(db, { allowEmpty: true }) === CURRENT_SCHEMA_VERSION) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    // Another connection may have created the schema while this writer waited.
    if (verifySchema(db, { allowEmpty: true }) === 0) {
      for (const object of SCHEMA) db.exec(object.sql);
      db.pragma(`user_version=${CURRENT_SCHEMA_VERSION}`);
      verifySchema(db, { integrity: true });
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
