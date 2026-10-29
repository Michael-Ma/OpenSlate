import type { DirectorProposal, GenerationOverview, ProposalPreview, ShotOverview } from "@openslate/core/public";
import type { TimelineSegment } from "./checks.ts";
import { isWorking, shotHasNoAnswer, unresolvedQueue, videoPanel, waitingMsg } from "./keyframes.ts";
import { regenerationState, regenerationSummary, type NoteAction, type NoteView } from "./notes.ts";
import { pendingAutomaticRetry } from "./media-state.ts";
import { formatMicros, keyframeEstimate, priceMsg } from "./price.ts";
import { msg, type Msg } from "./types.ts";
import type { MessageId } from "../i18n/messages.ts";

/**
 * The Director's notes in the Keyframes view (plan items DC-18, WA-10): the amber banner, one note at a time,
 * and the amber callout chips on shot cards. Pure; the component only renders and dispatches.
 */

export type Label = Msg | { text: string };

export interface NoteBannerAction {
  label: Label;
  action: NoteAction;
  /** chosen: the Director's recommendation (white); outline: an alternative; ghost: reply. */
  style: "chosen" | "outline" | "ghost";
  /** A paid choice (regenerate, video) shows its price next to its label. */
  price: Msg | null;
  enabled: boolean;
  /** Why a video confirm is off right now (frames still to make or open, a line to settle, clips being made). */
  reason: Msg | null;
  /** A proposal choice is carried out by accepting this exact proposal (with its preview digest). */
  proposal: DirectorProposal | null;
}

export interface NoteBannerView {
  noteId: string;
  letter: string;
  kind: NoteView["kind"];
  state: "open" | "settled";
  eyebrow: Msg;
  title: string;
  /** One line: the anchor, "settle before making video", the film length and the media effects; or how it was settled. */
  sub: Msg[];
  timeline: { now: TimelineSegment[]; after: TimelineSegment[] | null } | null;
  /** Every field a held proposal changes, Now → After, so the person sees the whole change before accepting it. */
  changes: ProposalChangeRow[];
  actions: NoteBannerAction[];
}

export interface ProposalChangeRow {
  /** Shown joined by " · ": ["2.3", Narration], [Scene 2, Scene direction]. */
  key: Label[];
  before: Label;
  after: Label;
  /** Long values (prompts, lines) go on their own lines when the list is opened in full; short ones read inline. */
  stacked: boolean;
  /** The preview's field id ("desiredFrames", "videoPrompt", …). */
  field: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

const FIELD_KEYS: Record<string, MessageId> = {
  desiredFrames: "plan.field.length", motion: "plan.field.motion", imagePrompt: "plan.field.prompt", videoPrompt: "plan.field.video_prompt",
  narration: "plan.field.narration", purpose: "plan.field.purpose", action: "plan.field.action", framing: "plan.field.framing",
};

/** A narration value as the preview carries it (canonical JSON of mode, text and voice), said the way Plan says it. */
function narrationValue(value: string): Label {
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { return { text: value }; }
  if (!raw || typeof raw !== "object") return msg("note.change.no_line");
  const parsed = raw as { mode?: string; text?: string; voice?: string };
  if (parsed.mode === "none") return msg("narr.choice.none");
  const text = parsed.text?.trim() ?? "";
  if (!text) return msg(parsed.mode === "uploaded" ? "narr.choice.recording" : "note.change.no_line");
  return parsed.voice === "personal" ? msg("note.change.line_personal", { text }) : { text };
}

function changeValue(field: string, value: string): Label {
  if (field === "desiredFrames") return msg("note.change.seconds", { seconds: round1(Number(value) / 30) });
  if (field === "narration") return narrationValue(value);
  return { text: value };
}

/** The proposal's own changes, in its order: the web never diffs anything itself. */
export function proposalChanges(preview: ProposalPreview, overview: GenerationOverview): ProposalChangeRow[] {
  return preview.changes.map((change) => {
    const field = msg(change.sceneId && !change.shotId ? (change.field === "title" ? "plan.scene.title_label" : "plan.scene.direction_label") : FIELD_KEYS[change.field] ?? "note.change.field_other");
    const owner: Label = change.shotId
      ? { text: overview.shots[change.shotId]?.label ?? "?" }
      : msg("note.change.scene", { scene: overview.scenes.find((s) => s.sceneId === change.sceneId)?.ordinal ?? "?" });
    const before = changeValue(change.field, change.before), after = changeValue(change.field, change.after);
    // A worded value (a mode name, "No line yet") is short in both languages.
    const length = (value: Label) => ("text" in value ? value.text.length : 12);
    return { key: [owner, field], before, after, stacked: length(before) + length(after) > 56, field: change.field };
  });
}

/** The proposal a note's choices carry, if the proposals read has it. */
export function noteProposal(note: NoteView, proposals: readonly DirectorProposal[]): DirectorProposal | null {
  for (const choice of note.choices)
    if (choice.action.kind === "proposal") {
      const id = choice.action.proposalId;
      const proposal = proposals.find((p) => p.proposalId === id);
      if (proposal) return proposal;
    }
  return null;
}

function shotSegment(label: string, seconds: number, hot: boolean): TimelineSegment {
  return { kind: "shot", text: msg("check.segment.shot", { label, seconds }), seconds, hot, label };
}

/** The scene after the note's scene, for the dashed tail of the strip. */
function tailAfter(overview: GenerationOverview, sceneId: string | null): number | null {
  const scenes = [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal);
  const index = scenes.findIndex((scene) => scene.sceneId === sceneId);
  return index >= 0 ? scenes[index + 1]?.ordinal ?? null : null;
}

/**
 * Now / After from the proposal's own preview (the web never diffs anything itself): the rows of the note's scene,
 * the changed ones hot, then the next scene, which starts later by the seconds the scene gains.
 */
export function proposalTimeline(preview: ProposalPreview, overview: GenerationOverview, sceneId: string | null): { now: TimelineSegment[]; after: TimelineSegment[] } {
  const rows = preview.timeline.filter((row) => !sceneId || row.sceneId === sceneId);
  const gained = round1(rows.reduce((sum, row) => sum + row.afterSeconds - row.nowSeconds, 0));
  const next = tailAfter(overview, sceneId);
  const tail = (later: boolean): TimelineSegment => ({
    kind: "tail",
    // What follows starts later when the scene grows and earlier when it shrinks.
    text: !later || !gained
      ? (next !== null ? msg("check.tail.scene", { scene: next }) : msg("check.tail.end"))
      : next !== null
        ? msg(gained > 0 ? "check.tail.scene_later" : "check.tail.scene_earlier", { scene: next, seconds: Math.abs(gained) })
        : msg(gained > 0 ? "check.tail.end_later" : "check.tail.end_earlier", { seconds: Math.abs(gained) }),
    seconds: 0,
    hot: false,
  });
  return {
    now: [...rows.map((row) => shotSegment(row.label, row.nowSeconds, false)), tail(false)],
    after: [...rows.map((row) => shotSegment(row.label, row.afterSeconds, row.changed)), tail(true)],
  };
}

/** What a regenerate choice costs: the shots' own quotes (exact, voice included), else the scene's per-keyframe quote. */
export function regeneratePrice(shotIds: readonly string[], overview: GenerationOverview, locale: string): Msg | null {
  const quote = keyframeEstimate(shotIds, overview);
  if (!quote) return msg("price.unknown");
  return priceMsg({ ...quote, units: 1, unitMicros: "0" }, locale);
}

/** Neutral waiting still guards the inputs of a bound purchase; it is separate from visible running progress. */
function regenerationBlock(shot: ShotOverview): Msg | null {
  if (shotHasNoAnswer(shot)) return msg("scene.unknown_outcome", { shots: shot.label });
  const retrying = pendingAutomaticRetry(shot.keyframe);
  if (retrying) return msg("inspector.failed.retrying", { count: retrying.autoRetriesLeft });
  const wait = unresolvedQueue(shot.keyframe) ?? unresolvedQueue(shot.video, true);
  if (wait) return waitingMsg(wait);
  return isWorking(shot.keyframe) || isWorking(shot.video) ? msg(isWorking(shot.video) ? "note.callout.wait_clip" : "note.callout.wait_keyframe", { shot: shot.label }) : null;
}

function choiceAction(note: NoteView, index: number, overview: GenerationOverview, proposals: readonly DirectorProposal[], locale: string): NoteBannerAction {
  const choice = note.choices[index]!;
  const action = choice.action;
  const style = action.kind === "reply" ? "ghost" : index === 0 ? "chosen" : "outline";
  const base = { label: choice.label, action, style, price: null, enabled: note.state === "open", reason: null, proposal: null } satisfies NoteBannerAction;
  switch (action.kind) {
    case "proposal": {
      const proposal = proposals.find((p) => p.proposalId === action.proposalId) ?? null;
      // Only a held proposal can be accepted; a stale, rejected or undone one stays visible but unavailable.
      return { ...base, proposal, enabled: base.enabled && proposal?.state === "held" };
    }
    case "regenerate": {
      const busy = action.shotIds.some((id) => { const shot = overview.shots[id]; return !shot || !!regenerationBlock(shot); });
      // A stale note can still be carried out by a regenerate (the server accepts it); only an in-flight job stops it.
      return { ...base, price: regeneratePrice(action.shotIds, overview, locale), enabled: (note.state !== "resolved" || note.regeneration === "failed") && !busy && keyframeEstimate(action.shotIds, overview) !== null };
    }
    case "edit": return { ...base, enabled: note.state !== "resolved" };
    case "confirm_video": {
      // The same check as the scene's own button: one confirm, wherever it is pressed.
      const scene = overview.scenes.find((s) => s.sceneId === action.sceneId);
      const panel = scene ? videoPanel(overview, scene, locale) : null;
      const ready = panel?.action === "confirm" && panel.enabled;
      // A saved scene has nothing left to confirm; its panel offers Play, which is no reason. Say what to do instead.
      const reason = !base.enabled || !panel || !scene ? null
        : panel.action === "confirm" ? panel.reason
          : panel.action === "play" ? msg("note.why.video_saved", { scene: scene.ordinal })
            : panel.reason ?? panel.label;
      return { ...base, price: ready ? panel.price : null, enabled: base.enabled && ready, reason };
    }
    default: return base;
  }
}

/**
 * The banner for one note. Open: the note's text, where it applies, and its choices in the Director's order.
 * Settled: how it was settled (the chosen choice, even before the server's read catches up), and for an accepted
 * proposal the strip as it now stands.
 */
export function noteBanner(note: NoteView, overview: GenerationOverview, proposals: readonly DirectorProposal[], locale: string, settledChoice?: number): NoteBannerView {
  const proposal = noteProposal(note, proposals);
  const base = { noteId: note.noteId, letter: note.letter, kind: note.kind, title: note.text };
  const chosenIndex = settledChoice ?? note.choices.findIndex((choice) => choice.chosen);
  const chosen = note.choices[chosenIndex];
  const failed = chosen?.action.kind === "regenerate" && regenerationState(overview, chosen.action.shotIds) === "failed";
  if (!failed && (settledChoice !== undefined || note.state === "resolved")) {
    const applied = chosen?.action.kind === "proposal" && proposal;
    return {
      ...base,
      state: "settled",
      eyebrow: msg(note.kind === "observation" ? "note.eyebrow.observation_done" : "note.eyebrow.done"),
      sub: [chosen ? settledMsg(chosen.action, chosen.label, overview) : note.settled ?? msg("note.settled.applied")],
      timeline: applied ? { now: proposalTimeline(proposal.preview, overview, note.sceneId).after, after: null } : null,
      changes: [],
      actions: [],
    };
  }
  const sub: Msg[] = failed && chosen ? [settledMsg(chosen.action, chosen.label, overview)] : [note.anchor];
  if (note.blocking) sub.push(msg("note.blocking"));
  if (proposal && proposal.state === "held") {
    if (proposal.preview.filmSecondsNow !== proposal.preview.filmSecondsAfter)
      sub.push(msg("note.proposal.film_length", { now: round1(proposal.preview.filmSecondsNow), after: round1(proposal.preview.filmSecondsAfter) }));
    for (const effect of [...new Set(proposal.preview.effects.map((e) => e.effect))]) sub.push(msg(`note.proposal.${effect}`));
  } else if (proposal) sub.push(msg("note.proposal.unavailable"));
  return {
    ...base,
    state: "open",
    eyebrow: msg(note.kind === "observation" ? "note.eyebrow.observation" : "note.eyebrow"),
    sub,
    timeline: proposal && proposal.state === "held" ? proposalTimeline(proposal.preview, overview, note.sceneId) : null,
    changes: proposal && proposal.state === "held" ? proposalChanges(proposal.preview, overview) : [],
    actions: note.choices.map((_, index) => choiceAction(note, index, overview, proposals, locale)),
  };
}

/** How a choice settled its note, said the same way the notes model says it once the server's read has caught up. */
export function settledMsg(action: NoteAction, label: Label, overview: GenerationOverview): Msg {
  const labels = (ids: readonly string[]) => ids.map((id) => overview.shots[id]?.label ?? "?").join(", ");
  switch (action.kind) {
    case "accept": return msg("note.settled.accepted", { choice: "text" in label ? label.text : "" });
    // Not "regenerated" while the new keyframe is still being made.
    case "regenerate": return regenerationSummary(overview, action.shotIds);
    case "edit": return msg("note.settled.edited", { shot: labels([action.shotId]) });
    case "proposal": return msg("note.settled.applied");
    case "confirm_video": return msg("note.settled.video_confirmed", { scene: overview.scenes.find((s) => s.sceneId === action.sceneId)?.ordinal ?? "?" });
    case "reply": return msg("note.settled.replied");
    case "card": return msg("note.settled.card_applied");
  }
}

// ---- card callouts ----------------------------------------------------------------------

export interface NoteCallout {
  noteId: string;
  letter: string;
  /** The note's first clause, whole: a card shows it on one line (cut by CSS), with the full note as its tooltip. */
  text: string;
  /** The whole note, for the card's tooltip and accessible description. */
  full: string;
  done: boolean;
  /** For a settled note: the choice that settled it ("Keep maroon"). */
  doneLabel: Label | null;
  /** An open note's regenerate choice for this shot, offered as a link under the chip (as in the design). */
  regenerate: {
    choiceIndex: number;
    /** The full choice, as the banner names it ("Regenerate 2.2 · about $0.04"): the link's tooltip. */
    label: Label;
    /** What the link shows on the card before its price ("New take", "2 new takes"); the card names the shot. */
    take: Msg;
    /** The shots it remakes, read after the short label by a screen reader ("2.2"). */
    shots: string;
    price: Msg | null;
    enabled: boolean;
    /** Why it is off while a job on its shots runs (the link's tooltip then); null when it is on. */
    wait: Msg | null;
  } | null;
}

const CLAUSE_END = /[,;:，。；：！？!?]|\.(?=\s|$)|\s[—–]\s/;

/**
 * "Mara's coat came out maroon, not red." → "Mara's coat came out maroon". The clause is kept whole unless a `max` is
 * given; then a longer one ends at a word with "…". (Chips cut it where their room ends, so no meaning is cut early.)
 */
export function firstClause(text: string, max = Infinity): string {
  const clause = text.split(CLAUSE_END)[0]!.trim();
  if (clause.length <= max) return clause;
  const cut = clause.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function noteCallout(note: NoteView, shotId: string, overview: GenerationOverview, locale: string): NoteCallout {
  const done = note.state === "resolved" && (note.regeneration === null || note.regeneration === "complete");
  const chosen = note.choices.find((choice) => choice.chosen) ?? null;
  const regenerateIndex = note.choices.findIndex((choice) => choice.action.kind === "regenerate" && choice.action.shotIds.includes(shotId));
  const regenerate = !done && regenerateIndex >= 0 ? note.choices[regenerateIndex]! : null;
  const ids = regenerate?.action.kind === "regenerate" ? regenerate.action.shotIds : [];
  const estimate = keyframeEstimate(ids, overview);
  const unique = [...new Set(ids)];
  const shots = unique.map((id) => overview.shots[id]?.label ?? "?").join(", ");
  const priced = !!estimate && !estimate.priceUnknown && Number(estimate.micros) > 0;
  const price = estimate ? formatMicros(estimate.micros, locale) : "";
  const label = estimate?.subscription
    ? msg(estimate.priceUnknown ? "note.choice.regenerate_codex_unknown" : priced ? "note.choice.regenerate_codex_about" : "note.choice.regenerate_codex", { shots, price })
    : msg(priced ? "note.choice.regenerate_priced" : "note.choice.regenerate_unpriced", { shots, price });
  // A job on one of its shots holds the link; its tooltip says which one to wait for.
  const wait = unique.map((id) => overview.shots[id]).flatMap((shot) => shot ? [regenerationBlock(shot)] : []).find((reason) => !!reason) ?? null;
  return {
    noteId: note.noteId,
    letter: note.letter,
    text: firstClause(note.text),
    full: note.text,
    done,
    doneLabel: done ? chosen?.label ?? null : null,
    regenerate: regenerate && regenerate.action.kind === "regenerate"
      ? {
        choiceIndex: regenerateIndex,
        // Keep the price in the link's own label: this purchase remains priced when another note fills the banner.
        label,
        take: unique.length > 1 ? msg("note.callout.take_many", { count: unique.length }) : msg("note.callout.take_one"),
        shots,
        price: regeneratePrice(ids, overview, locale),
        enabled: choiceAction(note, regenerateIndex, overview, [], locale).enabled,
        wait,
      }
      : null,
  };
}
