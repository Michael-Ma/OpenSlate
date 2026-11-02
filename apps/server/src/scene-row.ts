import { canonical, invariant, shotIntentDigest, sceneVideoDurationFrames, shotVideoTiming } from "@openslate/core";
import type { CompiledPlan, ProviderProfile, ShotRecord } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { NodeBinding, ReviewSnapshot } from "./execution/engine.js";
import type { LipSyncRoute } from "./execution/lip-sync-routing.js";

/** Pure projection of the existing scene row. All persistence reads are supplied by the caller. */
export function sceneRow(shot: ShotRecord, context: {
  snapshot: ReturnType<ProductionService["snapshot"]>;
  plan: CompiledPlan | null;
  lock: { profiles: ProviderProfile[] };
  profiles: { image: ProviderProfile; video: ProviderProfile };
  holds: { id: string }[];
  review: Omit<ReviewSnapshot, "id"> | null;
  bindings: NodeBinding[];
  approvals: { videoNodeId: string; approvalDigest: string }[];
  fixtures: Record<string, boolean | null>;
  tolerateAlternatives?: boolean;
  /** How this shot's clip is made when it sings (fal lip sync); absent or null for an ordinary shot. */
  lipSync?: LipSyncRoute | null;
}) {
  const { snapshot, plan, lock, profiles, holds, review, bindings, approvals, fixtures, tolerateAlternatives } = context;
  const lipSync = context.lipSync ?? null, planned = lipSync?.state === "planned" ? lipSync : null;
  const project = snapshot.project;
  const productionReview = (nodeId: string) => review?.members.find(m => m.videoNodeId === nodeId) ?? null;

  const cue = project.cues.find((c) => c.id === shot.cueId);
  const images =
      plan?.nodes.filter(
        (n) => n.kind === "image" && n.shotId === shot.id,
      ) ?? [],
    videos =
      plan?.nodes.filter(
        (n) => n.kind === "video" && n.shotId === shot.id,
      ) ?? [];
  invariant(
    tolerateAlternatives || (images.length <= 1 && videos.length <= 1),
    "SCENE_SELECTION_REQUIRED",
    "This shot has multiple active alternatives. Choose its current take in the conversation before generating the scene.",
  );
  const imageTarget = images[0],
    videoTarget = videos[0];
  const imageCurrent =
    imageTarget?.intentDigest === shotIntentDigest(shot, "image", cue) &&
    imageTarget.args.prompt === shot.imagePrompt;
  const imageOutput = imageCurrent
    ? snapshot.outputs.find(
        (o) => o.nodeId === imageTarget.id && o.artifact.kind === "image",
      )
    : undefined;
  const oldProfile = videoTarget
    ? lock.profiles.find(
        (p) => p.id === videoTarget.profileId && p.kind === "video",
      )
    : undefined;
  let recipeCurrent =
    !!videoTarget &&
    videoTarget.intentDigest === shotIntentDigest(shot, "video", cue) &&
    videoTarget.args.prompt === shot.videoPrompt;
  try {
    recipeCurrent =
      recipeCurrent &&
      !!oldProfile &&
      sceneVideoDurationFrames(shot, oldProfile!, videoTarget) ===
        videoTarget!.args.durationFrames;
  } catch {
    recipeCurrent = false;
  }
  const retainedCandidate = videoTarget
    ? bindings.find((binding) => binding.id === videoTarget.id)?.candidateId
    : null;
  const videoProfile =
    // A shot newly marked as singing is remade by lip sync instead of keeping its ordinary clip.
    recipeCurrent && retainedCandidate && oldProfile && (!planned || oldProfile.id === planned.profile.id)
      ? oldProfile
      : (planned?.profile ?? profiles.video);
  let durationFrames = shot.desiredFrames,
    durationCode: string | null = null;
  try {
    durationFrames = sceneVideoDurationFrames(
      shot,
      videoProfile,
      videoTarget,
    );
  } catch {
    durationCode = "PROFILE_INCOMPATIBLE";
  }
  // A lip-sync clip binds the song window the film plays under this shot now.
  const lipSyncSettings = planned && videoProfile.id === planned.profile.id && durationCode === null ? planned.settings(durationFrames) : null;
  const settings = lipSyncSettings
    ? { lipSync: { ...lipSyncSettings } }
    : videoTarget?.profileId === videoProfile.id
      ? (videoTarget.args.settings ?? {})
      : {};
  const videoCurrent =
    !!videoTarget &&
    videoTarget.profileId === videoProfile.id &&
    (!lipSyncSettings || canonical(videoTarget.args.settings ?? {}) === canonical(settings)) &&
    videoTarget.intentDigest === shotIntentDigest(shot, "video", cue) &&
    videoTarget.args.prompt === shot.videoPrompt &&
    videoTarget.args.durationFrames === durationFrames;
  const actualMember =
    videoCurrent && plan?.gates.length
      ? productionReview(videoTarget.id)
      : null;
  const firstFrame = videoTarget?.inputs.find(
    (i) => i.destinationPort === "firstFrame",
  )?.source;
  // Review the actual retained first frame of an unchanged recipe; reauthored recipes use the current generated frame.
  const retainedFrame = actualMember?.ready ? actualMember.keyframe : null;
  const imageComplete = imageTarget ? !!imageOutput : !!retainedFrame;
  const frame =
    imageTarget && !imageOutput
      ? null
      : (imageOutput?.artifact ?? retainedFrame ?? null);
  const frameNodeId =
    retainedFrame && firstFrame?.kind === "output"
      ? firstFrame.nodeId
      : retainedFrame && firstFrame?.kind === "artifact"
        ? null
        : (imageTarget?.id ?? null);
  const videoComplete =
    videoCurrent &&
    imageComplete &&
    snapshot.outputs.some(
      (o) => o.nodeId === videoTarget.id && o.artifact.kind === "video",
    );
  const active = snapshot.attempts.filter(
    (a) =>
      snapshot.currentAttemptIds.includes(a.id) &&
      [imageTarget?.id, videoTarget?.id].includes(a.nodeId) &&
      !["succeeded", "failed"].includes(a.phase),
  );
  const last = (nodeId: string | undefined) =>
    snapshot.attempts
      .filter(
        (a) =>
          a.nodeId === nodeId &&
          a.candidateId ===
            bindings.find((binding) => binding.id === nodeId)?.candidateId,
      )
      .at(-1);
  const candidatePending = (nodeId: string | undefined) =>
    !!nodeId &&
    !!bindings.find((binding) => binding.id === nodeId)
      ?.candidateId &&
    !["failed", "succeeded"].includes(last(nodeId)?.phase ?? "");
  const reviewedVideo =
    !!actualMember?.approvalDigest &&
    approvals
      .some(
        (a) =>
          a.videoNodeId === videoTarget?.id &&
          a.approvalDigest === actualMember.approvalDigest,
      );
  const timing = shotVideoTiming(project, shot);
  return {
    shotId: shot.id,
    purpose: shot.purpose,
    image: frame,
    imageFixture: frame ? fixtures[canonical(frame)] ?? null : null,
    imageComplete,
    imageNodeId: imageTarget?.id ?? null,
    videoNodeId: videoTarget?.id ?? null,
    frameNodeId,
    videoComplete,
    motionPrompt: shot.videoPrompt,
    plannedFrames: shot.desiredFrames,
    durationFrames,
    videoProfileLabel: videoProfile.id,
    videoSpecDigest:
      videoCurrent && actualMember?.ready ? videoTarget.specDigest : null,
    videoSettings: settings,
    narrationPending: !timing.ready,
    imagePending:
      active.some((a) => a.nodeId === imageTarget?.id) ||
      ((!imageOutput || !!bindings.find(b => b.id === imageTarget?.id)?.retainedTake) && candidatePending(imageTarget?.id)),
    videoPending:
      active.some((a) => a.nodeId === videoTarget?.id) ||
      ((!videoComplete || !!bindings.find(b => b.id === videoTarget?.id)?.retainedTake) &&
        reviewedVideo &&
        candidatePending(videoTarget?.id)),
    blockedCode: active.some((a) => a.phase === "submission_unknown")
      ? "SUBMISSION_UNKNOWN"
      : durationCode,
    // Only singing shots carry this field, so ordinary rows and their digests are unchanged.
    ...(lipSync ? { lipSync: lipSync.state === "planned"
      ? { state: "planned" as const, profileId: lipSync.profile.id }
      : { state: "unavailable" as const, reason: lipSync.reason } } : {}),
  };
}

/** The exact selection rule used by the scene command and the project overview. */
export function generationTargets<T extends { shotId: string; imageComplete: boolean; videoComplete: boolean; narration?: { mode: string; ready: boolean } }>(
  rows: readonly T[], kind: "image" | "video", targetShotIds?: string[], regenerate?: boolean,
): T[] {
  return rows.filter(row => kind === "image"
    ? (!targetShotIds || targetShotIds.includes(row.shotId)) && (regenerate || !row.imageComplete || row.narration?.mode === "generated" && !row.narration.ready)
    : (!targetShotIds || targetShotIds.includes(row.shotId)) && (regenerate || !row.videoComplete));
}
