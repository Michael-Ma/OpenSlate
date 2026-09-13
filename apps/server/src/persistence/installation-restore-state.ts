import Database from "better-sqlite3";
import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { assertRecoveryReceipt } from "./recovery-records.js";
import type { RecoveryReceipt } from "./recovery-records.js";
import type { BackupFile } from "./installation-backup.js";

export const INSTALLATION_RESTORE_STATE = "installation-restore.json";
export const RESTORE_STATE_MAX_BYTES = 32 * 1024 ** 2;
interface RestoreBase { version: 1; restoreId: string; backupId: string; backupManifestSha256: string; originalDataRoot: string; stageName: string }
export type InstallationRestoreState = RestoreBase & ({ state: "copying" } | { state: "publishing" | "complete"; files: BackupFile[]; receiptDigest: string });
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function parseInstallationRestoreState(bytes: Buffer, root: string): InstallationRestoreState {
  invariant(bytes.length > 0 && bytes.length <= RESTORE_STATE_MAX_BYTES, "RESTORE_STATE_INVALID", "Restore progress exceeds its bound");
  let input: unknown; try { input = JSON.parse(bytes.toString("utf8")); } catch { invariant(false, "RESTORE_STATE_INVALID", "Restore progress is invalid JSON"); }
  invariant(input !== null && typeof input === "object" && !Array.isArray(input), "RESTORE_STATE_INVALID", "Restore progress must be an object");
  const state = input as InstallationRestoreState;
  const fields = ["version", "restoreId", "backupId", "backupManifestSha256", "originalDataRoot", "stageName", "state", ...(state.state === "copying" ? [] : ["files", "receiptDigest"])];
  invariant(Object.keys(state).sort().join() === fields.sort().join() && canonical(state) === bytes.toString("utf8") && state.version === 1 && uuid(state.restoreId)
    && uuid(state.backupId) && hash(state.backupManifestSha256) && typeof state.originalDataRoot === "string" && isAbsolute(state.originalDataRoot)
    && resolve(state.originalDataRoot) === root && state.originalDataRoot === root && state.stageName === `.openslate-restore-${state.restoreId}`
    && ["copying", "publishing", "complete"].includes(state.state), "RESTORE_STATE_INVALID", "Restore progress identity is invalid");
  if (state.state !== "copying") {
    invariant(hash(state.receiptDigest) && Array.isArray(state.files) && state.files.length > 0 && state.files.length <= 100000, "RESTORE_STATE_INVALID", "Invalid restore publication inventory");
    let previous = "", total = 0;
    for (const file of state.files) {
      invariant(file && typeof file === "object" && !Array.isArray(file) && Object.keys(file).sort().join() === ["path", "sha256", "byteLength", "kind", "mode"].sort().join()
        && typeof file.path === "string" && file.path.length <= 2048 && file.path > previous && file.path.split("/").length <= 16
        && !file.path.includes("\\") && !file.path.includes("\0") && !isAbsolute(file.path) && file.path.split("/").every(part => part && part !== "." && part !== "..")
        && hash(file.sha256) && Number.isSafeInteger(file.byteLength) && file.byteLength >= 0 && file.byteLength <= 8 * 1024 ** 3
        && Number.isInteger(file.mode) && file.mode >= 0o400 && file.mode <= 0o666 && (file.mode & ~0o666) === 0
        && ["application_db", "fixture_db", "owned_media", "owned_metadata"].includes(file.kind), "RESTORE_STATE_INVALID", "Invalid restore publication file");
      previous = file.path; total += file.byteLength; invariant(total <= 256 * 1024 ** 3, "RESTORE_STATE_INVALID", "Restore publication exceeds its byte limit");
    }
  }
  return state;
}
export function readInstallationRestoreState(root: string): InstallationRestoreState | null {
  const path = join(root, INSTALLATION_RESTORE_STATE);
  if (!existsSync(path)) { invariant(!readdirSync(root).includes(INSTALLATION_RESTORE_STATE), "RESTORE_STATE_INVALID", "Restore progress cannot be a broken symlink");
    invariant(!readdirSync(root).some(name => name.startsWith(".openslate-restore-") || name.startsWith(".installation-restore-")),
    "RESTORE_INCOMPLETE", "An interrupted restore must be resumed before starting OpenSlate"); return null; }
  const before = lstatSync(path); invariant(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= RESTORE_STATE_MAX_BYTES,
    "RESTORE_STATE_INVALID", "Restore progress must be a bounded regular file");
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const count = readSync(file, bytes, offset, bytes.length - offset, offset); if (!count) break; offset += count; }
    const after = fstatSync(file); invariant(offset === bytes.length && before.size === after.size && before.ino === after.ino && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      "RESTORE_STATE_INVALID", "Restore progress changed during reading"); return parseInstallationRestoreState(bytes, root);
  } finally { closeSync(file); }
}
/** The marker can block startup, but only the database receipt proves restoration. */
export function restoredDatabaseReceipt(root: string, state: Exclude<InstallationRestoreState, { state: "copying" }>, databaseRoot = root): RecoveryReceipt {
  const path = join(databaseRoot, "openslate.sqlite");
  invariant(existsSync(path) && lstatSync(path).isFile() && realpathSync(path) === path, "RESTORE_STATE_INVALID", "Restored application database is missing or unsafe");
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT receipt FROM installation_recoveries ORDER BY generation DESC LIMIT 1").get() as { receipt: string } | undefined;
    invariant(row && Buffer.byteLength(row.receipt) <= 4 * 1024 ** 2, "RESTORE_STATE_INVALID", "Restore has no matching database receipt");
    const receipt = JSON.parse(row.receipt) as RecoveryReceipt; assertRecoveryReceipt(receipt);
    invariant(receipt.restoreId === state.restoreId && receipt.backupId === state.backupId && receipt.originalDataRoot === root
      && receipt.backupManifestSha256 === state.backupManifestSha256 && digest(receipt) === state.receiptDigest, "RESTORE_STATE_INVALID", "Restore progress differs from its database receipt");
    return receipt;
  } finally { db.close(); }
}
/** Call after acquiring the installation owner and before opening Store or credentials. */
export function assertInstallationRestoreComplete(directory: string): void {
  const root = realpathSync(directory), state = readInstallationRestoreState(root); if (!state) return;
  invariant(state.state === "complete", "RESTORE_INCOMPLETE", "Resume the interrupted restore before starting OpenSlate");
  restoredDatabaseReceipt(root, state);
}
