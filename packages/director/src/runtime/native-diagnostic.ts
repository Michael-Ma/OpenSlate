import type { NativeDiagnostic } from "@openslate/core";
import { RuntimeFault } from "./validation.js";

export type { NativeDiagnostic } from "@openslate/core";
const categories = new Set<NativeDiagnostic["category"]>(["native_timeout", "native_spawn_failed", "native_auth_required", "native_protocol", "native_rate_limited", "native_unknown"]);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
/** A whitelist projection only. Native text, paths, credentials and nested errors never escape. */
export function classifyNativeDiagnostic(error: unknown): NativeDiagnostic {
  const value = record(error), supplied = record(value.nativeDiagnostic);
  if (categories.has(supplied.category as NativeDiagnostic["category"])) {
    return { category: supplied.category as NativeDiagnostic["category"],
      ...(supplied.category === "native_timeout" && Number.isSafeInteger(supplied.limitMs) && Number(supplied.limitMs) > 0 && Number(supplied.limitMs) <= 600_000
        ? { limitMs: Number(supplied.limitMs) } : {}) };
  }
  const code = typeof value.code === "string" ? value.code : "";
  if (/TIMEOUT$/.test(code)) return { category: "native_timeout" };
  if (["ENOENT", "EACCES", "ENOEXEC", "RUNTIME_SPAWN_FAILED", "SETUP_BINARY_FAILED", "RUNTIME_VERSION_FAILED", "CODEX_IMAGE_BINARY_INVALID"].includes(code)) return { category: "native_spawn_failed" };
  if (["SETUP_AUTH_REQUIRED", "SETUP_INTERACTIVE_DENIED", "CODEX_IMAGE_CHATGPT_REQUIRED"].includes(code)) return { category: "native_auth_required" };
  // Structured native error identifiers/statuses are sufficient for common account/quota failures.
  const data = record(value.data), statuses = [value.status, value.statusCode, data.status, data.statusCode, value.code, data.code];
  // A generic JSON-RPC numeric envelope must not mask its structured native cause.
  const nativeCodes = [value.code, data.code, value.type, data.type].filter(item => typeof item === "string").map(item => String(item).toLowerCase());
  if (statuses.includes(429) || nativeCodes.some(item => /rate.?limit|usage.?limit|quota.?exceeded/.test(item))) return { category: "native_rate_limited" };
  if (statuses.includes(401) || statuses.includes(403) || nativeCodes.some(item => /auth|unauthorized|not.?logged.?in/.test(item))) return { category: "native_auth_required" };
  if (/^(RUNTIME_(PROTOCOL|VERSION_MISMATCH|POLICY|CONFIG_MISMATCH|CATALOG|SKILLS|BRIDGE|INSTRUCTIONS)|SETUP_(VERSION_MISMATCH|POLICY_MISMATCH|CONFIG_MISMATCH|CATALOG|SKILLS|MCP|MODEL_)|CODEX_IMAGE_(CONFIG_MISMATCH|THREAD_INVALID|CAPABILITY_UNAVAILABLE))/.test(code) || typeof value.code === "number" && [-32700, -32600, -32601, -32602, -32603].includes(value.code)) return { category: "native_protocol" };
  return { category: "native_unknown" };
}

/** Convert a private RPC rejection before discarding its body. */
export function nativeRpcFault(payload: unknown): RuntimeFault {
  return new RuntimeFault("RUNTIME_RPC_REJECTED", "Native runtime rejected the request", classifyNativeDiagnostic(payload));
}
export function nativeTimeoutFault(code: string, message: string, limitMs: number): RuntimeFault {
  return new RuntimeFault(code, message, { category: "native_timeout", limitMs });
}
