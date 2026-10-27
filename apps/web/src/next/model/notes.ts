import type { DirectorNote, DirectorProposal, GenerationOverview, NoteChoice } from "@openslate/core/public";
import { isWorking, shotHasNoAnswer } from "./keyframes.ts";
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
  /** The scene's "Confirm frames & generate video", pressed from the note; it resolves with the confirmation. */
  | { kind: "confirm_video"; noteId: string; choiceIndex: number; sceneId: string }
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
  /** How it was settled, for a resolved note; what changed since, for a stale one. */
  settled: Msg | null;
  /** A regeneration resolution records the request, not its outcome; only a returned frame is complete. */
  regeneration: RegenerationState | null;
  /**
   * Settled by a regenerate whose new keyframe is still being made: the line says so ("Regenerating 2.2…"), neutral
   * and without a check, until the new take arrives.
   */
  making: boolean;
  /** The proposal the Director accepted on the person's typed word; the chat offers its Undo under the note. */
  acceptedFromMessage: string | null;
}

const labels = (overview: GenerationOverview, shotIds: readonly string[]) => shotIds.map((id) => overview.shots[id]?.label ?? "?").join(", ");
const ordinalOf = (overview: GenerationOverview, sceneId: string) => overview.scenes.find((s) => s.sceneId === sceneId)?.ordinal ?? "?";

function choiceLabel(choice: NoteChoice, overview: GenerationOverview, proposals: readonly DirectorProposal[]): Msg | { text: string } {
  switch (choice.kind) {
    case "accept": return { text: choice.label };
    case "regenerate_keyframe": return msg("note.choice.regenerate", { shots: labels(overview, choice.shotIds) });
    case "edit_field": return msg(`note.choice.edit.${choice.field}`, { shot: labels(overview, [choice.shotId]) });
    case "reply": return msg("note.choice.reply");
    case "confirm_video": return msg("note.choice.confirm_video", { scene: ordinalOf(overview, choice.sceneId) });
    case "proposal": {
      const proposal = proposals.find((p) => p.proposalId === choice.proposalId);
      const changes = proposal?.preview.changes ?? [];
      // Name the change only when it is the whole change; anything more is "Apply N changes", listed in the banner.
      const duration = changes.length === 1 && changes[0]!.field === "desiredFrames" ? proposal!.preview.timeline.find((row) => row.shotId === changes[0]!.shotId) : undefined;
      if (duration) return msg("note.choice.make_seconds", { shot: duration.label, seconds: duration.afterSeconds });
      return changes.length > 1 ? msg("note.choice.apply_count", { count: changes.length }) : msg("note.choice.apply");
    }
  }
}

/** Some of these shots' new keyframes are still being made (or wait their turn). */
export const regenerating = (overview: GenerationOverview, shotIds: readonly string[]) =>
  shotIds.some((id) => { const shot = overview.shots[id]; return !!shot && isWorking(shot.keyframe); });

export type RegenerationState = "failed" | "making" | "waiting" | "complete";

const failedKeyframe = (shot: GenerationOverview["shots"][string]) => (shot.keyframe.replacement ?? shot.keyframe).state === "failed";

/** A retained frame is not proof that its replacement returned successfully. */
export function regenerationState(overview: GenerationOverview, shotIds: readonly string[]): RegenerationState {
  const shots = shotIds.map((id) => overview.shots[id]).filter((shot) => !!shot);
  if (shots.some(failedKeyframe)) return "failed";
  if (shots.some(shotHasNoAnswer)) return "waiting";
  if (regenerating(overview, shotIds)) return "making";
  return shots.length === shotIds.length && shots.length > 0 && shots.every((shot) => shot.keyframe.state === "ready" && !!shot.keyframe.artifact && !shot.keyframe.replacement)
    ? "complete" : "waiting";
}

/** A resolved choice is not a completed keyframe: unanswered and unclassified queues keep their own status. */
export function regenerationSummary(overview: GenerationOverview, shotIds: readonly string[]): Msg {
  const shots = shotIds.map((id) => overview.shots[id]).filter((shot) => !!shot);
  const names = labels(overview, shotIds);
  const unanswered = shots.filter(shotHasNoAnswer);
  if (unanswered.length) return msg("scene.unknown_outcome", { shots: unanswered.map((shot) => shot.label).join(", ") });
  const failed = shots.filter(failedKeyframe);
  if (failed.length) return msg("note.settled.regeneration_failed", { shots: failed.map((shot) => shot.label).join(", ") });
  const state = regenerationState(overview, shotIds);
  return msg(state === "making" ? "note.settled.regenerating" : state === "complete" ? "note.settled.regenerated" : "note.settled.waiting", { shots: names });
}

function fromMessage(choice: NoteChoice | undefined, proposals: readonly DirectorProposal[]): DirectorProposal | undefined {
  if (choice?.kind !== "proposal") return undefined;
  const proposal = proposals.find((p) => p.proposalId === choice.proposalId);
  return proposal?.state === "accepted" && proposal.decision?.action === "accept" && proposal.decision.actor === "director_on_user_request" ? proposal : undefined;
}

function settledMsg(choice: NoteChoice, overview: GenerationOverview, proposals: readonly DirectorProposal[]): Msg {
  switch (choice.kind) {
    case "confirm_video": return msg("note.settled.video_confirmed", { scene: ordinalOf(overview, choice.sceneId) });
    case "accept": return msg("note.settled.accepted", { choice: choice.label });
    case "regenerate_keyframe": return regenerationSummary(overview, choice.shotIds);
    case "edit_field": return msg("note.settled.edited", { shot: labels(overview, [choice.shotId]) });
    case "proposal": return msg(fromMessage(choice, proposals) ? "note.settled.applied_from_message" : "note.settled.applied");
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
    case "confirm_video": return { kind: "confirm_video", ...base, sceneId: choice.sceneId };
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

/**
 * What made a stale note out of date, as far as the overview tells: the keyframe the Director looked at was replaced
 * (a new take), or else its shots (or its scene) changed after it was written.
 */
function staleMsg(note: DirectorNote, overview: GenerationOverview, where: { sceneId: string | null; shotIds: string[] }): Msg {
  const seen = note.seenKeyframe;
  const shot = seen ? overview.shots[seen.shotId] : undefined;
  const current = shot?.keyframe.artifact;
  if (shot && current && (current.artifactId !== seen!.artifactId || current.sha256 !== seen!.sha256))
    return msg("note.settled.stale_keyframe", { shot: shot.label });
  if (where.shotIds.length) return msg("note.settled.stale_shots", { shots: labels(overview, where.shotIds) });
  const ordinal = overview.scenes.find((s) => s.sceneId === where.sceneId)?.ordinal;
  return ordinal !== undefined ? msg("note.settled.stale_scene", { scene: ordinal }) : msg("note.settled.stale");
}

export function noteViews(notes: readonly DirectorNote[], overview: GenerationOverview, proposals: readonly DirectorProposal[] = []): NoteView[] {
  return notes.map((note) => {
    const where = anchorOf(note, overview);
    const resolvedChoice = note.state === "resolved" && note.resolution ? note.choices[note.resolution.choiceIndex] : undefined;
    const regeneration = resolvedChoice?.kind === "regenerate_keyframe" ? regenerationState(overview, resolvedChoice.shotIds) : null;
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
        paid: choice.kind === "regenerate_keyframe" || choice.kind === "confirm_video",
      })),
      settled: note.state === "stale" ? staleMsg(note, overview, where) : resolvedChoice ? settledMsg(resolvedChoice, overview, proposals) : null,
      regeneration,
      making: regeneration === "making",
      acceptedFromMessage: fromMessage(resolvedChoice, proposals)?.proposalId ?? null,
    };
  });
}

/**
 * Open notes and failed regeneration requests of one scene: blocking ones first, then recommendations before
 * observations (a note asking for a change leads the banner over one saying a frame works), then by letter.
 */
export function sceneOpenNotes(views: readonly NoteView[], sceneId: string): NoteView[] {
  const rank = (view: NoteView) => (view.blocking ? 0 : view.kind === "recommendation" ? 1 : 2);
  return views
    .filter((view) => (view.state === "open" || view.regeneration === "failed") && view.sceneId === sceneId)
    .sort((a, b) => rank(a) - rank(b) || a.letter.localeCompare(b.letter));
}

/** Callout chips for a shot card: every open or recently settled note anchored to that shot. */
export function shotCallouts(views: readonly NoteView[], shotId: string): NoteView[] {
  return views.filter((view) => view.shotIds.includes(shotId) && view.state !== "stale");
}
