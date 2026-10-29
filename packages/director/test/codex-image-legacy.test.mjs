import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { digest } from "@openslate/core";
import { describeCodexImageInput } from "@openslate/providers";
import { CodexImageWorkerTransport } from "../dist/index.js";

const entry = fileURLToPath(new URL("codex-image-fixture.mjs", import.meta.url));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XsAAAAASUVORK5CYII=", "base64");
const input = () => ({ attemptId: "legacy-attempt", requestDigest: "a".repeat(64), prompt: "A blue boot", width: 1024, height: 1024,
  runtimeVersion: "0.153.4", model: "gpt-6-astra", images: [] });

// Author an old synthetic receipt directly. No new-home history is ever relabelled
// as V1, and no prepare/turn call or authentication file is needed to recover it.
async function legacyFixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openslate-image-legacy-")));
  const nativeHome = join(root, "home"), codexHome = join(nativeHome, ".codex"), directory = join(root, "images");
  const value = input(), turnInputDigest = describeCodexImageInput(value).turnInputDigest;
  const workspace = join(directory, "workspaces", turnInputDigest), configurations = join(directory, "configurations");
  await Promise.all([mkdir(codexHome, { recursive: true }), mkdir(workspace, { recursive: true }), mkdir(configurations, { recursive: true })]);
  const options = { command: { file: process.execPath, args: [entry] }, nativeHome, codexHome, directory,
    env: { SETUP_FIXTURE_LOG: join(root, "calls.jsonl"), IMAGE_FIXTURE_SCENARIO: "inline" } };
  const binary = await realpath(process.execPath), runtimeDigest = createHash("sha256").update(await readFile(binary)).digest("hex");
  const config = { version: 1, config: { model: "gpt-6-astra", model_provider: "openai", "features.image_generation": true,
    forced_login_method: "chatgpt", approval_policy: "never", web_search: "disabled", "skills.bundled.enabled": false, "skills.config": [],
    permissions: { openslate_local: { filesystem: { ":root": "deny", ":minimal": "read", [workspace]: "write", [binary]: "read" }, network: { enabled: false } } } },
    workspace, binary, args: [entry], runtimeDigest, environmentDigest: digest({ ...options.env, HOME: nativeHome, CODEX_HOME: codexHome }) };
  const prepared = { runtime: { version: 1, runtimeVersion: "0.153.4", runtimeDigest, configurationDigest: digest(config), model: "gpt-6-astra", authMode: "chatgpt" },
    session: { threadId: "thread-legacy", turnInputDigest } };
  const configPath = join(configurations, `${prepared.runtime.configurationDigest}.json`), configBytes = JSON.stringify(config);
  await writeFile(configPath, configBytes);
  const history = turns => writeFile(join(workspace, "fixture-history.json"), JSON.stringify({ id: prepared.session.threadId, cwd: workspace, modelProvider: "openai", turns }));
  const setServers = servers => writeFile(join(codexHome, "fixture-mcp-servers.json"), JSON.stringify(servers));
  await setServers({ inherited: { enabled: true, command: "FAKE_MCP_MUST_NOT_RUN" } });
  const workers = [], make = (overrides = {}) => { const worker = new CodexImageWorkerTransport({ ...options, ...overrides }); workers.push(worker); return worker; };
  t.after(async () => { await Promise.all(workers.map(worker => worker.close())); await rm(root, { recursive: true, force: true }); });
  const records = async () => { try { return (await readFile(options.env.SETUP_FIXTURE_LOG, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; } };
  const saveImage = async (home = codexHome) => { const folder = join(home, "generated_images", prepared.session.threadId); await mkdir(folder, { recursive: true });
    const path = join(folder, "original.png"); await writeFile(path, png); return path; };
  const completed = savedPath => ({ id: "turn-legacy", status: "completed", items: [{ type: "imageGeneration", id: "image-legacy", status: "completed", result: "", savedPath }] });
  return { options, value, prepared, configPath, configBytes, history, setServers, make, records, saveImage, completed, privateHome: join(directory, "runtime", "director-home") };
}

function assertReadOnly(rows, codexHome) {
  const launches = rows.filter(row => row.kind === "launch");
  assert.ok(launches.length > 0);
  assert.ok(launches.every(row => row.codexHome === codexHome && row.strictConfig));
  assert.deepEqual([...new Set(rows.filter(row => row.kind === "request").map(row => row.method))].sort(), ["initialize", "initialized", "thread/read"]);
  assert.ok(!rows.some(row => row.kind === "version" || row.kind === "forbidden-method"));
}

test("V1 personal-home history reconciles a late exact output despite changed MCP servers without relabelling its receipt", async t => {
  const f = await legacyFixture(t), original = structuredClone(f.prepared);
  await f.history([{ id: "turn-legacy", status: "inProgress", items: [] }]);
  assert.deepEqual(await f.make().lookup(f.prepared), { kind: "pending", threadId: "thread-legacy", turnId: "turn-legacy" });
  await f.setServers({ newly_enabled: { enabled: true, command: "FAKE_CHANGED_MCP_MUST_NOT_RUN" }, inherited: { enabled: false } });
  await f.saveImage(f.privateHome);
  const oldOutput = await f.saveImage();
  await f.history([f.completed(oldOutput)]);
  const recovered = await f.make().lookup(f.prepared, { turnId: "turn-legacy" });
  assert.equal(recovered.kind, "completed", recovered.code);
  assert.deepEqual(Buffer.from(recovered.bytes), png);
  assert.equal(recovered.threadId, "thread-legacy");
  assert.equal(recovered.turnId, "turn-legacy");
  assert.equal(await readFile(f.configPath, "utf8"), f.configBytes);
  assert.deepEqual(f.prepared, original);
  const rows = await f.records();
  assertReadOnly(rows, f.options.codexHome);
  assert.deepEqual(rows.filter(row => row.kind === "launch").at(-1).mcpServers.sort(), ["inherited", "newly_enabled"]);
});

test("V1 lookup cannot borrow a new private-home output root", async t => {
  const f = await legacyFixture(t), savedPath = await f.saveImage(f.privateHome);
  await f.history([f.completed(savedPath)]);
  assert.equal((await f.make().lookup(f.prepared, { turnId: "turn-legacy" })).kind, "unknown");
  assertReadOnly(await f.records(), f.options.codexHome);
  assert.equal(await readFile(f.configPath, "utf8"), f.configBytes);
});

test("V1 missing old bytes stay unknown even when the private home has an image with the same relative path", async t => {
  const f = await legacyFixture(t), oldOutput = await f.saveImage();
  await f.saveImage(f.privateHome);
  await rm(oldOutput);
  await f.history([f.completed(oldOutput)]);
  assert.equal((await f.make().lookup(f.prepared)).kind, "unknown");
  assertReadOnly(await f.records(), f.options.codexHome);
});

for (const defect of ["missing", "corrupt", "changed"]) test(`V1 ${defect} saved launch configuration stays unknown without starting a process`, async t => {
  const f = await legacyFixture(t);
  await f.history([f.completed(await f.saveImage())]);
  if (defect === "missing") await rm(f.configPath);
  else if (defect === "corrupt") await writeFile(f.configPath, "{broken");
  else { const config = JSON.parse(f.configBytes); config.config.model = "different-model"; await writeFile(f.configPath, JSON.stringify(config)); }
  assert.equal((await f.make().lookup(f.prepared)).kind, "unknown");
  assert.deepEqual(await f.records(), []);
});

test("V1 configuration retains its original launch environment digest rather than adopting changed host values", async t => {
  const f = await legacyFixture(t);
  await f.history([f.completed(await f.saveImage())]);
  const changed = f.make({ env: { ...f.options.env, CHANGED_HOST_VALUE: "changed" } });
  assert.deepEqual(await changed.lookup(f.prepared), { kind: "unknown", code: "CODEX_IMAGE_CONFIG_MISMATCH" });
  assert.deepEqual(await f.records(), []);
  assert.equal(await readFile(f.configPath, "utf8"), f.configBytes);
});

test("V1 expired or lost preparation cannot be recreated or resumed as a first image turn", async t => {
  const f = await legacyFixture(t), worker = f.make();
  await f.history([]);
  assert.deepEqual(await worker.start(f.prepared, f.value, { observeTurn: async () => { throw Error("must not observe a turn"); } }),
    { kind: "unknown", code: "CODEX_IMAGE_PREPARED_PROCESS_LOST" });
  await worker.release(f.prepared);
  assert.deepEqual(await f.records(), []);
  assert.equal((await worker.lookup(f.prepared)).kind, "unknown");
  assertReadOnly(await f.records(), f.options.codexHome);
  assert.equal(await readFile(f.configPath, "utf8"), f.configBytes);
});
