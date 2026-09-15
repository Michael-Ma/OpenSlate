import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { StudioApi } from "./api";
import { projectSubscription } from "./project-subscription";
const RefreshVersion = createContext(0);
/** Mounted once by the project workspace; panels consume this number without opening streams. */
export function ProjectUpdatesProvider({ value, children }: { value: number; children: ReactNode }) {
  return <RefreshVersion.Provider value={value}>{children}</RefreshVersion.Provider>;
}
export function useProjectRefreshVersion(): number { return useContext(RefreshVersion); }
export function useProjectUpdates(api: StudioApi, projectId: string) {
  const subscription = useMemo(() => projectSubscription(api, projectId), [api, projectId]);
  const state = useSyncExternalStore(subscription.subscribe, subscription.getSnapshot, subscription.getSnapshot);
  return { ...state, refresh: subscription.refresh };
}
