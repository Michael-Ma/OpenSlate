import type { NativeDiagnostic, NativeUnknownReason } from "@openslate/core";
import { NATIVE_UNKNOWN_REASONS } from "@openslate/core";

const categories: readonly NativeDiagnostic["category"][] = ["native_timeout", "native_spawn_failed", "native_auth_required", "native_protocol", "native_rate_limited", "native_unknown", "native_instructions_unexpected"];
const instructionFile = (value: unknown): value is string => typeof value === "string" && value.length <= 4096 &&
  /^(?:\/|~\/)(?!\/)/.test(value) && !/[\\\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(value) &&
  value.split("/").slice(1).every(part => part !== "" && part !== "." && part !== "..");

/** Copy only public diagnostic evidence, even when reading older or unexpected stored data. */
export function safeNativeDiagnostic(value: unknown): NativeDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { category, limitMs, instructionFiles, reason } = value as Record<string, unknown>;
  if (!categories.includes(category as NativeDiagnostic["category"])) return undefined;
  return { category: category as NativeDiagnostic["category"],
    ...(category === "native_timeout" && typeof limitMs === "number" && Number.isSafeInteger(limitMs) && limitMs > 0 && limitMs <= 600_000 ? { limitMs } : {}),
    ...(category === "native_instructions_unexpected" && Array.isArray(instructionFiles)
      ? { instructionFiles: [...new Set(instructionFiles.filter(instructionFile))].slice(0, 32) } : {}),
    ...(category === "native_unknown" && (NATIVE_UNKNOWN_REASONS as readonly unknown[]).includes(reason) ? { reason: reason as NativeUnknownReason } : {}) };
}

/** Fixed fields only: no native prose, credentials or commands; source paths are allowlisted metadata. */
export function logNativeDiagnostic(operation: "director_setup" | "codex_image_prepare" | "codex_image_unresolved", projectId: string, diagnostic: NativeDiagnostic, attemptId?: string): void {
  console.warn("openslate.native_start_failed", { operation, projectId, ...(attemptId ? { attemptId } : {}), ...safeNativeDiagnostic(diagnostic) });
}
