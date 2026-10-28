import type { StudioStore } from "../../store/store.ts";

/**
 * Another view asks Plan to open one character's sheet review (the Keyframes cast check's Review sheet). One request
 * per store, taken by Plan › Cast when it mounts or sees it; the view switch itself goes through the store.
 */
const requests = new WeakMap<object, string>();
const listeners = new WeakMap<object, Set<() => void>>();

export function requestSheetReview(store: Pick<StudioStore, "setView">, characterId: string): void {
  requests.set(store, characterId);
  for (const listener of listeners.get(store) ?? []) listener();
  store.setView("plan");
}

export function takeSheetReview(store: object): string | null {
  const id = requests.get(store) ?? null;
  requests.delete(store);
  return id;
}

export function onSheetReview(store: object, listener: () => void): () => void {
  const set = listeners.get(store) ?? new Set();
  set.add(listener);
  listeners.set(store, set);
  return () => set.delete(listener);
}
