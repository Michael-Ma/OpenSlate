import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { invariant } from "@openslate/core";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, verifySchema } from "./schema.js";
import type { MigrationLedgerRow } from "./schema.js";
import { snapshotDatabase } from "./database-snapshot.js";

/** Upgrade only schema objects/ledger; never parse or rewrite domain JSON. */
export function initializeDatabase(db: Database.Database, path: string): void {
  invariant(!db.inTransaction, "TRANSACTION_ACTIVE", "Database initialization requires a new connection");
  const observed = verifySchema(db, { allowEmpty: true });
  if (observed === CURRENT_SCHEMA_VERSION) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    // Another connection can finish migration while this connection waits for the
    // writer reservation. Never snapshot or apply from the earlier observation.
    const startingVersion = verifySchema(db, { allowEmpty: true, integrity: true });
    if (startingVersion === CURRENT_SCHEMA_VERSION) { db.exec("COMMIT"); return; }
    if (startingVersion > 0 && path !== ":memory:") {
      const absolute = resolve(path), directory = join(dirname(absolute), `${basename(absolute)}.migration-backups`);
      const destination = join(directory, `v${startingVersion}-to-v${CURRENT_SCHEMA_VERSION}-${randomUUID()}.sqlite`);
      const reader = new Database(absolute, { readonly: true, fileMustExist: true });
      try { snapshotDatabase(reader, destination); } finally { reader.close(); }
    }
    const time = new Date().toISOString(), pending: MigrationLedgerRow[] = [];
    if (startingVersion === 1) {
      const baseline = MIGRATIONS[0]!;
      pending.push({ version: 1, name: baseline.name, checksum: baseline.checksum, applied_at: time, mode: "adopted" });
    }
    for (const migration of MIGRATIONS.filter(migration => migration.version > startingVersion)) {
      db.exec(migration.sql);
      pending.push({ version: migration.version, name: migration.name, checksum: migration.checksum, applied_at: time, mode: "applied" });
      if (migration.version >= 2) {
        const insert = db.prepare("INSERT INTO schema_migrations(version,name,checksum,applied_at,mode) VALUES(@version,@name,@checksum,@applied_at,@mode)");
        for (const row of pending.splice(0)) insert.run(row);
      }
      db.pragma(`user_version=${migration.version}`);
    }
    verifySchema(db, { integrity: true });
    db.exec("COMMIT");
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
