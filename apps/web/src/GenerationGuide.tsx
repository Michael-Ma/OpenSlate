import { useEffect, useId, useState } from "react";
import type { StudioApi } from "./api";
import type { DirectorStatus, ProjectSnapshot, ReviewSnapshot } from "./model";
import type { SpendingState } from "./spending-model";
import {
  focusedGenerationStep,
  generationReviewBlocked,
} from "./generation-guide-model";
import { GenerationPermission } from "./GenerationPermission";
import { SpendingPanel } from "./SpendingPanel";
import { UiButton } from "./ui";
import { earlierProjectAttempts } from "./production-evidence-model";
import "./generation-guide.css";

type PermissionBody = Parameters<
  typeof GenerationPermission
>[0]["authorize"] extends (body: infer B) => void
  ? B
  : never;
export function GenerationGuide({
  api,
  snapshot,
  review,
  director,
  disabled,
  authorize,
  onChanged,
  onChat,
  onFrames,
  onTimeline,
  onAudio,
  focus,
  historyRequestId,
  active = true,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  review: ReviewSnapshot | null;
  director: DirectorStatus;
  disabled: boolean;
  authorize(body: PermissionBody): void;
  onChanged(): void;
  onChat(): void;
  onFrames(): void;
  onTimeline(): void;
  onAudio(shotId: string): void;
  focus?: { candidateId: string; requestId: string };
  historyRequestId?: string;
  active?: boolean;
}) {
  const [costs, setCosts] = useState<SpendingState | null>(null),
    [choose, setChoose] = useState(false);
  const [showHistory, setShowHistory] = useState(false),
    historyId = useId();
  useEffect(() => {
    if (historyRequestId) {
      setShowHistory(true);
      requestAnimationFrame(() =>
        document
          .getElementById(historyId)
          ?.scrollIntoView({ block: "nearest" }),
      );
    }
  }, [historyRequestId, historyId]);
  const step = focusedGenerationStep(
    snapshot,
    review,
    director,
    costs,
    showHistory ? undefined : focus?.candidateId,
  );
  const action =
    step.action === "audio" && step.shotId
      ? () => onAudio(step.shotId!)
      : step.action === "chat"
        ? onChat
        : step.action === "frames"
          ? onFrames
          : step.action === "timeline"
            ? onTimeline
            : null;
  const canChoose =
    !generationReviewBlocked(snapshot, director) &&
    step.jobState !== "uncertain";
  const reviewFocus =
    showHistory || step.jobState || !canChoose ? undefined : focus;
  const showCosts = step.action === "costs" || !!reviewFocus;
  const earlierJobs = earlierProjectAttempts(snapshot);
  const costOperations = showHistory
    ? undefined
    : (step.costOperations ??
      (!reviewFocus && (step.stage === "frames" || step.stage === "clips")
        ? [step.stage === "frames" ? "image" : "video"]
        : undefined));
  return (
    <section className="generation-guide" aria-label="Generation review">
      <ol className="generation-stages" aria-label="Production stages">
        {(["plan", "frames", "clips", "export"] as const).map((stage, i) => (
          <li
            key={stage}
            aria-current={step.stage === stage ? "step" : undefined}
          >
            <span>{i + 1}</span>
            {["Plan", "Keyframes", "Clips", "Export"][i]}
          </li>
        ))}
      </ol>
      <div className="generation-next">
        <div>
          <h4>{step.label}</h4>
          <p>{step.detail}</p>
        </div>
        {action && (
          <UiButton variant="primary" disabled={disabled} onClick={action}>
            {step.action === "audio"
              ? "Review narration"
              : step.action === "chat"
                ? "Open conversation"
                : step.action === "timeline"
                  ? "Open Timeline"
                  : "Review frames"}
          </UiButton>
        )}
      </div>
      <div
        hidden={
          showHistory || !canChoose || (!choose && step.action !== "permission")
        }
      >
        <GenerationPermission
          key={step.stage}
          {...(step.stage === "clips" ? { initialKinds: ["video"] } : {})}
          snapshot={snapshot}
          disabled={disabled || !canChoose}
          authorize={(body) => {
            setChoose(false);
            authorize(body);
          }}
        />
      </div>
      <div className="generation-history-toggle">
        <UiButton
          variant="ghost"
          aria-expanded={showHistory}
          aria-controls={historyId}
          onClick={() => setShowHistory((value) => !value)}
        >
          {showHistory ? "Hide usage and job history" : "Usage and job history"}
        </UiButton>
      </div>
      <div id={historyId} hidden={!showCosts && !showHistory}>
        {showHistory && (
          <section
            className="earlier-generation-jobs"
            aria-label="Earlier job status"
          >
            <h5>Earlier jobs</h5>
            <p>
              These saved jobs belong to earlier work. Review their recorded
              status and original job identity below.
            </p>
            {earlierJobs.length ? (
              <ul>
                {earlierJobs.map((job) => (
                  <li key={job.id}>
                    <code>{job.id}</code>
                    <span>
                      {job.phase === "submission_unknown"
                        ? "Outcome unconfirmed"
                        : job.phase === "remote_pending"
                          ? "Submitted · awaiting result"
                          : job.phase === "ingesting"
                            ? "Saving returned media"
                            : job.phase === "submitting"
                              ? "Submission recorded"
                              : "Preparation recorded"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No unfinished earlier jobs are recorded.</p>
            )}
          </section>
        )}
        <SpendingPanel
          key={
            showHistory ? "history" : (reviewFocus?.requestId ?? "current-work")
          }
          active={active && (showCosts || showHistory)}
          api={api}
          snapshot={snapshot}
          onChanged={onChanged}
          onState={setCosts}
          guided={!showHistory}
          {...(costOperations ? { operations: costOperations } : {})}
          {...(reviewFocus ? { focus: reviewFocus } : {})}
        />
      </div>
      {canChoose && !showHistory && (
        <details className="generation-options">
          <summary>Other generation options</summary>
          <UiButton
            variant="ghost"
            disabled={disabled}
            onClick={() => setChoose((v) => !v)}
          >
            {choose ? "Hide shot selection" : "Choose new shots or takes"}
          </UiButton>
        </details>
      )}
    </section>
  );
}
