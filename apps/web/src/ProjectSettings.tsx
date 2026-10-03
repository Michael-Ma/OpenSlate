import { PersonalVoiceSettings } from "./PersonalVoiceSettings";
import { IconButton } from "./components";
import { useEffect, useRef, useState } from "react";
import type { StudioApi } from "./api";
import type { ProjectSnapshot } from "./model";
import { DirectorSettingsPanel } from "./DirectorSettings";
import { ProjectModelsSettings } from "./ProviderSettings";
import "./project-settings.css";
export interface ProjectSettingsProps {
  api: StudioApi; projectId: string; snapshot?: ProjectSnapshot; close(): void; changed(): void;
  onContinue?(): void; refreshKey?: number;
}
export function ProjectSettings({ api, projectId, snapshot, close, changed, onContinue, refreshKey = 0 }: ProjectSettingsProps) {
  const [directorBusy, setDirectorBusy] = useState(false), [mediaBusy, setMediaBusy] = useState(false), [voiceBusy, setVoiceBusy] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null);
  const busy = directorBusy || mediaBusy || voiceBusy;
  useEffect(() => { const previous = document.activeElement, element = dialog.current; if (element && !element.open) element.showModal(); element?.focus(); return () => { if (element?.open) element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <div className="modal-scrim project-settings-scrim"><dialog ref={dialog} tabIndex={-1} className="settings-dialog project-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="project-settings-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }} onKeyDown={event => {
    if (event.key === "Escape" && !busy) { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href]') ?? [])].filter(element => {
      if (!element.getClientRects().length || element.closest('[hidden]')) return false;
      for (let ancestor = element.parentElement; ancestor && ancestor !== dialog.current; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
          const summary = ancestor.querySelector(':scope > summary');
          if (element !== summary && !summary?.contains(element)) return false;
        }
      }
      return true;
    });
    const first = focusable[0], last = focusable.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  }}>
    <header className="project-settings-header"><div><span className="eyebrow">{snapshot?.project.name ?? "THIS PROJECT"}</span><h2 id="project-settings-title">Project settings</h2><p>Choose a model for each kind of work.</p></div>
      <IconButton type="button" onClick={close} disabled={busy} label="Close settings" icon="close" /></header>
    <div className="project-settings-body">
      <DirectorSettingsPanel key={projectId} api={api} projectId={projectId} changed={changed} refreshKey={refreshKey} busyChanged={setDirectorBusy} externalBusy={mediaBusy || voiceBusy} localSetupContainerId={`settings-director-local-${projectId}`} />
      <ProjectModelsSettings key={projectId} api={api} projectId={projectId} {...(snapshot ? { snapshot } : {})} changed={changed} {...(onContinue ? { onContinue } : {})} refreshKey={refreshKey} busyChanged={setMediaBusy} externalBusy={directorBusy || voiceBusy}>
      <div id={`settings-director-local-${projectId}`} />
      <details className="settings-disclosure settings-voices" onToggle={event => setVoicesOpen(event.currentTarget.open)}><summary>Recorded voices<span>Existing voice identities</span></summary>
        {voicesOpen && <PersonalVoiceSettings api={api} projectId={projectId} busyChanged={setVoiceBusy} />}
      </details>
      </ProjectModelsSettings>
    </div>
    <footer className="project-settings-footer"><span>Generation is reviewed in the studio.</span><button type="button" className="button" disabled={busy} onClick={close}>Done</button></footer>
  </dialog></div>;
}
