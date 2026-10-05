import { PersonalVoiceSettings } from "./PersonalVoiceSettings";
import { useState } from "react";
import { AppDialog, UiButton } from "./ui";
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
  const [voicesOpen, setVoicesOpen] = useState(false);
  const busy = directorBusy || mediaBusy || voiceBusy;
  return <AppDialog open onOpenChange={open => { if (!open && !busy) close(); }} title="Models for this project" description="Choose a model for each kind of work."
    className="project-settings-dialog" maxWidth="680px" bodyClassName="project-settings-body" headerClassName="project-settings-header" footerClassName="project-settings-footer"
    header={<span className="eyebrow">{snapshot?.project.name ?? "THIS PROJECT"}</span>} closeLabel="Close settings" closeDisabled={busy} preventClose={busy}
    footer={<><span>Generation is reviewed in the studio.</span><UiButton type="button" disabled={busy} onClick={close}>Done</UiButton></>}>
      <DirectorSettingsPanel key={projectId} api={api} projectId={projectId} changed={changed} refreshKey={refreshKey} busyChanged={setDirectorBusy} externalBusy={mediaBusy || voiceBusy} localSetupContainerId={`settings-director-local-${projectId}`} />
      <ProjectModelsSettings key={projectId} api={api} projectId={projectId} {...(snapshot ? { snapshot } : {})} changed={changed} {...(onContinue ? { onContinue } : {})} refreshKey={refreshKey} busyChanged={setMediaBusy} externalBusy={directorBusy || voiceBusy}>
      <div id={`settings-director-local-${projectId}`} />
      <details className="settings-disclosure settings-voices" onToggle={event => setVoicesOpen(event.currentTarget.open)}><summary>Recorded voices<span>Existing voices</span></summary>
        {voicesOpen && <PersonalVoiceSettings api={api} projectId={projectId} busyChanged={setVoiceBusy} />}
      </details>
      </ProjectModelsSettings>
  </AppDialog>;
}
