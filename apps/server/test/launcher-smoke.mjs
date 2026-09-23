// Explicit local acceptance probe: owns port 3001 for one bounded process run.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const free = createServer();
try { await new Promise((resolve, reject) => free.once("error", reject).listen(3001, "127.0.0.1", resolve)); }
finally { if (free.listening) await new Promise(resolve => free.close(resolve)); }
const root = mkdtempSync(join(tmpdir(), "openslate-launcher-smoke-"));
const data = join(root, "data");
const env = { ...process.env, OPENSLATE_DATA_DIR: data };
delete env.OPENSLATE_LOCAL_TOKEN;
const child = spawn(process.execPath, [join(repository, "apps/server/dist/index.js"), "--serve-web", "--no-open"], { cwd: repository, env, stdio: ["ignore", "pipe", "pipe"] });
let output = "", exit;
child.stdout.on("data", value => { output += value.toString(); }); child.stderr.on("data", value => { output += value.toString(); });
const completion = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => { exit = { code, signal }; resolve(exit); }); });
const deadline = setTimeout(() => child.kill("SIGKILL"), 20000);
const request = (path, options = {}) => fetch(`http://127.0.0.1:3001${path}`, { ...options, signal: AbortSignal.timeout(4000) });
let report;
try {
  while (!output.includes(`Local data: ${data}`)) { if (exit) throw new Error(`Launcher exited before readiness: ${output}`); await pause(); }
  const tokenPath = join(data, "local-session.token"), token = readFileSync(tokenPath, "utf8").trim();
  assert.equal(statSync(tokenPath).mode & 0o777, 0o600); assert.ok(output.includes(tokenPath)); assert.ok(!output.includes(token));
  const page = await request("/"); assert.equal(page.status, 200); const markup = await page.text(); assert.match(markup, /<title>OpenSlate<\/title>/);
  const script = markup.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1]; assert.ok(script);
  const bundle = await request(script); assert.equal(bundle.status, 200); assert.match(bundle.headers.get("content-type"), /^text\/javascript/); await bundle.arrayBuffer();
  assert.equal((await request("/api/health")).status, 200);
  assert.equal((await request("/api/projects")).status, 403);
  const headers = { authorization: `Bearer ${token}` };
  const projects = await request("/api/projects", { headers }); assert.deepEqual((await projects.json()).projects, []);
  const created = await request("/api/projects", { method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": "launcher-smoke-project" }, body: JSON.stringify({ name: "Local launcher smoke" }) });
  assert.equal(created.status, 200); const project = await created.json();
  const beforeDuplicate = await (await request(`/api/projects/${project.id}`, { headers })).json();
  const ownerPath = join(data, "installation-owner.sqlite"), ownerBefore = statSync(ownerPath);
  // The invalid token override proves the duplicate is refused before credentials,
  // project storage or worker recovery are reached, rather than just failing to bind the port.
  const duplicate = spawn(process.execPath, [join(repository, "apps/server/dist/index.js"), "--serve-web", "--no-open"], {
    cwd: repository, env: { ...env, OPENSLATE_LOCAL_TOKEN: "invalid" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let duplicateOutput = "", duplicateExit;
  duplicate.stdout.on("data", value => { duplicateOutput += value.toString(); });
  duplicate.stderr.on("data", value => { duplicateOutput += value.toString(); });
  const duplicateDone = new Promise((resolve, reject) => { duplicate.once("error", reject); duplicate.once("exit", (code, signal) => { duplicateExit = { code, signal }; resolve(duplicateExit); }); });
  const duplicateDeadline = setTimeout(() => duplicate.kill("SIGKILL"), 5000);
  try {
    await duplicateDone;
    assert.deepEqual(duplicateExit, { code: 1, signal: null }, duplicateOutput);
    assert.match(duplicateOutput, /INSTALLATION_IN_USE/);
    assert.ok(!duplicateOutput.includes("EADDRINUSE") && !duplicateOutput.includes("CONFIGURATION_ERROR") && !duplicateOutput.includes("is ready"));
  } finally { clearTimeout(duplicateDeadline); if (!duplicateExit) { duplicate.kill("SIGKILL"); await duplicateDone.catch(() => {}); } }
  const ownerAfter = statSync(ownerPath);
  assert.equal(ownerAfter.dev, ownerBefore.dev); assert.equal(ownerAfter.ino, ownerBefore.ino);
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
  assert.equal((await request("/api/health")).status, 200);
  const afterDuplicate = await (await request(`/api/projects/${project.id}`, { headers })).json();
  assert.deepEqual(afterDuplicate.project, beforeDuplicate.project); assert.equal(afterDuplicate.cursor, beforeDuplicate.cursor);
  assert.equal(readFileSync(tokenPath, "utf8").trim(), token);
  const controller = new AbortController();
  const events = await fetch(`http://127.0.0.1:3001/api/projects/${project.id}/events`, { headers, signal: controller.signal });
  assert.equal(events.status, 200); const reader = events.body.getReader(); await reader.read();
  const start = performance.now(); child.kill("SIGTERM");
  try { await completion; while (!(await reader.read()).done) {} } finally { controller.abort(); }
  assert.deepEqual(exit, { code: 0, signal: null }, output);
  const shutdownMs = Math.round(performance.now() - start);
  assert.ok(shutdownMs < 5000, `Shutdown exceeded five seconds: ${shutdownMs}`);
  const { acquireInstallationOwner } = await import("../dist/persistence/installation-owner.js");
  const nextOwner = acquireInstallationOwner(data); nextOwner.close();
  assert.equal(statSync(ownerPath).ino, ownerBefore.ino);
  report = { status: "passed", launcher: "built single process on 127.0.0.1:3001", bundle: true, protectedApi: true, tokenFileMode: "0600", tokenPrinted: false, authenticatedProject: true,
    duplicateInstallationDeniedBeforeTokenRead: true, firstInstallationStayedHealthy: true, ownershipInodePreserved: true, ownershipReleasedAfterShutdown: true,
    openEventStreamClosed: true, shutdownMs, modelCalls: 0, mediaApiCalls: 0 };
} finally {
  clearTimeout(deadline); if (!exit) { child.kill("SIGKILL"); await completion.catch(() => {}); }
  // Immutable skill snapshots have read-only directories; only this probe's temporary tree is released.
  const writable = path => { const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) return; chmodSync(path, 0o700); for (const name of readdirSync(path)) writable(join(path, name)); };
  writable(root); rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
