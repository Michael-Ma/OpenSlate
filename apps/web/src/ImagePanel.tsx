import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import type { Artifact, ProjectSnapshot } from "./model";
import { activeProjectEdit, pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import "./media.css";

interface Reference { artifact: Artifact; width: number; height: number; byteLength: number }
interface Library { headVersion: number; images: Reference[]; capabilities: { import: boolean; maxBytes: number; unavailableReason: string | null }; coverage: { offset: number; returned: number; total: number; nextOffset: number | null } }
type Props = { api: StudioApi; snapshot: ProjectSnapshot; onChanged(): void; onDiscuss?: ((artifact: Artifact, requestId: string | null) => void) | undefined };
function importError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "UPLOAD_TOO_LARGE") return "Choose a nonempty PNG image up to 32 MiB.";
    if (error.code === "IMAGE_INPUT_INVALID") return "Choose a PNG no larger than 4096 pixels on either side and 8.29 megapixels overall.";
    if (["IMAGE_VALIDATION_FAILED", "MEDIA_TOOL_FAILED"].includes(error.code)) return "This file could not be decoded as a complete PNG. Choose another image.";
    if (["IMAGE_DIGEST_MISMATCH", "IMAGE_INTEGRITY_ERROR", "UPLOAD_CORRUPT"].includes(error.code)) return "The image changed during verification. Select the original file and try again.";
  }
  return errorText(error);
}

function ImagePreview({ api, projectId, reference }: { api: StudioApi; projectId: string; reference: Reference }) {
  const [url, setUrl] = useState(""), [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); let owned = ""; setUrl(""); setError(""); setLoaded(false);
    void api.artifact(projectId, reference.artifact, abort.signal).then(value => {
      if (abort.signal.aborted) { URL.revokeObjectURL(value); return; } owned = value; setUrl(value);
    }).catch(error => { if (!abort.signal.aborted) setError(errorText(error)); });
    return () => { abort.abort(); if (owned) URL.revokeObjectURL(owned); };
  }, [api, projectId, reference.artifact.artifactId, reference.artifact.sha256]);
  return <div className="owned-image-preview">{(!loaded || error) && <p role={error ? "alert" : "status"}>{error || "Loading verified reference…"}</p>}
    {url && !error && <img src={url} alt="Selected supplied reference" onLoad={() => setLoaded(true)} onError={() => setError("This reference could not be displayed.")} />}
  </div>;
}

export function ImagePanel(props: Props) { return <ImageWorkspace key={props.snapshot.project.id} {...props} />; }
function ImageWorkspace({ api, snapshot, onChanged, onDiscuss }: Props) {
  const projectId = snapshot.project.id, base = `/api/projects/${encodeURIComponent(projectId)}/images`, registry = pendingCommandsFor(api, "images");
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]), useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const [library, setLibrary] = useState<Library | null>(null), [loadError, setLoadError] = useState(""), [fileError, setFileError] = useState("");
  const [selected, setSelected] = useState<Reference | null>(null), [file, setFile] = useState<File | null>(null), [fileVersion, setFileVersion] = useState(0);
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true), [reuse, setReuse] = useState(true);
  const currentRequest = activeProjectEdit(snapshot.messages, projectId), blocked = slot.running || !!slot.command;
  const changed = useRef(onChanged); changed.current = onChanged;
  const observed = useRef({ registry, version: 0 });
  useEffect(() => {
    if (observed.current.registry !== registry) observed.current = { registry, version: 0 };
    if (slot.settledVersion <= observed.current.version) return;
    observed.current.version = slot.settledVersion;
    if (slot.lastSuccess) { setFile(null); setFileVersion(value => value + 1); setOffset(0); }
    setRefresh(value => value + 1); changed.current();
  }, [registry, slot.settledVersion, slot.lastSuccess]);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setLoadError("");
    void api.request<Library>(`${base}?offset=${offset}`, { signal: abort.signal }).then(next => {
      if (!abort.signal.aborted) { setLibrary(next); setSelected(current => current ?? next.images[0] ?? null); }
    }).catch(error => { if (!abort.signal.aborted) setLoadError(errorText(error)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [api, base, offset, refresh, snapshot.project.headVersion]);
  function execute(command: PendingCommand) {
    void registry.run(projectId, command, saved => api.upload(saved.path, saved.file!, saved.key),
      error => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code));
  }
  const error = fileError || (slot.error ? importError(slot.error) : "") || loadError;
  return <section className="media-panel" aria-labelledby="reference-images-title">
    <div className="media-heading"><div><span className="eyebrow">REFERENCE IMAGES</span><h3 id="reference-images-title">Set the visual direction</h3></div><span className="tag">Your images</span></div>
    <p>Import a PNG reference, review it here, and discuss which shots should use it. Importing an image does not approve video generation.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {library && !library.capabilities.import && <p role="status">{library.capabilities.unavailableReason}</p>}
    {slot.command && slot.running && <p role="status">Your saved import is running. Switching projects will not start it again.</p>}
    {slot.command && !slot.running && <div className="notice warning"><span>The import result was not confirmed. Check the same saved request.</span><button onClick={() => execute(slot.command!)}>Retry same import</button></div>}
    <form className="clip-upload" onSubmit={event => {
      event.preventDefault(); if (!file || fileError || !library?.capabilities.import || blocked) return;
      const query = new URLSearchParams({ expectedHeadVersion: String(snapshot.project.headVersion), ...(reuse && currentRequest ? { requestId: currentRequest } : {}) });
      execute({ path: `${base}/uploads?${query}`, file, key: crypto.randomUUID() });
    }}>
      <label htmlFor="supplied-image">PNG image · up to 32 MiB</label>
      <input key={fileVersion} id="supplied-image" type="file" accept="image/png,.png" disabled={blocked || !library?.capabilities.import} onChange={event => {
        const selectedFile = event.target.files?.[0] ?? null; setFile(selectedFile);
        setFileError(selectedFile && (!selectedFile.size || selectedFile.size > 32 * 1024 * 1024) ? "Choose a nonempty PNG image up to 32 MiB." : "");
      }} />
      {currentRequest && <label className="check-row"><input type="checkbox" checked={reuse} disabled={blocked} onChange={event => setReuse(event.target.checked)} />Add this reference to the current edit</label>}
      <button className="button small" disabled={blocked || !file || !!fileError || !library?.capabilities.import}>{slot.running ? "Importing…" : "Import reference"}</button>
    </form>
    {loading && <p role="status">Loading reference library…</p>}
    {!loading && library && !library.coverage.total && <p>No reference images yet.</p>}
    {!!library?.images.length && <div className="supplied-clips">{library.images.map((reference, index) => <button className="supplied-clip" key={reference.artifact.artifactId} aria-pressed={selected?.artifact.artifactId === reference.artifact.artifactId} onClick={() => setSelected(reference)}>
      <strong>Reference {library.coverage.offset + index + 1}</strong><span>{reference.width} × {reference.height} · {(reference.byteLength / 1048576).toFixed(2)} MiB</span><small>Preview</small>
    </button>)}</div>}
    {library && library.coverage.total > 40 && <div className="render-actions"><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 40))}>Previous references</button><span>{library.coverage.offset + 1}–{library.coverage.offset + library.coverage.returned} of {library.coverage.total}</span><button disabled={loading || library.coverage.nextOffset === null} onClick={() => setOffset(library.coverage.nextOffset!)}>More references</button></div>}
    {selected && <><ImagePreview key={selected.artifact.artifactId} api={api} projectId={projectId} reference={selected} />
      {onDiscuss && <><button className="text-button" disabled={blocked} onClick={() => onDiscuss(selected.artifact, currentRequest)}>Discuss this reference</button><p>The conversation shares the reference’s identity. Describe the visual details you want OpenSlate to use.</p></>}
    </>}
  </section>;
}
