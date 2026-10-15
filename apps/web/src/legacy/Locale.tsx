import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  localeHref,
  persistLocalePreference,
  readLocalePreference,
  resolveLocale,
  supportedLocale,
} from "./locale-model";
import type { Locale } from "./locale-model";
import { LocaleContext, useTranslation } from "./locale-context";
export { useTranslation } from "./locale-context";
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function browserLocale(): Locale {
  return resolveLocale(
    window.location.search,
    readLocalePreference(storage()),
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
}
export function initializeLocale(): Locale {
  const locale = typeof window === "undefined" ? "en" : browserLocale();
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  return locale;
}
export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, changeLocale] = useState<Locale>(
    () => initialLocale ?? initializeLocale(),
  );
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    const selected = supportedLocale(next);
    if (!selected) return;
    changeLocale(selected);
    persistLocalePreference(storage(), selected);
    try {
      window.history.replaceState(
        window.history.state,
        "",
        localeHref(window.location.href, selected),
      );
    } catch {
      /* Display language still changes in memory. */
    }
  }, []);
  useEffect(() => {
    const onPopState = () => changeLocale(browserLocale());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
export function LanguageSwitch() {
  const { locale, setLocale, t } = useTranslation();
  return (
    <label className="locale-switch">
      <span className="sr-only">{t("Language", "语言")}</span>
      <select
        value={locale}
        aria-label={t("Language", "语言")}
        onChange={(event) => {
          const next = supportedLocale(event.target.value);
          if (next) setLocale(next);
        }}
      >
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
    </label>
  );
}
