import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { invariant } from "@openslate/core";

interface SchemaObject { type: "table" | "index"; name: string; sql: string }
const table = (name: string, columns: string): SchemaObject => ({ type: "table", name, sql: `CREATE TABLE IF NOT EXISTS ${name} (${columns});` });
const index = (name: string, definition: string, unique = false): SchemaObject => ({ type: "index", name, sql: `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${name} ${definition};` });

/** Historical V1 definitions. Do not edit shipped migrations; add the next version. */
export const V1_SCHEMA: readonly Readonly<SchemaObject>[] = Object.freeze([
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
].map(value => Object.freeze(value)));
const V2_SCHEMA: readonly Readonly<SchemaObject>[] = Object.freeze([
  table("schema_migrations", `version INTEGER PRIMARY KEY CHECK(version > 0), name TEXT NOT NULL,
    checksum TEXT NOT NULL CHECK(length(checksum)=64), applied_at TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('applied','adopted'))`),
  index("execution_evidence_attempt", "ON entities(project_id,json_extract(body,'$.attemptId')) WHERE kind='execution_evidence'"),
].map(value => Object.freeze(value)));
const V3_SCHEMA: readonly Readonly<SchemaObject>[] = Object.freeze([
  table("installation_recoveries", `generation INTEGER PRIMARY KEY CHECK(generation > 0), restore_id TEXT NOT NULL UNIQUE,
    receipt TEXT NOT NULL CHECK(json_valid(receipt)), release_receipt TEXT CHECK(release_receipt IS NULL OR json_valid(release_receipt))`),
  index("installation_recovery_fence_lookup", "ON entities(project_id,json_extract(body,'$.kind'),json_extract(body,'$.recordId')) WHERE kind='installation_recovery_fence'"),
].map(value => Object.freeze(value)));
const migration = (version: number, name: string, sql: string) => Object.freeze({ version, name, sql,
  checksum: createHash("sha256").update(JSON.stringify({ version, name, sql })).digest("hex") });
export const MIGRATIONS = Object.freeze([
  migration(1, "initial_local_schema", V1_SCHEMA.map(object => object.sql).join("\n")),
  // V1 acquired indexes over time without a version bump. Upgrade restores all
  // known indexes transactionally; incompatible duplicate data is not rewritten.
  migration(2, "migration_ledger_and_evidence_lookup", [...V1_SCHEMA.filter(object => object.type === "index"), ...V2_SCHEMA].map(object => object.sql).join("\n")),
  migration(3, "installation_recovery_quarantine", V3_SCHEMA.map(object => object.sql).join("\n")),
]);
export const CURRENT_SCHEMA_VERSION = 3;
export interface MigrationLedgerRow { version: number; name: string; checksum: string; applied_at: string; mode: "applied" | "adopted" }
const sqlIdentity = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\b/gi, "").replace(/\s+/g, " ").replace(/\s*([(),;])\s*/g, "$1").replace(/;$/, "").trim();

/** Read-only compatibility validation; safe before setting persistent PRAGMAs. */
export function verifySchema(db: Database.Database, options: { allowEmpty?: boolean; integrity?: boolean } = {}): number {
  const version = db.pragma("user_version", { simple: true }) as number;
  invariant(Number.isSafeInteger(version) && version >= 0 && version <= CURRENT_SCHEMA_VERSION,
    "DATABASE_VERSION_UNSUPPORTED", "Database requires an unsupported OpenSlate schema version");
  const objects = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all() as SchemaObject[];
  if (version === 0) {
    invariant(options.allowEmpty && objects.length === 0, "DATABASE_SCHEMA_MISMATCH", "Only an empty database can initialize without a schema version");
    return 0;
  }
  const expected = new Map([...V1_SCHEMA, ...(version >= 2 ? V2_SCHEMA : []), ...(version >= 3 ? V3_SCHEMA : [])].map(object => [object.name, object]));
  for (const object of objects) {
    const known = expected.get(object.name);
    invariant(known && known.type === object.type && typeof object.sql === "string" && sqlIdentity(known.sql) === sqlIdentity(object.sql),
      "DATABASE_SCHEMA_MISMATCH", "Database contains an unrecognized schema definition");
    expected.delete(object.name);
  }
  invariant([...expected.values()].every(object => version === 1 && object.type === "index"),
    "DATABASE_SCHEMA_MISMATCH", "Database is missing a required schema definition");
  if (version >= 2) {
    const rows = db.prepare("SELECT version,name,checksum,applied_at,mode FROM schema_migrations ORDER BY version").all() as MigrationLedgerRow[];
    invariant(rows.length === version, "DATABASE_MIGRATION_MISMATCH", "Database migration history is incomplete");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!, known = MIGRATIONS[i]!;
      invariant(row.version === known.version && row.name === known.name && row.checksum === known.checksum
        && (row.mode === "applied" || (row.version === 1 && row.mode === "adopted"))
        && typeof row.applied_at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.applied_at) && Number.isFinite(Date.parse(row.applied_at)),
      "DATABASE_MIGRATION_MISMATCH", "Database migration checksum or history differs from this OpenSlate version");
    }
  }
  if (options.integrity) {
    invariant(db.pragma("integrity_check", { simple: true }) === "ok", "DATABASE_CORRUPT", "SQLite integrity check failed");
    invariant((db.pragma("foreign_key_check") as unknown[]).length === 0, "DATABASE_CORRUPT", "SQLite reference check failed");
  }
  return version;
}
