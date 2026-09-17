import { useProjectRefreshVersion } from "./project-updates";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import { recoveryReleaseCommand, recoveryReviewCurrent } from "./recovery-model";
import type { RecoveryState } from "./recovery-model";
import "./recovery.css";

export const RecoveryReadOnly = createContext(false);
export const useRecoveryReadOnly = () => useContext(RecoveryReadOnly);
export function RecoveryPanel({ api, refreshKey, onState, onChanged }: {
  api: StudioApi; refreshKey: number; onState(readOnly: boolean): void; onChanged(): void;
}) {
  const projectUpdate = useProjectRefreshVersion();
  const [state, setState] = useState<RecoveryState | null>(null), [loadError, setLoadError] = useState("");
  const [review, setReview] = useState<PendingCommand | null>(null), [refresh, setRefresh] = useState(0);
  const registry = pendingCommandsFor(api, "installation-recovery"), slotId = "installation";
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(slotId, listener), [registry]),
    useCallback(() => registry.snapshot(slotId), [registry]));
  const callbacks = useRef({ onState, onChanged }); callbacks.current = { onState, onChanged };
  const previous = useRef<RecoveryState["state"] | null>(null), observed = useRef(0);
  useEffect(() => {
    if (slot.settledVersion <= observed.current) return;
    observed.current = slot.settledVersion;
    if (slot.lastSuccess) setReview(null);
    setRefresh(value => value + 1); callbacks.current.onChanged();
  }, [slot.settledVersion, slot.lastSuccess]);
  useEffect(() => {
    const abort = new AbortController();
    const poll = async () => {
      try {
        const next = await api.request<RecoveryState>("/api/installation/recovery", { signal: abort.signal });
        if (abort.signal.aborted) return;
        setState(next); setLoadError(""); callbacks.current.onState(next.state === "quarantined");
        if (previous.current && previous.current !== next.state) callbacks.current.onChanged();
        previous.current = next.state;
      } catch (error) { if (abort.signal.aborted) return; setLoadError(errorText(error)); callbacks.current.onState(true); }

    };
    void poll(); return () => { abort.abort(); };
  }, [api, refreshKey, refresh, projectUpdate]);
  function execute(command: PendingCommand) {
    void registry.run(slotId, command, saved => api.request(saved.path, { method: "POST", body: saved.body, key: saved.key }),
      error => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code));
  }
  if (!state || loadError) return <div className="notice warning" role="status"><span>{loadError ? `Recovery status could not be checked. ${loadError}` : "Checking local recovery status…"}</span><button onClick={() => setRefresh(value => value + 1)}>Check again</button></div>;
  if (state.state === "ordinary" && !slot.command) return null;
  const current = !loadError && recoveryReviewCurrent(review, state), counts = state.counts;
  return <section className="recovery-panel" aria-labelledby="recovery-title">
    <div className="recovery-heading"><div><span className="eyebrow">RESTORED LOCAL WORKSPACE</span><h2 id="recovery-title">{state.state === "quarantined" ? "Review your recovery" : "Recovery review completed"}</h2></div><button className="text-button" onClick={() => setRefresh(value => value + 1)}>Refresh recovery</button></div>
    {state.state === "quarantined" ? <><p>Your saved projects and media are available to inspect. Changes, generation and director requests are paused until you finish this review.</p>
      <p>Backup created: <strong>{state.receipt ? new Date(state.receipt.backupCreatedAt).toLocaleString() : "Unavailable"}</strong>. Work completed after that backup may be absent.</p>
      <dl className="recovery-counts"><div><dt>Projects</dt><dd>{counts.projects}</dd></div><div><dt>Known pending jobs</dt><dd>{counts.knownJobs}</dd></div><div><dt>Uncertain jobs</dt><dd>{counts.unknownJobs}</dd></div>{!!counts.preparingJobs && <div><dt>Local preparation, not submitted</dt><dd>{counts.preparingJobs}</dd></div>}<div><dt>Saved director requests</dt><dd>{counts.nativeRequests}</dd></div><div><dt>Unused saved allowances</dt><dd>{counts.unusedAllowances}</dd></div></dl>
      {!!counts.preparingJobs && <p>These restored preparations did not reach provider submission. They stay stopped after recovery release; starting new work requires fresh generation permissions and spending review.</p>}
      <p>Uncertain work stays unresolved. Existing job results can be recovered after release; old unused permissions cannot start new generation. Previously reserved or spent amounts remain recorded.</p>
      {!review && !slot.command && <button className="button" onClick={() => setReview(recoveryReleaseCommand(state, crypto.randomUUID()))}>Review release</button>}
      {review && !slot.command && <div className="recovery-decision"><p>{current ? "Finish recovery review for this exact backup and job summary. Each project will remain paused. Use a fresh conversation and new spending review for new generation." : "The recovery summary changed. Review the current state again before continuing."}</p><button className="button primary" disabled={!current || slot.running} onClick={() => execute(review)}>Finish recovery review</button><button className="text-button" onClick={() => setReview(null)}>Back to inspection</button></div>}
    </> : <p>Recovery release kept projects paused. Existing job results may now be recovered. Send a fresh conversation message when you are ready to continue a project. New generation needs fresh permissions and spending review.</p>}
    {slot.command && <div className="notice warning" role="status"><span>{slot.running ? "Saving your recovery decision…" : "The recovery decision was not confirmed. Retry the same saved decision to check its outcome."}</span>{!slot.running && <button onClick={() => execute(slot.command!)}>Retry recovery decision</button>}</div>}
    {!!slot.error && <p className="form-error" role="alert">{errorText(slot.error)}</p>}
  </section>;
}
