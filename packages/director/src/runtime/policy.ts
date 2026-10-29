import { isAbsolute } from "node:path";
import { object, requireRuntime } from "./validation.js";
import type { PrivateCodexHome } from "./private-home.js";

export type CodexConfigValue = string | number | boolean | readonly CodexConfigValue[] | { readonly [key: string]: CodexConfigValue };
/** Updating this requires regenerating protocol fixtures and rerunning compatibility evidence. */
export const CODEX_PROTOCOL_VERSION = "0.153.4";
/** Pinned config/read serialization emits these absent optional fields as null.
 * Preserve every other field: stripping arbitrary nulls or comparing subsets could hide drift. */
export function normalizePermissionProfile(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = structuredClone(value) as Record<string, unknown>;
  const defaults = (target: unknown, keys: readonly string[]) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) return;
    const record = target as Record<string, unknown>;
    for (const key of keys) if (!Object.hasOwn(record, key)) record[key] = null;
  };
  defaults(result, ["description", "extends", "workspace_roots"]);
  defaults(result.filesystem, ["glob_scan_max_depth"]);
  defaults(result.network, ["proxy_url", "enable_socks5", "socks_url", "enable_socks5_udp", "allow_upstream_proxy",
    "dangerously_allow_non_loopback_proxy", "dangerously_allow_all_unix_sockets", "mode", "domains", "unix_sockets", "allow_local_binding", "mitm"]);
  return result;
}
/**
 * V0 runs on one local machine and trusts the pinned native runtime/sandbox.
 * This policy selects an exact permission configuration; it is not independent
 * code-host or credential-isolation proof. Remote deployment modes are unsupported.
 */
export interface LocalCodexPolicy {
  mode: "local";
  id: string;
  runtimeVersion: string;
  config: Readonly<Record<string, CodexConfigValue>>;
}
export interface CodexRuntimeLimits {
  /** Whole cold app-server preparation phase; ordinary RPCs retain their separate limit. */
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  runTimeoutMs: number;
  interruptGraceMs: number;
  shutdownGraceMs: number;
  outputBytes: number;
  eventQueue: number;
  eventTimeoutMs: number;
}
export const CODEX_RUNTIME_LIMITS: Readonly<CodexRuntimeLimits> = Object.freeze({
  startupTimeoutMs: 60_000, requestTimeoutMs: 15_000, runTimeoutMs: 180_000, interruptGraceMs: 3_000,
  shutdownGraceMs: 1_000, outputBytes: 16 * 1024 * 1024, eventQueue: 256, eventTimeoutMs: 5_000,
});
/** Host-configured planning turns may take longer; the default stays three minutes.
 * This bounds the complete native run, never a retry or an idle-time extension. */
export const CODEX_MAX_RUN_TIMEOUT_MS = 600_000;
export const CODEX_MAX_STARTUP_TIMEOUT_MS = 120_000;
export interface CodexDirectorOptions {
  /** An explicitly selected local binary; never resolved through PATH. */
  command: { file: string; args?: readonly string[] };
  cwd: string;
  /** Complete launch environment. No process.env merge or personal config/auth reads occur here. */
  env: Readonly<Record<string, string>>;
  /** Studio-owned instruction-free home, prepared again before each native launch. */
  privateCodexHome?: PrivateCodexHome;
  model: string;
  runtimeVersion: string;
  policy?: LocalCodexPolicy;
  limits?: Partial<CodexRuntimeLimits>;
}
export function validateOptions(supplied: CodexDirectorOptions): CodexDirectorOptions & { policy: LocalCodexPolicy; limits: CodexRuntimeLimits } {
  const value = structuredClone(supplied);
  requireRuntime(process.platform === "darwin" || process.platform === "linux", "RUNTIME_PLATFORM_UNSUPPORTED", "Native runtime process cleanup currently requires macOS or Linux");
  const policy = value.policy;
  requireRuntime(policy, "RUNTIME_POLICY_REQUIRED", "An explicit local runtime policy is required before native launch");
  requireRuntime(policy.mode === "local", "RUNTIME_MODE_UNSUPPORTED", "V0 supports only a single-machine local runtime");
  requireRuntime(/^[A-Za-z0-9_-]{1,80}$/.test(policy.id) && policy.runtimeVersion === value.runtimeVersion &&
    /^\d+\.\d+\.\d+$/.test(value.runtimeVersion), "RUNTIME_POLICY_INVALID", "Local runtime policy must match the pinned runtime version");
  requireRuntime(value.runtimeVersion === CODEX_PROTOCOL_VERSION, "RUNTIME_VERSION_UNSUPPORTED", "This adapter version has no compatibility evidence for the requested native version");
  requireRuntime(policy.config.default_permissions === policy.id &&
    (Object.keys(object(object(policy.config.permissions)[policy.id])).length > 0 ||
      Object.keys(policy.config).some(key => key.startsWith(`permissions.${policy.id}.`))) &&
    !Object.hasOwn(policy.config, "sandbox_mode"), "RUNTIME_POLICY_INVALID", "An explicit named permission configuration is required");
  requireRuntime(Object.keys(policy.config).every(key => /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(key)),
    "RUNTIME_POLICY_INVALID", "Configuration keys must be plain dotted names; use nested objects for filesystem paths");
  requireRuntime(typeof value.command?.file === "string" && isAbsolute(value.command.file) && isAbsolute(value.cwd) &&
    typeof value.model === "string" && /^[A-Za-z0-9_.:/-]{1,120}$/.test(value.model), "RUNTIME_CONFIG_INVALID", "Runtime paths and model must be explicit");
  requireRuntime(Object.entries(value.env).every(([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof item === "string" && !item.includes("\0")),
    "RUNTIME_CONFIG_INVALID", "Invalid explicit runtime environment");
  if (value.privateCodexHome !== undefined) {
    requireRuntime(value.privateCodexHome && [value.privateCodexHome.home, value.privateCodexHome.authSource].every(path =>
      typeof path === "string" && isAbsolute(path) && path.length <= 4096 && !/[\x00-\x1f\x7f]/.test(path)) &&
      value.env.CODEX_HOME === value.privateCodexHome.home,
    "RUNTIME_CONFIG_INVALID", "Private native home must match the explicit runtime environment");
  }
  const limits = { ...CODEX_RUNTIME_LIMITS };
  for (const key of Object.keys(limits) as (keyof CodexRuntimeLimits)[]) {
    const requested = value.limits?.[key];
    if (requested !== undefined) {
      const maximum = key === "runTimeoutMs" ? CODEX_MAX_RUN_TIMEOUT_MS : key === "startupTimeoutMs" ? CODEX_MAX_STARTUP_TIMEOUT_MS : limits[key];
      requireRuntime(Number.isSafeInteger(requested) && requested > 0 && requested <= maximum, "RUNTIME_CONFIG_INVALID", "Runtime limit exceeds its supported bound");
      limits[key] = requested;
    }
  }
  return { ...value, policy, limits };
}
export function toml(value: CodexConfigValue): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(",")}}`;
  requireRuntime(typeof value !== "number" || Number.isFinite(value), "RUNTIME_CONFIG_INVALID", "Invalid configuration number");
  return JSON.stringify(value);
}
