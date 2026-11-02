import { useSyncExternalStore } from "react";

/**
 * A preference kept in this browser, like the language: read wherever it is needed, and every open view follows a
 * change, in this tab or another. Storage that is missing or throws reads as unset; a value still applies until reload.
 */
export interface BrowserPreference {
  read(store?: Pick<Storage, "getItem"> | null): string | null;
  /** Saves the value (null clears it); false when the browser would not keep it. */
  write(value: string | null, store?: Pick<Storage, "setItem" | "removeItem"> | null): boolean;
  use(): string | null;
}

const browserStorage = (): Storage | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

export function browserPreference(key: string): BrowserPreference {
  const listeners = new Set<() => void>();
  const read: BrowserPreference["read"] = (store = browserStorage()) => {
    try { return store?.getItem(key) ?? null; } catch { return null; }
  };
  let current = read();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => { if (event.key === key) { current = event.newValue; listener(); } };
    window.addEventListener("storage", onStorage);
    return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
  };
  return {
    read,
    write(value, store = browserStorage()) {
      let kept = false;
      try {
        if (store) { if (value === null) store.removeItem(key); else store.setItem(key, value); kept = true; }
      } catch { kept = false; }
      current = value;
      listeners.forEach((listener) => listener());
      return kept;
    },
    use: () => useSyncExternalStore(subscribe, () => current, () => null),
  };
}
