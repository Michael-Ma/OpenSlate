import type { ShotOverview } from "@openslate/core/public";
import type { StoryboardEdit } from "./commands.ts";
import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * The singing flag on a shot (music video; docs/ai/music-video/audio-and-lipsync.md §8). Marking a shot singing is the
 * free, undoable storyboard command shotPerformance; it keeps the current clip. The clip is then made by lip sync
 * from the keyframe and this shot's stretch of the song, priced per second, when the person confirms the scene.
 */

/**
 * The published 768p rate of the lip-sync model (fal MiniMax H3 Max lip sync: $0.08 per output second, ×1.2 past
 * 15 s; packages/providers/src/fal-h3-lipsync.ts falH3LipSyncPriceMicros). The scene confirm shows the exact quote;
 * this line is an estimate said before the switch, and says so.
 */
export const LIP_SYNC_MICROS_PER_SECOND = 80_000;
/** The audio sent runs 0.2 s past the shot (LIP_SYNC_TAIL_SAMPLES) unless that would pass 15 s. */
const TAIL_SECONDS = 0.2;

export function lipSyncEstimateMicros(seconds: number): number {
  const sent = seconds < 15 ? Math.min(15, seconds + TAIL_SECONDS) : seconds;
  return Math.round(sent * LIP_SYNC_MICROS_PER_SECOND * (sent > 15 ? 1.2 : 1));
}

export interface SingingView {
  singing: boolean;
  /** The lip-sync price line (or why the clip would be an ordinary one). */
  note: Msg;
  /** Shown only for films with a song, or a shot already marked singing. */
  offered: boolean;
}

export function singingView(shot: ShotOverview, performance: "singing" | undefined, fps: number, hasSong: boolean, locale: string): SingingView {
  const singing = performance === "singing";
  const seconds = Math.round((shot.durationFrames / fps) * 10) / 10;
  const price = formatMicros(lipSyncEstimateMicros(seconds), locale);
  const unavailable = shot.lipSync?.state === "unavailable" ? shot.lipSync.reason : !hasSong ? "no_song" : null;
  const note = unavailable === "no_profile" ? msg("singing.note.no_profile")
    : unavailable === "no_song" ? msg("singing.note.no_song")
    : msg(singing ? "singing.note.on" : "singing.note.off", { price, seconds });
  return { singing, note, offered: hasSong || singing };
}

/** The storyboard command for the switch. */
export const performanceEdit = (shotId: string, singing: boolean): StoryboardEdit => ({ kind: "shotPerformance", id: shotId, value: singing ? "singing" : "none" });
