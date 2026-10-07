/** Appearance is UI preference only; it never replaces project or conversation state. */
export type AppearanceMode = "day" | "night";
export const APPEARANCE_STORAGE_KEY = "openslate.appearance";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export function appearanceMode(value: unknown): AppearanceMode | null {
  return value === "day" || value === "night" ? value : null;
}
export function resolveAppearance(
  search: string,
  stored: unknown,
): AppearanceMode {
  return (
    appearanceMode(new URLSearchParams(search).get("mode")) ??
    appearanceMode(stored) ??
    "day"
  );
}
export function readAppearancePreference(
  storage: PreferenceStorage | null,
): AppearanceMode | null {
  try {
    return appearanceMode(storage?.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return null;
  }
}
export function persistAppearancePreference(
  storage: PreferenceStorage | null,
  mode: AppearanceMode,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(APPEARANCE_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}
/** Keep view, selected-shot links, launch pairing parameters and fragment unchanged. */
export function appearanceHref(href: string, mode: AppearanceMode): string {
  const url = new URL(href);
  url.searchParams.set("mode", mode);
  return url.href;
}
