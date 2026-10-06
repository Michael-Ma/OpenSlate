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

function MusicSettings({ api, snapshot, disabled, command, onImportAudio }: TimelineSettingsProps) {
  const projectId = snapshot.project.id, revision = useProjectRefreshVersion(), id = useId();
  const [recordings, setRecordings] = useState<AudioLibraryEntry[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void api.request<{ recordings: AudioLibraryEntry[] }>(`/api/projects/${encodeURIComponent(projectId)}/audio-library`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setRecordings(value.recordings); })
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, projectId, revision, snapshot.project.headVersion]);
  const soundtrack = snapshot.project.soundtrack, locked = disabled || loading;
  const presets = [-30000, -24000, -18000, -12000, -6000, 0];
  const gainOptions = soundtrack && !presets.includes(soundtrack.gainMilliDb) ? [soundtrack.gainMilliDb, ...presets] : presets;
  return <section className="conversation-media-tools" aria-label="Background music settings">
    <div className="conversation-media-field"><label htmlFor={`${id}-music`}>Background music</label>
      <UiSelect id={`${id}-music`} value={soundtrack?.audioId ?? ""} disabled={locked}
        options={[{ value: "", label: "No background music" }, ...(soundtrack && !recordings.some(recording => recording.id === soundtrack.audioId) ? [{ value: soundtrack.audioId, label: "Saved background music" }] : []), ...recordings.map((recording, index) => ({ value: recording.id, label: `${recording.label || `Recording ${index + 1}`} · ${recording.durationSeconds.toFixed(1)}s` }))]}
        onValueChange={value => { if (!locked) command({ kind: "soundtrack", field: "audioId", value }); }} />
    </div>
    {soundtrack && <div className="conversation-media-field"><label htmlFor={`${id}-gain`}>Music gain</label>
      <UiSelect id={`${id}-gain`} value={String(soundtrack.gainMilliDb)} disabled={locked}
        options={gainOptions.map(gain => ({ value: String(gain), label: `${gain / 1000} dB` }))}
        onValueChange={value => { if (!locked) command({ kind: "soundtrack", field: "gainMilliDb", value }); }} />
    </div>}
    <UiButton disabled={disabled} onClick={onImportAudio}>Import background music</UiButton>
    <small className="conversation-media-note">Starts at 0 · trims to film length · no looping</small>
    {loading && <p role="status" className="field-help">Loading saved recordings…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}

interface SavedAsset { artifact: Artifact; label: string; source: string; fixture: boolean }
interface AssetPage { assets: SavedAsset[]; total: number; offset: number; nextOffset: number | null }
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

function SavedAssetActions({ api, snapshot, disabled, onDiscuss }: AssetActionsProps) {
  const projectId = snapshot.project.id, revision = useProjectRefreshVersion(), id = useId();
  const [search, setSearch] = useState(""), [offset, setOffset] = useState(0), [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState<AssetPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    const query = new URLSearchParams({ kind: "all", source: "all", search, offset: String(offset) });
    void api.request<AssetPage>(`/api/projects/${encodeURIComponent(projectId)}/assets?${query}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setPage(value); setSelectedId(current => value.assets.some(asset => asset.artifact.artifactId === current) ? current : ""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, projectId, revision, snapshot.project.headVersion, search, offset, retry]);
  const selected = page?.assets.find(asset => asset.artifact.artifactId === selectedId);
  const file = useArtifact(api, projectId, !loading && !error ? selected?.artifact ?? null : null);
  const locked = disabled || loading || !!error;
  return <section className="conversation-media-tools" aria-label="Saved asset actions">
    <div className="conversation-media-field"><label htmlFor={`${id}-search`}>Find a saved asset</label>
      <UiTextField id={`${id}-search`} value={search} maxLength={160} placeholder="Search saved images and videos…"
        onChange={event => { setSearch(event.currentTarget.value); setOffset(0); setSelectedId(""); }} />
    </div>
    <div className="conversation-media-field"><label htmlFor={`${id}-asset`}>Saved asset</label>
      <UiSelect id={`${id}-asset`} value={selectedId} disabled={locked || !page?.assets.length}
        options={[{ value: "", label: loading ? "Loading assets…" : page?.assets.length ? "Choose an image or video" : "No matching assets" }, ...(page?.assets.map(asset => ({ value: asset.artifact.artifactId, label: `${asset.label} · ${asset.artifact.kind}` })) ?? [])]}
        onValueChange={setSelectedId} />
    </div>
    {selected && <><small className="conversation-media-note">{selected.source}{selected.fixture ? " · Demo fixture" : ""}</small>
      <div className="conversation-media-actions">
        {!locked && file.url ? <a className="button small" href={file.url} download={`openslate-${selected.artifact.artifactId}.${selected.artifact.kind === "image" ? "png" : "mp4"}`}>Download</a> : <UiButton disabled>Download</UiButton>}
        {selected.artifact.kind === "image" && onDiscuss && <UiButton disabled={locked} onClick={() => { if (!locked) onDiscuss(selected.artifact); }}>Discuss image</UiButton>}
      </div>
      {file.error && <p role="alert" className="form-error">{file.error}</p>}
      {!locked && !file.url && !file.error && <p role="status" className="field-help">Loading the selected file…</p>}
    </>}
    {loading && <p role="status" className="field-help">Loading saved assets…</p>}
    {error && <p role="alert" className="form-error">{error} <UiButton variant="ghost" onClick={() => setRetry(value => value + 1)}>Reload assets</UiButton></p>}
    {page && !loading && !error && <div className="conversation-media-pages"><small>{page.total ? `${page.offset + 1}–${page.offset + page.assets.length} of ${page.total}` : "0 assets"}</small>
      {(offset > 0 || page.nextOffset !== null) && <><UiButton size="1" disabled={offset === 0} onClick={() => { setOffset(value => Math.max(0, value - 40)); setSelectedId(""); }}>Previous</UiButton>
        <UiButton size="1" disabled={page.nextOffset === null} onClick={() => { if (page.nextOffset !== null) { setOffset(page.nextOffset); setSelectedId(""); } }}>Next</UiButton></>}
    </div>}
  </section>;
}

/** Download the exact current or retained previous export without duplicating its video preview. */
export function ExportDownload({ api, snapshot, disabled = false }: { api: StudioApi; snapshot: ProjectSnapshot; disabled?: boolean }) {
  const output = previewOutput(snapshot), file = useArtifact(api, snapshot.project.id, output?.artifact ?? null);
  if (!output) return null;
  const label = output.previous ? "Save previous export" : "Save exported video";
  return <div className="conversation-media-tools">
    {file.url && !disabled ? <a className="button small" href={file.url} download={`openslate-${output.artifact.artifactId}.mp4`}>{label}</a> : <UiButton disabled>{label}</UiButton>}
    {file.error && <p role="alert" className="form-error">{file.error}</p>}
    {!file.url && !file.error && <p role="status" className="field-help">Loading the exported file…</p>}
  </div>;
}
