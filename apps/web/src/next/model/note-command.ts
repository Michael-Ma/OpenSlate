import type { GenerationOverview } from "@openslate/core/public";
import type { StudioStore } from "../store/store.ts";
import type { NoteAction } from "./notes.ts";
import { wordsOf } from "./narration.ts";
import { msg } from "./types.ts";

type NoteStore = Pick<StudioStore, "getState" | "regenerateKeyframe" | "makeKeyframes" | "resolveNote" | "setEdit" | "dispatch">;
export interface NoteCommandOwner { projectId: string; projectEpoch: number }

/** A callback belongs to one opening of one film, including leaving and reopening that same film. */
export function noteCommandOwner(store: Pick<NoteStore, "getState">, overview: GenerationOverview): NoteCommandOwner | null {
  const { projectId, projectEpoch } = store.getState();
  return projectId === overview.projectId ? { projectId, projectEpoch } : null;
}

export function noteCommandCurrent(store: Pick<NoteStore, "getState">, owner: NoteCommandOwner | null): boolean {
  const state = store.getState();
  return !!owner && state.projectId === owner.projectId && state.projectEpoch === owner.projectEpoch;
}

/** A paid regeneration and its free note resolution form one film-owned continuation. */
export async function runNoteRegeneration(store: NoteStore, overview: GenerationOverview, action: Extract<NoteAction, { kind: "regenerate" }>): Promise<boolean> {
  const owner = noteCommandOwner(store, overview);
  if (!owner) return false;
  const first = action.shotIds[0];
  if (!first) return false;
  const receipt = action.shotIds.length === 1 ? await store.regenerateKeyframe(first)
    : await store.makeKeyframes(overview.shots[first]?.sceneId ?? "", action.shotIds, true);
  const requestId = (receipt as { requestId?: string } | undefined)?.requestId;
  if (!requestId || !noteCommandCurrent(store, owner)) return false;
  const resolved = await store.resolveNote(action.noteId, action.choiceIndex, requestId);
  return !!resolved && noteCommandCurrent(store, owner);
}

/** Opening a note's inline editor shares the inspector's edit hold and displayed baseline. */
export function openNoteEditor(store: NoteStore, overview: GenerationOverview, action: Extract<NoteAction, { kind: "edit" }>, openShot: (shotId: string) => void): boolean {
  const owner = noteCommandOwner(store, overview);
  if (!owner) return false;
  const current = store.getState();
  if (current.edit) {
    store.dispatch({ type: "toast", message: msg("kf.edit_held", { shot: current.overview?.shots[current.edit.shotId]?.label ?? current.edit.shotId }), tone: "info" });
    return false;
  }
  if (current.overview?.headVersion !== overview.headVersion) {
    store.dispatch({ type: "toast", message: msg("error.EDIT_BASELINE_CHANGED"), tone: "error" });
    return false;
  }
  const shot = overview.shots[action.shotId];
  if (!shot) return false;
  openShot(action.shotId);
  if (!noteCommandCurrent(store, owner)) return false;
  const value = action.field === "narration" ? wordsOf(shot.narration.text) : action.field === "imagePrompt" ? shot.imagePrompt : shot.motion;
  store.setEdit({ shotId: action.shotId, field: action.field, value });
  return true;
}
