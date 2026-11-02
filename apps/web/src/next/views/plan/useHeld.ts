import { useCallback, useRef, useState } from "react";
import { change, conflicts, hold, keepMine, shown, takeSaved, type Held, type HeldFields } from "../../model/plan-conflict.ts";

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
 * Where an editor's draft is kept: in the Plan view, by the editor's place ("shot:<id>", "brief"), so the draft
 * outlives the editor's own mount (a shot moved to another scene is a new mount there) and the view can tell
 * whether closing the editor would throw text away. Absent until the person types.
 */
export interface DraftSlot {
  held: Held<HeldFields> | undefined;
  put(update: (current: Held<HeldFields> | undefined) => Held<HeldFields> | undefined): void;
}

/**
 * An editor's draft, held against the saved values (`live`, read on every render) it started from: see
 * model/plan-conflict.ts. With nothing typed it simply follows the saved values.
 */
export function heldDraft<T extends HeldFields>(live: T, slot: DraftSlot): HeldDraft<T> {
  const held = (slot.held as Held<T> | undefined) ?? hold(live);
  const put = (step: (current: Held<T>) => Held<T>) =>
    slot.put((current) => step((current as Held<T> | undefined) ?? hold(live)) as unknown as Held<HeldFields>);
  return {
    value: shown(held, live),
    stale: conflicts(held, live),
    set: (key, value) => put((current) => change(current, live, key, value)),
    keep: () => put((current) => keepMine(current, live)),
    takeSaved: () => put((current) => takeSaved(current, live)),
  };
}

type Update<T> = T | ((current: T) => T);

/**
 * State whose ref is current at once: a press's outcome (which may come after an await, or from a later retry)
 * reads what is open now, not what was open when the press began.
 */
export function useLatest<T>(initial: T): [T, (next: Update<T>) => void, { readonly current: T }] {
  const ref = useRef(initial);
  const [value, setValue] = useState(initial);
  const set = useCallback((next: Update<T>) => {
    ref.current = typeof next === "function" ? (next as (current: T) => T)(ref.current) : next;
    setValue(ref.current);
  }, []);
  return [value, set, ref];
}
