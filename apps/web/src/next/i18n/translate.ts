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
export function errorMsg(code: string): Msg {
  const id = `error.${code}`;
  return isMessageId(id) ? { id } : { id: "error.unknown", values: { code } };
}

/** Number formatting that follows the interface language. */
export function numberLocale(locale: Locale): string {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}
