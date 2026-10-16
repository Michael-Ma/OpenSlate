import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { CODEX_PROTOCOL_VERSION } from "@openslate/director";

export const supportedCodexInstall = (home = homedir()): string => join(home, ".local", "share", "openslate-codex", "node_modules", ".bin", "codex");
const validPath = (file: string | undefined): file is string => !!file && isAbsolute(file) && file.length <= 4096 && !file.includes("\0");
const installedPath = (file: string): string | null => {
  try { return existsSync(file) ? realpathSync(file) : null; } catch { return null; }
};

/** Version-only inspection. No native session, account discovery or inherited native environment. */
function matchesVersion(file: string, timeout: number): boolean {
  try {
    return execFileSync(file, ["--version"], { encoding: "utf8", timeout, maxBuffer: 4096, killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"], env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: "1", CI: "1" } }).trim() === `codex-cli ${CODEX_PROTOCOL_VERSION}`;
  } catch { return false; }
}

/** Host-only startup discovery. Explicit configuration remains visible even if it needs repair. */
export function findLocalCodexBinary(options: {
  environment?: Readonly<Record<string, string | undefined>>;
  home?: string;
  discovered?: readonly string[];
  matches?: (file: string) => boolean;
  now?: () => number;
} = {}): string {
  const environment = options.environment ?? process.env;
  for (const configured of [environment.OPENSLATE_CODEX_BINARY, environment.OPENSLATE_CODEX_IMAGE_BINARY])
    if (validPath(configured)) return installedPath(configured) ?? configured;
  const pinned = installedPath(supportedCodexInstall(options.home));
  if (pinned) return pinned;
  const candidates = options.discovered ?? ["/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex", "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex", ...((environment.PATH ?? "").split(":").filter(Boolean).map(path => join(path, "codex")))];
  const seen = new Set<string>(), now = options.now ?? (() => performance.now()), deadline = now() + 3000;
  const matches = options.matches ?? (file => matchesVersion(file, Math.max(1, Math.min(1000, Math.ceil(deadline - now())))));
  for (const candidate of candidates.slice(0, 64)) {
    if (now() >= deadline) break;
    if (!validPath(candidate)) continue;
    const file = installedPath(candidate);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (matches(file)) return file;
  }
  return "";
}
