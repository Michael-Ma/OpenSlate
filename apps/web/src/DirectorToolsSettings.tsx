import { useProjectRefreshVersion } from "./project-updates";
import { useRecoveryReadOnly } from "./RecoveryPanel";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { pendingCommandsFor } from "./pending-command";
import { UiButton } from "./ui";
import type { PendingCommand } from "./pending-command";

interface ToolStatus { currentVersion: string; availableVersion: string; lockId: string | null; lockDigest: string | null; upgradeAvailable: boolean; busy: boolean }

export function DirectorToolsSettings({ api, projectId }: { api: StudioApi; projectId: string }) {
  const projectUpdate = useProjectRefreshVersion();
  const recoveryReadOnly = useRecoveryReadOnly();
  const base = `/api/projects/${encodeURIComponent(projectId)}/director/tools`;
  const registry = pendingCommandsFor(api, "director-tools");
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const [status, setStatus] = useState<ToolStatus | null>(null), [loadError, setLoadError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const refresh = async () => {
      try { const result = await api.request<ToolStatus>(base, { signal: abort.signal }); if (!abort.signal.aborted) { setStatus(result); setLoadError(""); } }
      catch (error) { if (!abort.signal.aborted) setLoadError(errorText(error)); }

    };
    void refresh(); return () => { abort.abort(); };
  }, [api, base, slot.settledVersion, projectUpdate]);
  function execute(command: PendingCommand) {
    if (recoveryReadOnly) return;
    void registry.run(projectId, command, saved => api.request(saved.path, { method: "POST", body: saved.body, key: saved.key }),
      error => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code));
  }
  return <section aria-label="Narration guidance">
    <h3>Narration guidance</h3>
    {status?.upgradeAvailable ? <>
      <p>Update saved guidance to support shot narration and audio plans. Generation is reviewed in the studio.</p>
      {status.busy && <p role="status">Wait for the current conversation and setup to finish before updating.</p>}
      <UiButton type="button" disabled={recoveryReadOnly || status.busy || slot.running || !!slot.command}
        onClick={() => { if (!status.lockId || !status.lockDigest) return; execute({ path: `${base}/upgrade`,
          body: { expectedLockId: status.lockId, expectedLockDigest: status.lockDigest, targetVersion: status.availableVersion }, key: crypto.randomUUID() }); }}>Update guidance</UiButton>
    </> : status?.currentVersion === "4.0.0" ? <p>Current guidance supports shot narration and audio plans.</p>
      : status ? <p>This project's saved guidance requires a different application version.</p> : <p role="status">Loading project guidance…</p>}
    {slot.running && <p role="status">Updating this project's guidance…</p>}
    {slot.command && !slot.running && <div className="notice warning"><p>The update result was not confirmed.</p>
      <UiButton type="button" disabled={recoveryReadOnly} onClick={() => execute(slot.command!)}>Check saved update</UiButton></div>}
    {(slot.error || loadError) && <p role="alert" className="form-error">{slot.error ? errorText(slot.error) : loadError}</p>}
  </section>;
}
