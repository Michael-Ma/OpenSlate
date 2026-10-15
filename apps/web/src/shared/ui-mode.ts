/** Which studio to boot: the classic UI or the Last Ferry UI ("next"). */
export type UiMode = "classic" | "next";

export const UI_MODE_KEY = "openslate.ui";
/** The classic UI stays the default until the next UI reaches parity (plan decision D18). */
export const DEFAULT_UI_MODE: UiMode = "classic";

const parse = (value: string | null | undefined): UiMode | null => (value === "classic" || value === "next" ? value : null);

/**
 * `?ui=next` or `?ui=classic` chooses and remembers a mode; otherwise the remembered mode, then the default.
 * Storage is optional: private windows may refuse it.
 */
export function resolveUiMode(search: string, storage: Pick<Storage, "getItem" | "setItem"> | null): UiMode {
  const requested = parse(new URLSearchParams(search).get("ui"));
  if (requested) {
    try { storage?.setItem(UI_MODE_KEY, requested); } catch { /* storage unavailable */ }
    return requested;
  }
  try { return parse(storage?.getItem(UI_MODE_KEY)) ?? DEFAULT_UI_MODE; } catch { return DEFAULT_UI_MODE; }
}
