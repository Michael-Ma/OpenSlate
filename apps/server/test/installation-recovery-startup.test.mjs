import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "@openslate/core";
import { acquireInstallationOwner } from "../dist/persistence/installation-owner.js";
import { CURRENT_SCHEMA_VERSION } from "../dist/persistence/schema.js";

function environment(directory) {
  const env = { ...process.env, OPENSLATE_DATA_DIR: directory, OPENSLATE_ENABLE_IMAGE_GENERATION: "0", OPENSLATE_ENABLE_H3_GENERATION: "0" };
  for (const key of ["OPENSLATE_LOCAL_TOKEN", "OPENSLATE_PROVIDER_CONFIG", "OPENSLATE_H3_DOWNLOAD_HOSTS", "OPENSLATE_OPENAI_API_KEY", "OPENSLATE_MINIMAX_API_KEY"]) delete env[key];
  return env;
}
async function rejectedProcess(t, script, args, env) {
  const guard = "data:text/javascript," + encodeURIComponent('import {Server} from "node:net"; Server.prototype.listen=function(){throw Error("Unexpected startup listener")};');
  const child = spawn(process.execPath, ["--import", guard, fileURLToPath(new URL(script, import.meta.url)), ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = ""; child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
  const ended = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await ended; });
  const result = await ended; assert.equal(result.code, 1, stdout + stderr); assert.equal(result.signal, null);
  return { stdout, stderr };
}

test("actual launcher rejects an incomplete restore before token, Store, provider or media initialization", { timeout: 10000 }, async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "openslate-recovery-startup-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const owner = acquireInstallationOwner(directory); owner.close();
  const ownerPath = join(directory, "installation-owner.sqlite"), inode = statSync(ownerPath).ino;
  const restoreId = randomUUID();
  writeFileSync(join(directory, "installation-restore.json"), canonical({ version: 1, restoreId, backupId: randomUUID(), backupManifestSha256: "a".repeat(64),
    originalDataRoot: directory, stageName: `.openslate-restore-${restoreId}`, state: "copying" }), { mode: 0o600 });
  const sentinel = Buffer.from("Incomplete copied database: the launcher must never open this");
  writeFileSync(join(directory, "openslate.sqlite"), sentinel, { mode: 0o600 });
  const result = await rejectedProcess(t, "../dist/index.js", [], environment(directory)); assert.match(result.stderr, /RESTORE_INCOMPLETE/);
  assert.deepEqual(readFileSync(join(directory, "openslate.sqlite")), sentinel); assert.equal(statSync(ownerPath).ino, inode);
  for (const name of ["local-session.token", "fake-provider.sqlite", "media", "uploads", "execution-output", "native"])
    assert.equal(existsSync(join(directory, name)), false, `No startup effect: ${name}`);
  const nextOwner = acquireInstallationOwner(directory); nextOwner.close();
});

test("launcher and export CLI explain old or malformed schemas without changing their databases", { timeout: 20000 }, async t => {
  const message = "This data directory was created by an earlier OpenSlate prototype and cannot be opened. Start with a new OPENSLATE_DATA_DIR.";
  for (const version of [1, 2, 3, 999, CURRENT_SCHEMA_VERSION]) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "openslate-schema-startup-"))), directory = join(root, "installation"), destination = join(root, "backup");
    mkdirSync(directory); t.after(() => rmSync(root, { recursive: true, force: true }));
    const databasePath = join(directory, "openslate.sqlite"), fixturePath = join(directory, "fake-provider.sqlite"), db = new Database(databasePath);
    db.exec("CREATE TABLE unexpected(value TEXT)"); db.pragma(`user_version=${version}`); db.close(); new Database(fixturePath).close();
    const before = readFileSync(databasePath), fixtureBefore = readFileSync(fixturePath), env = { ...environment(directory), OPENSLATE_LOCAL_TOKEN: "synthetic-schema-startup-token" };
    const startup = await rejectedProcess(t, "../dist/index.js", [], env); assert.equal(startup.stderr.trim(), message); assert.equal(startup.stdout, "");
    const exported = await rejectedProcess(t, "../dist/installation-cli.js", ["export", "--data-dir", directory, "--output", destination], env);
    assert.deepEqual(JSON.parse(exported.stderr), { error: { code: version === CURRENT_SCHEMA_VERSION ? "DATABASE_SCHEMA_MISMATCH" : "DATABASE_VERSION_UNSUPPORTED", message } });
    assert.equal(exported.stdout, ""); assert.deepEqual(readFileSync(databasePath), before); assert.deepEqual(readFileSync(fixturePath), fixtureBefore);
    assert.equal(existsSync(destination), false);
    for (const name of ["local-session.token", "media", "uploads", "execution-output", "native", "installation-restore.json"])
      assert.equal(existsSync(join(directory, name)), false, `No startup effect: ${name}`);
    const owner = acquireInstallationOwner(directory); owner.close();
  }
});
