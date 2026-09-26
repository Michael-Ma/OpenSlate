import { useEffect, useState } from "react";
import type { StudioApi } from "./api";
import type { Artifact, ProjectSnapshot } from "./model";
import { HelpTip, Icon, IconButton, errorText, useArtifact } from "./components";
import { ImagePanel } from "./ImagePanel";
import { MediaPanel } from "./MediaPanel";
import { useProjectRefreshVersion } from "./project-updates";
interface Asset { artifact: Artifact; label: string; source: string; fixture: boolean; width: number | null; height: number | null; durationSeconds: number | null; byteLength: number | null }
interface Page { assets: Asset[]; total: number; offset: number; nextOffset: number | null }
function AssetDetail({ api, projectId, asset, close, onDiscuss, disabled }: { api: StudioApi; projectId: string; asset: Asset; close(): void; onDiscuss?: ((artifact: Artifact) => void) | undefined; disabled: boolean }) {
  const { url, error } = useArtifact(api, projectId, asset.artifact);
  return <section className="asset-detail" aria-label="Selected asset"><header><h3>{asset.label}</h3><IconButton label="Close asset details" onClick={close} /></header>
    {error && <p role="alert">{error}</p>}{!url && !error && <p role="status">Loading asset…</p>}
    {url && (asset.artifact.kind === "image" ? <img src={url} alt={asset.label} /> : <video src={url} controls preload="metadata" />)}
    <p>{asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ""}{asset.durationSeconds ? `${asset.durationSeconds.toFixed(1)}s · ` : ""}{asset.source}{asset.fixture ? " · Demo fixture" : ""}</p>
    <div className="quick-actions">{url && <a className="button small" href={url} download={`openslate-${asset.artifact.artifactId}.${asset.artifact.kind === "image" ? "png" : "mp4"}`}>Download</a>}{asset.artifact.kind === "image" && onDiscuss && <button className="button small" disabled={disabled} onClick={() => onDiscuss(asset.artifact)}>Discuss image</button>}</div>
  </section>;
}
export function AssetLibrary({ api, snapshot, onChanged, onDiscuss, disabled }: { api: StudioApi; snapshot: ProjectSnapshot; onChanged(): void; onDiscuss?: ((artifact: Artifact) => void) | undefined; disabled: boolean }) {
  const projectId = snapshot.project.id, revision = useProjectRefreshVersion();
  const [kind, setKind] = useState("all"), [source, setSource] = useState("all"), [search, setSearch] = useState(""), [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Asset | null>(null), [upload, setUpload] = useState<"image" | "video" | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    const query = new URLSearchParams({ kind, source, search, offset: String(offset) });
    void api.request<Page>(`/api/projects/${encodeURIComponent(projectId)}/assets?${query}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setPage(value); }).catch(reason => { if (!controller.signal.aborted) setError(errorText(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, projectId, revision, snapshot.project.headVersion, kind, source, search, offset, retry]);
  return <section className="asset-library" aria-labelledby="asset-library-title"><header className="library-heading"><h2 id="asset-library-title">Assets <HelpTip label="About assets">All saved images and videos, including earlier generated takes and uploads. Select an asset to inspect or download it. Narration lives in Brief & narration.</HelpTip></h2><div className="quick-actions"><button className="button small" aria-expanded={upload === "image"} onClick={() => setUpload(upload === "image" ? null : "image")}><Icon name="plus" size={16} />Image</button><button className="button small" aria-expanded={upload === "video"} onClick={() => setUpload(upload === "video" ? null : "video")}><Icon name="plus" size={16} />Video</button></div></header>
    <div hidden={upload !== "image"}><ImagePanel api={api} snapshot={snapshot} uploadOnly onChanged={onChanged} /></div><div hidden={upload !== "video"}><MediaPanel api={api} snapshot={snapshot} mode="upload" onChanged={onChanged} /></div>
    <div className="asset-filters"><label className="sr-only" htmlFor="asset-search">Find an asset</label><input id="asset-search" placeholder="Find an asset…" maxLength={160} value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /><label className="sr-only" htmlFor="asset-kind">Asset type</label><select id="asset-kind" value={kind} onChange={event => { setKind(event.target.value); setOffset(0); }}><option value="all">All types</option><option value="image">Images</option><option value="video">Videos</option></select><label className="sr-only" htmlFor="asset-source">Asset source</label><select id="asset-source" value={source} onChange={event => { setSource(event.target.value); setOffset(0); }}><option value="all">All sources</option><option value="uploaded">Uploaded</option><option value="generated">Generated</option><option value="export">Exports</option></select></div>
    {selected && <AssetDetail key={selected.artifact.artifactId} api={api} projectId={projectId} asset={selected} close={() => setSelected(null)} onDiscuss={onDiscuss} disabled={disabled} />}
    {error && <p role="alert">{error} <IconButton icon="refresh" label="Reload assets" onClick={() => setRetry(value => value + 1)} /></p>}{loading && <p role="status">Loading assets…</p>}
    {!loading && !error && page && <><div className="asset-list" aria-label="Image and video assets">{page.assets.map(asset => <button className="asset-row" key={asset.artifact.artifactId} aria-pressed={selected?.artifact.artifactId === asset.artifact.artifactId} onClick={() => setSelected(asset)}><span className="asset-kind"><Icon name={asset.artifact.kind === "image" ? "image" : "play"} /></span><span><strong>{asset.label}</strong><small>{asset.artifact.kind} · {asset.source}{asset.fixture ? " · Demo fixture" : ""}</small></span><Icon name="chevron" size={16} /></button>)}</div>{!page.assets.length && <div className="empty-filter"><h3>{search || kind !== "all" || source !== "all" ? "No matching assets" : "No assets yet"}</h3><p>{search || kind !== "all" || source !== "all" ? "Try another type or source, or clear your search." : "Upload a reference or generate your first keyframes from the storyboard."}</p></div>}<div className="asset-pagination"><span>{page.total ? `${page.offset + 1}–${page.offset + page.assets.length} of ${page.total}` : "0 assets"}</span>{(page.offset > 0 || page.nextOffset !== null) && <><button className="button small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 40))}>Previous</button><button className="button small" disabled={page.nextOffset === null} onClick={() => page.nextOffset !== null && setOffset(page.nextOffset)}>Next</button></>}</div></>}

  </section>;
}
