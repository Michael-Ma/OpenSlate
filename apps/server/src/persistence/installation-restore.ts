import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, opendir, readdir, rename, rmdir, statfs, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { installRecoveryQuarantine } from "../application/installation-recovery.js";
import type { RecoveryReceipt } from "../application/installation-recovery.js";
import { Store } from "./store.js";
import { acquireInstallationOwner } from "./installation-owner.js";
import { verifyDatabase } from "./database-snapshot.js";
import { CURRENT_SCHEMA_VERSION } from "./schema.js";
import { inspectInstallationBackup, installationBackupFileKind, installationBackupIO as io } from "./installation-backup.js";
import type { BackupFile, InstallationBackupLimits, InstallationBackupManifest, VerifiedInstallationBackup } from "./installation-backup.js";
import { INSTALLATION_RESTORE_STATE, RESTORE_STATE_MAX_BYTES, parseInstallationRestoreState, readInstallationRestoreState, restoredDatabaseReceipt } from "./installation-restore-state.js";
import type { InstallationRestoreState } from "./installation-restore-state.js";

export interface RestoreProgress { phase: "copying" | "copied_file" | "publishing" | "published_namespace" | "complete"; completed: number; total: number }
export interface RestoredInstallation { directory: string; status: "restored" | "already_restored"; receipt: RecoveryReceipt }
const MIGRATION = /^openslate\.sqlite\.migration-backups\/v[1-9][0-9]*-to-v[1-9][0-9]*-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.sqlite$/;
const OWNER = "installation-owner.sqlite";
const OWNER_FILES = [OWNER, `${OWNER}-journal`];
const stopped = (signal?: AbortSignal) => invariant(!signal?.aborted, "BACKUP_CANCELLED", "Installation restore was cancelled; run the same restore to resume");
const part = (state: InstallationRestoreState) => `.installation-restore-${state.restoreId}.partial`;
const top = (path: string) => path.split("/")[0]!;
const inside = (root: string, path: string) => { const sub = relative(root, path); return sub !== "" && sub !== ".." && !sub.startsWith(`..${sep}`) && !isAbsolute(sub); };

async function saveState(root: string, state: InstallationRestoreState): Promise<void> {
  const bytes = Buffer.from(canonical(state)); parseInstallationRestoreState(bytes, root);
  invariant(bytes.length <= RESTORE_STATE_MAX_BYTES, "RESTORE_STATE_INVALID", "Restore progress exceeds its bound");
  const temporary = join(root, part(state));
  if (!(await io.missing(temporary))) { await io.checkedPath(root, part(state)); const stat = await lstat(temporary);
    invariant(stat.isFile() && stat.size <= RESTORE_STATE_MAX_BYTES, "RESTORE_STATE_INVALID", "Unsafe interrupted progress write"); await unlink(temporary); }
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await rename(temporary, join(root, INSTALLATION_RESTORE_STATE)); await io.syncDirectory(root);
}
async function rootInventory(root: string, state: InstallationRestoreState): Promise<void> {
  const allowed = new Set([...OWNER_FILES, INSTALLATION_RESTORE_STATE, state.stageName, part(state), ...(state.state === "copying" ? [] : state.files.map(file => top(file.path)))]);
  for (const name of await readdir(root)) {
    invariant(allowed.has(name), "RESTORE_DESTINATION_EXISTS", "Restore destination contains unrelated installation data");
    await io.checkedPath(root, name); const stat = await lstat(join(root, name));
    invariant(stat.isDirectory() || stat.isFile(), "RESTORE_STATE_INVALID", "Restore destination contains a special file");
  }
}
async function resumeInitialProgress(root: string, backup: VerifiedInstallationBackup): Promise<void> {
  if (!(await io.missing(join(root, INSTALLATION_RESTORE_STATE)))) return;
  const entries = (await readdir(root)).filter(name => !OWNER_FILES.includes(name));
  if (entries.length !== 1 || !/^\.installation-restore-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.partial$/.test(entries[0]!)) return;
  // Before the very first marker rename no staging or published data exists.
  // Only in that empty state may an interrupted, torn initial write be discarded.
  const name = entries[0]!; await io.checkedPath(root, name); const file = await open(join(root, name), "r"); let bytes: Buffer;
  try { const stat = await file.stat(); invariant(stat.isFile() && stat.size <= RESTORE_STATE_MAX_BYTES, "RESTORE_STATE_INVALID", "Unsafe initial restore progress");
    bytes = Buffer.alloc(stat.size); let offset = 0; while (offset < bytes.length) { const next = await file.read(bytes, offset, bytes.length - offset, offset); if (!next.bytesRead) break; offset += next.bytesRead; }
    invariant(offset === bytes.length, "RESTORE_STATE_INVALID", "Initial progress changed while reading");
  } finally { await file.close(); }
  let completeJson = true; try { JSON.parse(bytes.toString("utf8")); } catch { completeJson = false; }
  if (!completeJson) { await unlink(join(root, name)); await io.syncDirectory(root); return; }
  const state = parseInstallationRestoreState(bytes, root);
  invariant(state.state === "copying" && name === part(state) && state.backupId === backup.manifest.backupId && state.backupManifestSha256 === backup.manifestSha256,
    "RESTORE_STATE_INVALID", "Initial progress belongs to another restore");
  await rename(join(root, name), join(root, INSTALLATION_RESTORE_STATE)); await io.syncDirectory(root);
}
/** Validate before deleting only the exact operation-owned incomplete staging subtree. */
async function validateStagingTree(root: string, stageName: string, bound: InstallationBackupLimits): Promise<void> {
  if (await io.missing(join(root, stageName))) return;
  let count = 0, total = 0;
  const walk = async (path: string, depth: number): Promise<void> => {
    invariant(depth <= bound.depth + 2 && ++count <= bound.files * 4 + 64, "RESTORE_STATE_INVALID", "Interrupted staging exceeds its bounds");
    await io.checkedPath(root, path); const stat = await lstat(join(root, path));
    invariant(stat.isDirectory() || stat.isFile(), "RESTORE_STATE_INVALID", "Interrupted staging contains a special file");
    if (stat.isFile()) { total += stat.size; invariant(stat.size <= bound.fileBytes && total <= bound.totalBytes * 2, "RESTORE_STATE_INVALID", "Interrupted staging exceeds its byte limits"); }
    else for await (const entry of await opendir(join(root, path))) await walk(`${path}/${entry.name}`, depth + 1);
  };
  await walk(stageName, 0);
}
function verifyPublicationInventory(state: Exclude<InstallationRestoreState, { state: "copying" }>, backup: VerifiedInstallationBackup, bound: InstallationBackupLimits): void {
  const source = new Map(backup.manifest.files.map(file => [file.path, file])); let total = 0;
  invariant(state.files.length <= bound.files, "BACKUP_LIMIT_EXCEEDED", "Restored installation exceeds the file limit");
  for (const file of state.files) {
    const original = source.get(file.path);
    invariant(file.path.split("/").length <= bound.depth && file.byteLength <= bound.fileBytes, "BACKUP_LIMIT_EXCEEDED", "Restored file exceeds its bounds");
    total += file.byteLength;
    if (original) {
      invariant(file.path === "openslate.sqlite" ? file.kind === original.kind && file.mode === original.mode : canonical(file) === canonical(original),
        "RESTORE_STATE_INVALID", "Restored content differs from the exact backup"); source.delete(file.path);
    } else invariant(MIGRATION.test(file.path) && file.kind === "application_db" && file.mode === 0o600, "RESTORE_STATE_INVALID", "Unrecognized migration diagnostic");
  }
  invariant(source.size === 0 && total <= bound.totalBytes, "RESTORE_STATE_INVALID", "Restore publication omits source files or exceeds its limit");
}
async function verifyExisting(root: string, state: Exclude<InstallationRestoreState, { state: "copying" }>, bound: InstallationBackupLimits, signal?: AbortSignal): Promise<void> {
  const stage = join(root, state.stageName), namespaces = new Set(state.files.map(file => top(file.path)));
  const locations = new Map<string, string>();
  for (const name of namespaces) {
    const published = !(await io.missing(join(root, name))), staged = !(await io.missing(join(stage, name)));
    invariant(published !== staged, "RESTORE_STATE_INVALID", "A restore namespace is missing or exists in two places"); locations.set(name, published ? root : stage);
  }
  const expected = new Map<string, Set<string>>(), expectedDirectories = new Map<string, Set<string>>();
  for (const file of state.files) {
    stopped(signal); const location = locations.get(top(file.path))!;
    invariant(canonical(await io.transfer(location, file.path, bound, signal, undefined, file.kind)) === canonical(file), "BACKUP_INTEGRITY_ERROR", "Interrupted restore bytes or modes changed");
    const set = expected.get(location) ?? new Set<string>(); set.add(file.path); expected.set(location, set);
    const directories = expectedDirectories.get(location) ?? new Set<string>();
    for (let path = dirname(file.path); path !== "."; path = dirname(path)) directories.add(path);
    expectedDirectories.set(location, directories);
    if (MIGRATION.test(file.path)) verifyDatabase(join(location, file.path));
  }
  // Reject extras inside every owned namespace before any additional publication.
  const walk = async (location: string, path: string): Promise<void> => {
    await io.checkedPath(location, path); const stat = await lstat(join(location, path));
    if (stat.isDirectory()) {
      invariant(expectedDirectories.get(location)?.has(path), "RESTORE_STATE_INVALID", "Unexpected directory in interrupted restore");
      for await (const entry of await opendir(join(location, path))) await walk(location, `${path}/${entry.name}`);
    } else invariant(stat.isFile() && expected.get(location)?.has(path), "RESTORE_STATE_INVALID", "Unlisted file in interrupted restore");
  };
  for (const [name, location] of locations) await walk(location, name);
  if (!(await io.missing(stage))) for (const name of await readdir(stage)) invariant(namespaces.has(name) && locations.get(name) === stage,
    "RESTORE_STATE_INVALID", "Unlisted staged restore namespace");
  for (const location of new Set(locations.values())) await io.skillDirectories(location, state.files.filter(file => locations.get(top(file.path)) === location), false);
  const databaseRoot = locations.get("openslate.sqlite")!;
  invariant(verifyDatabase(join(databaseRoot, "openslate.sqlite")) === CURRENT_SCHEMA_VERSION, "RESTORE_STATE_INVALID", "Restored database is not at the supported schema");
  restoredDatabaseReceipt(root, state, databaseRoot);
}

/** Same-root, offline restore. A crash resumes only from this exact verified bundle. */
export async function restoreInstallationBackup(options: { directory: string; destination: string; signal?: AbortSignal; limits?: Partial<InstallationBackupLimits>; onProgress?: (progress: RestoreProgress) => void }): Promise<RestoredInstallation> {
  const signal = options.signal, bound = io.limits(options.limits), onProgress = options.onProgress, input = options.directory, destination = options.destination;
  invariant(typeof destination === "string" && isAbsolute(destination), "BACKUP_PATH_INVALID", "Restore requires the original absolute data directory");
  const backup = await inspectInstallationBackup({ directory: input, expectedSourceRoot: resolve(destination), ...(signal ? { signal } : {}), limits: bound });
  const root = join(await io.directory(dirname(resolve(destination))), resolve(destination).split(sep).at(-1)!);
  invariant(root === backup.manifest.originalDataRoot && root !== backup.directory && !inside(root, backup.directory) && !inside(backup.directory, root),
    "BACKUP_ROOT_MISMATCH", "Restore must use the original canonical data directory outside the backup");
  if (await io.missing(root)) await mkdir(root, { mode: 0o700 });
  invariant(await io.directory(root) === root, "BACKUP_ROOT_MISMATCH", "Restore destination cannot be an alias");
  const owner = acquireInstallationOwner(root); let state: InstallationRestoreState | null = null;
  try {
    await resumeInitialProgress(root, backup);
    state = readInstallationRestoreState(root);
    if (state) {
      invariant(state.backupId === backup.manifest.backupId && state.backupManifestSha256 === backup.manifestSha256, "RESTORE_STATE_INVALID", "Resume requires the exact original backup bundle");
      if (state.state === "complete") { stopped(signal); return { directory: root, status: "already_restored", receipt: restoredDatabaseReceipt(root, state) }; }
      await rootInventory(root, state);
    } else {
      invariant((await readdir(root)).every(name => OWNER_FILES.includes(name)), "RESTORE_DESTINATION_EXISTS", "Restore never overwrites or merges existing installation data");
      const restoreId = randomUUID();
      state = { version: 1, restoreId, backupId: backup.manifest.backupId, backupManifestSha256: backup.manifestSha256, originalDataRoot: root, stageName: `.openslate-restore-${restoreId}`, state: "copying" };
      await saveState(root, state);
    }
    const stage = join(root, state.stageName);
    if (state.state === "copying") {
      await validateStagingTree(root, state.stageName, bound); if (!(await io.missing(stage))) await io.discard(stage);
      const disk = await statfs(root), bytes = backup.manifest.files.reduce((sum, file) => sum + file.byteLength, 0);
      invariant(disk.bavail * disk.bsize >= bytes * 2 + 16 * 1024 ** 2, "BACKUP_DISK_SPACE", "Insufficient space to stage and migrate the restore");
      stopped(signal); await mkdir(stage, { mode: 0o700 }); onProgress?.({ phase: "copying", completed: 0, total: backup.manifest.files.length });
      let count = 0;
      for (const file of backup.manifest.files) {
        invariant(canonical(await io.transfer(backup.directory, file.path, bound, signal, join(stage, file.path))) === canonical(file), "BACKUP_INTEGRITY_ERROR", "Backup changed while staging restoration");
        onProgress?.({ phase: "copied_file", completed: ++count, total: backup.manifest.files.length });
      }
      await io.skillDirectories(stage, backup.manifest.files, true); await io.validateContent(stage, backup.manifest, bound, signal); stopped(signal);
      const store = new Store(join(stage, "openslate.sqlite")); let receipt: RecoveryReceipt;
      try {
        receipt = installRecoveryQuarantine(store, { restoreId: state.restoreId, backupId: backup.manifest.backupId, backupManifestSha256: backup.manifestSha256,
          sourceDatabaseSha256: backup.manifest.files.find(file => file.path === "openslate.sqlite")!.sha256, originalDataRoot: root,
          backupCreatedAt: backup.manifest.createdAt, restoredAt: new Date().toISOString() });
        const checkpoint = store.db.pragma("wal_checkpoint(TRUNCATE)") as { busy: number }[];
        invariant(checkpoint.every(row => row.busy === 0), "RESTORE_STATE_INVALID", "Staged database checkpoint is busy");
        // The offline staged DB is exclusively owned. Publish a self-contained
        // main file; read-only verification must not recreate WAL/SHM sidecars.
        invariant(store.db.pragma("journal_mode=DELETE", { simple: true }) === "delete", "RESTORE_STATE_INVALID", "Staged database could not leave WAL mode");
      } finally { store.close(); }
      const files: BackupFile[] = [];
      for (const file of backup.manifest.files) files.push(await io.transfer(stage, file.path, bound, signal));
      const diagnostics = "openslate.sqlite.migration-backups";
      if (!(await io.missing(join(stage, diagnostics)))) for (const name of await readdir(join(stage, diagnostics))) {
        const path = `${diagnostics}/${name}`; invariant(MIGRATION.test(path), "RESTORE_STATE_INVALID", "Unexpected staged migration file");
        verifyDatabase(join(stage, path)); files.push(await io.transfer(stage, path, bound, signal, undefined, "application_db"));
      }
      files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      state = { ...state, state: "publishing", files, receiptDigest: digest(receipt!) };
      verifyPublicationInventory(state, backup, bound); await io.flushTree(stage, files); await saveState(root, state);
      onProgress?.({ phase: "publishing", completed: 0, total: new Set(files.map(file => top(file.path))).size });
    }
    invariant(state.state === "publishing", "RESTORE_STATE_INVALID", "Unexpected restore phase");
    verifyPublicationInventory(state, backup, bound); await rootInventory(root, state); await verifyExisting(root, state, bound, signal);
    const namespaces = [...new Set(state.files.map(file => top(file.path)))].sort(); let count = 0;
    for (const name of namespaces) {
      stopped(signal);
      if (await io.missing(join(root, name))) {
        await io.checkedPath(stage, name); await rename(join(stage, name), join(root, name)); await io.syncDirectory(stage); await io.syncDirectory(root);
      }
      onProgress?.({ phase: "published_namespace", completed: ++count, total: namespaces.length });
    }
    await verifyExisting(root, state, bound, signal);
    const currentManifest: InstallationBackupManifest = { ...backup.manifest, applicationSchemaVersion: CURRENT_SCHEMA_VERSION,
      files: state.files.filter(file => !MIGRATION.test(file.path)) };
    await io.validateContent(root, currentManifest, bound, signal); await io.flushTree(root, state.files); stopped(signal);
    if (!(await io.missing(stage))) await rmdir(stage);
    state = { ...state, state: "complete" }; await saveState(root, state); await io.syncDirectory(dirname(root));
    const receipt = restoredDatabaseReceipt(root, state); onProgress?.({ phase: "complete", completed: namespaces.length, total: namespaces.length }); stopped(signal);
    return { directory: root, status: "restored", receipt };
  } finally { owner.close(); }
}
