import Database from "better-sqlite3";
import { closeSync, constants, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { DomainError, invariant } from "@openslate/core";

/** One running launcher per local data directory, using an OS-released SQLite lock. */
export function acquireInstallationOwner(directory: string): { close(): void } {
  mkdirSync(resolve(directory), { recursive: true, mode: 0o700 });
  const path = join(realpathSync(directory), "installation-owner.sqlite");
  // Never unlink this file: replacing its inode would let two processes own different locks.
  try { closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stat = lstatSync(path);
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, "INSTALLATION_LOCK_INVALID", "The local installation lock must be a regular private file");
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { timeout: 0 });
    db.pragma("journal_mode = DELETE");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db?.close();
    const code = (error as { code?: string }).code;
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED")
      throw new DomainError("INSTALLATION_IN_USE", "Another OpenSlate process is using this local data directory. Stop it before starting again.");
    throw new DomainError("INSTALLATION_LOCK_FAILED", "OpenSlate could not acquire its local installation lock");
  }
  const owned = db;
  let closed = false;
  return { close() { if (closed) return; owned.close(); closed = true; } };
}
