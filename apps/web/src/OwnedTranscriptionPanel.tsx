import { useProjectRefreshVersion } from "./project-updates";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import type { NarrationView, Recording } from "./narration-model";
import { narrationError } from "./narration-model";
import type { PendingCommand, PendingCommandSnapshot } from "./pending-command";
import { TranscriptViewer } from "./TranscriptReviewPanel";
import { spendingMoney } from "./spending-model";
import { appendTranscriptionProposals, canReviewTranscription, transcriptionBlockReason, transcriptionExecutionNotice, transcriptionPrepareCommand, transcriptionReviewCommand } from "./owned-transcription-model";
import type { TranscriptionApplyReceipt, TranscriptionOptions, TranscriptionProposal, TranscriptionProposalDetail, TranscriptionProposalPage } from "./owned-transcription-model";
import "./owned-transcription.css";

interface Props { api: StudioApi; projectId: string; view: NarrationView; recording: Recording | null; disabled: boolean; completion: PendingCommandSnapshot;
  execute(command: PendingCommand): void; onReviewSpending?(candidateId: string): void }
const errorText = (value: unknown) => value instanceof ApiError ? narrationError(value.code, value.message) : value instanceof Error ? value.message : "The transcription plan could not be loaded.";

export function OwnedTranscriptionPanel({ api, projectId, view, recording, disabled, completion, execute, onReviewSpending }: Props) {
  const projectUpdate = useProjectRefreshVersion();
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`;
  const [options, setOptions] = useState<TranscriptionOptions | null>(null), [page, setPage] = useState<TranscriptionProposalPage | null>(null);
  const [profileId, setProfileId] = useState(""), [language, setLanguage] = useState("auto"), [targetId, setTargetId] = useState("");
  const [selected, setSelected] = useState(""), [detail, setDetail] = useState<TranscriptionProposalDetail | null>(null);
  const [error, setError] = useState(""), [detailError, setDetailError] = useState(""), [refresh, setRefresh] = useState(0), [loadingMore, setLoadingMore] = useState(false), [checking, setChecking] = useState(false);
  const moreRequest = useRef<AbortController | null>(null), observed = useRef(0);
  useEffect(() => () => moreRequest.current?.abort(), []);
  useEffect(() => { setTargetId(""); }, [recording?.id]);
  useEffect(() => { setRefresh(value => value + 1); }, [projectUpdate]);
  useEffect(() => {
    if (completion.settledVersion <= observed.current) return;
    observed.current = completion.settledVersion;
    if (!completion.lastSuccess) return;
    const metadata = completion.settledCommand?.metadata as { ownedTranscription?: string } | undefined;
    if (metadata?.ownedTranscription === "prepare") setSelected((completion.result as { proposal: TranscriptionProposal }).proposal.id);
    if (metadata?.ownedTranscription === "review") setSelected((completion.result as { receipt: TranscriptionApplyReceipt }).receipt.proposalId);
    setRefresh(value => value + 1);
  }, [completion.settledVersion]);
  useEffect(() => {
    const abort = new AbortController(); setError("");
    void Promise.all([api.request<TranscriptionOptions>(`${base}/transcription-options`, { signal: abort.signal }),
      api.request<TranscriptionProposalPage>(`${base}/transcription-proposals`, { signal: abort.signal })]).then(([nextOptions, nextPage]) => {
      if (abort.signal.aborted) return;
      setOptions(nextOptions); setProfileId(current => nextOptions.profiles.some(profile => profile.id === current) ? current : nextOptions.profiles[0]?.id ?? "");
      setPage(current => current?.coverage.dataDigest === nextPage.coverage.dataDigest ? current : nextPage);
    }).catch(cause => { if (!abort.signal.aborted) setError(errorText(cause)); });
    return () => abort.abort();
  }, [api, base, view.headVersion, refresh]);
  useEffect(() => {
    setDetail(current => current?.proposal.id === selected ? current : null); setDetailError("");
    if (!selected) { setChecking(false); return; }
    const abort = new AbortController(); setChecking(true);
    void api.request<TranscriptionProposalDetail>(`${base}/transcription-proposals/${encodeURIComponent(selected)}`, { signal: abort.signal }).then(next => {
      if (!abort.signal.aborted && next.proposal.id === selected) setDetail(next);
    }).catch(cause => { if (!abort.signal.aborted) setDetailError(errorText(cause)); }).finally(() => { if (!abort.signal.aborted) setChecking(false); });
    return () => abort.abort();
  }, [api, base, selected, view.headVersion, view.session?.id, refresh]);
  async function more() {
    if (!page || page.coverage.nextOffset === null || loadingMore) return;
    const prior = page, abort = new AbortController(); moreRequest.current?.abort(); moreRequest.current = abort; setLoadingMore(true); setError("");
    try {
      const query = new URLSearchParams({ offset: String(prior.coverage.nextOffset), expectedDigest: prior.coverage.dataDigest });
      const next = await api.request<TranscriptionProposalPage>(`${base}/transcription-proposals?${query}`, { signal: abort.signal });
      if (abort.signal.aborted) return;
      const merged = appendTranscriptionProposals(prior, next);
      setPage(current => current?.coverage.dataDigest === prior.coverage.dataDigest && current.coverage.nextOffset === prior.coverage.nextOffset ? merged : current);
    } catch (cause) { if (!abort.signal.aborted) setError(errorText(cause)); } finally { if (!abort.signal.aborted) setLoadingMore(false); }
  }
  function prepare() {
    if (disabled || !recording || !options) return;
    try {
      const row = targetId ? view.snapshot.segments.find(value => value.entry.segmentId === targetId) : undefined;
      if (targetId && !row) throw new Error("This section changed. Choose it again.");
      execute(transcriptionPrepareCommand(projectId, crypto.randomUUID(), view, recording, options, profileId, language, row));
    } catch (cause) { setError(errorText(cause)); }
  }
  function review() {
    if (disabled || !detail || checking) return;
    try { execute(transcriptionReviewCommand(projectId, crypto.randomUUID(), view, detail, { checking, failed: !!detailError })); } catch (cause) { setDetailError(errorText(cause)); }
  }
  const sourceSaved = !!recording?.sourceRecordDigest;
  const available = !!options?.capabilities.configured && options.capabilities.audioTools;
  const sections = view.snapshot.segments.filter(row => row.audio?.id === recording?.id && row.entry.audioId === recording?.id);
  const proposal = detail?.proposal, profile = options?.profiles.find(value => value.id === profileId);
  const candidateId = detail?.execution.generationCandidateId;
  const executionNotice = detail ? transcriptionExecutionNotice(detail.execution) : null;
  const proposalTarget = proposal?.target;
  const sectionIndex = proposalTarget?.kind === "section" ? view.snapshot.segments.findIndex(row => row.entry.segmentId === proposalTarget.segmentId && row.script.id === proposalTarget.segmentRevisionId) : -1;
  return <section className="owned-transcription" aria-labelledby="owned-transcription-title"><div className="narration-section-header"><h4 id="owned-transcription-title">Transcribe a recording</h4><button className="text-button" onClick={() => setRefresh(value => value + 1)}>Refresh transcription plans</button></div>
    <p>Review a plan for this recording, then approve its spending separately. You can read the transcript before creating a section.</p>
    {error && <p role="alert">{error}</p>}
    {!options && !error && <p role="status">Loading transcription choices…</p>}
    {options && !available && <p role="status">Transcription planning needs configured local audio tools.</p>}
    {options && !options.profiles.length && <p role="status">This project has no speech recognition model selected. Create a project with a transcription model to use this flow.</p>}
    {!recording ? <p>Choose a saved recording above to listen and prepare its transcript.</p> : <>
      {!sourceSaved && <p>Attach this OpenSlate take to a section first so it is saved in your narration recordings.</p>}
      {options && sourceSaved && !!options.profiles.length && <><div className="owned-transcription-fields"><label>Speech recognition model<select value={profileId} disabled={disabled} onChange={event => setProfileId(event.target.value)}>{options.profiles.map(value => <option key={value.id} value={value.id}>{value.provider} · {value.model} · {value.id}</option>)}</select></label>
        <label>Recording language<select value={language} disabled={disabled} onChange={event => setLanguage(event.target.value)}>{options.languages.map(value => <option key={value} value={value}>{value === "auto" ? "Detect automatically" : value.toUpperCase()}</option>)}</select></label>
        <label>Use this recording for<select value={targetId} disabled={disabled} onChange={event => setTargetId(event.target.value)}><option value="">Independent transcript · choose a section later</option>{sections.map(row => <option key={row.entry.segmentId} value={row.entry.segmentId}>Section {view.snapshot.segments.findIndex(value => value.entry.segmentId === row.entry.segmentId) + 1} · {row.script.text.slice(0, 60) || "Untitled"}</option>)}</select></label></div>
        {profile && <p className="field-help">Configured estimate: {spendingMoney(profile.estimatedMicros)} per attempt. Actual provider billing may differ. Check provider settings for connection readiness.</p>}
        <button className="button" disabled={disabled || !available || !profile} onClick={prepare}>Prepare transcription plan</button></>}
      {sourceSaved && <TranscriptViewer api={api} projectId={projectId} audioId={recording.id} />}
    </>}
    {!!page?.proposals.length && <label className="owned-transcription-history">Saved transcription plans<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a plan to review</option>{selected && !page.proposals.some(value => value.id === selected) && <option value={selected}>Recently prepared plan</option>}{page.proposals.map((value, index) => <option key={value.id} value={value.id}>Plan {index + 1}{value.proposal ? ` · ${value.proposal.audio.durationSeconds.toFixed(1)}s · ${value.proposal.model.model} · ${value.proposal.audio.sha256.slice(0, 8)}` : " · unavailable"}</option>)}</select></label>}
    {page?.coverage.nextOffset !== null && page && <button className="button" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? "Loading plans…" : "Load older transcription plans"}</button>}
    {detailError && <p role="alert">{detailError}</p>}{checking && <p role="status">Checking the selected plan…</p>}
    {detail && proposal && <div className="owned-transcription-proposal"><h4>Review this transcription plan</h4><dl><div><dt>Recording</dt><dd>{proposal.audio.durationSeconds.toFixed(1)}s · {proposal.audio.originEvidence === "verified_generated_audio" ? "Generated by OpenSlate" : proposal.audio.origin === "generated" ? "Generated elsewhere" : "Uploaded"} · {proposal.audio.sha256.slice(0, 8)}</dd></div>
      <div><dt>Model</dt><dd>{proposal.model.provider} · {proposal.model.model} · {proposal.model.profileId}</dd></div><div><dt>Language</dt><dd>{proposal.language === "auto" ? "Detect automatically" : proposal.language.toUpperCase()} · word timing</dd></div>
      <div><dt>Destination</dt><dd>{proposal.target.kind === "recording" ? "Independent transcript; no section is changed" : `${sectionIndex >= 0 ? `Section ${sectionIndex + 1}` : `Previously selected section · ${proposal.target.segmentId.slice(0, 8)}`} · no words or timing are adopted`}</dd></div>
      <div><dt>Configured estimate</dt><dd>{spendingMoney(proposal.estimatedMicros)} per attempt</dd></div></dl>
      <p>Adds one transcription request and keeps {proposal.plan.preservedOperations} existing plan operation{proposal.plan.preservedOperations === 1 ? "" : "s"}. Approval does not accept narration or authorize spending.</p>
      {!detail.application && <>{!detail.eligibility.current && <p role="status">{transcriptionBlockReason(detail.eligibility.code)}</p>}<button className="button primary" disabled={disabled || !canReviewTranscription(detail, view, { checking, failed: !!detailError })} onClick={review}>Approve transcription plan</button></>}
      <p role="status">{executionNotice?.status}</p>
      {executionNotice?.blocker && <p role="status">{executionNotice.blocker}</p>}
      {detail.application && candidateId && onReviewSpending && <button className="button" disabled={completion.running || !!completion.command} onClick={() => onReviewSpending(candidateId)}>Review transcription spending</button>}
      {detail.application && proposal.audio.id !== recording?.id && <TranscriptViewer api={api} projectId={projectId} audioId={proposal.audio.id} />}
    </div>}
  </section>;
}
