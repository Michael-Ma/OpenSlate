import type { GenerationOverview, ShotOverview, ShotTakes, StudioArtifactRef, UseTakeReceipt } from "@openslate/core/public";
import { madeMsg } from "./assets.ts";
import { clipUnit } from "./inspector.ts";
import { isWorking } from "./keyframes.ts";
import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * The takes strip (card B8): every keyframe a shot ever had, newest first, from
 * GET /api/projects/:projectId/shots/:shotId/takes, with "Use this take" on the earlier ones
 * (POST .../takes/:artifactId/use, free, Undo through the returned storyboard command).
 */
export interface TakeItem {
  artifact: StudioArtifactRef;
  /** 1 for the oldest. */
  take: number;
  current: boolean;
  /** Whether the studio can restore this take for this shot (shared conditioning sources may be read-only). */
  selectable: boolean;
  /** "Take 2", and when it was made ("Today 10:44"). */
  label: Msg;
  made: Msg | null;
}

export interface TakesStrip {
  items: TakeItem[];
  /** Said before using a take: it is free, and what goes out of date. */
  impact: Msg;
  /** Why no take can be used right now (a keyframe or clip of this shot is being made), else null. */
  blocked: Msg | null;
}

export function takesStrip(takes: ShotTakes, overview: GenerationOverview, shot: ShotOverview, now: Date, locale: string): TakesStrip {
  const count = takes.keyframes.length;
  const items = takes.keyframes.map((entry, index): TakeItem => {
    const take = count - index;
    return { artifact: entry.artifact, take, current: entry.current, selectable: entry.selectable === true, label: msg("takes.take", { take }), made: entry.createdAt ? madeMsg(entry.createdAt, now, locale) : null };
  });
  return { items, impact: takeImpact(overview, shot, locale), blocked: takeBlocked(shot) };
}

/** Using an earlier take is free; it outdates the shot's clip, which is paid to make again. */
export function takeImpact(overview: GenerationOverview, shot: ShotOverview, locale: string): Msg {
  if (shot.video.state !== "ready") return msg("takes.impact.free");
  const scene = overview.scenes.find((s) => s.sceneId === shot.sceneId);
  const unit = clipUnit(overview, scene);
  return unit && !unit.unknown && Number(unit.unitMicros) > 0
    ? msg("takes.impact.clip", { shot: shot.label, price: formatMicros(unit.unitMicros, locale) })
    : msg("takes.impact.clip_unpriced", { shot: shot.label });
}

/** The studio refuses to switch takes while this shot's keyframe is being made (ATTEMPT_EXISTS); a clip in the making is waited for too. */
export function takeBlocked(shot: ShotOverview): Msg | null {
  if (isWorking(shot.keyframe) || shot.keyframe.state === "no_answer") return msg("takes.wait_keyframe");
  if (isWorking(shot.video)) return msg("inspector.wait_for_clip");
  return null;
}

/** The free "Use this take" press: one per shot at a time, keyed by the take it switches to. */
export function useTakeCommand(shotId: string, artifactId: string): { pressId: string; logical: unknown; path: string; body: Record<string, never> } {
  return {
    pressId: `take:${shotId}`,
    logical: { kind: "use-take", shotId, artifactId },
    path: `/shots/${encodeURIComponent(shotId)}/takes/${encodeURIComponent(artifactId)}/use`,
    body: {},
  };
}

/** The toast after a take was used; its Undo is the receipt's storyboard command. */
export function takeUsedToast(shot: ShotOverview, item: Pick<TakeItem, "take">, receipt: UseTakeReceipt): { message: Msg; undoCommandId: string } {
  const hadClip = shot.video.state === "ready";
  return { message: msg(hadClip ? "toast.take_used_clip" : "toast.take_used", { shot: shot.label, take: item.take }), undoCommandId: receipt.commandId };
}

export const takesPath = (shotId: string) => `/shots/${encodeURIComponent(shotId)}/takes`;
