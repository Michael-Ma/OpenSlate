import { useTranslation, LanguageSwitch } from "./Locale";
import {
  artifactIdentity,
  artifactView,
  type ArtifactViewState,
} from "./artifact-view-model";
import { useEffect, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  FormEvent,
  ReactNode,
  RefObject,
} from "react";
import { IconButton as RadixIconButton, Tooltip } from "@radix-ui/themes";
import { AppDialog, UiButton } from "./ui";
import { APP_NAME } from "@openslate/core/public";
import type { StudioApi } from "./api";
import { durationLabel, previewOutput } from "./model";
import type { Artifact, ArtifactFixture, ProjectSnapshot, Shot } from "./model";

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The action could not be completed.";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v1" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H4v16h6m4-13 5 5-5 5m-6-5h11" />
      </>
    ),
    slate: (
      <>
        <path d="M4 8h16v12H4zM4 8l-1-4 16-3 1 4zM7 3l3 3m3-4 3 3M8 12h8m-8 4h5" />
      </>
    ),
    at: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
      </>
    ),
    pause: <path d="M8 5v14M16 5v14" />,
    play: <path d="m8 5 11 7-11 7z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    chat: <path d="M4 4h16v12H9l-5 4z" />,
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m3 16 5-5 5 5 3-3 5 5" />
        <circle cx="16" cy="8" r="1" />
      </>
    ),
    folder: (
      <path d="M3 8V6a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    "chevron-down": <path d="m5 9 7 7 7-7" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    moon: <path d="M21 13.1A9 9 0 0 1 10.9 3a9 9 0 1 0 10.2 10.1Z" />,
    frames: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    list: (
      <>
        <rect x="3" y="4" width="4" height="4" rx="1" />
        <rect x="3" y="10" width="4" height="4" rx="1" />
        <rect x="3" y="16" width="4" height="4" rx="1" />
        <path d="M11 6h10M11 12h10M11 18h10" />
      </>
    ),
    compare: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M12 4v16m-6-8 2-2m-2 2 2 2m10-2-2-2m2 2-2 2" />
      </>
    ),
    timeline: (
      <>
        <rect x="3" y="4" width="14" height="5" rx="1.5" />
        <rect x="7" y="12" width="14" height="5" rx="1.5" />
        <path d="M5 2v20" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
      </>
    ),
    expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    edit: (
      <>
        <path d="m16 3 5 5-12 12-6 1 1-6zM13 6l5 5" />
      </>
    ),
    volume: (
      <>
        <path d="M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function IconButton({
  label,
  icon = "close",
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color"> & {
  label: string;
  icon?: string;
}) {
  return (
    <RadixIconButton
      {...props}
      type={props.type ?? "button"}
      variant="ghost"
      color="gray"
      size="2"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </RadixIconButton>
  );
}
/** Hover, keyboard focus, or a tap reveals supplementary guidance. */
export function HelpTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="help-tip">
      <Tooltip
        open={open}
        onOpenChange={setOpen}
        delayDuration={200}
        content={children}
        className="ui-help-tooltip"
      >
        <RadixIconButton
          type="button"
          variant="ghost"
          color="gray"
          size="1"
          aria-label={label}
          onClick={() => setOpen(true)}
        >
          <Icon name="info" size={16} />
        </RadixIconButton>
      </Tooltip>
    </span>
  );
}
export function Connect({ onConnect }: { onConnect: () => Promise<void> }) {
  const { t, ui } = useTranslation();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const startup = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let active = true;
    // StrictMode replays effects; a single-use launch code must be exchanged only once.
    startup.current ??= onConnect();
    void startup.current
      .catch((error) => {
        if (active) setError(errorText(error));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConnect();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="connect-page">
      <header className="connect-brand">
        <span className="brand-mark">
          <Icon name="slate" />
        </span>
        <strong>{APP_NAME}</strong>
        <span className="quiet-label">{t("LOCAL STUDIO", "本地工作区")}</span>
        <LanguageSwitch />
      </header>
      <main className="connect-layout">
        <div className="connect-story">
          <span className="eyebrow">
            {t("A FILM STARTS WITH A CONVERSATION", "一部影片，从对话开始")}
          </span>
          <h1>
            {t("Give your story", "让你的故事")}
            <br />
            {t("a place to take shape.", "在这里成形。")}
          </h1>
          <p>
            {t(
              "Work through the idea, shape each shot, and review the frames before the video begins.",
              "讨论创意，塑造每个镜头，检查关键帧后再生成视频。",
            )}
          </p>
          <div className="process-strip">
            <span>
              01 <b>{t("Imagine", "构思")}</b>
            </span>
            <span>
              02 <b>{t("Shape", "创作")}</b>
            </span>
            <span>
              03 <b>{t("Review", "检查")}</b>
            </span>
          </div>
          <p className="connect-footnote">
            {t(
              "Open source. Your workspace, on your computer.",
              "开源，你的工作区，保存在你的电脑上。",
            )}
          </p>
        </div>
        <form className="connect-card" onSubmit={(event) => void submit(event)}>
          <span className="small-mark">
            <Icon name="slate" size={27} />
          </span>
          <h2>{t("Open your studio", "打开工作区")}</h2>
          <p>
            {t(
              "Your projects stay on this computer. The OpenSlate launcher connects your browser automatically.",
              "项目保存在这台电脑上。OpenSlate 启动器会自动连接浏览器。",
            )}
          </p>
          {error && (
            <p role="alert" className="form-error">
              {ui(error)}
            </p>
          )}
          <UiButton
            type="submit"
            variant="primary"
            className="button primary full-width"
            disabled={busy}
          >
            {busy
              ? t("Opening studio…", "正在打开工作区…")
              : t("Open studio", "打开工作区")}
            <Icon name="arrow" size={17} />
          </UiButton>
          <div className="connection-help">
            {t("Run", "运行")}
            <code>./start.sh</code>
            {t(
              "in your OpenSlate folder to start or reconnect to the studio.",
              "在 OpenSlate 文件夹中启动或重新连接工作区。",
            )}
          </div>
        </form>
      </main>
      <footer className="connect-footer">
        {t("BUILT FOR THE WORK BETWEEN IDEA AND FILM", "连接创意与影片")}{" "}
        <span>{t("OpenSlate · Early preview", "OpenSlate · 早期预览")}</span>
      </footer>
    </div>
  );
}
export function useArtifact(
  api: StudioApi,
  projectId: string,
  artifact: Artifact | null,
) {
  const identity = artifactIdentity(projectId, artifact);
  const [result, setResult] = useState<ArtifactViewState<StudioApi> | null>(
    null,
  );
  useEffect(() => {
    if (!artifact || !identity) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setResult({
      api,
      identity,
      signal: controller.signal,
      url: null,
      error: "",
    });
    void api
      .artifact(projectId, artifact, controller.signal)
      .then((url) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setResult({ api, identity, signal: controller.signal, url, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            api,
            identity,
            signal: controller.signal,
            url: null,
            error: errorText(error),
          });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, identity]);
  // A new review must never render yesterday's bytes with today's onLoad/hash.
  return artifactView(result, api, identity);
}

export function Lightbox({
  value,
  onClose,
  onApprove,
  approveDisabled = false,
  approved = false,
  returnFocusRef,
}: {
  value: { url: string; shot: Shot; fixture: ArtifactFixture };
  onClose: () => void;
  onApprove?: () => void;
  approveDisabled?: boolean;
  approved?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t, ui } = useTranslation();
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null),
    [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageReady = loadedUrl === value.url && failedUrl !== value.url;
  return (
    <AppDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={value.shot.purpose}
      header={
        <span className="eyebrow">
          {value.fixture === true
            ? t("Fixture keyframe", "演示关键帧")
            : t("Keyframe review", "检查关键帧")}
        </span>
      }
      className="keyframe-dialog"
      maxWidth="980px"
      closeLabel={t("Close enlarged keyframe", "关闭放大的关键帧")}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      description={
        value.fixture === true
          ? t(
              "Fixture imagery represents pipeline state, not the requested creative quality.",
              "演示图像用于展示制作状态，不代表实际创作质量。",
            )
          : t(
              "Review the exact frame and its planned motion.",
              "检查当前完整画面及其运动计划。",
            )
      }
      footer={
        <>
          <span className="field-help">
            {durationLabel(value.shot.desiredFrames)}
            {t("planned shot", "计划镜头")}
          </span>
          <div className="inline-actions">
            <UiButton variant="secondary" onClick={onClose}>
              {t("Close", "关闭")}
            </UiButton>
            {onApprove && (
              <UiButton
                variant="primary"
                disabled={approved || approveDisabled || !imageReady}
                onClick={() => {
                  if (imageReady) onApprove();
                }}
              >
                {approved
                  ? t("Reviewed", "已检查")
                  : t("Approve keyframe & motion", "确认关键帧与运动")}
              </UiButton>
            )}
          </div>
        </>
      }
    >
      <img
        key={value.url}
        className="keyframe-review-image"
        src={value.url}
        alt={value.shot.purpose}
        onLoad={() => {
          setLoadedUrl(value.url);
          setFailedUrl(null);
        }}
        onError={() => {
          setLoadedUrl(null);
          setFailedUrl(value.url);
        }}
      />
      {failedUrl === value.url ? (
        <p role="alert" className="inline-error">
          {t(
            "This exact frame could not be displayed. Close the review and reload it before approving.",
            "当前画面无法显示。请关闭检查并重新加载后再确认。",
          )}
        </p>
      ) : (
        !imageReady && (
          <p role="status" className="field-help">
            {t("Loading the exact frame…", "正在加载当前完整画面…")}
          </p>
        )
      )}
      <dl className="keyframe-review-details">
        <div>
          <dt>{t("Direction", "画面方向")}</dt>
          <dd>{value.shot.framing}</dd>
        </div>
        <div>
          <dt>{t("Motion", "运动")}</dt>
          <dd>{value.shot.motion}</dd>
        </div>
      </dl>
    </AppDialog>
  );
}
export function Preview({
  api,
  snapshot,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
}) {
  const { t, ui } = useTranslation();
  const output = previewOutput(snapshot);
  const { url, error } = useArtifact(
    api,
    snapshot.project.id,
    output?.artifact ?? null,
  );
  if (!output) return null;
  return (
    <section className="preview-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t("ASSEMBLED DRAFT", "合成草稿")}</span>
          <h2>
            {output.previous
              ? t("Previous preview", "较早的预览")
              : t("Your latest preview", "最新预览")}
          </h2>
        </div>
        <span className="tag">
          {output.fixture === true
            ? t("Fixture media", "演示素材")
            : t("Video preview", "视频预览")}
        </span>
      </div>
      {url ? (
        <video
          controls
          preload="metadata"
          src={url}
          aria-label={
            output.fixture === true
              ? t("Assembled fixture video preview", "合成演示视频预览")
              : t("Assembled video preview", "合成视频预览")
          }
        />
      ) : (
        <p>{error ? ui(error) : t("Loading preview…", "正在加载预览…")}</p>
      )}
      <p className="field-help">
        {output.previous &&
          t(
            "Your earlier preview stays available while the changed shots are prepared. ",
            "准备更新镜头时，仍可查看较早的预览。",
          )}
        {output.fixture === true
          ? t(
              "This fixture tests the production flow. Its playback length and visuals do not represent the planned film.",
              "此演示用于验证制作流程，其播放时长和画面不代表计划中的影片。",
            )
          : t(
              "Review the assembled video and discuss any changes you want.",
              "检查合成视频，讨论你希望进行的调整。",
            )}
      </p>
    </section>
  );
}
