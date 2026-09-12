import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { APP_NAME } from "@openslate/core/public";
import type { StudioApi } from "./api";
import { durationLabel, previewOutput } from "./model";
import type { Artifact, ProjectSnapshot, ReviewMember, Shot } from "./model";

export const errorText = (error: unknown) => error instanceof Error ? error.message : "The action could not be completed.";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    slate: <><path d="M4 8h16v12H4zM4 8l-1-4 16-3 1 4zM7 3l3 3m3-4 3 3M8 12h8m-8 4h5" /></>,
    plus: <path d="M12 5v14M5 12h14" />, arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />, refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
    pause: <path d="M8 5v14M16 5v14" />, play: <path d="m8 5 11 7-11 7z" />, close: <path d="m6 6 12 12M6 18 18 6" />,
    chat: <path d="M4 4h16v12H9l-5 4z" />, image: <><path d="M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5" /><circle cx="16" cy="8" r="1" /></>,
    folder: <path d="M3 6h7l2 3h9v11H3z" />, chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function Connect({ onConnect }: { onConnect: (token: string) => Promise<void> }) {
  const [token, setToken] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!/^[A-Za-z0-9_-]{20,256}$/.test(token.trim())) { setError("Enter the local access token from your OpenSlate server."); return; }
    setBusy(true); setError("");
    try { await onConnect(token.trim()); setToken(""); } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  return <div className="connect-page"><header className="connect-brand"><span className="brand-mark"><Icon name="slate" /></span><strong>{APP_NAME}</strong><span className="quiet-label">LOCAL STUDIO</span></header>
    <main className="connect-layout"><div className="connect-story"><span className="eyebrow">A FILM STARTS WITH A CONVERSATION</span><h1>Give your story<br />a place to take shape.</h1><p>Work through the idea, shape each shot, and review the frames before the video begins.</p><div className="process-strip"><span>01 <b>Imagine</b></span><span>02 <b>Shape</b></span><span>03 <b>Review</b></span></div><p className="connect-footnote">Open source. Your workspace, on your computer.</p></div>
    <form className="connect-card" onSubmit={event => void submit(event)}><span className="small-mark"><Icon name="slate" size={27} /></span><h2>Open your studio</h2><p>Connect to the OpenSlate server running on this computer.</p><label htmlFor="access-token">Local access token</label><input id="access-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} placeholder="Paste your local token" disabled={busy} aria-describedby="token-help" /><p id="token-help" className="field-help">Kept only in this tab’s memory. Disconnecting clears it.</p>{error && <p role="alert" className="form-error">{error}</p>}<button className="button primary full-width" disabled={busy}>{busy ? "Connecting…" : "Connect to OpenSlate"}<Icon name="arrow" size={17} /></button><div className="connection-help">The local server must be running before you connect.</div></form></main><footer className="connect-footer">BUILT FOR THE WORK BETWEEN IDEA AND FILM <span>OpenSlate · Early preview</span></footer></div>;
}
function useArtifact(api: StudioApi, projectId: string, artifact: Artifact | null) {
  const [url, setUrl] = useState<string | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    setUrl(null); setError(""); if (!artifact) return;
    const controller = new AbortController(); let objectUrl: string | null = null;
    void api.artifact(projectId, artifact, controller.signal).then(result => { if (controller.signal.aborted) { URL.revokeObjectURL(result); return; } objectUrl = result; setUrl(result); }).catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, projectId, artifact?.artifactId, artifact?.sha256]);
  return { url, error };
}
export function ShotCard({ api, projectId, shot, index, member, chosen, scoped, stale, onChoose, onScope, onDisplayed, onEnlarge, hasTake }: {
  api: StudioApi; projectId: string; shot: Shot; index: number; member: ReviewMember | undefined; chosen: boolean; scoped: boolean; stale: boolean;
  onChoose: () => void; onScope: () => void; onDisplayed: (id: string, sha: string) => void; onEnlarge: (url: string, shot: Shot) => void; hasTake: boolean;
}) {
  const { url, error } = useArtifact(api, projectId, member?.keyframe ?? null); const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); if (member) onDisplayed(member.videoNodeId, ""); return () => { if (member) onDisplayed(member.videoNodeId, ""); }; }, [url, member?.videoNodeId, onDisplayed]);
  const ready = !!member?.ready && !!member.motionPrompt && !!member.durationFrames && !!member.profileLabel && !!url && loaded;
  return <article className={`shot-card ${scoped ? "in-scope" : ""}`}><div className="shot-card-top"><span className="shot-number">SHOT {String(index + 1).padStart(2, "0")}</span><span className="duration">{durationLabel(member?.durationFrames ?? shot.desiredFrames)}</span>{member?.approved ? <span className="approved-label"><Icon name="check" size={13} />Frame approved</span> : <label className="review-select"><input type="checkbox" checked={chosen} disabled={!ready || stale} onChange={onChoose} aria-label={`Select shot ${index + 1} keyframe for approval`} /><span className="sr-only">Select for approval</span></label>}</div>
    <button className="frame-surface" disabled={!url} onClick={() => url && onEnlarge(url, shot)} aria-label={`Enlarge keyframe for shot ${index + 1}`}>{url ? <img src={url} alt={`Keyframe for shot ${index + 1}: ${shot.purpose}`} onLoad={() => { setLoaded(true); if (member?.keyframe) onDisplayed(member.videoNodeId, member.keyframe.sha256); }} onError={() => { setLoaded(false); if (member) onDisplayed(member.videoNodeId, ""); }} /> : <div className="frame-placeholder"><Icon name="image" size={31} /><span>{error ? "Preview unavailable" : member?.keyframe ? "Loading exact frame…" : "Waiting for a keyframe"}</span></div>}{url && <span className="fixture-badge">FIXTURE PREVIEW</span>}</button>
    <div className="shot-content"><h3>{shot.purpose}</h3><p className="shot-framing">{shot.framing}</p><div className="motion-row"><Icon name="arrow" size={14} /><p>{member?.motionPrompt ?? shot.motion}</p></div>{member?.profileLabel && <p className="review-profile">Video profile: {member.profileLabel}</p>}<div className="shot-status"><span className={`status-dot ${member?.approved ? "green" : ""}`} />{hasTake ? "Video fixture available" : member?.approved ? "Video can continue when ready" : ready ? "Ready for your frame review" : "Keyframe preparation pending"}</div>{error && <p className="inline-error">{error}</p>}<button className={`button scope-button ${scoped ? "selected" : ""}`} onClick={onScope} aria-pressed={scoped}><Icon name="chat" size={15} />{scoped ? "Selected for conversation" : "Discuss this shot"}{scoped && <Icon name="check" size={14} />}</button></div></article>;
}
export function Lightbox({ value, onClose }: { value: { url: string; shot: Shot }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="lightbox" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="lightbox-content"><button className="icon-button lightbox-close" onClick={onClose} aria-label="Close enlarged keyframe"><Icon name="close" /></button><img src={value.url} alt={value.shot.purpose} /><div><span className="eyebrow">FIXTURE KEYFRAME</span><h2>{value.shot.purpose}</h2><p>{value.shot.motion} · {durationLabel(value.shot.desiredFrames)}</p><p className="field-help">Fixture imagery represents pipeline state, not the requested creative quality.</p></div></div></dialog>;
}
export function Preview({ api, snapshot }: { api: StudioApi; snapshot: ProjectSnapshot }) {
  const output = previewOutput(snapshot);
  const { url, error } = useArtifact(api, snapshot.project.id, output?.artifact ?? null); if (!output) return null;
  return <section className="preview-panel"><div className="section-heading"><div><span className="eyebrow">ASSEMBLED DRAFT</span><h2>{output.previous ? "Previous preview" : "Your latest preview"}</h2></div><span className="tag">Fixture media</span></div>{url ? <video controls preload="metadata" src={url} aria-label="Assembled fixture video preview" /> : <p>{error || "Loading preview…"}</p>}<p className="field-help">{output.previous && "Your earlier preview stays available while the changed shots are prepared. "}This fixture tests the production flow. Its playback length and visuals do not represent the planned film.</p></section>;
}
