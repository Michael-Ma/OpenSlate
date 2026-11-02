import { locate, type PlanOutline } from "./plan.ts";
import { msg, type Msg } from "./types.ts";

/**
 * The Plan view's open editor and the presses whose reply was lost, kept apart from the editors' own mounts so a
 * draft outlives a move between scenes, and a lost reply is said once wherever it can be seen. Pure.
 */

/** What is open for editing. A shot remembers the label it had when it was opened, to say if it moved. */
export type Editing =
  | { kind: "brief" | "story" }
  | { kind: "title" | "direction"; sceneId: string }
  | { kind: "shot"; shotId: string; openedAs: string };

/** Where an open editor keeps its draft and says a lost reply: "brief", "title:<sceneId>", "shot:<shotId>". */
export const placeOf = (editing: Editing | null): string | null =>
  !editing ? null : editing.kind === "shot" ? `shot:${editing.shotId}` : "sceneId" in editing ? `${editing.kind}:${editing.sceneId}` : editing.kind;

export interface PlaceView {
  /** What the editor edits, for "Discard your changes to {name}?". */
  name: Msg;
  /** What is said if it is deleted while the editor is open. */
  gone: Msg;
}

/** The editor's subject as the outline shows it now, or null when it was deleted (a shot, or a scene). */
export function placeView(editing: Editing, outline: PlanOutline): PlaceView | null {
  if (editing.kind === "shot") {
    const where = locate(outline, editing.shotId);
    return where ? { name: msg("plan.place.shot", { shot: where.row.label }), gone: msg("plan.kept.shot", { shot: where.row.label }) } : null;
  }
  if ("sceneId" in editing) {
    const sceneId = editing.sceneId;
    const scene = outline.scenes.find((item) => item.sceneId === sceneId);
    if (!scene) return null;
    return { name: msg(editing.kind === "title" ? "plan.place.title" : "plan.place.direction", { scene: scene.ordinal }), gone: msg("plan.kept.scene", { scene: scene.ordinal }) };
  }
  const name = msg(editing.kind === "brief" ? "plan.place.brief" : "plan.place.story");
  return { name, gone: name };
}

// ---- lost replies ----------------------------------------------------------------------------------------

/** A press whose reply was lost: one per press, said where it was made. */
export interface LostNote {
  pressId: string;
  /** "brief", "shot:<id>", "import", or "view" for the outline's own actions. */
  place: string;
}

/** A notice for this press, replacing an earlier one for the same press (a retry that went unanswered too). */
export function putLost<T extends LostNote>(list: readonly T[], note: T): T[] {
  return list.some((item) => item.pressId === note.pressId) ? list.map((item) => (item.pressId === note.pressId ? note : item)) : [...list, note];
}

/** The press's notice goes: its own resend was answered, or the person dismissed it. Others stay. */
export function dropLost<T extends LostNote>(list: readonly T[], pressId: string): T[] {
  return list.filter((item) => item.pressId !== pressId);
}

/** The notices said in this place go (its editor was cancelled). */
export function dropLostAt<T extends LostNote>(list: readonly T[], place: string): T[] {
  return list.filter((item) => item.place !== place);
}

/**
 * Where each notice is said: in its place when that is on screen (the open editor, the import sheet), one per place;
 * every other in the strip under the header, so a notice is never shown nowhere.
 */
export function sayLost<T extends LostNote>(list: readonly T[], shown: ReadonlySet<string>): { byPlace: Map<string, T>; strip: T[] } {
  const byPlace = new Map<string, T>();
  const strip: T[] = [];
  for (const note of list) {
    if (shown.has(note.place) && !byPlace.has(note.place)) byPlace.set(note.place, note);
    else strip.push(note);
  }
  return { byPlace, strip };
}

// ---- a draft whose shot or scene was deleted -------------------------------------------------------------

export interface KeptField {
  key: string;
  label: string;
  value: string;
}

/** The kept text as one piece to copy: a single field as it is, several with their labels. */
export function keptText(fields: readonly KeptField[]): string {
  if (fields.length === 1) return fields[0]!.value;
  return fields.map((field) => `${field.label}: ${field.value}`).join("\n\n");
}
