import type { DirectorStatus, ProjectSnapshot, ReviewSnapshot } from "./model";
import { directorPlan } from "./director-plan-model";
import type { SavedEdit } from "./director-plan-model";
import { UiButton } from "./ui";
import "./director-plan.css";

interface Props {
  snapshot: ProjectSnapshot;
  director: DirectorStatus;
  review: ReviewSnapshot | null;
  connected: boolean;
  disabled: boolean;
  scopeIds?: readonly string[];
  onDiscuss(): void;
  onClearScope(): void;
  onAnswer(questionId: string): void;
  onResume(edit: SavedEdit): void;
  onScenes(): void;
  onGeneration(): void;
  onHistory(): void;
  onFrames(): void;
  onTimeline(): void;
}
export function DirectorPlan({
  snapshot,
  director,
  review,
  connected,
  disabled,
  scopeIds,
  onDiscuss,
  onClearScope,
  onAnswer,
  onResume,
  onScenes,
  onGeneration,
  onHistory,
  onFrames,
  onTimeline,
}: Props) {
  const plan = directorPlan(snapshot, director, review, connected, scopeIds);
  const act = () => {
    if (plan.action === "answer" && plan.questionId) onAnswer(plan.questionId);
    else if (plan.action === "chat") onDiscuss();
    else if (plan.action === "scope") onClearScope();
    else if (plan.action === "scenes") onScenes();
    else if (plan.action === "generation") onGeneration();
    else if (plan.action === "frames") onFrames();
    else if (plan.action === "timeline") onTimeline();
  };
  return (
    <section
      className={`director-plan state-${plan.state}`}
      aria-label="Current plan"
    >
      <header className="director-plan-head">
        <span className="tiny-label">
          {plan.state === "working" || plan.state === "generating"
            ? "IN PROGRESS"
            : plan.state === "unfinished"
              ? "UNFINISHED EDIT"
              : "YOUR NEXT STEP"}
        </span>
        <strong role="status" tabIndex={-1}>
          {plan.title}
        </strong>
      </header>
      <div className="director-plan-body">
        <p className="director-plan-detail">{plan.detail}</p>
        <dl className="director-plan-facts">
          <div>
            <dt>Saved</dt>
            <dd>{plan.saved}</dd>
          </div>
          <div>
            <dt>Next</dt>
            <dd>{plan.next}</dd>
          </div>
        </dl>
        {plan.edits.map((edit, index) => (
          <div className="director-plan-edit" key={edit.requestId}>
            <div className="director-plan-edit-header">
              <strong>
                {plan.edits.length > 1 ? `Edit ${index + 1} · ` : ""}
                {edit.scope}
              </strong>
              {plan.canResume && (
                <UiButton
                  variant="primary"
                  className="director-plan-action"
                  disabled={disabled || !connected}
                  onClick={() => onResume(edit)}
                >
                  Resume this edit
                </UiButton>
              )}
            </div>
            {edit.direction && (
              <details>
                <summary>Your saved direction</summary>
                <p>{edit.direction}</p>
              </details>
            )}
          </div>
        ))}
        {plan.action && plan.actionLabel && (
          <UiButton
            variant="primary"
            className="director-plan-action"
            disabled={disabled || !connected}
            onClick={act}
          >
            {plan.actionLabel}
          </UiButton>
        )}
        {plan.canResume && (
          <p className="director-plan-note">
            Saved work is kept. Generation has a separate review.
          </p>
        )}
        {plan.earlierJobs && (
          <details className="director-earlier-jobs">
            <summary>
              {plan.earlierJobs.unknown
                ? plan.earlierJobs.unknown === 1
                  ? "Earlier job needs confirmation"
                  : `${plan.earlierJobs.unknown} earlier jobs need confirmation`
                : plan.earlierJobs.active === 1
                  ? "Earlier job has saved progress"
                  : `${plan.earlierJobs.active} earlier jobs have saved progress`}
            </summary>
            <p>
              {plan.earlierJobs.unknown > 0 &&
                `${plan.earlierJobs.unknown} unconfirmed`}
              {plan.earlierJobs.unknown > 0 &&
                plan.earlierJobs.active > 0 &&
                " · "}
              {plan.earlierJobs.active > 0 &&
                `${plan.earlierJobs.active} in progress`}
              . Their original job identities and saved status remain available.
            </p>
            <UiButton
              variant="ghost"
              size="1"
              disabled={disabled || !connected}
              onClick={onHistory}
            >
              View earlier jobs
            </UiButton>
          </details>
        )}
      </div>
    </section>
  );
}
