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
  const { url, error } = useArtifact(api, projectId, asset.artifact);
  return (
    <section className="asset-detail" aria-label="Selected asset">
      <header>
        <h3>{asset.label}</h3>
        <IconButton label="Close asset details" onClick={close} />
      </header>
      {error && <p role="alert">{error}</p>}
      {!url && !error && <p role="status">Loading asset…</p>}
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
          <Icon name="at" size={16} />
          引用到对话
        </UiButton>
      )}
      <p>
        {asset.width && asset.height
          ? `${asset.width} × ${asset.height} · `
          : ""}
        {asset.durationSeconds ? `${asset.durationSeconds.toFixed(1)}s · ` : ""}
        {asset.source}
        {asset.fixture ? " · Demo fixture" : ""}
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
          Assets{" "}
          <HelpTip label="About assets">
            All saved images and videos, including earlier generated takes and
            uploads. Select an asset to inspect it. Download and discuss saved
            images from Import in the conversation.
          </HelpTip>
        </h2>
      </header>
      <div className="asset-filters">
        <label className="sr-only" htmlFor="asset-search">
          Find an asset
        </label>
        <UiTextField
          id="asset-search"
          placeholder="Find an asset…"
          maxLength={160}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
        <label className="sr-only" htmlFor="asset-kind">
          Asset type
        </label>
        <UiSelect
          id="asset-kind"
          value={kind}
          onValueChange={(value) => {
            setKind(value);
            setOffset(0);
          }}
          options={[
            { value: "all", label: "All types" },
            { value: "image", label: "Images" },
            { value: "video", label: "Videos" },
          ]}
        />
        <label className="sr-only" htmlFor="asset-source">
          Asset source
        </label>
        <UiSelect
          id="asset-source"
          value={source}
          onValueChange={(value) => {
            setSource(value);
            setOffset(0);
          }}
          options={[
            { value: "all", label: "All sources" },
            { value: "uploaded", label: "Uploaded" },
            { value: "generated", label: "Generated" },
            { value: "export", label: "Exports" },
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
          {error}{" "}
          <IconButton
            icon="refresh"
            label="Reload assets"
            onClick={() => setRetry((value) => value + 1)}
          />
        </p>
      )}
      {loading && <p role="status">Loading assets…</p>}
      {!loading && !error && page && (
        <>
          <div className="asset-list" aria-label="Image and video assets">
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
                    {asset.artifact.kind} · {asset.source}
                    {asset.fixture ? " · Demo fixture" : ""}
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
                  ? "No matching assets"
                  : "No assets yet"}
              </h3>
              <p>
                {search || kind !== "all" || source !== "all"
                  ? "Try another type or source, or clear your search."
                  : "Upload a reference or generate your first keyframes from the storyboard."}
              </p>
            </div>
          )}
          <div className="asset-pagination">
            <span>
              {page.total
                ? `${page.offset + 1}–${page.offset + page.assets.length} of ${page.total}`
                : "0 assets"}
            </span>
            {(page.offset > 0 || page.nextOffset !== null) && (
              <>
                <UiButton
                  className="button small"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 40))}
                >
                  Previous
                </UiButton>
                <UiButton
                  className="button small"
                  disabled={page.nextOffset === null}
                  onClick={() =>
                    page.nextOffset !== null && setOffset(page.nextOffset)
                  }
                >
                  Next
                </UiButton>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
