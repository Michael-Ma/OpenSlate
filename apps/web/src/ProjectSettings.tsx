import { useTranslation } from "./Locale";
import { PersonalVoiceSettings } from "./PersonalVoiceSettings";
import { useState } from "react";
import { AppDialog, UiButton } from "./ui";
import type { StudioApi } from "./api";
import type { ProjectSnapshot } from "./model";
import { DirectorSettingsPanel } from "./DirectorSettings";
import { ProjectModelsSettings } from "./ProviderSettings";
import "./project-settings.css";
export interface ProjectSettingsProps {
  api: StudioApi;
  projectId: string;
  snapshot?: ProjectSnapshot;
  close(): void;
  changed(): void;
  onContinue?(): void;
  refreshKey?: number;
}
export function ProjectSettings({
  api,
  projectId,
  snapshot,
  close,
  changed,
  onContinue,
  refreshKey = 0,
}: ProjectSettingsProps) {
  const { t } = useTranslation();

  const [directorBusy, setDirectorBusy] = useState(false),
    [mediaBusy, setMediaBusy] = useState(false),
    [voiceBusy, setVoiceBusy] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);
  const busy = directorBusy || mediaBusy || voiceBusy;
  return (
    <AppDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title={t("Models for this project", "本项目使用的模型")}
      description={t(
        "Choose a model for each kind of work.",
        "为每种工作选择模型。",
      )}
      className="project-settings-dialog"
      maxWidth="680px"
      bodyClassName="project-settings-body"
      headerClassName="project-settings-header"
      footerClassName="project-settings-footer"
      header={
        <span className="eyebrow">
          {snapshot?.project.name ?? t("THIS PROJECT", "本项目")}
        </span>
      }
      closeLabel={t("Close settings", "关闭设置")}
      closeDisabled={busy}
      preventClose={busy}
      footer={
        <>
          <span>
            {t(
              "Generation is reviewed in the studio.",
              "关键帧和视频生成在工作区中确认。",
            )}
          </span>
          <UiButton type="button" disabled={busy} onClick={close}>
            {t("Done", "完成")}
          </UiButton>
        </>
      }
    >
      <DirectorSettingsPanel
        key={projectId}
        api={api}
        projectId={projectId}
        changed={changed}
        refreshKey={refreshKey}
        busyChanged={setDirectorBusy}
        externalBusy={mediaBusy || voiceBusy}
        localSetupContainerId={`settings-director-local-${projectId}`}
      />
      <ProjectModelsSettings
        key={projectId}
        api={api}
        projectId={projectId}
        {...(snapshot ? { snapshot } : {})}
        changed={changed}
        {...(onContinue ? { onContinue } : {})}
        refreshKey={refreshKey}
        busyChanged={setMediaBusy}
        externalBusy={directorBusy || voiceBusy}
      >
        <div id={`settings-director-local-${projectId}`} />
        <details
          className="settings-disclosure settings-voices"
          onToggle={(event) => setVoicesOpen(event.currentTarget.open)}
        >
          <summary>
            {t("Recorded voices", "录音音色")}
            <span>{t("Existing voices", "已有音色")}</span>
          </summary>
          {voicesOpen && (
            <PersonalVoiceSettings
              api={api}
              projectId={projectId}
              busyChanged={setVoiceBusy}
            />
          )}
        </details>
      </ProjectModelsSettings>
    </AppDialog>
  );
}
