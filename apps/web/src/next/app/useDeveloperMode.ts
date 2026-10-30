import { useSyncExternalStore } from "react";

/**
 * Developer mode (Settings › This computer): shows a code-plan film's program (the Code tab and its mentions). A
 * browser preference like the language, off by default; storage that throws or is missing reads as off.
 */
export const DEVELOPER_STORAGE_KEY = "openslate.developerMode";

const listeners = new Set<() => void>();
const storage = (): Storage | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

export function readDeveloperMode(store: Pick<Storage, "getItem"> | null = storage()): boolean {
  try { return store?.getItem(DEVELOPER_STORAGE_KEY) === "on"; } catch { return false; }
}

/** Saves the choice and tells every open view; returns false when the browser would not keep it (it still applies here). */
export function setDeveloperMode(on: boolean, store: Pick<Storage, "setItem" | "removeItem"> | null = storage()): boolean {
  let kept = false;
  try {
    if (store) { if (on) store.setItem(DEVELOPER_STORAGE_KEY, "on"); else store.removeItem(DEVELOPER_STORAGE_KEY); kept = true; }
  } catch { kept = false; }
  current = on;
  listeners.forEach((listener) => listener());
  return kept;
}

let current = readDeveloperMode();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // Another tab of the same studio changed it.
  const onStorage = (event: StorageEvent) => { if (event.key === DEVELOPER_STORAGE_KEY) { current = event.newValue === "on"; listener(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
};

export const useDeveloperMode = (): boolean => useSyncExternalStore(subscribe, () => current, () => false);
