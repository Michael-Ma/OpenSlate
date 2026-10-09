import type { Artifact, DirectorStatus, ProjectSnapshot } from "./model.ts";

/** Existing scene/generation projection; recipes are supplied by the server, never reconstructed from defaults. */
export interface ConversationSceneView {
  projectId: string;
  sceneId: string;
  headVersion: number;
  revisionId: string;
  reviewedControlAuthorityId: string | null;
  reviewedHoldDigest: string;
  busy: boolean;
  paused: boolean;
  confirmationDigest?: string | null;
  sceneIntentDigest?: string;
  currentRequestId?: string | null;
  narrationVersion?: number;
  confirmationError?: string | null;
  narrationBusy?: boolean;
  confirmation?: {
    state: "preparing" | "generating" | "blocked" | "complete";
    message?: string;
  } | null;
  imageProfileLabel: string;
  videoProfileLabel: string;
  rows: {
    shotId: string;
    purpose: string;
    image: Artifact | null;
    imageComplete: boolean;
    imageFixture: boolean | null;
    motionPrompt: string;
    plannedFrames: number;
    durationFrames: number;
    videoComplete: boolean;
    videoProfileLabel: string;
    videoSettings: Record<string, unknown>;
    narrationPending: boolean;
    narration?: {
      mode: string;
      text: string;
      voice: string;
      profileId?: string | null;
      profileLabel?: string | null;
      profileRevisionId?: string | null;
      intentDigest?: string;
      segmentId?: string | null;
      segmentRevisionId?: string | null;
      recordingId?: string | null;
      recordingSha256?: string | null;
      recordingCurrent?: boolean;
      timing?: {
        startFrame: number;
        durationFrames?: number;
        policy?: string;
        startSample?: number;
        endSample?: number | null;
      };
      ready: boolean;
    };
    imagePending: boolean;
    videoPending: boolean;
    blockedCode: string | null;
  }[];
}

/** Exact frames viewed on the results surface; responsive navigation may retain proof while its bytes/revision stay current. */
export type ExposedSceneFrames = Readonly<Record<string, boolean>>;
export function exposedSceneFrameKey(
  projectId: string,
  revisionId: string,
  shotId: string,
  artifactId: string,
  sha256: string,
): string {
  return JSON.stringify([projectId, revisionId, shotId, artifactId, sha256]);
}

export function sceneGenerationLabels(
  snapshot: ProjectSnapshot,
  sceneId: string,
): { scene: string; shots: Readonly<Record<string, string>> } {
  const sceneIndex = snapshot.project.scenes.findIndex(
    (scene) => scene.id === sceneId,
  );
  const shots = snapshot.project.shots.filter(
    (shot) => shot.sceneId === sceneId,
  );
  return {
    scene:
      sceneIndex < 0
        ? "Scene"
        : `Scene ${String(sceneIndex + 1).padStart(2, "0")}`,
    shots: Object.fromEntries(
      shots.map((shot, index) => [
        shot.id,
        `Shot ${sceneIndex + 1}.${index + 1}`,
      ]),
    ),
  };
}

export interface ConversationSceneState {
  stage: "image" | "video" | "complete" | "empty";
  fresh: boolean;
  canGenerate: boolean;
  framesReady: boolean;
  existingWork: boolean;
  unknown: boolean;
  reason: string;
  targets: ConversationSceneView["rows"];
}

export function conversationSceneState(
  view: ConversationSceneView,
  snapshot: ProjectSnapshot,
  director: DirectorStatus,
  exposed: ExposedSceneFrames,
  disabled = false,
): ConversationSceneState {
  const sceneShots = snapshot.project.shots.filter(
    (shot) => shot.sceneId === view.sceneId,
  );
  const fresh =
    view.projectId === snapshot.project.id &&
    view.headVersion === snapshot.project.headVersion &&
    view.revisionId === snapshot.project.revisionId &&
    snapshot.project.scenes.some((scene) => scene.id === view.sceneId) &&
    view.rows.length === sceneShots.length &&
    new Set(view.rows.map((row) => row.shotId)).size === view.rows.length &&
    view.rows.every((row, index) => row.shotId === sceneShots[index]?.id);
  const images = view.rows.filter((row) => !row.imageComplete),
    videos = view.rows.filter(
      (row) => !row.videoComplete || row.narrationPending,
    );
  const stage = !view.rows.length
    ? "empty"
    : images.length
      ? "image"
      : videos.length
        ? "video"
        : "complete";
  const unknown = view.rows.some(
    (row) => row.blockedCode === "SUBMISSION_UNKNOWN",
  );
  const existingWork =
    unknown ||
    view.narrationBusy === true ||
    view.confirmation?.state === "preparing" ||
    view.confirmation?.state === "generating" ||
    view.rows.some((row) => row.imagePending || row.videoPending);
  const framesReady =
    videos.length > 0 &&
    videos.every(
      (row) =>
        row.image?.kind === "image" &&
        exposed[
          exposedSceneFrameKey(
            view.projectId,
            view.revisionId,
            row.shotId,
            row.image.artifactId,
            row.image.sha256,
          )
        ] === true,
    );
  let reason = "";
  if (!fresh)
    reason =
      "The scene changed. Waiting for its current direction and results.";
  else if (view.paused || snapshot.control?.paused)
    reason = "Stopped. Send a new direction in the conversation to continue.";
  else if (disabled || view.busy || director.status === "running")
    reason = "Waiting for the current conversation or saved action to finish.";
  else if (
    director.status === "waiting_user" ||
    snapshot.questions?.some(
      (question) =>
        question.state === "pending" && question.canAnswer !== false,
    )
  )
    reason =
      "Answer the Director’s current question before generating this scene.";
  else if (unknown)
    reason =
      "A saved job’s outcome is unconfirmed. Follow its existing status before starting more work.";
  else if (existingWork) reason = "Following this scene’s existing jobs.";
  else if (stage === "empty")
    reason = "Add shots in the conversation before generating this scene.";
  else if (stage === "complete")
    reason = "Keyframes and video are saved for this scene.";
  else if (stage === "video" && view.confirmationError)
    reason = view.confirmationError;
  else if (
    stage === "video" &&
    videos.some((row) => !!row.blockedCode || !row.motionPrompt.trim())
  )
    reason =
      "Update the motion or choose a model that supports these shot durations.";
  else if (stage === "video" && !view.confirmationDigest)
    reason = "Checking the current scene confirmation.";
  else if (stage === "video" && !framesReady)
    reason =
      "Display every current keyframe on the right before generating video.";
  return {
    stage,
    fresh,
    framesReady,
    existingWork,
    unknown,
    reason,
    canGenerate: !reason,
    targets: stage === "image" ? images : stage === "video" ? videos : [],
  };
}

/** The action names one complete scene. Read-only focus/shot selection cannot alter its scope or reviewed recipe. */
export function makeConversationSceneCommand(
  view: ConversationSceneView,
  snapshot: ProjectSnapshot,
  director: DirectorStatus,
  exposed: ExposedSceneFrames,
  key: string,
  disabled = false,
) {
  const state = conversationSceneState(
    view,
    snapshot,
    director,
    exposed,
    disabled,
  );
  if (
    !state.canGenerate ||
    (state.stage !== "image" && state.stage !== "video")
  )
    throw new Error(state.reason || "Refresh this scene before generating.");
  if (!key) throw new Error("The scene action needs a retry identity.");
  return {
    path: `/api/projects/${encodeURIComponent(view.projectId)}/scenes/${encodeURIComponent(view.sceneId)}/${state.stage === "video" ? "confirm" : "generate"}`,
    key,
    body: {
      headVersion: view.headVersion,
      revisionId: view.revisionId,
      kind: state.stage,
      reviewedFrames:
        state.stage === "video"
          ? state.targets.map((row) => ({
              shotId: row.shotId,
              artifactId: row.image!.artifactId,
              sha256: row.image!.sha256,
            }))
          : [],
      reviewedControlAuthorityId: view.reviewedControlAuthorityId,
      reviewedHoldDigest: view.reviewedHoldDigest,
      ...(state.stage === "video"
        ? { confirmationDigest: view.confirmationDigest! }
        : {}),
    },
    metadata: {
      sceneId: view.sceneId,
      kind: state.stage,
      revisionId: view.revisionId,
      ...(state.stage === "video" ? { sceneReview: view } : {}),
    },
  };
}

export function sceneShotMediaStatus(
  row: ConversationSceneView["rows"][number],
): string {
  if (row.blockedCode === "SUBMISSION_UNKNOWN")
    return "Job outcome unconfirmed";
  if (row.videoComplete) return "Video saved";
  if (row.videoPending) return "Video in progress";
  if (row.imagePending) return "Keyframe in progress";
  return row.imageComplete ? "Keyframe saved" : "Keyframe to create";
}
