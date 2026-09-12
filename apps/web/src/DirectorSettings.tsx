import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { DirectorToolsSettings } from "./DirectorToolsSettings";
import { ProjectProviderSummary } from "./ProviderSettings";

interface Selection { mode: "fake" | "native"; binaryPath?: string; model?: string; codexHome?: string }
interface Settings { selection: Selection; defaults: Omit<Selection, "mode">; locked: boolean; modelCalls: number }
export function DirectorSettings({ api, projectId, close, changed }: { api: StudioApi; projectId: string; close(): void; changed(): void }) {
  const [settings, setSettings] = useState<Settings | null>(null), [selection, setSelection] = useState<Selection>({ mode: "native" });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<{ selection: Selection; key: string } | null>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement; dialog.current?.focus(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  const path = `/api/projects/${encodeURIComponent(projectId)}/director/setup`;
  useEffect(() => {
    const controller = new AbortController();
    void api.request<Settings>(path, { signal: controller.signal }).then(value => {
      setSettings(value); setSelection(value.selection.mode === "native" ? value.selection : { ...value.defaults, mode: "native" });
    }).catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [api, path]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !settings || settings.locked) return;
    const request = pending ?? { selection: selection.mode === "fake" ? { mode: "fake" as const } : selection, key: crypto.randomUUID() };
    setPending(request); setBusy(true); setError("");
    try { const result = await api.request<Settings>(path, { method: "POST", body: request.selection, key: request.key, timeoutMs: 90000 });
      setSettings(result); setSelection(result.selection); setPending(null); setSaved(true); changed();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <div className="modal-scrim" role="presentation"><section ref={dialog} tabIndex={-1} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="director-settings-title" onKeyDown={event => {
    if (event.key === "Escape" && !busy) { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary') ?? [])].filter(element => element.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  }}>
    <button className="text-button settings-close" onClick={close} disabled={busy}>Close</button>
    <span className="eyebrow">THIS PROJECT</span><h2 id="director-settings-title">Choose your director</h2>
    <p>Codex handles live conversations using its existing sign-in on this computer. Setup checks the connection without starting a model conversation.</p>
    {settings?.locked ? <div className="notice"><p>This project uses {settings.selection.mode === "native" ? `Codex (${settings.selection.model})` : "the demo director"}. Its conversation has already started. Create a new project to choose a different director.</p></div>
      : <form onSubmit={event => void submit(event)}>
        <label htmlFor="director-mode">Director</label><select id="director-mode" value={selection.mode} disabled={busy || !!pending} onChange={event => { setSelection(value => ({ ...value, mode: event.target.value as Selection["mode"] })); setSaved(false); }}>
          <option value="native">Codex · live conversation</option><option value="fake">Demo · sample workflow</option>
        </select>
        {selection.mode === "native" && <><label htmlFor="director-model">Model</label><input id="director-model" value={selection.model ?? ""} disabled={busy || !!pending} onChange={event => { setSelection(value => ({ ...value, model: event.target.value })); setSaved(false); }} />
          <details open={!selection.binaryPath}><summary>Local installation</summary><label htmlFor="director-binary">Codex executable</label><input id="director-binary" value={selection.binaryPath ?? ""} disabled={busy || !!pending} onChange={event => setSelection(value => ({ ...value, binaryPath: event.target.value }))} placeholder="Absolute path to Codex" />
            <p className="field-help">OpenSlate found this installation automatically when available. Authentication stays with Codex; no media keys are needed for conversation.</p></details></>}
        <button className="button primary full-width" disabled={busy || !settings}>{busy ? "Checking local setup…" : pending ? "Retry setup check" : selection.mode === "native" ? "Check and use Codex" : "Use demo director"}</button>
        {pending && !busy && <button type="button" className="text-button" onClick={() => setPending(null)}>Edit setup choices</button>}
      </form>}
    <DirectorToolsSettings key={projectId} api={api} projectId={projectId} />
    <ProjectProviderSummary key={`providers:${projectId}`} api={api} projectId={projectId} />
    {saved && <p role="status">Director ready. You can start the conversation.</p>}{error && <p role="alert" className="form-error">{error}</p>}
    {settings && <p className="field-help">Recorded conversation attempts: {settings.modelCalls}. This includes attempts reserved before dispatch; it is not a billing count.</p>}
  </section></div>;
}
