import { useRef, useState } from "react";
import type { StudioApi } from "./api";
import type { ProjectSnapshot } from "./model";
import type { PendingCommandSnapshot } from "./pending-command";
import { startSceneCommand } from "./scene-command";
import { useTranslation } from "./Locale";
import { errorText } from "./components";
import { mediaHierarchyLabel, mediaUiCopy } from "./media-ui-copy";
import { sceneGenerationLabels } from "./conversation-actions-model";
import { UiButton } from "./ui";
import "./scene-activity.css";

/** Status remains in the workspace after the decision UI is gone. It never claims media is complete. */
export function SceneActivity({ api, snapshot, slot, disabled, stopping, stopFailed, canStop, onStop, onProgress }: {
  api: StudioApi; snapshot: ProjectSnapshot; slot: PendingCommandSnapshot;
  disabled: boolean; stopping: boolean; stopFailed: boolean; canStop: boolean;
  onStop(): void; onProgress(): void;
}) {
  const { t, ui, locale } = useTranslation();
  const activity = useRef<HTMLElement>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const command = slot.command ?? slot.settledCommand;
  const meta = command?.metadata as { sceneId?: string; kind?: string } | undefined;
  if (!command && !slot.localRecoveryLimit || command && !slot.running && !slot.command && dismissed === command.key) return null;
  const scene = meta?.sceneId && snapshot.project.scenes.some(s => s.id === meta.sceneId)
    ? mediaHierarchyLabel(sceneGenerationLabels(snapshot, meta.sceneId).scene, locale)
    : t("Scene generation", "场景生成");
  return <section ref={activity} tabIndex={-1} className="scene-activity" aria-label={t("Generation activity", "生成进度")}>
    <div className="scene-activity-copy">
      <strong>{scene}</strong>
      <p role="status">{!command
        ? t("Local scene recovery needs attention.", "本地场景恢复需要处理。")
        : slot.recovered && slot.command && !slot.running && !slot.error
          ? t("Recovered scene decision — waiting for you to check it.", "已恢复场景决定，等待你核对。")
        : slot.running
        ? slot.progress === "Checking saved scene request…"
          ? t("Checking saved scene request…", "正在核对已保存的场景请求…")
          : ui(slot.progress ?? t("Requesting generation…", "正在提交生成请求…"), mediaUiCopy)
        : slot.error
          ? t("Generation needs attention", "生成需要处理")
          : t("Generation request submitted. Results will appear in the workspace.", "生成请求已提交，结果会显示在工作区。")}</p>
      {slot.running
        ? <small>{t("You can browse and draft while this runs. Stop first to change this project’s plan.", "运行期间可以继续浏览和写草稿。如需修改本项目计划，请先停止当前任务。")}</small>
        : slot.command && <small>{t("You can browse and draft. Check the live project to continue this original request manually; use Stop to change its plan.", "可以继续浏览和写草稿。请核对实时项目后手动继续原请求；如需修改计划，请使用“停止”。")}</small>}
      {!!slot.error && <p className="inline-error" role="alert">{slot.command && ["NETWORK_ERROR", "REQUEST_FAILED", "INTERNAL_ERROR"].includes((slot.error as { code?: string }).code ?? "")
        ? t("The response could not be confirmed. Check the original request below.", "尚未确认请求结果，请在下方核对原请求。")
        : ui(errorText(slot.error), mediaUiCopy)}</p>}
      {slot.localRecoveryLimit && <p className="inline-error" role="alert">{ui(slot.localRecoveryLimit, mediaUiCopy)}</p>}
    </div>
    <div className="scene-activity-actions">
      {command && <UiButton onClick={onProgress}>{t("View progress", "查看进度")}</UiButton>}
      {!slot.running && slot.command && <UiButton disabled={disabled}
        onClick={() => { if (startSceneCommand(api, snapshot.project.id, slot.command!)) activity.current?.focus({ preventScroll: true }); }}>
        {t("Check existing request", "核对原请求")}
      </UiButton>}
      {canStop && <UiButton disabled={stopping} onClick={onStop}>{stopFailed ? t("Retry stop", "重试停止") : stopping ? t("Stopping…", "停止中…") : t("Stop", "停止")}</UiButton>}
      {!slot.running && !slot.command && command && <UiButton variant="ghost" onClick={() => { activity.current?.parentElement?.focus({ preventScroll: true }); setDismissed(command.key); }}>{t("Dismiss status", "收起提示")}</UiButton>}
    </div>
  </section>;
}
