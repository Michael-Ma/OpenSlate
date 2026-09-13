import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, opendir, realpath, rename, rm, statfs } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonical, DomainError, invariant } from "@openslate/core";
import { verifySkillSnapshot } from "@openslate/director";
import { acquireInstallationOwner } from "./installation-owner.js";
import { snapshotDatabase, verifyDatabase } from "./database-snapshot.js";
import { verifySchema } from "./schema.js";
import { FIXTURE_SCHEMA, snapshotFixtureDatabase, verifyFixtureDatabase, verifyFixtureSchema } from "./fixture-database.js";
import { verifyBackupClosure } from "./installation-backup-closure.js";
import { assertInstallationRestoreComplete } from "./installation-restore-state.js";

export type BackupFileKind = "application_db" | "fixture_db" | "owned_media" | "owned_metadata";
export interface BackupFile { path: string; sha256: string; byteLength: number; kind: BackupFileKind; mode: number }
export interface InstallationBackupManifest {
  version: 1; backupId: string; createdAt: string; originalDataRoot: string;
  applicationSchemaVersion: number; fixtureSchema: typeof FIXTURE_SCHEMA; files: BackupFile[];
}
export interface VerifiedInstallationBackup { directory: string; manifest: InstallationBackupManifest; manifestSha256: string }
export interface InstallationBackupLimits { files: number; totalBytes: number; fileBytes: number; manifestBytes: number; depth: number; chunkBytes: number }
const GiB = 1024 ** 3;
export const INSTALLATION_BACKUP_LIMITS: Readonly<InstallationBackupLimits> = Object.freeze({ files: 100000, totalBytes: 256 * GiB,
  fileBytes: 8 * GiB, manifestBytes: 32 * 1024 ** 2, depth: 16, chunkBytes: 1024 ** 2 });
export const INSTALLATION_BACKUP_MANIFEST = "manifest.json";
const HASH = "[a-f0-9]{64}", ID = "[A-Za-z0-9][A-Za-z0-9_.-]{0,159}";
const SKILL = new RegExp(`^(?:skill-snapshots|native/${ID}/workspace/\\.agents/skills)/(${HASH})/(.+)$`);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const stopped = (signal?: AbortSignal) => invariant(!signal?.aborted, "BACKUP_CANCELLED", "Installation backup was cancelled");
const inside = (root: string, path: string) => { const sub = relative(root, path); return sub !== "" && sub !== ".." && !sub.startsWith(`..${sep}`) && !isAbsolute(sub); };
function limits(input?: Partial<InstallationBackupLimits>): InstallationBackupLimits {
  const result = { ...INSTALLATION_BACKUP_LIMITS, ...structuredClone(input ?? {}) };
  invariant(Object.keys(result).every(key => key in INSTALLATION_BACKUP_LIMITS), "BACKUP_LIMIT_INVALID", "Unknown backup limit");
  for (const key of Object.keys(INSTALLATION_BACKUP_LIMITS) as (keyof InstallationBackupLimits)[])
    invariant(Number.isSafeInteger(result[key]) && result[key] > 0 && result[key] <= INSTALLATION_BACKUP_LIMITS[key], "BACKUP_LIMIT_INVALID", "Backup limits must be positive and within supported bounds");
  return result;
}
function relativePath(path: string, bound: InstallationBackupLimits): void {
  invariant(typeof path === "string" && path.length > 0 && path.length <= 2048 && !path.includes("\\") && !path.includes("\0")
    && !isAbsolute(path) && path.split("/").every(part => part !== "" && part !== "." && part !== "..")
    && path.split("/").length <= bound.depth, "BACKUP_PATH_INVALID", "Invalid or over-deep backup path");
}
/** Explicit published names only. Transient files never become an import surface. */
export function installationBackupFileKind(path: string): BackupFileKind | null {
  if (path === "openslate.sqlite") return "application_db";
  if (path === "fake-provider.sqlite") return "fixture_db";
  if (new RegExp(`^artifacts/${ID}/${HASH}\\.(svg|wav|mp4|json)$`).test(path)
    || new RegExp(`^artifacts/images/blobs/${HASH}\\.png$`).test(path)
    || new RegExp(`^media/blobs/${HASH}\\.(source|wav|mp4)$`).test(path)
    || new RegExp(`^execution-output/blobs/${HASH}\\.blob$`).test(path)
    || new RegExp(`^(?:artifacts/${ID}/)?fixture-imports/(product-reference\\.svg|silent-narration-fixture\\.wav)$`).test(path)
    || new RegExp(`^native/${ID}/workspace/image-attachments/${HASH}/[0-3]-${HASH}\\.jpg$`).test(path)) return "owned_media";
  if (new RegExp(`^artifacts/local-timelines/documents/${HASH}\\.json$`).test(path)
    || new RegExp(`^media/(sources|manifests)/${HASH}\\.json$`).test(path)
    || new RegExp(`^media/completions/${HASH}-${HASH}\\.json$`).test(path)
    || path === "execution-output/identity.json"
    || new RegExp(`^execution-output/(manifests|slots)/${HASH}\\.json$`).test(path)
    || new RegExp(`^video-derivations/completions/${HASH}\\.json$`).test(path)) return "owned_metadata";
  const skill = SKILL.exec(path);
  if (skill && skill[2]!.split("/").every(part => /^(?:[A-Za-z0-9][A-Za-z0-9._-]*|\.openslate-snapshot\.json)$/.test(part))) return "owned_metadata";
  return null;
}
function packagePath(path: string): string | null { const match = SKILL.exec(path); return match ? path.slice(0, -match[2]!.length - 1) : null; }
async function directory(path: string): Promise<string> {
  const canonicalPath = await realpath(path), info = await lstat(canonicalPath);
  invariant(info.isDirectory() && canonicalPath !== "/", "BACKUP_PATH_INVALID", "Use an existing local data directory"); return canonicalPath;
}
async function checkedPath(root: string, path: string): Promise<void> {
  const absolute = join(root, path);
  invariant(inside(root, absolute) && await realpath(absolute) === absolute, "BACKUP_PATH_INVALID", "Backup paths cannot traverse symlinks");
}
async function syncDirectory(path: string): Promise<void> { const fd = await open(path, "r"); try { await fd.sync(); } finally { await fd.close(); } }
async function missing(path: string): Promise<boolean> { try { await lstat(path); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; } }

async function enumerate(root: string, bound: InstallationBackupLimits, signal: AbortSignal | undefined, strict: boolean, expectedFiles?: readonly string[]): Promise<string[]> {
  const result: string[] = []; let entries = 0;
  const expectedDirs = new Set<string>();
  for (const file of expectedFiles ?? []) for (let path = dirname(file); path !== "."; path = dirname(path)) expectedDirs.add(path);
  const walk = async (prefix: string): Promise<void> => {
    stopped(signal); relativePath(prefix, bound);
    if (await missing(join(root, prefix))) return;
    await checkedPath(root, prefix);
    const info = await lstat(join(root, prefix));
    invariant(info.isDirectory() || info.isFile(), "BACKUP_PATH_INVALID", "Backup entries must be regular files or directories");
    if (info.isFile()) {
      invariant(installationBackupFileKind(prefix) !== null, "BACKUP_PATH_INVALID", "Unrecognized published installation file");
      invariant(result.length < bound.files, "BACKUP_LIMIT_EXCEEDED", "Backup file count exceeds its limit"); result.push(prefix); return;
    }
    if (strict) invariant(expectedDirs.has(prefix), "BACKUP_INCOMPLETE", "Backup contains an unlisted directory");
    const stream = await opendir(join(root, prefix));
    for await (const item of stream) {
      invariant(++entries <= bound.files * 4 + 64, "BACKUP_LIMIT_EXCEEDED", "Backup directory entry count exceeds its limit");
      const path = `${prefix}/${item.name}`;
      if (!strict && (/^artifacts\/(?:images|local-timelines)\/tmp$/.test(path)
        || /^artifacts\/[^/]+\/(?:[^/]+\.partial|\.(?:media|narration)-[^/]+\.tmp)$/.test(path)
        || /^(?:skill-snapshots|native\/[^/]+\/workspace\/\.agents\/skills)\/\.[a-f0-9]{64}\.[^/]+\.tmp$/.test(path)
        || /^native\/[^/]+\/workspace\/image-attachments\/[a-f0-9]{64}\/prepare-[^/]+$/.test(path))) continue;
      await walk(path);
    }
  };
  if (strict) {
    const stream = await opendir(root);
    for await (const entry of stream) { if (entry.name !== INSTALLATION_BACKUP_MANIFEST) await walk(entry.name); }
  } else {
    for (const prefix of ["artifacts", "fixture-imports", "media/blobs", "media/sources", "media/manifests", "media/completions",
      "execution-output/identity.json", "execution-output/blobs", "execution-output/manifests", "execution-output/slots", "video-derivations/completions", "skill-snapshots"]) await walk(prefix);
    if (!(await missing(join(root, "native")))) {
      await checkedPath(root, "native"); const stream = await opendir(join(root, "native"));
      for await (const entry of stream) {
        invariant(++entries <= bound.files * 4 + 64, "BACKUP_LIMIT_EXCEEDED", "Backup directory entry count exceeds its limit");
        invariant(new RegExp(`^${ID}$`).test(entry.name) && entry.isDirectory(), "BACKUP_PATH_INVALID", "Invalid native project directory");
        for (const tail of [".agents/skills", "image-attachments"]) await walk(`native/${entry.name}/workspace/${tail}`);
      }
    }
  }
  return result.sort();
}

/** Exact bounded read and optional copy; owns both handles until cleanup settles. */
async function transfer(root: string, path: string, bound: InstallationBackupLimits, signal?: AbortSignal, output?: string, kind?: BackupFileKind): Promise<BackupFile> {
  stopped(signal); relativePath(path, bound); await checkedPath(root, path);
  const file = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let target: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await file.stat(); invariant(before.isFile() && before.size <= bound.fileBytes && (before.mode & 0o111) === 0,
      "BACKUP_LIMIT_EXCEEDED", "Backup files must be bounded non-executable regular files");
    const mode = before.mode & 0o666;
    invariant((mode & 0o400) !== 0, "BACKUP_PATH_INVALID", "Backup files must be owner-readable");
    if (output) { await mkdir(dirname(output), { recursive: true, mode: 0o700 }); target = await open(output, "wx", 0o600); }
    const sha = createHash("sha256"), buffer = Buffer.alloc(Math.min(bound.chunkBytes, Math.max(1, before.size))); let total = 0;
    for (;;) {
      stopped(signal); const { bytesRead } = await file.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
      total += bytesRead; invariant(total <= before.size && total <= bound.fileBytes, "BACKUP_FILE_CHANGED", "Backup source grew during copying");
      const chunk = buffer.subarray(0, bytesRead); sha.update(chunk); if (target) await target.writeFile(chunk);
    }
    const after = await file.stat();
    invariant(total === before.size && after.size === before.size && before.ino === after.ino && before.dev === after.dev
      && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "BACKUP_FILE_CHANGED", "Backup source changed during copying");
    await checkedPath(root, path); stopped(signal);
    if (target) { await target.chmod(mode); await target.sync(); }
    return { path, sha256: sha.digest("hex"), byteLength: total, mode, kind: kind ?? installationBackupFileKind(path)! };
  } finally { await target?.close(); await file.close(); }
}
async function readBounded(root: string, path: string, maximum: number, signal?: AbortSignal): Promise<Buffer> {
  stopped(signal); await checkedPath(root, path); const file = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat(); invariant(before.isFile() && before.size > 0 && before.size <= maximum, "BACKUP_LIMIT_EXCEEDED", "Backup metadata exceeds its bound");
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { stopped(signal); const result = await file.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
    const after = await file.stat(); invariant(offset === bytes.length && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs,
      "BACKUP_FILE_CHANGED", "Backup metadata changed while reading"); stopped(signal); return bytes;
  } finally { await file.close(); }
}

async function skillDirectories(root: string, files: readonly BackupFile[], makeReadOnly: boolean): Promise<void> {
  const packages = new Set<string>(), dirs = new Set<string>();
  for (const file of files) { const pkg = packagePath(file.path); if (!pkg) continue; packages.add(pkg);
    for (let path = dirname(file.path); path === pkg || path.startsWith(`${pkg}/`); path = dirname(path)) dirs.add(path);
  }
  if (makeReadOnly) for (const path of [...dirs].sort().reverse()) await chmod(join(root, path), 0o555);
  for (const pkg of packages) verifySkillSnapshot(join(root, dirname(pkg)), pkg.split("/").at(-1)!);
}
async function flushTree(root: string, files: readonly BackupFile[]): Promise<void> {
  const dirs = new Set<string>([root]);
  for (const file of files) for (let path = dirname(join(root, file.path)); inside(root, path); path = dirname(path)) dirs.add(path);
  for (const path of [...dirs].sort().reverse()) await syncDirectory(path);
}
async function discard(root: string): Promise<void> {
  // Snapshot package directories are immutable; only our new incomplete bundle is writable here.
  const walk = async (path: string): Promise<void> => { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) return;
    await chmod(path, 0o700); for await (const entry of await opendir(path)) if (entry.isDirectory()) await walk(join(path, entry.name)); };
  await walk(root); await rm(root, { recursive: true, force: true });
}
async function validateContent(root: string, manifest: InstallationBackupManifest, bound: InstallationBackupLimits, signal?: AbortSignal): Promise<void> {
  const files = new Map(manifest.files.map(file => [file.path, file]));
  invariant(files.has("openslate.sqlite") && files.has("fake-provider.sqlite"), "BACKUP_INCOMPLETE", "Both installation databases are required");
  invariant(verifyDatabase(join(root, "openslate.sqlite")) === manifest.applicationSchemaVersion, "BACKUP_SCHEMA_MISMATCH", "Application snapshot version differs from its manifest");
  verifyFixtureDatabase(join(root, "fake-provider.sqlite"));
  await skillDirectories(root, manifest.files, false);
  await verifyBackupClosure(root, manifest.originalDataRoot, files, path => readBounded(root, path, Math.min(bound.fileBytes, 16 * 1024 ** 2), signal));
  stopped(signal);
}

/** Offline only: acquires the real installation owner; it never starts or migrates services. */
export async function createInstallationBackup(options: { sourceRoot: string; destination: string; signal?: AbortSignal; limits?: Partial<InstallationBackupLimits> }): Promise<VerifiedInstallationBackup> {
  const signal = options.signal, bound = limits(options.limits), sourceInput = options.sourceRoot, destinationInput = options.destination;
  stopped(signal); const source = await directory(sourceInput);
  invariant(typeof destinationInput === "string" && isAbsolute(destinationInput), "BACKUP_PATH_INVALID", "Choose an absolute new backup destination");
  const destination = join(await directory(dirname(resolve(destinationInput))), resolve(destinationInput).split(sep).at(-1)!);
  invariant(destination !== source && !inside(source, destination) && !inside(destination, source), "BACKUP_PATH_INVALID", "Backup and installation directories must not overlap");
  invariant(await missing(destination), "BACKUP_EXISTS", "Backup destination already exists");
  for (const path of ["openslate.sqlite", "fake-provider.sqlite"]) { await checkedPath(source, path); invariant((await lstat(join(source, path))).isFile(), "BACKUP_PATH_INVALID", "Installation database must be a regular file"); }
  const owner = acquireInstallationOwner(source); let created = false, publishedManifest = false;
  let app: Database.Database | undefined, fixture: Database.Database | undefined;
  try {
    assertInstallationRestoreComplete(source);
    app = new Database(join(source, "openslate.sqlite"), { readonly: true, fileMustExist: true });
    fixture = new Database(join(source, "fake-provider.sqlite"), { readonly: true, fileMustExist: true });
    const applicationSchemaVersion = verifySchema(app, { integrity: true }); verifyFixtureSchema(fixture);
    const published = await enumerate(source, bound, signal, false); let expected = 0;
    const databaseBytes = new Map([["openslate.sqlite", app], ["fake-provider.sqlite", fixture]].map(([name, connection]) => {
      const reader = connection as Database.Database;
      return [name, Number(reader.pragma("page_count", { simple: true })) * Number(reader.pragma("page_size", { simple: true }))] as const;
    }));
    for (const path of ["openslate.sqlite", "fake-provider.sqlite", ...published]) { stopped(signal); const size = databaseBytes.get(path) ?? (await lstat(join(source, path))).size;
      invariant(Number.isSafeInteger(size) && size <= bound.fileBytes, "BACKUP_LIMIT_EXCEEDED", "An installation file exceeds the backup limit"); expected += size; }
    invariant(expected <= bound.totalBytes && published.length + 2 <= bound.files, "BACKUP_LIMIT_EXCEEDED", "Installation exceeds backup limits");
    const disk = await statfs(dirname(destination)); invariant(disk.bavail * disk.bsize >= expected + 16 * 1024 ** 2, "BACKUP_DISK_SPACE", "Insufficient free space for the installation backup");
    stopped(signal); await mkdir(destination, { mode: 0o700 }); created = true;
    snapshotDatabase(app, join(destination, "openslate.sqlite")); snapshotFixtureDatabase(fixture, join(destination, "fake-provider.sqlite"));
    const files: BackupFile[] = []; let total = 0;
    for (const path of ["openslate.sqlite", "fake-provider.sqlite", ...published]) {
      const database = path.endsWith(".sqlite"); const file = await transfer(database ? destination : source, path, bound, signal, database ? undefined : join(destination, path));
      total += file.byteLength; invariant(total <= bound.totalBytes, "BACKUP_LIMIT_EXCEEDED", "Backup exceeds its total byte limit"); files.push(file);
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const manifest: InstallationBackupManifest = { version: 1, backupId: randomUUID(), createdAt: new Date().toISOString(), originalDataRoot: source,
      applicationSchemaVersion, fixtureSchema: FIXTURE_SCHEMA, files };
    await skillDirectories(source, files, false); await skillDirectories(destination, files, true); await validateContent(destination, manifest, bound, signal);
    const bytes = Buffer.from(canonical(manifest)); invariant(bytes.length <= bound.manifestBytes, "BACKUP_LIMIT_EXCEEDED", "Backup manifest exceeds its limit");
    await flushTree(destination, files); stopped(signal);
    const temporaryManifest = join(destination, ".manifest.partial");
    const output = await open(temporaryManifest, "wx", 0o600);
    try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
    stopped(signal); await rename(temporaryManifest, join(destination, INSTALLATION_BACKUP_MANIFEST)); publishedManifest = true;
    // Publication is the completion boundary. A later cancellation cannot delete
    // a completed backup; a sync error leaves it available for explicit inspection.
    await syncDirectory(destination); await syncDirectory(dirname(destination));
    return { directory: destination, manifest, manifestSha256: hash(bytes) };
  } catch (error) { if (created && !publishedManifest) await discard(destination).catch(() => {}); throw error; }
  finally { fixture?.close(); app?.close(); owner.close(); }
}

/** Full read-only verification; no migrations, media processes, auth setup or network. */
export async function inspectInstallationBackup(options: { directory: string; expectedSourceRoot?: string; signal?: AbortSignal; limits?: Partial<InstallationBackupLimits> }): Promise<VerifiedInstallationBackup> {
  const signal = options.signal, bound = limits(options.limits), input = options.directory, expectedRoot = options.expectedSourceRoot;
  stopped(signal); const root = await directory(input), bytes = await readBounded(root, INSTALLATION_BACKUP_MANIFEST, bound.manifestBytes, signal);
  let manifest: InstallationBackupManifest;
  try { manifest = JSON.parse(bytes.toString("utf8")) as InstallationBackupManifest; } catch { throw new DomainError("BACKUP_MANIFEST_INVALID", "Backup manifest is invalid JSON"); }
  invariant(manifest?.version === 1 && /^[a-f0-9-]{36}$/.test(manifest.backupId) && typeof manifest.createdAt === "string"
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(manifest.createdAt) && Number.isFinite(Date.parse(manifest.createdAt))
    && typeof manifest.originalDataRoot === "string" && isAbsolute(manifest.originalDataRoot) && resolve(manifest.originalDataRoot) === manifest.originalDataRoot && manifest.originalDataRoot !== "/"
    && canonical(manifest.fixtureSchema) === canonical(FIXTURE_SCHEMA) && Array.isArray(manifest.files) && manifest.files.length <= bound.files
    && Object.keys(manifest).sort().join() === ["version", "backupId", "createdAt", "originalDataRoot", "applicationSchemaVersion", "fixtureSchema", "files"].sort().join()
    && canonical(manifest) === bytes.toString("utf8"), "BACKUP_MANIFEST_INVALID", "Unsupported or noncanonical backup manifest");
  if (expectedRoot !== undefined) invariant(resolve(expectedRoot) === manifest.originalDataRoot, "BACKUP_ROOT_MISMATCH", "This backup can only restore to its original local data directory");
  let total = 0, previous = "";
  for (const file of manifest.files) {
    invariant(file !== null && typeof file === "object" && !Array.isArray(file), "BACKUP_MANIFEST_INVALID", "Backup file entries must be objects");
    relativePath(file.path, bound);
    invariant(file.path > previous && Object.keys(file).sort().join() === ["path", "sha256", "byteLength", "kind", "mode"].sort().join()
      && file.kind === installationBackupFileKind(file.path) && file.kind !== null && /^[a-f0-9]{64}$/.test(file.sha256)
      && Number.isSafeInteger(file.byteLength) && file.byteLength >= 0 && file.byteLength <= bound.fileBytes
      && Number.isInteger(file.mode) && file.mode >= 0o400 && file.mode <= 0o666 && (file.mode & ~0o666) === 0 && (file.mode & 0o400) !== 0,
    "BACKUP_MANIFEST_INVALID", "Invalid, duplicate or unsorted backup file entry"); previous = file.path;
    total += file.byteLength; invariant(total <= bound.totalBytes, "BACKUP_LIMIT_EXCEEDED", "Backup exceeds its total byte limit");
    invariant(canonical(await transfer(root, file.path, bound, signal)) === canonical(file), "BACKUP_INTEGRITY_ERROR", "Backup file bytes or permissions differ from the manifest");
  }
  invariant(canonical(await enumerate(root, bound, signal, true, manifest.files.map(file => file.path))) === canonical(manifest.files.map(file => file.path)), "BACKUP_INCOMPLETE", "Backup contains missing or unlisted files");
  await validateContent(root, manifest, bound, signal);
  return { directory: root, manifest, manifestSha256: hash(bytes) };
}

/** Trusted shared IO for the offline restore writer; never model-selected paths. */
export const installationBackupIO = Object.freeze({ limits, directory, checkedPath, missing, transfer, readBounded, skillDirectories, flushTree, discard, syncDirectory, validateContent });
