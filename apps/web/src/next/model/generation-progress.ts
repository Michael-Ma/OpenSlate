import type { DirectorGenerationBlock, DirectorGenerationEffect, GenerationOverview, MediaSlot, ShotNarration, ShotOverview } from "@openslate/core/public";
import type { Locale } from "../../shared/locale-preference.ts";
import { formatList } from "../i18n/typeset.ts";
import { queuedToRun } from "./media-state.ts";
import { priceMsg } from "./price.ts";
import { msg, type Msg } from "./types.ts";

const intlLocale = (locale: Locale) => (locale === "zh-CN" ? "zh-CN" : "en-US");

/**
 * Live progress of the keyframes and voice lines a Director turn started, from the generation overview (design study
 * docs/ai/prototypes/failure-display, item 1). A regenerate keeps the take in use, so a keyframe's state is its
 * replacement's while there is one. Failures with automatic retries left are still being made. Only a queue that will
 * run is "queued"; one waiting on the person or the studio is "waiting", so Stop goes away once nothing is on its way.
 */
export type ShotProgressState = "done" | "making" | "queued" | "waiting" | "stopped" | "given_up" | "failed" | "no_answer";

export interface PartProgress {
  state: ShotProgressState;
  /** failed: counted as spent (the reservation was not released). */
  charged: boolean;
}

export interface ShotProgress {
  shotId: string;
  label: string;
  /** The part that needs the most attention decides the shot's state. */
  state: ShotProgressState;
  charged: boolean;
  part: "keyframe" | "voice";
  /** null when this turn did not make the shot's keyframe (a voice line only). */
  keyframe: PartProgress | null;
  /** null when no voice line of this shot is tracked. */
  voice: PartProgress | null;
}

export interface GenerationProgress {
  /** What the head counts: the keyframes, or the voice lines when the turn made only those. */
  media: "keyframes" | "voices";
  shots: ShotProgress[];
  done: number;
  total: number;
  /** Every part of every shot is back. */
  allDone: boolean;
  /** Scene ordinals as a list ("3", "2 and 3"), for the header. */
  scenes: string;
  sceneCount: number;
  /** The one scene, for "Open Scene 3" when everything is back. */
  sceneId: string | null;
  price: Msg;
  /** Some of it is still being made: Stop can halt what has not been sent. */
  running: boolean;
  /** The first shot that needs the person, failed before waiting, with what to do next. */
  next: { shotId: string; label: string; text: Msg } | null;
}

function slotProgress(slot: MediaSlot): PartProgress {
  const live = slot.replacement ?? slot;
  const charged = !!live.failure?.charged;
  switch (live.state) {
    case "ready": return { state: "done", charged };
    case "running": return { state: "making", charged };
    case "queued": return { state: live.waiting?.code === "stopped" ? "stopped" : queuedToRun(live) ? "queued" : "waiting", charged };
    case "no_answer": return { state: "no_answer", charged };
    case "failed": return { state: (live.failure?.autoRetriesLeft ?? 0) > 0 ? "making" : "failed", charged };
    // none, outdated, direction_required, choose_take: nothing of this request is on its way any more.
    default: return { state: slot.state === "ready" ? "done" : slot.takenOff === "released" ? "given_up" : "stopped", charged };
  }
}

/** A voice line still on its way or settled; a line without a voice (none, text only) is not tracked. */
function narrationProgress(narration: ShotNarration): PartProgress | null {
  const charged = !!narration.failure?.charged;
  switch (narration.state) {
    case "making": return { state: "making", charged };
    case "ready": return { state: "done", charged };
    case "no_answer": return { state: "no_answer", charged };
    case "failed": return { state: (narration.failure?.autoRetriesLeft ?? 0) > 0 ? "making" : "failed", charged };
    default: return null;
  }
}

/** Most attention first: a failure, an unanswered job, work on its way, then how it ended. */
const RANK: readonly ShotProgressState[] = ["failed", "no_answer", "making", "queued", "waiting", "given_up", "stopped", "done"];

/** `keyframe`/`voice`: whether this turn made the shot's keyframe and voice line (both by default). */
export function shotProgress(shot: ShotOverview, track: { keyframe: boolean; voice: boolean } = { keyframe: true, voice: true }): ShotProgress {
  const keyframe = track.keyframe ? slotProgress(shot.keyframe) : null;
  const voice = track.voice ? narrationProgress(shot.narration) : null;
  const parts = [...(keyframe ? [{ part: "keyframe" as const, ...keyframe }] : []), ...(voice ? [{ part: "voice" as const, ...voice }] : [])];
  const lead = parts.sort((a, b) => RANK.indexOf(a.state) - RANK.indexOf(b.state))[0] ?? { part: "keyframe" as const, state: "done" as const, charged: false };
  return { shotId: shot.shotId, label: shot.label, state: lead.state, charged: lead.charged, part: lead.part, keyframe, voice };
}

function nextStep(shots: readonly ShotProgress[]): GenerationProgress["next"] {
  for (const state of ["failed", "no_answer"] as const) {
    const shot = shots.find((s) => s.state === state);
    if (shot) return { shotId: shot.shotId, label: shot.label, text: msg(`director.progress.next.${shot.part === "voice" ? "voice_" : ""}${state}`, { shot: shot.label }) };
  }
  return null;
}

/**
 * null for a transcription, or when the overview does not know the shots (yet). The effect lists every target shot,
 * voice-only ones included, while `keyframes` counts pictures only: a shot's keyframe was made by this turn unless
 * it was already back, so the head counts the keyframes still away against `keyframes`.
 */
export function generationProgress(effect: DirectorGenerationEffect, overview: GenerationOverview | null, locale: Locale): GenerationProgress | null {
  if (effect.kind !== "keyframes" || !overview || (effect.keyframes === 0 && effect.voiceLines === 0)) return null;
  const track = { keyframe: effect.keyframes > 0, voice: effect.voiceLines > 0 };
  const shots = effect.shotIds.flatMap((id) => (overview.shots[id] ? [shotProgress(overview.shots[id]!, track)] : []));
  if (!shots.length) return null;
  const ordinals = effect.sceneIds.flatMap((id) => { const scene = overview.scenes.find((s) => s.sceneId === id); return scene ? [String(scene.ordinal)] : []; });
  const media = effect.keyframes > 0 ? "keyframes" : "voices";
  const total = media === "keyframes" ? effect.keyframes : effect.voiceLines;
  // Every target of a voice-only turn is a voice line, so those are counted as they come back.
  const done = media === "keyframes" ? total - Math.min(total, shots.filter((shot) => shot.keyframe && shot.keyframe.state !== "done").length)
    : Math.min(total, shots.filter((shot) => shot.voice?.state === "done").length);
  const onItsWay = (part: PartProgress | null) => part?.state === "making" || part?.state === "queued";
  return {
    media,
    shots,
    done,
    total,
    allDone: shots.every((shot) => shot.state === "done"),
    scenes: formatList(ordinals, intlLocale(locale)),
    sceneCount: ordinals.length,
    sceneId: effect.sceneIds.length === 1 ? effect.sceneIds[0]! : null,
    price: priceMsg(effect.quote, locale),
    // A voice line still being made keeps Stop next to a failed keyframe of the same shot.
    running: shots.some((shot) => onItsWay(shot.keyframe) || onItsWay(shot.voice)),
    next: nextStep(shots),
  };
}

/**
 * A refused part of a Director request (item 2), with what unblocks it. Current while its jobs are still in the way;
 * once they are not, the line says the scene can go ahead.
 */
export interface BlockView {
  code: string;
  sceneId: string;
  scene: number | null;
  title: Msg;
  step: Msg;
  /** The shot to open first (the job to give up on, or the prompt to update). */
  open: { shotId: string; label: string } | null;
  /** Prompt refusals: the person can ask the Director to update the prompts (fills the composer, never sends). */
  ask: { shotIds: string[]; text: Msg } | null;
  resolved: boolean;
}

function inTheWay(overview: GenerationOverview, attempt: NonNullable<DirectorGenerationBlock["attempts"]>[number]): boolean {
  const shot = overview.shots[attempt.shotId];
  if (!shot) return false;
  const slot = attempt.kind === "image" ? shot.keyframe : shot.video;
  return [slot, slot.replacement].some((s) => s?.attemptId === attempt.attemptId && (s.state === "running" || s.state === "no_answer"));
}

/**
 * The jobs still in the way of a refused scene. A current server lists the scene's jobs with the refusal's own rule
 * (card X2, including detached and older jobs no slot shows), so the line resolves exactly when a new request would be
 * accepted; a cut-off list keeps the recorded jobs. An older server falls back to what the slots show.
 */
function stillBlocking(block: DirectorGenerationBlock, overview: GenerationOverview): NonNullable<DirectorGenerationBlock["attempts"]> {
  const recorded = block.attempts ?? [];
  const scene = overview.scenes.find((s) => s.sceneId === block.sceneId);
  if (!scene?.blockedBy) return recorded.filter((attempt) => inTheWay(overview, attempt));
  const shots = new Set(recorded.map((attempt) => attempt.shotId));
  const live = scene.blockedBy.filter((job) => shots.has(job.shotId));
  return live.length || !scene.blockedByTruncated ? live : recorded;
}

/** Refusals that need nothing from the person: the scene had nothing left to make. */
const NOTHING_TO_DO = new Set(["ALREADY_COMPLETE"]);

export function blockView(block: DirectorGenerationBlock, overview: GenerationOverview | null): BlockView | null {
  if (!overview || NOTHING_TO_DO.has(block.code)) return null;
  const scene = overview.scenes.find((s) => s.sceneId === block.sceneId)?.ordinal ?? null;
  const label = (id: string) => overview.shots[id]?.label ?? "?";
  const sceneArg = { scene: scene ?? "?" };
  if (block.code === "ATTEMPT_EXISTS" && block.attempts?.length) {
    const blocking = stillBlocking(block, overview);
    if (!blocking.length) return { code: block.code, sceneId: block.sceneId, scene, resolved: true, ask: null, open: null,
      title: msg("director.blocked.resolved", sceneArg), step: msg("director.blocked.resolved_step", sceneArg) };
    const first = blocking.find((attempt) => attempt.action === "human_release") ?? blocking[0]!;
    const media = first.kind === "image" ? "keyframe" : "video";
    return {
      code: block.code, sceneId: block.sceneId, scene, resolved: false, ask: null,
      open: { shotId: first.shotId, label: label(first.shotId) },
      title: msg(`director.blocked.attempt.${media}`, { ...sceneArg, shot: label(first.shotId) }),
      step: msg(first.action === "human_release" ? "director.blocked.attempt.release" : "director.blocked.attempt.follow", { ...sceneArg, shot: label(first.shotId) }),
    };
  }
  if (block.code === "STALE_PROMPT_INTENT" && block.shotIds.length) {
    const shots = block.shotIds.map(label).join(", ");
    return {
      code: block.code, sceneId: block.sceneId, scene, resolved: false,
      open: { shotId: block.shotIds[0]!, label: label(block.shotIds[0]!) },
      ask: { shotIds: block.shotIds, text: msg("director.blocked.prompt.ask", { shots }) },
      title: msg("director.blocked.prompt", { shots }), step: msg("director.blocked.prompt.step", { shot: label(block.shotIds[0]!) }),
    };
  }
  if (block.code === "DIRECTION_REQUIRED" && block.shotIds.length) {
    const shots = block.shotIds.map(label).join(", ");
    return {
      code: block.code, sceneId: block.sceneId, scene, resolved: false,
      open: { shotId: block.shotIds[0]!, label: label(block.shotIds[0]!) },
      ask: { shotIds: block.shotIds, text: msg("director.blocked.direction.ask", { shots }) },
      title: msg("director.blocked.direction", { shots }), step: msg("director.blocked.direction.step", { shot: label(block.shotIds[0]!) }),
    };
  }
  return { code: block.code, sceneId: block.sceneId, scene, resolved: false, ask: null, open: null,
    title: msg("director.blocked.other", sceneArg), step: msg("director.blocked.other_step", sceneArg) };
}
