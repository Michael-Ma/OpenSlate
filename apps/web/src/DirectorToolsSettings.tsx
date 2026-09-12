import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";

interface ToolStatus { currentVersion: string; lockId: string | null; lockDigest: string | null; upgradeAvailable: boolean; busy: boolean }

export function DirectorToolsSettings({ api, projectId }: { api: StudioApi; projectId: string }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/director/tools`;
  const registry = pendingCommandsFor(api, "director-tools");
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const [status, setStatus] = useState<ToolStatus | null>(null), [loadError, setLoadError] = useState("");
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const result = await api.request<ToolStatus>(base, { signal: abort.signal }); if (!abort.signal.aborted) { setStatus(result); setLoadError(""); } }
      catch (error) { if (!abort.signal.aborted) setLoadError(errorText(error)); }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), 4000); }
    };
    void refresh(); return () => { abort.abort(); clearTimeout(timer); };
  }, [api, base, slot.settledVersion]);
  function execute(command: PendingCommand) {
    void registry.run(projectId, command, saved => api.request(saved.path, { method: "POST", body: saved.body, key: saved.key }),
      error => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code));
  }
  return <section aria-label="Narration drafting tools">
    <h3>Narration drafting</h3>
    {status?.upgradeAvailable ? <>
      <p>Enable updated project guidance so the director can write narration drafts for your review. Accepted narration still requires your review of its words, recording and timing.</p>
      {status.busy && <p role="status">Wait for the current conversation and setup to finish before updating.</p>}
      <button type="button" className="button secondary" disabled={status.busy || slot.running || !!slot.command}
        onClick={() => { if (!status.lockId || !status.lockDigest) return; execute({ path: `${base}/upgrade`,
          body: { expectedLockId: status.lockId, expectedLockDigest: status.lockDigest, targetVersion: "2.0.0" }, key: crypto.randomUUID() }); }}>Enable narration drafting</button>
    </> : status?.currentVersion === "2.0.0" ? <p>This project uses the latest narration guidance. In a live conversation, Codex can draft text for your review.</p>
      : status ? <p>This project's saved guidance requires a different application version.</p> : <p role="status">Loading project guidance…</p>}
    {slot.running && <p role="status">Updating this project's guidance…</p>}
    {slot.command && !slot.running && <div className="notice warning"><p>The update result was not confirmed.</p>
      <button type="button" onClick={() => execute(slot.command!)}>Check the same update</button></div>}
    {(slot.error || loadError) && <p role="alert" className="form-error">{slot.error ? errorText(slot.error) : loadError}</p>}
  </section>;
}
