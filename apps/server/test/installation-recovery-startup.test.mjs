import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "@openslate/core";
import { acquireInstallationOwner } from "../dist/persistence/installation-owner.js";

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
  const env = { ...process.env, OPENSLATE_DATA_DIR: directory, OPENSLATE_ENABLE_IMAGE_GENERATION: "0", OPENSLATE_ENABLE_H3_GENERATION: "0" };
  for (const key of ["OPENSLATE_LOCAL_TOKEN", "OPENSLATE_PROVIDER_CONFIG", "OPENSLATE_H3_DOWNLOAD_HOSTS", "OPENSLATE_OPENAI_API_KEY", "OPENSLATE_MINIMAX_API_KEY"]) delete env[key];
  const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url))], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
  const ended = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await ended; });
  const result = await ended; assert.equal(result.code, 1, output); assert.match(output, /RESTORE_INCOMPLETE/);
  assert.deepEqual(readFileSync(join(directory, "openslate.sqlite")), sentinel); assert.equal(statSync(ownerPath).ino, inode);
  for (const name of ["local-session.token", "fake-provider.sqlite", "media", "uploads", "execution-output", "native", "openslate.sqlite.migration-backups"])
    assert.equal(existsSync(join(directory, name)), false, `No startup effect: ${name}`);
  const nextOwner = acquireInstallationOwner(directory); nextOwner.close();
});
