import { IconButton } from "./components";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import type { StudioApi } from "./api";
import type { NarrationSegment } from "./narration-model";
import { narrationError, sampleSeconds } from "./narration-model";
import { appendTranscriptCandidates, transcriptIssueText, transcriptPreviewMatches, transcriptSelectionFields } from "./transcript-review-model";
import type { TranscriptList, TranscriptPreview, TranscriptWords } from "./transcript-review-model";
import "./transcript-review.css";

interface Props {
  api: StudioApi; projectId: string; row: NarrationSegment; disabled: boolean;
  useSelection(action: "words" | "timing", fields: Record<string, unknown>): void;
}
const errorText = (error: unknown) => error instanceof ApiError ? narrationError(error.code, error.message) : error instanceof Error ? error.message : "The transcript could not be loaded.";

/** Existing evidence only. Loading pages and previews does not open a narration session or submit a command. */
export function TranscriptReviewPanel(props: Props) {
  return props.row.audio ? <TranscriptReview key={props.row.audio.id} {...props} audioId={props.row.audio.id} /> : null;
}
/** An independent recording can be read without creating a section or granting adoption authority. */
export function TranscriptViewer(props: { api: StudioApi; projectId: string; audioId: string }) {
  return <TranscriptReview key={`${props.projectId}:${props.audioId}`} {...props} disabled />;
}
function TranscriptReview({ api, projectId, row, disabled, useSelection, audioId }: Omit<Props, "row" | "useSelection"> & { audioId: string; row?: NarrationSegment; useSelection?: Props["useSelection"] }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/narration`;
  const [open, setOpen] = useState(false), [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<TranscriptList | null>(null), [listError, setListError] = useState(""), [listBusy, setListBusy] = useState(false);
  const [selected, setSelected] = useState(""), [offset, setOffset] = useState(0), [page, setPage] = useState<TranscriptWords | null>(null), [pageError, setPageError] = useState("");
  const [first, setFirst] = useState(""), [last, setLast] = useState(""), [preview, setPreview] = useState<TranscriptPreview | null>(null), [previewError, setPreviewError] = useState("");
  const [pageHistory, setPageHistory] = useState<number[]>([]);
  const moreRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { moreRequest.current?.abort(); }, []);
  const candidate = list?.candidates.find(value => value.id === selected);
  const start = /^\d+$/.test(first) ? Number(first) - 1 : -1, end = /^\d+$/.test(last) ? Number(last) : -1;
  const rangeValid = !!candidate && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < end && end <= candidate.wordCount;
  const ready = transcriptPreviewMatches(preview, candidate, audioId, start, end);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController(); setListBusy(true); setListError("");
    void api.request<TranscriptList>(`${base}/audio/${encodeURIComponent(audioId)}/transcripts`, { signal: abort.signal }).then(next => {
      if (abort.signal.aborted) return;
      setList(current => current?.coverage.dataDigest === next.coverage.dataDigest ? current : next);
    }).catch(error => { if (!abort.signal.aborted) setListError(errorText(error)); }).finally(() => { if (!abort.signal.aborted) setListBusy(false); });
    return () => abort.abort();
  }, [api, base, audioId, open, refresh]);
  useEffect(() => {
    if (!open || !candidate) { setPage(null); return; }
    const abort = new AbortController(); setPage(null); setPageError("");
    const query = new URLSearchParams({ audioId, candidateDigest: candidate.candidateDigest, offset: String(offset) });
    void api.request<TranscriptWords>(`${base}/transcripts/${encodeURIComponent(candidate.id)}/words?${query}`, { signal: abort.signal }).then(next => {
      if (!abort.signal.aborted && next.candidate.id === candidate.id && next.candidate.candidateDigest === candidate.candidateDigest && next.candidate.audioId === audioId && next.page.offset === offset) setPage(next);
    }).catch(error => { if (!abort.signal.aborted) setPageError(errorText(error)); });
    return () => abort.abort();
  }, [api, base, open, candidate?.id, candidate?.candidateDigest, audioId, offset]);
  useEffect(() => {
    setPreview(null); setPreviewError("");
    if (!open || !candidate || !rangeValid) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ audioId, candidateDigest: candidate.candidateDigest, startWordIndex: String(start), endWordIndex: String(end) });
      void api.request<TranscriptPreview>(`${base}/transcripts/${encodeURIComponent(candidate.id)}/selection?${query}`, { signal: abort.signal }).then(next => {
        if (!abort.signal.aborted && transcriptPreviewMatches(next, candidate, audioId, start, end)) setPreview(next);
      }).catch(error => { if (!abort.signal.aborted) setPreviewError(errorText(error)); });
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [api, base, open, candidate?.id, candidate?.candidateDigest, audioId, start, end, rangeValid]);
  useEffect(() => { if (selected && list && !candidate) { setSelected(""); setOffset(0); setPageHistory([]); setFirst(""); setLast(""); } }, [selected, list, candidate]);
  async function more() {
    if (!list || list.coverage.nextOffset === null || listBusy) return;
    const prior = list, abort = new AbortController(); moreRequest.current?.abort(); moreRequest.current = abort; setListBusy(true); setListError("");
    try {
      const query = new URLSearchParams({ offset: String(prior.coverage.nextOffset), expectedDigest: prior.coverage.dataDigest });
      const next = await api.request<TranscriptList>(`${base}/audio/${encodeURIComponent(audioId)}/transcripts?${query}`, { signal: abort.signal });
      if (abort.signal.aborted) return;
      const merged = appendTranscriptCandidates(prior, next);
      setList(current => current?.coverage.dataDigest === prior.coverage.dataDigest && current.coverage.nextOffset === prior.coverage.nextOffset ? merged : current);
    } catch (error) { if (!abort.signal.aborted) setListError(errorText(error)); } finally { if (!abort.signal.aborted) setListBusy(false); }
  }
  function adopt(action: "words" | "timing") {
    if (!ready || !preview || disabled || !row || !useSelection) return;
    try { useSelection(action, transcriptSelectionFields(row, preview, action)); } catch (error) { setPreviewError(errorText(error)); }
  }
  const chooseStart = (index: number) => { setFirst(String(index + 1)); if (end <= index) setLast(String(index + 1)); };
  const chooseEnd = (index: number) => { setLast(String(index + 1)); if (start < 0 || start > index) setFirst(String(index + 1)); };
  const reasons = ready && preview ? [...new Set(preview.timing.issues.map(issue => transcriptIssueText(issue.code)))] : [];
  return <details className="transcript-review" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Review an existing transcript</summary>
    {open && <div className="transcript-review-body"><p>Recognized words and timing are suggestions for this recording. Using them does not accept your script, recording or timing.</p>
      <div className="narration-actions"><IconButton disabled={listBusy} onClick={() => setRefresh(value => value + 1)} label="Refresh transcripts" icon="refresh" />
        {list?.coverage.nextOffset !== null && list && <button className="button" disabled={listBusy} onClick={() => void more()}>Load more transcripts</button>}</div>
      {listError && <p role="alert">{listError}</p>}{listBusy && <p role="status">Loading transcripts…</p>}
      {list && !list.candidates.length && <p>No completed transcript is listed for this recording{list.coverage.nextOffset !== null ? " on this page. Load more to continue." : " yet."}</p>}
      {!!list?.candidates.length && <label>Transcript<select value={selected} onChange={event => { setSelected(event.target.value); setOffset(0); setPageHistory([]); setFirst(""); setLast(""); }}><option value="">Choose a transcript</option>{list.candidates.map((value, index) => <option key={value.id} value={value.id}>Transcript {index + 1} · {value.wordCount} words · {value.reportedLanguage} · {value.id.slice(0, 8)}</option>)}</select></label>}
      {candidate && <><div className="transcript-range"><label>First word<input aria-label="First transcript word" inputMode="numeric" value={first} onChange={event => setFirst(event.target.value)} /></label><label>Last word<input aria-label="Last transcript word" inputMode="numeric" value={last} onChange={event => setLast(event.target.value)} /></label><span>Choose one continuous range, from 1 to {candidate.wordCount}.</span></div>
        {pageError && <p role="alert">{pageError}</p>}{!page && !pageError && <p role="status">Loading recognized words…</p>}
        {page && <>{page.globalIssues.map(code => <p className="transcript-warning" key={code}>{transcriptIssueText(code)}</p>)}
          {!page.words.length && <p>This transcript contains no recognized words.</p>}
          <div className="transcript-word-scroll"><table><thead><tr><th>Word</th><th>Recognized text</th><th>Recording time</th><th>Choose range</th></tr></thead><tbody>{page.words.map(word => <tr key={word.index} className={word.index >= start && word.index < end ? "selected" : ""}>
            <td>{word.index + 1}</td><td><span className="transcript-word">{word.word}</span>{[...new Set([...word.parserIssues, ...word.sampleIssues].map(transcriptIssueText))].map(reason => <small className="transcript-warning" key={reason}>{reason}</small>)}</td>
            <td>{word.startSeconds.toFixed(3)}–{word.endSeconds.toFixed(3)}s</td><td><button className="text-button" onClick={() => chooseStart(word.index)} aria-label={`Start at word ${word.index + 1}`}>Start here</button><button className="text-button" onClick={() => chooseEnd(word.index)} aria-label={`End at word ${word.index + 1}`}>End here</button></td></tr>)}</tbody></table></div>
          <div className="narration-actions"><button className="button" disabled={!pageHistory.length} onClick={() => { const previous = pageHistory.at(-1); if (previous !== undefined) { setOffset(previous); setPageHistory(values => values.slice(0, -1)); } }}>Previous words</button><span>{page.words.length ? `${page.page.offset + 1}–${page.page.offset + page.page.returned}` : "0"} of {page.page.total}</span><button className="button" disabled={page.page.nextOffset === null} onClick={() => { if (page.page.nextOffset !== null) { setPageHistory(values => [...values, offset]); setOffset(page.page.nextOffset); } }}>Next words</button></div></>}
        {first && last && !rangeValid && <p role="alert">Choose a first and last word within this transcript, in that order.</p>}
        {previewError && <p role="alert">{previewError}</p>}{rangeValid && !ready && !previewError && <p role="status">Checking this selection…</p>}
        {ready && preview && <><div className="transcript-compare">{row && <div><h4>Saved script</h4><p>{row.script.text || "This section has no words yet."}</p></div>}<div><h4>Recognized words{row ? " to use" : ""}</h4>{preview.text === null ? <p>Too many words for one section. Choose fewer words to use them as your script.</p> : <p>{preview.text}</p>}</div></div>
          {preview.warnings.map(issue => <p className="transcript-warning" key={issue.code}>{transcriptIssueText(issue.code)}</p>)}
          <p>{preview.timing.startSample !== null && preview.timing.endSample !== null ? `Suggested recording range: ${sampleSeconds(preview.timing.startSample)}–${sampleSeconds(preview.timing.endSample)}s.` : "No usable recording range is available for this selection."}{row ? " The section's video position stays the same." : ""}</p>
          {!preview.timing.allowed && <div className="transcript-warning" role="status">{reasons.map(reason => <p key={reason}>{reason}</p>)}<p>Choose a smaller valid range, or enter recording timing manually.</p>{preview.timing.issueCoverage.total > preview.timing.issueCoverage.returned && <p>More selected words have timing issues. Review their word pages for details.</p>}</div>}
          {row && disabled && <p className="field-help">Open a current narration session and save or revert edits before using this selection.</p>}
          {row && useSelection ? <div className="narration-actions"><button className="button" disabled={disabled || !preview.writing.allowed} onClick={() => adopt("words")}>Use recognized words</button><button className="button" disabled={disabled || !preview.timing.allowed} onClick={() => adopt("timing")}>Use suggested timing</button></div> : <p className="field-help">To use these suggestions, add or choose a section above, choose its recording source and attach this recording. Review words and timing separately in that section.</p>}</>}
      </>}
    </div>}
  </details>;
}
