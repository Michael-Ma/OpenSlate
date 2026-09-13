import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { canonical, digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { verifySkillSnapshot } from "@openslate/director";
import { Store } from "../dist/persistence/store.js";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "../dist/persistence/schema.js";
import { createInstallationBackup, inspectInstallationBackup } from "../dist/persistence/installation-backup.js";
import { verifyFixtureDatabase } from "../dist/persistence/fixture-database.js";
import { acquireInstallationOwner } from "../dist/persistence/installation-owner.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { videoArtifactId, videoDerivationId } from "../dist/execution/video-derivation.js";
import { createDirectorSkillLock } from "../dist/application/director-capabilities.js";
import { runDemo, seedFixture } from "../dist/demo.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { projectFixture } from "./execution-fixture.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function cleanup(path) { if (!existsSync(path)) return; const info = lstatSync(path); if (info.isDirectory()) {
  chmodSync(path, 0o700); for (const name of readdirSync(path)) cleanup(join(path, name)); }
  rmSync(path, { recursive: true, force: true }); }
function root(t) { const dir = realpathSync(mkdtempSync(join(tmpdir(), "openslate-backup-"))); t.after(() => cleanup(dir)); return dir; }
function fixture(t) {
  const dir = root(t), source = join(dir, "installation"), destination = join(dir, "backup"); mkdirSync(source);
  const store = new Store(join(source, "openslate.sqlite")), fake = new FakeProvider(join(source, "fake-provider.sqlite"));
  const project = projectFixture(); store.createProject(project);
  const close = () => { if (store.db.open) store.close(); if (fake.db.open) fake.close(); }; t.after(close);
  return { dir, source, destination, store, fake, project, close, backup: () => createInstallationBackup({ sourceRoot: source, destination }) };
}
function write(root, path, bytes, mode = 0o600) { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes, { mode }); return file; }
const savedRows = db => Object.fromEntries(["projects", "entities", "events", "commands"].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
function mediaFixture(f, { artifactId = randomUUID() } = {}) {
  const original = Buffer.from("original synthetic media"), normalized = Buffer.from("normalized synthetic media"), rendered = Buffer.from("rendered synthetic media");
  const body = { artifactId, kind: "video", originalSha256: sha(original), originalByteLength: original.length,
    sha256: sha(normalized), byteLength: normalized.length, probe: { durationSeconds: 1, video: { streamIndex: 0, width: 160, height: 90, frames: 30, frameRate: "30/1", durationSeconds: 1, codec: "h264" } }, toolchainDigest: "a".repeat(64) };
  const source = { id: digest(body), ...body };
  write(f.source, `media/blobs/${source.originalSha256}.source`, original); write(f.source, `media/blobs/${source.sha256}.mp4`, normalized);
  write(f.source, `media/sources/${source.id}.json`, canonical(source));
  const recipe = { version: 1, projectId: f.project.id, targetRevisionId: f.project.revisionId, width: 160, height: 90, frameRate: { numerator: 30, denominator: 1 }, sampleRate: 48000, totalFrames: 30,
    clips: [{ source, startFrame: 0, durationFrames: 30, fit: "contain" }], audio: [], toolchainDigest: body.toolchainDigest };
  const manifest = { digest: digest(recipe), ...recipe }; write(f.source, `media/manifests/${manifest.digest}.json`, canonical(manifest));
  const artifact = { id: randomUUID(), manifestDigest: manifest.digest, sha256: sha(rendered), byteLength: rendered.length,
    path: write(f.source, `media/blobs/${sha(rendered)}.mp4`, rendered), probe: body.probe };
  const completionPath = `media/completions/${manifest.digest}-${artifact.sha256}.json`;
  write(f.source, completionPath, canonical({ manifest, artifact }));
  return { source, manifest, artifact, completionPath };
}

test("offline export snapshots committed WAL in both databases and preserves private JSON history", async t => {
  const f = fixture(t);
  f.store.db.pragma("wal_autocheckpoint=0"); f.fake.db.pragma("wal_autocheckpoint=0");
  f.store.db.prepare("INSERT INTO entities VALUES(?,?,?,?,?)").run("historic", "receipt", f.project.id, '{ "value" : "exact bytes", "locator":"https://private.invalid/result?signed=synthetic" }', 1);
  f.store.appendEvent(f.project.id, "saved", {}); f.store.command("human", "old", "digest", () => ({ saved: true }));
  await f.fake.submit({ attemptId: "synthetic", nodeId: "node", kind: "image", fingerprint: "a".repeat(64) });
  assert.ok(existsSync(join(f.source, "openslate.sqlite-wal"))); assert.ok(existsSync(join(f.source, "fake-provider.sqlite-wal")));
  const rows = savedRows(f.store.db), mainHash = sha(readFileSync(join(f.source, "openslate.sqlite")));
  const result = await f.backup(); assert.equal(result.manifest.applicationSchemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(result.manifest.fixtureSchema, { tag: 1, userVersion: 0 });
  const app = new Database(join(f.destination, "openslate.sqlite"), { readonly: true }), fake = new Database(join(f.destination, "fake-provider.sqlite"), { readonly: true });
  try { assert.deepEqual(savedRows(app), rows); assert.equal(fake.prepare("SELECT count(*) n FROM fake_jobs").get().n, 1); }
  finally { app.close(); fake.close(); }
  assert.equal(sha(readFileSync(join(f.source, "openslate.sqlite"))), mainHash);
  assert.deepEqual(await inspectInstallationBackup({ directory: f.destination, expectedSourceRoot: f.source }), result);
  assert.equal(statSync(f.destination).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.destination, "openslate.sqlite")).mode & 0o777, 0o600);
  assert.equal(result.manifest.files.some(file => /(?:-wal|-shm|installation-owner)/.test(file.path)), false);
});

test("historical V1 and missing later indexes remain V1 without a migration or source rewrite", async t => {
  const dir = root(t), source = join(dir, "installation"), destination = join(dir, "backup"); mkdirSync(source);
  const path = join(source, "openslate.sqlite"), db = new Database(path);
  db.exec(readFileSync(new URL("schema-v1.sql.fixture", import.meta.url), "utf8")); db.pragma("user_version=1"); db.exec("DROP INDEX director_request_once; DROP INDEX director_running_once"); db.close();
  new FakeProvider(join(source, "fake-provider.sqlite")).close(); const before = sha(readFileSync(path));
  const result = await createInstallationBackup({ sourceRoot: source, destination }); assert.equal(result.manifest.applicationSchemaVersion, 1);
  assert.equal(sha(readFileSync(path)), before); assert.equal(existsSync(`${path}.migration-backups`), false);
  assert.equal((await inspectInstallationBackup({ directory: destination })).manifest.applicationSchemaVersion, 1);
});

test("owned artifact/demo files and fake execution remain usable after complete namespace copying", async t => {
  const dir = root(t), source = join(dir, "installation"), destination = join(dir, "backup");
  const demo = await runDemo(source), result = await createInstallationBackup({ sourceRoot: source, destination });
  assert.ok(result.manifest.files.some(file => file.path === "fixture-imports/product-reference.svg"));
  assert.ok(result.manifest.files.some(file => file.path === "fixture-imports/silent-narration-fixture.wav"));
  assert.deepEqual(readFileSync(join(destination, demo.previewPath.slice(source.length + 1))), readFileSync(demo.previewPath));
  await inspectInstallationBackup({ directory: destination });
});

test("published render/source completions survive without SQL publication and temporary/private roots stay out", async t => {
  const f = fixture(t), media = mediaFixture(f);
  for (const path of ["local-session.token", "uploads/private.wav", "media/tmp/job-x/private.wav", "execution-output/tmp/unfinished",
    "video-derivations/tmp/unfinished", "openslate.sqlite.migration-backups/old.sqlite", `native/${f.project.id}/runtime/native-state/auth.json`,
    `native/${f.project.id}/runtime/logs/session.log`, `native/${f.project.id}/workspace/arbitrary.txt`, "artifacts/images/tmp/validate-x/private.png"])
    write(f.source, path, "private data must be excluded");
  const result = await f.backup();
  assert.ok(result.manifest.files.some(file => file.path === media.completionPath));
  assert.ok(result.manifest.files.some(file => file.path.endsWith(".source")));
  assert.equal(result.manifest.files.some(file => /private|runtime|uploads|tmp|migration-backups|token|arbitrary/.test(file.path)), false);
  await inspectInstallationBackup({ directory: f.destination });
});

test("filesystem-only winning spool keeps original storage identity, locator and unknown liability", async t => {
  const f = fixture(t), request = { kind: "video", attemptId: "attempt", nodeId: "node" }, bytes = Buffer.from("synthetic raw MP4 storage fixture");
  f.store.insert("attempt", "attempt", f.project.id, { candidateId: null, workKey: "fixture", ordinal: 1, request, phase: "submission_unknown", taskId: null });
  f.store.insert("reservation", "reserved", f.project.id, { attemptId: "attempt", micros: "100000", state: "reserved" });
  const output = new ExecutionOutputStore(f.store, { rootDir: join(f.source, "execution-output") });
  const receipt = output.recordReceipt(f.project.id, { attemptId: "attempt", expectedRequestDigest: digest(request), port: "video", kind: "video", mimeType: "video/mp4",
    vendorTaskId: "known-task", diagnosticRequestId: null, source: { kind: "protected_locator", locator: "https://private.invalid/synthetic?secret=preserved", expiresAt: null } });
  const put = f.store.put.bind(f.store); f.store.put = (kind, ...args) => { if (kind === "execution_output_spool") throw Error("injected SQL publication crash"); return put(kind, ...args); };
  await assert.rejects(output.spool(f.project.id, receipt.id, async function* () { yield bytes; }), /publication crash/); f.store.put = put;
  assert.equal(f.store.get("execution_output_spool", receipt.id), undefined);
  const before = savedRows(f.store.db), result = await f.backup();
  assert.ok(result.manifest.files.some(file => file.path === `execution-output/manifests/${receipt.id}.json`));
  assert.deepEqual(readFileSync(join(f.destination, "execution-output/identity.json")), readFileSync(join(f.source, "execution-output/identity.json")));
  await inspectInstallationBackup({ directory: f.destination }); assert.deepEqual(savedRows(f.store.db), before);
});

test("locked skills and request thumbnails copy exact bytes and reconstruct immutable skill directory modes", async t => {
  const f = fixture(t), root = join(f.source, "skill-snapshots"), nativeRoot = join(f.source, "native", f.project.id, "workspace", ".agents", "skills");
  const repositoryRoot = resolve(new URL("../../..", import.meta.url).pathname);
  const { lock } = createDirectorSkillLock({ repositoryRoot, snapshotRoot: root });
  createDirectorSkillLock({ repositoryRoot, snapshotRoot: nativeRoot });
  f.store.insert("director_skill_lock", lock.id, f.project.id, { lock });
  const jpg = Buffer.from("synthetic thumbnail storage fixture"), thumbnailPath = `native/${f.project.id}/workspace/image-attachments/${digest({ requestId: "fixture" })}/0-${sha(jpg)}.jpg`;
  write(f.source, thumbnailPath, jpg, 0o444);
  const result = await f.backup();
  for (const pin of lock.skills) {
    const verified = verifySkillSnapshot(join(f.destination, "skill-snapshots"), pin.packageDigest); assert.equal(verified.id, pin.id);
    assert.equal(statSync(verified.immutableRoot).mode & 0o777, 0o555); assert.equal(statSync(verified.entryPath).mode & 0o777, 0o444);
  }
  assert.ok(result.manifest.files.some(file => file.path === thumbnailPath)); await inspectInstallationBackup({ directory: f.destination });
});

test("export owns the real installation lock through asynchronous copying; cancellation cleans only its incomplete bundle", async t => {
  const f = fixture(t), bytes = Buffer.alloc(4 * 1024 ** 2, 7); write(f.source, `artifacts/${f.project.id}/${sha(bytes)}.mp4`, bytes);
  const owner = acquireInstallationOwner(f.source);
  await assert.rejects(f.backup(), { code: "INSTALLATION_IN_USE" }); assert.equal(existsSync(f.destination), false); owner.close();
  const controller = new AbortController(), options = { sourceRoot: f.source, destination: f.destination, signal: controller.signal, limits: { chunkBytes: 1024 } };
  const running = createInstallationBackup(options); options.signal = new AbortController().signal;
  const deadline = Date.now() + 5000;
  while (!existsSync(join(f.destination, "openslate.sqlite"))) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.throws(() => acquireInstallationOwner(f.source), { code: "INSTALLATION_IN_USE" });
  controller.abort(); await assert.rejects(running, { code: "BACKUP_CANCELLED" }); assert.equal(existsSync(f.destination), false);
  const next = acquireInstallationOwner(f.source); next.close(); assert.ok(existsSync(join(f.source, "openslate.sqlite")));
});

test("existing destinations, source overlap, parent aliases and wrong recovery roots never overwrite data", async t => {
  const f = fixture(t); await f.backup(); const manifest = readFileSync(join(f.destination, "manifest.json"));
  await assert.rejects(f.backup(), { code: "BACKUP_EXISTS" }); assert.deepEqual(readFileSync(join(f.destination, "manifest.json")), manifest);
  await assert.rejects(createInstallationBackup({ sourceRoot: f.source, destination: join(f.source, "backup") }), { code: "BACKUP_PATH_INVALID" });
  symlinkSync(f.source, join(f.dir, "alias"));
  await assert.rejects(createInstallationBackup({ sourceRoot: f.source, destination: join(f.dir, "alias", "backup") }), { code: "BACKUP_PATH_INVALID" });
  await assert.rejects(inspectInstallationBackup({ directory: f.destination, expectedSourceRoot: join(f.dir, "other") }), { code: "BACKUP_ROOT_MISMATCH" });
});

test("missing or corrupt owned artifacts and metadata closures fail rather than silently omit history", async t => {
  const f = fixture(t), bytes = Buffer.from("owned"), path = write(f.source, `artifacts/${f.project.id}/${sha(bytes)}.mp4`, bytes);
  f.store.insert("artifact", "owned", f.project.id, { artifact: { artifactId: "owned", sha256: sha(bytes), kind: "video" }, path, byteLength: bytes.length });
  unlinkSync(path); await assert.rejects(f.backup(), { code: "BACKUP_REFERENCE_INVALID" }); assert.equal(existsSync(f.destination), false);
  writeFileSync(path, "wrong"); await assert.rejects(f.backup(), { code: "BACKUP_REFERENCE_INVALID" });
  writeFileSync(path, bytes); const media = mediaFixture(f); unlinkSync(join(f.source, `media/blobs/${media.source.originalSha256}.source`));
  await assert.rejects(f.backup(), { code: "BACKUP_REFERENCE_INVALID" });
});

test("schema/checksum incompatibility is rejected before creating a bundle or mutating the source", async t => {
  for (const problem of ["newer", "checksum", "fixture"]) {
    const f = fixture(t); f.close(); const path = join(f.source, problem === "fixture" ? "fake-provider.sqlite" : "openslate.sqlite"), db = new Database(path);
    if (problem === "newer") db.pragma("user_version=999");
    else if (problem === "checksum") db.exec("UPDATE schema_migrations SET checksum='" + "0".repeat(64) + "' WHERE version=1");
    else db.exec("CREATE TABLE unexpected(value TEXT)"); db.close(); const before = sha(readFileSync(path));
    await assert.rejects(f.backup(), { code: problem === "newer" ? "DATABASE_VERSION_UNSUPPORTED" : problem === "checksum" ? "DATABASE_MIGRATION_MISMATCH" : "FIXTURE_DATABASE_SCHEMA_MISMATCH" });
    assert.equal(sha(readFileSync(path)), before); assert.equal(existsSync(f.destination), false);
  }
});

test("bounded file/count/manifest budgets and original pre-abort fail without completed publication", async t => {
  const f = fixture(t);
  for (const limits of [{ files: 1 }, { fileBytes: 1 }, { totalBytes: 1 }, { manifestBytes: 1 }]) {
    await assert.rejects(createInstallationBackup({ sourceRoot: f.source, destination: f.destination, limits }), { code: "BACKUP_LIMIT_EXCEEDED" }); assert.equal(existsSync(f.destination), false);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createInstallationBackup({ sourceRoot: f.source, destination: f.destination, signal: controller.signal }), { code: "BACKUP_CANCELLED" });
});

test("symlinks, FIFOs and undeclared published files are rejected without reading them", async t => {
  for (const kind of ["symlink", "fifo", "unknown"]) {
    const f = fixture(t), relative = `artifacts/${f.project.id}/${"a".repeat(64)}.mp4`, path = join(f.source, relative); mkdirSync(dirname(path), { recursive: true });
    if (kind === "symlink") symlinkSync(join(f.source, "openslate.sqlite"), path);
    else if (kind === "fifo") execFileSync("mkfifo", [path]); else writeFileSync(join(dirname(path), "secret.txt"), "not published media");
    await assert.rejects(f.backup(), { code: "BACKUP_PATH_INVALID" }); assert.equal(existsSync(f.destination), false);
  }
});

test("inspection catches byte changes, unlisted files/directories and malformed duplicate/traversal manifests", async t => {
  const f = fixture(t); await f.backup(); const manifestPath = join(f.destination, "manifest.json"), original = readFileSync(manifestPath), manifest = JSON.parse(original);
  const writeManifest = value => writeFileSync(manifestPath, canonical(value));
  for (const mutate of [m => m.files.push(m.files[0]), m => { m.files[0].path = "../outside.sqlite"; }, m => { m.version = 2; }]) {
    const value = structuredClone(manifest); mutate(value); writeManifest(value); await assert.rejects(inspectInstallationBackup({ directory: f.destination }));
  }
  writeManifest({ ...manifest, files: [null] }); await assert.rejects(inspectInstallationBackup({ directory: f.destination }), { code: "BACKUP_MANIFEST_INVALID" });
  writeFileSync(manifestPath, original); writeFileSync(join(f.destination, "extra.txt"), "extra"); await assert.rejects(inspectInstallationBackup({ directory: f.destination }), { code: "BACKUP_PATH_INVALID" }); unlinkSync(join(f.destination, "extra.txt"));
  mkdirSync(join(f.destination, "unexpected-empty")); await assert.rejects(inspectInstallationBackup({ directory: f.destination }), { code: "BACKUP_INCOMPLETE" }); rmSync(join(f.destination, "unexpected-empty"), { recursive: true });
  const file = join(f.destination, "fake-provider.sqlite"), bytes = readFileSync(file); bytes[100] ^= 1; writeFileSync(file, bytes);
  await assert.rejects(inspectInstallationBackup({ directory: f.destination }), { code: "BACKUP_INTEGRITY_ERROR" });
});

test("fixture inspection is read-only, rejects unsupported versions and preserves user_version zero", t => {
  const f = fixture(t); f.close(); const path = join(f.source, "fake-provider.sqlite"), before = sha(readFileSync(path));
  assert.deepEqual(verifyFixtureDatabase(path), { tag: 1, userVersion: 0 }); assert.equal(sha(readFileSync(path)), before);
  const db = new Database(path); db.pragma("user_version=1"); db.close(); assert.throws(() => verifyFixtureDatabase(path), { code: "FIXTURE_DATABASE_VERSION_UNSUPPORTED" });
});

test("generated-video derivation retains distinct exact raw and normalized identities before SQL completion", async t => {
  const f = fixture(t), id = videoDerivationId(f.project.id, "attempt"), media = mediaFixture(f, { artifactId: videoArtifactId(id) });
  const request = { kind: "video", attemptId: "attempt", nodeId: "node", args: { durationFrames: 30 } };
  f.store.insert("attempt", "attempt", f.project.id, { candidateId: null, workKey: "fixture", ordinal: 1, request, taskId: null });
  const output = new ExecutionOutputStore(f.store, { rootDir: join(f.source, "execution-output") });
  const bytes = readFileSync(join(f.source, `media/blobs/${media.source.originalSha256}.source`));
  const receipt = output.recordReceipt(f.project.id, { attemptId: "attempt", expectedRequestDigest: digest(request), port: "video", kind: "video", mimeType: "video/mp4", vendorTaskId: null,
    diagnosticRequestId: null, source: { kind: "returned_bytes", sha256: sha(bytes), byteLength: bytes.length } });
  const spool = await output.spool(f.project.id, receipt.id, async function* () { yield bytes; });
  const intent = f.store.insert("video_derivation_intent", id, f.project.id, { version: 1, attemptId: "attempt", requestDigest: digest(request), slotId: digest({ projectId: f.project.id, attemptId: "attempt", port: "video" }),
    spoolId: spool.id, rawSha256: spool.sha256, rawByteLength: spool.byteLength, artifactId: videoArtifactId(id), requiredFrames: 30, recipe: "generated-video-v1",
    normalization: { version: 1, recipe: "silent-h264-30fps-v1", toolchainDigest: media.source.toolchainDigest, maxInputBytes: 1024, maxOutputBytes: 1024, maxDurationFrames: 30, timeoutMs: 1000 } });
  const derived = { id, version: 1, projectId: f.project.id, attemptId: "attempt", intentDigest: digest(intent), source: media.source };
  const relative = `video-derivations/completions/${id}.json`; write(f.source, relative, canonical(derived));
  const result = await f.backup(); assert.ok(result.manifest.files.some(file => file.path === relative));
  assert.notEqual(derived.source.originalSha256, derived.source.sha256); await inspectInstallationBackup({ directory: f.destination });
  cleanup(f.destination); write(f.source, relative, canonical({ ...derived, intentDigest: "0".repeat(64) }));
  await assert.rejects(f.backup(), { code: "VIDEO_DERIVATION_CONFLICT" });
});

test("historical V2 remains V2 even when the running application supports a later schema", async t => {
  const dir = root(t), source = join(dir, "installation"), destination = join(dir, "backup"); mkdirSync(source);
  const path = join(source, "openslate.sqlite"), db = new Database(path);
  for (const migration of MIGRATIONS.filter(m => m.version <= 2)) db.exec(migration.sql);
  for (const migration of MIGRATIONS.filter(m => m.version <= 2)) db.prepare("INSERT INTO schema_migrations VALUES(?,?,?,?,?)").run(migration.version, migration.name, migration.checksum, new Date().toISOString(), "applied");
  db.pragma("user_version=2"); db.close(); new FakeProvider(join(source, "fake-provider.sqlite")).close(); const before = sha(readFileSync(path));
  const result = await createInstallationBackup({ sourceRoot: source, destination }); assert.equal(result.manifest.applicationSchemaVersion, 2);
  assert.equal(sha(readFileSync(path)), before); await inspectInstallationBackup({ directory: destination });
});

test("a published hardlink surviving temporary cleanup is copied as independent exact bytes", async t => {
  const f = fixture(t), bytes = Buffer.from("completed before cleanup"), path = write(f.source, `artifacts/${f.project.id}/${sha(bytes)}.mp4`, bytes, 0o444);
  linkSync(path, join(dirname(path), "surviving.partial")); assert.equal(statSync(path).nlink, 2);
  const result = await f.backup(), record = result.manifest.files.find(file => file.path.endsWith(".mp4"));
  const copied = join(f.destination, record.path); assert.equal(statSync(copied).nlink, 1); assert.equal(statSync(copied).mode & 0o777, 0o444);
  assert.equal(result.manifest.files.some(file => file.path.endsWith(".partial")), false); await inspectInstallationBackup({ directory: f.destination });
});

test("owned references outside the installation and absent pinned skills are explicit failures", async t => {
  const f = fixture(t), bytes = Buffer.from("outside"), path = write(f.dir, "outside.mp4", bytes);
  f.store.insert("artifact", "external", f.project.id, { artifact: { artifactId: "external", sha256: sha(bytes), kind: "video" }, path });
  await assert.rejects(f.backup(), { code: "BACKUP_REFERENCE_INVALID" });
  f.store.db.prepare("DELETE FROM entities WHERE kind='artifact' AND id='external'").run();
  f.store.insert("director_skill_lock", "missing", f.project.id, { lock: { skills: [{ packageDigest: "a".repeat(64) }] } });
  await assert.rejects(f.backup(), { code: "BACKUP_REFERENCE_INVALID" }); assert.equal(existsSync(f.destination), false);
});

test("WAL page growth is bounded before a snapshot is created", async t => {
  const f = fixture(t); f.store.db.pragma("wal_autocheckpoint=0"); f.store.db.pragma("wal_checkpoint(TRUNCATE)");
  const mainBytes = statSync(join(f.source, "openslate.sqlite")).size;
  f.store.insert("historic", "large", f.project.id, { text: "x".repeat(mainBytes + 100000) });
  assert.equal(statSync(join(f.source, "openslate.sqlite")).size, mainBytes);
  await assert.rejects(createInstallationBackup({ sourceRoot: f.source, destination: f.destination, limits: { fileBytes: mainBytes + 1000 } }), { code: "BACKUP_LIMIT_EXCEEDED" });
  assert.equal(existsSync(f.destination), false);
});

test("browser-demo seeding preserves its project-scoped fixture imports", async t => {
  const f = fixture(t), engine = new Engine(f.store, f.fake, { artifactDir: join(f.source, "artifacts") }), service = new ProductionService(f.store, engine);
  const project = service.createProject("Browser demo backup");
  // This is the exact seed call used by POST /api/projects/:projectId/demo.
  seedFixture(service, join(engine.artifactDir, project.id), project.id);
  const result = await f.backup();
  for (const name of ["product-reference.svg", "silent-narration-fixture.wav"]) {
    const path = `artifacts/${project.id}/fixture-imports/${name}`;
    assert.ok(result.manifest.files.some(file => file.path === path));
    assert.deepEqual(readFileSync(join(f.destination, path)), readFileSync(join(f.source, path)));
  }
  await inspectInstallationBackup({ directory: f.destination });
});
