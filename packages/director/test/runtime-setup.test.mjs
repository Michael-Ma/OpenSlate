import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setupLocalCodex, CodexDirectorRuntime, CODEX_RUNTIME_LIMITS } from "../dist/index.js";
import { CodexTransport } from "../dist/runtime/transport.js";
const entry = fileURLToPath(new URL("runtime-setup-fixture.mjs", import.meta.url));
const fixture = async (t, scenario = "ready") => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openslate-setup-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nativeHome = join(root, "home"), codexHome = join(nativeHome, ".codex");
  await mkdir(codexHome, { recursive: true });
  const input = { command: { file: process.execPath, args: [entry] }, model: "gpt-6-astra", nativeHome, codexHome,
    directories: { projection: join(root, "workspace"), snapshots: join(root, "workspace/.agents/skills"), storage: join(root, "runtime") },
    env: { SETUP_FIXTURE_SCENARIO: scenario, SETUP_FIXTURE_LOG: join(root, "fixture.jsonl"), SETUP_FIXTURE_SKILL: join(codexHome, "skills/private/SKILL.md"),
      SETUP_FIXTURE_MODEL: "gpt-6-astra" }, limits: { requestTimeoutMs: 350, shutdownGraceMs: 100 } };
  const records = async () => { try { return (await readFile(input.env.SETUP_FIXTURE_LOG, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; } };
  return { input, records, root };
};
test("setup generates exact local policy using two no-turn sessions and private metadata", async t => {
  const f = await fixture(t); process.env.SETUP_PARENT_SECRET = "must-not-inherit";
  t.after(() => { delete process.env.SETUP_PARENT_SECRET; });
  const result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.status, "ready");
  assert.ok(Object.values(result.readiness.checks).every(check => check === "passed"));
  assert.equal(result.readiness.disabledMcpCount, 2); assert.equal(result.readiness.disabledSkillCount, 1);
  assert.equal(result.runtimeOptions.model, "gpt-6-astra");
  assert.doesNotThrow(() => new CodexDirectorRuntime(result.runtimeOptions));
  const policy = result.runtimeOptions.policy;
  assert.equal(policy.mode, "local"); assert.equal(policy.runtimeVersion, "0.153.4");
  assert.deepEqual(policy.config.permissions.openslate_local, { network: { enabled: false }, filesystem: {
    ":root": "deny", ":minimal": "read", [f.input.directories.projection]: "read", [f.input.directories.snapshots]: "read",
    [await realpath(process.execPath)]: "read" } });
  assert.equal(policy.config.sqlite_home, join(f.input.directories.storage, "native-state"));
  assert.equal(policy.config["features.default_mode_request_user_input"], true);
  assert.equal(policy.config["mcp_servers.inherited.enabled"], false);
  assert.deepEqual(policy.config["skills.config"], [{ path: f.input.env.SETUP_FIXTURE_SKILL, enabled: false }]);
  assert.ok(!JSON.stringify(policy).includes("INHERITED_TOKEN"));
  assert.ok(!JSON.stringify(policy).includes("/secret/native/tool"));
  for (const secret of [f.root, "PRIVATE_ACCOUNT_EMAIL", "INHERITED_TOKEN", "private/SKILL.md"])
    assert.ok(!JSON.stringify(result.readiness).includes(secret));
  const records = await f.records(), launches = records.filter(row => row.kind === "launch");
  assert.equal(launches.length, 2); assert.ok(launches.every(row => row.parentSecretAbsent));
  assert.ok(launches.every(row => row.home === f.input.nativeHome && row.codexHome === f.input.codexHome));
  assert.deepEqual([...new Set(records.filter(row => row.method).map(row => row.method))].sort(),
    ["account/read", "config/read", "initialize", "initialized", "model/list", "skills/list"]);
  assert.deepEqual(records.find(row => row.method === "account/read").params, { refreshToken: false });
  for (const launch of launches) assert.throws(() => process.kill(launch.pid, 0), error => error.code === "ESRCH");
});
for (const [scenario, code] of [
  ["version", "SETUP_VERSION_MISMATCH"], ["auth", "SETUP_AUTH_REQUIRED"], ["model", "SETUP_MODEL_UNAVAILABLE"],
  ["effort", "SETUP_MODEL_UNSUPPORTED"], ["cursor-loop", "SETUP_MODEL_CATALOG_INVALID"], ["policy", "SETUP_POLICY_MISMATCH"],
  ["mcp-drift", "SETUP_MCP_UNEXPECTED"], ["skill-drift", "SETUP_SKILLS_UNEXPECTED"], ["feature-drift", "SETUP_CONFIG_MISMATCH"],
  ["search-drift", "SETUP_CONFIG_MISMATCH"], ["question-feature-drift", "SETUP_CONFIG_MISMATCH"],
  ["skill-error", "SETUP_SKILLS_INVALID"], ["invalid-mcp-name", "SETUP_CATALOG_INVALID"], ["rpc-error", "RUNTIME_RPC_REJECTED"],
  ["hang", "RUNTIME_RPC_TIMEOUT"], ["approval", "SETUP_INTERACTIVE_DENIED"],
]) test(`setup blocks ${scenario} without returning launch options or native diagnostics`, async t => {
  const f = await fixture(t, scenario), result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.status, "blocked"); assert.equal(result.runtimeOptions, undefined);
  assert.equal(result.readiness.issues[0].code, code);
  assert.ok(!JSON.stringify(result).includes("PRIVATE")); assert.ok(!JSON.stringify(result).includes(f.root));
  assert.ok(!(await f.records()).some(row => row.kind === "forbidden-method"));
});
test("model discovery follows opaque pages and permission comparison accepts only pinned null defaults", async t => {
  for (const scenario of ["pagination", "permissions-null"]) {
    const f = await fixture(t, scenario), result = await setupLocalCodex(f.input);
    assert.equal(result.readiness.status, "ready");
    if (scenario === "pagination") assert.equal((await f.records()).filter(row => row.method === "model/list").length, 2);
  }
});
test("overlap and symlink aliases to native authentication fail before a native launch", async t => {
  const f = await fixture(t);
  await symlink(f.input.codexHome, join(f.root, "auth-alias"));
  for (const directories of [
    { ...f.input.directories, projection: f.input.nativeHome },
    { ...f.input.directories, snapshots: join(f.root, "auth-alias/new-skills") },
    { ...f.input.directories, storage: join(f.input.directories.projection, "storage") },
  ]) {
    const result = await setupLocalCodex({ ...f.input, directories });
    assert.equal(result.readiness.issues[0].code, "SETUP_PATH_OVERLAP");
  }
  assert.deepEqual(await f.records(), []);
});
test("cancellation before setup and during a native request remains bounded", async t => {
  const f = await fixture(t, "hang");
  const before = await setupLocalCodex(f.input, { signal: AbortSignal.abort() });
  assert.equal(before.readiness.issues[0].code, "SETUP_ABORTED"); assert.deepEqual(await f.records(), []);
  const controller = new AbortController();
  const pending = setupLocalCodex(f.input, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 120);
  const result = await pending; clearTimeout(timer);
  assert.equal(result.readiness.issues[0].code, "SETUP_ABORTED");
  for (const row of (await f.records()).filter(row => row.kind === "launch"))
    assert.throws(() => process.kill(row.pid, 0), error => error.code === "ESRCH");
});
test("read-only transport cannot dispatch a thread, model turn, login or config write", async t => {
  const f = await fixture(t);
  const transport = new CodexTransport({ command: process.execPath, args: [entry, "app-server"], cwd: f.root, env: f.input.env,
    limits: { ...CODEX_RUNTIME_LIMITS, shutdownGraceMs: 100 }, secrets: [],
    allowedMethods: ["initialize", "config/read", "skills/list", "account/read", "model/list"], onMessage: () => {} });
  try {
    for (const method of ["thread/start", "turn/start", "account/login/start", "config/value/write"])
      assert.throws(() => transport.request(method, {}), error => error.code === "RUNTIME_METHOD_DENIED");
  } finally { await transport.close(); }
  assert.ok(!(await f.records()).some(row => row.kind === "forbidden-method"));
});
