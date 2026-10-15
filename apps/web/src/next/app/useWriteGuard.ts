import { createContext, useContext } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { guardFor, OPEN_GUARD, type Needs, type WriteGuard } from "../model/shell-states.ts";

/** Provided by the shell (NextApp), which knows when the studio is offline, the session expired or the film stopped. */
export const WriteGuardContext = createContext<WriteGuard>(OPEN_GUARD);

/** The film-wide guard: whether writes reach the studio and whether new work may start, each with its reason. */
export function useWriteGuard(): WriteGuard {
  return useContext(WriteGuardContext);
}

/**
 * Props for one control under the guard (P5 shell change 8). Spread them on the button:
 * `<button {...useGuarded("run")} onClick={make}>`. It is off while the guard says so and its title says why;
 * `data-needs` names what it needs. A control with its own reason to be off combines it:
 * `disabled={guarded.disabled || busy}`. Keep `title` from here when it is off for the guard's reason.
 */
export function useGuarded(needs: Needs): { disabled: boolean; title: string | undefined; "data-needs": Needs } {
  const { tm } = useI18n();
  const { off, why } = guardFor(useWriteGuard(), needs);
  return { disabled: off, title: why ? tm(why) : undefined, "data-needs": needs };
}
