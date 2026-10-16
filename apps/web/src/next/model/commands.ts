import type { ConfirmSceneInput, GenerationOverview, SceneOverview } from "@openslate/core/public";

/** GET /api/projects/:projectId/scenes/:sceneId/generation: the freshness tokens the generate command echoes. */
export interface SceneGenerationRead {
  headVersion: number;
  revisionId: string;
  reviewedHoldDigest: string;
  reviewedControlAuthorityId: string | null;
  currentRequestId: string | null;
  rows: { shotId: string; image: { artifactId: string; sha256: string } | null; imageComplete: boolean; videoComplete: boolean }[];
}

export interface GenerateBody {
  headVersion: number;
  revisionId: string;
  expectedRequestId: string | null;
  kind: "image" | "video";
  reviewedFrames: { shotId: string; artifactId: string; sha256: string }[];
  reviewedHoldDigest: string;
  reviewedControlAuthorityId: string | null;
  targetShotIds?: string[];
  regenerate?: boolean;
}

export class CommandRefused extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const tokens = (read: SceneGenerationRead) => ({
  headVersion: read.headVersion,
  revisionId: read.revisionId,
  expectedRequestId: read.currentRequestId,
  reviewedHoldDigest: read.reviewedHoldDigest,
  reviewedControlAuthorityId: read.reviewedControlAuthorityId,
});

export function keyframesBody(read: SceneGenerationRead, targetShotIds?: string[], regenerate?: boolean): GenerateBody {
  return {
    ...tokens(read),
    kind: "image",
    reviewedFrames: [],
    ...(targetShotIds?.length ? { targetShotIds } : {}),
    ...(regenerate ? { regenerate: true } : {}),
  };
}

/**
 * The video confirm binds the exact frames the person opened. The server requires the frames of every
 * shot without a finished clip; each must be the keyframe the overview showed and the person opened.
 */
export function videoBody(read: SceneGenerationRead, overview: GenerationOverview): GenerateBody {
  const reviewedFrames = read.rows.filter((row) => !row.videoComplete).map((row) => {
    const shown = overview.shots[row.shotId]?.keyframe;
    if (!row.image || !shown?.artifact) throw new CommandRefused("SCENE_REVIEW_STALE");
    if (shown.artifact.artifactId !== row.image.artifactId || shown.artifact.sha256 !== row.image.sha256) throw new CommandRefused("SCENE_REVIEW_STALE");
    if (!shown.opened) throw new CommandRefused("FRAME_NOT_OPENED");
    return { shotId: row.shotId, artifactId: row.image.artifactId, sha256: row.image.sha256 };
  });
  if (!reviewedFrames.length) throw new CommandRefused("ALREADY_COMPLETE");
  return { ...tokens(read), kind: "video", reviewedFrames };
}

/**
 * The durable server confirm (phase P3, GR-3): it binds exactly the frames the person opened.
 * Every target must be a current keyframe the person opened, and the scene must offer a digest.
 */
export function confirmBody(overview: GenerationOverview, scene: SceneOverview): ConfirmSceneInput {
  if (!scene.confirmationDigest) throw new CommandRefused("SCENE_REVIEW_STALE");
  const reviewedFrames = scene.videoTargets.map((shotId) => {
    const keyframe = overview.shots[shotId]?.keyframe;
    if (!keyframe || keyframe.state !== "ready" || !keyframe.artifact) throw new CommandRefused("SCENE_REVIEW_STALE");
    if (!keyframe.opened) throw new CommandRefused("FRAME_NOT_OPENED");
    return { shotId, artifactId: keyframe.artifact.artifactId, sha256: keyframe.artifact.sha256 };
  });
  if (!reviewedFrames.length) throw new CommandRefused("ALREADY_COMPLETE");
  const quote = scene.quotes.confirmVideo;
  return { confirmationDigest: scene.confirmationDigest, reviewedFrames, ...(quote && !quote.priceUnknown ? { expectedEstimateMicros: quote.micros } : {}) };
}

/** Storyboard edits (POST /api/projects/:projectId/storyboard). */
export type StoryboardEdit =
  | { kind: "shot"; id: string; field: "imagePrompt" | "motion" | "desiredFrames" | "videoPrompt" | "framing" | "purpose"; value: string }
  | { kind: "narration"; id: string; field: "text" | "mode" | "voice"; value: string }
  | { kind: "undo"; commandId: string };

export function seconds(frames: number, fps: number): number {
  return Math.round((frames / fps) * 10) / 10;
}

export function framesFor(secondsValue: number, fps: number): number {
  return Math.round(secondsValue * fps);
}
