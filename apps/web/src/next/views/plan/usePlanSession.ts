import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { LostNote } from "../../model/plan-drafts.ts";
import type { PlanSession, PlanSessionState } from "../../model/plan-session.ts";

/** State and an immediately current ref, retained by the film when every Plan component unmounts. */
export function usePlanSession<TLost extends LostNote, K extends keyof PlanSessionState<TLost>>(session: PlanSession<TLost>, key: K) {
  const value = useSyncExternalStore(session.subscribe, () => session.getSnapshot()[key]);
  const set = useCallback((update: PlanSessionState<TLost>[K] | ((current: PlanSessionState<TLost>[K]) => PlanSessionState<TLost>[K])) => session.set(key, update), [session, key]);
  const ref = useMemo(() => ({ get current() { return session.getSnapshot()[key]; } }), [session, key]);
  return [value, set, ref] as const;
}
