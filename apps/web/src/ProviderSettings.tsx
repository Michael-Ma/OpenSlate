import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import { activeProjectEdit, pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import type { ProjectSnapshot } from "./model";
import { MODEL_KINDS, modelAppliedCurrent, modelContinuationSent, restoredModelDraft, modelApplyCommand, modelPreviewCommand, modelPreviewCurrent, modelSettingsContinuation, preservedWorkReason } from "./project-settings-model";
import type { CapturedModelPreview, ModelSelection, ModelScope, ModelSettingsStatus, ModelSettingsPreview, ModelSettingsApplied } from "./project-settings-model";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { providerEstimate, providerExecutionStatus, PROVIDER_KIND_CHOICES, providerSelectionForKind, selectedProviderForKind } from "./provider-model";
import type { ProviderCatalogView, ProviderKind, ProviderSelection, ProviderView } from "./provider-model";
import "./providers.css";

export function NewProjectProviderFields({ api, selection, changed, disabled }: {
  api: StudioApi; selection: ProviderSelection | null; changed(value: ProviderSelection | null): void; disabled: boolean;
}) {
  const [catalog, setCatalog] = useState<ProviderCatalogView | null>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError("");
    void api.request<ProviderCatalogView>("/api/providers", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setCatalog(value); })
      .catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [api, refresh]);
  const stale = !!selection && !!catalog && selection.expectedCatalogDigest !== catalog.catalogDigest;
  const selected = (kind: ProviderKind) => catalog ? selectedProviderForKind(catalog, selection, kind) : undefined;
  function choose(kind: ProviderKind, id: string) {
    if (!catalog || stale || disabled) return;
    try { changed(providerSelectionForKind(catalog, selection, kind, id)); } catch (cause) { setError(errorText(cause)); }
  }
  return <details className="new-provider-fields"><summary>Media models</summary>
    {!catalog && !error && <p role="status">Loading model choices…</p>}
    {catalog && <>{PROVIDER_KIND_CHOICES.map(({ kind, label }) => <div key={kind}><label htmlFor={`new-${kind}-profile`}>{label}</label>
      <select id={`new-${kind}-profile`} value={selected(kind)?.id ?? ""} disabled={disabled || stale} onChange={event => choose(kind, event.target.value)}>
        {catalog.profiles.filter(provider => provider.profile?.kind === kind).map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
      </select>{selected(kind) && <p>{providerEstimate(selected(kind)!)}</p>}</div>)}
      <p>{selection ? PROVIDER_KIND_CHOICES.some(({ kind }) => selected(kind)?.profile?.adapter === "codex-image")
        ? "These models will be saved for this project. Codex image starts require a separate, finite Codex usage approval. Quota use is not estimated; there is no automatic switch to the image API."
        : "These models will be saved for this project. Generation also requires model readiness and your exact spending allowance." : "Demo models are selected. No paid media calls."}</p></>}
    {stale && <p role="alert">The model catalog changed. Refresh the choices before creating this project.</p>}
    {error && <p role="alert">{error} Reset the choices to create a default demo project.</p>}
    {(selection || error || stale) && <button type="button" disabled={disabled} onClick={() => { changed(null); setRefresh(value => value + 1); }}>Reset and refresh choices</button>}
  </details>;
}

export function ProjectProviderSummary({ api, projectId }: { api: StudioApi; projectId: string }) {
  const [providers, setProviders] = useState<ProviderView[] | null>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError(""); setProviders(null);
    void api.request<{ profiles: ProviderView[] }>(`/api/projects/${encodeURIComponent(projectId)}/providers`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setProviders(value.profiles); }).catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [api, projectId, refresh]);
  return <section className="project-provider-summary" aria-labelledby="project-provider-title"><h3 id="project-provider-title">Media models</h3>
    <p>Current project model choices. Completed assets and existing jobs keep the models used to create them.</p>
    {!providers && !error && <p role="status">Loading saved models…</p>}
    {providers && <ul>{providers.map(provider => <li key={provider.id}><strong>{provider.label}</strong>
      <span>{provider.profile?.configuration?.model ?? (provider.profile?.adapter === "fake" ? "Demo model" : "Saved model unavailable")}</span>
      <span>{providerEstimate(provider)}</span>
      {provider.readiness.credential.required && <span>{provider.readiness.credential.backendUnavailable ? "Credential status unavailable" : provider.readiness.credential.present ? "API key configured · not checked with provider" : "API key not configured"}</span>}
      {provider.readiness.nativeAccess && <span>{provider.readiness.nativeAccess.configured ? "Local Codex runtime configured" : "Local Codex runtime unavailable"} · authentication checked before each start · quota unverified</span>}
      {provider.readiness.mediaTools.required && !provider.readiness.mediaTools.available && <span>Local media tools unavailable</span>}
      {provider.readiness.spendingPermissionRequired && <span>{providerExecutionStatus(provider)}</span>}
    </li>)}</ul>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button type="button" className="text-button" onClick={() => setRefresh(value => value + 1)}>Refresh model status</button>
  </section>;
}


function billingRoute(provider: ProviderView): string {
  const adapter = provider.profile?.adapter;
  return adapter === "fake" ? "Demo · no model account" : adapter === "codex-image" ? "Codex subscription usage"
    : adapter === "viggle-h3" ? "Viggle API billing" : adapter === "minimax-h3" ? "MiniMax API billing"
      : adapter?.startsWith("openai-") ? "OpenAI API billing" : "Saved provider account";
}
function ProviderStatusLines({ provider }: { provider: ProviderView }) {
  return <><span className="settings-billing">{billingRoute(provider)}</span><span>{providerEstimate(provider)}</span>
    {provider.readiness.credential.required && <span>{provider.readiness.credential.backendUnavailable ? "Account setup status unavailable" : provider.readiness.credential.present ? "API key configured · access has not been checked with the provider" : "API key is not configured on this computer"}</span>}
    {provider.readiness.nativeAccess && <span>{provider.readiness.nativeAccess.configured ? "Local Codex installation configured" : "Local Codex installation missing"} · authentication is checked before each start · quota unverified</span>}
    {provider.readiness.mediaTools.required && !provider.readiness.mediaTools.available && <span>Local media tools need setup</span>}
    {provider.readiness.spendingPermissionRequired && <span>{providerExecutionStatus(provider)}</span>}</>;
}
export function ProviderSetupAccounts({ api, projectId, refreshKey = 0 }: { api: StudioApi; projectId: string; refreshKey?: number }) {
  const [status, setStatus] = useState<ModelSettingsStatus | null>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError("");
    void api.request<ModelSettingsStatus>(`/api/projects/${encodeURIComponent(projectId)}/settings/models`, { signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) setStatus(value); }).catch(error => { if (!abort.signal.aborted) setError(errorText(error)); });
    return () => abort.abort();
  }, [api, projectId, refresh, refreshKey]);
  return <section className="project-settings-section" aria-labelledby="settings-accounts-title">
    <div className="project-settings-section-heading"><div><h3 id="settings-accounts-title">Setup & accounts</h3><p>These providers use separate accounts. Saving model choices does not enable a provider or approve its usage.</p></div>
      <button type="button" className="text-button" onClick={() => setRefresh(value => value + 1)}>Refresh setup status</button></div>
    {error && <p role="alert" className="form-error">{error} Previously shown setup information may be out of date.</p>}
    {!status && !error && <p role="status">Loading provider setup…</p>}
    <div className="settings-account-grid">{status?.options.map(provider => <article key={provider.id} className="settings-account-card"><h4>{provider.label}</h4>
      {MODEL_KINDS.some(kind => status.selected[kind] === provider.id) && <span className="settings-badge">Selected for this project</span>}
      <ProviderStatusLines provider={provider} /></article>)}</div>
    <details className="settings-advanced"><summary>Where account and installation settings live</summary><p>Media API keys and generation switches are configured on the local server. Codex images require a ChatGPT login; they do not fall back to the image API. The conversation director has its own account folder under the Director tab.</p>
      <p>Never paste keys into the conversation. Setup status does not verify a current balance, quota or final provider charge.</p></details>
  </section>;
}
function ImpactList({ preview, options }: { preview: ModelSettingsPreview; options: ProviderView[] }) {
  const [changeLimit, setChangeLimit] = useState(40), [preservedLimit, setPreservedLimit] = useState(40);
  const name = (id: string) => id === "local-assembly" ? "Local assembly" : options.find(option => option.id === id)?.label ?? "Earlier saved model";
  return <div className="settings-impact-lists">
    <h4>Unfinished operations to change · {preview.counts.changed}</h4>
    {preview.changes.length ? <><ul>{preview.changes.slice(0, changeLimit).map(row => <li key={row.nodeId}><strong>{row.alias}</strong><span>{row.kind === "timeline" || row.kind === "render" ? "Rebuild from the changed media in the next reviewed plan" : `${name(row.fromProfileId)} → ${name(row.toProfileId)}`}</span></li>)}</ul>
      {changeLimit < preview.changes.length && <button type="button" className="text-button" onClick={() => setChangeLimit(value => value + 40)}>Show more changed work</button>}</> : <p>No existing operation will be rewritten. New defaults can still affect future plans.</p>}
    <details open={preview.preserved.some(row => row.reason === "protected_dependency" || row.reason === "in_flight")}><summary>Work being kept · {preview.counts.preserved}</summary>
      {preview.preserved.length ? <><ul>{preview.preserved.slice(0, preservedLimit).map(row => <li key={row.nodeId}><strong>{row.alias}</strong><span>{preservedWorkReason(row.reason)}</span></li>)}</ul>
        {preservedLimit < preview.preserved.length && <button type="button" className="text-button" onClick={() => setPreservedLimit(value => value + 40)}>Show more kept work</button>}</> : <p>No existing work is excluded.</p>}</details>
  </div>;
}
export function ProjectModelsSettings({ api, projectId, snapshot, changed, onContinue, refreshKey = 0, busyChanged }: {
  api: StudioApi; projectId: string; snapshot?: ProjectSnapshot; changed(): void; onContinue?(): void; refreshKey?: number; busyChanged?(busy: boolean): void;
}) {
  const readOnly = useRecoveryReadOnly(), base = `/api/projects/${encodeURIComponent(projectId)}/settings/models`;
  const registry = pendingCommandsFor(api, "project-model-settings"), continuations = pendingCommandsFor(api, "project-model-continuation");
  const initial = useRef(restoredModelDraft(registry.snapshot(projectId))), dirty = useRef(!!initial.current);
  const [status, setStatus] = useState<ModelSettingsStatus | null>(null), [selected, setSelected] = useState<ModelSelection>(initial.current?.selected ?? { image: null, video: null, speech: null, transcription: null });
  const [scope, setScope] = useState<ModelScope>(initial.current?.scope ?? { kind: "unfinished" }), [captured, setCaptured] = useState<CapturedModelPreview | null>(initial.current?.captured ?? null);
  const [checking, setChecking] = useState(true), [loadError, setLoadError] = useState(""), [formError, setFormError] = useState(""), [refresh, setRefresh] = useState(0);
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]), useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const continuation = useSyncExternalStore(useCallback(listener => continuations.subscribe(projectId, listener), [continuations, projectId]), useCallback(() => continuations.snapshot(projectId), [continuations, projectId]));
  const observed = useRef(slot.settledVersion), observedContinuation = useRef(continuation.settledVersion), notify = useRef(changed), navigate = useRef(onContinue); notify.current = changed; navigate.current = onContinue;
  const busy = slot.running || continuation.running;
  useEffect(() => { busyChanged?.(busy); return () => busyChanged?.(false); }, [busy, busyChanged]);
  useEffect(() => {
    const abort = new AbortController(); setChecking(true); setLoadError("");
    void api.request<ModelSettingsStatus>(base, { signal: abort.signal }).then(value => {
      if (abort.signal.aborted) return; setStatus(value); if (!dirty.current) setSelected(value.selected);
    }).catch(error => { if (!abort.signal.aborted) setLoadError(errorText(error)); }).finally(() => { if (!abort.signal.aborted) setChecking(false); });
    return () => abort.abort();
  }, [api, base, refresh, refreshKey, snapshot?.project.headVersion]);
  useEffect(() => {
    if (slot.settledVersion <= observed.current) return;
    observed.current = slot.settledVersion;
    if (slot.lastSuccess && slot.settledCommand?.path.endsWith("/preview")) {
      const metadata = slot.settledCommand.metadata as { draftIdentity: string };
      setCaptured({ preview: slot.result as ModelSettingsPreview, draftIdentity: metadata.draftIdentity });
    } else if (slot.lastSuccess && slot.settledCommand?.path.endsWith("/apply")) {
      const result = slot.result as ModelSettingsApplied; dirty.current = false; setCaptured(null); setStatus(result.status); setSelected(result.status.selected); setRefresh(value => value + 1); notify.current();
    }
  }, [slot.settledVersion, slot.lastSuccess, slot.result, slot.settledCommand]);
  useEffect(() => {
    if (continuation.settledVersion <= observedContinuation.current) return;
    observedContinuation.current = continuation.settledVersion;
    if (continuation.lastSuccess) { notify.current(); navigate.current?.(); }
  }, [continuation.settledVersion, continuation.lastSuccess]);
  const uncertain = (error: unknown) => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code);
  const execute = (command: PendingCommand) => { if (!readOnly) void registry.run(projectId, command, saved => api.request(saved.path, { method: "POST", body: saved.body, key: saved.key, timeoutMs: 90000 }), uncertain); };
  const continueWithDirector = (command?: PendingCommand) => {
    if (readOnly || !snapshot || !applied || (!command && continuationSent)) return;
    try { const request = command ?? modelSettingsContinuation(projectId, crypto.randomUUID(), activeProjectEdit(snapshot.messages, projectId), applied.receipt);
      void continuations.run(projectId, request, saved => api.request(saved.path, { method: "POST", body: saved.body, key: saved.key }), uncertain);
    } catch (error) { setFormError(errorText(error)); }
  };
  const disabled = readOnly || busy || !!slot.command || !!continuation.command || checking || !!loadError || !status;
  const currentPreview = modelPreviewCurrent(captured, status, selected, scope, checking, !!loadError, snapshot?.project.headVersion);
  const applied = slot.lastSuccess && slot.settledCommand?.path.endsWith("/apply") ? slot.result as ModelSettingsApplied : null;
  const continuationSent = modelContinuationSent(applied, continuation);
  return <section className="project-settings-section" aria-labelledby="project-models-title">
    <div className="project-settings-section-heading"><div><h3 id="project-models-title">Models & usage</h3><p>Choose models for future plans and safely replace eligible unfinished work. Completed assets, in-flight jobs and their required inputs are kept.</p></div>
      <button type="button" className="text-button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh choices</button></div>
    <div className="settings-model-grid">{PROVIDER_KIND_CHOICES.map(({ kind, label }) => {
      const choices = status?.options.filter(provider => provider.profile?.kind === kind) ?? [], provider = choices.find(provider => provider.id === selected[kind]);
      return <article className="settings-model-card" key={kind}><label htmlFor={`settings-model-${kind}`}>{label}</label>
        <select id={`settings-model-${kind}`} value={selected[kind] ?? ""} disabled={disabled || !!captured} onChange={event => { dirty.current = true; setSelected(value => ({ ...value, [kind]: event.target.value || null })); setFormError(""); }}>
          {!selected[kind] && <option value="">No current model</option>}{selected[kind] && !provider && <option value={selected[kind]!}>Saved model unavailable</option>}
          {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select>
        {provider ? <ProviderStatusLines provider={provider} /> : <p>Choose an available model before reviewing a change for this type of work.</p>}</article>;
    })}</div>
    <fieldset className="settings-scope" disabled={disabled || !!captured}><legend>Where should these choices apply?</legend>
      <label><input type="radio" name="settings-scope" checked={scope.kind === "unfinished"} onChange={() => setScope({ kind: "unfinished" })} /> All eligible unfinished work</label>
      <label><input type="radio" name="settings-scope" checked={scope.kind === "shots"} disabled={!snapshot?.project.shots.length} onChange={() => setScope({ kind: "shots", shotIds: [] })} /> Selected shots</label>
      {scope.kind === "shots" && <div className="settings-shot-choices">{snapshot?.project.shots.map((shot, index) => <label key={shot.id}><input type="checkbox" checked={scope.shotIds.includes(shot.id)} onChange={event => {
        const checked = event.target.checked; setScope(value => value.kind === "shots" ? { kind: "shots", shotIds: checked ? [...value.shotIds, shot.id] : value.shotIds.filter(id => id !== shot.id) } : value);
      }} /> Shot {index + 1}<span>{shot.purpose}</span></label>)}</div>}
      <p>Protected dependencies and work with separate reviewed audio plans are excluded. Preview the exact impact before applying.</p>
    </fieldset>
    {!captured && <button type="button" className="button primary" disabled={disabled} onClick={() => { if (!status) return; try {
      execute(modelPreviewCommand(status, selected, scope, snapshot?.project.shots.map(shot => shot.id) ?? [], crypto.randomUUID())); setFormError("");
    } catch (error) { setFormError(errorText(error)); } }}>Preview model changes</button>}
    {captured && <div className="settings-impact" aria-labelledby="settings-impact-title"><span className="eyebrow">REVIEW BEFORE APPLYING</span><h3 id="settings-impact-title">Model change impact</h3>
      <p>{captured.preview.notice}</p><ImpactList key={captured.preview.id} preview={captured.preview} options={status?.options ?? []} />
      <p>Applying settings starts no generation. Changed work needs a new director plan and generation approval; real providers also need a separate spending or Codex usage allowance.</p>
      {!currentPreview && <p role="alert">These choices or the project changed, or current settings could not be verified. Refresh and preview again.</p>}
      <div className="settings-actions"><button type="button" className="button primary" disabled={disabled || !currentPreview} onClick={() => execute(modelApplyCommand(captured, crypto.randomUUID()))}>Apply model changes</button>
        <button type="button" className="button secondary" disabled={busy || !!slot.command} onClick={() => setCaptured(null)}>Back to choices</button></div></div>}
    {slot.command && !slot.running && <div className="notice warning"><p>The settings request was not confirmed. Check the same request before changing its scope or models.</p><button type="button" className="button secondary" disabled={readOnly || continuation.running} onClick={() => execute(slot.command!)}>Check same settings request</button></div>}
    {applied && !slot.command && <div className="settings-saved" role="status"><h4>{modelAppliedCurrent(applied, status, checking, !!loadError) ? "Model choices saved" : "Earlier model change recorded"}</h4><p>{modelAppliedCurrent(applied, status, checking, !!loadError) ? "These saved choices are current." : "Refresh to see the current choices; an older request does not replace later settings."} Completed results and existing jobs were kept. Nothing was generated or authorized to spend.</p>
      <p>Continue with the director to prepare and review the next plan.</p><button type="button" className="button primary" disabled={readOnly || busy || !!continuation.command || !snapshot || continuationSent} onClick={() => continueWithDirector()}>{continuationSent ? "Continuation sent" : "Continue with director"}</button></div>}
    {continuation.command && !continuation.running && <div className="notice warning"><p>Your continuation was not confirmed.</p><button type="button" className="button secondary" disabled={readOnly} onClick={() => continueWithDirector(continuation.command!)}>Check same continuation</button></div>}
    {!!(loadError || formError || slot.error || continuation.error) && <p role="alert" className="form-error">{loadError || formError || errorText(slot.error ?? continuation.error)}</p>}
    {checking && <p role="status">Loading current choices…</p>}{busy && <p role="status">{continuation.running ? "Sending your continuation…" : "Saving this exact settings request…"}</p>}
  </section>;
}
