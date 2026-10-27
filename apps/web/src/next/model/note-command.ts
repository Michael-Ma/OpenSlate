import type { DirectorProposal, GenerationOverview } from "@openslate/core/public";
import type { StudioStore } from "../store/store.ts";
import type { NoteAction } from "./notes.ts";
import { wordsOf } from "./narration.ts";
import { msg } from "./types.ts";

type NoteStore = Pick<StudioStore, "getState" | "regenerateKeyframe" | "makeKeyframes" | "resolveNote" | "setEdit" | "dispatch" | "refresh">;
type ChoiceStore = NoteStore & Pick<StudioStore, "confirmVideo" | "acceptProposal" | "pointAt" | "setDirectorOpen">;
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

/**
 * The studio settles a note itself when its choice's effect happens, whoever pressed it (whichever happens first
 * settles it), so after the press the note may already be settled: read the film once before resolving it again.
 */
async function settledByPress(store: Pick<NoteStore, "getState" | "refresh">, noteId: string, owner: NoteCommandOwner): Promise<boolean> {
  await store.refresh();
  return noteCommandCurrent(store, owner) && store.getState().snapshot?.notes?.find((note) => note.noteId === noteId)?.state === "resolved";
}

/** A paid regeneration and its free note resolution form one film-owned continuation. */
export async function runNoteRegeneration(store: NoteStore, overview: GenerationOverview, action: Extract<NoteAction, { kind: "regenerate" }>): Promise<boolean> {
  const owner = noteCommandOwner(store, overview);
  if (!owner) return false;
  // A failed resolved note may start a fresh human request, but its original resolution is immutable history.
  const alreadyResolved = store.getState().snapshot?.notes?.find((note) => note.noteId === action.noteId)?.state === "resolved";
  const first = action.shotIds[0];
  if (!first) return false;
  const receipt = action.shotIds.length === 1 ? await store.regenerateKeyframe(first)
    : await store.makeKeyframes(overview.shots[first]?.sceneId ?? "", action.shotIds, true);
  const requestId = (receipt as { requestId?: string } | undefined)?.requestId;
  if (!requestId || !noteCommandCurrent(store, owner)) return false;
  if (alreadyResolved || await settledByPress(store, action.noteId, owner)) return noteCommandCurrent(store, owner);
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

/** A pressed video confirm and its free note resolution, like a regeneration: the confirm first, then the note names it. */
export async function runNoteVideoConfirm(store: ChoiceStore, overview: GenerationOverview, action: Extract<NoteAction, { kind: "confirm_video" }>): Promise<boolean> {
  const owner = noteCommandOwner(store, overview);
  if (!owner) return false;
  const receipt = await store.confirmVideo(action.sceneId);
  const confirmationId = (receipt as { confirmationId?: string } | undefined)?.confirmationId;
  if (!confirmationId || !noteCommandCurrent(store, owner)) return false;
  if (await settledByPress(store, action.noteId, owner)) return noteCommandCurrent(store, owner);
  const resolved = await store.resolveNote(action.noteId, action.choiceIndex, confirmationId);
  return !!resolved && noteCommandCurrent(store, owner);
}

/** An "edit" choice waits for its field to be saved; the note then resolves with that edit (Keyframes or the chat). */
export interface PendingNoteEdit extends NoteCommandOwner {
  noteId: string;
  choiceIndex: number;
  shotId: string;
  field: "narration" | "imagePrompt" | "motion";
}

// One per store: a choice pressed in the chat is settled by the save in Keyframes.
const pendingEdits = new WeakMap<object, PendingNoteEdit>();
export const pendingNoteEdit = (store: object): PendingNoteEdit | null => pendingEdits.get(store) ?? null;
export function setPendingNoteEdit(store: object, edit: PendingNoteEdit | null): void {
  if (edit) pendingEdits.set(store, edit);
  else pendingEdits.delete(store);
}

/** What a choice did: settled (with what Undo can revert), opened its editor, or nothing (refused, another film). */
export type NoteChoiceOutcome =
  | { kind: "settled"; undo: { kind: "proposal"; proposalId: string } | { kind: "edit"; commandId: string } | null }
  | { kind: "editing" }
  | null;

/**
 * Carry out one of a note's choices the way the server requires, the same from the Keyframes banner and from the
 * chat: accept resolves directly; a regenerate or a video confirm is pressed first and the note names that press;
 * an edit opens the inline editor and the note names the saved edit; a proposal is accepted with its preview digest,
 * which resolves its note atomically; a reply points the composer at the note's anchor.
 */
export async function runNoteChoice(store: ChoiceStore, overview: GenerationOverview, note: { noteId: string; sceneId: string | null; shotIds: readonly string[] },
  action: NoteAction, proposal: DirectorProposal | null, openShot: (shotId: string) => void): Promise<NoteChoiceOutcome> {
  const owner = noteCommandOwner(store, overview);
  if (!owner) return null;
  switch (action.kind) {
    case "accept": return (await store.resolveNote(action.noteId, action.choiceIndex)) ? { kind: "settled", undo: null } : null;
    case "regenerate": return (await runNoteRegeneration(store, overview, action)) ? { kind: "settled", undo: null } : null;
    case "confirm_video": return (await runNoteVideoConfirm(store, overview, action)) ? { kind: "settled", undo: null } : null;
    case "edit": {
      if (!openNoteEditor(store, overview, action, openShot)) return null;
      setPendingNoteEdit(store, { ...owner, noteId: action.noteId, choiceIndex: action.choiceIndex, shotId: action.shotId, field: action.field });
      return { kind: "editing" };
    }
    case "proposal": {
      if (!proposal) return null;
      return (await store.acceptProposal(proposal)) ? { kind: "settled", undo: { kind: "proposal", proposalId: proposal.proposalId } } : null;
    }
    case "reply": {
      if (note.shotIds.length) for (const id of note.shotIds) store.pointAt({ kind: "shot", id });
      else if (note.sceneId) store.pointAt({ kind: "scene", id: note.sceneId });
      if (window.matchMedia?.("(max-width: 899px)").matches) store.setDirectorOpen(true);
      return null;
    }
  }
}
