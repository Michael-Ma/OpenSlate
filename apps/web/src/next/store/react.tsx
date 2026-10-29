import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { MediaSource } from "../media/media-source.ts";
import type { StudioState } from "./state.ts";
import type { StudioStore } from "./store.ts";

interface StudioContextValue {
  store: StudioStore;
  media: MediaSource;
  /** "live" talks to the studio server; "fixture" is the Last Ferry sample film with simulated actions. */
  mode: "live" | "fixture";
  /** Shared per-film drafts this window already handed to the next session through Disconnect. */
  relinquishedDrafts?: Set<string>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ value, children }: { value: StudioContextValue; children: ReactNode }) {
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

function useStudioContext(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error("Studio hooks need a StudioProvider");
  return value;
}

export const useStore = (): StudioStore => useStudioContext().store;
export const useMedia = (): MediaSource => useStudioContext().media;
export const useMode = (): "live" | "fixture" => useStudioContext().mode;
const NO_RELINQUISHED_DRAFTS = new Set<string>();
export const useRelinquishedDrafts = (): Set<string> => useStudioContext().relinquishedDrafts ?? NO_RELINQUISHED_DRAFTS;

/** Subscribe to a slice of the studio state. Selectors must return stable values (state fields or memoized results). */
export function useStudio<T>(selector: (state: StudioState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
