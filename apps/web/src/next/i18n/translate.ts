import type { Locale } from "../../shared/locale-preference.ts";
import type { Msg } from "../model/types.ts";
import { formatMessage, type MessageValues } from "./format.ts";
import { catalog, isMessageId, type MessageId } from "./messages.ts";

export function translate(locale: Locale, id: MessageId, values?: MessageValues): string {
  const entry = catalog[id];
  return formatMessage(locale === "zh-CN" ? entry.zh : entry.en, values, locale === "zh-CN" ? "zh" : "en");
}

export function translateMsg(locale: Locale, message: Msg): string {
  return translate(locale, message.id, message.values);
}

/** Server codes map to messages by id; an unknown code still says which code it was. */
export function errorMsg(code: string, details?: Readonly<Record<string, unknown>>): Msg {
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
