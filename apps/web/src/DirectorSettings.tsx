import { createPortal } from "react-dom";
import { IconButton } from "./components";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import { directorChangeCommand, directorDraftIdentity, directorSetupSummary, restoredDirectorDraft } from "./project-settings-model";
import type { DirectorSelection, DirectorSettingsStatus } from "./project-settings-model";
import { DirectorSettingsReadGate } from "./director-settings-read";

export function DirectorSettingsPanel({ api, projectId, changed, refreshKey = 0, busyChanged, externalBusy = false, localSetupContainerId }: {
  api: StudioApi; projectId: string; changed(): void; refreshKey?: number; busyChanged?(busy: boolean): void; externalBusy?: boolean; localSetupContainerId?: string;
}) {
  const readOnly = useRecoveryReadOnly(), path = `/api/projects/${encodeURIComponent(projectId)}/director/setup`;
  const registry = pendingCommandsFor(api, "project-director-settings"), initial = useRef(restoredDirectorDraft(registry.snapshot(projectId)));
  const [status, setStatus] = useState<DirectorSettingsStatus | null>(null), [draft, setDraft] = useState<DirectorSelection>(initial.current ?? { mode: "fake" });
  const [checking, setChecking] = useState(true), [loadError, setLoadError] = useState(""), [formError, setFormError] = useState(""), [refresh, setRefresh] = useState(0);
  const dirty = useRef(!!initial.current), catalogRequests = useRef(new Set<string>()), catalogAbort = useRef<AbortController | null>(null);
  const statusReads = useRef(new DirectorSettingsReadGate());
  const [modelChecking, setModelChecking] = useState(false), [catalogError, setCatalogError] = useState("");
  const [setupContainer, setSetupContainer] = useState<HTMLElement | null>(null);
  useEffect(() => { setSetupContainer(localSetupContainerId ? document.getElementById(localSetupContainerId) : null); }, [localSetupContainerId]);
  const formId = `settings-director-form-${projectId}`;
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const observed = useRef(slot.settledVersion), notify = useRef(changed); notify.current = changed;
  useEffect(() => { busyChanged?.(slot.running || modelChecking); return () => busyChanged?.(false); }, [slot.running, modelChecking, busyChanged]);
  useEffect(() => {
    const abort = new AbortController();
    void statusReads.current.run(() => api.request<DirectorSettingsStatus>(path, { signal: abort.signal }), abort.signal, {
      start: () => { setChecking(true); setModelChecking(false); setLoadError(""); setCatalogError(""); },
      success: value => { setStatus(value); if (!dirty.current) setDraft(value.selection); },
      failure: error => setLoadError(errorText(error)),
      finish: () => setChecking(false),
    });
    return () => abort.abort();
  }, [api, path, refresh, refreshKey]);
  useEffect(() => {
    if (slot.settledVersion <= observed.current) return;
    observed.current = slot.settledVersion;
    if (slot.lastSuccess) { dirty.current = false; notify.current(); }
    setRefresh(value => value + 1);
  }, [slot.settledVersion, slot.lastSuccess]);
  const execute = (command: PendingCommand) => {
    if (readOnly) return;
    void registry.run(projectId, command, saved => api.request(saved.path, { method: "POST", body: saved.body, key: saved.key, timeoutMs: 90000 }),
      error => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code));
  };
  const loadModels = useCallback(() => {
    catalogAbort.current?.abort();
    const controller = new AbortController(); catalogAbort.current = controller;
    void statusReads.current.run(() => api.request<DirectorSettingsStatus>(`/api/projects/${encodeURIComponent(projectId)}/director/models`, { signal: controller.signal, timeoutMs: 90000 }), controller.signal, {
      start: () => { setModelChecking(true); setChecking(false); setCatalogError(""); },
      success: value => { setStatus(value); if (!dirty.current) setDraft(value.selection); setLoadError(""); },
      failure: error => setCatalogError(errorText(error)),
      finish: () => setModelChecking(false),
    });
  }, [api, projectId]);
  useEffect(() => () => catalogAbort.current?.abort(), [api, projectId]);
  useEffect(() => {
    if (draft.mode !== "native" || !status || status.busy || checking || modelChecking || slot.running || slot.command || externalBusy) return;
    if (status.modelCatalogStatus === "ready" || status.modelCatalogStatus === "blocked" || catalogRequests.current.has(status.selectionDigest)) return;
    catalogRequests.current.add(status.selectionDigest); loadModels();
  }, [draft.mode, status, checking, modelChecking, slot.running, slot.command, externalBusy, loadModels]);
  const edit = (value: DirectorSelection) => { dirty.current = true; setDraft(value); setFormError(""); };
  const disabled = externalBusy || readOnly || modelChecking || slot.running || !!slot.command || checking || !!loadError || !status || status.busy || !status.changeAvailable;
  const feedback = useRef<HTMLParagraphElement>(null);
  const hasChanges = !!status && directorDraftIdentity(draft) !== directorDraftIdentity(status.selection);
  useEffect(() => { if (!slot.running && (slot.command || slot.lastSuccess && !hasChanges && !checking)) feedback.current?.focus(); }, [slot.settledVersion, slot.running, slot.command, slot.lastSuccess, hasChanges, checking]);
  const accountSelection = status?.selection.mode === "native" ? status.selection : status?.defaults;
  const catalogMatchesDraft = draft.binaryPath === accountSelection?.binaryPath && (draft.codexHome ?? "") === (accountSelection?.codexHome ?? "");
  const modelChoices = catalogMatchesDraft ? status?.modelChoices ?? [] : [];
  const listed = modelChoices.some(model => model.id === draft.model);
  const requestedSelection = (slot.settledCommand?.body as { selection?: DirectorSelection } | undefined)?.selection;
  const recordedChoiceCurrent = !!status && !!requestedSelection && directorDraftIdentity(status.selection) === directorDraftIdentity(requestedSelection);
  const nativeSetupBlocked = status?.selection.mode === "native" && status.readinessSelectionDigest === status.selectionDigest && status.readiness?.status === "blocked";
  const localSetup = draft.mode === "native" ? <details className="settings-disclosure settings-local-setup"><summary>Director local setup<span>Installation and account</span></summary>
        <div className="settings-setup-content"><p className="field-help">{status ? directorSetupSummary(status) : "Loading local setup…"}</p>
          {!modelChoices.length && <><label htmlFor="director-custom-model">Model ID (when the list is unavailable)</label><input id="director-custom-model" form={formId} value={draft.model ?? ""} maxLength={120} disabled={disabled}
            onChange={event => edit({ ...draft, model: event.target.value })} placeholder="Model available to this Codex account" /></>}
          <label htmlFor="director-binary">Codex executable</label><input id="director-binary" form={formId} value={draft.binaryPath ?? ""} maxLength={4096} disabled={disabled}
            onChange={event => edit({ ...draft, binaryPath: event.target.value })} placeholder="Absolute path to Codex" />
          <label htmlFor="director-home">Codex account folder (optional)</label><input id="director-home" form={formId} value={draft.codexHome ?? ""} maxLength={4096} disabled={disabled}
            onChange={event => { const next = { ...draft }; if (event.target.value) next.codexHome = event.target.value; else delete next.codexHome; edit(next); }} placeholder="Your existing Codex login" />
          <p className="field-help">Leave the account folder blank to use your existing login. Billing follows that Codex sign-in: ChatGPT usage or API billing. API keys are not entered here.</p>
        </div>
      </details> : null;
  return <section className="project-settings-section settings-director" aria-labelledby="project-director-title">
    <form id={formId} onSubmit={event => { event.preventDefault(); if (disabled || !status || !hasChanges) return; try { execute(directorChangeCommand(projectId, status, draft, crypto.randomUUID())); setFormError(""); } catch (error) { setFormError(errorText(error)); } }}>
      <div className="settings-model-row"><div className="settings-job-copy"><label id="project-director-title" htmlFor="director-mode">Director</label><p>Plan and refine your film</p></div><div className="settings-model-control">
        <div className={draft.mode === "native" ? "settings-director-picker" : undefined}><select id="director-mode" value={draft.mode} disabled={disabled} onChange={event => {
          const mode = event.target.value as DirectorSelection["mode"];
          edit(mode === "fake" ? { mode } : { ...status?.defaults, ...(status?.selection.mode === "native" ? status.selection : {}), mode });
        }}><option value="native">Codex</option><option value="fake">Demo director</option></select>
          {draft.mode === "native" && <div><label className="sr-only" htmlFor="director-model">Director model</label><select id="director-model" value={draft.model ?? ""} disabled={disabled}
            onChange={event => edit({ ...draft, model: event.target.value })}>
              {!listed && <option value={draft.model ?? ""} disabled={status?.modelCatalogStatus === "ready" && modelChoices.length > 0}>{draft.model ? `${draft.model} · ${modelChoices.length ? "not in available models" : "current model ID"}` : "Choose a model"}</option>}
              {modelChoices.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select></div>}
        </div>
        <p className="settings-account-line">{draft.mode === "fake" ? "Demo · no model calls" : "Codex sign-in · next conversation turn"}</p>
        {status?.busy && <p role="status" className="settings-inline-issue">Available after the current conversation or setup finishes.</p>}
        {nativeSetupBlocked && <p className="settings-inline-issue">Codex setup needs attention. Open Accounts & local setup below.</p>}
        {draft.mode === "native" && modelChecking && <p role="status" className="field-help">Checking available models…</p>}
        {draft.mode === "native" && !modelChecking && (!modelChoices.length || catalogError) && <p className="field-help">{catalogError || "Model choices are unavailable for this setup."} <button type="button" className="text-button" disabled={slot.running || !!slot.command || externalBusy || !!status?.busy} onClick={loadModels}>Refresh models</button></p>}
        {hasChanges && <div className="settings-row-actions"><button type="submit" className="button small primary" disabled={disabled}>{slot.running ? "Checking and saving…" : "Save director"}</button><span>This saves the director choice.</span></div>}

      </div></div>

    </form>
    {localSetup && (setupContainer ? createPortal(localSetup, setupContainer) : localSetup)}
    {slot.command && !slot.running && <div className="notice warning"><p ref={feedback} tabIndex={-1}>The director save result was not confirmed. Your media choices are saved separately.</p><button type="button" className="button" disabled={readOnly || externalBusy} onClick={() => execute(slot.command!)}>Check saved director request</button></div>}
    {slot.lastSuccess && !slot.command && !hasChanges && <p ref={feedback} tabIndex={-1} role="status" className="settings-save-status">{recordedChoiceCurrent ? "Director choice saved. No conversation was started." : "Earlier director change recorded. The current choice is shown above."}</p>}
    {!!(loadError || formError || !slot.command && slot.error) && <p role="alert" className="form-error">{loadError || formError || errorText(slot.error)}</p>}
    {loadError && <button type="button" className="button small" onClick={() => setRefresh(value => value + 1)}>Reload director choices</button>}
    {checking && !status && <p role="status">Loading director choice…</p>}
  </section>;
}

/** Compatibility entry point until the app mounts the full Project settings shell. */
export function DirectorSettings({ api, projectId, close, changed }: { api: StudioApi; projectId: string; close(): void; changed(): void }) {
  return <div className="modal-scrim"><section className="settings-dialog" role="dialog" aria-modal="true" aria-label="Director settings"><IconButton type="button" className="text-button settings-close" onClick={close} label="Close director settings" icon="close" />
    <DirectorSettingsPanel api={api} projectId={projectId} changed={changed} /></section></div>;
}
