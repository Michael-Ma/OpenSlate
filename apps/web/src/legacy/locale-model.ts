import type { Locale } from "../shared/locale-preference.ts";
export type { Locale } from "../shared/locale-preference.ts";
export { LOCALE_STORAGE_KEY, supportedLocale, resolveLocale, readLocalePreference, persistLocalePreference } from "../shared/locale-preference.ts";
export type TranslationValues = Readonly<Record<string, string | number>>;
export type UiTranslations = Readonly<Record<string, string>>;
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
