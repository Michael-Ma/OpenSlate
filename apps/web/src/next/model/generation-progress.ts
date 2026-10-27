import type { DirectorGenerationBlock, DirectorGenerationEffect, GenerationOverview, MediaSlot, ShotOverview } from "@openslate/core/public";
import type { Locale } from "../../shared/locale-preference.ts";
import { formatList } from "../i18n/typeset.ts";
import { priceMsg } from "./price.ts";
import { msg, type Msg } from "./types.ts";

const intlLocale = (locale: Locale) => (locale === "zh-CN" ? "zh-CN" : "en-US");

/**
 * Live progress of the keyframes a Director turn started, from the generation overview (design study
 * docs/ai/prototypes/failure-display, item 1). A regenerate keeps the take in use, so a shot's state is its
 * replacement's while there is one. Failures with automatic retries left are still being made.
 */
export type ShotProgressState = "done" | "making" | "queued" | "stopped" | "failed" | "no_answer";

export interface ShotProgress {
  shotId: string;
  label: string;
  state: ShotProgressState;
  /** failed: counted as spent (the reservation was not released). */
  charged: boolean;
}

export interface GenerationProgress {
  shots: ShotProgress[];
  done: number;
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

function slotProgress(slot: MediaSlot): { state: ShotProgressState; charged: boolean } {
  const live = slot.replacement ?? slot;
  const charged = !!live.failure?.charged;
  switch (live.state) {
    case "ready": return { state: "done", charged };
    case "running": return { state: "making", charged };
    case "queued": return { state: live.waiting?.code === "stopped" ? "stopped" : "queued", charged };
    case "no_answer": return { state: "no_answer", charged };
    case "failed": return { state: (live.failure?.autoRetriesLeft ?? 0) > 0 ? "making" : "failed", charged };
    // none, outdated, direction_required, choose_take: nothing of this request is on its way any more.
    default: return { state: slot.state === "ready" ? "done" : "stopped", charged };
  }
}

export function shotProgress(shot: ShotOverview): ShotProgress {
  return { shotId: shot.shotId, label: shot.label, ...slotProgress(shot.keyframe) };
}

function nextStep(shots: readonly ShotProgress[]): GenerationProgress["next"] {
  const failed = shots.find((shot) => shot.state === "failed");
  if (failed) return { shotId: failed.shotId, label: failed.label, text: msg("director.progress.next.failed", { shot: failed.label }) };
  const waiting = shots.find((shot) => shot.state === "no_answer");
  if (waiting) return { shotId: waiting.shotId, label: waiting.label, text: msg("director.progress.next.no_answer", { shot: waiting.label }) };
  return null;
}

/** null for a transcription, or when the overview does not know the shots (yet). */
export function generationProgress(effect: DirectorGenerationEffect, overview: GenerationOverview | null, locale: Locale): GenerationProgress | null {
  if (effect.kind !== "keyframes" || !overview || effect.keyframes === 0) return null;
  const shots = effect.shotIds.flatMap((id) => (overview.shots[id] ? [shotProgress(overview.shots[id]!)] : []));
  if (!shots.length) return null;
  const ordinals = effect.sceneIds.flatMap((id) => { const scene = overview.scenes.find((s) => s.sceneId === id); return scene ? [String(scene.ordinal)] : []; });
  return {
    shots,
    done: shots.filter((shot) => shot.state === "done").length,
    scenes: formatList(ordinals, intlLocale(locale)),
    sceneCount: ordinals.length,
    sceneId: effect.sceneIds.length === 1 ? effect.sceneIds[0]! : null,
    price: priceMsg(effect.quote, locale),
    running: shots.some((shot) => shot.state === "making" || shot.state === "queued"),
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

/** Refusals that need nothing from the person: the scene had nothing left to make. */
const NOTHING_TO_DO = new Set(["ALREADY_COMPLETE"]);

export function blockView(block: DirectorGenerationBlock, overview: GenerationOverview | null): BlockView | null {
  if (!overview || NOTHING_TO_DO.has(block.code)) return null;
  const scene = overview.scenes.find((s) => s.sceneId === block.sceneId)?.ordinal ?? null;
  const label = (id: string) => overview.shots[id]?.label ?? "?";
  const sceneArg = { scene: scene ?? "?" };
  if (block.code === "ATTEMPT_EXISTS" && block.attempts?.length) {
    const blocking = block.attempts.filter((attempt) => inTheWay(overview, attempt));
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
