import { useTranslation } from "./Locale";
import { workbenchCopy } from "./workbench-copy";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { StudioApi } from "./api";
import { startSceneCommand } from "./scene-command";
import type { RefObject } from "react";
import { AppDialog, UiButton } from "./ui";
import { errorText, Icon } from "./components";
import type { DirectorStatus, ProjectSnapshot } from "./model";
import type {
  ConversationSceneView,
  ExposedSceneFrames,
} from "./conversation-actions-model";
import {
  conversationSceneState,
  exposedSceneFrameKey,
} from "./conversation-actions-model";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import { scopedFrameCommand } from "./frame-decision-model";
import type { FrameRequest } from "./frame-decision-model";
import { useProjectRefreshVersion } from "./project-updates";
export function useSceneView(
  api: StudioApi,
  snapshot: ProjectSnapshot,
  sceneId: string | null,
) {
  const version = useProjectRefreshVersion(),
    [view, setView] = useState<ConversationSceneView | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!sceneId) {
      setView(null);
      return;
    }
    const c = new AbortController();
    setError("");
    void api
      .request<ConversationSceneView>(
        `/api/projects/${encodeURIComponent(snapshot.project.id)}/scenes/${encodeURIComponent(sceneId)}/generation`,
        { signal: c.signal },
      )
      .then((v) => {
        if (!c.signal.aborted) {
          setView(v);
          setError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setView(null);
          setError(errorText(e));
        }
      });
    return () => c.abort();
  }, [
    api,
    snapshot.project.id,
    snapshot.project.headVersion,
    snapshot.project.revisionId,
    sceneId,
    version,
  ]);
  const current =
    view?.projectId === snapshot.project.id &&
    view.sceneId === sceneId &&
    view.headVersion === snapshot.project.headVersion &&
    view.revisionId === snapshot.project.revisionId
      ? view
      : null;
  return { view: current, error };
}
export function FrameDecision({
  api,
  snapshot,
  director,
  request,
  disabled,
  onChanged,
  close,
  onStarted,
  returnFocusRef,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  director: DirectorStatus;
  request: FrameRequest;
  disabled: boolean;
  onChanged(): void;
  close(): void;
  onStarted(): void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t, ui } = useTranslation();

  const { view, error: loadError } = useSceneView(
      api,
      snapshot,
      request.sceneId,
    ),
    registry = pendingCommandsFor(api, "conversation-scenes"),
    projectId = snapshot.project.id;
  const slot = useSyncExternalStore(
    useCallback((l) => registry.subscribe(projectId, l), [registry, projectId]),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]),
  );
  const [error, setError] = useState(""),
    observed = useRef(slot.settledVersion),
    openedAt = useRef(slot.settledVersion);
  useEffect(() => {
    if (slot.settledVersion > observed.current) {
      observed.current = slot.settledVersion;
      onChanged();
      if (
        slot.lastSuccess &&
        (slot.settledCommand?.metadata as { sceneId?: string } | undefined)
          ?.sceneId === request.sceneId
      )
        close();
    }
  }, [
    slot.settledVersion,
    onChanged,
    slot.lastSuccess,
    slot.settledCommand,
    request.sceneId,
    close,
  ]);
  const run = (cmd: PendingCommand) => {
    if (disabled) return;
    if (startSceneCommand(api, projectId, cmd)) onStarted();
  };
  const targets =
    view?.rows.filter(
      (r) =>
        (!request.targetShotIds || request.targetShotIds.includes(r.shotId)) &&
        (request.regenerate || !r.imageComplete),
    ) ?? [];
  let allowed = false, eligibilityError = "";
  try {
    if (view) {
      scopedFrameCommand(
        view,
        snapshot,
        director,
        request,
        "check",
        disabled || slot.running || !!slot.command,
      );
      allowed = true;
    }
  } catch (cause) {
    eligibilityError = errorText(cause);
  }
  return (
    <AppDialog
      open
      title={
        request.regenerate
          ? t("Regenerate keyframes", "重新生成关键帧")
          : t("Generate keyframes", "生成关键帧")
      }
      description={t(
        targets.length === 1 ? "{v0} shot · {v1}" : "{v0} shots · {v1}",
        "{v0} 个镜头 · {v1}",
        {
          v0: targets.length,
          v1: view?.imageProfileLabel ?? t("Reading model…", "正在读取模型"),
        },
      )}
      onOpenChange={(v) => {
        if (!v) close();
      }}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      closeLabel={t("Close keyframe proposal", "关闭关键帧方案")}
    >
      <p className="field-help">
        {request.regenerate
          ? t(
              "Keep previous media versions and replace these shots’ current keyframes.",
              "保留原来的素材版本，替换这些镜头的当前关键帧。",
            )
          : t(
              "Generate images from the saved shot plans.",
              "按照已保存的镜头计划生成图片。",
            )}{" "}
        {t(
          "Video is generated separately after frame review.",
          "视频会在检查画面后单独生成。",
        )}{" "}
      </p>
      <ol className="frame-decision-targets">
        {targets.map((row) => {
          const shot = snapshot.project.shots.find((s) => s.id === row.shotId);
          return (
            <li key={row.shotId}>
              <strong>{row.purpose}</strong>
              <details>
                <summary>{t("Image prompt", "图像 Prompt")}</summary>
                <p>{shot?.imagePrompt}</p>
              </details>
            </li>
          );
        })}
      </ol>
      {(loadError || error || !!slot.error) && (
        <p role="alert" className="form-error">
          {ui(loadError || error || errorText(slot.error), workbenchCopy)}
        </p>
      )}
      {slot.command ? (
        <div className="notice">
          <span>
            {slot.running
              ? t("Saving generation request…", "正在保存生成请求…")
              : t(
                  "The response is unconfirmed. Check the saved request without creating a new job.",
                  "请求结果尚未确认。核对原来的请求，不会创建新任务。",
                )}
          </span>
          {!slot.running && (
            <UiButton
              disabled={disabled || !!snapshot.control?.paused}
              onClick={() => run(slot.command!)}
            >
              {" "}
              {t("Check saved request", "核对原请求")}{" "}
            </UiButton>
          )}
        </div>
      ) : (
        <UiButton
          variant="primary"
          disabled={!allowed}
          onClick={() => {
            try {
              run(
                scopedFrameCommand(
                  view!,
                  snapshot,
                  director,
                  request,
                  crypto.randomUUID(),
                  disabled,
                ),
              );
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          <Icon name="image" size={16} />
          {request.regenerate
            ? t(
                targets.length === 1
                  ? "Regenerate {count} keyframe"
                  : "Regenerate {count} keyframes",
                "重新生成 {count} 个关键帧",
                {
                  count: targets.length,
                },
              )
            : t(
                targets.length === 1
                  ? "Generate {count} keyframe"
                  : "Generate {count} keyframes",
                "生成 {count} 个关键帧",
                {
                  count: targets.length,
                },
              )}
        </UiButton>
      )}
      {slot.lastSuccess && slot.settledVersion > openedAt.current && (
        <p role="status">
          {t(
            "The request is saved. Frames will update in the workspace.",
            "生成请求已保存，画面会在工作区更新。",
          )}
        </p>
      )}
      {!allowed && !slot.command && view && (
        <p className="field-help">
          {ui(eligibilityError, workbenchCopy)}
        </p>
      )}
    </AppDialog>
  );
}
export function SceneDecisionFooter({
  api,
  snapshot,
  director,
  sceneId,
  disabled,
  exposedFrames,
  onReviewScene,
  onGenerateKeyframes,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  director: DirectorStatus;
  sceneId: string | null;
  disabled: boolean;
  exposedFrames: ExposedSceneFrames;
  onReviewScene(sceneId: string): void;
  onGenerateKeyframes(sceneId: string): void;
}) {
  const { t, ui } = useTranslation();

  const { view, error } = useSceneView(api, snapshot, sceneId);
  if (!view || !sceneId)
    return (
      <div className="frame-generation-footer">
        <small>
          {error
            ? ui(error, workbenchCopy)
            : t(
                "Select a scene to inspect generation state.",
                "选择场景后检查生成状态",
              )}
        </small>
      </div>
    );
  const state = conversationSceneState(
    view,
    snapshot,
    director,
    exposedFrames,
    disabled,
  );
  const viewed = view.rows.filter(
    (r) =>
      r.image &&
      exposedFrames[
        exposedSceneFrameKey(
          view.projectId,
          view.revisionId,
          r.shotId,
          r.image.artifactId,
          r.image.sha256,
        )
      ],
  ).length;
  return (
    <div className="frame-generation-footer">
      <div>
        <strong>
          {state.unknown
            ? t("Job outcome unconfirmed", "任务结果尚未确认")
            : state.stage === "complete"
              ? t("Scene media saved", "本场景媒体已保存")
              : view.rows.some((row) => row.videoPending)
                ? t("Scene confirmed", "场景已确认")
                : state.stage === "image" && state.existingWork
                  ? t("Generating keyframes…", "正在生成关键帧…")
                  : t(
                      view.rows.length === 1
                        ? "{v0} / {v1} keyframe viewed"
                        : "{v0} / {v1} keyframes viewed",
                      "{v0} / {v1} 个关键帧已查看",
                      {
                        v0: viewed,
                        v1: view.rows.length,
                      },
                    )}
        </strong>
        <small>
          {state.stage === "image"
            ? t(
                "Check composition and content with keyframes first.",
                "先用关键帧检查构图和内容",
              )
            : state.existingWork
              ? t("Updating requested media", "正在更新已请求的素材")
              : state.stage === "complete"
                ? t(
                    "Continue discussing changes or view the film.",
                    "可以继续讨论修改，或查看成片",
                  )
                : t(
                    "View the current keyframes, then confirm the scene once for narration and video.",
                    "查看当前关键帧后，一次确认场景的旁白与视频生成。",
                  )}
        </small>
      </div>
      {state.stage === "image" && !state.existingWork && !state.unknown ? (
        <UiButton
          variant="primary"
          disabled={
            disabled || state.existingWork || state.unknown || view.paused
          }
          onClick={() => onGenerateKeyframes(sceneId)}
        >
          <Icon name="image" size={16} />{" "}
          {t("Generate keyframes", "生成关键帧")}{" "}
        </UiButton>
      ) : (
        state.stage !== "complete" &&
        state.stage !== "image" &&
        !state.existingWork &&
        !state.unknown && (
          <UiButton
            variant="primary"
            disabled={
              !state.fresh ||
              disabled ||
              state.existingWork ||
              state.unknown ||
              !!snapshot.control?.paused
            }
            onClick={() => onReviewScene(sceneId)}
          >
            <Icon name="play" size={16} />{" "}
            {t("Review & confirm scene", "检查并确认场景")}{" "}
          </UiButton>
        )
      )}
    </div>
  );
}
