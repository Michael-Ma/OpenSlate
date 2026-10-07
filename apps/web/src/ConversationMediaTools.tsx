import { useTranslation } from "./Locale";
import { settingsUiTranslations } from "./settings-ui-translations";
import { useEffect, useId, useState } from "react";
import type { StudioApi } from "./api";
import type { Artifact, ProjectSnapshot } from "./model";
import { previewOutput } from "./model";
import type { AudioLibraryEntry } from "./AudioLibraryPanel";
import type { BoardCommand } from "./InlineField";
import { errorText, useArtifact } from "./components";
import { useProjectRefreshVersion } from "./project-updates";
import { UiButton, UiSelect, UiTextField } from "./ui";
import "./conversation-media-tools.css";

interface TimelineSettingsProps {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  disabled: boolean;
  command: BoardCommand;
  onImportAudio(): void;
}

/** Music changes belong to conversation tools; this surface never plays or previews media. */
export function TimelineSettings(props: TimelineSettingsProps) {
  return <MusicSettings key={props.snapshot.project.id} {...props} />;
}

function MusicSettings({
  api,
  snapshot,
  disabled,
  command,
  onImportAudio,
}: TimelineSettingsProps) {
  const { t, ui } = useTranslation();

  const projectId = snapshot.project.id,
    revision = useProjectRefreshVersion(),
    id = useId();
  const [recordings, setRecordings] = useState<AudioLibraryEntry[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api
      .request<{ recordings: AudioLibraryEntry[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/audio-library`,
        { signal: controller.signal },
      )
      .then((value) => {
        if (!controller.signal.aborted) setRecordings(value.recordings);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, projectId, revision, snapshot.project.headVersion]);
  const soundtrack = snapshot.project.soundtrack,
    locked = disabled || loading;
  const presets = [-30000, -24000, -18000, -12000, -6000, 0];
  const gainOptions =
    soundtrack && !presets.includes(soundtrack.gainMilliDb)
      ? [soundtrack.gainMilliDb, ...presets]
      : presets;
  return (
    <section
      className="conversation-media-tools"
      aria-label={t("Background music settings", "背景音乐设置")}
    >
      <div className="conversation-media-field">
        <label htmlFor={`${id}-music`}>
          {t("Background music", "背景音乐")}
        </label>
        <UiSelect
          id={`${id}-music`}
          value={soundtrack?.audioId ?? ""}
          disabled={locked}
          options={[
            { value: "", label: t("No background music", "无背景音乐") },
            ...(soundtrack &&
            !recordings.some((recording) => recording.id === soundtrack.audioId)
              ? [
                  {
                    value: soundtrack.audioId,
                    label: t("Saved background music", "已保存的背景音乐"),
                  },
                ]
              : []),
            ...recordings.map((recording, index) => ({
              value: recording.id,
              label: `${recording.label || t("Recording {number}", "录音 {number}", { number: index + 1 })} · ${recording.durationSeconds.toFixed(1)}s`,
            })),
          ]}
          onValueChange={(value) => {
            if (!locked)
              command({ kind: "soundtrack", field: "audioId", value });
          }}
        />
      </div>
      {soundtrack && (
        <div className="conversation-media-field">
          <label htmlFor={`${id}-gain`}>{t("Music gain", "配乐音量")}</label>
          <UiSelect
            id={`${id}-gain`}
            value={String(soundtrack.gainMilliDb)}
            disabled={locked}
            options={gainOptions.map((gain) => ({
              value: String(gain),
              label: `${gain / 1000} dB`,
            }))}
            onValueChange={(value) => {
              if (!locked)
                command({ kind: "soundtrack", field: "gainMilliDb", value });
            }}
          />
        </div>
      )}
      <UiButton disabled={disabled} onClick={onImportAudio}>
        {t("Import background music", "导入背景音乐")}
      </UiButton>
      <small className="conversation-media-note">
        {t(
          soundtrack?.muted
            ? "Muted · starts at {seconds}s · no looping"
            : "Starts at {seconds}s · trims to film length · no looping",
          soundtrack?.muted
            ? "已静音 · 从 {seconds} 秒开始 · 不循环"
            : "从 {seconds} 秒开始 · 按影片时长使用 · 不循环",
          { seconds: ((soundtrack?.startFrame ?? 0) / 30).toFixed(1) },
        )}
      </small>
      {loading && (
        <p role="status" className="field-help">
          {t("Loading saved recordings…", "正在读取已保存录音…")}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {ui(error, settingsUiTranslations)}
        </p>
      )}
    </section>
  );
}

interface SavedAsset {
  artifact: Artifact;
  label: string;
  source: string;
  fixture: boolean;
}
interface AssetPage {
  assets: SavedAsset[];
  total: number;
  offset: number;
  nextOffset: number | null;
}
interface AssetActionsProps {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  disabled: boolean;
  onDiscuss?(artifact: Artifact): void;
}

/** Saved assets are selected by immutable identity; their image/video display stays in results. */
export function AssetActions(props: AssetActionsProps) {
  return <SavedAssetActions key={props.snapshot.project.id} {...props} />;
}

function SavedAssetActions({
  api,
  snapshot,
  disabled,
  onDiscuss,
}: AssetActionsProps) {
  const { t, ui } = useTranslation();

  const projectId = snapshot.project.id,
    revision = useProjectRefreshVersion(),
    id = useId();
  const [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState<AssetPage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      kind: "all",
      source: "all",
      search,
      offset: String(offset),
    });
    void api
      .request<AssetPage>(
        `/api/projects/${encodeURIComponent(projectId)}/assets?${query}`,
        { signal: controller.signal },
      )
      .then((value) => {
        if (!controller.signal.aborted) {
          setPage(value);
          setSelectedId((current) =>
            value.assets.some((asset) => asset.artifact.artifactId === current)
              ? current
              : "",
          );
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    api,
    projectId,
    revision,
    snapshot.project.headVersion,
    search,
    offset,
    retry,
  ]);
  const selected = page?.assets.find(
    (asset) => asset.artifact.artifactId === selectedId,
  );
  const file = useArtifact(
    api,
    projectId,
    !loading && !error ? (selected?.artifact ?? null) : null,
  );
  const locked = disabled || loading || !!error;
  return (
    <section
      className="conversation-media-tools"
      aria-label={t("Saved asset actions", "已保存素材操作")}
    >
      <div className="conversation-media-field">
        <label htmlFor={`${id}-search`}>
          {t("Find a saved asset", "查找已保存素材")}
        </label>
        <UiTextField
          id={`${id}-search`}
          value={search}
          maxLength={160}
          placeholder={t(
            "Search saved images and videos…",
            "搜索已保存图片和视频…",
          )}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setOffset(0);
            setSelectedId("");
          }}
        />
      </div>
      <div className="conversation-media-field">
        <label htmlFor={`${id}-asset`}>{t("Saved asset", "已保存素材")}</label>
        <UiSelect
          id={`${id}-asset`}
          value={selectedId}
          disabled={locked || !page?.assets.length}
          options={[
            {
              value: "",
              label: loading
                ? t("Loading assets…", "正在读取素材…")
                : page?.assets.length
                  ? t("Choose an image or video", "选择图片或视频")
                  : t("No matching assets", "没有匹配素材"),
            },
            ...(page?.assets.map((asset) => ({
              value: asset.artifact.artifactId,
              label: `${asset.label} · ${ui(asset.artifact.kind, { image: "图片", video: "视频", audio: "音频", data: "数据" })}`,
            })) ?? []),
          ]}
          onValueChange={setSelectedId}
        />
      </div>
      {selected && (
        <>
          <small className="conversation-media-note">
            {ui(selected.source, {
              generated: "生成媒体",
              uploaded: "上传媒体",
              supplied: "导入媒体",
            })}
            {selected.fixture ? t(" · Demo fixture", " · 演示素材") : ""}
          </small>
          <div className="conversation-media-actions">
            {!locked && file.url ? (
              <a
                className="button small"
                href={file.url}
                download={`openslate-${selected.artifact.artifactId}.${selected.artifact.kind === "image" ? "png" : "mp4"}`}
              >
                {t("Download", "下载")}
              </a>
            ) : (
              <UiButton disabled>{t("Download", "下载")}</UiButton>
            )}
            {selected.artifact.kind === "image" && onDiscuss && (
              <UiButton
                disabled={locked}
                onClick={() => {
                  if (!locked) onDiscuss(selected.artifact);
                }}
              >
                {t("Discuss image", "讨论图片")}
              </UiButton>
            )}
          </div>
          {file.error && (
            <p role="alert" className="form-error">
              {ui(file.error, settingsUiTranslations)}
            </p>
          )}
          {!locked && !file.url && !file.error && (
            <p role="status" className="field-help">
              {t("Loading the selected file…", "正在读取选中的文件…")}
            </p>
          )}
        </>
      )}
      {loading && (
        <p role="status" className="field-help">
          {t("Loading saved assets…", "正在读取已保存素材…")}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {ui(error, settingsUiTranslations)}{" "}
          <UiButton
            variant="ghost"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Reload assets", "重新读取素材")}
          </UiButton>
        </p>
      )}
      {page && !loading && !error && (
        <div className="conversation-media-pages">
          <small>
            {page.total
              ? t(
                  "{first}–{last} of {total}",
                  "{first}–{last}／共 {total} 个",
                  {
                    first: page.offset + 1,
                    last: page.offset + page.assets.length,
                    total: page.total,
                  },
                )
              : t("0 assets", "0 个素材")}
          </small>
          {(offset > 0 || page.nextOffset !== null) && (
            <>
              <UiButton
                size="1"
                disabled={offset === 0}
                onClick={() => {
                  setOffset((value) => Math.max(0, value - 40));
                  setSelectedId("");
                }}
              >
                {t("Previous", "上一页")}
              </UiButton>
              <UiButton
                size="1"
                disabled={page.nextOffset === null}
                onClick={() => {
                  if (page.nextOffset !== null) {
                    setOffset(page.nextOffset);
                    setSelectedId("");
                  }
                }}
              >
                {t("Next", "下一页")}
              </UiButton>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Download the exact current or retained previous export without duplicating its video preview. */
export function ExportDownload({
  api,
  snapshot,
  disabled = false,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  disabled?: boolean;
}) {
  const { t, ui } = useTranslation();

  const output = previewOutput(snapshot),
    file = useArtifact(api, snapshot.project.id, output?.artifact ?? null);
  if (!output) return null;
  const label = output.previous
    ? t("Save previous export", "保存先前导出")
    : t("Save exported video", "保存导出视频");
  return (
    <div className="conversation-media-tools">
      {file.url && !disabled ? (
        <a
          className="button small"
          href={file.url}
          download={`openslate-${output.artifact.artifactId}.mp4`}
        >
          {label}
        </a>
      ) : (
        <UiButton disabled>{label}</UiButton>
      )}
      {file.error && (
        <p role="alert" className="form-error">
          {ui(file.error, settingsUiTranslations)}
        </p>
      )}
      {!file.url && !file.error && (
        <p role="status" className="field-help">
          {t("Loading the exported file…", "正在读取导出文件…")}
        </p>
      )}
    </div>
  );
}
