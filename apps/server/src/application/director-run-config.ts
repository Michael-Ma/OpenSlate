import { invariant } from "@openslate/core";
import { CODEX_MAX_RUN_TIMEOUT_MS, CODEX_RUNTIME_LIMITS } from "@openslate/director";

/** Trusted host setting, never supplied by a model or an HTTP command. */
export function readDirectorRunTimeout(environment: Readonly<Record<string, string | undefined>>): number {
  const raw = environment.OPENSLATE_DIRECTOR_RUN_TIMEOUT_MS;
  const value = raw === undefined || raw === "" ? CODEX_RUNTIME_LIMITS.runTimeoutMs : Number(raw);
  invariant((raw === undefined || raw === "" || /^[0-9]+$/.test(raw)) && Number.isSafeInteger(value)
    && value >= 1_000 && value <= CODEX_MAX_RUN_TIMEOUT_MS,
  "CONFIGURATION_ERROR", "OPENSLATE_DIRECTOR_RUN_TIMEOUT_MS must be an integer from 1000 to 600000");
  return value;
}
