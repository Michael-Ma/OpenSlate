import { ApiError } from "../api/client.ts";
import { MAX_SHOT_SECONDS, MIN_SHOT_SECONDS } from "../model/checks.ts";
import { NARRATION_SAMPLE_RATE } from "../model/narration.ts";

/** The fixture's 3–15 s video profile follows the server's narrationFitFrames rule, without padding. */
export function fixtureNarrationFitFrames(currentFrames: number, measuredSeconds: number, fps: number, fit: "extend_shot" | "cut_to_shot"): number {
  const samples = Math.round(measuredSeconds * NARRATION_SAMPLE_RATE);
  if (!Number.isSafeInteger(samples) || samples <= 0) throw new ApiError("NARRATION_RECORDING_REQUIRED", 409);
  const frames = fit === "cut_to_shot" ? currentFrames
    : Math.ceil(Math.max(currentFrames / fps, samples / NARRATION_SAMPLE_RATE, MIN_SHOT_SECONDS)) * fps;
  if (frames < MIN_SHOT_SECONDS * fps || frames > MAX_SHOT_SECONDS * fps) throw new ApiError("PROFILE_INCOMPATIBLE", 409);
  return frames;
}

/** An extension target exists only for a measured line that is too long and can fit the video profile. */
export function fixtureFitSeconds(currentFrames: number, measuredSeconds: number | undefined, fps: number): number | undefined {
  if (measuredSeconds === undefined || measuredSeconds <= currentFrames / fps + 1e-9) return undefined;
  try { return fixtureNarrationFitFrames(currentFrames, measuredSeconds, fps, "extend_shot") / fps; }
  catch (error) { if (error instanceof ApiError) return undefined; throw error; }
}
