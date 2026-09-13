import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { canonical, digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { DirectorSupervisor } from "../dist/application/director-supervisor.js";
import { InstallationRecoveryGuard, releaseRecovery } from "../dist/application/installation-recovery.js";
import { createInstallationBackup, inspectInstallationBackup } from "../dist/persistence/installation-backup.js";
import { restoreInstallationBackup } from "../dist/persistence/installation-restore.js";
import { assertInstallationRestoreComplete, INSTALLATION_RESTORE_STATE } from "../dist/persistence/installation-restore-state.js";
import { acquireInstallationOwner } from "../dist/persistence/installation-owner.js";
import { seedFixture } from "../dist/demo.js";
import { installationCommand } from "../dist/installation-cli.js";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function cleanup(path) { if (!existsSync(path)) return; const info = lstatSync(path); if (info.isDirectory()) {
  chmodSync(path, 0o700); for (const name of readdirSync(path)) cleanup(join(path, name)); } rmSync(path, { recursive: true, force: true }); }
async function fixture(t, { legacy = false } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "openslate-restore-"))), source = join(dir, "installation"), backup = join(dir, "backup"), archive = join(dir, "original");
  mkdirSync(source); t.after(() => cleanup(dir)); let projectId, requestId, turnId, originalTurn;
  if (legacy) {
    const db = new Database(join(source, "openslate.sqlite")); db.exec(readFileSync(new URL("schema-v1.sql.fixture", import.meta.url), "utf8")); db.pragma("user_version=1"); db.close();
    new FakeProvider(join(source, "fake-provider.sqlite")).close();
  } else {
    const store = new Store(join(source, "openslate.sqlite")), fake = new FakeProvider(join(source, "fake-provider.sqlite")), engine = new Engine(store, fake, { artifactDir: join(source, "artifacts") });
    const service = new ProductionService(store, engine), project = service.createProject("Restored browser demo"); projectId = project.id;
    seedFixture(service, join(engine.artifactDir, project.id), project.id);
    const actor = service.beginRequest(projectId, "human", "Original private conversation"); requestId = actor.requestId;
    const bridge = service.openEpoch(projectId, actor);
    const supervisor = new DirectorSupervisor(service, { id: "offline-fixture", start() { throw Error("A restore must never start a runtime"); } }, { mode: "native" });
    const turn = supervisor.enqueue(projectId, actor); turnId = turn.id;
    store.put("director_turn", turn.id, projectId, { ...turn, state: "running", owner: "previous-owner", leaseExpiresAt: Date.now() + 100000,
      epochId: bridge.actor.epochId, nativeThreadId: "saved-native-thread", nativeTurnId: "saved-native-turn", dispatched: true });
    originalTurn = store.db.prepare("SELECT body FROM entities WHERE kind='director_turn' AND id=?").get(turn.id).body;
    await supervisor.close(); store.close(); fake.close();
  }
  writeFileSync(join(source, "local-session.token"), "synthetic-old-token-do-not-copy");
  const verified = await createInstallationBackup({ sourceRoot: source, destination: backup }); renameSync(source, archive);
  return { dir, source, backup, archive, verified, projectId, requestId, turnId, originalTurn,
    restore: options => restoreInstallationBackup({ directory: backup, destination: source, ...options }) };
}
function state(f) { return JSON.parse(readFileSync(join(f.source, INSTALLATION_RESTORE_STATE), "utf8")); }
function crash(f, phase) {
  const url = new URL("../dist/persistence/installation-restore.js", import.meta.url).href;
  const code = `import {restoreInstallationBackup} from ${JSON.stringify(url)};
    await restoreInstallationBackup({directory:process.argv[1],destination:process.argv[2],onProgress(p){if(p.phase===process.argv[3]&&(p.phase!=='published_namespace'||p.completed===1))process.kill(process.pid,'SIGKILL')}});`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, f.backup, f.source, phase], { stdio: ["ignore", "pipe", "pipe"] }); let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(Error("restore interruption fixture timed out")); }, 10000);
    child.stderr.on("data", bytes => { stderr += bytes; }); child.once("error", reject);
    child.once("close", (code, signal) => { clearTimeout(timer); if (signal !== "SIGKILL") reject(Error(`Expected interrupted restore, got ${code}: ${stderr}`)); else resolve(); });
  });
}

test("same-root restore preserves media/history, creates durable quarantine and never copies the old token", async t => {
  const f = await fixture(t), result = await f.restore(); assert.equal(result.status, "restored"); assert.equal(result.receipt.backupCreatedAt, f.verified.manifest.createdAt);
  assert.equal(result.receipt.sourceDatabaseSha256, f.verified.manifest.files.find(file => file.path === "openslate.sqlite").sha256);
  assert.equal(existsSync(join(f.source, "local-session.token")), false); assert.doesNotThrow(() => assertInstallationRestoreComplete(f.source));
  const store = new Store(join(f.source, "openslate.sqlite"));
  try {
    const guard = new InstallationRecoveryGuard(store); assert.equal(guard.snapshot().state, "quarantined");
    assert.equal(store.get("execution_control", f.projectId).paused, true); assert.equal(guard.isImported(f.projectId, "message", f.requestId), true);
    const turn = store.get("director_turn", f.turnId); assert.equal(turn.state, "unknown"); assert.equal(turn.nativeThreadId, "saved-native-thread");
    assert.equal(store.list("installation_recovery_fence", f.projectId).find(row => row.recordId === f.turnId).originalBody, f.originalTurn);
    for (const artifact of store.list("artifact", f.projectId)) assert.equal(sha(readFileSync(artifact.path)), artifact.artifact.sha256);
    const view = guard.snapshot(); releaseRecovery(store, { restoreId: view.receipt.restoreId, expectedReceiptDigest: view.receiptDigest, expectedSummaryDigest: view.summaryDigest }, { principalId: "human", commandId: "release" });
    assert.equal(store.get("execution_control", f.projectId).paused, true);
  } finally { store.close(); }
  assert.doesNotThrow(() => assertInstallationRestoreComplete(f.source));
  assert.equal((await f.restore()).status, "already_restored");
  assert.deepEqual(await inspectInstallationBackup({ directory: f.backup }), f.verified);
  const exportedAgain = await createInstallationBackup({ sourceRoot: f.source, destination: join(f.dir, "restored-backup") });
  assert.equal(exportedAgain.manifest.files.some(file => file.path === INSTALLATION_RESTORE_STATE), false);
  const saved = new Database(join(exportedAgain.directory, "openslate.sqlite"), { readonly: true });
  try { assert.equal(saved.prepare("SELECT count(*) n FROM installation_recoveries").get().n, 1); } finally { saved.close(); }
  await inspectInstallationBackup({ directory: exportedAgain.directory });
});

test("migration runs only in staged restore and its verified original snapshot remains available", async t => {
  const f = await fixture(t, { legacy: true }), before = sha(readFileSync(join(f.backup, "openslate.sqlite")));
  await f.restore(); assert.equal(sha(readFileSync(join(f.backup, "openslate.sqlite"))), before);
  const backups = readdirSync(join(f.source, "openslate.sqlite.migration-backups")); assert.equal(backups.length, 1);
  const db = new Database(join(f.source, "openslate.sqlite.migration-backups", backups[0]), { readonly: true });
  try { assert.equal(db.pragma("user_version", { simple: true }), 1); } finally { db.close(); }
  assert.doesNotThrow(() => assertInstallationRestoreComplete(f.source));
});

test("restore refuses a running or populated destination and retains its existing owner inode", async t => {
  const f = await fixture(t); mkdirSync(f.source); const owner = acquireInstallationOwner(f.source), inode = statSync(join(f.source, "installation-owner.sqlite")).ino;
  await assert.rejects(f.restore(), { code: "INSTALLATION_IN_USE" }); owner.close();
  writeFileSync(join(f.source, "unrelated"), "keep"); await assert.rejects(f.restore(), { code: "RESTORE_DESTINATION_EXISTS" });
  assert.equal(readFileSync(join(f.source, "unrelated"), "utf8"), "keep"); unlinkSync(join(f.source, "unrelated"));
  await f.restore(); assert.equal(statSync(join(f.source, "installation-owner.sqlite")).ino, inode);
});

test("actual process death while copying remains startup-blocked and resets only its exact staging tree", async t => {
  const f = await fixture(t); await crash(f, "copied_file"); const progress = state(f), inode = statSync(join(f.source, "installation-owner.sqlite")).ino;
  assert.equal(progress.state, "copying"); assert.throws(() => assertInstallationRestoreComplete(f.source), { code: "RESTORE_INCOMPLETE" });
  assert.equal(existsSync(join(f.source, "openslate.sqlite")), false); await f.restore();
  assert.equal(statSync(join(f.source, "installation-owner.sqlite")).ino, inode); assert.doesNotThrow(() => assertInstallationRestoreComplete(f.source));
});

test("actual process death during namespace publication resumes without replacing published files", async t => {
  const f = await fixture(t); await crash(f, "published_namespace"); const progress = state(f); assert.equal(progress.state, "publishing");
  assert.throws(() => assertInstallationRestoreComplete(f.source), { code: "RESTORE_INCOMPLETE" });
  const names = [...new Set(progress.files.map(file => file.path.split("/")[0]))].filter(name => existsSync(join(f.source, name)));
  assert.equal(names.length, 1); const inodes = names.map(name => [name, statSync(join(f.source, name)).ino]);
  await f.restore(); for (const [name, inode] of inodes) assert.equal(statSync(join(f.source, name)).ino, inode);
  assert.doesNotThrow(() => assertInstallationRestoreComplete(f.source));
});

test("changed published bytes and a different bundle cannot be adopted by an interrupted restore", async t => {
  const f = await fixture(t); await crash(f, "published_namespace"); const progress = state(f), file = progress.files.find(file => existsSync(join(f.source, file.path)));
  const path = join(f.source, file.path), bytes = readFileSync(path); chmodSync(path, 0o600); writeFileSync(path, Buffer.alloc(bytes.length, 3));
  await assert.rejects(f.restore(), { code: "BACKUP_INTEGRITY_ERROR" }); assert.deepEqual(readFileSync(path), Buffer.alloc(bytes.length, 3));
  writeFileSync(path, bytes); chmodSync(path, file.mode);
  const manifestPath = join(f.backup, "manifest.json"), manifestBytes = readFileSync(manifestPath), manifest = JSON.parse(manifestBytes);
  writeFileSync(manifestPath, canonical({ ...manifest, backupId: randomUUID() }));
  await assert.rejects(f.restore(), { code: "RESTORE_STATE_INVALID" }); writeFileSync(manifestPath, manifestBytes); await f.restore();
});

test("unsafe staging and malformed markers fail closed without deleting the unexpected data", async t => {
  const f = await fixture(t); await crash(f, "copied_file"); const progress = state(f), outside = join(f.dir, "outside"); writeFileSync(outside, "keep");
  symlinkSync(outside, join(f.source, progress.stageName, "unsafe")); await assert.rejects(f.restore(), { code: "BACKUP_PATH_INVALID" });
  assert.equal(readFileSync(outside, "utf8"), "keep"); unlinkSync(join(f.source, progress.stageName, "unsafe"));
  const marker = join(f.source, INSTALLATION_RESTORE_STATE), original = readFileSync(marker); writeFileSync(marker, canonical({ ...progress, stageName: "../outside" }));
  assert.throws(() => assertInstallationRestoreComplete(f.source), { code: "RESTORE_STATE_INVALID" }); await assert.rejects(f.restore(), { code: "RESTORE_STATE_INVALID" });
  writeFileSync(marker, original); await f.restore();
});

test("cancellation retains original signal and complete publication survives late cancellation for exact retry", async t => {
  const f = await fixture(t), controller = new AbortController();
  const options = { directory: f.backup, destination: f.source, signal: controller.signal, onProgress(progress) { if (progress.phase === "copied_file") controller.abort(); } };
  const running = restoreInstallationBackup(options); options.signal = new AbortController().signal;
  await assert.rejects(running, { code: "BACKUP_CANCELLED" }); assert.throws(() => assertInstallationRestoreComplete(f.source), { code: "RESTORE_INCOMPLETE" });
  const late = new AbortController(); await assert.rejects(f.restore({ signal: late.signal, onProgress(progress) { if (progress.phase === "complete") late.abort(); } }), { code: "BACKUP_CANCELLED" });
  assert.equal(state(f).state, "complete"); assert.doesNotThrow(() => assertInstallationRestoreComplete(f.source)); assert.equal((await f.restore()).status, "already_restored");
});

test("orphan initial progress recovers only in the empty destination while startup always blocks", async t => {
  for (const torn of [false, true]) {
    const f = await fixture(t); mkdirSync(f.source); const restoreId = randomUUID();
    const initial = { version: 1, restoreId, backupId: f.verified.manifest.backupId, backupManifestSha256: f.verified.manifestSha256,
      originalDataRoot: f.source, stageName: `.openslate-restore-${restoreId}`, state: "copying" };
    writeFileSync(join(f.source, `.installation-restore-${restoreId}.partial`), torn ? '{"version":' : canonical(initial));
    assert.throws(() => assertInstallationRestoreComplete(f.source), { code: "RESTORE_INCOMPLETE" }); await f.restore();
    assert.doesNotThrow(() => assertInstallationRestoreComplete(f.source));
  }
});

test("CLI uses explicit paths and reports verified/restored results without starting application services", async t => {
  const f = await fixture(t); const inspect = await installationCommand(["inspect", "--backup", f.backup]); assert.equal(inspect.status, "verified");
  await assert.rejects(installationCommand(["restore", "--backup", f.backup, "--data-dir", join(f.dir, "wrong")]), { code: "BACKUP_ROOT_MISMATCH" });
  const result = await promisify(execFile)(process.execPath, [resolve(new URL("../dist/installation-cli.js", import.meta.url).pathname), "restore", "--backup", f.backup, "--data-dir", f.source], { timeout: 10000 });
  assert.equal(JSON.parse(result.stdout).status, "restored"); assert.equal(existsSync(join(f.source, "local-session.token")), false);
  assert.equal(readdirSync(f.source).some(name => name === "native" || name === "uploads"), false);
});
