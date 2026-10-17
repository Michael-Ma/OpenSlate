import type { Locale } from "../../shared/locale-preference.ts";
import type { Msg } from "../model/types.ts";
import { formatMessage, type MessageValues } from "./format.ts";
import { catalog, isMessageId, type MessageId } from "./messages.ts";

const NATIVE_CATEGORIES = ["native_timeout", "native_spawn_failed", "native_auth_required", "native_protocol", "native_rate_limited", "native_unknown"] as const;

/** Native text is never display copy: only an allowlisted category and a bounded numeric limit cross here. */
export function nativeDiagnosticMsg(diagnostic: unknown, context: "setup" | "images", notDispatched = false): Msg | null {
  if (!diagnostic || typeof diagnostic !== "object") return null;
  const { category, limitMs } = diagnostic as { category?: unknown; limitMs?: unknown };
  if (typeof category !== "string" || !(NATIVE_CATEGORIES as readonly string[]).includes(category)) return null;
  const timed = category === "native_timeout" && typeof limitMs === "number" && Number.isFinite(limitMs) && limitMs > 0 && limitMs <= 600_000;
  const id = `error.${context === "setup" ? "DIRECTOR_SETUP" : "CODEX_IMAGES"}_${category}${category === "native_timeout" && !timed ? "_no_limit" : ""}`;
  if (!isMessageId(id)) return null;
  return { id, values: { ...(timed ? { seconds: Math.round(limitMs / 100) / 10 } : {}), ...(context === "images" ? { notDispatched: notDispatched === true ? 1 : 0 } : {}) } };
}

export function translate(locale: Locale, id: MessageId, values?: MessageValues): string {
  const entry = catalog[id];
  return formatMessage(locale === "zh-CN" ? entry.zh : entry.en, values, locale === "zh-CN" ? "zh" : "en");
}

export function translateMsg(locale: Locale, message: Msg): string {
  return translate(locale, message.id, message.values);
}

/** Server codes map to messages by id; an unknown code still says which code it was. */
export function errorMsg(code: string, details?: Readonly<Record<string, unknown>>): Msg {
  if (code === "DIRECTOR_SETUP_REQUIRED" && details) {
    const native = nativeDiagnosticMsg(details.nativeDiagnostic, "setup");
    if (native) return native;
  }
  if (code === "DIRECTOR_CODEX_VERSION_MISMATCH" && details) {
    const { expectedVersion, foundVersion, binaryPath, installPath } = details;
    const version = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]{1,120})?$/.test(value);
    const path = (value: unknown): value is string => typeof value === "string" && value.startsWith("/") && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value);
    if (version(expectedVersion) && path(binaryPath) && path(installPath)) {
      const values = { expectedVersion, binaryPath, installPath };
      if (version(foundVersion)) return { id: "error.DIRECTOR_CODEX_VERSION_DETAILS", values: { ...values, foundVersion } };
      if (foundVersion === null) return { id: "error.DIRECTOR_CODEX_VERSION_UNREADABLE", values };
    }
  }
  const id = `error.${code}`;
  return isMessageId(id) ? { id } : { id: "error.unknown", values: { code } };
}

/** Number formatting that follows the interface language. */
export function numberLocale(locale: Locale): string {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}
