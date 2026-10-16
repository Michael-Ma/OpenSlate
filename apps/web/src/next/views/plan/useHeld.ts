import { useState } from "react";
import { change, conflicts, hold, keepMine, shown, takeSaved, type HeldFields } from "../../model/plan-conflict.ts";

export interface HeldDraft<T extends HeldFields> {
  /** What the editor shows: the person's text where they typed, the saved values elsewhere. */
  value: T;
  /** Fields whose saved value changed under the person's own text: the save waits for a choice. */
  stale: (keyof T & string)[];
  set<K extends keyof T>(key: K, value: T[K]): void;
  /** Keep my text: save it over the new version. */
  keep(): void;
  /** Use saved text. */
  takeSaved(): void;
}

/**
 * An editor's draft, held against the saved values (`live`, read on every render) it started from: see
 * model/plan-conflict.ts. The draft lives as long as the editor is open.
 */
export function useHeld<T extends HeldFields>(live: T): HeldDraft<T> {
  const [held, setHeld] = useState(() => hold(live));
  return {
    value: shown(held, live),
    stale: conflicts(held, live),
    set: (key, value) => setHeld((current) => change(current, live, key, value)),
    keep: () => setHeld((current) => keepMine(current, live)),
    takeSaved: () => setHeld((current) => takeSaved(current, live)),
  };
}
