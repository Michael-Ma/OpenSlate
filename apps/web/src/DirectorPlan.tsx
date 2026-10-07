import { settingsPlanCopy, settingsScopeLabel } from "./settings-labels";
import { useTranslation } from "./Locale";
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
  const { t, locale } = useTranslation();

  const plan = directorPlan(snapshot, director, review, connected, scopeIds);
  const copy = settingsPlanCopy(snapshot, plan, locale);
  const act = () => {
    if (plan.action === "answer" && plan.questionId) onAnswer(plan.questionId);
    else if (plan.action === "chat") onDiscuss();
    else if (plan.action === "scope") onClearScope();
    else if (plan.action === t("scenes", "场景")) onScenes();
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
        aria-label={t("Current plan", "当前计划")}
      >
        <header className="director-plan-head">
          <span className="tiny-label">{t("Creative plan", "创作计划")}</span>
          <strong>{snapshot.project.name}</strong>
        </header>
        <div className="director-plan-body">
          <p className="creative-brief-text">
            {snapshot.project.brief || snapshot.project.story}
          </p>
          <div className="creative-brief-tags">
            <span>
              {t("{count} scene{suffix}", "{count} 个场景", {
                count: snapshot.project.scenes.length,
                suffix: snapshot.project.scenes.length === 1 ? "" : "s",
              })}
            </span>
            <span>
              {t("{count} shot{suffix}", "{count} 个镜头", {
                count: snapshot.project.shots.length,
                suffix: snapshot.project.shots.length === 1 ? "" : "s",
              })}
            </span>
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
            <summary>{copy.title}</summary>
            <p>{copy.detail}</p>
            <p>{copy.saved}</p>
            <p>{copy.next}</p>
          </details>
          <div className="creative-brief-footer">
            <span>
              {connected
                ? t("Plan synced to workspace", "计划已同步到工作区")
                : t("Checking saved state", "正在核对已保存状态")}
            </span>
            <UiButton size="1" variant="secondary" onClick={onPlan}>
              {t("View plan →", "查看计划 →")}
            </UiButton>
          </div>
        </div>
      </section>
    );
  return (
    <section
      className={`director-plan state-${plan.state}`}
      aria-label={t("Current plan", "当前计划")}
    >
      <header className="director-plan-head">
        <span className="tiny-label">
          {plan.state === "working" || plan.state === "generating"
            ? t("IN PROGRESS", "进行中")
            : plan.state === "unfinished"
              ? t("UNFINISHED EDIT", "未完成的编辑")
              : t("YOUR NEXT STEP", "下一步")}
        </span>
        <strong role="status" tabIndex={-1}>
          {copy.title}
        </strong>
      </header>
      <div className="director-plan-body">
        <p className="director-plan-detail">{copy.detail}</p>
        <dl className="director-plan-facts">
          <div>
            <dt>{t("Saved", "已保存")}</dt>
            <dd>{copy.saved}</dd>
          </div>
          <div>
            <dt>{t("Next", "下一步")}</dt>
            <dd>{copy.next}</dd>
          </div>
        </dl>
        {plan.edits.map((edit, index) => (
          <div className="director-plan-edit" key={edit.requestId}>
            <div className="director-plan-edit-header">
              <strong>
                {plan.edits.length > 1
                  ? t("Edit {number} · ", "编辑 {number} · ", {
                      number: index + 1,
                    })
                  : ""}
                {settingsScopeLabel(snapshot, edit.scopeIds, locale)}
              </strong>
              {plan.canResume && (
                <UiButton
                  variant="primary"
                  className="director-plan-action"
                  disabled={disabled || !connected}
                  onClick={() => onResume(edit)}
                >
                  {t("Resume this edit", "继续此编辑")}
                </UiButton>
              )}
            </div>
            {edit.direction && (
              <details>
                <summary>{t("Your saved direction", "已保存的方向")}</summary>
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
            {copy.actionLabel}
          </UiButton>
        )}
        {plan.canResume && (
          <p className="director-plan-note">
            {t(
              "Saved work is kept. Generation has a separate review.",
              "已保存的工作会保留，关键帧和视频生成需单独确认。",
            )}
          </p>
        )}
        {plan.earlierJobs && (
          <details className="director-earlier-jobs">
            <summary>
              {plan.earlierJobs.unknown
                ? plan.earlierJobs.unknown === 1
                  ? t("Earlier job needs confirmation", "先前任务需要确认")
                  : t(
                      "{count} earlier jobs need confirmation",
                      "{count} 个先前任务需要确认",
                      { count: plan.earlierJobs.unknown },
                    )
                : plan.earlierJobs.active === 1
                  ? t("Earlier job has saved progress", "先前任务已有进度")
                  : t(
                      "{count} earlier jobs have saved progress",
                      "{count} 个先前任务已有进度",
                      { count: plan.earlierJobs.active },
                    )}
            </summary>
            <p>
              {plan.earlierJobs.unknown > 0 &&
                t("{count} unconfirmed", "{count} 个结果未确认", {
                  count: plan.earlierJobs.unknown,
                })}
              {plan.earlierJobs.unknown > 0 &&
                plan.earlierJobs.active > 0 &&
                " · "}
              {plan.earlierJobs.active > 0 &&
                t("{count} in progress", "{count} 个进行中", {
                  count: plan.earlierJobs.active,
                })}
              {t(
                ". Their original job identities and saved status remain available.",
                "。仍可查看这些任务的原始编号和已保存状态。",
              )}
            </p>
            <UiButton
              variant="ghost"
              size="1"
              disabled={disabled || !connected}
              onClick={onHistory}
            >
              {t("View earlier jobs", "查看先前任务")}
            </UiButton>
          </details>
        )}
      </div>
    </section>
  );
}
