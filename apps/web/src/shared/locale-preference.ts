/** Interface language is a browser preference, never production/project authority. */
export type Locale = "en" | "zh-CN";
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
