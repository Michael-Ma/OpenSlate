import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createFixtureServers, EpochFixture, FIXTURE_TOOLS } from "./epoch-fixture.js";
import { ProbeClient, record, RpcError } from "./protocol.js";
import { CODEX_PROBE_BASELINE } from "./baseline.js";

const execute = promisify(execFile);
interface Check { name: string; status: "passed" | "failed" | "blocked"; evidence: unknown; }
export interface ProbeReport {
  formatVersion: 1;
  observedAt: string;
  binary: string;
  version: string | null;
  schemaDigest: string | null;
  checks: Check[];
  safety: { turnStartSent: boolean; realAuthProvided: false; providerRequests: string[] };
  productionReady: false;
  unverified: string[];
}

export function isolatedEnvironment(root: string, guardUrl: string): NodeJS.ProcessEnv {
  // Construct from scratch; do not spread process.env or copy auth/config files.
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(root, "home"), CODEX_HOME: join(root, "runtime"),
    XDG_CONFIG_HOME: join(root, "xdg-config"), XDG_CACHE_HOME: join(root, "xdg-cache"),
    TMPDIR: join(root, "tmp"), USER: "openslate-probe", LOGNAME: "openslate-probe",
    SHELL: "/bin/sh", NO_COLOR: "1", CI: "1",
    HTTP_PROXY: guardUrl, HTTPS_PROXY: guardUrl, ALL_PROXY: guardUrl,
    http_proxy: guardUrl, https_proxy: guardUrl, all_proxy: guardUrl,
    NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost",
  };
}

export function schemaMethods(schema: unknown): string[] {
  const methods = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const object = record(value);
    const method = record(record(object.properties).method);
    for (const item of Array.isArray(method.enum) ? method.enum : []) {
      if (typeof item === "string") methods.add(item);
    }
    if (typeof method.const === "string") methods.add(method.const);
    for (const child of Object.values(object)) visit(child);
  };
  visit(schema); return [...methods].sort();
}

async function hashSchemaTree(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && path.endsWith(".json")) files.push(path);
    }
  };
  await walk("");
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(file); hash.update("\0"); hash.update(await readFile(join(root, file))); hash.update("\0");
  }
  return hash.digest("hex");
}

function failure(error: unknown): object {
  return { message: error instanceof Error ? error.message : String(error),
    ...(error instanceof RpcError ? { code: error.code } : {}) };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runProbe(binary = "codex"): Promise<ProbeReport> {
  const report: ProbeReport = {
    formatVersion: 1, observedAt: new Date().toISOString(), binary, version: null,
    schemaDigest: null, checks: [],
    safety: { turnStartSent: false, realAuthProvided: false, providerRequests: [] },
    productionReady: false,
    unverified: [
      "No model turn: streamed reasoning/tool dispatch, explicit skill injection, active interruption/steering and pending-input round trips remain unverified.",
      "A local epoch fixture is not a SQLite transaction, durable admission, or production sandbox proof.",
      "Sanitized configuration and a denying proxy do not establish OS-enforced egress/filesystem isolation or exclusion of managed/system skills.",
      "No vendor authentication, vision behavior, media generation, billing, or LLM compatibility was tested.",
    ],
  };
  const root = await realpath(await mkdtemp(join(tmpdir(), "openslate-codex-probe-")));
  const gate = new EpochFixture();
  let servers: Awaited<ReturnType<typeof createFixtureServers>>;
  try { servers = await createFixtureServers(gate); }
  catch (error) {
    report.checks.push({ name: "local_fixture_listeners", status: "blocked", evidence: failure(error) });
    await rm(root, { recursive: true, force: true });
    return report;
  }
  const env = isolatedEnvironment(root, servers.providerUrl);
  const workspace = join(root, "workspace");
  const clients: ProbeClient[] = [];
  const credentials: string[] = [];
  const check = async (name: string, fn: () => Promise<unknown>, blocked = false) => {
    try { const value = await fn(); report.checks.push({ name, status: "passed", evidence: value }); return value; }
    catch (error) { report.checks.push({ name, status: blocked ? "blocked" : "failed", evidence: failure(error) }); return undefined; }
  };
  const launch = () => {
    const client = new ProbeClient(binary, ["app-server"], workspace, env);
    clients.push(client); return client;
  };
  const initialize = async (client: ProbeClient) => {
    const result = await client.request("initialize", {
      clientInfo: { name: "openslate_no_paid_probe", title: "OpenSlate local compatibility probe", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    });
    client.initialized(); return result;
  };
  const threadParams = { cwd: workspace, model: "openslate-probe", modelProvider: "openslate_probe",
    approvalPolicy: "never", sandbox: "read-only", ephemeral: false };
  const writeConfig = async (credential: string) => {
    credentials.push(credential);
    const fakeMcp = fileURLToPath(new URL("./fake-mcp.js", import.meta.url));
    const q = JSON.stringify;
    await writeFile(join(root, "runtime", "config.toml"), [
      'model = "openslate-probe"', 'model_provider = "openslate_probe"',
      'approval_policy = "never"', 'sandbox_mode = "read-only"', 'web_search = "disabled"',
      "check_for_update_on_startup = false", "[analytics]", "enabled = false",
      "[feedback]", "enabled = false", "[features]", "apps = false", "plugins = false",
      "shell_tool = false", "skill_mcp_dependency_install = false",
      "[model_providers.openslate_probe]", 'name = "Local denying probe fixture"',
      `base_url = ${q(servers.providerUrl + "/v1")}`, 'wire_api = "responses"',
      "requires_openai_auth = false", "[mcp_servers.openslate_probe]",
      `command = ${q(process.execPath)}`, `args = [${q(fakeMcp)}]`, "required = true",
      `enabled_tools = [${FIXTURE_TOOLS.map(value => q(value)).join(", ")}]`,
      "[mcp_servers.openslate_probe.env]",
      `OPENSLATE_PROBE_CREDENTIAL = ${q(credential)}`,
      `OPENSLATE_PROBE_ENDPOINT = ${q(servers.bridgeUrl)}`, "",
    ].join("\n"), { mode: 0o600 });
  };
  try {
    for (const name of ["home", "runtime", "xdg-config", "xdg-cache", "tmp", "workspace/.git"]) {
      await mkdir(join(root, name), { recursive: true });
    }
    for (const name of ["production", "plan-authoring"]) {
      const dir = join(workspace, ".agents", "skills", name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: OpenSlate isolated probe fixture; never generate media.\n---\nFixture instructions only.\n`);
    }
    const oldEpoch = gate.issue(); await writeConfig(oldEpoch.credential);
    const version = await check("binary_version", async () => {
      const result = await execute(binary, ["--version"], { env, cwd: workspace, timeout: 10_000 });
      return result.stdout.trim();
    }, true);
    if (typeof version !== "string") return report;
    report.version = version;
    const schemaDir = join(root, "schema");
    await check("versioned_protocol_schema", async () => {
      await execute(binary, ["app-server", "generate-json-schema", "--out", schemaDir],
        { env, cwd: workspace, timeout: 20_000, maxBuffer: 2_097_152 });
      report.schemaDigest = await hashSchemaTree(schemaDir);
      const clientSchema: unknown = JSON.parse(await readFile(join(schemaDir, "ClientRequest.json"), "utf8"));
      const serverSchema: unknown = JSON.parse(await readFile(join(schemaDir, "ServerRequest.json"), "utf8"));
      const clientsAvailable = schemaMethods(clientSchema);
      const serversAvailable = schemaMethods(serverSchema);
      return { sha256: report.schemaDigest, declaredClientMethods: clientsAvailable.filter(method =>
        ["thread/start", "thread/resume", "turn/start", "turn/steer", "turn/interrupt", "skills/list",
          "mcpServerStatus/list", "mcpServer/tool/call"].includes(method)),
        declaredInputMethods: serversAvailable.filter(method => /approval|userinput|elicitation/i.test(method)),
        note: "Declaration only; turn/start is forbidden by the probe transport." };
    });
    if (report.version === CODEX_PROBE_BASELINE.version && process.platform === CODEX_PROBE_BASELINE.platform &&
        process.arch === CODEX_PROBE_BASELINE.arch) {
      await check("recorded_baseline_schema", async () => {
        assert(report.schemaDigest === CODEX_PROBE_BASELINE.schemaDigest, "Recorded runtime schema differs; review required");
        return { matches: true, note: "No-turn baseline only; live gates remain open." };
      });
    } else {
      report.checks.push({ name: "recorded_baseline_schema", status: "blocked",
        evidence: { reason: "No reviewed fixture for this runtime version/platform/architecture" } });
    }
    const client = launch();
    await check("pre_initialize_rejected", async () => {
      try { await client.request("skills/list", { cwds: [workspace] }); }
      catch (error) { assert(error instanceof RpcError, "Expected protocol rejection"); return failure(error); }
      throw new Error("Request succeeded before initialization");
    });
    const initialized = await check("initialize", () => initialize(client));
    if (initialized === undefined) return report;
    await check("skills_discovery", async () => {
      const result = record(await client.request("skills/list", { cwds: [workspace], forceReload: true }));
      const data = Array.isArray(result.data) ? result.data : [];
      const skills = data.flatMap(item => Array.isArray(record(item).skills) ? record(item).skills as unknown[] : []);
      for (const name of ["production", "plan-authoring"]) {
        assert(skills.some(item => record(item).name === name && record(item).enabled !== false), `Missing fixture skill ${name}`);
      }
      return { names: skills.map(item => record(item).name),
        exclusiveTwoSkillCatalog: skills.length === 2,
        outsideIsolatedRoot: skills.filter(item => typeof record(item).path === "string" &&
          !(record(item).path as string).startsWith(root + "/")).map(item => record(item).name),
        note: "Metadata discovery only; no model loaded skill instructions." };
    });
    const started = await check("thread_start_without_turn", () => client.request("thread/start", threadParams));
    const threadId = record(record(started).thread).id;
    if (typeof threadId !== "string") return report;
    await check("thread_read_metadata", async () => {
      const value = await client.request("thread/read", { threadId, includeTurns: false });
      assert(record(record(value).thread).id === threadId, "Thread metadata identity mismatch");
      return { matchingThreadId: true, historyMode: record(record(value).thread).historyMode };
    }, true);
    await check("thread_read_empty", async () => {
      const value = await client.request("thread/read", { threadId, includeTurns: true });
      const turns = record(record(value).thread).turns;
      assert(Array.isArray(turns) && turns.length === 0, "Unexpected turn history"); return { turns: 0 };
    }, true);
    await check("fixed_mcp_catalog", async () => {
      const result = record(await client.request("mcpServerStatus/list", { threadId, detail: "toolsAndAuthOnly" }));
      const data = Array.isArray(result.data) ? result.data : [];
      const server = data.map(record).find(item => item.name === "openslate_probe");
      assert(server, "Missing fixture MCP server");
      const names = Object.keys(record(server.tools)).sort();
      assert(JSON.stringify(names) === JSON.stringify([...FIXTURE_TOOLS].sort()), "Unexpected fixture MCP catalog");
      return { names };
    });
    const call = (target: ProbeClient, id: string, tool: string) => target.request("mcpServer/tool/call",
      { threadId: id, server: "openslate_probe", tool, arguments: {} });
    await check("fake_mcp_call_original_epoch", async () => {
      const result = await call(client, threadId, "apply_change");
      assert(JSON.stringify(result).includes(oldEpoch.epochId), "Missing immutable original epoch");
      assert(gate.commits.length === 1, "Expected one fixture-only commit");
      return { fixtureOnly: true, commits: gate.commits.length };
    }, true);
    for (const method of ["turn/interrupt", "turn/steer"]) {
      await check(`${method}_inactive_negative_probe`, async () => {
        const params = method === "turn/interrupt" ? { threadId, turnId: "probe-no-such-turn" } :
          { threadId, expectedTurnId: "probe-no-such-turn", input: [] };
        try { const value = await client.request(method, params); return { response: value, activeTurnTested: false }; }
        catch (error) {
          assert(error instanceof RpcError && error.code !== -32601, "Method unavailable");
          return { ...failure(error), activeTurnTested: false };
        }
      }, true);
    }
    gate.setState(oldEpoch.credential, "revoked");
    await check("fake_mcp_old_credential_rejected", async () => {
      const count = gate.commits.length;
      const result = await call(client, threadId, "apply_change");
      assert(JSON.stringify(result).includes("AUTHORIZATION_EPOCH_REVOKED"), "Old bridge was not fenced");
      assert(gate.commits.length === count, "Revoked bridge mutated fixture state");
      return { fixtureOnly: true, unchangedCommitCount: count };
    }, true);
    await client.close();
    const nextEpoch = gate.issue(); await writeConfig(nextEpoch.credential);
    const next = launch(); await initialize(next);
    const resumed = await check("empty_thread_resume_after_process_replacement", () =>
      next.request("thread/resume", { threadId, ...threadParams }), true);
    let nextThreadId = record(record(resumed).thread).id;
    if (typeof nextThreadId !== "string") {
      const fresh = await next.request("thread/start", threadParams);
      nextThreadId = record(record(fresh).thread).id;
    }
    if (typeof nextThreadId === "string") {
      const id = nextThreadId;
      await check("fake_mcp_replacement_epoch", async () => {
        const result = await call(next, id, "read_context");
        assert(JSON.stringify(result).includes(nextEpoch.epochId), "Replacement did not use its own credential");
        return { fixtureOnly: true, replacedCredential: true, persistedThreadResumed: resumed !== undefined };
      }, true);
    }
  } catch (error) {
    report.checks.push({ name: "probe_execution", status: "failed", evidence: failure(error) });
  } finally {
    for (const client of clients) await client.close();
    report.safety.turnStartSent = clients.some(client => client.methodsSent.includes("turn/start"));
    report.safety.providerRequests = [...servers.providerRequests];
    await servers.close();
    await rm(root, { recursive: true, force: true });
    // Reports must never expose even the disposable fixture bridge credentials.
    for (const check of report.checks) {
      let json = JSON.stringify(check.evidence ?? null);
      for (const credential of credentials) json = json.replaceAll(credential, "[fixture-credential-redacted]");
      check.evidence = JSON.parse(json);
    }
  }
  return report;
}
