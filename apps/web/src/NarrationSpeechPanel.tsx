import { IconButton } from "./components";
import { useProjectRefreshVersion } from "./project-updates";
import { useEffect, useRef, useState } from 'react';
import type { StudioApi } from './api';
import type { NarrationView } from './narration-model';
import type { PendingCommand, PendingCommandSnapshot } from './pending-command';
import { speechBlockReason, speechRequestCommand, speechStatus } from './narration-speech-model';
import type { SpeechDetail, SpeechOptions, SpeechPage, SpeechProposal } from './narration-speech-model';
import './owned-transcription.css';
interface Props { api: StudioApi; projectId: string; view: NarrationView; disabled: boolean; completion: PendingCommandSnapshot;
  execute(command: PendingCommand): void; onRequested?(): void; onViewJobs?(candidateId: string): void }
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The speech plan could not be loaded.';
export function NarrationSpeechPanel({ api, projectId, view, disabled, completion, execute, onRequested, onViewJobs }: Props) {
  const projectUpdate = useProjectRefreshVersion();
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`;
  const [options, setOptions] = useState<SpeechOptions | null>(null), [page, setPage] = useState<SpeechPage | null>(null);
  const [sectionId, setSectionId] = useState(''), [profileId, setProfileId] = useState(''), [voice, setVoice] = useState('cedar'), [instructions, setInstructions] = useState('');
  const [selected, setSelected] = useState(''), [detail, setDetail] = useState<SpeechDetail | null>(null), [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''), [detailError, setDetailError] = useState(''), [checking, setChecking] = useState(false), [loadingMore, setLoadingMore] = useState(false);
  const observed = useRef(completion.settledVersion), moreRequest = useRef<AbortController | null>(null);
  useEffect(() => () => moreRequest.current?.abort(), []);
  useEffect(() => { setRefresh(value => value + 1); }, [projectUpdate]);
  useEffect(() => {
    if (completion.settledVersion <= observed.current) return; observed.current = completion.settledVersion;
    if (!completion.lastSuccess) return;
    const metadata = completion.settledCommand?.metadata as { narrationSpeech?: string } | undefined;
    if (metadata?.narrationSpeech === 'prepare' || metadata?.narrationSpeech === 'request') { setSelected((completion.result as { proposal: SpeechProposal }).proposal.id); if(metadata.narrationSpeech==='request')onRequested?.(); }
    if (metadata?.narrationSpeech === 'review') setSelected((completion.result as { receipt: { proposalId: string } }).receipt.proposalId);
    setRefresh(value => value + 1);
  }, [completion.settledVersion]);
  useEffect(() => {
    const abort = new AbortController(); setError('');
    void Promise.all([api.request<SpeechOptions>(`${base}/speech-options`, { signal: abort.signal }), api.request<SpeechPage>(`${base}/speech-proposals`, { signal: abort.signal })]).then(([next, list]) => {
      if (abort.signal.aborted) return; setOptions(next);
      setProfileId(current => next.preferredProfileId !== undefined ? next.profiles.find(profile => profile.id === next.preferredProfileId)?.id ?? '' : next.profiles.some(profile => profile.id === current) ? current : next.profiles[0]?.id ?? '');
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
  return <section className="owned-transcription" aria-labelledby="speech-review-title"><div className="narration-section-header"><h4 id="speech-review-title">Generate narration</h4><IconButton onClick={() => setRefresh(value => value + 1)} label="Refresh speech plans" icon="refresh" /></div>
    <p>Generate speech from saved writing. Listen to the returned recording before accepting it for the film.</p>
    {error && <p role="alert">{error}</p>}
    {options && (!options.profiles.length || !profileId) && <p>Choose a narration model in Project settings.</p>}
    {!sections.length && <p>Add narration on a storyboard shot, or save writing here to generate a recording.</p>}
    {options && !!sections.length && !!options.profiles.length && <><div className="owned-transcription-fields"><label>Saved section<select value={sectionId} onChange={event => setSectionId(event.target.value)} disabled={disabled}><option value="">Choose a section</option>{sections.map(row => <option key={row.entry.segmentId} value={row.entry.segmentId}>{row.script.text.slice(0, 70)}</option>)}</select></label>
      <p className="field-help">Project narration model: {options.profiles.find(profile => profile.id === profileId)?.model ?? 'Choose in Project settings'}</p>
      <label>Voice<select value={voice} onChange={event => setVoice(event.target.value)} disabled={disabled}>{options.voices.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
      <label>Delivery instructions<textarea value={instructions} onChange={event => setInstructions(event.target.value)} maxLength={256} rows={2} disabled={disabled} placeholder="Warm, calm delivery with natural pauses" /></label>
      <button className="button primary" disabled={disabled || !sectionId || !profileId || !options.capabilities.configured} onClick={() => { try { execute(speechRequestCommand(projectId, crypto.randomUUID(), view, sectionId, options, profileId, voice, instructions)); } catch (cause) { setError(errorText(cause)); } }}>Generate narration</button></>}
    {!!page?.proposals.length && <label className="owned-transcription-history">Saved speech plans<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a plan to review</option>{selected && !page.proposals.some(row => row.id === selected) && <option value={selected}>Selected saved plan</option>}{page.proposals.map(row => <option key={row.id} value={row.id} disabled={!row.proposal}>{row.proposal ? `${row.proposal.segment.text.slice(0, 65)} · ${row.proposal.voice}` : 'Unavailable saved plan'}</option>)}</select></label>}
    {page?.coverage.nextOffset !== null && page && <button className="text-button" disabled={loadingMore} onClick={() => void more()}>Load older speech plans</button>}
    {detailError && <p role="alert">{detailError}</p>}{checking && <p role="status">Checking this exact plan…</p>}
    {detail && proposal && <div className="narration-proposal"><h4>Narration request</h4><blockquote style={{ whiteSpace: 'pre-wrap' }}>{proposal.segment.text}</blockquote>
      <p>{proposal.model.provider} · {proposal.model.model} · Voice: {proposal.voice}</p><p>Delivery: {proposal.instructions || 'Default delivery'}</p>
      {!detail.application && <p role="status">This earlier preparation did not start speech. Use Generate narration with the current saved writing to request it.</p>}
      {detail.application && <><p role="status">{speechStatus(detail.execution.state)}</p>{detail.execution.code && <p>{speechBlockReason(detail.execution.code)}</p>}
        {detail.execution.candidateId && onViewJobs && <button className="button" onClick={() => onViewJobs(detail.execution.candidateId!)}>View job status</button>}
        </>}
    </div>}
  </section>;
}
