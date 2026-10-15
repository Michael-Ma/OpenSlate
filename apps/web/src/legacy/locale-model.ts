/** Interface language is a browser preference, never production/project authority. */
export type Locale = "en" | "zh-CN";
export type TranslationValues = Readonly<Record<string, string | number>>;
export type UiTranslations = Readonly<Record<string, string>>;
export const LOCALE_STORAGE_KEY = "openslate.locale";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export function supportedLocale(value: unknown): Locale | null {
  return value === "en"
    ? "en"
    : value === "zh" || value === "zh-CN"
      ? "zh-CN"
      : null;
}
export function resolveLocale(
  search: string,
  stored: unknown,
  languages: readonly string[] = [],
): Locale {
  const explicit =
    supportedLocale(new URLSearchParams(search).get("lang")) ??
    supportedLocale(stored);
  if (explicit) return explicit;
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh-CN";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return "en";
}
export function readLocalePreference(
  storage: PreferenceStorage | null,
): Locale | null {
  try {
    return supportedLocale(storage?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}
export function persistLocalePreference(
  storage: PreferenceStorage | null,
  locale: Locale,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}
export function localeHref(href: string, locale: Locale): string {
  const url = new URL(href);
  url.searchParams.set("lang", locale);
  return url.href;
}
/** Values are interpolated once and never translated or interpreted as markup. */
export function translate(
  locale: Locale,
  english: string,
  chinese: string,
  values: TranslationValues = {},
): string {
  return (locale === "zh-CN" ? chinese : english).replace(
    /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,
    (token, key: string) =>
      Object.hasOwn(values, key) ? String(values[key]) : token,
  );
}
/** Only explicitly registered interface copy qualifies; unknown/dynamic content is preserved. */
export function translateUiText(
  text: string,
  locale: Locale,
  translations: UiTranslations,
): string {
  if (locale === "zh-CN") return translations[text] ?? text;
  for (const [english, chinese] of Object.entries(translations))
    if (text === chinese) return english;
  return text;
}
