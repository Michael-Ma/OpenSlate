/**
 * Changed-underneath protection for the Plan view's editors (the classic InlineField's "The saved project changed"):
 * an open draft is held against the saved values it started from. When the saved film changes while a draft is open
 * (the Director working alongside, another window):
 *
 * - a field the person did not touch follows the saved value, so a save never reverts someone else's change;
 * - a field the person changed, whose saved value changed too, is a conflict: the person's text is kept, and the
 *   save waits until they choose Keep my text (save it over the new version) or Use saved text.
 *
 * Text compares without surrounding spaces, numbers to a millionth. Pure.
 */

export type HeldValue = string | number;
export type HeldFields = Record<string, HeldValue>;

export interface Held<T extends HeldFields> {
  /** The saved values the draft was started from (or last reconciled with). */
  base: T;
  /** What the person typed; a field equal to its base is untouched. */
  draft: T;
}

const same = (a: HeldValue | undefined, b: HeldValue | undefined) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 : String(a ?? "").trim() === String(b ?? "").trim();

const keys = <T extends HeldFields>(value: T) => Object.keys(value) as (keyof T & string)[];

export function hold<T extends HeldFields>(live: T): Held<T> {
  return { base: { ...live }, draft: { ...live } };
}

/** The person changed this field (more than its surrounding spaces). */
const edited = <T extends HeldFields>(held: Held<T>, key: keyof T) => !same(held.draft[key], held.base[key]);
/** The saved value changed since the draft was started. */
const moved = <T extends HeldFields>(held: Held<T>, live: T, key: keyof T) => !same(live[key], held.base[key]);

/**
 * What the editor shows: the person's text where they typed (exactly, spaces and all), the saved value elsewhere.
 * A field touched only by spaces follows the saved value once that changes.
 */
export function shown<T extends HeldFields>(held: Held<T>, live: T): T {
  const out = { ...live };
  for (const key of keys(live)) {
    const typed = held.draft[key] !== held.base[key];
    if (typed && (edited(held, key) || !moved(held, live, key))) out[key] = held.draft[key];
  }
  return out;
}

/** The fields whose saved value changed under the person's own, different text. */
export function conflicts<T extends HeldFields>(held: Held<T>, live: T): (keyof T & string)[] {
  return keys(live).filter((key) => edited(held, key) && moved(held, live, key) && !same(held.draft[key], live[key]));
}

/** The person types into a field. A field they had not changed starts from the saved value as it is now. */
export function change<T extends HeldFields, K extends keyof T>(held: Held<T>, live: T, key: K, value: T[K]): Held<T> {
  const base = edited(held, key) ? held.base : { ...held.base, [key]: live[key] };
  return { base, draft: { ...held.draft, [key]: value } };
}

/** Keep my text: the conflicting fields are saved over the new version. */
export function keepMine<T extends HeldFields>(held: Held<T>, live: T): Held<T> {
  const base = { ...held.base };
  for (const key of conflicts(held, live)) base[key] = live[key];
  return { base, draft: held.draft };
}

/** The fields the person changed (more than surrounding spaces), in the draft's order. */
export function editedKeys<T extends HeldFields>(held: Held<T>): (keyof T & string)[] {
  return keys(held.draft).filter((key) => edited(held, key));
}

/** The person changed something: closing the editor would throw their text away. */
export const touched = <T extends HeldFields>(held: Held<T> | undefined): boolean => !!held && editedKeys(held).length > 0;

/**
 * A save of `sent` (what the editor showed when Save was pressed) was answered. When the person typed on after
 * pressing Save (the reply was slow or lost), that newer text stays, now held against what was saved, so the saved
 * values are not taken for someone else's change. Null when nothing is left to save: the editor closes.
 */
export function afterSave<T extends HeldFields>(held: Held<T>, sent: T): Held<T> | null {
  const newer = editedKeys(held).filter((key) => !same(held.draft[key], sent[key]));
  if (!newer.length) return null;
  const draft = { ...sent };
  for (const key of newer) draft[key] = held.draft[key];
  return { base: { ...sent }, draft };
}

/** Use saved text: the conflicting fields take the saved values. */
export function takeSaved<T extends HeldFields>(held: Held<T>, live: T): Held<T> {
  const base = { ...held.base };
  const draft = { ...held.draft };
  for (const key of conflicts(held, live)) {
    base[key] = live[key];
    draft[key] = live[key];
  }
  return { base, draft };
}
