import type {
  ArtifactFixture,
  ProjectSnapshot,
  ReviewSnapshot,
  Shot,
} from "./model.ts";
import {
  approvalPayload,
  reviewIdentity,
  reviewMatchesProject,
} from "./model.ts";

export interface KeyframeInspection {
  projectId: string;
  headVersion: number;
  revisionId: string;
  url: string;
  shot: Shot;
  fixture: ArtifactFixture;
  reviewNodeId: string | null;
  reviewIdentity: string;
}

/** Capture the exact review wording rather than the potentially different storyboard draft. */
export function inspectKeyframe(
  snapshot: ProjectSnapshot,
  review: ReviewSnapshot | null,
  shot: Shot,
  url: string,
  fixture: ArtifactFixture,
): KeyframeInspection {
  const member = review?.members.find((row) => row.shotId === shot.id);
  return {
    projectId: snapshot.project.id,
    headVersion: snapshot.project.headVersion,
    revisionId: snapshot.project.revisionId,
    url,
    shot: {
      ...shot,
      motion: member?.motionPrompt ?? shot.motion,
      desiredFrames: member?.durationFrames ?? shot.desiredFrames,
    },
    fixture,
    reviewNodeId: member?.videoNodeId ?? null,
    reviewIdentity: reviewIdentity(review),
  };
}

export function inspectionMatches(
  inspection: KeyframeInspection,
  snapshot: ProjectSnapshot | null,
  review: ReviewSnapshot | null,
): boolean {
  return (
    !!snapshot &&
    inspection.projectId === snapshot.project.id &&
    inspection.headVersion === snapshot.project.headVersion &&
    inspection.revisionId === snapshot.project.revisionId &&
    inspection.reviewIdentity === reviewIdentity(review)
  );
}

export function inspectedApproval(
  inspection: KeyframeInspection,
  snapshot: ProjectSnapshot | null,
  review: ReviewSnapshot | null,
  displayed: Readonly<Record<string, string>>,
  connected: boolean,
  disabled: boolean,
) {
  if (
    !connected ||
    disabled ||
    !inspectionMatches(inspection, snapshot, review) ||
    !reviewMatchesProject(review, snapshot) ||
    !review ||
    !inspection.reviewNodeId
  )
    throw new Error(
      "Refresh and review the current keyframe before approving.",
    );
  return approvalPayload(
    review,
    [inspection.reviewNodeId],
    displayed,
    inspection.reviewIdentity,
  );
}
