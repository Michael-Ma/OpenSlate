/** Browser-safe application identity; domain execution modules are server-only. */
export const APP_NAME = "OpenSlate";
export { joinPromptParts } from "./prompt-parts.js";
export * from "./clip-audio-mix.js";
export interface HealthResponse {
  name: typeof APP_NAME;
  status: "ok";
  stage: "foundation";
}
export type * from "./studio-api.js";
import type { NativeUnknownReason } from "./studio-api.js";
/** The allowlisted native_unknown stages (decision R1): a closed set, never native text. */
export const NATIVE_UNKNOWN_REASONS: readonly NativeUnknownReason[] = Object.freeze(["process_exit", "transport_failed", "worker_closed",
  "worker_busy", "cleanup_failed", "aborted", "completion_missing", "output_invalid", "identity_mismatch"]);
