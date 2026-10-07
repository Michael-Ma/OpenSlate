import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { StudioApi } from "./api";
import type { ArtifactFixture, ProjectSnapshot, Shot } from "./model";
import { durationLabel } from "./model";
import { Icon, useArtifact } from "./components";
import { UiButton } from "./ui";
import { frameExposureIdentity, projectResults } from "./project-results-model";
import type {
  ResultMedia,
  ResultScene,
  ResultShot,
  SceneFrameExposure,
} from "./project-results-model";
import {
  adjacentFrameShot,
  canExposeFrame,
  canConfirmAfterSeen,
  currentFrameExposures,
  frameHistory,
  frameSelection,
  revokedFrameExposures,
} from "./frame-workspace-model";
import type {
  FrameHistoryEntry,
  FrameSelection,
  FrameView,
} from "./frame-workspace-model";
import "./frame-workspace.css";

export interface FrameWorkspaceProps {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  view: FrameView;
  selectedShotId: string | null;
  onSelectShot: (id: string) => void;
  active?: boolean;
  disabled?: boolean;
  reviewedFrames?: Readonly<Record<string, boolean>>;
  onConfirmFrame?: (shotId: string) => void;
  onEditShot: (id: string) => void;
  onEditScene: (id: string) => void;
  onReferenceShot: (id: string) => void;
  onReferenceScene: (id: string) => void;
  onInspect?: (value: {
    url: string;
    shot: Shot;
    fixture: ArtifactFixture;
  }) => void;
  onFrameExposure?: (exposure: SceneFrameExposure) => void;
  onGenerateKeyframes?: (sceneId: string, shotId?: string) => void;
  onReviewScene?: (sceneId: string) => void;
  sceneActions?: ReactNode;
}

function WorkIcon({
  name,
  size = 16,
}: {
  name: "edit" | "reference" | "expand" | "left" | "right" | "history";
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    edit: (
      <>
        <path d="m15 4 5 5M4 20l5-1L20 8l-5-5L4 14z" />
      </>
    ),
    reference: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M16 8v7c0 3 4 2 4-2" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    left: <path d="m15 6-6 6 6 6" />,
    right: <path d="m9 6 6 6-6 6" />,
    history: (
      <>
        <path d="M3 5v5h5M3 10a9 9 0 1 1 2 8M12 7v5l3 2" />
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
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function stateLabel(media: ResultMedia): string {
  if (media.state === "saved") return "已保存";
  if (media.state === "previous") return "需要更新";
  if (media.state === "unverified") return "状态未核实";
  if (media.state === "uncertain") return "结果待核实";
  if (media.state === "failed") return "需要处理";
  if (media.state === "working") return "生成中";
  if (media.state === "missing") return "待生成";
  return media.label === "Waiting for keyframe" ? "等待关键帧" : "待生成";
}

function frameExposure(
  snapshot: ProjectSnapshot,
  result: ResultShot,
): SceneFrameExposure | null {
  const artifact = result.keyframe.artifact;
  return artifact
    ? {
        projectId: snapshot.project.id,
        projectRevisionId: snapshot.project.revisionId,
        shotId: result.shot.id,
        artifactId: artifact.artifactId,
        sha256: artifact.sha256,
        displayed: true,
      }
    : null;
}

function MediaNote({ media }: { media: ResultMedia }) {
  return (
    <>
      {media.fixture === true && (
        <span className="fw-source-note fw-source-warning">演示素材</span>
      )}
      {media.fixture === null && media.artifact && (
        <span className="fw-source-note">素材来源未核实</span>
      )}
      {!media.current && media.artifact && (
        <span className="fw-source-note">保留的旧画面 · 不用于当前检查</span>
      )}
    </>
  );
}

function FrameThumbnail({
  api,
  projectId,
  result,
  active,
}: {
  api: StudioApi;
  projectId: string;
  result: ResultShot;
  active: boolean;
}) {
  const node = useRef<HTMLDivElement>(null),
    [nearby, setNearby] = useState(false),
    [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!node.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearby(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setNearby(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "160px" },
    );
    observer.observe(node.current);
    return () => observer.disconnect();
  }, []);
  const image = useArtifact(
    api,
    projectId,
    active && nearby ? result.keyframe.artifact : null,
  );
  return (
    <div ref={node} className="fw-shot-thumb">
      {image.url && failedUrl !== image.url ? (
        <img
          src={image.url}
          alt=""
          loading="lazy"
          onError={() => setFailedUrl(image.url)}
        />
      ) : (
        <div className="fw-thumb-empty">
          <Icon name="image" size={22} />
          <span>
            {image.error || (failedUrl === image.url && image.url)
              ? "预览不可用"
              : stateLabel(result.keyframe)}
          </span>
        </div>
      )}
    </div>
  );
}

function SelectedStage({
  api,
  snapshot,
  selection,
  active,
  mediaKind,
  onMediaKind,
  scenes,
  onSelectShot,
  onInspect,
  onExposure,
  currentExposures,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  selection: FrameSelection;
  active: boolean;
  mediaKind: "image" | "video";
  onMediaKind: (kind: "image" | "video") => void;
  scenes: ResultScene[];
  onSelectShot: (id: string) => void;
  onInspect?: FrameWorkspaceProps["onInspect"];
  onExposure: (value: SceneFrameExposure) => void;
  currentExposures: SceneFrameExposure[];
}) {
  const { result, index, count } = selection,
    selectedMedia = mediaKind === "image" ? result.keyframe : result.video;
  const media = useArtifact(
    api,
    snapshot.project.id,
    active ? selectedMedia.artifact : null,
  );
  const tile = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    visible = useRef(false);
  const decoded = useRef<{
    identity: string;
    url: string;
    element: HTMLImageElement;
  } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const exposure = frameExposure(snapshot, result),
    exposureId = exposure ? frameExposureIdentity(exposure) : null;
  const latest = useRef({
    active,
    media,
    exposure,
    exposureId,
    mediaKind,
    currentExposures,
    onExposure,
  });
  latest.current = {
    active,
    media,
    exposure,
    exposureId,
    mediaKind,
    currentExposures,
    onExposure,
  };
  const prove = useCallback(() => {
    const value = latest.current,
      image = decoded.current;
    const ready =
      value.mediaKind === "image" &&
      !!image &&
      image.identity === value.exposureId &&
      image.url === value.media.url &&
      image.element.isConnected &&
      image.element.naturalWidth > 0 &&
      image.element.currentSrc === value.media.url &&
      canExposeFrame(value.exposure, value.currentExposures, {
        active: value.active,
        visible: visible.current,
        decoded: true,
      });
    if (ready && value.exposure)
      value.onExposure({ ...value.exposure, displayed: true });
  }, []);
  useEffect(() => {
    if (!tile.current) return;
    if (typeof IntersectionObserver === "undefined") {
      visible.current = true;
      prove();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      visible.current = entries.some((entry) => entry.isIntersecting);
      prove();
    });
    observer.observe(tile.current);
    return () => {
      visible.current = false;
      observer.disconnect();
    };
  }, [prove]);
  useLayoutEffect(() => {
    decoded.current = null;
  }, [exposureId, media.url, mediaKind]);
  useEffect(() => {
    prove();
  }, [active, currentExposures, prove]);
  useEffect(() => {
    if (media.error && mediaKind === "image" && exposure)
      onExposure({ ...exposure, displayed: false });
  }, [media.error, exposureId, mediaKind]);
  useEffect(() => {
    if (!active || mediaKind !== "video") video.current?.pause();
  }, [active, mediaKind]);
  const failed = (
    url: string | null,
    failedExposure: SceneFrameExposure | null,
  ) => {
    setFailedUrl(url);
    decoded.current = null;
    if (mediaKind === "image" && failedExposure)
      onExposure({ ...failedExposure, displayed: false });
  };
  const loaded = (element: HTMLImageElement, url: string, identity: string) => {
    // Decode belongs to this exact element and identity; a late callback cannot expose its replacement.
    void (
      typeof element.decode === "function"
        ? element.decode()
        : Promise.resolve()
    )
      .then(() => {
        const value = latest.current;
        if (
          value.media.url !== url ||
          value.exposureId !== identity ||
          !element.isConnected ||
          element.currentSrc !== url
        )
          return;
        decoded.current = { identity, url, element };
        prove();
      })
      .catch(() => {
        if (latest.current.media.url === url) failed(url, exposure);
      });
  };
  const previous = adjacentFrameShot(scenes, result.shot.id, -1),
    next = adjacentFrameShot(scenes, result.shot.id, 1);
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (
      (event.target as HTMLElement).closest(
        'input,textarea,select,video,[contenteditable="true"]',
      ) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const id =
      event.key === "ArrowLeft"
        ? previous
        : event.key === "ArrowRight"
          ? next
          : null;
    if (id) {
      event.preventDefault();
      onSelectShot(id);
    }
  };
  return (
    <section
      className="fw-preview-stage"
      aria-label={`Shot ${result.label} 画面预览`}
      tabIndex={0}
      onKeyDown={keyboard}
    >
      <header className="fw-stage-top">
        <span>
          <i />
          {mediaKind === "image" ? "画面预览" : "视频预览"} · SHOT{" "}
          {result.label}
        </span>
        <div className="fw-stage-tools">
          <span>{stateLabel(selectedMedia)}</span>
          {mediaKind === "image" &&
            media.url &&
            failedUrl !== media.url &&
            onInspect && (
              <button
                type="button"
                aria-label={`放大 Shot ${result.label} 关键帧`}
                title="放大画面"
                onClick={() =>
                  onInspect({
                    url: media.url!,
                    shot: result.shot,
                    fixture: result.keyframe.fixture,
                  })
                }
              >
                <WorkIcon name="expand" />
              </button>
            )}
        </div>
      </header>
      <div
        ref={tile}
        className="fw-main-media"
        aria-busy={!!selectedMedia.artifact && !media.url && !media.error}
      >
        {media.url && failedUrl !== media.url ? (
          mediaKind === "image" ? (
            <img
              key={`${exposureId}:${media.url}`}
              src={media.url}
              alt={`Shot ${result.label} 关键帧：${result.shot.purpose}`}
              onLoad={(event) => {
                if (exposureId)
                  loaded(event.currentTarget, media.url!, exposureId);
              }}
              onError={() => failed(media.url, exposure)}
            />
          ) : (
            <video
              key={media.url}
              ref={video}
              src={media.url}
              controls
              playsInline
              muted
              preload="metadata"
              onError={() => failed(media.url, null)}
              aria-label={`Shot ${result.label} 视频`}
            />
          )
        ) : (
          <div className="fw-stage-empty">
            <Icon name={mediaKind === "image" ? "image" : "play"} size={35} />
            <strong>
              {media.error || (failedUrl === media.url && media.url)
                ? "预览暂时不可用"
                : selectedMedia.artifact
                  ? "正在载入已保存的画面…"
                  : stateLabel(selectedMedia)}
            </strong>
            <p>
              {mediaKind === "image"
                ? result.shot.framing || result.shot.purpose
                : result.shot.motion || "视频会在生成后保留在这里。"}
            </p>
          </div>
        )}
        {mediaKind === "image" && media.url && failedUrl !== media.url && (
          <div className="fw-frame-overlay" aria-hidden="true" />
        )}
      </div>
      <footer className="fw-stage-bottom">
        <div className="fw-stage-media-switch" aria-label="镜头媒体">
          <button
            type="button"
            aria-pressed={mediaKind === "image"}
            onClick={() => onMediaKind("image")}
          >
            关键帧
          </button>
          <button
            type="button"
            aria-pressed={mediaKind === "video"}
            onClick={() => onMediaKind("video")}
          >
            视频{result.video.current ? " · 已保存" : ""}
          </button>
        </div>
        <div className="fw-stage-navigation">
          <span>
            {String(index + 1).padStart(2, "0")} /{" "}
            {String(count).padStart(2, "0")}
          </span>
          <button
            type="button"
            aria-label="上一个镜头"
            disabled={!previous}
            onClick={() => {
              if (previous) onSelectShot(previous);
            }}
          >
            <WorkIcon name="left" />
          </button>
          <button
            type="button"
            aria-label="下一个镜头"
            disabled={!next}
            onClick={() => {
              if (next) onSelectShot(next);
            }}
          >
            <WorkIcon name="right" />
          </button>
        </div>
      </footer>
      <div className="fw-stage-provenance">
        <MediaNote media={selectedMedia} />
        {media.error && <span role="alert">{media.error}</span>}
      </div>
    </section>
  );
}

function HistoryImage({
  api,
  snapshot,
  entry,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  entry: FrameHistoryEntry;
}) {
  const { url, error } = useArtifact(api, snapshot.project.id, entry.artifact),
    [failed, setFailed] = useState(false);
  return (
    <figure className="fw-history-frame">
      {url && !failed ? (
        <img src={url} alt={entry.label} onError={() => setFailed(true)} />
      ) : (
        <div className="fw-history-empty">
          {error || failed ? "预览不可用" : "载入已保存的画面…"}
        </div>
      )}
      <figcaption>
        <strong>{entry.label}</strong>
        <span>
          {entry.fixture === true
            ? "演示素材"
            : entry.fixture === null
              ? "来源未核实"
              : "已保存素材"}{" "}
          · 仅比较
        </span>
      </figcaption>
    </figure>
  );
}

function ShotInspector({
  api,
  snapshot,
  selection,
  disabled,
  reviewed,
  ready,
  history,
  onConfirmFrame,
  onEditShot,
  onReferenceShot,
  onGenerateKeyframes,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  selection: FrameSelection;
  disabled: boolean;
  reviewed: boolean;
  ready: boolean;
  history: FrameHistoryEntry[];
  onConfirmFrame?: FrameWorkspaceProps["onConfirmFrame"];
  onEditShot: FrameWorkspaceProps["onEditShot"];
  onReferenceShot: FrameWorkspaceProps["onReferenceShot"];
  onGenerateKeyframes?: FrameWorkspaceProps["onGenerateKeyframes"];
}) {
  const { result, scene } = selection;
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    setHistoryOpen(false);
  }, [result.shot.id, snapshot.project.id]);
  return (
    <aside
      className="fw-inspector"
      aria-label={`Shot ${result.label} 镜头设置`}
    >
      <header className="fw-inspector-head">
        <span>
          镜头设置 <small>{result.label}</small>
        </span>
        <button
          type="button"
          className="fw-icon-control"
          aria-label={`引用 Shot ${result.label}`}
          title="引用到对话"
          disabled={disabled}
          onClick={() => onReferenceShot(result.shot.id)}
        >
          <WorkIcon name="reference" />
        </button>
      </header>
      <div className="fw-inspector-body">
        <h2>{result.shot.purpose || "未命名镜头"}</h2>
        <p>
          {result.shot.framing ||
            result.shot.action ||
            "镜头计划会在这里显示。"}
        </p>
        <dl className="fw-properties">
          <div>
            <dt>时长</dt>
            <dd>{durationLabel(result.shot.desiredFrames)}</dd>
          </div>
          <div>
            <dt>关键帧</dt>
            <dd>{stateLabel(result.keyframe)}</dd>
          </div>
          <div>
            <dt>视频</dt>
            <dd>{stateLabel(result.video)}</dd>
          </div>
          {result.keyframe.model && (
            <div>
              <dt>图像模型</dt>
              <dd>{result.keyframe.model}</dd>
            </div>
          )}
          {result.video.model && (
            <div>
              <dt>视频模型</dt>
              <dd>{result.video.model}</dd>
            </div>
          )}
        </dl>
        {result.shot.motion && (
          <div className="fw-motion">
            <span>运动与节奏</span>
            <p>{result.shot.motion}</p>
          </div>
        )}
        <details className="fw-prompt-details">
          <summary>Plan &amp; Prompt</summary>
          <dl>
            <div>
              <dt>镜头计划</dt>
              <dd>{result.shot.purpose}</dd>
            </div>
            <div>
              <dt>图像 Prompt</dt>
              <dd>{result.shot.imagePrompt || "尚未编写"}</dd>
            </div>
            <div>
              <dt>视频 Prompt</dt>
              <dd>{result.shot.videoPrompt || "尚未编写"}</dd>
            </div>
            {result.keyframe.savedPrompt &&
              result.keyframe.savedPrompt !== result.shot.imagePrompt && (
                <div>
                  <dt>已保存关键帧的 Prompt</dt>
                  <dd>{result.keyframe.savedPrompt}</dd>
                </div>
              )}
            {result.video.savedPrompt &&
              result.video.savedPrompt !== result.shot.videoPrompt && (
                <div>
                  <dt>已保存视频的 Prompt</dt>
                  <dd>{result.video.savedPrompt}</dd>
                </div>
              )}
          </dl>
        </details>
        {(result.narration.text || result.shot.narration?.mode === "none") && (
          <details className="fw-prompt-details">
            <summary>旁白与声音</summary>
            <p>{result.narration.text || "无旁白"}</p>
            <small>
              {result.narration.voice}
              {result.narration.acceptedFrames
                ? ` · ${durationLabel(result.narration.acceptedFrames)}`
                : ""}
            </small>
          </details>
        )}
        {historyOpen && (
          <section className="fw-history" aria-label="之前的关键帧">
            <p>仅比较已保存的画面。旧版本不会替代当前画面或获得生成审批。</p>
            {history.map((entry) => (
              <HistoryImage
                key={entry.artifact.artifactId + entry.artifact.sha256}
                api={api}
                snapshot={snapshot}
                entry={entry}
              />
            ))}
          </section>
        )}
      </div>
      <div className="fw-inspector-actions">
        {onGenerateKeyframes && !scene.unassigned && (
          <UiButton
            variant="secondary"
            disabled={
              disabled ||
              result.latest === "Media work in progress" ||
              result.latest === "Outcome unconfirmed"
            }
            onClick={() => onGenerateKeyframes(scene.id, result.shot.id)}
          >
            <Icon name="refresh" size={15} />
            {result.keyframe.artifact ? "重新生成关键帧" : "生成关键帧"}
          </UiButton>
        )}
        <UiButton
          variant="secondary"
          disabled={disabled}
          onClick={() => onEditShot(result.shot.id)}
        >
          <WorkIcon name="edit" />
          编辑 Plan &amp; Prompt
        </UiButton>
        {!!history.length && (
          <UiButton
            variant="ghost"
            onClick={() => setHistoryOpen((value) => !value)}
            aria-expanded={historyOpen}
          >
            <WorkIcon name="history" />
            比较已保存的画面
          </UiButton>
        )}
        {onConfirmFrame && (
          <UiButton
            variant={reviewed ? "soft" : "success"}
            disabled={
              disabled || reviewed || !ready || !result.keyframe.current
            }
            onClick={() => {
              if (ready && result.keyframe.current)
                onConfirmFrame(result.shot.id);
            }}
          >
            <Icon name="check" size={16} />
            {reviewed ? "此画面已检查" : "确认此画面"}
          </UiButton>
        )}
        <p className="fw-review-hint">
          {reviewed
            ? "检查记录用于本次视频生成；不会自动开始制作。"
            : result.keyframe.current
              ? "检查构图与内容，再确认此画面。"
              : "生成符合当前计划的关键帧后再检查。"}
        </p>
      </div>
    </aside>
  );
}

function FrameShelf({
  api,
  snapshot,
  scene,
  selectedShotId,
  active,
  disabled,
  reviewedFrames,
  onSelectShot,
  onEditScene,
  onReferenceScene,
  onReferenceShot,
  onReviewScene,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  scene: ResultScene;
  selectedShotId: string | null;
  active: boolean;
  disabled: boolean;
  reviewedFrames: Readonly<Record<string, boolean>>;
  onSelectShot: FrameWorkspaceProps["onSelectShot"];
  onEditScene: FrameWorkspaceProps["onEditScene"];
  onReferenceScene: FrameWorkspaceProps["onReferenceScene"];
  onReferenceShot: FrameWorkspaceProps["onReferenceShot"];
  onReviewScene?: FrameWorkspaceProps["onReviewScene"];
}) {
  const selected = scene.shots.find(
    (result) => result.shot.id === selectedShotId,
  );
  return (
    <section
      className="fw-scene-shelf"
      id={`project-results-scene-${scene.id}`}
      aria-labelledby={`fw-scene-${scene.id}`}
    >
      <header className="fw-shelf-head">
        <h2 id={`fw-scene-${scene.id}`}>
          <span>分镜</span>
          <small>
            {scene.unassigned ? "未分组镜头" : `SCENE ${scene.label}`}
          </small>
          <b>{scene.purpose || "场景方向待定"}</b>
        </h2>
        {!scene.unassigned && (
          <div className="fw-shelf-actions">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onReferenceScene(scene.id)}
              aria-label={`引用 Scene ${scene.label}`}
              title="引用场景"
            >
              <WorkIcon name="reference" />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onEditScene(scene.id)}
            >
              <WorkIcon name="edit" />
              编辑场景
            </button>
          </div>
        )}
      </header>
      <div className="fw-shot-shelf">
        {scene.shots.map((result) => {
          const exposure = frameExposure(snapshot, result),
            reviewed =
              result.keyframe.current &&
              !!exposure &&
              reviewedFrames[frameExposureIdentity(exposure)] === true;
          return (
            <button
              type="button"
              key={result.shot.id}
              id={`project-results-shot-${result.shot.id}`}
              className={`fw-shot-card${result.shot.id === selectedShotId ? " selected" : ""}`}
              aria-pressed={result.shot.id === selectedShotId}
              aria-label={`选择 Shot ${result.label}：${result.shot.purpose}`}
              onClick={() => onSelectShot(result.shot.id)}
            >
              <FrameThumbnail
                api={api}
                projectId={snapshot.project.id}
                result={result}
                active={active}
              />
              <span className="fw-shot-number">{result.label}</span>
              <span
                className={`fw-shot-state${reviewed ? " checked" : result.keyframe.state === "saved" ? " pending" : ""}`}
              >
                {reviewed
                  ? "已检查"
                  : result.keyframe.current
                    ? "待检查"
                    : stateLabel(result.keyframe)}
              </span>
              <span className="fw-shot-meta">
                <strong>{result.shot.purpose || "未命名镜头"}</strong>
                <small>{durationLabel(result.shot.desiredFrames)}</small>
              </span>
              {result.video.artifact && (
                <span className="fw-shot-video-note">
                  <Icon name="play" size={12} />
                  {result.video.current ? "视频已保存" : "保留的旧视频"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!scene.shots.length && (
        <p className="fw-empty-scene">这个场景还没有镜头。</p>
      )}
      <footer className="fw-shelf-footer">
        <span>
          <Icon name="image" size={14} />
          静态关键帧 · 运动与节奏保留在视频计划中
        </span>
        <div>
          {selected && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onReferenceShot(selected.shot.id)}
            >
              <WorkIcon name="reference" size={14} />
              引用选中镜头
            </button>
          )}
          {onReviewScene && !scene.unassigned && scene.shots.length > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onReviewScene(scene.id)}
            >
              查看场景生成
              <WorkIcon name="right" size={14} />
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

function PlanView({
  snapshot,
  scenes,
  selectedShotId,
  disabled,
  onSelectShot,
  onEditShot,
  onEditScene,
  onReferenceShot,
  onReferenceScene,
}: {
  snapshot: ProjectSnapshot;
  scenes: ResultScene[];
  selectedShotId: string | null;
  disabled: boolean;
  onSelectShot: FrameWorkspaceProps["onSelectShot"];
  onEditShot: FrameWorkspaceProps["onEditShot"];
  onEditScene: FrameWorkspaceProps["onEditScene"];
  onReferenceShot: FrameWorkspaceProps["onReferenceShot"];
  onReferenceScene: FrameWorkspaceProps["onReferenceScene"];
}) {
  const total = snapshot.project.shots.reduce(
    (sum, shot) => sum + shot.desiredFrames,
    0,
  );
  return (
    <div className="fw-plan-view">
      <section className="fw-plan-intro">
        <span className="fw-eyebrow">创作计划</span>
        <h2>{snapshot.project.name}</h2>
        <div className="fw-plan-stats">
          <span>{durationLabel(total)}</span>
          <span>{scenes.length} 个场景</span>
          <span>{snapshot.project.shots.length} 个镜头</span>
        </div>
        {snapshot.project.brief && <p>{snapshot.project.brief}</p>}
        {snapshot.project.story && (
          <details>
            <summary>完整故事</summary>
            <p>{snapshot.project.story}</p>
          </details>
        )}
        {!snapshot.project.brief && !snapshot.project.story && (
          <p>通过左侧对话梳理创意，场景与镜头会保留在这份计划里。</p>
        )}
      </section>
      {scenes.map((scene) => (
        <section
          key={scene.id}
          className="fw-plan-scene"
          id={`plan-scene-${scene.id}`}
        >
          <header>
            <div>
              <span className="fw-eyebrow">
                {scene.unassigned ? "未分组镜头" : `Scene ${scene.label}`}
              </span>
              <h2>{scene.purpose || "场景方向待定"}</h2>
            </div>
            {!scene.unassigned && (
              <div className="fw-plan-actions">
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`引用 Scene ${scene.label}`}
                  onClick={() => onReferenceScene(scene.id)}
                >
                  <WorkIcon name="reference" />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onEditScene(scene.id)}
                >
                  <WorkIcon name="edit" />
                  编辑场景
                </button>
              </div>
            )}
          </header>
          {scene.shots.map((result) => (
            <article
              key={result.shot.id}
              className={`fw-plan-shot${selectedShotId === result.shot.id ? " selected" : ""}`}
            >
              <div className="fw-plan-shot-title">
                <button
                  type="button"
                  className="fw-plan-select"
                  aria-pressed={selectedShotId === result.shot.id}
                  onClick={() => onSelectShot(result.shot.id)}
                >
                  <span>Shot {result.label}</span>
                  <h3>{result.shot.purpose || "未命名镜头"}</h3>
                </button>
                <small>{durationLabel(result.shot.desiredFrames)}</small>
              </div>
              <dl>
                <div>
                  <dt>画面</dt>
                  <dd>{result.shot.framing || "尚未编写"}</dd>
                </div>
                <div>
                  <dt>运动</dt>
                  <dd>{result.shot.motion || "尚未编写"}</dd>
                </div>
                {result.shot.action && (
                  <div>
                    <dt>动作</dt>
                    <dd>{result.shot.action}</dd>
                  </div>
                )}
                {result.narration.text && (
                  <div>
                    <dt>旁白</dt>
                    <dd>{result.narration.text}</dd>
                  </div>
                )}
              </dl>
              <footer>
                <div className="fw-plan-state">
                  <span>
                    <Icon name="image" size={14} />
                    关键帧 · {stateLabel(result.keyframe)}
                  </span>
                  <span>
                    <Icon name="play" size={14} />
                    视频 · {stateLabel(result.video)}
                  </span>
                </div>
                <div className="fw-plan-actions">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`引用 Shot ${result.label}`}
                    onClick={() => onReferenceShot(result.shot.id)}
                  >
                    <WorkIcon name="reference" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onEditShot(result.shot.id)}
                  >
                    <WorkIcon name="edit" />
                    编辑 Plan &amp; Prompt
                  </button>
                </div>
              </footer>
              <details className="fw-plan-prompts">
                <summary>查看 Prompt</summary>
                <dl>
                  <div>
                    <dt>图像</dt>
                    <dd>{result.shot.imagePrompt || "尚未编写"}</dd>
                  </div>
                  <div>
                    <dt>视频</dt>
                    <dd>{result.shot.videoPrompt || "尚未编写"}</dd>
                  </div>
                </dl>
              </details>
            </article>
          ))}
          {!scene.shots.length && (
            <p className="fw-empty-scene">镜头会在场景计划完善后显示。</p>
          )}
        </section>
      ))}
    </div>
  );
}

/** Production state remains authoritative; the workspace adds view/navigation and explicit review intent. */
export function FrameWorkspace({
  api,
  snapshot,
  view,
  selectedShotId,
  onSelectShot,
  active = true,
  disabled = false,
  reviewedFrames = {},
  onConfirmFrame,
  onEditShot,
  onEditScene,
  onReferenceShot,
  onReferenceScene,
  onInspect,
  onFrameExposure,
  onGenerateKeyframes,
  onReviewScene,
  sceneActions,
}: FrameWorkspaceProps) {
  const results = useMemo(() => projectResults(snapshot), [snapshot]),
    selection = frameSelection(results.scenes, selectedShotId);
  const exposures = useMemo(
    () => currentFrameExposures(snapshot, results.scenes),
    [snapshot, results],
  );
  const seen = useRef(new Map<string, SceneFrameExposure>()),
    callback = useRef(onFrameExposure);
  callback.current = onFrameExposure;
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [, refreshProof] = useState(0);
  useLayoutEffect(() => {
    for (const exposure of revokedFrameExposures(seen.current, exposures)) {
      seen.current.delete(frameExposureIdentity(exposure));
      callback.current?.(exposure);
    }
  }, [exposures]);
  const recordExposure = useCallback((exposure: SceneFrameExposure) => {
    const identity = frameExposureIdentity(exposure);
    if (exposure.displayed) {
      if (seen.current.has(identity)) return;
      seen.current.set(identity, exposure);
    } else seen.current.delete(identity);
    refreshProof((value) => value + 1);
    callback.current?.(exposure);
  }, []);
  useEffect(() => {
    if (selection && selection.result.shot.id !== selectedShotId)
      onSelectShot(selection.result.shot.id);
  }, [selection?.result.shot.id, selectedShotId, onSelectShot]);
  const history = useMemo(
    () => (selection ? frameHistory(snapshot, selection.result) : []),
    [
      snapshot,
      selection?.result.shot.id,
      selection?.result.keyframe.artifact?.artifactId,
      selection?.result.keyframe.artifact?.sha256,
    ],
  );
  const selectedExposure = selection
    ? frameExposure(snapshot, selection.result)
    : null;
  const canConfirm = canConfirmAfterSeen(
    selectedExposure,
    exposures,
    seen.current,
    active,
  );
  const reviewed =
    !!selectedExposure &&
    selection?.result.keyframe.current === true &&
    reviewedFrames[frameExposureIdentity(selectedExposure)] === true;
  const selectedScene = selection?.scene;
  return (
    <div
      className={`frame-workspace fw-view-${view}`}
      aria-label="制作工作区"
      id={`project-results-project-${snapshot.project.id}`}
    >
      <div className="fw-workspace-content">
        <header className="fw-section-head">
          <div>
            <h1>{view === "frames" ? "关键帧预览" : "创作计划"}</h1>
            <p>
              {view === "frames"
                ? "先检查构图与内容，确认后再生成视频。"
                : "每个场景与镜头的方向、Prompt 和当前状态。"}
            </p>
          </div>
          {view === "frames" &&
            selectedScene &&
            !selectedScene.unassigned &&
            onGenerateKeyframes && (
              <UiButton
                variant="secondary"
                className="fw-update-frames"
                disabled={
                  disabled ||
                  selectedScene.shots.some(
                    (result) =>
                      result.latest === "Media work in progress" ||
                      result.latest === "Outcome unconfirmed",
                  )
                }
                onClick={() => onGenerateKeyframes(selectedScene.id)}
              >
                <Icon name="refresh" size={15} />
                更新场景关键帧
              </UiButton>
            )}
        </header>
        {view === "plan" ? (
          <PlanView
            snapshot={snapshot}
            scenes={results.scenes}
            selectedShotId={selection?.result.shot.id ?? null}
            disabled={disabled}
            onSelectShot={onSelectShot}
            onEditShot={onEditShot}
            onEditScene={onEditScene}
            onReferenceShot={onReferenceShot}
            onReferenceScene={onReferenceScene}
          />
        ) : (
          <>
            {selection ? (
              <div className="fw-stage-layout">
                <SelectedStage
                  key={selection.result.shot.id}
                  api={api}
                  snapshot={snapshot}
                  selection={selection}
                  active={active}
                  mediaKind={mediaKind}
                  onMediaKind={setMediaKind}
                  scenes={results.scenes}
                  onSelectShot={onSelectShot}
                  {...(onInspect ? { onInspect } : {})}
                  onExposure={recordExposure}
                  currentExposures={exposures}
                />
                <ShotInspector
                  api={api}
                  snapshot={snapshot}
                  selection={selection}
                  disabled={disabled}
                  reviewed={reviewed}
                  ready={canConfirm}
                  history={history}
                  {...(onConfirmFrame ? { onConfirmFrame } : {})}
                  onEditShot={onEditShot}
                  onReferenceShot={onReferenceShot}
                  {...(onGenerateKeyframes ? { onGenerateKeyframes } : {})}
                />
              </div>
            ) : (
              <section className="fw-empty-project">
                <Icon name="slate" size={35} />
                <h2>把创意变成第一组画面。</h2>
                <p>
                  在左侧对话开始创作。场景、镜头与生成的画面会保留在这个工作区。
                </p>
              </section>
            )}
            {results.scenes.map((scene) => (
              <FrameShelf
                key={scene.id}
                api={api}
                snapshot={snapshot}
                scene={scene}
                selectedShotId={selection?.result.shot.id ?? null}
                active={active}
                disabled={disabled}
                reviewedFrames={reviewedFrames}
                onSelectShot={onSelectShot}
                onEditScene={onEditScene}
                onReferenceScene={onReferenceScene}
                onReferenceShot={onReferenceShot}
                {...(onReviewScene ? { onReviewScene } : {})}
              />
            ))}
          </>
        )}
      </div>
      {view === "frames" && sceneActions && (
        <footer className="fw-work-footer" aria-label="场景生成操作">
          {sceneActions}
        </footer>
      )}
    </div>
  );
}
