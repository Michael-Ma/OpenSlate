import type { DirectorNote, GenerationOverview, NoteChoice, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { listLabels } from "./keyframes.ts";
import { mediaCountMsgs, mediaCounts } from "./plan.ts";
import { priceMsg } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Contract 7.0.0 confirmation cards in the Director chat (docs/ai/director-gaps, decisions 5 and 9): the Director
 * asks, the application writes the note, and only the person's click applies it. The server's note text is English
 * and fixed; the card says the same facts in the interface language from the film itself: what changes, what it
 * costs, and that Undo stays available. Choice 0 is the change; choice 1 is the "keep" accept the server adds.
 */

export type CardChoice = Extract<NoteChoice, { kind: "confirm_delete_shots" | "confirm_delete_scene" | "use_take" | "confirm_resume" }>;
export type CardKind = "delete_shots" | "delete_scene" | "use_take" | "resume";

export const isCardChoice = (choice: NoteChoice | undefined): choice is CardChoice =>
  !!choice && (choice.kind === "confirm_delete_shots" || choice.kind === "confirm_delete_scene" || choice.kind === "use_take" || choice.kind === "confirm_resume");

/** One line of the card; `strong` facts lead (the money ones). */
export interface CardFact {
  text: Msg;
  tone: "change" | "cost" | "safe";
  /** Joined in the interface language into the message's {list} ("2 keyframes and 1 clip"). */
  list?: Msg[];
}

export interface ConfirmCardView {
  kind: CardKind;
  noteId: string;
  title: Msg;
  /** "2.2, 2.3", "Scene 2" or "Whole film". */
  anchor: Msg;
  facts: CardFact[];
  /** Small frames of what the change touches (deleted shots; the current and the chosen take). */
  frames: { label: string; artifact: StudioArtifactRef | null; role: "now" | "chosen" | "gone" }[];
  confirm: { index: number; label: Msg; destructive: boolean };
  keep: { index: number; label: Msg } | null;
  /** The card can no longer be carried out as written (a shot is gone, the film is no longer stopped). */
  unavailable: Msg | null;
  state: DirectorNote["state"];
  /** How it ended: which button, said in the interface language. */
  settled: Msg | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const filmSeconds = (overview: GenerationOverview, without: ReadonlySet<string> = new Set()) =>
  round1(Object.values(overview.shots).filter((shot) => !without.has(shot.shotId)).reduce((sum, shot) => sum + shot.durationFrames, 0) / overview.fps);
const working = (shot: ShotOverview) => [shot.keyframe, shot.video].some((slot) => slot.state === "running" || slot.state === "queued" || slot.state === "no_answer");

function deleteFacts(overview: GenerationOverview, shots: ShotOverview[]): CardFact[] {
  const gone = new Set(shots.map((shot) => shot.shotId));
  const media = mediaCountMsgs(mediaCounts(shots));
  const facts: CardFact[] = [];
  facts.push({ tone: "change", text: msg("card.delete.length", { now: filmSeconds(overview), after: filmSeconds(overview, gone) }) });
  const later = shots.some((shot) => {
    const scene = overview.scenes.find((s) => s.sceneId === shot.sceneId);
    const index = scene?.shotIds.indexOf(shot.shotId) ?? -1;
    return !!scene && scene.shotIds.slice(index + 1).some((id) => !gone.has(id));
  });
  if (later) facts.push({ tone: "change", text: msg("card.delete.renumbers") });
  facts.push(media.length
    ? { tone: "cost", text: msg("card.delete.paid_media"), list: media }
    : { tone: "safe", text: msg("card.delete.nothing_made") });
  facts.push({ tone: "safe", text: msg("card.undo") });
  return facts;
}

/** The card for a note whose first choice is a confirmation, or null for any other note. */
export function confirmCard(note: DirectorNote, overview: GenerationOverview, locale: string): ConfirmCardView | null {
  const choice = note.choices[0];
  if (!isCardChoice(choice)) return null;
  const keepIndex = note.choices.findIndex((c, i) => i > 0 && c.kind === "accept");
  const resolvedIndex = note.state === "resolved" ? note.resolution?.choiceIndex ?? null : null;
  const base = { noteId: note.noteId, state: note.state };
  const keepLabel = (id: "card.keep.shots" | "card.keep.scene" | "card.keep.take" | "card.keep.stopped") => (keepIndex > 0 ? { index: keepIndex, label: msg(id) } : null);
  const ended = (applied: Msg, kept: Msg): Msg | null => (resolvedIndex === null ? note.state === "stale" ? msg("card.settled.stale") : null : resolvedIndex === 0 ? applied : kept);

  switch (choice.kind) {
    case "confirm_delete_shots": {
      const shots = choice.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
      const labels = shots.map((shot) => shot.label);
      const missing = shots.length !== choice.shotIds.length;
      return {
        ...base, kind: "delete_shots",
        title: msg("card.delete_shots.title", { count: choice.shotIds.length, shots: listLabels(labels, locale) }),
        anchor: msg("note.anchor.shots", { shots: labels.join(", ") }),
        facts: deleteFacts(overview, shots),
        frames: shots.map((shot) => ({ label: shot.label, artifact: shot.keyframe.artifact ?? null, role: "gone" as const })),
        confirm: { index: 0, label: msg("card.delete_shots.confirm", { count: choice.shotIds.length }), destructive: true },
        keep: keepLabel("card.keep.shots"),
        unavailable: missing && note.state === "open" ? msg("card.unavailable.gone") : shots.some(working) ? msg("card.unavailable.working") : null,
        settled: ended(msg("card.settled.deleted_shots", { shots: labels.join(", ") || "?" }), msg("card.settled.kept")),
      };
    }
    case "confirm_delete_scene": {
      const scene = overview.scenes.find((s) => s.sceneId === choice.sceneId);
      const shots = (scene?.shotIds ?? []).map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
      const later = !!scene && overview.scenes.some((s) => s.ordinal > scene.ordinal);
      const facts = deleteFacts(overview, shots).filter((fact) => fact.text.id !== "card.delete.renumbers");
      if (later) facts.splice(1, 0, { tone: "change", text: msg("card.delete.renumbers_scenes") });
      return {
        ...base, kind: "delete_scene",
        title: shots.length ? msg("card.delete_scene.title", { scene: scene?.ordinal ?? "?", title: scene?.title ?? "", count: shots.length })
          : msg("card.delete_scene.title_empty", { scene: scene?.ordinal ?? "?", title: scene?.title ?? "" }),
        anchor: msg("note.anchor.scene", { scene: scene?.ordinal ?? "?" }),
        facts,
        frames: shots.slice(0, 4).map((shot) => ({ label: shot.label, artifact: shot.keyframe.artifact ?? null, role: "gone" as const })),
        confirm: { index: 0, label: shots.length ? msg("card.delete_scene.confirm", { count: shots.length }) : msg("card.delete_scene.confirm_empty"), destructive: true },
        keep: keepLabel("card.keep.scene"),
        unavailable: !scene && note.state === "open" ? msg("card.unavailable.gone") : shots.some(working) ? msg("card.unavailable.working") : null,
        settled: ended(msg("card.settled.deleted_scene", { scene: scene?.ordinal ?? "?" }), msg("card.settled.kept")),
      };
    }
    case "use_take": {
      const shot = overview.shots[choice.shotId];
      const scene = shot ? overview.scenes.find((s) => s.sceneId === shot.sceneId) : undefined;
      const label = shot?.label ?? "?";
      const hasClip = !!shot && (shot.video.state === "ready" || shot.video.takeCount > 0);
      const facts: CardFact[] = [{ tone: "change", text: msg("card.take.keyframe", { shot: label }) }];
      if (hasClip) {
        facts.push({ tone: "change", text: msg("card.take.clip_outdated", { shot: label }) });
        const quote = scene?.quotes.oneClip;
        facts.push({ tone: "cost", text: quote ? { ...msg("card.take.remake_cost"), messages: { price: priceMsg(quote, locale) } } : msg("card.take.remake_cost_unknown") });
      } else facts.push({ tone: "safe", text: msg("card.take.no_clip", { shot: label }) });
      facts.push({ tone: "safe", text: msg("card.take.kept") });
      return {
        ...base, kind: "use_take",
        title: msg("card.take.title", { shot: label }),
        anchor: msg("note.anchor.shots", { shots: label }),
        facts,
        frames: [
          { label, artifact: shot?.keyframe.artifact ?? null, role: "now" },
          // The chosen take's sha256 comes from the shot's take history (the view reads it); the id names it here.
          { label, artifact: null, role: "chosen" },
        ],
        confirm: { index: 0, label: msg("card.take.confirm"), destructive: false },
        keep: keepLabel("card.keep.take"),
        unavailable: !shot && note.state === "open" ? msg("card.unavailable.gone")
          : shot?.keyframe.artifact?.artifactId === choice.artifactId ? msg("card.unavailable.take_current")
          : shot && working(shot) ? msg("card.unavailable.working") : null,
        settled: ended(msg("card.settled.take", { shot: label }), msg("card.settled.kept_take")),
      };
    }
    case "confirm_resume": {
      const stopped = overview.stopped;
      const facts: CardFact[] = [];
      if (stopped) {
        if (stopped.detachedJobs) facts.push({ tone: "cost", text: msg("card.resume.restarts", { count: stopped.detachedJobs }) });
        else facts.push({ tone: "change", text: msg("card.resume.nothing_unsent") });
        if (stopped.sentJobs) facts.push({ tone: "change", text: msg("card.resume.sent", { count: stopped.sentJobs }) });
      } else facts.push({ tone: "change", text: msg("card.resume.queued") });
      facts.push({ tone: "safe", text: msg("card.resume.stop_again") });
      return {
        ...base, kind: "resume",
        title: msg("card.resume.title"),
        anchor: msg("note.anchor.film"),
        facts,
        frames: [],
        confirm: { index: 0, label: stopped?.detachedJobs ? msg("card.resume.confirm_count", { count: stopped.detachedJobs }) : msg("card.resume.confirm"), destructive: false },
        keep: keepLabel("card.keep.stopped"),
        unavailable: !stopped && note.state === "open" ? msg("card.unavailable.not_stopped") : null,
        settled: ended(msg("card.settled.resumed"), msg("card.settled.kept_stopped")),
      };
    }
  }
}
