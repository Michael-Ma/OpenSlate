import type { EditDraft } from "../store/state.ts";
import type { StudioStore } from "../store/store.ts";
import { displayedHead } from "./displayed-baseline.ts";

export interface RecordingWordSave {
  commandId: string;
  projectId: string;
  projectEpoch: number;
  shotId: string;
  revision: number;
  beforeText: string;
  words: string;
}

type WordsStore = Pick<StudioStore, "getState" | "saveEdit" | "refresh" | "edit" | "dispatch">;
type Owner = Pick<RecordingWordSave, "projectId" | "projectEpoch" | "shotId" | "revision">;
const owns = (store: WordsStore, owner: Owner): boolean => {
  const state = store.getState(), draft = state.edit;
  return state.projectId === owner.projectId && state.projectEpoch === owner.projectEpoch && draft?.shotId === owner.shotId
    && draft.projectId === owner.projectId && draft.field === "narration" && draft.revision === owner.revision;
};

/** Save recording subtitles through the same field comparison and retained baseline as a typed voice line. */
export async function saveRecordingWords(store: WordsStore, draft: EditDraft, words: string): Promise<RecordingWordSave | null> {
  if (!draft.projectId || draft.revision === undefined || draft.baselineValue === undefined) return null;
  const owner = { projectId: draft.projectId, projectEpoch: store.getState().projectEpoch, shotId: draft.shotId, revision: draft.revision };
  if (!owns(store, owner)) return null;
  const value = words.trim(), beforeText = draft.baselineValue;
  const commandId = await store.saveEdit({ ...store.getState().edit!, value }, undefined, true, false, { quiet: true });
  return commandId && owns(store, owner) ? { ...owner, commandId, beforeText, words: value } : null;
}

/** Undo this exact subtitle save, then rebase only its unchanged owner to the verified restored text. */
export async function rollbackRecordingWords(store: WordsStore, saved: RecordingWordSave): Promise<boolean> {
  if (!owns(store, saved)) return false;
  await store.refresh();
  if (!owns(store, saved)) return false;
  let state = store.getState();
  if (displayedHead(state.projectId, state.snapshot, state.overview) === null || state.overview?.shots[saved.shotId]?.narration.text !== saved.words) return false;
  const undone = await store.edit({ kind: "undo", commandId: saved.commandId }, null);
  if (!undone || !owns(store, saved)) return false;
  await store.refresh();
  if (!owns(store, saved)) return false;
  state = store.getState();
  const head = displayedHead(state.projectId, state.snapshot, state.overview);
  if (head === null || state.overview?.shots[saved.shotId]?.narration.text !== saved.beforeText || state.edit?.baselineValue !== saved.words) return false;
  store.dispatch({ type: "edit", edit: { ...state.edit, baselineValue: saved.beforeText, expectedHeadVersion: head, saving: false } });
  return true;
}
