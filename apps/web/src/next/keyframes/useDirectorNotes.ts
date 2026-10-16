import type { DirectorNote, GenerationOverview } from "@openslate/core/public";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { noteBanner, noteCallout, type NoteBannerAction, type NoteBannerView, type NoteCallout } from "../model/note-banner.ts";
import { noteCommandCurrent, noteCommandOwner, openNoteEditor, runNoteRegeneration, type NoteCommandOwner } from "../model/note-command.ts";
import { noteViews, sceneOpenNotes, shotCallouts, type NoteView } from "../model/notes.ts";
import { useStore, useStudio } from "../store/react.tsx";

const NO_NOTES: DirectorNote[] = [];

/** A note settled from the banner; its settled view stays until the person moves on, with Undo where it exists. */
interface SettledNote extends NoteCommandOwner {
  noteId: string;
  sceneId: string;
  choiceIndex: number;
  undo: { kind: "proposal"; proposalId: string } | { kind: "edit"; commandId: string } | null;
  /** The snapshot cursor when it settled; only later snapshots can contradict it. */
  cursor: number;
}

/** An "edit" choice opened the inline editor; saving that field settles the note with the edit's command id. */
interface PendingNoteEdit extends NoteCommandOwner {
  noteId: string;
  choiceIndex: number;
  shotId: string;
  field: "narration" | "imagePrompt" | "motion";
}

export interface DirectorNotes {
  /** The banner to show for this scene: a settled note, else the first open one (blocking first); null for none. */
  banner: NoteBannerView | null;
  /** For a settled banner: the letter of the next open note, if any. */
  nextLetter: string | null;
  canUndo: boolean;
  /** True when the scene had Director notes and every one is settled. */
  allSettled: boolean;
  busy: boolean;
  calloutsFor(shotId: string): NoteCallout[];
  choose(action: NoteBannerAction): void;
  /** Run a card's regenerate link: the note's choice with this index. */
  chooseOnCard(noteId: string, choiceIndex: number): void;
  next(): void;
  undo(): void;
  /** Called after an inline edit saved; settles the note whose edit choice opened it. */
  editSaved(shotId: string, field: string, commandId: string | null): void;
  /** The inline editor changed: closing it or switching away from the note's field leaves the note open. */
  editChanged(draft: { shotId: string; field: string } | null): void;
  /** A paid press used the current state: a settled note's Undo is no longer offered. */
  forgetUndo(): void;
}

/**
 * The Director's notes in the Keyframes view (DC-18, WA-10). Each choice is carried out the way the server
 * requires: accept resolves directly; a regenerate is pressed first and the note names that request; an edit
 * opens the inline editor and the note names the saved edit; a proposal is accepted with its preview digest,
 * which resolves its note atomically; a reply points the composer at the note's anchor.
 */
export function useDirectorNotes(options: {
  overview: GenerationOverview;
  sceneId: string | null;
  locale: string;
  openShot(shotId: string): void;
}): DirectorNotes {
  const { overview, sceneId, locale, openShot } = options;
  const store = useStore();
  const notes = useStudio((s) => s.snapshot?.notes ?? NO_NOTES);
  const proposals = useStudio((s) => s.proposals);
  const snapshotCursor = useStudio((s) => s.snapshot?.cursor ?? 0);
  const pending = useStudio((s) => s.pending);
  const projectEpoch = useStudio((s) => s.projectEpoch);
  const views = useMemo(() => noteViews(notes, overview, proposals), [notes, overview, proposals]);
  const [settled, setSettled] = useState<SettledNote | null>(null);
  const pendingEdit = useRef<PendingNoteEdit | null>(null);
  useEffect(() => { setSettled(null); pendingEdit.current = null; }, [projectEpoch]);

  // Undo (or anything else) that reopens the note ends its settled view.
  useEffect(() => {
    if (!settled || snapshotCursor <= settled.cursor) return;
    const note = views.find((view) => view.noteId === settled.noteId);
    if (!note || note.state !== "resolved") setSettled(null);
  }, [views, settled, snapshotCursor]);

  const settle = useCallback((note: { noteId: string; sceneId: string | null }, choiceIndex: number, undo: SettledNote["undo"], owner: NoteCommandOwner) => {
    if (!noteCommandCurrent(store, owner)) return;
    setSettled({ ...owner, noteId: note.noteId, sceneId: note.sceneId ?? sceneId ?? "", choiceIndex, undo, cursor: store.getState().snapshot?.cursor ?? 0 });
  }, [store, sceneId]);

  const run = useCallback(async (note: NoteView, choice: NoteBannerAction) => {
    const owner = noteCommandOwner(store, overview);
    if (!owner) return;
    const action = choice.action;
    switch (action.kind) {
      case "accept": {
        if (await store.resolveNote(action.noteId, action.choiceIndex)) settle(note, action.choiceIndex, null, owner);
        return;
      }
      case "regenerate": {
        if (await runNoteRegeneration(store, overview, action)) settle(note, action.choiceIndex, null, owner);
        return;
      }
      case "edit": {
        if (openNoteEditor(store, overview, action, openShot))
          pendingEdit.current = { ...owner, noteId: action.noteId, choiceIndex: action.choiceIndex, shotId: action.shotId, field: action.field };
        return;
      }
      case "proposal": {
        if (!choice.proposal) return;
        const receipt = await store.acceptProposal(choice.proposal);
        if (receipt) settle(note, action.choiceIndex, { kind: "proposal", proposalId: choice.proposal.proposalId }, owner);
        return;
      }
      case "reply": {
        if (note.shotIds.length) for (const id of note.shotIds) store.pointAt({ kind: "shot", id });
        else if (note.sceneId) store.pointAt({ kind: "scene", id: note.sceneId });
        if (window.matchMedia?.("(max-width: 899px)").matches) store.setDirectorOpen(true);
        return;
      }
    }
  }, [store, overview, sceneId, openShot, settle]);

  const open = sceneId ? sceneOpenNotes(views, sceneId) : [];
  const settledView = settled && noteCommandCurrent(store, settled) && settled.sceneId === sceneId ? views.find((view) => view.noteId === settled.noteId) ?? null : null;
  const shown = settledView ?? open[0] ?? null;
  const banner = shown ? noteBanner(shown, overview, proposals, locale, settledView ? settled!.choiceIndex : undefined) : null;

  const choose = useCallback((choice: NoteBannerAction) => {
    const note = views.find((view) => view.noteId === choice.action.noteId);
    if (note) void run(note, choice);
  }, [views, run]);

  return {
    banner,
    nextLetter: settledView ? open.find((note) => note.noteId !== settledView.noteId)?.letter ?? null : null,
    canUndo: !!settledView && !!settled?.undo,
    allSettled: !!sceneId && !shown && views.some((view) => view.sceneId === sceneId && view.state === "resolved"),
    busy: Object.keys(pending).some((key) => key.startsWith("note:") || key.startsWith("proposal:")),
    calloutsFor: (shotId) => shotCallouts(views, shotId).map((view) => noteCallout(view, shotId, overview, locale)),
    choose,
    chooseOnCard: (noteId, choiceIndex) => {
      const note = views.find((view) => view.noteId === noteId);
      const action = note ? noteBanner(note, overview, proposals, locale).actions[choiceIndex] : undefined;
      if (note && action?.enabled) void run(note, action);
    },
    next: () => setSettled(null),
    undo: () => {
      const undo = settled?.undo;
      setSettled(null);
      if (!settled || !noteCommandCurrent(store, settled)) return;
      if (undo?.kind === "proposal") void store.undoProposal(undo.proposalId);
      else if (undo?.kind === "edit") void store.undo(undo.commandId);
    },
    editSaved: (shotId, field, commandId) => {
      const waiting = pendingEdit.current;
      if (!waiting || !noteCommandCurrent(store, waiting) || waiting.shotId !== shotId || waiting.field !== field || !commandId) return;
      pendingEdit.current = null;
      const note = views.find((view) => view.noteId === waiting.noteId);
      void store.resolveNote(waiting.noteId, waiting.choiceIndex, commandId).then((done) => {
        if (done && note) settle(note, waiting.choiceIndex, { kind: "edit", commandId }, waiting);
      });
    },
    editChanged: (draft) => {
      const waiting = pendingEdit.current;
      if (waiting && (!draft || draft.shotId !== waiting.shotId || draft.field !== waiting.field)) pendingEdit.current = null;
    },
    forgetUndo: () => setSettled((current) => (current ? { ...current, undo: null } : current)),
  };
}
