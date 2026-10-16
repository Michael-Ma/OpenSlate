import type { GenerationOverview, ShotOverview } from "@openslate/core/public";
import type { EditDraft } from "../store/state.ts";
import { msg, type Msg } from "./types.ts";

/** The values displayed by an editor; a moved project head is never itself one of them. */
export interface EditValues {
  value: string;
  motion: string;
  durationFrames: number;
}
export type EditConflict = { kind: "waiting" } | { kind: "none"; saved: EditValues } | { kind: "changed"; saved?: EditValues };

export const motionForm = (field: EditDraft["field"]): boolean => field === "motion" || field === "desiredFrames";
export const sameEditForm = (a: EditDraft["field"], b: EditDraft["field"]): boolean => a === b || motionForm(a) && motionForm(b);

export function editValues(field: EditDraft["field"], shot: ShotOverview): EditValues {
  return { value: field === "narration" ? shot.narration.text : field === "desiredFrames" ? String(shot.durationFrames) : shot[field],
    motion: shot.motion, durationFrames: shot.durationFrames };
}

/** `head` comes from displayedHead: mixed or foreign projections wait without reporting a field conflict. */
export function editConflict(draft: EditDraft, overview: GenerationOverview | null, head: number | null): EditConflict {
  if (head === null || !overview || overview.headVersion !== head || draft.projectId !== overview.projectId) return { kind: "waiting" };
  const shot = overview.shots[draft.shotId];
  if (!shot) return { kind: "changed" };
  const saved = editValues(draft.field, shot);
  const equal = motionForm(draft.field)
    ? draft.baselineMotion !== undefined && draft.baselineFrames !== undefined && draft.baselineMotion === saved.motion && draft.baselineFrames === saved.durationFrames
    : draft.baselineValue !== undefined && draft.baselineValue === saved.value;
  return { kind: equal ? "none" : "changed", saved };
}

/** The same save reason for the form and its command: waiting is neutral guidance, not an alert. */
export function editSaveReason(conflict: EditConflict): Msg | null {
  return conflict.kind === "none" ? null : msg(conflict.kind === "waiting" ? "error.PROJECTION_CHANGED" : "error.EDIT_BASELINE_CHANGED");
}
