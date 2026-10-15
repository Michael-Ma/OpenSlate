// Frozen baseline 2c4b6e3 scene projection. Test oracle for the pure-row extraction.
import { invariant, digest, shotIntentDigest, shotVideoTiming, sceneVideoDurationFrames } from "@openslate/core";
import type { CompiledPlan, ProviderProfile } from "@openslate/core";
import type { ProductionService } from "../../src/application/service.js";
export function legacySceneView(
  service: ProductionService,
  projectId: string,
  sceneId: string,
) {
  const snapshot = service.snapshot(projectId),
    project = snapshot.project,
    store = service.store;
  invariant(
    project.scenes.some((s) => s.id === sceneId),
    "NOT_FOUND",
    "Scene is no longer in this film",
  );
  const plan = project.activePlanId
    ? (store.get<{ compiled: CompiledPlan }>("plan", project.activePlanId)
        ?.compiled ?? null)
    : null;
  const lock = store.get<{
    profiles: ProviderProfile[];
    preferredProfileIds?: Partial<Record<"image" | "video", string>>;
    localExecution?: unknown;
  }>("capability_lock", project.capabilityLockId)!;
  const preferred = (kind: "image" | "video") => {
    const id = lock.preferredProfileIds?.[kind];
    const profile = id
      ? lock.profiles.find((p) => p.id === id && p.kind === kind)
      : lock.profiles.find((p) => p.kind === kind);
    invariant(
      profile,
      "PROFILE_INCOMPATIBLE",
      "The selected picture model is unavailable",
    );
    return profile;
  };
  const profiles = { image: preferred("image"), video: preferred("video") };
  const holds = store
    .list<{
      id: string;
      scopeId: string;
      ownerId: string;
      active: boolean;
    }>("hold", projectId)
    .filter(
      (h) =>
        h.active &&
        (h.scopeId === projectId ||
          h.scopeId === sceneId ||
          project.shots.some(
            (s) => s.sceneId === sceneId && s.id === h.scopeId,
          )),
    );
  // Identity alone cannot distinguish a renewed or reactivated pause. Bind the
  // review to its latest durable change without invalidating it for unrelated progress.
  const holdSequences = new Map<string, number>();
  if (holds.length)
    for (const event of store.readEvents(projectId))
      if (
        event.kind === "hold.changed" &&
        typeof event.payload.holdId === "string"
      )
        holdSequences.set(event.payload.holdId, event.sequence);
  const review = plan?.gates.length
    ? service.engine.inspectReview(projectId)
    : null;
  const productionReview = (nodeId: string) =>
    review?.members.find((m) => m.videoNodeId === nodeId) ?? null;
  const rows = project.shots
    .filter((s) => s.sceneId === sceneId)
    .map((shot) => {
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
        images.length <= 1 && videos.length <= 1,
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
        ? store.get<{ candidateId: string | null }>(
            "node_binding",
            videoTarget.id,
          )?.candidateId
        : null;
      const videoProfile =
        recipeCurrent && retainedCandidate && oldProfile
          ? oldProfile
          : profiles.video;
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
      const settings =
        videoTarget?.profileId === videoProfile.id
          ? (videoTarget.args.settings ?? {})
          : {};
      const videoCurrent =
        !!videoTarget &&
        videoTarget.profileId === videoProfile.id &&
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
          : (retainedFrame ?? imageOutput?.artifact ?? null);
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
                store.get<{ candidateId: string | null }>(
                  "node_binding",
                  nodeId ?? "",
                )?.candidateId,
          )
          .at(-1);
      const candidatePending = (nodeId: string | undefined) =>
        !!nodeId &&
        !holds.length &&
        !!store.get<{ candidateId: string | null }>("node_binding", nodeId)
          ?.candidateId &&
        !["failed", "succeeded"].includes(last(nodeId)?.phase ?? "");
      const reviewedVideo =
        !!actualMember?.approvalDigest &&
        store
          .list<{
            videoNodeId: string;
            approvalDigest: string;
          }>("approval", projectId)
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
        imageFixture: frame ? service.artifactFixture(projectId, frame) : null,
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
          (!imageOutput && candidatePending(imageTarget?.id)),
        videoPending:
          active.some((a) => a.nodeId === videoTarget?.id) ||
          (!videoComplete &&
            reviewedVideo &&
            candidatePending(videoTarget?.id)),
        blockedCode: active.some((a) => a.phase === "submission_unknown")
          ? "SUBMISSION_UNKNOWN"
          : durationCode,
      };
    });
  const busy =
    store
      .list<{ state: string }>("director_turn", projectId)
      .some((t) => ["running", "queued"].includes(t.state)) ||
    snapshot.questions.some(
      (question) =>
        (question as { state?: string; canAnswer?: boolean }).state ===
          "pending" &&
        (question as { canAnswer?: boolean }).canAnswer !== false,
    );
  return {
    project,
    plan,
    lock,
    profiles,
    view: {
      projectId,
      sceneId,
      headVersion: project.headVersion,
      revisionId: project.revisionId,
      reviewedControlAuthorityId:
        "authorityId" in snapshot.control ? snapshot.control.authorityId : null,
      reviewedHoldDigest: digest(
        holds
          .map(
            (h) =>
              [
                h.id,
                h.scopeId,
                h.ownerId,
                holdSequences.get(h.id) ?? 0,
              ] as const,
          )
          .sort((a, b) => a[0]!.localeCompare(b[0]!)),
      ),
      busy,
      paused: snapshot.control.paused,
      imageProfileLabel: profiles.image.id,
      videoProfileLabel: profiles.video.id,
      rows,
    },
  };
}
