import { useEffect, useId, useRef, useState } from "react";
import type { ProjectSnapshot } from "./model";
import {
  currentProjectAttempts,
  earlierProjectAttempts,
} from "./production-evidence-model";
import { UiButton } from "./ui";
import "./generation-guide.css";
const jobLabel = (phase: string) =>
  ({
    submission_unknown: "Outcome unconfirmed",
    remote_pending: "Generating",
    ingesting: "Saving returned media",
    submitting: "Submitting",
    preparing: "Preparing",
    succeeded: "Saved",
    failed: "Failed",
  })[phase] ?? phase;
export function GenerationGuide({
  snapshot,
  historyRequestId,
  onChat,
  onTimeline,
}: {
  snapshot: ProjectSnapshot;
  historyRequestId?: string;
  onChat(): void;
  onTimeline(): void;
}) {
  const guide = useRef<HTMLElement>(null);
  useEffect(() => {
    guide.current?.scrollIntoView({ block: "start" });
    guide.current?.focus({ preventScroll: true });
  }, [historyRequestId]);
  const [showHistory, setShowHistory] = useState(false),
    historyId = useId();
  useEffect(() => {
    if (historyRequestId) setShowHistory(true);
  }, [historyRequestId]);
  const current = currentProjectAttempts(snapshot),
    earlier = earlierProjectAttempts(snapshot);
  return (
    <section
      ref={guide}
      tabIndex={-1}
      className="generation-guide"
      aria-label="Generation status"
    >
      <div className="generation-next">
        <div>
          <h4>Generate from each scene</h4>
          <p>
            Use the green check to create keyframes. Review the returned frames
            and motion, then approve video for that scene.
          </p>
        </div>
      </div>
      {current.length > 0 && (
        <ul className="generation-jobs">
          {current.map((job) => (
            <li key={job.id}>
              <span>
                {snapshot.plan?.nodes?.find((node) => node.id === job.nodeId)
                  ?.kind === "image"
                  ? "Keyframe"
                  : snapshot.plan?.nodes?.find((node) => node.id === job.nodeId)
                        ?.kind === "video"
                    ? "Video"
                    : "Audio / assembly"}
              </span>
              <strong>{jobLabel(job.phase)}</strong>
            </li>
          ))}
        </ul>
      )}
      {!snapshot.project.shots.length && (
        <UiButton onClick={onChat}>Plan your scenes</UiButton>
      )}
      {snapshot.outputs.some((output) => output.artifact.kind === "video") && (
        <UiButton variant="ghost" onClick={onTimeline}>
          Open timeline
        </UiButton>
      )}
      <div className="generation-history-toggle">
        <UiButton
          variant="ghost"
          aria-expanded={showHistory}
          aria-controls={historyId}
          onClick={() => setShowHistory((v) => !v)}
        >
          Job history
        </UiButton>
      </div>
      {showHistory && (
        <div id={historyId} className="earlier-generation-jobs">
          <h5>Earlier jobs</h5>
          {earlier.length ? (
            <ul>
              {earlier.map((job) => (
                <li key={job.id}>
                  <code>{job.id}</code>
                  <span>{jobLabel(job.phase)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No unfinished earlier jobs.</p>
          )}
        </div>
      )}
    </section>
  );
}
