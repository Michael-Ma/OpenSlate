import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { acquireInstallationOwner } from "../dist/persistence/installation-owner.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "openslate-installation-owner-"));
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}
test("one data directory has one owner while other directories remain independent", t => {
  const root = fixture(t), first = acquireInstallationOwner(join(root, "one"));
  t.after(() => first.close());
  assert.equal(statSync(join(root, "one/installation-owner.sqlite")).mode & 0o777, 0o600);
  assert.throws(() => acquireInstallationOwner(join(root, "one")), { code: "INSTALLATION_IN_USE" });
  const other = acquireInstallationOwner(join(root, "two")); other.close();
  first.close(); first.close();
  const replacement = acquireInstallationOwner(join(root, "one")); replacement.close();
});
test("a directory alias resolves to the same installation owner", t => {
  const root = fixture(t), first = acquireInstallationOwner(join(root, "data")); t.after(() => first.close());
  symlinkSync(join(root, "data"), join(root, "alias"));
  assert.throws(() => acquireInstallationOwner(join(root, "alias")), { code: "INSTALLATION_IN_USE" });
});
test("a symbolic-link lock or corrupt reserved file is rejected without replacement", t => {
  const root = fixture(t), external = join(root, "external"); writeFileSync(external, "existing bytes");
  symlinkSync(external, join(root, "installation-owner.sqlite"));
  assert.throws(() => acquireInstallationOwner(root), { code: "INSTALLATION_LOCK_INVALID" });
  const corrupt = "not a sqlite database".repeat(32);
  rmSync(join(root, "installation-owner.sqlite")); writeFileSync(join(root, "installation-owner.sqlite"), corrupt);
  assert.throws(() => acquireInstallationOwner(root), { code: "INSTALLATION_LOCK_FAILED" });
  assert.equal(readFileSync(join(root, "installation-owner.sqlite"), "utf8"), corrupt);
});
test("a retained owner survives forced GC in another process and abrupt death releases it", { timeout: 10000 }, async t => {
  const root = fixture(t), moduleUrl = new URL("../dist/persistence/installation-owner.js", import.meta.url).href;
  // Retain the handle for the process lifetime, as the launcher does. Discarding
  // it lets the SQLite finalizer release ownership during ordinary collection.
  const code = `import { acquireInstallationOwner } from ${JSON.stringify(moduleUrl)};
    const owner = acquireInstallationOwner(process.argv[1]);
    const timer = setInterval(() => { if (typeof owner.close !== 'function') process.exit(2); }, 1000);
    process.once('SIGTERM', () => { clearInterval(timer); owner.close(); process.exit(0); });
    for (let i = 0; i < 8; i++) { global.gc(); await new Promise(setImmediate); }
    process.stdout.write('owned-after-gc\\n');`;
  const child = spawn(process.execPath, ["--expose-gc", "--input-type=module", "-e", code, root], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", bytes => { stderr += bytes; });
  const ended = once(child, "exit");
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await ended; });
  const ready = await Promise.race([once(child.stdout, "data").then(([data]) => data.toString()), ended.then(() => { throw new Error(stderr); })]);
  assert.equal(ready, "owned-after-gc\n");
  assert.throws(() => acquireInstallationOwner(root), { code: "INSTALLATION_IN_USE" });
  child.kill("SIGKILL"); await ended;
  const replacement = acquireInstallationOwner(root); replacement.close();
});
