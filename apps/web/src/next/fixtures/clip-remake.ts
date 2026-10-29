import type { ShotOverview } from "@openslate/core/public";
import { isWorking, shotHasNoAnswer } from "../model/keyframes.ts";

/** Whether a new clip can be made now, as the studio reports it per shot (contract 7.1.0). Pure. */
export function clipRemakeAvailability(shot: Pick<ShotOverview, "keyframe" | "video" | "narration">): { available: boolean; code?: string } {
  if (shot.video.state !== "ready" || !shot.video.artifact) return { available: false, code: "CLIP_NOT_SAVED" };
  if (isWorking(shot.keyframe) || isWorking(shot.video) || shotHasNoAnswer(shot as ShotOverview)) return { available: false, code: "ATTEMPT_EXISTS" };
  if (shot.keyframe.state !== "ready" || !shot.keyframe.artifact) return { available: false, code: "SCENE_REVIEW_STALE" };
  if (!shot.keyframe.opened) return { available: false, code: "FRAME_NOT_OPENED" };
  return { available: true };
}
