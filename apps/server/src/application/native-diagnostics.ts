import type { NativeDiagnostic } from "@openslate/core";

const categories: readonly NativeDiagnostic["category"][] = ["native_timeout", "native_spawn_failed", "native_auth_required", "native_protocol", "native_rate_limited", "native_unknown"];

/** Copy only public diagnostic evidence, even when reading older or unexpected stored data. */
export function safeNativeDiagnostic(value: unknown): NativeDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { category, limitMs } = value as Record<string, unknown>;
  if (!categories.includes(category as NativeDiagnostic["category"])) return undefined;
  return { category: category as NativeDiagnostic["category"],
    ...(category === "native_timeout" && typeof limitMs === "number" && Number.isSafeInteger(limitMs) && limitMs > 0 && limitMs <= 600_000 ? { limitMs } : {}) };
}

/** Fixed fields only: no native error, stderr, account data, commands or filesystem paths. */
export function logNativeDiagnostic(operation: "director_setup" | "codex_image_prepare", projectId: string, diagnostic: NativeDiagnostic, attemptId?: string): void {
  console.warn("openslate.native_start_failed", { operation, projectId, ...(attemptId ? { attemptId } : {}), ...safeNativeDiagnostic(diagnostic) });
}
