import type { DirectorNote, DirectorProposal, GenerationOverview, NoteChoice } from "@openslate/core/public";
import { msg, type Msg } from "./types.ts";

/**
 * Director notes (plan items DC-1, DC-10, DC-18, WA-10). Labels come from the typed choice,
 * never from the model, except an "accept" choice's short label (e.g. "Keep maroon").
 */
export type NoteAction =
  | { kind: "accept"; noteId: string; choiceIndex: number }
  /** A priced press; the note resolves with the press's request as its result. */
  | { kind: "regenerate"; noteId: string; choiceIndex: number; shotIds: string[] }
  /** Opens the inline editor; the note resolves with the edit's command id once it is saved. */
  | { kind: "edit"; noteId: string; choiceIndex: number; shotId: string; field: "narration" | "imagePrompt" | "motion" }
  | { kind: "proposal"; noteId: string; choiceIndex: number; proposalId: string }
  /** Points the composer at the note's anchor so the person can answer in words. */
  | { kind: "reply"; noteId: string; choiceIndex: number };

export interface NoteChoiceView {
  label: Msg | { text: string };
  action: NoteAction;
  chosen: boolean;
  /** A paid choice shows its price next to its label. */
  paid: boolean;
}

export interface NoteView {
  noteId: string;
  letter: string;
  text: string;
  kind: DirectorNote["kind"];
  blocking: boolean;
  state: DirectorNote["state"];
  sceneId: string | null;
  shotIds: string[];
  /** "2.2", "2.2, 2.3" or "Scene 2". */
  anchor: Msg;
  choices: NoteChoiceView[];
  /** How it was settled, for a resolved note. */
  settled: Msg | null;
}

const labels = (overview: GenerationOverview, shotIds: readonly string[]) => shotIds.map((id) => overview.shots[id]?.label ?? "?").join(", ");

function choiceLabel(choice: NoteChoice, overview: GenerationOverview, proposals: readonly DirectorProposal[]): Msg | { text: string } {
  switch (choice.kind) {
    case "accept": return { text: choice.label };
    case "regenerate_keyframe": return msg("note.choice.regenerate", { shots: labels(overview, choice.shotIds) });
    case "edit_field": return msg(`note.choice.edit.${choice.field}`, { shot: labels(overview, [choice.shotId]) });
    case "reply": return msg("note.choice.reply");
    case "proposal": {
      const proposal = proposals.find((p) => p.proposalId === choice.proposalId);
      const duration = proposal?.preview.timeline.find((row) => row.changed && row.nowSeconds !== row.afterSeconds);
      if (duration) return msg("note.choice.make_seconds", { shot: duration.label, seconds: duration.afterSeconds });
      return msg("note.choice.apply");
    }
  }
}

function settledMsg(choice: NoteChoice, overview: GenerationOverview): Msg {
  switch (choice.kind) {
    case "accept": return msg("note.settled.accepted", { choice: choice.label });
    case "regenerate_keyframe": return msg("note.settled.regenerated", { shots: labels(overview, choice.shotIds) });
    case "edit_field": return msg("note.settled.edited", { shot: labels(overview, [choice.shotId]) });
    case "proposal": return msg("note.settled.applied");
    case "reply": return msg("note.settled.replied");
  }
}

function action(note: DirectorNote, choice: NoteChoice, choiceIndex: number): NoteAction {
  const base = { noteId: note.noteId, choiceIndex };
  switch (choice.kind) {
    case "accept": return { kind: "accept", ...base };
    case "regenerate_keyframe": return { kind: "regenerate", ...base, shotIds: choice.shotIds };
    case "edit_field": return { kind: "edit", ...base, shotId: choice.shotId, field: choice.field };
    case "proposal": return { kind: "proposal", ...base, proposalId: choice.proposalId };
    case "reply": return { kind: "reply", ...base };
  }
}

function anchorOf(note: DirectorNote, overview: GenerationOverview): { sceneId: string | null; shotIds: string[]; anchor: Msg } {
  const shotIds = note.anchor.shotIds ?? [];
  const sceneId = note.anchor.sceneId ?? (shotIds[0] ? overview.shots[shotIds[0]]?.sceneId ?? null : null);
  if (shotIds.length) return { sceneId, shotIds, anchor: msg("note.anchor.shots", { shots: labels(overview, shotIds) }) };
  const ordinal = overview.scenes.find((s) => s.sceneId === sceneId)?.ordinal ?? 0;
  return { sceneId, shotIds, anchor: msg("note.anchor.scene", { scene: ordinal }) };
}

export function noteViews(notes: readonly DirectorNote[], overview: GenerationOverview, proposals: readonly DirectorProposal[] = []): NoteView[] {
  return notes.map((note) => {
    const where = anchorOf(note, overview);
    const resolvedChoice = note.state === "resolved" && note.resolution ? note.choices[note.resolution.choiceIndex] : undefined;
    return {
      noteId: note.noteId,
      letter: note.letter,
      text: note.text,
      kind: note.kind,
      blocking: note.blocking,
      state: note.state,
      ...where,
      choices: note.choices.map((choice, index) => ({
        label: choiceLabel(choice, overview, proposals),
        action: action(note, choice, index),
        chosen: note.resolution?.choiceIndex === index,
        paid: choice.kind === "regenerate_keyframe",
      })),
      settled: note.state === "stale" ? msg("note.settled.stale") : resolvedChoice ? settledMsg(resolvedChoice, overview) : null,
    };
  });
}

/** Open notes of one scene, blocking ones first, then by letter: the banner shows the first one. */
export function sceneOpenNotes(views: readonly NoteView[], sceneId: string): NoteView[] {
  return views
    .filter((view) => view.state === "open" && view.sceneId === sceneId)
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.letter.localeCompare(b.letter));
}

/** Callout chips for a shot card: every open or recently settled note anchored to that shot. */
export function shotCallouts(views: readonly NoteView[], shotId: string): NoteView[] {
  return views.filter((view) => view.shotIds.includes(shotId) && view.state !== "stale");
}
