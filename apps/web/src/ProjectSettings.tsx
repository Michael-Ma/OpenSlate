import { useEffect, useRef, useState } from "react";
import type { StudioApi } from "./api";
import type { ProjectSnapshot } from "./model";
import { DirectorSettingsPanel } from "./DirectorSettings";
import { ProjectModelsSettings, ProviderSetupAccounts } from "./ProviderSettings";
import "./project-settings.css";
type Section = "models" | "director" | "setup";
export interface ProjectSettingsProps {
  api: StudioApi; projectId: string; snapshot?: ProjectSnapshot; close(): void; changed(): void;
  onContinue?(): void; refreshKey?: number;
}
export function ProjectSettings({ api, projectId, snapshot, close, changed, onContinue, refreshKey = 0 }: ProjectSettingsProps) {
  const [section, setSection] = useState<Section>("models"), [busy, setBusy] = useState(false), dialog = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement; dialog.current?.focus(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <div className="modal-scrim project-settings-scrim"><section ref={dialog} tabIndex={-1} className="settings-dialog project-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="project-settings-title" onKeyDown={event => {
    if (event.key === "Escape" && !busy) { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, a[href]') ?? [])].filter(element => element.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  }}>
    <header className="project-settings-header"><div><span className="eyebrow">{snapshot?.project.name ?? "THIS PROJECT"}</span><h2 id="project-settings-title">Project settings</h2><p>Choose models, understand usage, and check local setup.</p></div>
      <button type="button" className="text-button" onClick={close} disabled={busy}>Close settings</button></header>
    <nav className="project-settings-tabs" aria-label="Project settings sections">
      {([["models", "Models & usage"], ["director", "Director"], ["setup", "Setup & accounts"]] as const).map(([value, label]) => <button key={value} type="button" disabled={busy} aria-current={section === value ? "page" : undefined}
        className={section === value ? "active" : ""} onClick={() => setSection(value)}>{label}</button>)}
    </nav>
    <div className="project-settings-body">
      {section === "models" && <ProjectModelsSettings api={api} projectId={projectId} {...(snapshot ? { snapshot } : {})} changed={changed} {...(onContinue ? { onContinue } : {})} refreshKey={refreshKey} busyChanged={setBusy} />}
      {section === "director" && <DirectorSettingsPanel api={api} projectId={projectId} changed={changed} refreshKey={refreshKey} busyChanged={setBusy} />}
      {section === "setup" && <ProviderSetupAccounts api={api} projectId={projectId} refreshKey={refreshKey} />}
    </div>
  </section></div>;
}
