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
  onPlan?(): void;
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
  onPlan,
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
  const compact =
    ["saved", "review", "ready", "idle"].includes(plan.state) &&
    snapshot.project.shots.length > 0;
  if (compact && onPlan)
    return (
      <section
        className={`director-plan state-${plan.state} creative-brief-widget`}
        aria-label="Current plan"
      >
        <header className="director-plan-head">
          <span className="tiny-label">创作计划</span>
          <strong>{snapshot.project.name}</strong>
        </header>
        <div className="director-plan-body">
          <p className="creative-brief-text">
            {snapshot.project.brief || snapshot.project.story}
          </p>
          <div className="creative-brief-tags">
            <span>{snapshot.project.scenes.length} 场景</span>
            <span>{snapshot.project.shots.length} 镜头</span>
            <span>
              {(
                snapshot.project.shots.reduce(
                  (sum, s) => sum + s.desiredFrames,
                  0,
                ) / 30
              ).toFixed(0)}
              s
            </span>
          </div>
          <ol className="creative-brief-shots">
            {snapshot.project.scenes
              .flatMap((scene, i) =>
                snapshot.project.shots
                  .filter((s) => s.sceneId === scene.id)
                  .map((shot, j) => (
                    <li key={shot.id}>
                      <span>
                        {i + 1}.{j + 1}
                      </span>
                      <strong>{shot.purpose}</strong>
                      <span>{shot.desiredFrames / 30}s</span>
                    </li>
                  )),
              )
              .slice(0, 6)}
          </ol>
          <details className="creative-brief-status">
            <summary>{plan.title}</summary>
            <p>{plan.detail}</p>
            <p>{plan.saved}</p>
            <p>{plan.next}</p>
          </details>
          <div className="creative-brief-footer">
            <span>
              {connected ? "计划已同步到工作区" : "正在核对已保存状态"}
            </span>
            <UiButton size="1" variant="secondary" onClick={onPlan}>
              查看计划 →
            </UiButton>
          </div>
        </div>
      </section>
    );
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
