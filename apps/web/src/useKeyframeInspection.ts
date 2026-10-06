import { useEffect, useRef, useState } from "react";
import type {
  ArtifactFixture,
  ProjectSnapshot,
  ReviewSnapshot,
  Shot,
} from "./model";
import { inspectKeyframe, inspectionMatches } from "./keyframe-review-model";
import type { KeyframeInspection } from "./keyframe-review-model";

/** Read-only inspection. Generation approval belongs to the scene controls. */
export function useKeyframeInspection({
  projectId,
  snapshot,
  review,
}: {
  projectId: string;
  snapshot: ProjectSnapshot | null;
  review: ReviewSnapshot | null;
}) {
  const returnFocus = useRef<HTMLElement | null>(null),
    [stored, setStored] = useState<KeyframeInspection | null>(null);
  const inspection =
    stored && inspectionMatches(stored, snapshot, review) ? stored : null;
  useEffect(() => setStored(null), [projectId]);
  useEffect(() => {
    if (stored && !inspectionMatches(stored, snapshot, review)) setStored(null);
  }, [stored, snapshot, review]);
  const inspect = (shot: Shot, url: string, fixture: ArtifactFixture) => {
    if (!snapshot) return;
    const launcher = document.activeElement;
    returnFocus.current = launcher instanceof HTMLElement ? launcher : null;
    setStored(inspectKeyframe(snapshot, review, shot, url, fixture));
  };
  return { inspection, returnFocus, inspect, close: () => setStored(null) };
}
