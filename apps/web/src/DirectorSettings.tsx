import { useRecoveryReadOnly } from "./RecoveryPanel";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { DirectorToolsSettings } from "./DirectorToolsSettings";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import { directorChangeCommand, directorSetupSummary } from "./project-settings-model";
import type { DirectorSelection, DirectorSettingsStatus } from "./project-settings-model";

export function DirectorSettingsPanel({ api, projectId, changed, refreshKey = 0, busyChanged }: {
  api: StudioApi; projectId: string; changed(): void; refreshKey?: number; busyChanged?(busy: boolean): void;
}) {
  const readOnly = useRecoveryReadOnly(), path = `/api/projects/${encodeURIComponent(projectId)}/director/setup`;
  const [status, setStatus] = useState<DirectorSettingsStatus | null>(null), [draft, setDraft] = useState<DirectorSelection>({ mode: "fake" });
  const [checking, setChecking] = useState(true), [loadError, setLoadError] = useState(""), [formError, setFormError] = useState(""), [refresh, setRefresh] = useState(0);
  const dirty = useRef(false), registry = pendingCommandsFor(api, "project-director-settings");
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const observed = useRef(slot.settledVersion), notify = useRef(changed); notify.current = changed;
  useEffect(() => { busyChanged?.(slot.running); return () => busyChanged?.(false); }, [slot.running, busyChanged]);
  useEffect(() => {
    const abort = new AbortController(); setChecking(true); setLoadError("");
    void api.request<DirectorSettingsStatus>(path, { signal: abort.signal }).then(value => {
      if (abort.signal.aborted) return;
      setStatus(value); if (!dirty.current) setDraft(value.selection);
    }).catch(error => { if (!abort.signal.aborted) setLoadError(errorText(error)); })
      .finally(() => { if (!abort.signal.aborted) setChecking(false); });
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
  const edit = (value: DirectorSelection) => { dirty.current = true; setDraft(value); setFormError(""); };
  const disabled = readOnly || slot.running || !!slot.command || checking || !!loadError || !status || status.busy || !status.changeAvailable;
  return <section className="project-settings-section" aria-labelledby="project-director-title">
    <div className="project-settings-section-heading"><div><h3 id="project-director-title">Conversation director</h3><p>Choose who helps plan this film. Media models and their usage approvals are separate.</p></div>
      <button type="button" className="text-button" disabled={slot.running} onClick={() => setRefresh(value => value + 1)}>Refresh status</button></div>
    {status && <div className="settings-status-card"><strong>{status.selection.mode === "fake" ? "Demo director" : status.selection.model ?? "Codex"}</strong><span>{directorSetupSummary(status)}</span></div>}
    {status?.busy && <p role="status" className="notice">The current conversation or setup check must finish first. This control does not interrupt it.</p>}
    <form onSubmit={event => { event.preventDefault(); if (disabled || !status) return; try { execute(directorChangeCommand(projectId, status, draft, crypto.randomUUID())); setFormError(""); } catch (error) { setFormError(errorText(error)); } }}>
      <div className="settings-field-grid"><div><label htmlFor="director-mode">Director</label><select id="director-mode" value={draft.mode} disabled={disabled} onChange={event => {
        const mode = event.target.value as DirectorSelection["mode"];
        edit(mode === "fake" ? { mode } : { ...status?.defaults, ...(status?.selection.mode === "native" ? status.selection : {}), mode });
      }}><option value="native">Codex · live conversation</option><option value="fake">Demo · sample workflow</option></select></div>
      {draft.mode === "native" && <div><label htmlFor="director-model">Conversation model</label><input id="director-model" value={draft.model ?? ""} maxLength={120} disabled={disabled}
        onChange={event => edit({ ...draft, model: event.target.value })} placeholder="Model available to your Codex account" /></div>}</div>
      <p className="settings-billing">{draft.mode === "fake" ? "Demo uses a sample workflow and makes no model calls." : "Billing follows the selected Codex sign-in: ChatGPT usage or API billing. A folder name does not verify the account or its quota."}</p>
      {draft.mode === "native" && <details className="settings-advanced"><summary>Advanced local setup</summary>
        <label htmlFor="director-binary">Codex executable</label><input id="director-binary" value={draft.binaryPath ?? ""} maxLength={4096} disabled={disabled}
          onChange={event => edit({ ...draft, binaryPath: event.target.value })} placeholder="Absolute path to Codex" />
        <label htmlFor="director-home">Codex account folder (optional)</label><input id="director-home" value={draft.codexHome ?? ""} maxLength={4096} disabled={disabled}
          onChange={event => { const next = { ...draft }; if (event.target.value) next.codexHome = event.target.value; else delete next.codexHome; edit(next); }} placeholder="Default: your existing Codex account" />
        <p>Leave the account folder blank for your existing login, or choose a separate account folder for an API-key login. Keep your ChatGPT account available separately if using Codex images. Keys are not entered here.</p>
      </details>}
      <p>Changes apply to the next conversation turn. Existing conversation history, generated assets and media jobs keep their original identities. This setup check starts no model turn.</p>
      <div className="settings-actions"><button type="submit" className="button primary" disabled={disabled}>{slot.running ? "Checking and saving…" : draft.mode === "native" ? "Check setup and use for next turn" : "Use demo for next turn"}</button></div>
    </form>
    {slot.command && !slot.running && <div className="notice warning"><p>The result was not confirmed. Check the same saved request before making another choice.</p><button type="button" className="button secondary" disabled={readOnly} onClick={() => execute(slot.command!)}>Check same director change</button></div>}
    {slot.lastSuccess && !slot.command && <p role="status">Director-change request recorded. Current settings are shown above; no conversation was started.</p>}
    {!!(loadError || formError || slot.error) && <p role="alert" className="form-error">{loadError || formError || errorText(slot.error)}</p>}
    {checking && <p role="status">Loading current director settings…</p>}
    {status && <p className="field-help">Recorded conversation attempts: {status.modelCalls}. This includes reserved attempts and is not a billing count.</p>}
    <details className="settings-advanced"><summary>Project guidance</summary><DirectorToolsSettings key={projectId} api={api} projectId={projectId} /></details>
  </section>;
}

/** Compatibility entry point until the app mounts the full Project settings shell. */
export function DirectorSettings({ api, projectId, close, changed }: { api: StudioApi; projectId: string; close(): void; changed(): void }) {
  return <div className="modal-scrim"><section className="settings-dialog" role="dialog" aria-modal="true" aria-label="Director settings"><button type="button" className="text-button settings-close" onClick={close}>Close</button>
    <DirectorSettingsPanel api={api} projectId={projectId} changed={changed} /></section></div>;
}
