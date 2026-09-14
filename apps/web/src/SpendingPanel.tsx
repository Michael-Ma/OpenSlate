import { useRecoveryReadOnly } from "./RecoveryPanel";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import { errorText } from "./components";
import { pendingCommandsFor } from "./pending-command";
import type { PendingCommand } from "./pending-command";
import { budgetCommand, canSelectSpending, isCodexSpending, reviewSpending, spendingAllowanceUsage, spendingEstimate, revokeSpending, spendingAllowanceStatus, spendingAudioSummary, spendingModelSettings, spendingMoney, spendingOperationLabel, spendingPage, spendingReviewCurrent, spendingWorkStatus } from "./spending-model";
import type { SpendingCandidate, SpendingReview, SpendingState } from "./spending-model";
import type { ProjectSnapshot } from "./model";
import "./spending.css";

type Props = { api: StudioApi; snapshot: ProjectSnapshot; onChanged(): void; focus?: { candidateId: string; requestId: string } };
export function SpendingPanel(props: Props) { return <SpendingWorkspace key={props.snapshot.project.id} {...props} />; }
function ProjectBudgetControls({ projectId, budget, disabled, execute, codexUsage }: { projectId: string; budget: SpendingState["projectBudget"]; disabled: boolean; codexUsage: boolean; execute(command: PendingCommand): void }) {
  const [dollars, setDollars] = useState(spendingMoney(budget.capMicros).slice(1, -4));
  const [command, setCommand] = useState<PendingCommand | null>(null), [error, setError] = useState("");
  const body = command?.body as { expectedCapMicros: string; capMicros: string } | undefined;
  return <details className="budget-controls"><summary>Change project estimate limit</summary>
    <p>{codexUsage ? "This limit tracks USD estimates and does not limit Codex subscription quota. Changing it does not issue a work allowance, approve keyframes, cancel work or change existing charges." : "This independent limit applies to all generation in this project. Changing it does not issue a work allowance, approve keyframes, cancel work or change existing charges."}</p>
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
function SpendingWorkspace({ api, snapshot, onChanged, focus }: Props) {
  const recoveryReadOnly = useRecoveryReadOnly();
  const projectId = snapshot.project.id, base = `/api/projects/${encodeURIComponent(projectId)}/spending`;
  const [state, setState] = useState<SpendingState | null>(null), [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<SpendingReview | null>(null), [reviewError, setReviewError] = useState("");
  const [offsets, setOffsets] = useState({ candidates: 0, allowances: 0 }), [refresh, setRefresh] = useState(0);
  const [focusCandidateId, setFocusCandidateId] = useState<string | null>(null);
  const focusedRequest = useRef<string | null>(null), selectedFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || focusedRequest.current === focus.requestId) return;
    focusedRequest.current = focus.requestId; selectedFocus.current = null;
    setFocusCandidateId(focus.candidateId); setSelected([]); setReview(null); setReviewError("");
    setOffsets(value => ({ ...value, candidates: 0 })); setRefresh(value => value + 1);
  }, [focus?.candidateId, focus?.requestId]);
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
        const query = new URLSearchParams({ allowanceOffset: String(offsets.allowances),
          ...(focusCandidateId ? { focusCandidateId } : { candidateOffset: String(offsets.candidates) }) });
        const next = await api.request<SpendingState>(`${base}?${query}`, { signal: abort.signal });
        if (!abort.signal.aborted) {
          setState(next); setLoadError("");
          if (focusCandidateId && next.focus?.candidateId === focusCandidateId && selectedFocus.current !== focusedRequest.current) {
            const candidate = next.candidates.find(item => item.candidateId === focusCandidateId);
            selectedFocus.current = focusedRequest.current;
            setSelected(candidate && canSelectSpending(candidate) ? [candidate.candidateId] : []);
            document.getElementById("spending-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      } catch (error) { if (!abort.signal.aborted) setLoadError(errorText(error)); }
      finally { if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 4000); }
    };
    setState(null); void poll(); return () => { abort.abort(); clearTimeout(timer); };
  }, [api, base, offsets.candidates, offsets.allowances, focusCandidateId, refresh, snapshot.project.headVersion]);
  function execute(command: PendingCommand) {
    if (recoveryReadOnly) return;
    setReviewError("");
    void registry.run(projectId, command, saved => api.request(saved.path, { method: "POST", body: saved.body, key: saved.key }),
      error => !(error instanceof ApiError) || ["NETWORK_ERROR", "INTERNAL_ERROR", "REQUEST_FAILED"].includes(error.code));
  }
  const busy = slot.running || !!slot.command;
  const confirmed = !!review && !loadError && spendingReviewCurrent(review, state);
  const profileIds = [...new Set(state?.candidates.map(candidate => candidate.profileId).filter((value): value is string => !!value) ?? [])];
  const codexUsage = !!state && (state.candidates.some(candidate => isCodexSpending(candidate.providerDisplay)) || state.allowances.some(allowance => isCodexSpending(allowance.providerDisplay)));
  const selectedProfile = state?.candidates.find(candidate => selected.includes(candidate.candidateId))?.profileId;
  const select = (candidate: SpendingCandidate) => {
    setReview(null); setReviewError("");
    setSelected(ids => ids.includes(candidate.candidateId) ? ids.filter(id => id !== candidate.candidateId) : [...ids, candidate.candidateId]);
  };
  const page = (kind: "candidates" | "allowances", next: number) => { setSelected([]); setReview(null);
    if (kind === "candidates") setFocusCandidateId(null);
    setOffsets(value => ({ ...value, [kind]: next })); };
  const rowLabel = (candidate: SpendingCandidate) => {
    const shotIndex = snapshot.project.shots.findIndex(shot => shot.id === candidate.shotId);
    return `${shotIndex >= 0 ? `Shot ${shotIndex + 1}` : candidate.alias} · ${spendingOperationLabel(candidate.operation)}`;
  };
  if (state && !state.coverage.candidates.total && !state.coverage.allowances.total && !slot.command && !slot.error && !review && !slot.lastSuccess && !focusCandidateId) return null;
  return <section className="spending-panel" aria-labelledby="spending-title">
    <div className="spending-heading"><div><span className="eyebrow">YOUR GENERATION LIMITS</span><h3 id="spending-title">{codexUsage ? "Review generation costs and Codex usage" : "Review generation costs"}</h3></div><button className="text-button" disabled={slot.running} onClick={() => setRefresh(value => value + 1)}>{codexUsage ? "Refresh limits" : "Refresh costs"}</button></div>
    <p>{codexUsage ? "Approve API spending or finite Codex starts for specific work." : "Approve spending for specific work."} Permission to generate the exact creative work remains separate, as does keyframe review before video generation.</p>
    <p className="spending-disabled">{codexUsage ? "Generation requires enabled providers and local tools. API providers also need a key and sufficient USD budget; Codex checks authentication before each start and its quota remains unverified. There is no automatic switch from Codex to the image API." : "Generation also requires enabled provider configuration, available local tools, a configured API key and sufficient project budget."} An allowance does not provide that setup, accept narration or authorize a new creative change.</p>
    {!!(loadError || reviewError || slot.error) && <p role="alert" className="form-error">{loadError || reviewError || errorText(slot.error)}</p>}
    {!state && !loadError && <p role="status">Loading current work and saved allowances…</p>}
    {state?.focus && <p role="status">{state.focus.found ? "Showing the work from your recording review. Review its allowance below before approving spending." : "That recording operation is no longer current. Return to its recording review before selecting new work."}</p>}
    {slot.command && <div className="notice warning"><span>{slot.running ? "Saving your exact spending request…" : "The result was not confirmed. Retry the saved request to check its outcome."}</span>{!slot.running && <button disabled={recoveryReadOnly} onClick={() => execute(slot.command!)}>Retry same spending action</button>}</div>}
    {slot.lastSuccess && !slot.command && <p role="status">Your spending change was recorded.</p>}
    {state && <><p className="spending-budget">Project estimate limit: <strong>{spendingMoney(state.projectBudget.capMicros)}</strong> · Reserved or committed: {spendingMoney(state.projectBudget.committedMicros)}. This independent project limit is not raised by an allowance.{codexUsage && " Codex subscription quota is outside this USD limit."}</p>
      <ProjectBudgetControls key={`${projectId}:${state.projectBudget.revision}:${state.projectBudget.capMicros}`} projectId={projectId} budget={state.projectBudget} codexUsage={codexUsage} disabled={recoveryReadOnly || busy || !!review || !!loadError} execute={execute} />
      {profileIds.map(profileId => <fieldset key={profileId} className="spending-group" disabled={recoveryReadOnly || busy || !!review || !!loadError}>
        <legend>{state.candidates.find(candidate => candidate.profileId === profileId)?.providerDisplay?.model ?? "Saved model details unavailable"}</legend>
        {state.candidates.filter(candidate => candidate.profileId === profileId).map(candidate => <label key={candidate.candidateId} className="spending-work">
          <input type="checkbox" checked={selected.includes(candidate.candidateId)} disabled={!canSelectSpending(candidate) || !!selectedProfile && selectedProfile !== profileId} onChange={() => select(candidate)} />
          <span><strong>{rowLabel(candidate)}</strong>{candidate.providerDisplay && <small>{spendingModelSettings(candidate.providerDisplay)} · profile {candidate.providerDisplay.id} ({candidate.providerDisplay.revision})</small>}<small>{spendingEstimate(candidate.providerDisplay, candidate.estimatedMicros)}</small>
            {candidate.audioDisplay && <small>{spendingAudioSummary(candidate)}</small>}
            <small>{spendingWorkStatus(candidate)}</small></span>
        </label>)}
      </fieldset>)}
      {!review && selected.length > 0 && <div className="spending-actions"><button className="button small" disabled={busy || !!loadError} onClick={() => {
        try { const next = reviewSpending(state, selected, crypto.randomUUID()); setReview({ ...next, labels: selected.map(id => rowLabel(state.candidates.find(candidate => candidate.candidateId === id)!)) }); setReviewError(""); }
        catch (error) { setReviewError(errorText(error)); }
      }}>Review allowance for {selected.length} {selected.length === 1 ? "item" : "items"}</button><button className="text-button" disabled={busy} onClick={() => { setSelected([]); setReviewError(""); }}>Clear selected work</button></div>}
      {spendingPage(state.coverage.candidates, 100).visible && <nav className="spending-pagination" aria-label="Generation work pages"><span>{spendingPage(state.coverage.candidates, 100).label}</span>
        <button disabled={busy || state.coverage.candidates.offset === 0} onClick={() => page("candidates", Math.max(0, state.coverage.candidates.offset - 100))}>Previous work</button>
        <button disabled={busy || state.coverage.candidates.nextOffset === null} onClick={() => page("candidates", state.coverage.candidates.nextOffset!)}>Next work</button></nav>}
    </>}
    {review && <div className="spending-review" aria-labelledby="allowance-review-title"><h4 id="allowance-review-title">{isCodexSpending(review.providerDisplay) ? "Approve this Codex usage" : "Approve this spending allowance"}</h4>
      <p><strong>{review.providerDisplay.model}</strong> · {spendingModelSettings(review.providerDisplay)} · {isCodexSpending(review.providerDisplay) ? "Codex subscription quota" : `${spendingMoney(review.unitMicros)} configured estimate per attempt`}</p>
      <p>Saved profile: {review.providerDisplay.id} ({review.providerDisplay.revision})</p>
      <ul>{review.labels.map((label, index) => <li key={index}>{label}{review.audioDisplays?.[index] && <span> · {spendingAudioSummary({ audioDisplay: review.audioDisplays[index] })}</span>}</li>)}</ul>
      <p>Up to <strong>{review.body.maxAttempts} {isCodexSpending(review.providerDisplay) ? "Codex native" : "generation"} {review.body.maxAttempts === 1 ? "start" : "starts"}</strong>{isCodexSpending(review.providerDisplay) ? ", using your Codex subscription quota. Quota use and availability are not estimated." : <>, with a total configured estimate of <strong>{spendingMoney(review.body.maxEstimatedMicros)}</strong>.</>} Expires {new Date(review.body.expiresAt).toLocaleString()}.</p>
      <p>{isCodexSpending(review.providerDisplay) ? "The USD estimate is zero because this route uses Codex, not the image API; it does not mean usage is free. Every admitted attempt uses one start permission, even if it cannot start or later fails. This approval does not authorize an API fallback or limit quota consumed within a native turn." : "These are configured estimates, not guaranteed provider bills. Every admitted attempt uses a start and its estimate, even if it later fails."} This does not permit replacing a result for quality reasons.</p>
      {!confirmed && !busy && <p role="alert">The selected work is no longer current or could not be refreshed. Return to selection before approving.</p>}
      <div className="spending-actions"><button className="button primary" disabled={recoveryReadOnly || busy || !confirmed} onClick={() => execute(review.command)}>{isCodexSpending(review.providerDisplay) ? "Approve Codex usage" : "Approve spending allowance"}</button>
        <button className="button small" disabled={busy} onClick={() => { setReview(null); setSelected([]); }}>Back to selection</button></div>
    </div>}
    {!!state?.allowances.length && <details className="spending-history" open><summary>Saved allowances · {state.coverage.allowances.total}</summary>
      {state.allowances.map(allowance => <div key={allowance.id}><strong>{allowance.providerDisplay?.model ?? "Historical model details unavailable"} · {spendingAllowanceStatus(allowance)}</strong>
        {allowance.providerDisplay && <p>{spendingModelSettings(allowance.providerDisplay)} · profile {allowance.providerDisplay.id} ({allowance.providerDisplay.revision})</p>}
        <ul>{allowance.work.map(work => <li key={work.candidateId}>{work.historyAvailable ? `${work.alias} · ${spendingOperationLabel(work.operation)}${work.current ? "" : " · historical work"}` : "Historical work details unavailable"}
          {(work.operation === "speech" || work.operation === "transcription") && <span> · {spendingAudioSummary(work)}</span>}</li>)}</ul>
        <p>Recorded {new Date(allowance.createdAt).toLocaleString()} · allowance {allowance.id.slice(0, 8)}</p>
        <p>{spendingAllowanceUsage(allowance)}</p>
        {allowance.restoredHistory && <p>This saved allowance cannot authorize new work. Recorded usage and existing results remain in history.</p>}
        <p>Expires {new Date(allowance.expiresAt).toLocaleString()}</p>
        {!allowance.revoked && (!allowance.expired || allowance.restoredHistory) && <button disabled={recoveryReadOnly || busy} onClick={() => execute(revokeSpending(projectId, allowance.id, crypto.randomUUID()))}>{allowance.restoredHistory ? "Revoke saved allowance" : "Revoke remaining allowance"}</button>}
      </div>)}
      <p>Revocation stops future starts. It does not cancel work already admitted or imply a refund.</p>
      {spendingPage(state.coverage.allowances, 40).visible && <nav className="spending-pagination" aria-label="Allowance history pages"><button disabled={busy || offsets.allowances === 0} onClick={() => page("allowances", Math.max(0, offsets.allowances - 40))}>Newer allowances</button><button disabled={busy || state.coverage.allowances.nextOffset === null} onClick={() => page("allowances", state.coverage.allowances.nextOffset!)}>Older allowances</button></nav>}
    </details>}
  </section>;
}
