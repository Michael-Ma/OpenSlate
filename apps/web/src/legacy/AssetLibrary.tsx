import { useTranslation } from "./Locale";
import { workbenchCopy } from "./workbench-copy";
import { useEffect, useState } from "react";
import type { StudioApi } from "./api";
import type { Artifact, ProjectSnapshot } from "./model";
import {
  HelpTip,
  Icon,
  IconButton,
  errorText,
  useArtifact,
} from "./components";
import { useProjectRefreshVersion } from "./project-updates";
import { UiButton, UiSelect, UiTextField } from "./ui";
interface Asset {
  artifact: Artifact;
  label: string;
  source: string;
  fixture: boolean;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  byteLength: number | null;
}
interface Page {
  assets: Asset[];
  total: number;
  offset: number;
  nextOffset: number | null;
}
function AssetDetail({
  api,
  projectId,
  asset,
  close,
  onReference,
}: {
  api: StudioApi;
  projectId: string;
  asset: Asset;
  close(): void;
  onReference?(artifact: Artifact): void;
}) {
  const { t, ui } = useTranslation();

  const { url, error } = useArtifact(api, projectId, asset.artifact);
  return (
    <section
      className="asset-detail"
      aria-label={t("Selected asset", "选中的素材")}
    >
      <header>
        <h3>{asset.label}</h3>
        <IconButton
          label={t("Close asset details", "关闭素材详情")}
          onClick={close}
        />
      </header>
      {error && <p role="alert">{ui(error, workbenchCopy)}</p>}
      {!url && !error && (
        <p role="status">{t("Loading asset…", "正在载入素材…")}</p>
      )}
      {url &&
        (asset.artifact.kind === "image" ? (
          <img src={url} alt={asset.label} />
        ) : (
          <video src={url} controls preload="metadata" />
        ))}
      {onReference && (
        <UiButton
          variant="secondary"
          onClick={() => onReference(asset.artifact)}
        >
          <Icon name="at" size={16} />{" "}
          {t("Reference in conversation", "引用到对话")}{" "}
        </UiButton>
      )}
      <p>
        {asset.width && asset.height
          ? `${asset.width} × ${asset.height} · `
          : ""}
        {asset.durationSeconds ? `${asset.durationSeconds.toFixed(1)}s · ` : ""}
        {ui(asset.source, {
          uploaded: "已上传",
          generated: "已生成",
          export: "导出文件",
        })}
        {asset.fixture ? t(" · Demo fixture", " · 演示素材") : ""}
      </p>
    </section>
  );
}
export function AssetLibrary({
  api,
  snapshot,
  active = true,
  focusArtifactId,
  onReference,
}: {
  api: StudioApi;
  snapshot: ProjectSnapshot;
  active?: boolean;
  focusArtifactId?: string | null;
  onReference?(artifact: Artifact): void;
}) {
  const { t, ui } = useTranslation();

  const projectId = snapshot.project.id,
    revision = useProjectRefreshVersion();
  const [kind, setKind] = useState("all"),
    [source, setSource] = useState("all"),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Asset | null>(null);
  useEffect(() => {
    if (focusArtifactId) {
      setSearch(focusArtifactId);
      setKind("all");
      setSource("all");
      setOffset(0);
    }
  }, [focusArtifactId]);
  useEffect(() => {
    if (focusArtifactId && page) {
      const asset = page.assets.find(
        (a) => a.artifact.artifactId === focusArtifactId,
      );
      if (asset) setSelected(asset);
    }
  }, [page, focusArtifactId]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      kind,
      source,
      search,
      offset: String(offset),
    });
    void api
      .request<Page>(
        `/api/projects/${encodeURIComponent(projectId)}/assets?${query}`,
        { signal: controller.signal },
      )
      .then((value) => {
        if (!controller.signal.aborted) setPage(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorText(reason));
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
    kind,
    source,
    search,
    offset,
    retry,
    active,
  ]);
  return (
    <section className="asset-library" aria-labelledby="asset-library-title">
      <header className="library-heading">
        <h2 id="asset-library-title">
          {" "}
          {t("Assets", "素材")}{" "}
          <HelpTip label={t("About assets", "关于素材")}>
            {" "}
            {t(
              "All saved images and videos, including earlier generated takes and uploads. Select an asset to inspect it. Download and discuss saved images from Import in the conversation.",
              "所有已保存的图像与视频，包括早期生成版本和上传素材。选择素材可查看详情；在对话的导入工具中下载和讨论已保存的图像。",
            )}{" "}
          </HelpTip>
        </h2>
      </header>
      <div className="asset-filters">
        <label className="sr-only" htmlFor="asset-search">
          {" "}
          {t("Find an asset", "查找素材")}{" "}
        </label>
        <UiTextField
          id="asset-search"
          placeholder={t("Find an asset…", "查找素材…")}
          maxLength={160}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
        <label className="sr-only" htmlFor="asset-kind">
          {" "}
          {t("Asset type", "素材类型")}{" "}
        </label>
        <UiSelect
          id="asset-kind"
          value={kind}
          onValueChange={(value) => {
            setKind(value);
            setOffset(0);
          }}
          options={[
            { value: "all", label: t("All types", "所有类型") },
            { value: "image", label: t("Images", "图片") },
            { value: "video", label: t("Videos", "视频") },
          ]}
        />
        <label className="sr-only" htmlFor="asset-source">
          {" "}
          {t("Asset source", "素材来源")}{" "}
        </label>
        <UiSelect
          id="asset-source"
          value={source}
          onValueChange={(value) => {
            setSource(value);
            setOffset(0);
          }}
          options={[
            { value: "all", label: t("All sources", "所有来源") },
            { value: "uploaded", label: t("Uploaded", "已上传") },
            { value: "generated", label: t("Generated", "已生成") },
            { value: "export", label: t("Exports", "导出文件") },
          ]}
        />
      </div>
      {selected && active && (
        <AssetDetail
          key={selected.artifact.artifactId}
          api={api}
          projectId={projectId}
          asset={selected}
          close={() => setSelected(null)}
          {...(onReference ? { onReference } : {})}
        />
      )}
      {error && (
        <p role="alert">
          {ui(error, workbenchCopy)}{" "}
          <IconButton
            icon="refresh"
            label={t("Reload assets", "重新载入素材")}
            onClick={() => setRetry((value) => value + 1)}
          />
        </p>
      )}
      {loading && <p role="status">{t("Loading assets…", "正在载入素材…")}</p>}
      {!loading && !error && page && (
        <>
          <div
            className="asset-list"
            aria-label={t("Image and video assets", "图像与视频素材")}
          >
            {page.assets.map((asset) => (
              <UiButton
                variant="ghost"
                className="asset-row"
                key={asset.artifact.artifactId}
                aria-pressed={
                  selected?.artifact.artifactId === asset.artifact.artifactId
                }
                onClick={() => setSelected(asset)}
              >
                <span className="asset-kind">
                  <Icon
                    name={asset.artifact.kind === "image" ? "image" : "play"}
                  />
                </span>
                <span>
                  <strong>{asset.label}</strong>
                  <small>
                    {ui(asset.artifact.kind, { image: "图片", video: "视频" })}{" "}
                    ·{" "}
                    {ui(asset.source, {
                      uploaded: "已上传",
                      generated: "已生成",
                      export: "导出文件",
                    })}
                    {asset.fixture ? t(" · Demo fixture", " · 演示素材") : ""}
                  </small>
                </span>
                <Icon name="chevron" size={16} />
              </UiButton>
            ))}
          </div>
          {!page.assets.length && (
            <div className="empty-filter">
              <h3>
                {search || kind !== "all" || source !== "all"
                  ? t("No matching assets", "没有匹配的素材")
                  : t("No assets yet", "还没有素材")}
              </h3>
              <p>
                {search || kind !== "all" || source !== "all"
                  ? t(
                      "Try another type or source, or clear your search.",
                      "尝试其他类型或来源，或清除搜索。",
                    )
                  : t(
                      "Upload a reference or generate your first keyframes from the storyboard.",
                      "上传参考素材，或按分镜计划生成第一组关键帧。",
                    )}
              </p>
            </div>
          )}
          <div className="asset-pagination">
            <span>
              {page.total
                ? t("{v0}–{v1} of {v2}", "第 {v0}–{v1} 项，共 {v2} 项", {
                    v0: page.offset + 1,
                    v1: page.offset + page.assets.length,
                    v2: page.total,
                  })
                : t("0 assets", "0 个素材")}
            </span>
            {(page.offset > 0 || page.nextOffset !== null) && (
              <>
                <UiButton
                  className="button small"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 40))}
                >
                  {" "}
                  {t("Previous", "上一页")}{" "}
                </UiButton>
                <UiButton
                  className="button small"
                  disabled={page.nextOffset === null}
                  onClick={() =>
                    page.nextOffset !== null && setOffset(page.nextOffset)
                  }
                >
                  {" "}
                  {t("Next", "下一页")}{" "}
                </UiButton>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
