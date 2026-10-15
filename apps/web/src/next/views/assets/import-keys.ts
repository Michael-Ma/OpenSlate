import { ImportKeys } from "../../model/assets-import.ts";
import type { StudioStore } from "../../store/store.ts";

const registry = new WeakMap<StudioStore, { projectId: string; keys: ImportKeys }>();

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/**
 * The saved import requests of the open film, one set per store. They outlive the import sheet (and, in the
 * studio, a reload) so a lost reply is resent with the same key and the same film version. The sample film
 * keeps them in memory only.
 */
export function importKeysFor(store: StudioStore, mode: "live" | "fixture"): ImportKeys | null {
  const projectId = store.getState().projectId;
  if (!projectId) return null;
  const known = registry.get(store);
  if (known?.projectId === projectId) return known.keys;
  const keys = new ImportKeys(projectId, mode === "fixture" ? null : browserStorage(), () => crypto.randomUUID());
  registry.set(store, { projectId, keys });
  return keys;
}
