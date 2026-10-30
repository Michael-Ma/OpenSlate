import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { MediaSource } from "../media/media-source.ts";
import type { StudioState } from "./state.ts";
import type { StudioStore } from "./store.ts";

interface StudioContextValue {
  store: StudioStore;
  media: MediaSource;
  /** Where a code-plan step's media is read (api/code-plan.ts); absent: the same source as every other picture. */
  codePlanMedia?: MediaSource;
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

const MediaScope = createContext<MediaSource | null>(null);

/**
 * Inside a code-plan screen, pictures and clips are a code-plan step's media and come from its own route: every
 * Picture, thumbnail and player below reads through the session's codePlanMedia, with the same verification and cache.
 */
export function CodePlanMedia({ children }: { children: ReactNode }) {
  const { codePlanMedia, media } = useStudioContext();
  return <MediaScope.Provider value={codePlanMedia ?? media}>{children}</MediaScope.Provider>;
}

export const useMedia = (): MediaSource => {
  const scoped = useContext(MediaScope);
  const { media } = useStudioContext();
  return scoped ?? media;
};
export const useMode = (): "live" | "fixture" => useStudioContext().mode;
const NO_RELINQUISHED_DRAFTS = new Set<string>();
export const useRelinquishedDrafts = (): Set<string> => useStudioContext().relinquishedDrafts ?? NO_RELINQUISHED_DRAFTS;

/** Subscribe to a slice of the studio state. Selectors must return stable values (state fields or memoized results). */
export function useStudio<T>(selector: (state: StudioState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
