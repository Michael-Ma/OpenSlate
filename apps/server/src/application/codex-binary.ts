import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { CODEX_PROTOCOL_VERSION } from "@openslate/director";

export const supportedCodexInstall = (home = homedir()): string => join(home, ".local", "share", `openslate-codex-${CODEX_PROTOCOL_VERSION}`, "node_modules", ".bin", "codex");
export interface CodexVersionDiagnostic { code: "DIRECTOR_CODEX_VERSION_MISMATCH"; expectedVersion: string; foundVersion: string | null; binaryPath: string; installPath: string }
export interface CodexBinarySelection { binaryPath: string; diagnostic?: CodexVersionDiagnostic }
const validPath = (file: string | undefined): file is string => !!file && isAbsolute(file) && file.length <= 4096 && !file.includes("\0");
const installedPath = (file: string): string | null => {
  try { return existsSync(file) ? realpathSync(file) : null; } catch { return null; }
};

/** Version-only inspection. No native session, account discovery or inherited native environment. */
function readVersion(file: string, timeout: number): string | null {
  try {
    const output = execFileSync(file, ["--version"], { encoding: "utf8", timeout, maxBuffer: 4096, killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"], env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: "1", CI: "1" } }).trim();
    return /^codex-cli (\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]{1,120})?)$/.exec(output)?.[1] ?? null;
  } catch { return null; }
}

/** A saved/configured path keeps its identity. Only the effective launch path can fall back, with a notice. */
export function resolveConfiguredCodexBinary(binaryPath: string, options: {
  home?: string | undefined; version?: (file: string) => string | null;
} = {}): CodexBinarySelection {
  const pinned = installedPath(supportedCodexInstall(options.home)), configured = installedPath(binaryPath) ?? binaryPath;
  if (!pinned || pinned === configured) return { binaryPath: configured };
  const version = options.version ?? (file => readVersion(file, 1000)), foundVersion = version(configured);
  if (foundVersion === CODEX_PROTOCOL_VERSION || version(pinned) !== CODEX_PROTOCOL_VERSION) return { binaryPath: configured };
  return { binaryPath: pinned, diagnostic: { code: "DIRECTOR_CODEX_VERSION_MISMATCH", expectedVersion: CODEX_PROTOCOL_VERSION,
    foundVersion, binaryPath, installPath: supportedCodexInstall(options.home) } };
}

/** Host-only startup discovery. A broken explicit path remains visible if the supported install is unavailable. */
export function selectLocalCodexBinary(options: {
  environment?: Readonly<Record<string, string | undefined>>;
  home?: string | undefined;
  discovered?: readonly string[];
  matches?: (file: string) => boolean;
  now?: () => number;
  version?: (file: string) => string | null;
} = {}): CodexBinarySelection {
  const environment = options.environment ?? process.env;
  for (const configured of [environment.OPENSLATE_CODEX_BINARY, environment.OPENSLATE_CODEX_IMAGE_BINARY])
    if (validPath(configured)) return resolveConfiguredCodexBinary(configured, options);
  const pinned = installedPath(supportedCodexInstall(options.home));
  if (pinned) return { binaryPath: pinned };
  const candidates = options.discovered ?? ["/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex", "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex", ...((environment.PATH ?? "").split(":").filter(Boolean).map(path => join(path, "codex")))];
  const seen = new Set<string>(), now = options.now ?? (() => performance.now()), deadline = now() + 3000;
  const matches = options.matches ?? (file => readVersion(file, Math.max(1, Math.min(1000, Math.ceil(deadline - now())))) === CODEX_PROTOCOL_VERSION);
  for (const candidate of candidates.slice(0, 64)) {
    if (now() >= deadline) break;
    if (!validPath(candidate)) continue;
    const file = installedPath(candidate);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (matches(file)) return { binaryPath: file };
  }
  return { binaryPath: "" };
}
export const findLocalCodexBinary = (options: Parameters<typeof selectLocalCodexBinary>[0] = {}): string => selectLocalCodexBinary(options).binaryPath;
