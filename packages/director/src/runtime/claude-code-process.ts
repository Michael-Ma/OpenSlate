import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { object, requireRuntime, RuntimeFault } from "./validation.js";

export const CLAUDE_CODE_VERSION = "2.1.312";
/** Claude Code updates itself. Any 2.x from the tested version on is accepted; the init checks still hold each run to the isolation it needs. */
export function supportedClaudeCodeVersion(version: unknown): boolean {
  const parse = (value: string) => value.split(".").map(Number);
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor, patch] = parse(version), [baseMajor, baseMinor, basePatch] = parse(CLAUDE_CODE_VERSION);
  return major === baseMajor && (minor! > baseMinor! || minor === baseMinor && patch! >= basePatch!);
}
export const CLAUDE_CODE_MODELS = Object.freeze([
  { id: "claude-opus-5-5", label: "Opus 5.5" }, { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
] as const);
export type ClaudeCodeModel = typeof CLAUDE_CODE_MODELS[number]["id"];

/** The sole environment builder for version, auth and print. No inherited provider/terminal variables. */
export function claudeCodeEnvironment(source: Readonly<NodeJS.ProcessEnv> = process.env): Record<string, string> {
  const env: Record<string, string> = {
    HOME: source.HOME ?? homedir(), PATH: source.PATH ?? `${dirname(process.execPath)}:/usr/bin:/bin`,
  };
  for (const key of ["USER", "LOGNAME", "LANG", "TMPDIR"])
    if (typeof source[key] === "string") env[key] = source[key];
  requireRuntime(Object.values(env).every(value => !value.includes("\0")), "RUNTIME_CONFIG_INVALID", "Invalid local Claude environment");
  return env;
}
export const claudeIsolationArgs = () => ["--restricted", "--setting-sources", "", "--settings",
  // Safe mode disables even our explicit MCP bridge in 2.1.312; restricted mode keeps it.
  // The built-in agent loader retains general-purpose/Explore/Plan unless disabled below.
  // Its noninteractive loader explicitly returns [] for this setting. Supply it as trusted
  // session settings, never inherited environment; the actual spawn env stays allow-listed.
  JSON.stringify({ disableAllHooks: true, enabledPlugins: {}, env: { CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1" } }),
  "--disable-slash-commands", "--no-chrome"];

export function claudePlanLogin(value: unknown): "ready" | "signed_out" | "not_on_plan" {
  const auth = object(value);
  if (auth.loggedIn !== true) return "signed_out";
  return auth.authMethod === "claude.ai" && auth.apiProvider === "firstParty" && (auth.apiKeySource == null || auth.apiKeySource === "none")
    && ["pro", "max", "team", "enterprise"].includes(String(auth.subscriptionType)) ? "ready" : "not_on_plan";
}

export function spawnClaude(command: { file: string; args?: readonly string[] }, args: readonly string[], cwd: string,
  env: Record<string, string>): ChildProcessWithoutNullStreams {
  return spawn(command.file, [...(command.args ?? []), ...args], { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
}
/** Always clean the group, including children left behind by an exited parent. */
export async function stopClaude(child: ChildProcessWithoutNullStreams, graceMs: number): Promise<void> {
  const alive = () => {
    if (child.pid === undefined) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      // macOS can transiently deny a group probe while a child is exiting/reaping.
      // It remains unconfirmed, and is probed again within the bounded grace period.
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
      throw error;
    }
  };
  const signal = (value: NodeJS.Signals) => { if (child.pid !== undefined) try { process.kill(-child.pid, value); } catch {} };
  const wait = async () => {
    const end = Date.now() + graceMs;
    while (alive() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
    return !alive();
  };
  child.stdin.destroy();
  if (!alive()) return;
  signal("SIGTERM"); if (await wait()) return;
  signal("SIGKILL");
  requireRuntime(await wait(), "RUNTIME_CLEANUP_FAILED", "Claude Code process group cleanup was not confirmed");
}

/** Small non-model commands. Raw stdout is used transiently and never persisted or included in errors. */
export async function claudeCommand(command: { file: string; args?: readonly string[] }, args: readonly string[],
  env: Record<string, string>, signal?: AbortSignal, timeoutMs = 10_000): Promise<{ code: number | null; stdout: string }> {
  requireRuntime(!signal?.aborted, "RUNTIME_ABORTED", "Director run was cancelled");
  const child = spawnClaude(command, args, env.TMPDIR ?? "/tmp", env);
  let bytes = 0, stdout = "", problem: RuntimeFault | undefined;
  let fail!: (error: RuntimeFault) => void;
  const failed = new Promise<never>((_, reject) => { fail = error => { problem ??= error; reject(problem); }; });
  const abort = () => fail(new RuntimeFault("RUNTIME_ABORTED", "Director run was cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => fail(new RuntimeFault("CLAUDE_CODE_CHECK_TIMEOUT", "Claude Code check timed out")), timeoutMs);
  const collect = (chunk: Buffer, output: boolean) => {
    bytes += chunk.length;
    if (bytes > 64 * 1024) fail(new RuntimeFault("CLAUDE_CODE_CHECK_FAILED", "Claude Code check exceeded its output limit"));
    else if (output) stdout += chunk.toString("utf8");
  };
  child.stdout.on("data", chunk => collect(chunk, true)); child.stderr.on("data", chunk => collect(chunk, false));
  for (const stream of [child.stdout, child.stderr]) stream.on("error", () => fail(new RuntimeFault("CLAUDE_CODE_CHECK_FAILED", "Claude Code check stream failed")));
  child.stdin.on("error", () => {}); child.stdin.end();
  try {
    const code = await Promise.race([failed, new Promise<number | null>((resolve, reject) => {
      child.once("error", () => reject(new RuntimeFault("CLAUDE_CODE_CHECK_FAILED", "Claude Code could not start"))); child.once("close", resolve);
    })]);
    if (problem) throw problem;
    return { code, stdout };
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); await stopClaude(child, 1000); }
}

export const defaultClaudeBinary = (env: Readonly<NodeJS.ProcessEnv> = process.env) => env.OPENSLATE_CLAUDE_BINARY ?? join(env.HOME ?? homedir(), ".local", "bin", "claude");
