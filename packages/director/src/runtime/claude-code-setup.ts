import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { CLAUDE_CODE_MODELS, CLAUDE_CODE_VERSION, claudeCodeEnvironment, claudeCommand, claudeIsolationArgs, claudePlanLogin, defaultClaudeBinary } from "./claude-code-process.js";
import type { ClaudeCodeModel } from "./claude-code-process.js";

export interface LocalClaudeCodeSetupInput { binaryPath?: string; model?: ClaudeCodeModel }
export interface LocalClaudeCodeSetupResult {
  status: "ready" | "blocked" | "missing" | "unchecked";
  binaryPath: string | null;
  version: string | null;
  reason?: string;
}
/** Host-only injection; browser input cannot select an environment, wrapper arguments or a deadline. */
export interface LocalClaudeCodeSetupOptions { env?: Readonly<NodeJS.ProcessEnv>; signal?: AbortSignal; timeoutMs?: number }

export async function setupLocalClaudeCode(input: LocalClaudeCodeSetupInput = {}, options: LocalClaudeCodeSetupOptions = {}): Promise<LocalClaudeCodeSetupResult> {
  const source = options.env ?? process.env, env = claudeCodeEnvironment(source);
  let binaryPath: string | null = null, version: string | null = null;
  const explicit = input.binaryPath ?? source.OPENSLATE_CLAUDE_BINARY;
  const candidates = explicit ? [explicit] : [defaultClaudeBinary(source), ...env.PATH!.split(":").filter(isAbsolute).map(path => join(path, "claude"))];
  for (const path of candidates) {
    if (!isAbsolute(path) || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) continue;
    try { await access(path, constants.X_OK); binaryPath = path; break; } catch {}
  }
  if (!binaryPath) return { status: "missing", binaryPath: explicit ?? null, version, reason: "Install Claude Code or select its executable" };
  const result = (status: LocalClaudeCodeSetupResult["status"], reason?: string): LocalClaudeCodeSetupResult => ({ status, binaryPath, version, ...(reason ? { reason } : {}) });
  if (!CLAUDE_CODE_MODELS.some(model => model.id === (input.model ?? "claude-opus-5-5"))) return result("blocked", "Choose Opus 5.5 or Sonnet 5.5");
  const run = (args: string[]) => claudeCommand({ file: binaryPath! }, args, env, options.signal, options.timeoutMs);
  try {
    const found = await run(["--version"]);
    version = /^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/.exec(found.stdout)?.[1] ?? null;
    if (found.code !== 0 || version !== CLAUDE_CODE_VERSION) return result("blocked", `Claude Code ${CLAUDE_CODE_VERSION} is required`);
    const help = await run(["auth", "--help"]);
    if (help.code !== 0 || !/\bstatus\b/.test(help.stdout)) return result("unchecked", "Claude Code sign-in was not checked; this version offers no auth status command");
    const checked = await run([...claudeIsolationArgs(), "auth", "status", "--json"]);
    const auth = claudePlanLogin(JSON.parse(checked.stdout));
    if (auth === "signed_out") return result("blocked", "Sign in to Claude Code first");
    if (auth !== "ready") return result("blocked", "Sign in to Claude Code with your Claude subscription plan");
    return checked.code === 0 ? result("ready") : result("blocked", "Sign in to Claude Code first");
  } catch { return result("blocked", options.signal?.aborted ? "Claude Code setup was cancelled" : "Claude Code setup could not be checked"); }
}
