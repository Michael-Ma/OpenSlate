import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CODEX_PROTOCOL_VERSION, normalizePermissionProfile, toml, validateOptions } from "./policy.js";
import type { CodexConfigValue, CodexDirectorOptions, CodexRuntimeLimits } from "./policy.js";
import { CodexTransport } from "./transport.js";
import { object, requireRuntime, RuntimeFault } from "./validation.js";

export interface LocalCodexSetupInput {
  command: { file: string; args?: readonly string[] };
  model: string;
  /** Existing native homes. OpenSlate never reads or copies their credential files. */
  nativeHome: string;
  codexHome: string;
  /** Complete environment apart from HOME/CODEX_HOME, which the explicit fields set. */
  env: Readonly<Record<string, string>>;
  /** Caller-owned directories, never a source checkout or a personal configuration directory. */
  directories: { projection: string; snapshots: string; storage: string };
  limits?: Partial<CodexRuntimeLimits>;
}
export type LocalCodexSetupCheck = "passed" | "failed" | "unverified";
export interface LocalCodexReadiness {
  status: "ready" | "blocked";
  checkedAt: string;
  runtimeVersion: typeof CODEX_PROTOCOL_VERSION;
  model: string;
  checks: Record<"binary" | "account" | "model" | "catalog" | "policy", LocalCodexSetupCheck>;
  disabledMcpCount: number;
  disabledSkillCount: number;
  issues: { code: string; message: string }[];
}
export interface LocalCodexSetupResult {
  /** Safe for the local UI. It deliberately excludes paths, email, config, env and native diagnostics. */
  readiness: LocalCodexReadiness;
  /** Backend-only. Never serialize this object into a health/API response. */
  runtimeOptions?: CodexDirectorOptions;
}
export interface LocalCodexSetupOptions { signal?: AbortSignal }

const PROFILE = "openslate_local";
const READ_METHODS = ["initialize", "config/read", "skills/list", "account/read", "model/list"] as const;
// Mirrors the pinned adapter's launch reductions. These settings are not independent isolation proof.
const DISABLED = ["apps", "plugins", "remote_plugin", "hooks", "shell_tool", "shell_snapshot", "unified_exec", "browser_use",
  "browser_use_external", "computer_use", "in_app_browser", "image_generation", "memories", "multi_agent", "multi_agent_v2",
  "skill_search", "skill_mcp_dependency_install", "tool_suggest", "sleep_tool", "workspace_dependencies", "code_mode", "unbounded_connection_retries"];
const validPath = (value: unknown): value is string => typeof value === "string" && isAbsolute(value) && value.length <= 4096 && !value.includes("\0");
const within = (parent: string, child: string): boolean => {
  const delta = relative(parent, child);
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`));
};
const overlap = (a: string, b: string): boolean => within(a, b) || within(b, a);

/** Resolve existing ancestors before creating anything; reject symlink aliases to protected roots. */
async function plannedPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    return join(await plannedPath(dirname(path)), relative(dirname(path), path));
  }
}
async function prepare(input: LocalCodexSetupInput): Promise<ReturnType<typeof validateOptions>> {
  requireRuntime(process.versions.node.split(".")[0] === "24", "SETUP_NODE_VERSION", "Local runtime setup requires Node 24");
  requireRuntime(validPath(input.command?.file) && validPath(input.nativeHome) && validPath(input.codexHome) &&
    input.directories && Object.values(input.directories).length === 3 &&
    [input.directories.projection, input.directories.snapshots, input.directories.storage].every(validPath),
  "SETUP_PATH_INVALID", "Select explicit absolute native and application paths");
  requireRuntime(input.command.args === undefined || (Array.isArray(input.command.args) && input.command.args.length <= 16 &&
    input.command.args.every(arg => typeof arg === "string" && arg.length <= 4096 && !arg.includes("\0"))),
  "SETUP_COMMAND_INVALID", "Native command arguments are invalid");
  requireRuntime(Object.keys(object(input.env)).length <= 128 && input.env && typeof input.env === "object" && !Array.isArray(input.env),
    "SETUP_ENV_INVALID", "Supply a bounded explicit native environment");
  const nativeHome = await realpath(input.nativeHome), codexHome = await realpath(input.codexHome);
  requireRuntime((await stat(nativeHome)).isDirectory() && (await stat(codexHome)).isDirectory(),
    "SETUP_AUTH_HOME_INVALID", "Selected native homes must already exist");
  const projection = await plannedPath(resolve(input.directories.projection));
  const snapshots = await plannedPath(resolve(input.directories.snapshots));
  const storage = await plannedPath(resolve(input.directories.storage));
  const state = await plannedPath(join(storage, "native-state")), logs = await plannedPath(join(storage, "logs"));
  requireRuntime(!overlap(projection, storage) && !overlap(snapshots, storage) &&
    [projection, snapshots, storage].every(path => path !== dirname(path) && !within(path, nativeHome) && !overlap(path, codexHome)) &&
    within(storage, state) && within(storage, logs) && state !== storage && logs !== storage && !overlap(state, logs),
  "SETUP_PATH_OVERLAP", "Application projections and runtime storage must exclude native authentication homes and each other");
  const profile = { filesystem: { ":root": "deny", ":minimal": "read", [projection]: "read", [snapshots]: "read",
    [await realpath(process.execPath)]: "read" }, network: { enabled: false } };
  const config: Record<string, CodexConfigValue> = {
    default_permissions: PROFILE, permissions: { [PROFILE]: profile }, sqlite_home: state, log_dir: logs,
    model: input.model, model_provider: "openai", model_reasoning_effort: "low", approval_policy: "never", web_search: "disabled",
    project_doc_max_bytes: 0, "analytics.enabled": false, "feedback.enabled": false, "history.persistence": "none",
    check_for_update_on_startup: false, "shell_environment_policy.inherit": "none", "shell_environment_policy.experimental_use_profile": false,
    "features.code_mode_host": true, "features.skip_host_skill_discovery": true, "features.default_mode_request_user_input": true,
  };
  for (const name of DISABLED) config[`features.${name}`] = false;
  const options = validateOptions({ command: structuredClone(input.command), cwd: projection,
    env: { ...input.env, HOME: nativeHome, CODEX_HOME: codexHome }, model: input.model, runtimeVersion: CODEX_PROTOCOL_VERSION,
    policy: { mode: "local", id: PROFILE, runtimeVersion: CODEX_PROTOCOL_VERSION, config },
    ...(input.limits ? { limits: input.limits } : {}) });
  // Make no changes in either native home. Existing directories retain their permissions.
  for (const path of [projection, snapshots, storage, state, logs]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    requireRuntime((await stat(path)).isDirectory() && await realpath(path) === path,
      "SETUP_DIRECTORY_CHANGED", "An application directory changed during setup");
  }
  return options;
}
async function verifyVersion(options: ReturnType<typeof validateOptions>, signal: AbortSignal): Promise<void> {
  await new Promise<void>((yes, no) => {
    execFile(options.command.file, [...(options.command.args ?? []), "--version"], { cwd: options.cwd, env: { ...options.env },
      timeout: options.limits.requestTimeoutMs, killSignal: "SIGKILL", maxBuffer: 4096, signal }, (error, stdout) => {
      if (error) no(new RuntimeFault(signal.aborted ? "SETUP_ABORTED" : "SETUP_BINARY_FAILED", "Selected native binary could not be checked"));
      else if (stdout.trim() !== `codex-cli ${CODEX_PROTOCOL_VERSION}`)
        no(new RuntimeFault("SETUP_VERSION_MISMATCH", "Select the pinned Codex 0.153.4 installation"));
      else yes();
    });
  });
}
async function session<T>(options: ReturnType<typeof validateOptions>, signal: AbortSignal,
  run: (rpc: (method: string, params: unknown) => Promise<unknown>) => Promise<T>): Promise<T> {
  requireRuntime(!signal.aborted, "SETUP_ABORTED", "Local runtime setup was cancelled");
  const args = [...(options.command.args ?? []), "app-server", "--strict-config",
    ...Object.entries(options.policy.config).flatMap(([key, value]) => ["-c", `${key}=${toml(value)}`])];
  requireRuntime(Buffer.byteLength(args.join("\0")) <= 128 * 1024, "SETUP_CATALOG_LIMIT", "Discovered catalog exceeds the native launch limit");
  const transport = new CodexTransport({ command: options.command.file, args, cwd: options.cwd, env: { ...options.env }, limits: options.limits,
    secrets: Object.values(options.env), allowedMethods: READ_METHODS, onMessage: message => {
      if (message.id !== undefined) {
        transport.rejectServerRequest(message.id);
        transport.fail(new RuntimeFault("SETUP_INTERACTIVE_DENIED", "Finish native authentication outside OpenSlate before checking again"));
      }
    } });
  try {
    const rpc = (method: string, params: unknown) => transport.request(method, params, signal);
    await rpc("initialize", { clientInfo: { name: "openslate-setup", version: "1" }, capabilities: { experimentalApi: true } });
    transport.notification("initialized");
    return await run(rpc);
  } finally { await transport.close(); }
}
function readServers(config: Record<string, unknown>): [string, unknown][] {
  const value = config.mcp_servers;
  requireRuntime(value === undefined || value === null || (typeof value === "object" && !Array.isArray(value)),
    "SETUP_CATALOG_INVALID", "Native MCP discovery returned an unsupported shape");
  const entries = Object.entries(object(value));
  requireRuntime(entries.length <= 128 && entries.every(([name, server]) => /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(name) &&
    server !== null && typeof server === "object" && !Array.isArray(server)),
  "SETUP_CATALOG_INVALID", "Native MCP catalog cannot be represented by the pinned adapter");
  return entries;
}
function readSkills(value: unknown, cwd: string): { path: string; enabled: boolean }[] {
  const data = object(value).data;
  requireRuntime(Array.isArray(data) && data.length === 1 && object(data[0]).cwd === cwd,
    "SETUP_SKILLS_INVALID", "Native skill discovery did not cover the selected workspace");
  const row = object(data[0]);
  requireRuntime(Array.isArray(row.errors) && row.errors.length === 0 && Array.isArray(row.skills) && row.skills.length <= 512,
    "SETUP_SKILLS_INVALID", "Native skill discovery failed or exceeded its limit");
  return row.skills.map(raw => { const skill = object(raw);
    requireRuntime(validPath(skill.path) && typeof skill.enabled === "boolean", "SETUP_SKILLS_INVALID", "Native skill metadata is invalid");
    return { path: skill.path, enabled: skill.enabled };
  });
}
async function checkModel(rpc: (method: string, params: unknown) => Promise<unknown>, model: string): Promise<void> {
  let cursor: string | undefined; const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const value = object(await rpc("model/list", { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) }));
    requireRuntime(Array.isArray(value.data) && value.data.length <= 100, "SETUP_MODEL_CATALOG_INVALID", "Native model catalog is invalid");
    const selected = value.data.map(object).find(item => item.model === model);
    if (selected) {
      requireRuntime(Array.isArray(selected.supportedReasoningEfforts) && selected.supportedReasoningEfforts.some(item => object(item).reasoningEffort === "low") &&
        (selected.inputModalities === undefined || (Array.isArray(selected.inputModalities) && selected.inputModalities.includes("text"))),
      "SETUP_MODEL_UNSUPPORTED", "Selected model does not advertise the adapter's text and low-effort contract");
      return;
    }
    if (value.nextCursor === undefined || value.nextCursor === null) throw new RuntimeFault("SETUP_MODEL_UNAVAILABLE", "Selected model is absent from the native model catalog");
    requireRuntime(typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 4096 && !seen.has(value.nextCursor),
      "SETUP_MODEL_CATALOG_INVALID", "Native model pagination is invalid");
    cursor = value.nextCursor; seen.add(cursor);
  }
  throw new RuntimeFault("SETUP_MODEL_CATALOG_LIMIT", "Native model discovery exceeded its page limit");
}

/** No thread, turn, login, refresh, configuration-write, or filesystem RPC is reachable here. */
export async function setupLocalCodex(supplied: LocalCodexSetupInput, options: LocalCodexSetupOptions = {}): Promise<LocalCodexSetupResult> {
  const readiness: LocalCodexReadiness = { status: "blocked", checkedAt: new Date().toISOString(), runtimeVersion: CODEX_PROTOCOL_VERSION,
    model: typeof supplied?.model === "string" && /^[A-Za-z0-9_.:/-]{1,120}$/.test(supplied.model) ? supplied.model : "invalid",
    checks: { binary: "unverified", account: "unverified", model: "unverified", catalog: "unverified", policy: "unverified" },
    disabledMcpCount: 0, disabledSkillCount: 0, issues: [] };
  let checking: keyof LocalCodexReadiness["checks"] = "policy";
  const cancellation = new AbortController(); let timedOut = false;
  const abort = () => cancellation.abort(); options.signal?.addEventListener("abort", abort, { once: true });
  // Bounds the complete discovery, including pagination and both native processes.
  const timer = setTimeout(() => { timedOut = true; cancellation.abort(); }, 60_000);
  try {
    requireRuntime(!options.signal?.aborted, "SETUP_ABORTED", "Local runtime setup was cancelled");
    const runtime = await prepare(structuredClone(supplied));
    checking = "binary"; await verifyVersion(runtime, cancellation.signal); readiness.checks.binary = "passed";
    checking = "catalog";
    await session(runtime, cancellation.signal, async rpc => {
      checking = "catalog";
      const config = object(object(await rpc("config/read", { cwd: runtime.cwd, includeLayers: false })).config);
      const servers = readServers(config);
      const skills = readSkills(await rpc("skills/list", { cwds: [runtime.cwd], forceReload: true }), runtime.cwd);
      // Copy only identifiers and disabled flags, never commands, args, URLs, env, tokens, or skill text.
      const policy = { ...runtime.policy.config };
      for (const [name] of servers) policy[`mcp_servers.${name}.enabled`] = false;
      const paths = [...new Set(skills.map(skill => skill.path))].sort();
      policy["skills.config"] = paths.map(path => ({ path, enabled: false }));
      runtime.policy = { ...runtime.policy, config: policy };
      readiness.disabledMcpCount = servers.length; readiness.disabledSkillCount = paths.length;
      checking = "account";
      const account = object(await rpc("account/read", { refreshToken: false }));
      requireRuntime(account.requiresOpenaiAuth === true && ["chatgpt", "apiKey"].includes(String(object(account.account).type)),
        "SETUP_AUTH_REQUIRED", "Sign in to the selected Codex installation before checking again");
      readiness.checks.account = "passed";
      checking = "model"; await checkModel(rpc, runtime.model); readiness.checks.model = "passed";
    });
    await session(runtime, cancellation.signal, async rpc => {
      checking = "policy";
      const config = object(object(await rpc("config/read", { cwd: runtime.cwd, includeLayers: false })).config);
      const expected = object(runtime.policy.config.permissions)[PROFILE];
      requireRuntime(config.default_permissions === PROFILE && isDeepStrictEqual(normalizePermissionProfile(object(config.permissions)[PROFILE]), normalizePermissionProfile(expected)),
        "SETUP_POLICY_MISMATCH", "Native permission profile differs from the exact local policy");
      requireRuntime(config.model === runtime.model && config.model_provider === "openai" && config.approval_policy === "never" &&
        config.model_reasoning_effort === "low" && config.web_search === "disabled" && config.check_for_update_on_startup === false &&
        object(config.analytics).enabled === false && object(config.feedback).enabled === false && object(config.history).persistence === "none" &&
        config.sqlite_home === runtime.policy.config.sqlite_home && config.log_dir === runtime.policy.config.log_dir &&
        config.project_doc_max_bytes === 0 && object(config.features).code_mode_host === true && object(config.features).skip_host_skill_discovery === true &&
        object(config.features).default_mode_request_user_input === true &&
        DISABLED.every(name => object(config.features)[name] === false) && object(config.shell_environment_policy).inherit === "none" &&
        object(config.shell_environment_policy).experimental_use_profile === false,
      "SETUP_CONFIG_MISMATCH", "Native configuration differs from the pinned local settings");
      readiness.checks.policy = "passed";
      checking = "catalog";
      requireRuntime(readServers(config).every(([, server]) => object(server).enabled === false),
        "SETUP_MCP_UNEXPECTED", "An inherited native MCP server remained enabled");
      requireRuntime(readSkills(await rpc("skills/list", { cwds: [runtime.cwd], forceReload: true }), runtime.cwd).every(skill => !skill.enabled),
        "SETUP_SKILLS_UNEXPECTED", "An inherited native skill remained enabled");
      readiness.checks.catalog = "passed";
    });
    requireRuntime(!cancellation.signal.aborted, "SETUP_ABORTED", "Local runtime setup was cancelled");
    readiness.status = "ready";
    return { readiness, runtimeOptions: runtime };
  } catch (error) {
    readiness.checks[checking] = "failed";
    // RuntimeFault messages are locally authored. Never expose an OS error, RPC body or child stderr.
    const issue = timedOut ? new RuntimeFault("SETUP_TIMEOUT", "Local runtime setup exceeded its time limit") :
      cancellation.signal.aborted ? new RuntimeFault("SETUP_ABORTED", "Local runtime setup was cancelled") :
      error instanceof RuntimeFault ? error : new RuntimeFault("SETUP_FAILED", "Local runtime setup could not complete; check selected paths and native installation");
    readiness.issues.push({ code: issue.code, message: issue.message });
    return { readiness };
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
