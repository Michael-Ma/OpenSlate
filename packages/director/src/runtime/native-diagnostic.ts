import type { NativeDiagnostic, NativeUnknownReason } from "@openslate/core";
import { NATIVE_UNKNOWN_REASONS } from "@openslate/core";
import { RuntimeFault } from "./validation.js";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type { NativeDiagnostic } from "@openslate/core";
const categories = new Set<NativeDiagnostic["category"]>(["native_timeout", "native_spawn_failed", "native_auth_required", "native_protocol", "native_rate_limited", "native_unknown", "native_instructions_unexpected"]);
/**
 * Exact locally authored worker codes for stages that leave the outcome unexplained (decision R1). They narrow
 * native_unknown to a closed reason; they never change the category, retry or charge rules, and nothing else maps.
 */
const unknownReasons: ReadonlyMap<string, NativeUnknownReason> = new Map(Object.entries({
  process_exit: ["RUNTIME_PROCESS_EXIT", "CODEX_IMAGE_PREPARED_PROCESS_LOST"],
  transport_failed: ["RUNTIME_TRANSPORT_FAILED"],
  worker_closed: ["RUNTIME_CLOSED", "CODEX_IMAGE_CLOSED", "CODEX_IMAGE_UNAVAILABLE"],
  worker_busy: ["RUNTIME_BUSY", "CODEX_IMAGE_BUSY"],
  cleanup_failed: ["RUNTIME_CLEANUP_FAILED", "CODEX_IMAGE_CLEANUP_FAILED"],
  aborted: ["RUNTIME_ABORTED", "CODEX_IMAGE_ABORTED", "SETUP_ABORTED"],
  completion_missing: ["RUNTIME_COMPLETION_UNKNOWN", "CODEX_IMAGE_COMPLETION_MISSING", "CODEX_IMAGE_TURN_MISSING"],
  output_invalid: ["CODEX_IMAGE_OUTPUT_INVALID", "CODEX_IMAGE_MULTIPLE_OUTPUTS", "CODEX_IMAGE_ITEM_INVALID", "CODEX_IMAGE_ITEM_CONFLICT",
    "CODEX_IMAGE_BYTES_UNAVAILABLE", "CODEX_IMAGE_HISTORY_INVALID", "CODEX_IMAGE_HISTORY_LIMIT"],
  identity_mismatch: ["CODEX_IMAGE_TURN_MISMATCH", "CODEX_IMAGE_THREAD_MISMATCH", "CODEX_IMAGE_SESSION_MISMATCH", "CODEX_IMAGE_SESSION_INVALID",
    "CODEX_IMAGE_TURN_INVALID"],
}).flatMap(([reason, codes]) => codes.map(code => [code, reason as NativeUnknownReason])));
const unknownWith = (reason: unknown): NativeDiagnostic => (NATIVE_UNKNOWN_REASONS as readonly unknown[]).includes(reason)
  ? { category: "native_unknown", reason: reason as NativeUnknownReason } : { category: "native_unknown" };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const printablePath = (value: unknown): value is string => typeof value === "string" && value.length <= 4096 &&
  /^(?:\/|~\/)(?!\/)/.test(value) && !/[\\\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(value) &&
  value.split("/").slice(1).every(part => part !== "" && part !== "." && part !== "..");
/** Retain file/folder identities only, never a native source's contents or other fields. */
export function instructionSourcesDiagnostic(sources: unknown, home?: string): NativeDiagnostic {
  const files = new Set<string>();
  if (Array.isArray(sources)) for (const source of sources.slice(0, 512)) {
    // The pinned native protocol reports strings; retain object-path compatibility
    // for older host fixtures without ever projecting their other fields.
    const path = typeof source === "string" ? source : record(source).path;
    if (typeof path !== "string" || !isAbsolute(path) || !printablePath(path)) continue;
    const normalized = resolve(path), delta = home && isAbsolute(home) ? relative(resolve(home), normalized) : undefined;
    const display = delta !== undefined && delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta)
      ? `~/${delta}` : normalized;
    if (printablePath(display)) files.add(display);
    if (files.size === 32) break;
  }
  return { category: "native_instructions_unexpected", instructionFiles: [...files] };
}
/** A whitelist projection only. Native prose, credentials and nested errors never escape. */
export function classifyNativeDiagnostic(error: unknown): NativeDiagnostic {
  const value = record(error), supplied = record(value.nativeDiagnostic);
  if (categories.has(supplied.category as NativeDiagnostic["category"])) {
    return { category: supplied.category as NativeDiagnostic["category"],
      ...(supplied.category === "native_timeout" && Number.isSafeInteger(supplied.limitMs) && Number(supplied.limitMs) > 0 && Number(supplied.limitMs) <= 600_000
        ? { limitMs: Number(supplied.limitMs) } : {}),
      ...(supplied.category === "native_instructions_unexpected" && Array.isArray(supplied.instructionFiles)
        ? { instructionFiles: [...new Set(supplied.instructionFiles.filter(printablePath))].slice(0, 32) } : {}),
      ...(supplied.category === "native_unknown" && (NATIVE_UNKNOWN_REASONS as readonly unknown[]).includes(supplied.reason)
        ? { reason: supplied.reason as NativeUnknownReason } : {}) };
  }
  const code = typeof value.code === "string" ? value.code : "";
  if (["RUNTIME_INSTRUCTIONS_UNEXPECTED", "SETUP_INSTRUCTIONS_UNEXPECTED"].includes(code)) return { category: "native_instructions_unexpected" };
  if (/TIMEOUT$/.test(code)) return { category: "native_timeout" };
  if (["ENOENT", "EACCES", "ENOEXEC", "RUNTIME_SPAWN_FAILED", "SETUP_BINARY_FAILED", "RUNTIME_VERSION_FAILED", "CODEX_IMAGE_BINARY_INVALID"].includes(code)) return { category: "native_spawn_failed" };
  if (["SETUP_AUTH_REQUIRED", "SETUP_INTERACTIVE_DENIED", "CODEX_IMAGE_CHATGPT_REQUIRED", "CODEX_IMAGE_INTERACTIVE_DENIED"].includes(code)) return { category: "native_auth_required" };
  // Structured native error identifiers/statuses are sufficient for common account/quota failures.
  const data = record(value.data), statuses = [value.status, value.statusCode, data.status, data.statusCode, value.code, data.code];
  // A generic JSON-RPC numeric envelope must not mask its structured native cause.
  // Words, not substrings: "AUTHORIZATION_EPOCH_REVOKED" is the app's own authority fence, not a Codex sign-in.
  const nativeCodes = [value.code, data.code, value.type, data.type].filter(item => typeof item === "string").map(item => String(item).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[_\-.]+/g, " "));
  if (statuses.includes(429) || nativeCodes.some(item => /\b(rate ?limit(ed)?|usage ?limit|quota ?exceeded)\b/.test(item))) return { category: "native_rate_limited" };
  if (statuses.includes(401) || nativeCodes.some(item => /\b(unauthori[sz]ed|unauthenticated|not ?logged ?in|login ?required|auth(entication)? ?(required|expired|failed|invalid))\b/.test(item)))
    return { category: "native_auth_required" };
  // These locally authored preparation guards prove a setup/configuration mismatch.
  // Keep the allowlist exact: closed/busy workers and unexplained native exits do not prove one.
  if (["RUNTIME_PLATFORM_UNSUPPORTED", "RUNTIME_MODE_UNSUPPORTED", "RUNTIME_VERSION_UNSUPPORTED", "RUNTIME_CONFIG_INVALID",
    "RUNTIME_METHOD_DENIED", "RUNTIME_OUTPUT_LIMIT", "RUNTIME_REQUEST_TOO_LARGE", "RUNTIME_BACKPRESSURE", "RUNTIME_REQUEST_LIMIT",
    "SETUP_NODE_VERSION", "SETUP_PATH_INVALID", "SETUP_PATH_OVERLAP", "SETUP_COMMAND_INVALID", "SETUP_ENV_INVALID",
    "SETUP_AUTH_HOME_INVALID", "SETUP_AUTH_LINK_INVALID", "SETUP_DIRECTORY_CHANGED", "CODEX_IMAGE_PLATFORM_UNSUPPORTED",
    "CODEX_IMAGE_MODEL_UNSUPPORTED", "CODEX_IMAGE_ENV_INVALID", "CODEX_IMAGE_LIMIT_INVALID", "CODEX_IMAGE_PATH_INVALID",
    "CODEX_IMAGE_CONFIG_LIMIT", "CODEX_IMAGE_MCP_UNEXPECTED", "CODEX_IMAGE_BINARY_CHANGED", "CODEX_IMAGE_FILE_INVALID",
    "CODEX_IMAGE_FILE_CHANGED", "CODEX_IMAGE_REFERENCE_CHANGED", "CODEX_IMAGE_REFERENCE_INVALID"].includes(code)) return { category: "native_protocol" };
  if (/^(RUNTIME_(PROTOCOL|VERSION_MISMATCH|POLICY|CONFIG_MISMATCH|CATALOG|SKILLS|BRIDGE|INSTRUCTIONS)|SETUP_(VERSION_MISMATCH|POLICY_MISMATCH|CONFIG_MISMATCH|CATALOG|SKILLS|MCP|MODEL_)|CODEX_IMAGE_(CONFIG_MISMATCH|THREAD_INVALID|CAPABILITY_UNAVAILABLE))/.test(code) || typeof value.code === "number" && [-32700, -32600, -32601, -32602, -32603].includes(value.code)) return { category: "native_protocol" };
  return unknownWith(unknownReasons.get(code));
}

/** Convert a private RPC rejection before discarding its body. */
export function nativeRpcFault(payload: unknown): RuntimeFault {
  return new RuntimeFault("RUNTIME_RPC_REJECTED", "Native runtime rejected the request", classifyNativeDiagnostic(payload));
}
export function nativeTimeoutFault(code: string, message: string, limitMs: number): RuntimeFault {
  return new RuntimeFault(code, message, { category: "native_timeout", limitMs });
}
