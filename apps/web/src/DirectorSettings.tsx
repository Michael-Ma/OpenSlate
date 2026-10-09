import { useTranslation } from "./Locale";
import { settingsUiTranslations } from "./settings-ui-translations";
import { createPortal } from "react-dom";
import { UiButton, UiSelect, UiTextField } from "./ui";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import {
  directorChangeCommand,
  directorDraftIdentity,
  directorSetupSummary,
  restoredDirectorDraft,
} from "./project-settings-model";
import type {
  DirectorSelection,
  DirectorSettingsStatus,
} from "./project-settings-model";
import { DirectorSettingsReadGate } from "./director-settings-read";
import { clearLocalDraft, readLocalDraft, writeLocalDraft } from "./local-draft-cache";

const isDirectorSelection = (value: unknown): value is DirectorSelection => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (item.mode === "fake" || item.mode === "native") &&
    ["binaryPath", "codexHome"].every((field) =>
      item[field] === undefined || (typeof item[field] === "string" && (item[field] as string).length <= 4096)) &&
    (item.model === undefined || (typeof item.model === "string" && item.model.length <= 120));
};

export function DirectorSettingsPanel({
  api,
  projectId,
  changed,
  refreshKey = 0,
  busyChanged,
  externalBusy = false,
  localSetupContainerId,
}: {
  api: StudioApi;
  projectId: string;
  changed(): void;
  refreshKey?: number;
  busyChanged?(busy: boolean): void;
  externalBusy?: boolean;
  localSetupContainerId?: string;
}) {
  const { t, ui } = useTranslation();

  const readOnly = useRecoveryReadOnly(),
    path = `/api/projects/${encodeURIComponent(projectId)}/director/setup`;
  const registry = pendingCommandsFor(api, "project-director-settings"),
    initial = useRef(restoredDirectorDraft(registry.snapshot(projectId)));
  const recovered = useRef<ReturnType<typeof readLocalDraft<DirectorSelection>> | undefined>(undefined);
  if (recovered.current === undefined)
    recovered.current = readLocalDraft(api.cacheNamespace, projectId,
      "settings:director", isDirectorSelection);
  const cacheRevision = useRef(recovered.current?.revision ?? null);
  const writeCache = (value: DirectorSelection, selectionDigest: string | null) => {
    const result = writeLocalDraft(api.cacheNamespace, projectId,
      "settings:director", value, { selectionDigest }, cacheRevision.current);
    if (result.status === "saved") cacheRevision.current = result.revision!;
  };
  const clearCache = () => {
    const result = clearLocalDraft(api.cacheNamespace, projectId,
      "settings:director", cacheRevision.current ?? undefined);
    if (result === "saved") cacheRevision.current = null;
  };
  const [draftBaseDigest, setDraftBaseDigest] = useState<string | null>(() => {
    const base = recovered.current?.base;
    return base && typeof base === "object" &&
      typeof (base as { selectionDigest?: unknown }).selectionDigest === "string"
      ? (base as { selectionDigest: string }).selectionDigest : null;
  });
  const [status, setStatus] = useState<DirectorSettingsStatus | null>(null),
    [draft, setDraft] = useState<DirectorSelection>(
      initial.current ?? recovered.current?.value ?? { mode: "fake" },
    );
  const [checking, setChecking] = useState(true),
    [loadError, setLoadError] = useState(""),
    [formError, setFormError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const dirty = useRef(!!initial.current || !!recovered.current),
    catalogRequests = useRef(new Set<string>()),
    catalogAbort = useRef<AbortController | null>(null);
  const statusReads = useRef(new DirectorSettingsReadGate());
  const [modelChecking, setModelChecking] = useState(false),
    [catalogError, setCatalogError] = useState("");
  const [setupContainer, setSetupContainer] = useState<HTMLElement | null>(
    null,
  );
  useEffect(() => {
    setSetupContainer(
      localSetupContainerId
        ? document.getElementById(localSetupContainerId)
        : null,
    );
  }, [localSetupContainerId]);
  const formId = `settings-director-form-${projectId}`;
  const slot = useSyncExternalStore(
    useCallback(
      (listener) => registry.subscribe(projectId, listener),
      [registry, projectId],
    ),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]),
  );
  const observed = useRef(slot.settledVersion),
    notify = useRef(changed);
  notify.current = changed;
  useEffect(() => {
    // Catalog discovery is a cancellable read; it must not lock dismissal or unrelated work.
    busyChanged?.(slot.running);
    return () => busyChanged?.(false);
  }, [slot.running, busyChanged]);
  useEffect(() => {
    const abort = new AbortController();
    void statusReads.current.run(
      () => api.request<DirectorSettingsStatus>(path, { signal: abort.signal }),
      abort.signal,
      {
        start: () => {
          setChecking(true);
          setModelChecking(false);
          setLoadError("");
          setCatalogError("");
        },
        success: (value) => {
          setStatus(value);
          if (recovered.current &&
            directorDraftIdentity(value.selection) === directorDraftIdentity(draft)) {
            clearCache();
            recovered.current = null;
            dirty.current = false;
            setDraftBaseDigest(null);
          }
          if (!dirty.current) setDraft(value.selection);
        },
        failure: (error) => setLoadError(errorText(error)),
        finish: () => setChecking(false),
      },
    );
    return () => abort.abort();
  }, [api, path, refresh, refreshKey]);
  useEffect(() => {
    if (slot.settledVersion <= observed.current) return;
    observed.current = slot.settledVersion;
    if (slot.lastSuccess) {
      const requested = (slot.settledCommand?.body as { selection?: DirectorSelection } | undefined)?.selection;
      if (requested && directorDraftIdentity(requested) === directorDraftIdentity(draft)) {
        dirty.current = false;
        clearCache();
        recovered.current = null;
        setDraftBaseDigest(null);
      }
      notify.current();
    }
    setRefresh((value) => value + 1);
  }, [slot.settledVersion, slot.lastSuccess]);
  const execute = (command: PendingCommand) => {
    if (readOnly) return;
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
      (error) =>
        !(error instanceof ApiError) ||
        ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(
          error.code,
        ),
    );
  };
  const loadModels = useCallback(() => {
    catalogAbort.current?.abort();
    const controller = new AbortController();
    catalogAbort.current = controller;
    void statusReads.current.runCatalog(
      () =>
        api.request<DirectorSettingsStatus>(
          `/api/projects/${encodeURIComponent(projectId)}/director/models`,
          { signal: controller.signal, timeoutMs: 90000 },
        ),
      controller.signal,
      {
        start: () => {
          setModelChecking(true);
          setChecking(false);
          setCatalogError("");
        },
        success: (value) => {
          setStatus(value);
          if (!dirty.current) setDraft(value.selection);
          setLoadError("");
        },
        failure: (error) => setCatalogError(errorText(error)),
        finish: () => setModelChecking(false),
      },
      () => setRefresh((value) => value + 1),
    );
  }, [api, projectId]);
  useEffect(() => () => catalogAbort.current?.abort(), [api, projectId]);
  useEffect(() => {
    if (
      draft.mode !== "native" ||
      !status ||
      status.busy ||
      checking ||
      modelChecking ||
      slot.running ||
      slot.command ||
      externalBusy
    )
      return;
    if (
      status.modelCatalogStatus === "ready" ||
      status.modelCatalogStatus === "blocked" ||
      catalogRequests.current.has(status.selectionDigest)
    )
      return;
    catalogRequests.current.add(status.selectionDigest);
    loadModels();
  }, [
    draft.mode,
    status,
    checking,
    modelChecking,
    slot.running,
    slot.command,
    externalBusy,
    loadModels,
  ]);
  const edit = (value: DirectorSelection) => {
    dirty.current = true;
    const base = draftBaseDigest ?? status?.selectionDigest ?? null;
    setDraftBaseDigest(base);
    writeCache(value, base);
    setDraft(value);
    setFormError("");
  };
  const staleDraft = !!status && !!draftBaseDigest &&
    draftBaseDigest !== status.selectionDigest &&
    directorDraftIdentity(draft) !== directorDraftIdentity(status.selection);
  const disabled =
    externalBusy ||
    readOnly ||
    modelChecking ||
    slot.running ||
    !!slot.command ||
    checking ||
    !!loadError ||
    !status ||
    status.busy ||
    !status.changeAvailable || staleDraft;
  const feedback = useRef<HTMLParagraphElement>(null);
  const hasChanges =
    !!status &&
    directorDraftIdentity(draft) !== directorDraftIdentity(status.selection);
  useEffect(() => {
    if (
      !slot.running &&
      (slot.command || (slot.lastSuccess && !hasChanges && !checking))
    )
      feedback.current?.focus();
  }, [
    slot.settledVersion,
    slot.running,
    slot.command,
    slot.lastSuccess,
    hasChanges,
    checking,
  ]);
  const accountSelection =
    status?.selection.mode === "native" ? status.selection : status?.defaults;
  const catalogMatchesDraft =
    draft.binaryPath === accountSelection?.binaryPath &&
    (draft.codexHome ?? "") === (accountSelection?.codexHome ?? "");
  const modelChoices = catalogMatchesDraft ? (status?.modelChoices ?? []) : [];
  const listed = modelChoices.some((model) => model.id === draft.model);
  const requestedSelection = (
    slot.settledCommand?.body as { selection?: DirectorSelection } | undefined
  )?.selection;
  const recordedChoiceCurrent =
    !!status &&
    !!requestedSelection &&
    directorDraftIdentity(status.selection) ===
      directorDraftIdentity(requestedSelection);
  const nativeSetupBlocked =
    status?.selection.mode === "native" &&
    status.readinessSelectionDigest === status.selectionDigest &&
    status.readiness?.status === "blocked";
  const localSetup =
    draft.mode === "native" ? (
      <details className="settings-disclosure settings-local-setup">
        <summary>
          {t("Director setup", "导演设置")}
          <span>{t("Installation and account", "安装与账号")}</span>
        </summary>
        <div className="settings-setup-content">
          <p className="field-help">
            {status
              ? ui(directorSetupSummary(status), settingsUiTranslations)
              : t("Loading local setup…", "正在读取本机设置…")}
          </p>
          {!modelChoices.length && (
            <>
              <label htmlFor="director-custom-model">
                {t("Model ID", "模型 ID")}
              </label>
              <UiTextField
                id="director-custom-model"
                form={formId}
                value={draft.model ?? ""}
                maxLength={120}
                disabled={disabled}
                onChange={(event) =>
                  edit({ ...draft, model: event.target.value })
                }
                placeholder={t(
                  "Model available to this Codex account",
                  "此 Codex 账号可用的模型",
                )}
              />
            </>
          )}
          <label htmlFor="director-binary">
            {t("Codex executable", "Codex 程序路径")}
          </label>
          <UiTextField
            id="director-binary"
            form={formId}
            value={draft.binaryPath ?? ""}
            maxLength={4096}
            disabled={disabled}
            onChange={(event) =>
              edit({ ...draft, binaryPath: event.target.value })
            }
            placeholder={t("Absolute path to Codex", "Codex 程序的绝对路径")}
          />
          <label htmlFor="director-home">
            {t("Codex account folder (optional)", "Codex 账号目录（可选）")}
          </label>
          <UiTextField
            id="director-home"
            form={formId}
            value={draft.codexHome ?? ""}
            maxLength={4096}
            disabled={disabled}
            onChange={(event) => {
              const next = { ...draft };
              if (event.target.value) next.codexHome = event.target.value;
              else delete next.codexHome;
              edit(next);
            }}
            placeholder={t(
              "Your existing Codex login",
              "已有的 Codex 登录目录",
            )}
          />
          <p className="field-help">
            {t(
              "Leave the folder blank to use your existing Codex login and its billing.",
              "留空即可使用已有的 Codex 登录和计费方式。",
            )}
          </p>
        </div>
      </details>
    ) : null;
  return (
    <section
      className="project-settings-section settings-director"
      aria-labelledby="project-director-title"
    >
      {staleDraft && <p role="status" className="settings-inline-issue">
        {t("The saved Director choice changed. Your local draft is kept. Review it before saving.", "已保存的导演设置发生变化。本地草稿已保留，请检查后再保存。")}
        <UiButton type="button" variant="ghost" onClick={() => {
          setDraftBaseDigest(status!.selectionDigest);
          writeCache(draft, status!.selectionDigest);
        }}>{t("Keep my choice for current version", "在当前版本保留我的选择")}</UiButton>
        <UiButton type="button" variant="ghost" onClick={() => {
          setDraft(status!.selection);
          setDraftBaseDigest(null);
          dirty.current = false;
          clearCache();
        }}>{t("Use saved choice", "使用已保存的选择")}</UiButton>
      </p>}
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || !status || !hasChanges) return;
          try {
            execute(
              directorChangeCommand(
                projectId,
                status,
                draft,
                crypto.randomUUID(),
              ),
            );
            setFormError("");
          } catch (error) {
            setFormError(errorText(error));
          }
        }}
      >
        <div className="settings-model-row">
          <div className="settings-job-copy">
            <label id="project-director-title" htmlFor="director-mode">
              {t("Director", "导演")}
            </label>
            <p>{t("Plan and refine your film", "规划和完善影片")}</p>
          </div>
          <div className="settings-model-control">
            <div
              className={
                draft.mode === "native" ? "settings-director-picker" : undefined
              }
            >
              <UiSelect
                id="director-mode"
                value={draft.mode}
                disabled={disabled}
                options={[
                  { value: "native", label: "Codex" },
                  { value: "fake", label: t("Demo director", "演示导演") },
                ]}
                onValueChange={(value) => {
                  const mode = value as DirectorSelection["mode"];
                  edit(
                    mode === "fake"
                      ? { mode }
                      : {
                          ...status?.defaults,
                          ...(status?.selection.mode === "native"
                            ? status.selection
                            : {}),
                          mode,
                        },
                  );
                }}
              />
              {draft.mode === "native" && (
                <div>
                  <label className="sr-only" htmlFor="director-model">
                    {t("Director model", "导演模型")}
                  </label>
                  <UiSelect
                    id="director-model"
                    value={draft.model ?? ""}
                    disabled={disabled}
                    options={[
                      ...(!listed
                        ? [
                            {
                              value: draft.model ?? "",
                              label: draft.model
                                ? `${draft.model} · ${modelChoices.length ? t("unavailable", "不可用") : t("current model", "当前模型")}`
                                : t("Choose a model", "选择模型"),
                              disabled:
                                status?.modelCatalogStatus === "ready" &&
                                modelChoices.length > 0,
                            },
                          ]
                        : []),
                      ...modelChoices.map((model) => ({
                        value: model.id,
                        label: model.label,
                      })),
                    ]}
                    onValueChange={(value) => edit({ ...draft, model: value })}
                  />
                </div>
              )}
            </div>
            <p className="settings-account-line">
              {draft.mode === "fake"
                ? t("Demo · no model calls", "演示模式 · 不调用模型")
                : t(
                    "Codex sign-in · next conversation turn",
                    "使用 Codex 登录 · 从下一轮对话生效",
                  )}
            </p>
            {status?.busy && (
              <p role="status" className="settings-inline-issue">
                {t(
                  "Available after the current conversation or setup finishes.",
                  "当前对话或设置完成后即可使用。",
                )}
              </p>
            )}
            {nativeSetupBlocked && (
              <p className="settings-inline-issue">
                {t(
                  "Codex needs setup. See Accounts & local setup.",
                  "需要完成 Codex 设置，请查看“账号与本机设置”。",
                )}
              </p>
            )}
            {draft.mode === "native" && modelChecking && (
              <p role="status" className="field-help">
                {t("Checking available models…", "正在检查可用模型…")}
              </p>
            )}
            {draft.mode === "native" &&
              !modelChecking &&
              (!modelChoices.length || catalogError) && (
                <p className="field-help">
                  {catalogError
                    ? ui(catalogError, settingsUiTranslations)
                    : t(
                        "Model list unavailable.",
                        "暂时无法读取模型列表。",
                      )}{" "}
                  <UiButton
                    type="button"
                    variant="ghost"
                    className="text-button"
                    disabled={
                      slot.running ||
                      !!slot.command ||
                      externalBusy ||
                      !!status?.busy
                    }
                    onClick={loadModels}
                  >
                    {t("Refresh models", "刷新模型")}
                  </UiButton>
                </p>
              )}
            {hasChanges && (
              <div className="settings-row-actions">
                <UiButton
                  type="submit"
                  variant="primary"
                  className="small"
                  disabled={disabled}
                >
                  {slot.running
                    ? t("Checking and saving…", "正在检查并保存…")
                    : t("Save Director", "保存导演模型")}
                </UiButton>
                <span>
                  {t(
                    "Used from the next conversation turn.",
                    "从下一轮对话生效。",
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </form>
      {localSetup &&
        (setupContainer
          ? createPortal(localSetup, setupContainer)
          : localSetup)}
      {slot.command && !slot.running && (
        <div className="notice warning">
          <p ref={feedback} tabIndex={-1}>
            {t(
              "Director save unconfirmed. Check the saved request before making another change.",
              "导演设置尚未确认。再次修改前，请检查已保存的请求。",
            )}
          </p>
          <UiButton
            type="button"
            disabled={readOnly || externalBusy}
            onClick={() => execute(slot.command!)}
          >
            {t("Check saved Director request", "检查已保存的导演设置请求")}
          </UiButton>
        </div>
      )}
      {slot.lastSuccess && !slot.command && !hasChanges && (
        <p
          ref={feedback}
          tabIndex={-1}
          role="status"
          className="settings-save-status"
        >
          {recordedChoiceCurrent
            ? t(
                "Director saved. Used from the next conversation turn.",
                "导演设置已保存，从下一轮对话生效。",
              )
            : t(
                "Earlier Director change recorded. The current choice is shown above.",
                "先前的导演设置修改已记录，上方显示当前选择。",
              )}
        </p>
      )}
      {!!(loadError || formError || (!slot.command && slot.error)) && (
        <p role="alert" className="form-error">
          {ui(
            loadError || formError || errorText(slot.error),
            settingsUiTranslations,
          )}
        </p>
      )}
      {loadError && (
        <UiButton
          type="button"
          className="small"
          onClick={() => setRefresh((value) => value + 1)}
        >
          {t("Reload Director choices", "重新读取导演选项")}
        </UiButton>
      )}
      {checking && !status && (
        <p role="status">
          {t("Loading director choice…", "正在读取导演选项…")}
        </p>
      )}
    </section>
  );
}
