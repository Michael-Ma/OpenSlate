import { useProjectRefreshVersion } from "./project-updates";
import { useEffect, useRef, useState } from 'react';
import type { StudioApi } from './api';
import type { NarrationView } from './narration-model';
import type { PendingCommand, PendingCommandSnapshot } from './pending-command';
import { spendingMoney } from './spending-model';
import { canReviewSpeech, speechBlockReason, speechPrepareCommand, speechReviewCommand, speechStatus } from './narration-speech-model';
import type { SpeechDetail, SpeechOptions, SpeechPage, SpeechProposal } from './narration-speech-model';
import './owned-transcription.css';
interface Props { api: StudioApi; projectId: string; view: NarrationView; disabled: boolean; completion: PendingCommandSnapshot;
  execute(command: PendingCommand): void; onReviewSpending?(candidateId: string): void }
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The speech plan could not be loaded.';
export function NarrationSpeechPanel({ api, projectId, view, disabled, completion, execute, onReviewSpending }: Props) {
  const projectUpdate = useProjectRefreshVersion();
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`;
  const [options, setOptions] = useState<SpeechOptions | null>(null), [page, setPage] = useState<SpeechPage | null>(null);
  const [sectionId, setSectionId] = useState(''), [profileId, setProfileId] = useState(''), [voice, setVoice] = useState('cedar'), [instructions, setInstructions] = useState('');
  const [selected, setSelected] = useState(''), [detail, setDetail] = useState<SpeechDetail | null>(null), [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''), [detailError, setDetailError] = useState(''), [checking, setChecking] = useState(false), [loadingMore, setLoadingMore] = useState(false);
  const observed = useRef(0), moreRequest = useRef<AbortController | null>(null);
  useEffect(() => () => moreRequest.current?.abort(), []);
  useEffect(() => { setRefresh(value => value + 1); }, [projectUpdate]);
  useEffect(() => {
    if (completion.settledVersion <= observed.current) return; observed.current = completion.settledVersion;
    if (!completion.lastSuccess) return;
    const metadata = completion.settledCommand?.metadata as { narrationSpeech?: string } | undefined;
    if (metadata?.narrationSpeech === 'prepare') setSelected((completion.result as { proposal: SpeechProposal }).proposal.id);
    if (metadata?.narrationSpeech === 'review') setSelected((completion.result as { receipt: { proposalId: string } }).receipt.proposalId);
    setRefresh(value => value + 1);
  }, [completion.settledVersion]);
  useEffect(() => {
    const abort = new AbortController(); setError('');
    void Promise.all([api.request<SpeechOptions>(`${base}/speech-options`, { signal: abort.signal }), api.request<SpeechPage>(`${base}/speech-proposals`, { signal: abort.signal })]).then(([next, list]) => {
      if (abort.signal.aborted) return; setOptions(next);
      setProfileId(current => next.profiles.some(profile => profile.id === current) ? current : next.profiles[0]?.id ?? '');
      setPage(current => current?.coverage.dataDigest === list.coverage.dataDigest ? current : list);
    }).catch(cause => { if (!abort.signal.aborted) setError(errorText(cause)); });
    return () => abort.abort();
  }, [api, base, view.headVersion, refresh]);
  useEffect(() => {
    const abort = new AbortController(); setDetail(current => current?.proposal.id === selected ? current : null); setDetailError('');
    if (!selected) { setChecking(false); return; } setChecking(true);
    void api.request<SpeechDetail>(`${base}/speech-proposals/${encodeURIComponent(selected)}`, { signal: abort.signal }).then(next => {
      if (!abort.signal.aborted && next.proposal.id === selected) setDetail(next);
    }).catch(cause => { if (!abort.signal.aborted) setDetailError(errorText(cause)); }).finally(() => { if (!abort.signal.aborted) setChecking(false); });
    return () => abort.abort();
  }, [api, base, selected, view.headVersion, view.session?.id, refresh]);
  async function more() {
    if (!page || page.coverage.nextOffset === null || loadingMore) return;
    const previous = page, abort = new AbortController(); moreRequest.current?.abort(); moreRequest.current = abort; setLoadingMore(true);
    try {
      const params = new URLSearchParams({ offset: String(previous.coverage.nextOffset), expectedDigest: previous.coverage.dataDigest });
      const next = await api.request<SpeechPage>(`${base}/speech-proposals?${params}`, { signal: abort.signal });
      if (abort.signal.aborted) return;
      if (next.coverage.dataDigest !== previous.coverage.dataDigest || next.coverage.offset !== previous.coverage.nextOffset) throw Error('Speech history changed. Refresh before loading more.');
      setPage(current => current?.coverage.dataDigest === previous.coverage.dataDigest && current.coverage.nextOffset === previous.coverage.nextOffset
        ? { proposals: [...current.proposals, ...next.proposals], coverage: { ...next.coverage, offset: current.coverage.offset, scanned: current.coverage.scanned + next.coverage.scanned } } : current);
    } catch (cause) { if (!abort.signal.aborted) setError(errorText(cause)); } finally { if (!abort.signal.aborted) setLoadingMore(false); }
  }
  const sections = view.snapshot.segments.filter(row => row.script.source.kind === 'generated' && row.script.textKind === 'draft' && row.script.text.trim());
  const proposal = detail?.proposal;
  return <section className="owned-transcription" aria-labelledby="speech-review-title"><div className="narration-section-header"><h4 id="speech-review-title">Generate narration</h4><button className="text-button" onClick={() => setRefresh(value => value + 1)}>Refresh speech plans</button></div>
    <p>Ask the director to prepare speech from a saved section, or choose one here. Review the exact words and delivery before approving spending.</p>
    {error && <p role="alert">{error}</p>}
    {options && !options.profiles.length && <p>This project has no speech model selected. Create a project with a speech model to prepare narration.</p>}
    {!sections.length && <p>Save a finished draft with “Generated audio” as its recording source first. Longer narration can use several separately reviewed sections.</p>}
    {options && !!sections.length && !!options.profiles.length && <><div className="owned-transcription-fields"><label>Saved section<select value={sectionId} onChange={event => setSectionId(event.target.value)} disabled={disabled}><option value="">Choose a section</option>{sections.map(row => <option key={row.entry.segmentId} value={row.entry.segmentId}>{row.script.text.slice(0, 70)}</option>)}</select></label>
      <label>Speech model<select value={profileId} onChange={event => setProfileId(event.target.value)} disabled={disabled}>{options.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.model} · {profile.id}</option>)}</select></label>
      <label>Voice<select value={voice} onChange={event => setVoice(event.target.value)} disabled={disabled}>{options.voices.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
      <label>Delivery instructions<textarea value={instructions} onChange={event => setInstructions(event.target.value)} maxLength={256} rows={2} disabled={disabled} placeholder="Warm, calm delivery with natural pauses" /></label>
      <p className="field-help">One section per request. The app checks the saved text and instructions against the selected model's limits. Preparing a plan creates no audio.</p>
      <button className="button" disabled={disabled || !sectionId || !options.capabilities.configured} onClick={() => { try { execute(speechPrepareCommand(projectId, crypto.randomUUID(), view, sectionId, options, profileId, voice, instructions)); } catch (cause) { setError(errorText(cause)); } }}>Prepare speech plan</button></>}
    {!!page?.proposals.length && <label className="owned-transcription-history">Saved speech plans<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a plan to review</option>{selected && !page.proposals.some(row => row.id === selected) && <option value={selected}>Selected saved plan</option>}{page.proposals.map(row => <option key={row.id} value={row.id} disabled={!row.proposal}>{row.proposal ? `${row.proposal.segment.text.slice(0, 65)} · ${row.proposal.voice}` : 'Unavailable saved plan'}</option>)}</select></label>}
    {page?.coverage.nextOffset !== null && page && <button className="text-button" disabled={loadingMore} onClick={() => void more()}>Load older speech plans</button>}
    {detailError && <p role="alert">{detailError}</p>}{checking && <p role="status">Checking this exact plan…</p>}
    {detail && proposal && <div className="narration-proposal"><h4>Review narration generation</h4><blockquote style={{ whiteSpace: 'pre-wrap' }}>{proposal.segment.text}</blockquote>
      <p>{proposal.model.provider} · {proposal.model.model} · Voice: {proposal.voice}</p><p>Delivery: {proposal.instructions || 'Default delivery'}</p>
      <p>Configured estimate: {spendingMoney(proposal.estimatedMicros)} per attempt. Actual provider billing may differ.</p>
      <p>{proposal.plan.preservedOperations} existing operations retained; one speech operation added. The result will need your listening review and attachment.</p>
      {!detail.application && <><p role="status">{speechBlockReason(detail.eligibility.code)}</p><button className="button primary" disabled={disabled || !canReviewSpeech(detail, view, checking || !!detailError)} onClick={() => { try { execute(speechReviewCommand(projectId, crypto.randomUUID(), view, detail, checking || !!detailError)); } catch (cause) { setDetailError(errorText(cause)); } }}>Approve speech plan</button></>}
      {detail.application && <><p role="status">{speechStatus(detail.execution.state)}</p>{detail.execution.code && <p>{speechBlockReason(detail.execution.code)}</p>}
        {detail.execution.candidateId && onReviewSpending && <button className="button" disabled={disabled} onClick={() => onReviewSpending(detail.execution.candidateId!)}>Review speech spending</button>}</>}
    </div>}
  </section>;
}
