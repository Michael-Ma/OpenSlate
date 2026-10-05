import { IconButton } from "./components";
import { UiButton, UiSelect } from "./ui";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ApiError } from "./api";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import type { ProjectSnapshot } from "./model";
import { MODEL_KINDS, modelAppliedCurrent, modelAutomaticApplyCommand, modelDraftIdentity, restoredModelDraft, modelApplyCommand, modelPreviewCommand, modelPreviewCurrent, preservedWorkReason } from "./project-settings-model";
import type { CapturedModelPreview, ModelSelection, ModelScope, ModelSettingsStatus, ModelSettingsPreview, ModelSettingsApplied } from "./project-settings-model";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { providerEstimate, providerExecutionStatus, PROVIDER_KIND_CHOICES, providerSelectionForKind, selectedProviderForKind } from "./provider-model";
import type { ProviderCatalogView, ProviderKind, ProviderSelection, ProviderView } from "./provider-model";
import { selectedSettingsAccounts, settingsModelAccountLine, settingsModelLabel, settingsSetupIssue } from "./settings-presentation-model";
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
      <UiSelect id={`new-${kind}-profile`} value={selected(kind)?.id ?? ""} disabled={disabled || stale}
        options={catalog.profiles.filter(provider => provider.profile?.kind === kind).map(provider => ({ value: provider.id, label: settingsModelLabel(provider) }))}
        onValueChange={value => choose(kind, value)} />{selected(kind) && <p>{providerEstimate(selected(kind)!)}</p>}</div>)}
      <p>{selection ? PROVIDER_KIND_CHOICES.some(({ kind }) => selected(kind)?.profile?.adapter === "codex-image")
        ? "Saved for this project. Codex images use your subscription allowance; generation is reviewed in the studio."
        : "Saved for this project. Generation is reviewed in the studio with its spending allowance." : "Demo models are selected."}</p></>}
    {stale && <p role="alert">The model catalog changed. Refresh the choices before creating this project.</p>}
    {error && <p role="alert">{error} Reset the choices to create a default demo project.</p>}
    {(selection || error || stale) && <IconButton type="button" disabled={disabled} onClick={() => { changed(null); setRefresh(value => value + 1); }} label="Reset and refresh choices" icon="refresh" />}
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
    <IconButton type="button" onClick={() => setRefresh(value => value + 1)} label="Refresh model status" icon="refresh" />
  </section>;
}


function SelectedAccounts({ options, selected }: { options: ProviderView[]; selected: ModelSelection }) {
  const accounts = selectedSettingsAccounts(options, selected);
  return <div className="settings-setup-content"><ul className="settings-selected-accounts">{accounts.map(account => {
    const issues = account.providers.filter(provider => settingsSetupIssue(provider));
    return <li key={account.name}><div><strong>{account.name}</strong><span>{issues.length ? "Needs attention" : "Configured"}</span></div>
      {!!issues.length && <ul>{issues.map(provider => <li key={provider.id}>{settingsModelLabel(provider)}: {provider.projectExecution?.compatible === false
        ? provider.projectExecution.message ?? settingsSetupIssue(provider) : settingsSetupIssue(provider)}</li>)}</ul>}
    </li>;
  })}</ul>{!accounts.length && <p>Demo models need no accounts.</p>}
    <p className="field-help">Accounts are checked when used. API keys stay on this computer.</p>
    <details className="settings-local-help"><summary>Where setup lives</summary><p>Media keys and routes use the local server configuration. Restart OpenSlate after changing it. Codex images use the configured ChatGPT login; Director setup is below.</p></details>
  </div>;
}
export function ProviderSetupAccounts({ api, projectId, refreshKey = 0 }: { api: StudioApi; projectId: string; refreshKey?: number }) {
  const [status, setStatus] = useState<ModelSettingsStatus | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void api.request<ModelSettingsStatus>(`/api/projects/${encodeURIComponent(projectId)}/settings/models`, { signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) { setStatus(value); setError(""); } }).catch(error => { if (!abort.signal.aborted) setError(errorText(error)); });
    return () => abort.abort();
  }, [api, projectId, refreshKey]);
  return <section className="project-settings-section" aria-label="Selected media accounts">{status && <SelectedAccounts options={status.options} selected={status.selected} />}
    {!status && !error && <p role="status">Loading selected accounts…</p>}{error && <p role="alert" className="form-error">{error}</p>}</section>;
}
function ImpactList({ preview, options, snapshot }: { preview: ModelSettingsPreview; options: ProviderView[]; snapshot: ProjectSnapshot | undefined }) {
  const [changeLimit, setChangeLimit] = useState(40), [preservedLimit, setPreservedLimit] = useState(40);
  const name = (id: string) => id === "local-assembly" ? "Local assembly" : options.find(option => option.id === id) ? settingsModelLabel(options.find(option => option.id === id)!) : "Earlier saved model";
  const label = (row: ModelSettingsPreview["changes"][number] | ModelSettingsPreview["preserved"][number]) => {
    const shot = snapshot?.project.shots.find(value => value.id === row.shotId);
    if (!shot || !snapshot) return row.kind === "timeline" ? "Timeline" : row.kind === "render" ? "Export" : row.alias;
    const scene = snapshot.project.scenes.findIndex(value => value.id === shot.sceneId), index = snapshot.project.shots.filter(value => value.sceneId === shot.sceneId).findIndex(value => value.id === shot.id);
    return `Shot ${scene + 1}.${index + 1} · ${shot.purpose}`;
  };
  const media = preview.changes.filter(row => MODEL_KINDS.includes(row.kind as ProviderKind));
  const assembly = preview.changes.filter(row => !MODEL_KINDS.includes(row.kind as ProviderKind));
  return <div className="settings-impact-lists">
    {!!media.length && <ul>{media.slice(0, changeLimit).map(row => <li key={row.nodeId}><strong>{label(row)}</strong><span>{name(row.fromProfileId)} → {name(row.toProfileId)}</span></li>)}</ul>}
    {changeLimit < media.length && <UiButton type="button" variant="ghost" className="text-button" onClick={() => setChangeLimit(value => value + 40)}>Show more changed work</UiButton>}
    {!!assembly.length && <p className="field-help">{assembly.length} dependent timeline/export {assembly.length === 1 ? "step will" : "steps will"} be prepared from the changed media.</p>}
    <details><summary>Work being kept · {preview.counts.preserved}</summary>
      {preview.preserved.length ? <><ul>{preview.preserved.slice(0, preservedLimit).map(row => <li key={row.nodeId}><strong>{label(row)}</strong><span>{preservedWorkReason(row.reason)}</span></li>)}</ul>
        {preservedLimit < preview.preserved.length && <UiButton type="button" variant="ghost" className="text-button" onClick={() => setPreservedLimit(value => value + 40)}>Show more kept work</UiButton>}</> : <p>No existing work is excluded.</p>}
    </details>
  </div>;
}
export function ProjectModelsSettings({ api, projectId, snapshot, changed, onContinue, refreshKey = 0, busyChanged, externalBusy = false, children }: {
  api: StudioApi; projectId: string; snapshot?: ProjectSnapshot; changed(): void; onContinue?(): void; refreshKey?: number; busyChanged?(busy: boolean): void; externalBusy?: boolean; children?: ReactNode;
}) {
  const readOnly = useRecoveryReadOnly(), base = `/api/projects/${encodeURIComponent(projectId)}/settings/models`;
  const registry = pendingCommandsFor(api, "project-model-settings"), continuations = pendingCommandsFor(api, "project-model-continuation");
  const initial = useRef(restoredModelDraft(registry.snapshot(projectId))), dirty = useRef(!!initial.current);
  const [status, setStatus] = useState<ModelSettingsStatus | null>(null), [selected, setSelected] = useState<ModelSelection>(initial.current?.selected ?? { image: null, video: null, speech: null, transcription: null });
  const [scope] = useState<ModelScope>(initial.current?.scope ?? { kind: "unfinished" }), [captured, setCaptured] = useState<CapturedModelPreview | null>(initial.current?.captured ?? null);
  const [checking, setChecking] = useState(true), [loadError, setLoadError] = useState(""), [formError, setFormError] = useState(""), [refresh, setRefresh] = useState(0);
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]), useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const continuation = useSyncExternalStore(useCallback(listener => continuations.subscribe(projectId, listener), [continuations, projectId]), useCallback(() => continuations.snapshot(projectId), [continuations, projectId]));
  const automaticApplies = useRef(new Set<string>());
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
  const continueWithDirector = (command: PendingCommand) => {
    if (readOnly || externalBusy) return;
    void continuations.run(projectId, command, saved => api.request(saved.path, { method: "POST", body: saved.body, key: saved.key }), uncertain);
  };
  const disabled = externalBusy || readOnly || busy || !!slot.command || !!continuation.command || checking || !!loadError || !status;
  const currentPreview = modelPreviewCurrent(captured, status, selected, scope, checking, !!loadError, snapshot?.project.headVersion);
  const applied = slot.lastSuccess && slot.settledCommand?.path.endsWith("/apply") ? slot.result as ModelSettingsApplied : null;
  const hasChanges = !!status && modelDraftIdentity(selected, scope) !== modelDraftIdentity(status.selected, scope);
  useEffect(() => {
    if (readOnly || externalBusy || slot.running || slot.command || continuation.running || continuation.command) return;
    const command = modelAutomaticApplyCommand(captured, status, selected, scope, slot.settledCommand, checking, !!loadError, snapshot?.project.headVersion);
    if (!command || automaticApplies.current.has(command.key)) return;
    automaticApplies.current.add(command.key);
    execute(command);
  }, [captured, status, selected, scope, slot.settledCommand, slot.running, slot.command, continuation.running, continuation.command, checking, loadError, snapshot?.project.headVersion, readOnly, externalBusy]);
  const feedback = useRef<HTMLParagraphElement>(null), reviewHeading = useRef<HTMLHeadingElement>(null), imageChoice = useRef<HTMLButtonElement>(null), returnToChoices = useRef(false);
  useEffect(() => { if (!captured && returnToChoices.current) { returnToChoices.current = false; imageChoice.current?.focus(); } }, [captured]);
  useEffect(() => { if (!slot.running && (slot.command || applied && !hasChanges && !checking)) feedback.current?.focus(); }, [slot.settledVersion, slot.running, slot.command, applied, hasChanges, checking]);
  const accountCount = selectedSettingsAccounts(status?.options ?? [], selected).length;
  const zeroImpactSaving = !!captured && currentPreview && captured.preview.counts.changed === 0
    && !!(slot.settledCommand?.metadata as { zeroImpactApplyKey?: string } | undefined)?.zeroImpactApplyKey && !slot.error;
  useEffect(() => { if (captured && !applied && !zeroImpactSaving && !slot.running && !slot.command) { reviewHeading.current?.focus(); reviewHeading.current?.scrollIntoView({ block: "start" }); } }, [captured?.preview.id, applied, zeroImpactSaving, slot.running, slot.command]);
  const mediaChanges = captured?.preview.changes.filter(row => MODEL_KINDS.includes(row.kind as ProviderKind)) ?? [];
  const changedTitle = mediaChanges.length ? `Update ${mediaChanges.length} unfinished media ${mediaChanges.length === 1 ? "item" : "items"}?` : "Save media model choices?";
  const modelRow = (kind: ProviderKind, label: string, description: string) => {
    const choices = status?.options.filter(provider => provider.profile?.kind === kind) ?? [], provider = choices.find(provider => provider.id === selected[kind]);
    return <div className="settings-model-row" key={kind}><div className="settings-job-copy"><label htmlFor={`settings-model-${kind}`}>{label}</label><p>{description}</p></div><div className="settings-model-control">
      <UiSelect ref={kind === "image" ? imageChoice : undefined} id={`settings-model-${kind}`} value={selected[kind] ?? ""} disabled={disabled || !!captured}
        options={[...(!selected[kind] ? [{ value: "", label: "No current model" }] : []), ...(selected[kind] && !provider ? [{ value: selected[kind]!, label: "Saved model unavailable" }] : []), ...choices.map(choice => ({ value: choice.id, label: settingsModelLabel(choice) }))]}
        onValueChange={choice => { dirty.current = true; setSelected(value => ({ ...value, [kind]: choice || null })); setFormError(""); }} />
      <p className={`settings-account-line${provider && settingsSetupIssue(provider) ? " settings-inline-issue" : ""}`}>{provider ? settingsModelAccountLine(provider) : "Choose an available model"}</p>
    </div></div>;
  };
  return <section className="project-settings-section settings-media" aria-label="Media model choices">
    {slot.command && !slot.running && <div className="notice warning"><p ref={feedback} tabIndex={-1}>Media save unconfirmed. Check the saved request before changing choices.</p><UiButton type="button" disabled={readOnly || externalBusy || continuation.running} onClick={() => execute(slot.command!)}>Check saved media request</UiButton></div>}
    {!!(loadError || formError || !slot.command && slot.error || !continuation.command && continuation.error) && <p role="alert" className="form-error">{loadError || formError || errorText(slot.error ?? continuation.error)}</p>}
    {applied && !slot.command && !hasChanges && <p ref={feedback} tabIndex={-1} role="status" className="settings-save-status">{modelAppliedCurrent(applied, status, checking, !!loadError) ? "Media models saved. Existing results and jobs kept." : "Earlier media change recorded. Reload to see current choices."}</p>}
    {modelRow("image", "Keyframes", "Create the look of each shot")}
    {modelRow("video", "Video", "Bring approved shots to life")}
    {modelRow("speech", "Narration", "Generate speech when needed")}
    <details className="settings-disclosure"><summary>Other models<span>Transcription</span></summary>{modelRow("transcription", "Transcription", "Find words and timing in audio")}</details>
    <details className="settings-disclosure"><summary>Accounts & local setup<span>{accountCount ? `${accountCount} media ${accountCount === 1 ? "account" : "accounts"}` : "Demo models"}</span></summary>
      {status && <SelectedAccounts options={status.options} selected={selected} />}{children}
    </details>
    {!captured && hasChanges && <div className="settings-media-actions">{hasChanges && <span>Future plans and eligible unfinished work.</span>}<UiButton type="button" variant="primary" disabled={disabled || !hasChanges} onClick={() => {
      if (!status) return; try { const command = modelPreviewCommand(status, selected, scope, snapshot?.project.shots.map(shot => shot.id) ?? [], crypto.randomUUID());
        command.metadata = { ...(command.metadata as Record<string, unknown>), zeroImpactApplyKey: crypto.randomUUID() }; execute(command); setFormError("");
      } catch (error) { setFormError(errorText(error)); }
    }}>{slot.running ? "Saving media choices…" : "Save media models"}</UiButton></div>}
    {captured && !applied && !zeroImpactSaving && !slot.command && <div className="settings-impact" aria-labelledby="settings-impact-title"><h3 id="settings-impact-title" ref={reviewHeading} tabIndex={-1}>{changedTitle}</h3>
      {scope.kind === "shots" && <p className="field-help">This saved change applies to {scope.shotIds.length} selected shots.</p>}
      <ImpactList key={captured.preview.id} preview={captured.preview} options={status?.options ?? []} snapshot={snapshot} />
      <p>Completed results, active jobs and reviewed audio are kept.</p>
      {!currentPreview && <p role="alert">The project or choices changed. Reload and review again.</p>}
      <div className="settings-actions"><UiButton type="button" variant="primary" disabled={disabled || !currentPreview} onClick={() => execute(modelApplyCommand(captured, crypto.randomUUID()))}>Apply media changes</UiButton>
        <UiButton type="button" disabled={busy || !!slot.command} onClick={() => { returnToChoices.current = true; setCaptured(null); }}>Back to choices</UiButton></div>
    </div>}
    {busy && !zeroImpactSaving && <p role="status" className="settings-save-status">{continuation.running ? "Checking the saved planning request…" : "Saving media choices…"}</p>}
    {zeroImpactSaving && <p role="status" className="settings-save-status">Saving the reviewed media choices…</p>}
    {continuation.command && !continuation.running && <div className="notice warning"><p>An earlier planning continuation was not confirmed.</p><UiButton type="button" disabled={readOnly || externalBusy} onClick={() => continueWithDirector(continuation.command!)}>Check saved continuation</UiButton></div>}
    {(!slot.command && (loadError || slot.error || captured && !currentPreview)) && <UiButton type="button" className="small" disabled={busy || !!slot.command} onClick={() => { setCaptured(null); setRefresh(value => value + 1); }}>Reload model choices</UiButton>}
    {checking && !status && <p role="status">Loading model choices…</p>}
  </section>;
}
