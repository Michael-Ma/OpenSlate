import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, lstat, readlink, writeFile, unlink, readdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setupLocalCodex, CodexDirectorRuntime, CODEX_RUNTIME_LIMITS } from "../dist/index.js";
import { CodexTransport } from "../dist/runtime/transport.js";
import { preparePrivateCodexHome } from "../dist/runtime/private-home.js";
import { PROTOCOL_FIXTURE_LIMITS, waitForFixture } from "./fixture-timing.mjs";
const entry = fileURLToPath(new URL("runtime-setup-fixture.mjs", import.meta.url));
const fixture = async (t, scenario = "ready") => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openslate-setup-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nativeHome = join(root, "home"), codexHome = join(nativeHome, ".codex");
  await mkdir(codexHome, { recursive: true });
  // Synthetic sign-in marker only. Neither OpenSlate nor the fixture reads its contents.
  await writeFile(join(codexHome, "auth.json"), "FAKE_AUTH_NEVER_READ");
  const input = { command: { file: process.execPath, args: [entry] }, model: "gpt-6-astra", nativeHome, codexHome,
    directories: { projection: join(root, "workspace"), snapshots: join(root, "workspace/.agents/skills"), storage: join(root, "runtime") },
    env: { SETUP_FIXTURE_SCENARIO: scenario, SETUP_FIXTURE_LOG: join(root, "fixture.jsonl"), SETUP_FIXTURE_SKILL: join(codexHome, "skills/private/SKILL.md"),
      SETUP_FIXTURE_MODEL: "gpt-6-astra" }, limits: { startupTimeoutMs: PROTOCOL_FIXTURE_LIMITS.startupTimeoutMs, requestTimeoutMs: PROTOCOL_FIXTURE_LIMITS.requestTimeoutMs, shutdownGraceMs: PROTOCOL_FIXTURE_LIMITS.shutdownGraceMs } };
  const records = async () => { try { return (await readFile(input.env.SETUP_FIXTURE_LOG, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; } };
  return { input, records, root };
};
test("setup generates exact local policy using two no-turn sessions and private metadata", async t => {
  const f = await fixture(t); process.env.SETUP_PARENT_SECRET = "must-not-inherit";
  t.after(() => { delete process.env.SETUP_PARENT_SECRET; });
  const result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.status, "ready", result.readiness.issues[0]?.code);
  assert.ok(Object.values(result.readiness.checks).every(check => check === "passed"));
  assert.equal(result.readiness.disabledMcpCount, 2); assert.equal(result.readiness.disabledSkillCount, 1);
  assert.deepEqual(result.readiness.modelChoices, [{ id: 'gpt-6-astra', label: 'gpt-6-astra' }]);
  assert.equal(result.runtimeOptions.model, "gpt-6-astra");
  assert.equal(result.runtimeOptions.limits.startupTimeoutMs, PROTOCOL_FIXTURE_LIMITS.startupTimeoutMs);
  assert.doesNotThrow(() => new CodexDirectorRuntime(result.runtimeOptions));
  const policy = result.runtimeOptions.policy;
  assert.equal(policy.mode, "local"); assert.equal(policy.runtimeVersion, "0.153.4");
  assert.deepEqual(policy.config.permissions.openslate_local, { network: { enabled: false }, filesystem: {
    ":root": "deny", ":minimal": "read", [f.input.directories.projection]: "read", [f.input.directories.snapshots]: "read",
    [await realpath(process.execPath)]: "read" } });
  assert.equal(policy.config.sqlite_home, join(f.input.directories.storage, "native-state"));
  assert.equal(policy.config["features.default_mode_request_user_input"], true);
  assert.equal(policy.config["skills.bundled.enabled"], false);
  assert.equal(policy.config["mcp_servers.inherited.enabled"], false);
  assert.deepEqual(policy.config["skills.config"], [{ path: f.input.env.SETUP_FIXTURE_SKILL, enabled: false }]);
  assert.ok(!JSON.stringify(policy).includes("INHERITED_TOKEN"));
  assert.ok(!JSON.stringify(policy).includes("/secret/native/tool"));
  for (const secret of [f.root, "PRIVATE_ACCOUNT_EMAIL", "INHERITED_TOKEN", "private/SKILL.md"])
    assert.ok(!JSON.stringify(result.readiness).includes(secret));
  const records = await f.records(), launches = records.filter(row => row.kind === "launch");
  assert.equal(launches.length, 2); assert.ok(launches.every(row => row.parentSecretAbsent));
  assert.ok(launches.every(row => row.home === f.input.nativeHome && row.codexHome === join(f.input.directories.storage, "director-home")));
  assert.deepEqual(result.runtimeOptions.privateCodexHome, { home: join(f.input.directories.storage, "director-home"), authSource: join(f.input.codexHome, "auth.json") });
  assert.equal((await lstat(join(result.runtimeOptions.env.CODEX_HOME, "auth.json"))).isSymbolicLink(), true);
  assert.deepEqual([...new Set(records.filter(row => row.method).map(row => row.method))].sort(),
    ["account/read", "config/read", "initialize", "initialized", "model/list", "skills/list"]);
  assert.deepEqual(records.find(row => row.method === "account/read").params, { refreshToken: false });
  for (const launch of launches) assert.throws(() => process.kill(launch.pid, 0), error => error.code === "ESRCH");
});

test("private home excludes the selected home's instructions and settings and links an already linked sign-in", async t => {
  const f = await fixture(t), source = join(f.root, "fake-auth.json");
  await writeFile(source, "SYNTHETIC_AUTH_BYTES_MUST_NOT_BE_COPIED");
  await unlink(join(f.input.codexHome, "auth.json"));
  await symlink(source, join(f.input.codexHome, "auth.json"));
  for (const name of ["AGENTS.md", "AGENTS.override.md", "config.toml"]) await writeFile(join(f.input.codexHome, name), "PRIVATE_PERSONAL_INSTRUCTIONS");
  for (const name of ["prompts", "rules", "skills"]) await mkdir(join(f.input.codexHome, name));
  // The synthetic native sessions do not open auth, so unreadable credential bytes cannot affect setup.
  await chmod(source, 0o000);
  const result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.status, "ready", result.readiness.issues[0]?.code);
  const home = result.runtimeOptions.env.CODEX_HOME;
  assert.notEqual(home, f.input.codexHome);
  assert.deepEqual(await readdir(home), ["auth.json"]);
  assert.equal((await lstat(join(home, "auth.json"))).isSymbolicLink(), true);
  assert.equal(await readlink(join(home, "auth.json")), join(f.input.codexHome, "auth.json"));
  assert.equal((await lstat(join(f.input.codexHome, "auth.json"))).isSymbolicLink(), true);
  assert.ok((await f.records()).filter(row => row.kind === "launch").every(row => row.instructionSources.length === 0));
  assert.ok(!(await f.records()).some(row => JSON.stringify(row).includes("PRIVATE_PERSONAL_INSTRUCTIONS")));
});

test("setup repairs native-session sign-in link drift before its verification session", async t => {
  const f = await fixture(t, "auth-link-drift"), result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.status, "ready", result.readiness.issues[0]?.code);
  const launches = (await f.records()).filter(row => row.kind === "launch");
  assert.equal(launches.length, 2);
  assert.ok(launches.every(row => row.authIsLink === true && row.authLinkTarget === join(f.input.codexHome, "auth.json")));
});

test("every preparation repairs a missing, redirected or copied sign-in link without copying credential bytes", async t => {
  const f = await fixture(t), result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.status, "ready");
  const descriptor = result.runtimeOptions.privateCodexHome, link = join(descriptor.home, "auth.json"), wrong = join(f.root, "wrong-auth.json");
  await writeFile(wrong, "SYNTHETIC_OTHER_AUTH");
  for (const replacement of ["missing", "redirected", "regular-file"]) {
    await unlink(link);
    if (replacement === "redirected") await symlink(wrong, link);
    if (replacement === "regular-file") await writeFile(link, "SYNTHETIC_OLD_COPY");
    await preparePrivateCodexHome(descriptor);
    assert.equal((await lstat(link)).isSymbolicLink(), true, replacement);
    assert.equal(await readlink(link), descriptor.authSource, replacement);
  }
  const repeated = await setupLocalCodex(f.input);
  assert.equal(repeated.readiness.status, "ready");
  assert.equal(repeated.runtimeOptions.env.CODEX_HOME, descriptor.home);
  assert.equal(await readlink(link), descriptor.authSource);
});

test("setup preserves a safe OS preparation cause after replacing private error prose", async t => {
  const f = await fixture(t);
  f.input.nativeHome = join(f.root, "PRIVATE_MISSING_NATIVE_HOME");
  const result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.status, "blocked");
  assert.equal(result.readiness.issues[0].code, "SETUP_FAILED");
  assert.deepEqual(result.readiness.nativeDiagnostic, { category: "native_spawn_failed" });
  assert.equal(result.runtimeOptions, undefined);
  assert.deepEqual(await f.records(), []);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.ok(!JSON.stringify(result).includes(f.root));
});

test("setup keeps its primary native failure when owned-process cleanup also fails", async t => {
  const f = await fixture(t, "auth"), close = CodexTransport.prototype.close;
  CodexTransport.prototype.close = async function () { await close.call(this); throw Error("PRIVATE_CLEANUP_ERROR"); };
  let result;
  try { result = await setupLocalCodex(f.input); }
  finally { CodexTransport.prototype.close = close; }
  assert.equal(result.readiness.status, "blocked");
  assert.equal(result.readiness.issues[0].code, "SETUP_AUTH_REQUIRED");
  assert.deepEqual(result.readiness.nativeDiagnostic, { category: "native_auth_required" });
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.ok(!(await f.records()).some(row => row.method?.startsWith("turn/")));
});

test("successful setup checks still refuse failed owned-process cleanup", async t => {
  const f = await fixture(t), close = CodexTransport.prototype.close;
  CodexTransport.prototype.close = async function () { await close.call(this); throw Error("PRIVATE_CLEANUP_ERROR"); };
  let result;
  try { result = await setupLocalCodex(f.input); }
  finally { CodexTransport.prototype.close = close; }
  assert.equal(result.readiness.status, "blocked");
  assert.equal(result.runtimeOptions, undefined);
  assert.deepEqual(result.readiness.nativeDiagnostic, { category: "native_unknown" });
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.ok(!(await f.records()).some(row => row.method?.startsWith("turn/")));
});

for (const scenario of ["missing", "directory", "dangling-link", "selected-home-missing"]) test(`missing usable sign-in (${scenario}) blocks setup before native launch`, async t => {
  const f = await fixture(t), auth = join(f.input.codexHome, "auth.json");
  await unlink(auth);
  if (scenario === "directory") await mkdir(auth);
  if (scenario === "dangling-link") await symlink(join(f.root, "missing-auth.json"), auth);
  if (scenario === "selected-home-missing") await rm(f.input.codexHome, { recursive: true });
  const result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.issues[0].code, "SETUP_AUTH_REQUIRED");
  assert.deepEqual(result.readiness.nativeDiagnostic, { category: "native_auth_required" });
  assert.equal(result.runtimeOptions, undefined);
  assert.deepEqual(await f.records(), []);
});

test("private home alias and path overlap protections refuse before a native launch", async t => {
  for (const target of ["selected-home", "state", "logs", "elsewhere"]) {
    const f = await fixture(t), storage = f.input.directories.storage;
    await mkdir(storage);
    const path = target === "selected-home" ? f.input.codexHome : target === "state" ? join(storage, "native-state") : target === "logs" ? join(storage, "logs") : join(f.root, "elsewhere");
    await mkdir(path, { recursive: true });
    await symlink(path, join(storage, "director-home"));
    const result = await setupLocalCodex(f.input);
    assert.equal(result.readiness.issues[0].code, "SETUP_PATH_OVERLAP", target);
    assert.deepEqual(await f.records(), []);
  }
});

test("later directory aliases and instruction/settings additions are refused by every-launch preparation", async t => {
  const f = await fixture(t), result = await setupLocalCodex(f.input), descriptor = result.runtimeOptions.privateCodexHome;
  for (const name of ["AGENTS.md", "AGENTS.override.md", "config.toml", "managed_config.toml", "prompts", "rules", "skills", "plugins"]) {
    const path = join(descriptor.home, name);
    await writeFile(path, "UNEXPECTED_INSTRUCTION_OR_SETTING");
    await assert.rejects(preparePrivateCodexHome(descriptor), error => error.code === "SETUP_INSTRUCTIONS_UNEXPECTED", name);
    await unlink(path);
  }
  await rm(descriptor.home, { recursive: true });
  const outside = join(f.root, "replacement"); await mkdir(outside);
  await symlink(outside, descriptor.home);
  await assert.rejects(preparePrivateCodexHome(descriptor), error => error.code === "SETUP_DIRECTORY_CHANGED");
});

test("Codex's own trust record for a directory inside the application root is accepted; any other setting is not", async t => {
  const f = await fixture(t), result = await setupLocalCodex(f.input), descriptor = result.runtimeOptions.privateCodexHome;
  const root = join(descriptor.home, "..", ".."), path = join(descriptor.home, "config.toml");
  const own = join(await realpath(root), "workspaces", "a".repeat(64));
  // The image worker's prepared thread writes exactly this; its start must not be refused for it.
  await writeFile(path, `[projects."${own}"]\ntrust_level = "trusted"\n`);
  await preparePrivateCodexHome(descriptor);
  for (const [why, text] of [
    ["a directory outside the application root", `[projects."/tmp/elsewhere"]\ntrust_level = "trusted"\n`],
    ["the application root itself", `[projects."${await realpath(root)}"]\ntrust_level = "trusted"\n`],
    ["a relative escape", `[projects."${own}/../../.."]\ntrust_level = "trusted"\n`],
    ["another trust level", `[projects."${own}"]\ntrust_level = "untrusted"\n`],
    ["an extra setting", `[projects."${own}"]\ntrust_level = "trusted"\nmodel = "other"\n`],
    ["a top-level setting", `model_instructions_file = "x"\n`],
  ]) {
    await writeFile(path, text);
    await assert.rejects(preparePrivateCodexHome(descriptor), error => error.code === "SETUP_INSTRUCTIONS_UNEXPECTED", why);
  }
  await unlink(path);
  await symlink(join(f.root, "linked.toml"), path);
  await writeFile(join(f.root, "linked.toml"), `[projects."${own}"]\ntrust_level = "trusted"\n`);
  await assert.rejects(preparePrivateCodexHome(descriptor), error => error.code === "SETUP_INSTRUCTIONS_UNEXPECTED", "a linked file");
});
for (const [scenario, code] of [
  ["version", "SETUP_VERSION_MISMATCH"], ["auth", "SETUP_AUTH_REQUIRED"], ["model", "SETUP_MODEL_UNAVAILABLE"],
  ["effort", "SETUP_MODEL_UNSUPPORTED"], ["cursor-loop", "SETUP_MODEL_CATALOG_INVALID"], ["policy", "SETUP_POLICY_MISMATCH"],
  ["mcp-drift", "SETUP_MCP_UNEXPECTED"], ["skill-drift", "SETUP_SKILLS_UNEXPECTED"], ["feature-drift", "SETUP_CONFIG_MISMATCH"],
  ["search-drift", "SETUP_CONFIG_MISMATCH"], ["question-feature-drift", "SETUP_CONFIG_MISMATCH"],
  ["bundled-skills-drift", "SETUP_CONFIG_MISMATCH"],
  ["skill-error", "SETUP_SKILLS_INVALID"], ["invalid-mcp-name", "SETUP_CATALOG_INVALID"], ["rpc-error", "RUNTIME_RPC_REJECTED"],
  ["hang", "RUNTIME_RPC_TIMEOUT"], ["approval", "SETUP_INTERACTIVE_DENIED"],
  ["duplicate-model", "SETUP_MODEL_CATALOG_INVALID"], ["late-cursor-loop", "SETUP_MODEL_CATALOG_INVALID"],
]) test(`setup blocks ${scenario} without returning launch options or native diagnostics`, async t => {
  const f = await fixture(t, scenario), result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.status, "blocked"); assert.equal(result.runtimeOptions, undefined);
  assert.equal(result.readiness.issues[0].code, code);
  const category = scenario === "hang" ? "native_timeout" : ["auth", "approval"].includes(scenario) ? "native_auth_required" : scenario === "rpc-error" ? "native_unknown" : "native_protocol";
  assert.deepEqual(result.readiness.nativeDiagnostic, { category, ...(scenario === "hang" ? { limitMs: PROTOCOL_FIXTURE_LIMITS.startupTimeoutMs } : {}) });
  assert.ok(!JSON.stringify(result).includes("PRIVATE")); assert.ok(!JSON.stringify(result).includes(f.root));
  assert.ok(!(await f.records()).some(row => row.kind === "forbidden-method"));
});
test('setup lists all account-advertised supported models even when the selected model is on the first page', async t => {
  const f = await fixture(t, 'model-choices'), result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.status, 'ready');
  assert.deepEqual(result.readiness.modelChoices, [{ id: 'gpt-6-astra', label: 'GPT fixture' }, { id: 'fixture-text', label: 'Other fixture model' }]);
  assert.equal((await f.records()).filter(row => row.method === 'model/list').length, 2);
  assert.ok(!JSON.stringify(result.readiness).includes('PRIVATE'));
  assert.ok(!(await f.records()).some(row => row.kind === 'forbidden-method'));
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
  try {
    await Promise.race([
      waitForFixture(async () => (await f.records()).some(row => row.method === "initialize"), "the initialize request", controller.signal),
      pending.then(result => { throw new Error(`Setup ended before the cancellation barrier: ${result.readiness.issues[0]?.code ?? result.readiness.status}`); }),
    ]);
  } finally { controller.abort(); }
  const result = await pending;
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

for (const [scenario, foundVersion] of [['version', '0.0.1'], ['version-alpha', '0.162.0-alpha.4'], ['version-private', null]])
test(`setup records a bounded parsed version for ${scenario} before any account session`, async t => {
  const f = await fixture(t, scenario), result = await setupLocalCodex(f.input);
  assert.equal(result.readiness.issues[0].code, 'SETUP_VERSION_MISMATCH');
  assert.deepEqual(result.readiness.binaryVersion, { expectedVersion: '0.153.4', foundVersion });
  assert.equal(result.runtimeOptions, undefined); assert.deepEqual((await f.records()).map(row => row.kind), ['version']);
  assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.ok(!JSON.stringify(result).includes(f.root));
});
