import { useTranslation } from "./Locale";
import { settingsUiTranslations } from "./settings-ui-translations";
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
  navigationVersion,
  onChat,
  onTimeline,
}: {
  snapshot: ProjectSnapshot;
  historyRequestId?: string;
  navigationVersion?: number;
  onChat(): void;
  onTimeline(): void;
}) {
  const { t, ui } = useTranslation();

  const guide = useRef<HTMLElement>(null);
  useEffect(() => {
    guide.current?.scrollIntoView({ block: "start" });
    guide.current?.focus({ preventScroll: true });
  }, [historyRequestId, navigationVersion]);
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
      aria-label={t("Generation status", "生成状态")}
    >
      <div className="generation-next">
        <div>
          <h4>{t("Generate from each scene", "按场景生成")}</h4>
          <p>
            {t(
              "Use the green check to create keyframes. Review the returned frames and motion, then approve video for that scene.",
              "点击绿色确认按钮生成关键帧。检查返回画面和运动后，再确认该场景的视频生成。",
            )}
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
                  ? t("Keyframe", "关键帧")
                  : snapshot.plan?.nodes?.find((node) => node.id === job.nodeId)
                        ?.kind === "video"
                    ? t("Video", "视频")
                    : t("Audio / assembly", "音频／合成")}
              </span>
              <strong>{ui(jobLabel(job.phase), settingsUiTranslations)}</strong>
            </li>
          ))}
        </ul>
      )}
      {!snapshot.project.shots.length && (
        <UiButton onClick={onChat}>
          {t("Plan your scenes", "规划场景")}
        </UiButton>
      )}
      {snapshot.outputs.some((output) => output.artifact.kind === "video") && (
        <UiButton variant="ghost" onClick={onTimeline}>
          {t("Open timeline", "打开时间线")}
        </UiButton>
      )}
      <div className="generation-history-toggle">
        <UiButton
          variant="ghost"
          aria-expanded={showHistory}
          aria-controls={historyId}
          onClick={() => setShowHistory((v) => !v)}
        >
          {t("Job history", "任务历史")}
        </UiButton>
      </div>
      {showHistory && (
        <div id={historyId} className="earlier-generation-jobs">
          <h5>{t("Earlier jobs", "先前任务")}</h5>
          {earlier.length ? (
            <ul>
              {earlier.map((job) => (
                <li key={job.id}>
                  <code>{job.id}</code>
                  <span>{ui(jobLabel(job.phase), settingsUiTranslations)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {t("No unfinished earlier jobs.", "没有尚未完成的先前任务。")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
