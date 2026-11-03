import { invariant } from "@openslate/core";
import type { MediaProbe } from "./types.js";

/** Plan positions are always 1/30 s ticks. Probe frame counts are decoded pictures. */
export const TIMELINE_FPS = 30;
export const NATIVE_FRAME_RATES = ["24/1", "25/1", "30/1", "24000/1001", "30000/1001"] as const;
export function frameRate(rate: string): number {
  const [numerator, denominator] = rate.split("/").map(Number);
  invariant(numerator && denominator && Number.isFinite(numerator / denominator) && numerator / denominator > 0,
    "MEDIA_INVALID_INPUT", "Video requires a measured positive frame rate");
  return numerator / denominator;
}
export function videoSeconds(video: NonNullable<MediaProbe["video"]>): number { return video.frames / frameRate(video.frameRate); }
export function videoTicks(video: NonNullable<MediaProbe["video"]>): number { return Math.round(videoSeconds(video) * TIMELINE_FPS); }
export function outputFrames(ticks: number, fps: number): number { return Math.round(ticks * fps / TIMELINE_FPS); }
