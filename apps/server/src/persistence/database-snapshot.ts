import Database from "better-sqlite3";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { invariant } from "@openslate/core";
import { verifySchema } from "./schema.js";

export function verifyDatabase(path: string): number {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try { return verifySchema(db, { integrity: true }); } finally { db.close(); }
}
function flushDirectory(path: string): void {
  const directory = openSync(path, "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
}
export function prepareSnapshotDirectory(path: string): void {
  const parent = dirname(resolve(path)), firstCreated = mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!firstCreated) return;
  // Persist newly created directory entries too, including their link from the
  // first existing parent, before relying on a snapshot during schema changes.
  const existingParent = dirname(firstCreated);
  for (let current = parent; ; current = dirname(current)) {
    flushDirectory(current); if (current === existingParent) break;
  }
}
export function flushSnapshot(path: string): void {
  const file = openSync(path, "r"); try { fsyncSync(file); } finally { closeSync(file); }
  flushDirectory(dirname(resolve(path)));
}

/** SQLite snapshot includes committed WAL pages. It never copies only the main file. */
export function snapshotDatabase(source: Database.Database, destination: string): void {
  invariant(!source.inTransaction, "TRANSACTION_ACTIVE", "Snapshot reader must not have an open transaction");
  invariant(typeof destination === "string" && destination.length > 0 && destination.trim() === destination && destination !== ":memory:",
    "DATABASE_PATH_INVALID", "Use a new database file destination");
  invariant(!existsSync(destination) && !existsSync(`${destination}-wal`) && !existsSync(`${destination}-shm`), "BACKUP_EXISTS", "Use a new backup destination");
  verifySchema(source, { integrity: true });
  prepareSnapshotDirectory(destination);
  // VACUUM INTO accepts an empty file; exclusive creation claims this destination
  // and ensures private permissions before any application data is written.
  const fd = openSync(destination, "wx", 0o600); closeSync(fd);
  try {
    source.prepare("VACUUM INTO ?").run(destination);
    verifyDatabase(destination); flushSnapshot(destination);
  } catch (error) {
    try { unlinkSync(destination); } catch { /* Preserve the original snapshot error. */ }
    throw error;
  }
}
