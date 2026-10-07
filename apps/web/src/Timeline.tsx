import { useTranslation } from "./Locale";
import { hierarchyUiLabel, workbenchCopy } from "./workbench-copy";
import {
  TimelineAudioCache,
  audioWindow,
  audioKey,
} from "./timeline-audio-cache";
import {
  audioAt,
  currentPlayback,
  scheduleAudioStart,
  syncAudio,
} from "./timeline-playback-model";
import type {
  AudioPlacement,
  TimelinePlayback,
} from "./timeline-playback-model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudioApi } from "./api";
import type { ProjectSnapshot, Shot } from "./model";
import { Icon, IconButton, Preview, useArtifact } from "./components";
import { durationLabel } from "./model";
import type { AudioLibraryEntry } from "./AudioLibraryPanel";
import {
  timelineEditor,
  timelineMoveCommand,
  timelineNudgeCommand,
  timelineDurationFrames,
  timelineDurationCommand,
  timelineMusicStart,
  timelineMusicSpan,
  timelineMusicCommand,
} from "./timeline-editor-model";
import type { TimelineCommand } from "./timeline-editor-model";
import type { DragEvent } from "react";
import "./timeline-editor.css";
import { UiButton } from "./ui";
interface TimelineProps {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  active?: boolean;
  selectedShotId?: string | null;
  onSelectShot?(id: string): void;
  command?(body: Record<string, unknown>): void | Promise<void>;
  disabled?: boolean;
  onEditShot?(id: string): void;
  onImportAudio?(): void;
}
export function Timeline(props: TimelineProps) {
  return props.active === false ? null : <TimelineWorkspace {...props} />;
}
function TimelineWorkspace({
  api,
  snapshot,
  selectedShotId,
  onSelectShot,
  command,
  disabled = true,
  onEditShot,
  onImportAudio,
}: TimelineProps) {
  const { t, ui } = useTranslation();

  const [localSelection, setLocalSelection] = useState<string | null>(null),
    [collapsed, setCollapsed] = useState(false),
    [zoom, setZoom] = useState(1),
    [editError, setEditError] = useState("");
  const [sending, setSending] = useState(false),
    [trackViewportWidth, setTrackViewportWidth] = useState(660);
  const trackViewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = trackViewport.current;
    if (!element) return;
    const measure = () =>
      setTrackViewportWidth(Math.max(0, element.clientWidth - 24));
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [collapsed, snapshot.project.id, snapshot.project.shots.length]);
  const sendingNow = useRef(false),
    drag = useRef<{
      id: string;
      projectId: string;
      headVersion: number;
    } | null>(null);
  const locked = disabled || !command || sending;
  const send = useCallback(
    (body: TimelineCommand | null) => {
      if (!body || disabled || !command || sendingNow.current) return;
      sendingNow.current = true;
      setSending(true);
      setEditError("");
      void Promise.resolve()
        .then(() => command(body))
        .catch((error) =>
          setEditError(
            error instanceof Error
              ? error.message
              : t(
                  "The edit did not finish. Check the conversation state.",
                  "修改未完成，请检查对话中的状态。",
                ),
          ),
        )
        .finally(() => {
          sendingNow.current = false;
          setSending(false);
        });
    },
    [command, disabled],
  );
  const [playback, setPlayback] = useState<TimelinePlayback | null>(null),
    [audioUrls, setAudioUrls] = useState<Record<string, string>>({}),
    [audioError, setAudioError] = useState(""),
    [audioLoading, setAudioLoading] = useState(false);
  const audioElements = useRef(new Map<string, HTMLAudioElement>()),
    playbackEpoch = useRef(0),
    audioCache = useRef<TimelineAudioCache | null>(null);
  const [audioRetry, setAudioRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(),
      epoch = ++playbackEpoch.current;
    setPlayback(null);
    setAudioUrls({});
    setAudioError("");
    setAudioLoading(true);
    setPlaying(false);
    for (const el of audioElements.current.values()) el.pause();
    const cache = new TimelineAudioCache(
      (placement, signal) =>
        api.narrationAudio(
          snapshot.project.id,
          placement.audioId,
          placement.sha256,
          signal,
        ),
      URL.revokeObjectURL,
      (urls, error) => {
        if (!abort.signal.aborted && epoch === playbackEpoch.current) {
          setAudioUrls(urls);
          setAudioError(error);
          if (error) setPlaying(false);
        }
      },
    );
    audioCache.current = cache;
    void api
      .request<TimelinePlayback>(
        `/api/projects/${encodeURIComponent(snapshot.project.id)}/narration/playback`,
        { signal: abort.signal },
      )
      .then((view) => {
        if (abort.signal.aborted || epoch !== playbackEpoch.current) return;
        if (!currentPlayback(view, snapshot.project))
          throw Error(
            t(
              "Timeline changed. Refresh the project before playback.",
              "时间线已更新，请刷新项目后再播放。",
            ),
          );
        setPlayback(view);
        setAudioLoading(false);
      })
      .catch((cause) => {
        if (!abort.signal.aborted && epoch === playbackEpoch.current) {
          setAudioError(
            cause instanceof Error
              ? cause.message
              : t("Audio could not be loaded.", "音频无法载入。"),
          );
          setAudioLoading(false);
        }
      });
    return () => {
      abort.abort();
      ++playbackEpoch.current;
      for (const el of audioElements.current.values()) el.pause();
      cache.close();
      if (audioCache.current === cache) audioCache.current = null;
    };
  }, [
    api,
    snapshot.project.id,
    snapshot.project.headVersion,
    snapshot.project.revisionId,
  ]);
  const placements: AudioPlacement[] = currentPlayback(
    playback,
    snapshot.project,
  )
    ? [
        ...playback!.placements,
        ...(playback!.soundtrack ? [playback!.soundtrack] : []),
      ]
    : [];
  const editor = useMemo(() => timelineEditor(snapshot), [snapshot]);
  const shots = editor.clips.map((clip) => clip.result.shot);
  const [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [showRender, setShowRender] = useState(false);
  const controlVersion = useRef(0),
    playingNow = useRef(false);
  const total = shots.reduce((n, s) => n + s.desiredFrames / 30, 0),
    video = useRef<HTMLVideoElement>(null),
    lastTick = useRef(0);
  const assignVideo = useCallback((element: HTMLVideoElement | null) => {
    if (!element) video.current?.pause();
    video.current = element;
  }, []);
  const clips = editor.clips.map((clip) => ({
    ...clip,
    shot: clip.result.shot,
    at: clip.startFrame / 30,
    end: clip.endFrame / 30,
  }));
  const current =
    clips.find((c) => position >= c.at && position < c.end) ?? clips.at(-1);
  const media = current
    ? {
        video:
          current.result.video.current && current.result.video.artifact
            ? current.result.video
            : null,
        image: current.result.keyframe.artifact
          ? current.result.keyframe
          : null,
      }
    : null;
  const selected =
    clips.find((clip) => clip.shot.id === (selectedShotId ?? localSelection)) ??
    current;
  useEffect(() => {
    const clip = editor.clips.find(
      (clip) => clip.result.shot.id === selectedShotId,
    );
    if (clip) {
      ++controlVersion.current;
      setPlaying(false);
      setPosition(clip.startFrame / 30);
    }
  }, [selectedShotId, snapshot.project.id]);
  const clip = useArtifact(
      api,
      snapshot.project.id,
      media?.video?.artifact ?? null,
    ),
    still = useArtifact(
      api,
      snapshot.project.id,
      media?.image?.artifact ?? null,
    );
  const [failedVideo, setFailedVideo] = useState<string | null>(null);
  const playableVideo = clip.url && clip.url !== failedVideo;
  const neededAudio = audioWindow(placements, position),
    neededKeys = [...new Set(neededAudio.map(audioKey))].join(",");
  useEffect(() => {
    audioCache.current?.select(neededAudio);
  }, [neededKeys, audioRetry]);
  const audioBuffering = placements.some(
    (placement) =>
      audioAt(placement, position).active && !audioUrls[audioKey(placement)],
  );
  const buffering =
      audioLoading ||
      audioBuffering ||
      !!(media?.video
        ? !clip.url && !clip.error
        : media?.image
          ? !still.url && !still.error
          : false),
    buffered = useRef(false);
  buffered.current = buffering;
  playingNow.current = playing && !buffering;
  useEffect(() => {
    setPlaying(false);
    const selected = editor.clips.find(
      (clip) => clip.result.shot.id === (selectedShotId ?? localSelection),
    );
    setPosition((selected?.startFrame ?? 0) / 30);
  }, [snapshot.project.id, snapshot.project.headVersion]);
  useEffect(() => {
    if (!playing) {
      video.current?.pause();
      return;
    }
    lastTick.current = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        delta = (now - lastTick.current) / 1000;
      lastTick.current = now;
      if (buffered.current) return;
      setPosition((value) => {
        const next = Math.min(total, value + delta);
        if (next >= total) setPlaying(false);
        return next;
      });
    }, 33);
    return () => clearInterval(timer);
  }, [playing, total]);
  const playVideo = (el: HTMLVideoElement) => {
    const epoch = playbackEpoch.current,
      control = controlVersion.current;
    void el.play().catch(() => {
      if (
        epoch === playbackEpoch.current &&
        control === controlVersion.current &&
        video.current === el
      )
        setPlaying(false);
    });
  };
  useEffect(() => {
    const el = video.current;
    if (!el || !clip.url) return;
    el.currentTime = Math.max(0, position - (current?.at ?? 0));
    if (playing) playVideo(el);
  }, [clip.url, playing]);
  useEffect(() => {
    const epoch = playbackEpoch.current,
      control = controlVersion.current;
    for (const placement of placements) {
      const el = audioElements.current.get(placement.id);
      if (!el) continue;
      const pending = syncAudio(
        el,
        placement,
        position,
        playing && !audioLoading && !audioError && !buffering,
      );
      if (pending)
        void pending.catch(() => {
          if (
            epoch === playbackEpoch.current &&
            control === controlVersion.current
          ) {
            setPlaying(false);
            setAudioError(
              t(
                "Audio playback was blocked. Press play to try again.",
                "音频播放被阻止，请再次点击播放。",
              ),
            );
          }
        });
    }
    if (video.current && clip.url) {
      const at = Math.max(0, position - (current?.at ?? 0));
      if (Math.abs(video.current.currentTime - at) > 0.2)
        video.current.currentTime = at;
      if (!playing || buffering) video.current.pause();
    }
  }, [
    position,
    playing,
    audioLoading,
    audioError,
    audioUrls,
    clip.url,
    current?.at,
    buffering,
  ]);
  useEffect(() => {
    if (!playing || buffering || audioLoading || audioError) return;
    const epoch = playbackEpoch.current,
      control = controlVersion.current,
      cancellations: Array<() => void> = [];
    for (const placement of neededAudio) {
      const el = audioElements.current.get(placement.id);
      if (!el || !audioUrls[audioKey(placement)]) continue;
      cancellations.push(
        scheduleAudioStart(
          el,
          placement,
          position,
          () =>
            epoch === playbackEpoch.current &&
            control === controlVersion.current &&
            playingNow.current &&
            !buffered.current &&
            audioElements.current.get(placement.id) === el,
          () => {
            setPlaying(false);
            setAudioError(
              t(
                "Audio playback was blocked. Press play to try again.",
                "音频播放被阻止，请再次点击播放。",
              ),
            );
          },
        ),
      );
    }
    return () => cancellations.forEach((cancel) => cancel());
  }, [
    position,
    playing,
    buffering,
    audioLoading,
    audioError,
    audioUrls,
    neededKeys,
  ]);
  const seek = (at: number) => {
    ++controlVersion.current;
    setPosition(at);
    if (video.current)
      video.current.currentTime = Math.max(
        0,
        at -
          ((clips.find((c) => at >= c.at && at < c.end) ?? clips.at(-1))?.at ??
            0),
      );
  };
  if (!shots.length)
    return (
      <div className="empty-storyboard">
        <h3>
          {t(
            "The timeline starts with the first shot.",
            "时间线从第一个镜头开始。",
          )}
        </h3>
        <p>
          {t(
            "Develop scenes and shots in the conversation.",
            "在对话里完善场景和镜头。",
          )}
        </p>
      </div>
    );
  const choose = (id: string, at: number) => {
    setLocalSelection(id);
    onSelectShot?.(id);
    setPlaying(false);
    seek(at);
  };
  const drop = (targetId: string, edge: "before" | "after") => {
    const captured = drag.current;
    drag.current = null;
    if (locked || !captured) return;
    if (
      captured.projectId !== snapshot.project.id ||
      captured.headVersion !== snapshot.project.headVersion
    ) {
      setEditError(
        t(
          "The project changed. Drag again using the current order.",
          "项目已更新，请按当前顺序重新拖动。",
        ),
      );
      return;
    }
    send(
      timelineMoveCommand(
        snapshot,
        captured.id,
        targetId,
        edge,
        captured.headVersion,
      ),
    );
  };
  const marks = Math.min(20, Math.max(2, Math.ceil(total / 5)));
  return (
    <section
      className="film-timeline timeline-editor"
      aria-label={t("Timeline", "时间线")}
    >
      <div className="timeline-player">
        {playableVideo ? (
          <video
            ref={assignVideo}
            src={clip.url ?? undefined}
            poster={still.url ?? undefined}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => {
              const el = event.currentTarget;
              if (el !== video.current || el.currentSrc !== clip.url) return;
              el.currentTime = Math.max(0, position - (current?.at ?? 0));
              if (playing) playVideo(el);
            }}
            onError={(event) => {
              if (event.currentTarget !== video.current) return;
              setFailedVideo(clip.url);
              setPlaying(false);
              setEditError(
                t(
                  "Video cannot play. You can inspect the saved keyframe.",
                  "视频无法播放；可查看已保存的关键帧。",
                ),
              );
            }}
            aria-label={t("Timeline picture preview", "时间线画面预览")}
          />
        ) : still.url ? (
          <img src={still.url} alt={current?.shot.purpose} />
        ) : (
          <div className="timeline-missing">
            <Icon name="image" size={34} />
            <p>
              {clip.error || still.error
                ? t("Media temporarily unavailable", "媒体暂时无法读取")
                : t("This shot has no picture yet.", "这个镜头还没有画面")}
            </p>
          </div>
        )}
        <span className="timeline-player-label">
          {" "}
          {t("Shot", "镜头")} {current?.result.label} ·{" "}
          {playableVideo
            ? media?.video?.fixture === true
              ? t("Demo video", "演示视频")
              : t("Current video", "当前视频")
            : still.url
              ? media?.image?.current
                ? media.image.fixture === true
                  ? t("Demo keyframe · {v0}", "演示关键帧 · {v0}", {
                      v0: media?.video
                        ? clip.error || failedVideo === clip.url
                          ? t("Video unavailable", "视频暂不可用")
                          : t("Loading video", "视频读取中")
                        : t("Video not generated", "视频待生成"),
                    })
                  : t("Current keyframe · {v0}", "当前关键帧 · {v0}", {
                      v0: media?.video
                        ? clip.error || failedVideo === clip.url
                          ? t("Video unavailable", "视频暂不可用")
                          : t("Loading video", "视频读取中")
                        : t("Video not generated", "视频待生成"),
                    })
                : t(
                    "Earlier keyframe · current picture needs an update",
                    "早期关键帧 · 当前画面待更新",
                  )
              : buffering
                ? t("Loading media", "正在读取媒体")
                : t("Picture not generated", "画面待生成")}
        </span>
      </div>
      <div className="timeline-transport">
        <IconButton
          icon="refresh"
          label={t("Back to start", "返回起点")}
          onClick={() => seek(0)}
        />
        <IconButton
          icon={playing ? "pause" : "play"}
          label={
            playing
              ? t("Pause timeline preview", "暂停时间线预览")
              : t("Play timeline preview", "播放时间线预览")
          }
          disabled={audioLoading}
          onClick={() => {
            ++controlVersion.current;
            if (position >= total) seek(0);
            if (audioError) {
              audioCache.current?.retry();
              setAudioRetry((value) => value + 1);
              setAudioError("");
            }
            setPlaying((value) => !value);
          }}
        />
        <span className="timeline-time">
          {durationLabel(position * 30)} / {durationLabel(total * 30)}
        </span>
        <small>
          {audioLoading
            ? t("Loading sound", "正在读取声音")
            : buffering
              ? t("Loading picture", "正在读取画面")
              : placements.length
                ? playback?.soundtrack
                  ? playback.placements.length
                    ? t("Picture + narration + music", "画面 + 旁白 + 配乐")
                    : t("Picture + music", "画面 + 配乐")
                  : t("Picture + narration", "画面 + 旁白")
                : t("No accepted audio", "没有已确认的音频")}
        </small>
        <UiButton
          variant="ghost"
          onClick={() => {
            ++controlVersion.current;
            setPlaying(false);
            setShowRender((value) => !value);
          }}
        >
          {showRender
            ? t("Hide export preview", "收起导出预览")
            : t("Export preview", "导出预览")}
        </UiButton>
      </div>
      {audioError && (
        <p className="narration-feedback error" role="alert">
          {ui(audioError, workbenchCopy)}
        </p>
      )}
      {editError && (
        <p className="inline-error" role="alert">
          {ui(editError, workbenchCopy)}
        </p>
      )}
      {neededAudio.map((placement) => (
        <TimelineAudio
          key={`${snapshot.project.revisionId}:${placement.id}`}
          id={placement.id}
          url={audioUrls[audioKey(placement)]}
          elements={audioElements.current}
        />
      ))}
      <div className="timeline-editor-toolbar">
        <div>
          <Icon name="timeline" size={17} />
          <strong>{t("Timeline", "时间线")}</strong>
          <span>
            {t(
              shots.length === 1 ? "{count} shot" : "{count} shots",
              "{count} 个镜头",
              { count: shots.length },
            )}
          </span>
        </div>
        <div className="timeline-view-controls">
          <label>
            {" "}
            {t("Zoom", "缩放")}{" "}
            <input
              type="range"
              aria-label={t("Timeline zoom", "时间线缩放")}
              min="1"
              max="3"
              step="0.25"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
          >
            {collapsed ? t("Expand", "展开") : t("Collapse", "收起")}
            <Icon name="chevron-down" size={14} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="timeline-editor-board">
          <div className="timeline-scroll" ref={trackViewport}>
            <div
              className="timeline-tracks"
              style={{ minWidth: `${Math.max(660, total * 32 * zoom)}px` }}
            >
              <div className="timeline-scenes">
                {editor.groups
                  .filter((group) => group.endFrame > group.startFrame)
                  .map((group) => (
                    <span
                      key={group.id}
                      title={group.purpose}
                      style={{
                        width: `${((group.endFrame - group.startFrame) / editor.totalFrames) * 100}%`,
                      }}
                    >
                      {ui(
                        hierarchyUiLabel(group.label, "scene", t),
                        workbenchCopy,
                      )}{" "}
                      · {group.purpose}
                    </span>
                  ))}
              </div>
              <div className="timeline-ruler">
                {Array.from({ length: marks + 1 }, (_, index) => (
                  <span
                    key={index}
                    style={{ left: `${(index / marks) * 100}%` }}
                  >
                    {((total * index) / marks).toFixed(1)}s
                  </span>
                ))}
              </div>
              <input
                type="range"
                aria-label={t("Timeline playhead", "时间线播放位置")}
                min={0}
                max={total}
                step={1 / 30}
                value={position}
                onChange={(event) => seek(Number(event.target.value))}
              />
              <div className="timeline-lane">
                <span>{t("Frame", "画面")}</span>
                <div>
                  {clips.map(({ shot, at, result }) => (
                    <TimelineClip
                      key={shot.id}
                      api={api}
                      snapshot={snapshot}
                      shot={shot}
                      result={result}
                      active={shot.id === current?.shot.id}
                      selected={shot.id === selected?.shot.id}
                      disabled={locked}
                      select={() => choose(shot.id, at)}
                      dragStart={() => {
                        drag.current = {
                          id: shot.id,
                          projectId: snapshot.project.id,
                          headVersion: snapshot.project.headVersion,
                        };
                      }}
                      dragEnd={() => {
                        drag.current = null;
                      }}
                      drop={(edge) => drop(shot.id, edge)}
                      nudge={(direction) =>
                        send(timelineNudgeCommand(snapshot, shot.id, direction))
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="timeline-lane">
                <span>{t("Narration", "旁白")}</span>
                <div>
                  {shots.map((shot) => (
                    <div
                      key={shot.id}
                      className={`timeline-voice ${shot.narration?.text ? "script" : ""}`}
                      style={{ flex: shot.desiredFrames }}
                      title={
                        shot.narration?.text ||
                        t("No shot script", "没有镜头文稿")
                      }
                    >
                      {shot.narration?.mode === "generated"
                        ? `${shot.narrationPending ? t("Script", "文稿") : t("Narration", "旁白")} · ${shot.narration.text || t("Not written", "待写")}`
                        : shot.cueId
                          ? t("Saved narration", "已保存旁白")
                          : ""}
                    </div>
                  ))}
                </div>
              </div>
              <TimelineMusic
                api={api}
                snapshot={snapshot}
                totalFrames={editor.totalFrames}
                placement={
                  currentPlayback(playback, snapshot.project)
                    ? (playback?.soundtrack ?? null)
                    : null
                }
                disabled={locked}
                send={send}
              />
              <div
                className="timeline-playhead"
                aria-hidden="true"
                style={{
                  left: `calc(58px + ${total ? (position / total) * 100 : 0}% - ${total ? (position / total) * 58 : 0}px)`,
                }}
              />
            </div>
          </div>
        </div>
      )}
      {selected && (
        <div className="timeline-selection-tools">
          <div className="timeline-selected-copy">
            <strong>
              {t("Shot", "镜头")} {selected.result.label}
            </strong>
            <span>{selected.shot.purpose}</span>
          </div>
          <TimelineDuration
            key={`${snapshot.project.id}:${selected.shot.id}`}
            snapshot={snapshot}
            shot={selected.shot}
            disabled={locked}
            send={send}
          />
          {onEditShot && (
            <UiButton
              disabled={disabled}
              onClick={() => onEditShot(selected.shot.id)}
            >
              <Icon name="edit" size={15} /> {t("Edit shot", "编辑镜头")}{" "}
            </UiButton>
          )}
          {onImportAudio && (
            <UiButton disabled={disabled} onClick={onImportAudio}>
              <Icon name="volume" size={15} />{" "}
              {t("Import music", "导入配乐")}{" "}
            </UiButton>
          )}
        </div>
      )}
      {showRender && <Preview api={api} snapshot={snapshot} />}
    </section>
  );
}

function TimelineClip({
  api,
  snapshot,
  shot,
  result,
  active,
  selected,
  disabled,
  select,
  dragStart,
  dragEnd,
  drop,
  nudge,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  shot: Shot;
  result: import("./project-results-model").ResultShot;
  active: boolean;
  selected: boolean;
  disabled: boolean;
  select(): void;
  dragStart(): void;
  dragEnd(): void;
  drop(edge: "before" | "after"): void;
  nudge(direction: -1 | 1): void;
}) {
  const { t, ui } = useTranslation();

  const image = useArtifact(api, snapshot.project.id, result.keyframe.artifact);
  const [edge, setEdge] = useState<"before" | "after" | null>(null);
  const peers = snapshot.project.shots.filter(
      (peer) => peer.sceneId === shot.sceneId,
    ),
    index = peers.findIndex((peer) => peer.id === shot.id);
  const position = (event: DragEvent) =>
    event.clientX <
    event.currentTarget.getBoundingClientRect().left +
      event.currentTarget.getBoundingClientRect().width / 2
      ? "before"
      : "after";
  return (
    <div
      className={`timeline-clip-wrap ${selected ? "selected" : ""} ${active ? "playing" : ""} ${edge ? `drop-${edge}` : ""}`}
      style={{ flex: shot.desiredFrames }}
      onDragOver={(event) => {
        if (
          !disabled &&
          event.dataTransfer.types.includes("application/x-openslate-shot")
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setEdge(position(event));
        }
      }}
      onDragLeave={() => setEdge(null)}
      onDrop={(event) => {
        event.preventDefault();
        const side = position(event);
        setEdge(null);
        if (!disabled) drop(side);
      }}
    >
      <button
        type="button"
        className={`timeline-clip ${active ? "active" : ""}`}
        style={
          image.url ? { backgroundImage: `url("${image.url}")` } : undefined
        }
        onClick={select}
        draggable={!disabled}
        onDragStart={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData("application/x-openslate-shot", shot.id);
          event.dataTransfer.effectAllowed = "move";
          dragStart();
        }}
        onDragEnd={dragEnd}
        aria-label={t("Select Shot {v0}", "选择镜头 {v0}", {
          v0: result.label,
        })}
        aria-pressed={selected}
        title={shot.purpose}
        onKeyDown={(event) => {
          if (
            !disabled &&
            event.altKey &&
            ["ArrowLeft", "ArrowRight"].includes(event.key)
          ) {
            event.preventDefault();
            nudge(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <strong>
          {result.label} · {shot.purpose}
        </strong>
        <small>
          {result.video.current
            ? result.video.fixture === true
              ? t("Demo video", "演示视频")
              : t("Current video", "当前视频")
            : result.keyframe.current
              ? result.keyframe.fixture === true
                ? t("Demo keyframe", "演示关键帧")
                : t("Current keyframe", "当前关键帧")
              : result.keyframe.artifact
                ? t("Earlier keyframe", "早期关键帧")
                : t("Not generated", "待生成")}{" "}
          · {durationLabel(shot.desiredFrames)}
        </small>
      </button>
      {selected && (
        <div className="timeline-order-actions">
          <button
            type="button"
            disabled={disabled || index <= 0}
            onClick={() => nudge(-1)}
            aria-label={t("Move Shot {v0} earlier", "向前移动镜头 {v0}", {
              v0: result.label,
            })}
          >
            <Icon name="chevron" size={13} />
          </button>
          <button
            type="button"
            disabled={disabled || index >= peers.length - 1}
            onClick={() => nudge(1)}
            aria-label={t("Move Shot {v0} later", "向后移动镜头 {v0}", {
              v0: result.label,
            })}
          >
            <Icon name="chevron" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
function TimelineDuration({
  snapshot,
  shot,
  disabled,
  send,
}: {
  snapshot: ProjectSnapshot;
  shot: Shot;
  disabled: boolean;
  send(body: TimelineCommand | null): void;
}) {
  const { t, ui } = useTranslation();

  const [draft, setDraft] = useState(String(shot.desiredFrames / 30)),
    [error, setError] = useState("");
  const base = useRef(snapshot.project.headVersion),
    editing = useRef(false);
  useEffect(() => {
    if (!editing.current) {
      setDraft(String(shot.desiredFrames / 30));
      base.current = snapshot.project.headVersion;
    }
  }, [shot.desiredFrames, snapshot.project.headVersion]);
  return (
    <form
      className="timeline-duration"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        if (base.current !== snapshot.project.headVersion) {
          setError(
            t(
              "The project changed. Enter the current duration again.",
              "项目已更新，请重新输入当前时长。",
            ),
          );
          return;
        }
        if (timelineDurationFrames(draft) === null) {
          setError(
            t("Each shot must be 3–15 seconds.", "每个镜头需要 3–15 秒。"),
          );
          return;
        }
        const body = timelineDurationCommand(
          snapshot,
          shot.id,
          draft,
          base.current,
        );
        editing.current = false;
        setError("");
        send(body);
      }}
    >
      <label>
        {" "}
        {t("Planned duration", "计划时长")}{" "}
        <input
          aria-label={t(
            "Planned duration for Shot {v0} in seconds",
            "镜头 {v0} 的计划时长（秒）",
            { v0: shot.id },
          )}
          type="number"
          min="3"
          max="15"
          step="0.1"
          value={draft}
          disabled={disabled}
          onFocus={() => {
            if (!editing.current) base.current = snapshot.project.headVersion;
            editing.current = true;
          }}
          onChange={(event) => {
            editing.current = true;
            setDraft(event.target.value);
            setError("");
          }}
        />
        <span>{t("Seconds", "秒")}</span>
      </label>
      <UiButton
        type="submit"
        disabled={
          disabled || timelineDurationFrames(draft) === shot.desiredFrames
        }
      >
        {" "}
        {t("Save duration", "保存时长")}{" "}
      </UiButton>
      <small>
        {t(
          "This is the planned shot duration. Existing video may need an update.",
          "这是镜头计划时长；已有视频可能需要更新。",
        )}
      </small>
      {error && (
        <p role="alert" className="inline-error">
          {ui(error, workbenchCopy)}
          <button
            type="button"
            onClick={() => {
              setDraft(String(shot.desiredFrames / 30));
              base.current = snapshot.project.headVersion;
              editing.current = false;
              setError("");
            }}
          >
            {" "}
            {t("Restore current duration", "恢复当前时长")}{" "}
          </button>
        </p>
      )}
    </form>
  );
}
function TimelineMusic({
  api,
  snapshot,
  totalFrames,
  placement,
  disabled,
  send,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  totalFrames: number;
  placement: AudioPlacement | null;
  disabled: boolean;
  send(body: TimelineCommand | null): void;
}) {
  const { t, ui } = useTranslation();

  const soundtrack = snapshot.project.soundtrack as
    | (NonNullable<ProjectSnapshot["project"]["soundtrack"]> & {
        startFrame?: number;
        muted?: boolean;
      })
    | null
    | undefined;
  const [recording, setRecording] = useState<AudioLibraryEntry | null>(null),
    [error, setError] = useState(""),
    [dragFrame, setDragFrame] = useState<number | null>(null),
    [gain, setGain] = useState(soundtrack?.gainMilliDb ?? -18000);
  const track = useRef<HTMLDivElement>(null),
    drag = useRef<{
      x: number;
      frame: number;
      width: number;
      head: number;
      projectId: string;
      pointerId: number;
    } | null>(null),
    gainHead = useRef(snapshot.project.headVersion);
  useEffect(() => {
    const abort = new AbortController();
    setRecording(null);
    setError("");
    if (soundtrack)
      void api
        .request<{ recordings: AudioLibraryEntry[] }>(
          `/api/projects/${encodeURIComponent(snapshot.project.id)}/audio-library`,
          { signal: abort.signal },
        )
        .then((value) => {
          if (!abort.signal.aborted)
            setRecording(
              value.recordings.find(
                (recording) => recording.id === soundtrack.audioId,
              ) ?? null,
            );
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setError(
              t(
                "Music information could not be loaded.",
                "配乐信息暂时无法读取。",
              ),
            );
        });
    return () => abort.abort();
  }, [api, snapshot.project.id, soundtrack?.audioId]);
  useEffect(() => {
    drag.current = null;
    setDragFrame(null);
    setGain(soundtrack?.gainMilliDb ?? -18000);
    gainHead.current = snapshot.project.headVersion;
  }, [
    snapshot.project.id,
    snapshot.project.headVersion,
    soundtrack?.gainMilliDb,
    soundtrack?.startFrame,
  ]);
  const startFrame = soundtrack?.startFrame ?? 0,
    sourceFrames =
      recording && Number.isFinite(recording.durationSeconds)
        ? Math.round(recording.durationSeconds * 30)
        : placement
          ? Math.round(placement.durationSamples / 1600)
          : null;
  const span = timelineMusicSpan(
    dragFrame ?? startFrame,
    sourceFrames,
    totalFrames,
  );
  const saveGain = () => {
    if (!disabled)
      send(
        timelineMusicCommand(snapshot, "gainMilliDb", gain, gainHead.current),
      );
  };
  const cancel = () => {
    drag.current = null;
    setDragFrame(null);
  };
  return (
    <div className="timeline-music-editor">
      <div className="timeline-lane">
        <span>{t("Music", "配乐")}</span>
        <div ref={track} className="timeline-music-track">
          {soundtrack ? (
            <div
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={t("Music start", "配乐起点")}
              aria-valuemin={0}
              aria-valuemax={Math.max(0, (totalFrames - 1) / 30)}
              aria-valuenow={(dragFrame ?? startFrame) / 30}
              aria-valuetext={t("{v0} seconds", "{v0} 秒", {
                v0: ((dragFrame ?? startFrame) / 30).toFixed(1),
              })}
              aria-disabled={disabled}
              className={`timeline-music-clip ${soundtrack.muted ? "muted" : ""} ${span.width === null ? "duration-unknown" : ""}`}
              style={{
                left: `${span.left}%`,
                ...(span.width !== null ? { width: `${span.width}%` } : {}),
              }}
              title={recording?.label || t("Saved music", "已保存配乐")}
              onPointerDown={(event) => {
                if (disabled || event.button !== 0 || !track.current) return;
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {
                  x: event.clientX,
                  frame: startFrame,
                  width: track.current.getBoundingClientRect().width,
                  head: snapshot.project.headVersion,
                  projectId: snapshot.project.id,
                  pointerId: event.pointerId,
                };
                setDragFrame(startFrame);
              }}
              onPointerMove={(event) => {
                const captured = drag.current;
                if (captured && captured.pointerId === event.pointerId)
                  setDragFrame(
                    timelineMusicStart(
                      captured.frame,
                      event.clientX - captured.x,
                      captured.width,
                      totalFrames,
                    ),
                  );
              }}
              onPointerUp={(event) => {
                const captured = drag.current;
                cancel();
                if (
                  !captured ||
                  disabled ||
                  captured.projectId !== snapshot.project.id
                )
                  return;
                send(
                  timelineMusicCommand(
                    snapshot,
                    "startFrame",
                    timelineMusicStart(
                      captured.frame,
                      event.clientX - captured.x,
                      captured.width,
                      totalFrames,
                    ),
                    captured.head,
                  ),
                );
              }}
              onPointerCancel={cancel}
              onKeyDown={(event) => {
                if (
                  disabled ||
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const frame =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? totalFrames - 1
                      : Math.max(
                          0,
                          Math.min(
                            totalFrames - 1,
                            startFrame +
                              (event.key === "ArrowLeft" ? -1 : 1) *
                                (event.shiftKey ? 1 : 30),
                          ),
                        );
                send(
                  timelineMusicCommand(
                    snapshot,
                    "startFrame",
                    frame,
                    snapshot.project.headVersion,
                  ),
                );
              }}
            >
              <strong>
                <Icon name="volume" size={13} />
                {recording?.label || t("Saved music", "已保存配乐")}
              </strong>
              <small>
                {soundtrack.muted
                  ? t("Muted", "已静音")
                  : t("Starts at {v0}s", "{v0}s 开始", {
                      v0: ((dragFrame ?? startFrame) / 30).toFixed(1),
                    })}
                {span.width === null
                  ? t(" · duration loading", " · 长度待读取")
                  : ""}
              </small>
            </div>
          ) : (
            <span className="timeline-empty-music">
              {t("No music added", "未添加配乐")}
            </span>
          )}
        </div>
      </div>
      {soundtrack && (
        <div className="timeline-music-controls">
          <label>
            {" "}
            {t("Volume", "音量")}{" "}
            <input
              type="range"
              aria-label={t("Music volume", "配乐音量")}
              min="-60000"
              max="0"
              step="1000"
              value={gain}
              disabled={disabled}
              onPointerDown={() => {
                gainHead.current = snapshot.project.headVersion;
              }}
              onFocus={() => {
                gainHead.current = snapshot.project.headVersion;
              }}
              onChange={(event) => setGain(Number(event.target.value))}
              onPointerUp={saveGain}
              onKeyUp={(event) => {
                if (
                  [
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                  ].includes(event.key)
                )
                  saveGain();
              }}
            />
            <span>{gain / 1000} dB</span>
          </label>
          <label className="timeline-mute">
            <input
              type="checkbox"
              checked={soundtrack.muted ?? false}
              disabled={disabled}
              onChange={(event) =>
                send(
                  timelineMusicCommand(
                    snapshot,
                    "muted",
                    event.target.checked,
                    snapshot.project.headVersion,
                  ),
                )
              }
            />{" "}
            {t("Mute", "静音")}{" "}
          </label>
          {startFrame >= totalFrames && (
            <>
              <small>
                {t(
                  "Music starts outside the current film.",
                  "配乐起点在当前影片之外。",
                )}
              </small>
              <UiButton
                disabled={disabled}
                onClick={() =>
                  send(
                    timelineMusicCommand(
                      snapshot,
                      "startFrame",
                      0,
                      snapshot.project.headVersion,
                    ),
                  )
                }
              >
                {" "}
                {t("Move to film start", "移至影片起点")}{" "}
              </UiButton>
            </>
          )}
          <small>
            {t(
              "Drag music to change its start, or use left and right arrow keys.",
              "拖动配乐调整起点，或使用左右方向键。",
            )}
          </small>
        </div>
      )}
      {error && (
        <p role="status" className="field-help">
          {ui(error, workbenchCopy)}
        </p>
      )}
    </div>
  );
}

function TimelineAudio({
  id,
  url,
  elements,
}: {
  id: string;
  url: string | undefined;
  elements: Map<string, HTMLAudioElement>;
}) {
  const assign = useCallback(
    (element: HTMLAudioElement | null) => {
      if (element) elements.set(id, element);
      else {
        elements.get(id)?.pause();
        elements.delete(id);
      }
    },
    [id, elements],
  );
  return (
    <audio ref={assign} src={url} preload="auto" hidden aria-hidden="true" />
  );
}
