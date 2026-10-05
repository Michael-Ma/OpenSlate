import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ArtifactFixture,
  ProjectSnapshot,
  ReviewSnapshot,
  Shot,
} from "./model";
import { reviewMatchesProject } from "./model";
import {
  inspectKeyframe,
  inspectedApproval,
  inspectionMatches,
} from "./keyframe-review-model";
import type { KeyframeInspection } from "./keyframe-review-model";
import { errorText } from "./components";

interface Props {
  projectId: string;
  snapshot: ProjectSnapshot | null;
  review: ReviewSnapshot | null;
  connected: boolean;
  disabled: boolean;
  onApprove(body: ReturnType<typeof inspectedApproval>): void;
  onError(message: string): void;
}

/** One inspection/approval path; every submission still passes the model's exact identity/hash guards. */
export function useKeyframeReview({
  projectId,
  snapshot,
  review,
  connected,
  disabled,
  onApprove,
  onError,
}: Props) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const [stored, setStored] = useState<KeyframeInspection | null>(null);
  const [displayed, setDisplayed] = useState<Record<string, string>>({});
  const inspection =
    stored && inspectionMatches(stored, snapshot, review) ? stored : null;
  useEffect(() => {
    setStored(null);
    setDisplayed({});
  }, [projectId]);
  useEffect(() => {
    if (stored && !inspectionMatches(stored, snapshot, review)) setStored(null);
  }, [stored, snapshot, review]);
  const onDisplayed = useCallback((id: string, sha: string) => {
    setDisplayed((current) =>
      current[id] === sha ? current : { ...current, [id]: sha },
    );
  }, []);
  const inspect = (shot: Shot, url: string, fixture: ArtifactFixture) => {
    if (snapshot) {
      const launcher = document.activeElement;
      // Approval temporarily disables the Review action; the same-shot image remains inspectable.
      returnFocus.current =
        launcher instanceof HTMLElement
          ? (launcher
              .closest(".board-shot")
              ?.querySelector<HTMLElement>(".board-inspect") ?? launcher)
          : null;
      setStored(inspectKeyframe(snapshot, review, shot, url, fixture));
    }
  };
  const close = () => setStored(null);
  const member = inspection
    ? review?.members.find((row) => row.videoNodeId === inspection.reviewNodeId)
    : null;
  const approve = () => {
    if (!inspection) return;
    try {
      const body = inspectedApproval(
        inspection,
        snapshot,
        review,
        displayed,
        connected,
        disabled,
      );
      close();
      onApprove(body);
    } catch (error) {
      close();
      onError(errorText(error));
    }
  };
  return {
    inspection,
    returnFocus,
    inspect,
    close,
    onDisplayed,
    approve,
    approved: !!member?.approved,
    approveDisabled:
      disabled ||
      !connected ||
      !reviewMatchesProject(review, snapshot) ||
      !member?.ready ||
      !inspection ||
      !inspection.reviewNodeId ||
      !inspectionMatches(inspection, snapshot, review),
  };
}
