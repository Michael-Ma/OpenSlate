import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { persistLocalePreference, type Locale } from "../../shared/locale-preference.ts";
import type { Msg } from "../model/types.ts";
import type { MessageValues } from "./format.ts";
import type { MessageId } from "./messages.ts";
import { translate, translateMsg } from "./translate.ts";
import { keepTogether } from "./typeset.ts";

interface I18nValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(id: MessageId, values?: MessageValues): string;
  tm(message: Msg): string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    try { persistLocalePreference(window.localStorage, next); } catch { /* storage unavailable */ }
  }, []);
  // Every string the interface shows comes through here, so this is where a number is kept on the line of its unit
  // and "about" on the line of its price (`keepTogether`); `translate` itself stays the plain catalog text.
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (id, values) => keepTogether(translate(locale, id, values)),
    tm: (message) => keepTogether(translateMsg(locale, message)),
  }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n needs an I18nProvider");
  return value;
}
