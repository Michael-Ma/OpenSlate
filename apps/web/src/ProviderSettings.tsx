import {
  settingsAccountLine,
  settingsEstimate,
  settingsMediaAccountCount,
} from "./settings-labels";
import { useTranslation } from "./Locale";
import { settingsUiTranslations } from "./settings-ui-translations";
import { IconButton } from "./components";
import { UiButton, UiSelect } from "./ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ApiError } from "./api";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import type { ProjectSnapshot } from "./model";
import {
  MODEL_KINDS,
  modelAppliedCurrent,
  modelAutomaticApplyCommand,
  modelDraftIdentity,
  restoredModelDraft,
  modelApplyCommand,
  modelPreviewCommand,
  modelPreviewCurrent,
  preservedWorkReason,
} from "./project-settings-model";
import type {
  CapturedModelPreview,
  ModelSelection,
  ModelScope,
  ModelSettingsStatus,
  ModelSettingsPreview,
  ModelSettingsApplied,
} from "./project-settings-model";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import {
  PROVIDER_KIND_CHOICES,
  providerSelectionForKind,
  selectedProviderForKind,
} from "./provider-model";
import type {
  ProviderCatalogView,
  ProviderKind,
  ProviderSelection,
  ProviderView,
} from "./provider-model";
import {
  selectedSettingsAccounts,
  settingsModelLabel,
  settingsSetupIssue,
} from "./settings-presentation-model";
import "./providers.css";

export function NewProjectProviderFields({
  api,
  selection,
  changed,
  disabled,
}: {
  api: StudioApi;
  selection: ProviderSelection | null;
  changed(value: ProviderSelection | null): void;
  disabled: boolean;
}) {
  const { t, ui, locale } = useTranslation();

  const [catalog, setCatalog] = useState<ProviderCatalogView | null>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api
      .request<ProviderCatalogView>("/api/providers", {
        signal: controller.signal,
      })
      .then((value) => {
        if (!controller.signal.aborted) setCatalog(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error));
      });
    return () => controller.abort();
  }, [api, refresh]);
  const stale =
    !!selection &&
    !!catalog &&
    selection.expectedCatalogDigest !== catalog.catalogDigest;
  const selected = (kind: ProviderKind) =>
    catalog ? selectedProviderForKind(catalog, selection, kind) : undefined;
  function choose(kind: ProviderKind, id: string) {
    if (!catalog || stale || disabled) return;
    try {
      changed(providerSelectionForKind(catalog, selection, kind, id));
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  return (
    <details className="new-provider-fields">
      <summary>{t("Media models", "媒体模型")}</summary>
      {!catalog && !error && (
        <p role="status">{t("Loading model choices…", "正在读取模型选项…")}</p>
      )}
      {catalog && (
        <>
          {PROVIDER_KIND_CHOICES.map(({ kind, label }) => (
            <div key={kind}>
              <label htmlFor={`new-${kind}-profile`}>
                {ui(label, settingsUiTranslations)}
              </label>
              <UiSelect
                id={`new-${kind}-profile`}
                value={selected(kind)?.id ?? ""}
                disabled={disabled || stale}
                options={catalog.profiles
                  .filter((provider) => provider.profile?.kind === kind)
                  .map((provider) => ({
                    value: provider.id,
                    label: settingsModelLabel(provider),
                  }))}
                onValueChange={(value) => choose(kind, value)}
              />
              {selected(kind) && (
                <p>{settingsEstimate(selected(kind)!, locale)}</p>
              )}
            </div>
          ))}
          <p>
            {selection
              ? t(
                  "Saved for this project. Use each scene’s controls to generate and review its media.",
                  "已为本项目保存。使用场景操作生成和检查媒体。",
                )
              : t("Demo models are selected.", "当前选择的是演示模型。")}
          </p>
        </>
      )}
      {stale && (
        <p role="alert">
          {t(
            "The model catalog changed. Refresh the choices before creating this project.",
            "模型列表已更新。创建项目前，请刷新选项。",
          )}
        </p>
      )}
      {error && (
        <p role="alert">
          {ui(error, settingsUiTranslations)}
          {t(
            " Reset the choices to create a default demo project.",
            " 重置选项后可创建默认演示项目。",
          )}
        </p>
      )}
      {(selection || error || stale) && (
        <IconButton
          type="button"
          disabled={disabled}
          onClick={() => {
            changed(null);
            setRefresh((value) => value + 1);
          }}
          label={t("Reset and refresh choices", "重置并刷新选项")}
          icon="refresh"
        />
      )}
    </details>
  );
}

function SelectedAccounts({
  options,
  selected,
}: {
  options: ProviderView[];
  selected: ModelSelection;
}) {
  const { t, ui } = useTranslation();

  const accounts = selectedSettingsAccounts(options, selected);
  return (
    <div className="settings-setup-content">
      <ul className="settings-selected-accounts">
        {accounts.map((account) => {
          const issues = account.providers.filter((provider) =>
            settingsSetupIssue(provider),
          );
          return (
            <li key={account.name}>
              <div>
                <strong>{ui(account.name, settingsUiTranslations)}</strong>
                <span>
                  {issues.length
                    ? t("Needs attention", "需要处理")
                    : t("Configured", "已配置")}
                </span>
              </div>
              {!!issues.length && (
                <ul>
                  {issues.map((provider) => (
                    <li key={provider.id}>
                      {settingsModelLabel(provider)}:{" "}
                      {provider.projectExecution?.compatible === false
                        ? ((provider.projectExecution.message
                            ? ui(
                                provider.projectExecution.message,
                                settingsUiTranslations,
                              )
                            : null) ??
                          ui(
                            settingsSetupIssue(provider) ?? "",
                            settingsUiTranslations,
                          ))
                        : ui(
                            settingsSetupIssue(provider) ?? "",
                            settingsUiTranslations,
                          )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {!accounts.length && (
        <p>{t("Demo models need no accounts.", "演示模型无需配置账号。")}</p>
      )}
      <p className="field-help">
        {t(
          "Accounts are checked when used. API keys stay on this computer.",
          "账号在使用时检查，API 密钥保留在本机。",
        )}
      </p>
      <details className="settings-local-help">
        <summary>{t("Where setup lives", "在哪里配置")}</summary>
        <p>
          {t(
            "Media keys and routes use the local server configuration. Restart OpenSlate after changing it. Codex images use the configured ChatGPT login; Director setup is below.",
            "媒体密钥和调用方式在本机服务配置中设置，修改后请重启 OpenSlate。Codex 图片使用已配置的 ChatGPT 登录；导演设置位于下方。",
          )}
        </p>
      </details>
    </div>
  );
}
function ImpactList({
  preview,
  options,
  snapshot,
}: {
  preview: ModelSettingsPreview;
  options: ProviderView[];
  snapshot: ProjectSnapshot | undefined;
}) {
  const { t, ui } = useTranslation();

  const [changeLimit, setChangeLimit] = useState(40),
    [preservedLimit, setPreservedLimit] = useState(40);
  const name = (id: string) =>
    id === "local-assembly"
      ? t("Local assembly", "本机合成")
      : options.find((option) => option.id === id)
        ? settingsModelLabel(options.find((option) => option.id === id)!)
        : t("Earlier saved model", "先前保存的模型");
  const label = (
    row:
      | ModelSettingsPreview["changes"][number]
      | ModelSettingsPreview["preserved"][number],
  ) => {
    const shot = snapshot?.project.shots.find(
      (value) => value.id === row.shotId,
    );
    if (!shot || !snapshot)
      return row.kind === "timeline"
        ? t("Timeline", "时间线")
        : row.kind === "render"
          ? t("Export", "导出")
          : row.alias;
    const scene = snapshot.project.scenes.findIndex(
        (value) => value.id === shot.sceneId,
      ),
      index = snapshot.project.shots
        .filter((value) => value.sceneId === shot.sceneId)
        .findIndex((value) => value.id === shot.id);
    return t("Shot {number} · {purpose}", "镜头 {number} · {purpose}", {
      number: `${scene + 1}.${index + 1}`,
      purpose: shot.purpose,
    });
  };
  const media = preview.changes.filter((row) =>
    MODEL_KINDS.includes(row.kind as ProviderKind),
  );
  const assembly = preview.changes.filter(
    (row) => !MODEL_KINDS.includes(row.kind as ProviderKind),
  );
  return (
    <div className="settings-impact-lists">
      {!!media.length && (
        <ul>
          {media.slice(0, changeLimit).map((row) => (
            <li key={row.nodeId}>
              <strong>{label(row)}</strong>
              <span>
                {name(row.fromProfileId)} → {name(row.toProfileId)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {changeLimit < media.length && (
        <UiButton
          type="button"
          variant="ghost"
          className="text-button"
          onClick={() => setChangeLimit((value) => value + 40)}
        >
          {t("Show more changed work", "显示更多待更新内容")}
        </UiButton>
      )}
      {!!assembly.length && (
        <p className="field-help">
          {t(
            "{count} dependent timeline/export step{suffix} will be prepared from the changed media.",
            "将根据修改后的媒体更新 {count} 个时间线／导出步骤。",
            {
              count: assembly.length,
              suffix: assembly.length === 1 ? "" : "s",
            },
          )}
        </p>
      )}
      <details>
        <summary>
          {t("Work being kept · ", "保留的内容 · ")}
          {preview.counts.preserved}
        </summary>
        {preview.preserved.length ? (
          <>
            <ul>
              {preview.preserved.slice(0, preservedLimit).map((row) => (
                <li key={row.nodeId}>
                  <strong>{label(row)}</strong>
                  <span>
                    {ui(
                      preservedWorkReason(row.reason),
                      settingsUiTranslations,
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {preservedLimit < preview.preserved.length && (
              <UiButton
                type="button"
                variant="ghost"
                className="text-button"
                onClick={() => setPreservedLimit((value) => value + 40)}
              >
                {t("Show more kept work", "显示更多保留内容")}
              </UiButton>
            )}
          </>
        ) : (
          <p>{t("No existing work is excluded.", "未排除任何现有工作。")}</p>
        )}
      </details>
    </div>
  );
}
export function ProjectModelsSettings({
  api,
  projectId,
  snapshot,
  changed,
  onContinue,
  refreshKey = 0,
  busyChanged,
  externalBusy = false,
  children,
}: {
  api: StudioApi;
  projectId: string;
  snapshot?: ProjectSnapshot;
  changed(): void;
  onContinue?(): void;
  refreshKey?: number;
  busyChanged?(busy: boolean): void;
  externalBusy?: boolean;
  children?: ReactNode;
}) {
  const { t, ui, locale } = useTranslation();

  const readOnly = useRecoveryReadOnly(),
    base = `/api/projects/${encodeURIComponent(projectId)}/settings/models`;
  const registry = pendingCommandsFor(api, "project-model-settings"),
    continuations = pendingCommandsFor(api, "project-model-continuation");
  const initial = useRef(restoredModelDraft(registry.snapshot(projectId))),
    dirty = useRef(!!initial.current);
  const [status, setStatus] = useState<ModelSettingsStatus | null>(null),
    [selected, setSelected] = useState<ModelSelection>(
      initial.current?.selected ?? {
        image: null,
        video: null,
        speech: null,
        transcription: null,
      },
    );
  const [scope] = useState<ModelScope>(
      initial.current?.scope ?? { kind: "unfinished" },
    ),
    [captured, setCaptured] = useState<CapturedModelPreview | null>(
      initial.current?.captured ?? null,
    );
  const [checking, setChecking] = useState(true),
    [loadError, setLoadError] = useState(""),
    [formError, setFormError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const slot = useSyncExternalStore(
    useCallback(
      (listener) => registry.subscribe(projectId, listener),
      [registry, projectId],
    ),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]),
  );
  const continuation = useSyncExternalStore(
    useCallback(
      (listener) => continuations.subscribe(projectId, listener),
      [continuations, projectId],
    ),
    useCallback(
      () => continuations.snapshot(projectId),
      [continuations, projectId],
    ),
  );
  const automaticApplies = useRef(new Set<string>());
  const observed = useRef(slot.settledVersion),
    observedContinuation = useRef(continuation.settledVersion),
    notify = useRef(changed),
    navigate = useRef(onContinue);
  notify.current = changed;
  navigate.current = onContinue;
  const busy = slot.running || continuation.running;
  useEffect(() => {
    busyChanged?.(busy);
    return () => busyChanged?.(false);
  }, [busy, busyChanged]);
  useEffect(() => {
    const abort = new AbortController();
    setChecking(true);
    setLoadError("");
    void api
      .request<ModelSettingsStatus>(base, { signal: abort.signal })
      .then((value) => {
        if (abort.signal.aborted) return;
        setStatus(value);
        if (!dirty.current) setSelected(value.selected);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setLoadError(errorText(error));
      })
      .finally(() => {
        if (!abort.signal.aborted) setChecking(false);
      });
    return () => abort.abort();
  }, [api, base, refresh, refreshKey, snapshot?.project.headVersion]);
  useEffect(() => {
    if (slot.settledVersion <= observed.current) return;
    observed.current = slot.settledVersion;
    if (slot.lastSuccess && slot.settledCommand?.path.endsWith("/preview")) {
      const metadata = slot.settledCommand.metadata as {
        draftIdentity: string;
      };
      setCaptured({
        preview: slot.result as ModelSettingsPreview,
        draftIdentity: metadata.draftIdentity,
      });
    } else if (
      slot.lastSuccess &&
      slot.settledCommand?.path.endsWith("/apply")
    ) {
      const result = slot.result as ModelSettingsApplied;
      dirty.current = false;
      setCaptured(null);
      setStatus(result.status);
      setSelected(result.status.selected);
      setRefresh((value) => value + 1);
      notify.current();
    }
  }, [slot.settledVersion, slot.lastSuccess, slot.result, slot.settledCommand]);
  useEffect(() => {
    if (continuation.settledVersion <= observedContinuation.current) return;
    observedContinuation.current = continuation.settledVersion;
    if (continuation.lastSuccess) {
      notify.current();
      navigate.current?.();
    }
  }, [continuation.settledVersion, continuation.lastSuccess]);
  const uncertain = (error: unknown) =>
    !(error instanceof ApiError) ||
    ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code);
  const execute = (command: PendingCommand) => {
    if (!readOnly)
      void registry.run(
        projectId,
        command,
        (saved) =>
          api.request(saved.path, {
            method: "POST",
            body: saved.body,
            key: saved.key,
            timeoutMs: 90000,
          }),
        uncertain,
      );
  };
  const continueWithDirector = (command: PendingCommand) => {
    if (readOnly || externalBusy) return;
    void continuations.run(
      projectId,
      command,
      (saved) =>
        api.request(saved.path, {
          method: "POST",
          body: saved.body,
          key: saved.key,
        }),
      uncertain,
    );
  };
  const disabled =
    externalBusy ||
    readOnly ||
    busy ||
    !!slot.command ||
    !!continuation.command ||
    checking ||
    !!loadError ||
    !status;
  const currentPreview = modelPreviewCurrent(
    captured,
    status,
    selected,
    scope,
    checking,
    !!loadError,
    snapshot?.project.headVersion,
  );
  const applied =
    slot.lastSuccess && slot.settledCommand?.path.endsWith("/apply")
      ? (slot.result as ModelSettingsApplied)
      : null;
  const hasChanges =
    !!status &&
    modelDraftIdentity(selected, scope) !==
      modelDraftIdentity(status.selected, scope);
  useEffect(() => {
    if (
      readOnly ||
      externalBusy ||
      slot.running ||
      slot.command ||
      continuation.running ||
      continuation.command
    )
      return;
    const command = modelAutomaticApplyCommand(
      captured,
      status,
      selected,
      scope,
      slot.settledCommand,
      checking,
      !!loadError,
      snapshot?.project.headVersion,
    );
    if (!command || automaticApplies.current.has(command.key)) return;
    automaticApplies.current.add(command.key);
    execute(command);
  }, [
    captured,
    status,
    selected,
    scope,
    slot.settledCommand,
    slot.running,
    slot.command,
    continuation.running,
    continuation.command,
    checking,
    loadError,
    snapshot?.project.headVersion,
    readOnly,
    externalBusy,
  ]);
  const feedback = useRef<HTMLParagraphElement>(null),
    reviewHeading = useRef<HTMLHeadingElement>(null),
    imageChoice = useRef<HTMLButtonElement>(null),
    returnToChoices = useRef(false);
  useEffect(() => {
    if (!captured && returnToChoices.current) {
      returnToChoices.current = false;
      imageChoice.current?.focus();
    }
  }, [captured]);
  useEffect(() => {
    if (
      !slot.running &&
      (slot.command || (applied && !hasChanges && !checking))
    )
      feedback.current?.focus();
  }, [
    slot.settledVersion,
    slot.running,
    slot.command,
    applied,
    hasChanges,
    checking,
  ]);
  const accountCount = selectedSettingsAccounts(
    status?.options ?? [],
    selected,
  ).length;
  const zeroImpactSaving =
    !!captured &&
    currentPreview &&
    captured.preview.counts.changed === 0 &&
    !!(
      slot.settledCommand?.metadata as
        | { zeroImpactApplyKey?: string }
        | undefined
    )?.zeroImpactApplyKey &&
    !slot.error;
  useEffect(() => {
    if (
      captured &&
      !applied &&
      !zeroImpactSaving &&
      !slot.running &&
      !slot.command
    ) {
      reviewHeading.current?.focus();
      reviewHeading.current?.scrollIntoView({ block: "start" });
    }
  }, [
    captured?.preview.id,
    applied,
    zeroImpactSaving,
    slot.running,
    slot.command,
  ]);
  const mediaChanges =
    captured?.preview.changes.filter((row) =>
      MODEL_KINDS.includes(row.kind as ProviderKind),
    ) ?? [];
  const changedTitle = mediaChanges.length
    ? t(
        "Update {count} unfinished media item{suffix}?",
        "更新 {count} 个未完成媒体项目？",
        {
          count: mediaChanges.length,
          suffix: mediaChanges.length === 1 ? "" : "s",
        },
      )
    : t("Save media model choices?", "保存媒体模型选择？");
  const modelRow = (kind: ProviderKind, label: string, description: string) => {
    const choices =
        status?.options.filter((provider) => provider.profile?.kind === kind) ??
        [],
      provider = choices.find((provider) => provider.id === selected[kind]);
    return (
      <div className="settings-model-row" key={kind}>
        <div className="settings-job-copy">
          <label htmlFor={`settings-model-${kind}`}>
            {ui(label, settingsUiTranslations)}
          </label>
          <p>{description}</p>
        </div>
        <div className="settings-model-control">
          <UiSelect
            ref={kind === "image" ? imageChoice : undefined}
            id={`settings-model-${kind}`}
            value={selected[kind] ?? ""}
            disabled={disabled || !!captured}
            options={[
              ...(!selected[kind]
                ? [{ value: "", label: t("No current model", "尚未选择模型") }]
                : []),
              ...(selected[kind] && !provider
                ? [
                    {
                      value: selected[kind]!,
                      label: t("Saved model unavailable", "已保存的模型不可用"),
                    },
                  ]
                : []),
              ...choices.map((choice) => ({
                value: choice.id,
                label: settingsModelLabel(choice),
              })),
            ]}
            onValueChange={(choice) => {
              dirty.current = true;
              setSelected((value) => ({ ...value, [kind]: choice || null }));
              setFormError("");
            }}
          />
          <p
            className={`settings-account-line${provider && settingsSetupIssue(provider) ? " settings-inline-issue" : ""}`}
          >
            {provider
              ? settingsAccountLine(provider, locale)
              : t("Choose an available model", "选择可用模型")}
          </p>
        </div>
      </div>
    );
  };
  return (
    <section
      className="project-settings-section settings-media"
      aria-label={t("Media model choices", "媒体模型选择")}
    >
      {slot.command && !slot.running && (
        <div className="notice warning">
          <p ref={feedback} tabIndex={-1}>
            {t(
              "Media save unconfirmed. Check the saved request before changing choices.",
              "媒体设置尚未确认。再次修改前，请检查已保存的请求。",
            )}
          </p>
          <UiButton
            type="button"
            disabled={readOnly || externalBusy || continuation.running}
            onClick={() => execute(slot.command!)}
          >
            {t("Check saved media request", "检查已保存的媒体设置请求")}
          </UiButton>
        </div>
      )}
      {!!(
        loadError ||
        formError ||
        (!slot.command && slot.error) ||
        (!continuation.command && continuation.error)
      ) && (
        <p role="alert" className="form-error">
          {ui(
            loadError ||
              formError ||
              errorText(slot.error ?? continuation.error),
            settingsUiTranslations,
          )}
        </p>
      )}
      {applied && !slot.command && !hasChanges && (
        <p
          ref={feedback}
          tabIndex={-1}
          role="status"
          className="settings-save-status"
        >
          {modelAppliedCurrent(applied, status, checking, !!loadError)
            ? t(
                "Media models saved. Existing results and jobs kept.",
                "媒体模型已保存，已有结果和任务均保留。",
              )
            : t(
                "Earlier media change recorded. Reload to see current choices.",
                "先前的媒体设置修改已记录。请刷新以查看当前选择。",
              )}
        </p>
      )}
      {modelRow(
        "image",
        t("Keyframes", "关键帧"),
        t("Create the look of each shot", "确定每个镜头的画面"),
      )}
      {modelRow(
        "video",
        t("Video", "视频"),
        t("Bring reviewed keyframes to life", "将确认后的关键帧制作成视频"),
      )}
      {modelRow(
        "speech",
        t("Narration", "旁白"),
        t("Generate speech when needed", "在需要时生成语音"),
      )}
      <details className="settings-disclosure">
        <summary>
          {t("Other models", "其他模型")}
          <span>{t("Transcription", "语音识别")}</span>
        </summary>
        {modelRow(
          "transcription",
          t("Transcription", "语音识别"),
          t("Find words and timing in audio", "识别音频中的文字与时间"),
        )}
      </details>
      <details className="settings-disclosure">
        <summary>
          {t("Accounts & local setup", "账号与本机设置")}
          <span>
            {accountCount
              ? settingsMediaAccountCount(accountCount, locale)
              : t("Demo models", "演示模型")}
          </span>
        </summary>
        {status && (
          <SelectedAccounts options={status.options} selected={selected} />
        )}
        {children}
      </details>
      {!captured && hasChanges && (
        <div className="settings-media-actions">
          {hasChanges && (
            <span>
              {t(
                "Future plans and eligible unfinished work.",
                "用于后续计划和可更新的未完成工作。",
              )}
            </span>
          )}
          <UiButton
            type="button"
            variant="primary"
            disabled={disabled || !hasChanges}
            onClick={() => {
              if (!status) return;
              try {
                const command = modelPreviewCommand(
                  status,
                  selected,
                  scope,
                  snapshot?.project.shots.map((shot) => shot.id) ?? [],
                  crypto.randomUUID(),
                );
                command.metadata = {
                  ...(command.metadata as Record<string, unknown>),
                  zeroImpactApplyKey: crypto.randomUUID(),
                };
                execute(command);
                setFormError("");
              } catch (error) {
                setFormError(errorText(error));
              }
            }}
          >
            {slot.running
              ? t("Saving media choices…", "正在保存媒体选择…")
              : t("Save media models", "保存媒体模型")}
          </UiButton>
        </div>
      )}
      {captured && !applied && !zeroImpactSaving && !slot.command && (
        <div
          className="settings-impact"
          aria-labelledby="settings-impact-title"
        >
          <h3 id="settings-impact-title" ref={reviewHeading} tabIndex={-1}>
            {changedTitle}
          </h3>
          {scope.kind === "shots" && (
            <p className="field-help">
              {t("This saved change applies to ", "本次修改适用于 ")}
              {scope.shotIds.length}
              {t(" selected shots.", " 个选中的镜头。")}
            </p>
          )}
          <ImpactList
            key={captured.preview.id}
            preview={captured.preview}
            options={status?.options ?? []}
            snapshot={snapshot}
          />
          <p>
            {t(
              "Completed results, active jobs and reviewed audio are kept.",
              "已完成结果、进行中任务和已检查音频都会保留。",
            )}
          </p>
          {!currentPreview && (
            <p role="alert">
              {t(
                "The project or choices changed. Reload and review again.",
                "项目或选项已改变，请刷新并重新检查。",
              )}
            </p>
          )}
          <div className="settings-actions">
            <UiButton
              type="button"
              variant="primary"
              disabled={disabled || !currentPreview}
              onClick={() =>
                execute(modelApplyCommand(captured, crypto.randomUUID()))
              }
            >
              {t("Apply media changes", "应用媒体修改")}
            </UiButton>
            <UiButton
              type="button"
              disabled={busy || !!slot.command}
              onClick={() => {
                returnToChoices.current = true;
                setCaptured(null);
              }}
            >
              {t("Back to choices", "返回选项")}
            </UiButton>
          </div>
        </div>
      )}
      {busy && !zeroImpactSaving && (
        <p role="status" className="settings-save-status">
          {continuation.running
            ? t(
                "Checking the saved planning request…",
                "正在检查已保存的规划请求…",
              )
            : t("Saving media choices…", "正在保存媒体选择…")}
        </p>
      )}
      {zeroImpactSaving && (
        <p role="status" className="settings-save-status">
          {t("Saving the reviewed media choices…", "正在保存已检查的媒体选择…")}
        </p>
      )}
      {continuation.command && !continuation.running && (
        <div className="notice warning">
          <p>
            {t(
              "An earlier planning continuation was not confirmed.",
              "先前的继续规划请求尚未确认。",
            )}
          </p>
          <UiButton
            type="button"
            disabled={readOnly || externalBusy}
            onClick={() => continueWithDirector(continuation.command!)}
          >
            {t("Check saved continuation", "检查已保存的继续请求")}
          </UiButton>
        </div>
      )}
      {!slot.command &&
        (loadError || slot.error || (captured && !currentPreview)) && (
          <UiButton
            type="button"
            className="small"
            disabled={busy || !!slot.command}
            onClick={() => {
              setCaptured(null);
              setRefresh((value) => value + 1);
            }}
          >
            {t("Reload model choices", "重新读取模型选项")}
          </UiButton>
        )}
      {checking && !status && (
        <p role="status">{t("Loading model choices…", "正在读取模型选项…")}</p>
      )}
    </section>
  );
}
