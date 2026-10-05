import { artifactIdentity, artifactView, type ArtifactViewState } from './artifact-view-model';
import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, FormEvent, ReactNode, RefObject } from "react";
import { IconButton as RadixIconButton, Tooltip } from "@radix-ui/themes";
import { AppDialog, UiButton } from "./ui";
import { APP_NAME } from "@openslate/core/public";
import type { StudioApi } from "./api";
import { durationLabel, previewOutput } from "./model";
import type { Artifact, ArtifactFixture, ProjectSnapshot, Shot } from "./model";

export const errorText = (error: unknown) => error instanceof Error ? error.message : "The action could not be completed.";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></>,
    settings: <><path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3z" /><circle cx="12" cy="12" r="3" /></>,
    logout: <><path d="M10 4H4v16h6m4-13 5 5-5 5m-6-5h11" /></>,
    slate: <><path d="M4 8h16v12H4zM4 8l-1-4 16-3 1 4zM7 3l3 3m3-4 3 3M8 12h8m-8 4h5" /></>,
    plus: <path d="M12 5v14M5 12h14" />, arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />, refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
    pause: <path d="M8 5v14M16 5v14" />, play: <path d="m8 5 11 7-11 7z" />, close: <path d="m6 6 12 12M6 18 18 6" />,
    chat: <path d="M4 4h16v12H9l-5 4z" />, image: <><path d="M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5" /><circle cx="16" cy="8" r="1" /></>,
    folder: <path d="M3 6h7l2 3h9v11H3z" />, chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function IconButton({ label, icon = "close", className = "", ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color"> & { label: string; icon?: string }) {
  return <RadixIconButton {...props} type={props.type ?? "button"} variant="ghost" color="gray" size="2" className={`icon-button ${className}`} aria-label={label} title={label}><Icon name={icon} /></RadixIconButton>;
}
/** Hover, keyboard focus, or a tap reveals supplementary guidance. */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <span className="help-tip"><Tooltip open={open} onOpenChange={setOpen} delayDuration={200} content={children} className="ui-help-tooltip">
    <RadixIconButton type="button" variant="ghost" color="gray" size="1" aria-label={label} onClick={() => setOpen(true)}><Icon name="info" size={16} /></RadixIconButton>
  </Tooltip></span>;
}
export function Connect({ onConnect }: { onConnect: () => Promise<void> }) {
  const [busy, setBusy] = useState(true); const [error, setError] = useState("");
  const startup = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let active = true;
    // StrictMode replays effects; a single-use launch code must be exchanged only once.
    startup.current ??= onConnect();
    void startup.current.catch(error => { if (active) setError(errorText(error)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await onConnect(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  return <div className="connect-page"><header className="connect-brand"><span className="brand-mark"><Icon name="slate" /></span><strong>{APP_NAME}</strong><span className="quiet-label">LOCAL STUDIO</span></header>
    <main className="connect-layout"><div className="connect-story"><span className="eyebrow">A FILM STARTS WITH A CONVERSATION</span><h1>Give your story<br />a place to take shape.</h1><p>Work through the idea, shape each shot, and review the frames before the video begins.</p><div className="process-strip"><span>01 <b>Imagine</b></span><span>02 <b>Shape</b></span><span>03 <b>Review</b></span></div><p className="connect-footnote">Open source. Your workspace, on your computer.</p></div>
    <form className="connect-card" onSubmit={event => void submit(event)}><span className="small-mark"><Icon name="slate" size={27} /></span><h2>Open your studio</h2><p>Your projects stay on this computer. The OpenSlate launcher connects your browser automatically.</p>{error && <p role="alert" className="form-error">{error}</p>}<UiButton type="submit" variant="primary" className="button primary full-width" disabled={busy}>{busy ? "Opening studio…" : "Open studio"}<Icon name="arrow" size={17} /></UiButton><div className="connection-help">Run <code>./start.sh</code> in your OpenSlate folder to start or reconnect to the studio.</div></form></main><footer className="connect-footer">BUILT FOR THE WORK BETWEEN IDEA AND FILM <span>OpenSlate · Early preview</span></footer></div>;
}
export function useArtifact(api: StudioApi, projectId: string, artifact: Artifact | null) {
  const identity = artifactIdentity(projectId, artifact);
  const [result, setResult] = useState<ArtifactViewState<StudioApi> | null>(null);
  useEffect(() => {
    if (!artifact || !identity) return;
    const controller = new AbortController(); let objectUrl: string | null = null;
    setResult({ api, identity, signal: controller.signal, url: null, error: '' });
    void api.artifact(projectId, artifact, controller.signal).then(url => {
      if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
      objectUrl = url; setResult({ api, identity, signal: controller.signal, url, error: '' });
    }).catch(error => { if (!controller.signal.aborted) setResult({ api, identity, signal: controller.signal, url: null, error: errorText(error) }); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, identity]);
  // A new review must never render yesterday's bytes with today's onLoad/hash.
  return artifactView(result, api, identity);
}

export function Lightbox({ value, onClose, onApprove, approveDisabled = false, approved = false, returnFocusRef }: { value: { url: string; shot: Shot; fixture: ArtifactFixture }; onClose: () => void; onApprove?: () => void; approveDisabled?: boolean; approved?: boolean; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null), [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageReady = loadedUrl === value.url && failedUrl !== value.url;
  return <AppDialog open onOpenChange={open => { if (!open) onClose(); }} title={value.shot.purpose} header={<span className="eyebrow">{value.fixture === true ? "Fixture keyframe" : "Keyframe review"}</span>} className="keyframe-dialog" maxWidth="980px" closeLabel="Close enlarged keyframe" {...(returnFocusRef ? { returnFocusRef } : {})}
    description={value.fixture === true ? "Fixture imagery represents pipeline state, not the requested creative quality." : "Review the exact frame and its planned motion."}
    footer={<><span className="field-help">{durationLabel(value.shot.desiredFrames)} planned shot</span><div className="inline-actions"><UiButton variant="secondary" onClick={onClose}>Close</UiButton>{onApprove && <UiButton variant="primary" disabled={approved || approveDisabled || !imageReady} onClick={() => { if (imageReady) onApprove(); }}>{approved ? "Reviewed" : "Approve keyframe & motion"}</UiButton>}</div></>}>
    <img key={value.url} className="keyframe-review-image" src={value.url} alt={value.shot.purpose} onLoad={() => { setLoadedUrl(value.url); setFailedUrl(null); }} onError={() => { setLoadedUrl(null); setFailedUrl(value.url); }} />
    {failedUrl === value.url ? <p role="alert" className="inline-error">This exact frame could not be displayed. Close the review and reload it before approving.</p> : !imageReady && <p role="status" className="field-help">Loading the exact frame…</p>}
    <dl className="keyframe-review-details"><div><dt>Direction</dt><dd>{value.shot.framing}</dd></div><div><dt>Motion</dt><dd>{value.shot.motion}</dd></div></dl>
  </AppDialog>;
}
export function Preview({ api, snapshot }: { api: StudioApi; snapshot: ProjectSnapshot }) {
  const output = previewOutput(snapshot);
  const { url, error } = useArtifact(api, snapshot.project.id, output?.artifact ?? null); if (!output) return null;
  return <section className="preview-panel"><div className="section-heading"><div><span className="eyebrow">ASSEMBLED DRAFT</span><h2>{output.previous ? "Previous preview" : "Your latest preview"}</h2></div><span className="tag">{output.fixture === true ? "Fixture media" : "Video preview"}</span></div>{url ? <video controls preload="metadata" src={url} aria-label={output.fixture === true ? "Assembled fixture video preview" : "Assembled video preview"} /> : <p>{error || "Loading preview…"}</p>}<p className="field-help">{output.previous && "Your earlier preview stays available while the changed shots are prepared. "}{output.fixture === true ? "This fixture tests the production flow. Its playback length and visuals do not represent the planned film." : "Review the assembled video and discuss any changes you want."}</p></section>;
}
