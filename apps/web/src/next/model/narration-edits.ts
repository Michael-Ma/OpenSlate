import type { EditDraft } from "../store/state.ts";
import type { StudioStore } from "../store/store.ts";
import type { StoryboardEdit } from "./commands.ts";
import { displayedHead } from "./displayed-baseline.ts";
import { editConflict } from "./edit-conflict.ts";
import type { Msg } from "./types.ts";

type NarrationStore = Pick<StudioStore, "getState" | "refresh" | "saveEdit" | "edit" | "dispatch">;

/**
 * A line plus its settings shares the original field comparison and keeps newer typing through every await.
 * Intermediate commands are silent successes; only the completed human action gets its final command's Undo.
 */
export async function runNarrationEdits(store: NarrationStore, draft: EditDraft, edits: { edit: StoryboardEdit; toast: Msg }[]): Promise<boolean> {
  const epoch = store.getState().projectEpoch;
  const active = () => {
    const state = store.getState();
    return state.projectId === draft.projectId && state.projectEpoch === epoch && state.edit?.revision === draft.revision
      && state.edit?.shotId === draft.shotId && state.edit?.field === "narration";
  };
  let completed: { commandId: string; toast: Msg } | null = null;
  for (const [index, { edit, toast }] of edits.entries()) {
    if (index > 0) await store.refresh();
    if (!active()) return false;
    const state = store.getState();
    const head = displayedHead(state.projectId, state.snapshot, state.overview);
    if (editConflict(state.edit!, state.overview, head).kind !== "none") return false;
    const commandId = edit.kind === "narration" && edit.field === "text"
      ? await store.saveEdit({ ...state.edit!, value: edit.value }, undefined, true, false, { toast: null })
      : await store.edit(edit);
    if (!commandId) return false;
    completed = { commandId, toast };
  }
  if (!active()) return false;
  if (completed) store.dispatch({ type: "toast", message: completed.toast, tone: "info", undoCommandId: completed.commandId });
  return true;
}
