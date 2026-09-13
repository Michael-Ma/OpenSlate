import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import { budgetCommand, canSelectSpending, reviewSpending, revokeSpending, spendingModelSettings, spendingMoney, spendingPage, spendingReviewCurrent } from "./spending-model";
import type { SpendingCandidate, SpendingReview, SpendingState } from "./spending-model";
import type { ProjectSnapshot } from "./model";
import "./spending.css";

type Props = { api: StudioApi; snapshot: ProjectSnapshot; onChanged(): void };
export function SpendingPanel(props: Props) { return <SpendingWorkspace key={props.snapshot.project.id} {...props} />; }
function ProjectBudgetControls({ projectId, budget, disabled, execute }: { projectId: string; budget: SpendingState["projectBudget"]; disabled: boolean; execute(command: PendingCommand): void }) {
  const [dollars, setDollars] = useState(spendingMoney(budget.capMicros).slice(1, -4));
  const [command, setCommand] = useState<PendingCommand | null>(null), [error, setError] = useState("");
  const body = command?.body as { expectedCapMicros: string; capMicros: string } | undefined;
  return <details className="budget-controls"><summary>Change project estimate limit</summary>
    <p>This independent limit applies to all generation in this project. Changing it does not issue a work allowance, approve keyframes, cancel work or change existing charges.</p>
    {!command ? <form onSubmit={event => { event.preventDefault(); try { setCommand(budgetCommand(projectId, budget, dollars, crypto.randomUUID())); setError(""); } catch (error) { setError(errorText(error)); } }}>
      <label htmlFor="project-budget-usd">New project limit · USD</label><input id="project-budget-usd" inputMode="decimal" value={dollars} maxLength={24} disabled={disabled} onChange={event => setDollars(event.target.value)} />
      <button className="button small" disabled={disabled}>Review project limit</button>
    </form> : <div className="budget-review"><p>Change the configured project estimate limit from <strong>{spendingMoney(body!.expectedCapMicros)}</strong> to <strong>{spendingMoney(body!.capMicros)}</strong>.</p>
      <p>Reserved or committed now: {spendingMoney(budget.committedMicros)}. A lower limit only restricts future admissions; it does not refund or cancel existing work.</p>
      <div className="spending-actions"><button className="button primary" disabled={disabled} onClick={() => execute(command)}>Save project limit</button><button className="button small" disabled={disabled} onClick={() => setCommand(null)}>Back to amount</button></div>
    </div>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </details>;
}
function SpendingWorkspace({ api, snapshot, onChanged }: Props) {
  const projectId = snapshot.project.id, base = `/api/projects/${encodeURIComponent(projectId)}/spending`;
  const [state, setState] = useState<SpendingState | null>(null), [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<SpendingReview | null>(null), [reviewError, setReviewError] = useState("");
  const [offsets, setOffsets] = useState({ candidates: 0, allowances: 0 }), [refresh, setRefresh] = useState(0);
  const registry = pendingCommandsFor(api, "spending");
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId, listener), [registry, projectId]),
    useCallback(() => registry.snapshot(projectId), [registry, projectId]));
  const changed = useRef(onChanged); changed.current = onChanged;
  const observed = useRef(0);
  useEffect(() => {
    if (slot.settledVersion <= observed.current) return;
    observed.current = slot.settledVersion;
    if (slot.lastSuccess) { setReview(null); setSelected([]); }
    setRefresh(value => value + 1); changed.current();
  }, [slot.settledVersion, slot.lastSuccess]);
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.request<SpendingState>(`${base}?candidateOffset=${offsets.candidates}&allowanceOffset=${offsets.allowances}`, { signal: abort.signal });
        if (!abort.signal.aborted) { setState(next); setLoadError(""); }
      } catch (error) { if (!abort.signal.aborted) setLoadError(errorText(error)); }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 4000); }
    };
    setState(null); void poll(); return () => { abort.abort(); clearTimeout(timer); };
  }, [api, base, offsets.candidates, offsets.allowances, refresh, snapshot.project.headVersion]);
  function execute(command: PendingCommand) {
    setReviewError("");
    void registry.run(projectId, command, saved => api.request(saved.path, { method: "POST", body: saved.body, key: saved.key }),
      error => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code));
  }
  const busy = slot.running || !!slot.command;
  const confirmed = !!review && !loadError && spendingReviewCurrent(review, state);
  const profileIds = [...new Set(state?.candidates.map(candidate => candidate.profileId).filter((value): value is string => !!value) ?? [])];
  const selectedProfile = state?.candidates.find(candidate => selected.includes(candidate.candidateId))?.profileId;
  const select = (candidate: SpendingCandidate) => {
    setReview(null); setReviewError("");
    setSelected(ids => ids.includes(candidate.candidateId) ? ids.filter(id => id !== candidate.candidateId) : [...ids, candidate.candidateId]);
  };
  const page = (kind: "candidates" | "allowances", next: number) => { setSelected([]); setReview(null); setOffsets(value => ({ ...value, [kind]: next })); };
  const rowLabel = (candidate: SpendingCandidate) => {
    const shotIndex = snapshot.project.shots.findIndex(shot => shot.id === candidate.shotId);
    return `${shotIndex >= 0 ? `Shot ${shotIndex + 1}` : candidate.alias} · ${candidate.operation === "image" ? "keyframe" : candidate.operation}`;
  };
  if (state && !state.coverage.candidates.total && !state.coverage.allowances.total && !slot.command && !slot.error && !review && !slot.lastSuccess) return null;
  return <section className="spending-panel" aria-labelledby="spending-title">
    <div className="spending-heading"><div><span className="eyebrow">YOUR GENERATION LIMITS</span><h3 id="spending-title">Review generation costs</h3></div><button className="text-button" disabled={slot.running} onClick={() => setRefresh(value => value + 1)}>Refresh costs</button></div>
    <p>Approve spending for specific work. Keyframe review remains a separate step before video generation.</p>
    <p className="spending-disabled">Paid execution is not enabled in this build. Recorded allowances can be used if it is enabled before they expire.</p>
    {!!(loadError || reviewError || slot.error) && <p role="alert" className="form-error">{loadError || reviewError || errorText(slot.error)}</p>}
    {!state && !loadError && <p role="status">Loading current work and saved allowances…</p>}
    {slot.command && <div className="notice warning"><span>{slot.running ? "Saving your exact spending request…" : "The result was not confirmed. Retry the saved request to check its outcome."}</span>{!slot.running && <button onClick={() => execute(slot.command!)}>Retry same spending action</button>}</div>}
    {slot.lastSuccess && !slot.command && <p role="status">Your spending change was recorded.</p>}
    {state && <><p className="spending-budget">Project estimate limit: <strong>{spendingMoney(state.projectBudget.capMicros)}</strong> · Reserved or committed: {spendingMoney(state.projectBudget.committedMicros)}. This independent project limit is not raised by an allowance.</p>
      <ProjectBudgetControls key={`${projectId}:${state.projectBudget.revision}:${state.projectBudget.capMicros}`} projectId={projectId} budget={state.projectBudget} disabled={busy || !!review || !!loadError} execute={execute} />
      {profileIds.map(profileId => <fieldset key={profileId} className="spending-group" disabled={busy || !!review || !!loadError}>
        <legend>{state.candidates.find(candidate => candidate.profileId === profileId)?.providerDisplay?.model ?? "Saved model details unavailable"}</legend>
        {state.candidates.filter(candidate => candidate.profileId === profileId).map(candidate => <label key={candidate.candidateId} className="spending-work">
          <input type="checkbox" checked={selected.includes(candidate.candidateId)} disabled={!canSelectSpending(candidate) || !!selectedProfile && selectedProfile !== profileId} onChange={() => select(candidate)} />
          <span><strong>{rowLabel(candidate)}</strong>{candidate.providerDisplay && <small>{spendingModelSettings(candidate.providerDisplay)} · profile {candidate.providerDisplay.id} ({candidate.providerDisplay.revision})</small>}<small>{candidate.estimatedMicros !== null ? `${spendingMoney(candidate.estimatedMicros)} configured estimate / attempt` : "Estimate unavailable"}</small>
            <small>{(candidate.matchingAllowanceCount ?? 0) > 0 ? "Matching allowance recorded; remaining limits are shared." : canSelectSpending(candidate) ? "Available for cost review" : candidate.workState === "uncertain" ? "Outcome uncertain · waiting for recovery" : candidate.workState === "completed" ? "Completed" : candidate.workState === "in_progress" ? "Already in progress" : "Not available for another attempt"}</small></span>
        </label>)}
      </fieldset>)}
      {!review && selected.length > 0 && <div className="spending-actions"><button className="button small" disabled={busy || !!loadError} onClick={() => {
        try { const next = reviewSpending(state, selected, crypto.randomUUID()); setReview({ ...next, labels: selected.map(id => rowLabel(state.candidates.find(candidate => candidate.candidateId === id)!)) }); setReviewError(""); }
        catch (error) { setReviewError(errorText(error)); }
      }}>Review allowance for {selected.length} {selected.length === 1 ? "item" : "items"}</button><button className="text-button" disabled={busy} onClick={() => { setSelected([]); setReviewError(""); }}>Clear selected work</button></div>}
      {spendingPage(state.coverage.candidates, 100).visible && <nav className="spending-pagination" aria-label="Generation work pages"><span>{spendingPage(state.coverage.candidates, 100).label}</span>
        <button disabled={busy || offsets.candidates === 0} onClick={() => page("candidates", Math.max(0, offsets.candidates - 100))}>Previous work</button>
        <button disabled={busy || state.coverage.candidates.nextOffset === null} onClick={() => page("candidates", state.coverage.candidates.nextOffset!)}>Next work</button></nav>}
    </>}
    {review && <div className="spending-review" aria-labelledby="allowance-review-title"><h4 id="allowance-review-title">Approve this spending allowance</h4>
      <p><strong>{review.providerDisplay.model}</strong> · {spendingModelSettings(review.providerDisplay)} · {spendingMoney(review.unitMicros)} configured estimate per attempt</p>
      <p>Saved profile: {review.providerDisplay.id} ({review.providerDisplay.revision})</p>
      <ul>{review.labels.map((label, index) => <li key={index}>{label}</li>)}</ul>
      <p>Up to <strong>{review.body.maxAttempts} generation {review.body.maxAttempts === 1 ? "start" : "starts"}</strong>, with a total configured estimate of <strong>{spendingMoney(review.body.maxEstimatedMicros)}</strong>. Expires {new Date(review.body.expiresAt).toLocaleString()}.</p>
      <p>These are configured estimates, not guaranteed provider bills. Every admitted attempt uses a start and its estimate, even if it later fails. This does not permit replacing a result for quality reasons.</p>
      {!confirmed && !busy && <p role="alert">The selected work is no longer current or could not be refreshed. Return to selection before approving.</p>}
      <div className="spending-actions"><button className="button primary" disabled={busy || !confirmed} onClick={() => execute(review.command)}>Approve spending allowance</button>
        <button className="button small" disabled={busy} onClick={() => { setReview(null); setSelected([]); }}>Back to selection</button></div>
    </div>}
    {!!state?.allowances.length && <details className="spending-history" open><summary>Saved allowances · {state.coverage.allowances.total}</summary>
      {state.allowances.map(allowance => <div key={allowance.id}><strong>{allowance.providerDisplay?.model ?? "Historical model details unavailable"} · {allowance.status.replaceAll("_", " ")}</strong>
        {allowance.providerDisplay && <p>{spendingModelSettings(allowance.providerDisplay)} · profile {allowance.providerDisplay.id} ({allowance.providerDisplay.revision})</p>}
        <ul>{allowance.work.map(work => <li key={work.candidateId}>{work.historyAvailable ? `${work.alias} · ${work.operation === "image" ? "keyframe" : work.operation ?? "work"}${work.current ? "" : " · historical work"}` : "Historical work details unavailable"}</li>)}</ul>
        <p>Recorded {new Date(allowance.createdAt).toLocaleString()} · allowance {allowance.id.slice(0, 8)}</p>
        <p>{allowance.usedAttempts} / {allowance.maxAttempts} starts used · {spendingMoney(allowance.usedEstimatedMicros)} / {spendingMoney(allowance.maxEstimatedMicros)} configured estimate used</p>
        <p>Expires {new Date(allowance.expiresAt).toLocaleString()}</p>
        {!allowance.revoked && !allowance.expired && <button disabled={busy} onClick={() => execute(revokeSpending(projectId, allowance.id, crypto.randomUUID()))}>Revoke remaining allowance</button>}
      </div>)}
      <p>Revocation stops future starts. It does not cancel work already admitted or imply a refund.</p>
      {spendingPage(state.coverage.allowances, 40).visible && <nav className="spending-pagination" aria-label="Allowance history pages"><button disabled={busy || offsets.allowances === 0} onClick={() => page("allowances", Math.max(0, offsets.allowances - 40))}>Newer allowances</button><button disabled={busy || state.coverage.allowances.nextOffset === null} onClick={() => page("allowances", state.coverage.allowances.nextOffset!)}>Older allowances</button></nav>}
    </details>}
  </section>;
}
