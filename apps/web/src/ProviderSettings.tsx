import { useEffect, useState } from "react";
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
    <p>Saved when this project was created. Choose different models in a new project.</p>
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
